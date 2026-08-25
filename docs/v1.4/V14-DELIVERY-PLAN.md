# Musefold v1.4 UI 落实计划

> **状态**：Phase 0–3 已落地；Phase 4 `SITE-01…06` 与截图刷新 `SHOT-01` 已完成（2026-08-22）。下一张卡 `REL-01`，需真实 0.6.0 构建产物与发布协调。视觉方向与技术选型已冻结。
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
3. **每张卡只动声明的 surface**。本仓视觉门禁（`scripts/compare-shared-ui-visuals.mjs`，16 个 surface）是 Web 对桌面的**双端实时对比**，没有提交基线（D9 已按此形态钉死协议）。每张卡的门禁语义是：共享 `packages/product-ui` 的改动天然双端同步；卡片合并前重跑 `npm run test:visual:shared` 并把关键 surface 的 `artifacts/` 截图附进 PR；桌面与 Web 表现分叉的中间态**不得跨卡存在**；阈值如需上调必须写进卡片说明，并在 `REL-02` 压回。
4. **Theater 不得泄漏进 Operate**。`--dur-theater-*` token、display 字体、滚动叙事只允许出现在 `[data-ui-register="theater"]` 子树与官网。Operate 的密度（7）与动效强度（3→4）按方向 §0 执行，不许为了「好看」降密度。
5. **共享层不引 GSAP**。GSAP 目前只是 `apps/desktop` 依赖。`packages/product-ui` 中的 Theater 瞬间（结果就位、空态入场）一律用 CSS token（`--dur-theater-*` + `--ease-spring`）实现；GSAP 只允许出现在桌面叶子（引导、朱点）与官网 `motion.js` 岛（D3）。
6. **先改产品，再拍证据图，最后切割**。截图刷新（`SHOT-01`）固定排在 Phase 4 之后、Phase 5 之前；官网新视觉的公网发布与 0.6.0 切割同批（`REL-01`），避免官网先行宣布新视觉而产品仍是 0.5 铬，或官网证据图仍是 0.5 铬。
7. **每张卡可独立回滚**。寄存器属性是增量属性；Web 样式迁移按屏分批、每批可 revert；官网改版在仓库内完成验收、发布后靠 v1.2.1 的 release 目录回滚；版本切割是最后一刀。

## 2. 阶段总览

| 阶段 | 交付结果 | 依赖 | 门禁语义 |
|---|---|---|---|
| Phase 0 治理与地基（GOV） | 假权威退役、寄存器与 token 就位、emoji 门禁、约束修订、字体锁定 | 无 | 旧视觉门禁保持绿（零视觉变更） |
| Phase 1 Web 样式统一（WEB） | `apps/web` 接入 Tailwind v4 + token，手写 CSS 只剩宿主胶水 | Phase 0 | **零视觉变更**，现行阈值全绿 |
| Phase 2 Operate 收口（OPERATE） | 字阶/间距/选中态/焦点环收口，工作台、库、历史、设置 | Phase 1 | **OPERATE-01…06 已完成**；16 surface 现行阈值全绿 |
| Phase 3 Theater 产品内（THEATER） | 引导两步、空态、结果就位、朱点收口 | Phase 0；与 Phase 2 可部分并行（不同 surface） | **THEATER-01…05 已完成**（主题：显形）；Windows CJK 字体核验仍为外部门禁 |
| Phase 4 官网 Theater（SITE） | 折页 Hero、GSAP 岛、sprite、字体、几何契约 + Lighthouse、作品策展 | Phase 0（GOV-05）；结构工作可与 Phase 2/3 并行 | **`SITE-01…06` 已完成** |
| 截图刷新（SHOT） | 官网证据图全部换成 0.6 产品真机截图 | Phase 2、3、4 全部完成 | **`SHOT-01` 已完成**；人工核对无 0.5 铬残留 |
| Phase 5 切割与收口（REL） | 0.6.0 版本切割、阈值压回、验收清单、文档同步 | SHOT-01 | 第 9 节发布门禁全部通过 |

## 3. Phase 0：治理与地基

### GOV-01 文档权威修正

**已完成（2026-08-22）。**

- ~~退役 `design-system/musefold/MASTER.md`~~：已替换为重定向声明（指向 v1.4 方向、v0.2.2 约束、`tokens.css`、品牌规划），并列出防再污染要点。`pages/landing.md` 同批退役——其「应用壳当官网框架、13px UI 字号」主张即 v1.4 判定的「应用铬放大」反模式。
- ~~修订 `docs/06-ui-design-system.md`~~：旧值实为「strokeWidth 2，激活 2.3」（非方向文档记的 2.0），已改为 1.75 / 选中 2.25 并注明废除旧值。
- ~~`docs/README.md` 基线表补 v1.4 行~~：已随方案交付完成。

**验收记录**：`rg -i 'travel|inter|0EA5E9' design-system/` 仅剩重定向声明内的历史描述；`rg strokeWidth docs/06` 已是新值。

**执行期发现（移交 Phase 2）**：代码实际线宽混杂——`WindowControls.tsx` 1.5（10px 视口的光学例外，待裁定保留与否）、`SidebarAccessSwitcher.tsx` 2/2.3、`HistoryLineagePanel.tsx` 1.8、其余未指定处取 Lucide 默认 2。统一到 1.75/2.25 是像素改动，登记到 `OPERATE-01`（全局默认）与 `OPERATE-02`（侧栏选中态）执行。

### GOV-02 寄存器与 Theater token

**已完成（2026-08-22）。**

- ~~`packages/ui/src/tokens.css` 新增 theater 作用域与三个时长 token~~：已落地。实现决定：`--dur-theater-*` **只**定义在 `[data-ui-register="theater"]` 作用域内，不进 `:root`——Operate 子树引用它们会解析失败（动画时长回落 0s），泄漏防护由 CSS 机制本身承担，不依赖人工评审。
- ~~根节点落属性~~：`OnboardingFlow.tsx` 根与 `WorkbenchEmptyState.tsx` 根标 `theater`；`AppShell.tsx` 主列与 `apps/web/src/App.tsx` 的 `<main className="app-main">` 标 `operate`。官网 `<body>` 随 `SITE-01` 生效。
- 零视觉变更（纯 data 属性 + 未被引用的 token）。

