# CAACI site — Cloudflare Pages + Supabase

> **LIVE:** https://caaci.pages.dev — deployed & verified (Supabase project
> `gczslluaxccbnftvfayn`, Cloudflare account `ab3df09b…`, Stripe **test** mode).
> See "Post-deploy checklist" at the bottom for the remaining go-live steps.


A rebuild of **caaciorg.com** on a modern stack. The frontend is a byte-for-byte
mirror of the live site (so the UI is identical); the WordPress backend
(MemberPress / WooCommerce / Events Calendar) is replaced by **Supabase**
(auth + database) and **Cloudflare Pages Functions** (API) + **Stripe** (payments).

## Repo layout

```
mirror/                 pristine public mirror of caaciorg.com (do not edit by hand)
src/caaci-app.js        enhancement layer wired onto the mirror's existing forms
build.mjs               mirror/ -> dist/, injects config + app into every page
dist/                   deployable output (generated; git-ignored)
functions/api/*.js      Cloudflare Pages Functions (checkout, webhook, contact, …)
supabase/migrations/    schema + RLS
supabase/seed.sql       membership tiers (real prices) + annual events
wrangler.toml           Cloudflare Pages config (output dir = dist)
.env.example            all required environment variables
```

## What carries over vs. not

| Carried over | Not carried over (private origin data) |
|---|---|
| 100% identical UI, all pages, all assets (EN + 中文) | Existing member accounts / passwords |
| Membership tiers + real prices | Order / payment history |
| Login, signup, account, membership checkout | Original plugin settings |
| Donations, contact form, business-listing, event RSVP | |

## One-time setup

### 1. Supabase
1. Create a project at supabase.com → note **Project URL**, **anon key**, **service_role key**.
2. Apply the schema (SQL editor → paste, or CLI):
   ```
   supabase link --project-ref <ref>
   supabase db push                         # runs migrations/
   supabase db execute --file supabase/seed.sql
   ```
3. Auth → Providers: enable **Email** (password + magic link as desired).
4. Make yourself admin: in the SQL editor,
   `update members set is_admin = true where email = 'you@example.com';`

### 2. Stripe
1. Create products are not needed — checkout uses inline `price_data`.
2. Get the **secret key** (test first: `sk_test_…`).
3. Add a webhook endpoint → `https://<your-domain>/api/stripe-webhook`, event
   `checkout.session.completed`; copy the **signing secret** (`whsec_…`).

### 3. Email (Resend)
Create an API key, verify the sending domain, set `NOTIFY_FROM` / `NOTIFY_TO`.

### 4. Cloudflare Pages
1. `npm install`
2. Connect this repo to Pages **or** use direct upload (below).
3. Set environment variables (Pages → Settings → Environment variables) — all from
   `.env.example`. Mark the secret ones as **encrypted**:
   `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`.
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` must also be present at **build time**
   (they are baked into `dist/assets/caaci-config.js`).

## Local development

```
cp .env.example .env        # fill in values
npm run build               # builds dist/ (bakes public config)
npm run dev                 # wrangler pages dev dist  → http://localhost:8788
```
Use Stripe **test mode** + test cards (4242 4242 4242 4242).

## Deploy

```
npm run deploy              # build + wrangler pages deploy dist
```
Then add the custom domain in the Pages project and point DNS. Set redirects in
`dist/_redirects` if any old URL paths need mapping.

## Verify end-to-end
- Browse every page, toggle EN/中文 — should look identical to the live site.
- Sign up → redirected to Stripe → pay (test card) → webhook flips your member row
  to `active` (check the `members` table) → `/account/` shows the membership.
- Submit the contact form → row in `form_submissions` + email arrives.
- Submit a business listing → row in `business_directory` (pending approval).
- Log in / log out via `/login/` and `/account/`.

## Post-deploy checklist (remaining go-live steps)

- [ ] **Custom domain**: Cloudflare Pages → project `caaci` → Custom domains →
      add `caaciorg.com` / `www`, then point DNS. (Will replace the live WordPress.)
- [ ] **Make yourself admin**: in Supabase SQL editor,
      `update members set is_admin = true where email = 'you@example.com';`
- [ ] **Stripe go-live**: swap the `STRIPE_SECRET_KEY` secret for a live key, create
      a live webhook → `/api/stripe-webhook` (event `checkout.session.completed`),
      set the new `whsec_…`, and redeploy.
- [ ] **Email**: set `RESEND_API_KEY` / `NOTIFY_FROM` / `NOTIFY_TO` secrets so the
      contact + business-listing forms send notifications (they already save to the DB).
- [ ] **Security**: revoke the temporary Supabase Personal Access Token
      (dashboard → Account → Access Tokens) now that provisioning is done; rotate the
      Stripe test key and the Supabase `service_role` key since they passed through chat.
- [ ] Any time you change a secret, **redeploy** (`npm run deploy`) — Pages binds env at deploy time.

## Notes / TODO for the org
- Events: the seed has the 3 annual festivals. Add the rest via the `events` table
  (or build a small admin page) — the live Events Calendar list wasn't in the static mirror.
- Business directory: seed real listings into `business_directory` (set `approved = true`).
- Commercial-plugin look is reproduced via the mirror's CSS — no Divi/MemberPress
  license is required on this stack.
```
