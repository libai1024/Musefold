# 创作台重构开发文档：探索与制作

**版本**：v1.1
**日期**：2026-08-04
**状态**：✅ 已实现并完成无真实 API 验收（2026-08-04）；2026-08-05 补齐头部当前会话标题（首个回合提示词派生，新会话重置为「新创作」）并将 Workbench 专项扩到 17 passed；2026-08-06 真实 TvT 生图验收已通过；同日完成 Composer 输入优先、比例卡片、生成完成态动作、设置页去重、命令面板定位、推荐词随机池、历史「再次制作」回填、固定参数槽位收口，以及提示词引用与作品关联闭环。
**适用范围**：Generate 创作台前端、生成任务编排、历史记录衔接、Library/Composer/History 跨入口联动

## 1. 文档目标

本文件定义 Generate 创作台的目标产品形态、前后端架构、交互规则、代码迁移范围和测试验收标准，作为后续实现的唯一执行依据。

本次重构解决以下问题：

- 当前“快速”和“精修”两个模式的差异不足，用户无法理解何时使用哪个模式。
- Studio、Generation、Chat 存在三套相互独立的状态和生成逻辑，功能容易不一致。
- 当前生成结果主要以面板和网格呈现，无法像 ChatGPT 一样连续回看当前会话。
- 模式切换、历史记录、生成结果操作和跨页面进入创作台的行为缺乏统一模型。
- 旧 Chat 代码已经包含较好的对话式交互，但它没有接入当前主路由，继续保留会形成第四套行为来源。

本次重构不改变供应商适配器的核心能力，不重新设计 Library、Composer、History 的业务页面，而是统一它们进入 Generate 的方式。

## 2. 已确认的产品决策

以下决策已经由产品需求确认，后续实现不应再次引入相反的行为：

| 项目 | 决策 |
| --- | --- |
| 当前会话历史 | 创作台中显示可向上滚动的当前会话时间线 |
| 两种模式关系 | 使用同一个会话，时间线中的每个回合保存当时使用的模式 |
| 模式切换位置 | 顶部居中，使用 Segmented Control |
| 输入区 | 底部固定 Composer，支持展开更多设置 |
| 探索默认出图数 | 4 张 |
| 制作默认出图数 | 1 张 |
| 全局历史 | 保留 History 页面，作为所有已落库图片的持久记录 |
| 旧 Chat 实现 | 保留可复用的视觉和交互思路，废弃独立 Chat store 和独立生成流程 |
| 当前会话持久化 | v1 不增加 Conversation 数据表；应用重启后从全局 History 进入，不自动恢复内存会话 |

## 3. 现有代码审计结论

### 3.1 当前路由与页面

`src/App.tsx` 当前只注册以下页面：

```ts
generate
library
composer
history
settings
```

`src/pages/ChatPage.tsx` 虽然存在，但没有被主路由使用。`features/chat/*` 是并行实现，不能作为新功能继续扩展。

### 3.2 当前 Generate 结构

`src/pages/GeneratePage.tsx` 当前使用：

- `quick`：渲染 `src/features/studio/StudioView.tsx`
- `refine`：渲染 `src/features/generation/GeneratePanel.tsx`
- 顶部 Provider 选择器
- 当前模式独立清空按钮

当前两个模式分别持有状态：

- `src/features/studio/store.ts`
- `src/features/generation/store.ts`

这导致模式之间无法自然形成一个会话时间线，也导致参数、取消、重试、历史落库等行为存在重复实现。

### 3.3 旧 Chat 的可复用部分

`src/features/chat/*` 中值得保留的不是它的状态模型，而是以下交互形态：

- `ChatView.tsx` 的消息时间线布局。
- `ChatComposer.tsx` 的底部输入框、自动增高、Enter 发送和 Shift+Enter 换行。
- `MessageBubble.tsx` 的用户输入和助手结果分组呈现。
- 结果组下方的复制、保存、重新生成等操作位置。
- 空状态中的示例提示词入口。

不应继续使用：

- `src/features/chat/store.ts` 的独立消息和生成状态。
- Chat 自己的 `size/quality/n` 设置模型。
- Chat 自己的生成、重试和 Provider 解析逻辑。
- `ChatPage.tsx` 作为另一个正式入口。

### 3.4 跨页面入口迁移结果

正式入口已经统一调用 Workbench API：

- Library 的 PromptDetail：通过 `useGenerationWorkbenchStore.openDraft({ mode: 'produce' })` 进入制作，并保留提示词来源。
- Composer 的 PreviewPanel：先保存 Composition 快照，再通过 `openDraft` 进入制作，并保留 target 感知渲染来源。
- HistoryDetail：通过 `openDraft` 进入制作或探索，并保留历史来源与参数快照；原记录重试仍走 History store。
- CommandPalette：通过 `setGenerationMode('explore' | 'produce')` 进入统一生成工作区。
- PromptList 空状态：进入统一 Generate 工作区的探索模式。
- `src/lib/test-hook.ts`：正式测试钩子暴露 `generation`（Provider/兼容 API）和 `workbench`（会话事实源），不再暴露 `studio`。

`generation/store.ts` 的旧 `requestRefine`、`refineParams`、结果状态和生成动作已删除。当前它只负责 Provider 配置、密钥、模型和连通性测试；生成草稿、回合、取消和重试全部由 `generation/workbench/store.ts` 管理。

### 3.5 后端现状

当前生成链路为：

```text
renderer
  -> preload API
  -> IMAGE_GENERATE
  -> electron/main/ipc/images.ts
  -> provider adapter
  -> history table
```

现有 `GenerateImageRequest` 已经支持：

- providerId、jobId、model
- prompt、negative
- size、aspectRatio、quality、n
- background、moderation
- promptId、compositionId

当前 History 表已经记录每一张图片的提示词、参数、Provider、状态、图片路径、成本和耗时，但没有明确记录生成模式或父结果关系。

## 4. 产品模型

### 4.1 核心心智模型

Generate 不再被理解为两个互相独立的页面，而是一个持续的创作会话：

