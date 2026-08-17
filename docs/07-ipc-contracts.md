# 07 · IPC 契约（类型驱动）

> 主进程 ↔ 渲染进程的所有通道名、请求/响应类型。`shared/types/ipc.ts` 是其代码化，preload 与渲染都依赖它。

---

## 1. 通道命名规范

`<域>:<实体>:<动作>`

| 域 | 含义 | 示例 |
|---|---|---|
| `db` | 数据库 CRUD | `db:prompts:list` |
| `image` | 生图调用 | `image:generate` |
| `provider` | Provider 配置 + 密钥 | `provider:saveKey` |
| `system` | 系统（路径、版本） | `system:getPaths` |
| `updater` | 应用在线更新 | `updater:check` |

---

## 2. 错误约定

所有 IPC 返回 Promise。失败时 reject 一个标准 `IpcError`：

```ts
// shared/types/ipc.ts
export interface IpcError {
  code: string;          // 机器可读，如 'AUTH_FAILED' / 'RATE_LIMITED' / 'NOT_FOUND'
  message: string;       // 用户可读中文
  details?: unknown;     // 额外上下文（如 HTTP 状态码、响应体）
}
```

主进程 handler 统一 try/catch，把异常包装成 `IpcError` 再 reject。

---

## 3. 通道清单

### 3.1 提示词 `db:prompts:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:prompts:list` | `{ folderId?, tagIds?, search?, filters?, sort? }` | `Prompt[]` |
| `db:prompts:get` | `{ id: string }` | `Prompt \| null` |
| `db:prompts:create` | `NewPrompt` | `Prompt` |
| `db:prompts:update` | `{ id: string, patch: Partial<Prompt> }` | `Prompt` |
| `db:prompts:delete` | `{ id: string }` | `{ ok: true }` |
| `db:prompts:togglePin` | `{ id: string, pinned: boolean }` | `Prompt` |
| `db:prompts:reorderPins` | `{ ids: string[] }` | `{ ok: true }` |
| `db:prompts:incrementUsage` | `{ id: string }` | `{ ok: true }` |
| `db:prompts:createFromComposition` | `{ compositionId: string, title?: string }` | `Prompt` |

### 3.2 文件夹 `db:folders:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:folders:list` | `{ parentId? }` | `Folder[]` |
| `db:folders:create` | `{ name: string, parentId?: string }` | `Folder` |
| `db:folders:update` | `{ id, patch }` | `Folder` |
| `db:folders:delete` | `{ id }` | `{ ok: true }` |
| `db:folders:reorder` | `{ ids: string[] }` | `{ ok: true }` |

### 3.3 标签 `db:tags:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:tags:list` | `{ group? }` | `Tag[]` |
| `db:tags:create` | `{ name, group?, color? }` | `Tag` |
| `db:tags:update` | `{ id, patch }` | `Tag` |
| `db:tags:delete` | `{ id }` | `{ ok: true }` |
| `db:tags:assignToPrompt` | `{ promptId, tagIds[] }` | `{ ok: true }` |

### 3.4 组合系统 `db:fragments:*` / `db:templates:*` / `db:compositions:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:fragments:list` | `{ type?, category?, search? }` | `Fragment[]` |
| `db:fragments:create` | `NewFragment` | `Fragment` |
| `db:fragments:update` | `{ id, patch }` | `Fragment` |
| `db:fragments:delete` | `{ id }` | `{ ok: true }` |
| `db:templates:list` | `{}` | `Template[]` |
| `db:templates:create` | `NewTemplate` | `Template` |
| `db:templates:update` | `{ id, patch }` | `Template` |
| `db:templates:delete` | `{ id }` | `{ ok: true }` |
| `db:compositions:list` | `{ templateId? }` | `Composition[]` |
| `db:compositions:create` | `NewComposition` | `Composition` |
| `db:compositions:update` | `{ id, patch }` | `Composition` |
| `db:compositions:delete` | `{ id }` | `{ ok: true }` |

### 3.5 Provider `provider:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `provider:list` | `{}` | `ProviderConfig[]`（不含明文 key） |
| `provider:create` | `NewProviderConfig` | `ProviderConfig` |
| `provider:update` | `{ id, patch }` | `ProviderConfig` |
| `provider:delete` | `{ id }` | `{ ok: true }` |
| `provider:saveKey` | `{ id, apiKey: string }` | `{ ok: true }` |
| `provider:hasKey` | `{ id }` | `{ hasKey: boolean, suffix: string \| null }` |
| `provider:validate` | `{ id }` | `ValidationResult` |
| `provider:listModels` | `{ id }` | `ModelInfo[]`（仅模型元数据，不含密钥） |
| `provider:setActive` | `{ id }` | `{ ok: true }` |

> **密钥约定**：`provider:list` / `provider:get` 永不返回 `apiKey`。渲染进程需要密钥信息时调 `provider:hasKey`，只拿到 `hasKey: boolean` + `suffix`（末 4 位）。明文 key 只在主进程 `generateImage` 时内部读取。

### 3.6 生图 `image:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `image:generate` | `GenerateImageRequest` | `GenerateImageResult` |
| `image:cancel` | `{ jobId: string }` | `{ ok: true }` |
| `image:retry` | `{ historyId: string }` | `GenerateImageResult` |

