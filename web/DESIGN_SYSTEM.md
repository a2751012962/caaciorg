# CAACI 新前端 UI / 设计 / 配色规范

适用范围：`web/`（React + Vite + Tailwind v4）下的全部公开页面与会员账户页。
镜像层与 Tabler 后台仍以仓库根目录的 `UI_GUIDELINE.md` 为准；两份规范共用同一套品牌色。

所有数值均从 `web/src` 现有代码统计得出（2026-09-15，分支 `feat/new-frontend`），
不是设想值。出现次数写在括号里，用来判断"主流用法"与"零散用法"。

---

## 0. 一句话原则

**砖红点睛，黑白承载，圆润轻盈。**
品牌色只用在"要人点/要人看"的地方；其余一律用中性灰；卡片大圆角、浅阴影、细边框。

---

## 1. 配色

### 1.1 品牌色（Brand）

| 令牌名          | Hex       | 用途                                                                       | 现用次数 |
| --------------- | --------- | -------------------------------------------------------------------------- | -------- |
| `brick`         | `#8e2e11` | **主色**。主按钮底、eyebrow 小标、图标、hover 文字、focus ring、装饰短横线 | 255      |
| `brick-hover`   | `#a63715` | 主按钮 hover（亮一档）                                                     | 6        |
| `brick-pressed` | `#72240d` | 主按钮 pressed / 深一档 hover                                              | 5        |
| `brick-deep`    | `#73250e` | 首页三联横幅第二格                                                         | 2        |
| `maroon`        | `#300200` | **Display 标题色**（Playfair）、Logo 文字、弹窗标题、三联横幅第三格        | 12       |
| `rust`          | `#ce4327` | 页脚联系信息图标                                                           | 2        |
| `gold`          | `#edbb5f` | 深色底上的 eyebrow / 星标 / 会员权益图标                                   | 10       |
| `tan`           | `#d3a971` | 数字会员卡与页脚的点缀链接色                                               | 8        |

规则：

- 大面积色块只允许 `brick` / `brick-deep` / `maroon` 三格并排（首页与子页横幅）。
- `gold` 与 `tan` 只在深色底（`ink` / `#222`）上使用，浅色底不用。
- 不引入蓝色（Divi 遗留 `#2ea3f2` 明确禁止）。

### 1.2 中性色（Neutral）

正文与界面骨架全部走 Tailwind `neutral` 系，外加四个"苹果式"近白底色。

| 角色                   | 值                                                          | 现用次数  |
| ---------------------- | ----------------------------------------------------------- | --------- |
| 标题黑 `ink`           | `#1d1d1f`                                                   | 127       |
| 正文（body 默认）      | `#333333`                                                   | index.css |
| 强调文字               | `text-neutral-900` / `800`                                  | 45 / 41   |
| 普通文字               | `text-neutral-700` / `600`                                  | 74 / 98   |
| 次要 / 说明文字        | `text-neutral-500` / `400`                                  | 101 / 105 |
| 卡片底 `surface-2`     | `#fbfbfd`                                                   | 20        |
| 页面区块底 `surface-3` | `#f5f5f7`                                                   | 14        |
| hover 底               | `#fafafc` / `bg-neutral-50`                                 | 6 / 26    |
| 边框（主）             | `border-neutral-200` 与 `border-neutral-200/80`             | 73 / 70   |
| 边框（输入框）         | `border-neutral-300`                                        | 44        |
| 深色面板               | `#1d1d1f`（会员卡、联系卡、Most Popular 徽章）              | —         |
| 页脚                   | `#222222`，文字 `neutral-300/400/500`，分隔线 `neutral-800` | —         |

规则：

- 白底页面上，区块交替用 `#fff` 与 `#f5f5f7`；卡片放在白底上用 `#fbfbfd`。
- 深色面板的边框固定 `border-white/10`。

### 1.3 语义色（Semantic）

