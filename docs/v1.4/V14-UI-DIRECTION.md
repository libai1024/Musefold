# Musefold v1.4 视觉方向与双寄存器

> **状态**：v1.4 方向冻结
>
> **日期**：2026-08-22
>
> **一句话读法**：把 Musefold 读成「本地优先的视觉创作工具」给创作者，语言是安静的石墨案头；Theater 面把浏览器当成折页画布，Operate 面把窗口当成精密仪器。两面共用 Ember，不许长出第二套品牌。

## 0. 设计读法

Reading this as: dual-surface redesign of a local-first image-making product for independent creators, with a quiet Graphite / Porcelain / Ember language. Theater surfaces lean kinetic-editorial (Awwwards). Operate surfaces lean precise studio instrument (Linear / Arc / Figma). Not a travel-agency template, not a neon AI landing.

| 旋钮 | Theater | Operate（现状 → 目标） |
|---|---:|---|
| DESIGN_VARIANCE | 9 | 4 → 5 |
| MOTION_INTENSITY | 8 | 3 → 4 |
| VISUAL_DENSITY | 3 | 7 保持 7 |

Operate 密度不降。Awwwards 不靠把工作台撑出大片留白来假装高级。

## 1. 为什么现在做

1. v1.3 收官时用户可见行为为零。结构已经撑得住一次真正的视觉切割。
2. v1.3 迁移计划 §8.4 写明：Web 手写 CSS 1,228 行 vs 桌面 Tailwind v4，触发条件是「Web 端下次大改样式」。本版本就是这次大改。
3. 官网 `website/Musefold/` 已经有正确的品牌句子，但排版、动效、图像处理仍是「应用铬放大」：13px 字、编号 eyebrow、`SCROLL TO EXPLORE`、hero 里塞版本号。这是 Awwwards 评审会直接判掉的 AI 签名。
4. 产品里唯一真正有物理感的物件是朱点（GSAP 已在桌面）。它现在像孤立彩蛋，没有把「显形」写成系统语言。
5. `design-system/musefold/MASTER.md` 把产品误标成 Travel Agency、主色天空蓝、字体 Inter。后续 Agent 若读到它会污染输出。本版本必须退役这份假权威。

## 2. 双寄存器（本版本的主结构）

每个可见表面必须声明一个寄存器。实现上用 `data-ui-register="theater" | "operate"`（官网根节点、引导根节点、空态根节点、AppShell 主列）。

### 2.1 Theater：折页画布

**任务**：让第一次看见的人在 3 秒内感到「未像正在变成图像」，而不是「又一个生图客户端」。

允许：

- 实验性字号阶梯、不对称网格、文字作为图像蒙版
- 滚动驱动叙事（仅官网）、入场编排、弹簧物理
- 真实产品截图与真实生成图作为材料（裁切、层叠、遮罩、轻微视差）
- 单一签名动效：折页 / 落印 / 显形，三者选一为主题，不并存三套隐喻

禁止：

- 霓虹、网格背景、粒子、彩色光晕、mesh 渐变、AI 紫
- 假产品 UI（div 搭的仪表盘 / 终端 / 任务列表）
- 表情符号、第二节品牌色、第二套图标
- `Scroll to explore`、hero 版本号、`01 / 04` 式章节计数器、装饰性状态圆点

### 2.2 Operate：创作桌

**任务**：让每天打开的人在 3 秒内找到当前位置、当前状态、下一步动作。

允许：

- 更准的字阶、间距、选中态、焦点环
- 主按钮磁吸 / 按压物理（`transform` + spring，不改布局尺寸）
- 生成结果以稳定画幅舞台呈现，图像优先于卡片铬
- 布局过渡（面板开合、结果就位）走 `transform` / `opacity`

禁止：

- 落地页英雄区、全屏滚动劫持、无限循环装饰动画
- 内容区 `backdrop-filter`（v0.2.2 §2.1 穷举仍有效）
- 渐变表面、发光、卡片左侧 accent 条、图片底部渐变遮罩
- 为「好看」降低信息密度或把主操作藏进动效后面

`DESIGN.md` 原句继续有效：**不要把落地页英雄区放进应用壳。**

### 2.3 共用世界

两寄存器共用：

- Ember 作为唯一强调色（token 不改 hex，见决策 D12）
- Lucide、语义色、圆角阶梯、4px 间距栅格
- 朱点作为产品签名物件（桌面）；官网用二维印记呼应，不复制一颗会呼吸的实时朱点
- 中文术语表（制作工作台、提示词库、生成历史、配方……）

## 3. 表面清单与目标状态

