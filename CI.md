# CAACI — what CI refuses / CI 拦截什么

This repository is written mostly by prompting. That is fine, and it is fast,
but it changes where the mistakes are: the code that gets written is usually
reasonable, and the damage comes from the code that _doesn't_ — the RLS line
nobody added, the `requireAdmin` nobody called, the migration number two
branches picked at once. None of those look wrong in a diff, because there is
nothing there to look at.

So the checks below are written the other way round. They do not ask whether the
new code is good. They ask whether something that must exist is missing, and
they make an exception cost a sentence.

> 这个仓库主要靠对话生成代码。真正出事的不是写出来的部分，而是**漏写**的部分：
> 忘记开 RLS、忘记校验管理员、两个分支抢同一个迁移号。下面的检查就是专门盯住"缺失"，
> 例外必须写一句理由。

Everything here runs on every pull request, in the ordinary unit suite
(`npm test`) unless stated otherwise. Nothing needs a database, a network or a
secret.

## The workflows

| Workflow          | When                             | What it does                                                              |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `ci.yml` — check  | every PR, every push to `main`   | lint, typecheck, format, unit suite, build — on Node **20 and 24**        |
| `ci.yml` — ui     | every PR, every push to `main`   | a real Chromium over the built site: layout, tap targets, console, axe    |
| `ci.yml` — base   | PRs into `main` only             | refuses a PR into `main` that is not `preview`, `release/*` or `hotfix/*` |
| `codeql.yml`      | every PR, push to `main`, weekly | data-flow analysis (injection, unescaped sinks, dead comparisons)         |
| `auth-config.yml` | push to `main`, daily            | the Supabase sign-in settings that live outside this repo                 |
| `audit.yml`       | weekly, or by hand               | advisories in the dependencies that reach a browser                       |

Node 20 is the floor this project supports; Node 24 is what it is developed on.
The gap between them has already turned `main` red once — `navigator` is a
global from Node 21 onward, so the code passed locally and failed in CI. Both
now run. (The repo pins no Node version outside the workflows — no `.nvmrc`, no
`engines`, no `NODE_VERSION` — so the version Cloudflare Pages builds with lives
in the Pages dashboard and cannot be read from this repo. Check there before
dropping 20.)

Dependabot opens its PRs against `preview`, because the `base` job would refuse
a `dependabot/*` branch aimed at `main`. jsdom's **major** updates are ignored:
jsdom 30 dies on Node 20 with `webidl.util.markAsUncloneable is not a function`,
and grouped updates mean it would take eslint, prettier and wrangler down with
it (PRs #39 and #92).

`audit.yml` is deliberately not a PR check: an advisory is published against a
package, not against a change, and a check that goes red for reasons its author
cannot fix is a check people learn to ignore.

## The guardrails, and what each one refuses

### `test/api-auth-gates.test.js` — an endpoint that forgets to ask who is calling

Every Pages Function is a public URL the moment it deploys; nothing in the
framework asks who is calling. So a handler is **assumed** to need a gate
(`requireUser`, `requireAdmin`, `requireRoot`, `tokenGate`). Under
`functions/api/admin/` there is no way out: it is `requireAdmin` or
`requireRoot`, full stop.

A handler that genuinely needs no gate goes in the `UNGATED` map with what
protects it instead — and three of those claims are checked against the code,
not taken on trust: `turnstile` must really call `requireHuman`, `read-only`
must really be a GET, and both `read-only` and `lookup-only` must write nothing.

### `test/migration-hygiene.test.js` — a schema change that cannot be undone

`supabase/migrations/` is applied by hand, by pasting each file into the SQL
editor of the live project. Once pasted it is history. This refuses:

- **a table in `public` without RLS** — PostgREST serves every table in `public`
  to `anon`; without RLS the whole thing is readable from a browser. (This
  already happened to `public.members`.)
- **a `SECURITY DEFINER` function that does not pin `search_path`** — it runs as
  its owner, past RLS, and an unpinned path lets the caller choose which tables
  the names inside it mean.
- **two migrations with the same number** — two branches in parallel both take
  the next free one. Gaps are fine (`0016` was never used); collisions are not.
- **dropping a table or a column** unless the file is listed in `DESTRUCTIVE`
  with a sentence saying why it is safe.

### `test/secret-scan.test.js` — a key in a public repository

`a2751012962/caaciorg` is public. Pushing a key _is_ the disclosure; deleting it
in the next commit changes nothing. The patterns are shape-based and tuned to
miss the placeholders this repo is full of — the Supabase **anon** key belongs
in `wrangler.toml`, `sk_test_123` belongs in the fixtures. A JWT is decoded
rather than matched, so the anon key passes and a **service-role** key does not.
It also refuses any tracked `.env` file other than `.env.example`.

### `test/workflow-hygiene.test.js` — CI quietly checking less than it says

Removing `npm run typecheck` from `ci.yml` turns nothing red. So the gate list
lives here too, and the suite fails when `ci.yml` stops running one of them. It
also requires every action to be pinned to a commit SHA with a version comment,
every workflow to declare `permissions`, no `pull_request_target`, and nothing a
stranger can type (`github.head_ref`, a PR title) to be interpolated into a
`run:` block — pass it through `env:` and quote it.

### `test/ui/` — what jsdom cannot see

The unit suite is thorough about structure and blind to layout: jsdom has no
viewport, no box model and no paint, so it cannot tell that a card sits 60px
past the right edge of a phone or that a button is 28px tall. Every UI bug this
project has actually shipped lived in that blind spot — the `/events/` card
broken by the `.tribe-common` reset, tap targets under 44px, horizontal overflow
on `/events/`, the membership page scrolling 689px past its own form.

So `test/ui/` opens a real Chromium against the real `dist/` and measures. Per
page: it renders, it logs no error, nothing sticks out sideways at 375px, every
tap target is ≥ 44px (the rule `UI_GUIDELINE.md` already writes down), and the
React routes hold together at 1280px too. Then axe, WCAG 2 A/AA, serious and
critical only — **whole** on the React routes, and on a mirror page scoped to
the `.caaci-*` subtree we inject, because Divi's markup is not ours to fix.

It is **hermetic**, which is the only reason it is allowed to block a merge:
`serve-mirror.mjs` serves the build, and every request that would leave the
machine — `/api/**`, `*.supabase.co`, fonts — is answered from a fixture in
`test/ui/harness.js`. No secrets, no live database, no screenshots to
arbitrate; every assertion is a number, so a failure names the element and the
pixel count.

The page list is **read from `dist/`**, not written down — a new route is
covered without anyone remembering to add it. A page counts as React if its
HTML contains `<div id="root"></div>`.

It is opt-in so `npm test` stays fast and offline, the same way the auth-config
suite is:

```
npm run build
CAACI_UI_TESTS=1 npm run test:ui
```

### `test/test-hygiene.test.js` — a test that stopped testing

Strict asserts only (`node:assert/strict`: plain `assert.equal` is `==`), no
leftover `.only`, and every `*.test.js` registers at least one test.

## Adding an exception

All four allowlists (`UNGATED`, `DESTRUCTIVE`, and the gate list in
`workflow-hygiene`) work the same way, and none of them takes a bare entry:

1. Add the key.
2. Write the sentence. Say what protects it instead, or why the loss is safe.
3. Stale entries fail too — an allowlist entry that no longer matches anything
   real, or that excuses something already safe, is an error, not a leftover.

If writing the sentence is hard, that is the check working.
