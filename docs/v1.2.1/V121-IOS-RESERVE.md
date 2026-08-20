# Musefold v1.2.1 iOS 接入预留

> **状态**：M7 预留交付
>
> **日期**：2026-08-20
>
> **范围**：协议与认证侧预留。v1.2.1 **不**交付 iOS 工程、Capacitor 壳、App Store 包或任何可上架的客户端。实际接入属于 v3.0。

## 0. 范围声明

本文件只回答两件事，供 v3.0 开工时直接消费：

1. Cookie 会话如何演进为 iOS 可用的 bearer，且不破坏现有 Web（`V121-IOS-02`）。
2. App Store 条款 4.2（最低功能性）的应对：从现有桌面 IPC 里挑出有 iOS 原生对应物的能力，并给出优先级（`V121-IOS-03`）。

不在本文件范围内：Capacitor 工程脚手架、签名公证、热更新 iOS 消费端实现、App Store 提交。热更新协议侧的 `capacitor-web` surface 已在 `@musefold/update-protocol` 保留，见 `V121-HOT-UPDATE-PROTOCOL.md` 第 2 节与任务卡 `V121-IOS-01`。

形态选择本身已冻结在 `V121-TECHNOLOGY-DECISIONS.md` 第 10 节：Capacitor 包 `apps/web`。若 v3.0 改选 React Native，认证迁移与 4.2 能力清单仍然适用，只是原生桥从 Capacitor plugin 换成 RN module。

---

## 1. Cookie 会话 → bearer token（`V121-IOS-02`）

### 1.1 现状：Web Cookie 会话的建立与校验

Web 与 API 同源部署在 `zhaozhaoyue.top`。`infra/v1.1/Caddyfile` 把 `/Musefold/*` 交给静态站、把 `/api/musefold/v1/*` 反代到 `v11-web-api`。浏览器里这是同一 origin，Cookie 能带上。

**建立**

| 步骤 | 位置 | 行为 |
|---|---|---|
| 1 | `apps/web/src/runtime.ts` 的 `HttpWebGateway` | `createMusefoldCloudClient(baseUrl)`，默认 `VITE_API_BASE_URL` 或 `/api/musefold/v1` |
| 2 | `packages/cloud-client/src/index.ts` | `credentials: "include"`；登录走 `POST /auth/login` |
| 3 | `apps/web-api/src/modules/account/routes.ts` | `login` / `register` 调 `AccountService`，再用 `reply.setCookie` 写下会话 |
| 4 | `apps/web-api/src/modules/account/service.ts` | 先用 `@musefold/new-api-client` 对 new-api 做用户名密码登录，拿到 JWT + refresh；再 `SessionStore.create` 写入 `auth.web_sessions` |
| 5 | Cookie 属性 | 名默认 `mf_session`（`SESSION_COOKIE_NAME`）；`httpOnly: true`；生产 `secure: true`；`sameSite: "lax"`；`path: "/"`；`maxAge` = `SESSION_ABSOLUTE_TTL_SECONDS`（默认 2_592_000，30 天） |

会话本体是不透明 id（`createOpaqueId()`），库里只存 `hashSessionId(rawId)`。行内凭据（new-api 的 access/refresh）经 `SESSION_ENCRYPTION_KEY` 封存。`csrfToken` 与会话一同生成，返回给前端，不进 Cookie。

**校验**

资源接口（prompts / generations / workbench / sync / oauth 的 Web 面）走 `apps/web-api/src/modules/auth/request-auth.ts` 的 `requireMusefoldSession`：

1. 先读 `Authorization: Bearer …`，没有再用 Cookie `mf_session`。
2. `SessionStore.get(rawId)` 找不到即 401。
3. 写操作再过 `requireMusefoldCsrf`，比对 `X-Musefold-CSRF` 与会话里的 `csrfToken`。

例外：账号路由自己读 Cookie，**不**走 `requireMusefoldSession`。`GET /auth/me`、`POST /auth/logout`、`POST /auth/redeem` 一律 `requireCookie`。桌面端不走这三条，所以目前能工作；iOS 若只拿 Bearer、没有 Cookie，这三条今天会 401。这是 v3.0 必须补的缺口，不是推测。

