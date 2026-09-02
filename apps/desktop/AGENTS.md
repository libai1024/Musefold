# apps/desktop — 桌面端开发约束

Electron 43 应用。渲染层规范以 `docs/v2.5/V25-UI-SPEC.md` 为准,本文件只管主进程侧与桌面特有流程。

## 目录职责

```text
electron/main/            应用编排(application.ts)、v25 单通道桥(ipc-v25/ 按域分文件)、
                          遗留装配(ipc/index.ts:updater + pet + doubao 登录同步)、
                          automation 全家(CLI/MCP/Automation API 的宿主侧)、design-scheme、skill-import
electron/preload/v25.ts   主窗口唯一 preload:数据域经 `musefold:invoke` 单通道纯转发;另可暴露窗口宿主信号(只读查询/事件)与窗口生命周期动作(minimize/maximizeToggle/close),不 import electron 之外任何模块
electron/preload/index.ts 桌宠窗口专用 preload(pet.* + updater.notifyContentReady)
electron/update/          electron-updater 封装 + 内容热更(Ed25519,基于 packages/update-protocol)
electron/{ai,security,settings,system,doubao-web}/  按域的主进程模块
src/v25/                  v2.5 渲染壳(shell.html + desktop-gateway):挂载 packages/features 的屏
src/pet/                  桌宠窗口(冻结面,独立 renderer 入口,不与 v25 壳互相 import)
```

主进程与渲染层禁止互相泄漏:渲染层禁 import `electron`(depcruise `renderer-no-electron`);`packages/core` 禁 import electron。

## 新增 / 修改 IPC 的标准流程(v25 单通道桥)

数据域一律走 `musefold:invoke` 单通道。以「给 prompts 域加一个方法」为例:

1. **契约**:实体/入参形状在 `packages/contracts`(zod);方法入参必须有 schema。
2. **方法表**:在 `electron/main/ipc-v25/<domain>-domain.ts` 的 `build<Domain>DomainMethods()` 里加 `'<domain>.<method>': { input: zodSchema, handle }`;新域在 `gateway-bridge.ts` 的 `buildMethods()` 里展开。
3. **渲染层消费**:`src/v25/desktop-gateway.ts` 实现 `MusefoldGateway`(packages/platform)对应方法,经 `window.musefoldV25.invoke` 调用;features 只认 gateway 接口,不知道 IPC 存在。
4. **Web 对等**:同一 gateway 方法在 `packages/api-client` 有 HTTP 实现;两端行为必须等价(features 是同一份)。
5. **测试**:域方法表就地 `__tests__/`;跨进程行为跑 Electron E2E(`tests/v25/electron.*.spec.ts`)。

规则:数据域错误走 `BridgeError`(结构化信封),不靠异常序列化;preload 对数据域永远只做转发。窗口全屏/最大化等只读宿主信号与最小化/最大化切换/关闭等窗口生命周期动作可走独立的受控通道(查询/事件/动作,Win/Linux 自绘控件即经此接线),不进入 `musefold:invoke` 方法表,不得扩展为业务或数据通道;遗留多通道面(updater/pet)是冻结清单,不加新成员。

## SQLite 迁移流程(packages/desktop-db,Drizzle 受管)

事实源是 `packages/desktop-db`:`src/schema.ts`(Drizzle schema)+ `drizzle/`(SQL 迁移链)。

1. 改 `src/schema.ts`,跑 `pnpm --filter @musefold/desktop-db run db:generate` 生成增量 SQL。
2. 跑 `pnpm --filter @musefold/desktop-db run db:bundle` 把迁移内联进 `src/migrations.generated.ts`(打包环境无 SQL 文件可读,漏这步产物会崩)。
3. 就地迁移测试:真实旧库结构 → 迁移 → 断言新结构与数据保留。
4. 首次接管逻辑(legacy 0001–0020 链 + fakeApplyBaseline)不要动;它负责存量用户库的一次性 Drizzle 接管。
5. `packages/db` 的 PostgreSQL 迁移是完全独立的另一套(expand/contract),不要互相假设。

## 安全红线(桌面密钥与窗口基线)

- Provider API Key 与账号 bearer token 只经主进程 `safeStorage` 存取;不写 SQLite 明文、日志、导出文件、渲染层。
- 窗口基线:`contextIsolation: true, nodeIntegration: false, sandbox: true`;不放开 `webSecurity`、不加本地 HTTP 端点(automation-server 的回环端口除外,它有自己的鉴权模型)。
- 自定义协议(`app://`、`media://`、share 协议)注册集中在 `electron/main/*-protocol.ts`,privileges 清单在 `privileged-schemes.ts`。
- AI 输出的 JSON 是不可信输入:skill-runtime / design-scheme 的 AI 边界已有 zod 校验,新增 AI 编排路径必须同样过 schema。

## E2E(桌面行为验证)

Playwright 驱动真实 Electron:`tests/v25/electron.*.spec.ts`。跑法:先 `pnpm run build`,再 `pnpm exec playwright test -c tests/v25 --project electron`。视觉基线在 darwin 生成,CI 用 macOS runner 复用同一套。打包产物冒烟见 `tests/v25/package.smoke.spec.ts`。

## 冻结面与暂缓域(保持现状,不顺手改)

- **桌宠**(`src/pet` + `electron/main/pet/` + 桌宠专用 preload):冻结,不迁移不重构。
- **设计方案**:已纳入 v2.1→v2.5 迁移;复用 `electron/main/design-scheme/` 与 automation 语义,数据域经 v25 单通道桥接,专用 `.musefold.design` 导入/导出随本域迁移。
- **暂缓域**(主进程语义保留、渲染层暂缓,后续排卡):skill-runtime 对话、通用分享/导入、豆包登录管理、热更控制面。服务函数由 automation 直连,删除即破坏 Agent 对外能力。
- doubao-web/browser-service 是已知巨型文件(3000 行门禁内);`updater` 行为改动必须有对应单测(FakeUpdater 注入模式)。