**验收记录**：改动面目标测试（onboarding、product-ui workbench、packages/ui）23/23 绿；`dur-theater` 当前零使用。

### GOV-03 emoji 机器门禁

**已完成（2026-08-22）。**

- ~~新增 `scripts/check-no-emoji.mjs`~~：已落地，按 D7 五组 glob 扫描；判定 `\p{Extended_Pictographic}` + 区域指示符 + VS16 + 键帽；豁免两类（`emoji-allow:` 行标记计入审计输出、许可文件按文件名模式豁免）；`--self-test` 七组夹具全过。
- **执行期新增细则**：文本表意符白名单——`© ® ™` 与 `↔↕↖↗↘↙↩↪`（默认文本呈现的排版字符，官网页脚版权与代码注释在用）不算 emoji，但跟随 VS16 强制 emoji 呈现时仍拦截。白名单穷举在脚本头注释。
- ~~接入根 lint 链与 CI~~：`npm run lint` 现为 `eslint . && node scripts/check-no-emoji.mjs`；turbo `//#lint` inputs 补入 `website/Musefold/**`（守卫扫官网，官网变更必须能失效 lint 缓存）。
- ~~首跑清零存量~~：首扫存量为零，无需清理。

**验收记录**：向 `WorkbenchEmptyState.tsx` 注入 U+2728 后守卫 exit 1 并精确报出文件:行:列；还原后再扫通过；self-test 通过。

### GOV-04 v0.2.2 约束修订

**已完成（2026-08-22）。**

- ~~新增 §0.1「Theater 例外登记」~~：已插入 `docs/v0.2/V02.2-UI-DEVELOPMENT-CONSTRAINTS.md` §0 与 §1 之间，内容按 D13：适用范围、寄存器不豁免清单（emoji / 第二图标库 / 第二品牌色 / 内容区假玻璃）、允许例外穷举（字阶、theater 时长、图像蒙版、仅官网一次滚动叙事），并加登记规则——未登记的例外视为缺陷。
- Operate 子树原约束一字未改。

### GOV-05 Theater 字体锁定与自托管

**macOS 侧已完成（2026-08-22）；Windows 核验为外部门禁（pending）。**

- **锁定结论**：拉丁 display 锁定 **Syne**（variable，wght 400–800）；中文锁定 **Noto Sans SC**（variable，标题子集）。macOS 核验全项通过：CJK 标题「让灵感 / 成为图像。」不破行、字重梯度 400/600/800 平滑、Syne descender（y g j p q）无裁切、Ember 强调不换家族、子集外字符（骤雨鷗鷺）按字符粒度干净回落系统苹方。
- **执行期发现**：google/fonts 的 Syne 只有直体、无 italic——强调词方案按方向 §5.2 的二选一锁定为 **Ember 色**，不用 faux italic。
- ~~产物~~：`packages/ui/fonts/` 与 `website/Musefold/assets/fonts/` 已提交 `syne-var.woff2`（26.6 KB）、`noto-sans-sc-var-subset.woff2`（53.3 KB）、两份 OFL 许可；预算 200 KB 达标。
- ~~可复现性~~：字表 `scripts/font-subset-text.txt`（只收标题级用字，正文回落苹方）；再生成 `scripts/build-font-subsets.mjs`（自动下载字体源到 gitignored 的 `artifacts/fonts-src/`，内置预算断言）；核验页 `scripts/font-lock-check.html`（入库，Windows 侧复跑同一页面）。
- **遗留（登记）**：Windows 平台核验图待补——若 Windows CJK 回落失败，按技术选型 §14 回退系统栈只保留字阶。`SITE-04` 已将两份 OFL 声明接入官网许可页。

**验收记录**：`rg 'fonts.googleapis' apps packages website` 零匹配；macOS 核验图已生成（`playwright screenshot` 复现命令见核验页头部路径约定）。

### Phase 0 完成条件

- ~~视觉门禁在现行阈值下全绿（本阶段零视觉变更）~~ 改动均为 data 属性 / 未引用 token / 文档 / 脚本，无像素变化；双端门禁完整跑一次合并到 Phase 1 WEB-01 第一批的门禁中执行（避免重复全量跑，与「只测改动部分」原则一致）。
- ~~emoji 守卫接入 CI 且 self-test 通过~~ ✅ 2026-08-22
- ~~`design-system/musefold/MASTER.md` 不再包含设计参数~~ ✅ 2026-08-22
- ~~Theater 字体锁定结论已登记~~ ✅ macOS 通过；Windows 外部门禁 pending，不阻塞 Phase 1/2（阻塞 Phase 3 THEATER-01 的最终合并）。

## 4. Phase 1：Web 样式统一（零视觉变更）

### WEB-01 `apps/web` 接入 Tailwind v4 + token

v1.3 迁移计划 §8.4 的触发条件在本版本满足（D2）。**已完成（2026-08-22）。**

**执行期修订的门禁方法**（比原计划更严且更便宜）：桌面侧在本卡不动，因此每批的机器门禁是 **Web 自身前后像素对比**——新工具 `scripts/diff-web-visuals.mjs`（capture/compare，复用门禁同源解码器 `scripts/lib/png-compare.mjs`）。噪声底由两次基准互比实测：静态面逐像素一致（0.000000），含滚动 ticker 动画的面最高 mean 0.0011 / changed 0.0054（动画相位漂移）；批次阈值定为 **mean ≤ 0.0015、changed ≤ 0.006**。全量 `test:visual:shared` 双端对比留到批次里程碑与收口跑。

