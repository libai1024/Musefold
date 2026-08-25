# apps/desktop — 桌面端开发约束

Electron 应用。三段式结构,渲染层规范以 `docs/frontend/DEVELOPMENT-GUIDE.md` 为准,本文件只管主进程侧与桌面特有流程。

## 目录职责

```text
electron/main/       应用编排、IPC handlers(ipc/ 按域分文件,经 index.ts 的 registerAllHandlers 集中注册)、design-scheme、skill-import
electron/preload/    contextBridge 桥(api/ 按域转发,无业务逻辑),sandbox 强制 CJS
electron/update/     electron-updater 封装 + 内容热更(Ed25519,基于 packages/update-protocol)
electron/{account,ai,cloud-sync,security,settings,system,doubao-web}/  按域的主进程模块
src/                 渲染层(features/ + runtime/ + stores/,见 DEVELOPMENT-GUIDE)
src/pet/ src/preview/  桌宠与一次性导出页,是独立的 renderer 入口,不与主入口互相 import
```

主进程与渲染层代码禁止互相泄漏:渲染层禁 import `electron` 与裸 `window.api`(depcruise `renderer-no-electron` / `renderer-no-direct-ipc`,允许名单见 DEVELOPMENT-GUIDE §9);`packages/core` 禁 import electron。

## 新增 / 修改 IPC 的标准流程

一次 IPC 能力贯穿六处,缺一处就是断链。以「给 prompts 域加一个方法」为例:

1. **契约**:在 `packages/desktop-contracts/src/ipc/<domain>.ts` 定义请求/响应类型;通道名加进 `src/ipc/channels.ts` 的 `IPC` 常量对象。
2. **Handler**:在 `electron/main/ipc/<domain>.ts` 实现,经 `ipcMain.handle(IPC.X, …)`;新文件要在 `electron/main/ipc/index.ts` 的 `registerAllHandlers()` 里挂上。
3. **Preload**:在 `electron/preload/api/<domain>.ts` 加转发函数;若是新域,在 `preload/index.ts` 的 `api` 对象里组装(单次 `contextBridge.exposeInMainWorld("api", api)`,不做第二次暴露)。
4. **渲染层消费**:类型来自 `desktop-contracts/ipc` 的全局 `Window.api` 声明;业务代码经 `src/lib/ipc` 或 runtime 桥调用,不直接碰 `ipcRenderer`。
5. **行模型转换**:涉及 SQLite 行 ↔ contracts 文档的映射,只准写在 `src/runtime/mappers/`(depcruise `desktop-runtime-contracts-only-in-mappers`)。枚举映射用 `as const satisfies Record<行枚举, 文档枚举>` 保证穷举,新增枚举值而漏映射会编译失败。
6. **云同步**:该写操作需要同步到云端时,在同一 handler 内调 `scheduleCloudSync()`(现状是手动散点,漏了不会报错——自查清单里过一遍)。
7. **测试**:handler 注册逻辑 + mapper 逐字段断言,就地 `__tests__/`;行为变化跑 `pytest tests/e2e/` 对应用例。

规则:preload 永远只做转发;preload 抛异常会让整个 App 不可用,组装处必须容错(见 `preload/index.ts` 现有写法);不要在 `channels.ts` 之外发明通道字符串。

## SQLite 迁移流程(packages/core/src/db/)

调度器在 `packages/core/src/db/run-migrations.ts`(注意:该文件头部注释的旧路径 `electron/system/migrations.ts` 是历史遗留,以实际路径为准):

1. 新建 `migrations/00NN_描述.ts`,导出 `up(db)`,只写 schema 变更,不塞业务数据修复。
2. 在 `run-migrations.ts` 顶部 import 并加入 `migrations` 数组(手工清单,两处都要改,漏了迁移不会执行)。
3. 迁移必须是幂等安全、事务包裹的;调度器升级前会 `VACUUM INTO` 自动备份,不要在迁移里自己删备份。
4. 就地写迁移测试(`migrations/__tests__/` 体例:内存库手搭旧表结构 → `up(db)` → 断言新结构与数据保留)。带数据变换的迁移,测试必须覆盖旧数据行。
5. web-api 的 PostgreSQL 迁移是完全独立的另一套(见 `apps/web-api/AGENTS.md`),不要在桌面迁移里做任何云侧假设。

## 安全红线(桌面密钥与窗口基线)

- Provider API Key 只经主进程 `safeStorage` 存取;不写 SQLite、日志、导出文件、渲染层。
- 窗口基线:`contextIsolation: true, nodeIntegration: false, sandbox: true`;不放开 `webSecurity`、不加本地 HTTP 端点。
- 自定义协议(`app://`、`media://`、share 协议)注册集中在 `electron/main/*-protocol.ts`,新增协议走同一模式,privileges 清单在 `privileged-schemes.ts`。
- AI 输出的 JSON 是不可信输入:skill-runtime / design-scheme 的 AI 边界已有 zod 校验,新增 AI 编排路径必须同样过 schema。

## E2E(桌面行为验证)

Python + Playwright 驱动真实 Electron(CDP),`tests/e2e/`。跑法:先 `npm run build`,再 `pytest tests/e2e/<file> -k <name>`;交互用例带 `gui` marker(Windows CI 跑 `-m "not gui"`)。夹具用 SQL 直写数据库(`test_00_harness` 模式),不在 E2E 里重复单测逻辑。

## 桌面侧欠账(保持现状,不顺手改)

主进程重任务未拆 utilityProcess;doubao-web/browser-service 是已知巨型文件(在 file-size baseline 内);`updater` 相关行为改动必须有对应单测(FakeUpdater 注入模式,见 `electron/update/` 现有测试)。改这些区域前先确认不与 v1.4 REL 卡冲突。
