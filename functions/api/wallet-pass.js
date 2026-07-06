// POST /api/wallet-pass — build and sign an Apple Wallet .pkpass for the
// signed-in member's card. The pass front mirrors the web membership card
// (name, tier, valid-through) and its QR encodes the same live /api/verify URL.
//
// Requires an Apple Developer account. One-time setup (see SETUP.md):
//   1. developer.apple.com → Identifiers → Pass Type ID (e.g. pass.org.caaci.member)
//   2. Create its certificate, export the .p12, split into cert + key PEMs
//   3. Download Apple's WWDR intermediate certificate (PEM)
//   4. wrangler pages secret put … for the five APPLE_* values below
// Until those secrets exist this endpoint answers 503 and the account page
// simply hides its "Add to Apple Wallet" button.
import forge from 'node-forge';
import { json, bad, sb, requireUser } from './_lib.js';

// ---- embedded pass artwork (solid brick icon; transparent logo so the
// ---- logoText renders alone). Generated PNGs, base64-embedded.
const ICON_1X =
  'iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAYAAABWk2cPAAAALElEQVR42u3NMQkAAAgAMCtYxKhW1haCsGP3oivnWkilUqlUKpVKpVLpw3QB0ebneKUtQ5AAAAAASUVORK5CYII=';
const ICON_2X =
  'iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAYAAADhu0ooAAAAU0lEQVR42u3PMQEAAAQAMBUUEVVlYjjsWIBFV84HISoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqemcBd4eeCotjgSAAAAAASUVORK5CYII=';
const LOGO_1X =
  'iVBORw0KGgoAAAANSUhEUgAAAKAAAAAyCAYAAADbYdBlAAAANklEQVR42u3BMQEAAADCoPVPbQdvoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABeA30yAAEpbT6xAAAAAElFTkSuQmCC';
