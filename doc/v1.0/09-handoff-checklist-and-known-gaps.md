# 09 · 交接清单与已知缺口

## 1. 交接前必须确认

### 代码与版本

- [ ] 确认要交付的 commit，而不是当前包含 275 条工作树变更的 `v0.4-dev` 快照。
- [ ] 统一应用 `0.5.0-dev`、Core `0.1.0`、MCP `0.4.0` 三个版本显示的语义。
- [ ] 检查 `npm run check`、E2E 和目标平台打包结果，并把失败归因到代码、环境还是外部服务。
- [ ] 从开发环境切回正式版前运行 `npm run dev:stop -- --dry-run` 检查目标，再运行 `npm run dev:stop`；确认 `/Applications/Musefold.app` 不在匹配结果中。

### 账号与 Provider

- [ ] 用真实账号验证 register/login/refresh/logout、设备 token、managed image/text stack、额度同步和 logout 回退 BYOK。
- [ ] 用至少一个 OpenAI-compatible、Wukong 和 Doubao 网页账户验证模型列表、密钥无泄漏、超时、重试、额度和历史记录。
- [ ] 确认服务端 `musefold-image-pro` 价格、`quotaType=1`、group ratio 与本地 pricing cache 一致。
- [ ] 确认官方域名不可达时的 fallback IP 证书/路由可用；自定义 server 不应被错误 failover。

### 数据与升级

- [ ] 从旧主库升级到 schema 15，检查迁移备份、FTS、`managed_by`、Doubao usage scope 和自动化审计。
- [ ] 从含旧专用库的 profile 启动，确认通用 workbench/run/asset 迁入主库，旧库文件删除。
- [ ] 实测 JSON/ZIP export、merge/replace/dry-run、managed Provider/key 排除和 restore safety backup。
- [ ] 验证用户 Pictures、previews/uploads、logs 目录权限和清理策略。

### 外部集成

- [ ] 桌面 App 与 `musefold serve` 同目录互斥；确认 takeover 只处理 pid/owner 匹配的进程。
- [ ] 验证 discovery 文件权限、token 轮换、Origin 拒绝、速率限制、SSE 断线后的 client poll fallback。
- [ ] 验证 CLI 非 TTY 无 `--yes` 不发起花费请求；MCP readonly/toolsets/no-wait 形态符合集成方预期。
- [ ] 仅公开仓库 Skill 可导入；确认脚本不会执行，输入长度和文件读取限制生效。

## 2. 当前源码确认的限制

| 主题 | 当前事实 | 交接影响 |
| --- | --- | --- |
| 工作树 | 大量既有修改/未跟踪文件 | 不能从目录内容推断单一 release commit 或变更归属。 |
| Headless | `serve-runtime.ts` 注释明确只读 + 普通生图 | 设计方案/Skill 运行需要桌面宿主，不要把 headless 宣传成全功能服务器。 |
| Doubao | 网页 DOM 自动化、登录态和页面结构依赖外部站点 | 需持续维护选择器/页面变化和人工验证流程。 |
| 账号价格 | pricing/notices/quota 来自远端且有 cache | 不能硬编码产品页面价格；必须显示 health/更新时间。 |
| Provider 可靠性 | OpenAI-compatible/Wukong 由外部服务决定 | 代码只提供归一化错误、重试和熔断，无法保证服务端成功。 |
| 图片账本 | 数据库路径和文件资产分离 | 仅备份数据库不足以恢复图片；导出需包含允许的资产。 |
| 设计方案 | formal/unsupported/quality gate 有严格状态门 | Draft 或 unsupported 不能假设可运行。 |
| CLI/MCP 版本 | CLI usage 体现 v0.4 设计；MCP info 固定 0.4.0 | 需在发布时确认协议兼容，不以应用包版本替代。 |
| 开发/正式环境 | `dev:stop` 只隔离运行进程，普通开发态数据目录仍可能使用 `musefold` | 不得把进程清理脚本当作数据、密钥或登录会话隔离；独立 development profile 仍需后续实现。 |

## 3. 已发现的历史文档偏差

