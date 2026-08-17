# 11 · 组合画布 Composer —— Deep Dive

> **大功能定位**：核心生产力主路径的**造词工作台**。把 Fragment / Template / Composition 三层引擎变成「拖拽即造词、切模型即改语法、满意即沉淀」的可视化台面。
> **差异化核心**：多 target 感知序列化（护城河 🥇）+ 完整三层组合引擎（护城河 🥉）。引擎单测 **21/21 绿**，是全项目质量标杆。
> 引用：`docs/04-composition-engine.md`（工程规格·真源）、`docs/02` §2.3/§3（schema）、`docs/07` §3.4（IPC 契约）、`docs/product/01`（融合双入口）。格式遵循 [10-library-deep-dive.md](10-library-deep-dive.md)。

> **任务卡状态回写**：2026-08-04 · 基于源码实读 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

> **与制作模式的边界（2026-08-06）**：提示词引用侧栏属于统一 Generate Workbench 的「制作」模式，不把 Composer 引入富文本编辑器或 ContentEditable。Composer 仍负责 Fragment / Template / Composition 的结构化造词；从 Library 进入 Composer 只接收显式的初始正文/参数快照，制作模式则通过右侧检索栏引用提示词整条内容或用户选中的文本片段。

> **跨入口数据约定**：Workbench 的最终 Prompt 可以包含引用合并文本，使用「存为提示词」或「拆到画布」时传递最终文本；Composer 本身不解析引用标记，也不负责写入 `history_prompt_references`。生成请求、历史写入和重试恢复由 Workbench 与主进程统一完成。

> **作品关联边界（2026-08-06）**：Composer 只是结构化提示词编辑器，不承担提示词与生成历史的模糊匹配。Workbench 生成时由主进程保存引用快照；从生成结果「存为提示词」后，再通过显式的 `history.linkPrompt` 关联成功历史。这样从 Composer 打开的正文仍可追溯到 Workbench/History 的来源，而不会因为用户在画布中改写文本造成错误关联。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为提示词工程玩家，我要**把「主体/风格/光照/构图/画质」拆成可复用片段**，像搭积木一样组合，而不是每次从零手写。
- 作为高频创作者，我要**一份组合切换模型自动改语法**：A1111 出 `(word:1.5)`，MJ 出 `word::15`，Flux 出自然语言，gpt-image 不带权重。
- 作为造词者，我要**拖片段进槽位、拉滑块调权重，右侧预览实时变**，所见即所得。
- 我要**边造边看 Token 数**，避免正文超长被模型截断（绿/黄/红一眼可辨）。
- 满意后我要**一键「另存为 Prompt」进库**，并立刻跳到库里看到它、管理它、拿去生图。
- 作为老用户，我要**从库里某条 prompt「在画布打开」二次组合**，而不是复制粘贴回炉。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| PromptBox / PromptStorm：`{variable}` 单层变量替换 | 变量占位心智 | 我们做**三层**（Fragment/Template/Composition）+ 6 种插值语法，远超单层替换 |
| ComfyUI：节点图编排 prompt | 可视化组合 | 节点图太重、门槛高；我们用「**槽位 + 拖拽**」轻量表达组合关系 |
| sd-dynamic-prompts：`{a\|b}` 通配 / 循环 | 循环 / 条件插值 | 用 `{{#each}}` / `{{#if}}` / `{{?slot}}` 覆盖，且渲染后按 target 序列化 |
| Fooocus / Krea：预设 style 一键套用 | 预设模板降门槛 | 用「**默认模板 seed + 内置 Fragment 库**」承载，且允许用户自定义 |
| 各 SD WebUI：`(word:1.5)` 权重括号 | 权重表达 | **独家**：同一权重按 target 自动改写为 `word::15` / `very word` / 纯自然语言 |

**结论**：Composer = **「变量模板的可复用性」×「节点编排的组合力」×「多 target 序列化的独家壁垒」**，但坚持**轻量**（槽位拖拽而非节点图）——让 P2 玩家造词、P1 创作者复用、切模型零手改。

---

## 2. 现状对照（设计 vs 实现）

> 依据 `docs/04` §9 与实际代码走查（`src/features/composer/**`、`electron/db/**`、`resources/builtin/`）。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增

| 小功能 | 设计要求 | 现状 | 结论 |
|--------|----------|------|------|
| 插值引擎纯逻辑 | parser/renderer/serializer/tokenizer + 6 语法 | ✅ vitest **21/21 通过**（parser 7 + renderer 5 + serializer 7 + tokenizer 2），6 语法 + 多 target 权重全覆盖 | 达标（全项目最高质量） |
| 权重序列化 by target | 7 个 target 分发 | ✅ `serializer.ts` 全 target 分发，单测覆盖 a1111/comfyui/mj/flux/openai | 达标 |
| 三栏 UI 骨架 | 库 / 画布 / 预览 | ✅ 桌面三栏 + 共享 `DndContext`；≤1100px 时片段库收为 280px 侧层，画布/预览保持稳定宽度 | 达标 |
| dnd 拖拽填槽 | @dnd-kit 拖 fragment → slot | ✅ replace、Shift/Alt append、拖出移除与视觉反馈齐全 | 达标 |
| 权重滑块 | 0.1–1.9 实时预览 | ✅ 0.1 步进、数值输入、reset、正文权重基线与 `weightable=false` 校验齐全 | 达标 |
| Token 计数阈值色 | 0-75 绿 / 75-150 黄 / >150 红 | ✅ `TOKEN_THRESHOLDS={green:75,yellow:150}`，阈值与配色**与设计一致（已核对代码）** | 达标 |
| 实时预览 | 正/负面 + token 条 + **参数面板** | ✅ target 感知参数面板、自绘比例预览/枚举菜单、数值约束与滚动布局齐全 | 达标 |
| 默认模板 seed | 至少 3 个内置模板 | ✅ DB v3 seed 4 个模板，幂等且首启自动选中；空态可重建默认模板 | 达标 |
| 模板管理 UI | 新建/编辑 body+slots+negativeBody+target+params | ✅ 模板 CRUD、槽位解析/校验、脏检查与 target；生成参数在右栏以模板 params 初始化并独立编辑 | 达标 |
| Fragment 库规模 | 100+ | ✅ **100 条**，八类齐全（subject20/camera14/lighting12/composition12/style14/quality10/negative10/custom8），均含 category/tags/compatibleModels | 达标 |
| Fragment 库树 + 搜索 | 两级树 + fuse.js + 收藏 + 兼容过滤 | ✅ Fuse content/tags 模糊搜索与高亮、收藏置顶、type→category 折叠记忆、target 过滤和拖拽源已接通 | 达标 |
| Fragment 管理 | 用户自建/编辑/删除/收藏 | ✅ 用户片段完整表单 CRUD、收藏联动与删除快照保留；内置片段前后端双重只读 | 达标 |
| 「另存为 Prompt」 | 跳 Library + 高亮新条目 | ✅ 应用内标题对话框，Composition/params 落库后跳 Library、选中并高亮 | 达标 |
| 负面 target 适配 | A1111 字段 / MJ `--no` / Flux 隐藏 / gpt-image 无 | ✅ 独立纯函数覆盖 A1111/ComfyUI、MJ、Flux/SD3/OpenAI 三类形态 | 达标 |
| target 切换实时序列化 | 切 target 预览重渲染 | ✅ 正文权重、负面形态和参数字段集同步切换，参数草稿保留 | 达标 |
| 从预览直接生图 | 预览面板生图入口 | ✅ 按钮与 Cmd/Ctrl+Enter 均保存真实 Composition，并携参数快照进入制作台 | 达标 |
| 「在画布打开」 | Library prompt → Composer 初始 body | ✅ Library/History 一次性意图注入临时模板，正文、负面与已有参数一并保留 | 达标 |
| AST 点击反查高亮 | 点预览词高亮来源 slot | 🔴 `RenderResult.segments` 已含 `sourceSlot`，UI 未消费 | 差异化，见 [15](15-differentiators-deep-dive.md) |

