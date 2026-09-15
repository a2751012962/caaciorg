// The site language: the visitor's stored choice first, the browser's language
// on a first visit. Covers the pure helpers, the inline script build.mjs puts at
// the top of every mirrored page, and the member pages' own language pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  LANG_KEY,
  browserLang,
  preferredLang,
  mirrorLangBoot,
  mirrorLangScript,
} from '../src/caaci-shared.js';

test('browserLang: the first Chinese or English entry decides, English otherwise', () => {
  assert.equal(browserLang(['zh-CN', 'en-US']), 'zh');
  assert.equal(browserLang(['zh-TW']), 'zh');
  assert.equal(browserLang(['en-US', 'zh-CN']), 'en');
  assert.equal(browserLang(['fr-FR', 'zh-HK']), 'zh');
  assert.equal(browserLang(['ja-JP']), 'en');
  assert.equal(browserLang(undefined), 'en');
});

test('preferredLang: a stored choice beats the browser, anything else is ignored', () => {
  assert.equal(preferredLang('en', ['zh-CN']), 'en');
  assert.equal(preferredLang('zh', ['en-US']), 'zh');
  assert.equal(preferredLang(null, ['zh-CN']), 'zh');
  assert.equal(preferredLang('fr', ['zh-CN']), 'zh');
});

// A mirrored page as mirrorLangBoot sees it: a real jsdom document for clicks,
// a location whose replace() is recorded, and a navigator the test controls.
function mirrorPage({
  path,
  stored,
  languages = ['en-US'],
  userAgent = 'Mozilla/5.0',
  search = '',
  hash = '',
  storage,
}) {
  const same = path.startsWith('/zh/') ? '/zh/events/' : '/events/';
  const dom = new JSDOM(
    `<body><a id="to-zh" href="/zh/about/"><span>Chinese</span></a><a id="to-en" href="/about/">English</a>` +
      `<a id="same" href="${same}">Events</a><a id="away" href="https://example.org/zh/">Elsewhere</a></body>`,
    { url: `https://caaci.example${path}`, virtualConsole: new VirtualConsole() },
  );
  if (stored) dom.window.localStorage.setItem(LANG_KEY, stored);
  const replaced = [];
  const w = {
    document: dom.window.document,
    localStorage: storage || dom.window.localStorage,
    navigator: { languages, userAgent },
    location: {
      pathname: path,
      origin: 'https://caaci.example',
      search,
      hash,
      replace: (url) => replaced.push(url),
    },
  };
  return { dom, w, replaced, stored: () => dom.window.localStorage.getItem(LANG_KEY) };
}

test('first visit: an English page moves a Chinese browser to the /zh/ copy, keeping query and hash', () => {
  const p = mirrorPage({
    path: '/about/',
    languages: ['zh-CN', 'en'],
    search: '?a=1',
    hash: '#top',
  });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, ['/zh/about/?a=1#top']);
  assert.equal(p.stored(), null, 'the browser language is not stored as a choice');
});

test('first visit: an English browser stays on the English page', () => {
  const p = mirrorPage({ path: '/about/', languages: ['en-US', 'zh-CN'] });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, []);
});

test('first visit: a /zh/ page is never left, even by an English browser', () => {
  const p = mirrorPage({ path: '/zh/about/', languages: ['en-US'] });
  mirrorLangBoot(p.w, '/about/', browserLang);
  assert.deepEqual(p.replaced, []);
});

test('first visit: crawlers are not redirected by their browser language', () => {
  const p = mirrorPage({
    path: '/about/',
    languages: ['zh-CN'],
    userAgent:
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
  });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, []);
});

test('a stored choice wins over the page and the browser, in both directions', () => {
  let p = mirrorPage({ path: '/about/', stored: 'zh', languages: ['en-US'] });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, ['/zh/about/']);

  p = mirrorPage({ path: '/zh/about/', stored: 'en', languages: ['zh-CN'] });
  mirrorLangBoot(p.w, '/about/', browserLang);
  assert.deepEqual(p.replaced, ['/about/']);

  p = mirrorPage({ path: '/about/', stored: 'en', languages: ['zh-CN'] });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, []);

  // The home page: /zh is Chinese too, not an English page named "zh".
  p = mirrorPage({ path: '/zh', stored: 'zh' });
  mirrorLangBoot(p.w, '/', browserLang);
  assert.deepEqual(p.replaced, []);
});

test('without a counterpart URL nothing redirects', () => {
  const p = mirrorPage({ path: '/about/', stored: 'zh' });
  mirrorLangBoot(p.w, null, browserLang);
  assert.deepEqual(p.replaced, []);
});

