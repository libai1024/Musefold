# Musefold v1.4 UI 落实计划

> **状态**：待执行（[视觉方向](./V14-UI-DIRECTION.md)与[技术选型](./V14-TECHNOLOGY-DECISIONS.md)已于 2026-08-22 冻结）
>
> **日期**：2026-08-22
>
> **范围**：只改可见 UI 与样式基础设施（D14）。不改契约、IPC、schema、计费、主导航信息架构与 v0.2.2 术语表。
>
> **读法**：本文件是执行卡片的唯一登记处。方向问题回[视觉方向](./V14-UI-DIRECTION.md)，选型问题回[技术选型](./V14-TECHNOLOGY-DECISIONS.md)，本文件只回答「谁、按什么顺序、改哪些文件、怎么验收、怎么回滚」。

## 0. 简报落点

| 简报条目 | 冻结依据 | 落实卡片 |
|---|---|---|
| 图标统一 Lucide、全程禁止 emoji | D6 / D7 | `GOV-03`（emoji 机器门禁）、`SITE-03`（官网同源 sprite） |
| 对标 Awwwards / FWA / CSSDA 每日最佳 | 方向 §9 签名时刻、§10 反模式、§11 验收 | `THEATER-*`、`SITE-01/02`、`REL-03` |
| 浏览器作为交互式艺术画布、实验性排版、物理动效 | D1 双寄存器、方向 §5.2 / §6 | `GOV-02`（寄存器与 token）、`GOV-05`（display 字体）、Phase 3 / Phase 4 全部 |
| 沉浸式体验（含图片素材版本） | D10 图像三角色、方向 §4 | `SITE-06`（作品策展）、`SHOT-01`（证据截图）、`THEATER-02`（用户此刻的图） |

## 1. 交付原则

1. **门禁先于外观**。所有会故意改像素的卡，开工前 emoji 守卫（`GOV-03`）、寄存器作用域（`GOV-02`）、v0.2.2 §0.1 例外登记（`GOV-04`）必须已合并。没有护栏就开始「Awwwards 化」，产出会退化成不可审计的品味之争。
2. **零视觉迁移与改设计严格分批**（D9.1）。Phase 1 的 Web 样式统一必须在现行阈值下门禁全绿后才允许 Phase 2 开工。禁止「迁 CSS 的同时改设计」。
3. **每张卡只动声明的 surface**。本仓视觉门禁（`scripts/compare-shared-ui-visuals.mjs`，16 个 surface）是 Web 对桌面的**双端实时对比**，没有提交基线。因此「重打基线」的操作语义是：共享 `packages/product-ui` 的改动天然双端同步；卡片合并前重跑 `npm run test:visual:shared`，桌面与 Web 表现分叉的中间态**不得跨卡存在**；阈值如需上调必须写进卡片说明，并在 `REL-02` 压回。
4. **Theater 不得泄漏进 Operate**。`--dur-theater-*` token、display 字体、滚动叙事只允许出现在 `[data-ui-register="theater"]` 子树与官网。Operate 的密度（7）与动效强度（3→4）按方向 §0 执行，不许为了「好看」降密度。
5. **共享层不引 GSAP**。GSAP 目前只是 `apps/desktop` 依赖。`packages/product-ui` 中的 Theater 瞬间（结果就位、空态入场）一律用 CSS token（`--dur-theater-*` + `--ease-spring`）实现；GSAP 只允许出现在桌面叶子（引导、朱点）与官网 `motion.js` 岛（D3）。
6. **先改产品，再拍证据图，最后切割**。截图刷新（`SHOT-01`）固定排在 Phase 4 之后、Phase 5 之前；官网新视觉的公网发布与 0.6.0 切割同批（`REL-01`），避免官网先行宣布新视觉而产品仍是 0.5 铬，或官网证据图仍是 0.5 铬。
7. **每张卡可独立回滚**。寄存器属性是增量属性；Web 样式迁移按屏分批、每批可 revert；官网改版在仓库内完成验收、发布后靠 v1.2.1 的 release 目录回滚；版本切割是最后一刀。

