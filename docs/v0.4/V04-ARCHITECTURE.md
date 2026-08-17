# V04 · 总体架构：共享核心 + 本地控制面 + 双入口

> **状态**：设计规格（待评审）
> **依赖**：[V04-CORE-FEATURE-SUMMARY.md](V04-CORE-FEATURE-SUMMARY.md)（可移植性评估）、[V04-RESEARCH-MCP-CLI.md](V04-RESEARCH-MCP-CLI.md)（模式依据）
> **一句话**：把领域逻辑抽进 `@musefold/core`；桌面 App 主进程保持唯一数据所有者并内嵌 loopback 控制面（Automation API v1）；CLI 与 MCP 服务器是控制面的两个薄客户端；无 GUI 场景由 `musefold serve` 以互斥方式接管所有权。

---

## 1. 设计约束（不可违反）

| # | 约束 | 来源 |
|---|---|---|
| C1 | 明文 API Key 只在所有者进程（App 主进程或 headless 守护）内存中短暂出现 | v0.3 安全红线 |
| C2 | 三个 SQLite 库任一时刻只有一个进程持有写权 | better-sqlite3 同步模型 + WAL 单写者 |
| C3 | 不执行第三方 Skill 脚本；外联仅限 Provider API 与 GitHub 只读 | v3.1 / v0.3.2 红线 |
| C4 | 外部入口只暴露**策展后的稳定 API**，内部 IPC 可继续自由演化 | D10 版本策略 |
| C5 | 桌面 App 的既有行为（IPC 形态、渲染层）零回归 | v0.4 是加法不是重写 |

---

## 2. 总体拓扑

```
                            ┌───────────────────────────────────────────────┐
                            │  Musefold.app（Electron）                      │
                            │  ┌─────────────┐   ┌───────────────────────┐  │
   renderer (React UI) ◄────┼──┤ typed IPC   │◄──┤                       │  │
                            │  └─────────────┘   │   @musefold/core      │  │
                            │  ┌─────────────┐   │  (领域服务 + 3×SQLite  │  │
  127.0.0.1:<port> ◄────────┼──┤ 控制面       │◄──┤   + Provider 客户端)  │  │
  Automation API v1         │  │ HTTP + SSE  │   │                       │  │
  (Bearer token)            │  └─────────────┘   └───────────┬───────────┘  │
                            │        ▲                       │ SecretsPort  │
                            └────────┼───────────────────────┼──────────────┘
                                     │                       ▼
                                     │              safeStorage (OS 级加密)
        ┌────────────────────────────┼─────────────────────────────┐
        │                            │                             │
┌───────┴────────┐          ┌────────┴────────┐          ┌─────────┴─────────┐
│ musefold CLI   │          │ musefold-mcp    │          │ 第三方脚本/CI      │
│ (人类 & 脚本)   │          │ (stdio JSON-RPC)│          │ (直接 HTTP 调 v1)  │
└────────────────┘          └────────┬────────┘          └───────────────────┘
                                     │ 子进程 stdio
                        ┌────────────┴─────────────┐
                        │ Claude Code / Codex /    │
                        │ Cursor 等 MCP 客户端      │
                        └──────────────────────────┘

无 GUI 场景（互斥替身）：
  musefold serve --headless   = 同一个 @musefold/core + 控制面，无 Electron 壳
                                （SecretsPort 换 keychain/加密文件实现，见 V04-SECURITY §4）
```

角色分工：

| 组件 | 职责 | 不做什么 |
|---|---|---|
| `@musefold/core` | 领域服务、DB 访问、Provider 调用、事件总线 | 不 import electron；不做传输 |
| 控制面（`@musefold/automation-server`） | HTTP+SSE 绑定、token 鉴权、请求→core 服务映射、确认/预算策略执行 | 不含业务逻辑 |
| `musefold` CLI | 参数解析、发现连接、人类/JSON 输出 | 不开 DB、不碰密钥文件 |
| `musefold-mcp` | MCP 工具/资源/prompts ↔ 控制面客户端映射 | 不开 DB、无本地状态 |
| Electron 主进程 | 组装 core（safeStorage/paths 适配器）+ 既有 IPC + 控制面开关 | 业务逻辑逐步迁出至 core |

---

## 3. 单写者所有权模型（C2 的实现）

### 3.1 发现文件（谁在当家）