| 状态          | 底              | 边                   | 字                     | 用法                         |
| ------------- | --------------- | -------------------- | ---------------------- | ---------------------------- |
| 成功          | `bg-emerald-50` | `border-emerald-200` | `text-emerald-700/800` | 已付费、已报名、保存成功     |
| 错误 / 危险   | `bg-rose-50`    | `border-rose-200`    | `text-rose-600/800`    | 表单错误、退出登录、取消报名 |
| 警告 / 待处理 | `bg-amber-50`   | `border-amber-200`   | `text-amber-800/900`   | 待续费、宽限期               |

错误提示统一样式（已出现 7 次，作为标准）：
`p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-center gap-2`

语义色不当作品牌色用：危险按钮用 `bg-rose-600 hover:bg-rose-700`，不用 brick。

---

## 2. 字体

| 角色                 | 变量                    | 字体栈                                                     |
| -------------------- | ----------------------- | ---------------------------------------------------------- |
| Display / h1–h3      | `--font-caaci-serif`    | Playfair Display → Noto Serif SC → SimSun / Songti SC      |
| 中文 Display         | `--font-caaci-serif-zh` | Noto Serif SC → Playfair Display（中文标题时优先中文衬线） |
| 正文 / UI            | `--font-caaci-sans`     | Poppins → Microsoft YaHei → PingFang SC → Noto Sans SC     |
| 数据 / 会员号 / 邮箱 | `font-mono`             | 系统等宽                                                   |

工具类：`.font-serif-caaci`（15）、`.font-poppins`（52）。`h1/h2/h3` 已在 `@layer base` 里默认衬线，无需重复加类。

### 2.1 字号阶梯（实际使用）

| 层级         | 类                                   | 出现     | 用在                   |
| ------------ | ------------------------------------ | -------- | ---------------------- |
| 页面大标题   | `text-3xl sm:text-4xl md:text-5xl`   | 19+      | SubpageHero            |
| 首页欢迎标题 | `text-xl sm:text-3xl md:text-[34px]` | 1        | Hero                   |
| 区块标题     | `text-2xl sm:text-3xl md:text-4xl`   | 21+      | Benefits 等            |
| 卡片标题     | `text-lg sm:text-xl`                 | 36       | 卡片 h3                |
| 正文         | `text-sm` / `text-base`              | 119 / 47 | 段落                   |
| UI 默认      | `text-xs`                            | **366**  | 按钮、导航、标签、表单 |
| 微文字       | `text-[11px]` / `text-[10px]`        | 74 / 47  | 说明、徽章、副标       |

规则：

- 界面文字默认 `text-xs`，不要小于 `10px`（`9px`/`8px` 各 5/2 次，属于待清理）。
- 段落用 `leading-relaxed`（53）；标题用 `tracking-tight`（51）。
- 全大写（已定 2026-09-15）：**只允许导航项和主按钮**（`bg-brick text-white`，含首页 / 子页三联横幅）。
  区块 eyebrow、表单 label、页脚栏目标题、卡片小标一律正常大小写，并去掉 `tracking-wider/widest`。
  全大写处必须带 `tracking-wider`。

### 2.2 固定文字模式

| 模式                    | 类                                                                            |
| ----------------------- | ----------------------------------------------------------------------------- |
| Eyebrow（区块上方小标） | `text-xs font-semibold text-brick block mb-2`（正常大小写）                   |
| 装饰短横线              | `w-12 h-0.5 bg-brick mt-3 rounded-full`（Hero/子页用 `w-16 h-1`）             |
| 表单 label              | `block text-xs font-bold text-neutral-500 mb-2`（正常大小写）                 |
| 导航项                  | `px-3 py-2 text-sm font-semibold uppercase tracking-wider`                    |
| 页脚栏目标题            | `font-bold text-white text-xs border-b border-neutral-700 pb-2`（正常大小写） |

字重：`font-semibold`（227）为默认强调，`font-medium`（136）次之，`font-bold`（94）用于标题与 label。

---

## 3. 布局与间距

