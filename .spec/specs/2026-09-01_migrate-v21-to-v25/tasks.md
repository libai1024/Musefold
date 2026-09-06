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
  - verify: v2.1 设计方案导航、列表/详情、创建/编辑/复制/删除、AI 生成/运行、版本与工作台联动按历史实现逐项验证；Web 与 Electron E2E、contracts/repository/API/IPC/features tests 通过。当前本地历史来源 owner-safe 链路、确定性 adapter、固定计划校验、取消和 `.musefold.design` 安全 staging/archive 已接线；Desktop cancellation-wins 已进入 checkpoint `607e7b5`：部分成功加后续取消时 canonical result、Design Scheme run ledger、terminal event 与 execution registry tombstone 统一为 `cancelled`，所有 active generation job IDs 均 fan-out cancel，并在评估/terminal outward event 前重检重入取消。主进程权威、text-only `prepareRun` 已接线：renderer 只提交选择、文本值与执行设置，主进程从 exact revision/source binding/Provider 事实生成并校验 `desktop-fixed-v1` 四步计划；reference assets、图片槽位、缺失/多余输入、revision/scheme mismatch 和未知 Provider 均 fail-closed。2026-09-01 Desktop Workbench run/cancel 接缝已接通：`WorkbenchScreen.designSchemes` 的宿主提交处理拆为 `onRun/onCancelRun/onCreate/onModify` + `runInputSupport`，桌面 `useDesignSchemeComposerHandlers()` 注入 `onRun`（prepareRun → run，await 终态）与 `onCancelRun`（按同一 executionId，含取消先于登记仲裁）；Composer 运行中转停止钮、成功复位保留附件、blocked/failed 就地错误行并保留输入、text-only 下图片输入禁用并解释、运行落活动会话并短轮询时间线。desktop-shell 17 tests、features 297 tests 通过；Electron Workbench 9/9，新增回环 Provider 下真实 IPC 运行后停止取消的双账本证据，Composer 输入保留且无方案资产提交。2026-09-03 Desktop Workbench `onCreate/onModify` 已接到主进程 Agent adapter（brief / 历史来源 runId/assetId 身份 → Compiler 落草稿；exact revision + 指令 → Reviser 产出待验证草稿），`checkUpdate` 以同一 Agent 文本连接做上游重编译；Agent 文本连接沿用 v2.1 `AiConnectionStore`（可在「设置 → Agent 连接」配置（2026-09-03 补齐 `AgentConnectionsPanel`）），无连接时结构化 `DESIGN_SCHEME_AGENT_AI_UNAVAILABLE`；同时修复 v2.1 历史来源 `history:<id>` 伪 URI 导致方案详情映射失败的 parity 缺陷。desktop-shell 22、domain 61、agent-adapter 4 tests 通过。GitHub Skill 来源已于 2026-09-03 闭环：`confirmInstall` 进部署方法表（18 项），renderer 从 brief 提取仓库地址，主进程解析后经 confirmation-required → 共享 `SourceInstallConfirmDialog` → confirmInstall 决定继续或整体取消（域 64、desktop-shell 25、features 305 tests）；Agent 创建/修改过程以一行进度展示在 Composer 上方；参考图运行已接通（Composer 上传暂存 id → prepareRun 按声明顺序分配图片槽位 → run 解析为受管本地图；桌面 text-and-images；plan builder 35、run adapter 20、domain 65、desktop-shell 26 tests）；Web runtime/cloud assets/package 和成功出图 E2E 尚未闭合
