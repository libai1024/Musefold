# 08 · 安全、运维与验证

## 1. 密钥与隐私

- Electron safeStorage/keychain 保存 Provider key、AI connection key 和账号 refresh token；JWT 只保存在 account-service 内存。
- 主库只保存 `has_key`、`key_suffix`、Provider metadata；Automation/MCP/API 响应不返回 key。
- Headless 只允许 `MUSEFOLD_PROVIDER_KEY_<NORMALIZED_ID>` 环境变量注入，运行时不写回；日志对 token、凭据和完整 URL 做约束。
- 账号服务只向官方域名失败时做网络/5xx fallback IP；自定义 server URL 不自动 failover。账号 store 会把旧 fallback IP 迁移到官方域名。
- BrowserWindow 禁止 cookie 导出、非 HTTPS 导航、新窗口和权限请求；Doubao 只保留持久登录 partition，不将 session 交给 Renderer。

## 2. 本地 HTTP 安全

Automation 是本机集成面，不是公网服务：loopback bind、Bearer token、Origin 拒绝、速率限制、body/depth 限制、错误 envelope、SSE heartbeat 都由 server 层执行。Token 轮换会原子更新 discovery，旧 token 不应继续使用。

生图和本地管理是两类不同安全门：

- 生图：估算→预算覆盖或用户确认→运行→成功后实际结算；
- 本地 admin：challenge 文件证明同机同用户，MCP 永远不具备该能力。

## 3. 资产与路径安全

上传必须经过 magic header、大小限制和 staging；历史引用要回查 DB。Automation 使用 `realpath` 根目录校验，避免 symlink 或 `..` 绕过。导入/导出图片路径只接受 userData previews/pictures 根内路径。读取系统剪贴板和打开路径都是显式窄 IPC。

## 4. 数据安全运维

### 备份

`electron/system/backup.ts` 使用 SQLite `VACUUM INTO`，默认保留最新 10 份。恢复前创建 safety backup；恢复文件需在 backups 目录且通过 quick_check、版本和 prompts 表校验，完成后要求 relaunch。

### 导出/导入

导出支持 JSON/ZIP 和可选 history；Provider 只导出非秘密白名单，managed Provider 和 key 排除。导入支持 merge/replace/dry-run；Provider 导入后 `has_key=0`，需要用户在设置或 CLI 本地表单重新配置。

### 数据目录所有权

`owner.lock` 是单写者约束。启动第二个 App/serve 会拒绝或提示；桌面 takeover 仅在 discovery/lock pid 一致时结束 headless，避免误杀其他进程。

### 开发进程与正式版切换

仓库提供 `npm run dev:stop`，用于在结束本轮开发后清理当前仓库启动的进程。实现位于 `scripts/stop-dev-processes.mjs`，安全边界如下：

- 只匹配命令行中包含当前仓库绝对路径，并且属于 Electron/Vite/esbuild、`release/` 下 Musefold 测试 App、开发 CLI `serve` 或 MCP 的进程；
- 显式排除 `/Applications/Musefold.app`，不按 `Musefold`、`Electron` 或 `node` 进程名做全局结束；
- 先向匹配进程的根进程发送 `SIGTERM`，等待 1.8 秒，再只对命令行仍与原快照一致的残留 PID 发送 `SIGKILL`，降低 PID 复用和未完成清理的风险；
- `npm run dev:stop -- --dry-run` 只打印匹配结果，不发送信号；
- 当前仅支持 macOS/Linux，不删除数据库、图片、日志、构建产物或其他文件。

推荐切换流程：

```bash
npm run dev:stop -- --dry-run
npm run dev:stop
open /Applications/Musefold.app
```

2026-08-17 本机验证中，脚本清理了仓库内 Vite、esbuild 和 `release/mac-arm64/Musefold.app` 共 5 个进程；随后正式版 `/Applications/Musefold.app` 正常启动，正式版运行期间再次 dry-run 返回“没有开发进程”。

