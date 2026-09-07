// Pins the OAuth sign-in contract on the member login page: which provider each
// button asks for, which scopes ride along, and where the visitor is sent back
// to afterwards.
//
// The scopes assertion is the load-bearing one. Supabase's azure provider builds
// its authorize URL with the bare `openid` scope, and Microsoft does not
// guarantee the `email` and `name` claims on `openid` alone: with no email
// GoTrue rejects the sign-in outright, and with no name the members row that
// handle_new_user creates gets a null full_name, so the admin panel shows a
// blank name for everyone who signed up with Microsoft. Nothing else in the
// suite goes red if those scopes are dropped — Microsoft sign-in simply starts
// failing in production — which is exactly why it is pinned here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

const LOGIN_HTML = await readFile(new URL('../member-src/login.html', import.meta.url), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 15));

// A Supabase stand-in that records the auth calls the tests assert on. Only the
// members the sign-in paths actually touch are implemented.
function spyClient() {
  const oauth = [];
  const resets = [];
  return {
    oauth,
    resets,
    client: {
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        signOut: async () => {},
        signInWithOAuth: async (args) => {
          oauth.push(args);
          return { error: null };
        },
        resetPasswordForEmail: async (email, options) => {
          resets.push({ email, ...options });
          return { error: null };
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
            order: () => ({ limit: async () => ({ data: [] }) }),
          }),
        }),
      }),
    },
  };
}

// jsdom + the globals both modules read at call time. `location` is a plain
// object so assignments to location.href do not make jsdom throw.
function mountDom(html, { href = 'https://caaci.example/login-3/', pathname = '/login-3/' } = {}) {
  const dom = new JSDOM(html, { url: href });
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
  globalThis.Image = dom.window.Image;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.location = {
    pathname,
    origin: 'https://caaci.example',
    search: '',
    hash: '',
    href,
    reload: () => {},
  };
  globalThis.alert = () => {};
  dom.window.__CAACI_TEST__ = true;
  globalThis.window = dom.window;
  return dom;
}

const btn = (root, provider) => root.querySelector(`button[data-p="${provider}"]`);

test('login page: the Microsoft button carries the email/profile scopes', async () => {
  mountDom(LOGIN_HTML);
  const spy = spyClient();
  member.__setSupa(spy.client);
  await member.wireAuthPage();

  const host = document.querySelector('#caaci-oauth-host');
  assert.equal(host.querySelectorAll('button').length, 2, 'both provider buttons should render');

  btn(host, 'azure').dispatchEvent(new Event('click'));
  await tick();

  assert.equal(spy.oauth.length, 1);
  assert.equal(spy.oauth[0].provider, 'azure');
  assert.equal(
    spy.oauth[0].options.scopes,
    'openid email profile',
    'Microsoft returns no guaranteed email/name claim on the bare openid scope',
  );
  assert.equal(spy.oauth[0].options.redirectTo, 'https://caaci.example/account/');
});

test('login page: the Google button does not narrow Google to a custom scope set', async () => {
  mountDom(LOGIN_HTML);
  const spy = spyClient();
  member.__setSupa(spy.client);
  await member.wireAuthPage();

  btn(document.querySelector('#caaci-oauth-host'), 'google').dispatchEvent(new Event('click'));
  await tick();

  assert.equal(spy.oauth.length, 1);
  assert.equal(spy.oauth[0].provider, 'google');
  assert.equal(spy.oauth[0].options.redirectTo, 'https://caaci.example/account/');
  assert.ok(
    !('scopes' in spy.oauth[0].options),
    'Google already returns email and profile on its defaults; overriding can only remove claims',
  );
});

test('login page: forgot-password returns to the recovery form, not the bare account page', async () => {
  mountDom(LOGIN_HTML);
  const spy = spyClient();
  member.__setSupa(spy.client);
  await member.wireAuthPage();

  document.querySelector('#caaci-li-email').value = 'mei@example.com';
  document.querySelector('#caaci-forgot').dispatchEvent(new Event('click'));
  await tick();

  assert.equal(spy.resets.length, 1);
  assert.equal(spy.resets[0].email, 'mei@example.com');
  assert.equal(
    spy.resets[0].redirectTo,
    'https://caaci.example/account/?recovery=1',
    '?recovery=1 is what makes /account/ render the set-new-password form',
  );
});
