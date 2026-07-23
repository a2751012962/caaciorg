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

| Carried over                                          | Not carried over (private origin data) |
| ----------------------------------------------------- | -------------------------------------- |
| 100% identical UI, all pages, all assets (EN + 中文)  | Existing member accounts / passwords   |
| Membership tiers + real prices                        | Order / payment history                |
| Login, signup, account, membership checkout           | Original plugin settings               |
| Donations, contact form, business-listing, event RSVP |                                        |

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
3. Add a webhook endpoint → `https://<your-domain>/api/stripe-webhook`; subscribe
   these events, then copy the **signing secret** (`whsec_…`):
   - `checkout.session.completed` — activates a membership / marks a donation paid
   - `invoice.paid` — renewal: extends the membership another year
   - `invoice.payment_failed` — flags the member `past_due`
   - `customer.subscription.deleted` — flags the member `cancelled`

### 3. Email (Resend)

Create an API key, verify the sending domain, set `NOTIFY_FROM` / `NOTIFY_TO`.

### 4. Cloudflare Pages

1. `npm install`
2. Connect this repo to Pages **or** use direct upload (below).
3. Set the server-side config. This is a **`wrangler.toml`-managed** project, so the
   Pages dashboard env UI is locked to **Secrets only** (no plain-text "Variables") —
   set them with wrangler, which targets the **production** environment by default:

   ```
   npx wrangler pages secret put SUPABASE_URL              --project-name=caaci
   npx wrangler pages secret put SUPABASE_ANON_KEY         --project-name=caaci
   npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=caaci
   npx wrangler pages secret put STRIPE_SECRET_KEY         --project-name=caaci
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET     --project-name=caaci
   # optional (emails): RESEND_API_KEY, NOTIFY_FROM, NOTIFY_TO
   ```

   Verify with `wrangler pages secret list --project-name=caaci`. **Currently set on
   production:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

   `SUPABASE_URL` / `SUPABASE_ANON_KEY` are public values; `build.mjs` also hardcodes
   them as defaults for the browser bundle (`dist/assets/caaci-config.js`), so the
   client works even without the runtime secrets — only the Pages **Functions**
   (`functions/api/_lib.js`, `rsvp.js`) read them at runtime. **Secret changes bind
   only on the next deployment**, so redeploy after changing one.

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
- Log in / log out via `/login-3/` and `/account/`. (The old duplicate pages —
  `/login/`, `/login-2/`, `/login-4/`, `/login-5/`, `/account-5/`, plus their
  `/zh/` copies — now redirect to these two canonical pages.)

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

## Admin / back-office panel (`/admin/`)

A branded staff panel lives at **`/admin/`**. It is gated two ways:

- **Client:** the page shows nothing until a logged-in admin session is detected.
- **Server (authoritative):** every `/api/admin/*` Function calls `requireAdmin`, which
  validates the caller's Supabase session and re-checks `members.is_admin` with the
  service-role key (RLS is bypassed by the server, so this check is essential).

To grant access, set `is_admin` on a member (see the admin-bootstrap step below), then
visit `/admin/` while logged in. The panel provides:

- **Members & Subscriptions** — search/filter/paginate members; **add** a member (creates a
  login account so they can sign in — set a password or leave it blank for a sign-in link),
  **edit** status / tier / expiry / family inline, and **delete** a member (removes their
  login account too). Subscription state is also updated automatically by the Stripe webhook
  events listed above.
- **Families** — manage family memberships. A household groups several people under one
  membership: link login accounts via a member's _Family_ field, and add family members who
  **don't** have their own login (children, a spouse) directly on the family card. Create,
  edit, and delete families and their members.
- **Compose News** — email an announcement to members (active-only or all) via Resend.
  Recipients are read server-side and never exposed to the browser; each member gets their
  own message. Sends are throttled (one per minute) and require an explicit confirm.
  Requires `RESEND_API_KEY` + `NOTIFY_FROM` to be set. Logged to the `news_posts` table.
- **Discounts** — create discount codes (percent off, optional expiry / redemption cap).
  Every code gets a shareable **QR code** that opens `/membership/?code=XXX` with the
  discount pre-applied — download the image and print it on flyers. Codes are validated
  server-side (`/api/discount`) and re-checked at checkout; Stripe applies them as a
  `duration: once` coupon, so **only the first year is discounted** and renewals bill at
  full price. The webhook counts redemptions atomically (`redeem_discount_code`).
