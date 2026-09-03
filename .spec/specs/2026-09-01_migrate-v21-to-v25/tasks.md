# Musefold v2.1 到 v2.5 全功能迁移 - 任务拆解

## 使用规则
- 每个任务都要写清楚 `boundary` 和 `verify`
- 如果一个任务没有验证方式，就不能开始
- 发现的可执行问题必须回写本包，并在本轮做完
- 新任务包使用 `YYYY-MM-DD_<verb>-<object>`，详见 `references/naming-and-commits.md`

## 阶段一：基线与任务包
- [x] 固化迁移目标、关键假设、非目标和 integration branch
  - boundary: 只更新本包 `spec.md`
  - verify: `spec.md` 写明 v2.1 parity、四端范围、豆包入口、桌宠冻结面和 branch
- [x] 创建独立 integration branch 并保存上一轮未提交成果
  - boundary: 只执行 Spec 初始化与 Git 保存/切换，不改业务逻辑
  - verify: 当前分支为 `spec/2026-09-01_migrate-v21-to-v25`，上一轮改动可由 `stash@{0}` 恢复
- [x] 恢复并盘点上一轮迁移成果
  - boundary: 只恢复 `stash@{0}`，按 `git diff --stat`、迁移卡和测试目录建立本包基线，不删除已有改动
  - verify: 工作树包含上一轮迁移改动；盘点结果记录在本包或 `docs/v2.5/V25-MIGRATION-CARDS.md`，无无主文件

## 阶段二：契约、数据与服务主链路
- [x] 收口 v2.5 contracts、platform gateway 和 API client 的实体/方法契约
  - boundary: `packages/contracts`、`packages/platform`、`packages/api-client` 及其就地测试；不改宿主 UI
  - verify: contracts/platform/gateway tests 通过，所有 gateway 方法由 zod schema 推导且 Web 调用出入参一致；`pnpm run check` 已通过
- [x] 完成 PostgreSQL、SQLite 和 core 本地数据迁移与兼容性校验
  - boundary: `packages/db`、`packages/desktop-db`、`packages/core`、相关 migrations/tests；不改云端路由或 UI
  - verify: schema tests、desktop takeover/migration tests、repository lifecycle tests 通过，旧数据保留且生成账本唯一；`pnpm run check` 已通过。真实 PG replay、匿名 v2.1 语料和备份恢复仍由后续门禁单独判定
- [x] 收口 API、Worker、生图状态机、同步和 workbench 服务
  - boundary: `apps/api`、`apps/worker` 及其 integration/unit tests；不改桌面 IPC 或 features
  - verify: API integration、generation/worker、sync/workbench tests 通过；取消、重试、幂等和 reconcile 不会卡死；`pnpm run check` 已通过。真实 Graphile Worker/PG runtime 仍未形成独立证据

## 阶段三：桌面与共享产品 UI
- [x] 收口桌面 v25 IPC、preload、window lifecycle 和 desktop gateway
  - boundary: `apps/desktop/electron/main/ipc-v25`、`preload/v25.ts`、`main/application.ts`、`main/window.ts`、`apps/desktop/src/v25/desktop-gateway.ts`
  - verify: 各域 IPC 单测、preload/window/gateway tests 通过；数据域保持 `musefold:invoke`，窗口信号不混入业务 gateway；`pnpm run check` 已通过。最近 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生全屏前 runner 无法让 shell BrowserWindow 获得前台焦点；Workbench 与 Design Scheme 业务用例通过
- [ ] 完成设计方案全链路迁移与 v2.1 功能 parity
  - boundary: `packages/contracts`、`packages/platform`、`packages/features/src/design-schemes`、`packages/core/src/db/design-scheme`、`packages/db`、`packages/desktop-db`、`apps/api`、`packages/api-client`、桌面 `ipc-v25/design-scheme-domain.ts`/gateway、双端路由与就地/E2E 测试；不触碰豆包内部或桌宠
  - verify: v2.1 设计方案导航、列表/详情、创建/编辑/复制/删除、AI 生成/运行、版本与工作台联动按历史实现逐项验证；Web 与 Electron E2E、contracts/repository/API/IPC/features tests 通过。当前本地历史来源 owner-safe 链路、确定性 adapter、固定计划校验、取消和 `.musefold.design` 安全 staging/archive 已接线；Desktop cancellation-wins 已进入 checkpoint `607e7b5`：部分成功加后续取消时 canonical result、Design Scheme run ledger、terminal event 与 execution registry tombstone 统一为 `cancelled`，所有 active generation job IDs 均 fan-out cancel，并在评估/terminal outward event 前重检重入取消。主进程权威、text-only `prepareRun` 已接线：renderer 只提交选择、文本值与执行设置，主进程从 exact revision/source binding/Provider 事实生成并校验 `desktop-fixed-v1` 四步计划；reference assets、图片槽位、缺失/多余输入、revision/scheme mismatch 和未知 Provider 均 fail-closed。2026-09-01 Desktop Workbench run/cancel 接缝已接通：`WorkbenchScreen.designSchemes` 的宿主提交处理拆为 `onRun/onCancelRun/onCreate/onModify` + `runInputSupport`，桌面 `useDesignSchemeComposerHandlers()` 注入 `onRun`（prepareRun → run，await 终态）与 `onCancelRun`（按同一 executionId，含取消先于登记仲裁）；Composer 运行中转停止钮、成功复位保留附件、blocked/failed 就地错误行并保留输入、text-only 下图片输入禁用并解释、运行落活动会话并短轮询时间线。desktop-shell 17 tests、features 297 tests 通过；Electron Workbench 9/9，新增回环 Provider 下真实 IPC 运行后停止取消的双账本证据，Composer 输入保留且无方案资产提交。主进程 Agent create/modify adapter 已实现并有定向测试，但 Workbench `onCreate/onModify`、GitHub confirmation/install、renderer recompile/event、图片 prepare、Web runtime/cloud assets/package 和成功出图 E2E 尚未闭合
