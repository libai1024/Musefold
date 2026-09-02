# Musefold v2.1 到 v2.5 全功能迁移 - 项目范围

## 1. 问题定义
- **项目目标**：把 v2.1 的可用产品能力迁入 v2.5 的四端复用架构，并完成可验收的行为与视觉对齐。
- **目标用户**：使用 Musefold 进行 AI 生图、提示词管理、历史管理、账号/连接管理和云同步的个人创作者。
- **核心价值**：用户在 Windows/macOS 桌面、PC Web 和移动 Web 上获得同一套主要工作流，迁移后既保留 v2.1 的功能语义，也获得 v2.5 的共享 features、契约和数据可靠性。

## 2. 假设与待确认

### 2.1 已确认事实
- 当前分支已有连续的 v2.5 迁移提交，以及一批未提交的 API、Worker、SQLite、IPC、共享 features、双端宿主、文档和 E2E 改动；这些改动由前一轮代理完成，必须纳入本包审计，不得覆盖。
- v2.5 的源码、自动化测试和 `docs/v2.5/V25-UI-SPEC.md` 是当前权威；v2.1 文档只用于识别旧版行为。
- 主要迁移面包括应用壳、工作台/生图、提示词库、生成历史、设计方案、设置、账号/AI 连接、云同步、桌面本地数据库和 Web/桌面双宿主。
- 桌宠是冻结面；豆包网页模式的主进程语义保留、渲染层不迁移，但产品界面必须保留豆包入口。
- 设计方案是 v2.1 用户功能，必须完成共享 UI、桌面和 Web 数据链路迁移；v2.5 文档中的“暂缓”记录由本包更新。

### 2.2 关键假设
- v2.1 的核心用户行为由当前仓库历史代码、`v2.5-baseline` 和现有测试足以判定；无法从历史实现证明的细节以当前 v2.5 契约和 UI 规范为准。
- 现有未提交改动属于同一迁移目标；恢复后如发现明显无关主题，按独立边界分流，不混入本包提交。
- 四端共享 `packages/features`，宿主只负责路由、壳和 gateway 注入；不为单端复制产品 UI。
- “基本保持一致”优先保持信息架构、文案、动作和状态，允许只改善可访问性、响应式布局和交互可发现性，并将有意差异记录在 v2.5 UI 规范。

### 2.3 待确认问题
- 无（已确认；本轮无阻塞性待确认问题）。桌宠和豆包内部渲染是明确非目标；设计方案是否必须迁移已由用户确认。

### 2.4 可选解释与取舍
- 当前选择：采用一个整包承接当前连续迁移改动，而不是拆成多个历史补录包 -> 所有改动围绕 v2.1 到 v2.5 的同一交付目标，拆分会割裂契约、宿主和 E2E 的联合验收。
- 当前选择：先恢复上一轮代理成果再做增量修复 -> 保留已有实现和测试证据，避免重复开发或误删用户工作。

## 3. 功能范围

### 3.1 核心功能（MVP）
- [ ] 四端应用壳与导航：桌面常驻侧栏、Web 桌面/移动响应式壳、会话列表、账号 footer、设置入口和豆包入口。
- [ ] 工作台与生图：会话创建/切换/重命名/置顶/归档/删除、提示词 Composer、比例/质量/负面词/Provider、参考素材、生成状态时间线、重试/取消/删除。
- [ ] 提示词库与历史：列表、搜索/标签/收藏/评分/编辑/复制/回收站，以及生成历史筛选、详情、删除和状态展示。
- [ ] 账号与连接：登录/登出、账号额度、AI 连接列表/切换/配置入口、云同步状态和归档会话恢复闭环。
- [ ] 数据与服务链路：contracts 单一事实源、PostgreSQL/SQLite 增量迁移、API/Worker 生图状态机、桌面 v25 单通道 IPC、Web API gateway。
- [ ] 迁移验收：关键单测、集成测试、Web/Electron E2E、移动/桌面视觉基线和仓库门禁全部达到可判定状态。

### 3.2 扩展功能
- 允许在不改变功能语义的前提下改善响应式布局、键盘可访问性、错误/加载态和动作可发现性，并同步记录有意差异。

### 3.3 不在范围内
- 桌宠 renderer、桌宠主进程域和专用 preload 的迁移、重构或视觉改造。
- 豆包网页模式内部渲染、登录管理重构和专属限制提示迁移；只保留现有主进程能力和 v2.5 界面入口。
- Skill runtime 对话、GitHub Skill 导入、通用分享/导入、命令面板完整实现、微调链和热更新控制面；Design Schemes 专属 `.musefold.design` import/export 明确属于本轮范围。
- 不为单端复制 `packages/features`，不做与迁移无关的目录重排、依赖升级或产品新功能。