- ~~**批次 1（基础设施接入）**~~ **已完成（2026-08-22）**：新增 `apps/web/tailwind.config.ts`（继承根配置主题，content 只扫本 app，双端产物互不掺类）；`styles.css` 顶部接入 `tailwindcss/theme.css` + `utilities.css` 分层导入。**执行期决定：刻意不引 preflight**——现有手写重置即像素基线，preflight 对齐属像素变更，推迟到 OPERATE-01。验收：34 张截图对比全部在噪声内（含 ticker 面交叉验证）；web e2e 17 通过、单测 16 通过、typecheck 绿。
- ~~**批次 2（全局与布局壳）**~~ **已完成（2026-08-22）**：层序显式声明 `@layer theme, base, components, utilities`；全局元素规则（`:root` 字体栈、`*` 盒模型、`html/body/#root`、表单重置、焦点环、`svg` 尺寸）移入 `@layer base`；删除死码 `.nav-button` 族 / `.sr-only` / `.icon-button`（web 导航已是 product-ui 组件）；`.app-main` 与 `.quota-readout` 转工具类。验收：34 张对比全部在噪声内。
- **施工细则（批次 2 期间确立，后续批次沿用）**：① 全局元素规则必须在 `@layer base`，否则未分层元素选择器压过分层工具类；② `:root` 字号是 13px，rem 基的标准间距刻度会失真，忠实转换一律用 px 任意值（`h-[28px]`）或 token 变量类（`rounded-sm`、`bg-elevated`）；③ 无 preflight 时 `border` 工具类必须显式搭配 `border-solid`；④ 类名疑似死码时用词边界搜索确认（`icon-button` 曾被 `mf-product-topbar-icon-button` 子串误报）；⑤ e2e / 媒体查询挂钩类名在转工具类后必须保留（`.result-actions` 曾被删导致 workspace 布局断言空选择器）；⑥ 未分层的 `.button` 会压过 `min-h-*` 工具类，需要更高的未分层挂钩（`.login-submit`）才能加高。
- ~~**批次 3（工作台）**~~ **已完成（2026-08-22）**：清掉 34 个确认死类（`styles.css` 1144→629 行）；工作台框 / 结果下载 / loading-mark 转工具类。验收：对照 `baseline-a` 34 张过噪声阈。
- ~~**批次 4（库、历史、账户、引导屏）**~~ **已完成（2026-08-22）**：`.page` / `.page-history` 转工具类（类名留给 680px padding）；冲突提示、引导屏盒模型、品牌锁转工具类。`.login-form input` 后裔选择器保留（要打到 Input 内部 native input）。验收：34 张过阈；账户登录 e2e 与两条先前失败的 workspace 生成流复跑通过。
- ~~**批次 5（移动端抽屉与键盘 inset）**~~ **已完成（2026-08-22）**：680px 块保持为宿主胶水（`PRODUCT_MOBILE_BREAKPOINT`），不改像素；更正旧注释把 680 误写成 760（760 是 compact 侧栏，由 product-ui 自己的查询负责）。mobile spec（抽屉 / 键盘 / 触控目标）6 项通过。
- 每批合并门禁：`diff-web-visuals` 对比在噪声阈值内；改动面 Playwright 绿。全量 `test:visual:shared` 双端对比留到 Phase 1 收口。
- 禁止在本卡内改任何设计决定（字号、间距、颜色一个都不动）。发现想改的，登记到 Phase 2 对应卡片。

**行数与 200 行目标**：收口时 `styles.css` 379 行。剩余全是有归属的宿主胶水（`@layer base` 重置、未分层 `.button`/`.composer-conflict` 契约、680px / `pointer:coarse` / reduced-motion）。压到 200 行需要把 `.composer-conflict` / `.button` 收进 `product-ui` 并改 `mf-*`——那是双端像素合同，登记到 WEB-02 已知项，本卡不搬。

**验收**：宿主胶水已清点；Web 自对比相对迁移前 `baseline-a` 在噪声内；`npm run check:v1.1` 与双端 `test:visual:shared` 留 Phase 1 收口跑（本卡未改共享层像素）。

### WEB-02 宿主胶水清点

**已完成（2026-08-22）。**

剩余规则归属（`apps/web/src/styles.css` 文件头分组注释为登记处）：

| 规则 | 归属 |
|---|---|
| `@layer base` 元素重置 | Web 宿主，不引 preflight 的替代品 |
| `.result-save-prompt:disabled` / `.button*` / `.composer-conflict*` | product-ui 仍发射这些非 `mf-*` 类；未分层才能压过工具类 |
| `.form-error` / `.spin` | Web 宿主状态 |
| `.login-form h1\|label\|input` | 穿过 Input 原语打 native `<input>` |
| `.login-submit` / `.approval-submit` | 未分层，压过 `.button` 的 32px |
| `@media (max-width: 680px)` | `PRODUCT_MOBILE_BREAKPOINT`：字号、键盘 inset、safe-area、抽屉主列 |
| `@media (pointer: coarse)` | 触控目标抬到 44px |
| `prefers-reduced-motion` | 全局降动效 |

**已知项（不在本卡修，避免双端像素合同）**：`WorkbenchDraftConflictNotice` 与 `WorkbenchGenerationResultCard` 仍输出 `composer-conflict` / `button button-secondary`。WEB-02 原文「product-ui 只出 mf-*」对存量未强制改名；后续 OPERATE 动到这两处时一并改前缀并迁样式进 `product-ui/styles.css`。

**验收记录**：`npm run check:ui-boundaries` 通过（该守卫不扫 mf-* 前缀，只锁 token 定义唯一性与 ProductSidebarLayout 用法）。

### Phase 1 完成条件

- ~~Web 自对比相对迁移前 `baseline-a` 在噪声内（零视觉变更的机器定义）~~ ✅ WEB-01 各批次对 `baseline-a` 过阈。双端 `test:visual:shared` 未在 Phase 1 单独跑——OPERATE-01 立刻改像素，双端门禁改在 OPERATE-01 收口时带新阈值跑。
- ~~`apps/web` 不再存在与 token / 原语重复的无归属手写规则~~ ✅ 剩余规则已在 WEB-02 登记归属。