- **容器**：`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`（31 处，唯一容器写法）。
- **文字栏宽**：`max-w-3xl`（标题区）、`max-w-2xl`、`max-w-[580px]`（正文段）。
- **区块垂直间距**：`py-16 sm:py-24`（主流）；大区块 `py-20 md:py-28`。
- **网格**：12 栏 `lg:grid-cols-12`，图文 6/6，页脚 5/4/3；卡片 `md:grid-cols-2` 或 `3`。
- **卡片内距**：`p-6 sm:p-7`（普通）、`p-8 sm:p-9`（权益卡）。
- **元素间距**：`gap-2`（99）、`gap-1.5`（74）、`gap-3`（45）；卡片内 `space-y-4`。
- **断点**：`sm:`（448）是主断点，其次 `lg:`（119）、`md:`（92）；`xl:` 只用于导航。
- **手机横滑卡片**：`w-[80vw] max-w-[290px] shrink-0 snap-center md:w-auto`。

---

## 4. 形状、层次、动效

### 4.1 圆角

| 类                       | 出现    | 用途                                   |
| ------------------------ | ------- | -------------------------------------- |
| `rounded-full`           | 179     | 所有按钮、徽章、语言切换、装饰线、头像 |
| `rounded-2xl`            | 78      | 卡片、下拉菜单、弹窗、图片             |
| `rounded-xl`             | 54      | 输入框、Tab、内嵌小卡、提示条          |
| `rounded-3xl`            | 18      | 大型展示面板                           |
| `rounded` / `rounded-lg` | 14 / 10 | 捐款金额格等少数，逐步统一到 xl        |

### 4.2 阴影

`shadow-xs`（68）为默认卡片阴影；`shadow-sm`（25）用于 hover 提升；
`shadow-2xs`（15）用于卡片内图标圈；`shadow-lg/xl`（下拉）；`shadow-2xl`（弹窗）。
不要用 `shadow-md` 以上做静态卡片。

### 4.3 边框

细边框 + 轻透明是本站的"分隔语言"：`border border-neutral-200/80`。
图片再加一层内描边：`ring-1 ring-inset ring-black/5`。

### 4.4 动效

- CSS 过渡：`transition-colors` / `transition-all`；hover 图片 `duration-500 scale-[1.01]`。
- 按钮按下：`active:scale-98`（或 `active:scale-[0.99]`）。
- 主按钮 hover 二选一：`hover:bg-brick-hover` 或 `hover:brightness-110`。
- GSAP 入场：`duration 0.5–0.9`，`ease: power2.out`（默认）/ `power3.out`（大位移）；微交互 `0.2–0.25`。
- 滚动：Lenis 平滑滚动，导航栏下滑隐藏、上滑显示（`transition-transform duration-300`）。
- 加载：`animate-spin`；实时状态点：`animate-ping`。
- `animate-fadeIn`（下拉）与 `animate-in`（弹窗）在 `index.css` 中定义，0.18s / 0.2s ease-out。

### 4.5 层级 z-index

`z-50`：导航栏、下拉、弹窗遮罩；`z-20`：横幅 / 悬浮徽章；`z-10` 及以下：装饰层。

---

## 5. 组件规范

### 5.1 按钮

| 类型                         | 类                                                                                                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **主按钮**                   | `min-h-[44px] px-8 py-3 rounded-full bg-brick hover:bg-brick-hover text-white font-semibold text-xs uppercase tracking-wider shadow-xs transition-all active:scale-98 cursor-pointer inline-flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-wait` |
| **次按钮（浅）**             | `min-h-[44px] px-6 py-2.5 rounded-full bg-white border border-neutral-300 text-neutral-700 hover:border-neutral-800 hover:text-neutral-900 text-xs font-semibold`                                                                                                            |
| **深色按钮**                 | `min-h-[44px] py-2.5 px-4 rounded-full bg-ink hover:bg-neutral-800 text-white text-xs font-semibold border border-neutral-700 shadow-xs`                                                                                                                                     |
| **危险按钮**                 | `rounded-full bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold`                                                                                                                                                                                                |
| **文字链接**                 | `text-neutral-700 hover:text-brick transition-colors`                                                                                                                                                                                                                        |
| **胶囊小按钮**（语言切换等） | `px-3 py-1.5 rounded-full border border-neutral-300 bg-neutral-50 text-xs font-semibold hover:border-brick hover:text-brick`                                                                                                                                                 |