空闲 / 绝对 TTL 由配置给出：`SESSION_IDLE_TTL_SECONDS` 默认 7 天，`SESSION_ABSOLUTE_TTL_SECONDS` 默认 30 天。具体 SQL 函数 `auth.find_web_session` / `auth.touch_web_session` 的闲置判定在数据库迁移里，本预留未逐行核对存储过程正文；消费侧只保证「get 不到就是过期」。

### 1.2 现状：device-token 怎么发、存哪、活多久

device-token **不是** Musefold Web API 的登录凭据。它是 new-api 的 `sk-` 令牌，给生图上游用。

**签发（客户端）**——`packages/new-api-client/src/index.ts`：

- `POST /api/token/`，body 为 `{ name, remain_quota: 0, unlimited_quota: true, expired_time: -1 }`。
- 列表 `GET /api/token/?p=0&page_size=20`。
- 取明文 `POST /api/token/:id/key`，缺 `sk-` 前缀时客户端补上。
- 管理面鉴权用 JWT：`Authorization: Bearer <jwt>`。
- 刷新管理 JWT：`POST /api/user/auth/refresh`，请求头里手工拼 `Cookie: new_api_refresh=<token>`——**不依赖浏览器 Cookie 罐**。登录时从 `Set-Cookie` 解析出 refresh 字符串交给调用方保存。

**桌面编排**——`electron/account/account-service.ts` 的 `ensureDeviceToken`：

- 登录成功后按设备名幂等供给（默认 `musefold-{mac|win|linux}-{rand}`）。
- 已有 `deviceTokenId` 则先 `fetchTokenKey`；令牌被删才重建。
- 明文 `sk-` 经 `managed-provisioner` 写入两栈 keychain（生图 Provider + AI connection），**不进** `electron-store`。
- store（`electron/account/account-store.ts`，`musefold-account-v0.5.0`）只留 `deviceTokenId` / `deviceTokenName` / `deviceTokenSuffix`（后四位）。
- 管理 JWT 只在进程内存；refresh 在 keychain，id 为 `account:refresh-token`（`ElectronAiSecretKeychain`，底层 Electron `safeStorage`）。
- 续期：JWT 余量少于 60 秒走 `ensureJwt` 单飞刷新，并把新的 refresh 写回 keychain。
- **登出是本地操作**：清 keychain、清 store、拆托管 Provider。不调 new-api 撤令牌，也不调 Web API `logout`。服务端令牌会残留。`new-api-client` 目前没有 delete/revoke token 方法。

**服务端再发一张**——`AccountService.ensureGenerationCredential` 用固定名 `Musefold Cloud v1.1` 再给 Web API 自己备一张 `sk-`，封进 `AccountCredentialStore`（`auth.upsert_account_credential`），供 generation-worker 调上游。与桌面那张 device-token 是平行的两套，不要混。

**生命周期（已核实）**

| 凭据 | 存哪 | 过期 |
|---|---|---|
| 用户密码 | 只在登录参数作用域 | 无持久化 |
| new-api JWT | 桌面：内存；Web API 会话行：封存 | 按 `access_expires_at`；桌面 60 秒余量刷新 |
| new-api refresh | 桌面 keychain；Web 会话行封存 | 随 new-api 刷新响应轮换 |
| device-token `sk-` | 桌面 keychain；Web API 凭据表 | `expired_time: -1`，客户端视为不过期 |
| Musefold 不透明会话 id | Web：Cookie；桌面：`sessionToken` 内存 | 闲置 7 天 / 绝对 30 天（配置默认） |

### 1.3 现状：`cloud-client` 的调用面

`packages/cloud-client/src/index.ts` 已经是双通道：

- **Web**：不设 `sessionToken`，靠 `credentials: "include"` 带 Cookie；登录/注册响应里的 `csrfToken` 留在模块内存，写操作加 `X-Musefold-CSRF`。
- **桌面**：`openDesktopSession(accessToken)` → `POST /auth/device-session`（请求头是 **new-api 管理 JWT**，不是 device-token `sk-`）→ 响应带 `sessionToken`（就是不透明会话 id）+ `csrfToken`。此后所有请求 `Authorization: Bearer <sessionToken>`，JWT 不再出现。单测 `packages/cloud-client/src/__tests__/client.test.ts` 锁死了这条「只交换一次、后续只用不透明会话」的约定。
- 编排入口：`electron/cloud-sync/index.ts` 的 `ensureClient`，管理 JWT 来自 `AccountService.managementAccessToken()`（内部 `ensureJwt`）。