所有者进程启动控制面成功后，原子写入 `userData/automation.json`（权限 `0600`）：

```json
{
  "version": 1,
  "apiVersion": "v1",
  "pid": 4242,
  "port": 51799,
  "token": "mf_at_9f2c…（32 字节随机，base64url）",
  "owner": "desktop-app",        // 或 "headless-daemon"
  "appVersion": "0.4.0",
  "startedAt": "2026-08-12T16:00:00Z"
}
```

退出时删除该文件（并处理僵尸：连接失败 + `pid` 不存活 ⇒ 视为陈旧，可覆盖）。

### 3.2 客户端发现链（CLI 与 MCP 相同）

```
1. 环境变量 MUSEFOLD_ENDPOINT + MUSEFOLD_TOKEN 显式指定？ → 直连
2. 读 userData/automation.json → 健康检查 GET /v1/health → 直连
3. 都失败：
   a. CLI：报错并引导（"Musefold 未运行。请启动 App，或运行 `musefold serve`"）；
      带 --autostart 时尝试拉起（macOS: `open -gja Musefold`），最多等 10s
   b. MCP：以「降级目录」启动——只注册 `musefold_status` 一个工具，
      返回引导信息（MCP 客户端不喜欢启动即失败的服务器）
```

### 3.3 所有权互斥

- App 主进程与 `musefold serve` 启动时都先 `flock` 独占 `userData/owner.lock`；拿不到锁 ⇒ 已有所有者：App 弹提示（「检测到 headless 守护，接管请先停止它」），守护则直接退出（exit 3）。
- 三个 DB 连接统一设置 `PRAGMA busy_timeout = 5000`（防御性兜底，正常路径下不会有第二个写者）。
- **明确不做**：两进程同时直开 DB 的「共享模式」（调研反模式，见 V04-RESEARCH §4）。

---

## 4. `@musefold/core` 抽取

### 4.1 仓库形态：npm workspaces

```
PromptForge/
├── package.json                 # workspaces: ["packages/*"]；App 构建脚本不变
├── electron/                    # 壳：窗口/IPC/对话框/safeStorage 适配器（逐步变薄）
├── src/                         # 渲染层（不动）
├── shared/                      # 既有纯域逻辑（P1 原地复用，P3 归并进 core）
└── packages/
    ├── core/                    # @musefold/core
    │   ├── src/ports.ts         # SecretsPort / PathsPort / EventSink / Logger / Clock
    │   ├── src/db/              # 迁自 electron/db（repositories + migrations 原样搬移）
    │   ├── src/providers/       # 迁自 electron/providers（getApiKey 改走 SecretsPort）
    │   ├── src/services/        # LibraryService / GenerationService / RecipeService /
    │   │                        # SchemeService / SkillService / HistoryService / BackupService
    │   └── src/index.ts         # createMusefoldCore(options): MusefoldCore
    ├── automation-server/       # @musefold/automation-server：控制面（依赖 core）
    ├── client/                  # @musefold/client：发现 + typed fetch + SSE（无 core 依赖）
    ├── cli/                     # musefold：CLI（依赖 client）
    └── mcp/                     # @musefold/mcp：MCP 服务器（依赖 client + MCP SDK）
```

### 4.2 端口（ports）定义

```ts
export interface SecretsPort {                  // C1 的抽象化
  getProviderKey(providerId: string): Promise<string | null>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  deleteProviderKey(providerId: string): Promise<void>;
  // aiConnection 同形态方法……
}
export interface PathsPort {                    // 今天的 getPaths() 升级
  dataDir: string;        // userData 等价物
  picturesDir: string;    // 产物输出
  logsDir: string;
}
export interface EventSink {                    // 替代 ipcRenderer 推送
  emit(event: CoreEvent): void;                 // CoreEvent = 进度/方案事件/Skill 事件统一信封
}
export interface CoreOptions {
  paths: PathsPort;
  secrets: SecretsPort;
  events: EventSink;
  logger: Logger;
}
export function createMusefoldCore(opts: CoreOptions): MusefoldCore;
```

适配器实现：

| 端口 | Electron 实现 | headless 实现 |
|---|---|---|
| SecretsPort | 现 `electron/security/keychain.ts`（safeStorage + electron-store，**格式不变，双端可互读**） | 见 V04-SECURITY §4（keytar/OS keychain 优先，降级加密文件） |
| PathsPort | `app.getPath('userData')` 等 | 同一路径的平台算法复刻（macOS `~/Library/Application Support/musefold`…），保证**读同一份数据** |
| EventSink | 转发到 `webContents.send` + 控制面 SSE | 仅控制面 SSE |

