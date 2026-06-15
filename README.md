# CAACI

Monorepo for the Chinese American Association of Central Illinois (CAACI).

## Structure

```
.
├── apps/
│   └── web/        # caaciorg.com — Cloudflare Pages + Supabase rebuild
└── .github/        # CI workflows (run per-app)
```

Each project lives under `apps/`. New apps or shared packages can be added
alongside `web/` (e.g. `apps/admin`, `packages/ui`) without restructuring.

## apps/web

The public CAACI website, rebuilt on Cloudflare Pages + Supabase, with Pages
Functions for checkout, RSVP, contact, business listings and the Stripe
webhook. See [`apps/web/SETUP.md`](apps/web/SETUP.md) for setup, environment
variables and deployment.

```bash
cd apps/web
npm install
npm run build      # assemble ./dist
npm run dev        # build + wrangler pages dev
npm run deploy     # build + wrangler pages deploy
```

### Deploying from this monorepo

The web app no longer sits at the repo root, so the Cloudflare Pages project's
**Root directory** must be set to `apps/web` (Pages → Settings → Builds &
deployments). Build output stays `dist` (relative to that root).