**一句话（2026-08-05 回写）**：Composer 14 张任务卡已全部完成：模板、100 条片段、管理/检索、拖拽/权重、多 target 预览、参数快照、另存和生图链路均已自动化验收。剩余 AST 点击反查属于 [15-differentiators](15-differentiators-deep-dive.md) 的独立差异化任务，不计入 Composer 14 卡。

---
## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | 默认模板 seed（通用写实/二次元/海报 ≥3）+ 首启空态引导 | P0 | [TASK-CMP-01](#task-cmp-01) |
| 2 | Composer store 完整 actions（模板/片段/组合/初始 body） | P0 | [TASK-CMP-02](#task-cmp-02) |
| 3 | 模板管理 UI（新建/编辑 body+slots+negativeBody+target+params） | P0 | [TASK-CMP-03](#task-cmp-03) |
| 4 | 「另存为 Prompt」真流程（跳 Library + 高亮，修掉 alert） | P0 | [TASK-CMP-04](#task-cmp-04) |
| 5 | 扩充内置 Fragment 库到 80–100+（补齐 subject/camera） | P1 | [TASK-CMP-05](#task-cmp-05) |
| 6 | Fragment 库左栏（树形分类 + fuse.js 搜索 + 收藏 + 拖拽源） | P1 | [TASK-CMP-06](#task-cmp-06) |
| 7 | Fragment 管理（用户自建/编辑/删除/收藏/筛选） | P1 | [TASK-CMP-07](#task-cmp-07) |
| 8 | 槽位填充增强（replace 默认 / append 修饰键 / 拖出移除） | P1 | [TASK-CMP-08](#task-cmp-08) |
| 9 | 权重滑块增强（0.1–1.9 + reset + weightable 校验） | P1 | [TASK-CMP-09](#task-cmp-09) |
| 10 | 实时预览参数面板（target 感知显隐 size/quality/n/background…） | P1 | [TASK-CMP-10](#task-cmp-10) |
| 11 | target 切换实时再序列化（含参数面板联动） | P1 | [TASK-CMP-11](#task-cmp-11) |
| 12 | 负面提示词 target 适配（A1111 字段 / MJ `--no` / Flux 隐藏 / gpt-image 无） | P1 | [TASK-CMP-12](#task-cmp-12) |
| 13 | 从预览面板直接生图（Composer → Generate） | P1 | [TASK-CMP-13](#task-cmp-13) |
| 14 | 「在画布打开」入口（Library prompt → Composer 初始 body） | P2 | [TASK-CMP-14](#task-cmp-14) |
| 15 | AST 点击反查高亮（差异化，本文仅占位） | P2 | 见 [15-differentiators](15-differentiators-deep-dive.md) §AST 反查 |

> **依赖主线**：CMP-02(store) 是多数卡的地基；CMP-01(模板 seed)+CMP-03(模板管理) 解首启不可用；CMP-04(另存) 打通「Composer→Library」提升动作。P0 四张卡完成即达成「首启可造词、产物可沉淀」的最小可用闭环。

---

## 4. UI/UX 设计

### 4.1 页面布局（ComposerPage · 三栏，右侧检视栏在本页隐藏见 `docs/01` §6.2）

```
┌─ 左栏 片段库(230) ─┬─ 中栏 组合画布 ────────────┬─ 右栏 实时预览(320) ────┐
│ ┌───────────────┐ │ ┌ 模板栏 ─────────────────┐ │ ┌────────────────────┐ │
│ │[🔍 搜索片段…]  │ │ │ [模板 通用写实 ▾] [＋] ✎ │ │ │ 实时预览   [另存为▾] │ │
│ ├───────────────┤ │ │            目标 [A1111 ▾]│ │ ├────────────────────┤ │
│ │▾ 主体 subject │ │ ├─────────────────────────┤ │ │ 正面   ▓▓▓░ 62 tok │ │
│ │   portrait    │ │ │ ┌ subject *  ────────┐  │ │ │ ┌──────────────┐   │ │
│ │  ⠿ young woman│ │ │ │ (a young woman:1.3)│  │ │ │ │(a young      │   │ │
│ │  ⠿ old sailor │ │ │ │ 权重 ●──────○ 1.3 ↺│  │ │ │ │ woman:1.3),  │   │ │
│ │▾ 风格 style   │ │ │ └────────────────────┘  │ │ │ │ cinematic... │   │ │
│ │   cinematic   │ │ │ ┌ style *  ──────────┐  │ │ │ └──────────────┘   │ │
│ │  ⠿ cinematic..│ │ │ │ cinematic film look│  │ │ │ 负面   28 tok      │ │
│ │▾ 光照 lighting│ │ │ │ 权重 ●───○──  1.0 ↺│  │ │ │ ┌──────────────┐   │ │
│ │  ⠿ golden hour│ │ │ └────────────────────┘  │ │ │ │ blurry, low..│   │ │
│ │▾ 构图 / 画质  │ │ │ ┌ lighting  (拖入…)  ┐  │ │ │ └──────────────┘   │ │
│ │  ★ 收藏       │ │ │ └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘  │ │ ├────────────────────┤ │
│ │               │ │ │ ┌ quality (text) ────┐  │ │ │ ⚙ 参数(A1111)      │ │
│ │               │ │ │ │ 8k, sharp focus    │  │ │ │ steps30 cfg7 …    │ │
│ │               │ │ └─────────────────────────┘ │ │ [⚡生成图像]        │ │
│ └───────────────┘ │                             │ └────────────────────┘ │
└───────────────────┴─────────────────────────────┴────────────────────────┘
```

- 左栏拖拽源（`@dnd-kit` Draggable），中栏槽位为放置区（Droppable），拖入实时更新右栏。
- 三栏均可独立滚动；窗口过窄（<1024px）时左栏可折叠为图标抽屉（P3 打磨）。

### 4.2 中栏 SlotRow（槽位卡片）

```
┌ subject *  ─────────────────────────── 🗑 ┐   ← key + required(*) + 清除
│ ┌───────────────────────────────────────┐ │
│ │ (a young woman:1.3)                     │ │   ← 已填：等宽字体 + 序列化预览
│ └───────────────────────────────────────┘ │
│ 权重  ●───────────○──────  1.3   ↺        │   ← Slider 0.1–1.9 + 数值 + reset
└─────────────────────────────────────────────┘
   拖入时：accent 边框 + 放大高亮（isOver）
   空槽：虚线边框 + 「拖入片段或文本…」占位
   text 型槽（slot.type=text）：无权重条，直接可编辑文本框
```

### 4.3 模板选择/管理栏（中栏顶部）

```
┌──────────────────────────────────────────────────────────┐
│ 模板 [通用写实 ▾]   ✎编辑  🗑删除     目标 [A1111 ▾]  [＋新建]│
└──────────────────────────────────────────────────────────┘
  下拉项：通用写实 / 二次元人像 / 电影海报 / …用户模板
  空库（无模板）时：整栏替换为空态卡「还没有模板」+ [创建默认模板] + [新建空白模板]
```

### 4.4 模板编辑器（TemplateEditor · 对话框/抽屉）

```
┌ 编辑模板 ───────────────────────────────────── ✕ ┐
│ 名称*     [电影感人像________________]            │
│ 目标      [A1111 ▾]                               │
│ 正文骨架* [ {{subject}}, {{style}}, {{?lighting}},│  ← 多行等宽；{{slot}} 语法高亮
│            {{composition}}, {{quality}}          │
│           ]                                       │
│ 负面骨架  [ {{negative_common}} ]                 │  ← target 感知（Flux/gpt-image 隐藏）
│ ── 槽位（从正文自动解析 + 手动补充）──────────── │
│  key       type      required  category   default │
│  subject   fragment    ☑        subject    —      │
│  style     fragment    ☑        —          —      │
│  lighting  fragment    ☐        lighting   soft…  │
│  quality   text        ☐        —          8k,…   │
│  [＋ 添加槽位]                                     │
│ ── 参数（可选，另存 Prompt 时带出）──────────── │
│  steps [30]  cfg [7]  sampler [DPM++ 2M Karras]   │
│ ────────────────────────────────────────────────  │
│                             [取消]  [保存 ⌘S]     │
└───────────────────────────────────────────────────┘
```

- 校验（zod）：`name` + `body` 必填；每个 slot `key` 唯一且为合法标识符；正文里出现但未在 slots 声明的 key **自动补齐**为 `fragment/required=false`。
- 「从正文解析槽位」：解析 body AST，抽取所有 `slot` 节点 key，与 slots 列表 diff，提示新增/多余。
- 未保存关闭：脏检查 → 「放弃更改？」确认。

### 4.5 关键交互与状态

| 场景 | 行为 |
|------|------|
| 选模板 | `setTemplate`：重置 slotFills、target 取模板 `target`、重渲染预览 |
| 拖片段入槽（默认） | **replace**：覆盖槽位现有内容，实时重渲染 |
| 拖片段入槽 + `Shift/Alt` | **append**：追加到现有文本（`, ` 连接），实时重渲染 |
| 槽内片段拖出 | 移除该槽填充（`setSlotFill(key, null)`） |
| 拖动权重滑块 | `weightOverride` 实时写入 → 右栏按 target 序列化重渲染 |
| 权重 reset ↺ | 恢复到片段声明 `weight`（或 1.0） |
| `weightable=false` 片段 | 权重条禁用 + tooltip「该片段不支持权重」 |
| 切 target | 预览正/负面按新 target 重序列化；参数面板字段随之显隐；负面区按 target 适配 |
| Token 条 | 0–75 绿 / 75–150 黄 / >150 红（`gpt-tokenizer`，正文实时） |
| 另存为 Prompt | 输入标题 → `createFromComposition` → **跳转 Library 并高亮新条目**（见 CMP-04） |
| 生成图像 | 用当前渲染正/负面 + 参数进 Generate 精修（见 CMP-13）；未配 Provider 引导去设置 |
| 在画布打开 | 从 Library 进入，以 prompt.content 作为**临时单槽模板**的初始 body（见 CMP-14） |
| **空态·无模板** | 空态卡 +「创建默认模板」（一键 seed 3 模板）/「新建空白模板」 |
| **空态·未填槽** | 预览区提示「拖入片段开始组合」；必填槽未填时其卡片红色描边提示 |
| **加载态** | 三栏骨架占位 |
| **错误态** | 顶部 inline 错误条 + 重试 |

---
## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。前缀 `CMP` = Composer。

### <a id="task-cmp-01"></a>[TASK-CMP-01] 默认模板 seed + 首启空态引导

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Composer
- **依赖**：无
- **预估**：M

**目标**：干净安装后 Composer 至少有 3 个内置模板（通用写实 / 二次元人像 / 电影海报），画布不再空转；完全无模板时给「创建默认模板」引导，一键补齐。

**涉及文件**（新建/修改）：
- `resources/builtin/templates.json`（新建：≥3 个模板，字段对齐 `NewTemplate`：name/body/negativeBody/slots/params/target）
- `electron/db/migrations/seed-templates.ts`（新建：仿 `seed-fragments.ts`，`INSERT OR IGNORE` 幂等）
- `electron/db/migrations/0001_initial.ts`（修改：`seedBuiltinFragments(db)` 后调用 `seedBuiltinTemplates(db)`）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：无模板空态加「创建默认模板」按钮）
- `src/features/composer/store.ts`（依赖 CMP-02 的 `seedDefaultTemplates` action）

**IPC 契约**：seed 走主进程迁移，无新通道；「创建默认模板」按钮走 `db:templates:create`（docs/07 §3.4，已存在）批量建。

**建议 seed 内容**（对齐 `docs/02` §3 示例）：
- 通用写实（a1111）：`{{subject}}, {{style}}, {{?lighting}}, {{?composition}}, {{quality}}`，negativeBody 用通用负面。
- 二次元人像（a1111）：anime 风骨架 + 二次元负面。
- 电影海报（midjourney）：`{{subject}}, {{style}}, cinematic poster {{?composition}}`，target=midjourney 演示 `--no` 负面。

**交互与 UI/UX**：见 §4.3 空态。「创建默认模板」点击后 seed 3 模板并自动选中第一个、重渲染预览；已存在同名不重复插入。

**验收标准**：
- [x] 干净安装后 `db:templates:list` 返回 ≥3 个模板，Composer 打开即选中第一个
- [x] 3 个模板各含合法 slots，拖片段可正常渲染出正文
- [x] 至少一个模板 target=midjourney，用于验证负面 `--no`（配合 CMP-12）
- [x] 无模板时空态出现「创建默认模板」，点击后即时补齐并选中
- [x] seed 幂等：重复启动 / 重复点击不产生重复模板

**测试场景**：
1. 正常：删库首启 → 三模板就位 → 选「通用写实」→ 拖 subject/style → 预览有正文。
2. 边界：手动删光所有模板 → 空态引导出现 → 一键创建恢复。
3. 异常：`templates.json` 缺失/损坏 → seed 静默跳过（返回空数组），不崩溃，空态仍可手动新建。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm run test`（若加 seed 单测则含）
- [x] preview / 首启验证三模板 + 空态引导

---

### <a id="task-cmp-02"></a>[TASK-CMP-02] Composer store 完整 actions

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Composer
- **依赖**：无
- **预估**：M

**目标**：`composer/store.ts` 补齐业务组件所需 action，统一走 `window.api.{template,fragment,composition,prompt}.*`，成功后本地状态即时同步；为模板管理、片段管理、另存跳转、在画布打开提供状态基座。

**涉及文件**：
- `src/features/composer/store.ts`（修改/补齐）

**现状**：已有 `loadAll/setTemplate/setTarget/setSlotFill/rerender/saveComposition/saveAsPrompt`；`saveAsPrompt` 目前只返回 id，不触发跳转。

**需新增/补齐的 actions**：
- 模板：`createTemplate(t)` · `updateTemplate(id, patch)` · `deleteTemplate(id)` · `seedDefaultTemplates()`（批量建 3 默认）
- 片段：`createFragment(f)` · `updateFragment(id, patch)` · `deleteFragment(id)` · `toggleFragmentFavorite(id)`（收藏本地持久化，见 CMP-06）
- 槽位：`appendSlotFill(key, fragment)`（追加模式）· `clearSlotFill(key)`
- 组合/提升：`saveAsPrompt` 返回 `{id}` 并暴露给页面做跳转（跳转本身在 CMP-04）
- 初始 body：`openWithBody(body, opts?)`（在画布打开，见 CMP-14）
- 状态补充：`favoriteFragmentIds: string[]`、`loading`、`error`

**验收标准**：
- [x] 每个 action 调用对应 IPC，失败 set `error` 且不破坏现有 templates/fragments 列表
- [x] create/update/delete 后本地 `templates`/`fragments` 即时反映，无需整表 refetch
- [x] `setSlotFill` 保持现有 replace 语义，新增 `appendSlotFill` 走追加
- [x] `weightOverride`/`textOverride` 变更后 `rerender` 被触发（预览同步）

**测试场景**：
1. 正常：createTemplate → 列表 +1 → setTemplate 选中 → 拖片段渲染正确。
2. 边界：连续 setSlotFill/append 混用，slotFills 与预览一致，无残留。
3. 异常：updateTemplate IPC reject → error 置值、原列表不变。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] 相关 store 逻辑若可单测则加

---

### <a id="task-cmp-03"></a>[TASK-CMP-03] 模板管理 UI（新建/编辑）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02
- **预估**：L

**目标**：提供完整模板创建/编辑：名称、target、正文骨架（`{{slot}}` 语法）、负面骨架、槽位表（key/type/required/category/default）、可选参数——补上当前**完全缺失**的模板 UI，解「空态提示要创建却无创建入口」的死结。

**涉及文件**：
- `src/features/composer/components/TemplateEditor.tsx`（新建：对话框/抽屉表单）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：模板栏加 [＋新建]/✎编辑/🗑删除 入口）
- `src/features/composer/store.ts`（依赖 CMP-02 的 template actions）

**IPC 契约**（docs/07 §3.4，已存在）：`db:templates:create` `NewTemplate → Template`、`db:templates:update` `{id, patch} → Template`、`db:templates:delete` `{id} → {ok}`。

**交互与 UI/UX**：见 §4.4。核心：**从正文自动解析槽位**（`parse(body)` 抽 slot 节点 key），与手动 slots diff 后提示补齐；`{{slot}}` 语法在正文输入框内高亮。target 切换时负面骨架字段按适配显隐（配合 CMP-12）。

**验收标准**：
- [x] 新建模板：name+body 必填校验，保存后下拉即时出现并可选中
- [x] 编辑模板：预填全字段，保存后 `updated_at` 更新、预览用新 body 重渲染
- [x] 从正文解析槽位：body 写 `{{subject}}` 未在 slots 声明 → 提示/自动补 `fragment,required=false`
- [x] 槽位 key 唯一性校验，重复时红字禁止保存
- [x] 删除模板走软删（`deleted_at`），若删的是当前模板则回退到列表首个或空态
- [x] 未保存关闭弹脏检查确认

**测试场景**：
1. 正常：新建「产品摄影」模板（4 槽）→ 保存 → 选中 → 拖片段渲染正确。
2. 边界：body 只有纯文本无 slot → 可保存，槽位表为空，预览=原文。
3. 异常：两个槽 key 同名 → 保存禁用 + 红字；create IPC reject → 表单不清空 + 错误条。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] preview 验证新建/编辑/删除 + 槽位解析

---

### <a id="task-cmp-04"></a>[TASK-CMP-04] 「另存为 Prompt」真流程（跳 Library + 高亮）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02
- **预估**：M

**目标**：把当前 `window.prompt()` 取标题 + `window.alert('已另存为提示词')` 的占位实现，升级为完整提升流程：**保存组合 → 创建 Prompt → 跳转 Library → 高亮并选中新条目**，打通 `docs/01` §5.1 的「Composer→Library」提升动作。

**涉及文件**：
- `src/features/composer/components/PreviewPanel.tsx`（修改：替换 alert 流程，改用应用内标题输入 + 跳转）
- `src/stores/app.ts`（修改：`setView('library')` 已具备；新增高亮意图传递，如 `pendingHighlightPromptId`）
- `src/features/library/store.ts`（修改：接收并消费高亮 id，选中 + 滚动到该条 + 短暂高亮动效）
- `src/features/composer/store.ts`（`saveAsPrompt` 返回新 prompt id）

**IPC 契约**（docs/07 §3.1，已存在）：`db:prompts:createFromComposition` `{compositionId, title?} → Prompt`（主进程 `prompts.ts:244` 已实现，`source='composition'` + `compositionId` 外键回填正确）。

**交互与 UI/UX**：
- 点「另存为」→ 应用内小对话框输入标题（默认 `模板名 + 时间戳`），**不再用 `window.prompt`**。
- 成功后：`setView('library')` + 设置 `pendingHighlightPromptId` → Library 打开后选中该条、滚动可见、`accent` 高亮 1.5s 后淡出 + toast「已存入库」。
- 失败：错误条提示，不跳转。

**验收标准**：
- [x] 另存后 Library 出现新 prompt，`source='composition'`、`composition_id` 正确回填
- [x] 另存后自动切到 Library 视图，新条目被选中 + 滚动可见 + 高亮动效
- [x] 标题输入用应用内对话框（无 `window.prompt`/`window.alert`）
- [x] 空标题回退到默认标题；取消则不创建
- [x] 另存不回写 Composition（单向提升，`docs/02` §5）

**测试场景**：
1. 正常：填槽 → 另存「电影人像」→ 跳 Library → 新条目高亮选中，正文=渲染正文。
2. 边界：未填任何槽（正文为空）→ 提示「正文为空，仍要保存？」或禁用另存。
3. 异常：createFromComposition reject → 错误条 + 停留在 Composer。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] preview 验证另存 → 跳转 → 高亮全链路

---
### <a id="task-cmp-05"></a>[TASK-CMP-05] 扩充内置 Fragment 库到 80–100+

- **状态**：✅ 已完成（2026-08-05：100 条、八类齐全，含升级迁移与打包验收）
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：无
- **预估**：M

**目标**：把内置片段从 **45 条**扩到 80–100+，**补齐当前为 0 的 `subject` 与 `camera` 两类**，并均衡各 `type`，让默认模板的每个槽位都有可拖素材。

**涉及文件**：
- `resources/builtin/fragments.json`（修改：新增条目，字段沿用 type/content/category/tags/compatibleModels）
- `electron/db/migrations/seed-fragments.ts`（按 `source+type+content` 业务键判重）
- `electron/db/migrations/0005_expand_builtin_fragments.ts`（已有数据库升级补齐）

**完成分布**：`subject 20 / camera 14 / lighting 12 / composition 12 / style 14 / quality 10 / negative 10 / custom 8`。

**建议补充**（对齐 `FragmentType` 八类）：
- `subject`（新增 ~20）：人像/动物/场景/物体/幻想生物等，配 `category=subject/portrait|animal|scene…`。
- `camera`（新增 ~12）：焦段/机位/景深，如 `85mm portrait lens, shallow depth of field`、`wide angle, low angle shot`。
- `quality`（补到 ~10）、`negative`（补到 ~10，含人像通用/SDXL 推荐/二次元）、`style`/`lighting`/`composition` 各酌情补。
- 每条标注合理 `compatibleModels`，供后续按 target 过滤（CMP-06）。

**验收标准**：
- [x] `fragments.json` 总数 ≥80，`subject` ≥15、`camera` ≥10、`negative` ≥8
- [x] 每个内置模板的 fragment 型槽位都能在库中找到 ≥3 个匹配 category 的片段
- [x] JSON 合法，字段齐全（type 合法枚举、tags/compatibleModels 为非空数组）
- [x] seed 幂等（新库 0001→0005 不重复；旧库由 0005 只补缺失条目）

**测试场景**：正常（首启片段树八类齐全）；边界（`subject` 类下可拖入 subject 槽渲染正确）；异常（含中英文引号/括号的 content 不破坏渲染，如 `(word:1.5)` 原样保留）。

**质量门禁（2026-08-05）**：4 项 JSON/分布/模板覆盖契约测试通过；Composer+基座 E2E 30 passed；全量无 API E2E 215 passed / 6 skipped；macOS 打包冒烟 1 passed。

---

### <a id="task-cmp-06"></a>[TASK-CMP-06] Fragment 库左栏（树 + fuse.js + 收藏 + 拖拽源）

- **状态**：✅ 已完成（2026-08-05：Fuse 搜索/高亮、收藏、折叠记忆、target 过滤与拖拽契约）
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02, TASK-CMP-05
- **预估**：M

**目标**：把当前手写分组 + 本地 `filter` 的左栏，升级为：树形分类（type 一级 / category 二级）+ **fuse.js 模糊搜索**（content/tags）+ **收藏区** + 按 target 兼容性过滤，拖拽源不变。

**涉及文件**：
- `src/features/composer/components/FragmentLibrary.tsx`（修改：接 fuse.js + 收藏 + 折叠树 + compatibleModels 过滤）
- `src/features/composer/store.ts`（`favoriteFragmentIds`、`toggleFragmentFavorite`）

**现状**：`FragmentLibrary.tsx` 用 `useMemo` + `Array.filter` 做子串匹配，`type→category` 双层 `Map` 分组渲染，`@dnd-kit` Draggable 已就位；**无 fuse.js、无收藏、无 arborist**。（`docs/04` §6.1 建议 react-arborist，但轻量折叠树即可满足，Opus 可自主取舍。）

**IPC 契约**：`db:fragments:list`（docs/07 §3.4，已存在）；收藏为前端本地偏好（localStorage 或 app store），不占 IPC。

**交互与 UI/UX**：见 §4.1 左栏。搜索 fuse.js 阈值模糊匹配 + 命中高亮；收藏区置顶（★）；可按当前 target 的 compatibleModels 过滤（开关，默认全显）；分类可折叠。

**验收标准**：
- [x] fuse.js 模糊搜索命中 content 与 tags（容错拼写），正文命中高亮
- [x] 收藏片段进「★ 收藏」区置顶，点星切换、本地持久化；收藏项不复制 draggable ID
- [x] 树按 type→category 两级折叠，展开态记忆；搜索时自动展开结果
- [x] 按 target 过滤开关：开启后只显示 compatibleModels 含当前 target 家族的片段
- [x] 拖拽源功能保持（dnd-kit 源契约 + CMP-08 填槽语义回归）

**测试场景**：正常（搜 "cinema" 命中 cinematic 系列）；边界（收藏 0 条时收藏区隐藏）；异常（片段 content 超长在窄栏截断不溢出）。

**质量门禁（2026-08-05）**：`npm run check` 28 文件/201 项通过；CMP-06 专项 Electron E2E 5 passed；Composer 全模块 E2E 55 passed；真实渲染截图检查无窄栏溢出；macOS 打包冒烟 1 passed。

---

### <a id="task-cmp-07"></a>[TASK-CMP-07] Fragment 管理（自建/编辑/删除/收藏/筛选）

- **状态**：✅ 已完成（2026-08-05）
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02, TASK-CMP-06
- **预估**：M

**目标**：用户能自建/编辑/删除自己的 Fragment（type/content/weight/weightable/tags/category/compatibleModels），补上后端已备（`db:fragments:*`）但前端缺失的管理闭环。

**涉及文件**：
- `src/features/composer/components/FragmentEditor.tsx`（新建：小表单，对话框或左栏内联）
- `src/features/composer/components/FragmentLibrary.tsx`（修改：条目右键/悬浮菜单 编辑/删除；顶部 [＋新建片段]）
- `src/features/composer/store.ts`（createFragment/updateFragment/deleteFragment）

**IPC 契约**（docs/07 §3.4，已存在）：`db:fragments:create` `NewFragment → Fragment`、`update`、`delete`。内置片段（`source='builtin'`）只读不可删，用户片段（`source='user'`）可增删改。

**验收标准**：
- [x] 新建用户片段：type+content 必填，保存后即时进树对应分类
- [x] 编辑/删除仅对 `source='user'` 开放；`builtin` 片段不显示管理操作，IPC/repository 同时拒绝越权写入
- [x] `weightable` 开关落库，false 时该片段在槽内权重条禁用（配合 CMP-09）
- [x] tags/category/compatibleModels 正确保存与回显
- [x] 删除用户片段后从树移除；若正在某槽使用，槽内文本保留（textOverride 已快照），收藏引用同步清理且不报错

**测试场景**：正常（建自定义 style 片段并拖用）；边界（删除正在用的片段，画布不崩，槽保留文本）；异常（create reject → 表单保留 + 错误条）。

**质量门禁（2026-08-05）**：`npm run check` 28 文件/201 项通过；CMP-07 专项 Electron E2E 5 passed；Composer 全模块 E2E 60 passed；1280×800 真实渲染截图检查表单完整且无重叠；macOS 打包版覆盖用户片段 CRUD 与内置只读，冒烟 1 passed。

---

### <a id="task-cmp-08"></a>[TASK-CMP-08] 槽位填充增强（replace / append / 拖出移除）

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02
- **预估**：M

**目标**：实现 `docs/04` §6.2/§7 的完整拖拽规格：默认 **replace**、按住 `Shift/Alt` **append**、槽内片段**拖出移除**，并给拖拽视觉反馈。

**涉及文件**：
- `src/pages/ComposerPage.tsx`（修改：`onDragEnd` 读修饰键，分发 replace/append；处理拖出）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：槽内内容变为可拖出的 Draggable；append 目标视觉）
- `src/features/composer/store.ts`（`appendSlotFill`、`clearSlotFill`）

**现状**：`ComposerPage.handleDragEnd` 仅 `setSlotFill(slotKey, fragment)`（永远 replace），无 append、无拖出、无修饰键读取。

**交互与 UI/UX**：拖入时槽位 `isOver` 高亮已具备（accent 边框）；append 模式下额外提示「追加」；从槽内拖出到非槽区域 → 清空该槽；`@dnd-kit` 的 `activatorEvent` 读 `shiftKey`/`altKey`。

**验收标准**：
- [x] 默认拖入 replace 覆盖槽内容
- [x] 按住 Shift/Alt 拖入 append（`原文, 新文` 连接），预览实时更新
- [x] 槽内片段可拖出移除，槽回到空态占位
- [x] 拖拽过程视觉反馈：源半透明、目标槽高亮，append 态有区分提示
- [x] append 后权重语义合理（追加内容默认 1.0，或整槽共享权重，实现自定但需一致）

**测试场景**：正常（replace 后 Shift 追加两段）；边界（空槽 append = 等同 replace）；异常（拖到非法目标不改状态）。

**质量门禁**：`npm run typecheck` + preview 验证三种拖拽。

---

### <a id="task-cmp-09"></a>[TASK-CMP-09] 权重滑块增强（0.1–1.9 + reset + weightable 校验）

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02
- **预估**：S

**目标**：权重滑块补齐 reset（恢复片段声明权重）、数值精度显示、`weightable=false` 片段禁用权重，且实时反映到 target 序列化预览。

**涉及文件**：
- `src/features/composer/components/CompositionCanvas.tsx`（修改：SlotRow 加 reset ↺ + weightable 判定）
- `src/features/composer/store.ts`（`setSlotFill` 权重路径，reset 逻辑）

**现状**：`SlotRow` 已有 `Slider min=WEIGHT_MIN(0.1) max=WEIGHT_MAX(1.9) step=0.1` + 数值显示 + 实时 `onWeight`；缺 reset、缺 weightable 禁用。

**验收标准**：
- [x] 滑块范围 0.1–1.9、步进 0.1，数值实时显示（1 位小数）
- [x] reset ↺ 恢复到片段 `weight`（无则 1.0），预览同步
- [x] `weightable=false` 的片段：滑块禁用 + tooltip，序列化不加权重括号
- [x] 权重变更实时驱动右栏按当前 target 重序列化（a1111 `(x:1.30)` / mj `x::13` / flux `very x`）
- [x] 权重≈1.0 时预览不加任何权重语法（`serializeWeight` 已保证）

**测试场景**：正常（拖到 1.5，a1111 预览出 `(x:1.50)`）；边界（拖到 1.0，预览无括号）；异常（weightable=false 片段滑块不可动）。

**质量门禁**：`npm run typecheck` + preview（可复用引擎单测覆盖序列化正确性）。

---
### <a id="task-cmp-10"></a>[TASK-CMP-10] 实时预览参数面板（target 感知显隐）

- **状态**：✅ 已完成（2026-08-05）
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02
- **预估**：M

**目标**：右栏预览补上 `docs/04` §6.3 的**参数面板**——按 target 显隐不同字段（gpt-image 显 size/quality/n/background；SD 系显 steps/cfg/sampler/seed），参数随另存/生图带出。

**涉及文件**：
- `src/features/composer/components/PreviewPanel.tsx`（修改：正/负面下方加参数面板区）
- `src/features/composer/components/ParamPanel.tsx`（新建：target 感知字段渲染）
- `src/features/composer/store.ts`（当前编辑参数 draft，随 target 切换给默认值）

**完成实现**：`PreviewPanel` 接入 target 感知 `ParamPanel`；`PromptParams` 草稿按模板预填、枚举/数值归一化并随 Composition/Prompt/Workbench 传递。OpenAI/MJ 复用自绘 `RatioPicker`，比例轮廓可视且不使用原生下拉。

**字段矩阵（建议）**：

| target | 显示字段 |
|--------|----------|
| openai (gpt-image) | size / quality / n / background / moderation |
| a1111 / comfyui | steps / cfg / sampler / seed |
| flux / sd3 | steps / cfg / seed（无 sampler 或简化） |
| midjourney | 少量（`--ar` 等，或占位说明「参数写入正文标志位」） |
| generic | 隐藏或最小化 |

**验收标准**：
- [x] 参数面板按 target 显隐正确字段（切 target 即时切字段集）
- [x] 参数值随模板 `params` 预填，可编辑
- [x] 参数在「另存为 Prompt」时写入 `prompt.params`（配合 CMP-04）
- [x] gpt-image 的 size/quality 取值合法（对齐 `ImageSize`/`ImageQuality` 枚举）
- [x] 面板不遮挡预览文本，窄栏可滚动

**测试场景**：正常（target=openai 显 size/quality）；边界（切到 flux 隐藏 sampler）；异常（非法 size 输入被枚举约束/回退）。

**质量门禁（2026-08-05）**：参数纯函数 Vitest 6 passed；CMP-10 专项 Electron E2E 7 passed；Composer 五文件全回归 67 passed（198.10 秒）；`npm run check` 为 29 文件/207 项；1320×860 与 940×600 截图检查无重叠，窄窗片段侧层可用；macOS 打包版参数/Workbench 冒烟 1 passed。

---

### <a id="task-cmp-11"></a>[TASK-CMP-11] target 切换实时再序列化

- **状态**：✅ 已完成
- **优先级**：P1 · **差异化关联** 🥇
- **所属大功能**：Composer
- **依赖**：TASK-CMP-09, TASK-CMP-10
- **预估**：S

**目标**：切换 target 时，右栏正/负面**整体重序列化**、参数面板换字段集、负面区按 target 适配——把「多 target 感知序列化」这一护城河在 UI 上跑通、可见。

**涉及文件**：
- `src/features/composer/components/CompositionCanvas.tsx`（target Select 已在，确认联动）
- `src/features/composer/store.ts`（`setTarget→rerender` 已在，扩展联动参数面板 + 负面适配）
- `src/features/composer/components/PreviewPanel.tsx`（消费适配结果）

**现状**：`store.setTarget` → `set({target})` → `rerender()` 已重渲染正文权重；**但参数面板（CMP-10）与负面适配（CMP-12）尚未联动**，本卡收口三者一致性。

**交互与 UI/UX**：target 下拉切换即时（<50ms 感知）刷新三处：正文权重语法、负面区形态、参数字段集。可加一行小字提示当前语法示例（如 A1111：`(word:1.5)`）。

**验收标准**：
- [x] 同一填充下，切 a1111→mj→flux→openai，正文权重语法分别为 `(x:1.50)` / `x::15` / `very x` / `x`
- [x] 切 target 同步刷新参数面板字段集（CMP-10）与负面区形态（CMP-12）
- [x] 切换无明显卡顿，预览无闪烁残留
- [x] 模板自带 target 在选中模板时作为默认（`setTemplate` 已置 `target`）

**测试场景**：正常（四 target 轮切核对语法）；边界（权重全 1.0 时各 target 正文一致无权重符）；异常（generic 回退 `(x:w)` 括号）。

**质量门禁**：`npm run typecheck` + preview 四 target 核对（引擎单测已覆盖序列化真值）。

---

### <a id="task-cmp-12"></a>[TASK-CMP-12] 负面提示词 target 适配

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-11
- **预估**：M

**目标**：实现 `docs/04` §5 的负面 target 适配——A1111/ComfyUI 独立负面字段、Midjourney 拼 `--no item1, item2`、Flux/SD3 隐藏负面 UI、gpt-image 无负面概念。当前仅原样渲染 `negativeBody`，无适配。

**涉及文件**：
- `src/features/composer/components/PreviewPanel.tsx`（修改：负面区按 target 形态渲染）
- `src/features/composer/store.ts`（`rerender` 负面产出按 target 变换：MJ 转 `--no`，Flux/openai 置空/隐藏）
- （可选）`src/features/composer/engine/serializer.ts` 或新增 `negative.ts`（负面 target 变换纯函数，便于单测）

**现状**：`store.rerender` 对 `negativeBody` 直接 `parse+render`，产出 `renderedNegative` 原样显示；`PreviewPanel` 有 `renderedNegative` 才显示负面区；**无 `--no`、无隐藏逻辑**。

**适配规则**：

| target | 负面处理 |
|--------|----------|
| a1111 / comfyui | 独立负面字段，正常渲染 |
| midjourney | 负面词转 `--no a, b, c` 追加到正文尾（或独立展示但标注拼接方式） |
| flux / sd3 | 隐藏负面 UI（这些模型弱依赖负面） |
| openai | 无负面概念，隐藏 |
| generic | 保留独立负面字段 |

**验收标准**：
- [x] a1111：负面独立区正常渲染
- [x] midjourney：负面转 `--no ...` 形式（正文尾或明确展示），Token 计入合理
- [x] flux/sd3/openai：负面区隐藏，不产生误导性空框
- [x] 切 target 时负面区形态即时切换（与 CMP-11 一致）
- [x] 负面变换逻辑若抽为纯函数，补单测覆盖四类 target

**测试场景**：正常（a1111 负面正常 / mj 出 `--no blurry, lowres`）；边界（negativeBody 为空时各 target 均不显示空负面框）；异常（负面含逗号/换行时 `--no` 拼接不产生双逗号）。

**质量门禁**：`npm run typecheck` + 负面变换单测（若抽纯函数）+ preview。

---

### <a id="task-cmp-13"></a>[TASK-CMP-13] 从预览面板直接生图（Composer → Generate）

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Composer
- **依赖**：TASK-CMP-10
- **预估**：M

**目标**：预览面板加「⚡生成图像」，用当前渲染正/负面 + 参数直接进 Generate 精修模式生图，无需先另存——补 `docs/01` §5.1 主路径的 Composer→Generate 直连。

**涉及文件**：
- `src/features/composer/components/PreviewPanel.tsx`（修改：加「⚡生成图像」按钮）
- `src/stores/app.ts`（`setView('generate'/'chat')` + 传参预填意图）
- 关联 [12-generation](12-generation-deep-dive.md)（Generate 精修入口接收预填正/负面/参数）

**IPC 契约**：生图本身走 `image:generate`（docs/07 §3.6），可带 `compositionId`（若已 saveComposition）写历史；本卡负责**把渲染结果 + 参数交给 Generate**，不直接在 Composer 内发起。

**交互与 UI/UX**：点「⚡生成图像」→ 若未配 active Provider，引导去 Settings；否则 `setView` 到 Generate 精修并预填正文/负面/参数（size/quality/n）。建议先静默 `saveComposition` 以便历史回溯 `compositionId`。

**验收标准**：
- [x] 预览面板有「⚡生成图像」入口，正/负面为空时禁用
- [x] 点击进入 Generate 精修，预填当前渲染正文、负面、参数
- [x] 未配 Provider 时引导到 Settings（不静默失败）
- [x] 生成的历史记录可关联 `compositionId`（若已保存组合）
- [x] 快捷键 `Cmd/Ctrl+Enter` 在 Composer 触发生图（`docs/01` §6.3）

**测试场景**：正常（填槽→生图→Generate 预填正确）；边界（正文空时按钮禁用）；异常（无 Provider → 引导设置页）。

**质量门禁**：`npm run typecheck` + preview（生图链路依赖 Provider，preview 桥验证跳转与预填即可）。

---

### <a id="task-cmp-14"></a>[TASK-CMP-14] 「在画布打开」入口（Library → Composer 初始 body）

- **状态**：✅ 已完成
- **优先级**：P2 · 🆕
- **所属大功能**：Composer
- **依赖**：TASK-CMP-02, TASK-CMP-03
- **预估**：M

**目标**：从 Library 详情「在画布打开」进入 Composer，以该 prompt 的 `content` 作为初始 body 二次组合，落地 `docs/01` §5.1 的 `Library→Composer` 流转。

**涉及文件**：
- `src/features/composer/store.ts`（`openWithBody(body, opts?)`：建临时模板或预填单槽/整段 body）
- `src/pages/ComposerPage.tsx`（修改：接收进入意图并初始化）
- `src/stores/app.ts`（跳转意图传递 `pendingComposerBody`）
- 关联 [10-library](10-library-deep-dive.md) TASK-LIB-09（详情面板「在画布打开」按钮）

**设计取舍**：prompt 是成品文本、非模板结构。两种落地策略（Opus 择一）：
1. **单槽临时模板**：body=`{{content}}`，把整段填入 `content` 槽，用户可继续拆分。
2. **整段可编辑正文**：进画布即以纯文本模式载入，提供「拆解为槽位」动作。
推荐策略 1（复用现有槽位/渲染管线，最小改动）。

**验收标准**：
- [x] Library 详情「在画布打开」→ 切到 Composer，正文预填为该 prompt content
- [x] 预填后可正常调权重/切 target/再另存（形成新 Prompt，不覆盖原 prompt）
- [x] 若 Composer 未就绪该能力，Library 侧按钮灰显 + tooltip（与 TASK-LIB-09 约定一致）
- [x] 进入后 target 默认取 prompt 关联模型或 generic

**测试场景**：正常（库中一条 → 在画布打开 → 调权重 → 另存为新条目）；边界（超长正文预填不卡）；异常（prompt 无 content 时给空画布不崩）。

**质量门禁**：`npm run typecheck` + preview 验证 Library→Composer 预填。

---
## 6. 依赖关系图

```
CMP-02(store) ─┬─→ CMP-03(模板管理 UI) ──┐
               │                          ├─→ CMP-14(在画布打开)
               ├─→ CMP-04(另存→跳库高亮)  ┘        └─关联→ 10-library (LIB-09)
               ├─→ CMP-08(槽位 replace/append/拖出)
               ├─→ CMP-09(权重滑块增强) ─┐
               ├─→ CMP-10(参数面板) ─────┼─→ CMP-11(target 实时序列化) ─→ CMP-12(负面适配)
               │                          └─→ CMP-13(预览直接生图) ─关联→ 12-generation
               ├─→ CMP-06(库树/fuse/收藏) ─→ CMP-07(片段管理)
               └───────────────────────────↑
CMP-01(模板 seed + 空态) ─(用 store.seed)──┘   ← 与 CMP-03 共同解「首启不可用」
CMP-05(扩充内置片段) ─→ CMP-06

差异化（本文占位，规格见 15）：AST 点击反查高亮 —— 消费 renderer 已产出的 segments.sourceSlot
```

**关键路径（P0 最小可用闭环）**：`CMP-02 → CMP-01 + CMP-03`（首启有可用模板）`→ CMP-04`（产物能沉淀进库）。四张 P0 卡完成即达成「新用户能在 Composer 造词并存入库」。

---

## 7. 大功能验收（对照 docs/04 §9 + 本设计扩展）

**引擎层（docs/04 §9 原始项，现状 ✅ 已达标，回归保持）**
- [x] 插值引擎单测覆盖全部 6 种语法（parser/renderer 单测已绿）
- [x] 权重序列化 a1111/mj/flux/openai 四 target 输出正确（serializer 单测已绿）
- [x] Token 计数随正文变化更新，颜色阈值正确（0-75 绿 / 75-150 黄 / >150 红，代码已核对一致）

**产品闭环层（本设计推进项）**
- [x] 首启即有 ≥3 个默认模板，画布不空转（CMP-01）
- [x] 模板可新建/编辑/删除，正文解析槽位（CMP-03）
- [x] Fragment 拖到 slot，预览实时更新；replace/append/拖出齐全（CMP-06/08）
- [x] 权重滑块拖动，预览文本按 target 实时反映权重（CMP-09/11）
- [x] 内置片段 ≥80，八类齐全（补 subject/camera）（CMP-05）
- [x] target 切换整体重序列化 + 参数面板换字段（CMP-10/11）
- [x] 负面提示词 target 适配（A1111 字段 / MJ `--no` / Flux 隐藏 / gpt-image 无）（CMP-12）
- [x] 「另存为 Prompt」：Library 出现新条目，`source='composition'`、`composition_id` 正确，**跳转并高亮**（CMP-04）
- [x] 从预览可直接生图（Composer→Generate）（CMP-13）
- [x] 「在画布打开」：Library prompt → Composer 初始 body（CMP-14）

**差异化（规格见 [15-differentiators](15-differentiators-deep-dive.md)）**
- [x] AST 点击反查：点预览词高亮来源 slot（`RenderResult.segments.sourceSlot` 已具备数据，UI 已产品化）→ 见 15

> **达标定义**：P0 四卡（CMP-01/02/03/04）完成 = Composer 从「能看不能用」升级为「首启可造词、产物可沉淀」；P1 全绿 = 达到 `docs/04` §9 完整验收 + 多 target/负面适配可见；差异化 AST 反查作为 V1 护城河单列 [15](15-differentiators-deep-dive.md)。
