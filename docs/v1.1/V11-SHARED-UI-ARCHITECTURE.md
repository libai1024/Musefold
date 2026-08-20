# Musefold v1.1 Desktop/Web 共享 UI 架构

本轮增量：共享产品 UI 新增工作台消息复制/编辑操作和最近对话上下文菜单；Desktop/Web 共同支持置顶、重命名、归档、标记未读和软删除，Web 删除使用 Cloud gateway 的版本保护接口。Desktop 标题栏和 Web 顶栏也使用同一会话菜单触发器、图标、菜单 portal、重命名弹层和删除确认；点击外部关闭与 Escape 行为由共享菜单统一处理。提示词库搜索已接入服务端 `q` 查询，输入采用短防抖并用请求序列丢弃过期响应。提示词引用卡片、全文悬停预览和生成结果重试控件也已由 Desktop/Web 共用，并通过正文快照避免依赖宿主本地 store。共享产品 UI 测试为 `38/38`，Web E2E 为 `11/11`；真实 Cloud/staging 浏览器验收仍单独保留。

> **状态**：v1.1 UI 复用基线
>
> **目标**：Web 与桌面端使用同一套工作台、提示词库和历史 UI 源码，平台差异只存在于宿主与 adapter

> **实施状态（2026-08-19）**：`@musefold/ui` 已建立并成为 Desktop/Web 的共享 token、图标和基础交互原语来源；`Button`、`IconButton`、`StatusBadge` 已接入提示词列表/回收站、历史列表/详情动作/回收站、产品侧栏折叠和状态标签，产品旧 `mf-*` class 作为兼容层保留。`@musefold/product-ui` 已建立，Desktop/Web 已共同消费提示词列表/详情 header/正文/编辑表单、生成历史列表/详情正文/公共动作、页面标题工具条、工作台页面壳/时间线视口控制器、Composer 壳体/提示词输入/提交按钮/保存状态/空态/最近会话列表/会话列表 reducer/controller/上下文菜单/比例选择/生成设置、Turn 骨架/用户消息/助手头/结果网格/结果卡、共享 `WorkbenchAssistantAvatar`、历史检视导航 reducer/hook、`GenerationHistoryWorkspace` 主从布局和“存为提示词”动作；共享包另已提供提示词/历史回收站、`AccountSummaryPanel`、`AccountScreen` 和 `ConnectedAppsScreen`。Web 的云端草稿 debounce、串行保存、版本冲突和会话切换失效由 `useWorkbenchDraftSyncController` 统一实现，Web 最近会话列表已由带请求序列保护的 `useWorkbenchSessionController` 统一管理替换、前置更新、移除、加载、错误和并行打开；跨会话活跃生成的筛选、SSE 游标、断线退避和终态收敛由 `useWorkbenchGenerationSyncController` 统一实现。Desktop 本地 IPC 的 active/archived list、open、rename、archive、restore、delete 已复用同一 session reducer 的选中项规则，并加入 IPC 请求序列保护和失败保留列表语义。Desktop/Web 共用工作台时间线、用户消息复制/编辑、Composer 浮动定位/宽度/背景/移动端间距、结果网格几何和助手结果列骨架，结果态还统一头像资源、状态文案、1:1 结果卡比例和存提示词 footer。共享控件测试 35/35、共享原语测试 5/5、双端类型检查、Desktop 视觉 QA 5/5、Desktop 设置 E2E 45/45、Desktop 账号 E2E 4/4、十一项共享视觉门禁及 Web E2E 11/11 已通过；Web fixture 仅能通过显式 fixtures mode 启用，生产 bundle 有独立泄漏检查。Web 的页面编排器已拆分为 `layout/WebNavigation.tsx`、`views/GenerateView.tsx`、`views/PromptLibraryView.tsx` 和 `views/HistoryView.tsx`，`App.tsx` 仅保留路由、会话状态和 gateway adapter 组合。Web 与 Desktop 的账户和 Cloud MCP 连接页面均由共享组件承载，Desktop 通过集中式 `cloud-connections-store` 和 `cloudConnections` IPC 复用 Cloud 会话；真实 Cloud/staging 浏览器验收仍待完成。