1. 早期 Doubao “两轨 onboarding”说明落后于当前 `OnboardingTrack` 三轨 union，相关旧文档已从工作树清理。
2. 该文档把 Doubao 10 次写成全局共享；`usage-limit.ts` 当前按规范化账号名 scope 计数，并迁移旧 global 行。
3. `docs/v0.4` 的大量内容是架构/设计规格；当前实现已落地部分，但文档中的目标能力不能替代运行时证据。
4. `docs/v0.5/V05-UPDATER.md` 记录 updater 方案；实际行为应以 `electron/update/*` 和打包配置为准。

## 4. 风险与监控建议

- 监控 Provider 失败率、429/NO_BALANCE、模型不存在和 Wukong 轮询超时；三次失败 breaker 只在进程内生效。
- 监控账号 refresh/token-invalid、fallback IP 使用率、pricing sync 失败和 quota stale 时间。
- 监控 Doubao 选择器失败、verification 出现、partial stability 超时、图片签名拒绝和每日额度耗尽。
- 监控 owner.lock 残留、automation discovery 与进程不匹配、SSE 连接数和 token rotation。
- 备份完成和 restore 演练应有可审计记录；应用升级前保留数据库和图片目录的恢复点。

## 4.1 Windows 实机遗留项

1. **先修 CLI 进程退出崩溃**：Windows Node 24 上 `status --json` 已写出正确结果，但进程退出触发 `src\win\async.c:76` 的 UV assertion（exit code `3221226505`）。应在 Node 20 LTS、Node 22 LTS、Node 24 以及 packaged CLI/MCP 资源中分别复现，确认是 `process.exit()`、HTTP keep-alive、AbortSignal 还是 Node 版本组合导致。
2. **处理首启引导与自动化/Skill 测试的互斥**：真实空 profile 会显示全屏 onboarding；当前 MCP 确认卡和 Skill 导入按钮都被遮罩拦截。测试专用绕过必须在启动前、明确且只在 `MUSEFOLD_E2E=1` 生效，不能在生产构建中无条件调用 `skip()`。
3. **修正跨平台断言**：`discoveryFileMode` 的 POSIX `0600`、`path.join` 的 `/` 和 `\`、Tray icon 路径、stale lock 语义在 Windows 不能直接复用 Unix 断言；应使用 `path.normalize`/`pathToFileURL` 或按平台断言，而不是修改运行时安全目标。
4. **重跑真实 Skill 与 MCP 出图**：前置关闭/跳过 onboarding 后，执行 Skill Runtime 的 `test_18`、`test_19`、`test_20`、`test_27` 和 `test_31_mcp_scenario_a.py` 的确认/拒绝、ResourceLink 及审计闭环。
5. **补装包级 Windows runtime smoke**：当前远端目录只验证了源码副本；没有在这台机器运行 `npm run package:win` 生成的 NSIS 安装包，也没有执行 `tests/package/windows_runtime_smoke.py` 的 fake Provider、media protocol、history、export/import、deeplink 全流程。

## 5. 代码变更回归矩阵

| 改动区域 | 必须回归 |
| --- | --- |
| `shared/types/ipc.ts` / preload | IPC 类型、Main handler、Renderer smoke/E2E |
| Core generation/provider | provider tests、history/ledger、Automation/CLI/MCP generate |
| 账号/managed provisioner | keychain、logout cleanup、quota/pricing、onboarding |
| DB migration/schema | fresh DB、upgrade DB、backup/restore、FTS |
| Doubao bridge | DOM fixture、usage scope、ref upload、image data/signature |
| Automation server | auth/Origin/rate/depth/upload/SSE/local proof |
| Skill/design scheme | source snapshot、scripts never execute、formal gate、quality evaluation |
| updater/builder | dev disabled、packaged mac/win、download/install states |

### 证据文件

- `docs/README.md`
- `docs/v0.4/*`
- `docs/v0.5/*`
- Git 历史中的早期 Doubao 两轨说明
- 本目录 [01](./01-product-and-capability-map.md)、[04](./04-generation-and-provider.md)、[08](./08-security-operations-testing.md)