- **探索**：快速提出方向，批量观察可能性，默认生成 4 张。
- **制作**：基于明确方向控制参数，输出最终版本，默认生成 1 张。

两个模式共享一条会话时间线，但每个回合记录自己的模式、参数快照、来源和结果。模式切换不会清空时间线，也不会隐式修改历史回合。

用户可以通过显式动作跨模式：

```text
探索结果 -> 采用此方向制作 -> 制作
制作结果 -> 探索相似方向 -> 探索
Library Prompt -> 制作
Composer 预览 -> 制作
History 记录 -> 按原参数制作 / 探索相似方向
```

### 4.2 探索和制作的真正差异

| 维度 | 探索 | 制作 |
| --- | --- | --- |
| 目标 | 发散、比较、寻找方向 | 收敛、控制、定稿 |
| 输入 | 轻量提示词 | 提示词、负面提示词、来源、完整参数 |
| 默认数量 | 4 | 1 |
| 参数展示 | 只展示高频参数 | 展示完整参数和高级选项 |
| 结果布局 | 四张结果为一个方向组 | 单张或少量结果为一个制作回合 |
| 主要动作 | 继续探索、采用方向制作 | 再次制作、复制参数、查看历史 |
| 参考图 | 仅在 Provider 能力明确支持时开放 | 作为制作来源能力逐步开放 |
| 成功标准 | 快速得到可比较的视觉方向 | 得到可交付或可继续编辑的结果 |

探索不应只是“制作模式把 n 改成 4”，制作也不应只是“探索模式把 n 改成 1”。两者必须在信息密度、默认参数、结果动作和跨模式动作上体现不同目标。

## 5. 信息架构与 UI 设计

### 5.1 页面结构

```text
┌────────────────────────────────────────────────────────────┐
│  生成                         [ 探索 | 制作 ]   Provider  ⋯ │  Header
├────────────────────────────────────────────────────────────┤
│                                                            │
│                当前会话时间线 / 结果回合                    │  Scroll
│                                                            │
│  用户输入                                                   │
│  助手结果组                                                  │
│  回合操作                                                   │
│                                                            │
│                         ...                                  │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  [来源]  描述你想生成的内容...                    [发送/生成] │  Composer
│          [比例] [质量] [数量] [更多设置]                     │
└────────────────────────────────────────────────────────────┘
```

页面整体接近 ChatGPT 主界面：中心是纵向对话流，底部是固定输入区，顶部只放全局上下文和模式控制，不再使用左右双栏作为主要信息结构。

### 5.2 Header

左侧：

- 页面标题“生成”。
- 当前会话标题，默认使用第一条用户输入的截断文本；没有输入时显示“新创作”。

中央：

- `探索` / `制作` Segmented Control。
- 两个按钮必须有 `aria-pressed` 和清晰的 active 状态。
- 切换模式只改变下一次输入的默认行为，不修改已经生成的历史回合。
- 切换时如果 Composer 中已有未发送内容，内容必须保留。

右侧：

- 当前 Provider 选择器。
- 新建会话按钮，使用图标按钮并配置 tooltip。
- 当前存在运行中任务时显示取消或任务状态，不允许新建会话静默丢弃任务。

Provider 只保留一个可信入口。不得同时保留 Generate Header 和 StudioSettings 中两个互相独立的 Provider 选择器。

### 5.3 会话时间线

时间线是当前会话的主区域：

- 纵向滚动。
- 进入页面后自动定位到最新回合。
- 新回合开始时滚动到底部。
- 用户向上阅读时不强制抢回滚动位置；有新结果时显示“回到最新”按钮。
- 保留底部 padding，避免最后一个结果被 Composer 遮挡。
- 空状态显示示例提示词，但不使用大型营销 Hero。

建议宽度：

| 窗口宽度 | 时间线最大宽度 | Composer 行为 |
| --- | --- | --- |
| `>= 1200px` | 840px | 居中，设置弹层从底部输入区展开 |
| `900-1199px` | 720px | 居中，设置弹层限制在窗口内 |
| `< 900px` | 100% 减左右 16px | 更多设置使用底部 Sheet |

### 5.4 用户输入回合

用户回合显示：

- 原始提示词。
- 来源标签，例如“来自 Library”“来自 Composer”“来自历史记录”。
- 当时使用的模式标签“探索”或“制作”。
- 发送时的关键参数摘要，不默认展开全部 JSON。

用户回合必须是不可变快照。后续修改 Composer 不得改变已经显示的历史回合。

### 5.5 结果组

一个回合可以包含一个或多个结果项：

- 探索回合默认显示 2x2 网格。
- 制作回合默认显示单列或宽图，避免单张结果被挤成缩略图。
- Pending、Success、Failed、Cancelled 必须在结果项内有稳定尺寸，不能因为状态切换导致网格跳动。
- 失败结果显示重试，且重试使用原回合的 Provider、参数和提示词快照。
- 取消结果显示“已取消”，允许基于原回合再次制作。

结果组底部提供与模式对应的主要动作：

探索：

- `继续探索`：复用提示词，保持探索模式。
- `采用此方向制作`：将选中结果的提示词和可用来源带入制作模式。
- `保存提示词`。
- `下载`、`复制路径`、`查看历史`。

制作：

- `再次制作`：复用当前回合快照。
- `探索相似方向`：将提示词带入探索模式。
- `保存提示词`。
- `下载`、`复制路径`、`查看历史`。

参考图或图生图能力只有在当前 Provider 明确支持时才显示。不能显示一个点击后无效的“参考图”按钮。

### 5.6 底部 Composer

Composer 固定在页面底部，但不覆盖时间线内容。结构如下：

```text
┌─────────────────────────────────────────────────────┐
│ [来源标签]                                           │
│ 描述你想探索/制作的内容...                            │
│                                                     │
│ [比例] [质量] [数量] [更多设置]                 [生成] │
└─────────────────────────────────────────────────────┘
```

交互规则：