## 5. Phase 2：Operate 收口

每张卡开头声明其 surface（对应 `compare-shared-ui-visuals.mjs` 的 16 个 surface 名），只动声明面。改动集中在 `packages/product-ui`（双端自动同步）与 `apps/desktop` 桌面独有铬（不进双端门禁，由桌面 E2E 锁行为）。

### OPERATE-01 字阶与间距收口（token 级，先行）

**surface：全部 16 个。** 像素抖动最大的一张卡，必须单独成卡、排在本阶段最前，后续卡在新字阶上工作。

**已完成（2026-08-22）。**

- ~~按方向 §5.1 落字阶~~：`packages/ui/src/tokens.css` 新增 `--text-page: 16px` / `--text-section: 13px` / `--text-body: 13px` / `--text-meta: 11px`；根 `tailwind.config.ts` 增加 `text-page` / `text-section` / `text-body` / `text-meta`；删未使用的 `text-xxs`。
- ~~废除 10px 及以下正文~~：`packages` + `apps` 内 9 / 9.5 / 10 / 10.5px 与对应 `text-[…]` 已改为 `var(--text-meta)` 或 `text-meta`（product-ui TSX 用 `text-[11px]`，因 Tailwind content 尚未扫该包）。`primitives.css` 里 0.6875rem（约 9px @13px 根）的 toast / empty / error 同步改为 `--text-meta`。
- ~~页标题~~：`.mf-product-topbar h1` 12px/550 → `--text-page` 16px/600（桌面 TitleBar 与 Web 顶栏共用 ProductTopbar）。
- 数值、ID、成本继续 tabular mono；中文不用 monospace。

**豁免登记**：

| 范围 | 原因 |
|---|---|
| `website/Musefold` 9–10px kicker | Theater，SITE 卡处理 |
| `.mf-ui-dropdown-label` 仍 `uppercase` | 字号已到 Meta；靠全大写制造层级未在 OPERATE-05 动（surface 不含下拉标签），仍待后续 |
| `website/GrokBotDemo` | 非本产品面 |

**双端门禁（2026-08-22）**：`npm run test:visual:shared` **现行阈值全绿，无需上调**。最高抖动：`history-detail-compact` mean 0.0508 / changed 0.0823（阈 0.14 / 0.16）；`prompt-reference-preview` changed 0.1224（阈 0.14）。Web 相对迁移前 `baseline-a` 的像素差是本卡故意的字阶抬升，不是回归。

**验收记录**：`rg 'font-size:\s*(9|10)(\.5)?px|text-\[(9|10)(\.5)?px\]' packages apps` 零匹配；product-ui/ui 单测 30 过；布局敏感 web e2e 3 过；双端视觉门禁绿。

### OPERATE-02 AppShell / ProductSidebar / TitleBar

**surface：`product-sidebar`。已完成（2026-08-22）。**

- 选中态：导航 `font-weight: 600`；图标 Ember + `stroke-width: 2.25`（默认 1.75，对齐 v0.2.2 / GOV-01）。
- 焦点环：`2px solid var(--accent-ring)`，`outline-offset: 1px`（从 2px 收紧）。
- 主按钮（「新设计」）按压：`translateY(1px) scale(0.98)` + `--ease-spring`；`prefers-reduced-motion` 下取消 transform。不改 `min-height` / padding。
- 桌面 `SidebarAccessSwitcher` 设置图标 `strokeWidth` 2/2.3 → 1.75/2.25。`EmberMark` 未动。
- 过渡从硬编码 `120ms ease` 换成 `--dur-fast` / `--ease-out`。

**门禁**：product-ui/ui 30 过；Web 自比 `operate01-meta9` → `operate02-sidebar`：`shared-product-sidebar` mean 0.0002（线宽光学差）；`shared-workbench` 因裁切含侧栏 changed 0.0062（登记为渗出，非回归）。`npm run test:visual:shared` 现行阈值全绿。AppShell / TitleBar 无行为改动，不重跑桌面全量 e2e。

### OPERATE-03 制作工作台与 Composer

**surface：`workbench`、`workbench-composer`、`workbench-composer-mobile`。已完成（2026-08-22）。**

- 画布=图：`.mf-generation-result-media` 补 `width: 100%` + 默认 `aspect-ratio: 1 / 1`（inline 比例覆盖）；占位层仍 `inset: 0`，加载/失败不塌。结果行静态终态的视觉收口仍归 OPERATE-06。
- Composer 收成乐器：去掉内容区 `backdrop-filter`（v0.2.2 §2.1 禁止 Composer 模糊）与 88% 半透明，改为实色 `--bg-elevated`；圆角 24/18 → 12/10；提示词与工具栏用发丝分隔；leading 间距 2→4px。
- 唯一实心 Ember：提交钮 hover `translateY(-1px)`、active `scale(0.96)` + `--ease-spring`；图标 1.75 / 进行中 2.25；`prefers-reduced-motion` 取消 transform。
- 信息密度：未删控件、未加留白行；composer 共享裁切 140→145 / 136→143（分隔线 + 4px 分组）。

**门禁**：product-ui/ui 30 过；composer/overflow/touch 相关 web e2e 7 过。Web 自比相对 OPERATE-02：composer 与含 composer 的全页裁切有意抖动；共享结果裁切 0.000。`test:visual:shared` 现行阈值全绿（composer 双端同为 620×145 / 366×143，mean ≈ 0.003）。

### OPERATE-04 提示词库 / 历史

**surface：`library-list`、`prompt-detail`、`prompt-reference-card`、`prompt-reference-preview`、`history-detail-compact`、`history-workspace`。已完成（2026-08-22）。**