本轮补充验证：Desktop 工作台 E2E `29/29` 通过，覆盖素材库响应式抽屉、生成结果、取消/重试、图片选择和本地能力动作；标准 Musefold 生图结果已切换到共享 `WorkbenchAssistantAvatar`，Desktop 私有大头像仅保留给 Skill Agent 过程态。

当前状态修订（2026-08-19）：以上实施状态中的旧测试数字仅保留作历史记录；当前共享产品 UI 为 `40/40`，共享视觉门禁为 `16/16`。新增的提示词引用卡片、全文预览、完整 Composer、完整侧栏和结果重试控件已在 Desktop/Web 通过同一组件、同一正文快照和视觉比较门禁。

共享原语本轮已扩展为 `Button`、`IconButton`、`Dialog`、`Drawer`、`Tabs`、`Input`、`Textarea`、`Tooltip`、`Toast`、`EmptyState`、`LoadingState` 和 `ErrorState`。Desktop 的 `src/components/ui/*` 保留为兼容入口并统一转发到 `@musefold/ui`，产品侧的提示词编辑器、搜索、工作台提示词、生成设置和会话重命名已接入共享表单控件；提示词详情、历史详情、账号连接的确认/重认证弹窗已接入共享 Dialog。共享 Button 另提供 `unstyled` 语义，用于保留产品行按钮、图片预览和侧栏的既有几何，同时统一原生按钮语义、禁用和类型入口。共享原语单测为 `5/5`，高风险 Desktop 回归为 `86 passed`，Web E2E 为 `11/11`，共享视觉门禁已扩展为 `13/13`。

本轮视觉门禁增量：`npm run test:visual:shared` 已扩展为十六项共享区域，并新增完整侧栏、桌面/手机 Composer、成功/失败/取消结果态、`390x844` 手机取消态、提示词引用卡片和全文悬停预览；Web E2E 当前 `13/13`，Desktop 视觉 QA `5/5`。提示词引用卡片平均像素误差 `0.00933` / 变化像素 `1.08%`，历史详情 `0.02640` / `4.02%`，均低于门禁；失败态、桌面取消态和手机取消态也均低于门禁。

本轮继续将完整 Composer 和完整侧栏提升为共享产品结构：`WorkbenchComposerFrame` 统一输入区、工具条、左右能力插槽、自动高度和 Enter/Shift+Enter 语义；`ProductSidebarLayout` 统一 rail、默认/最小宽度、宽度持久化、指针与键盘 resize、双击恢复、折叠、窄屏抽屉遮罩以及离开窄屏后的状态恢复。Desktop/Web 的侧栏截图均为 `243x900`，平均像素误差 `0.01503`、变化像素比例 `2.48%`；主工作区均为 `1196x848`。共享视觉门禁现覆盖十六项区域，Web E2E `13/13`、Desktop 工作台 E2E `29/29`、Product UI `40/40` 已通过。`check-shared-ui-boundaries.mjs` 会拒绝宿主绕过上述两个共享壳层，或在 Web CSS 中重新定义私有 `.sidebar` rail。

本轮实现增量：`@musefold/ui` 已补齐可复用的 `Button`、`IconButton`、`StatusBadge` 与 canonical icon/token exports，Desktop、Web、`@musefold/product-ui` 的直接图标依赖已收敛到共享入口，并由 `check:ui-boundaries` 阻止重复 token 和越界图标导入。工作台结果区新增独立交互边界，避免用户消息操作栏在保存/重试按钮按下时先收缩造成 click 位移；提示词来源正文以 host snapshot 传递，Desktop/Web 共用同一引用卡片和预览；相关回归由 Web 主流程 E2E 和共享视觉门禁覆盖。当前共享原语单测 `5/5`、产品 UI 单测 `38/38`、Web 单测 `13/13`、v1.1 类型检查、Electron/Web 生产构建和生产边界检查均通过。