**GenerateImageRequest**：
```ts
{
  providerId: string;
  model?: string;             // 覆盖 Provider 默认
  prompt: string;
  negative?: string;
  size: ImageSize;
  quality: ImageQuality;
  n: number;
  background?: 'auto' | 'transparent' | 'opaque';
  moderation?: 'auto' | 'low';
  promptId?: string;          // 来源提示词（写历史用）
  compositionId?: string;     // 来源组合（写历史用）
}
```

**GenerateImageResult**：
```ts
{
  historyId: string;
  status: 'success' | 'failed' | 'cancelled';
  imagePath?: string;         // 成功时本地路径
  error?: { code: string; message: string };
  cost?: number;              // 数值单位由对应 HistoryRecord.costUnit 快照决定（cny_cent | point）
  durationMs?: number;
}
```

### 3.7 历史 `db:history:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `db:history:list` | `{ status?, limit?, offset? }` | `HistoryRecord[]` |
| `db:history:get` | `{ id }` | `HistoryRecord \| null` |
| `db:history:delete` | `{ id }` | `{ ok: true }` |
| `db:history:clear` | `{ before?: number }` | `{ ok: true }` |

### 3.8 系统 `system:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `system:getPaths` | `{}` | `{ userData, pictures, backups }` |
| `system:getVersion` | `{}` | `{ app: string, db: number }` |
| `system:openInFolder` | `{ path: string }` | `{ ok: true }` |
| `system:export` | `{ format, promptIds? }` | `{ path: string }` |
| `system:import` | `{ path: string }` | `{ imported: number }` |

### 3.9 账号与云通道 `account:*`（v0.5）

> 类型真源：`shared/types/account.ts` + `shared/types/ipc.ts`。安全红线：响应永不含密码、JWT、refresh 凭据或 `sk-` 明文；仅可返回设备令牌末 4 位。

| 通道 | 请求 | 响应 |
|---|---|---|
| `account:status` | 无 | `AccountStatus` |
| `account:register` | `{ username, password }` | `AccountStatus`（注册成功即登录并供给双栈） |
| `account:login` | `{ username, password }` | `AccountStatus` |
| `account:logout` | 无 | `AccountStatus`（本地回收托管双栈；服务器不可达也成功） |
| `account:redeem` | `code: string` | `{ quotaAdded, status }` |
| `account:refreshQuota` | 无 | `AccountStatus`（JWT 到期时主进程用 refresh 凭据静默续期） |
| `account:setServerUrl` | `url: string` | `AccountStatus`（仅未登录可改） |
| `account:changed` | 主进程推送 | `AccountStatus` |

主进程账号域错误以 `ACCOUNT_ERR::<AccountErrorPayload JSON>` 放入 Electron `Error.message`；preload 仅负责还原 `{ code, message, stage? }` 后再 reject。账号凭据及登录、注册、兑换操作不暴露给 Automation API / CLI / MCP；自动化仅可读取脱敏就绪状态或唤起此原生表单（D12）。

### 3.10 应用更新 `updater:*`

| 通道 | 请求 | 响应 |
|---|---|---|
| `updater:getState` | 无 | `UpdateStatus` |
| `updater:check` | 无 | `UpdateStatus` |
| `updater:download` | 无 | `UpdateStatus` |
| `updater:install` | 无 | `UpdateStatus` |
| `updater:stateChanged` | 主进程推送 | `UpdateStatus` |

`UpdateStatus` 仅包含当前版本、目标版本、下载进度和用户可读错误；更新包路径、签名对象和 updater 实例不穿过 IPC。

---

## 4. preload 暴露形态

`window.api` 按域分组，每个方法是对应 IPC 的类型安全封装：

```ts
// electron/preload/index.ts
const api = {
  prompt: {
    list: (q: ListPromptsQuery) => ipcRenderer.invoke('db:prompts:list', q),
    create: (p: NewPrompt) => ipcRenderer.invoke('db:prompts:create', p),
    // ...
  },
  folder: { /* ... */ },
  tag: { /* ... */ },
  fragment: { /* ... */ },
  template: { /* ... */ },
  composition: { /* ... */ },
  provider: { /* ... */ },
  account: { /* status/register/login/logout/redeem/refreshQuota/setServerUrl/onChanged */ },
  updater: { /* getState/check/download/install/onStateChanged */ },
  image: { /* ... */ },
  history: { /* ... */ },
  system: { /* ... */ },
};

contextBridge.exposeInMainWorld('api', api);
```

类型来自 `shared/types/ipc.ts`，渲染进程通过 `window.api.prompt.list(...)` 调用，有完整类型提示。

---

## 5. 实现约定

- **主进程 handler**：每个域一个文件（`electron/main/ipc/prompts.ts` 等），在 `index.ts` 统一注册
- **参数校验**：用 zod schema 校验入参，校验失败 reject `{ code: 'INVALID_PARAMS', message: '...' }`
- **不暴露原始错误**：DB 错误、网络错误包装成 `IpcError`，不泄露内部堆栈给渲染进程
- **日志**：主进程记日志，但密钥相关操作脱敏
