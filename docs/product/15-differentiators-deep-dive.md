# 15 · 差异化壁垒 Differentiators —— Deep Dive

> **大功能定位**：**V1 竞争护城河**。这里的每个小功能都对应 [01-vision-and-ia](01-vision-and-ia.md) §4 的一条护城河——它们不是「更好用」，而是「竞品做不到 / 没做」。
> **诚实前置**：本文全部为 **P2**，位于 MVP 之后。先保证「配 Key→生图→管理→导出」主链路，再按本文 ROI 顺序扩展。
> 引用：`docs/04-composition-engine.md`（AST/segments、权重序列化）、`docs/02`（schema）、`docs/07`（IPC 契约）、原始调研 `生图提示词管理App_调研与设计建议.md` §2.3/§4.5/§5.4。

> **任务卡状态回写**：2026-08-05 · 基于源码实读、DIF-01/DIF-02 Composer 回归、DIF-05 分享专项与 DIF-06 Library/Settings 回归 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为提示词工程玩家，我预览里看到 `(dramatic lighting:1.3)`，想**点它一下就知道这段来自哪个 slot / Fragment**，而不是回头对着模板猜。
- 作为多模型用户，我同一份配方要投喂 A1111、MJ、Flux，想**一键切 target 看输出怎么变**，并「复制为 MJ 格式」直接粘走。
- 作为追求可复现的玩家，我改废了一版想**退回昨天那版**，还想看**两版差在哪几个词**。
- 作为批量生产者，我想给「风格」slot 放 3 个候选、「光照」放 2 个，**自动排列出 6 种组合一次性生图**（MJ permutation 的心智）。
- 作为社区活跃用户，我想把「这条 prompt + 出图 + 参数」**做成一张分享卡片发群里**，对方点一下就能导进他的 App——但我不想为此上传到任何服务器。
- 作为老用户，我把常用的「Flux + 壁纸 + 4 星以上」筛选**存成一个智能集合**，一键就能打开。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 我们的差异 |
|----------|------|-----------|
| PromptBox/AIPRM：纯文本变量，无来源追溯 | 变量心智 | **AST segments 反查**：渲染保留来源 slot，点词高亮出处（独家） |
| 各家「切模型靠手改语法」 | —— | **target 感知序列化**：同一 Composition 一键切 7 种语法（独家，引擎已就绪） |
| Git / 手工另存 N 个版本 | 版本心智 | **事件日志 + 快照 + 文本 diff**，非 Git，对预览图友好 |
| Midjourney permutation `{a,b,c}` | 排列语法 | 落到 GUI：多候选 slot → 笛卡尔积 → 批量生图网格 |
| 云端分享靠账号/服务器 | 分享心智 | **P2P：PNG 卡片 + `promptforge://` deeplink**，零后端，契合买断 |
| Eagle 智能文件夹 | 保存筛选 | 智能集合复用 Library 现成 list 查询，近乎零边际成本 |

**结论**：差异化 = **「组合引擎的中间表示（AST/segments/多 target）产品化」+ 「本地优先的 P2P 分享与版本」**。前者是引擎已经算出来、只差 UI 暴露的「白捡分」；后者是与买断定价强绑定的结构性优势。

---

## 2. 现状对照（设计 vs 实现）

> 依据历史 P2 清单与实际代码核查。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增

| 差异化点 | 设计要求 | 现状（核查证据） | 引擎/依赖就绪度 |
|----------|----------|-----------------|----------------|
| **AST 点击反查高亮** | 点预览词 → 高亮来源 slot/Fragment | ✅ 已完成。`store.rerender()` 保留 positive/negative segments 与高亮状态；`PreviewPanel` 按最终文本中的 segment 渲染可点段、来源浮层与复制动作；`CompositionCanvas` slot 卡片响应反向高亮、滚动可见和空输出提示 | 🟢 引擎 100% 就绪，UI 已接线 |
| **多 target 序列化产品化** | 一键切 target + 并排对比 + 复制为 X | ✅ 已完成。`PreviewPanel` 暴露 7 target 自绘切换器、并排对比、差异高亮和复制为目标语法；`store.renderForTarget(target)` 可纯渲染任意 target，不改当前画布状态；MJ/Flux/SD3/OpenAI 的负面词与权重呈现按 target 收敛 | 🟢 引擎就绪，UI 已接线 |
| **版本管理 + diff** | 事件日志 + 快照 + 文本 diff + 分叉树 | ✅ 已完成。DB v7 新增 `composition_events` / `composition_snapshots`；`versionsRepo` + IPC + `VersionDrawer` 支持事件、快照、diff、恢复、分叉；导入导出/重置/删除已联动 | 🟢 diff 库已启用，UI/IPC/DB 已接线 |
| **排列组合 permutation** | 多候选 slot → 笛卡尔积 → 批量生图 | ✅ 已完成。`engine/permutation.ts` 提供纯笛卡尔积与组合数摘要；`CompositionCanvas` slot 支持添加/删除候选；`PreviewPanel` 接入 `PermutationGrid`，可勾选组合、>24 二次确认、逐条 `image:generate`、每组 Composition 快照与 History 独立落库、失败格单独重试 | 🟢 引擎 render + 生成队列 + History 已接线 |
| **分享卡片 + deeplink** | prompt+图+参数 → PNG，`promptforge://` 导入 | ✅ 已完成。新增 `shared/share.ts` 白名单 payload 与 base64 往返；`electron/main/ipc/share.ts` 离屏渲染 PNG 并生成 deeplink；`share-protocol.ts` 注册协议与 open-url/second-instance 队列；Library 详情页可分享，App 全局导入确认弹窗确认后才入库 | 🟢 IPC/协议/UI 已接线 |
| **智能集合 + 搜索历史** | 存筛选条件一键打开；最近 10 搜索 | ✅ 已完成。DB v6 新增 `smart_sets`/`search_history`，Library 侧栏可保存/套用集合、显示实时命中数、回放/清空最近搜索；导入导出/重置已同步 | 🟢 复用 Library `list` 查询，边际成本低 |
| **Fragment 智能元数据** | 兼容标记/推荐权重/冲突/同义词/多语 | ✅ 已完成。DB v8 新增 `weight_min`/`weight_max`/`conflicts`/`synonyms`/`i18n`；仓储、导入导出、左栏搜索、Fragment 编辑器和画布软提示已接通 | 🟢 schema、校验、UI 与回归已接线 |
| **多 Provider / 垫图 / ComfyUI 导出 / 区域词** | V2+ 展望 | 🔴 全未实现，本文仅列路线图 | ⚪ V2+，不派工 |

**一句话**：**差异化 V1 已完整兑现到产品层**。AST 反查已把 segments 暴露成可感知的双向高亮，多 target 序列化也已变成可切换、可对比、可复制的产品能力；智能集合与搜索历史补齐了 Library 的高频复用入口；版本管理 + diff、排列组合、分享卡片 + deeplink 与 Fragment 智能元数据均已完成。

---

## 3. 小功能拆解

### 3.1 ROI 排序表（投入产出 × 引擎就绪度）

> 按 **ROI 降序**排列即建议开发顺序。产出 = 差异化强度 × 用户可感知度；投入含 UI+IPC+DB+测试。