`POST /auth/device-session` **不** `setCookie`。它把同一份 `SessionStore` 行的 `rawId` 放进 JSON。`openDesktopSession` 写入的 `refreshToken` 是空字符串——这条会话不能经 Web API 去 refresh new-api JWT。桌面也不需要：管理 JWT 的刷新在 Electron 主进程，Web API 资源路径只认不透明 id。

结论：Musefold 资源 API **今天就能用 Bearer**。缺的是账号三条路由、以及 iOS 侧把 refresh / 会话 id 放进 Keychain 的壳。不是从零发明一种认证。

### 1.4 iOS 为什么不能用 Cookie

不是「WKWebView 不会存 Cookie」这么简单，是 origin 与 ITP 叠在一起：

1. **跨源**。Capacitor 页面来源是 `capacitor://`（技术选型第 10 节已写）。常见变体还有 `ionic://localhost`、`https://localhost`（Capacitor 配置而定，**待 v3.0 确认具体 scheme/host**）。Web API 在 `https://zhaozhaoyue.top`。对 fetch 而言这是 cross-site。
2. **`SameSite=Lax`**。当前 Cookie 就是 Lax。Lax 只在顶级导航 GET 时带跨站 Cookie，XHR/fetch 这种子资源请求不带。iOS 里所有 API 调用都是子资源请求。
3. **httpOnly**。就算同源，JS 也读不到 `mf_session`，必须靠运行时自动附带。跨源时自动附带失败，前端无后备。
4. **WKWebView 与 Safari 的 Cookie 罐隔离**。用户在 Safari 里登录过 Musefold，装完 App 不会继承那份会话。
5. **ITP**。第三方 Cookie 默认拦截；即便将来改 `SameSite=None; Secure`，ITP 仍可能按分区存储或短期驱逐。把登录态押在跨站 Cookie 上，审核期和系统升级都可能突然断登录。

因此 iOS 必须把会话 id（或后继 bearer）当作**显式请求头**发送，存在 Keychain，而不是指望 `credentials: "include"`。

Web 继续用 Cookie。Caddy 同源布局不动。两条路径并行，见 1.6。

### 1.5 迁移路径：从 device-token 演进到 bearer

device-token 是起点，但不要把它直接当成 Musefold API 的 Bearer：`sk-` 的权限面是 new-api 生图与用户令牌 API，和 `mf_session` 代表的「已登录的 Musefold 用户」不是同一件事。正确演进是复用桌面已经走通的两跳，再补 iOS 缺口。

```
用户名/密码
    │
    ▼
new-api login  →  JWT（内存）+ refresh（Keychain）
    │
    ├─ createToken / fetchTokenKey  →  device-token sk-（Keychain，生图/上游）
    │
    └─ POST /auth/device-session  (Bearer JWT)
           │
           ▼
      Musefold sessionToken + csrfToken（Keychain）
           │
           ▼
      资源 API：Authorization: Bearer <sessionToken>
                写操作另带 X-Musefold-CSRF
```

**签发**。**已决策（2026-08-20）**：v3.0 首发复用 `POST /auth/device-session` 换回的不透明 `sessionToken`，不另建独立的 access / refresh / 撤销体系。论证：资源 API 今天已认这份 id（§1.3），Web 的 Cookie 路径零改动，iOS 只需把 token 放进 Keychain，并补账号三条路由认 Bearer。独立签发推迟。**复审触发条件**：出现「多设备管理」或「单设备远程撤销」需求时启动独立签发设计——现有不透明会话做不到按设备列出、按台作废，而不波及同一用户的 Web Cookie 会话。触发之前不要新造一套。device-token 继续只服务 new-api。

**刷新**。管理 JWT 用现有 `NewApiClient.refresh(refreshToken)`，请求头拼 Cookie 字符串，不碰 WKWebView Cookie 罐。Musefold `sessionToken` 靠 `SessionStore` 的闲置触摸续命；绝对 30 天到期后重新 `openDesktopSession`。首发不做专用 Musefold refresh token（同上决策）。若按触发条件启动独立签发，refresh 必须同时做轮换与撤销，不能只发不收。