## 2. 阶段总览

| 阶段 | 交付结果 | 依赖 | 门禁语义 |
|---|---|---|---|
| Phase 0 治理与地基（GOV） | 假权威退役、寄存器与 token 就位、emoji 门禁、约束修订、字体锁定 | 无 | 旧视觉门禁保持绿（零视觉变更） |
| Phase 1 Web 样式统一（WEB） | `apps/web` 接入 Tailwind v4 + token，手写 CSS 只剩宿主胶水 | Phase 0 | **零视觉变更**，现行阈值全绿 |
| Phase 2 Operate 收口（OPERATE） | 字阶/间距/选中态/焦点环收口，工作台、库、历史、设置 | Phase 1 | 每卡声明 surface，双端同步，阈值差登记 |
| Phase 3 Theater 产品内（THEATER） | 引导两步、空态、结果就位、朱点收口 | Phase 0；与 Phase 2 可部分并行（不同 surface） | 桌面 E2E + 减少动效走查；共享空态进门禁 |
| Phase 4 官网 Theater（SITE） | 折页 Hero、GSAP 岛、sprite、字体、几何契约 + Lighthouse | Phase 0（GOV-05）；结构工作可与 Phase 2/3 并行 | 不进像素门禁；几何契约 + Lighthouse（D9.4） |
| 截图刷新（SHOT） | 官网证据图全部换成 0.6 产品真机截图 | Phase 2、3、4 全部完成 | 人工核对：无 0.5 铬残留 |
| Phase 5 切割与收口（REL） | 0.6.0 版本切割、阈值压回、验收清单、文档同步 | SHOT-01 | 第 9 节发布门禁全部通过 |

## 3. Phase 0：治理与地基

### GOV-01 文档权威修正

- 退役 `design-system/musefold/MASTER.md`：该文件把产品误标为 Travel/Tourism Agency、主色天空蓝 `#0EA5E9`、字体 Inter（2026-08-14 生成）。清空正文，替换为一段重定向声明，指向 [V14-UI-DIRECTION.md](./V14-UI-DIRECTION.md) 与 [v0.2.2 UI 约束](../v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md)；保留文件名避免外部引用 404。`design-system/musefold/pages/landing.md` 同批处理。
- 修订 `docs/06-ui-design-system.md`：图标线宽 2.0 改为 1.75（选中 2.25），与 v0.2.2 及 `packages/ui/src/icons.ts` 现状对齐（方向 §7）。
- `docs/README.md` 当前开发基线表补 v1.4 行。

**验收**：`rg -i 'travel|inter|0EA5E9' design-system/` 除重定向声明外无残留；`rg '2\.0' docs/06-ui-design-system.md` 无线宽残留。

### GOV-02 寄存器与 Theater token

- `packages/ui/src/tokens.css` 新增：
  - `[data-ui-register="theater"]` 作用域（颜色仍引用同一 `--accent`，不分叉品牌）；
  - 三个 Theater 时长 token：`--dur-theater-enter: 640ms`、`--dur-theater-fold: 900ms`、`--dur-theater-hold: 1200ms`（方向 §6.2）。Operate 侧 `--dur-instant`（90ms）至 `--dur-slow`（260ms）不动。
- 根节点落 `data-ui-register` 属性：
  - `theater`：`apps/desktop/src/features/onboarding/OnboardingFlow.tsx` 根、`packages/product-ui/src/workbench/WorkbenchEmptyState.tsx` 根、官网 `<body>`（随 `SITE-01` 实际生效）；
  - `operate`：`apps/desktop/src/components/layout/AppShell.tsx` 主列、`apps/web` 宿主根。
- 本卡**只建作用域，不改任何视觉**。

**验收**：旧视觉门禁绿；`rg 'dur-theater' packages/product-ui apps/desktop apps/web` 的每一处使用都在 theater 子树内（本卡合并时应为零使用）。

### GOV-03 emoji 机器门禁

