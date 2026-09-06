# Musefold v2.1 到 v2.5 全功能迁移 - 验收清单

## 假设与范围对齐
- [x] 无阻塞性待确认项；豆包内部与桌宠已标记为范围外/冻结面
- [x] 范围内/范围外与实现一致，豆包入口仍可到达；完整 Design Scheme parity 与若干旧版扩展能力仍明确记录为未完成
- [x] 本轮发现的可执行问题已回写任务包并完成，未甩给用户；外部环境阻塞已保留为 blocked

## 简洁性
- [x] 没有未请求的扩展、抽象或配置化；本轮沿用现有 gateway/features/Drizzle/Query 架构
- [x] 当前实现路径保持最小可行，未打开云端 Design Scheme capability 或伪造不可用 runtime

## 变更边界
- [x] 每项已落地改动均能追溯到迁移任务或对应回归修复
- [x] 没有为本轮引入无关重构或顺手清理；桌宠冻结面和 Doubao 内部未被迁移

## 功能完整性
- [ ] MVP 功能全部实现：壳、工作台、生图、提示词、历史、设计方案、设置、账号/连接、同步和归档会话；Design Scheme Desktop Workbench run/cancel 接缝已于 2026-09-01 接通，并有真实 Electron 取消路径证据；Agent create/modify/recompile 与 GitHub Skill 来源安装确认（confirmInstall）已于 2026-09-03 经 Workbench 接通，Agent 过程进度在 Composer 展示；参考图运行已于 2026-09-03 接通（text-and-images）；Web runtime/cloud assets/package、成功出图 E2E 及若干 parity 仍未闭合
- [x] 已实现范围内的边界条件已处理：无 Provider、加载/错误/空态、取消/重试/删除、移动抽屉和主要窗口状态
- [x] 错误处理符合预期：结构化 BridgeError/API 错误、用户可重试、生成/同步状态机可收敛

## 测试与验证
- [x] 核心逻辑有就地单测、集成测试或等价 runtime 证据；未覆盖的真实 PG/Worker/跨设备能力已单独列出。Design Scheme 本轮受影响套件 8 个文件、151 个测试通过，覆盖主进程权威 text-only `prepareRun`、strict renderer 输入、四步计划、formal/fidelity/source/Provider blocker、legacy 来源归一化、完整槽位/来源/Provider 执行前复核与 prepare→run 原样往返；Desktop cancellation-wins 已进入 checkpoint `607e7b5`。2026-09-01 Desktop Workbench Composer run/cancel 接缝有 desktop-shell 17 个用例与 features 297 个测试（workbench-schemes 14、integration-store 15）证据；Electron Workbench 9/9 并以回环 Provider 覆盖真实 IPC、同一 executionId、活动 Workbench 会话、运行中轮询、停止取消、双账本 `cancelled`、输入保留和零方案资产提交。参考图运行经上传暂存 id 接通（plan builder 35、run adapter 20、domain 65 tests）；Web/cloud 与成功出图路径仍未宣称完成
- [x] Web 桌面/移动与 Electron 已验证 shell/workbench/prompts/settings/sync 关键路径；Design Scheme Web deep-link 的打开、返回、删除 query 生命周期和非法参数清理已有 22 个 Web host tests；本轮 `@musefold/features` 共 23 个文件、297 个测试通过，覆盖 Design Scheme 正式详情常驻修改入口、相册键盘与横向触控导航、History 成本展示、时间线内容尺寸变化贴底与用户离底不抢位；移动 Workbench 完成态视觉基线已刷新并连续复核通过；最近完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生全屏前的 shell focus 前置，Design Scheme Workbench 仍 9/9 通过

## 文档同步
- [x] 受影响的 v2.5 台账、UI 规范差异和证据边界已更新；未登记的历史数字未被冒充当前通过
- [x] `spec.md` / `tasks.md` / `checklist.md` 已同步当前实现、未完成项和外部阻塞

## 部署验证（如适用）
- [x] 本地源码构建与测试门禁正常；受影响的 `@musefold/features` 与 `@musefold/web-next` typecheck 通过，4 个 deep-link 变更文件 Biome 通过；生产 package-smoke、migration replay 和安全产物扫描仍由 Q03 记录为未闭合
- [x] Electron/Web 构建成功；最近 Electron project 为 33 passed、1 failed、1 skipped，原生 macOS fullscreen 用例因 runner 无法取得 shell 前台焦点而阻塞，未将失败改写为产品通过

## 跨载体一致性
- [x] 共享 contracts、platform gateway、Desktop bridge/preload/desktop gateway 的方法集合和错误边界保持一致
- [x] Web desktop/mobile 与 Electron 的 session URL、设置、工作台和同步回归路径已执行定向验证
- [x] Desktop-only window lifecycle 信号未混入业务 gateway，桌宠与 Doubao 冻结边界保持不变

## 项目结构与文档可信度
- [x] 已按第一性原理保留现有分层：features 复用产品 UI，宿主只负责路由/壳/gateway，contracts 为唯一实体源
- [x] 本轮未进行目录重排；依赖边界、源码路径、测试路径和台账引用已通过仓库检查
- [x] `.spec` 三件套、V25 migration ledger 与 evidence manifest 的未完成/blocked 语义保持一致