- 输入框自动增高，有最大高度，超过后内部滚动。
- Enter 发送；Shift+Enter 换行。
- 输入为空时主按钮禁用。
- 任务运行中主按钮变为取消，不能重复提交同一个 Composer。
- Composer 内容在模式切换时保留。
- 发送后立即创建用户回合和 Pending 结果组，用户可以看到任务已经开始。
- 生成完成后清空输入框，但保留最近一次设置。
- 当前来源存在时显示 Source Chip，可一键移除来源。

### 5.7 更多设置

更多设置必须根据当前模式动态展示，不使用一个含义模糊的巨大表单。

探索设置：

- 数量，默认 4，可选 Provider 支持的数量。
- 比例。
- 质量，默认使用探索偏好。
- 背景等常用选项。
- 负面提示词放入折叠区。

制作设置：

- 数量，默认 1。
- 比例。
- 质量。
- 负面提示词。
- 背景、审核、模型等高级设置。
- 来源和来源参数摘要。

设置展开和关闭不应清空用户输入。设置修改只影响下一次提交。

### 5.8 Settings 页面

现有 `GenerationSection.tsx` 不应继续把 Studio 和 Refine 设置混成一组。改为两个偏好分组：

- 探索偏好：默认数量 4、默认比例、默认质量、默认背景。
- 制作偏好：默认数量 1、默认比例、默认质量、默认背景、默认高级选项。

一次提交时的真实参数必须优先级最高；页面偏好只作为默认值。历史重试永远优先使用历史回合快照，不得被当前设置覆盖。

## 6. 交互流程

### 6.1 新会话

1. 用户点击新建会话。
2. 如果没有运行中的任务，清空当前内存时间线、Composer 来源和输入内容。
3. 如果有运行中的任务，弹出确认，明确提示任务是否取消。
4. 新会话不会删除 History 中已经落库的图片。
5. 默认进入探索模式；如果产品后续确认需要记忆上次模式，可以作为独立偏好增加，不能隐式从旧回合推断。

### 6.2 探索流程

1. 用户在顶部选择探索。
2. 输入简单方向描述。
3. Composer 显示轻量参数，数量默认 4。
4. 提交后创建一个探索回合和四个 Pending 结果项。
5. 每个结果项独立更新状态。
6. 用户可从结果组中选择一张，点击“采用此方向制作”。

### 6.3 制作流程

1. 用户切换到制作，或通过跨模式动作进入制作。
2. Composer 展示来源、比例、质量和更多设置。
3. 数量默认为 1。
4. 提交后创建制作回合。
5. 结果操作以再次制作、探索相似方向、历史记录为主。

### 6.4 探索到制作

选择“采用此方向制作”时：

- 切换到制作模式。
- 复制原回合提示词、负面提示词和可兼容参数。
- 如果当前 Provider 支持参考图，带入选中的图片作为 source image。
- 如果不支持，不能假装带入图片；只带入文本和参数，并在 Source Chip 中准确标注。
- 不立即发起生成，等待用户确认和修改后提交。
- 记录 `parentHistoryId` 或 renderer 内的父结果 ID，以便历史链路可追踪。

### 6.5 制作到探索

选择“探索相似方向”时：

- 切换到探索模式。
- 带入原回合提示词和兼容参数。
- 数量切换为探索默认值 4。
- 不自动生成，用户可以修改提示词后提交。

### 6.6 Library、Composer、History 进入创作台

Library：

- “生成”统一进入制作模式。
- 传入 Prompt ID、提示词和负面提示词。

Composer：

- 预览面板“生成”统一进入制作模式。
- 传入 Composition ID；如果存在外键生命周期风险，至少传入可靠的显示来源标签，并在后端不写入失效 ID。

History：

- “再次制作”进入制作模式，完整回填历史提示词、负面提示词、Provider 和参数；不自动提交，用户手动确认。
- 仅失败记录的错误恢复按钮调用已有 retry 语义。
- 新增“探索相似方向”时进入探索模式，数量使用探索默认值，不覆盖原历史记录。

## 7. 前端架构设计

### 7.1 目标目录

建议新增：

```text
src/features/generation/workbench/
  types.ts
  store.ts
  selectors.ts
  components/
    GenerationWorkbench.tsx
    GenerationHeader.tsx
    ModeSwitch.tsx
    GenerationTimeline.tsx
    GenerationTurn.tsx
    GenerationResultGroup.tsx
    GenerationResultItem.tsx
    GenerationComposer.tsx
    GenerationOptionsPopover.tsx
    GenerationSourceChip.tsx
    GenerationEmpty.tsx
    GenerationResultActions.tsx
```

目标原则：

- Workbench store 负责会话时间线、Composer 草稿、回合快照和任务关联。
- 现有 generation store 暂时继续负责 Provider 列表、Provider CRUD 和底层生成调用，避免一次性重写全部基础能力。
- Studio store 和 Chat store 不再作为业务事实来源。
- 最终所有模式都通过一个 Workbench 提交入口调用统一的 generation service。

### 7.2 类型模型

建议在 `src/features/generation/workbench/types.ts` 定义：

```ts
export type GenerationMode = 'explore' | 'produce'

export type GenerationSource =
  | { kind: 'manual' }
  | { kind: 'prompt'; id?: string; label: string }
  | { kind: 'composition'; id?: string; label: string }
  | { kind: 'history'; id: string; label: string }
  | { kind: 'exploration'; historyId?: string; resultId: string; label: string }

export type GenerationTurnStatus =
  | 'pending'
  | 'running'
  | 'partial'
  | 'success'
  | 'failed'
  | 'cancelled'

export interface GenerationTurn {
  id: string
  mode: GenerationMode
  prompt: string
  negativePrompt: string
  source: GenerationSource
  providerId: string | null
  params: RefineParams
  status: GenerationTurnStatus
  resultIds: string[]
  parentHistoryId?: string
  createdAt: number
  completedAt?: number
}
```

说明：

- `params` 必须是提交时的不可变快照。
- `providerId` 必须记录实际使用的 Provider，不使用提交后当前激活 Provider 反推。
- `resultIds` 允许探索回合包含多个结果。
- `parentHistoryId` 是可选关联，旧数据为空是合法状态。
- 当前会话只保存上述结构，重启后不要求自动恢复。