**撤销**。Musefold 侧已有 `SessionStore.revoke`（Web `logout` 在用）。iOS 登出应调它，不要学桌面「只清本地」。new-api device-token 的服务端撤销：**客户端没有封装，new-api 是否暴露 DELETE 待 v3.0 对上游核实**；核实前登出至少删 Keychain，接受服务端 `sk-` 残留（与今日桌面相同）。独立签发未触发前，远程按设备撤销做不到——这正是 §1.5 签发条的复审触发条件，不是首发缺口。

**CSRF**。**已决策（2026-08-20）**：iOS Bearer 写操作继续发送 `X-Musefold-CSRF`，与桌面 `cloud-client` 行为一致（`packages/cloud-client/src/__tests__/client.test.ts` 已锁死），服务端零改动。Bearer 不会被浏览器自动附带，经典 CSRF 并不成立，但今日 `csrfToken` 仍是写操作第二因子，首发不拆这条路径。豁免推迟到服务端能显式区分 Bearer-only 客户端时再议；届时必须配套测试，避免 Web Cookie 路径被顺带放开。

**存储（iOS Keychain）**。对标桌面红线（`electron/account/account-store.ts` 头部注释）：

| 项 | 桌面 | iOS（v3.0） |
|---|---|---|
| 密码 | 不落盘 | 不落盘 |
| new-api JWT | 内存 | 内存；杀进程后用 refresh 换 |
| new-api refresh | Keychain `account:refresh-token` | Keychain，`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`（具体 accessibility **待 v3.0 确认**） |
| device-token `sk-` | 两栈 keychain | Keychain；webview 不可读 |
| Musefold `sessionToken` / `csrfToken` | 主进程内存 | Keychain（杀进程后还要能静默恢复） |
| 用户名、token 后四位 | electron-store | UserDefaults 或等价非敏感存储 |

不要放进 `localStorage` / Capacitor Preferences：webview 资产可被内容层热更新替换，Prefs 不是密钥柜。

**与 Cookie 并行、不破坏 Web**。`requireMusefoldSession` 已经是 Bearer 优先、Cookie 其次。Web 的 `setCookie` 路径一个字节都不必为 iOS 改。禁止「为了 iOS 把 Web 改成只认 Bearer」或「给 SPA 也发 `sessionToken` 让它改存 localStorage」——那会把 httpOnly 会话变成 XSS 可偷的 token。

### 1.6 分阶段步骤与兼容性

| 阶段 | 做什么 | 对 Web 的影响 | 对桌面的影响 |
|---|---|---|---|
| A. 现有双通道（已落地） | `requireMusefoldSession` 认 Bearer 或 Cookie；`/auth/device-session` 发不透明 id | 无 | 云同步已在用 |
| B. 账号路由认 Bearer | `me` / `logout` / `redeem` 与资源接口同一套取会话 | 仍可只靠 Cookie；有 Bearer 时不要误清 Cookie | 桌面若改走这三条，行为与现网一致 |
| C. iOS 壳接 Keychain + 两跳登录 | Capacitor plugin；webview 只拿「已登录摘要」，拿不到密钥 | 无 | 无 |
| D. 契约补 `ios` | `packages/contracts/src/sync.ts` 的 `platform` 现为 `macos \| windows \| linux`，iOS 设备注册会 Zod 失败 | 无 | 无 |
| E. 推迟：独立 iOS bearer | **已决策（2026-08-20）**：首发不做独立签发 / 刷新 / 撤销 / 范围。复审触发条件为「多设备管理」或「单设备远程撤销」；触发前继续用不透明 `sessionToken`。Cookie 会话始终服务 Web | 不得改变 Cookie 语义 | 继续用今天的不透明 id，不必强迁 |
| F. CSRF 头照带 | **已决策（2026-08-20）**：iOS Bearer 写操作继续发送 `X-Musefold-CSRF`，与桌面 `cloud-client` 一致（该行为已由单测锁死），服务端零改动。Bearer 虽非浏览器自动附带、经典 CSRF 不成立，但 `csrfToken` 今日仍是写操作第二因子，首发不拆。豁免推迟到服务端能显式区分 Bearer-only 客户端时再议，届时必须配套测试，避免 Web Cookie 路径被顺带放开 | Web Cookie 路径的 CSRF 校验不变 | 不变 |