### 4.3 服务面（core 对外 API = 控制面/未来 IPC 的共同真源）

每个服务方法即一个「操作」，签名与现 IPC 请求/响应类型对齐（复用 `shared/types/*`），错误统一抛 `CoreError { code, message, details }`（沿用现 `IpcError` 语义与错误码表）。

**P1 迁移策略（防回归）**：core 先以「搬移 + re-export」方式吸收 `electron/db` 与 `electron/providers`，Electron 侧 IPC handler 改为调 core 服务；`npm run test` + Playwright E2E 全量回归绿灯后才进入 P2。渲染层与 IPC 契约**零改动**。

---

## 5. 控制面：Automation API v1

### 5.1 基本约定

| 项 | 约定 |
|---|---|
| 绑定 | 仅 `127.0.0.1`，动态端口（0 → OS 分配），**不监听局域网** |
| 鉴权 | `Authorization: Bearer <token>`；token 与端口写发现文件；设置页可一键轮换 |
| 版本 | 路径前缀 `/v1/`；破坏性变更 ⇒ `/v2` 并行期 ≥ 1 个次版本 |
| 编码 | JSON（UTF-8）；产物一律返回**本地绝对路径**而非二进制 |
| 错误 | `{ "error": { "code": "PROVIDER_AUTH_FAILED", "message": "…", "details": {} } }`，HTTP 状态映射（400 参数 / 401 token / 403 策略拒绝 / 404 / 409 忙 / 422 业务 / 500） |
| CORS | 不开放（非浏览器用途）；`Origin` 头存在即 403（防浏览器页面探测） |

### 5.2 端点目录（与暴露矩阵一一对应）

| 方法 & 路径 | 对应 core 服务 | 级别 |
|---|---|---|
| `GET /v1/health` | 版本/所有者/能力开关 | 🟢 |
| `GET /v1/prompts?query=&folderId=&tagIds=&limit=` | LibraryService.search | 🟢 |
| `GET /v1/prompts/:id` · `POST /v1/prompts` | get / create（含 `source:'slip'`） | 🟢 / 🟡 |
| `GET /v1/providers` · `GET /v1/providers/:id/models` | ProviderService（**响应永不含 key 字段**） | 🟢 |
| `POST /v1/generations` | GenerationService.generate（进入策略闸门，见 §5.4） | 🔴 |
| `GET /v1/generations/:jobId` · `DELETE /v1/generations/:jobId` | 状态查询 / 取消 | 🟢 / 🟡 |
| `GET /v1/history?limit=&status=` · `GET /v1/history/:id` | HistoryService | 🟢 |
| `GET /v1/recipes` · `GET /v1/recipes/:id` | RecipeService | 🟢 |
| `POST /v1/recipes/:id/compile` | renderRecipeComposition（纯） | 🟢 |
| `GET /v1/schemes` · `GET /v1/schemes/:id`（仅正式版） | SchemeService | 🟢 |
| `POST /v1/schemes/:id/compile` | 方案 prompt 编译预览 | 🟢 |
| `POST /v1/schemes/:id/runs` · `GET /v1/scheme-runs/:runId` | 方案运行 / 状态 | 🔴 / 🟢 |
| `POST /v1/skills/github/run` | SkillService（prepare + execute 聚合） | 🔴 |
| `GET /v1/materials?query=` | MaterialService | 🟢 |
| `POST /v1/uploads` | 参考图显式转存进受管暂存目录（配合路径白名单，V04-SECURITY §5） | 🟡 |
| `GET /v1/events`（SSE） | EventSink 订阅（见 §5.3） | 🟢 |
| `POST /v1/confirmations/:id`（App 内部/CLI 交互回执） | 策略闸门放行 | 🟡 |

> 备份/导出/Provider 写操作**不进 v1 远程面**：它们只在所有者进程本地执行（CLI 连本机守护时经专门的 `X-Musefold-Local-Only` 校验端点，P4 细化；MCP 一律不可见）。

### 5.3 事件流（SSE）

`GET /v1/events?jobId=…`（或不带过滤订阅全量），事件信封：

