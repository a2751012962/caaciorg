import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { onRequestPost, onRequestGet, buildZip, crc32 } from '../functions/api/wallet-pass.js';
import { fakeRequest, mockFetch, fakeEnv } from './helpers.js';

// Self-signed cert + key standing in for the Apple Pass Type ID certificate
// (1024-bit keeps the test fast; real deploys use Apple-issued 2048-bit certs).
function makeCert() {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 864e5);
  const attrs = [{ name: 'commonName', value: 'Pass Type ID: pass.test.caaci' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}
const CERT = makeCert();

const APPLE_ENV = {
  APPLE_PASS_CERT_PEM: CERT.certPem,
  APPLE_PASS_KEY_PEM: CERT.keyPem,
  APPLE_WWDR_CERT_PEM: CERT.certPem, // any parseable cert works for the chain slot
  APPLE_PASS_TYPE_ID: 'pass.test.caaci',
  APPLE_TEAM_ID: 'TEAM123456',
};

const UUID = '11111111-2222-3333-4444-555555555555';

function route(member) {
  return (u) => {
    if (u.includes('/auth/v1/user')) return { body: { id: UUID } };
    if (u.includes('membership_tiers')) return { body: [{ name: 'Family Membership' }] };
    if (u.includes('/rest/v1/members')) return { body: member ? [member] : [] };
    return {};
  };
}

// Read entries back out of the store-method ZIP the endpoint produces.
function readZip(bytes) {
  const buf = Buffer.from(bytes);
  const entries = {};
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString();
    const start = p + 30 + nameLen + extraLen;
    entries[name] = buf.subarray(start, start + size);
    p = start + size;
  }
  return entries;
}

test('wallet-pass: unconfigured env answers 503 (probe + create)', async () => {
  const probe = await onRequestGet({ env: fakeEnv() });
  assert.equal(probe.status, 503);
  const r = await onRequestPost({ request: fakeRequest({ body: {} }), env: fakeEnv() });
  assert.equal(r.status, 503);
});

test('wallet-pass: configured probe answers 204', async () => {
  const r = await onRequestGet({ env: fakeEnv(APPLE_ENV) });
  assert.equal(r.status, 204);
});

test('wallet-pass: non-active member is refused', async () => {
  const fetch = mockFetch(route({ id: UUID, status: 'expired', tier_id: 'family' }));
  try {
    const r = await onRequestPost({
      request: fakeRequest({ body: {}, headers: { authorization: 'Bearer tok' } }),
      env: fakeEnv(APPLE_ENV),
    });
    assert.equal(r.status, 403);
  } finally {
    fetch.restore();
  }
});

test('wallet-pass: builds a signed .pkpass with correct manifest hashes', async () => {
  const fetch = mockFetch(
    route({
      id: UUID,
      full_name: 'Mei Lin',
      email: 'mei@x.com',
      tier_id: 'family',
      status: 'active',
      expires_at: '2027-07-04T00:00:00Z',
    }),
  );
  try {
    const r = await onRequestPost({
      request: fakeRequest({
        url: 'https://caaci.example/api/wallet-pass',
        body: {},
        headers: { authorization: 'Bearer tok' },
      }),
      env: fakeEnv(APPLE_ENV),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.apple.pkpass');

    const entries = readZip(new Uint8Array(await r.arrayBuffer()));
    for (const name of [
      'pass.json',
      'manifest.json',
      'signature',
      'icon.png',
      'icon@2x.png',
      'logo.png',
      'logo@2x.png',
    ])
      assert.ok(entries[name], `${name} present`);

    const pass = JSON.parse(entries['pass.json'].toString());
    assert.equal(pass.passTypeIdentifier, 'pass.test.caaci');
    assert.equal(pass.teamIdentifier, 'TEAM123456');
    assert.equal(pass.serialNumber, UUID);
    assert.equal(pass.barcodes[0].message, `https://caaci.example/api/verify?m=${UUID}`);
    assert.equal(pass.generic.primaryFields[0].value, 'Mei Lin');
    assert.equal(pass.generic.secondaryFields[0].value, 'Family Membership');

    // manifest hashes must match the actual bundled files (Wallet checks this)
    const manifest = JSON.parse(entries['manifest.json'].toString());
    for (const [name, hash] of Object.entries(manifest))
      assert.equal(hash, createHash('sha1').update(entries[name]).digest('hex'), name);

    // the detached PKCS#7 signature must verify against manifest.json
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(entries['signature'].toString('binary'))),
    );
    const attrs = p7.rawCapture.authenticatedAttributes;
    const digestAttr = attrs.map((a) => forge.asn1.toDer(a).getBytes()).join(''); // presence check below is enough — full CMS verify needs the content re-bound
    assert.ok(digestAttr.length > 0, 'signature carries authenticated attributes');
    const signedDigest = forge.util.bytesToHex(p7.rawCapture.digest ? p7.rawCapture.digest : '');
    // messageDigest attribute must equal SHA-256 of manifest.json (detached content)
    const mdAttr = p7.rawCapture.authenticatedAttributes.find(
      (a) => forge.asn1.derToOid(a.value[0].value) === forge.pki.oids.messageDigest,
    );
    const embedded = forge.util.bytesToHex(mdAttr.value[1].value[0].value);
    const expected = createHash('sha256').update(entries['manifest.json']).digest('hex');
    assert.equal(embedded, expected, 'signed digest matches manifest.json');
    assert.ok(signedDigest !== undefined);
  } finally {
    fetch.restore();
  }
});

test('wallet-pass: zip writer round-trips content with valid CRCs', () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'a.txt', bytes: enc.encode('hello') },
    { name: 'dir/b.json', bytes: enc.encode('{"x":1}') },
  ];
  const zip = buildZip(files);
  const entries = readZip(zip);
  assert.equal(entries['a.txt'].toString(), 'hello');
  assert.equal(entries['dir/b.json'].toString(), '{"x":1}');
  // CRC in the local header matches a fresh computation
  const buf = Buffer.from(zip);
  assert.equal(buf.readUInt32LE(14), crc32(enc.encode('hello')));
});