A 已在 v1.2.1。B–D 是 v3.0 开工最小集。E 按 2026-08-20 决策推迟，未触发复审前不要把 device-token `sk-` 直接授权 Musefold 资源 API。F 已决策为首发照带 CSRF 头。

### 1.7 v3.0 开工时要加什么、什么可复用

**服务端要加**

- 账号三条路由接受 Bearer（与 `requireMusefoldSession` 对齐），`logout` 在 Bearer 路径撤销会话且不依赖 `clearCookie`。
- `syncDeviceRegistrationSchema.platform` 增加 `ios`（及是否要 `ipados`，**待 v3.0 确认**）。
- 独立 bearer：**已决策（2026-08-20）**首发不做。复审触发条件为「多设备管理」或「单设备远程撤销」；触发后再加签发、refresh 轮换、撤销列表、可选 scope，与 `mf_session` 并行、互不废止。
- iOS 登录/换票的速率限制（可仿 `RATE_LIMIT_POLICIES.desktopSession`）。
- CSRF：**已决策（2026-08-20）**首发不豁免。iOS 与桌面一样发送 `X-Musefold-CSRF`，服务端零改动。豁免推迟到服务端能显式区分 Bearer-only 客户端时再议；届时必须配套测试，避免 Web Cookie 路径被顺带放开。

**客户端要加**

- Capacitor 原生插件：Keychain 读写、登录/刷新/登出编排。密码与 refresh 不准进 webview。写操作必须附带 `X-Musefold-CSRF`（2026-08-20 决策，与桌面 `cloud-client` 对齐）。
- 对 `NewApiClient` / `MusefoldCloudClient` 的适配：原生侧持 token，webview 只调桥。`cloud-client` 已支持 `sessionToken` 选项，可复用其请求编码与 CSRF 头拼接，但 Capacitor 的 fetch Cookie 罐与 Node/Electron 不同，**待 v3.0 确认是原生 HTTP 还是 WK fetch**。
- 内容层 `capacitor-web` 消费端（验签、解压、回滚）——属热更新，不属本认证卡，但登录态必须在 bundle 切换后仍从 Keychain 恢复。

**可以复用**

- `requireMusefoldSession` 的 Bearer 分支。
- `POST /auth/device-session` + `desktopAccountSessionSchema`。
- `@musefold/new-api-client` 的 login / refresh / createToken / fetchTokenKey（refresh 已是显式字符串，不绑浏览器 Cookie）。
- `@musefold/cloud-client` 的 CSRF 头与 `Authorization` 拼接。
- `SessionStore` 与绝对/闲置 TTL。
- 桌面「JWT 内存、refresh 进安全存储、store 只留后缀」的红线。

**不要复用**

- Web 的 `setCookie` / `requireCookie`。
- Electron `safeStorage` + `electron-store` 密文格式（iOS Keychain 是另一套）。
- 把 device-token `sk-` 直接塞进 `Authorization` 调 `/api/musefold/v1`。
- 桌面登出的「只清本地」。

---

## 2. App Store 条款 4.2（`V121-IOS-03`）

### 2.1 风险

条款 4.2 要求应用具备超出「套壳网站」的最低功能性：要有让用户愿意装 App 而不是只开 Safari 的功能、内容与 UI。Capacitor 包 `apps/web` 若原样上架，审核员会看到与 `https://zhaozhaoyue.top/Musefold/` 几乎同一份 SPA，拒绝理由会落在 4.2，而不是 2.5.2（WebKit 解释执行的 JS 远程替换是豁免的，见协议第 0 节）。

技术选型第 10 节已定性：至少落地两三项实质原生集成。下面的清单不从愿望出发，而从 `electron/main/ipc/index.ts` 已注册的 handler 出发——桌面有、Web 没有（或 Web 只有云端弱替代）、且 iOS 有对等原生 API 的，才进候选。桌宠、托盘、多窗口、Finder 揭示文件没有对等物，直接排除。

iOS 没有 Electron IPC。表中「协议侧影响」指：要不要新的 Capacitor plugin 契约、要不要改 `@musefold/contracts` / bearer 范围、要不要新服务端 API。不是再给 Electron 加通道。