- 新增 `scripts/check-no-emoji.mjs`：
  - 扫描范围（D7 穷举）：`apps/desktop/src/**/*.{tsx,ts,css}`、`apps/web/src/**/*.{tsx,ts,css}`、`packages/ui/**/*.{tsx,ts,css}`、`packages/product-ui/**/*.{tsx,ts,css}`、`website/Musefold/**/*.{html,css,js}`；
  - 判定：`\p{Extended_Pictographic}`（Unicode 属性正则），连同 VS16（U+FE0F）与 ZWJ 序列；
  - 豁免仅两类：测试夹具中描述「用户输入了 emoji」的字符串（行尾 `// emoji-allow: <原因>` 显式标记，标记本身计入审计输出）；第三方许可文本（按路径清单豁免）；
  - 自带 `--self-test`（内联夹具覆盖：命中、VS16、ZWJ、豁免标记、豁免路径五种分支）。
- 接入根 `npm run lint` 链与 CI；`Sparkles` 等 Lucide 字形是合法图标，不在本门禁范围（D7）。
- 首跑清零存量。

**验收**：向 `packages/product-ui` 任一字符串人为塞入 U+2728 后 CI 必须红；`node scripts/check-no-emoji.mjs --self-test` 通过。

### GOV-04 v0.2.2 约束修订

- `docs/v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md` 新增 §0.1「Theater 例外登记」（D13 原文照录）：
  - 适用：`[data-ui-register="theater"]` 及其子树；
  - 仍禁止：emoji、第二图标库、第二品牌色、内容区假玻璃（引导完成层用实色或图像，不用 blur 叠内容）；
  - 允许：更大字阶、更长时长、图像蒙版、一次滚动叙事（仅官网）。
- Operate 子树原约束全文继续有效，一字不改。

**验收**：文档评审通过；后续任何 Theater 例外只允许在该节追加登记，不允许散落在业务 CSS 注释里。

### GOV-05 Theater 字体锁定与自托管

全仓当前没有任何字体文件，本卡从零建。

- 候选按方向 §5.2：拉丁 **Syne（默认）或 Outfit**，中文 **Noto Sans SC**（variable，子集化）。
- 锁定程序（先于任何 Theater 卡开工）：本地对照页渲染「让灵感 / 成为图像。」全组字与 Ember 强调词，在 macOS 与 Windows 各截一张核验图附在卡内；核验项：CJK 回落不破行、不裁 descender、含 `y g j p q` 的斜体行高 ≥ 1.1、Ember 强调词不换字体家族。任一不过即换候选；两个候选都不过则触发复审（回退系统栈，只保留字阶，见技术选型 §14）。
- 产物：
  - 新建 `packages/ui/fonts/`（引导复用）与 `website/Musefold/assets/fonts/`，提交子集化 woff2；
  - 子集字表维护在 `scripts/font-subset-text.txt`（全站用字 + 数字 + 基础拉丁），再生成命令写入 `scripts/build-font-subsets.mjs` 头注释，保证可复现；
  - `@font-face` 一律 `font-display: swap`；禁止运行时 Google Fonts `<link>`（D5）；
  - OFL 许可文本随字体入库，第三方声明同步更新。
- 预算：单家族子集 woff2 < 200 KB；超出即重切子集，不放宽。

**验收**：两平台核验图登记在卡；`rg 'fonts.googleapis' apps packages website` 零匹配。

### Phase 0 完成条件

- 视觉门禁在现行阈值下全绿（本阶段零视觉变更）。
- emoji 守卫接入 CI 且 self-test 通过。
- `design-system/musefold/MASTER.md` 不再包含任何可被误读为权威的设计参数。
- Theater 字体锁定结论（含平台核验图）已登记。

## 4. Phase 1：Web 样式统一（零视觉变更）

### WEB-01 `apps/web` 接入 Tailwind v4 + token

v1.3 迁移计划 §8.4 的触发条件在本版本满足（D2）。