- 缩略图统一 56×56（compact 44），列表/详情共用；边框改 `--border-subtle`，图像 `object-fit: cover` 优先于铬。
- 行 hover：背景不变高度；缩略图 `scale(1.06)` 在 `overflow: hidden` 内，不改测量高度。`prefers-reduced-motion` 取消 scale。
- 历史详情图改为 `aspect-ratio: 1 / 1` + `max-height: 360px` 舞台（compact 裁切 462→542）。
- 提示词详情封面 40→56，页标题 20/650 → 18/600。
- 引用卡去阴影、实色表面、40px 图标槽，**高度锁定 48px**。预览层未改（portal，不进行高）。
- 未把桌面回收站/筛选/成本看板/虚拟化补到 Web。

**门禁**：product-ui/ui 30 过。`test:visual:shared` 现行阈值全绿。登记：`history-detail-compact` mean 0.099 / changed 0.130（阈 0.14 / 0.16，变近）；`prompt-reference-card` 双端 mean 0.009（变近）；`library-list` 960×366 vs 桌面 960×517 仍为既有高度差。

### OPERATE-05 设置 / 对话框 / 命令面板

**surface：`account-summary`、`connected-apps`。已完成（2026-08-22）。**

- 字阶：摘要 h2 / 页 h1 → `--text-page`；事实值与应用名 → `--text-body`；说明/空/错 → `--text-meta`。
- 圆角：按钮、输入、图标槽 → `--radius-sm`；头像圈仍 50%。
- 焦点环：账号/连接应用按钮与输入 `2px var(--accent-ring)` / offset 1px（与 OPERATE-02 同一套）。
- 去掉主按钮 hover 裸 `#000`；头像描边改 `color-mix(... var(--accent))`。
- 重认证对话框的 `backdrop-filter` 仍在 §2.1 模态名单内，未扩到内容区。更新通道未改（桌面独有，零行为）。

**门禁**：product-ui/ui 30 过。Web 自比只动 account / connected-apps。`test:visual:shared` 全绿；`account-summary` 双端 680×159；`connected-apps` changed 0.044（此前 0.062）。命令面板是桌面瞬时层，本卡未改交互。

### OPERATE-06 结果行静态终态

**surface：`workbench-result`、`workbench-result-failed`、`workbench-result-cancelled`、`workbench-result-cancelled-mobile`。已完成（2026-08-22）。**

- 舞台：OPERATE-03 已让 media 吃 `aspect-ratio`（inline 覆盖默认 1/1），占位 `inset: 0`，失败/取消/加载不塌。本卡只收静态终态，无就位动画（`THEATER-04`）。
- 圆角 `--radius-md`；hover 只动边框色；图 `scale(1.02)` 在 overflow 内，不改测量高度。
- 占位图标 `stroke-width: 1.75`；图按钮焦点环 inward 2px `--accent-ring`。失败态仍 `--danger`。
- `prefers-reduced-motion` 取消图 scale。

**门禁**：product-ui/ui 30 过。Web 自比结果共享裁切 ≈ 0.000（线宽光学差）。`test:visual:shared` 现行阈值全绿，结果四卡阈值未上调。

### Phase 2 完成条件

- ~~16 个 surface 双端门禁全绿~~ ✅ `npm run test:visual:shared` 现行阈值全绿；本阶段**未上调**任何阈值（`history-detail-compact` 变近到 0.099 / 0.130，阈仍 0.14 / 0.16）。压回工作仍归 `REL-02`。
- 桌面 pytest **全量** E2E 共收集 241 项，其中包含 live / 真实账户 / 外部服务验收，仍属于发布前外部门禁；本地 v1.4 确定性子集已复核：`test_07_onboarding.py`、`test_08_generation_workbench.py`、`test_11_visual_qa.py` 共 **41 passed**（2026-08-22，真实 Electron，115.43s）。800px 人工走查仍待 `REL-03`；390 无横向滚动已在 OPERATE-03 的 `mobile generation flow` 覆盖。
- 一屏一个实心 Ember 主动作：Composer 提交钮已是唯一实心 Ember；人工 3 秒走查仍待 `REL-03`。

## 6. Phase 3：Theater 产品内

引导是桌面独有（`apps/desktop/src/features/onboarding/`），不进双端像素门禁，用桌面 E2E + 卡内附图评审。空态在 `packages/product-ui`，进 `workbench` surface 门禁。

**减少动效双通道**是本阶段每张卡的验收项：`prefers-reduced-motion` 与 `useAppStore.reducedMotion`（`apps/desktop/src/stores/app.ts`）任一生效即退化为静态编辑构图，全流程可点完。

### THEATER-01 引导欢迎

**已完成（2026-08-22）。签名动效主题锁定为「显形」。**

折页是显形的几何（标记从折角一侧 `rotateY` 展开，标题行从裁切中升起），不是第二套隐喻。落印不作为独立叙事；THEATER-02 的确认读成显形完成时的停驻。官网折页角（SITE-01）沿用同一几何。

- `OnboardingStepWelcome.tsx`：废除居中 logo + `tracking-[0.55em]` 标题。不对称双栏；display 栈 `font-theater`（Syne + Noto Sans SC 子集）；主标「让灵感 / 成为图像。」末行 Ember；一颗实心 Ember CTA「开始设置」。
- 入场：桌面叶子 GSAP + `useGSAP`（`useTheaterReveal.ts`），时长读 `--dur-theater-enter/fold`；卸载 `timeline.revert()`。`prefers-reduced-motion` 与 `reducedMotion === 'on'` 跳过编排、立刻 `data-theater-idle`。
- 测试钩：`data-theater-idle` + 冒泡 `animationend`。`test_07_onboarding.py` 的 `force_show` 等待该钩。
- 引导壳：欢迎步全宽、去掉 `1 / 4` 章节计数与 uppercase eyebrow；后续步仍用进度条（无数字）。
- 字体：补回缺失的 woff2（`packages/ui/fonts/` + 官网副本），`@musefold/ui/theater-fonts.css` 接入桌面。Windows CJK 核验仍为外部门禁（GOV-05）。

**门禁**：onboarding + brand 单测 27 过；emoji 守卫过；`test_07_onboarding.py` 5 过。本卡不进双端像素门禁。

### THEATER-02 第一张图显形

