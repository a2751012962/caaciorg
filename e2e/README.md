# e2e · 功能测试

Browser functional tests for caaciorg.com, written with
[tester-army/e2e](https://github.com/tester-army/e2e). Every new feature gets one here.

浏览器功能测试，基于 [tester-army/e2e](https://github.com/tester-army/e2e)。以后每个新功能都在这里补测试。

## Run · 运行

```bash
cd e2e
npm ci
npm run browsers      # once: download Chromium · 第一次运行时下载 Chromium
npm test              # smoke suite, no model · 冒烟测试，不需要模型
```

- The runner starts the local site (`npm run dev` in the repo root, port 8788) when
  nothing answers there, or reuses one you already started.
  没有站点在 8788 端口上时，runner 会自己在仓库根目录跑 `npm run dev`；已经开着的话就直接用。
- `APP_URL=https://… npm test` points the same suite at another copy.
  设置 `APP_URL` 可以让同一套测试去跑别的地址。
- Agent steps: `ANTHROPIC_API_KEY=… npm run test:agent`.
  agent 步骤需要设置 `ANTHROPIC_API_KEY`。
- Reports, screenshots and traces land in `e2e/.e2e/` (git-ignored).
  报告、截图和 trace 都写在 `e2e/.e2e/`，这个目录不进 git。

Needs Node 22.22+ or 24.8+, newer than the site's Node 20 floor. That is why this is its
own package with its own lockfile, outside the root workspace.
需要 Node 22.22+ 或 24.8+，比网站要求的 Node 20 新。所以它单独成一个包、有自己的 lockfile，
不放进根目录的 workspace。

## Rules · 规则

1. **Read-only.** The local build talks to the live Supabase project. No sign-ups, form
   submissions, checkouts or admin writes.
   **只读。** 本地构建连的是线上数据库：不注册、不提交表单、不付款、不在后台写数据。
2. `tests/smoke/` holds locator tests that need no model. Put a check here when it must
   never break. `tests/agent/` holds goals for the agent.
   `tests/smoke/` 放不需要模型的定位器测试，绝不能坏的检查放这里；`tests/agent/` 放交给 agent 的目标。
3. Follow every `agent.act` with a locator check or `agent.assert`, so the replay cache
   can record it.
   每个 `agent.act` 后面都要跟一个定位器断言或 `agent.assert`，replay cache 才能把这一步录下来。
4. Assert on what a visitor sees (headings, URLs, `lang`), in both languages where the
   feature is bilingual.
   断言访客看得到的东西：标题、URL、`lang`。功能是双语的，就两种语言都测。

Docs · 文档：[e2e.tester.army/docs](https://e2e.tester.army/docs), also offline in
`node_modules/e2e/docs` after `npm ci` · `npm ci` 之后也可以在 `node_modules/e2e/docs` 离线查看。