- `apps/web` 接入根部已有的 Tailwind v4 工具链（`@tailwindcss/postcss`、根 `tailwind.config.ts`）与 `@musefold/ui` 的 `tokens.css`。
- `apps/web/src/styles.css`（现 1,228 行）按屏分批改写为 token / 原语类，批次建议：全局与布局壳 → 工作台 → 库与历史 → 账户与设置 → 移动端抽屉与键盘 inset。
- **每一批**的合并门禁：`npm run test:visual:shared` 在现行阈值下全绿；`apps/web` 三个 Playwright spec（`mobile` / `visual-contract` / `workspace`）全绿；`check:production` 绿（fixture 标记不入产物）。
- 禁止在本卡内改任何设计决定（字号、间距、颜色一个都不动）。发现想改的，登记到 Phase 2 对应卡片。

**验收**：`styles.css` 只剩宿主布局胶水，目标 ≤ 200 行；`npm run check:v1.1` 绿。

### WEB-02 宿主胶水清点

- 留下的每条规则加一行归属注释（键盘 inset、导航抽屉、safe-area 等），无归属的删除。
- `packages/product-ui` 继续只出 `mf-*` 与 token 类；`npm run check:ui-boundaries` 绿。

### Phase 1 完成条件

- 双端视觉门禁在**未改动的阈值**下全绿——这是「零视觉变更」的机器定义。
- `apps/web` 不再存在与 token / 原语重复的手写规则。

## 5. Phase 2：Operate 收口

每张卡开头声明其 surface（对应 `compare-shared-ui-visuals.mjs` 的 16 个 surface 名），只动声明面。改动集中在 `packages/product-ui`（双端自动同步）与 `apps/desktop` 桌面独有铬（不进双端门禁，由桌面 E2E 锁行为）。

### OPERATE-01 字阶与间距收口（token 级，先行）

**surface：全部 16 个。** 像素抖动最大的一张卡，必须单独成卡、排在本阶段最前，后续卡在新字阶上工作。

- 按方向 §5.1 落字阶：Page 16–18px/600、Section 13–15px/600、Body 12–13px/400–500、Meta 11px/400；**废除 10px 正文**。数值、ID、成本继续 tabular mono；中文不用 monospace；禁止负字距、禁止靠全大写制造层级。
- 改动点：`packages/ui/src/tokens.css` 字阶 token 与 `packages/product-ui` 的引用面；`apps/desktop` 页标题同步。

**验收**：`rg 'font-size:\s*10px|text-\[10px\]' packages apps` 零匹配（豁免登记除外）；WCAG AA 正文对比不回退；双端门禁绿（阈值差登记）。

### OPERATE-02 AppShell / ProductSidebar / TitleBar

**surface：`product-sidebar`。**

- 选中态、焦点环、间距按新字阶收口；朱点保留区（`EmberMark`）继续有效，不动其行为。
- 主按钮按压物理：`transform` + `--ease-spring`，纯 CSS，不改布局尺寸，不引入新依赖。
- `AppShell` / `TitleBar` 是桌面独有铬，由 `tests/e2e` 既有用例锁行为。

### OPERATE-03 制作工作台与 Composer

**surface：`workbench`、`workbench-composer`、`workbench-composer-mobile`。**

- 画布=图：生成区以稳定画幅舞台呈现（`aspect-ratio` 占位，加载/失败不塌）。
- Composer 收成一件乐器：分组与层级重排，不是底栏工具条堆砌；一屏只有一个实心 Ember 主动作。
- 信息密度保持 7，不为留白删行。

### OPERATE-04 提示词库 / 历史

**surface：`library-list`、`prompt-detail`、`prompt-reference-card`、`prompt-reference-preview`、`history-detail-compact`、`history-workspace`。**

- 图像存在感提高：缩略图规格统一、图像优先于卡片铬；hover 只动 `transform`/`opacity`，禁止改变测量高度。
- 扫描密度不降；桌面独有能力（回收站彻底删除、历史筛选、成本看板、虚拟化）**不**在本版本补到 Web（v1.3 §8.1 的产品决定）。

### OPERATE-05 设置 / 对话框 / 命令面板

**surface：`account-summary`、`connected-apps`。**