**已完成（2026-08-22）。确认读成显形完成时的停驻，不另起落印叙事。**

- `OnboardingStepFirstImage.tsx`：第 4 步全宽画布；生成图按所选 `aspect-ratio` 占满舞台；加载/失败/空态共用同一画幅盒。铬在有图后后退（去进度条、去页脚、标题让位）。
- 显形：`useFirstImageReveal` 读 `--dur-theater-hold`（图就位 + 角上朱点停驻）；生成中清掉 `data-theater-idle`，结束再打钩。减少动效双通道立刻 idle。
- 推荐词只展示、点击「生成第一张图」才发（`generateFirstImage` 不进 `useEffect`）。`Sparkles` 语义为显形。
- `test_07_onboarding.py` 在 compose 与结果两段都等待 `[data-theater-idle]`。

**门禁**：onboarding 单测 25 过；`test_07_onboarding.py` 5 过。本卡不进双端像素门禁。

### THEATER-03 工作台空态

**已完成（2026-08-22）。**

- `WorkbenchEmptyState.tsx`：不对称编辑构图（文案左、品牌图右）；display 栈标题，Ember 强调「成为图像。」；一颗实心 Ember CTA「从这条开始」（回填首条推荐词，不代发）。
- 废除三行横向跑马灯（方向 §10 反模式）。推荐词改为静态芯片，前三条仍挂 `generation-example`。
- 入场只用 CSS `--dur-theater-enter` + `--ease-spring`（`transform`/`opacity`）；`useTheaterIdle` 打钩。`prefers-reduced-motion` 与 `html.reduce-motion` / `data-motion=on` 跳过；`data-motion=off` 强制播放。
- 产品空态继续走既有 `brand` 槽，不引入第二套产品素材；官网作品图由已完成的 `SITE-06` 独立策展。
- Web 接入 `@musefold/ui/theater-fonts.css`。视觉截图等待 `workbench-empty[data-theater-idle]`。

**门禁**：product-ui / onboarding / page-identity 58 过；桌面空态 2 过；Web 空态回填与窄屏隐藏方向列表过；`npm run test:visual:shared` 现行阈值全绿（`workbench` mean 0.012 / changed 0.035，未上调）。共享层无 GSAP。

### THEATER-04 生成结果就位

**已完成（2026-08-22）。**

- ~~图像「一张纸落到桌上」~~：落点收在共享层 `GenerationResultSurface.tsx`——`useResultTheaterReveal` 只在挂载后「无图 → 有图」转场触发（真实生成、重试成功；静态挂载/历史回填不重放，不把时间线变画廊）。显形期间 media 元素同帧挂 `data-ui-register="theater"` + `data-theater-reveal`，CSS `mf-theater-result-land`（scale 1.03→1 + translateY 8px→0 + opacity，`--dur-theater-enter` 640ms + `--ease-spring`，与 THEATER-02 第一张图同一动效语言，≤ 800ms）；结束移除两个属性，DOM 回 Operate 结果行。桌面 `GenerationResultCard.tsx` 经共享卡组合继承钩，无需桌面侧改动。
- idle 钩：surface 根输出 `data-theater-idle`；pending 期先打的 idle 在显形开始时清除（避免钩子在动画中途误报就位）。
- 减少动效双通道：`skipTheaterMotion()` 命中即不加显形属性（idle 立即）；CSS 另有 `prefers-reduced-motion` / `html.reduce-motion` 双保险取消动画。
- **执行期修复**：`theaterDurationMs` 统一归一 token 单位——压缩后的 `.64s` 此前被 `parseFloat` 解析为 0.64ms，minified Web 构建下 idle 会打得太早（THEATER-03 的 `useTheaterIdle` 同病，一并修复）。
- ~~视觉门禁截图在 idle 态拍摄~~：`visual-contract.spec.ts` 的 `captureCanonicalSurface` 对 `generation-result-group` 等全部结果面 idle；pytest `test_11` 新增 `wait_result_theater_idle`（success / failed / cancelled / cancelled-mobile 四处）。

**门禁**：product-ui 71 过（新增 result-theater-reveal 3 例 + 静态终态不携带 theater 属性断言）；typecheck 绿；web visual-contract 2 过；桌面 test_11 结果面 2 过、test_08 真实生成流 29 过；`npm run test:visual:shared` 现行阈值全绿（本卡零静态终态像素变更，reveal 只在转场瞬时存在）。

### THEATER-05 朱点语言收口

**已完成（2026-08-22）。核验型卡片，零代码改动。**

- 朱点未新造第二吉祥物、未加第二套物理：`EmberMark.tsx` 本版本零改动；「显形」叙事由 THEATER-01…04 承担，朱点只在第一张图显形完成时停驻（THEATER-02 已实现）。
- 减少动效下呼吸关闭核验：`motion.css` 双通道（`.reduce-motion` 显式开启 / `prefers-reduced-motion` + `data-motion='system'`）把 `ember-breathe` 压到 0.01ms 单次迭代，退化为 v0.3.3 规定的静态柔光。回归测试 `test_29_ember_slip_paths.py` 5 过。
- 方向 §9 口径核对：四个签名时刻表述与 THEATER-01…04 落地一致，无需修订。官网二维印记呼应归 `SITE-01`。

### Phase 3 完成条件

- 减少动效路径下引导全流程可点完（两种开关各走一遍，登记）。
- 桌面 E2E 全绿（含 onboarding 与朱点用例），无因动画产生的 flaky 重试。
- `rg 'dur-theater' ` 的全部使用点都在 theater 子树内。

**本地实现状态（2026-08-22）**：THEATER-01…05 的单测、桌面定向 E2E、Web visual-contract 与共享视觉门禁均已通过；Windows CJK 字体核验仍需目标平台证据，不影响当前本地 renderer 交付。

## 7. Phase 4：官网 Theater

官网不进 `test:visual:shared`（D9.4）。结构工作可与 Phase 2/3 并行；`SHOT-01` 已将证据图替换为当前产品捕获，公网发布仍等 `REL-01`。