const LOGO_2X =
  'iVBORw0KGgoAAAANSUhEUgAAAUAAAABkCAYAAAD32uk+AAAAk0lEQVR42u3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD+BvRzAAHYSQGNAAAAAElFTkSuQmCC';

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---- minimal ZIP writer (store method — .pkpass never needs compression) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// files: [{ name, bytes: Uint8Array }] → complete ZIP as Uint8Array.
export function buildZip(files) {
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v) =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(f.bytes.length),
      u32(f.bytes.length),
      u16(name.length),
      u16(0),
      name,
      f.bytes,
    ];
    central.push({ name, crc, size: f.bytes.length, offset });
    for (const c of local) {
      chunks.push(c);
      offset += c.length;
    }
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const e of central) {
    const rec = [
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(e.crc),
      u32(e.size),
      u32(e.size),
      u16(e.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(e.offset),
      e.name,
    ];
    for (const c of rec) {
      chunks.push(c);
      cdSize += c.length;
    }
  }
  chunks.push(
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(cdSize),
    u32(cdStart),
    u16(0),
  );
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// Detached PKCS#7 signature over manifest.json, signed by the Pass Type ID
// certificate with Apple's WWDR intermediate included in the chain.
export function signManifest(manifestText, { certPem, keyPem, wwdrPem }) {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(keyPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestText, 'utf8');
  p7.addCertificate(cert);
  if (wwdrPem) p7.addCertificate(forge.pki.certificateFromPem(wwdrPem));
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Uint8Array.from(der, (c) => c.charCodeAt(0));
}

const sha1hex = async (bytes) => {
  const d = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function onRequestPost({ request, env }) {
  const configured =
    env.APPLE_PASS_CERT_PEM &&
    env.APPLE_PASS_KEY_PEM &&
    env.APPLE_WWDR_CERT_PEM &&
    env.APPLE_PASS_TYPE_ID &&
    env.APPLE_TEAM_ID;
  if (!configured) return bad('Apple Wallet passes are not configured yet.', 503);

  const gate = await requireUser(request, env);
  if (gate.error) return gate.error;

  try {
    const m = await sb(env).selectOne(
      'members',
      { id: gate.user.id },
      'id,full_name,email,tier_id,status,expires_at',
    );
    if (!m || m.status !== 'active' || !m.tier_id)
      return bad('Only active members can add their card to Apple Wallet.', 403);
    const tier = await sb(env).selectOne('membership_tiers', { id: m.tier_id }, 'name');

    const origin = new URL(request.url).origin;
    const verifyUrl = `${origin}/api/verify?m=${m.id}`;
    const name = m.full_name || m.email || 'CAACI Member';
    const pass = {
      formatVersion: 1,
      passTypeIdentifier: env.APPLE_PASS_TYPE_ID,
      teamIdentifier: env.APPLE_TEAM_ID,
      serialNumber: m.id,
      organizationName: 'Chinese American Association of Central Illinois',
      description: 'CAACI Membership Card · 会员卡',
      logoText: 'CAACI',
      foregroundColor: 'rgb(255,255,255)',
      backgroundColor: 'rgb(142,46,17)',
      labelColor: 'rgb(237,187,95)',
      ...(m.expires_at ? { expirationDate: new Date(m.expires_at).toISOString() } : {}),
      barcodes: [
        { format: 'PKBarcodeFormatQR', message: verifyUrl, messageEncoding: 'iso-8859-1' },
      ],
      generic: {
        primaryFields: [{ key: 'member', label: 'MEMBER · 会员', value: name }],
        secondaryFields: [{ key: 'tier', label: 'PLAN · 方案', value: tier?.name || m.tier_id }],
        auxiliaryFields: m.expires_at
          ? [
              {
                key: 'expires',
                label: 'VALID THROUGH · 有效期至',
                value: new Date(m.expires_at).toLocaleDateString('en-US'),
              },
            ]
          : [],
        backFields: [
          { key: 'verify', label: 'Verify · 验证', value: verifyUrl },
          {
            key: 'org',
            label: 'Organization · 组织',
            value: 'Chinese American Association of Central Illinois · 中伊利诺伊州美国华人协会',
          },
        ],
      },
    };

    const enc = new TextEncoder();
    const files = [
      { name: 'pass.json', bytes: enc.encode(JSON.stringify(pass)) },
      { name: 'icon.png', bytes: b64ToBytes(ICON_1X) },
      { name: 'icon@2x.png', bytes: b64ToBytes(ICON_2X) },
      { name: 'logo.png', bytes: b64ToBytes(LOGO_1X) },
      { name: 'logo@2x.png', bytes: b64ToBytes(LOGO_2X) },
    ];
    const manifest = {};
    for (const f of files) manifest[f.name] = await sha1hex(f.bytes);
    const manifestText = JSON.stringify(manifest);
    const signature = signManifest(manifestText, {
      certPem: env.APPLE_PASS_CERT_PEM,
      keyPem: env.APPLE_PASS_KEY_PEM,
      wwdrPem: env.APPLE_WWDR_CERT_PEM,
    });
    files.push({ name: 'manifest.json', bytes: enc.encode(manifestText) });
    files.push({ name: 'signature', bytes: signature });

    return new Response(buildZip(files), {
      headers: {
        'content-type': 'application/vnd.apple.pkpass',
        'content-disposition': 'attachment; filename="caaci-membership.pkpass"',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return bad(e.message, 500);
  }
}

// Config probe for the account page: 204 when Wallet is ready, 503 when not —
// so the "Add to Apple Wallet" button only appears once certificates exist.
export async function onRequestGet({ env }) {
  const configured =
    env.APPLE_PASS_CERT_PEM &&
    env.APPLE_PASS_KEY_PEM &&
    env.APPLE_WWDR_CERT_PEM &&
    env.APPLE_PASS_TYPE_ID &&
    env.APPLE_TEAM_ID;
  return configured ? new Response(null, { status: 204 }) : json({ configured: false }, 503);
}