- [x] 重构设置界面为「分区注册表 + 分组导航」并写入设置项开发规范
  - boundary: `packages/features/src/settings`(SettingsScreen、sections 注册表、nav store、AppearanceCard 拆分)、就地测试、`tests/v25/{web,electron}.settings.spec.ts` 与设置视觉基线、`docs/v2.5/V25-UI-SPEC.md` §6 与 `docs/v2.5/V25-FEATURE-DEV-GUIDE.md` 新增「新增设置项」走线;不改 account/connections 各面板内部,不改契约与宿主
  - verify: 已交付(2026-09-03)。桌面 md+ 左分组导航(220px,搜索)+ 右分区面板,移动一级列表 → 二级面板(返回行);分区按 capability 门注册(Web 只有外观/账号),深链意图落分区并点亮、兜底账号,分区记忆跨屏保持、不可用时兜底首个分区,搜索按标题/描述/关键词过滤;面板只渲染当前分区,md+ 面板头让位卡片自述(消除标题重复);既有 testid 全部保留。features settings 25 tests(含注册表可用性/意图/搜索),Electron 设置 E2E 10/10、Web 桌面+移动 16/16,设置视觉基线三形态重收并人工核对(发现并登记:设置页留白多,2% 像素容差可吞掉整页布局变化,重收基线必须人工看图);根 `pnpm run check` 182 文件/1357 tests 全绿。UI-SPEC §6 改写为已交付形态+§6.4 新增设置项规范,DEV-GUIDE 新增 §8-C 走线
- [x] 打通官方账号登录闭环(xiaomiao 测试账号)
  - boundary: 账号登录链路涉及的 `apps/api` 账号模块、`apps/desktop/electron/main/ipc-v25/account-domain.ts`、`packages/api-client`、`packages/features/src/account`,以及本地起服务所需的 `infra`/环境配置;不改 New API 网关本体
  - verify: 已验证(2026-09-03,零代码改动——链路本身是通的,缺的是运行环境与正确的网关地址)。账号事实源为自托管 New API 网关 `https://zhaozhaoyue.top`(v1.1 生产主机;`docs/11-ai-tvt-wiki-api.md` 的 ai.tvt.wiki 是 Sub2API 生图中转,无账号接口,不可作 `NEW_API_BASE_URL`)。本地链路:OrbStack 起 `infra/v2.5` 的 postgres(55433)+minio → `pnpm run db:migrate` → `apps/api` dev(`NEW_API_BASE_URL=https://zhaozhaoyue.top` 等 env)→ HTTP 实测 `sign-in/new-api` 200 返回 token、`/api/v1/account/status` 返回 username=xiaomiao/quota=97,544,980/canGenerate=true → 真实 Electron 壳(`MUSEFOLD_API_URL=http://127.0.0.1:8787`)一次性 Playwright 驱动:设置→账号分区→表单登录→`account-signed-in` 显示 xiaomiao/1950.9 积分→登出确认→回未登录且 `v25-account-session.json` 已删除(脚本跑完即删,凭据不落仓库)。途中修复本地库 JWKS 密钥错配(换 BETTER_AUTH_SECRET 后清 jwks/session/user 表)。**阻塞登记**:生产 `https://api.musefold.app` TLS 不可达(未部署/被阻),云端部署属人工发布门禁(Q03);Web 宿主同链路经 dev proxy 指向同一本地 API,未单独驱动 UI
- [ ] 完成共享 AppShell、工作台、提示词库、历史、设置、账号/连接和归档会话 parity
  - boundary: `packages/features`、必要的 `packages/ui`；共享组件不得 import electron/next，桌宠代码不触碰
  - verify: features unit tests、`V25-UI-SPEC.md` 状态矩阵和 testid 对照通过；主要 v2.1 动作均有可发现入口。当前主路径和定向 Web/Electron E2E 已通过，History 列表行已补已知 `costPoints` 展示且未知成本保持隐藏，Workbench 时间线已恢复内容尺寸变化后的贴底跟随且用户离底不抢位，Design Scheme 正式详情修改入口和相册键盘/横向触控导航已有共享 features 回归；2026-09-03 设置「连接」区补齐 Agent 文本连接卡（`AgentConnectionsPanel`，与生图连接卡共用泛化 `ConnectionsPanel`，`hasAgentConnections` 开关；数据面 `agentConnections.*` 6 方法 → 主进程 AiConnectionStore，domain 8、bridge/gateway 方法表、features account/settings 60 tests，Electron settings E2E 10/10 含真实 IPC 下 Agent 连接 CRUD），v2.1 的 Agent 文本模型连接在 v2.5 有了可达入口；但首次启动引导、部分历史/生成 parity、费用审批、移动键盘、连接预设/模型拉取和若干详情/批量动作仍缺
