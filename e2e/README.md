# e2e · 功能测试

Browser functional tests for caaciorg.com, written with
[tester-army/e2e](https://github.com/tester-army/e2e). Every new feature gets one here.

浏览器功能测试，基于 [tester-army/e2e](https://github.com/tester-army/e2e)。以后每个新功能都在这里补测试。

## Run · 运行

Start the site first, in the repo root · 先在仓库根目录启动网站：

```bash
npm run dev -- --ip 127.0.0.1 --port 8788
```

Then, in another terminal · 再开一个终端：

```bash
cd e2e
npm ci
npm run browsers      # once: download Chromium · 第一次运行时下载 Chromium
npm test
```

- `APP_URL=https://… npm test` points the same suite at another address.
  设置 `APP_URL` 可以让同一套测试去跑别的地址。
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
2. Assert on what a visitor sees (headings, URLs, `lang`), in both languages where the
   feature is bilingual.
   断言访客看得到的东西：标题、URL、`lang`。功能是双语的，就两种语言都测。
3. Run a new test against the site before committing it.
   新测试提交前要先对着网站跑通。

Docs · 文档：[e2e.tester.army/docs](https://e2e.tester.army/docs), also offline in
`node_modules/e2e/docs` after `npm ci` · `npm ci` 之后也可以在 `node_modules/e2e/docs` 离线查看。
