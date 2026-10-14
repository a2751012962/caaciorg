<p align="center">
  <a href="https://caaciorg.com"><img src="./web/public/images/logo.png" alt="CAACI 伊利诺伊中部华人协会" width="120" /></a>
</p>

<p align="center">
  <a href="https://github.com/a2751012962/caaciorg/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/a2751012962/caaciorg/ci.yml?branch=main&style=for-the-badge&label=CI&labelColor=000000" /></a>
  <a href="https://caaciorg.com"><img alt="线上：caaciorg.com" src="https://img.shields.io/badge/live-caaciorg.com-B91C1C.svg?style=for-the-badge&labelColor=000000" /></a>
  <img alt="Cloudflare Pages" src="https://img.shields.io/badge/Cloudflare%20Pages-F38020.svg?style=for-the-badge&logo=cloudflarepages&logoColor=white&labelColor=000000" />
  <img alt="Supabase" src="https://img.shields.io/badge/Supabase-3FCF8E.svg?style=for-the-badge&logo=supabase&logoColor=white&labelColor=000000" />
</p>

<p align="center"><a href="./README.md">English</a> · <b>中文</b></p>

# caaciorg

**伊利诺伊中部华人协会**（CAACI）官网：[caaciorg.com](https://caaciorg.com)。
中英双语页面、会员与家庭方案、活动报名与志愿者、商家名录、华协币，以及工作人员后台，
运行在 Cloudflare Pages + Supabase + Stripe 上。

浏览器功能测试放在 [`e2e/`](./e2e/README.md)，基于 [tester-army/e2e](https://github.com/tester-army/e2e)。
目前有一套只读的公开页面冒烟测试（不需要模型），外加两条需要 API key 的 agent 测试。
它们在本地按需运行，还没有接入 CI。下面是其中一条冒烟测试：

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

## 快速开始

```bash
npm ci
cp .env.example .env   # 填好各项配置，见 SETUP.md
npm run dev            # 先构建，再用 wrangler pages dev 启动 → http://localhost:8788
```

网站需要 Node 20 及以上；e2e 测试需要 Node 22.22+ 或 24.8+。
`npm run dev` 连的是 `wrangler.toml` 里的**线上** Supabase 项目。
请用 Stripe 测试模式和测试卡，自己创建的数据用完要清掉。

## 测试

| 命令                                                          | 检查什么                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm test`                                                    | 单元与契约测试（`node --test`，`test/`）：API 处理函数、在 PGlite 上跑的迁移、RLS、邮件模板、构建路由。 |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | ESLint、`web/` 的 TypeScript 检查、Prettier。CI 在 Node 20 和 24 上都会跑。                             |
| `cd e2e && npm test`                                          | 浏览器冒烟测试：公开页面能打开，中英文内容正确。不需要模型。                                            |
| `cd e2e && npm run test:agent`                                | 用目标描述写的 agent 步骤。需要 `ANTHROPIC_API_KEY`。                                                   |

新功能都要在 [`e2e/`](./e2e/README.md) 里补一条功能测试。e2e 测试只读不写：
不注册、不提交表单、不发起付款，因为本地构建用的是线上数据库。

## 仓库结构

| 路径                                                                    | 内容                                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [`web/`](./web)                                                         | React + Vite 网站和后台（`/`、`/membership/`、`/events/`、`/account/`、`/admin/`、`/token-admin/` 等）。 |
| [`functions/api/`](./functions/api)                                     | Cloudflare Pages Functions：结账、Stripe webhook、家庭、华协币、后台接口。                               |
| [`supabase/`](./supabase)                                               | 按编号排列的 SQL 迁移、种子数据、登录邮件模板。                                                          |
| [`src/`](./src) · [`member-src/`](./member-src) · [`mirror/`](./mirror) | 渐进增强脚本，以及仍从 WordPress 镜像提供的页面。                                                        |
| [`build.mjs`](./build.mjs)                                              | 把 `web/` 和镜像构建进 `dist/`，Pages 部署的就是这个目录。                                               |
| [`scripts/`](./scripts)                                                 | 手动运行的运维脚本：Stripe 配置与核对、会员导入、登录邮件和 Resend 模板同步。                            |
| [`e2e/`](./e2e)                                                         | 浏览器功能测试，有自己的 `package.json` 和 lockfile。                                                    |
| [`test/`](./test)                                                       | 单元与契约测试。                                                                                         |
| [`docs/`](./docs)                                                       | [CI 规则](./docs/CI.md)、[UI 规范](./docs/UI_GUIDELINE.md) 和其他说明。                                  |
| [`archive/`](./archive)                                                 | 已退役、留作参考的代码。                                                                                 |

## 分支与部署

| 分支      | 部署到                                                   | Stripe |
| --------- | -------------------------------------------------------- | ------ |
| `main`    | [caaciorg.com](https://caaciorg.com)，正式站             | live   |
| `preview` | beta.caaciorg.com，仅工作人员可访问（Cloudflare Access） | test   |

功能分支的 PR 一律指向 `preview`。`main` 只接受 `preview`、`release/*` 或 `hotfix/*`，
其他分支 CI 会直接拒绝。合并进 `main` 就是正式上线。

## 文档

- [SETUP.md](./SETUP.md)：一次性配置、迁移怎么执行、各环境与访问权限，以及每个功能的
  工作方式（会员、活动、志愿者、华协币、家庭邀请、后台）。
- [docs/CI.md](./docs/CI.md)：CI 会拒绝什么，以及怎么加例外。
- [web/DESIGN_SYSTEM.md](./web/DESIGN_SYSTEM.md)：React 网站的设计变量和组件。

## 数据库迁移

线上项目没有迁移历史表，所以 `db:push` 是故意禁用的。
每个新的 `supabase/migrations/NNNN_*.sql` 要按文件名顺序贴进 Supabase SQL 编辑器执行，
并且要在合并依赖它的代码之前执行。详见 [Applying migrations](./SETUP.md#applying-migrations)。

## 安全

发现漏洞请不要开公开 issue，发邮件到 [caaci.org@gmail.com](mailto:caaci.org@gmail.com)。
任何密钥都不要提交：`.env`、Stripe 密钥和 Cloudflare Access 令牌都放在仓库外，
仓库里有测试会扫描这些内容。