- [x] 批次 B1(2026-09-06,并行 6 卡,checkpoint 起点 `8b0ef3c`):按 ui-parity 差距清单收口 v2.1 parity
  - boundary: 每卡只改自己的屏/域文件;枢纽文件(contracts gateway-methods/index/preferences、platform gateway/capabilities/query-keys、desktop-gateway、settings/sections、shell/shortcuts)只做增量编辑;不动桌宠、豆包内部、V25-UI-SPEC/MIGRATION-CARDS(由主代理批次末统一回写)
  - verify: 已验证(2026-09-06)。六卡全部交付;批次末统一门禁:`pnpm run check` 35/35 任务绿(根 vitest 191 文件 1460 测试、features 396、boundaries 0 违规)、Web E2E 双视口 122 passed / 4 skipped、Electron project 55 passed / 1 skipped(真实 key 用例),三形态全绿。主代理修复:① `appPreferencesPatchSchema` zod 4 `.partial()` 回填 default → 桌面 bridge spread 会重置置顶/密度/生成默认/引导哨兵,改为剥 default 后 partial + 契约回归测试;② `useClearAllData` `onSuccess` 返回全量 `invalidateQueries()` Promise 被离线 `account.getStatus` 挂住 → mutation 永远 pending,改为只失效 prompts/workbench/generation/system 且不 await;③ 设置段控件(主题/动效/密度/质量 ToggleGroup)在 390px 视口溢出卡片,新增 `settings/segment-classes.ts`(<sm 铺满行宽、字号/内距收一档);④ `history.test.tsx` 两处 TS(自由错误码越过枚举、闭包赋值 never);⑤ drizzle 生成的 `0006_snapshot.json`/`_journal.json` 未按 biome 格式化;⑥ `electron.sync.spec.ts` 未适配设置分区导航(account/sync/connections 分区跳转);⑦ `electron.settings-data.spec.ts` 备份状态断言未计入首启 takeover 快照;⑧ `electron.prompts.spec.ts` 浅色基线吞入前序 toast,加 toast 消散等待;⑨ 宿主注入 `onOpenHistory`(desktop-shell / web prompts page)。视觉基线重收(先删再生,2% 容差不会自动重写):web `settings-light/dark`(双视口)、`prompts-detail`(双视口)、`history-list`(双视口)、electron `desktop-prompts-light/dark`、`desktop-history-light`、`desktop-settings-light/dark`。文档回写:V25-UI-SPEC §2.6/§4/§5/§6.2-6.3/§7.2/§8-I7/§9(D10、D13 过期项更正,新增 D18–D22)/§10.2;MIGRATION-CARDS U01-onboarding `done`、U02/U04/U05 已迁与待迁重写;ui-parity 01/04/05/07-02/07-03/07-06/07-07 由各卡销账;`docs/product/16` 清空边界表述更正。遗留(转 B2/B3):大库/大列表虚拟化(features 声明 `@tanstack/react-virtual`)、`promptId` 服务端过滤、密度 token 消费、S01 Key 失效引导、「需要重启应用」逃生门、Composer 预选断言补 `workbench-domain.test.ts`
  - B1-T1 提示词库完整性(U02,ui-parity 04 §8):封面缩略(契约 `coverImageUrl` + 存为提示词写入)、详情 Inspector/窄屏 Sheet(头部/正文/相关作品/元数据,「使用」主动作)、行点击开详情、清除筛选/新建 CTA、清空回收站(`prompts.emptyTrash`)、⌘/Ctrl+S、更新时间、复制 Check、`prompt-highlight` 接收端、⌘K/`/` 聚焦搜索
  - B1-T2 历史完整性(U04,ui-parity 05 §7):自定义日期区间、批量清理(30 天前/失败取消/清空回收站,`generation.cleanup`)、磁盘用量(桌面)、检视谱系「来自/派生」、桌面文件操作(打开目录/复制图片,`canRevealLocalFile` 门控)、错误建议文案、孤儿微调标注与「+n 微调」、成本/用时/种子字段、lg+ 检视 slide-in
  - B1-T3 AI 连接完整性(07-02 §6):`aiProviders.listModels`(草稿亦可拉取)+ 模型 combobox、编辑 Dialog 脏表单守卫、「设为默认」+ Composer 预选联动、行首状态点、新建流程内测试连接、接入预设目录、无 Key 前置提示、`role=status`;Agent 连接同享
  - B1-T4 偏好完整性(07-03 §5):`defaultAspectRatio`/`defaultQuality` 进偏好契约 + 生成默认参数卡 + 新会话草稿初始化/未改草稿联动;界面密度 `--density-*` 七 token + 两档 chips + `data-density` 同步;主题/动效动态 hint;偏好 error 重试钮
  - B1-T5 首启引导(U01-onboarding,基线 `apps/desktop/src/features/onboarding/*`):welcome → connect(官方账号 / 桌面 BYOK / 豆包冻结入口三轨;Web 只官方账号)→ validate → first-image → complete;跳过/返回/失败恢复;完成哨兵(`preferences.onboardingCompletedAt`)持久化、再启动不重放;已有 Provider 或已登录不触发;E2E 夹具默认已完成引导
  - B1-T6 设置·数据存储 + 关于(07-06 §6 / 07-07 §6,新 `system` 桌面域):数据库备份卡(立即备份/列表/恢复确认+重启)、存储位置(复制/打开)、诊断日志查看、危险区(确认短语「清空全部数据」)、关于卡(品牌/版本/schema/复制版本信息/文档/反馈信息/第三方声明/快捷键表 `PRODUCT_SHORTCUTS` 单源);`system.relaunch` 供「需要重启应用」逃生门
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
  - verify: `pnpm run check`、`pnpm run test:e2e`、桌面 Electron E2E 和 `check_spec_package.py` 结果真实记录。2026-09-03 `pnpm run check` 为 182 个测试文件、1357 个测试、35 个 Turbo task 全绿（features 23 文件/297 测试；此前基线 1301）；本轮受影响 Design Scheme 套件 8 个文件、151 个测试通过，根目录 `pnpm run typecheck` 通过；最新完整 Electron project 为 33 passed、1 failed、1 skipped，唯一失败是 macOS 原生 fullscreen 前 runner 无法让 Electron shell 获得前台焦点，跳过项为真实 key 场景；Workbench Electron 9/9 通过并覆盖 Design Scheme 取消路径。最新完整 v25 E2E 为 98 passed、1 failed、5 skipped，同一 fullscreen shell focus 前置失败；此前一次完整复跑的 99 passed、5 skipped 与 34 passed、1 skipped 没有 durable report/artifact，只能作为历史记录；Spec 校验仍应因未完成 parity/证据门禁失败
- [ ] 完成 parity 复核、验收清单和迁移知识沉淀
  - boundary: 只更新本包 `checklist.md`、相关 v2.5 证据文档和 `.spec/docs`，不改业务逻辑
  - verify: checklist 全部勾选且 `**验收结果**：通过`，每个任务有 boundary/verify 证据，变更边界和非目标可追溯。当前已回写实际验证与阻塞，但不能在 Design Scheme/全量 parity 未闭合前标记通过

---

**当前进度**：由脚本计算，无需手动维护