### 7.3 Store 责任

建议 `useGenerationWorkbenchStore` 至少包含：

```ts
mode: GenerationMode
turns: GenerationTurn[]
draftPrompt: string
draftNegativePrompt: string
draftSource: GenerationSource | null
draftParams: RefineParams
runningTurnIds: string[]
activeTurnId: string | null
isNearLatest: boolean
```

核心 action：

```ts
setMode(mode)
setDraftPrompt(value)
setDraftNegativePrompt(value)
setDraftSource(source)
setDraftParams(params)
submitDraft()
cancelTurn(turnId)
retryTurn(turnId)
continueExplore(turnId)
promoteToProduce(turnId, resultId)
exploreSimilar(turnId, resultId)
newSession()
scrollToLatest()
```

`submitDraft` 是唯一创建新回合的入口。按钮、快捷键、示例提示词和跨页面回填都必须最终调用它，而不是直接调用某个模式自己的 `generate`。

### 7.4 Provider 解析规则

Provider 的解析顺序统一为：

1. 历史重试：使用历史记录中的原 Provider。
2. 显式传入的 Provider：使用显式值。
3. 当前用户选择的 Provider。
4. 默认 Provider。
5. 没有可用 Provider 时返回结构化错误，不发起空请求。

重试时不能使用“当前 active provider”覆盖历史记录里的 Provider。现有 Studio `retry` 逻辑需要重点检查并修正。

### 7.5 现有组件迁移策略

可以复用：

- ChatComposer 的输入行为和布局思路。
- MessageBubble 的用户回合与结果回合渲染思路。
- StudioResultCard 和 GenerateResultCard 的结果操作，但需要统一为 `GenerationResultItem`。
- 现有 ImageLightbox，前提是确认没有重复实现。

需要改造：

- `GeneratePage.tsx` 改为 Workbench 页面壳。
- `StudioView.tsx` 不再作为 quick 模式独立页面，逐步拆成探索设置和结果组组件。
- `GeneratePanel.tsx` 不再作为精修独立双栏页面，逐步拆成制作参数和结果组组件。
- `GenerationSection.tsx` 改成探索偏好和制作偏好。
- `CommandPalette.tsx` 的命令指向统一 `setMode` 和 `setView('generate')`。

需要废弃：

- `src/features/chat/store.ts`。
- `src/pages/ChatPage.tsx` 作为正式页面入口。
- Chat 中独立的生成和重试逻辑。
- Studio 中独立的提交和重试逻辑。

旧文件在迁移完成前可以保留，但禁止新增业务功能。待无引用、测试迁移完成后删除，避免一边开发一边维护两套行为。

## 8. 后端与 IPC 设计

### 8.1 v1 原则

第一阶段不增加 Conversation 表，也不新增一组 Chat IPC。原因是：

- 当前会话需求可以由 renderer 内存时间线满足。
- History 已经是图片级持久记录。
- 新增会话表会引入标题、归档、排序、恢复、迁移和清理等额外产品范围。
- 当前主要问题是前端模式和生成链路分裂，不是数据库缺少会话表。

### 8.2 共享请求类型

在 `shared/types/providers.ts` 中扩展：

```ts
export type GenerationMode = 'explore' | 'produce'

export interface GenerateImageRequest {
  // existing fields...
  generationMode?: GenerationMode
  parentHistoryId?: string
}
```

字段要求：

- 两个字段均为可选，兼容旧调用方和旧 History 数据。
- `generationMode` 只接受 `explore` 或 `produce`。
- `parentHistoryId` 必须是字符串且不能为空字符串。
- Provider adapter 不需要理解这两个字段，应由 IPC 层消费并从发给 Provider 的参数中排除。

### 8.3 `images.ts` 处理规则

`electron/main/ipc/images.ts` 应：

1. 校验可选的 mode 和 parentHistoryId。
2. 生成 History 时保存 mode 和 parentHistoryId。
3. 保持现有 jobId、AbortController、成功/失败/取消落库行为。
4. Retry 时从原 History 恢复 mode、parentHistoryId、Provider、提示词和参数。
5. 所有错误仍使用现有结构化 IPC 错误，不向 renderer 返回裸异常字符串。

### 8.4 History 存储方案

建议分两个阶段实现：

#### 阶段一：向后兼容的 JSON 元数据

先将新字段放入已有 `params` JSON：

```json
{
  "schemaVersion": 2,
  "ratioId": "1:1",
  "quality": "medium",
  "n": 1,
  "generationMode": "produce",
  "parentHistoryId": "..."
}
```

同时在 `HistoryRecord` 映射层派生：

```ts
generationMode?: GenerationMode
parentHistoryId?: string
```

优点是不用马上新增迁移，旧记录自然得到 `undefined`，可以先验证产品使用和历史详情 UI。

#### 阶段二：需要历史筛选或链路视图时再增加列

如果后续要按探索/制作筛选、统计成本或展示父子链路，再新增 migration `0005`：

```sql
ALTER TABLE history ADD COLUMN generation_mode TEXT;
ALTER TABLE history ADD COLUMN parent_history_id TEXT;
```

迁移必须注册到 `electron/system/migrations.ts`，并补充已有数据库和空数据库测试。不要为了第一版 UI 提前引入无法使用的数据库复杂度。

### 8.5 IPC 和 Preload

第一阶段复用已有：

- `image.generate`
- `image.cancel`
- `image.retry`
- `history.list`
- `history.get`

如请求类型变化，需要同步检查：

- `shared/types/ipc.ts`
- `shared/types/providers.ts`
- `electron/preload/index.ts` 或对应 preload bridge
- `electron/main/ipc/images.ts`
- renderer API 类型封装
- mock API 和测试 fixture

不新增 Chat 专用 IPC。模式只是生成请求的产品语义，不是另一种后端服务。

### 8.6 Provider 与成本

本次重构不修改：