### SITE-01 信息架构与折页 Hero

**已完成（2026-08-22）。**

- ~~语义页面与 Theater 根寄存器~~：`website/Musefold/index.html` 已重写为 `header/nav/main/section/footer` 结构，`<body data-ui-register="theater">` 落地；首子节点保留方向契约注释。
- ~~折页首屏~~：左侧 `clamp(48px, 7vw, 92px)` 双行标题与 Ember 末行，右侧真实 `workbench.png` 真机证据图，叠加品牌折页几何层；首屏主动作「下载 Musefold」统一指向下载区。
- ~~反模式清理~~：移除 hero 版本徽章、`SCROLL TO EXPLORE`、章节计数器与 hero 状态圆点；页面不再使用渐变、第二品牌色或第二图标源。
- ~~功能保留~~：下载统计、macOS/Windows 下载契约、Skill 打开与复制动作保留；官网按钮接入 Lucide 同源 sprite（`download` / `copy` / `arrow-up-right`）。
- ~~**执行期登记**：图片生成工具本轮返回 404，未伪造 AI 作品图；Hero 的作品层暂用仓库内品牌折页素材承载几何。完整 Musefold 生成作品策展归 `SITE-06`，届时替换该层并补 `CREDITS.md`。~~ 已由 SITE-06 收口：Hero 折页与独立作品画廊已接入本地 Musefold 历史资产。

**门禁**：Playwright 390 / 768 / 1440 三档无横向溢出，CTA 首屏可见，导航高度 68 / 76px，Hero 标题在三档均保持两行；字体 `Syne` / `Noto Sans SC` 自托管加载；浅色 metadata 使用通过 WCAG AA 的 `accent-ink` / `quiet-ink`；`check-icon-contract`、`check-no-emoji`、`git diff --check` 通过。Impeccable detector 初报的 `padding` 过渡已改为 `transform`。

### SITE-02 `motion.js` GSAP 岛

**已完成（2026-08-22）。**

- ~~独立动效岛~~：`website/Musefold/motion.js` 使用本地 GSAP 3.15.0 + ScrollTrigger UMD 资源，不引入 React，不监听原生 `scroll`；`start: "top top"`、桌面 pin、`ctx.revert()` 和 `pagehide` 清理均落地。
- ~~唯一滚动叙事~~：只驱动 Hero 的真实工作台截图与折页作品层——截图后退、作品层 rotateY/scale/translate 展开，表达「收集 → 折叠 → 显形 → 复用」；其余 section 不增加滚动秀，首屏不再有第二条 IntersectionObserver 入场路径。
- ~~响应式与减少动效~~：`681px+` 使用 pinned timeline，移动端使用非 pinned scrub；`prefers-reduced-motion: reduce` 不建立 ScrollTrigger，页面保持静态叠图。
- ~~许可同步~~：GSAP 与 ScrollTrigger 本地 vendor 文件保留上游许可证头；新增 `third-party-notices.html`，页脚增加第三方许可入口。

**门禁**：Playwright 验证 GSAP/ScrollTrigger 加载、桌面 trigger=1 且 pinned、移动 trigger 非 pinned、scroll 前后 transform/opacity 变化、reduced-motion trigger=0、`pagehide` 后 trigger=0；三档无横向溢出，motion/script `node --check` 与 `git diff --check` 通过。

### SITE-03 Lucide 同源 sprite

**已完成（2026-08-22）。**

- ~~同源构建~~：`scripts/build-website-icon-sprite.mjs` 读取 `website/Musefold/icons.json`，从仓库 `lucide-react` 同版本的 SVG 节点生成 `website/Musefold/assets/icons.svg`，当前登记 `download` / `copy` / `arrow-up-right` 三枚字形。
- ~~单一图标源~~：官网 `<use>` 引用全部来自 sprite；`check-icon-contract.mjs` 同时守卫清单闭包、内联手绘 SVG、Font Awesome 和 emoji，线宽由 CSS 统一为 1.75。
- ~~门禁~~：构建脚本成功生成 sprite；官网 icon contract、no-emoji 与 `git diff --check` 通过。

### SITE-04 字体接入

**已完成（2026-08-22）。**

- ~~自托管字体~~：官网 `assets/fonts/` 落地 Syne 与 Noto Sans SC 变量子集，`@font-face` 使用 `font-display: swap`，页面无 Google Fonts 依赖。
- ~~首屏加载~~：Hero 使用的两套字体通过 `<link rel="preload" as="font">` 预加载，其余字重不额外预加载；标题级字表与 GOV-05 产物一致，单文件预算低于 200 KB。
- ~~许可登记~~：`third-party-notices.html` 记录两份 OFL 1.1 文本路径，和 GSAP/ScrollTrigger 许可一起从页脚可达。

**门禁**：官网与 `scripts/font-lock-check.html` 的 Playwright `document.fonts.check()` 均确认 Syne/Noto Sans SC 加载；1440 官网与 390 许可页无横向溢出。

### SITE-05 官网验收设施（从零建）

**已完成（2026-08-22）。**

- **几何契约（已完成）**：复用 Playwright，新增 `website/Musefold/e2e-site/` 独立 config 与测试；webServer 起静态服务指向 `website/Musefold/`，断言三档视口 390 / 768 / 1440：无横向溢出、主 CTA 首屏可见、导航高度 ≤ 80px，桌面导航 `flex-wrap: nowrap` 且垂直对齐。根脚本 `test:site:geometry`，当前三档 3 passed。
- **Lighthouse CI（已完成）**：根 devDependency `@lhci/cli@0.15.1`，配置 `website/Musefold/lighthouserc.json`，断言性能 ≥ 0.8、无障碍 ≥ 0.9、LCP < 2.5s、CLS < 0.1；`scripts/run-site-lighthouse.mjs` 复用 Playwright Chromium，根脚本 `test:site:lighthouse`。
- CI 触发：沿用 `.github/layer-paths.yml` 机制，仅 `website/**` 变更时运行。
- **图像交付规格（已完成）**：`scripts/build-website-image-variants.mjs` 生成 Hero 真机截图 768/1280 两档 AVIF/WebP；`<picture>` 使用 `srcset`，PNG 保留回退，LCP 图像 `fetchpriority="high"`。