## 0. 冻结结论

“与桌面端一致”在 v1.1 中定义为代码复用，不是视觉仿写：

1. 桌面端是现有视觉和交互基线。
2. Web 不继续扩展独立的 `apps/web/src/App.tsx + styles.css` 产品实现；现有代码只作为 Phase 0 原型。
3. 工作台、提示词库、历史详情、生成结果和通用账号组件从桌面端抽到共享 React 包。
4. 共享组件不得调用 `window.api`、Electron、Node/fs、本地路径或 Cloud fetch。
5. Desktop 通过 IPC adapter 注入数据；Web 通过 `cloud-client` adapter 注入数据。
6. 平台壳、标题栏、导航范围、文件选择、下载方式和 capability 可以不同。
7. 同一组件的桌面/手机响应式状态放在同一 CSS/组件源码中，禁止复制一份 mobile 页面。

## 1. 共享层级

| 层                      |           共享程度 | 内容                                                                                           |
| ----------------------- | -----------------: | ---------------------------------------------------------------------------------------------- |
| Design tokens           |               100% | 颜色、字号、间距、边框、阴影、动效、z-index                                                    |
| UI primitives           |               100% | Button、IconButton、Dialog、Drawer、Tabs、Input、Textarea、Tooltip、Toast、Empty/Error/Loading |
| Feature view components |               100% | Workbench、Prompt Library、History、Generation Result                                          |
| Pure interaction logic  |               100% | reducer、校验、selection、lineage、draft 和 conflict view model                                |
| Data adapters           | 接口共享、实现分开 | Electron IPC / Cloud HTTP                                                                      |
| App shell               |               分开 | Electron titlebar/sidebar 与 Web/mobile navigation                                             |
| Platform services       | 接口共享、实现分开 | clipboard、download、open external、file picker、share                                         |

目标不是让 Web 拥有桌面所有功能，而是让两端在相同 capability 下渲染同一 UI。

## 2. 目标目录

```text
packages/
  ui/
    src/tokens.css
    src/primitives/
    src/layout/
    src/icons/
    src/index.ts

  product-ui/
    src/runtime/
      MusefoldRuntimeProvider.tsx
      capabilities.ts
      platform-services.ts
    src/workbench/
      WorkbenchScreen.tsx
      Composer.tsx
      TurnList.tsx
      ResultGrid.tsx
      GenerationSettings.tsx
    src/library/
      PromptLibraryScreen.tsx
      PromptList.tsx
      PromptDetail.tsx
      PromptEditor.tsx
      PromptConflictDialog.tsx
    src/history/
      HistoryScreen.tsx
      HistoryList.tsx
      HistoryDetail.tsx
      LineagePanel.tsx
    src/account/
      AccountSummary.tsx
      QuotaDisplay.tsx
      RedeemDialog.tsx
      ConnectedApps.tsx
      GenerationApproval.tsx
    src/controllers/
    src/index.ts

  domain/
  contracts/
  cloud-client/

src/                              # Desktop host
  app/DesktopShell.tsx
  adapters/desktop/

apps/web/src/                     # Web host
  app/WebShell.tsx
  adapters/cloud/
```

包职责：

- `@musefold/ui` 只包含通用视觉原语和 token。
- `@musefold/product-ui` 包含 Musefold 产品页面和交互，不拥有数据来源。
- `@musefold/domain` 包含平台无关状态转换和业务规则。
- Desktop/Web host 负责路由、认证门、capability 和 adapter 组装。

## 3. Runtime 注入

共享 UI 通过一个窄 runtime 获取能力：