| 表面 | 路径 | 寄存器 | 现状 | v1.4 目标 |
|---|---|---|---|---|
| 官网 | `website/Musefold/` | Theater | 克制、正确、偏应用铬；hero 含版本与 scroll cue | 折页叙事站点；图像作画布；下载诚实 |
| 引导欢迎 | `OnboardingStepWelcome.tsx` | Theater | 居中 logo + 字距标题 | 不对称构图；标记入场即「折/显」；无居中 SaaS 模板 |
| 第一张图 | `OnboardingStepFirstImage.tsx` | Theater | 表单 + 预览缩在 620px 栏里 | 生成图占满画布；铬后退；落印确认 |
| 工作台空态 | product-ui 工作台空态 | Theater 片段 | 功能完整 | 编辑构图 + 一个真实动作；推荐词仍只回填不代发 |
| 生成完成 | `GenerationResultCard` / 时间线 | Theater 瞬间 → 回到 Operate | 卡片出现 | 图像带重量就位（scale/opacity）；随后是可扫描的结果行 |
| AppShell / 侧栏 / 标题栏 | `AppShell` `ProductSidebar` `TitleBar` | Operate | 可用 | 字阶/间距/选中态收口；朱点保留区继续有效 |
| 制作工作台 | `GenerationWorkbench` + Composer | Operate | 高密度、正确 | 画布=图；Composer 是一件乐器，不是底栏工具条堆砌 |
| 提示词库 / 历史 | Library / History screens | Operate | 列表优先 | 图像存在感提高，扫描密度不降 |
| 设置 / 对话框 / 命令面板 | settings + command | Operate | 分区清楚 | 同一圆角、同一焦点、同一空/错态 |
| Web SPA | `apps/web` | 与桌面对应 | 手写 CSS 1,228 行 | 与桌面同一 token + Tailwind，像素门禁继续锁 |

桌面独有能力（回收站彻底删除、历史筛选、成本看板、虚拟化）不在本版本补到 Web。那是产品决定，见 v1.3 §8.1。

## 4. 图像策略（第 5 条简报采用含图片版本）

Musefold 的主材料就是图。本模型支持多模态，但**禁止用生成图去画装饰背景、粒子、假界面**。图像只承担三种角色：

| 角色 | 来源 | 用法 |
|---|---|---|
| 证据 | 真机截图：`website/Musefold/assets/screens/`（工作台、库、Skill、模型） | 官网 proof；必须是真实 App，禁止 div 仿造 |
| 作品 | 用 Musefold 自己跑出来的生成图（curated 集，含授权） | 官网 hero 蒙版、画廊、折页夹层；产品空态可用一张品牌作品 |
| 用户此刻的图 | 引导第一张图、工作台结果、历史缩略图 | Theater 瞬间的唯一主角；失败/加载必须占住 `aspect-ratio`，布局不得塌 |

生成新素材时的约束（给多模态模型的提示必须包含）：

- 调色只允许石墨、瓷白、Ember、单张作品里的内容色
- 禁止霓虹、赛博、体积光、UI 假窗、水印、英文乱码
- 作品图要像「创作者会收藏的静帧」，不要像股票网站的「AI 概念人」

官网 hero 推荐构图（签名画面，只此一次）：

```text
左：超大标题「让灵感 / 成为图像。」末行 Ember，不作渐变字
右：真实工作台截图，被一张真实生成图以折页角度压住一角
动：折页角随滚动展开 8–12%，露出更多作品；减少动效时静态叠图
```

禁止：纯字 + 渐变色块当 hero。

## 5. 排版

### 5.1 Operate（产品）

继续系统栈，不下载字体：

```text
"SF Pro Text", -apple-system, BlinkMacSystemFont,
"Segoe UI Variable", "Segoe UI", "PingFang SC", system-ui, sans-serif
```

数值、ID、成本继续 tabular mono。这是原生桌面工具的正确选择，也是对 CJK 最稳的渲染。

字阶微抬（相对现状 15–16px 页标题）：

| 层级 | 大小 | 用途 |
|---|---:|---|
| Page | 16–18px / 600 | 页标题 |
| Section | 13–15px / 600 | 面板 |
| Body | 12–13px / 400–500 | 控件、列表主信息 |
| Meta | 11px / 400 | 时间、模型、计数；**废除 10px 正文** |

Operate 仍然禁止负字距、禁止靠全大写制造层级。中文不用 monospace。

### 5.2 Theater（官网与引导）

自托管一款 **sans display**（禁止 Inter、禁止 Fraunces / Instrument Serif）。拉丁与数字走 display；中文回落到 `PingFang SC` / `Noto Sans SC`（自托管 subset）。

候选（择一锁定，全 Theater 只用这一对）：

- 拉丁：Syne 或 Outfit
- 中文：Noto Sans SC（variable，子集化「未像 / 让灵感成为图像」等全站用字）

英雄标题桌面目标：`clamp(48px, 7vw, 92px)`，最多两行；副文最多 20 个词当量。斜体若含 `y g j p q`，行高至少 1.1。

强调词用**同一家族的 italic 或 Ember 色**，禁止中英混用第二字体当装饰。