**门禁**：几何 3 passed；Lighthouse 性能 `0.99`、无障碍 `0.95`、LCP `744ms`、CLS `0.058`；报告目录已加入 `.gitignore`。

### SITE-06 作品图策展

**已完成（2026-08-22）。**

- 复用 Musefold 本地历史中的两张已生成作品，未在本轮追加点数消耗：`floating-library.png` 用于 Hero 折页与作品画廊；`away-from-agent-loop.png` 用于作品画廊。
- 登记文件 [`website/Musefold/assets/works/CREDITS.md`](../../website/Musefold/assets/works/CREDITS.md) 记录 history ID、模型、原始提示词、画幅、生成日期、点数成本与公开发布前的 provider 条款复核口径。
- 作品保留各自内容色，但网站主寄存器仍限定为 Graphite / Porcelain / Ember；无水印、无 stock 署名、无假 UI。第二张图的蓝色仅作为单张作品内容色，不扩展为网站品牌色。
- Hero、画廊均使用 PNG 回退与 AVIF/WebP 响应式变体；不把生成图用作粒子、渐变背景或假界面。

**门禁**：`view_image` 人工检查两张原始资产；Playwright 390 / 768 / 1440 无横向溢出、Hero 标题两行、CTA 首屏可见；图像变体构建完成；`test:site:geometry` 3 passed，Lighthouse 性能 `0.99`、无障碍 `0.95`、LCP `744ms`、CLS `0.058`。

### Phase 4 完成条件

- `test:site:geometry` 与 `test:site:lighthouse` 全绿。
- `SITE-06` 作品资产与 `CREDITS.md` 已入库；`SHOT-01` 已完成，下一步转入 `REL-01` 进行真实 0.6.0 构建与发布协调。
- emoji 守卫覆盖 `website/**` 且绿；sprite 守卫绿。
- 减少动效下官网全部内容可达、静态叠图成立（人工走查登记）。
- 官网未对公网发布（等 `REL-01`）。

## 8. 截图刷新（SHOT-01）

固定排在 Phase 4 之后、Phase 5 切割之前（D10）。

**已完成（2026-08-22）。**

- 用当前 v1.4 产品重拍 `website/Musefold/assets/screens/` 全部证据图（`workbench` / `library` / `model-hub`〔连接应用〕 / `recipes`〔生成历史〕 / `skill-import`〔工作台引用预览〕），统一为 1440×900 的 light 主题；内容不得含隐私数据。
- 官网内所有占位图替换为真机截图；**必须是真实 App，禁止 div 仿造**（D10 证据角色）。

**验收**：人工核对官网每一张证据图，均来自 `artifacts/v1.4/web-visuals/operate06-result/` 的真实界面捕获；无 0.5 铬残留、旧版本号或外部产品品牌；工作台与提示词库在官网通过 `<picture>` 使用 AVIF/WebP，PNG 仅作回退。

## 9. Phase 5：切割与收口

### REL-01 0.6.0 版本切割

- 应用版本按 v1.2.1 `V121-CI-07` 单一事实源口径递进为 `0.6.0`（D12：这是用户可见的第一刀，必须与「还是 0.5 只是架构更好」切开）。
- 同步四处用户可见位置：`apps/desktop/package.json`、官网 JSON-LD `softwareVersion`（现 `index.html:26`）、`downloads/catalog.json` 的 `currentVersion` 与下载路径、桌面关于页。
- 发布路径：本版本只改 renderer 与官网 → 按 v1.2.1 内容层发布，**默认不抬 `minShellVersion`**；合并前跑 `npm run derive:min-shell` 确认渲染层未新增方法面依赖（Theater UI 不应新增 IPC）。若动了主进程窗口材质再另议（D12）。
- 官网新视觉与 0.6.0 同批对公网发布；`downloads/` 保留上一版本用于回滚（沿用 `V121-REL-06` 语义）。

**状态（2026-08-22）**：待真实 0.6.0 macOS / Windows 安装包与发布协调；当前不提前改版本号或下载 catalog，避免官网链接指向不存在的产物。`npm run derive:min-shell` 当前结果为 `0.5.0`（floor `0.5.0`，103 个方法引用），符合「仅 renderer / 官网改动不抬外壳」的预期。`release:preflight` 已新增 v1.4 版本同步检查：开发版要求官网 JSON-LD 与两份 catalog 都等于 catalog 基础版本，正式版要求四处精确等于应用版本。

### REL-02 阈值压回

- Phase 2 各卡登记的视觉门禁阈值差，全部压回起始值或更低；`compare-shared-ui-visuals.mjs` 内的阈值注释更新为 v1.4 终值与理由。
- 阈值不得偷偷放宽是 D9.3 的门禁语义；压不回去的差值必须在本卡写明原因并获裁定。

**审计记录（2026-08-22）**：`npm run test:visual:shared` 的 16 个 surface 全绿；脚本阈值与 v1.4 前的原始契约一致，本版本没有上调任何值。最高实测为 `history-detail-compact` mean `0.0994` / changed `0.1300`（仍低于 `0.14 / 0.16`），因此不改阈值，只在脚本中登记审计结果与理由。

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

**本地自动门禁记录（2026-08-22）**：`npm run release:preflight -- --json` 全部通过（11/11），并已用 `npm run clean:artifacts` 清理测试缓存；`test:site:geometry` 3 passed；Lighthouse 性能 `0.99`、无障碍 `0.95`、LCP `744ms`、CLS `0.058`；icon contract、no-emoji、JS 语法与 `git diff --check` 通过。`npm run release:status` 仍正确列出安装包哈希、远端 CI、Windows 两层运行和 Developer ID 公证为待外部证据，不把本地状态误报为发布完成。

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