| 序 | 差异化点 | 投入 | 产出（差异化强度） | 引擎/依赖就绪度 | ROI | 任务卡 |
|----|----------|------|-------------------|----------------|-----|--------|
| 🥇 | **AST 点击反查高亮** | S–M | 🥈护城河 · 极高可感知 | 🟢 引擎已产出 segments | **最高** | [TASK-DIF-01](#task-dif-01) |
| 🥈 | **多 target 序列化产品化** | M | 🥇护城河 · 独家卖点 | 🟢 序列化已就绪+单测 | **很高** | [TASK-DIF-02](#task-dif-02) |
| 🥉 | **智能集合 + 搜索历史** | M | 中 · 提效留存 | 🟢 复用 list 查询 | **高** | [TASK-DIF-06](#task-dif-06) |
| 4 | **版本管理 + diff** | L | 高 · P2 玩家刚需 | 🟢 已完成 | 中高 | [TASK-DIF-03](#task-dif-03) |
| 5 | **分享卡片 + deeplink** | L | 高 · 增长/传播 | 🟢 已完成 | 中 | [TASK-DIF-05](#task-dif-05) |
| 6 | **排列组合 permutation** | L | 中高 · 批量生产 | 🟢 已完成 | 中 | [TASK-DIF-04](#task-dif-04) |
| 7 | **Fragment 智能元数据** | M–L | 中 · 专业度 | 🟢 已完成 | 中低 | [TASK-DIF-07](#task-dif-07) |
| — | V2+（多 Provider/垫图/Comfy 导出/区域词） | XL | 视需求 | ⚪ 未就绪 | 后置 | §8 路线图 |

### 3.2 小功能索引

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | AST 点击反查高亮（预览词 ↔ slot/Fragment 双向） | P2 | [TASK-DIF-01](#task-dif-01) |
| 2 | 多 target 序列化产品化（切换器 + 并排对比 + 一键复制为 X） | P2 | [TASK-DIF-02](#task-dif-02) |
| 3 | 版本管理 + diff（事件日志 + 快照 + 文本 diff + 分叉树） | P2 | [TASK-DIF-03](#task-dif-03) |
| 4 | 排列组合 permutation（多候选 slot → 笛卡尔积 → 批量生图） | P2 | [TASK-DIF-04](#task-dif-04) |
| 5 | 分享卡片 + deeplink（PNG 渲染 + `promptforge://` 导入） | P2 | [TASK-DIF-05](#task-dif-05) |
| 6 | 智能集合 + 搜索历史（保存筛选 + 最近 10 搜索） | P2 | [TASK-DIF-06](#task-dif-06) |
| 7 | Fragment 智能元数据（兼容/权重区间/冲突/同义词/多语） | P2 | [TASK-DIF-07](#task-dif-07) |

---

## 4. UI/UX 设计

### 4.1 AST 点击反查高亮（TASK-DIF-01）

引擎已把渲染结果拆成 `segments: { text, weight, sourceSlot }[]`。UI 只需把预览区从「一整块 `<pre>` 字符串」改为「按 segment 渲染的可点 `<span>` 序列」，即可实现双向反查。

```
┌ 中栏：组合画布 ────────────┬ 右栏：实时预览（segment 渲染） ─────────┐
│ Template: 通用写实 ▾       │ 正面提示词            142 tokens ▁▁▁▂ │
│ ┌ slots ─────────────┐   │ ┌───────────────────────────────────┐ │
│ │ subject  [a young…] │◄──┼─│ a young woman, ⟦cinematic⟧,        │ │
│ │ style    [cinema…] ★│   │ │ (dramatic lighting:1.3), 8k,      │ │
│ │ lighting [dramat…] ⚖│   │ │  sharp focus                       │ │
│ │ quality  [8k,shar…] │   │ └───────────────────────────────────┘ │
│ └─────────────────────┘   │  ▲ 点击「dramatic lighting」段        │
│                            │  → 该段描边高亮(accent)               │
│  ← style slot 卡片同步     │  → 中栏 lighting slot 高亮回跳        │
│    亮起 accent 边框         │  → 悬浮小卡：来源 slot=lighting        │
│                            │       Fragment「dramatic lighting」    │
│                            │       权重 1.3 · 复制此段              │
└────────────────────────────┴────────────────────────────────────────┘
        双向：点 slot 卡 → 预览里它贡献的段落一起高亮
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| hover 预览某段 | 该段底色微亮 `bg-elevated`；`sourceSlot != null` 的段显示手型光标 |
| 单击预览某段 | 段落描边 accent；中栏对应 slot 卡高亮 + `scrollIntoView`；弹来源浮层（slot key / Fragment 名 / 权重 / 复制此段） |
| 单击 slot 卡 | 反向：预览中所有 `sourceSlot===该slot` 的段一起高亮 |
| 点纯文本段（无 sourceSlot，如分隔符/模板固定文字） | 不可点、不高亮（光标默认） |
| 权重 ≠ 1 的段 | 段尾附小徽标 `⚖1.3`（可选，低调显示） |
| 再次点击 / 点空白 / Esc | 清除高亮 |
| 空预览 | 显示「（空）」占位，无可点段 |
| target=flux/openai（自然语言序列化） | 段仍可反查（segment 结构与 target 无关，`serializeWeight` 只改文本） |

**关键实现锚点**：`store.rerender()` 目前 `set({ renderedPositive: r.text })` 丢了 `r.segments`；改为同时存 `positiveSegments: r.segments`、`negativeSegments`，`PreviewPanel` 消费之。**无需改引擎**。

### 4.2 多 target 序列化产品化（TASK-DIF-02）

```
┌ 右栏：预览 · target 呈现 ───────────────────────────────┐
│ 输出目标：[A1111 ●][ComfyUI][MJ][Flux][SD3][gpt-image]  │  ← 分段切换器
│ ┌─ 并排对比（点「⇄ 对比」展开）──────────────────────┐  │
│ │ A1111            │ Midjourney                      │  │
│ │ (dramatic        │ dramatic lighting::13           │  │
│ │  lighting:1.3),  │ 8k, sharp focus                 │  │
│ │ 8k, sharp focus  │ --no blurry                     │  │
│ │  [📋 复制为A1111] │  [📋 复制为MJ]                   │  │
│ └──────────────────┴─────────────────────────────────┘  │
│  差异高亮：权重语法差异处以 accent 底色标出              │
│  [📋 复制正面] [📋 复制为当前 target] [复制负面]          │
└──────────────────────────────────────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| 切 target | `store.setTarget(t)` → 重渲染；权重语法即时变化（`(w:1.3)`→`::13`→`very …`） |
| 「⇄ 对比」 | 展开双列，左=当前 target，右=可选第二 target，逐段对齐 |
| 复制为 X | 用目标 target 重渲染一次并写剪贴板；toast「已复制为 MJ 格式」；若来源是 Prompt 则 `usage_count++` |
| target 无权重概念（openai） | 隐藏权重徽标；提示「gpt-image 用自然语言，权重已并入描述」 |
| target=MJ 且有负面 | 负面渲染为 `--no a, b`（见 docs/04 §5）；对比列同步 |
| target=flux/sd3 | 负面 UI 隐藏；提示「Flux 通常不需负面」 |
| 参数不适配（如 MJ 的 `--ar`） | 超出本卡范围，落 [12-generation](12-generation-deep-dive.md) 参数面板 |

### 4.3 版本管理 + diff（TASK-DIF-03）

```
┌ 版本抽屉（Composer/Prompt 详情内「版本」入口）──────────────┐
│ 版本树（父子指针，非 Git）          │ Diff：v3 ⇄ v5           │
│  ● v1 初稿          10:02          │ ┌─────────────────────┐ │
│  └● v2 加光照       10:15          │ │ a young woman,       │ │
│    ├● v3 (当前分支)  10:31 ★       │ │- cinematic          │ │  ← 删除(红)
│    │  └● v5 调权重   11:04 ◀选中    │ │+ dramatic lighting  │ │  ← 新增(绿)
│    └● v4 换风格(分叉) 10:52         │ │  (…:1.3), 8k        │ │
│  [＋ 手动快照] [从此版本分叉]        │ └─────────────────────┘ │
│  自动：每 50 事件打一次快照          │  diff-match-patch 逐词   │
└──────────────────────────────────────┴──────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| 编辑动作 | 追加事件到 event log（append-only）：`SlotFilled`/`WeightChanged`/`ParamChanged`/`TextEdited` |
| 满 50 事件 or 手动保存 | 打快照（存渲染正/负 + slotFills + params + 可选预览图 + 备注） |
| 选两个版本 | 右侧 diff-match-patch 逐词对比，删红增绿 |
| 「恢复到此版本」 | 以该快照重建当前编辑态（不删后续版本，新开一条事件 `Reverted`） |
| 「从此版本分叉」 | 新建子节点，`parent_id` 指向源，形成树 |
| 版本无预览图 | 树节点显示文字占位，不报错 |
| 事件流为空（新建未编辑） | 版本树仅 1 个「初稿」占位 |

### 4.4 排列组合 permutation（TASK-DIF-04）

```
┌ 中栏：slot 多候选 ─────────┬ 排列预览网格 ─────────────────┐
│ subject  [a young woman]  │ 组合数：style×lighting = 3×2 = 6│
│ style   [＋候选]          │ ┌────┬────┬────┐               │
│  ├ cinematic      ✕       │ │ #1 │ #2 │ #3 │  每格：       │
│  ├ oil painting   ✕       │ ├────┼────┼────┤  渲染文本预览 │
│  └ watercolor     ✕       │ │ #4 │ #5 │ #6 │  + [生成]勾选  │
│ lighting[＋候选]          │ └────┴────┴────┘               │
│  ├ dramatic       ✕       │ [全选] 已选 6/6                │
│  └ soft natural   ✕       │ [⚡ 批量生成 6 张] 预估 $0.24   │
└────────────────────────────┴────────────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| slot 加多候选 | slot 从单值升级为候选数组；其余单值 slot 不变 |
| 实时组合数 | = 各多候选 slot 候选数的笛卡尔积；顶部显示 `A×B=N` |
| 组合数超阈值（如 >24） | 警示「N 张将产生约 $X」，要求二次确认，防误触烧钱 |
| 网格单元 | 显示该组合渲染文本；默认勾选，可单独取消 |
| 批量生成 | 逐条走 `image:generate`，共用取消；每条独立写 history（见 [12-generation](12-generation-deep-dive.md)） |
| 无多候选 slot | 退化为 1 组，等同普通单次生成 |
| 生成中失败某张 | 该格标红可单独重试，不阻断其余 |

### 4.5 分享卡片 + deeplink（TASK-DIF-05）

```
┌ 分享卡片（离屏渲染 → PNG）────────┐   导入侧：
│ ┌───────────────────────────────┐ │   用户双击 .png 无法导入（仅图）
│ │      [ 预览图 512×512 ]        │ │   → 卡片附带 promptforge:// 链接
│ │                               │ │     或「复制 deeplink」按钮
│ ├───────────────────────────────┤ │
│ │ 电影感人像 · 日系             │ │   promptforge://import?data=<base64>
│ │ cinematic portrait, soft…     │ │        │ 系统调起 App
│ │ #二次元 #Flux                  │ │        ▼
│ │ Flux · 1024×1024 · seed 42    │ │   ┌ 导入确认 ──────────────┐
│ │ ── forged with PromptForge ── │ │   │ 将导入 1 条提示词        │
│ └───────────────────────────────┘ │   │ 标题/正文/参数预览       │
│ [💾 保存 PNG] [🔗 复制 deeplink]   │   │ [导入到 Library] [取消]  │
└────────────────────────────────────┘   └──────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| 「分享」 | 离屏渲染卡片 DOM → PNG 写盘/剪贴板；同时生成 `promptforge://import?data=<base64(JSON)>` |
| deeplink 内容 | 精简 JSON：title/content/negative/params/target（**不含**预览图二进制，控制体积；图仅在 PNG 里） |
| 收方点击 deeplink | OS 唤起 App（`app.setAsDefaultProtocolClient`）→ 解析 → **导入确认弹窗**（预览后再入库，防恶意/脏数据） |
| data 超长 / 解析失败 | 拒绝导入 + 提示「链接无效或已损坏」，不写库 |
| 无预览图的 prompt | 卡片用文字版式（无图占位），deeplink 照常 |
| 隐私 | 纯本地：无任何网络请求；卡片不含 Key/路径等敏感信息（见 [01](01-vision-and-ia.md) §7 产品原则 #1） |

**安全红线**：deeplink 是外部输入，**必须走导入确认 + 字段白名单校验**，绝不静默入库、绝不执行其中任何可执行内容。

### 4.6 智能集合 + 搜索历史（TASK-DIF-06）

```
┌ Library Sidebar 增区 ────────┐
│ ⭐ 智能集合                    │   保存当前筛选：
│  ├ Flux壁纸4★+     (23)       │   Library 筛选栏「💾 存为集合」
│  ├ 最近用过         (10)       │   → 命名 → 存 filters JSON
│  └ 未分类待整理     (7)        │
│ 🕘 最近搜索                    │   点集合 = 一键套用该筛选
│  赛博朋克 · 头像 · portrait…  │   点历史词 = 回填搜索框重搜
│  [清空历史]                    │
└────────────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| 存为集合 | 序列化当前 `{search, tagIds, filters, sort}` 为 JSON 存 `smart_sets` |
| 点击集合 | 套用其筛选到 Library store，列表即时收敛；集合旁显示实时命中数 |
| 每次搜索 | 去重后写入 `search_history`，保留最近 10 条（超出淘汰最旧） |
| 点历史词 | 回填搜索框并触发搜索 |
| 集合引用的标签被删 | 该条件自动失效并从集合剔除（与 [10-library](10-library-deep-dive.md) TASK-LIB-11 一致） |
| 空态 | 无集合时区块隐藏；无历史时「暂无搜索记录」 |

> 复用 [10-library](10-library-deep-dive.md) 现成的 `db:prompts:list`（已支持 `search/tagIds/filters/sort`），智能集合本质是「存一份 list 查询参数」，故 ROI 高、投入低。

### 4.7 Fragment 智能元数据（TASK-DIF-07）

```
┌ Fragment 编辑/检视（Composer 左栏）──────────┐
│ dramatic lighting                            │
│ 类型 lighting · 分类 lighting/dramatic       │
│ 推荐权重  [1.1 ─●───── 1.5]  当前 1.3 ✓在区间 │
│ 兼容模型  [SDXL][Flux] ⚠ 不建议用于 gpt-image │
│ 冲突      ⚠ 与「soft natural light」语义冲突   │
│ 同义词    dramatic light, moody lighting     │
│ 多语      戏剧化光照 / ドラマチックな照明      │
└──────────────────────────────────────────────┘
```

**交互与状态表**

| 场景 | 行为 |
|------|------|
| 权重超推荐区间 | slot 权重滑块外显黄色提示「超出推荐 1.1–1.5」，不强制 |
| target 与 `compatible_models` 不符 | Fragment 卡显 ⚠ 徽标 + tooltip（软提示，不禁用） |
| 同 slot 填入互斥 Fragment | 冲突提示（基于 `conflicts` 元数据），可忽略 |
| 搜索 Fragment | 命中同义词也返回（如搜「moody」命中 dramatic lighting） |
| 多语显示 | 按应用语言显示译名，正文仍用原文（生图用英文） |
| 元数据缺失（老 Fragment） | 优雅降级：不显示对应区块，不报错 |

---

## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。全部 P2，位于主链路（Phase A–D）之后，按 §3.1 ROI 顺序认领。**引擎/契约层不偏离** `docs/04`、`docs/07`。

### <a id="task-dif-01"></a>[TASK-DIF-01] AST 点击反查高亮 🥇

- **状态**：✅ 已完成（2026-08-05：Composer 预览 segment ↔ slot 双向高亮、来源浮层、权重徽标、空输出提示、Esc/空白清除已接通）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：无（引擎 `render()` 已返回 segments；Composer 三栏 UI 已存在）
- **预估**：M

**目标**：预览区按 segment 渲染为可点元素，点预览词 → 高亮来源 slot 并回跳中栏 slot 卡；点 slot 卡 → 高亮其贡献的所有预览段。把「引擎已算好的 segments」暴露成可感知的差异化交互。

**完成记录**：`store.rerender()` 现在同时保留 `positiveSegments` / `negativeSegments`，并新增 `highlightedSlot` 与来源段状态。`PreviewPanel` 不再把 prompt 当作整块纯字符串展示，而是用最终归一化文本匹配 source segments，确保显示文本仍等于 `renderedPositive/Negative`；有来源的段可点击、hover、显示权重徽标与来源浮层，复制只复制该段。`CompositionCanvas` slot 卡支持反向点击，高亮对应预览段并滚动可见；空可选槽点击时给「该 slot 当前无输出」提示。该功能纯渲染进程内完成，无 IPC/DB 迁移。

**涉及文件**：
- `src/features/composer/store.ts`（`rerender()` 保留 `r.segments` → 新增 state `positiveSegments`/`negativeSegments`；新增 `highlightedSlot` / `highlightedPreviewSegment`）
- `src/features/composer/components/PreviewPanel.tsx`（按最终文本中的 segment 渲染可点段、来源浮层、复制此段和 Esc/空白清除）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：slot 卡响应 `highlightedSlot` 高亮 + `scrollIntoView`；点 slot 卡回写 `highlightedSlot`）
- `src/styles/globals.css`（权重徽标用 `::after` 呈现，避免污染 prompt `innerText`）
- `tests/e2e/test_03_composer.py`（新增 DIF-01 双向反查验收）
- `src/features/composer/engine/types.ts`（**无需改**，`RenderSegment.sourceSlot` 已存在）
- `src/features/composer/engine/renderer.ts`（**无需改**，`render()` 已产出 segments）

**IPC 契约**：**无**（纯渲染进程内交互，不跨进程）。

**交互与 UI/UX**：见 §4.1。双向高亮 + 悬浮来源浮层（slot key / Fragment 名 / 权重 / 复制此段）；纯文本段不可点；Esc/点空白清除。

**验收标准**：
- [x] `store.rerender()` 同时产出 `positiveSegments`/`negativeSegments`，与 `renderedPositive/Negative` 文本一致（`segments.map(s=>s.text).join('')` normalize 后 === 文本）
- [x] 预览中 `sourceSlot != null` 的段可点、hover 有手型光标；纯文本段不可点
- [x] 点预览段 → 中栏对应 slot 卡高亮 accent + 滚动可见 + 弹来源浮层
- [x] 点 slot 卡 → 预览中该 slot 的所有段一起高亮（双向）
- [x] 权重 ≠ 1 的段显示权重徽标（如 `⚖1.3`）
- [x] 切 target 到 flux/openai（自然语言序列化）后，反查仍准确
- [x] Esc / 点空白清除全部高亮

**测试场景**：
1. 正常：填 subject+style+lighting，点预览「dramatic lighting」→ lighting slot 卡亮 + 浮层显示权重 1.3。
2. 边界：点分隔符「, 」等纯文本段 → 无高亮无浮层；空预览 → 无可点段不报错。
3. 异常：某 slot 渲染为空（条件 slot 未填）→ 点其 slot 卡时预览无对应段，给「该 slot 当前无输出」提示而非报错。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npx vitest run src/features/composer/engine/__tests__/engine.test.ts`：21 passed
- [x] `tests/e2e/test_03_composer.py::test_preview_segments_highlight_slots_bidirectionally`：1 passed
- [x] Composer 五文件回归：68 passed
- [x] `tests/e2e/test_04_generate.py::test_composer_send_to_workbench_persists_composition_and_selects_provider_target`：1 passed，确认权重徽标不污染 prompt 文本
- [x] `npm run check`：30 Vitest 文件 / 216 passed + build 通过

---

### <a id="task-dif-02"></a>[TASK-DIF-02] 多 target 序列化产品化 🥈

- **状态**：✅ 已完成（2026-08-05；7 target 切换、并排对比、一键复制、Library 来源 usage_count 已验收）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：无（`serializeWeight` 全 target 就绪 + 已单测；`store.setTarget` 已可切）
- **预估**：M

**目标**：把「引擎默默支持的多 target」变成可见卖点：分段 target 切换器 + 并排 diff 对比 + 「复制为 A1111/MJ/Flux…」一键。呼应 [01](01-vision-and-ia.md) §4 头号护城河。

**涉及文件**：
- `src/features/composer/components/PreviewPanel.tsx`（修改：target 切换器 + 对比双列 + 复制按钮组）
- `src/features/composer/store.ts`（新增：`renderForTarget(target)` 纯函数封装——用现有 `parse`+`render` 对任意 target 重渲染，不改 `activeTemplateId/target`）
- `src/stores/app.ts`、`src/pages/ComposerPage.tsx`、`src/features/library/components/PromptDetail.tsx`（修改：Library 来源 prompt 带 `sourcePromptId` 进入临时画布，复制后可累计 usage_count）
- `src/features/composer/engine/serializer.ts`（**无需改**，7 target 已覆盖）
- `tests/e2e/test_03_composer.py`（新增：多 target 切换/对比/复制、Library usage_count、空画布禁用复制）

**IPC 契约**：**无**（渲染进程内；复制走浏览器剪贴板 API）。若来源是 Library Prompt 的「复制正文」，复用既有 `db:prompts:incrementUsage`（docs/07 §3.1）。

**交互与 UI/UX**：见 §4.2。切换器 7 target；「⇄ 对比」展开双列逐段对齐、权重语法差异 accent 标注；复制 toast 反馈；openai 隐藏权重、flux/sd3 隐藏负面。

**验收标准**：
- [x] 切换器覆盖 7 个 target（a1111/comfyui/midjourney/flux/sd3/openai/generic），切换即时重渲染
- [x] 权重语法随 target 正确变化：`(w:1.30)` / `w::13` / `very w` / 原文（openai）
- [x] 「复制为 X」写入剪贴板为 X 语法（与当前显示 target 可不同），toast 确认
- [x] 「⇄ 对比」双列并排，差异处高亮
- [x] MJ target 负面渲染为 `--no a, b`；flux/sd3 负面 UI 隐藏
- [x] openai target 隐藏权重徽标并给自然语言说明

**测试场景**：
1. 正常：a1111 下 `(dramatic lighting:1.30)`，切 MJ → `dramatic lighting::13`，切 flux → `very dramatic lighting`。
2. 边界：权重=1.0 的段所有 target 都输出原文（`serializeWeight` 早返回）。
3. 异常：无激活模板时切 target → 预览空、复制按钮禁用，不报错。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npx vitest run src/features/composer/engine/__tests__/engine.test.ts`：21 passed
- [x] `tests/e2e/test_03_composer.py::test_multi_target_switch_compare_and_copy_formats`：1 passed，覆盖 7 target、MJ `--no`、Flux/OpenAI 差异和复制格式
- [x] `tests/e2e/test_03_composer.py::test_copy_as_target_from_library_canvas_increments_prompt_usage`：1 passed，覆盖 Library 来源复制累计 `usage_count`
- [x] `tests/e2e/test_03_composer.py::test_multi_target_empty_canvas_disables_copy_without_errors`：1 passed，覆盖无模板切 target、禁用复制和无 console error
- [x] Composer 五文件回归：70 passed
- [x] `npm run check`：30 Vitest 文件 / 216 passed + build 通过
- [x] Playwright 视觉检查：桌面截图 `/tmp/promptforge-dif02-preview.png`；940×740 检查 `rootOverflow=0`、`panelOverflow=0`、`pageOverflow=0`

---

### <a id="task-dif-03"></a>[TASK-DIF-03] 版本管理 + diff

- **状态**：✅ 已完成（2026-08-05：事件日志 + 快照树 + 逐词 diff + 恢复/分叉 + 导出导入/重置联动已接通）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：无（`diff-match-patch` 已在 package.json，本卡首次启用）
- **预估**：L

**目标**：为 Composition（及可选 Prompt）提供事件日志 + 快照的版本历史，diff-match-patch 逐词文本 diff，支持恢复与分叉树。非 Git，对预览图友好（原始调研 §4.5）。

**完成记录**：新增 `composition_events` / `composition_snapshots` 两张表，`composition_snapshots.event_count` 记录打快照时累计事件数；Composer store 在编辑动作后追加版本事件，并在保存/恢复/分叉时同步版本树。主进程 `db:versions:*` IPC 暴露 append/snapshot/list/get/diff/restore/fork，repository 用 `diff-match-patch` 做逐词 diff，事件超过 50 条自动补快照，恢复会写 `Reverted` 事件，分叉会保留 `parent_id`。删除 Composition、导入替换与重置都会级联清掉版本数据。Composer 侧新增版本抽屉，支持版本树、手动快照、对比、恢复与分叉；settings 的导入/导出/重置也同步了承载版本数据。

**涉及文件**：
- `electron/db/migrations/0007_versions.ts`（新建：`composition_events` + `composition_snapshots` 表）
- `electron/system/migrations.ts`（修改：注册 DB v7）
- `electron/db/schema.ts`（修改：补版本表创建）
- `electron/db/repositories/versions.ts`（新建：append 事件 / 打快照 / 列快照 / 取快照 / diff / 恢复 / 分叉）
- `electron/main/ipc/versions.ts`（新建 handler，`index.ts` 注册）
- `electron/main/ipc/index.ts`、`electron/preload/index.ts`（注册并暴露 `db:versions:*`）
- `electron/db/repositories/compositions.ts`（修改：删除 Composition 时清版本数据）
- `electron/system/export.ts`、`electron/system/import.ts`、`electron/system/reset.ts`（纳入版本导出/导入/重置）
- `shared/types/ipc.ts`（新增 `db:versions:*` 类型）· `shared/types/models.ts`（新增 `VersionEventType` / `CompositionSnapshot` / `VersionDiff`）
- `shared/types/diff-match-patch.d.ts`（新建：补齐类型声明）
- `src/features/composer/components/VersionDrawer.tsx`（新建：版本树 + diff 视图）
- `src/features/composer/components/PreviewPanel.tsx`（修改：版本抽屉入口）
- `src/features/composer/store.ts`（修改：编辑动作追加事件、快照触发、恢复/分叉 action）
- `src/features/settings/components/ExportDialog.tsx`、`ImportDialog.tsx`、`sections/DataSection.tsx`（修改：导入/导出/重置摘要与 versionCompositionId 清理）
- `tests/e2e/test_03f_versions.py`（新建：API + UI + 导入导出 + 删除清理验收）

**Schema（🆕，参照 docs/02 §2.3 风格）**：
```sql
CREATE TABLE composition_events (
  id TEXT PRIMARY KEY,
  composition_id TEXT NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,          -- Created|SlotFilled|WeightChanged|ParamChanged|TextEdited|Reverted
  payload TEXT,                -- JSON
  created_at INTEGER NOT NULL
);
CREATE TABLE composition_snapshots (
  id TEXT PRIMARY KEY,
  composition_id TEXT NOT NULL REFERENCES compositions(id) ON DELETE CASCADE,
  parent_id TEXT,              -- 分叉树父指针（NULL=根）
  rendered_positive TEXT, rendered_negative TEXT,
  slot_fills TEXT, params TEXT,
  preview_image TEXT, note TEXT,
  event_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_snap_comp ON composition_snapshots(composition_id);
```

**IPC 契约（🆕 `db:versions:*`）**：

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:versions:appendEvent` | `{ compositionId: string, type: VersionEventType, payload?: unknown }` | `{ ok: true, snapshotTaken: boolean }` |
| `db:versions:snapshot` | `{ compositionId: string, note?: string, parentId?: string }` | `Snapshot` |
| `db:versions:list` | `{ compositionId: string }` | `Snapshot[]`（含 parent_id / event_count 供构树与排序） |
| `db:versions:get` | `{ snapshotId: string }` | `Snapshot \| null` |
| `db:versions:diff` | `{ fromId: string, toId: string }` | `{ positive: DiffChunk[], negative: DiffChunk[] }` |
| `db:versions:restore` | `{ snapshotId: string }` | `{ composition: Composition }` |
| `db:versions:fork` | `{ snapshotId: string, note?: string }` | `Snapshot` |

```ts
type VersionEventType = 'Created'|'SlotFilled'|'WeightChanged'|'ParamChanged'|'TextEdited'|'Reverted';
interface DiffChunk { op: -1|0|1; text: string; } // diff-match-patch: -1 删除 / 0 相同 / 1 新增
```
错误：`SNAPSHOT_NOT_FOUND` / `INVALID_PARAMS`（reject `IpcError`，见 docs/07 §2）。

**交互与 UI/UX**：见 §4.3。自动每 50 事件打快照；手动「＋快照」；选两版逐词 diff（增绿删红）；恢复不删后续、追加 `Reverted` 事件；分叉写 `parent_id`。版本抽屉还支持当前组合的快照备注、图标预览和历史选择保留。

**验收标准**：
- [x] 编辑动作正确 append 事件，满 50 或手动触发打快照
- [x] 版本树按 `parent_id` 正确渲染父子/分叉结构
- [x] 选两版调 `db:versions:diff`，diff-match-patch 逐词增删渲染正确
- [x] 「恢复到此版本」重建编辑态、原后续版本保留、新增 `Reverted` 事件
- [x] 「从此版本分叉」新节点 `parent_id` 指向源
- [x] 无预览图的快照优雅占位不报错
- [x] 删除 Composition 时其事件/快照级联清除（`ON DELETE CASCADE`）

**测试场景**：
1. 正常：连续改 3 个 slot → 手动快照 v2 → 再改 → diff(v1,v2) 显示新增词。
2. 边界：51 个事件确认自动快照恰好触发一次；空事件流仅「初稿」占位。
3. 异常：`diff` 传不存在 snapshotId → reject `SNAPSHOT_NOT_FOUND`，UI 提示不崩。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] versions repository 单测（append/snapshot/diff/restore/fork）
- [x] `tests/e2e/test_03f_versions.py`：5 passed，覆盖事件日志、自动快照、diff、恢复、分叉、导入导出与删除清理
- [x] `npm run check` 与全量 E2E（240 passed, 6 skipped）通过

---

### <a id="task-dif-04"></a>[TASK-DIF-04] 排列组合 permutation

- **状态**：✅ 已完成（2026-08-05：slot 多候选、笛卡尔积预览网格、>24 成本二次确认、逐条生图、每组合 Composition 快照与 History 独立落库、失败格重试/整体取消 UI 已接线）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：[12-generation](12-generation-deep-dive.md) 批量生图/取消能力（docs/12 §2 P0「取消生图」需先修）
- **预估**：L

**目标**：slot 支持多候选，笛卡尔积自动生成多个 Composition，批量生图并以网格呈现（MJ permutation 心智，原始调研 §2.2）。

**涉及文件**：
- `src/features/composer/engine/permutation.ts`（新建：纯函数 `expandPermutations(slots): SlotFills[]` 笛卡尔积，可独立单测）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：slot 支持「＋候选」多值）
- `src/features/composer/components/PermutationGrid.tsx`（新建：组合网格 + 勾选 + 批量生成）
- `src/features/composer/store.ts`（修改：多候选 slotFills、组合数计算、批量生成编排）

**IPC 契约**：复用现有 `image:generate`（docs/07 §3.6）逐条调用；**无新增通道**。批量生成在渲染进程编排（顺序/并发受限），共用取消 controller；每条独立写 history。

**交互与 UI/UX**：见 §4.4。实时组合数 = 笛卡尔积；超阈值（>24）二次确认防烧钱；网格每格显渲染文本 + 勾选；失败格单独重试。

**验收标准**：
- [x] slot 可加/删多候选，其余单值 slot 不受影响
- [x] 组合数 = 各多候选 slot 候选数乘积，实时显示 `A×B=N`
- [x] `expandPermutations` 输出恰好 N 个不重复 SlotFills（笛卡尔积正确）
- [x] 组合数超阈值弹二次确认 + 预估花费
- [x] 批量生成逐条走 `image:generate`，各自写 history，可整体取消
- [x] 单条失败不阻断其余，失败格可单独重试
- [x] 无多候选 slot 时退化为单次生成

**测试场景**：
1. 正常：style 3 候选 × lighting 2 候选 = 6 组，网格 6 格，批量生成 6 条 history。
2. 边界：全单值 → 1 组；某 slot 1 候选不参与相乘。
3. 异常：生成中途取消 → 已发的照常记录、未发的标 `cancelled`（依赖 §12-gen 取消修复）。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `expandPermutations` 笛卡尔积单测（含 0/1/多候选边界）通过（3/3）
- [x] preview 验证多候选 → 网格 → 批量生成通过（Electron E2E 2/2）

---

### <a id="task-dif-05"></a>[TASK-DIF-05] 分享卡片 + deeplink

- **状态**：✅ 已完成（2026-08-05：PNG 离屏卡片、deeplink 编解码、协议入口队列、导入确认弹窗与 Library 分享入口已接通）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：无（但建议在导入/导出 docs/12 §8 A5 之后，复用序列化逻辑）
- **预估**：L

**目标**：把 prompt + 预览图 + 参数渲染成 PNG 分享卡片，并生成 `promptforge://import?data=<base64>` deeplink，收方点击唤起 App 并**经确认后**导入。纯 P2P、零后端，契合买断（[01](01-vision-and-ia.md) §4/§7）。

**涉及文件**：
- `electron/main/ipc/share.ts`（新建：离屏 `BrowserWindow` 渲染卡片 → PNG；deeplink 编码/解码）
- `electron/main/share-protocol.ts`、`electron/main/application.ts`（新建/修改：`app.setAsDefaultProtocolClient('promptforge')` + `open-url`(mac)/`second-instance`(win) 处理 deeplink）
- `src/features/share/ShareCard.tsx`、`src/features/share/SharePromptDialog.tsx`（新建：分享预览与 Library 详情页分享弹窗）
- `src/features/share/ImportConfirmDialog.tsx`（新建：deeplink 导入确认弹窗）
- `shared/share.ts`、`shared/types/ipc.ts`（新增分享 payload 安全层与 `share:*` 类型）
- `electron/preload/index.ts`、`src/App.tsx`、`src/stores/app.ts`、`src/lib/test-hook.ts`（新增 preload API、全局弹窗挂载与 E2E 触发钩子）

**IPC 契约（🆕 `share:*`）**：

| 通道 | 请求 | 响应 |
|---|---|---|
| `share:renderCard` | `{ promptId?: string, payload?: SharePayload, savePath?: string }` | `{ pngPath: string, deeplink: string }` |
| `share:buildDeeplink` | `{ payload: SharePayload }` | `{ deeplink: string }` |
| `share:parseDeeplink` | `{ url: string }` | `{ payload: SharePayload }`（校验+白名单后） |
| `share:import` | `{ payload: SharePayload }` | `{ prompt: Prompt }` |

```ts
interface SharePayload {   // 白名单字段，绝不含 Key/本地路径/可执行内容
  title: string; content: string; contentNegative?: string;
  params?: Record<string, unknown>; target?: PromptTarget;
  previewDataUrl?: string;   // 仅卡片用，可选；deeplink 默认不带图以控体积
}
```
主进程推送已有 deeplink：渲染进程订阅 `share:incoming`（event，非 invoke）打开导入弹窗。
错误：`INVALID_DEEPLINK` / `PAYLOAD_TOO_LARGE`（reject `IpcError`）。

**交互与 UI/UX**：见 §4.5。卡片离屏渲染为 PNG；deeplink 精简 JSON（不含图二进制）；收方**必经导入确认**（预览后入库）；解析失败拒绝并提示。

**安全红线**：
- deeplink 是**外部不可信输入**：`share:parseDeeplink` 必做 base64/JSON 解析容错 + **字段白名单**（只留 SharePayload 字段），超长（如 >64KB）拒绝。
- **绝不静默入库**、绝不执行 payload 中任何内容、绝不透传本地路径或密钥。
- 卡片 PNG 不得渲染任何敏感信息（Key、绝对路径）。

**验收标准**：
- [x] `share:renderCard` 产出 PNG（含预览图/标题/正文/参数/水印），可保存与复制到剪贴板
- [x] deeplink 格式 `promptforge://import?data=<base64>`，往返编解码一致
- [x] `app.setAsDefaultProtocolClient('promptforge')` 注册，mac `open-url` / win `second-instance` 代码路径已接线；Windows OS 级唤起仍归发布平台冒烟
- [x] 点击 deeplink → 弹**导入确认**（预览字段）→ 确认后才入库
- [x] `share:parseDeeplink` 对畸形/超长输入安全拒绝（`INVALID_DEEPLINK`/`PAYLOAD_TOO_LARGE`），不写库、不崩
- [x] payload 白名单生效：额外/未知字段被丢弃
- [x] 全程无任何网络请求（本地优先验证）

**测试场景**：
1. 正常：库中一条带图 prompt → 生成卡片 PNG + deeplink → 另一实例点 deeplink → 确认 → Library 出现该条。
2. 边界：无预览图的 prompt → 卡片文字版式、deeplink 照常。
3. 异常：篡改 base64 / 注入超大 payload / 塞入非白名单字段 → 拒绝导入并提示，DB 无写入。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] deeplink 编解码 + 白名单校验单测（`shared/__tests__/share.test.ts` 4 passed，含畸形/超长输入）
- [x] 真实 Electron E2E：`tests/e2e/test_09_share.py` 2 passed，覆盖 PNG 生成、分享 UI、确认前不写库、确认后 `source='shared'` 入库；打包 OS 级协议唤起待发布冒烟

---

### <a id="task-dif-06"></a>[TASK-DIF-06] 智能集合 + 搜索历史

- **状态**：✅ 已完成（2026-08-05：DB v6、Library 侧栏、搜索历史、导入导出/重置与响应式验收均已接通）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：[10-library](10-library-deep-dive.md) TASK-LIB-07（筛选栏，提供 filters 结构）
- **预估**：M

**目标**：保存当前筛选条件为「智能集合」一键复用；记录最近 10 条搜索可回放。复用 Library 现成 list 查询，边际成本低（原始调研 §5.1/§5.2）。

**完成记录**：新增 DB v6 迁移 `smart_sets` / `search_history`，主进程 repository 会白名单归一化 Library 查询、搜索词去重并保留最近 10 条。Library store 新增智能集合、集合命中数与搜索历史状态；筛选栏可把当前搜索/标签/文件夹/收藏/排序保存为集合，侧栏点击集合会套用筛选并在引用标签/文件夹被删后自动剔除失效条件。搜索框在防抖刷新后写入历史，侧栏支持回放与清空。导出/导入/重置把 `smartSets` 作为业务数据纳入闭环，搜索历史作为临时行为数据在 reset/replace 时清空。

**涉及文件**：
- `electron/db/migrations/0006_smart_sets.ts`（新建：`smart_sets` + `search_history` 表）
- `electron/db/schema.ts`、`electron/system/migrations.ts`（注册 DB v6 schema/migration）
- `electron/db/repositories/smartSets.ts`（新建）· `electron/main/ipc/smartSets.ts`（新建 handler）
- `electron/main/ipc/index.ts`、`electron/preload/index.ts`（注册并暴露 IPC）
- `shared/types/ipc.ts`（新增 `db:smartSets:*` / `db:searchHistory:*`）
- `shared/types/models.ts`（新增 `LibraryQuerySnapshot` / `SmartSet` / `SearchHistoryItem`）
- `src/features/library/components/SmartSets.tsx`（新建：侧栏集合区 + 搜索历史区）
- `src/features/library/store.ts`（修改：套用集合 = 设置 filters；写入/读取搜索历史）
- `src/features/library/components/FilterBar.tsx`、`src/features/library/components/SearchBar.tsx`、`src/pages/LibraryPage.tsx`（保存入口、搜索锚点、侧栏挂载与窄屏收敛）
- `electron/system/export.ts`、`electron/system/import.ts`、`electron/system/reset.ts`、`shared/export-format.ts`、`src/features/settings/*`（导出/导入/重置与 UI 摘要）
- `tests/e2e/test_01_data_layer.py`、`tests/e2e/test_02_library.py`、`tests/e2e/test_05_settings.py`、`tests/package/macos_package_smoke.py`（DB/Library/Settings/打包冒烟覆盖）

**Schema（🆕）**：
```sql
CREATE TABLE smart_sets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  query TEXT NOT NULL,        -- JSON {search, tagIds, filters, sort}
  sort_order INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE search_history (
  id TEXT PRIMARY KEY, term TEXT NOT NULL UNIQUE, used_at INTEGER NOT NULL
);
```

**IPC 契约（🆕）**：

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:smartSets:list` | `{}` | `SmartSet[]` |
| `db:smartSets:create` | `{ name: string, query: LibraryQuery }` | `SmartSet` |
| `db:smartSets:update` | `{ id: string, patch: Partial<SmartSet> }` | `SmartSet` |
| `db:smartSets:delete` | `{ id: string }` | `{ ok: true }` |
| `db:searchHistory:list` | `{ limit?: number }` | `{ term: string }[]`（默认 10，按 used_at 降序） |
| `db:searchHistory:add` | `{ term: string }` | `{ ok: true }`（去重更新 used_at，超 10 淘汰最旧） |
| `db:searchHistory:clear` | `{}` | `{ ok: true }` |

`LibraryQuery` = `db:prompts:list` 的入参子集 `{ search?, tagIds?, filters?, sort? }`（复用 docs/07 §3.1）。

**交互与 UI/UX**：见 §4.6。存为集合→命名→存 query JSON；点集合套用筛选并显命中数；搜索去重写历史留 10 条；点历史回填重搜；引用已删标签的条件自动失效。

**验收标准**：
- [x] 「存为集合」序列化当前 `{search,tagIds,filters,sort}` 持久化
- [x] 点集合套用其筛选，列表即时收敛，集合旁显实时命中数
- [x] 每次搜索去重写入，保留最近 10 条，超出淘汰最旧
- [x] 点历史词回填搜索框并触发搜索
- [x] 集合引用的标签被删后，该条件自动剔除不报错，并回写剔除后的 query
- [x] 空态：无集合隐藏区块，无历史显「暂无搜索记录」
- [x] 导出/导入/重置纳入 `smartSets`，搜索历史不作为导出载荷泄漏

**测试场景**：
1. 正常：设「Flux+4★」筛选 → 存为集合 → 清筛选 → 点集合恢复筛选。
2. 边界：连搜同词多次 → 历史只留一条（更新时间）；搜第 11 个不同词 → 淘汰最旧。
3. 异常：集合里的标签被删 → 打开集合自动去除该标签条件，其余仍生效。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm run check`：30 Vitest 文件 / 216 passed + build 通过
- [x] `tests/e2e/test_02_library.py::test_smart_sets_ipc_and_search_history_limit`：1 passed，覆盖 IPC、DB query JSON、最近 10 与去重
- [x] `tests/e2e/test_02_library.py::test_smart_sets_sidebar_search_history_and_deleted_tag_prune`：1 passed，覆盖侧栏空态、保存/套用/删除集合、历史回放、删标签自动剔除
- [x] 关联回归 10 passed：harness、DB v6、Library、Settings 导出/导入/重置
- [x] Library 全量 E2E：26 passed；Settings 全量 E2E：43 passed
- [x] Playwright 视觉检查：`/tmp/promptforge-dif06-library-desktop.png` 与 `/tmp/promptforge-dif06-library-narrow.png`；1280×820 与 420×820 均 `documentWidth == viewport`、`overflowNodes=[]`

---

### <a id="task-dif-07"></a>[TASK-DIF-07] Fragment 智能元数据

- **状态**：✅ 已完成（2026-08-05：DB v8 + 左栏/编辑器/画布软提示 + 同义词/i18n 搜索 + JSON 容错已接通）
- **优先级**：P2
- **所属大功能**：Differentiators
- **依赖**：无（`fragments` 表已有 `compatible_models`/`weight`/`weightable`）
- **预估**：M–L

**目标**：为 Fragment 补充推荐权重区间、冲突关系、同义词、多语译名，并在 Composer 中做**软提示**（不禁用）：权重越界提示、target 不兼容徽标、冲突警示、同义词搜索命中。原始调研 §2.3「智能元数据」。

**涉及文件**：
- `electron/db/migrations/0008_fragment_meta.ts`（新建：ALTER `fragments` 加列并回填内置元数据）
- `electron/db/repositories/fragments.ts`（修改：读写新元数据）
- `resources/builtin/fragments.json`（修改：内置库补元数据字段）
- `src/features/composer/components/FragmentLibrary.tsx`（修改：徽标/提示/同义词搜索）
- `src/features/composer/components/FragmentEditor.tsx`（修改：元数据编辑与预览）
- `src/features/composer/components/CompositionCanvas.tsx`（修改：权重越界/冲突软提示）
- `src/features/composer/fragment-meta.ts`（新建：兼容、冲突、译名与权重范围辅助逻辑）

**Schema 扩展（🆕，加列，向后兼容）**：
```sql
ALTER TABLE fragments ADD COLUMN weight_min REAL;      -- 推荐权重下限
ALTER TABLE fragments ADD COLUMN weight_max REAL;      -- 推荐权重上限
ALTER TABLE fragments ADD COLUMN conflicts TEXT;       -- JSON string[]（互斥 fragment id/关键词）
ALTER TABLE fragments ADD COLUMN synonyms TEXT;        -- JSON string[]
ALTER TABLE fragments ADD COLUMN i18n TEXT;            -- JSON {lang: 译名}
```

**IPC 契约**：复用现有 `db:fragments:*`（docs/07 §3.4），`Fragment` 类型加上述字段即可，**无新增通道**。`shared/types/models.ts` 的 `Fragment` 补可选字段。

**交互与 UI/UX**：见 §4.7。全部为**软提示**：越界黄字、不兼容 ⚠ 徽标、冲突警示、同义词搜索命中、按应用语言显译名（正文仍原文）；元数据缺失优雅降级。

**验收标准**：
- [x] slot 权重超 `[weight_min, weight_max]` 时滑块旁黄色软提示，不禁止
- [x] 当前 target 不在 `compatible_models` 时 Fragment 卡显 ⚠ + tooltip
- [x] 同 slot 填入 `conflicts` 命中的 Fragment 时给冲突提示（可忽略）
- [x] Fragment 搜索命中 `synonyms`（搜 moody 命中 dramatic lighting）
- [x] 按应用语言显示 `i18n` 译名，正文/生图仍用原文
- [x] 老 Fragment（元数据缺失）不显对应区块、不报错（优雅降级）
- [x] 内置 `fragments.json` 至少给核心片段补齐元数据

**测试场景**：
1. 正常：dramatic lighting 推荐 1.1–1.5，拉到 1.8 出黄字提示。
2. 边界：无元数据的用户自建 Fragment → 各提示区块隐藏，功能不受影响。
3. 异常：`conflicts`/`synonyms` 存了非法 JSON → 容错解析为空数组，不崩。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] fragments repository 元数据读写 + JSON 容错单测：Vitest 9 passed；DIF-07 E2E 3 passed
- [x] preview 验证越界/不兼容/冲突/同义词搜索：`test_03g_fragment_metadata.py` 3 passed
- [x] 关联回归：`test_03c + test_03d` 10 passed、harness + data layer 26 passed、Composer audit 26 passed
- [x] `npm run check`：33 个 Vitest 文件 / 228 passed + build 通过

---

## 6. 依赖关系图

```
（前置：docs/12 Phase A–D 主链路必须先通，尤其取消生图 / 筛选栏 / 导入导出）

引擎已就绪（白捡分，优先产品化）
  DIF-01(AST 反查) ── ✅ 已完成：store segments → PreviewPanel/Canvas 双向高亮
  DIF-02(多 target 产品化) ── ✅ 已完成：renderForTarget → PreviewPanel 切换/对比/复制

低投入高复用
  10-library:LIB-07(筛选栏) ─→ DIF-06(智能集合 + 搜索历史) ── ✅ 已完成：DB v6 + Library 侧栏/历史回放

从零但结构清晰
  diff-match-patch(已装) ─→ DIF-03(版本 + diff) ── ✅ 已完成
  12-generation(取消/批量) ─→ DIF-04(排列组合)
  16-onboarding:导入导出(A5) ┄推荐先┄→ DIF-05(分享卡片 + deeplink) ── ✅ 已完成：PNG 卡片 + 确认导入

部分字段已在
  fragments 现有列 ─→ DIF-07(智能元数据，加列向后兼容) ── ✅ 已完成：DB v8 + UI 软提示/搜索

建议顺序（ROI 降序）：DIF-01/DIF-02/DIF-03/DIF-05/DIF-06/DIF-07 已完成 → DIF-04
```

## 7. 大功能验收（差异化壁垒整体）

> 对照 [01-vision-and-ia](01-vision-and-ia.md) §4 护城河清单逐条落地。全部 P2，主链路达标后开工。

- [x] **AST 反查**（🥇 最高 ROI）：点预览词高亮来源 slot、点 slot 反查段，双向（DIF-01）
- [x] **多 target 产品化**（🥇 头号护城河）：7 target 切换 + 并排对比 + 一键复制为 X（DIF-02）
- [x] **智能集合 + 搜索历史**：存筛选一键用 + 最近 10 搜索回放（DIF-06）
- [x] **版本 + diff**：事件日志 + 快照 + diff-match-patch 逐词 diff + 分叉树 + 恢复（DIF-03）
- [x] **分享卡片 + deeplink**：PNG 卡片 + `promptforge://` 导入，零后端，导入必经确认（DIF-05）
- [x] **排列组合**：多候选 slot → 笛卡尔积 → 批量生图网格（DIF-04）
- [x] **Fragment 智能元数据**：权重区间/兼容/冲突/同义词/多语软提示（DIF-07）
- [x] 安全：deeplink 白名单校验 + 导入确认；分享全程无网络；密钥/路径不入卡片（[01](01-vision-and-ia.md) §7）
- [x] 引擎不回退：`npm run check` 33 个 Vitest 文件 / 228 passed，生产 build 通过；DIF-04 Electron E2E 2/2 通过

---

## 8. V2+ 展望（路线图，暂不派工）

> 依据原始调研中的延后项。这些是**方向性预留**，不出完整任务卡；待主链路与 V1 差异化稳定、且有明确用户需求再拆卡。不要在主链路 P0 缺口未补前并行开多个 Provider 适配。

| 方向 | 内容 | 前置条件 | 引擎/契约影响 | 备注 |
|------|------|----------|--------------|------|
| **多 Provider 适配** | StabilityAI / Replicate / ComfyUI 本地 / MJ 中转 | 主模型链路（gpt-image）稳定、取消生效 | Provider 抽象层扩展、`serializeWeight` 已覆盖对应 target | MJ 需异步 job 轮询模式 |
| **异步任务模式** | job_id 轮询（MJ 等） | 上一项 | `image:*` 增轮询/回调通道 | 生图状态机改造 |
| **图像引用 / 垫图** | Fragment 支持 `imageRef` 类型 | 生图 API 支持 image-to-image | 新 `FragmentType='imageRef'`、参数面板加参考图 | gpt-image 编辑能力接入 |
| **ComfyUI 工作流导出** | Composition → ComfyUI API JSON | Comfy 本地 Provider | 新序列化目标（AST→节点图） | 复用 AST 中间表示 |
| **区域提示词** | Regional Prompter，预留 region 字段 | 支持分区的 Provider | Composition 加 `regions` | 高级功能，受众窄 |
| **社区 Fragment 包** | `.fragments.json` 像扩展一样安装 | 元数据（DIF-07）稳定 | 复用 Fragment schema + 导入校验 | 需内容安全审查策略 |

**取舍**：V2+ 的共同前提是「V1 差异化已把引擎的账兑现成产品」。多 Provider 与垫图受**外部 API 能力**约束（非本 App 可独立完成），故排在 P2 差异化之后。ComfyUI 导出与区域词能**复用已有 AST 中间表示**，是与本文 §5 差异化协同度最高的 V2 方向。

---

> **落地提醒**：本文所有 P2 V1 差异化任务卡已完成。后续若继续扩展，请优先从 §8 V2+ 的多 Provider、垫图、ComfyUI 导出、区域词中重新做需求确认与 API 能力验证后再拆卡。
