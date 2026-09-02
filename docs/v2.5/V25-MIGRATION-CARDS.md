# V25-MIGRATION-CARDS — v2.1 → v2.5 全功能迁移任务卡

> **性质**:实施台账(非规范源)。本文只记录迁移范围、依赖、证据和进度,不定义产品语义。
>
> **裁决顺序**:当前源码/数据库迁移/自动化测试 → v2.5 四份规范文档 → `v2.5-baseline` 源码与 v2.1 历史文档。实践方式见 [V25-FEATURE-DEV-GUIDE](./V25-FEATURE-DEV-GUIDE.md)。
>
> **UI 基线**:信息架构、入口、动作、状态、快捷键和功能结果与 `v2.5-baseline` 基本一致。改进只允许提升可达性、错误恢复、响应式、性能、无障碍、token 化与安全;有意差异须登记到 [V25-UI-SPEC §9](./V25-UI-SPEC.md#9-与旧版差异登记表有意变化已批准)。
>
> **排除与保留**:桌宠完全冻结,不迁移不重构。豆包内部 renderer、主进程算法、登录同步和数据库迁移不迁移;v2.5 必须保留可达入口,入口只转接既有能力。

## 0. 卡片规则

状态只写已经有源码与测试证据的事实:

| 状态 | 含义 |
|---|---|
| `todo` | 尚未开始或只有历史实现 |
| `doing` | 当前批次正在修改,尚未通过全部卡内门禁 |
| `partial` | 主路径已迁,仍缺旧版功能或对称证据 |
| `verify` | 实现已齐,等待全量/真实环境验收 |
| `blocked` | 代码或合同已有明确证据,但被环境、外部依赖或尚未建立的必要门禁阻断;不得当作通过 |
| `done` | 六层走线与卡内门禁均有当前提交证据 |
| `frozen` | 明确不迁移,只跑防回归测试 |

涉及屏幕、宿主或跨端行为的卡片必须同时填写以下平台矩阵。`N/A` 只表示该平台没有该语义,不能用来掩盖未实现;桌面单元格必须在存在系统差异时注明 macOS/Windows/Linux。Desktop Agent 是兼容面,与 Desktop renderer 分列,不能用 Agent 测试替代产品 UI 证据。

| 字段 | 必填内容 |
|---|---|
| Mobile Web | 入口/路由、响应式差异、状态、Web mobile E2E 与视觉证据 |
| PC Web | 入口/路由、桌面视口差异、状态、Web desktop E2E 与视觉证据 |
| Desktop | Electron 入口、IPC/SQLite/core 触达、状态、macOS/Windows/Linux 差异与 Electron 证据 |
| Desktop Agent | Automation/CLI/local MCP 的兼容状态;无关时写 `N/A` |
| Capability | capability flag、fallback 和不可用时的入口行为 |
| State matrix | 对应 `V25-UI-SPEC` 或 `ui-parity` 状态矩阵章节 |
| Evidence | 单测、API/client/IPC mapping、E2E、视觉快照、真 PG/SQLite 证据 ID |
| Difference | 对应 `V25-UI-SPEC §9` 的有意差异编号;没有则写 `N/A` |

每张源码卡完成前必须逐项核对:

1. 契约:Zod 唯一形状源,类型从 schema 推导,兼容与安全边界有测试。
2. 接缝:gateway、query key、可选域与 capability flag 同步。
3. features:四端共用屏/hook,无 Electron/Next/Node 依赖,状态矩阵齐全。
4. Web:API 路由/service + api-client 映射 + Next 薄挂载。
5. Desktop:IPC 方法表/BridgeError/行映射 + desktop-gateway 精确 payload。
6. 证据:就地单测、必要的真 SQLite/PG、Web desktop/mobile、Electron 与视觉快照。
7. 平台矩阵:Mobile Web、PC Web、Desktop、Desktop Agent 均有状态或明确 `N/A`/`blocked` 理由。
8. 边界:不改桌面版本号;不触碰 pet 与豆包内部实现;准确判断 Agent/CLI/MCP/Automation 影响。

### 0.1 证据登记口径

为防止“源码存在”被误写成“功能完成”,每条 evidence 必须同时注明证据层级、执行范围和可复现位置:

| 证据层级 | 可以证明 | 不能证明 |
|---|---|---|
| `source` | 当前源码/迁移/manifest 存在,接口或边界已声明 | 消费方、成功路径、跨宿主 parity、真实数据正确性 |
| `unit` | 单函数、schema、mapper、状态决策或错误分支 | 真 API/PG/SQLite、真实 Electron 窗口、生产构建 |
| `mock-e2e` | 共享 features 在指定视口中的交互和视觉 | API service、PostgreSQL、worker、生产 Web runtime |
| `runtime-e2e` | disposable SQLite、真实 Electron 或 Testcontainer PG 的运行结果 | 未执行的平台、未覆盖状态和跨设备语义 |
| `artifact` | 指定 build/package 产物的加载、迁移和启动 | 另一个平台或另一个产物路径 |
| `external` | 真实账号、真实设备、远程 MCP 或发布环境结果 | 可由本地 fixture/mock 替代的事实 |
| `blocked` | 阻塞原因、保留的断言和可重跑条件 | 通过、完成或可跳过门禁 |

当前工作树中的未提交改动统一标记为 `working-tree-only`;它们可以驱动下一卡实现,但不能单独把卡升为 `done`。数字 evidence 必须绑定命令、测试范围、执行日期和 commit/report/artifact;无法复现的历史数字改写为“未登记”。`test.skip`、缺产物自动 skip、只上传失败 artifact、route mock 和人工目测均不能单独构成全量通过证据。

### 0.2 v2.1 / baseline 反向覆盖总表

下表把旧用户意图、当前实现和迁移卡分开记录。`当前证据` 只表示当前树可找到的实现或测试,不代表四端完成;旧路径来自 `v2.5-baseline`(`0e5be61`),当前路径必须再由本地源码和测试核对。

| 旧产品意图 | baseline 对位 | 当前 v2.5 证据 | 当前判定 | 归属卡 |
|---|---|---|---|---|
| 壳、导航、窗口控件、拖拽区 | `apps/desktop/src/components/layout/*`、`apps/web/src/layout/*` | `packages/features/src/shell/*`、Web/Electron shell specs | `partial`;macOS fullscreen 前台焦点 `blocked`,Win/Linux 控件和内容拖拽仍缺 | U01、U01-fullscreen-environment |
| 首次启动 onboarding | `v2.5-baseline` 的 desktop onboarding 与 Web BootScreens 历史实现 | 当前 features 无 onboarding module/route | `todo`;无 Provider inline guide 不等于完整首启三轨引导 | U01-onboarding |
| 账号、注册、退出、额度、兑换 | baseline account/settings surfaces | `packages/features/src/account/*`、Web account/Electron settings specs | `partial`;Web 主要为 route mock,真实云端与 Agent connection UI 缺 | U05、S01 |
| Desktop Provider/BYOK 与模型目录 | baseline Provider/AI connection surfaces | `providers-domain.ts`、`AiConnectionsPanel`、定向 tests | `partial`;safeStorage 主路径存在,失效/轮换/Agent key 生命周期未闭合 | U05、S01 |
| Prompt/Folder/Tag CRUD、搜索、置顶、回收站、冲突 | baseline library/product-ui | features/prompts、API/IPC tests、Web/Electron prompt specs | `partial`;大库/封面/Inspector/真 PG/跨设备证据缺 | U02、D01-boundaries、D02-a |
| 新设计、会话、草稿、参数、提交/取消/重试 | baseline generation/workbench | features/workbench、Web/Electron workbench specs、API/IPC/core tests | `partial`;多图、审批、费用、移动键盘及 working-tree-only 修复未闭合 | U03、U03-spend |
| 参考图、比例、结果消费 | baseline image input/RatioPicker/result card | current contracts/domain/IPC 和 working-tree E2E | `partial`;多图保存/复制和稳定产物回归未闭合 | U03、Q01 |
| 微调、父子谱系、错误建议 | baseline refinement/history lineage | 当前只保留部分 `parentRunId`/lineage 展示 | `todo/partial`;不得以线索展示冒充微调完成 | P02、U04 |
| 历史列表、筛选、详情、Lightbox、清理、统计 | baseline history components | features/history、Web/Electron history specs | `partial`;列表行已显示已有 `costPoints`, `null` 成本不伪造成 0；批量清理、磁盘用量、种子/谱系跳转及完整历史成本/统计闭环仍缺 | U04、D02-a/d |
| 设计方案全生命周期 | baseline `features/design-schemes/*` 与 main runtime | canonical contracts、SQLite/PG schema、Desktop/API/client adapter、shared features | `partial`;确定性 CRUD、working-draft 读取、Desktop `.musefold.design` 安全 staging/archive/domain 导入导出、owner-safe 历史来源链路与失败回滚已接线；共享屏详情生命周期回调与 Web `/design-schemes?scheme=<id>` deep-link 的打开/返回/删除 query 同步、非法参数清理已接线；正式详情常驻修改入口、相册键盘与横向触控导航已补且有 features 回归测试，但 Desktop Agent 编译/modify/run/event 与真实 E2E、Web runtime、云端 run/assets/package 尚未闭环，双宿主 capability 保持关闭 | P01-1..P01-13 |
| Skill runtime、GitHub 固定版本读取 | baseline Skill conversation/skill-import/local MCP | 主进程 skill runtime/import 保留,新壳无入口 | `partial`;兼容面不等于 renderer parity | P02、P01-12 |
| 分享、导入、导出、`.musefold.design` | baseline share surfaces、scheme share runtime | Desktop 主进程 share/staging/archive 已接入 v25 domain 导入导出;无 shared screen,Web package 仍 fail-closed | `partial`;方案专用 Desktop staging/指纹/落盘已接线未验收(E2E/capability),Web 导入导出与确认未闭合,通用分享/导入仍暂缓(P03) | P01-9、P03 |
| Automation token、确认、预算、审计、取消 | baseline `AutomationConfirmCard` 和 automation runtime | automation-server/local routes;v25 确认 UI 缺,约 120s 超时拒绝 | `partial/blocked`;外部花费动作无用户确认闸 | U03-spend、P01-11、P03 |
| Cloud MCP/Agent 上下文读取 | v2.1 精确 allowlist | `apps/api/src/modules/mcp/manifest.ts` 七工具 + manifest tests | `partial`;缺两独立远程客户端、撤销和发布环境 evidence | P01-12、Q01/Q03 |
| 云同步 consent、owner、outbox、冲突、恢复 | v2.1 sync docs/legacy runtime | current IPC/core/API sync + Electron sync spec | `partial`;本地 mock 单设备证据,跨 owner/两设备/真云端缺 | D01、D01-boundaries、Q01 |
| 删除、保留期、asset/staging GC | baseline trash/cleanup/migrations | soft-delete/restore/部分 purge;worker 仅 rate-limit cleanup | `todo`;30/90 天策略无 runtime/maintenance evidence | D02-a..d |
| Desktop takeover、scheme replay、PG replay | baseline migrations/DB | disposable migration tests、PG schema tests、env-gated Testcontainers | `partial`;无匿名真实 v2.1 语料、备份恢复演练和 CI replay gate | D03、Q03-pg-replay |
| 密钥、路径、media、导出和产物扫描 | baseline keychain/media/share tests | contracts negative tests、临时 userData scan、safeStorage code | `partial`;无 source/asar/DMG/Windows artifact 全面扫描 | S01、Q03-security |
| 宠物、豆包、更新和发布产物 | baseline pet/doubao/updater | 冻结代码仍在;release/package-smoke workflow 存在 | `partial`;入口/冻结负向证据和按平台非 skip smoke 未闭 | X01、Q03-package-smoke |

## 1. 总览与依赖

```text
B00 当前树基线 ─→ B02 可追溯证据登记
 └─ B01 既有公共域跨宿主合同 ─┬─ D01 数据正确性 ─┬─ U01 壳
                              │                  ├─ U02 提示词库
                              │                  ├─ U03 工作台
                              │                  ├─ U04 历史/资产
                              │                  └─ U05 设置/账号/连接
                              └─ X01 冻结入口保护

U01..U05 + D01 ─→ P01 设计方案 ─→ P02 Skill/微调/素材
                 └→ P03 分享导入/Automation/Cloud MCP
D01 + U02..U05 ─→ D02 生命周期治理
B02 + 全部实现卡 ─→ Q01 反向审计 ─→ Q02 本地门禁 ─→ Q03 CI/CD
```

`P01-0..P01-4` 的合同、数据 scaffold 和 fail-closed seam 可在 U 卡尚为 `partial` 时先行,但 P01-6 共享 UI、P01-7 入口和 P01-13 最终 evidence 仍依赖相关 U/D 卡稳定。该并行只减少等待,不降低产品 parity 或全量门禁。

## 2. 基线与基础设施

### B00 当前工作树与视觉基线

- **状态**:`verify`
- **目标**:在独立迁移分支保护现有未提交 UI/Workbench 改动,取得当前树真实门禁结果。
- **当前证据边界**:当前分支 `spec/2026-09-01_migrate-v21-to-v25`;已有阶段成果提交至 checkpoint `b85aa1b`、`9f7a860`、`aa87333` 与 `82ad437`。当前树复现 `pnpm run check`（179 个测试文件、1282 个测试、35 个 Turbo task，退出码 0）；History 成本切片的 `@musefold/features` 定向测试为 23 个文件、279 个测试，覆盖已知成本展示与未知成本隐藏；时间线内容尺寸变化后的贴底修复使 `@musefold/features` Workbench 定向测试达到 23 个文件、281 个测试，正式方案详情常驻修改入口切片后 features 定向测试达到 23 个文件、283 个测试，相册键盘与横向触控导航切片后达到 23 个文件、286 个测试；移动 Workbench 完成态视觉基线已连续复核通过；最新完整 `pnpm run test:e2e` 为 97 passed、1 failed、5 skipped，唯一失败是 macOS runner 无法让 Electron BrowserWindow 获得前台焦点的原生 fullscreen 阻塞，Web 测试同时记录后端 `127.0.0.1:8787` 未启动的 proxy 日志。由于尚未绑定 durable machine-readable report/artifact，数字只能作为当前工作树验证记录，不能把 B00 升为 `done`。同步四态截图若位于 gitignored `.results`，仍不能替代持久 visual baseline。
- **动作**:
  - 审查现有 dirty diff,不回滚用户改动。
  - 用当前源码重建 Web/Electron;清理或拒绝复用 3399 的旧服务。
  - 由 B02 登记命令、commit、日期、report/artifact 和 skip;没有登记的历史数字不回填。
  - 缺失视觉快照要么纳入 `toHaveScreenshot` 稳定基线,要么由 CI 成功/失败都持久上传;人工目测只作辅助。
- **门禁**:`pnpm run check`;`pnpm run test:e2e`;Electron project;B02 evidence manifest。
- **回滚**:只回滚本卡新增 evidence/基线,不改用户原有工作树。

### B02 可追溯 evidence manifest 与基线刷新

- **状态**:`todo`
- **目标**:建立 claim → 当前源码/测试名 → 执行命令 → 证据层级 → commit/date → report/artifact → skip/blocked reason 的单一登记,替代易过期的 prose 数字。
- **范围**:新增机器可读 evidence manifest 和 repo 守卫;刷新 B00/B01/D01/U01..U05/P01/Q01..Q03 的数字与状态。manifest 不存凭据、Prompt 正文、本地路径、真实用户身份或生成结果资产。
- **验收**:每个 `done/verify/blocked` claim 都可解析到存在的测试/迁移/workflow 路径;历史运行无 report 时标“未登记”;repo test 拒绝缺文件、重复 id、`test.skip` 冒充 pass 和过期 commit;渲染后的 Markdown 主表列数正确。
- **平台矩阵**:Mobile Web/PC Web/Desktop/Desktop Agent 均由本卡登记证据,本卡自身不实现产品能力。
- **依赖**:B00。Q01/Q02/Q03 只能消费本 manifest,不得再手写一组不一致数字。

### B01 既有公共域跨宿主合同与方法映射

- **状态**:`verify`
- **旧版能力**:Desktop/Web adapter 对相同产品动作提供一致结果,宿主只适配 transport。
- **范围边界**:本卡只覆盖当前已接通的 settings/account/sync/providers/prompts/workbench/generation 公共域。设计方案的 canonical seam 归 P01-3/P01-4/P01-5,不得用 fail-closed `designSchemes.*` 方法扩大解释本卡。
- **当前发现**:
  - `buildMethods()` 已由 contracts 的 canonical source 派生方法集合,并在生产构建时对 settings/account/sync/aiProviders/designSchemes/prompts/workbench/generation 逐域做双向断言;当前定向 bridge 测试已覆盖原型链方法名和全域异常脱敏。因此 method-set 漂移不再是当前红门禁;剩余完整门禁和证据由 B02/Q02 登记。
  - Desktop design-scheme gateway 已有确定性 CRUD 成功路径(尚无 main 侧 event producer),Web api-client 已有 design-scheme adapter;两者按 P01 独立记账。
  - 现有 API-client/platform/desktop gateway 的历史数字已经与当前测试集合漂移,由 B02 刷新后再登记。
- **修复子卡 B01-R**:
  - 让主进程 method set、Desktop gateway wire names 与测试锁定使用同一 canonical source或明确的双向集合断言,避免手写清单静默漂移。
  - 为 preload 的 `onDesignSchemeEvent` 增 listener identity/unsubscribe 测试,并明确没有 main producer 时只能算 seam。
  - 保留 unknown method、strict input、BridgeError、unexpected redaction、malformed response、missing bridge 等负例。
- **验收**:既有公共域全部 gateway 方法有 transport mapping test;P01-4 的 15 个 fail-closed names 有独立 contract test;出参经 Zod;不存在 renderer 方法而 bridge 缺失或 bridge 方法而 adapter 无登记的漂移。
- **门禁**:gateway-bridge/preload/desktop-gateway/api-client/platform 定向 tests;相关 typecheck;Biome;`git diff --check`;B02 manifest。

## 3. 数据、状态机与同步

### D01 统一账本、生成状态机、账号与同步

- **状态**:`partial`
- **已迁证据边界**:`generation_runs/generated_assets` 单账本、API 幂等/原子取消、worker lease/epoch/reconcile、Desktop/core 终态守卫、sync consent 四态和冲突处理均有源码与定向测试。worker 证据以函数/fake dependency 为主;Electron sync 使用本地 mock server;真 Graphile Worker + PG、两设备和生产 sync transport 不能由这些证据替代。
- **剩余功能**:
  - Desktop Prompt/Folder/Tag 建立 workspace 所有权,旧本地数据固定留在 local-only workspace;新 owner 未显式 adopt 时 seed outbox 必须为 0。
  - usage/version/max 合并、purge/outbox/FTS/cloud entity state 一致;Provider 激活与 active 删除接管事务化。
  - 两设备 pull/apply 与 push 交错、server-side device mid-push 撤销、跨账号 relogin、cursor expired 和真实云端错误恢复。
  - real Graphile Worker + PG 执行、worker restart/reconcile、storage partial/orphan cleanup 与外部 Provider success/failure/cancel race。
- **working-tree-only**:当前 prompts-domain Folder/Tag workspace 作用域修复、generation prompt 比例约束/多参考图编号等变更在 dirty tree 中;在 B02 登记并通过对应回归前不得写成已提交完成。
- **视觉证据修正**:Electron sync 四态行为和临时截图生成代码存在,但截图写入 gitignored `.results` 且 CI 只在失败时上传;“已人工检查”不是可复现视觉 evidence,由 V01 处理。
- **触达**:contracts、db/desktop-db、api/worker、core、IPC、account/sync features。
- **验收**:并发/崩溃/重复执行/取消竞态;匿名 v2.1 SQLite 回放和备份恢复;真 PG/worker;断网/换号/两设备/冲突/撤销;所有非 enabled 状态 zero transport。
- **门禁**:worker unit + runtime integration;API `test:integration`;desktop takeover/replay;Electron sync/account E2E;B02 evidence manifest。

### D01-boundaries workspace、跨账号与两设备 fencing

- **状态**:`partial`
- **范围**:定义 local-only workspace 的显式 adopt/copy 语义;逐项决定 Folder/Tag/Prompt/FTS/usage/outbox/entity-state 的 copy/retain/seed;验证 design-scheme machine-local DB 与 account-scoped Prompt sync 在同一 userData 中互不串线。
- **本批已闭合**:登录和开启同步在缺少显式 account workspace 时不自动建 workspace、不构造 cloud transport;显式 `adoptLegacyWorkspace` 复制 Folder/Tag/Prompt/prompt_tags、usage 并重建 FTS,保留 local-only source;重复 exact copy 幂等, divergent 非空目标拒绝;cloud entity state、mutation outbox、usage outbox 不跨 owner 复制,由后续 seed/runtime 重新建立。
- **状态矩阵**:`unset`、`paused`、`enabled`、`auth_blocked`、`owner transition`、`device revoked`、`cursor expired`;任一 owner/token/device mismatch 都必须停 transport 且保留数据。
- **平台矩阵**:Mobile Web/PC Web 只验证服务端 owner/version 结果;Desktop 验证 SQLite/outbox/transport;Desktop Agent 验证本地调用不能绕过 active owner 或复用 Cloud OAuth。
- **剩余**:跨 owner seed、两客户端 duplicate/local/remote、device mid-push 撤销、cursor expired/bootstrap reset、真实 Electron account transition 和 design-scheme machine-local 隔离的 runtime evidence 仍未闭合。
- **验收**:未 adopt 的新 owner seed=0;A outbox 永不发给 B;两客户端 duplicate/local/remote 都可解释;device mid-push 撤销后后续 mutation 被 fence;设计方案本地库不因登录自动绑定或上传。

### D02 删除语义、回收站与保留期治理

- **状态**:`todo`
- **父卡范围**:统一 deletion/tombstone/purge/retention/GC,不把当前单项 soft-delete/restore 或 archived session 误报为治理完成。保留期数值必须进入可执行配置/服务常量和测试,不能只写在本文。
- **子卡**:
  - **D02-a 删除语义 parity**:`todo`。Folder/Tag detach 后硬删且同步 tombstone 不可 restore;Prompt/History/Session `deletedOnly`、restore/purge/清空回收站;永久删除会话保留 generation 并置空 session id;归档恢复是否清 `archivedAt` 明确。所有不可恢复动作走 AlertDialog。
  - **D02-b retention maintenance**:`todo`。软删对象 30 天 purge;sync log/result/event 90 天裁剪;automation audit/external run/Skill backup retention;任务幂等、可暂停、可观察且不删除 outbox/conflict/tombstone/cursor/bootstrap metadata。
  - **D02-c asset/staging GC**:`todo`。S3 reference/generated asset、Desktop reference staging、share package staging 和 orphan upload 清理;引用计数/ledger/provenance 仍存时禁止删;失败重跑不得破坏成功资产。
  - **D02-d 三形态回收与清理 evidence**:`todo`。Web desktop/mobile、Electron 对软删/恢复/永久删除/清空/归档区别进行行为与视觉验收;Desktop Agent destructive API 需预算/确认/审计,Cloud Agent 不提供删除工具。
- **触达**:contracts/platform/features、双端服务、两套数据库、worker maintenance、设置入口。
- **验收**:桌面/云端相同语义;maintenance 连跑两次第二次 no-op;仍被引用资产存活;同步水位可恢复;S3/磁盘失败产生可重试 orphan 记录而非静默成功。
- **门禁**:migration replay、真 PG、worker maintenance、Web/Electron E2E、artifact/userData path+secret scan。

### D03 匿名真实 v2.1 SQLite 语料与备份恢复演练

- **状态**:`partial`
- **目标**:补齐当前“由代码合成 legacy DB”之外的真实形态回放。只使用脱敏、可公开、无凭据/正文/绝对用户路径的匿名 fixture;任何用户/活动 App 数据库不得用于自动测试。
- **本批已闭合**:新增 D03-A synthetic disposable corpus builder/scanner 与 provenance manifest,覆盖 legacy `user_version=20`、FTS drift、非 ASCII/长相对路径元数据、enabled/paused/unset sync 状态、outbox/conflict/tombstone、历史资产、归档会话及独立 design-scheme v4 scaffold;scanner 实际校验 integrity/FK/表/version/hash/source 禁止项/敏感值/绝对路径/Prompt 脱敏。
- **语料**:至少包含 `user_version=20`、FTS drift、非 ASCII/长路径元数据、已启用/paused/unset sync 证据、outbox/conflict/tombstone、历史资产、归档会话;design-scheme 独立 v4 库另存 fixture。
- **演练**:legacy → desktop-db takeover;`VACUUM INTO` 备份可开;迁移失败后原库不变;从备份恢复后旧/新版本可启动;design-scheme v4→v5 replay;fresh PG 0000→latest 与已应用 0000→latest replay。
- **剩余**:D03-A 仍是代码生成的 synthetic corpus,不能冒充真实脱敏 v2.1 语料;takeover/replay、备份恢复、design-scheme v4→v5 和 PG migration replay 尚未形成 runtime evidence。
- **验收**:数据计数、FTS 查询、owner/consent/outbox/version、asset 引用和 scheme revision/run provenance 前后等价;备份恢复是可执行测试,不是文档承诺。

## 4. 核心 UI parity

### U01 应用壳、导航与窗口

- **状态**:`partial`
- **平台矩阵**:
  - Mobile Web:`N/A`(无原生窗口交通灯/全屏 inset 语义);移动抽屉与底栏由 Web shell 另行回归。
  - PC Web:`N/A`(浏览器全屏 API 不属于本卡);桌面 Web 壳行为由既有 Web shell E2E 覆盖。
  - Desktop:`partial`;macOS 全屏 inset 子卡已完成代码接线与单测/构建验收,但真实原生全屏 E2E 受当前 runner 无法让 Electron BrowserWindow 获得 macOS 前台焦点阻断,Windows/Linux 保持 0 inset 与现有自绘窗口控件边界。
  - Desktop Agent:`N/A`。
- **已迁**:共享侧栏/移动底栏、会话区、账号 footer、错误边界、动效闸门、基础 drag-region;U01 首批核心几何:默认 248px、220–360px/32vw 调宽,指针/键盘/Home/End/双击与旧 `musefold:sidebar-width` 持久化;普通屏四边 4px 浮岛(设置保持全出血);`<768px` 同源模态抽屉 + focus trap/Escape/inert/焦点归还/自动关闭;收起态占位展开轨。2026-08-29 的历史运行记录覆盖 features、Web shell desktop/mobile、Web/Electron build、renderer typecheck、Biome 与独立 review;原始计数未绑定 report/commit,由 B02 重新登记,不能作为当前通过数字。独立 review 找到并修复 761–767px 侧栏与抽屉同时缺席回归。
- **待迁**:Win/Linux 控件;内容/设置拖拽带;`⌘K`;会话上下文/任务摘要;AutomationConfirmCard;TooltipProvider 统一 300ms;首启引导(未 onboarded 且无 Provider 时的账号/BYOK/豆包入口三轨道,豆包只深链既有冻结能力)。macOS 全屏 inset 已由 U01-fullscreen-inset 接入,其真实 E2E 与单测证据见该子卡。
- **U01-fullscreen-inset 子卡**:`blocked`。旧版基线为 macOS 非全屏保留 traffic-light 空间、原生全屏回退约 12px;当前 v2.5 已由 `resolveBrandInset(IS_MAC, isFullscreen)` 驱动,macOS 非全屏 78px、原生全屏 12px,非 macOS 0px。触达链为 `electron/main/window.ts → electron/preload/v25.ts → window.musefoldV25 → apps/desktop/src/v25/main.tsx → AppShell.brandInset`;窗口状态不进入 contracts、platform data gateway 或 `musefold:invoke` 方法表。代码/单元证据可记 `verify`,但真实 macOS runtime evidence 被环境阻断:当前 runner 的前台应用不是 Electron,`BrowserWindow.isFocused()` 持续为 `false`,用例在聚焦前置条件处失败,未删除断言或无条件 skip。完成条件是在允许 WindowServer 前台激活 Electron 的 macOS runner 重跑 `tests/v25/electron.shell.spec.ts`,并取得 `78px → 12px → 78px` 的真实窗口证据。Difference:`D16`;不触碰 pet/Doubao。
- **U01-onboarding 子卡**:`todo`。恢复首次启动且无可用 Provider 时的完整引导,不能用 Composer 一行无连接提示代替。三轨为官方账号、Desktop BYOK、豆包既有冻结入口;Web 仅展示真实可执行的官方账号路径,不伪造本地 Provider/豆包。验收 welcome/connect/validate/first-image/complete、跳过/返回/失败恢复、完成哨兵持久化和再次启动不重放;豆包只深链既有能力,不改 frozen internals;无授权不执行真实生图。
- **U01-fullscreen-environment 子卡**:`todo`。建立可聚焦 Electron 的 macOS runner 资格检查、前台应用诊断和 artifact 保留;资格不满足时结果为 `blocked` 而非 pass/skip。该环境卡不得削弱 fullscreen 产品断言。
- **UI 约束**:几何和交互以旧 `ProductSidebarLayout/TitleBar/WindowControls` 为基线;移动底栏作为不删功能的改进保留。新增 UI 必须使用 `packages/ui` 的 ShadCN 原语、Lucide 出口和语义 token;本卡不新增组件。
- **触达**:features/shell、两宿主挂载、桌面 window IPC/capability、ui tokens。
- **验收**:桌面/Web 大屏/760/680/390;键盘与焦点;Windows package smoke;视觉明暗;新用户四步完成后进入工作台,完成哨兵持久化,三轨道不产生死入口。U01 子卡另验收 macOS `78px → 12px → 78px` 与收起轨同步变化。

### U02 提示词库完整迁移

- **状态**:`partial`
- **已迁**:CRUD、搜索、排序、置顶、Folder/Tag、使用动作、回收站、永久删除、存为提示词入口;PromptEditorDialog 使用 ShadCN Dialog/AlertDialog 实现 dirty guard,拦截取消、Escape、外点与 X,支持继续编辑/放弃修改,保存失败保留表单值。
- **待迁**:封面资产;详情 Inspector/窄屏 Sheet;相关作品;跨屏高亮;更新时间;清除筛选 CTA;清空回收站;大库虚拟化;分享/导入与创建方案入口在对应域就绪后恢复。编辑器 `Cmd/Ctrl+S` 仍为独立快捷键任务。
- **平台矩阵**:
  - Mobile Web:`partial`;同一 features 屏与移动布局存在,但 Prompt 详情 Inspector/Sheet、Taxonomy Sheet、大库 evidence 和部分清除筛选动作未闭合。
  - PC Web:`partial`;列表/编辑/回收站 route-mock E2E 存在,不证明真 API/PG;详情 Inspector、封面和相关作品缺。
  - Desktop:`partial`;IPC/SQLite CRUD 与 Electron E2E 存在,封面 path-free mapper、相关作品和大库性能缺。
  - Desktop Agent:`partial`;local MCP/Automation 读取/写入兼容需单独回归,不能替代 renderer;Cloud MCP 仅 search/get 云 Prompt。
- **Evidence 边界**:Web Playwright route mock=`mock-e2e`;Electron disposable SQLite=`runtime-e2e`;真 PG/跨设备 sync 由 D01/Q03 提供。

### U03 工作台、生成与结果消费

- **状态**:`partial`
- **已迁**:会话/草稿、首句标题、Timeline/Composer、三路参考图、Provider、取消/重试/删除、保存图片/提示词、消息编辑/复制、回到最新、基础 Lightbox;比例目录与自定义 `W:H`(UI/草稿/契约同为 1:4–4:1,canonical wire);Prompt 引用六层闭环(最多 6 条整条/UTF-16 片段、host-owned owner/workspace 解析、不可变快照、纯引用生成、304px Dock/移动 82dvh Dialog)。
- **P0 回归**:
  - Desktop openai-compatible 主链必须恢复比例约束合成;两张及以上参考图必须恢复图片序号提示。两者复用 `packages/domain/src/generation-prompt.ts`,不得只保留在 Skill/设计方案旁路。
  - Prompt 引用不是暂缓域:已恢复最多 6 条选择意图、owner-safe 解析、Composer 引用卡与不可变历史快照;client title/text/content 不得成为权威数据。2026-08-29 的历史证据覆盖 features、domain/core/Desktop bridge、真 PG、Web desktop/mobile 与 build 后 Electron/SQLite;原始测试计数未绑定 report/commit,由 B02 重新登记,不能作为当前通过数字。源编辑/删除后历史不漂移,split-surrogate/版本/越权/伪造均拒绝。
  - Web 当前会话必须回写并读取 `?session=<id>`;刷新、前进/回退保持选中会话,无效或无权 id 安全回落。
- **待迁**:生成数量和多图选择/保存;用户消息参数摘要;历史/方案/Skill 引用 chip;素材 Dock;微调;方案/Skill 模式与运行对话;多图 Lightbox/复制图片;审批与费用确认完整矩阵;额度不足失败卡内兑换并自动重试;移动 Web 软键盘 inset。
- **平台矩阵**:
  - Mobile Web:`partial`;主工作台、参考图/Prompt 引用移动 Dialog 和 route-mock E2E 存在;会话删除用例当前按项目 skip,软键盘 inset、多图/费用恢复缺。
  - PC Web:`partial`;会话/生成/结果消费 route-mock E2E 存在,不证明 production Next runtime、API/PG/worker。
  - Desktop:`partial`;真实 Electron/IPC/SQLite 失败/重试与部分参考链证据存在;真实成功 Provider、多图、clipboard/file action、approval 仍缺。
  - Desktop Agent:`partial`;Automation/CLI/local MCP 可触发本地运行,其确认/spend/audit 归 U03-spend/P01-11/P03,不能替代 renderer。
- **U03-spend 子卡**:`todo`。覆盖 `pending_approval/not_required/approved/rejected`、预算内/超预算、quota 402、兑换成功后稳定 idempotency key 自动重试、取消/超时和终态额度刷新。Web 与 Desktop 使用相同结构化错误码和卡内恢复动作;Cloud Agent 无 spend tool;Desktop Agent 外部花费必须经过 U03-spend/P01-11 用户确认。
- **U03-worker-runtime 子卡**:`todo`。用 disposable PG/Graphile Worker/对象存储 fake 或测试容器跑实际入队→lease→provider boundary→upload→terminal/reconcile,覆盖 worker 重启、stale epoch、partial upload、late success、cancel race;不得调用真实生图或消耗额度。
- **验收**:成功/失败/取消/重试/断线/幂等/审批/多图;参考图安全边界;比例约束和多参考图编号真实进入上游 prompt;Prompt 引用快照;Web URL 刷新/回退;额度兑换原地恢复;移动键盘不遮 Composer;三形态 E2E/视觉;B02 登记 working-tree-only 修复。

### U04 历史、资产与统计字段

- **状态**:`partial`
- **已迁**:列表/筛选/详情/线程、回收站、恢复/永久删除、Lightbox、保存资产/提示词、查看会话。
- **待迁**:自定义日期;错误建议;谱系跳转;Desktop 打开目录/复制图片;批量清理;磁盘用量;大列表虚拟化;孤儿微调标识。列表行成本已接入现有 `GenerationJob.costPoints`：已知值显示 `N 积分`, `null` 保持隐藏；成本字段的完整跨端/统计闭环仍待 U04/D02/Q03 证据。
- **平台矩阵**:
  - Mobile Web:`partial`;列表、筛选、Sheet/Lightbox 与 route-mock E2E 存在;自定义日期、清理、谱系和大列表 evidence 缺。
  - PC Web:`partial`;宽屏 Inspector/列表 route-mock E2E 存在,真 API/PG/object storage 未由它证明。
  - Desktop:`partial`;Electron/SQLite 列表详情与保存证据存在;打开目录、复制本地图片、磁盘统计/清理缺。
  - Desktop Agent:`partial`;本地 history 读取/运行兼容另测,Cloud Agent 明确没有 history 扩读工具。
- **Evidence 边界**:Web action/visual=`mock-e2e`;Electron disposable SQLite=`runtime-e2e`;资产 GC/retention 由 D02,真 PG/对象存储由 Q03。

### U05 设置、账号、连接与归档

- **状态**:`partial`
- **已迁**:主题/动效、账号登录注册、额度兑换、云同步基础卡/开关/立即同步、本地 Provider CRUD/test、回收站入口。
- **待迁**:
  - 账号:注册确认密码已收口(ShadCN Input/Label,失配红字与 aria-invalid,按钮/Enter 均拦截,确认值不进 gateway payload);上次用户名;错误码文案。
  - 连接:模型拉取/combobox、dirty guard、默认切换、预设、状态点、新建时测试;v2.5 AI Connections UI 当前仅为 image Provider CRUD/default/test,暂无可达 Agent connection/model UI,separate Agent key 与 `gpt-5.5` 配置/选择仍是明确缺口。
  - 偏好:默认比例/质量、密度 token 与当前草稿联动。
  - 分区:使用统计;开放能力;已连接 Cloud MCP 应用;备份恢复;路径/日志;危险区;关于/支持/许可/快捷键;归档聊天。
  - 归档闭环:契约/API/IPC 增 `archivedOnly`(不能用 `includeArchived` 后客户端过滤);设置内四态列表、刷新、恢复与软删,生成记录保留。归档列表的「删除」沿当前会话软删语义,与旧版永久删差异登记 §9;真正 purge 留 D02。
  - 数据/关于接缝:新增可选 system/backup/automation/about gateway 与 `system-domain`;路径/日志/openExternal 必须主进程白名单;第三方许可数据源需重建。
  - 设置壳:达到分区阈值后恢复分组导航、搜索、深链、分区记忆;移动形态保持可达。
- **触达**:多个 contracts/gateway 可选域、features/settings/account、API/IPC/system/automation、双宿主挂载。
- **验收**:旧版每个设置动作可达;桌面专属项在 Web 有明确隐藏/fallback;密钥/令牌不泄漏;归档闭环不再是单向阀。
- **U05-archive-closure 子卡**:`partial`。共享设置内 archived 面板已在当前工作树落地 loading/error/empty/ready、刷新、restore/remove pending、AlertDialog 和 generation retention 路径;Web desktop/mobile route-mock E2E 与 Electron disposable SQLite evidence 存在。不能标 `done` 的原因:组件当前为 `working-tree-only`;查询固定 `limit:100` 且不消费 `nextCursor`;没有真 PG archive runtime/两设备 refetch;恢复后不精确返回原会话。Difference:`D17`;purge 留 D02。
- **U05-archive-pagination 子卡**:`todo`。消费 cursor/“加载更多”,覆盖 >100 条、跨页恢复/删除、操作失败回滚、恢复后可选择回原会话;Web 真 API/PG 和 Electron SQLite 使用同一集合语义。
- **平台矩阵**:Mobile Web:`partial`(同源卡片与归档窄布局;Desktop-only section 隐藏;Web evidence 多为 route mock);PC Web:`partial`(账号/设置同源,缺 connected apps/usage/about 等);Desktop:`partial`(账号/sync/image Provider 主链,缺 Agent connection、开放能力、备份/关于等);Desktop Agent:`partial`(local runtime 存在,无 v25 控制面,不替代 renderer)。
- **触达与依赖**:复用 `workbench.listSessions({ archivedOnly: true, limit: 100 })`、versioned `updateSession({ archived: false, expectedVersion })` 与现有 remove 语义;共享实现位于 `packages/features/src/settings/ArchivedSessionsPanel.tsx`、`SettingsScreen.tsx`、`packages/features/src/workbench/hooks.ts`;不修改 U01 fullscreen 文件,不得触碰 pet/Doubao。
- **当前证据**:contracts/API/client/IPC 的 `archivedOnly`、owner/filter/version mapping 与 features/Web/Electron 定向测试存在;精确运行数量由 B02 当前 report 刷新,不再在 prose 固定。Web 证据是 route mock,Electron 使用 disposable SQLite。
- **当前差异/范围备注**:baseline 删除为永久删除,当前按 D17 采用软删;没有 purge;恢复后停留设置页;侧栏归档失败 toast/局部回滚待补。一次读取 `limit:100`,未消费 `nextCursor`,超过 100 条会截断。

## 5. 安全与扩展产品域

### S01 凭据、token 与导出生命周期

- **状态**:`todo`
- **范围**:统一核对账号 bearer、image Provider key、Agent key、Automation loopback token、Cloud OAuth grant 和内容签名 key 的独立生命周期;不把任何 key 放入 renderer、SQLite 明文、日志、fixture、截图、导出、备份或发布产物。
- **子项**:safeStorage 不可用/解密失败 fallback;Provider key 失效后的可解释 UI 和删除/替换;Automation token 创建/掩码/复制/轮换/旧 token 即时 401;Agent key 与 image key 永不互写;backup/export/import secret scan;account logout/change 的内存清理与新 owner fencing。
- **平台矩阵**:Web 只处理 HttpOnly cookie/Cloud OAuth grant;Desktop 处理 safeStorage/loopback token;Desktop Agent 仅接受 local token;Cloud Agent 仅接受 canonical resource OAuth,二者不可互换。
- **验收**:mock safeStorage failure、keychain orphan cleanup、token rotation E2E、old token revoke、源代码/userData/backup/export/asar/DMG/Windows unpacked 扫描;测试值不得使用真实凭据。


### P01 设计方案

- **状态**:`doing`
- **平台矩阵**:域已从规划转入实施——Mobile Web:`doing`(共享 features 已有响应式形态,Web `/design-schemes` 列表/详情路由已挂载,运行与云端 assets/package 仍未完成);PC Web:`doing`(同一 features 的桌面视图与 Inspector、`?scheme=<id>` deep-link 已有,真实云端 runtime 仍未完成);Desktop:`doing`(v25 IPC/SQLite 确定性 CRUD、`.musefold.design` 导入导出与 v25 导航视图已接线,run/Agent 编译/modify/event 与 capability 未完成;macOS/Windows/Linux 差异按 capability 记录);Desktop Agent:`partial`(现有 Automation/CLI/local MCP 正式方案 list/get/compile/run 保留,不替代 Desktop renderer 证据)。
- **UI 参考与组件约束**:设计参考固定为 `https://ui.shadcn.com/create?preset=b27GcrRo`;该 preset 只作为外部视觉/组件参考。新组件必须先适配到 `packages/ui` 的本地 ShadCN/Radix 原语、Lucide 图标出口、Graphite/Ember 语义 token 和现有动效/无障碍约束,不得整体替换 `new-york`、主题或 RSC 配置。
- **旧版功能**:我的/发现、正式/草稿、来源与保真度、GitHub/历史/Prompt/分享包创建、试运行、转正、revision、输入槽位、上游更新、替换正式、详情/相册、跨屏 intent。
- **现有资产**:`electron/main/design-scheme/` 与 Automation/CLI/local MCP 主进程语义保留;P01-1 shared contracts、P01-2 SQLite/PG persistence、P01-3 platform seam、P01-4 Desktop v25 transport(确定性 CRUD 成功路径)、P01-5 Web API/client、P01-6 共享 features 均已有源码与定向测试。P01-7 Web `/design-schemes` 列表/详情路由、Desktop v25 导航视图与 `?scheme=<id>` 生命周期已接线,但双宿主 capability 仍按完整运行闭环要求保持关闭。`ui-parity/06-design-schemes.md` 是旧版存档与迁移蓝图,不构成当前成功运行路径 evidence。
- **走线**:contracts、platform seam、Desktop 确定性 adapter、Web cloud runtime/client、features/schemes 已建立;剩余为 Desktop run/Agent 编译/modify/recompile/event producer、Web run/assets/package、三端导航/详情/Workbench/Prompt/History 挂点与 E2E,最后才开启 capability。
- **状态矩阵**:以 `ui-parity/06-design-schemes.md §5.1` 为旧版验收基准,已同步登记为 `V25-UI-SPEC §8A` 正式章节(迁移中基准)。每个子卡必须记录 loading/error/empty/ready、capability、E2E/视觉证据与 `V25-UI-SPEC §9` 差异编号。
- **子卡**:按 `P01-0` 至 `P01-13` 执行,依赖和端侧证据见下表。
- **验收**:旧版交互全量闭环;方案资产进入受管资产库;automation 与 UI 产生同一结果;Mobile Web、PC Web、Desktop 三形态均有入口/返回/刷新/错误/空态和视觉证据;Cloud MCP 继续精确七个只读工具;无死入口。

### P01-0 宿主模型与数据归属

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **卡片性质**:本卡是设计方案域的架构裁决与实施边界卡,不是 renderer、contracts、gateway、API、IPC、数据库或同步实现卡。完成本卡只输出可追溯的宿主模型、数据归属/provenance 表、旧资产盘点、依赖 DAG、验收门禁和剩余风险;不得因本卡完成而打开设计方案入口。
- **目标**:继承 v2.1 的正式设计方案 Web/Desktop parity 目标,采用“最终 parity、分阶段接入”的宿主模型。当前保留 Desktop local runtime 与 Desktop Agent 兼容面;后续以 path-free shared contracts 和 `MusefoldGateway` 分别接入 Desktop 本地 adapter 与 Web cloud adapter,不把 Desktop-only 过渡状态固化成永久产品例外,也不引入未经定义的双写。
- **非目标**:本卡不创建 `packages/features/src/schemes`、`packages/platform` gateway/capability/query key、`apps/api`/`packages/db` Web 方案服务、`apps/desktop` v25 IPC/preload/gateway、SQLite/PG migration、同步、分享包或任何新导航/死入口;不修改桌宠、豆包内部实现及现有 Automation/CLI/local MCP 语义。
- **旧版/存量事实**:
  - v2.1 parity 将“正式设计方案”列为 Web/Desktop 的 P 能力,要求共同合同、创建/编辑/使用语义、共享 surface 与双端 controller/E2E/视觉证据;该目标不能被当前暂缓状态改写为永久 Desktop-only。
  - 旧设计方案领域 schema 真实入口为 `packages/desktop-contracts/src/design-scheme/schema.ts`;它定义 `draft/formal`、fidelity、source binding、inputs、parameters、constraints、prompt program、revision 和 compilation trace。旧本地持久化为 `packages/core/src/db/design-scheme/*`,包含 source/snapshot/file、scheme/revision/binding、asset、run/step、evaluation、market candidate、share package 表;主进程编排位于 `apps/desktop/electron/main/design-scheme/*`。
  - 当前 v2.5 已有 shared contracts、PG/SQLite scaffold、platform seam、Desktop 确定性成功 adapter、Web API/client 与 `packages/features` 共享屏；Web `/design-schemes` 列表/详情路由、Desktop v25 导航视图与 `?scheme=<id>` 生命周期已接线，但双宿主 capability 仍按完整运行闭环要求保持关闭。旧 renderer/legacy runtime 不能证明新壳成功运行路径。Desktop Agent 仅因 Automation/CLI/local MCP 存量兼容面记为 `partial`。
- **宿主模型裁决**:
  - 共享 features 未来只依赖 `packages/contracts` 的 path-free schema 与 `MusefoldGateway`;禁止直接依赖 Electron、Node、SQLite 句柄、userData 绝对路径或 `desktop-contracts` 本地 DTO。
  - Desktop adapter 继续调用保留的本地 design-scheme runtime/repository;Web adapter 后续调用 cloud-safe API、PG 和私有对象存储。两端共享实体、动作、状态与错误语义,transport 和持久化可以不同。
  - 当前 Web 与 v25 renderer 不伪造 capability、不显示死入口、不提供空实现冒充可用;只有 P01-1/2/3/4/5/6/7 各自有当前证据后才可按卡开启对应入口。拟用 `hasDesignSchemes` 表达未来能力,本卡不新增 flag。
  - Desktop Agent 是独立兼容面:Automation、CLI、local MCP 继续复用主进程真实 runtime;Agent 回归测试不能证明 Desktop renderer parity。Cloud Agent/MCP 与本地 Agent 不共享信任边界。
  - Cloud MCP/Cloud Agent 继续严格保持七个只读工具:`musefold_status`、`get_account_status`、`list_models`、`search_prompts`、`get_prompt`、`list_skills`、`get_skill`;不得读取本地方案、Provider、密钥、文件、路径,不得执行方案或任意 GitHub Skill,不得写 Prompt、创建/取消生成或调整预算/scope。
- **数据归属与 provenance 裁决**:

| 对象 | 当前/目标权威 | Desktop | Web | 同步/导出边界 |
|---|---|---|---|---|
| DesignScheme、Revision | 当前为独立 design-scheme SQLite;目标为共享 path-free 合同下分别由 local/cloud adapter 承载 | 本地离线可用 | 后续 cloud 副本,owner/version 由 P01-2/P01-5 定义 | 当前不自动跨账号/跨设备同步 |
| Source package/snapshot/file | Desktop 受管数据库与 userData 受管文件;Web 后续只保存 cloud-safe metadata/object key | 固定 ref/commit/hash,路径仅在本地边界 | API/对象存储引用 | 绝对路径、`file://` 不出本地边界 |
| Run/step/evaluation | Desktop 本地 design-scheme ledger;Web 后续云端 run ledger | `trial`/`formal` 状态和审计保留 | 后续由云服务执行/记录 | 不把本地运行伪装为云端已提交 |
| Asset/cover | Desktop 受管 store key/文件;Web 后续私有对象存储/signature URL | `media://` 只能由主进程受管根目录解析 | 仅返回签名 URL 或 path-free DTO | 不传绝对路径、API key、bearer token |
| Share package | 用户显式导出的私有文件,不是同步实体 | 仅 formal 可导出,导入生成新 draft/revision | Web 导入/导出由 P01-9 的 cloud-safe 方案另行定义 | 包内不得含 key/token/绝对路径 |
| market candidate | 本地短期候选缓存,不是方案事实源 | Explorer 只写候选缓存,确认后才创建方案 | 后续 cloud search cache 另定义 | 未确认不写入方案 |

  当前独立 design-scheme 库没有 `userId`/`workspaceId` 归属;登录、授权和同步开启是三个独立决定。本卡阶段不把已有本地方案自动绑定当前账号,不进入 `packages/db`,不进入 sync payload,不因登录触发 bootstrap/push。
- **领域状态与不变量**:方案用户状态只有 `draft`/`formal`,`trial`/`formal` 是 run mode;revision 不可变。formal 的 current revision 在 working draft 成功试运行并经用户显式 promote/formalize 前继续可用;来源 snapshot 固定 ref/commit/hash;删除采用软删并保留 run/evaluation/source 追溯;`unsupported` 来源不得运行;Agent 不能直接 formalize;`.musefold.design` 导入必须生成新 scheme/revision 且从 draft 开始。
- **四端矩阵**:
  - **Mobile Web**:`todo`。cloud contract 与 API/client adapter 已有(P01-5),`/design-schemes` route 未挂载;目标为同一 `packages/features` 屏幕的移动列表/详情/创建/运行形态,完成条件包含 cloud-safe API/PG、loading/error/empty/ready 与 approval/blocked 等状态、web-mobile 行为 E2E 和视觉快照。
  - **PC Web**:`todo`。contract、Web 持久化(PG)与 API/client adapter 已有,方案 route 未挂载;目标为同一 features 的桌面列表与 Inspector,完成条件包含 Web API/client/PG owner 隔离、web-desktop 行为 E2E 和视觉快照。
  - **Desktop renderer**:`todo`。旧版 renderer/IPC 仅作历史基线;目标为 v25 导航/薄宿主、typed IPC、本地 adapter/SQLite 和受管 `media://` 资产,完成条件包含真实 Electron IPC/SQLite E2E、macOS/Windows/Linux 实际差异记录和 Desktop 视觉快照。
  - **Desktop Agent**:`partial`。现有 Automation/CLI/local MCP 仍可访问部分本地方案能力,兼容回归继续复用主进程 runtime;目标是保留接口和安全边界,不与 Desktop renderer 合并,也不能替代三形态 UI 证据。Cloud Agent 对本地方案明确不可达。
- **六层触达与依赖**:
  - 六层目标走线为 `packages/contracts` 形状源 → `packages/platform` gateway/query/capability → `packages/features` 共享屏与状态 → Web `apps/api`/`packages/api-client`/`packages/db` → Desktop `ipc-v25`/preload/本地 runtime/SQLite → Web/Desktop 薄宿主与三端证据。本卡只定义边界,不消费这些实现层。
  - 子卡顺序为 `P01-0 → P01-1 → P01-2 → P01-3 → (P01-4/P01-5 并行) → P01-6 → P01-7 → P01-8/9/10/11/12 → P01-13`。其中 P01-4 与 P01-5 只能在 P01-1/2/3 契约、归属和 capability 稳定后并行;P01-13 是最终汇总门禁。
  - 本卡交付物为宿主/数据归属裁决、provenance 表、旧资产与现状清单、依赖 DAG、验收门禁、回滚边界和风险登记;P01-1 后续单独执行 shared contracts,不在本卡范围内打开其它实现层。
- **Capability、fallback 与状态矩阵**:
  - `hasDesignSchemes` 已由 P01-3 加入 `packages/platform`,当前 Desktop/Web 均为 `false`。在成功 adapter、features 和宿主入口未完成时保持无入口/无死路由,不得用 `isElectron`、UA 或路径字符串探测宿主;Desktop Agent 继续走现有本地兼容面。
  - 旧 `packages/domain/src/capabilities.ts` 仅作为 v2.1 存量 capability 目录的对照输入,不作为 v2.5 实现依赖,也不在本卡修改;P01-3 的新 flag 只允许进入 `packages/platform/src/capabilities.ts`,命名固定为 `hasDesignSchemes`,不与旧 `designSchemes` 并用。
  - 继承 `ui-parity/06-design-schemes.md §5.1` 状态矩阵:我的方案、发现/市场、Inspector、详情、试运行相册分别覆盖 loading/error/empty/ready;生命周期另覆盖 approval/pending、blocked、cancelled、failed、conflict/version mismatch。每个后续 UI 子卡必须补真实 testid、错误恢复和视觉状态证据。
  - Host Exception 按 v2.1 字段记录 `id/surface/capability/host/reason/fallback/dataBoundary/evidence/reviewTrigger`;“暂未实现”只进入交付状态,不能冒充永久例外理由。当前暂缓属于交付计划状态,不是 `HX-*` 平台例外。
- **安全边界**:
  - shared contract、renderer、sync、Cloud MCP、日志和导出包不得携带 API key、bearer/OAuth token、safeStorage 数据、本地绝对路径或 `file://` 资产链接。
  - 旧 local DTO 中的 `filePath`、`path`、`imagePath`、`coverImagePath`、`storeKey` 等字段不能原样提升为共享云合同;共享模型只能使用 path-free 标识/metadata,本地资源由主进程解析为受管 `media://`。
  - Provider key 和账号 bearer 只经 Desktop 主进程 `safeStorage` 或服务端;本地 Agent 的 loopback token 与 Cloud OAuth 不互通。GitHub reader 只读固定 ref/commit/tree/blob,不执行仓库脚本或安装命令。
  - 方案运行的本地 spend gate、用户确认、预算、取消和审计继续保留;Cloud Agent 输出不是授权,花费动作必须回到用户可见的 GenerationGateway。
- **P01-0 验收门禁与证据计划**:
  - 引用完整性:本卡所有源码、schema、旧版规范和测试路径可由当前仓库追溯;实际旧 schema 路径固定为 `packages/desktop-contracts/src/design-scheme/schema.ts`。
  - 裁决完整性:范围/非目标、宿主模型、数据归属/provenance、四端矩阵、六层触达、依赖、capability/fallback、状态矩阵、Owner/Reviewer、Difference、回滚和剩余风险齐全;P01 总卡仍为 `todo`。
  - 安全与冻结:当前无 renderer 入口;Cloud MCP 工具数量/名称/顺序/只读范围不变;宠物、豆包内部实现和旧 Agent runtime 无本卡实现 diff;不暴露凭据或本地路径。
  - 文档门禁:`git diff --check`、P01 stale-text/path scan、`V25-UI-SPEC §9` 差异引用检查;这些命令及结果必须由 B02 登记,不能以历史 prose 代替。
  - 只读回归:existing repository/orchestrator/Automation/CLI/local MCP tests 只证明兼容面,不生成图、不发送花费请求;任何 skip 记录原因和未覆盖范围。
- **回滚与剩余风险**:回滚仅限本卡文档与状态,不得删除或回滚 `electron/main/design-scheme`、Automation/CLI/MCP 或现有数据库。旧独立 design-scheme SQLite 是否最终并入 `desktop-db` 留给 P01-2/ADR;旧 local DTO 的路径字段不能复用;Web cloud copy 的 owner/version/sync/provenance 尚未实现;Automation 当前确认等待超时(当前约 120s)、local/Cloud 信任边界和 share/import 实现仍需后续卡验证。若后续审查发现归属冲突,先回退本卡裁决再继续 P01-2。
- **Owner/Reviewer**:GPT 负责宿主/数据裁决与证据整理;GLM 独立审查,本轮审查结论为无 P0/P1;Kimi 仅在后续 P01-6/7 负责共享 UI/renderer。P01-0 已完成架构裁决;P01-1 作为后续独立子卡执行,不因本卡完成而打开其它实现层。
- **Difference**:`N/A`(本卡仅做宿主/数据归属裁决,不改变 UI 或产品动作)。

### P01-1 共享 contracts

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **范围**:仅在 `packages/contracts` 建立 path-free design-scheme Zod schema、根 barrel export 和就地契约测试;不触达 `packages/platform`、API/PG、IPC/preload、features、宿主入口、SQLite/同步或旧 `packages/desktop-contracts`。
- **契约边界**:共享模型覆盖 scheme summary/detail、不可变 revision document、source binding/package/snapshot/file metadata、inputs/parameters/constraints/prompt program、compilation trace、asset/market、creation/run/evaluation/repair 生命周期、action input/result、分页/事件/结构化错误;所有公共对象 strict,本地路径/store key/绝对路径、凭据、owner/workspace 字段均拒绝。
- **状态与版本**:方案状态为 `draft/formal`,运行模式为 `trial/formal`,`unsupported` 保留但不可运行;document/format version 固定为 `1`;formal current revision 与 working draft、导入新 draft、运行计划 revision/policy/budget alias 一致性由 schema 表达,formal-only export 仍由 P01-9 host/service 权限执行。
- **来源与资产**:来源 URI 仅 HTTPS 且拒绝 credentials、签名/access key/token query/fragment;resolved ref/commit/hash 和仓库相对 evidence path 有界;asset origin 统一为 `repository | local-run`,不携带 `file://`、`media://` 或 Desktop `storeKey`。
- **证据边界**:`packages/contracts/src/__tests__/design-scheme.test.ts` 当前包含 path-free round-trip、strict unknown/owner/workspace、路径/URI/敏感字段、状态/版本/unsupported、run plan 与 import draft 等测试。它只证明 schema boundary,不证明 host authorization、PG runtime、Desktop 完整 adapter(run/Agent 编译/事件)或 renderer parity。精确计数和命令由 B02 当前 report 登记。
- **独立审查**:上一轮 Git SHA、深度/签名/compiledPrompt 与 revision alias 问题已有对应 working-tree 修复记录;formal-only export、owner/version 持久化和 host authorization 归 P01-2/P01-5/P01-9。
- **全局门禁**:根 `pnpm run check` 已在当前工作树复现通过;本卡独立 report/artifact、真实 PG/renderer consumer 和完整跨宿主证据仍未登记,不得把 check 通过扩大解释为 P01-1 或全仓 parity 完成。
- **平台矩阵**:Mobile Web:`todo`;PC Web:`todo`;Desktop renderer:`todo`;Desktop Agent:`partial`(仅保留旧 Automation/CLI/local MCP 兼容面,不能替代 shared contracts 或 renderer 证据)。
- **Difference**:`N/A`(本卡建立安全共享契约,不打开任何新入口或改变当前产品 UI)。
### P01-2 SQLite/PG 数据策略

- **状态**:`verify`。
- **决策日期**:`2026-08-29`。
- **卡片性质**:本卡只收口设计方案域的本地 SQLite 迁移纪律、云端 PG 归属/表形状和数据保留不变量;不打开 gateway、IPC、API route、features、renderer 入口或同步传输。
- **审计结论**:
  - 当前 Desktop 方案 runtime 的事实源继续是独立 `packages/core/src/db/design-scheme/*` SQLite。它不是 `packages/desktop-db` legacy 接管库的一部分,不做未经定义的合并、复制或登录触发迁移。
  - `packages/desktop-db` 继续只承载 v2.5 桌面公共账本;本卡不把 design-scheme 表塞入该库。未来若要合并,必须另开 ADR,完成 adapter、备份、replay、回退和真实旧库等价证据后再做。
  - `packages/db` 新增的是未来 Web/cloud adapter 使用的 cloud-safe 设计方案副本,不是本地库镜像。所有云表由服务端认证上下文派生 `user_id`,不接受 renderer/client 的 `ownerId`/`workspaceId`。
- **本地 SQLite 策略**:
  - 继续使用独立 namespace、`user_version` 顺序迁移、每版事务和 `foreign_keys = ON`/WAL/busy timeout;迁移只作用于 disposable 测试库或应用启动时打开的方案库,不触碰 `desktop-db` takeover 链。
  - 新增本地 scheme `version` 作为乐观锁;带 expected version 的写入必须使用条件 UPDATE 并在 0 行时返回版本冲突,revision 仍不可变。既有调用暂时可省略 expected version,由后续 gateway/IPC 接入强制传入。
  - scheme 软删只写 `deleted_at`;revision、source snapshot/file metadata、run、step、evaluation、asset 和本地分享索引继续保留 provenance。中断中的 planning/executing/evaluating run 在下次启动收敛为 failed,不得自动重跑或产生花费。
  - `source_files.path`、`source_files.store_key`、asset `store_key`、share package `path` 仅限 Desktop local adapter;不进入 shared contracts、Web DTO、PG JSON、sync payload 或 Cloud Agent 结果。
- **PG cloud-safe 映射**:
  - 新增 `design_schemes`、`design_scheme_revisions`、`design_scheme_source_packages`、`design_scheme_source_snapshots`、`design_scheme_source_files`、`design_scheme_source_bindings`、`design_scheme_assets`、`design_scheme_runs`、`design_scheme_run_steps`、`design_scheme_evaluations`。
  - scheme 带 `user_id`,`version`,软删和 current/working revision 指针;revision 追加不可变并保存 path-free document JSON;source 只保存 HTTPS/ref/commit/hash/相对 metadata;asset 只保存 cloud object reference 与媒体元数据;run/step/evaluation 带 owner、policy/provider/result provenance。
  - PG 表之间的写入必须由后续 API service 在同一 owner scope 内完成,写入 JSON 前重新经过 `packages/contracts` schema;数据库 schema 通过 `(entity_id, user_id)` 复合唯一键与复合 FK 强制子表 owner 与父表一致,不能只依赖 service 过滤。数据库 schema 不把本地 path/store key 当作云字段。current revision、working draft、formal/cover/trial 前提由 service transaction 校验并由 targeted tests 守护。
  - 本地 GitHub source package ID (`pkg_${sha256(repositoryUrl).slice(0,24)}`) 只在独立 SQLite namespace 内稳定;cloud adapter 必须生成新的 owner-scoped package ID,不得把本地确定性 ID 当作 PG 全局 ID 或用跨用户 `ON CONFLICT` 复用。
  - market candidate 仍是短期搜索缓存,不建 PG 事实表;share package 仍是用户显式导出的私有文件索引,不做同步实体。未来 Web 导入/导出另由 P01-9 定义 cloud-safe 对象存储与授权。
- **同步/保留边界**:P01-2 不启用本地方案自动同步,不因登录 bootstrap/push,不建立 local-to-cloud 双写。未来 cloud copy 必须有独立创建/导入动作、服务端 owner、revision provenance 和明确冲突策略;本地删除不会伪造云端删除。
- **四端矩阵**:
  - **Mobile Web**:`todo`;本卡只提供未来 cloud-safe PG 表形状,不提供 route、query 或网络请求。
  - **PC Web**:`todo`;同上,不得把 PG schema 误报为 Web 功能已接入。
  - **Desktop renderer**:`todo`;本地 schema/repository 继续可被旧 Agent runtime 使用,但 v25 renderer/IPC 不在本卡打开。
  - **Desktop Agent**:`partial`;现有 Automation/CLI/local MCP 继续复用本地 repository,兼容语义保持;不以 Agent 证据替代三形态 renderer 证据。
- **验收与证据计划**:
  - SQLite disposable migration replay:空库全链、v4→最新增量、重复执行 noop、失败事务回滚、namespace/schema version/foreign key 校验。
  - SQLite data semantics:expected version 条件更新与冲突、formal current revision/working draft 不变量、软删后 run/evaluation/source/asset/share retention、中断 run 恢复为 failed、market cache/share index 非同步边界。
  - PG schema/migration replay:所有新表均有 user FK、owner-scoped index、版本/软删字段、path-free JSON 约束说明;迁移目录与 Drizzle schema 同步。若运行真 PG integration,只使用 Testcontainers disposable PostgreSQL,不使用用户或线上数据库。
  - 定向门禁:design-scheme/core tests、`@musefold/db` schema tests/typecheck、受影响文件 Biome、`git diff --check`、`pnpm run check:boundaries`;根级 check 若仍被既有全仓 lint 阻断必须原样记录。
- **非目标与回滚**:不改 `packages/desktop-db` takeover baseline、不迁移真实用户数据库、不新增同步/API/IPC/导航、不删除旧表或旧 Agent runtime。回滚仅限本卡新增 PG schema/migration、本地 scheme migration/repository 版本保护、定向测试和文档;已有方案库通过迁移前备份恢复。
- **Owner/Reviewer**:GPT 负责 schema/迁移/repository/test;GLM 独立审查 owner 隔离、并发、保留、路径边界和迁移回退;Kimi 不参与本卡 renderer 实现。
- **Difference**:`N/A`(本卡不改变当前 UI;只建立后续 parity 所需的数据接缝和安全边界)。

### P01-3 platform gateway/query/capability

- **状态**:`verify`。
- **决策日期**:`2026-08-31`。
- **卡片性质**:本卡只建立共享 `MusefoldGateway` 的 design-scheme 可选域、查询 key 和 capability/fallback 合同;不实现 Desktop IPC、本地 adapter、Web API/PG consumer、features、导航、路由或任何新入口。
- **目标**:让后续 P01-4/P01-5/P01-6 使用同一组 path-free contract 类型、方法名和缓存分区,宿主是否已接入由 `PlatformCapabilities.hasDesignSchemes` 唯一表达。
- **网关方法**:覆盖当前 `packages/contracts` 已定义的 list/detail（detail 携带 revision/assets/sources）、create/update/modify/run/cancel、cover/formalize/rename/remove、upstream check、market search、share import/export 与事件订阅;当前 contracts 未定义独立 promote 方法,不在本卡另造平行接口。方法参数/结果全部复用 contracts 的 `z.input`/`z.output` 推导类型,不复制旧 `AppResult`、绝对路径 DTO 或凭据字段。
- **Capability/fallback**:`hasDesignSchemes` 是唯一开关;当前 Desktop/Web 均为 `false`,因为本卡没有 adapter。`designSchemes` gateway 保持 optional;需要访问时必须经过 typed capability guard,缺失时抛稳定 `CAPABILITY_UNAVAILABLE` 错误,不得用 UA、`isElectron`、URL 路径或空对象冒充可用。
- **Query keys**:使用 `design-schemes` 根前缀,分区 `list/detail/market-search`;list/search query 对象原样作为 key segment,不同 query 不得互相覆盖,所有 scheme invalidation 以根 key 为前缀。
- **平台矩阵**:
  - **Mobile Web**:`todo`;只登记 capability=false/fallback,不新增 route 或网络请求。
  - **PC Web**:`todo`;同 Mobile Web。
  - **Desktop renderer**:`todo`;只保留未来 IPC adapter 接缝,不触达 `ipc-v25`/preload。
  - **Desktop Agent**:`partial`;继续走旧 Automation/CLI/local MCP,不消费本接口,不以 Agent 证据替代 renderer。
- **验收与证据**:platform tests 覆盖 capability 常量、optional gateway、guard 成功/缺失、稳定错误码、query key 分区/前缀。当前 capability 仍为 false,所以这些是 seam/fallback evidence,不是可用功能。精确测试数、typecheck/Biome/boundary 输出由 B02 当前 report 登记。
- **依赖/交接**:P01-4/P01-5 只能在本卡完成后分别实现 Desktop/Web adapter,并将 `hasDesignSchemes` 改为真实可用状态;P01-6 才能消费 `useGateway().designSchemes` 并实现 loading/error/empty/ready UI。
- **Difference**:`N/A`(只新增未启用的数据接缝,不改变当前 UI)。

### P01-4 Desktop v25 IPC

- **状态**:`doing`。
- **决策日期**:`2026-08-31`。
- **卡片性质**:本卡把 design-scheme 的 Desktop transport 接入 v25 单通道,并建立主进程到 renderer 的 path-free adapter 边界;不实现 Web API/PG consumer、共享 features、导航/入口或把旧 Automation/CLI/MCP 面迁入 v25。
- **审计结论**:现有桥固定为 `musefold:invoke` → `ipc-v25/gateway-bridge.ts` 方法表 → `preload/v25.ts` 纯转发 → `src/v25/desktop-gateway.ts` typed response parse。design-scheme 旧 runtime 继续位于 `electron/main/design-scheme/*` 与独立 `getDesignSchemeDb()` SQLite;不能复活旧 `window.api.designScheme` 多通道,不能把 `resolveActiveWorkspace(getDb())` 误用于该独立数据库。
- **Owner policy**:本卡明确采用 machine-local policy:独立 design-scheme SQLite 不声明账号/工作区隔离,不接受 renderer 的 `ownerId`/`workspaceId`,不因登录/切换账号自动绑定或同步;任何需要账号归属的 cloud/跨账号语义留给 P01-5/P01-10 的明确 owner migration。若宿主尚未能证明该策略,方法必须返回结构化 `CAPABILITY_UNAVAILABLE`/`DESIGN_SCHEME_UNAVAILABLE`,不得静默暴露数据。
- **方法表**:部署 `designSchemes.*` 16 个方法:`list/get/searchMarket/create/update/modify/cancel/selectCover/formalize/promoteWorkingDraft/rename/remove/checkUpdate/importPackage/exportPackage/run`;每项在主进程用对应 contracts input schema 校验,再进入 domain facade。`confirmInstall` 与 `prepareImportPackage` 是独立的可选宿主生命周期接缝，不进入当前部署方法表；legacy local requestTemplate 不得用平行 DTO 偷渡。
- **错误与安全**:业务失败统一 `BridgeError(code,message)` 信封;legacy `AppResult`/异常先映射到稳定错误码,unexpected error 不得把绝对路径、store key、provider/key 细节或堆栈返回 renderer。主进程可在受管根目录内使用本地路径,返回值、事件和错误只允许 canonical path-free schema;renderer 输入的 owner/workspace/path/store-key/credential 字段必须在 bridge 层拒绝。
- **Preload/event**:preload 继续只转发 `invoke`;新增受控 design-scheme event listener 时仅面向 v25 主窗口,保持 listener identity/unsubscribe,不触达宠物 preload/window。事件 payload 由 renderer gateway 用 `designSchemeEventSchema` parse 后才交给订阅者;畸形事件安全丢弃或映射结构化错误,不穿透。
- **Desktop gateway**:`createDesktopGateway()` 增加可选 `designSchemes` adapter,15 个方法逐一固定 IPC 名称和 response schema;缺少 v25 bridge 时继续 `BRIDGE_MISSING`,结构化失败映射 `DesktopGatewayError`,成功数据再次通过 contracts schema parse。只有 adapter 与 `DESKTOP_CAPABILITIES.hasDesignSchemes` 同时真实可用时,后续卡才可打开 capability;本卡不以空对象或死 route 冒充可用。
- **当前实现状态**:`partial success adapter, capability closed`。部署方法表已扩展为 16 项（含 `promoteWorkingDraft`），`list/get/searchMarket/create(document)/update/selectCover/formalize/promoteWorkingDraft/rename/remove/checkUpdate(no-change)` 已有 machine-local SQLite 成功路径和 legacy↔canonical 映射；`importPackage/exportPackage` 已接线 `.musefold.design` 安全 staging/archive(`package-staging`/`package-archive`/`package-host` + 保存对话框,导入新 draft/仅 formal 导出)；本轮另接通 owner-safe 历史来源：只接受指定成功且未软删 run 下的 available asset，经受管根校验复制，从 generation ledger immutable prompt snapshot 读取 prompt，并在 domain/source-ingestion 失败时清理 snapshot/package/files。仍返回结构化 blocker 的是 `create` 的 Agent 编译、`modify/run/cancel`、有变化时的 update recompile 与 main-side event producer(通道与 parse 已有,无 producer)。`hasDesignSchemes` 继续为 false，不能把确定性 CRUD/staging 或本地历史来源闭环扩大解释成 Desktop 产品闭环。
- **当前 evidence**(2026-09-01,本地 `vitest run apps/desktop/electron/main/design-scheme apps/desktop/electron/main/ipc-v25/__tests__/design-scheme-domain.test.ts apps/desktop/src/v25/__tests__/design-scheme-gateway.test.ts`,14 文件 154 用例全绿):design-scheme-domain(40) + fixed-run-plan(22) + source-ingestion(12) + share(12) + design-scheme-gateway(11) = 97 项聚焦 lifecycle/transport 用例,另含 package-staging(5)/package-host(6)/package-archive(4) 与 run-session/modify-session/orchestrator/evaluation 等单元用例;覆盖严格方法集、成功 CRUD 映射、working-draft selector、乐观锁、错误脱敏、`.musefold.design` 导入导出与 event listener lifecycle。同日新增 owner-safe 历史来源定向闭环：contracts、source-ingestion、design-scheme-domain 3 个文件共 87 tests passed，覆盖成功 run/available asset、跨 run/失败或软删 run/不可用资产、受管根与 renderer prompt 注入拒绝、macOS 路径别名、复制或落库失败后的 snapshot/package/files 回滚。`tsc -b`、Desktop `electron-vite build` 与根 `pnpm run check` 通过。真实 Electron E2E、Agent/run/cancel、媒体解析和 capability 开启仍待完成。
- **平台矩阵**:
  - **Mobile Web**:`N/A`;本卡仅 Desktop IPC。
  - **PC Web**:`N/A`;由 P01-5 实现 HTTP/client。
  - **Desktop renderer**:`todo`;本卡完成 transport seam 后仍不打开导航/feature 入口,待 P01-6/P01-7。
  - **Desktop Agent**:`partial`;继续走旧 Automation/CLI/local MCP,不消费 v25 gateway,不以 Agent 证据替代 renderer。
- **验收与证据**:先证明 fixed wire contract 与 fail-closed 行为:exact method set/no legacy names/strict validation/redacted envelope;preload event listener identity/unsubscribe;desktop gateway exact payload/response/malformed response/missing bridge。成功 legacy mapping 要求另加 repository/domain adapter tests,不能由 unavailable handler 测试替代。真实 Electron E2E 需 build 后运行,不使用真实 relay generation/花费额度。
- **依赖/交接**:本卡完成后 P01-5 可复用 canonical method names independently实现 Web adapter;P01-6/P01-7 只能在 Desktop adapter 的 capability/错误/事件边界和真实 Electron evidence 稳定后消费 `designSchemes`;P01-9/P01-10 负责把 explicit unsupported seams 替换为完整 lifecycle,不得绕过本卡直接暴露旧 DTO。
- **风险登记**:独立 SQLite 无 owner 隔离、canonical contracts 缺 install-confirmation/run requestTemplate/package staging 表达、旧错误和结果含本地路径、event shape 与 canonical union 可能漂移、长任务需 shutdown/account-change cleanup。所有风险在后续卡关闭前不得标记为已迁移。
- **Difference**:`N/A`(仅新增未启用的 Desktop transport seam,不改变当前 UI 或产品入口)。

| 子卡 | Owner | Reviewer | 依赖 | Mobile Web | PC Web | Desktop | Desktop Agent | 当前状态 / evidence |
|---|---|---|---|---|---|---|---|---|
| P01-0 宿主模型与数据归属 | GPT | GLM | — | todo | todo | todo | partial | `verify`;架构裁决、provenance 表、旧资产盘点和 fail-closed 边界已记录;只读回归只能证明 legacy/Agent 兼容面,不打开入口 |
| P01-1 共享 contracts | GPT | GLM | P01-0 | todo | todo | todo | partial | `verify` slice;`packages/contracts/src/design-scheme.ts` 与就地 schema tests 证明 path-free/strict 状态合同;不证明授权、PG、IPC 成功或 renderer parity |
| P01-2 SQLite/PG 数据策略 | GPT | GLM | P01-0,P01-1 | todo | todo | todo | partial | `verify` scaffold;SQLite v1→v5 migration/repository/recovery tests 与 PG cloud schema 存在;API/client consumer 已由 P01-5 接入,真 PG runtime、真实 v2.1 语料/备份演练仍缺 |
| P01-3 platform gateway/query/capability | GPT | GLM | P01-1,P01-2 | todo | todo | todo | partial | `verify` seam;`hasDesignSchemes=false`、optional gateway、query partitions、`CAPABILITY_UNAVAILABLE` 有定向测试;不代表 capability 可用 |
| P01-4 Desktop v25 IPC | GPT | GLM | P01-1,P01-3 | N/A | N/A | doing | partial | 16 项部署方法的 transport、确定性 SQLite CRUD、`.musefold.design` staging/archive/domain 导入导出与 owner-safe 历史来源复制已接线并有定向测试（既有 97 项聚焦 lifecycle/transport 用例；本轮 contracts/source-ingestion/domain 3 个文件新增闭环共 87 tests passed；另有 typecheck/build/check 证据）；Agent create/modify、run/cancel、recompile、事件 producer、媒体与真实 E2E 仍是 blocker，capability 关闭 |
| P01-5 Web API/client/PG | GPT | GLM | P01-1,P01-2,P01-3 | doing | doing | N/A | N/A | owner-scoped PG schema、17 条 API routes 与 api-client adapter 已接入；确定性 CRUD/working-draft selector 可用，Agent create/run/cancel/market/package/assets 仍以结构化 501 fail-closed |
| P01-6 共享 schemes features | Kimi | GLM | P01-3,P01-4,P01-5 | doing | doing | doing | N/A | `packages/features/src/design-schemes` 已含列表/详情/来源/相册/版本/跨屏 integration；formal=current、trial/modify=exact working draft 已有回归测试；新增可选详情生命周期回调，覆盖从列表打开、详情返回和详情删除成功通知宿主；正式方案详情已补齐常驻 `runtime-scheme-modify`「在 Composer 中修改」按钮，缺少宿主接缝时禁用并解释且保留下拉菜单补充动作；SchemeAlbum 已补齐左右方向键环绕、横向触控滑动与短滑/纵向滑动忽略，滑动后不会误开 Lightbox；features 定向测试 23 个文件、286 个测试通过；完整宿主闭环与 E2E 未完成 |
| P01-7 三端薄宿主入口 | Kimi | GLM | P01-6 | doing | doing | doing | N/A | Web `/design-schemes` route 与 Desktop v25 view/nav 已挂载并消费 `?scheme=<id>`；列表打开详情用 `push`，详情返回/删除用 `replace` 清理 query，非法 scheme 参数 fail-closed，Web host 定向 22 tests 通过；双宿主 `hasDesignSchemes` 仍按完整 Web/Electron lifecycle 要求保持关闭，完整运行闭环可用后再开启 |
| P01-8 跨屏 ScreenIntent | GPT+Kimi | GLM | P01-6,P01-7 | partial | partial | partial | partial | Prompt/History/Schemes→Workbench 的 zustand 一次性 intent 与附件语义已接入；宿主未传 `onSubmit`，scheme-surface deep link 和真实端到端 trace 仍缺 |
| P01-9 来源与分享包管线 | GPT | GLM | P01-1,P01-2,P01-5,P01-6 | todo | todo | doing | partial | GitHub/历史来源与 legacy share runtime 保留；Desktop `.musefold.design` secure staging/archive 已接入 domain `importPackage/exportPackage` 并有聚焦测试(E2E/capability 未验收)，Web package staging 仍 fail-closed，通用分享/导入仍归 P03 |
| P01-10 完整生命周期编排 | GPT | GLM | P01-4,P01-5,P01-6,P01-9 | todo | todo | doing | partial | deterministic lifecycle、working-draft promotion 与 revision selector 已完成；Agent create/modify/recompile、run/cancel/event/result mapping 尚未完成 |
| P01-11 Automation confirmation/spend | GPT | GLM | P01-4,P01-7,P01-10 | N/A | N/A | todo | partial | v25 confirmation UI 缺;当前外部花费请求约 120s 后 timeout;预算/审计/取消需独立 evidence |
| P01-12 Agent 兼容回归与 Cloud MCP 边界 | GPT | GLM | P01-10,P01-11 | N/A | N/A | N/A | partial | local Automation/CLI/MCP 兼容面与 Cloud 七工具 manifest 分开验收;缺远程客户端、revoke、禁止能力负例汇总 |
| P01-13 三形态与安全证据 | 主代理 | GLM | P01-7..P01-12 | todo | todo | todo | partial | Web desktop/mobile、Electron、Agent/MCP、视觉、source/asar/package secret/path scan 全量收口卡 |
| B01-R bridge 方法表修复 | GPT | GLM | B01,P01-4 | N/A | N/A | doing | N/A | 修复手写 `ALL_METHODS` 与 `buildMethods()` 漂移,建立 method-name 单源/双向断言,补 15 项 gateway/preload tests |
| U03-spend 费用与审批 | GPT+Kimi | GLM | U03,D01 | partial | partial | todo | partial | `pending_approval`/quota 402/兑换重试/确认/拒绝/超时/审计矩阵;Cloud Agent 不提供 spend tool |
| U01-onboarding 首启引导 | Kimi | GLM | U01,U05 | todo | todo | todo | partial | baseline onboarding 有实现,当前 v25 无完整可达三轨引导;完成哨兵和重启语义待建 |



### P02 Skill runtime、历史来源、素材与微调

- **状态**:`todo`
- **范围**:固定 commit/hash 的本地 GitHub Skill、Skill 运行对话、历史来源、通用素材 Dock、微调目标/父子谱系、Composer 工作模式与 `/` 指令。Prompt 引用已在 U03 收口,本卡不得重复实现或退回客户端权威文本。
- **安全**:不执行 Skill 脚本;本地 Skill 不进入 Cloud OAuth;Cloud 只读官方 registry;费用动作仍经可见 GenerationGateway。
- **验收**:版本/hash/输入/最终 prompt 快照进入 ledger;恶意 Skill 无文件/网络/密钥/提权能力;运行和历史可解释。

### P03 分享/导入、Automation 与 Cloud MCP 控制面

- **状态**:`todo`
- **范围**:
  - 导出/导入包:范围、校验、预览、内容指纹去重、跳过策略、全局 Query invalidation;不含密钥。
  - 本地 Automation:开关、令牌掩码/复制/轮换、预算、确认卡、审计、接入向导、Skill 安装状态。`AutomationConfirmCard` 与 `automation:confirmationRequired/Resolved` v25 监听为 P1 安全阻断:当前 server 可启用但新壳无确认 UI,外部花费动作会等待 120s 后拒绝。
  - Cloud MCP:已连接应用、scope/grant、撤销;七工具只读白名单不扩大。
  - 命令面板:只注册真实可执行命令。
- **触达**:contracts/platform 可选域、features/settings/shell、system/import/export、automation、api OAuth/MCP、双宿主文件能力。
- **验收**:旧 token 轮换后即时失效;撤销 grant 后 401;导出扫描无 key/token/path;Agent 无生成/花费工具。

## 6. 冻结面与入口

### X01 豆包入口保留、宠物冻结

- **状态**:`partial`
- **宠物**:`frozen`。禁止修改 `apps/desktop/src/pet*`、pet preload、`electron/main/pet/` 及其语义;只跑既有测试。
- **豆包**:内部实现 `frozen`;v2.5 保留一个可见入口,点击交给既有豆包窗口/登录控制面。Web 不伪造豆包本地能力,提供明确不可用说明或不展示。
- **允许触达**:v25 capability/adapter/入口及其测试;不触达 doubao-web 算法、登录同步和迁移。
- **验收**:入口可达;冻结实现 diff 为 0;Provider/账号/密钥不泄漏;pet 专用 preload 暴露面不变。

## 7. 反向审计与交付

### Q01 旧测试反向映射与遗漏扫描

- **状态**:`todo`
- **动作**:枚举 `v2.5-baseline` 和当前树的测试/fixture/E2E,把每个旧用户意图映射到 B02 evidence id;标记直接覆盖、间接覆盖、route mock、runtime-e2e、存在但 CI skip、环境 blocked、frozen 或不适用。
- **重点**:bridge/preload/account domain;API-client 全方法;capability 全字段;keychain;sync/owner;purge/Lightbox/saveAsset/reference/retry/cancel;设置分区;迁移 replay;Cloud MCP/Skill 禁止能力。
- **同步专项**:保留 `unset/enabled/paused/conflict`、zero transport、首次顺序、paused mutation+usage、逐条 conflict resolution(含 duplicate)、logout/relogin preservation 和 secret scan 的行为证据。四态截图若仍在 `.results`，只能登记为“临时附件/不可复现”,不得写“已人工检查”。
- **验收**:不存在“有入口但无逆操作/错误/空态/刷新测试”;不存在被删除测试或 snapshot 替换造成的假绿;每个 `test.skip` 都有产品边界或环境原因。

### Q02 本地全量门禁与真实产物

- **状态**:`todo`
- **门禁**:
  - `pnpm run check`
  - `pnpm --filter @musefold/api run test:integration`(显式 `RUN_DATABASE_TESTS=true`)
  - PG/SQLite migration replay、`pnpm --filter @musefold/desktop-db run db:bundle` 与 bundle freshness diff
  - `pnpm run test:e2e`、Electron project
  - 对应平台真实 package-smoke,缺产物/错误平台产物不得 skip
- **视觉**:固定时间、mask 动态值、保留成功 run artifact;人工检查仅作辅助,不能替代 `toHaveScreenshot`/持久 baseline。
- **同步证据边界**:现有 Electron sync spec 使用本地 mock server 和临时 userData;行为可作为定向 evidence,不等于生产云端、跨设备或持久视觉通过。

### Q03 CI/CD 等价门禁

- **状态**:`todo`
- **现状缺口**:PR 使用 `turbo ... --affected`;PR/Main/Release 均未显式设置 `RUN_DATABASE_TESTS=true`,未锁 migration replay/`desktop-db db:bundle` freshness;Web E2E 使用 Next dev server;package-smoke 缺产物时 `test.skip`,且 spec 可能选择错误平台产物;没有独立 source/path/secret/asar/release artifact scan。
- **子卡**:
  - **Q03-pg-replay**:`todo`。PR/Main 显式 Testcontainers/PG service,跑 fresh 0000→latest、upgrade replay、owner/version/document identity 拒绝和 migration journal 校验;失败直接阻断。
  - **Q03-db-bundle**:`todo`。每次 desktop-db migration 后执行 `db:bundle`,以 `git diff --exit-code` 或等价 hash 检查 `migrations.generated.ts` 新鲜度,并在打包 smoke 中确认 asar 使用内联迁移。
  - **Q03-package-smoke**:`todo`。由 workflow 将目标 artifact 路径/平台传给 spec;macOS、Windows x64/arm64 分别启动自身产物;缺产物、错误平台或 skip 直接失败,禁止 macOS artifact 掩盖 Windows。
  - **Q03-e2e-runtime**:`todo`。确认 Release verify 与 package jobs 都跑新 build 后的 Web/Electron E2E;Web production/standalone runtime 与 dev-server evidence 分开登记;`reuseExistingServer` 在 CI 禁止复用旧 3399。
  - **Q03-security**:`todo`。加入 source/userData/backup/export/asar/DMG/Windows unpacked 的 secret/path scan,并扫描日志、MCP response、HTTP body;不记录凭据、Prompt 正文或绝对路径。
  - **Q03-full-gate**:`todo`。明确 PR affected 与 Main/Release full gate 的差异,并把 PG、worker runtime、migration、bundle、package-smoke、安全扫描的必跑关系写入 workflow。
- **发布边界**:工作流和 CI 验证可以落地;tag、站点发布、更新 feed 和生产部署须另行明确授权。

### V01 视觉 evidence 持久化与环境政策

- **状态**:`todo`
- **范围**:把同步四态、明暗主题和各端快照纳入可复现 baseline 或成功/失败都上传的 evidence artifact;统一 fixed clock、mask、viewport、OS、字体和 snapshot ownership。
- **现状**:同步截图通过 `testInfo.outputPath()` 写入 gitignored `.results`,当前 workflow 失败才上传;`toHaveScreenshot` 没有为四态建立 committed baseline。Playwright `reuseExistingServer: true` 可能复用陈旧 3399。
- **验收**:四态行为与截图可在指定 commit/命令重现;CI 不能静默 skip;视觉差异、环境 blocked 和失败附件都可追溯;不把人工目测或临时附件写成完成证据。

## 8. 当前批次

端侧列是实现状态汇总,不是规范替代。`N/A` 必须有语义理由;Desktop Agent 兼容证据单独记录,不能替代 Desktop renderer。

| 卡 | Owner | Reviewer | Mobile Web | PC Web | Desktop | Desktop Agent | 总状态 | 当前证据 |
|---|---|---|---|---|---|---|---|---|
| B00 | 主代理 | — | verify | verify | verify | N/A | verify | 当前树 `pnpm run check` 已通过（179 个测试文件、1282 个测试、35 个 Turbo task）;最新完整 v25 E2E 为 97 passed、1 failed、5 skipped，唯一失败是原生 macOS fullscreen 的 runner 前台焦点阻断；Prompt 9 个用例与移动 Workbench 完成态视觉基线均通过;无 durable report/artifact 绑定,仍不能登记为 done/pass;同步截图中 gitignored 临时附件也不替代 durable baseline |
| B01 | GPT | GLM | partial | partial | verify | partial | verify | 既有公共域 gateway/IPC mapping 与 canonical method set 有当前定向测试;B01-R 的 15 项 designSchemes fail-closed、全域异常脱敏、malformed envelope 和 preload event lifecycle 已通过定向验证;Web/真实 Electron/全量门禁仍由 B02/Q02 登记 |
| D01-generation | GPT | GLM | N/A | partial | partial | partial | partial | generation ledger、API 幂等/取消和 worker lease/epoch 有定向证据;worker 主要为 fake dependency,真 PG/Graphile Worker、外部 Provider、重启/reconcile 与跨端成功路径仍待 |
| D01-sync | GPT | GLM | partial | partial | partial | partial | partial | consent 四态、显式 workspace/adopt、zero transport、首轮顺序、paused mutation/usage、逐条 local/remote/duplicate、logout/relogin preservation、secret scan 已有定向证据;Prompt/Folder/Tag 目录 CRUD 已修复 workspace 作用域;跨 owner seed、usage/version/max merge、两设备/revoke/cursor expiry 与真云端仍待 |
| U01-fullscreen-inset | GPT+Kimi | GLM | N/A | N/A | blocked | N/A | blocked | 代码接线、定向单测和 build 已有 evidence;真实 macOS fullscreen E2E 被当前 runner 的 Electron 前台焦点环境阻断,必须在具备 WindowServer 前台激活资格的 runner 重跑,不能以 `verify` 或 skip 代替 |
| U03-session/prompt | GPT+Kimi | GLM | partial | partial | partial | N/A | partial | 会话、比例与 Prompt 引用主路径已有定向证据;Web 主要为 route mock,Electron 为 disposable SQLite/失败路径,多图保存、费用审批、移动键盘与稳定全端视觉 evidence 仍缺 |
| U02-prompt-dirty-guard | Kimi | GLM | verify | verify | verify | N/A | verify | ShadCN Dialog/AlertDialog 关闭防护及 Escape/X/外点拦截已有定向行为证据;历史计数未绑定当前 report,完整提示词库 parity、真 API/PG 和视觉基线仍由 U02/B02 收口 |
| U05-account-confirm-password | Kimi | GLM | verify | verify | verify | N/A | verify | ShadCN Input/Label 确认密码与失配 Enter 零请求、匹配 payload 边界已有定向证据;历史计数未绑定当前 report,完整账号/连接/设置 parity 仍属 U05/S01 |
| P01-0..P01-13 设计方案 | GPT/Kimi | GLM | doing | doing | doing | partial | doing | contracts、SQLite/PG、Desktop/API/client adapters、shared features 和 working-draft 语义已有定向证据；Desktop `.musefold.design` staging/archive/domain 导入导出已接线(97 项聚焦 lifecycle/transport 用例 + 定向 typecheck/build,见 P01-4)；双宿主 capability 仍关闭，Desktop Agent 编译/modify/run/event 与真实 E2E、Web run/assets/package、三端入口尚未闭环 |
| 其余 | 待领取 | GPT/GLM/Kimi | todo/partial | todo/partial | todo/partial | todo/partial | todo/partial | 按平台矩阵补齐,不把单端证据扩大解释成全功能完成 |