### 2.2 候选原生集成（从现有 IPC 对照）

**不适用 iOS，排除**

| 桌面能力 | 代码 | 原因 |
|---|---|---|
| 桌宠悬浮窗 | `electron/main/pet/`，`IPC.PET_*` | 依赖独立 `BrowserWindow` 与桌面坐标 |
| 托盘 | `electron/main/tray.ts` | iOS 无对应物 |
| 打开所在文件夹 / 关于文档 | `IPC.SYSTEM_OPEN_IN_FOLDER`、`SYSTEM_OPEN_ABOUT_RESOURCE` | 桌面壳行为 |
| 外壳层 electron-updater | `IPC.UPDATER_*`（应用更新，非内容层） | iOS 走 App Store / TestFlight |
| 本地 automation HTTP 服务器 | `electron/main/ipc/automation.ts` 对外端口 | iOS 不能在后台开本地 HTTP 给 Cursor/Codex 打 |

**推荐纳入 4.2 证据链**

| 优先级 | 能力 | 桌面已有 | Web 现状 | iOS 原生 API 域 | 协议 / 认证影响 |
|---|---|---|---|---|---|
| P0 | 分享导入 | `IPC.SHARE_*`；`electron/main/share-protocol.ts` 注册 `musefold://`；载荷在 `shared/share.ts` | 无自定义协议，无分享卡片落盘 | Universal Links / 自定义 URL Scheme；Share Extension；`UIActivityViewController` | 复用 `SharePayload`；要原生插件。不新开 bearer 范围。Associated Domains **待 v3.0 确认** |
| P0 | 保存到相册 | `IPC.SYSTEM_SAVE_IMAGE` / `SAVE_IMAGES`（`electron/system/image-actions.ts` 写用户选的目录） | 历史里的图是云端 URL，无「存到系统相册」 | `PHPhotoLibrary` / `PhotosUI`；权限 `NSPhotoLibraryAddUsageDescription` | 纯本地。无新 IPC 通道，无 bearer 范围 |
| P0 | 从相册选参考图 | `IPC.IMAGE_PICK_LOCAL`（`dialog.showOpenDialog`）+ `IMAGE_STAGE_LOCAL` | Web 创作台若有文件选择，也只是 `<input type=file>`，无系统相册权限叙事 | `PHPickerViewController` | 纯本地。Web 已有云端参考图上传则对齐 contracts，**待 v3.0 对照 `apps/web` 创作台是否已接文件选择** |
| P1 | 离线本地生成历史 | `IPC.HISTORY_*`，SQLite + 磁盘图片（`electron/main/ipc/history.ts`） | `HistoryView` 只读 Web API `/generations` | 本地 SQLite 或 Filesystem + 与云历史对账 | 若只做「云历史的本地缓存」可能要新 API；若只缓存已下载资产则无协议变更。与桌面 schema 是否共用 **待 v3.0 确认** |
| P1 | 剪贴板读图/贴文 | `IPC.SYSTEM_COPY_IMAGE`、`READ_CLIPBOARD_TEXT`、`READ_CLIPBOARD_IMAGE` | 浏览器剪贴板权限弱且不稳定 | `UIPasteboard` | 纯本地 |
| P1 | 账号密钥进 Keychain | 桌面 `safeStorage`；登录编排见 §1 | Web 会话在 httpOnly Cookie，密钥不在浏览器 | iOS Keychain Services | 认证前置，本身不够 4.2，但是 P0 分享/相册之外的必备壳能力。无新 bearer 范围 |
| P1 | 快捷指令 | 桌面是本地 automation 端口 + 系统 `Notification`（`electron/main/automation.ts`） | 无 | App Intents / Shortcuts | **不是**把桌面 HTTP 服务器搬到手机。要单独设计意图（例如「用当前提示词生成一张」）。可能要新的受限 bearer 范围，**待 v3.0 确认是否首发就做** |
| P2 | 远程推送 | 桌面只有本机 `Notification`（自动化确认卡），无 APNs | 无 | APNs；Capacitor Push | **需要服务端**（device token 登记、发送）。现网没有这条 API。不与 new-api device-token 混名 |
| P2 | 桌面小组件 | 无 | 无 | WidgetKit | 无现成 IPC。数据源要么本地缓存要么新只读 API。4.2 加分项，不是最小集 |
| P2 | 提示词库本机导入导出 | `IPC.SYSTEM_EXPORT` / `SYSTEM_IMPORT` | 云端 CRUD，无文件包 | `UIDocumentPickerViewController` / Files | 可复用导出信封 `ExportEnvelope`（`shared/types/ipc.ts`）。无 bearer 范围 |
| P2 | 云同步登记 iOS 设备 | `IPC.CLOUD_SYNC_*`；`openDesktopSession` | Web 本身就是云，无「设备」 | 无新系统 API；差契约 | **必须**改 `platform` 枚举，否则 iOS 注册失败。属同步，不是 4.2 最小集 |

