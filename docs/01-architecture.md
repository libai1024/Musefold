# 01 · 架构设计

> 三进程划分、IPC 数据流、安全边界、目录职责。

---

## 1. 进程划分

```
┌─────────────────────────────────────────────────────────┐
│                   渲染进程 (React)                        │
│   pages / features / components / stores / lib           │
│   ↑ 只能用 window.api，无 Node 能力                      │
├─────────────────────────────────────────────────────────┤
│  contextBridge (preload)                                 │
│   ↑ window.api = 类型安全的 IPC 调用封装                  │
├─────────────────────────────────────────────────────────┤
│                   主进程 (Node.js)                       │
│   ipc handlers / db repositories / providers / security   │
│   ↑ 唯一能访问 SQLite / safeStorage / 文件系统           │
└─────────────────────────────────────────────────────────┘
```

| 进程 | 入口 | 能力 | 限制 |
|---|---|---|---|
| 主进程 | `electron/main/index.ts` | SQLite、safeStorage、fs、网络（生图 API） | 不能直接渲染 UI |
| preload | `electron/preload/index.ts` | contextBridge 暴露 `window.api` | contextIsolation 隔离，无业务逻辑 |
| 渲染进程 | `src/main.tsx` | React UI、状态管理 | `nodeIntegration:false`，只能用 `window.api` |

**共享层 `shared/`**：主进程与渲染进程都依赖的类型与常量，是契约层，不含运行时逻辑。

---

## 2. IPC 数据流

以"创建提示词"为例：

```
渲染进程                preload                 主进程
   │                       │                       │
   │ 1. 调用               │                       │
   │  window.api.prompt    │                       │
   │  .create(data)        │                       │
   ├──────────────────────▶│                       │
   │                       │ 2. ipcRenderer.invoke │
   │                       │  ('db:prompts:create'│
   │                       │   , data)             │
   │                       ├──────────────────────▶│
   │                       │                       │ 3. ipcMain.handle
   │                       │                       │  ('db:prompts:create')
   │                       │                       │  → promptsRepo.create()
   │                       │                       │  → SQLite INSERT
   │                       │                       │ 4. 返回 Prompt
   │                       │◀──────────────────────┤
   │  5. Promise resolve   │                       │
   │  → Prompt             │                       │
   │◀──────────────────────┤                       │
```

**关键约定**：
- **通道命名**：`<域>:<实体>:<动作>`，如 `db:prompts:create`、`image:generate`、`provider:saveKey`（详见 [07-ipc-contracts.md](07-ipc-contracts.md)）
- **类型安全**：preload 暴露的 API 签名来自 `shared/types/ipc.ts`，渲染进程调用有完整类型提示
- **请求/响应**：所有 IPC 返回 Promise，成功 resolve 数据、失败 reject 一个标准化的 `IpcError`
- **错误约定**：不抛裸字符串，统一 `{ code: string, message: string, details?: unknown }`

---

## 3. 安全边界

### 3.1 密钥生命周期

```
用户在 UI 输入 api_key
  → 渲染进程（明文短暂存在输入框）
  → window.api.provider.saveKey(providerId, apiKey)
  → 主进程 safeStorage.encryptStringAsync(apiKey)
  → 写入 electron-store（base64 密文）
  → 渲染进程内存中的明文立即被丢弃（用完即清）

生图时：
  → 主进程从 electron-store 读密文
  → safeStorage.decryptStringAsync → 明文
  → 明文仅在 Provider 类实例内存中，用于这次请求
  → 请求结束后，明文随实例释放
  → 日志拦截器脱敏请求头，永不打印 key
```

**红线**：
- 永不通过 IPC 返回明文 key
- 永不在日志/控制台打印 key（封装 OpenAI client 拦截器脱敏）
- 渲染进程查询 Provider 配置时，只返回 `hasKey: boolean` + `keySuffix: '...xxxx'`（末 4 位用于显示）

### 3.2 渲染进程隔离

- `contextIsolation: true`：渲染进程的 window 对象与 preload 隔离，防止 XSS 注入直接拿 Node
- `nodeIntegration: false`：渲染进程不能 require 任何 Node 模块
- `sandbox: true`（preload）：进一步限制 preload 能力，仅暴露白名单 API

### 3.3 CSP（内容安全策略）

主窗口 `webPreferences` 配置 CSP，限制可加载资源来源，防止注入。开发期允许 localhost，生产期严格限制。

---

## 4. 目录职责约定

```
shared/          ← 契约层：类型 + 常量，无运行时逻辑，主进程和渲染都依赖
  types/         ← TypeScript 接口/枚举（先于实现完整定义）
  constants.ts   ← 路径名、默认值、枚举字面量

electron/         ← 主进程
  main/          ← app 生命周期、窗口、IPC handler 注册
    ipc/         ← 按模块分 handler（与 shared/types/ipc.ts 一一对应）
  preload/       ← contextBridge，只做转发，无业务逻辑
  db/            ← SQLite 连接、schema、迁移、repositories（按表分文件）
  providers/     ← 生图 Provider 抽象 + 各实现
  security/      ← safeStorage 封装
  system/        ← 路径、迁移调度

src/              ← 渲染进程
  pages/         ← 顶层视图（Library/Composer/History）
  features/      ← 按业务域组织（自包含 components/hooks/store）
  components/    ← 共享 UI（shadcn 基础组件 + layout）
  stores/        ← zustand 全局状态
  lib/           ← ipc 封装、utils、format
  styles/        ← Tailwind + CSS 变量
```

**依赖方向**（单向，禁止逆向）：
```
shared ← electron/main ← preload
shared ← src/renderer
```
- `shared` 不依赖任何一侧
- `electron` 和 `src` 都依赖 `shared`，但互不依赖
- preload 是主进程侧的最后一层，只做转发

---

## 5. 开发与生产构建

| 命令 | 作用 |
|---|---|
| `npm run dev` | electron-vite 启动：main/preload 热重载 + renderer HMR |
| `npm run build` | 构建生产产物到 out/ |
| `npm run package` | electron-builder 打包 dmg/nsis 安装包 |
| `npm run typecheck` | tsc --noEmit 跨三 tsconfig 检查 |

**native 模块处理**：
- `better-sqlite3` + `@node-rs/jieba` 需 `@electron/rebuild` 针对 Electron ABI 重编译
- `electron-builder.yml` 配 `asarUnpack`：`**/node_modules/better-sqlite3/**` + `**/node_modules/@node-rs/jieba*/**`，否则 asar 内无法加载 `.node` 二进制