- OpenAI-compatible Provider 的请求格式。
- Wukong Studio Provider 的请求格式。
- Keychain、密钥校验和 Provider CRUD。
- 成本计算规则。

探索默认 4 张会自然产生 4 次或 Provider 支持的批量成本，UI 必须显示真实生成数量和任务状态，不能把“探索”宣传成低成本模式。

## 9. 详细文件改动清单

### 9.1 前端必须检查或改动

| 文件 | 改动 |
| --- | --- |
| `src/pages/GeneratePage.tsx` | 改为统一 Workbench 壳，移除双面板主结构 |
| `src/stores/app.ts` | 将 `quick/refine` 迁移为 `explore/produce`，保留兼容映射直到测试迁移完成 |
| `src/features/generation/store.ts` | 只保留 Provider 生命周期、密钥、模型和连通性测试 |
| `src/features/generation/params.ts` | 增加模式默认值、快照转换和来源兼容处理 |
| `src/features/generation/GeneratePanel.tsx` | 已删除；制作参数与结果组已迁入 Workbench |
| `src/features/studio/store.ts` | 已删除；探索/制作正式会话状态统一由 Workbench store 承担 |
| `src/features/studio/StudioView.tsx` | 已删除；不再作为整页或模式组件渲染 |
| `src/features/chat/store.ts` | 已删除；探索能力由 Workbench store 承担 |
| `src/features/chat/components/ChatComposer.tsx` | 已删除；输入交互由 Workbench Composer 承担 |
| `src/features/chat/components/MessageBubble.tsx` | 已删除；回合/结果渲染由 Workbench Timeline 承担 |
| `src/pages/ChatPage.tsx` | 已删除；不再作为正式或兼容入口 |
| `src/features/settings/sections/GenerationSection.tsx` | 拆分探索/制作偏好 |
| `src/features/library/components/PromptDetail.tsx` | 统一进入制作模式 |
| `src/features/composer/components/PreviewPanel.tsx` | 统一进入制作模式，传递来源 |
| `src/features/history/components/HistoryDetail.tsx` | 区分原参数重试、再次制作、探索相似方向 |
| `src/features/history/refine.ts` | 适配新的制作回填参数和模式 |
| `src/features/library/components/PromptList.tsx` | 空状态直接打开统一 Workbench |
| `src/components/command/CommandPalette.tsx` | 更新模式命令和文案 |
| `src/lib/test-hook.ts` | 暴露 Workbench store，逐步移除 studio/chat store |
| `src/features/generation/__tests__/*` | 增加模式、来源、Provider 和快照测试 |
| `tests/e2e/test_04_generate.py` | 迁移为统一创作台端到端测试 |

### 9.2 后端必须检查或改动

| 文件 | 改动 |
| --- | --- |
| `shared/types/providers.ts` | 增加 GenerationMode 和可选元数据字段 |
| `shared/types/models.ts` | HistoryRecord 增加可选模式和父记录字段 |
| `shared/types/ipc.ts` | 确认 image generate/retry 类型同步 |
| `electron/main/ipc/images.ts` | 校验、落库、重试恢复新元数据 |
| `electron/main/ipc/history.ts` | 映射新字段，兼容旧 params |
| `electron/db/json.ts` | 如由此处负责 params 序列化，增加 schemaVersion 兼容处理 |
| `electron/system/migrations.ts` | 只有阶段二需要新增 0005 |
| `electron/providers/openai-compatible.ts` | 确认不会把产品元数据发给 Provider |
| `electron/providers/wukong-studio.ts` | 同上，原则上不改业务逻辑 |
| preload bridge | 请求类型变化时同步透传 |

## 10. 实现顺序

每一步完成后都必须先通过该步骤的测试，再进入下一步。

### Step 0：冻结边界并补类型

- 新增 Workbench 类型和模式枚举。
- 为旧 `quick/refine` 增加兼容映射，避免一次性改爆所有调用方。
- 定义探索和制作默认参数。
- 明确 `GenerationTurn` 的不可变快照。

验收：TypeScript 类型检查通过，原有 Generate 和测试不回归。

### Step 1：建立统一 Workbench store

- 实现时间线、Composer 草稿、来源、模式、回合状态。
- 先使用现有 image.generate 能力，不改 UI。
- 实现提交、取消、重试、创建新会话。

验收：store 单元测试覆盖模式切换、草稿保留、回合快照、取消和失败。

### Step 2：实现 ChatGPT 风格页面骨架

- Header 居中模式切换。
- 可滚动时间线。
- 底部 Composer。
- 空状态和最新位置控制。

验收：桌面和窄窗口布局无重叠，输入框、发送、模式切换和滚动行为可用。

### Step 3：接入探索和制作视觉差异

- 探索结果组默认 4 张，轻量设置。
- 制作结果组默认 1 张，展开高级设置。
- 合并结果操作、Pending、Failed、Cancelled 状态。

验收：两个模式的界面、默认值、结果动作和参数展示清晰可区分。

### Step 4：迁移跨页面入口

- Library、Composer 进入制作。
- History 区分按原参数重试、再次制作和探索相似方向。
- Command Palette 更新。

验收：每个入口都能打开正确模式，来源和参数没有丢失。

### Step 5：补后端元数据

- 在请求中传递 generationMode 和 parentHistoryId。
- 先写入 params JSON。
- History 读取和 retry 可恢复。

验收：成功、失败、取消、重试都保留正确的模式和父级信息；旧历史记录仍可打开。

### Step 6：废弃旧实现

- 已删除 Chat store、ChatPage、Studio 独立生成 store、旧页面组件与 `GeneratePanel`。
- `src/stores/app.ts` 的 `quick/refine` 映射仍用于旧测试与持久化兼容，不能在没有迁移验证前直接移除。
- Library、History、Composer 已直接调用 Workbench `openDraft`；`tests/e2e/test_04_generate.py` 的旧生成契约已整体迁成 Workbench 状态和行为断言，旧 `generation/store` 生成字段、动作与 Workbench legacy bridge 已删除。