- 同一圆角阶梯、同一焦点环、同一空/错态；更新通道行等既有功能零行为变化。
- 内容区继续禁止 `backdrop-filter`（v0.2.2 §2.1 穷举名单不扩）。

### OPERATE-06 结果行静态终态

**surface：`workbench-result`、`workbench-result-failed`、`workbench-result-cancelled`、`workbench-result-cancelled-mobile`。**

- 失败/取消/加载全部占住 `aspect-ratio`，布局不塌；结果行保持可扫描（Operate 密度）。
- 就位**动画**不在本卡（见 `THEATER-04`），本卡只交付动画结束后的静态终态。

### Phase 2 完成条件

- 16 个 surface 双端门禁全绿；每卡阈值差已登记（压回在 `REL-02`）。
- 桌面 pytest E2E 全绿；390px / 800px 无横向滚动、无不可达操作。
- 一屏一个实心 Ember 主动作，3 秒可识别（人工走查登记）。

## 6. Phase 3：Theater 产品内

引导是桌面独有（`apps/desktop/src/features/onboarding/`），不进双端像素门禁，用桌面 E2E + 卡内附图评审。空态在 `packages/product-ui`，进 `workbench` surface 门禁。

**减少动效双通道**是本阶段每张卡的验收项：`prefers-reduced-motion` 与 `useAppStore.reducedMotion`（`apps/desktop/src/stores/app.ts`）任一生效即退化为静态编辑构图，全流程可点完。

### THEATER-01 引导欢迎

- `OnboardingStepWelcome.tsx`：废除居中 logo + 字距标题的 SaaS 模板；不对称构图，display 字体（`packages/ui/fonts/`），标记入场用「折/显」编排（GSAP + `@gsap/react`，桌面叶子，卸载 `ctx.revert()`）。
- 签名动效主题在本卡定稿：折页 / 落印 / 显形**三选一为主题**，登记选择，后续卡不得并存三套隐喻（方向 §2.1）。

### THEATER-02 第一张图显形

- `OnboardingStepFirstImage.tsx`：生成图占满画布、铬后退、朱点落印确认；显形时长用 `--dur-theater-hold`。
- 失败/加载必须占住 `aspect-ratio`；推荐词只回填不代发（既有行为锁定）。
- `Sparkles` 若使用，语义是「显形」，禁止换成 emoji 字符（D7）。
- 测试钩：动画结束发 `animationend` 并置 `data-theater-idle`，引导 E2E 一律等待该钩，杜绝动画抖动（技术选型 §14 复审触发器预案前置执行）。

### THEATER-03 工作台空态

- `packages/product-ui/src/workbench/WorkbenchEmptyState.tsx`：编辑构图 + 一个真实动作；可选用一张品牌 curated 作品（来源 `SITE-06`，授权已登记）。
- 共享组件，**动效只用 CSS token**（原则 5），双端同步进 `workbench` surface 门禁。

### THEATER-04 生成结果就位

- 图像「一张纸落到桌上」：`scale`/`opacity` 就位，**全程 ≤ 800ms**（D1），结束后 DOM 回到 Operate 结果行，不把时间线改成画廊。
- 落点组件：`packages/product-ui/src/workbench/WorkbenchGenerationResultCard.tsx`（共享，CSS token 实现）与 `apps/desktop/.../GenerationResultCard.tsx`；同样输出 `data-theater-idle` 钩。
- 视觉门禁截图必须在 idle 态拍摄（Playwright / pytest 侧等待钩位）。

### THEATER-05 朱点语言收口

- `EmberMark.tsx` 不新造第二吉祥物、不加第二套物理；核验 reduced-motion 下呼吸关闭（现有行为回归测试 `test_29_ember_slip_paths.py` 绿）。
- 「显形」作为系统语言的口径统一到方向 §9；官网以二维印记呼应（`SITE-01`），不复制实时朱点。

### Phase 3 完成条件

- 减少动效路径下引导全流程可点完（两种开关各走一遍，登记）。
- 桌面 E2E 全绿（含 onboarding 与朱点用例），无因动画产生的 flaky 重试。
- `rg 'dur-theater' ` 的全部使用点都在 theater 子树内。

