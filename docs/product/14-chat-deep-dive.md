# 14 · Chat 快速生图 —— Deep Dive

> **大功能定位**：**轻入口，不是归宿**。低门槛、即输即生、多图对比、灵感速记——服务 P4 轻度试验者与 P1 的「灵感速记」场景。
> **产品红线**（来自 [01-vision-and-ia](01-vision-and-ia.md) §5.2）：Chat 是「入口」不是「归宿」。任何在 Chat 里产生的有价值资产，都要有一键「提升」进主路径的通道。**绝不让 App 沦为「又一个聊天生图客户端」。**
> **导航归属**（来自 [01](01-vision-and-ia.md) §6.1）：Chat 不再是割裂的顶层，而是 **Generate 工作区的「探索」模式**（与「制作」并列）。早期任务卡中的“快速/精修”均为历史术语；本文与 [12-generation](12-generation-deep-dive.md) 是联合改造点。
> 引用：`docs/05-image-generation.md`（生图调用/密钥/错误重试/历史）、`docs/07-ipc-contracts.md` §3.5/§3.6/§3.7（provider/image/history 契约）。

> **任务卡状态回写**：2026-08-05 · 基于源码实读与 CHT-06 Workbench/Composer 回归 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

> **当前实现覆盖（本轮回写）**：Chat 的低门槛心智已收敛为 Generate Workbench 的「探索」模式；“快速/精修”是历史术语，当前产品交互以「探索/制作」为准。正式状态源是 `src/features/generation/workbench/*`；存为提示词、拆到画布和 History 兜底三条提升/沉淀通道已补齐，Chat 11/11 完成。旧 Chat/Studio 页面组件、`studio/store` 与旧 generation 生成状态已删除；Library/History/Composer 正式入口直接使用 Workbench，`generation/store` 只保留 Provider 配置。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为**轻度试验者（P4）**，我只想「输入一句话看看出什么图」，不想先学库/组合概念——配好 Provider 后零门槛即输即生。
- 作为**高频创作者（P1）**，我在正经组合造词之前，想先用 Chat 快速试几个方向，**一次出多张对比**挑感觉。
- 作为任何用户，我在 Chat 里试出一句**好用的提示词**，想**一键存进库**长期复用，而不是复制到别处再手动新建。
- 我想把 Chat 里的一句话**「拆解到画布」**深化成可组合的模板，而不是从零在 Composer 里重打。
- 我担心 Chat 的临时消息流刷掉就没了——但每次生成的结果我**在历史里还能找回**，成本也有账。
- 我要能**放大看原图、另存、在文件夹里打开**，失败了能**重试**，卡住了能**取消**。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| ChatGPT / Gemini 生图：对话流即输即生 | **零门槛对话入口** + 多轮上下文感 | 我们**不做多轮对话续写**，每条独立生成；产物默认不入库，靠「提升」进主路径 |
| Midjourney Discord：一条命令出 4 图网格 | **一次多图对比**心智 | 用 `n=1..4` 逐张点亮，不阻塞 UI |
| Krea / Playground：快速试 + 收藏进画布 | **试验→沉淀**的提升动作 | 提升为**单向**（Chat→Library / Chat→Composer），库不被半成品污染 |
| 通用聊天客户端：会话历史长期保存 | —— | **反模式**：我们**不**把 Chat 做成长期资产库；资产归 Library/History，Chat 只做临时流 |

**结论**：Chat = **「对话入口的低门槛」×「本地资产池的沉淀力」**。呈现用消息流（提示词气泡 + 图集卡 + 参数标签），价值兜底靠「每次生成都写全局 History」+「一键提升进 Library/Composer」。它是主路径的**前厅**，不是替代品。

### 1.3 定位边界（本文反复回扣的心智锚）

| | Chat 「快速」入口 | Library/Composer 主路径 |
|---|---|---|
| **心智** | 「我想试试这句话出什么图」 | 「我在经营提示词资产 / 批量生产」 |
| **产物** | 临时消息流，默认不入库（但结果必进 History） | 一等公民资产，长期沉淀 |
| **门槛** | 配好 Provider 即用，零概念 | 需理解库 / 组合概念 |
| **不做** | 不做复杂组合、不做批量管理、不做多轮对话 | —— |

> 这张表是 Chat 所有设计决策的裁决线：任何让 Chat「变重、变成归宿」的需求都应被拒绝或改造成「提升到主路径」。

---

## 2. 现状对照（设计 vs 实现）

> 依据代码：`src/features/generation/workbench/*`（正式页面）、`src/features/generation/store.ts`（Provider 配置）、`src/pages/GeneratePage.tsx`、`docs/12`。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增

| 小功能 | 设计要求 | 现状 | 结论 |
|--------|----------|------|------|
| Chat 快速生图核心 | 输入→生成→多图结果，逐张点亮 | ✅ Workbench `submitDraft` 先创建不可变回合快照，再按序逐张请求；骨架、部分失败、取消、重试和键盘发送均有覆盖 | 达标 |
| 图集与消息气泡 | user 气泡 + assistant 图集 + 参数标签 | ✅ `MessageBubble`/`ImageResult` 完整（骨架/成功/失败/broken 四态） | 达标 |
| 放大预览 Lightbox | 全屏遮罩 + 原图 + ESC/点击关闭 | ✅ `ImageLightbox`（走 `toImageSrc`→media://，含 broken 兜底） | 达标 |
| 图片另存 | 悬浮工具条「另存为」 | ✅ Workbench 结果卡与 Lightbox 均走 `system.saveImage` 系统另存 | 达标（CHT-04） |
| 「在文件夹打开」 | 打开图片所在目录 | ✅ Workbench 结果卡与 Lightbox 均调用 `system.openInFolder` | 达标（CHT-04） |
| 重新生成 | 用原参数重来 | ✅ `regenerate` 用消息快照的 prompt/size/quality/n | 达标 |
| 取消生成 | AbortController + 取消按钮 | ✅ Workbench 统一使用 `activeJobId`/`cancel()`/`image:cancel`，未开始结果标记 cancelled | 达标（CHT-03/GEN-07） |
| Provider/模型/参数快切 | 输入区内联切换服务商、模型、比例、质量、数量 | ✅ Workbench Composer 使用自绘 Provider/模型/比例控件；Provider 菜单只显示 suffix/状态，模型经主进程读取并可原位切换；参数按模式持久化 | 达标（CHT-07） |
| 空态/首启引导 | 无 Provider 时引导配置 | ✅ Workbench 空态已区分无 Provider / 有 Provider 无密钥 / Provider 可用三态；可就地打开配置、取消不留状态，Provider 可用时示例卡即点即生 | 达标（CHT-10） |
| 提升：存为 Prompt | Chat 消息→Library | ✅ Workbench 回合和旧 Chat 消息均可存为提示词；成功 toast 带「查看」跳 Library 高亮，失败 toast 不静默，同一回合/消息成功后锁定防重复 | 达标（CHT-05） |
| 提升：拆解到 Composer 🆕 | Chat 消息→画布初始 body | ✅ 正式 Workbench 回合操作栏新增「拆到画布」确认弹层；确认后走 `requestComposerBody` → Composer `openWithBody` 临时模板，正文/负面/参数单向流转；旧 `MessageBubble` 兼容入口同步补齐 | 达标（CHT-06） |
| 会话持久化 | 决策：临时 or 持久 | 🔴 `messages` 纯内存，刷新即失；但结果已进 History（主进程写） | 需**显式决策 + 文案兜底**（见 CHT-08） |
| 文案/心智一致性 | Chat/History/空态措辞统一 | ✅ 顶层为「生成」，模式为「探索/制作」，资产为「生成历史/提示词库」，保存动作统一为「存为提示词」；旧 Chat/Studio 页面已清理 | 达标（CHT-09） |
| **收敛进 Generate** | Chat = Generate「快速」tab | ✅ `GeneratePage` 统一承载 Workbench；顶部居中「探索/制作」切换，单一 Provider/History/生成入口，旧路由仅作兼容 | 达标（CHT-02） |
| 生图引擎 | 单一 `image:generate` 通道 | ✅ chat 与 studio 都走 `api.image.generate`（`docs/07` §3.6）；引擎不重复 | 达标（收敛时**不得**新造引擎） |
| 密钥安全 | 明文不过渲染进程 | ✅ 生成只传 `providerId`，明文 key 只在主进程（`docs/05` §4.2） | 达标（收敛后须保持） |

