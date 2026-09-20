# The Tabler back office (retired 2026-09-20)

This is the hand-authored admin panel that served `/admin/` until the React
console took the address over. Nothing here is built, served or linked any more:
`build.mjs` no longer copies it, and `/admin/` is now the React back office in
[`web/src/pages/admin/`](../../web/src/pages/admin/). It is kept for reference —
twelve tabs' worth of behaviour, with the comments that explain why each one
works the way it does.

## What it was

| file                                   | was                                                    |
| -------------------------------------- | ------------------------------------------------------ |
| `index.html`                           | `admin-src/index.html`, built to `/admin/index.html`    |
| `caaci-admin.js`                       | `src/caaci-admin.js`, served as `/assets/caaci-admin.js` |
| `vendor/qrcode.js`                     | `src/vendor/qrcode.js` — the Discounts tab's QR codes   |
| `vendor/filepond*.js`, `filepond*.css` | `src/vendor/` — the Media tab's uploader                |

Tabler, Jodit and the Supabase UMD bundle are still in `src/vendor/`: the member
pages (`/login-3/`, `/privacy/`) and the React console still use them.

## Why it went

The React console (`/admin-next/` while it was being built) reached tab-for-tab
parity — Dashboard, Members & Subscriptions, Families, Payments, Discount codes,
Events, Volunteers, Business directory, Membership plans, Send news, Refunds, My
account — and sign-in had been routing admins there since it shipped. Both
panels always talked to the same `/api/admin/*` Pages Functions, which re-check
the caller on every request, so retiring this page changed no permission: it
removed a second, unmaintained UI over the same endpoints. `/admin-next/` is now
a redirect stub into `/admin/`.

## Its tests

Three jsdom suites booted this markup and module and were deleted with it:
`test/caaci-admin-dom.test.js`, `test/caaci-admin-news-dom.test.js` and
`test/caaci-admin-passwords-dom.test.js`. The last commit that still built and
tested this panel is `04a809d`, so they can be read (or restored) with:

```bash
git show 04a809d:test/caaci-admin-dom.test.js
```

The `/api/admin/*` Functions those suites exercised from the browser side keep
their own server-side tests in `test/admin-*.test.js`, which are untouched.