## 7. Phase 4：官网 Theater

官网不进 `test:visual:shared`（D9.4）。结构工作可与 Phase 2/3 并行，但证据截图一律占位，等 `SHOT-01` 替换；公网发布等 `REL-01`。

### SITE-01 信息架构与折页 Hero

- `website/Musefold/index.html` 重写为语义 HTML，寄存器 `<body data-ui-register="theater">`。
- Hero 按方向 §4 签名构图：左超大标题「让灵感 / 成为图像。」末行 Ember（不作渐变字），桌面字号 `clamp(48px, 7vw, 92px)` 最多两行；右侧真实工作台截图被一张真实生成图以折页角度压住一角。禁止纯字 + 渐变色块。
- **删除**（方向 §7 穷举）：hero 版本徽章 `0.5.0 DEV`（现 `index.html:41`）、JSON-LD 之外的 hero 版本字样、`SCROLL TO EXPLORE`、`01 / 04` 式章节计数器、装饰性状态圆点、底部 `BRAND. MOTION.` 类字带；`0.6 BETA` / `INVITE-ONLY` 不得出现（方向 §10）。
- Theme Lock：深色章节整段锁定，一屏内禁止瓷白/石墨来回跳。
- 下载区诚实：继续由 `downloads/catalog.json` 与 `script.js` 的 `data-download-version` 机制驱动；同一页面所有「开始 / 下载」意图的 CTA 文案一致。
- uppercase tracking eyebrow 最多每 3 个 section 一个。

### SITE-02 `motion.js` GSAP 岛

- 独立 ESM/IIFE，不把 React 打进官网（D8）；GSAP + ScrollTrigger，与桌面同一家族。
- **一次**滚动驱动叙事：收集 → 折叠 → 显形 → 复用；折页角随滚动展开 8–12%。禁止第二条 marquee、第二段横向劫持、Three.js 粒子（D4）。
- 硬约束：钉住用 `start: "top top"`；卸载 `ctx.revert()`；禁止 `window.addEventListener("scroll")`；`prefers-reduced-motion` 时 ScrollTrigger 全部 `kill`，退化为静态叠图。
- GSAP 进入官网必须同步 `third-party-notices` 与官网页脚许可，不得默默加（D3）。
- 预案：若 GSAP 包体打满 LCP，按复审触发器改 CSS scroll-driven + 静态折页，去掉滚动劫持。

### SITE-03 Lucide 同源 sprite

- 新增 `scripts/build-website-icon-sprite.mjs`：读取字形清单 `website/Musefold/icons.json`，从仓库 `lucide-react` 同版本的 SVG 源生成 `website/Musefold/assets/icons.svg`，页面用 `<use href="assets/icons.svg#i-download">`。
- 守卫：HTML 中的 `<use>` 引用必须 ⊆ 清单；清单外字形、手绘 path、Font Awesome、emoji 字符即失败（可扩展 `scripts/check-icon-contract.mjs` 或独立检查，接入 CI）。
- 语义唯一表继续有效（Retry = `RotateCcw`，Reload = `RefreshCw`）；线宽与产品一致 1.75。

### SITE-04 字体接入

- 消费 `GOV-05` 产物：`assets/fonts/` 落地、`@font-face` + `swap`、子集覆盖全站用字（含下载按钮数字与版本号字符）。
- LCP 元素涉及的字重预加载（`<link rel="preload" as="font">`），其余不预加载。

### SITE-05 官网验收设施（从零建）

仓库当前没有任何 Lighthouse 设施，官网也没有自动化测试。

- **几何契约**：复用 `apps/web` 已有的 Playwright 安装，新增独立项目（建议 `apps/web/e2e-site/` + 独立 config，webServer 起静态服务指向 `website/Musefold/`）；断言三档视口 390 / 768 / 1440：无横向溢出、主 CTA 首屏可见、桌面导航单行且高度 ≤ 80px。根脚本 `test:site:geometry`。
- **Lighthouse CI**：根 devDependency `@lhci/cli`，配置 `website/Musefold/lighthouserc.json`，断言 LCP < 2.5s、CLS < 0.1；根脚本 `test:site:lighthouse`。
- CI 触发：沿用 `.github/layer-paths.yml` 机制，仅 `website/**` 变更时运行。
- 图像交付规格：AVIF/WebP 双格式 + `srcset`，LCP 图像 `fetchpriority="high"`。