**一句话**：**Chat 的正式体验已收敛到 Generate Workbench，CHT-01/02/03/04/05/06/07/08/09/10/11 已全部完成。** 探索回合现在同时具备「存为提示词」和「拆到画布」两条提升通道，结果仍由 History 兜底；旧 Chat/Studio 页面与独立 Studio 状态源已清理，不再扩展为正式业务入口。

---

## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | Chat 快速生图核心打磨（多图/逐张/参数快照，refine） | P1 | [TASK-CHT-01](#task-cht-01) |
| 2 | **收敛：Chat = Generate 工作区「快速」tab**（不重复引擎） | P1 | [TASK-CHT-02](#task-cht-02) |
| 3 | 取消 + 重试对齐（接 jobId / `image:cancel`，复用引擎） | P1 | [TASK-CHT-03](#task-cht-03) |
| 4 | Lightbox + 图片操作（放大/另存/在文件夹打开/复制图） | P1 | [TASK-CHT-04](#task-cht-04) |
| 5 | **提升：Chat 消息 → 存为 Prompt（Library）** | P1 | [TASK-CHT-05](#task-cht-05) |
| 6 | **提升：Chat 消息 → 拆解到 Composer 画布** 🆕 | P2 | [TASK-CHT-06](#task-cht-06) |
| 7 | Provider/模型快切 + 参数内联（ChatSettingsMenu 扩展） | P1 | [TASK-CHT-07](#task-cht-07) |
| 8 | 会话持久化决策 + 结果不丢兜底（transient + 全进 History） | P1 | [TASK-CHT-08](#task-cht-08) |
| 9 | 文案/心智一致性（Chat/History/空态统一措辞） | P1 | [TASK-CHT-09](#task-cht-09) |
| 10 | 空态 + 首启引导（无 Provider 引导、双入口心智对齐） | P1 | [TASK-CHT-10](#task-cht-10) |
| 11 | 「快速 vs 精修」差异化提示（subtle callout） | P2 | [TASK-CHT-11](#task-cht-11) |

---

## 4. UI/UX 设计

### 4.1 Generate 工作区布局（Chat 收敛为「快速」tab）

> 收敛后 Chat 不再是独立顶层。Generate 顶部一条 tab 切换「快速 / 精修」，两 tab 共用同一 Provider 快切与生图引擎（`image:generate`）。「快速」= 现 Chat 消息流；「精修」= 来自 Library/Composer 的参数化生成（见 [12-generation](12-generation-deep-dive.md)）。

```
┌─ Sidebar(240) ─┬─ Generate 主区 ───────────────────────────────────────┐
│ 📚 Library     │ ┌ PageHeader ────────────────────────────────────────┐ │
│ 🧩 Composer    │ │ ⚡ Generate            [Provider: 我的OneAPI ▾] [清空]│ │
│ ⚡ Generate ◄  │ │ ┌───────────────────────────────────────────────┐   │ │
│ 🕘 History     │ │ │ [ 快速 ]  [ 精修 ]      ← tab 切换（同一引擎）  │   │ │
│ ─────────      │ │ └───────────────────────────────────────────────┘   │ │
│ ⚙️ Settings    │ ├──────────────────────────────────────────────────────┤ │
└────────────────┤ │  「快速」tab 内容 = Chat 消息流（见 §4.2）           │ │
                 │ │                                                      │ │
                 │ └──────────────────────────────────────────────────────┘ │
                 └───────────────────────────────────────────────────────────┘
```

### 4.2 「快速」tab 主视图（现 ChatView）

```
┌ 快速 tab ─────────────────────────────────────────────────┐
│  ┌ 消息流（自动滚底，max-w-chat 居中）──────────────────┐  │
│  │                              ┌──────────────────────┐ │  │
│  │                              │ 赛博朋克风格的雨夜街道 │ │ ← user 气泡(右)
│  │                              └──────────────────────┘ │  │
│  │  🔥 [1024x1024] [high] [×2]                           │  │ ← assistant 参数标签
│  │     ┌────────┐ ┌────────┐                             │  │
│  │     │ [图1]  │ │ [图2]  │   ← 悬浮:[放大][另存][⊞打开] │  │ ← 图集(逐张点亮)
│  │     └────────┘ └────────┘      底缘: 2.3s · ¥0.12     │  │
│  │  [📋复制提示词][🔖存为提示词][🧩拆到画布][🔄重生]  编辑重发│ │ ← 操作条(提升入口)
│  └───────────────────────────────────────────────────────┘  │
│  ┌ 输入栏（ChatComposer，固定底部）──────────────────────┐  │
│  │ 描述你想生成的画面…                                    │  │
│  │ [⚙ 1024×1024 · high · ×2] [Provider▾]   Enter 发送 [↑]│  │ ← 设置浮层+Provider快切+发送
│  └───────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 4.3 图片放大 Lightbox（已实现，refine）

```
┌ 全屏遮罩 bg-black/75 + backdrop-blur ────────────────── ✕ ┐
│                                                            │
│                  ┌────────────────────┐                    │
│                  │                    │                    │
│                  │     原图 object-    │  ← 点图不关；点空白/ESC 关
│                  │      contain       │                    │
│                  │                    │                    │
│                  └────────────────────┘                    │
│         [另存为]  [在文件夹打开]  [复制提示词]  🆕底部工具条  │
│         broken 兜底：图标 + 「图片无法加载，可能已被移动」   │
└────────────────────────────────────────────────────────────┘
```

### 4.4 「提升」菜单：拆解到 Composer 🆕（消息操作条 → 确认）

```
点「🧩 拆到画布」→
┌ 拆解到画布？ ───────────────────────── ✕ ┐
│ 把这句提示词作为初始正文送入组合画布，   │
│ 你可以在那里拆成片段、加权重、切模型语法。│
│ ┌──────────────────────────────────────┐ │
│ │ 赛博朋克风格的雨夜街道，霓虹反射在…    │ │ ← 只读预览(该消息 prompt)
│ └──────────────────────────────────────┘ │
│              [取消]   [进入画布 →]         │
└────────────────────────────────────────────┘
进入后：切到 Composer，正文预填为 body；toast「已送入画布」
```

### 4.5 关键交互与状态

| 场景 | 行为 |
|------|------|
| 输入发送 | `Enter` 发送、`Shift+Enter` 换行、`Cmd/Ctrl+Enter` 亦发送（全局键，[01](01-vision-and-ia.md) §6.3）；发送后清空草稿、追加 user+assistant 两条消息 |
| 多图生成 | 按 `n` 铺 N 张 pending 骨架，**顺序逐张**调 `image:generate({n:1})`，逐张点亮（中转站并发不友好，顺序更稳） |
| 生成中 | 发送键变 spinner + 禁用；`isBusy` 期间不接新发送/重生 |
| 取消 | 生成中输入栏发送键位显示「取消」（或旁置取消键）→ `image:cancel(jobId)` 中止在途、未开始槽位标记 `cancelled`（对齐 [12](12-generation-deep-dive.md)） |
| 单图放大 | 点图 → Lightbox；`ESC`/点空白关闭；broken 兜底占位 |
| 图片另存 | 悬浮「另存为」→ 系统另存，统一走 `system.saveImage` |
| 在文件夹打开 | 🆕 悬浮/Lightbox「在文件夹打开」→ `system:openInFolder(imagePath)` |
| 重新生成 | 用消息快照 prompt/size/quality/n 重来，重铺骨架 |
| 编辑重发 | 把该消息 prompt 填回输入框（`setDraft`），用户改后再发 |
| 提升·存为 Prompt | `createPrompt({source:'manual'})`→ **成功 toast「已存入提示词库」+ 「查看」**；已存过则按钮显「已入库」并短暂锁定；失败 toast + 保留可重试 |
| 提升·拆到画布 | 确认弹层 → 切 Composer 以该 prompt 为初始 body（🆕，见 CHT-06） |
| Provider 快切 | 输入栏 Provider 下拉：列出已配置 Provider，切换=`setActive`；无 Provider 项显「+ 连接服务商」 |
| **空态（无 Provider）** | 品牌图标 + 引导语 + 醒目「连接服务商」+ 示例卡（禁用态，配好后可点） |
| **空态（有 Provider）** | 品牌图标 + 引导语 + 4 张示例提示词卡（点即生成）+ subtle「想精修？切到精修 tab」 |
| 加载态 | 图集 pending 骨架（shimmer + spinner） |
| 错误态 | 单图失败卡（红边 + 错误文案）；整体无 Provider→ 每张失败卡引导去连接；不 crash 整条消息 |
| 清空 | Header「清空」清 `messages`（仅清临时流，**不影响 History**，见 CHT-08 兜底文案） |

---

## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。所属大功能统一为 **Chat**（收敛后归属 Generate 工作区「快速」tab）。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。

### <a id="task-cht-01"></a>[TASK-CHT-01] Chat 快速生图核心打磨

- **状态**：✅ 已完成（2026-08-05：Workbench 多图顺序快照、逐张状态、输入清稿、IME/Enter 键盘语义、8000 字上限、部分失败和运行中互斥均已收口）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：无（`chat/store.ts` 已具备核心，本卡是 refine + 接入路由前的质量收口）
- **预估**：M

**目标**：把已有的对话生图核心从「能用」打磨到「达验收」——多图逐张点亮稳定、参数快照正确、发送/键盘交互严谨，作为收敛（CHT-02）前的干净基线。

**涉及文件**：
- `src/features/generation/workbench/store.ts`（正式状态源：提交快照、顺序逐张生成、清稿、部分失败/取消和运行中状态）
- `src/features/generation/workbench/GenerationWorkbench.tsx`（正式 UI：图集/参数标签/输入框/IME 与 Enter 语义）
- `tests/e2e/test_08_generation_workbench.py`、`src/features/generation/workbench/__tests__/store.test.ts`（行为与边界回归）

**IPC 契约**（已存在，见 `docs/07` §3.6）：`image:generate` `{providerId, prompt, size, quality, n:1}` → `GenerateImageResult`。

**交互与 UI/UX**：见 §4.2、§4.5。顺序逐张生成，逐张 patch 点亮；每张各自写 History、各自计费（主进程负责）。

**验收标准**：
- [x] 发送后 Workbench 回合中的 user 气泡 + assistant 图集即时出现，提交快照写入且草稿清空
- [x] `n=1/2/4` 分别铺对应骨架，按序逐张点亮；剩余任务期间回合保持 running，互不阻塞
- [x] 参数标签（比例/质量/×n）与提交时不可变参数快照一致
- [x] `isBusy` 期间不接受新发送/重试，显示取消入口并保留 pending/取消状态
- [x] `Enter` 发送、`Shift+Enter` 换行、`Cmd/Ctrl+Enter` 发送、输入法组词回车不误发

**测试场景**：
1. 正常：输入一句 →`n=2`→ 两张先后点亮，参数标签正确。
2. 边界：空白/纯空格草稿 → 发送键禁用；超长（>8000 字）不崩、正常截断或提示。
3. 异常：中途某张 IPC reject → 该张失败卡，其余仍继续，整条不崩。

**质量门禁**：
- [x] `npm run typecheck` 通过；`npm run check` 通过（29 个 Vitest 文件 / 213 项）
- [x] Electron Workbench 专项 6 passed；Generate 旧入口 + Workbench 回归 31 passed；完整无真实 API E2E 216 passed / 6 skipped / 0 failed（556.20 秒）

---

### <a id="task-cht-02"></a>[TASK-CHT-02] 收敛：Chat = Generate 工作区「快速」tab

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：TASK-CHT-01；与 [12-generation](12-generation-deep-dive.md) 的 Generate 工作区改造联合（谁先落地谁建 tab 容器）
- **预估**：L

**目标**：终结「两套并行生图 UI」。把 Chat 收敛为 Generate 工作区的「快速」tab，与「精修」tab 并列，共用同一 Provider 快切与 `image:generate` 引擎——**不新造引擎、不重复 store 逻辑**。

**现状根因**（务必先读）：`src/pages/ChatPage.tsx` 当前 `return <StudioView />`，即顶层「创作台」实际渲染的是 `features/studio/*`（参数化），而功能完整的 `features/chat/*`（对话流）**未接入任何路由**。二者都调 `api.image.generate`。收敛目标：**一个 Generate 页 + tab 切换**，「快速」= 对话流（chat），「精修」= 参数化（studio 演进而来）。

**涉及文件**：
- `src/pages/ChatPage.tsx` → 重命名/改造为 `GeneratePage.tsx`（或新建），内含 tab 容器（快速/精修）
- `src/App.tsx`（修改：`pages` map 的 `chat` 键改指 Generate 工作区；`ViewKey` 语义调整见下）
- `src/stores/app.ts`（修改：`ViewKey` 增/改 `generate`，或保留 `chat` 键但语义=Generate；同步 Sidebar）
- `src/components/layout/Sidebar.tsx`（修改：`{ key:'chat', label:'创作台' }` → `{ key:'generate', label:'Generate/生成' }`，图标沿用 `Wand2`/`Zap`）
- `src/features/chat/components/ChatView.tsx`（修改：作为「快速」tab 内容嵌入，去掉自带 PageHeader 与 Provider 加载副本，改由 Generate 壳统一提供）
- `src/features/generation/components/GeneratePanel.tsx`（关联：作为「精修」tab 载体，见 [12](12-generation-deep-dive.md)）

**IPC 契约**：不新增。两 tab 复用 `image:generate` / `image:cancel` / `image:retry`（`docs/07` §3.6）与 `provider:*`（§3.5）。

**交互与 UI/UX**：见 §4.1、§4.2。tab 切换保留各自会话/结果态；Provider 快切在两 tab 间共享（同一 `useGenerationStore.activeProviderId`）。默认落到「快速」tab（低门槛优先）。

**安全红线（收敛后须保持）**：生成只传 `providerId`，明文 key 永不过渲染进程（`docs/05` §4.2）。收敛不得引入任何在渲染层读取/缓存 key 的捷径。

**验收标准**：
- [x] Generate 页顶部有「探索 / 制作」模式切换，切换不丢当前草稿
- [x] 「探索」渲染对话式时间线，「制作」渲染参数化生成输入
- [x] 两模式共用同一 Provider 快切与同一 `image:generate` 调用路径（无第二套生图封装）
- [x] Sidebar 不再有独立「对话生图/创作台」两个入口，只有一个 Generate 顶层
- [x] `ChatPage` 不再直接 `return <StudioView/>` 的错配；旧 Chat/Studio 仅作为迁移兼容或已清理
- [x] 渲染进程代码中不出现明文 apiKey 传参

**测试场景**：
1. 正常：Generate→「快速」发一句出图→切「精修」参数化生成→切回「快速」，上一条消息流仍在。
2. 边界：无 Provider 时两 tab 都引导去连接，且共享同一 Provider 状态。
3. 异常：从旧 `ViewKey='chat'` 的持久化状态启动 → 正确落到 Generate，不白屏。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Workbench E2E 验证模式切换 + 探索/制作生图 + Sidebar 单入口

---

### <a id="task-cht-03"></a>[TASK-CHT-03] 取消 + 重试对齐（复用引擎，不重造）

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：TASK-CHT-01；对齐 [12-generation](12-generation-deep-dive.md) 的 AbortController/`image:cancel` 修复
- **预估**：M

**目标**：为「快速」tab 补上生成中取消能力，并让取消/重试与 studio 路径走同一套 jobId + `image:cancel` 机制——`features/studio/store.ts` 已有 `activeJobId`/`cancel()`/`cancelRequested` 的成熟范式，chat 侧照搬对齐，不各写一套。

**涉及文件**：
- `src/features/chat/store.ts`（修改：`runGeneration` 生成 `jobId` 传入 `image:generate`；加 `activeJobId`/`cancelRequested`/`cancel()`；未开始槽位标 `cancelled`）
- `src/features/chat/components/ChatComposer.tsx`（修改：`isBusy` 时发送键切「取消」或旁置取消键 → 调 `cancel()`；`Esc` 取消，[01](01-vision-and-ia.md) §6.3）
- `src/features/chat/components/ImageResult.tsx`（修改：失败/取消卡提供「重试」单张入口）

**IPC 契约**（已存在，见 `docs/07` §3.6）：`image:generate`（请求增 `jobId`，与 studio 一致）、`image:cancel` `{jobId}` → `{ok:true}`、`image:retry` `{historyId}` → `GenerateImageResult`。

**交互与 UI/UX**：见 §4.5「取消」「重新生成」。取消后在途任务中止、未开始 pending 槽位标 `cancelled`（复用 studio 的 `CANCELLED` 语义）；取消/失败的单张可「重试」。

**验收标准**：
- [x] 生成中出现取消入口（发送键切换或旁置），点击/`Esc` 生效
- [x] 取消后：在途 `image:cancel(jobId)` 中止，未开始槽位标 `cancelled` 并写入 History（`docs/05` §5.2/§5.4）
- [x] 单张失败/取消卡有「重试」，用原参数重生成该张
- [x] 探索与制作共用同一 jobId/cancel 语义（无重复实现）

**测试场景**：
1. 正常：`n=4` 生成中点取消 → 已完成保留、在途中止、剩余标已取消。
2. 边界：最后一张刚完成瞬间点取消 → 不产生「取消已成功项」的错乱。
3. 异常：`image:cancel` reject → 静默兜底（任务超时自愈），UI 不卡死。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] E2E 验证取消 + 单张重试

---

### <a id="task-cht-04"></a>[TASK-CHT-04] Lightbox + 图片操作（放大/另存/在文件夹打开）

- **状态**：✅ 已完成（2026-08-05：结果卡与 Lightbox 的图片操作、系统保存/剪贴板、broken 兜底和 media:// 展示均已接通）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：无（`ImageLightbox`/`ImageResult` 已存在，本卡补动作）
- **预估**：S

**目标**：补齐单图操作闭环——放大、系统另存、**在文件夹打开**、复制图片和复制提示词。让 Generate Workbench 结果卡、Lightbox 与 History 详情使用一致的图片动作。

**涉及文件**：
- `src/features/generation/workbench/GenerationWorkbench.tsx`（结果卡悬浮工具条：放大、另存、打开目录、复制路径）
- `src/features/chat/components/ImageLightbox.tsx`（底部加「另存 / 在文件夹打开 / 复制图片 / 复制提示词」工具条，保留 broken 兜底）
- `electron/system/image-actions.ts`、`electron/main/ipc/system.ts`、`electron/preload/index.ts`（系统另存与图片剪贴板 IPC）
- `src/lib/media.ts`（复用 `toImageSrc`，图片经 media:// 渲染，勿改协议）

**IPC 契约**（已存在，见 `docs/07` §3.8）：`system:openInFolder` `{path}` → `{ok:true}`（preload 已暴露 `api.system.openInFolder`）。

**交互与 UI/UX**：见 §4.3。图片一律走 `toImageSrc()`→media://（Chromium 拒 file:// 于 http 源，见项目记忆 media-protocol-images）；「在文件夹打开」传绝对 `imagePath`。

**验收标准**：
- [x] 缩略卡悬浮显示：放大 / 另存 / 在文件夹打开 / 复制路径
- [x] Lightbox 底部工具条：另存 / 在文件夹打开 / 复制图片 / 复制提示词 / 缩放
- [x] 「在文件夹打开」调 `system:openInFolder`，定位到图片文件；无效路径安全失败并 toast
- [x] 图片加载失败显示 broken 占位（缩略卡与 Lightbox 都有），不空白
- [x] 所有图片经 `toImageSrc()` → `media://` 渲染（不出现裸 `file://`）

**测试场景**：
1. 正常：生成成功 → 放大 → 底部「在文件夹打开」定位文件。
2. 边界：图片文件被手动删除 → broken 占位 + 文案，不 crash。
3. 异常：`openInFolder` 传无效路径 → 主进程安全失败，UI toast 提示。

**质量门禁**：
- [x] `npm run typecheck`、`npm run check` 通过
- [x] `npx vitest run electron/system/__tests__/image-actions.test.ts electron/providers/__tests__/wukong-studio.test.ts`：5 passed
- [x] `tests/e2e/test_08_generation_workbench.py`：7 passed；覆盖真实 Electron IPC、`media://`、系统另存/复制/打开目录、Lightbox、中文/空格路径与 broken 兜底
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：218 passed，6 skipped

---

### <a id="task-cht-05"></a>[TASK-CHT-05] 提升：Chat 消息 → 存为 Prompt（Library）

- **状态**：✅ 已完成（2026-08-05：Workbench 回合 + 旧 Chat 消息存为提示词闭环）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：无（`createPrompt` 已存在于 `library/store.ts`）
- **关联**：[10-library](10-library-deep-dive.md)（资产入库后可管理）、[01](01-vision-and-ia.md) §5.1 提升流转表
- **预估**：S

**目标**：把「Chat 试出好词 → 一键沉淀进 Library」这条**核心提升通道**从「静默、易重复、无反馈」打磨到可信。这是「Chat 不沦为聊天客户端」红线的关键落点之一。

**完成记录**：正式入口落在 `GenerationWorkbench` 的回合操作栏，生成成功后可将当前回合 prompt 存为提示词；旧兼容 `MessageBubble` 同步修掉静默失败和短暂已保存状态。成功 toast 为「已存为提示词」并带「查看」动作，跳到 Library 后选中并高亮新条目；失败显示「存为提示词失败」并保留可重试；成功后按钮锁定为「已存为提示词」，同一回合/消息不会重复入库。

**涉及文件**：
- `src/features/chat/components/MessageBubble.tsx`（修改：`saveToLibrary` 加 toast 成功/失败 + 「查看」跳转、查重提示、失败可重试）
- `src/features/generation/workbench/GenerationWorkbench.tsx`（正式 Workbench 回合操作栏新增「存为提示词」）
- `src/features/library/store.ts`（复用 `createPrompt`；`source:'manual'`）
- `src/features/library/prompt-title.ts`（共享标题兜底规则：正文前 40 字）
- `src/components/ui/toast.tsx`（复用现有 toast）
- `src/stores/app.ts`（复用 `requestHighlightPrompt` 跨视图高亮）

**IPC 契约**（已存在，见 `docs/07` §3.1）：`db:prompts:create` `NewPrompt` → `Prompt`（`source='manual'`）。

**交互与 UI/UX**：见 §4.5「提升·存为提示词」。默认标题取 prompt 前 40 字；成功 toast「已存为提示词」+「查看」（跳 Library 并选中）；同一消息重复点显「已存为提示词」并短暂锁定；失败 toast 保留可重试（不再静默 catch）。

**验收标准**：
- [x] 点「存为提示词」→ 入库成功后 toast 成功 + 「查看」可跳到 Library 选中该条
- [x] 存为提示词时的 `source='manual'`、`content=消息 prompt`、标题为前 40 字兜底
- [x] 同一条消息重复点击不产生重复入库（按钮进入「已存为提示词」态）
- [x] 入库失败（IPC reject）显示错误 toast，可重试，不静默吞错
- [x] 入库不影响当前消息流与生成态

**测试场景**：
1. 正常：存一条 → Library 出现该 prompt（source=manual）→「查看」定位成功。
2. 边界：超长 prompt → 标题正确截断，正文完整入库。
3. 异常：DB 错误 → 错误 toast + 按钮回可点态，可重试成功。

**质量门禁**：
- [x] `npm run check`：typecheck + 30 个 Vitest 文件 / 216 项 + 生产 build 通过
- [x] `tests/e2e/test_08_generation_workbench.py`：14 passed，新增覆盖失败 toast、重试成功、`source='manual'`、标题 40 字、去重锁定与「查看」跳 Library 高亮
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：历史基线 224 passed，6 skipped（584.91 秒）；当前全量回归 251 passed，6 skipped，0 failed（636.19 秒）

---

### <a id="task-cht-06"></a>[TASK-CHT-06] 提升：Chat 消息 → 拆解到 Composer 画布 🆕

- **状态**：✅ 已完成（2026-08-05：正式 Workbench 回合操作栏新增「拆到画布」确认弹层，正文/负面/比例质量数量参数单向送入 Composer；旧 Chat MessageBubble 兼容入口同步补齐）
- **优先级**：P2
- **所属大功能**：Chat
- **依赖**：TASK-CHT-02（收敛后统一「提升」出口更自然）；Composer 需支持「以外部文本初始化 body」
- **关联**：[11-composer](11-composer-deep-dive.md)、[01](01-vision-and-ia.md) §5.1（Chat→Composer 流转）
- **预估**：M

**目标**：新增「拆到画布」提升动作——把 Chat 的一句 prompt 送入 Composer 作为初始正文，让轻入口试出的方向能被**深化成可组合、可切 target 语法的资产**。这是双入口「提升」闭环的第二条腿。

**完成记录**：正式入口落在 `GenerationWorkbench` 的回合操作栏。用户点击「拆到画布」先看到确认弹层和只读 prompt/negative 预览；确认后复用已完成的跨视图意图 `useAppStore.requestComposerBody()`，由 `ComposerPage` 消费并调用 `useComposerStore.openWithBody()` 建立单槽临时模板。Workbench 会把本回合 prompt、negative 和比例/质量/数量/background/moderation 参数一起带过去，Composer 侧按参数推断 target 并归一化；流转不创建 Prompt、不回写 Chat。旧兼容 `MessageBubble` 也补了同样入口，但正式验收以 Workbench 为准。

**涉及文件**：
- `src/features/generation/workbench/GenerationWorkbench.tsx`（正式 Workbench 回合操作栏加「拆到画布」与确认弹层）
- `src/features/chat/components/MessageBubble.tsx`（旧兼容操作条同步加「拆到画布」与确认弹层）
- `src/stores/app.ts`（复用既有 `requestComposerBody` / `pendingComposerBody`）
- `src/pages/ComposerPage.tsx` / `src/features/composer/store.ts`（复用既有 `openWithBody` 临时模板入口）
- `tests/e2e/test_08_generation_workbench.py`（新增 CHT-06 单向流转验收）

**IPC 契约**：无需新增 IPC（纯前端 store 间流转）。若后续需落库为草稿 Composition，再引用 `db:compositions:create`（`docs/07` §3.4），本卡不强制。

**交互与 UI/UX**：见 §4.4。点「拆到画布」→ 确认弹层（只读预览该 prompt）→「进入画布」切 Composer，正文预填为 body，`toast「已送入画布」`。若 Composer 尚未支持外部文本初始化（依赖未就绪），按钮灰显 + tooltip「画布支持后开放」。

**验收标准**：
- [x] 消息操作条有「拆到画布」，点击弹确认层并预览该 prompt
- [x] 确认后切到 Composer，正文/初始 body = 该 prompt，可继续拆片段/加权重/切 target
- [x] 流转为**单向**（不回写 Chat；不污染 Library）
- [x] Composer 已具备 `openWithBody` 临时模板入口；无需灰显兜底
- [x] toast 反馈「已送入画布」

**测试场景**：
1. 正常：拆一条 → Composer 正文预填 → 切 target 语法正常渲染。
2. 边界：空/极长 prompt → 正确进入、不撑破画布。
3. 异常：Composer store 初始化失败 → 回退提示，Chat 侧不受影响。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm run check` 通过（30 个 Vitest 文件 / 216 测试 + build）
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_08_generation_workbench.py -q --basetemp /tmp/promptforge-cht06-workbench` 通过（16 passed）
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_03_composer.py::test_open_in_canvas_from_library tests/e2e/test_03_composer.py::test_ephemeral_template_persisted_on_save tests/e2e/test_03e_composer_params.py::test_library_to_canvas_preserves_prompt_params -q --basetemp /tmp/promptforge-cht06-composer` 通过（3 passed）
- [x] preview 验证拆解跳转 + 画布预填（由 Workbench E2E 真实 Electron 覆盖）

---

### <a id="task-cht-07"></a>[TASK-CHT-07] Provider/模型快切 + 参数内联

- **状态**：✅ 已完成（2026-08-05：正式 Workbench 已接通 Provider/模型/比例/质量/数量内联切换，并完成桌面/360px 视觉验收）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：TASK-CHT-01
- **预估**：M

**目标**：在正式 Workbench 输入区内联切换 Provider/模型，并保留比例/质量/数量快切，不跳设置页即可换后端试图；探索/制作共享激活 Provider，模式参数各自持久化。

**涉及文件**：
- `src/features/generation/workbench/GenerationWorkbench.tsx`（正式输入区：Provider/模型/比例/质量/数量与失败反馈）
- `src/features/generation/components/RatioPicker.tsx`（共享自绘比例轮廓，创作台与设置页复用）
- `src/features/generation/store.ts`（`providers`/`activeProviderId`/`setActive`/`listModels`）
- `shared/types/ipc.ts`、`electron/preload/index.ts`、`electron/main/ipc/providers.ts`（模型列表 IPC，仅返回元数据）
- `src/components/layout/AppShell.tsx`、`src/components/layout/TitleBar.tsx`（窄屏侧栏与标题栏适配）

**IPC 契约**（见 `docs/07` §3.5）：`provider:list`、`provider:setActive`、`provider:update`、`provider:listModels`。`listModels` 在主进程实例化 Provider，只向渲染进程返回 `ModelInfo[]`；下拉只消费 `hasKey`/`keySuffix`，不返回或展示明文 key。

**交互与 UI/UX**：见 §4.2 输入栏。Provider 下拉列已配置项（显示 name + 末 4 位 suffix + 连通状态点），切换=`setActive`；无 Provider 时显示「连接服务商」→ 打开 Provider 浮层（复用 `openProviderDialog`）。切 Provider 与两模式共享（同一 `activeProviderId`）。

**验收标准**：
- [x] 输入栏可选 Provider，切换后新生成和 History 快照使用新 Provider
- [x] 下拉显示 name + key 末 4 位 + 连通状态，**不显示明文 key**
- [x] 无 Provider 时显示「连接服务商」并打开配置浮层
- [x] 模型菜单原位读取可用模型并更新 Provider；失败可重试、自定义模型仍保留
- [x] 比例/质量/数量快切保留并按探索/制作模式持久化
- [x] Provider 快切与探索/制作共享同一 `activeProviderId`
- [x] `setActive` reject 时保持原 Provider、菜单不关闭并显示错误提示

**测试场景**：
1. 正常：配两个 Provider → 切换 → 新图用新 Provider（History 记录可核对 provider_id）。
2. 边界：只有 1 个 Provider → 下拉正常显示、切换无副作用。
3. 异常：`setActive` reject → 保持原 Provider + 错误提示。

**质量门禁**：
- [x] `npm run typecheck` 与 `npm run check` 通过（30 个 Vitest 文件 / 216 项）
- [x] `test_08_generation_workbench.py` 8 passed；Generate + Workbench 33 passed
- [x] 完整无 API Electron E2E：218 passed / 6 skipped / 0 failed（559.00 秒）
- [x] preview 验证桌面与 360×740：Provider/模型/比例菜单不越界，无明文 key，比例轮廓在创作台和设置页均可见

---

### <a id="task-cht-08"></a>[TASK-CHT-08] 会话持久化决策 + 结果不丢兜底

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：无
- **关联**：[13-history](13-history-deep-dive.md)（结果账本）、[01](01-vision-and-ia.md) §5.2（Chat 产物默认不入库）
- **预估**：S

**产品决策（本卡确立，与 History doc 对账）**：
- **Chat 会话默认 transient（临时）**：消息流刷新即失、清空即清，**符合「轻入口、临时流」定位**，不做长期会话库（否则就滑向「聊天客户端」，违反红线）。
- **但结果绝不丢**：每次生成（成功/失败/取消）由主进程写入全局 `history` 表（`docs/05` §6），Chat 只是它的一个「快速产出源」。用户永远能在 History 找回图与成本，能「重试 / 另存为 Prompt」。
- **心智对账**：Library=提示词资产，History=生成结果账本，Chat=临时试验流。三者边界清晰，Chat 不承担持久化职责。

**目标**：把上述决策落到 UI 与文案，消除「清空会不会丢图」的焦虑，并确保每条 Chat 生成都进 History。

**涉及文件**：
- `src/features/chat/store.ts`（修改：生成收尾后 `void useHistoryStore.getState().load(...)` 刷新历史——**当前 chat store 未刷新 History，studio store 已做**，对齐之）
- `src/features/chat/components/ChatView.tsx`（修改：「清空」二次说明「仅清空当前对话，图片和记录已保存到历史」）
- `src/features/chat/components/ChatEmpty.tsx` / `MessageBubble.tsx`（文案：明确「每次生成都会自动存入历史记录」——现状已有该句，保留并统一）

**IPC 契约**（已存在）：`db:history:list`（`docs/07` §3.7）；生成写历史由主进程在 `image:generate` 内完成（`docs/05` §6）。

**交互与 UI/UX**：见 §4.5「清空」。清空前 tooltip/确认副文案说明结果已存历史；生成后 Sidebar History 计数即时 +N。

**验收标准**：
- [x] 探索每次生成后 History store 刷新，Sidebar「生成历史」计数即时反映
- [x] 成功/失败/取消都在 History 有记录（含 prompt 快照、参数、成本、状态）
- [x] 「新建会话」只清空当前 Workbench 时间线，不影响 History
- [x] 会话消息流不做持久化（刷新后为空，符合决策），文案不误导用户以为会话会保存
- [x] 决策与 [13-history](13-history-deep-dive.md) 表述一致（探索为产出源之一，非独立持久层）

**测试场景**：
1. 正常：Chat 生成 2 张 → History 多 2 条 → 清空 Chat → History 仍在。
2. 边界：失败/取消的生成 → History 有对应 `failed/cancelled` 记录可重试。
3. 异常：History 读失败（DB 未就绪）→ 兜底不卡死（见项目记忆 db-soft-reload），Chat 仍可用。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Workbench/History E2E 验证生成→History 联动 + 新建会话不删历史

---

### <a id="task-cht-09"></a>[TASK-CHT-09] 文案/心智一致性（Chat/History/空态统一）

- **状态**：✅ 已完成（2026-08-05：正式 Workbench、History、Library、设置与旧兼容视图已统一术语；219 passed / 6 skipped）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：TASK-CHT-02（收敛后术语更好统一）
- **预估**：S

**目标**：消除「对话生图 / 创作台 / 快速 / 精修」遗留措辞造成的心智割裂。统一术语与文案，让轻入口在「生成 · 探索」的定位下与生成历史、提示词库说同一套话。

**完成记录**：`ChatView` 改为「生成 / 探索模式」；`ChatEmpty` 改为「先探索一个方向」；`StudioView` 改为「制作 / 控制参数，定稿出图」；`ProviderEmptyGuide`、History 回填、Composer 存词、设置和 About 均已同步。正式 Sidebar 本来就是「生成」，本卡新增 `nav-{view}` 测试锚点防回归。

**涉及文件**：
- `src/features/chat/components/ChatView.tsx`、`ChatEmpty.tsx`、`MessageBubble.tsx`（探索兼容语汇与存词动作）
- `src/components/layout/Sidebar.tsx`（顶层 `生成` 与稳定测试锚点）
- `src/features/studio/components/StudioView.tsx`、`src/features/generation/components/ProviderEmptyGuide.tsx`（制作与空态语汇）
- `src/features/history/components/HistoryDetail.tsx`、`src/features/library/components/PromptDetail.tsx`、`src/features/composer/components/PreviewPanel.tsx`、`src/features/settings/sections/{Generation,About}Section.tsx`
- `src/features/generation/workbench/GenerationWorkbench.tsx`、`tests/e2e/test_08_generation_workbench.py`、`tests/e2e/test_06_history.py`
- 文案术语表（可放本卡验收注释或 [17-uiux](17-uiux-patterns.md)）

**统一术语表（本卡确立）**：

| 概念 | 统一用词 | 禁用/淘汰 |
|------|----------|-----------|
| 顶层工作区 | **Generate / 生成** | 「对话生图」「创作台」作顶层名 |
| 低门槛发散模式 | **探索** | 「快速」「Chat」作正式 UI 模式名 |
| 参数化定稿模式 | **制作** | 「精修」「创作台」 |
| 生成结果台账 | **生成历史 / History** | 「记录」「日志」混用 |
| 提示词资产 | **提示词库 / Library** | 「收藏夹」 |
| 存词动作 | **存为提示词** | 「入库」「另存为 Prompt」「保存」混用（完成态可显「已存为提示词」） |

**验收标准**：
- [x] Sidebar、PageHeader、空态、tab 名、按钮文案全部符合术语表
- [x] 不再同时出现「对话生图」「创作台」两个顶层名（Provider 外部套餐名“创作台生图组”保留为专有名词）
- [x] Chat 内引用生成历史/提示词库的措辞与各自页面一致
- [x] 已有提升动作统一为「存为提示词」；「拆到画布」由 CHT-06 独立实现

**测试场景**：
1. 正常：`test_generation_surfaces_use_canonical_terminology` 走查正式 Generate、生成历史、提示词库和设置。
2. 边界：桌面与 360×740 走查「生成偏好」「存为提示词」不溢出。
3. 异常：History 存词成功/失败与再次编辑使用新术语，原数据与跳转不变。

**质量门禁**：
- [x] `npm run check`：30 个 Vitest 文件 / 216 项通过，生产构建通过
- [x] `tests/e2e/test_08_generation_workbench.py`：10 passed（含 360×740 截图、设置分区菜单与无横向溢出）；`tests/e2e/test_06_history.py`：14 passed
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：220 passed，6 skipped（561.65 秒）
- [x] Playwright 截图走查桌面与 360×740：生成空态、生成偏好、比例轮廓和移动端自绘设置分区菜单均无文字截断或重叠

---

### <a id="task-cht-10"></a>[TASK-CHT-10] 空态 + 首启引导（无 Provider 引导 · 双入口心智）

- **状态**：✅ 已完成（2026-08-05：正式 Workbench 三态空态 + 示例即点即生）
- **优先级**：P1
- **所属大功能**：Chat
- **依赖**：TASK-CHT-07（Provider 快切）、TASK-CHT-09（文案）
- **关联**：[16-onboarding](16-onboarding-settings-data-deep-dive.md)、激活北极星「安装到首次生图 < 10 分钟」（[01](01-vision-and-ia.md) §8）
- **预估**：S

**目标**：让「探索」空态成为新用户最短生图路径的入口——无 Provider 时清晰引导连接，有 Provider 但未存密钥时引导补 Key，Provider 可用时示例卡即点即生，并 subtle 传达双入口心智（探索试方向 → 制作定稿 / 存为提示词）。

**完成记录**：正式入口在 `GenerationWorkbench.WorkbenchEmpty`，不再扩展旧 `ChatEmpty`。空态新增 `empty / missing-key / ready` 三态：无 Provider 时展示 `ProviderEmptyGuide` 并就地打开 Provider 配置；已有 Provider 但无密钥时示例卡禁用并提供「补充密钥」入口，避免制造失败回合；Provider 有密钥时 4 张示例卡直接提交当前探索/制作模式，探索默认生成 4 张。底部轻提示统一为「存为提示词 / 切到制作」，符合 CHT-09 术语。

**涉及文件**：
- `src/features/generation/workbench/GenerationWorkbench.tsx`（正式 Workbench 空态三态、示例即点即生、补密钥入口）
- `src/features/generation/components/ProviderEmptyGuide.tsx`（复用无 Provider 预设接入引导）
- `src/features/generation/store.ts`（复用 `openProviderDialog` 就地打开配置浮层，不必跳设置页——与全局一致）
- `tests/e2e/test_08_generation_workbench.py`、`tests/e2e/test_07_onboarding.py`

**IPC 契约**（已存在）：`provider:list`（判断有无 Provider）；配置走 `provider:create/saveKey/validate`（`docs/07` §3.5）。

**交互与 UI/UX**：见 §4.5 两种空态，当前实现细化为三态。无 Provider：图标 + 引导语 + 预设卡 +「添加第一个服务商」，配置浮层取消后回到原空态。有 Provider 无密钥：不显示无 Provider 预设区，示例卡禁用，主按钮「补充密钥」打开对应 Provider。Provider 可用：示例卡点击直接生成；底部 subtle 提示「试出好方向后，可以把结果存为提示词，也可以切到制作继续定稿」。

**验收标准**：
- [x] 无 Provider：显醒目引导，点击就地打开 Provider 配置浮层（或跳设置，二选一但与全局一致）
- [x] 有 Provider：4 张示例卡可点即生成
- [x] 空态含 subtle 双入口提示（提升到 Library / 切制作），不喧宾夺主
- [x] 配好 Provider 后空态即时从「引导态」转「可用态」（示例卡启用）
- [x] 配了 Provider 但未存密钥：引导补密钥而非直接生成失败
- [x] 文案符合 CHT-09 术语表

**测试场景**：
1. 正常：干净首启 → 空态引导 → 配 Provider → 点示例卡出图（贯穿激活路径）。
2. 边界：配了 Provider 但未存密钥 → 引导补密钥而非直接失败。
3. 异常：Provider 配置浮层取消 → 回到空态，无残留态。

**质量门禁**：
- [x] `npm run check`：typecheck + 30 个 Vitest 文件 / 216 项 + 生产 build 通过
- [x] `tests/e2e/test_08_generation_workbench.py`：13 passed，覆盖无 Provider 取消、无密钥补 Key、示例即点即生、探索/制作与既有 Workbench 回归
- [x] `tests/e2e/test_07_onboarding.py`：5 passed，确认首启引导与 Generate 空态补救路径不冲突
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：223 passed，6 skipped（574.93 秒）

---

### <a id="task-cht-11"></a>[TASK-CHT-11] 「探索 vs 制作」差异化

- **状态**：✅ 已完成（实际以 Workbench 的模式、默认值、结果布局和操作差异实现；旧 subtle callout 方案不再单独存在）
- **优先级**：P2
- **所属大功能**：Chat
- **依赖**：TASK-CHT-02（tab 就位）、TASK-CHT-09（文案）
- **预估**：S

**目标**：让用户通过真实交互理解「探索 ≠ 制作」：探索用于发散和比较，制作用于控制参数和定稿，不依赖额外说明气泡。

**涉及文件**：
- `src/features/chat/components/ChatView.tsx` / 「快速」tab 容器（加一处可关闭的 subtle 提示条或首次气泡）
- 首次可见后写 `localStorage` 标记，不反复打扰

**IPC 契约**：无。

**交互与 UI/UX**：首次进「快速」tab（或首次成功生成后）显一条可关闭的 subtle 提示：「快速适合即兴试图；想复用/加权重/切模型语法，试试『精修』或把好词『存为提示词』。」关闭后不再显（`localStorage`）。不用弹窗、不阻断。

**验收标准**：
- [x] 探索/制作不依赖一次性 callout，而以默认数量、参数密度、结果布局和回合动作形成真实差异
- [x] 探索默认 4 张、制作默认 1 张，且两组偏好分别持久化
- [x] 探索结果提供「采用此方向制作」，制作结果提供「探索相似方向」
- [x] 视觉克制，不额外弹出阻断式引导，也不遮挡消息流

**测试场景**：
1. 正常：首次显示 → 关闭 → 刷新不再显。
2. 边界：清 `localStorage` 后重新显示（符合预期）。
3. 异常：`localStorage` 不可用时降级为「本会话内不再显」，不报错。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Workbench E2E 验证探索/制作默认值、布局、跨模式动作与设置持久化

---

## 6. 依赖关系图

```
CHT-01(核心打磨) ─┬─→ CHT-02(收敛为「快速」tab) ─┬─→ CHT-06(拆到画布🆕) ──关联→ 11-composer
                  │        │                      ├─→ CHT-09(文案统一) ─→ CHT-10(空态引导) ─→ CHT-11(差异callout)
                  │        └──联合改造──→ 12-generation（Generate 工作区 + 精修 tab）
                  ├─→ CHT-03(取消/重试对齐) ──对齐──→ 12-generation（AbortController/image:cancel）
                  └─→ CHT-07(Provider/参数快切)

CHT-04(Lightbox/图片操作)  独立（system:openInFolder）
CHT-05(存为 Prompt) ──关联→ 10-library（createPrompt）
CHT-08(持久化决策/结果不丢) ──对账──→ 13-history（结果账本）

跨文档联合点：
  · CHT-02 ⇄ 12-generation：Generate 工作区壳 + 快速/精修 tab（谁先落地谁建容器）
  · CHT-03 ⇄ 12-generation：共用 jobId + image:cancel 语义，勿各写一套
  · CHT-05 → 10-library / CHT-06 → 11-composer：两条「提升」通道
  · CHT-08 ⇄ 13-history：Chat 为 History 的产出源之一，非独立持久层
```

**认领建议**：先 CHT-01（基线）→ CHT-02（收敛，与 12 协调）→ 并行 CHT-03/04/05/07 → CHT-08/09 → CHT-06/10/11。

---

## 7. 大功能验收（对照 docs/05 + 本设计 + 红线）

**核心生图（保持达标）**
- [x] 快速生图核心：多图逐张点亮、参数快照正确、键盘交互严谨（CHT-01）
- [x] 取消生效并写 History，单张可重试，与 studio 共用 jobId/cancel（CHT-03 · docs/05 §5.2/§5.4）
- [x] Lightbox 放大 + 另存 + 在文件夹打开 + broken 兜底，图片走 media://（CHT-04）

**收敛（P1 主改造）**
- [x] Chat 收敛为 Generate 工作区「探索」tab，与「制作」并列，共用同一引擎（CHT-02）
- [x] Sidebar 只有一个 Generate 顶层，`ChatPage` 不再错渲染 StudioView（CHT-02）
- [x] Provider/参数快切内联，两 tab 共享激活 Provider（CHT-07）

**提升通道（红线闭环）**
- [x] Chat 消息「存为提示词」→ Library（source=manual），有 toast + 查看跳转、无重复入库（CHT-05）
- [x] Chat 消息「拆到画布」→ Composer 初始 body，单向流转，正文/负面/参数预填（CHT-06）

**心智与文案**
- [x] 会话默认 transient，但每次生成必进 History；「清空」不丢结果，文案不误导（CHT-08）
- [x] Chat/History/Library/空态术语统一，无「对话生图 vs 创作台」双顶层名（CHT-09）
- [x] 无 Provider 引导 + 有 Provider 示例即点即生，贯穿「10 分钟激活」（CHT-10）
- [x] subtle「探索 vs 制作」提示引导上探主路径，不打扰（CHT-11）

**安全红线（不可退）**
- [x] 生成只传 `providerId`，明文 key 永不过渲染进程 / 不入下拉 / 不进日志（docs/05 §4.2）
- [x] 收敛与快切均未引入渲染层读取/缓存 key 的捷径

**产品红线自检**
- [x] Chat 每一处有价值产物都有「提升」出口（存词 / 拆画布 / 进 History）
- [x] Chat 未被做成长期会话库、未吞掉主路径——它是「快速入口」，不是「归宿」