此脚本解决的是开发实例残留造成的单实例锁/端口冲突，不等于数据目录隔离。当前普通开发态仍按 `electron/main/index.ts` 使用 `Application Support/musefold`；在独立 development profile 落地前，不应把 `dev:stop` 描述成数据库、账号、Provider 密钥或登录会话隔离方案。

## 5. 更新与打包

`electron/update/updater-service.ts` 对 `electron-updater` 做状态适配：disabled/idle/checking/not-available/available/downloading/downloaded/installing/error；`autoDownload=false`、`autoInstallOnAppQuit=false`、不接受 prerelease。`electron/update/index.ts` 仅 packaged mac/win 启用，开发态、非支持平台或 `MUSEFOLD_DISABLE_AUTO_UPDATE=1` 时禁用；首次 10s 检查，之后每 6h。

`electron-builder.yml`：appId `com.musefold.app`，产品名 Musefold，更新 URL 为 `https://zhaozhaoyue.top/Musefold/updates/stable/`；mac 产出 dmg/zip 和 hardened runtime；Windows NSIS 默认不签名；better-sqlite3 在 asarUnpack；builtin/pet/product docs 和打包后的 CLI/MCP 作为资源。

CLI 安装遵循最小权限：macOS 首启只写 `~/.local/bin` 和当前用户 shell profile 的带边界标记 PATH 块；Windows NSIS/首启只写 `%USERPROFILE%\.musefold\bin` 与 HKCU PATH。两端都不需要管理员权限，不写 machine-wide PATH，不在 shim 中保存 token 或业务凭据。macOS 仅在 App 位于 Applications 时自动执行，避免从 DMG 挂载卷或临时目录生成失效入口。

Agent Skill 更新与 App 更新相互独立。Skill 更新默认仅检查、不自动写；用户开启自动更新后也只改当前用户的 `~/.codex/skills/musefold`、`~/.claude/skills/musefold`、`~/.cursor/skills/musefold`（Windows 对应用户目录）。远程清单只负责版本发现，实际内容固定到 Git tag 并逐文件校验 SHA-256；目录替换前保留同级时间戳备份。清单校验、下载或换入失败均不得破坏当前可用版本。

更新安装前清理临时状态，再调用 `quitAndInstall(false, true)`；没有自动重启行为的代码证据。

## 6. 日志与审计

- Core/M providers 使用注入 Logger；Electron 将关键错误写诊断日志。
- Automation 有最近 200 条内存审计、`logs/automation-audit.ndjson` 和主库 `automation_audit` spend audit。
- 审计字段包括 caller/action/prompt/params/estimated/actual/approvedVia/status/jobId；密钥和 token 不应进入审计。

## 7. 建议验证命令

`package.json` 当前脚本：

```bash
npm install
npm run dev:stop            # 结束当前仓库的开发进程，保留正式版
npm run typecheck
npm test
npm run build
npm run check                 # typecheck + test + build
npm run test:e2e
npm run package
npm run package:mac
npm run package:win
```

测试覆盖面包括 Core/DB/migrations、Provider、账号、Doubao DOM/usage、IPC、Automation security/rate-limit、headless takeover、CLI、MCP stdio 和 Renderer E2E。完整结果应以本工作树执行输出为准；本交接包不会把设计文档中的“通过”当成当前构建结果。

### 本次文档快照的实际验证结果（2026-08-16）

- `npm run typecheck`：失败。`electron/doubao-web/browser-service.ts:293` 的页面脚本模板字符串在当前工作树无法解析（TypeScript 报 `TS1005`）。
- `npm run build`：失败。同一文件同一行由 esbuild 报 `Expected ")" but found "$"`。
- `npm run typecheck:mcp`：通过。
- `npm test -- --run`：205 个测试文件中 204 个通过、1 个失败；总计 1156 个测试中 1155 个通过、1 个失败。失败为 `electron/main/pet/__tests__/state-machine.test.ts` 的“有任务在跑时不睡”，期望 `idle`、实际 `idle-look`。