### SITE-06 作品图策展

- 用 Musefold 自己产出 curated 生成图集（官网 hero 蒙版、画廊、折页夹层；产品空态可选一张）。
- 登记文件 `website/Musefold/assets/works/CREDITS.md`：每张作品的生成参数、日期、授权口径。
- 生成约束（提示词必须包含，方向 §4）：调色只允许石墨、瓷白、Ember 与单张作品内容色；禁止霓虹、赛博、体积光、UI 假窗、水印、英文乱码；成片标准是「创作者会收藏的静帧」。
- 禁止用生成图画装饰背景、粒子、假界面（D10）。

### Phase 4 完成条件

- `test:site:geometry` 与 `test:site:lighthouse` 全绿。
- emoji 守卫覆盖 `website/**` 且绿；sprite 守卫绿。
- 减少动效下官网全部内容可达、静态叠图成立（人工走查登记）。
- 官网未对公网发布（等 `REL-01`）。

## 8. 截图刷新（SHOT-01）

固定排在 Phase 4 之后、Phase 5 切割之前（D10）。

- 用 0.6 产品重拍 `website/Musefold/assets/screens/` 全部证据图（现有五张：`workbench` / `library` / `model-hub` / `recipes` / `skill-import`，如 IA 调整可增删），统一主题（light/dark 择一）、统一分辨率与命名；内容不得含隐私数据。
- 官网内所有占位图替换为真机截图；**必须是真实 App，禁止 div 仿造**（D10 证据角色）。

**验收**：人工核对官网每一张证据图，无 0.5 铬残留（旧版本号、旧字阶、旧侧栏样式）。

## 9. Phase 5：切割与收口

### REL-01 0.6.0 版本切割

- 应用版本按 v1.2.1 `V121-CI-07` 单一事实源口径递进为 `0.6.0`（D12：这是用户可见的第一刀，必须与「还是 0.5 只是架构更好」切开）。
- 同步四处用户可见位置：`apps/desktop/package.json`、官网 JSON-LD `softwareVersion`（现 `index.html:26`）、`downloads/catalog.json` 的 `currentVersion` 与下载路径、桌面关于页。
- 发布路径：本版本只改 renderer 与官网 → 按 v1.2.1 内容层发布，**默认不抬 `minShellVersion`**；合并前跑 `npm run derive:min-shell` 确认渲染层未新增方法面依赖（Theater UI 不应新增 IPC）。若动了主进程窗口材质再另议（D12）。
- 官网新视觉与 0.6.0 同批对公网发布；`downloads/` 保留上一版本用于回滚（沿用 `V121-REL-06` 语义）。

### REL-02 阈值压回

- Phase 2 各卡登记的视觉门禁阈值差，全部压回起始值或更低；`compare-shared-ui-visuals.mjs` 内的阈值注释更新为 v1.4 终值与理由。
- 阈值不得偷偷放宽是 D9.3 的门禁语义；压不回去的差值必须在本卡写明原因并获裁定。

### REL-03 验收清单执行

方向 §11 逐条落为可执行动作：

| 验收项 | 执行方式 |
|---|---|
| Light / Dark 层级等价（官网、桌面、Web） | 人工走查登记，双主题截图对照 |
| 主动作 3 秒可识别 | 人工走查登记（每屏一次） |
| WCAG AA：正文 4.5:1、大字 3:1；Ember 按钮 `on-accent` 不改浅字浅底 | 抽查工具 + `tests/e2e/test_12_accessibility.py` 绿 |
| 800px / 390px 无横向滚动、无不可达操作；桌面导航单行 ≤ 80px | `test:site:geometry` + Web Playwright `mobile.spec.ts` 绿 |
| 减少动效路径可点完全流程 | 两种开关各走一遍，登记 |
| `npm run test:visual:shared` 在终值阈值上绿 | CI |
| 桌面 E2E 与 Web E2E 全绿 | `npm run test:e2e`、`npm run test:e2e:web` |
| 全仓产品表面无 emoji 字符 | `node scripts/check-no-emoji.mjs` |
| 无业务组件新增硬编码品牌色 | `rg` 抽查 + code review 登记 |

