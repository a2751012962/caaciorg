<p align="center">
  <a href="https://caaciorg.com"><img src="./web/public/images/logo.png" alt="CAACI — Chinese American Association of Central Illinois" width="120" /></a>
</p>

<p align="center">
  <a href="https://github.com/a2751012962/caaciorg/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/a2751012962/caaciorg/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=000000" /></a>
  <a href="https://caaciorg.com"><img alt="Live at caaciorg.com" src="https://img.shields.io/badge/live-caaciorg.com-B91C1C.svg?style=for-the-badge&labelColor=000000" /></a>
  <img alt="Cloudflare Pages" src="https://img.shields.io/badge/Cloudflare%20Pages-F38020.svg?style=for-the-badge&logo=cloudflarepages&logoColor=white&labelColor=000000" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E.svg?style=for-the-badge&logo=supabase&logoColor=white&labelColor=000000" />
</p>

<p align="center"><b>English</b> · <a href="./README.zh-CN.md">中文</a></p>

# caaciorg

The website of the **Chinese American Association of Central Illinois** (伊利诺伊中部华人协会):
[caaciorg.com](https://caaciorg.com). Bilingual pages, memberships and family plans, event
registration and volunteers, a business directory, member tokens (华协币), columns and
articles under About, and the staff back office, where page text and photos are edited
without code. All on Cloudflare Pages + Supabase + Stripe.

Browser functional tests live in [`e2e/`](./e2e/README.md), written with
[tester-army/e2e](https://github.com/tester-army/e2e). So far that is a read-only smoke
suite of the public pages, run locally on demand, not in CI yet. One of them:

```ts
// e2e/tests/smoke/site.e2e.ts
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('the membership page lists every tier', async ({ app, screen }) => {
  await app.open('/membership/');
  await expect(
    screen.getByRole('heading', { name: 'Membership Tiers & Annual Dues' }),
  ).toBeVisible();
  for (const tier of ['Free', 'Student', 'Individual', 'Family', 'Business']) {
    await expect(screen.getByRole('heading', { name: `${tier} Membership` })).toBeVisible();
  }
});
```

## Quick start

```bash
npm ci
cp .env.example .env   # fill in the values, see SETUP.md
npm run dev            # build, then wrangler pages dev → http://localhost:8788
```

Node 20 or newer for the site; the e2e suite needs Node 22.22+ or 24.8+.
`npm run dev` uses the **live** Supabase project from `wrangler.toml`. Use Stripe
test mode and test cards, and clean up whatever you create.

## Tests

| Command                                                       | What it checks                                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | Unit and contract tests (`node --test`, `test/`): API handlers, migrations on PGlite, RLS, email templates, build routes. |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | ESLint, TypeScript for `web/`, Prettier. CI runs all of these on Node 20 and 24.                                          |
| `cd e2e && npm test`                                          | Browser smoke suite: the public pages answer, in English and Chinese. Start `npm run dev` first.                          |

New features get a functional test in [`e2e/`](./e2e/README.md). The e2e suite only
reads: it never signs up, submits a form, or starts a checkout, because the local
build shares the live database.

## Repository layout

| Path                                                                    | What lives there                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [`web/`](./web)                                                         | The React + Vite site and back office (`/`, `/membership/`, `/events/`, `/account/`, `/admin/`, `/token-admin/`, …). |
| [`functions/api/`](./functions/api)                                     | Cloudflare Pages Functions: checkout, Stripe webhook, family, tokens, admin APIs.                                    |
| [`supabase/`](./supabase)                                               | Numbered SQL migrations, seed data, auth email templates.                                                            |
| [`src/`](./src) · [`member-src/`](./member-src) · [`mirror/`](./mirror) | The progressive-enhancement layer and the pages still served from the WordPress mirror.                              |
| [`build.mjs`](./build.mjs)                                              | Builds `web/` and the mirror into `dist/`, the folder Pages deploys.                                                 |
| [`scripts/`](./scripts)                                                 | Operator scripts run by hand: Stripe wiring and audits, member import, auth and Resend email sync.                   |
| [`e2e/`](./e2e)                                                         | Browser functional tests, with their own `package.json` and lockfile.                                                |
| [`test/`](./test)                                                       | Unit and contract tests.                                                                                             |
| [`docs/`](./docs)                                                       | [CI rules](./docs/CI.md), [UI guideline](./docs/UI_GUIDELINE.md), and notes.                                         |
| [`archive/`](./archive)                                                 | Retired code kept for reference.                                                                                     |

## Branches and deploys

| Branch    | Deploys to                                        | Stripe |
| --------- | ------------------------------------------------- | ------ |
| `main`    | [caaciorg.com](https://caaciorg.com), production  | live   |
| `preview` | beta.caaciorg.com, staff only (Cloudflare Access) | test   |

Feature branches open a pull request into `preview`. `main` takes only `preview`,
`release/*` or `hotfix/*`; CI refuses anything else. A merge into `main` is a release
of the live site.

## Documentation

- [SETUP.md](./SETUP.md): one-time setup, applying migrations, environments and access,
  and how each feature works (memberships, events, volunteers, tokens, family invites,
  the back office).
- [docs/CI.md](./docs/CI.md): what CI refuses and how to add an exception.
- [docs/content-management.md](./docs/content-management.md): columns and articles,
  editing page copy and photos, and the back-office roles (root, administrators,
  content managers).
- [web/DESIGN_SYSTEM.md](./web/DESIGN_SYSTEM.md): design tokens and components for the React site.

## Database migrations

The live project has no migration history table, so `db:push` is disabled on purpose.
Paste each new `supabase/migrations/NNNN_*.sql` into the Supabase SQL editor, in filename
order, before merging the code that needs it. See
[Applying migrations](./SETUP.md#applying-migrations).

## Security

Never commit keys: `.env`, Stripe keys and Cloudflare Access tokens stay outside the
repo, and a test scans for them.