## 6. 动效

### 6.1 原则

每一段动画必须能用一句话说清：层级、叙事、反馈、状态切换。说不清就删。

只动画 `transform` 与 `opacity`。列表项禁止因 hover 改变测量高度。

### 6.2 时长

Operate 继续现有 token（90–260ms）。Theater 另开一组，不得泄漏进 Operate：

| Token | 时长 | 用途 |
|---|---:|---|
| `--dur-theater-enter` | 640ms | 标题/图像入场 |
| `--dur-theater-fold` | 900ms | 折页、落印 |
| `--dur-theater-hold` | 1200ms | 第一张图显形 |

缓动：`--ease-smooth` / `--ease-spring` 已在 `tokens.css`。Theater 弹簧只用在落印与主 CTA，不用在每一张卡片。

### 6.3 减少动效

`prefers-reduced-motion` 与设置里的「减少动效」必须同时生效（桌面已有 `useAppStore.reducedMotion`）。Theater 退化为静态编辑构图；朱点呼吸关闭；官网 ScrollTrigger `kill`。

### 6.4 官网滚动

允许 **一次** 滚动驱动叙事（收集 → 折叠 → 显形 → 复用）。禁止第二条 marquee、禁止第二段横向劫持。

`start: "top top"` 钉住；组件卸载必须 `ctx.revert()`。禁止 `window.addEventListener("scroll")`。

## 7. 图标与文案

- 产品：继续 `packages/ui/src/icons.ts`，ESLint 禁直连 `lucide-react`。
- 官网：构建一步生成 Lucide SVG sprite（只用到的 glyph），`<use href="#i-download">`。禁止手绘路径、禁止 Font Awesome、禁止 emoji 字符。
- 线宽：产品锁定 1.75（选中 2.25），与 v0.2.2 对齐；`docs/06` 写的 2.0 在本版本改掉。
- 语义唯一表继续有效（Retry = `RotateCcw`，Reload = `RefreshCw`）。
- 界面字符串禁止 emoji。机器约束见落实计划 GOV-03。
- 官网删除：hero 版本号、`SCROLL TO EXPLORE`、`01 / 04` 计数器、装饰性圆点、底部 `BRAND. MOTION.` 类字带。

## 8. 材质与颜色

不改 Ember / Graphite hex。本版本的高级感来自层级、纸面和印泥，不来自新色。

Operate 继续 v0.2.2：

- 内容区实色；模糊只属于瞬时层穷举名单
- 阴影只有 `--shadow-sm` 与 `--shadow-pop`
- 一屏一个实心 Ember 主动作

Theater 额外允许：

- 大字与图像的遮罩（`mix-blend` 或 SVG mask），不是渐变字
- 折页阴影用石墨 tint，不用纯黑、不用 Ember 外发光
- 官网深色章节必须整段锁定深色，禁止一屏里瓷白/石墨来回跳（Theme Lock）

`design-system/musefold/MASTER.md` 的天空蓝 / Inter **不是**本产品。读到它即视为缺陷源。

## 9. 签名时刻（只做这些，做透）

1. **官网折页 Hero**：字 + 真截图 + 真生成图。这是对外的 SOTD 画面。
2. **引导第一张图显形**：用户按一次，图占满窗口，铬让位，朱点落印。这是对内的 SOTD 画面。
3. **工作台结果就位**：图像一张纸落到桌上，随后恢复 Operate 扫描。
4. **朱点**：已有物理。本版本只收口语言，不新造第二吉祥物。

空态、侧栏、设置是工艺，不是签名。工艺要够好，但不要每页都想当封面。

## 10. 反模式（本版本预检）

以下出现即本卡未完成：

- Inter、Roboto、AI 紫、三列等大功能卡、div 假截图
- 表情符号当图标
- 工作台里的全屏滚动秀
- 官网 hero 里的 `0.6 BETA` / `INVITE-ONLY`
- 每个 section 都有 uppercase tracking eyebrow（最多每 3 个 section 一个）
- 两条以上横向 marquee
- Three.js 粒子当背景
- 同一页面两个「开始 / 下载」意图的 CTA 文案不一致
- 视觉门禁未重打基线就合并 Operate 卡

## 11. 验收

- Light / Dark 层级等价（官网、桌面、Web）。
- 主动作 3 秒可识别。
- WCAG AA：正文 4.5:1，大字 3:1；Ember 按钮上的 `on-accent` 已满足则不得改成浅字浅底。
- 800px / 390px 无横向滚动、无不可达操作；桌面导航单行、高度 ≤ 80px。
- 减少动效路径可点完全流程。
- `npm run test:visual:shared` 在新基线上绿。
- 桌面 E2E 与 Web E2E 全绿。
- 全仓 `rg` 产品表面无 emoji 字符。
- 无业务组件新增硬编码品牌色。
