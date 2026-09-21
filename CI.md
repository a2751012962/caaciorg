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
| `ci.yml` — base   | PRs into `main` only             | refuses a PR into `main` that is not `preview`, `release/*` or `hotfix/*` |
| `codeql.yml`      | every PR, push to `main`, weekly | data-flow analysis (injection, unescaped sinks, dead comparisons)         |
| `auth-config.yml` | push to `main`, daily            | the Supabase sign-in settings that live outside this repo                 |
| `audit.yml`       | weekly, or by hand               | advisories in the dependencies that reach a browser                       |

Node 20 is what Cloudflare Pages builds with; Node 24 is what this project is
developed on. The gap between them has already turned `main` red once —
`navigator` is a global from Node 21 onward, so the code passed locally and
failed in CI. Both now run.

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