```ts
interface MusefoldUiRuntime {
  surface: "desktop" | "web";
  capabilities: ProductCapabilities;
  prompts: PromptUiGateway;
  workbench: WorkbenchUiGateway;
  history: HistoryUiGateway;
  account: AccountUiGateway;
  platform: PlatformServices;
}
```

共享组件只调用 gateway，不判断 URL 或 `window.api` 是否存在。

### 3.1 Prompt gateway

```ts
interface PromptUiGateway {
  list(query: PromptListQuery): Promise<PromptPage>;
  get(id: string): Promise<PromptDocument | null>;
  create(input: NewPromptDocument): Promise<PromptDocument>;
  update(id: string, patch: UpdatePromptDocument): Promise<PromptDocument>;
  remove(id: string, expectedVersion: number): Promise<void>;
  restore(id: string, expectedVersion: number): Promise<PromptDocument>;
  subscribe?(listener: (event: PromptChangeEvent) => void): () => void;
}
```

### 3.2 Workbench gateway

```ts
interface WorkbenchUiGateway {
  createSession(input?: CreateSessionInput): Promise<WorkbenchSession>;
  getSession(id: string): Promise<WorkbenchSessionDetail>;
  saveDraft(id: string, patch: DraftPatch): Promise<WorkbenchSession>;
  generate(input: CreateGenerationInput): Promise<GenerationJob>;
  getGeneration(id: string): Promise<GenerationJob>;
  subscribeGeneration(id: string, listener: GenerationListener): () => void;
  cancelGeneration(id: string): Promise<GenerationJob>;
  retryGeneration(id: string, input?: RetryPatch): Promise<GenerationJob>;
}
```

### 3.3 Platform services

```ts
interface PlatformServices {
  copyText(text: string): Promise<void>;
  downloadAsset(asset: UiAsset): Promise<void>;
  shareAsset?(asset: UiAsset): Promise<void>;
  openExternal(url: string): Promise<void>;
  pickReferenceImages?(): Promise<UiReferenceAsset[]>;
  revealLocalFile?(asset: UiAsset): Promise<void>;
}
```

Web P0 没有 `pickReferenceImages/revealLocalFile` capability，组件不渲染对应按钮；不是点击后提示“Web 不支持”。

## 4. Adapter

### 4.1 Desktop adapter

```text
DesktopPromptGateway    -> window.api.prompt.*
DesktopWorkbenchGateway -> window.api.workbench/generation.*
DesktopHistoryGateway   -> window.api.history.*
DesktopAccountGateway   -> window.api.account.*
DesktopPlatformServices -> clipboard/shell/dialog/local files
```

Desktop adapter 把本地 `Prompt/History/Workbench` 类型映射为共享 view model。`image_path` 转为桌面可渲染 URL，但不改变本地数据库字段。

### 4.2 Web adapter

```text
CloudPromptGateway      -> @musefold/cloud-client /prompts
CloudWorkbenchGateway   -> /workbench + /generations + SSE
CloudHistoryGateway     -> /generations
CloudAccountGateway     -> /auth + /connections + /approvals
WebPlatformServices     -> Clipboard/Download/Web Share APIs
```

Web adapter 负责 session 失效、CSRF header、SSE 重连、签名 URL 刷新和 HTTP 错误映射；这些细节不进入共享组件。

### 4.3 契约适配原则

- 共享 UI 的主要 view model 以 `@musefold/contracts` 为基础，不直接暴露数据库行。
- 平台缺失字段在 adapter 映射为明确 capability 或 null，不伪造。
- 本地文件和云对象统一为 `UiAsset`，但保留来源：

```ts
interface UiAsset {
  id: string;
  source: "local" | "cloud";
  displayUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  downloadable: boolean;
}
```

## 5. 状态管理

### 5.1 分层