test('clicking a link into the other language stores that language; other links store nothing', () => {
  let p = mirrorPage({ path: '/about/' });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  p.w.document.querySelector('#same').click();
  p.w.document.querySelector('#away').click();
  assert.equal(p.stored(), null);
  p.w.document.querySelector('#to-zh span').click(); // the click lands on the label inside the link
  assert.equal(p.stored(), 'zh');

  p = mirrorPage({ path: '/zh/about/', stored: 'zh' });
  mirrorLangBoot(p.w, '/about/', browserLang);
  p.w.document.querySelector('#to-en').click();
  assert.equal(p.stored(), 'en');
});

test('blocked storage: the browser language still applies and nothing throws', () => {
  const blocked = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  };
  const p = mirrorPage({ path: '/about/', languages: ['zh-CN'], storage: blocked });
  mirrorLangBoot(p.w, '/zh/about/', browserLang);
  assert.deepEqual(p.replaced, ['/zh/about/']);
  assert.doesNotThrow(() => p.w.document.querySelector('#to-zh').click());
});

// The serialised script must run on its own: no reference to anything outside
// the two functions it inlines.
function runInlineScript({ path, stored }) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  const dom = new JSDOM(
    `<!doctype html><html><head>${mirrorLangScript(path.startsWith('/zh/') ? '/about/' : '/zh/about/')}</head>` +
      `<body><a id="to-zh" href="/zh/about/">Chinese</a></body></html>`,
    {
      url: `https://caaci.example${path}`,
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(window) {
        if (stored) window.localStorage.setItem(LANG_KEY, stored);
      },
    },
  );
  return { dom, errors };
}

test('mirrorLangScript: the inlined script runs standalone and redirects', () => {
  const { errors } = runInlineScript({ path: '/about/', stored: 'zh' });
  // jsdom cannot navigate; its "not implemented" report proves replace() was called.
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /navigation/i);
});

test('mirrorLangScript: the inlined click handler stores the choice', () => {
  const { dom, errors } = runInlineScript({ path: '/about/', stored: 'en' });
  assert.deepEqual(errors, []);
  dom.window.document.querySelector('#to-zh').click();
  assert.equal(dom.window.localStorage.getItem(LANG_KEY), 'zh');
  assert.ok(!errors.some((m) => /ReferenceError|TypeError/.test(m)), errors.join('\n'));
});

test('mirrorLangScript: a "<" in the URL cannot close the script tag', () => {
  assert.ok(!mirrorLangScript('/zh/</script><b>/').includes('</script><b>'));
});

// ---------- member pages (caaci-member.js) ----------
const nav = await readFile(new URL('../member-src/_nav.html', import.meta.url), 'utf8');
const privacy = (
  await readFile(new URL('../member-src/privacy.html', import.meta.url), 'utf8')
).replace('<!--CAACI_NAV-->', nav);
globalThis.window = { __CAACI_TEST__: true }; // block auto-boot at import
const member = await import('../src/caaci-member.js');

async function bootMemberPage({ languages, stored, search = '' }) {
  const dom = new JSDOM(privacy, {
    url: `https://caaci.example/privacy/${search}`,
    virtualConsole: new VirtualConsole(),
  });
  Object.defineProperty(dom.window.navigator, 'languages', { value: languages });
  if (stored) dom.window.localStorage.setItem(LANG_KEY, stored);
  dom.window.__CAACI_TEST__ = true;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.location = {
    pathname: '/privacy/',
    origin: 'https://caaci.example',
    search,
    hash: '',
    href: '',
    reload: () => {},
  };
  member.__setSupa(null);
  await member.boot();
  return dom;
}

test('member page: a first visit follows the browser language', async () => {
  const dom = await bootMemberPage({ languages: ['zh-CN', 'en'] });
  const doc = dom.window.document;
  assert.equal(doc.documentElement.lang, 'zh');
  assert.equal(doc.querySelector('#caaci-lang').textContent, 'En');
  assert.equal(doc.querySelector('a.navbar-brand').getAttribute('href'), '/zh/');
  assert.equal(dom.window.localStorage.getItem(LANG_KEY), null);
});

test('member page: the stored choice beats the browser, and ?lang= becomes the stored choice', async () => {
  let dom = await bootMemberPage({ languages: ['zh-CN'], stored: 'en' });
  assert.equal(dom.window.document.documentElement.lang, 'en');
  assert.equal(dom.window.document.querySelector('#caaci-lang').textContent, '中');
  assert.equal(dom.window.document.querySelector('a.navbar-brand').getAttribute('href'), '/');

  dom = await bootMemberPage({ languages: ['en-US'], search: '?lang=zh' });
  assert.equal(dom.window.document.documentElement.lang, 'zh');
  assert.equal(dom.window.localStorage.getItem(LANG_KEY), 'zh');
});

test('member page: the toggle stores the other language', async () => {
  const dom = await bootMemberPage({ languages: ['zh-CN'] });
  dom.window.document.querySelector('#caaci-lang').click();
  assert.equal(dom.window.localStorage.getItem(LANG_KEY), 'en');
});