- [ ] 完成共享 AppShell、工作台、提示词库、历史、设置、账号/连接和归档会话 parity
  - boundary: `packages/features`、必要的 `packages/ui`；共享组件不得 import electron/next，桌宠代码不触碰
  - verify: features unit tests、`V25-UI-SPEC.md` 状态矩阵和 testid 对照通过；主要 v2.1 动作均有可发现入口。当前主路径和定向 Web/Electron E2E 已通过，History 列表行已补已知 `costPoints` 展示且未知成本保持隐藏，Workbench 时间线已恢复内容尺寸变化后的贴底跟随且用户离底不抢位，Design Scheme 正式详情修改入口和相册键盘/横向触控导航已有共享 features 回归；但首次启动引导、部分历史/生成 parity、费用审批、移动键盘和若干详情/批量动作仍缺
- [ ] 保留豆包入口并验证冻结边界
  - boundary: 只改共享壳/账号连接入口和对应测试；不迁移豆包网页 renderer、登录内部或桌宠
  - verify: Web/桌面均能从账号/连接入口到达豆包通道或配置路径；冻结面文件无业务改动。入口与冻结实现已保留，独立 fresh evidence 尚未完成登记

## 阶段四：双宿主集成与回归
- [x] 打通 Web 桌面/移动宿主路由、gateway 注入和响应式交互
  - boundary: `apps/web-next/src/app`、`components/app-shell.tsx`、宿主适配及 Web E2E；业务 UI 继续留在 features
  - verify: Web desktop/mobile E2E 覆盖导航、工作台、提示词、设置、账号和同步；移动抽屉/底栏焦点和 deep-link 可用；session URL、设置和成图视觉用例已在定向重跑中通过
- [ ] 打通 Electron 宿主关键用户路径和窗口行为
  - boundary: `tests/v25/electron.*.spec.ts`、electron helpers 和必要宿主修复；不改 pet E2E 语义
  - verify: `pnpm run build` 后 Electron v25 E2E 覆盖 shell/workbench/prompts/settings/sync。最新完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是原生 macOS fullscreen 前 runner 无法让 Electron shell 获得前台焦点；skip 为需真实 key 的付费场景。Workbench 文件 9/9 通过，并新增 Design Scheme text-only run/cancel 双账本收敛证据
- [ ] 运行统一门禁并修复本包发现的可执行问题
  - boundary: 只修复本包任务覆盖的真实失败，必要时同步 v2.5 evidence/docs；不删测试、不引入未请求抽象
  - verify: `pnpm run check`、`pnpm run test:e2e`、桌面 Electron E2E 和 `check_spec_package.py` 结果真实记录。2026-09-01 `pnpm run check` 为 181 个测试文件、1332 个测试、35 个 Turbo task 全绿（features 23 文件/297 测试；此前基线 1301）；本轮受影响 Design Scheme 套件 8 个文件、151 个测试通过，根目录 `pnpm run typecheck` 通过；最新完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生 fullscreen 前 runner 无法让 Electron shell 获得前台焦点，跳过项为真实 key 场景；Workbench Electron 9/9 通过并覆盖 Design Scheme 取消路径。最新完整 v25 E2E 为 98 passed、1 failed、5 skipped，同一 fullscreen shell focus 前置失败；此前一次完整复跑的 99 passed、5 skipped 与 34 passed、1 skipped 没有 durable report/artifact，只能作为历史记录；Spec 校验仍应因未完成 parity/证据门禁失败
- [ ] 完成 parity 复核、验收清单和迁移知识沉淀
  - boundary: 只更新本包 `checklist.md`、相关 v2.5 证据文档和 `.spec/docs`，不改业务逻辑
  - verify: checklist 全部勾选且 `**验收结果**：通过`，每个任务有 boundary/verify 证据，变更边界和非目标可追溯。当前已回写实际验证与阻塞，但不能在 Design Scheme/全量 parity 未闭合前标记通过

---

**当前进度**：由脚本计算，无需手动维护