- 纯状态转换放 `@musefold/domain`：selection、composer intent、lineage、冲突决策。
- 页面 controller 放 `@musefold/product-ui`：加载、提交、错误和 pending 状态。
- 数据访问和重连在 adapter。
- App shell 只维护当前 route、全局账户和 capability。

共享层冻结的是受控组件、view model、纯 reducer/use case 和 gateway port，不强制 Desktop/Web 使用同一种服务端缓存实现：

- Web 使用 TanStack Query 管理分页、revalidate、mutation、失效和网络恢复；composer 草稿、drawer、selection 等短生命周期状态使用局部 React state 或小型 Zustand store。
- Desktop 保留现有 Zustand + IPC store，逐步把直接 `window.api` 调用移到 adapter，不为迁就 Web 重写桌面缓存策略。
- `@musefold/product-ui` 通过 props/controller contract 接收数据和 action，不导入 TanStack Query、Electron IPC 或平台 store。

这能复用真正影响维护成本的产品 UI 和交互规则，同时避免把远程服务器状态硬塞进桌面本地 store。具体选型见 [技术选型与架构决策](./V11-TECHNOLOGY-DECISIONS.md)。

### 5.2 禁止的状态模式

- 组件 mount 后自己读取 `window.api`。
- 同一个 Prompt editor 禁止在 Desktop/Web 各维护一套表单规则；当前由 `PromptEditorForm` 统一字段、校验、折叠、快捷键和放弃改动交互。
- Web 把全量云库复制到 localStorage 作为事实源。
- 用 `surface === 'web'` 在几十个叶子组件中散布分支。
- 让 capability 缺失的动作先显示再报错。

## 6. 样式与构建

### 6.1 Tailwind 和 token

桌面当前使用 Tailwind 4，因此 Web 接入同一 Tailwind/PostCSS 构建链：

- `@musefold/ui/tokens.css` 成为颜色、间距、字体和动效唯一来源。
- Desktop/Web 都扫描 `packages/ui` 和 `packages/product-ui` 的 class。
- `apps/web/src/styles.css` 只保留 Web shell 特有布局，不能重新定义产品 token。
- 共享组件禁止依赖 Electron 根节点类名。
- 暗色/高对比度若后续开放，通过 token theme 切换，不复制组件。

### 6.2 响应式

同一组件维护三种布局状态：

| 宽度        | 工作台                           | 提示词库/历史      |
| ----------- | -------------------------------- | ------------------ |
| `>= 1024`   | 桌面主布局、固定 composer        | 列表 + 详情        |
| `640..1023` | 紧凑单栏/可折叠侧区              | 列表 + 抽屉详情    |
| `< 640`     | 单列、底部 composer、参数 drawer | 列表页与详情页切换 |

断点和行为存在于共享 component/CSS。Electron 窗口缩窄时也得到相同行为，从而让响应式逻辑得到双端复用。

### 6.3 平台壳

允许不同：

- Desktop：自定义 titlebar、完整 sidebar、命令面板、设置窗口。
- Web desktop：普通浏览器顶栏/侧栏、登录门、Cloud MCP 连接入口。
- Web mobile：左侧功能/对话抽屉、浏览器安全区、系统分享。

页面内容、按钮文案、图标和交互顺序在相同 capability 下保持一致。

## 7. Capability

```ts
interface ProductCapabilities {
  generation: boolean;
  workbench: boolean;
  generationHistory: boolean;
  cloudPrompts: boolean;
  promptSync: boolean;
  localPrompts: boolean;
  referenceImages: boolean;
  skills: boolean;
  designSchemes: boolean;
  automation: boolean;
  cloudMcpConnections: boolean;
  byokProviders: boolean;
}
```

P0 Web：

```text
generation/workbench/generationHistory/cloudPrompts/promptSync/cloudMcpConnections = true
referenceImages/skills/designSchemes/automation/byokProviders/localPrompts = false
```

