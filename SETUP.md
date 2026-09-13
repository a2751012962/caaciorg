# CAACI site — Cloudflare Pages + Supabase

> **LIVE:** https://caaci.pages.dev — deployed & verified (Cloudflare account
> `ab3df09b…`, Stripe **test** mode).
> See "Post-deploy checklist" at the bottom for the remaining go-live steps.

> **Supabase project moved.** The backend is now `wslzeqhipvibeflmxznh`
> (org `dduletwxytbduspygnxh`, us-east-1); the old project was
> `gczslluaxccbnftvfayn`. Schema (migrations `0001`–`0010` + seed), the `media`
> storage bucket, both auth users and every table row were copied across and
> verified row-for-row. **The deployed site still points at the old project
> until the Pages secrets are updated and it is redeployed** — see
> "Post-deploy checklist".

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
stripe-connect.mjs      one-shot Stripe wiring (webhook + billing portal) for acct_1PfYMi…
stripe-audit.mjs        read-only inventory of a Stripe mode (what the cutover must not break)
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
2. Apply the schema: in the Supabase SQL editor, paste and run each file in
   `supabase/migrations/` in filename order (`0001_init.sql` first), then
   `supabase/seed.sql`. Apply every later migration the same way — see
   [Applying migrations](#applying-migrations).
3. Auth → Providers: enable **Email** (password + magic link as desired).
4. Make yourself admin: in the SQL editor,
   `update members set is_admin = true where email = 'you@example.com';`

### 2. Stripe

Payments run through account **`acct_1PfYMiJ3oYxWrRWD`**
([dashboard](https://dashboard.stripe.com/acct_1PfYMiJ3oYxWrRWD/dashboard)). Three
things to wire up per mode: a key, a webhook endpoint + Billing Portal
(`stripe:connect`), and the tier catalogue (`stripe:catalog`).

**Catalogue.** Each paid tier in `membership_tiers` gets one Stripe Product and one
yearly Price (base price + 3.5% card fee) tagged `lookup_key = caaci_<tier>_year`.
Checkout and change-plan resolve the Price by that key at request time, so no
Stripe IDs live in the database and the same code serves test and live mode.
If the catalogue is missing in a mode, checkout falls back to inline `price_data`
— it still works, but every payment then mints its own ad-hoc product and the
Dashboard's per-product MRR becomes noise. Run once per mode, and again after
changing a price in Supabase (it re-prices and archives the old Price; existing
subscribers stay on what they signed up for).

It **reuses before it creates**: a tier lives on the active Product tagged with its
`tier_id`, or else the one with the same name — in live mode that is the old
MemberPress "Family Membership" / "Individual Membership" product, so legacy
subscribers (still on their $60 / $30 Prices) and new members share one Product.
An existing active yearly Price of the exact amount is tagged; only a missing Price or
Product is created. The script never archives or re-activates a Price it did not
create (no `metadata.source` / `base_cents`), so MemberPress plans stay as they are,
and if Stripe refuses to tag a legacy Price that tier is left unwritten and the run
exits 1 rather than minting a duplicate. `$0` tiers (free, honorary) never reach
Stripe Checkout and get no Price. Always read the report before `--apply`:

```
npm run stripe:catalog              # report only
npm run stripe:catalog -- --apply   # create / re-price
```

1. Copy the **secret key** for the mode you want (Developers → API keys):
   `sk_test_…` while testing, `sk_live_…` at go-live.
2. Run the connector. It reads the key from the environment (never prints it),
   refuses to touch any account other than the one above, and reports before it
   changes anything:

   ```
   # PowerShell
   $env:STRIPE_SECRET_KEY='sk_…'; npm run stripe:connect              # report only
   $env:STRIPE_SECRET_KEY='sk_…'; npm run stripe:connect -- --apply   # create/repair

   # bash
   STRIPE_SECRET_KEY=sk_… npm run stripe:connect -- --apply
   ```

   With `--apply` it creates the webhook endpoint on
   `https://caaci.pages.dev/api/stripe-webhook` (override with
   `-- --site-url=https://…`), subscribed to exactly the events the handler
   branches on, and writes the new signing secret to `.env`:
   - `checkout.session.completed` — activates a membership / marks a donation paid
   - `invoice.paid` — renewal: extends the membership another year
   - `invoice.payment_failed` — flags the member `past_due`
   - `customer.subscription.deleted` — flags the member `cancelled`
   - `charge.refunded` — writes the charge's refunded total onto its `payments` row,
     so a refund issued in the Stripe Dashboard shows on the Payments / Refunds tabs
     just like one issued from the admin panel. An existing endpoint picks the new
     event up on the next `stripe:connect -- --apply` (repaired in place, same secret).

   It also creates a Billing Portal configuration if the account has none —
   `/api/portal` mints portal sessions without naming one, so Stripe needs an
   account default or "Manage billing" fails on the account page.

   Re-running is safe: a healthy account produces no writes. An endpoint that is
   missing events or was auto-disabled gets repaired in place, which keeps its
   existing signing secret (so the deployed `STRIPE_WEBHOOK_SECRET` stays valid).

3. Put the same two values on Cloudflare Pages (step 4) and redeploy — **test and
   live keys are different, and so are their webhook signing secrets**, so a
   test→live switch means updating both secrets together.

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

## Applying migrations

<!-- db-push-warning -->

> **Never run `supabase db push` (or `npm run db:push`) against the live project
> `wslzeqhipvibeflmxznh`.** Every migration there was applied by pasting it into the
> SQL editor, so the project has no `supabase_migrations.schema_migrations` table and
> the CLI believes none of them has run: a push would replay every file in
> `supabase/migrations/`, from `0001_init.sql` onward, against production.
> `npm run db:push` refuses and points here.

<!-- /db-push-warning -->

To apply a new migration, open the project's SQL editor, paste the new
`supabase/migrations/NNNN_*.sql` file and run it. If several are pending, run them one
at a time in filename order, each only after the one before it succeeded.

Do not paste `supabase/seed.sql` into the live project: its `on conflict (id) do update`
resets every membership tier's name, price, description, sort order and invite-only flag
to the values in the file. `npm run db:seed` refuses for the same reason.

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

## Migrating the live members off WordPress

The WordPress site (MemberPress) and this site bill through the **same** Stripe
account, so **nothing moves inside Stripe**. Customers, saved cards, subscriptions
and payment history stay exactly where they are; members are never asked to
re-enter a card. What has to happen is that Supabase learns about them.

`migrate-members.mjs` does that from the Stripe history. Every MemberPress charge,
PaymentIntent and subscription carries `memberpress_product` metadata, so the
script finds everyone who ever paid for a membership and creates or updates their
login and `members` row. Stripe is only read (GET). Run it from the repo root with
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` and the live Stripe key in
`../stripe-live.env` (an env-style file or a bare `sk_live_…` / `rk_live_…` key;
`--stripe-env` wins over any `STRIPE_SECRET_KEY` in `.env`).

1. **Dry run** — reads everything, writes nothing. It prints the account id and
   LIVE/TEST mode, then a masked table (`a***@example.com`, no names) with each
   person's action, tier, status and expiry, plus every warning and skip reason:

   ```
   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env
   ```

   Add `--report=migrate-report.json` for the full plan with emails and names; it
   is gitignored because it is a roster, so delete it when done. If a payer's email
   is mistyped in Stripe (the table flags domains like `gmai.com`), add
   `--fix-email=<typed>=<correct>` (repeatable) and the account is created, or
   matched, under the corrected address.

2. **Canary** — apply one or two people you can check by hand in `/admin/`:

   ```
   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env --only=<email>,<email> --apply
   ```

3. **Everyone**:

   ```
   node --env-file=.env migrate-members.mjs --stripe-env=../stripe-live.env --apply
   ```

   It stops at the first error and says how far it got. Re-running is safe:
   people already written plan as `unchanged`. After writing, it reads the rows
   back and prints how many match the plan.

What the import does, and does not do:

- **No email is sent.** Accounts are created already confirmed through the Auth
  admin API — no invite, magic link, recovery or confirmation mail. Members set a
  password or use a one-time code the next time they sign in.
- **One-time payers** (MemberPress "for 1 Year") get `expires_at` = their last
  membership payment + 1 year: `active` while that is in the future, `expired`
  after. The tier comes from the latest payment's product; a change of product
  over the years is listed as a warning.
- **Subscribers keep their old MemberPress price.** Their row gets the
  subscription and customer ids and `expires_at = current_period_end`. Each
  renewal then lands on `/api/stripe-webhook`, which finds them by those ids
  (`findMember`) and sets the expiry to the paid invoice's billing period end.
  They re-price only when they change plan. Keep the MemberPress Price and
  Product objects — deleting them breaks live subscriptions.
- **Existing accounts are matched by email.** A free member who paid on the old
  site is upgraded to the paid tier and keeps the earlier `member_since`.
  `is_admin`, household, phone and notes are never touched. Honorary members,
  anyone whose membership here already runs longer, and conflicting subscription
  ids are skipped with a reason for a human to handle. Family plans need no
  `households` row up front.
- **Both webhooks fire during the overlap.** The MemberPress endpoint
  (`caaciorg.com/mepr/notify/…`) keeps updating WordPress while the new endpoint
  updates Supabase. That is fine, and it is the safe order: stand the new one up
  first, retire the old one only after DNS moves.

For an aggregate, PII-free inventory of the account first, `npm run stripe:audit`
still works.

## Post-deploy checklist (remaining go-live steps)

- [ ] **Custom domain**: Cloudflare Pages → project `caaci` → Custom domains →
      add `caaciorg.com` / `www`, then point DNS. (Will replace the live WordPress.)
- [ ] **Make yourself admin**: in Supabase SQL editor,
      `update members set is_admin = true where email = 'you@example.com';`
- [ ] **Stripe go-live**: run `npm run stripe:connect -- --apply` with the **live**
      key of `acct_1PfYMiJ3oYxWrRWD` (see step 2) — it creates the live webhook and
      Billing Portal config and writes the new `whsec_…` to `.env`. Then set both
      `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Pages secrets and redeploy.
      Live mode has its own webhook endpoint and signing secret: update both, or the
      webhook 400s on every event and nothing activates after payment.
- [ ] **Email**: set `RESEND_API_KEY` / `NOTIFY_FROM` / `NOTIFY_TO` secrets so the
      contact + business-listing forms send notifications (they already save to the DB).
- [x] **Point the deployment at the new Supabase project** (`wslzeqhipvibeflmxznh`) —
      done on the `caaci-8s2` Pages project: `SUPABASE_SERVICE_ROLE_KEY` is the new
      project's key and the site is redeployed. If the key is ever rotated, set it
      again with `npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY --project-name=caaci`
      and redeploy, or every `/api/*` Function 401s.
- [ ] **Security**: revoke the temporary Supabase Personal Access Token
      (dashboard → Account → Access Tokens) now that provisioning is done; rotate the
      Stripe test key and **both** projects' `service_role` keys since they passed
      through chat (then re-set the Pages secret as above and redeploy).
- [ ] Any time you change a secret, **redeploy** (`npm run deploy`) — Pages binds env at deploy time.

## Site language (EN / 中文)

A visitor sees the language they last chose and, until they choose one, the
language their browser asks for (the first Chinese or English entry in
`navigator.languages`; anything else is English).

- **The choice** is stored in `localStorage` under `caaci-lang`. It is set by the
  member-page toggle, a `?lang=zh|en` link, and a click on any link from one
  language copy of a mirrored page to the other (TranslatePress's floating
  switcher). The admin panel keeps its own `caaci-admin-lang` and falls back to
  `caaci-lang`, then the browser.
- **Mirrored pages** exist twice (`/about/`, `/zh/about/`). `build.mjs` puts an
  inline script (`mirrorLangScript` in `src/caaci-shared.js`) at the top of each
  `<head>` with the other copy's URL, so the switch happens before anything
  renders. It keeps `?query` and `#hash`.
- **Without a stored choice** a `/zh/` page is never left (the visitor opened a
  Chinese link on purpose), and crawlers (`bot|crawl|spider|slurp` user agents)
  are never redirected, so both copies stay indexable.
- To reset during testing: `localStorage.removeItem('caaci-lang')` in the console.

## Member pages (`/login-3/`, `/membership/`, `/account/`)

The three member-facing flows are standalone **Tabler** pages (same open-source
UI kit as `/admin/`, self-hosted, bilingual EN/中文 with a toggle), replacing the
mirrored WordPress pages **at the same URLs** — every inbound link and Stripe
return URL keeps working:

- **`/login-3/`** — sign in, create account (with duplicate-email detection),
  forgot-password (reset link lands on `/account/?recovery=1`), and Google /
  Microsoft OAuth.
- **`/membership/`** — the plan grid (live `membership_tiers` merged over the
  built-in fallback), `?code=` discount validation, and the checkout dialog:
  fresh joins POST `/api/checkout` (Stripe Checkout), active members switching
  plans POST `/api/change-plan` (in-place proration). The self-serve **Free**
  tier (`free`, $0, no festival perks) skips Stripe entirely: `/api/checkout`
  activates it directly (`{ activated: true }`, no expiry) and the page lands on
  `/account/`; a member with a live paid subscription must cancel it in the
  billing portal before moving to free. `/register/<tier>/` pages
  and the `/zh/` copies now redirect here (`?tier=` pre-opens the dialog,
  `?lang=zh` preselects Chinese).
- **`/account/`** — profile, subscription status, Stripe billing portal
  (`/api/portal`), payment history (RLS self-read), the digital membership card
  (live-verifying QR + PNG download + Apple Wallet when configured), the
  password-recovery form, and the **Family** card.

### Family card on `/account/`

Self-service family invitations. A family is at most **3 people including the
founder** (the family-plan holder); linked accounts, name-only people and
pending invites all count. The page loads `GET /api/family` once (Bearer token,
like the billing portal) and again after every successful change; if it fails
(404, 500, network) the card stays hidden and the rest of the page is untouched.
The server enforces every rule; the card mirrors them and shows its errors.

- **Invitations for you** (any role): "\<founder email\> invited you to join their
  CAACI family membership", expiry, **Accept** / **Decline** (decline confirms).
  The invitation email links to `/account/?family_invite=<id>`, which highlights
  and scrolls to that invitation; an id that isn't in the list gets an
  explanation (expired, already used, or sent to another address) naming the
  signed-in email. The id is never rendered.
- **Signed out** with `?family_invite`: the Sign in link carries
  `next=/account/?family_invite=<id>`, so the member lands back on it.
- **No family yet** (`can_start_family: true`; a response without that field
  falls back to the member's own active `family` tier): "Invite your family"
  with the seat counter (1 / 3), the invite form (email; name and relationship
  optional) and the add-a-person form for someone without an account (e.g. a
  young child). Either one creates the household.
- **Founder**: family name, plan status and expiry, seats used / limit; people
  with a Founder badge and "Linked account" / "Not linked to an account";
  **Remove** on everyone but the founder (the last other person can't be
  removed, dissolve instead); pending invitations with **Cancel** and **Resend**
  (60 s cooldown per address, also started by a 429); both forms, disabled once
  the family is full; **Dissolve family**; and the activity log (name-only
  people appear by `subject_name`). After an invite the notice says whether an
  invitation or a sign-in-link email went out (`delivered`).
- **Inviting a name-only person**: **Invite by email** on their row opens an
  email field in that row and sends `invite` with their `person_id`. Accepting
  links the existing row instead of taking a seat, so this works even when the
  family is full (3 / 3) and the general forms are disabled. While a pending
  invite carries that row's `person_id`, the row says "Invitation pending to
  \<email\>" and its button is disabled; cancel or resend it from the pending
  list. A second invite for the same person gets the server's 409 as the notice.
- **Member**: family name, founder email, plan status and expiry, **Leave family**.
- **Membership card**: a member or founder without an active tier of their own
  gets the digital card from an active family plan (tier named by
  `plan.tier_id`, falling back to the family tier; plan expiry); it disappears
  when they leave or the plan lapses.

Source: `member-src/*.html` + `src/caaci-member.js` (+ `src/caaci-shared.js`,
pure helpers shared with the mirror layer `caaci-app.js`). The rest of the site
remains the untouched mirror; `caaci-app.js` still powers its forms.

## Event registration (`/events/<slug>/register/`)

Any published event can take registrations, and **no account is needed** to
register. One standalone bilingual Tabler page (`member-src/event-register.html`,
wired by `wireEventFormPage` in `src/caaci-member.js`) serves every event.

- **Routes.** `build.mjs` writes the page to `/event-register/` and a
  `dist/_redirects` whose 200 rewrites serve it at `/events/<slug>/register/`
  (with or without the trailing slash). The page takes the slug from its
  `data-event` attribute, else the path, else `?event=`. `/mid_autumn_festival_form/`
  — the URL on the printed Mid-Autumn QR codes — is a copy with
  `data-event="mid-autumn-festival"`. The local static server (`serve-mirror.mjs`)
  does not apply `_redirects`; preview there with `/event-register/?event=<slug>`.
- **Setting up an event** (Admin → Events → edit): a Chinese title, the
  "Accept registrations" switch and the question builder — single choice or
  multiple choice (either can offer "Other" with a text box), short text and long
  text, each with English and Chinese labels and a "required" box. Question and
  option ids are generated once and never change, so relabelling keeps earlier
  answers readable. Every open event lists its registration link and a printable
  QR code. Registration closes when the event ends (`ends_at`, else `starts_at`).
- **Free gift** (optional): the gift's name in both languages and the free-gift
  deadline (`events.perk_deadline`; empty means the event start). A registration
  qualifies when it was submitted **and** the registrant holds an email-confirmed
  CAACI account with that email (or submitted while signed in with it), both by the
  deadline. An event without a gift name shows no gift wording anywhere. The
  success screen offers "Create a free account" (`/login-3/?signup=1`; the email is
  handed over in `sessionStorage`, never in the URL).
- **Submitting** POSTs `/api/event-register`, which validates the answers against
  the event's questions (`functions/api/_event-form.js`) and writes
  `event_registrations.answers` (keyed by question id) with the service-role key
  (the table has RLS on and no browser privileges). One row per email per event:
  resubmitting updates the answers but keeps the first `created_at`, the
  registration time used for the gift cutoff.
- **Emails** share one layout (`functions/api/_event-emails.js`). The first
  submission sends the registrant a confirmation with the event details, their
  multiple-choice answers and the gift step. It never carries typed text (text
  answers, "Other" text, or the address itself), so the public endpoint cannot be
  used to mail arbitrary copy from CAACI. **Admin → Compose News → Template "Event
  announcement"** fills the subject and body for a published event with
  registrations turned on; edit and preview before sending. Both need
  `RESEND_API_KEY` and `NOTIFY_FROM`; `NOTIFY_TO` is the confirmation's reply-to.
- **Resend Templates.** `npm run resend:templates` (dry run) and
  `npm run resend:templates -- --apply` publish the same two layouts to Resend as
  Templates (aliases `event-registration-confirmation` and `event-announcement`)
  with `{{{VARIABLE}}}` slots. This needs a full-access `RESEND_API_KEY` in the
  environment, not the site's sending-only key. The site does not read these
  copies; they are for sending through the Resend API by hand.
- **Admin → Events → Registrations**: one column per question, per-option counts,
  the account and gift-eligibility columns, and a CSV export.
- **Migrations:** `0015_event_registrations.sql`, then `0018_event_forms.sql`
  (Chinese title, questions and gift names on `events`, `answers` on
  registrations; it backfills the Mid-Autumn questions and that event's existing
  registrations). Paste 0018 into the Supabase SQL editor (never `supabase db
push`) **immediately before** deploying this code — the API and the admin
  events list read the new columns. 0018 only adds, so the previously deployed
  code keeps working once it is applied, and a temporary trigger keeps `answers`
  in step with the legacy columns that code still writes, until a later cleanup
  migration drops the trigger and those columns.
- **Testing on a preview deployment:** preview uses the live Supabase database and
  sends real email. Test registrations there against a separate, temporary
  published event — never the Mid-Autumn event, whose rows the production admin
  reads — then delete that event (its registrations cascade). Confirmation emails
  sent from a preview link back to the preview host.

## Family invitations (`/api/family`)

A member on the family plan (`members.tier_id = 'family'`) is the family's
**founder**. From `/account/` they invite people by email, add name-only people
(e.g. young children, no account) and manage the family; everyone else in it can
leave. Joined members get the family plan's benefits while the founder's plan is
active (families an admin made by hand, with no founder, keep using the
`households` row's plan).

- **3 people at most, founder included.** Linked accounts, name-only people and
  pending, unexpired invitations all count. The cap is enforced in Postgres by the
  `family_*` functions in `0017`, which lock the household row before counting, so
  two invitations sent at once cannot both take the last seat. The founder cannot
  remove the last other person; they dissolve the family instead (accounts are
  unlinked, name-only people deleted, pending invitations cancelled, the history
  in `household_events` kept).
- **A name-only person can be given a login**: inviting with their `person_id`
  takes no extra seat (they already hold one), and accepting links their existing
  row. Removing that person cancels the invitation.
- **Invitations** last 14 days, can only be sent while the founder's plan is
  `active`, and are accepted by signing in with the invited address. They are
  Supabase Auth emails through the project's SMTP: a new address gets the Invite
  template, an existing confirmed login the Magic Link template, an existing
  unconfirmed login the Invite template again. The link lands on
  `/account/?family_invite=<id>`, so `/account/` must be allowed by the Site URL
  or the redirect allow list. The templates show "_founder login email_ invited
  you" from `user_metadata.family_invite_from`, which `/api/family` sets just
  before the send and clears right after it, and again on accept, decline, cancel
  or expiry; outside that one `{{ if }}` block both templates read as before.
- **Founder emails** (someone joined or left) and the removed member's email go
  through Resend (`RESEND_API_KEY` + `NOTIFY_FROM`). Without them the action still
  succeeds and answers `notified: false`. They carry fixed bilingual copy and login
  email addresses only, never a typed name.
- **The founder's plan** must be the `family` tier, `active` and unexpired for
  them to invite, resend, add people or start a family, and for an invitation to
  be accepted. Removing a person and leaving run in locked `family_*` functions
  too, so two changes at once cannot leave the founder alone by accident.
- **Membership cards** (`/api/verify`, Apple Wallet) of a joined member with no
  plan of their own show the family plan: the founder's tier and expiry, or the
  `households` row's for a legacy family.
- **Deploy order:**
  1. Deploy this code. It is safe before `0017`: the account page hides the family
     card while `/api/family` errors, and cards keep working for members with
     their own plan (and legacy families).
  2. Paste `0017_family_invites.sql` into the Supabase SQL editor. The family
     card and invitations work from then on.
  3. Push the templates: `npm run auth:emails` (dry run), then
     `npm run auth:emails -- --apply`, close to the deploy:
     `test/auth-config.test.js` compares the repo templates with the live project
     exactly, so the two must not drift apart.
  4. For founder emails, set the `RESEND_API_KEY` and `NOTIFY_FROM` secrets in
     Cloudflare Pages.

## Admin / back-office panel (`/admin/`)

A staff panel lives at **`/admin/`**. Its UI is built on **Tabler** (`@tabler/core`
1.4.0, MIT — an open-source Bootstrap-5 admin/dashboard kit designed for exactly this
kind of subscription back office), self-hosted at `/assets/tabler.min.css` +
`/assets/tabler.min.js` from `src/vendor/` — the same no-CDN policy as supabase.js,
qrcode.js, and FilePond. (The Inter webfont is not bundled, so the panel renders in
system fonts.) It is gated two ways:

- **Client:** the page shows nothing until a logged-in admin session is detected.
- **Server (authoritative):** every `/api/admin/*` Function calls `requireAdmin`, which
  validates the caller's Supabase session and re-checks `members.is_admin` with the
  service-role key (RLS is bypassed by the server, so this check is essential).

To grant access, set `is_admin` on a member (see the admin-bootstrap step below), then
visit `/admin/` while logged in. The panel provides:

- **Members & Subscriptions** — search/filter/paginate members; **add** a member (creates a
  login account so they can sign in — set a password or leave it blank for a sign-in link),
  **edit** status / tier / expiry / family inline, and **delete** a member (removes their
  login account too). The editor can also **send a password reset or invitation email** to
  the member's login address (see _Self-service auth & billing_ below). Subscription state is
  also updated automatically by the Stripe webhook events listed above.
- **Families** — manage family memberships. A household groups several people under one
  membership: link login accounts via a member's _Family_ field, and add family members who
  **don't** have their own login (children, a spouse) directly on the family card. Create,
  edit, and delete families and their members. Each card also shows the family's **founder**,
  which people are **not linked to an account**, **seats in use** (linked accounts + name-only
  people + pending invitations, out of the self-service limit of 3 — admins aren't capped),
  **pending invitations**, and a collapsible **activity** log (latest 20 events). Until
  migration `0017_family_invites.sql` is applied, the card says invitations and activity are
  unavailable and everything else works as before.
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
- **Events** — create, edit, and delete calendar events, complete with an image. The
  **Publish/Unpublish** toggle is what makes an event official: only published events are
  publicly readable (the `events_read` RLS policy) and open for RSVPs; drafts stay
  admin-only.
- **Directory** — the review queue for the business directory. Community submissions from
  the business-services form arrive as **Pending**; **Approve** makes a listing official
  (publicly visible via the `biz_read` RLS policy), and staff can also create, edit, and
  delete listings directly. A stat tile shows how many are awaiting review.
- **Media** — upload images (JPEG/PNG/WebP/GIF, up to 5 MB) to the site's own
  **Supabase Storage** bucket (`media`, public-read) and copy their URLs into events and
  directory listings. The uploader UI is the open-source **FilePond** library (MIT,
  self-hosted like every other asset — no CDN). Writes go only through
  `/api/admin/media` with the service-role key; the bucket re-enforces the size/type
  limits server-side.
- **Refunds** — issue a refund against any ledger row without leaving the panel.
  Pick a payment, refund the full amount or a partial amount, and the money is
  returned through Stripe (`/api/admin/refunds`) and written back to the row. A
  charge can be refunded more than once up to what was paid; the running
  `refunded_cents` total shows on both the Payments and Refunds tabs. The Stripe
  charge is resolved from whichever reference the ledger stored (Checkout Session
  for the first year, Invoice for renewals), so staff never handle charge ids.
  Requires migration `0010_refunds.sql`.

Apply the admin migrations before using the panel (paste each into the SQL editor, in order —
see [Applying migrations](#applying-migrations)):
`0003_admin.sql` (adds the `past_due` status and the `news_posts` audit table),
`0004_households.sql` + `0005_households_rls.sql` (the `households` / `household_members`
tables and `members.household_id` that power the **Families** tab and member add/edit),
`0006_discounts.sql` (the `discount_codes` table + atomic redemption counter behind the
**Discounts** tab), `0007_signup_phone.sql` (copies the signup form's phone number
onto the members row), `0008_payments.sql` (the `payments` ledger behind the **Payments**
tab), `0009_storage_media.sql` (creates the public `media` storage bucket with its
size/MIME limits, behind the **Media** tab), and `0010_refunds.sql` (adds the
`refunded_cents` running total + refund audit columns behind the **Refunds** tab).

## Self-service auth & billing

- **Registration**: `/login-3/` offers "Create an account" (name, email, phone,
  password + confirm, duplicate-email detection, email-confirmation notice). The
  checkout overlay's inline signup enforces the same password rules and detects
  already-registered emails instead of silently continuing. `/register/` (which the
  mirror never captured an index page for) now redirects to `/membership/`.
- **Password reset**: "Forgot password?" on the login page (and in the checkout
  dialog's log-in mode) opens an inline form with its own email field; the emailed
  link lands on `/account/?recovery=1` with a set-new-password form. An expired or
  already-used link shows a clear message instead of a dead form; other failed links
  (signup confirmation, email change, OAuth) get a generic one.
- **Resend countdowns**: every button that sends an auth email — reset link,
  confirmation resend (after signup, or when signing in with an unconfirmed email),
  reauthentication code, email-change confirmation — is disabled for 60 s after a
  send, matching the SMTP "minimum interval per user". The end time is kept in
  `localStorage` per action + address, so a reload does not reset it; a Supabase
  rate-limit reply starts the countdown from the seconds it reports.
- **Account security** (`/account/`): change password (asks for the current
  password — turn on _Require current password when updating_ under Authentication →
  Sign In / Providers → Email so Supabase enforces it; Google/Microsoft-only members
  see "Set a password" instead) and change email. If Supabase answers
  `reauthentication_needed`, the page emails a code (the _Reauthentication_ template)
  and asks for it. The email-change resend uses the member's **current** address,
  which is how Supabase finds the pending change.
- **Admin-sent auth emails**: Admin → Members → edit → "Send password reset" /
  "Send invitation" (`POST /api/admin/member-email`). They go to the member's
  **login** email in Supabase Auth, never the editable profile email, and land on
  `/account/?recovery=1` — so every deploy origin must be on the Supabase redirect
  allow list. "Send invitation" works for any member: a login that was never
  confirmed or signed in gets Supabase's `invite` email; an existing account
  (confirmed or signed in, which includes every member created in this panel) gets
  the `recovery` (set-password) email instead, since Supabase refuses to invite a
  confirmed user. If Supabase refuses an invite as already registered, the endpoint
  falls back to the `recovery` email once. The response's `delivered` (`invite` /
  `password_setup`) says which went out, and the admin notice tells the admin.
- **Auth email delivery & templates**: Supabase Auth sends through custom SMTP on
  Resend (`smtp.resend.com:465`, user `resend`, sender `CAACI <no-reply@caaciorg.com>`,
  60 s minimum interval per user). The six bilingual templates and their subjects live
  in `supabase/templates/` (named after the Management API keys
  `mailer_templates_<type>_content` / `mailer_subjects_<type>`) — **edit them there, not
  in the dashboard**. Preview and push with a Supabase personal access token:
  `SUPABASE_ACCESS_TOKEN=sbp_… npm run auth:emails` (dry run: lists what differs) and
  `npm run auth:emails -- --apply` (PATCHes only the differing keys, re-reads, exits 1 on
  any mismatch). The SMTP **password** (a Resend API key) is entered only in the
  dashboard (Authentication → Emails → SMTP Settings) and is never read from or written
  by the script; SMTP keys are only written to a project already on `smtp.resend.com`.
  Template images must be hosted on the project's Supabase Storage
  (`media/email/caaci-logo.png`) — the dashboard preview blocks other image hosts. The
  daily **Auth config** workflow compares the live templates, subjects and SMTP sender
  with the repo, so a dashboard edit (or an un-pushed repo change) turns it red.
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

- Events: the seed has the 3 annual festivals. Add the rest in the admin panel's
  **Events** tab — the live Events Calendar list wasn't in the static mirror.
- Business directory: add real listings in the admin panel's **Directory** tab (or
  approve the ones the community submits through the business-services form).
- Commercial-plugin look is reproduced via the mirror's CSS — no Divi/MemberPress
  license is required on this stack.

```

```
