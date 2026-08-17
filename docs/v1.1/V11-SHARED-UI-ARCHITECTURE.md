# Musefold v1.1 Desktop/Web 共享 UI 架构

> **状态**：v1.1 UI 复用基线
>
> **目标**：Web 与桌面端使用同一套工作台、提示词库和历史 UI 源码，平台差异只存在于宿主与 adapter

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

| 层 | 共享程度 | 内容 |
|---|---:|---|
| Design tokens | 100% | 颜色、字号、间距、边框、阴影、动效、z-index |
| UI primitives | 100% | Button、IconButton、Dialog、Drawer、Tabs、Input、Tooltip、Toast |
| Feature view components | 100% | Workbench、Prompt Library、History、Generation Result |
| Pure interaction logic | 100% | reducer、校验、selection、lineage、draft 和 conflict view model |
| Data adapters | 接口共享、实现分开 | Electron IPC / Cloud HTTP |
| App shell | 分开 | Electron titlebar/sidebar 与 Web/mobile navigation |
| Platform services | 接口共享、实现分开 | clipboard、download、open external、file picker、share |

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
  surface: 'desktop' | 'web';
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
  source: 'local' | 'cloud';
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
- 同一个 Prompt editor 在 Desktop/Web 各维护一套表单规则。
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

| 宽度 | 工作台 | 提示词库/历史 |
|---|---|---|
| `>= 1024` | 桌面主布局、固定 composer | 列表 + 详情 |
| `640..1023` | 紧凑单栏/可折叠侧区 | 列表 + 抽屉详情 |
| `< 640` | 单列、底部 composer、参数 drawer | 列表页与详情页切换 |

断点和行为存在于共享 component/CSS。Electron 窗口缩窄时也得到相同行为，从而让响应式逻辑得到双端复用。

### 6.3 平台壳

允许不同：

- Desktop：自定义 titlebar、完整 sidebar、命令面板、设置窗口。
- Web desktop：普通浏览器顶栏/侧栏、登录门、Cloud MCP 连接入口。
- Web mobile：底部导航、浏览器安全区、系统分享。

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
  | { type: 'open-prompt'; id: string }
  | { type: 'use-prompt'; id: string }
  | { type: 'open-session'; id: string }
  | { type: 'open-generation'; id: string }
  | { type: 'open-account' }
  | { type: 'open-approval'; id: string };
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

### Stage 3：历史

- 抽取 history list/detail/lineage/save-prompt。
- Desktop 保留成本/磁盘等本地专属 slot。
- Web 注入云资产 download 和签名 URL 刷新。

### Stage 4：工作台

- 将现有大型 `GenerationWorkbench` 按 Composer/Turn/Result/Settings 拆分。
- 先只移动渲染和纯交互，保留 desktop adapter；每一步运行桌面 E2E。
- 再注入 CloudWorkbenchGateway，替换 Web fixture 工作台。
- 本地参考图、Skill 和设计方案通过 capability slots 留在 Desktop，不进入共享核心路径。

### Stage 5：账号与 Cloud MCP

- 抽取账号摘要、额度和兑换组件。
- 新增 Web connected apps/approval 页面，继续使用相同 token/primitives。
- 历史和工作台显示统一的 `web | cloud_mcp` 来源 badge。

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