验收：`rg` 检查旧入口不存在业务调用；Library、History、Composer、Workbench 回归通过。当前 `studio/store`、`stores.studio`、`generation/store` 旧生成 API 引用已清零，`generation/store` 只剩 Provider 管理。

### Step 7：同步产品文档

至少同步：

- `docs/product/10-library-deep-dive.md`
- `docs/product/12-generation-deep-dive.md`
- `docs/product/13-history-deep-dive.md`
- `docs/product/14-chat-deep-dive.md`
- `docs/product/17-uiux-patterns.md`
- `docs/product/90-roadmap-and-task-index.md`
- `docs/product/README.md`

文档必须反映实际实现，不得继续描述“快速=Chat、精修=Studio”等过期模型。

## 11. 测试方案

### 11.1 单元测试

必须覆盖：

- `explore` 默认数量为 4。
- `produce` 默认数量为 1。
- 模式切换不清空 Composer 草稿。
- 模式切换不修改既有回合。
- 提交时保存参数和 Provider 快照。
- History 重试使用原 Provider，而不是当前 active Provider。
- 探索结果进入制作时复制正确提示词、来源和父级结果。
- 制作结果进入探索时使用探索默认数量。
- 新会话清空 renderer 时间线但不删除 History。
- 取消、部分成功、失败和重试状态。
- 旧 History 没有模式字段时仍能正常显示。
- 设置页面修改默认值不覆盖历史回合。

### 11.2 组件测试

必须覆盖：

- 顶部模式切换 active 状态和无障碍属性。
- Empty State 示例提示词填入 Composer。
- Composer Enter/Shift+Enter 行为。
- 运行中任务按钮变为取消。
- 上翻历史时不被新结果强行滚到底部。
- “回到最新”按钮显示和点击行为。
- 探索和制作的设置项不同。
- 结果卡片状态尺寸稳定，失败和取消不改变布局。

### 11.3 Electron E2E

建议在 `tests/e2e/test_04_generate.py` 中重构或拆分为以下场景：

1. 打开 Generate，确认顶部居中模式切换。
2. 空状态示例提示词进入 Composer。
3. 探索生成 4 张，结果组和操作出现。
4. 切换制作，确认 Composer 内容和已有时间线保留。
5. 制作生成 1 张。
6. 探索结果“采用此方向制作”。
7. 制作结果“探索相似方向”。
8. 上翻当前会话后生成新结果，确认不强制跳到底部。
9. 取消运行中的任务。
10. Provider 错误和重试。
11. Library 进入制作并保留 Prompt 来源。
12. Composer 进入制作并保留 Composition 来源。
13. History 再次制作和探索相似方向；失败记录保留独立重试。
14. 新建会话不删除全局 History。
15. 应用重启后全局 History 仍可看到已落库结果。

### 11.4 执行顺序

按照项目现有规则执行：

```text
npm run typecheck
针对性 Vitest
npm run build
针对性 Electron E2E
npm run check
涉及共享生成、数据库或安全时再跑完整 E2E
```

当前交接记录中已有 onboarding 测试和 Vitest localStorage 兼容问题，创作台重构不得将这些未闭环测试宣称为已通过。每次报告必须区分：本次新增测试、已有基线测试、未运行或仍失败的测试。

## 12. 非功能要求与安全边界

- Renderer 不直接访问 Node、文件系统、数据库或 Provider 密钥。
- 新增字段必须经过 shared types、preload 和 main IPC 的完整链路。
- Provider 元数据不得泄露给不需要它的第三方请求。
- 取消任务必须继续使用现有 AbortController 和 jobId 机制。
- 失败和取消必须落库或沿用现有 History 语义，不能只留 renderer 假状态。
- 所有图片路径、复制路径和打开目录能力继续走现有安全 API。
- 不通过 localStorage 保存完整生成结果或密钥；只保存轻量偏好。
- 任何 UI 按钮都必须对应真实能力，Provider 不支持的能力不显示为可用按钮。
- 不能通过删除数据库、清空 History 或重置用户设置来解决迁移问题。

## 13. 验收标准

本重构完成的最低标准：

- Generate 只有一个统一创作台，没有可达的独立 Chat 页面。
- 顶部居中显示探索/制作模式切换。
- 两种模式在目标、默认数量、参数密度和结果操作上有明显差异。
- 当前会话支持向上翻阅，且回合包含用户输入、模式、参数和结果。
- 探索默认 4 张，制作默认 1 张。
- 模式切换不会丢失 Composer 输入或既有时间线。
- 探索结果可以显式进入制作，制作结果可以显式进入探索。
- Library、Composer、History、Command Palette 都接入统一 Workbench。
- 取消、失败、重试、Provider 选择和历史记录行为一致。
- 旧 Chat store、Studio 独立生成逻辑不再作为业务事实来源。
- 旧 History 数据可读取，新生成记录可保留模式和父级关系。
- TypeScript、目标单元测试、构建、目标 E2E 和项目检查均有明确结果。
- 相关产品文档已同步，路线图状态与实际代码一致。

## 14. 风险与默认处理

### 风险一：一次性合并三个 store

处理：不直接把 Provider、Studio、Chat、Workbench 全部揉成一个超大 store。保留 generation store 的基础 Provider/请求责任，新增 Workbench store 管理会话和 Composer，按阶段迁移。

### 风险二：历史链路定义过早

处理：第一阶段只传递可选元数据并写入 params JSON；只有产品确认需要筛选、统计或链路视图时才增加数据库列。

### 风险三：参考图能力被 UI 虚假承诺

处理：按 Provider 能力动态显示。没有端到端请求契约前，使用文本和参数迁移，不显示无效参考图按钮。

### 风险四：旧 Chat 文件被误认为仍然有效

处理：在迁移期间给旧文件增加废弃说明，禁止新功能继续写入；完成引用扫描和 E2E 迁移后删除。

### 风险五：当前会话和全局历史混淆

处理：当前会话是 renderer 的工作上下文，History 是落库图片账本。新会话只清空前者，不删除后者；页面文案和测试必须明确这一点。

## 15. 开发规则

后续每个小功能必须遵守：