同批执行方向 §10 反模式预检（Inter / AI 紫 / div 假截图 / hero 版本号 / 多条 marquee / Three.js 粒子……出现即本版本未完成）。

### REL-04 文档同步

- `docs/README.md` v1.4 行状态更新为已实施；`docs/v1.4/README.md` 状态更新。
- 确认 `GOV-01`（`docs/06` 线宽、MASTER.md 退役）与 `GOV-04`（v0.2.2 §0.1）已随卡合并，无遗漏。
- 官网发布流程若有手工步骤变化，回写 `website/Musefold/downloads/README.md`。

## 10. 发布门禁

v1.4 视为完成的前提，缺一不可：

1. `REL-03` 验收表全项通过且登记可查。
2. 视觉门禁阈值已压回（`REL-02`），无未裁定的放宽。
3. emoji 守卫、sprite 守卫、`check:ui-boundaries`、`check:production` 全部在 CI 常驻且绿。
4. 官网 Lighthouse LCP < 2.5s、CLS < 0.1；几何契约三档视口绿。
5. 0.6.0 四处版本一致；内容层发布未抬 `minShellVersion`（或抬升已按 v1.2.1 协议裁定）。
6. 证据截图全部为 0.6 真机图。
7. 减少动效全流程走查登记（产品 + 官网）。
8. Theater token 与 display 字体未泄漏进 Operate 子树（rg 审计登记）。

## 11. 风险与复审触发器

技术选型 §14 全部有效，另登记计划级风险：

| 风险 | 缓解 | 触发后动作 |
|---|---|---|
| WEB-01 迁移期像素抖动导致门禁反复红 | 按屏分批 + 每批独立合并门禁 | 连续两批红 → 暂停迁移，先修 fixture / 字体加载时序，不放宽阈值 |
| Theater 字体 Windows CJK 回落失败 | GOV-05 锁定程序前置双平台核验 | 回退系统栈，只保留字阶（选型 §14 第 1 行） |
| GSAP 官网包体打满 LCP | motion.js 独立岛 + Lighthouse 门禁 | 改 CSS scroll-driven + 静态折页（选型 §14 第 2 行） |
| 产品内 Theater 瞬间造成 E2E 抖动 | `data-theater-idle` 钩在 THEATER-02/04 落地即为验收项 | 已前置，残余抖动按钩位等待修测试而非删动画 |
| 双端实时对比门禁无提交基线，历史不可追溯 | 每卡在 PR 附上 `artifacts/` 关键 surface 截图 | 若追溯需求成立，另立小卡把关键 surface 产物纳入 LFS/评审附件，不阻塞本版本 |
| 签名动效隐喻发散（折页/落印/显形并存三套） | THEATER-01 定稿登记，SITE-01/02 复用同一主题 | 评审发现并存 → 回 THEATER-01 的登记结论裁掉多余隐喻 |

## 12. 相关文档

- [v1.4 视觉方向与双寄存器](./V14-UI-DIRECTION.md)
- [v1.4 技术选型与决策](./V14-TECHNOLOGY-DECISIONS.md)
- [v0.2.2 UI 开发约束](../v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md)（本版本新增 §0.1 Theater 例外）
- [v1.3 迁移计划](../v1.3/V13-MIGRATION-PLAN.md)（§8.1 桌面独有能力、§8.4 Web 样式统一触发条件）
- [v1.2.1 CI/CD 交付计划](../v1.2.1/V121-DELIVERY-PLAN.md)（版本口径 CI-07、内容层发布、官网回滚语义）
- [朱点 UI 规格](../v0.3.3/V03.3-EMBER-MARK-UI-SPEC.md)