## 4. 最小实现路径
- 恢复前一轮代理改动，在同一 integration branch 上以源码、测试和 v2.5 文档进行差距审计。
- 先修 contracts/schema/gateway 和服务端主链路，再修桌面 IPC 与共享 features，最后验证 Web/Electron 宿主和 E2E。
- 让已有测试成为每个 ownership 的完成证据；只补缺失测试或修复真实失败，不以删测试换取通过。
- 暂不引入新的状态管理、跨端抽象、服务端接口版本或配置化框架；沿用现有 TanStack Query、MusefoldGateway、zod、Drizzle 和 v25 单通道桥。
- 不迁移冻结/暂缓域的渲染实现，避免把一次版本迁移扩展成产品重做。

## 5. 技术决策
- 技术栈：沿用 Next.js 16、Electron 43、Hono、PostgreSQL/Drizzle、SQLite/Drizzle、TanStack Query、zod、Playwright 和 Vitest。
- 本轮允许改动：当前迁移涉及的 contracts、platform、db/desktop-db/core、api/worker、desktop v25 IPC/preload/host、web-next、features/ui、相关测试与 v2.5 证据文档。
- 本轮不应触碰：`apps/desktop/src/pet`、桌宠主进程域、桌宠 preload，以及与本包无关的旧版本冻结代码。
- Git integration branch：`spec/2026-09-01_migrate-v21-to-v25`，从 `main` 创建；上一轮工作已先保存到 `stash@{0}`，恢复后作为本包输入。

### 5.4 编排策略
- route: `build`
- immediate blocker: 恢复上一轮改动后确认真实失败，避免基于干净基线重复开发。
- ownership: 主线程负责恢复、合流、任务包、公共入口、最终修复与验收；sidecar 按契约数据、服务端、桌面桥、共享 UI、Web/E2E 和质量门禁提供实现或 findings。
- waiting strategy: 主线程先执行基线验证和独立修复，不因单个审计 sidecar 尚未返回而停工。
- verification gate: worker 局部通过不等于验收；统一以主线程的 `pnpm run check`、双端 E2E 和 Spec 校验为准。

## 6. 成功标准与验证方式
- v2.1 核心用户路径在 v2.5 双宿主可用 -> verify: 共享 features 单测、Web/Electron E2E 覆盖壳、工作台、提示词库、历史、设置、账号/连接和同步路径。
- 四端使用同一页面模块且 gateway 行为等价 -> verify: dependency boundary、contracts/api-client/IPC/platform 测试和 Web/桌面对应场景通过。
- 数据迁移不丢失且生图账本状态可收敛 -> verify: desktop-db/db migration tests、API/Worker/core sync/generation tests 和集成测试通过。
- UI 与 v2.1 基本一致且明确排除桌宠/豆包内部 -> verify: `V25-UI-SPEC.md` 对照、视觉快照、冻结面检查和豆包入口 E2E 证据。
- 仓库达到可交付状态 -> verify: `pnpm run check`、`pnpm run test:e2e` 及桌面 Electron E2E（按环境可用性记录真实结果）。

### 6.1 行为成效指标
- 仓库统一门禁在当前工作树可复现通过 -> verify: `pnpm run check` 退出码为 0，并报告 179 个测试文件、1282 个测试和 35 个 Turbo task 成功
- Web 桌面/移动与 Electron 关键迁移路径可复现通过 -> verify: session URL、设置视觉基线、成图视觉基线、Electron Workbench 和 Electron sync 定向 E2E 均通过；完整 v25 E2E 为 97 passed、1 failed、5 skipped，唯一失败是 macOS fullscreen 环境阻塞
- 本轮本地同步路径不泄漏密钥或凭据 -> verify: `tests/v25/electron.sync.spec.ts` 通过并完成 disposable userData secret scan；Design Scheme canonical event/result 保持 path-free、credential-free

## 7. 风险与约束
- 风险点：现有改动规模大且未提交 -> 缓解措施：已用 stash 保存并在本包分支恢复，按 ownership 审计，提交只纳入本包边界。
- 风险点：旧版行为与新规范可能冲突 -> 缓解措施：源码/测试优先，规范差异写入 UI 规范，不凭视觉猜测改行为。
- 风险点：真实 PostgreSQL、Electron 或外部认证环境不可用 -> 缓解措施：先运行可离线的单测/构建，再记录具体外部阻塞；不把预检结果写成已发布。