1. 开发前先阅读本文件对应章节，以及相关的产品深读文档、现有实现和测试。
2. 一次只处理一个清晰的小功能，完成后立即运行针对性测试。
3. 任何共享类型变更都必须检查 renderer、preload、main、preview/mock 和测试 fixture。
4. 先确认现有行为和数据边界，再决定保留、迁移还是删除文件。
5. 不保留两套同时可用的生成逻辑；迁移期也必须明确唯一事实来源。
6. 不通过大范围状态重构解决局部问题；新增抽象必须确实消除重复行为。
7. UI 行为必须有 loading、empty、error、cancelled、partial success 和 retry 状态。
8. 生成参数必须使用提交时快照，不能在异步任务完成时读取当前 UI 状态。
9. 历史重试必须复用历史 Provider 和历史参数，除非用户明确选择修改。
10. 每次开发结束都要报告改动文件、测试命令、通过数量、失败数量和未运行项目。
11. 未解决的测试失败必须保留在交接文档或任务记录中，不得用“暂时忽略”代替结论。
12. 不使用 destructive Git 命令，不回滚用户已有改动，不擅自删除数据库或用户数据。

## 16. 本文档之后的第一项开发任务

在本设计获得确认后，第一项建议实现为：

**建立 Workbench 类型、默认参数和 store 骨架，不改变现有页面布局。**

该任务的交付内容：

- `GenerationMode`、`GenerationSource`、`GenerationTurn` 类型。
- 探索/制作默认参数函数。
- Workbench store 的草稿、模式、时间线和新会话 action。
- 统一提交入口的接口定义，暂时由现有生成能力适配。
- 相关单元测试。

这样可以先固定领域模型和数据边界，再逐步替换 UI，不会在 UI 开发过程中继续扩大 Studio、Generation、Chat 三套状态的差异。

## 17. 实现回写与验收记录

### 17.1 已交付范围

- `GenerationWorkbench` 已替换 `GeneratePage`，提供 ChatGPT 风格的顶部居中「探索 / 制作」、可向上翻阅的当前会话时间线和底部固定 Composer。
- 探索默认 4 张、2×2 结果组；制作默认 1 张、单列结果；两种模式分别保存比例、质量、数量和背景偏好。
- 结果状态覆盖 pending / success / failed / cancelled / partial；支持取消、失败重试、同模式复用、探索相似、采用方向制作、下载、复制路径、打开目录、查看历史。
- Library、Composer、History、Command Palette 已进入统一 Workbench；History 新增“探索相似”入口，并保留历史 Provider/参数/来源。
- `generationMode` 与 `parentHistoryId` 作为可选元数据写入 History params JSON，旧历史没有这些字段时仍可读取。
- 设置页已拆分探索/制作数量，并通过轻量 localStorage 偏好持久化；工作台比例选择使用共享自绘 `RatioPicker`，每个选项显示长宽轮廓、比例数字和用途标签。2026-08-05 二次补强弹层卡片式预览和设置页常驻预览；2026-08-06 按旧版创作台源码恢复白底矩形比例轮廓，并补齐 `3:4`、`4:3`、`4:5`、`5:4`、`21:9` 等常用画幅，OpenAI 侧仍只输出合法像素档。设置页最终收口为“一行当前值摘要 + 一套直接选择网格”，移除重复的比例下拉和第二套图形摘要。
- 2026-08-06 Composer 视觉收口：底部输入框成为主视觉；服务商/模型降为轻量上下文控件；比例改为紧凑画幅入口；质量、数量和反向提示词统一进入自绘“生成设置”浮层；发送/停止改为圆形图标按钮。无 Provider 时保持引导态，不渲染无效的禁用生成按钮。质量/数量选择仍写入 Workbench 当前模式参数，反向提示词仍保留草稿链路。
- 2026-08-06 比例卡片视觉重做：去除重复灰色舞台、基线和绝对定位文字，改为完整画幅框 + 单层轻卡片 + 比例/用途/像素三行信息；横图、竖图、超宽图均留足高度不裁切。Workbench 比例弹层、当前摘要和 Settings 默认比例网格共享此视觉实现。
- 2026-08-06 生成完成态操作收口：补齐 `action-button`、`icon-action`、`menu-action` 的真实组件样式；回合主要动作使用稳定圆角操作组，图片悬浮工具和更多菜单不再退化为裸按钮。
- 2026-08-06 推荐词与历史回填收口：探索/制作空态改为本地组合式推荐词池，每次进入或点击「换一组」生成新的候选；点击推荐词只回填并聚焦 Composer，不自动发起请求。历史详情主动作改为「再次制作」，进入制作模式预填提示词与参数，等待用户修改/确认。
- 2026-08-06 Composer 稳定性收口：服务商、模型、比例、更多设置四个上下文控件使用固定槽位，参数文字变化不会改变输入栏布局；提交后保留规范化提示词，生成中和完成后都可继续编辑。
- 2026-08-06 Toast 改为系统通知式实色面板，移除左侧强调色线和玻璃装饰；使用小状态图标、关闭按钮、文本操作和短距离淡入淡出，Radix 默认悬停/聚焦暂停自动关闭。
- 2026-08-06 命令面板定位收口：修复 Tailwind 独立 `translate` 与 `command-in` 动画重复横移造成的左偏；桌面中心点与视口中心一致，360×740 下左右各保留 16px 且无横向溢出。
- 工作台和设置页不使用系统原生下拉框：Provider 与比例均使用应用内弹层菜单，支持点击外部关闭、Esc 关闭、选中态和基本 ARIA 状态；比例控件的触发器、弹层和设置页默认值必须保留画幅预览。
- Provider 自动重试已接入统一 Workbench：OpenAI/Wukong 对 429/5xx/网络异常执行统一退避，主进程通过 `image:progress` 推送，结果卡显示「重试中（第 n/3 次）」。
- Composer 进入制作前会保存真实 Composition 和不可变渲染快照；Workbench 按当前 Provider target 重新序列化 prompt，并把 composition_id 写入 History。用户手改正文或负面词后解除自动同步，切 Provider 不覆盖手改内容。