```
event: generation.progress
data: {"jobId":"…","phase":"uploading|generating|saving","percent":42}

event: generation.completed
data: {"jobId":"…","historyId":"…","assets":[{"path":"/Users/…/abc.png"}],"costCents":18,"durationMs":21000}

event: scheme.run.step / skill.runtime.delta / confirmation.required …
```

对应现有 `image.onProgress`、`designScheme.onEvent`、`skillRuntime.onEvent` 的信封统一。CLI 用它画进度；MCP 服务器把长任务转成阻塞工具调用并转发标准 progress 通知；低频状态读取只用于断线兜底。

### 5.4 策略闸门（花钱动作的服务端强制，D7）

```
POST /v1/generations
  → 估算成本（单价配置 × n × 尺寸档）
  → 判定：
     a. 请求带 Idempotency-Key 且命中已放行记录 → 直接执行
     b. 调用方声明的 budget（≤ 设置页「自动化预算」剩余额度）覆盖估算 → 记账并执行
     c. 否则 → 202 + {"confirmationId": "…"}，同时：
          · App 在运行：弹系统通知 + 应用内确认卡（朱点忙碌态）
          · MCP 路径：musefold-mcp 收到 202 后向客户端发起 elicitation 确认，
            用户点确认 → POST /v1/confirmations/:id → 原请求继续
     d. 超时（120s）未确认 → 409 CONFIRMATION_TIMEOUT
```

预算账本落在设置存储（`automation.budget`：月度上限 / 已用 / 白名单调用方），设置页可视化。

---

## 6. Electron 主进程改造点（全部为加法）

1. `electron/main/index.ts`：启动时若设置 `automation.enabled`（默认**开**，可关）→ `createAutomationServer(core, …)`，写发现文件；退出清理。
2. 既有 IPC handlers 改为薄委托 core 服务（P1 完成）；`window.api` 契约不变。
3. 设置页新增「自动化」面板：开关、端口/token 展示与轮换、月度预算、调用方审计列表（最近 50 条：谁、何时、调了什么、花了多少）。
4. 朱点（v0.3.3）忙碌态接入控制面任务：外部发起的生图与方案运行同样点亮呼吸态——用户对「后台有 Agent 在花钱」永远有全局感知。

---

## 7. 典型时序（场景 A 全链路）

```
Claude Code                musefold-mcp             控制面(App 主进程)          Provider
    │  tools/call generate_image │                        │                      │
    │───────────────────────────►│  POST /v1/generations  │                      │
    │                            │───────────────────────►│ 估算成本→需确认        │
    │                            │◄─── 202 confirmationId │                      │
    │   elicitation(确认 ¥0.18?) │                        │                      │
    │◄───────────────────────────│                        │                      │
    │  用户点「允许」              │                        │                      │
    │───────────────────────────►│ POST /v1/confirmations │                      │
    │                            │───────────────────────►│ 放行 → generate()     │
    │                            │   SSE: progress…       │─────────────────────►│
    │                            │◄───────────────────────│◄─────────────────────│
    │                            │   SSE: completed       │ 写盘+history+朱点熄灭  │
    │◄───────────────────────────│ CallToolResult:        │                      │
    │  ResourceLink(file://…png) │  structured + link     │                      │
```

---

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| core 抽取引发回归 | P1 只搬移不重构；IPC 契约冻结；单测 + E2E 全量门禁 |
| 双所有者竞态（App 与守护同启） | `owner.lock` 独占 + 发现文件 pid 活性校验；DB `busy_timeout` 兜底 |
| headless 密钥可用性（safeStorage 无 GUI 上下文） | SecretsPort 双实现；无 keychain 环境明确降级策略（V04-SECURITY §4），拿不到 key 的 Provider 在 `list_providers` 里标 `available:false` |
| 端口/token 泄露给本机恶意进程 | 发现文件 0600；token 轮换；预算硬上限；审计列表；参考图路径白名单 |
| MCP 客户端不支持 elicitation | `musefold-mcp` 启动探测客户端能力：不支持 ⇒ 生图工具描述中注明需预授权预算，未授权时返回结构化错误 `CONFIRMATION_REQUIRED` + 引导文案 |
| 长任务超时（Codex 默认 60s） | 接入文档配置 `tool_timeout_sec=300`；同时提供「提交即返回 jobId」模式（`wait:false`）与单次 `wait_for_generation` 事件等待 |