推送与 Widget 常被当作 4.2 例证，但**当前仓库里没有对应实现**，不能写成「桌面已有」。它们是 iOS 侧可以新建的加分项，成本高于分享/相册。

### 2.3 优先级排序与理由

1. **P0 底线（已决策，2026-08-20）：分享导入、存入相册、相册选参考图必须随第一个上架外壳交付，不得指望 OTA。** 论证：三者都是桌面已交付、Web 做不到或做不像的系统级动作；审核员可以在一分钟内完成「从另一个 App 分享进来 / 把图存进照片」。载荷与保存逻辑已有（`shared/share.ts`、`image-actions.ts`），v3.0 主要是桥，不发明产品。三条都纯本地，**不需要新的 bearer 范围**，不阻塞 §1 的认证并行。技术选型第 10 节「至少两三项」以此为下限。不能靠热更新补发的依据见 [热更新协议](./V121-HOT-UPDATE-PROTOCOL.md) 第 0 节：协议只覆盖 webview 可解释执行的资产，原生二进制与系统权限属外壳层，只能随应用商店发版。
2. **P1 Keychain 登录**与认证卡绑定，不是给审核看的彩蛋，但是没有它 P0 里「已登录用户的云历史/云提示词」演示不了。与 4.2 同时开工。
3. **P1 本地历史与剪贴板**强化「这是一台设备上的创作工具」而不是浏览器标签。若排期紧，历史可以先做「已下载图片的本地相册缓存」，不必先移植整份桌面 SQLite 谱系。
4. **P1 快捷指令**产品叙事强，但要重做意图模型，不能复用 `automation` HTTP。放到首版审核通过之后，除非 P0 仍被拒需要加码。
5. **P2 推送 / Widget / 文件包导入导出 / 同步 ios 平台。** 推送与 Widget 要新服务端或新 UI 面；同步 `ios` 枚举是正确性修补，不是 4.2 证据。首版能做同步枚举就做，不要等 Widget。

审核演示建议（v3.0 提交包，非本版本）：冷启动 → Keychain 静默恢复登录 → 用相册参考图生成或打开一条云历史 → 存入照片 → 从分享扩展导入一条 `musefold://` 提示词。这条路径不依赖推送、不依赖桌宠、不依赖本地 HTTP。

### 2.4 与热更新、条款 2.5.2 的边界

内容层只替换 webview 资产（`capacitor-web`）。[热更新协议](./V121-HOT-UPDATE-PROTOCOL.md) 第 0 节划定的合规边界是：本协议不覆盖任何原生二进制、系统权限或外壳层代码；那些只能经应用商店分发。因此 P0 的 Photo / Share 能力在外壳层，**已决策（2026-08-20）**必须随**第一个**上架外壳交付，不能经热更新加权限或补原生桥。条款 2.5.2 对 WebKit 解释执行的 JavaScript 有豁免，OTA 只合法替换 webview 资产，补不了 4.2 所需的原生集成。认证 bearer 同理：第一个外壳就要能登录，否则审核看到的是未登录的套壳站点。

---

## 3. 相关文档

- [内容层热更新协议](./V121-HOT-UPDATE-PROTOCOL.md)（`capacitor-web` surface、未知 surface 忽略）
- [技术选型与决策](./V121-TECHNOLOGY-DECISIONS.md) 第 10 节
- [交付计划](./V121-DELIVERY-PLAN.md) 第 9 节 M7
- [CI/CD 架构](./V121-CICD-ARCHITECTURE.md)