手机端主按钮 `w-full sm:w-auto`。触控目标 `min-h-[44px]`（29 处，作为硬性要求）。

### 5.2 输入框

标准（账户页）：
`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-neutral-50 border border-neutral-300 text-neutral-900 focus:outline-none focus:ring-2 focus:ring-brick`

紧凑（表单内）：`... py-2 text-sm bg-white ... focus:ring-1 focus:ring-brick`。
多行：追加 `resize-none`。焦点只用 brick ring；黑色 ring（`#1d1d1f`，9 处）限于会员页搜索框。

### 5.3 卡片

`bg-surface-2 p-6 sm:p-7 rounded-2xl border border-neutral-200/80 shadow-xs hover:border-neutral-300 transition-colors`
卡片内图标圈：`w-10 h-10 rounded-full bg-white border border-neutral-200/70 shadow-2xs`，图标 `w-5 h-5 text-brick`。
深色卡片：`bg-ink text-white rounded-2xl p-6 shadow-xl border border-white/10`。

### 5.4 徽章 / 标签

- 状态（已定 2026-09-15）：**色点 + 文字，无底色无边框无胶囊**。
  `inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-current`
  颜色：有效 `emerald-700`、待处理 `amber-800`、失效 `rose-700`、中性 `neutral-500`。
- 悬浮标签（Most Popular）：`absolute -top-3 left-6 bg-ink text-white text-[10px] font-semibold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-md`
- 序号圆点：`w-6 h-6 rounded-full bg-brick/10 text-brick font-semibold text-xs`

### 5.5 Tab（账户页）

选中 `bg-brick text-white shadow-sm`；未选中 `bg-white text-neutral-700 border border-neutral-200/80 hover:bg-neutral-100`；共用 `min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold`。

### 5.6 分段选择（Segmented）

外框 `h-10 p-1 rounded-full bg-neutral-100 border border-neutral-200/80 grid`；
选中项 `h-8 rounded-full text-xs font-semibold bg-white shadow-xs`。

### 5.7 弹窗

遮罩 `fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4`；
面板 `w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-neutral-200 overflow-hidden`；
头部 `px-6 py-4 border-b border-neutral-200 bg-neutral-50`，标题 `font-serif-caaci font-bold text-lg text-maroon`；
关闭键 `p-1 rounded-full text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200`；内容 `p-6`。

### 5.8 导航栏 / 下拉

`sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-neutral-200/80 shadow-xs`，高度 `h-[72px]`。
下拉：`w-48 bg-white border border-neutral-200/80 shadow-lg py-2 rounded-2xl`，项 `px-4 py-2 text-xs font-medium uppercase tracking-wider hover:bg-neutral-50 hover:text-brick`。

### 5.9 三联行动横幅（Hero / SubpageHero 底部）

三格 `grid md:grid-cols-3 border-t border-b border-black/10`，底色依次 `#8e2e11` / `#73250e` / `#300200`；
每格 `py-3.5 sm:py-4 px-5 text-white font-semibold text-xs sm:text-[13px] uppercase tracking-wider hover:brightness-110 active:scale-[0.99]`，图标 `w-4 h-4 text-white/90`。

### 5.10 图标

lucide-react。尺寸：行内 `w-3.5 h-3.5`，按钮 `w-4 h-4`，卡片 `w-5 h-5`。品牌色图标 `text-brick`，中性图标 `text-neutral-400`。

---

## 6. 双语规则

- 每个可见字符串都有 en / zh 两版（`data/content.ts`）。
- 中文标题使用 `--font-caaci-serif-zh`（`isZh` 分支），不要给中文加 `uppercase`/`tracking-widest`。
- 字距（tracking）对中文无效且会拉开字，按钮/标签的 `tracking-wider` 只对英文有意义，可接受但不要再加大。

---

## 7. 无障碍与响应式硬指标