上述失败属于当前工作树代码状态，不是本目录 Markdown 生成造成的；在修复前不应宣称整仓 `check` 或生产构建通过。

### Windows 局域网实机验证（192.168.0.182，2026-08-16）

测试对象不是远端旧安装目录 `C:\musefold-build`（其 `package.json` 为 `0.3.2`），而是把当前工作树打包后同步到 `C:\musefold-v050-test` 的独立副本。归档 SHA-256 为 `602fa2fbcc8f3f39612a67cf543ee44743e39ef9eec308a4c099cc2a6586bb81`，远端确认版本 `0.5.0-dev`。账号密码只用于 SSH 登录，没有写入仓库、脚本或日志。

| 检查 | 结果 | 证据/解释 |
| --- | --- | --- |
| Windows 环境 | 通过 | Windows 10 build `10.0.19045.7548`，Node `v24.12.0`，npm `11.6.2`，Git `2.52.0`。 |
| `npm ci` | 通过 | 672 个包安装完成；`electron-builder install-app-deps` 成功重建 `better-sqlite3` x64 native module。 |
| `npm run build` | 通过 | 主进程、preload、renderer 全部产物写入远端 `out/`；仅有既有动态 import/第三方 `use client` 警告。 |
| CLI 定向 Vitest | 通过 | `packages/cli` generate/cli/local-admin：3 files、25 tests passed。 |
| CLI/MCP 单文件构建 | 通过 | `node scripts\build-cli.mjs` 生成 `packages/cli/dist/musefold.mjs` 与 `packages/mcp/dist/musefold-mcp.mjs`。 |
| 全量 Vitest | 部分通过 | 清除 macOS `._*` 伴生文件后为 205 files：197 passed、1 skipped、8 failed；失败集中在 Windows POSIX 权限/路径断言、stale lock 清理、Tray 路径、Pet 定时状态和一个临时目录清理权限。 |
| headless `serve` | 部分通过 | 能启动、监听 `127.0.0.1`、写 `automation.json`，`status --json` 返回 owner=`headless-daemon`、capabilities 与数据计数。 |
| Windows CLI 进程退出 | 失败 | CLI 子进程在输出正确 `status --json` 后以 `3221226505` 退出，stderr：`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c:76`。需要单独修复 Node/UV handle 生命周期或确认 Node 24/Electron 运行时兼容矩阵。 |
| MCP stdio + 确认卡 | 阻断 | MCP 握手、`search_prompts` 和确认卡展示成功；点击 `automation-confirm-approve` 被 onboarding modal 的 `z-50` 遮罩拦截，未完成出图/审计断言。 |
| Skill Runtime | 已拆分验证 | 仓库读取、执行策略、图片上传和真实运行由 `test_18`、`test_19`、`test_20` 及 `test_27` 覆盖。 |

这组远端测试的结论是：Windows native install/build 与 CLI 纯逻辑没有发现编译级问题，但“真实 Windows 上 CLI 进程稳定退出”“MCP 生成确认闭环”“Skill 导入 UI”尚未达到通过标准。远端测试脚本 `tests/windows_cli_integration.py` 只用于只读/花费门验证，headless 设计本身不允许写 Provider key，所以不能把它当作真实 Provider 生图通过。

## 8. 故障定位顺序

1. `musefold status` 或 MCP `musefold_status` 检查 owner、端点、Core 版本和计数；
2. Settings/IPC 检查 Provider `has_key`、active provider、账号 health、pricing/quota；
3. 查 `logs`、Automation audit、history error 和对应 job event；
4. 参考图失败先检查 staging 路径、文件 magic header、历史状态；
5. “App 无法启动/库被占用”先看 owner.lock 和 `automation.json`；
6. 数据问题先备份，再运行 dry-run/export 或恢复 safety backup；不要直接删除数据库文件。

### 源码证据

- `electron/{account,system,update}`
- `packages/automation-server/src/{server,owner-lock,discovery}.ts`
- `electron-builder.yml`
- `package.json`