## 分支与多代理治理
- [x] 当前位于 `spec/2026-09-01_migrate-v21-to-v25` integration branch
- [x] 本包执行与验收均在该分支进行，已保留既有不推送 checkpoint `607e7b5`，最终收口 checkpoint 待本轮门禁复核后创建，未覆盖既有 dirty worktree
- [x] sidecar ownership、non-targets、verify 和主线程合流门禁已记录在 `spec.md` 编排策略

## 编排治理
- [x] 已启用 `build` 编排，route 与 ownership 可由 `spec.md` 复核
- [x] waiting strategy 明确主线程不因单一 sidecar 停工
- [x] verification gate 明确以主线程 `pnpm run check`、双端 E2E 和 Spec 校验为准

## 行为成效
- [x] 统一门禁结果：`pnpm run check` 通过，2026-09-06（批次 B1 收口）为 191 个测试文件、1460 个测试、35 个 Turbo task 成功（2026-09-03 为 182/1357，此前基线 1301）
- [x] 已回填关键路径验证：Web session URL、Web mobile Settings/Workbench 视觉、Electron Workbench、Electron sync 定向 E2E 通过；2026-09-01 Workbench 接缝重构后复跑 `electron.workbench.spec.ts` 9/9，新增正式纯文本方案经真实 IPC 进入回环 Provider 并由停止钮取消的双账本证据；`web.workbench.spec.ts`（web-desktop + web-mobile）17 passed/1 skipped（移动端无侧栏的既有跳过）。普通生成、运行中取消与视觉基线不回归；移动 Workbench 完成态视觉基线已刷新，时间线尺寸变化贴底回归通过；最近完整 `pnpm run test:e2e` 为 98 passed、1 failed、5 skipped，唯一失败是 macOS 原生全屏前的 shell focus 前置，不影响上述 Design Scheme/Workbench 断言
- [x] 本轮返工原因已记录：工作台会话列表竞态、孤立 draft/sync fixture、Settings 归档行视觉基线，以及 bare Escape 在串行 Radix dismiss layer 后的时序不稳定；Electron 方案 E2E 改用同语义的可见停止钮，Escape 继续由共享 Workbench 测试覆盖

## 验收证据
- 外部对标：以 task package 状态机和 `V25-MIGRATION-CARDS.md` 当前状态为真；Design Scheme、真实 PG/Worker/跨设备、完整 CI/package-smoke 仍未宣称完成
- 脚本验证：`pnpm run check` 通过；`check_spec_package.py` 已运行，当前因未完成 parity/全量证据与验收结果而不通过
- 旧新对比：已按 `docs/v2.5/V25-UI-SPEC.md` 与迁移台账反向覆盖表核对主要入口、状态和有意差异；完整 v2.1 parity 仍有明确待迁子卡
- 差异边界：桌宠不迁移；Doubao 内部不迁移但入口保留；云端 Design Scheme capability 保持关闭
- 行为成效：共享 features 已覆盖主要 Web desktop/mobile 与 Electron shell/workbench/prompts/settings/sync 路径
- 构建：`pnpm run check` 内含 Electron/Web build、typecheck、Biome、unit/integration、dependency-cruiser，全部成功
- 测试：**2026-09-06 批次 B1 收口**：`pnpm run check` 191 个测试文件/1460 个测试、features 396；Web E2E（web-desktop + web-mobile）122 passed/4 skipped；Electron project 55 passed/1 skipped（skip 为真实 key 场景），0 failed，含 onboarding 3、settings-data 6、history/prompts 新增用例与 sync 分区导航适配；视觉基线 web settings/prompts-detail/history-list 双视口与 electron prompts/history/settings 已重收并逐张目视核对。历史：`pnpm run check` 2026-09-03 为 182 个测试文件/1357 个测试（此前 1301）；Design Scheme 主进程套件为 8 个文件/151 个测试，Desktop Workbench 接缝有 desktop-shell 17 个用例、workbench-schemes 14 个、integration-store 15 个，根目录 `pnpm run typecheck` 通过；最新完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生 fullscreen 前 runner 无法让 Electron shell 获得前台焦点，skip 为真实 key 场景；`electron.workbench.spec.ts` 9/9，包含 Design Scheme run/cancel 双账本收敛；最新完整 v25 E2E 为 98 passed、1 failed、5 skipped，同一 fullscreen shell focus 前置失败；此前一次完整复跑的 99 passed、5 skipped 与 34 passed、1 skipped 没有 durable report/artifact，只能作为历史记录；Prompt Electron 套件 9 个用例及移动 Workbench 完成态视觉基线均通过；Web server 同时记录 `127.0.0.1:8787` 未启动的 proxy 连接拒绝日志，未影响通过用例
- 手工验证：已检查同步暂停/恢复、冲突动作、同账号重登和 userData secret scan；本轮未使用真实账号凭据，也未发起云端或付费生图

---

**验收结果**：部分通过，仍有任务与外部环境门禁未闭合