这里的 `skills=false` 指 Web 工作台不执行桌面 GitHub Skill；Cloud MCP 的官方 Skill registry 由连接管理和 MCP 层使用，是独立 capability。

## 8. 路由与命令

共享 screen 不直接使用 React Router 或修改 `window.location`，只触发 command：

```ts
type ProductCommand =
  | { type: "open-prompt"; id: string }
  | { type: "use-prompt"; id: string }
  | { type: "open-session"; id: string }
  | { type: "open-generation"; id: string }
  | { type: "open-account" }
  | { type: "open-approval"; id: string };
```

Desktop shell 映射为内部 ViewKey；Web shell 映射为 URL。这样“从历史保存/使用提示词”等交互只维护一份。

## 9. 共享页面范围

### 9.1 P0 必须共享

- 制作工作台 composer、参数、turn/run 列表、进度、错误和结果。
- 提示词列表、搜索、详情、编辑、回收站、版本冲突。
- 生成历史列表、详情、谱系、重试、保存为提示词。
- 账号摘要、额度和兑换组件。
- Dialog、Drawer、Toast、Tooltip、Empty/Error/Loading states。

### 9.2 平台专属

- Desktop Provider 设置、豆包、CLI/MCP 自动化和本地文件管理。
- Web 登录页、Cloud MCP OAuth consent、connected apps、预算和审批页。
- Desktop titlebar 与 Web mobile navigation。

平台专属页面仍应使用 `@musefold/ui` primitives 和 token。

## 10. 迁移顺序

### Stage 1：基础视觉

- 抽取 token、icons、Button/Dialog/Drawer/Input/Tooltip/Toast。
- Desktop 先改用共享 primitive，视觉截图不得变化。
- Web 接入 Tailwind 4 和同一 token，删除重复产品色值。

### Stage 2：提示词库

- 把桌面 Prompt list/detail/editor 拆成 controlled components。
- 将 store 中的纯筛选、标题和关联逻辑移到 domain/product-ui。
- DesktopPromptGateway 接回现有 IPC，完成无行为变化回归。
- CloudPromptGateway 接 Web API，替换 Web 原型列表。

当前已完成共享 list/search/section/detail-screen/detail-content/editor/trash 组件，Web Cloud gateway 已接入 get/update/delete/restore 和乐观版本；Desktop 已接入共享 list、detail-screen、detail-content、`PromptEditorForm` 和 `PromptLibraryHeaderActions`，并通过 menu item slot 保留分享和创建方案入口。Web/Desktop 提示词库列表和详情已纳入同 fixture 内容区域截图差异门禁；真实 Cloud API 浏览器验收、并发冲突 UI 自动化和 10,000 条数据性能门槛仍属于本阶段剩余工作。

### Stage 3：历史

- 抽取 history list/detail/lineage/save-prompt。
- Desktop 保留成本/磁盘等本地专属 slot。
- Web 注入云资产 download 和签名 URL 刷新。

当前已完成共享 history list/detail-content/trash/detail-actions、`GenerationHistoryScreen`、`GenerationHistoryWorkspace` 和 `useHistoryInspectorController`；Desktop/Web 共用页面标题工具条、刷新/回收站操作、列表 + 320px 检视器布局、手机详情返回、再次制作、重试、取消、下载、复制提示词、保存和删除的图标、文案、忙碌状态与菜单/确认交互；Desktop 通过 slot 保留谱系、磁盘文件、服务商密钥和设计方案动作。历史详情内容与完整主从工作区均已接入同 fixture 差异门禁；Cloud client/Web API 已接入生成 SSE、`LISTEN/NOTIFY` 唤醒、快照确认和断线退避；Web 工作台已同时恢复当前会话的完整多 turn 生成快照，并通过共享同步 controller 追踪已载入其他会话的活跃任务。Web 资产使用稳定同源 `/assets/:id/url` 跳转端点，每次读取重新签名；Cloud MCP 的 `get_generation` 返回刷新后的短期签名 `resource_link`。剩余工作是后台生成快照跨设备统一、长时会话资产访问和 30 天清理任务的 staging 验收。