### 17.2 迁移边界

`studio/store.ts` 已在引用扫描与 E2E 迁移后删除；旧 Chat/Studio 页面组件也已清理，`ImageLightbox` 已迁移到公共 UI。`generation/store.ts` 的旧生成状态和 legacy bridge 也已删除，只保留 Provider 管理；Library/History/Composer 正式入口和 Workbench 均使用各自明确的正式状态源。

### 17.3 已执行测试

```text
npm run check
  typecheck: 通过
  Vitest: 35 个文件，235 个测试通过
  build: 通过

.venv-test/bin/python -m pytest tests/e2e/test_04_generate.py -q
  25 passed
.venv-test/bin/python -m pytest tests/e2e/test_05_settings.py -q
  43 passed
.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q
  16 passed
.venv-test/bin/python -m pytest tests/e2e/test_08_generation_workbench.py -q
  19 passed
env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q
  253 passed, 6 skipped, 0 failed（662.92 秒）
```

真实 API 验收已创建 Provider、保存密钥、通过 `/v1/models` 确认 `gpt-image-2` 可见，并发起制作模式低质量单图生成。2026-08-06 使用临时环境变量重跑：`test_08_generation_workbench_live.py` 1 passed，`test_04c_generate_live.py` 连通性 + 真 PNG/成本/History 共 3 passed；最新真图观测为 1254×1254、约 1081KB、`duration_ms=17492`、成本 32 分，图片 SHA-256 `c6d80a30ef8fe473aa59982116c58314014b7a98313b1ae81eaa545348ac7e8b`。密钥未写入仓库、DB、localStorage 或报告。

## 18. 提示词库与制作模式引用闭环（2026-08-06）

### 18.1 产品边界

提示词引用是制作模式的辅助检索能力，不是另一套生成状态，也不进入探索模式。桌面端右侧栏默认展开，约 300px，可折叠；宽度不超过 1100px 时变成右侧覆盖抽屉。输入框上方显示可移除的来源条，保留用户正文编辑能力，避免引入富文本编辑器或 ContentEditable。

### 18.2 引用与 Prompt 合并契约

`PromptReference` 保存 `promptId/title/text/scope` 快照，`scope` 为 `full` 或 `excerpt`。一次最多 6 条，单条最多 4000 字；相同 `promptId + text` 不重复添加。最终 Prompt 固定合并为：

```text
用户输入正文

参考提示词：
【标题 1｜整条】
引用内容 1
```

`GenerationTurn.userPrompt` 是原始正文，`GenerationTurn.prompt` 是发送给 Provider 的最终文本，`GenerationTurn.references` 是提交时不可变快照。回合完成后仍允许修改输入；再次制作恢复正文和引用，探索相似方向不带引用。

### 18.3 前后端与历史

- renderer：`PromptReferenceSidebar` 独立查询 Library，不污染 Library 筛选；Workbench store 负责添加、移除、清空、长度校验和最终合并。
- IPC：`GenerateImageRequest.promptReferences` 与生成 Prompt 一起发送；新增 `history.related` 查询直接来源或引用来源，支持成功/失败/取消筛选、分页和总数。
- SQLite migration 0009：新增 `history_prompt_references`，保存标题/正文快照；历史删除级联，提示词软删仍可回查，彻底删除后 `prompt_id` 置空但快照保留。
- 主进程：成功、失败、取消均在同一事务写入引用关系；历史重试复制原引用快照；导入/导出、重置和测试库清理同步处理关系表。
- SQLite migration 0010：对升级前“生成后立即存为提示词”的手动记录做一次严格精确回填，并为新提示词写入稳定的 `history://<historyId>` 来源；不做模糊文本匹配，无法确定的旧记录保持未关联。
- Workbench/History 的「存为提示词」在创建成功后显式调用 `history.linkPrompt`，最多关联本次回合中已经落库的 200 条历史（含成功/失败/取消），遇到已有其他归属的历史只报告冲突，不覆盖原来源；提示词封面仍只选择第一张成功图片。
- 历史继续制作的来源同时保留 `historyId` 和可选 `promptId`。`historyId` 用于父子回合追踪，`promptId` 用于延续明确的提示词作品归属；从手工输入或没有 prompt 来源的 Composition 进入时不生成 `promptId`。

### 18.4 交互验收与测试

- 关联单元测试 4 个文件、39 项通过，覆盖合并函数、store 引用生命周期、SQL 查询、migration 升级/级联。
- 全量无真实 API Electron E2E：257 passed、6 skipped、0 failed；覆盖列表/网格、作品分栏、成功/失败/取消、引用整条/选段、无自动生成、假 Provider 最终 Prompt、历史重试与再次制作恢复、导入导出和窄屏抽屉。
- 视觉检查覆盖深色/浅色、1440px、1100px、800px；真实 TvT API 本轮未因凭证安全原因重复调用，沿用同日已有 `gpt-image-2` 真 PNG 验收，新增引用链路使用假 Provider 完成端到端校验。
- `npm run clean:artifacts` 后 `npm run release:preflight` 通过；预检明确保留远端 CI、Windows hosted/ARM64 真机、Developer ID 签名公证和真实生图为外部门禁。

### 18.5 关联故障修复记录

2026-08-06 曾出现 `Error invoking remote method 'db:history:related': No handler registered`。根因有两层：开发模式 renderer 热更新时仍连接旧的 Electron 主进程，且旧版“存为提示词”只创建了 prompt，没有把生成历史写回 `history.prompt_id` 或关系表。现在前端通过 `system.getVersion` 判断 DB 能力，旧主进程不会把 IPC 错误伪装成 0 条；主进程使用 `history.related` 返回稳定关联原因，新建提示词时通过 `history.linkPrompt` 建立显式关系，migration 0010 为符合严格条件的旧数据补齐关系。

当前验收数据库为 v10；现有手动提示词的历史关联已按精确规则回填。关联查询不使用提示词文本模糊匹配，因此同文案但没有明确来源或引用关系的历史仍然不会出现在作品分栏。