1. 触控目标 ≥ 44px（`min-h-[44px]`）。
2. 焦点可见：`focus:outline-none` 必须配 `focus:ring-*`，单用 outline-none 不允许。
3. 正文对比：`text-neutral-500` 是白底上可用的最浅正文色；`neutral-400` 只做装饰 / 占位。
4. 手机端 ≤ 400px 无横向滚动（`html, body { overflow-x: clip }` 已处理）。
5. 图片 `object-cover`，容器 `overflow-hidden rounded-2xl`。

---

## 8. 代码实现（已落地）

令牌定义在 `web/src/index.css` 的 `@theme` 块中，Tailwind v4 据此生成
`bg-brick`、`text-ink`、`border-brick/20`、`hover:text-brick`、`focus:ring-brick` 等全部变体。
源码中不再出现 `[#8e2e11]` 这类任意值；首页 / 子页横幅的内联 `style` 也已改为 `bg-brick` / `bg-brick-deep` / `bg-maroon`。

| 令牌类名                  | 值                    |     | 令牌类名                                | 值                                |
| ------------------------- | --------------------- | --- | --------------------------------------- | --------------------------------- |
| `brick`                   | `#8e2e11`             |     | `ink`                                   | `#1d1d1f`                         |
| `brick-hover`             | `#a63715`             |     | `ink-deep`                              | `#161617`                         |
| `brick-pressed`           | `#72240d`             |     | `footer`                                | `#222222`                         |
| `brick-deep`              | `#73250e`             |     | `surface-2`                             | `#fbfbfd`                         |
| `brick-700` / `brick-800` | `#6a220c` / `#5c1c0a` |     | `surface-3`                             | `#f5f5f7`                         |
| `maroon`                  | `#300200`             |     | `surface-hover`                         | `#fafafc`                         |
| `rust`                    | `#ce4327`             |     | `surface-warm` / `-2` / `surface-cream` | `#fbf9f8` / `#fbf9f6` / `#fcfbf9` |
| `gold` / `tan`            | `#edbb5f` / `#d3a971` |     | `font-display` / `font-display-zh`      | 衬线 / 中文衬线                   |

`animate-fadeIn`（下拉）与 `animate-in`（弹窗）的 keyframes 同样定义在 `index.css`，并遵守 `prefers-reduced-motion`。

**守卫测试**：`test/web-design-tokens.test.js` 会在以下情况让 CI 失败：

- `web/src` 中出现 `[#xxxxxx]` 形式的任意颜色值；
- 组件里用 `style={{ backgroundColor: '#…' }}` 写颜色（`DigitalMemberCard` 的 canvas 绘制除外）；
- `index.css` 缺少本表中任一令牌或 fadeIn 动画。

新增颜色的流程：先在 `@theme` 加令牌并在本文档 §1 登记，再在组件中使用类名。

---

## 9. 禁止事项

- 不用蓝色、紫色、渐变主色。
- 不用 `rounded-lg` 以下做卡片；不用 `shadow-md` 以上做静态卡片。
- 不写内联 `style=` 颜色，不写 `[#xxxxxx]` 任意值（测试会拦）。
- 不在浅色底上用 `gold` / `tan`。
- 不出现小于 10px 的文字。
- 不给中文加 `uppercase`。

---

## 10. 决策记录

| 日期       | 项                                                         | 决定                                | 状态                                            |
| ---------- | ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| 2026-09-15 | 状态徽章                                                   | 色点 + 文字，去掉胶囊 / 底色 / 边框 | 已落地                                          |
| 2026-09-15 | 全大写                                                     | 只留导航与主按钮                    | 已落地（Hero.tsx 两处小标待另一会话收尾后再改） |
| 2026-09-15 | 二选一控件                                                 | 保留分段胶囊                        | 维持现状                                        |
| 2026-09-15 | 反馈提示、列表卡片、会员等级、账户 Tab、圆角档位、最小字号 | 再议                                | 待用户给方向                                    |

总方向（用户原话）：少卡片、少无用胶囊、简洁表达。