### Stage 4：工作台

- 将现有大型 `GenerationWorkbench` 按 Composer/Turn/Result/Settings 拆分。
- 先只移动渲染和纯交互，保留 desktop adapter；每一步运行桌面 E2E。
- 再注入 CloudWorkbenchGateway，替换 Web fixture 工作台。
- 本地参考图、Skill 和设计方案通过 capability slots 留在 Desktop，不进入共享核心路径。

当前已完成 `WorkbenchPageFrame`、`WorkbenchTimelineViewport`、`WorkbenchTimelineContent`、`useWorkbenchTimelineController`、`WorkbenchComposerSurface`、`WorkbenchComposerPrompt`、`WorkbenchEmptyState`、`WorkbenchSessionList`、`useWorkbenchSessionController`、`useWorkbenchGenerationSyncController`、`WorkbenchContextMenu`、`WorkbenchRatioPicker`、`WorkbenchGenerationSettingsPopover`、`WorkbenchTurnFrame`、`WorkbenchUserMessage`、`GenerationResultSurface`、`GenerationRetryAction`、`WorkbenchResultGrid`、`WorkbenchAssistantFrame`、`WorkbenchAssistantHeader` 和 `WorkbenchAssistantAvatar`：Desktop/Web 共用页面壳、时间线跟随/停跟/回到最新行为、Composer 浮动定位/宽度/背景/移动端间距、空态创作方向、会话分组与归档入口、上下文菜单、比例/设置弹层、回合根节点/用户消息列、复制/编辑动作、结果网格列数与画幅宽度、结果卡的媒体比例、加载/成功/取消/失败状态、可访问图片按钮、统一助手头像、媒体 action slot、footer action slot、统一重试语义和助手结果列骨架。结果态视觉夹具使用同一 JPEG、同一 1:1 比例、同一状态文案和共享存提示词 footer，单独验证图片裁切、头像、状态和结果卡高度。Desktop 通过 capability action 保留本地图片、复制、打开目录、历史、微调、长按选择、批量保存、额度兑换、Skill 和设计方案交互；Web 保留云资产下载、提示词引用、消息复制/编辑、存为提示词和原地重试，并在会话切换/刷新后恢复完整多 turn 结果。Desktop 的 active/archived/open/rename/archive/restore/delete 已由 shared reducer-backed adapter 覆盖并有失败语义测试；剩余工作是后台生成快照跨设备统一、抽取更多账号/详情 action slots，并完成真实 Cloud 会话联调。

### Stage 5：账号与 Cloud MCP

- 抽取账号摘要、额度和兑换组件。
- 新增 Web connected apps/approval 页面，继续使用相同 token/primitives。
- 历史和工作台显示统一的 `web | cloud_mcp` 来源 badge。

当前已完成 `AccountSummaryPanel`、`AccountScreen` 和 `ConnectedAppsScreen`；Web 与 Desktop 均仅在 host 中完成 contracts 到 view model 的映射，页面、预算控件、密码二次认证、键盘 Escape、暂停/恢复和撤销确认均由共享组件实现。Desktop 通过集中式 `cloud-connections-store`、`cloudConnections` IPC 与 CloudSyncService 复用同一短期 Cloud 会话，并在设置导航提供“已连接应用”分区；本地账号服务器、提示词云同步、兑换码和本地 AI 连接仍按 capability 保留。账号摘要与完整连接页均已进入双端视觉差异门禁；真实 Cloud/staging 浏览器验收仍需单独完成。

## 11. 测试策略

### 11.1 组件测试

- 共享组件只测试一次，使用内存 gateway fixture。
- 每个 gateway 运行相同的 contract test，确保 Desktop/Web 行为等价。
- capability 组合测试保证不支持动作根本不渲染。