- **Refunds** — issue a refund against any ledger row without leaving the panel.
  Pick a payment, refund the full amount or a partial amount, and the money is
  returned through Stripe (`/api/admin/refunds`) and written back to the row. A
  charge can be refunded more than once up to what was paid; the running
  `refunded_cents` total shows on both the Payments and Refunds tabs. The Stripe
  charge is resolved from whichever reference the ledger stored (Checkout Session
  for the first year, Invoice for renewals), so staff never handle charge ids.
  Requires migration `0009_refunds.sql`.

Apply the admin migrations before using the panel (`supabase db push` runs them all):
`0003_admin.sql` (adds the `past_due` status and the `news_posts` audit table),
`0004_households.sql` + `0005_households_rls.sql` (the `households` / `household_members`
tables and `members.household_id` that power the **Families** tab and member add/edit),
`0006_discounts.sql` (the `discount_codes` table + atomic redemption counter behind the
**Discounts** tab), `0007_signup_phone.sql` (copies the signup form's phone number
onto the members row), `0008_payments.sql` (the `payments` ledger behind the **Payments**
tab), and `0009_refunds.sql` (adds the `refunded_cents` running total + refund audit
columns behind the **Refunds** tab).

## Self-service auth & billing

- **Registration**: `/login-3/` offers "Create an account" (name, email, phone,
  password + confirm, duplicate-email detection, email-confirmation notice). The
  checkout overlay's inline signup enforces the same password rules and detects
  already-registered emails instead of silently continuing. `/register/` (which the
  mirror never captured an index page for) now redirects to `/membership/`.
- **Password reset**: "Forgot your password?" on the login page emails a reset link
  that lands on `/account/?recovery=1` with a set-new-password form.
- **Billing portal**: `/account/` shows the full subscription (plan, status, price,
  renewal date) and a "Manage billing" button — `/api/portal` mints a Stripe Billing
  Portal session for updating cards, viewing invoices, or cancelling. Enable the
  portal once in Stripe Dashboard → Settings → Billing → Customer portal.
- **Payments tracking**: every membership charge (first year + yearly auto-renewal)
  is written to the `payments` ledger by the Stripe webhook. The admin panel's
  **Payments** tab shows the ledger plus live stats — active / past-due / expired
  head-counts and revenue this year — so staff can see who paid, when, and who
  needs to be chased without opening Stripe. Members see their own payment
  history on `/account/`. Requires migration `0008_payments.sql`.
- **Apple Wallet**: active members can add their card to Apple Wallet from
  `/account/` — `POST /api/wallet-pass` builds and signs the `.pkpass` on the
  server. Needs an Apple Developer account ($99/yr) and five secrets; until they
  exist the endpoint answers 503 and the button stays hidden:
  1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers →
     new **Pass Type ID** (e.g. `pass.org.caaci.member`).
  2. Create its certificate; download, import into Keychain, export as `.p12`;
     split: `openssl pkcs12 -in pass.p12 -clcerts -nokeys -out cert.pem` and
     `openssl pkcs12 -in pass.p12 -nocerts -nodes -out key.pem`.
  3. Download Apple's **WWDR G4** intermediate certificate and convert to PEM.
  4. `npx wrangler pages secret put APPLE_PASS_CERT_PEM / APPLE_PASS_KEY_PEM /
APPLE_WWDR_CERT_PEM / APPLE_PASS_TYPE_ID / APPLE_TEAM_ID --project-name=caaci`
  5. Redeploy. The pass front mirrors the web card; its QR is the same live
     `/api/verify` check, and the pass auto-expires with the membership.
- **Digital membership card**: active members see a branded card on `/account/`
  (name, tier, valid-through, QR) and can download it as a PNG to show at partner
  businesses. The QR encodes `/api/verify?m=<member-id>`, a public page that checks
  status LIVE (green valid / red not valid) — so screenshots of expired cards fail.
  It reveals only name, tier, and validity.

## Notes / TODO for the org

- Events: the seed has the 3 annual festivals. Add the rest via the `events` table
  (or build a small admin page) — the live Events Calendar list wasn't in the static mirror.
- Business directory: seed real listings into `business_directory` (set `approved = true`).
- Commercial-plugin look is reproduced via the mirror's CSS — no Divi/MemberPress
  license is required on this stack.

```

```