### 11.2 视觉回归

- 为 Workbench、Prompt Library、History 建稳定 fixture 场景。
- 同一 fixture 分别渲染 Desktop preview 和 Web，裁掉平台 shell 后做截图差异检查。
- 固定验证 `1440x900`、`1024x768`、`390x844`。
- 检查加载/错误/空态/长文本/最长按钮文案，不只检查理想成功态。

当前 Web 已在 `apps/web/e2e/visual-contract.spec.ts` 固定工作台、成功/失败/取消结果态、提示词列表/详情、提示词引用卡片/全文预览、历史主从工作区、历史详情、账号摘要、Cloud MCP 连接页和 `390x844` 手机场景，断言表面几何、横向溢出、浏览器错误，并支持 `MUSEFOLD_VISUAL_OUTPUT_DIR` 输出截图；`npm run test:visual:shared` 会运行 Web canonical fixture、Desktop visual QA，并对十三项共享区域做稳定宽度/高度裁剪像素比较。本轮共同区域指标为：Workbench `1196x848`，平均像素误差 `0.00718`、变化像素比例 `2.05%`；Workbench result `589x502`，`0.01834`、`3.14%`；失败态 `589x490`，`0.00375`、`0.73%`；桌面取消态 `589x490`，`0.00299`、`0.50%`；手机取消态 `351x385`，`0.00634`、`1.23%`；提示词库列表 `960x358`，`0.01488`、`3.89%`；提示词详情 `880x545`，`0.00448`、`1.44%`；提示词引用卡片 `300x48`，`0.00933`、`1.08%`；提示词全文预览 `320x98`，`0.04092`、`11.23%`；历史详情 `285x459`，`0.02640`、`4.02%`；完整历史工作区 `960x766`，`0.04535`、`7.61%`；账号摘要 `680x156`，`0.01048`、`2.29%`；Cloud MCP 连接页 `958x271`，`0.01518`、`4.87%`，均低于门禁阈值。Desktop visual fixture 对 fixed portal 预览采用稳定窗口裁剪，避免 Electron locator 截图的 fixed 层裁剪差异；Desktop 工作台 E2E `29/29`、Desktop 视觉 QA `5/5`、Desktop 设置 E2E `45/45`、Desktop 账号 E2E `4/4`、Web E2E `11/11` 和共享组件 `38/38` 已通过。真实 Cloud API 和 staging 环境仍需单独验收。

### 11.3 平台 E2E

- Desktop：IPC、keychain、本地文件、CLI/MCP 回归。
- Web：session、HTTP、SSE、浏览器下载、手机导航。
- 共享主路径在两端执行同一语义用例：选择提示词、生成、重试、保存回库。

## 12. 代码审查规则

以下改动禁止合并：

- 在 `apps/web` 复制一个已有 Desktop 产品组件。
- 在 `@musefold/product-ui` 导入 Electron、`window.api`、fs/path 或 cloud-client。
- 为同一文案、间距或状态在 Desktop/Web 定义不同常量且没有产品理由。
- 共享组件出现散落的 `surface === ...`，本可由 capability/slot 解决。
- Web 或 Desktop adapter 把凭据、本地路径传入共享日志/telemetry。
- 只更新一端截图而没有说明 capability 差异。

## 13. 完成定义

- Web 工作台、提示词库和历史的核心组件来自 `@musefold/product-ui`，不再有独立仿写页面。
- Desktop 同样从共享包导入这些组件，确保以后改一次两端生效。
- `apps/web/src/App.tsx` 只承担 Web shell/route 组合，产品页面不在其中实现。
- 相同 capability 和 fixture 下，Desktop/Web 页面内容、交互顺序和视觉通过差异门禁。
- 平台 adapter、shell 和能力差异有清晰边界，Web 构建不能解析到 Electron/core。
- 手机布局由共享组件响应式完成，不存在第二套 mobile feature tree。
