# v2.1 → v2.5 迁移验证手册与结果台账

> 更新日期：2026-09-09。最新B57共享创建授权/原任务恢复与首败、门禁见§5.51；实际服务产品合流和完整D4仍待验。整包未闭合，管理员未启动。
>
> 先读 [迁移路线图](./V25-MIGRATION-ROADMAP.md)，按 [goal 任务拆解](./V25-MIGRATION-GOALS.md) 选任务，再用本文执行验证。旧卡号及完成定义仍见 [迁移卡](./V25-MIGRATION-CARDS.md)，行为基准见 [UI 规范](./V25-UI-SPEC.md)，数据基准见 [数据迁移文档](./V25-DATA-MIGRATION.md)。

> B9–B57 的开发与准备实绩统一记入[开发记录](./V25-DEVELOPMENT-LOG.md)，安全扫描详见[安全验证](./V25-SECURITY-VALIDATION.md)。本文保留历史测试与流程；后续实际结果不由 B8 数字推算。

## 1. 如何判断“测试通过”

### 1.1 证据等级与映射

每条结论必须同时记录：被证明的行为、真实组件、替身组件、平台、执行版本、命令、日期、报告和跳过原因。级别没有自动继承关系，例如通过生产登录不代表生产生图通过。

| 本文层级 | 能证明什么 | 不能外推什么 | 现有 manifest 的 `level` |
|---|---|---|---|
| `source` | 源码、路由、迁移、配置或 workflow 存在；接口显式 501 或能力门控 | 功能运行成功、消费方一致、配置已部署 | `source` |
| `unit` | schema、状态转移、mapper、权限判断、失败分支；使用 fake gateway 的组件测试 | 真 PG、真 Electron、真实上游费用或生产构建运行 | `unit` |
| `mock-e2e` | 浏览器中指定视口的动作、状态、布局及快照 | 被 route mock 替代的 API、Worker、数据库和对象存储 | `mock-e2e` |
| `runtime-e2e` | 真实 Electron + disposable SQLite，或真实 Testcontainers PG + Graphile Worker；只有实际启动并重启子进程的用例才证明相应进程边界 | 未运行的平台；fake Provider/S3 的真实服务可靠性；未测试的生产入口/容器；真实跨设备同步 | `runtime-e2e` |
| `live` | 测试账号对真实服务的指定路径，如本地 API → 远端账号服务，或真实上游出图 | 完整生产部署、所有模型、持续稳定性、未覆盖的付费与恢复路径 | `external`，在说明中写 `live` |
| `package` | 精确打包产物的启动、协议、内联迁移、平台运行行为 | 另一平台、另一架构、另一文件或安装升级；源码 E2E 不能代替它 | `artifact`，在说明中写 `package` |
| `prod` | 生产域名、TLS、部署版本、数据库、Worker、对象存储及回滚的实际运行 | 没执行的客户端、动作、容量、跨设备和计费分支 | `external`，在说明中写 `prod` |

现有 [manifest schema](../../tests/repo/migration-evidence.ts) 只接受 `source/unit/mock-e2e/runtime-e2e/artifact/external/blocked`。`live/package/prod` 是本文便于阅读的细分，**不能直接写入现有 JSON 的 `level`**。`blocked` 表示阻塞，不是一种成功证据；结果单独用 `pass/fail/skip/blocked/unregistered`。尚未执行的计划写“待执行”，不能先填 `pass`。

### 1.2 当前证据欠账

[V25-EVIDENCE-MANIFEST.json](./V25-EVIDENCE-MANIFEST.json) 已存在，B00已有后续批次导航，部分其他claim仍保留早期 `98 passed / 1 failed / 5 skipped` 和 Electron `33 / 1 / 1`，多项 `commit/date/report/artifact` 为 `null`、结果为 `unregistered`。它没有完成 B8 登记。部分旧卡及 checklist 通用段落也保留过时的“最近”数字。

因此当前应分别读作：**B53同源码完整门禁/三形态结果见§5.47，B46数据库开启的API/worker全集等专项仍对应各自批次；发布与manifest的正式证据仍需收口**。G-BASE必须核对具体运行记录、刷新过期claim，并将无法取得原始报告的B8数据保留为历史记录；不能把历史文字或dirty工作树摘要抄进manifest后直接改成clean commit的`pass`。需要正式升级结论时，在固定checkpoint上补跑对应门禁并保存报告。

结果计数遵循以下规则：

1. 根 Vitest、features 以及其他包测试有不同执行范围，不把文件数或用例数直接相加成“唯一测试总量”；Turbo `35/35` 是 task 数。
2. 同一用例重跑仍是一例；全量首跑失败后定向通过，要记录两次执行及修改范围，不能伪装成一次全量零失败。
3. `skip` 必须给出测试名、原因、补跑条件和归属任务。存在必验路径 skip 的阶段不能通过该路径的验收。
4. CI retry 后成功保留首次失败及 retry 次数，不能用重试掩盖产品问题。视觉更新需先确认 UI 变化符合规范并审阅差异。
5. 缺少 commit/report/artifact 的历史“已过”不丢弃，但标为“历史文字记录，未重新认证”。
6. 测试断言全部通过，但 runner 报未捕获错误或命令非零退出时，整条门禁仍为失败；分别记录断言数、错误数和退出码，不能只摘 `Tests passed`。

## 2. B1–B8 历史结果

### 2.1 统一门禁与双端 E2E

来源：[原任务包 tasks.md](../../.spec/specs/2026-09-01_migrate-v21-to-v25/tasks.md) 各批次 `verify`、[checklist.md](../../.spec/specs/2026-09-01_migrate-v21-to-v25/checklist.md) 的“行为成效 / 验收证据”。表中 `P/F/S` 分别为通过 / 失败 / 跳过；“归并”保持原记录口径，不代表本次复跑确认。

| 批次与日期 | 批次范围 | `check` 历史结果 | Web 双视口 | Electron | 记录边界 |
|---|---|---|---|---|---|
| B1，09-06 | 提示词、历史、连接、偏好、首启引导、数据与关于 | Turbo 35/35；根 191 文件 / 1460 例；features 396 例；边界 0 违规 | 122 P / 4 S | 55 P / 1 S | 原记录 checkpoint 起点 `8b0ef3c`，不是结束版本证明；真实 key 用例跳过。B1 六子卡和视觉变更详见原任务包 |
| B2，09-06 | 多图、开放能力、账号与壳、密度/虚拟化、统计、窗控 | Turbo 35/35；根 200 / 1548；features 38 / 495 | 136 P / 0 F / 4 S | 67 P / 0 F / 1 S | darwin、未 commit；Windows 控件重叠未实机验证 |
| B3，09-06 | Cloud MCP 已连接应用、统计图表、Win/Linux 控件避让 | Turbo 35/35；根 202 / 1566；features 39 / 507 | 142 P / 0 F / 4 S | 69 P / 0 F / 1 S | darwin、未 commit；图表只验证存在性，无图表快照；Windows 未实机目测 |
| B4，09-06 | promptId 服务端过滤、归档游标、Key 引导、豆包入口、桌面方案包 | Turbo 35/35；根 203 / 1572；features 40 / 513 | 首跑 143 P / 1 F / 4 S；修复后 mobile 豆包定向 1/1；原记录归并为 144 P / 4 S | 首跑 72 P / 1 F / 1 S；修复后方案 spec 3/3；原记录归并为 75 P / 1 S | darwin、未 commit；Electron 归并值存在重复计数可能，见 §2.2；不是一次全量通过 |
| B5，09-07 | 云端出图落盘、双列、Taxonomy Sheet、会话标题、移动键盘 | Turbo 35/35；根 204 / 1578；features 42 / 534 | 首跑 142 P / 2 F / 4 S；日期夹具修复后原记录归并 144 P / 4 S | 首跑 73 P / 1 F / 1 S；视觉更新后 Workbench 11/11；原记录归并 74 P / 1 S | darwin、未 commit；Web 日期失败与 Electron 视觉修复后以定向结果归并 |
| B6，09-07 | 额度引导、兑换后重试、终态刷额度、只读审批卡 | Turbo 35/35；根 205 / 1579；features 43 / 544 | 144 P / 4 S | 74 P / 1 S | darwin、未 commit；不证明完整费用审批后端，原记录另提真实 key 验证但未提供独立矩阵 |
| B7，09-07 | Worker runtime 第一批、生成软删 purge、方案改名删除、Web live、数据库 CI | Turbo 35/35；根 206 / 1582；features 43 / 545 | mock 144 P / 6 S；live 双视口另跑 2/2 | 75 P / 1 S；方案 spec 4/4 | darwin、未 commit；Web 默认新增 2 个 live skip；Worker integration 4/4 |
| B8，09-07 | Worker runtime 第二批、提示词/sync 保留期、时间线键盘、PG replay/bundle、Electron live | Turbo 35/35；根 207 / 1586；features 44 / 548 | mock 144 P / 6 S；live 双视口另跑 2/2 | 默认全量 75 P / 2 S；live 另跑 1/1 | darwin、未 commit；默认 Electron skip 为真实 key 与 live；Worker integration 9/9、PG replay 1/1、bundle freshness 1/1 |

### 2.2 首次失败、重跑与限制

- **B4 Web**：移动端豆包入口断言未先打开账号所在抽屉；修正后 mobile 定向 1/1。保留“首跑 1 F”，归并结果只描述修复后的已覆盖用例集合。
- **B4 Electron**：方案导出后仍在详情页，下一用例找不到新建入口；补返回动作和 serial 后方案 spec 3/3。首跑 72 P + 1 F 的总用例集合与“归并 75 P”并不直接一致，可能把已通过的定向用例重复计入。**75 是原文报告值，不能认定为去重后的唯一通过数**；G-BASE 应从原始报告去重，拿不到报告则保留未登记。
- **B5 Web**：UTC+8 跨午夜后“今天”的种子不落查询范围，改成本地日首；原记录给出修复后的归并数，没有新的一次全量报告可供本文认证。
- **B5 Electron**：工作台标题及错误文案变化导致浅色快照差异约 3%；原记录删除旧基线再生成，随后 Workbench 11/11。后续验证不能把“刷新快照”本身当作产品正确性证明。
- **全屏历史失败**：早期 33 P / 1 F / 1 S 与完整 E2E 98 P / 1 F / 5 S 是旧记录，不作为 B8 当前失败。B3 测试在原生全屏不可用时注入同义窗口事件，能证明壳响应；这仍不能替代 macOS 原生切换和 Windows 实机窗口几何的专门证据。
- **live 与默认 E2E**：B8 Web 2/2、Electron 1/1 是开启环境门控后的另外执行。不能把默认 skip 自行改写为默认套件已覆盖真实服务。

### 2.3 真实服务与数据库的已知结果

本文不复制旧记录中的真实账号、额度、凭据、生成 ID 或资产地址。回溯使用原任务包位置；后续报告使用脱敏 case ID。

| 日期 / 批次 | 已有历史行为结果 | 级别及实际组件 | 未证明的事项 |
|---|---|---|---|
| 09-03 账号联调 | 本地 API 的登录、账号状态及 Electron 登录/登出通过 | `live`：本地 API + 远端 New API；桌面经真实账号域 | 正式 API 域名部署、独立 Web UI 和完整费用状态机 |
| B4 | 登录/额度/提示词 CRUD、桌面导入入口可达；普通云生图入队后 `failed / GENERATION_UPSTREAM_UNKNOWN`；方案市场/导出为 501 | `live`：本地云服务链路、真实上游 | 成功出图没有通过；501 是未实现边界，不能写成功 |
| B5 / B6 / B7 | 各有普通云生图终态 `succeeded`、1 张资产记录；B7 方案确定性 CRUD 可用，市场/Agent create 501 | `live`：本地 API/Worker/对象存储 + 真实上游 | 云端设计方案运行；重复扣费/取消/并发/长时间可靠性矩阵；生产部署 |
| B7 Worker | 4/4：入队成功；过期租约且已发上游变未知；运行中取消；生成软删 30 天 purge | `runtime-e2e`：临时 PG + Graphile `runOnce`；fake generate + 内存 S3 | 真实子进程退出/重启、stale epoch 并发提交、真实 S3 |
| B8 Worker | 9/9：runtime 7 + retention 2；新增未发上游续跑、失租约 late success、部分上传失败；提示词 30 天、sync 90 天裁剪 | `runtime-e2e`，当前入口见 [runtime](../../apps/worker/src/__tests__/runtime.integration.test.ts)、[retention](../../apps/worker/src/__tests__/retention.integration.test.ts) | 进程 kill/restart、两个 Worker 实例竞争、完整资产 GC、跨设备过期游标恢复 |
| B8 PG | 空库 migrate 后再次 replay，迁移账本条数相等且大于 0，1/1 | `runtime-e2e`：[migrate replay](../../apps/api/src/__tests__/integration/migrate-replay.integration.test.ts)，Testcontainers PG | 旧版本升级、真实脱敏 v2.1 数据、身份拒绝矩阵和备份恢复 |
| B8 bundle | freshness 1/1；`db:bundle` 后生成文件 diff 干净 | `source/unit`：[bundle freshness](../../tests/repo/desktop-db-bundle-freshness.test.ts) | asar 运行时实际加载内联迁移，必须跑 package |
| B8 live UI | Web 双视口 2/2；Electron 1/1，登录及提示词 CRUD | `live`：[Web](../../tests/v25/web.live-account.spec.ts)、[Electron](../../tests/v25/electron.live-account.spec.ts) | 本批没有强制重生图；不代表独立设备同步验证 |

## 3. 执行环境与命令准备

所有命令从仓库根目录执行。命令来源为 [根 scripts](../../package.json)、[API scripts](../../apps/api/package.json)、[Worker scripts](../../apps/worker/package.json)、[Playwright 配置](../../tests/v25/playwright.config.ts) 和实际测试文件。安装/迁移/打包均只在任务专用环境执行，不读取或修改用户正式 App 的数据。

| 环境 | 前置与读取方式 |
|---|---|
| 通用 | 当前 CI 使用 Node 24；包管理器版本以根 `packageManager` 为准。锁文件安装：`pnpm install --frozen-lockfile`。记录 OS、架构、Node/pnpm 版本和工作树状态 |
| Web / Electron E2E | `pnpm exec playwright install chromium`；Electron 真窗口、单 worker；macOS 快照使用 darwin 基线。默认 Web desktop 为 1280×800；mobile 使用 iPhone 13 设备参数但内核是 Chromium，不等于真实 iOS Safari |
| PG integration | Docker / 兼容运行时可用，可拉取 `postgres:17-alpine`；API/Worker `test:integration` 自动设置 `RUN_DATABASE_TESTS=true` 并创建 disposable PG，不需要真实账号或真实上游密钥 |
| 本地 API / Worker | 从 [API env schema](../../apps/api/src/env.ts)、[Worker env schema](../../apps/worker/src/env.ts) 核对变量名。通过已配置的进程环境或受控 secret 注入提供 `DATABASE_URL`、`NEW_API_BASE_URL`、`CREDENTIAL_ENCRYPTION_KEY`，API 另需 `BETTER_AUTH_SECRET`；对象存储按 schema 提供 S3 参数。两服务加密配置必须匹配。不要把值输出到终端、报告或仓库 |
| 本地基础设施 | `pnpm run dev:infra` 启动 [compose](../../infra/v2.5/compose.yaml)；迁移前确认 `DATABASE_URL` 指向任务专用库。`packages/db/drizzle.config.ts` 有默认 URL，不能假定默认值就是当前 compose 端口。用变量名/存在性检查，不打印连接串 |
| 活体账号 E2E | 仅在已授权测试账号下启用；显式注入 `MUSEFOLD_E2E_USERNAME`、`MUSEFOLD_E2E_PASSWORD`，避免测试源码中的默认账号。`MUSEFOLD_LIVE_E2E=1` 开启；没有密码会 skip。Web Next 通过 `MUSEFOLD_API_UPSTREAM` 指向 API，默认本地 8787；当前 Electron live spec 固定指向本地 8787，不能当远程生产验收 |
| 付费生图 | 当前 live-account specs 只覆盖登录/提示词操作，不自动生图。付费验证需任务中已确定账号、模型、张数和花费边界，使用受控 fixture；完整自动脚本仍待相关 goal 交付，不复制历史临时 HTTP 调用或凭据到文档 |
| 打包 | 使用本平台和本架构的构建机；正式签名/公证由 Release secrets 注入。ad-hoc 通过不能冒充 Developer ID 签名、公证或 Gatekeeper 安装体验通过 |

如需核对环境，只记录变量是否存在及非敏感的端口/模式；不要执行 `env` 全量输出或读取凭据文件正文。开发进程结束用 `pnpm run dev:stop`；不要终止用户的正式 App。容器销毁与数据清理按本任务创建的资源范围执行。

## 4. 分阶段验证流程

### T0：文档、范围与可复现基线

**入口**：开始任何 goal；G-BASE 必做一次完整盘点，后续任务只登记其起点和增量。**关联任务**：G-BASE，全部任务的前置。

1. 读取根及目标目录 AGENTS、当前 goal、旧卡、相关 UI/契约/数据规范；锁定可写文件与不可改区域。
2. 记录起始 HEAD、分支、dirty 文件归属。既有未提交改动保持原样；无法稳定复现的并发改动先隔离到任务 checkout。
3. 将验收项映射到测试文件、平台和证据层级；已有测试与计划新增测试分列。
4. 核查文档相对链接、引用的命令和任务依赖；`git diff --check` 检查已跟踪 diff。新建但未跟踪的文档还需单独检查空白与链接。

```bash
git rev-parse HEAD
git status --short
git diff --check
pnpm exec vitest run tests/repo/migration-evidence-manifest.test.ts
```

**出口**：每个验收项有负责人、行为、测试入口和证据类型；旧数字明确是历史记录；manifest 校验结果真实登记。单纯文档任务不必为此重跑全仓 `check`，但不能因此修改产品测试结论。Spec 工具校验使用当前已安装 spec skill 的实际脚本入口；它不在本仓库根 scripts 中，不虚构固定命令。

**失败回写**：链接/路径/状态冲突在本卡修复。manifest 守卫如果因真实未完成项报错，保留失败或未登记的含义并关联任务，不能删约束使之通过。

### T1：就地逻辑、契约和统一源码门禁

**入口**：T0 范围稳定，相关实现与就地 `__tests__` 完成。**关联任务**：全部有源码改动的 goal；G-CLOUD、G-SPEND、G-OPS 尤其需要权限和状态负例。

先按所属包跑小范围，再按根 AGENTS 跑 `pnpm run check`。以下是当前真实入口，定向文件选择以本卡修改内容为准：

```bash
pnpm --filter @musefold/contracts exec vitest run
pnpm --filter @musefold/api run test
pnpm --filter @musefold/worker run test
pnpm --filter @musefold/features run test
pnpm exec vitest run tests/repo/migration-evidence-manifest.test.ts tests/repo/desktop-db-bundle-freshness.test.ts
pnpm run check
```

必须覆盖：正常路径；未授权和跨 owner；非法输入与版本冲突；重复请求；取消与晚到结果；暂不支持能力的明确拒绝。Cloud MCP 保持已批准的只读 allowlist，不借费用测试顺手开放远程写入。

**出口**：统一门禁全部成功；任何失败均有修复或明确环境阻塞；测试不以删除断言、扩大白名单、降低边界门禁收尾。`pnpm run check` 包含 lint/typecheck/test/build/boundaries 及 Web build，但默认数据库 integration 可能 skip，不能把它写成 T2 已完成。

**失败回写**：记录 failing test、最小触发、修复文件及重跑范围；契约变化同步所有消费方。若修复涉及新的公共层，扩展受影响测试；无新改动与疑点时不重复无意义全量执行。

### T2：数据库、Worker、保留期和恢复

**入口**：T1 的相关定向测试通过，Docker 可用，数据库完全隔离。**关联任务**：G-WORKER-01..02、G-DATA-01..03、涉及 PG 的 G-CLOUD/G-SPEND、相关发布迁移任务。

```bash
pnpm --filter @musefold/api run test:integration
pnpm --filter @musefold/worker run test:integration
pnpm --filter @musefold/desktop-db run db:bundle
git diff --exit-code -- packages/desktop-db/src/migrations.generated.ts
pnpm exec vitest run packages/core/src/db/design-scheme/__tests__/migrations.test.ts tests/repo/desktop-db-bundle-freshness.test.ts
```

PG schema 有改动时另在明确的专用数据库连接环境下执行：

```bash
pnpm run db:migrate
```

`db:bundle` 会生成文件。在已提交、应当新鲜的基线上其后 diff 应为空；若本卡新增 SQLite migration，先验证生成内容正确、按 AGENTS 一并纳入交付，再在相同 checkpoint 做 freshness 检验，不能通过还原生成文件消除 diff。

下表保留B9–B12时的基础矩阵和当时缺口，供定位既有测试；当前剩余项以任务卡§5.5、§5.7.2与各最新批次结果为准。例如正式worker bin/新PID已有后续批次证据，不能按本表旧快照重新判为未实现。

| 验收子矩阵 | 已有入口及带批次的已执行证据 | 后续必须补齐的验收 |
|---|---|---|
| Worker lease / epoch | 既有 PG + `runOnce` 7 项，加 [真实子进程矩阵](../../apps/worker/src/__tests__/process-runtime.integration.test.ts) 11 项：发送前 kill/新 PID 恢复、发送后 unknown 禁重发、Graphile reconcile、取消/重复投递/上传后崩溃、epoch/heartbeat 竞争；包含于最终 Worker 4 文件/22 tests | 生产 `bin.ts`/容器启动恢复、真实对象存储/上游、长时间运行及尚未覆盖的竞争排列；不能把 11 项推成全矩阵完成 |
| 保留期 | 生成/提示词 30 天及 sync 90 天；未到期保留；重复清理 no-op | 时限边界、清理失败恢复、过期游标 bootstrap、真实两客户端语义；保留期配置与契约一致 |
| P1 账号身份与失败补偿 | B12 的 [COMMIT/cookie 故障](../../apps/api/src/__tests__/integration/account-identity-faults.integration.test.ts)与[两真实 API PID/响应丢失](../../apps/api/src/__tests__/integration/account-identity-process.integration.test.ts)原合跑7项后追加live保存间SIGKILL，合跑8项；backup另有对应真实120秒租约case，均包含于最终API164项，见§5.4.5 | 真实上游与可信历史来源不能由合成owner夹具推导；不承诺跨系统回滚 |
| P1 可信备份及恢复密文 | [真实备份 CLI/PG 集成](../../apps/api/src/__tests__/integration/account-backup.integration.test.ts)的33项包含于最终完整API164 P、0 F/S/未捕获错误、退出0；[到期清理](../../apps/worker/src/__tests__/account-recovery-retention.integration.test.ts)专项 8 项及完整 worker 55 项已通过 | 原失败与最终通过见 §5.4.3；真实备份来源审定和运维恢复演练仍待。P1 证据恢复不等于 P2/P3 付款回执，也不解决旧本地备份防重付 |
| 资产 GC | cleanup queue 与部分上传失败入队；B9 [永久引用保护 2 项](../../apps/worker/src/__tests__/object-cleanup.integration.test.ts) 覆盖已晋升方案资产及 soft deleted 方案，物理 purge 前均不误删；云资产用例覆盖晋升/discard 竞争与过期暂存拒绝 | 全资产/来源包/历史/包 staging 的发现与回收、真实 S3、Desktop GC、完整失败恢复和并发引用变化矩阵；正在被使用的成功资产不能误删 |
| PG replay / upgrade | 空库 migrate 两次幂等仍保留；B9 [云资产 integration](../../apps/api/src/__tests__/integration/design-scheme-assets.integration.test.ts) 在真实 0006 schema 写入 repository/local-run 旧行，再用 CLI 升至 0007 并核对保留、重复 replay；同时验证该切片 owner/用途隔离、伪造引用拒绝和事务回滚。最终 API 总计 4 文件/54 tests | 其他历史版本升级、真实脱敏 v2.1 语料、完整 schema/journal/identity 矩阵、备份恢复及升级失败回滚策略 |
| Desktop 数据 | synthetic corpus 与就地迁移/repository 测试；B9 [独立方案库 v6→v7](../../packages/core/src/db/design-scheme/__tests__/migrations.test.ts) 保留资产全部列、封面/版本/来源/run 关联及 FK/索引；[专用包往返](../../apps/desktop/electron/main/design-scheme/__tests__/share.test.ts) 验证 uploaded 来源与 hash 经 v25 详情和媒体读取保真，相关定向 7 文件/130 tests | 真实脱敏旧库来源、全量升级前后清点、备份恢复、不同同步身份隔离与两客户端同步；synthetic corpus 明确标注 |

这些“必须补齐”的测试 harness 尚未全部存在；由相应 goal 新增并回写确切命令，不能给未来测试编造文件名或通过数。B9 Worker 子进程复用生产 task、Graphile、HTTP 生图和 S3 客户端，但进程入口是测试 fixture，上游/S3 是回环 HTTP 替身；PG 为 Testcontainers。故障时间通过隔离数据库的租约/保留期字段加速，不篡改 Graphile 已崩溃作业锁。

P1 新增定向入口已存在；Docker/Testcontainers 就绪后可运行下列命令。测试自行创建隔离 PG 和合成 HTTP 身份，不需真实账号或付费 Key；`RUN_DATABASE_TESTS` 只开启集成套件。备份 CLI 测试内部启动真实子进程并注入合成源/目标连接及加密材料，人工恢复的环境读取方式和受控文件前置另见[运维流程](./V25-ACCOUNT-RECOVERY-OPS.md)，不得把生产秘密放在命令行或测试报告。

```bash
RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/account-identity-faults.integration.test.ts src/__tests__/integration/account-identity-process.integration.test.ts
RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/account-backup.integration.test.ts
RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/account-recovery-retention.integration.test.ts
```

P1 出口须逐项映射 L-T1–8：身份/owner 校验 → 事务及 session CAS → 原申请恢复 → 到期清理，再跑完整 API/worker integration 与 T1/T3。清理通过不替代备份激活；CLI 的字节一致性校验不创造可信历史来源；两个 API PID 竞争不等于在指定间隙 kill/restart。任何失败将相应条目回写为待验，不扩大为另一阶段已通过。

**出口**：本卡要求的运行矩阵在隔离真数据库中通过，失败注入可重复，结果/账本/对象/清理队列相互一致；记录哪些组件是假实现。B9 已补独立子进程重启证据，不能继续记为“完全未验证”；生产入口、容器及未覆盖矩阵仍待执行，G-WORKER/G-DATA 不整体关闭。

**失败回写**：区分容器启动失败、代码缺陷、迁移缺陷、上游故障。保存脱敏时序和状态摘要，不存业务正文；修复后重跑触发用例及同状态机相关矩阵。不得在生产库上做 destructive fixture。

### T3：Web、Electron 和真实服务产品路径

**入口**：T1/T2 中本卡依赖的门禁通过；使用本次源码新构建；E2E 配置明确指向本次服务。**关联任务**：G-CLOUD-01..06、G-SPEND-01..02、G-DATA-01..03、G-UI-01..02、若启用的 G-OPS 页面。

```bash
pnpm run test:e2e
```

根命令已串联双宿主构建及 Web/Electron 项目；打包产物走 T4 独立严格配置。定向执行可用：

```bash
pnpm run build:web
pnpm exec playwright test -c tests/v25 --project web-desktop --project web-mobile
pnpm run build
pnpm exec playwright test -c tests/v25 --project electron
```

features/ui/双端屏幕改动按 AGENTS 另跑根 `test:e2e`；桌面主进程/IPC/数据改动按 AGENTS 跑真实 Electron project，必须在 build 后执行。若一次根 `test:e2e` 已在同一 checkpoint 完整跑过 Electron，可在报告引用该命令中的 project 结果，不重复累计用例。

G-UI-01 移动会话删除已补齐真实可达路径：移动抽屉 → 行内“更多” → 删除 → AlertDialog；桌面仍走同一菜单。专项命令如下，执行前必须已有对应源码的 Web 构建。出口覆盖取消 DELETE=0、确认只删目标、非当前会话不切换、当前删除回退剩余会话、最后一条删除回空态，以及移动“更多”44px 触区。该专项 4 项已通过（§5.4.2），不再保留“移动入口待实现”的当前 skip；原批次 skip 数原样封存。随后完整三形态已在 1223 项源码检查点实跑通过（§5.4.3），不能由 239 的旧计数手算新总数。

```bash
pnpm exec playwright test -c tests/v25 tests/v25/web.workbench.spec.ts --project web-desktop --project web-mobile --grep '删除会话经确认对话框'
```

已授权并通过受控环境注入测试用户名/密码、本地 API 运行后，真实账号验证命令为：

```bash
MUSEFOLD_LIVE_E2E=1 pnpm exec playwright test tests/v25/web.live-account.spec.ts -c tests/v25 --project=web-desktop --project=web-mobile
MUSEFOLD_LIVE_E2E=1 pnpm exec playwright test tests/v25/electron.live-account.spec.ts -c tests/v25 --project=electron
```

验收按用户动作组织：首启 → 登录/连接 → 提示词 → 普通生成与方案生成 → 查看/保存资产 → 重试/取消 → 历史/归档/回收 → 设置/同步/授权撤销。每个本卡新增动作覆盖加载、空、失败、无权限、处理中和终态；desktop-only 能力在 Web 有正确门控。

需要单独补充并登记的限制：

- B9 的 [Playwright 配置](../../tests/v25/playwright.config.ts) 已改为本次 Next **standalone production**，`reuseExistingServer: false`，并复制匹配构建的静态资源。真实业务 API 与页面 mock 的证据仍需区分。
- 移动 Chromium 视口不等于真实手机软键盘、iOS Safari 或触摸设备验证；G-UI 应对键盘遮挡、焦点和长列表给出目标设备证据。
- macOS 事件注入 fallback 与原生 fullscreen 成功分开；Windows 标题栏/缩放/窗口按钮需要 Windows 运行验证。
- 桌面 sync E2E 的本地 mock server、独立 userData 不自动证明两真实客户端云同步。
- `.results` 仍是本地产物目录；B9 已配置 JSON/HTML、成功/失败均上传、隐藏目录显式包含和 JSON 存在门禁；本轮尚未在远程 CI 执行，不能编造 artifact URL。

**出口**：本卡要求的平台和动作均有匹配层级的证据；截图变化已审阅；live 和 mock 各自计数；必验路径无无主 skip。外部服务不可用时保留原断言、故障时间和重跑条件，标 blocked。

**失败回写**：附测试名、期望/实际状态、脱敏截图或日志引用。修复夹具后只证明夹具问题已解决；当业务实现也改变，补跑受影响功能与统一门禁。不得用全局 sleep 或移除断言掩盖竞态。

### T4：平台产物、安全与 Release 等价门禁

**入口**：准备冻结发布候选，T1–T3 与相关数据门禁通过；目标 OS/架构和签名方式明确。**关联任务**：G-RELEASE-01..04 中产物、安全和 CI 子任务。

当前 macOS 本地入口：

```bash
pnpm run package:mac:adhoc
pnpm exec playwright test -c tests/v25/playwright.package.config.ts
```

Windows x64 构建机使用现有 Release 同款入口：

```bash
pnpm run package:win --x64
pnpm exec playwright test -c tests/v25/playwright.package.config.ts
```

B9 的 [严格配置](../../tests/v25/playwright.package.config.ts) 按当前 OS/架构定位产物，可显式传 `MUSEFOLD_PACKAGE_PATH`、`MUSEFOLD_PACKAGE_ARCH`；缺包必须失败。冒烟验证平台、asar、当前 bundle 字节、受管数据库和重启持久化。当前 Release 明确 macOS arm64、Windows x64；其他承诺架构、旧库升级/备份恢复和安装器自身体验仍须独立验收。最新执行次数见 [开发记录](./V25-DEVELOPMENT-LOG.md)。

| 当前 CI 源码事实 | 验收缺口 |
|---|---|
| PR `verify` 是 Turbo affected，另有 Web build；Main 是 full；两者有 database-integration 与 macOS E2E | 有 job 不代表当前 commit 在远端实际成功；需 CI run URL、commit、结果及 artifacts |
| Release 打包等待 full checks/Web build、数据库 integration、双端 E2E 和服务镜像构建/冒烟，publish 再等待两平台打包；已接 source 与 package 内容扫描 | 未执行本批远程 Release 验证；Windows 实际产物及全部运行出口仍待验 |
| Release 提供 macOS arm64 / Windows x64 的严格 package-smoke，缺包/错架构/bundle不匹配失败 | 其他承诺架构、旧库升级与安装器体验仍缺实际证据 |
| PR/Main/Release E2E 与 package 报告成功/失败均上传，显式包含隐藏目录并要求 JSON 存在 | 仍需真正的 CI artifact URL 与视觉审阅 |
| B10 已实现扫描器、合成 canary、归档内容扫描及 CI；macOS App/DMG/ZIP 与 Electron 出口有报告，B11 重扫 source | 更多备份/导出/HTTP/MCP 出口、Windows 产物和最终源码重新打包仍需逐项验证；内容扫描不等于依赖漏洞或全面安全审计 |

安全扫描使用专用哨兵密钥/路径标记验证“不泄漏”，仅输出命中位置和规则 ID，不输出真实 secret 或业务正文。已有脚本与限制见[安全验证记录](./V25-SECURITY-VALIDATION.md)。下列是真实存在的独立命令；产物扫描须在本次打包及严格冒烟之后执行，不能将 `pnpm run check` 宣称为安全产物扫描通过：

```bash
node scripts/security/scan.mjs source --report tests/v25/.results/security/source.json
node scripts/security/scan-packages.mjs tests/v25/.results/package/security.json
```

**出口**：目标平台产物逐一启动且必验项非 skip；产物版本/hash/构建 commit 可追溯；安全扫描在规定载体完成；Release 运行结果与完整门禁对齐；安装包签名方式和分发通道如实登记。

**失败回写**：错误平台、缺产物、迁移失败、泄漏命中均阻断该产物发布。修复后重新生成受影响产物，旧 hash 下的结果不能迁移给新产物。

### T5：部署、回滚、远程 MCP 与最终验收

**入口**：发布候选和 T4 证据齐备，生产/预发拓扑、备份与回滚目标清楚；执行动作在相应 goal 授权范围内。**关联任务**：G-RELEASE-01..04 中部署/MCP/最终验收子任务；可选 G-OPS 可提供诊断入口，但不替代自动测试。

当前可以引用的构建验证命令来自 Main workflow：

```bash
docker build -f apps/api/Dockerfile -t musefold/api:v2.5 .
docker build -f apps/worker/Dockerfile -t musefold/worker:v2.5 .
```

这些命令只证明镜像能构建。当前 `pnpm run deploy:prod` / `deploy:rollback` 虽存在，实际脚本仍依赖 v1.1 的 Dockerfile、Web dist、环境文件、镜像和 health 路径；[部署 README](../../scripts/deploy/README.md) 的旧自动触发表述也与当前 Main workflow 不一致。**不能把这两个现有脚本直接当作 v2.5 发布/回滚流程运行**。先由 G-RELEASE 对齐 Next standalone、API/Worker、PG 迁移、对象存储、反代和健康检查，再在本节登记真实入口。

| 顺序 | 必须执行与记录的验收 |
|---|---|
| 1. 预发准备 | 精确镜像/产物 digest、数据库版本、域名、配置变量名、备份与回滚版本；秘密值不入报告 |
| 2. 迁移和启动 | 迁移前备份；expand/contract 兼容；API、Worker、Web 启动；现有 API `/healthz` 仅为活性接口，是否覆盖 DB/队列/存储就绪需专门实现及断言 |
| 3. 生产形态 Web | Next standalone 启动、静态资源、深链刷新、登录/cookie/CSRF、PC/mobile 主路径；必须独立于 dev-server E2E |
| 4. 全链路生图 | 在既定花费边界内验证入队、执行、资产可读、任务/费用状态；取消、失败、未知上游等恢复矩阵使用可控故障，不盲目重试已可能扣费的请求 |
| 5. 数据与同步 | 两个独立客户端，同步冲突、设备撤销、过期游标恢复；回收与资产清理不会破坏仍被引用的数据 |
| 6. 远程 MCP | 两个独立远程客户端完成发现、OAuth/consent、只读工具调用、授权撤销后拒绝；未授权/跨 owner/禁止写入工具负例；token 与响应脱敏 |
| 7. 回滚演练 | 部署失败和人工回滚都能回到上一个已知可用版本；验证 Web/API/Worker 与已扩展 schema 兼容；数据恢复演练与应用版本回滚分开记录 |
| 8. 最终验收 | 功能矩阵、平台矩阵、费用矩阵、证据 manifest 与任务包一致；每项 unresolved 均明确阻断或已批准范围外，不能把暂未实现能力改成永久平台例外 |

真实部署拓扑下的完整 v2.5 部署/回滚、standalone smoke 与远程 MCP 两客户端验收尚无已核实的统一自动入口，标 **待实现 / 待执行**。本地 production standalone 已有 B9–B11 验证，不能继续称为尚未实现，也不能代替本阶段外部部署证据。不要直接套用旧脚本，或写出看似可执行但仓库不存在的命令。

**出口**：生产/预发实际版本与报告绑定；完成规定路径和回滚演练；外部客户端证据可追溯；最终清单才可标“通过”。本地普通生图 live 成功、`/healthz` 返回 200、镜像构建成功都不能独自满足出口。

**失败回写**：先按已验证预案收敛到安全版本，保留任务及数据状态；记录影响范围、回滚结果及下一次尝试前置。部署域名不可达或缺运行环境，标环境 blocked，不能通过改成 localhost 消除生产验收要求。

## 5. 后续阶段结果栏

### 5.1 初次文档交付验证（2026-09-07，B8 后历史）

| 检查 | 实际执行结果 | 可以证明的范围 |
|---|---|---|
| 文档结构与引用 | 检查三份新文档及六份关联文档的相对链接、代码块、空白、文件行数；23 个 goal 索引与详细卡一一对应。发现旧 UI 规范尾随空格后已修正 | 文档可导航、任务可定位；不证明业务实现 |
| 既有 repo 守卫 | `pnpm exec vitest run tests/repo/migration-evidence-manifest.test.ts tests/repo/file-size-limit.test.ts`：退出码 0，2 文件、13 测试通过（19:53，Asia/Shanghai） | 现有 manifest 结构/约束与生产文件尺寸；manifest 中未登记结果仍未登记 |
| 文档 diff | `git diff --check` 限定本轮关联的已跟踪文档：退出码 0；未跟踪新文档另做静态检查 | 文档改动没有空白错误 |
| 当前迁移包校验 | 已安装 spec skill 的 `check_spec_package.py --root <仓库根> --slug 2026-09-01_migrate-v21-to-v25 --compact`：退出码 1；19/24 任务完成，1 条 checklist 未勾，验收未通过 | 原迁移整包仍未闭合，符合当前事实；本轮未修改勾选框伪造完成 |

本轮文档目标已经具备完整内容；上表 Spec 失败属于原迁移任务包仍有开发/验收工作，不能据此把本轮扩展为立即实施全部后续 goal。完整业务测试与 G-BASE 的正式证据登记仍待后续执行。

### 5.2 B9 实施结果（历史快照）

以下为文档轮之后的 **B9 实际实施结果**，不继承 B8 的 pass，也不擦除中间失败。最终命令、报告、冻结源码和产物摘要以 [开发记录](./V25-DEVELOPMENT-LOG.md) 为准；执行平台为 macOS arm64，工作树仍 dirty，不能据此强填 clean commit 的 manifest pass。

| 阶段 | 当前结果 | 完成时必须关联 |
|---|---|---|
| T0 文档/基线 | 文档静态核查已完成；B9 冻结清单 1037 个源码/配置/测试文件在最终打包后复核无变化；正式 checkpoint 与 manifest 刷新仍欠 | 源码版本、dirty 范围、链接/路径检查、manifest 结果；工作树 hash 不代替 clean commit |
| T1 就地/统一源码 | B9 最终 `pnpm run check` 退出 0，Turbo 35/35，根 212 文件/1656 tests、features 44/548；中间失败及重跑范围保留于开发记录 | 当前源码的 check 和定向报告、失败/跳过说明 |
| T2 PG/Worker/恢复 | B9 最终 API integration 4 文件/54 tests，Worker integration 4/22，均退出 0；真实子进程、PG 0006→0007、方案 SQLite v6→v7 已补；完整恢复/GC/跨设备仍待执行 | DB/进程/对象存储真实与 fake 范围见 T2 子矩阵，不将切片通过写成整个阶段通过 |
| T3 Web/Electron/live | B9 最终 E2E 219 passed / 8 skipped / 0 failed / 0 flaky：Web desktop 73/2 skip、mobile 71/4 skip、Electron 75/2 skip；Web 使用当次 standalone 生产构建、业务 mock；本轮没有新的 live 登录/真实 Key 证据 | 报告见开发记录；8 skip = 3 项 live account 未注入 + 1 项真实 Key 未注入 + 3 项按视口排除 + 1 项移动端会话删除入口暂缓（G-UI-01）；原生全屏 fallback 与 Windows 未验边界保留 |
| T4 package/security | B9 最终 macOS arm64 `package:mac:adhoc` 与严格 package-smoke 1/1、0 skip、退出 0；bundle 与 asar 逐文件 SHA-256 相等，IPC/SQLite integrity/受管迁移与主题重启恢复通过；Windows、正式签名/公证、完整安全扫描和本轮 CI runner 仍欠 | 精确产物/hash、报告见开发记录；ad-hoc App 冒烟不代替 DMG/ZIP 安装体验或其他平台 |
| T5 prod/rollback/MCP | 待实现并待执行 | 部署版本、健康/业务检查、回滚、两个独立 MCP 客户端 |

### 5.3 B10/B11 已验收结果导航

最新数字只在对应批次报告维护；下表用于选择复跑范围，不把不同源码、重叠用例或定向重跑累加成一份“当前全绿”。

| 阶段 | B10 / B11 结果及原始入口 | 继续开发时的限制 |
|---|---|---|
| T0 源码身份 | B11 的 1175 项源码/配置/资源冻结清单，与最终门禁之后复核一致；见[市场报告](./V25-MARKET-VALIDATION.md) | B12 已开始新增文件/依赖，B11 摘要不代表当前全部文件；正式 checkpoint/manifest 仍待 |
| T1 统一源码 | B11 `pnpm run check`：退出 0，Turbo 35/35；详见[开发记录 B11](./V25-DEVELOPMENT-LOG.md) | API/worker 普通测试的 gated skip 必须由独立 integration 补证；新源码需要重新执行 |
| T2 数据库/进程 | B11 API integration 7 文件/72 passed、0 skip；B10 Worker integration 5 文件/47 passed、0 skip；精确 PG 0007→0008/replay 另见[云运行报告](./V25-CLOUD-RUN-VALIDATION.md) | Worker 47 项是 B10 的执行，B11 未重新跑该 integration；上游/对象存储用替身，完整 GC/旧数据仍待 |
| T3 三形态产品 | B11 完整 E2E 230 passed/8 skipped/0 failed/0 flaky；市场专项与完整套件重叠，见[市场报告](./V25-MARKET-VALIDATION.md) | 8 skip：3 真实账号、1 真实 Key、3 视口排除、1 移动会话删除暂缓；原生全屏/Windows 实机仍待 |
| T4 包与安全 | B10 macOS arm64 ad-hoc 新包、严格 package-smoke 1/1；App/DMG/ZIP 内容扫描 6 个目标零命中。B11 source 扫描零命中，见[安全记录](./V25-SECURITY-VALIDATION.md)及开发记录 | B11 未重新打包；B10 产物不能代表市场改动或 B12；Windows/签名/远程 CI 与其他出口未继承通过 |
| T5 部署与外部 | 本地 production standalone 及部分容器准备已有验证；v2.5 staging/production 部署链、回滚、两独立远程 MCP 客户端仍未验收 | 本地镜像/页面成功不替代目标域名、实际运行拓扑和恢复演练 |

B11 原始摘要：`tests/v25/.results/b11/validation-summary.json`；完整 E2E：`tests/v25/.results/b11/e2e/`；命令日志：`.results/v25/2026-09-07-development/b11-market/`。这些是本机可复核证据，不是已发布的 CI artifact。

### 5.4 B12 实施与阶段验证（旧检查点封存；后续合流待复跑）

#### 5.4.1 01:46 历史实现检查点

2026-09-08 已新增身份契约、PG 0009、账号事务/恢复接口、Web/桌面恢复界面与本机旧库查看/明确复制入口。reader 的历史 51 passed/6 failed 已修复，reader+图片专项 74 passed；New API transport 专项 60 passed；桌面账号/桥接专项 40 passed。定向 Web 双视口/Electron 7 passed、1 个真实 Key 例 skipped；这些结果覆盖范围不同，不直接相加。

该检查点的完整 check 两次 35/35 通过，根 2013、features 594 tests；实际 API integration 123 passed、worker integration 47 passed、隔离 PG 17 CLI migrate 两次退出 0。API 单测 244 passed/122 gated skipped 与早期 120 skip 的差异为随后新增两项 OAuth，原日志不改写。首次 check 的 6 项格式错误和后续修复记录见[开发记录](./V25-DEVELOPMENT-LOG.md)。

完整 E2E 首轮 233 passed/8 skipped/4 failed；reviewRef 合流后第二轮 237 passed/8 skipped/2 failed。第二轮是新 spec 把真实 IPC 平铺错误误写成 HTTP 格式，生产拒绝正确；只修 spec 后定向 3 passed，权限断言保留。**01:46 最终全量取得 239 passed/8 skipped/0 failed/0 flaky**，288.7 秒；PC Web 80/2 skipped、Mobile Web 78/4、Electron 81/2。报告为 [e2e-verified/report.json](../../tests/v25/.results/b12/e2e-verified/report.json)，[统一摘要](../../tests/v25/.results/b12/validation-summary.json)绑定 1210 项源码清单摘要 `6bc9e7fc6925d13b10b26ce1a9f8a225d7fd046c80c4c4eb92abf92cbb61c442`。source 复扫 1114 文件、11,748,874 字节、零命中/错误；E2E 后源码清单零漂移。

以上是 **01:46 已封存历史**。其 8 skip 包含当时的移动会话删除；该入口随后已补齐，不能改写旧报告为 7 skip，也不能把旧摘要中的 P1 缺项继续当成当前全部未实现。PG 0010、可信备份、故障矩阵和移动删除不在该检查点内；当前 package/Windows/CI/生产证据仍未取得。

#### 5.4.2 01:46 之后的真实专项与验收映射

日期均为 2026-09-08、Asia/Shanghai。以下报告对应各自源码窗口；`P/F/S` 不跨范围相加。

| 任务 / 阶段 | 已执行命令或入口与结果 | 验收范围与限制 |
|---|---|---|
| SP-P1 L-T5/L-T8，T2 | 02:02:47，两个身份故障集成文件合跑 **7 P / 0 F / 0 S**、退出 0、10.2 秒；API typecheck、3 文件 Biome 退出 0。见 [fault 摘要](../../.results/v25/2026-09-08-development/b12-identity-faults/validation-summary.json)与同目录 `integration-final.log` | PG 延迟约束在实际 COMMIT 抛错；真实 cookie 头构造失败；正常/受限登录回包确实丢失；两份生产 API bin 的独立 PID 在同一公开 issuer 下竞争 refresh/logout，上游 refresh HTTP=1。只补偿本次 session，不声称回包丢失自动回滚；未在 refresh→PG 保存间 kill API |
| SP-P1 备份恢复，T1/T2 | `backup-source.test.ts` 15 P；真实备份 CLI/PG 专项从 22 项扩至 31 P，再增至 **32 项**，这 32 项已包含于 02:33:09 最终完整 API integration 的 **162 P / 0 F / 0 S / 0 未捕获错误，退出 0**。见 [backup 源码清单](../../.results/v25/2026-09-08-development/b12-backup/source-manifest.json)及同目录日志，完整命令状态见 §5.4.3 | 实际 `inspect-source/inspect/stage` 子进程、隔离 0008 源库与当前目标库、原申请人 retry 激活/消费；错来源/owner/摘要、候选自证、跨申请、过期、损坏、refresh/logout 与 CAS 负例。合成受控 profile 证明工具行为，不替代真实部署/备份的独立审定，也不证明全部历史 run 的 payer |
| SP-P1 到期密文 / G-DATA-01，T2 | 02:10:30，`account-recovery-retention.integration.test.ts` **8 P / 0 F / 0 S**、退出 0、3.49 秒；[retention 摘要](../../.results/v25/2026-09-08-development/b12-recovery-retention/validation-summary.json)。02:21:30 完整 worker `test:integration` **6 文件 / 55 P / 0 F / 0 S**，51.94 秒；[完整日志](../../.results/v25/2026-09-08-development/b12-followup/worker-integration.log) | 真 PG + Graphile 清除到期 candidate/backup 密文，保留非秘密来源、清 lease、revision 只增加一次；有效证据/写锁保留、双 pool、1001 条积压与单侧满批。每次 cleanup 每类最多 1000 行，不是自然小时全局配额；8 项已包含于 55，不相加 |
| G-UI-01 会话删除，T1/T3 | features 两文件 **58 P**，typecheck/Biome 退出 0；重新构建后的双视口删除专项 **4 P / 0 F / 0 S / 0 flaky**，02:08:34 开始、28.6 秒。见 [Playwright 报告](../../tests/v25/.results/b12/mobile-session-delete/report.json)和 [专项日志](../../.results/v25/2026-09-08-development/mobile-session-delete/e2e-first.log) | 真实共享 UI/api-client，业务 API 为 route mock；手机不靠 hover，通过抽屉/44px 更多入口完成确认、取消、非当前/当前删除和空态。该产品性 skip 已移除；不代表真实 API 删除、真手机 Safari 或整张 G-UI 卡通过 |

身份故障首轮 2 P/1 F 是新主体壳状态的测试预期错误，修正为源码真实的 `verification_pending` 后通过，生产未改。备份专项早期 8 P/14 F、20 P/2 F、22 P、31 P 的原日志均保留于 `b12-backup/`；它们是逐次修复/扩展的记录，不能累加成新增通过量，也不能以最后一条局部 pass 抹除完整运行的错误。

#### 5.4.3 后续检查点：同源码本机门禁已通过

新源码合流后的首轮失败全部保留；随后 check 在原断言和原超时下复跑通过，API/worker integration、完整 E2E 与 source 扫描也已实跑成功。以下结果封存于 1223 项源码检查点；本机合流通过不等于 P1 全矩阵、整包迁移或发布完成：

| 门禁 | 最终结果 | 首轮失败与证据边界 |
|---|---|---|
| `pnpm run check` | [最终 check 日志](../../.results/v25/2026-09-08-development/b12-followup/check-final.log)：**退出 0，35/35 task、28 cached**；根 233 文件/2013 P，features 50/598 P，API 259 P/161 gated S，worker 63 P/55 gated S | [首轮](../../.results/v25/2026-09-08-development/b12-followup/check-first.log)34/35、根 2010 P/3 F：方案包条目上限、Skill ZIP 上限、SQLite 进程仲裁均命中 5 秒 timeout。此次原断言和原超时不变均通过，支持并发负载解释但不能绝对定因；gated skip 不替代 integration |
| 完整 API integration | [api-integration-verified.log](../../.results/v25/2026-09-08-development/b12-backup/api-integration-verified.log)：**实际退出 0，12 文件 / 162 P / 0 F / 0 S / 0 未捕获错误**；02:33:09 开始，13.41 秒；包含 backup 32 项和身份故障专项 | 02:21:24 原轮为 160 P/2 F；02:26:04 [第二轮](../../.results/v25/2026-09-08-development/b12-backup/api-integration-complete.log)162 项断言通过但有 4 个未捕获 PG teardown 错误，退出 1。等待连接实际关闭后再停容器，最终重跑成功；原失败保留，不由断言数推断退出成功 |
| 完整 worker integration | 当前 6 文件/55 P、0 F/S，已取得有效单独结果 | 最终来源清单如有 worker/共享 DB 漂移须复跑；无漂移可明确引用，不重复计数 |
| 完整三形态 E2E | **退出 0，242 P / 7 S / 0 F / 0 flaky，errors=[]**；02:35:32 开始，319.95 秒；PC Web 81 P/2 S、Mobile Web 80 P/3 S、Electron 81 P/2 S。[原始报告](../../tests/v25/.results/b12-followup/e2e/report.json)及 [project/skip 摘要](../../tests/v25/.results/b12-followup/e2e/summary.json)已归档 | 7 skip = 3 真实账号环境未注入 + 1 真实 Key 环境未注入 + 3 视口排除；移动删除产品性 skip 已消除。4 项删除专项与本套重叠，不相加；01:46 的 239 P/8 S 保留旧源码身份 |
| 0010 迁移 / replay | [backup integration 的 beforeAll](../../apps/api/src/__tests__/integration/account-backup.integration.test.ts)在一个隔离 PG 17 集群内创建独立 source/target 两库：source 精确 0008，target 先到 0009 并插入保留旧行；真实子进程 `pnpm --filter @musefold/db db:migrate` 连跑两次，各自退出 0；随后断言旧行仍为 1、备份证据表为 15 列 | 上述断言属于已通过的 32 项套件前置；不是两个独立集群，不是实际 dump restore，也没有将执行命令改写为根 `pnpm run db:migrate` |
| 源码身份 / 扫描 | 最终 [源码清单](../../tests/v25/.results/b12-followup/source-files.json)1223 项，摘要 `c19604bbf4ed04194700da5a7be0445c726b9598dcfaf2841fd5d467af66ae1a`，check 与 E2E 后 drift=[]；source 扫描 1127 文件/12,062,445 字节，0 findings/errors/accepted exceptions，退出 0 | 正式 clean checkpoint/manifest 仍由 G-BASE 收口；下一个测试增量不能沿用本清单身份宣称已包含 |
| 打包 / 生产 | 当前新增源码尚无 T4/T5 通过记录 | 后续 G-RELEASE 按精确产物、平台、CI、部署与回滚补验；B10 包只保留历史效力 |

#### 5.4.4 后续验收出口与保留限制

P1最后的refresh保存间kill与完整API/check增量已在§5.4.5收口，下一步SP-P2/P3。真实来源无法取得时保留具体外部前置，不能伪造运维审定。以下项仍待，旧检查点源码与数字保持原样：

- 独立可信的历史部署/备份来源、隔离恢复和真实运维演练；CLI 只能核对受控输入与字节一致性。证据不足保持可操作的受限恢复/独立空间，不回放旧 BA/OAuth 权限、不改历史付款人。
- live与backup的保存前SIGKILL现已分别验证明确重新认证/独立空间恢复；仍不能承诺上游与数据库跨系统回滚，旧一次性refresh丢失不会自动变回有效。
- SP-P2 的 expectedBinding 入队冻结及不可删除执行回执、SP-P3 worker 凭据版本发送仍未实施；现有 worker 回归不能证明旧排队任务使用可信付款绑定。P4/P5 托管发送/仅查询恢复和旧本地备份防重付尚未接通。
- 已知费用估算、Provider 返回值和成功状态不等于可信实际账单；Cloud MCP 七工具继续只读，管理员不能代批花费。
- 当前源码的安装包、Windows/原生平台、远程 CI、生产部署/回滚与外部 MCP 客户端证据仍待。

#### 5.4.5 P1 本机切片最后增量（09-08，已通过）

live relay与backup两条保存间隙分别使用真实生产API bin、PG阻塞观测、SIGKILL/新PID和自然30/120秒租约；明确重新登录或独立空间可继续使用，旧证据/数据不被冒领。live专项8项、完整backup33项均包含于下述API164项，不累加。真实部署历史来源与实际运维恢复仍依赖独立材料；本机实现与合成验收完成后直接接SP-P2/P3。

| 检查 | 最终结果 | 来源/边界 |
|---|---|---|
| 完整API | `pnpm --filter @musefold/api test:integration`，03:18:29，135.67秒；12文件/164 passed，0 failed/skipped/unhandled，工具退出0 | [原始日志](../../.results/v25/2026-09-08-development/b12-p1-final/api-integration-final.log)；同套件再次实际执行0010 CLI迁移/replay两次，退出0 |
| 全仓check | `pnpm run check`，35/35、31 cached，退出0；根233/2013、features50/598，API259 passed/163 gated skipped，worker63/55 gated skipped | [check日志](../../.results/v25/2026-09-08-development/b12-p1-final/check-final.log)；之前两份JSON报告格式错误导致31/35退出1，格式修正后复跑，未改生产或断言 |
| source扫描 | 1127文件、12,089,052字节；0 findings/errors/accepted，退出0 | [扫描报告](../../tests/v25/.results/b12-p1-final/security-source.json)；仍不是依赖漏洞审计 |
| 源码身份 | 1223项，摘要 `d7bd41e626af7317a6f014017549f1bc3ee90a33478be9bd2fbf951487adc7b7`；完整API/check后无漂移 | [最终摘要](../../tests/v25/.results/b12-p1-final/validation-summary.json)；与§5.4.3仅3个API测试/fixture不同，生产/schema/宿主/E2E字节相同 |
| 未变范围 | §5.4.3的E2E242 passed/7 skipped/0 failed/flaky、worker55项保留原报告，不因API测试增量重复运行 | 不是宣称新清单运行过另一份E2E；源码差异证明及前序报告关联见最终摘要 |

第一次新增164项合跑为163 passed/1 failed，备份case等待180秒和pool关闭10秒超时；后来确认同一测试PG的遗留JWKS使用另一合成BA密钥，生产bin首请求500、上游HTTP为0，裸barrier又未观察提前回包。统一测试部署secret、保留JWKS加密和ID、加入有界等待与全部清理后通过。首轮/三次诊断/最终日志和此前SQL、Biome失败均见[开发记录](./V25-DEVELOPMENT-LOG.md)，不抹除历史。

### 5.5 09-07 文档刷新验证（历史）

2026-09-07，Asia/Shanghai。本轮以文档交付为范围，检查已有实现与原始报告后修正过时描述，未执行生产动作。日志保存在 `.results/v25/2026-09-07-development/documentation-refresh/`。

| 检查 | 实际结果 | 结论边界 |
|---|---|---|
| 文档导航与任务结构 | 9 份关联文档、186 个相对链接可达；23 个 goal 索引与 23 张详细卡一致；代码块闭合、无尾随空格、单文件未超限 | 第一次发现路线图子任务号 `G-CLOUD-02.1/03` 有歧义，已改为完整编号并复核；不证明任务已实现 |
| 既有 repo 守卫 | 23:45 执行 `pnpm exec vitest run tests/repo/migration-evidence-manifest.test.ts tests/repo/file-size-limit.test.ts`：退出 0，2 文件/13 passed | manifest 结构和文件尺寸有效；不把未登记证据改成 pass |
| 文档 diff | 六份本轮修改文档的 `git diff --check` 退出 0；未跟踪文件另做静态检查 | 仅验证文档格式与引用，不代替源码门禁 |
| 原迁移包校验 | `check_spec_package.py --root <仓库根> --slug 2026-09-01_migrate-v21-to-v25 --compact`：退出 1，22/28，1 条 checklist 未勾 | 原迁移仍有开发/验收任务；文档可交付，整包不可报完成；B11 的 22/27 留作历史 |

该 09-07 文档轮没有执行新的全量 check、数据库迁移、E2E 或打包；这是当时 fixture/reader 准备阶段的历史结论。随后 09-08 的实际实施与验证已登记于 §5.4，不能把本段读作当前仍未执行。

### 5.6 B13：执行回执与发送身份（2026-09-08，本机实现与合成验收通过）

B13 对应 SP-P2/P3：契约/客户端、API 三个入队入口、PG 0011 与 worker 已通过本批专项和全仓 `check`。本节时间均为 Asia/Shanghai；B12 数字仍是历史检查点，不累加到本批。本批未重新执行 UI E2E、安装包、远程 CI 或部署；SP-P4/P5 桌面托管连接与仅查询恢复尚未接通，G-SPEND-02 和整包不因此完成。

#### 5.6.1 行为与验收映射

| 阶段 | 已验收行为 | 实际证据及边界 |
|---|---|---|
| T0 契约/客户端 | 稳定 binding 不含登录时间；期待字段不接收秘密/伪造授权会话；未知费用与零分开；查询 404/已清理结果不自动 POST；旧 retry 无 body 兼容 | 首轮 5 文件/59 项通过、三包类型检查通过；最终全仓 check 再覆盖当前源码。桌面托管 IPC 不在本批 |
| T1 PG 结构与恢复 | 有数据 0010→0011/replay；旧 binding/授权/摘要保持空；歧义旧 retry 为 legacy_unknown；普通 refinement 只保留原 run 的 parent；独立 key 在 run/方案/user 删除后继续占用；真实锁阻止凭据并发轮换 | 最终 PostgreSQL 17 专项 1 文件/5 passed；空库实际根 CLI 两次退出 0。两种迁移场景独立登记，详见下表及[迁移方案 §7](./V25-DATA-MIGRATION.md#7-执行回执增量与联合升级b132026-09-08) |
| T2 API 三入口与重放 | ordinary create / explicit retry / scheme run 同键仅一条 receipt/run/queue；查已有回执先于可变 prompt/原 run/新 Provider 校验；不同操作/输入/binding 冲突；真实 BA sessionId 与工作台 sessionId 分开；队列插入失败全部回滚 | API 完整 13 文件/188 passed，包含回执专项和旧账号/备份回归；历史 unbound 不借当前 payer 升级，旧已接受 Provider 值只读重放 |
| T2 素材与清理并发 | 方案对象读取/解码在入队锁外；最终事务重查权限、execution、锁定的 owner/revision/reference 元数据，再原子写 receipt/run/queue；慢读取期间可完成换 key、登出、素材到期/修订，随后旧提交拒绝且不留任务；purge/empty-trash/retention 保留回执，按 run→receipt 锁序，restore 先提交则不删 | 方案预检/回执/素材 3 文件/46 passed 已归并进 API 188；worker retention 随完整 83 项通过。worker 仍在实际发送前检查对象内容 hash，API 预检不能替代它 |
| T3 worker 发送 | 取完参考图后在 claim 事务重查 session/identity/issuer/owner/ref/version、authRevision、请求摘要、run epoch/lease 与 receipt；只使用事务返回的固定密文快照；两个竞争者最多一个 claim/HTTP；claim 后换 key 不替换已授权快照 | 真实 PG/loopback HTTP 权限专项 22 项包含在完整 worker 83 项中；旧 legacy、过期/撤销/版本不符在发送前拒绝。HTTP 401/已发送后未知仍为 unknown，不自动重试 |
| T3 进程退出与恢复 | 真正 fork `apps/worker/src/bin.ts`，production 模式正常发送一次、S3 保存、SIGTERM 退出 0/PG 连接清零；新 PID 重复投递不重发；PUBLIC_BASE_URL 不符时 HTTP 0；上游收到请求后 SIGKILL，新 PID reconcile 保留 claimed/unknown 且无二次 HTTP | 新生产入口 3 项已归并进 worker 8 文件/83 passed。另有隔离 task 子进程在 claim 后、fetch 前退出和旧 epoch/heartbeat 回归；两类入口证据不可混称。生产 bin 已在本机验收，容器/生产宿主仍未验 |
| T4/T5 合流与发布 | 当前源码全仓 lint/typecheck/unit/build/边界检查；保留范围清单及失败历史 | `pnpm run check` 35/35、0 cached、退出 0；source 扫描通过、最终 1243 项清单无漂移。本批未新跑 E2E、安装包、目标平台、远程 CI 或生产部署/回滚，不能把 check 中的 build 当安装验收 |

#### 5.6.2 首轮与最终结果

| 检查 | 真实命令及最终结果 | 报告与归并说明 |
|---|---|---|
| 空库实际 CLI | 10:52:17 开始，在任务拥有的 disposable `postgres:17-alpine` 上执行根 `pnpm run db:migrate` 两次：均退出 0，命令用时 1.030/0.884 秒；观察到迁移账本 12 项、receipt 22 列、run 关联存在、空库 receipt 0；容器清理退出 0 | [最终摘要](../../tests/v25/.results/b13/migration-summary-final.json)。03:51 首轮同命令通过的[原摘要](../../tests/v25/.results/b13/migration-summary.json)保留，发生于 refinement 回填修正前，不替代最终复跑 |
| 有数据 PG | 显式注入任务专用 `DATABASE_URL` 并开启 `RUN_DATABASE_TESTS=1`；`pnpm --filter @musefold/db exec vitest run src/__tests__/generation-execution.integration.test.ts`：10:52:24，1 文件/5 passed，Vitest 0.932 秒，包装命令 1.459 秒，退出/容器清理均 0 | [最终摘要](../../tests/v25/.results/b13/db-integration-summary-final.json)、[日志](../../tests/v25/.results/b13/db-integration-final.log)。测试另建自己拥有的隔离数据库，程序化先迁到 0010、造 5 条旧 run、迁 0011 并 replay，断言 4 条旧回执；不是整库 dump/restore。03:57 [首轮 5 项](../../tests/v25/.results/b13/db-integration-summary-first.json)保留为修正前历史 |
| API 最终完整 | `pnpm --filter @musefold/api test:integration`：11:04:04，139.60 秒，13 文件/188 passed，0 failed/skipped，退出 0 | [摘要](../../tests/v25/.results/b13/api-validation-summary.json)、[日志](../../tests/v25/.results/b13/api-integration-final.log)。此前 180 项全套通过后增加预检/并发回归，再完整跑 188；不是将两次累计。最终 88 文件摘要 `47fdf91176008de2600ee5d092bfc717a984d082a3ad7e20a3b703cacc42df68`，[复核无漂移](../../tests/v25/.results/b13/api-source-after-final.json) |
| API 定向与静态 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/generation-receipts.integration.test.ts src/__tests__/integration/design-scheme-assets.integration.test.ts src/__tests__/integration/design-scheme-runs.integration.test.ts`：3 文件/46 passed、5.13 秒、退出 0；`pnpm --filter @musefold/api exec vitest run src/modules/generation/__tests__`：2 文件/21 passed；API typecheck 和限定 16 文件 Biome 均退出 0 | 路径/日志见 API 摘要；46 项是完整集成的子集，21 项由全仓 check 再覆盖，不相加 |
| worker 最终完整 | `pnpm --filter @musefold/worker test:integration --reporter=verbose --silent=false`：10:58:48，26.99 秒，8 文件/83 passed，0 failed/skipped，退出 0 | [生产入口批摘要](../../.results/v25/2026-09-08-development/b13-worker-production-bin/validation-summary.json)、[完整日志](../../.results/v25/2026-09-08-development/b13-worker-production-bin/integration-complete.log)。22 项权限、3 项实际 bin 均在 83 内；旧 7 文件/80 passed [摘要](../../.results/v25/2026-09-08-development/b13-worker/validation-summary.json)保留，不含后来的 bin 修复与测试，不累加 |
| worker 定向与静态 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/production-bin.integration.test.ts`：3 passed；`pnpm --filter @musefold/worker test`：77 passed/83 gated skipped；typecheck、`pnpm exec biome check apps/worker`（27 文件）、限定 diff 均退出 0 | 最终 worker 17 文件摘要 `184e9221d612bdbeb90f3846c91b8ae5230629573bfd28bbca89e4f208875fdc`；旧清单的 15 文件无漂移，新增真实 bin 修复和就地测试另记。默认 test 的 gated skipped 已由上行真实 PG 集成执行 |
| 全仓 check | `pnpm run check`：11:11:04–11:11:47，35/35、0 cached、退出 0；根 238 文件/2055 passed/5 gated skipped，features 50 文件/598 passed，API 271 passed/187 gated skipped，worker 77/83 gated skipped，DB 39/5 gated skipped | [摘要](../../tests/v25/.results/b13/check-summary.json)、[完整日志](../../tests/v25/.results/b13/check.log)。各包统计不能直接相加为独立场景总数；API 完整集成的 188 还含非 gated detail 用例，不能与默认 187 skipped 一一等号。本批实际 PG 已独立运行，skip 不是其通过依据 |
| source 扫描与最终冻结 | `node scripts/security/scan.mjs source --report tests/v25/.results/b13/security-source.json`：11:12:36，1147 文件、12,461,286 字节，0 findings/errors/accepted，退出 0；1243 项源码在 check 前后无漂移 | [扫描报告](../../tests/v25/.results/b13/security-source.json)、[统一摘要](../../tests/v25/.results/b13/validation-summary.json)。源码摘要 `bec320e638a2b1dd413b22c40375fe35d8db7fbf29cf2bf576d24a6ff7285eeb`；未提交 dirty 工作树检查点，非干净 commit。内容扫描不是依赖漏洞审计或安装产物扫描；B14 后续变化另记 |

本批命令只使用隔离 PG、合成账号权限、loopback Provider/S3；API/worker `test:integration` 自动开启数据库门禁并管理测试基础设施，DB 专项则要求显式提供任务专用数据库环境。不得复制报告里的合成标识去操作正式库，不能打印实际连接串、bearer 或 key。

#### 5.6.3 失败记录与修复后的复跑

以下记录保留原日志；后续通过不改写首轮结果。数字是当轮结果，不累计为验收数量。

| 失败/发现 | 结果与原因 | 修复及复跑证据 |
|---|---|---|
| API 回执首轮 | `api-receipts-first.log` 2 passed/14 failed；合成 queue 计数误从 Graphile 公共 view 取 payload，方案 fixture 缺 size/quality。诊断轮 `api-receipts-diagnostic.log` 14 passed/2 failed，明确仍是缺少必需字段 | 修 fixture 与观测 SQL，保留生产校验；`api-receipts-fixed.log` 16 passed，最终 188 再覆盖 |
| API 完整首轮 | `api-integration-first.log` 179 passed/1 failed、退出 1；资产迁移 fixture 已经由 0009 生成未验证 identity，测试再插同 PK | 仅允许 fixture 显式替换已知 unverified/recovery_required 行，不放宽生产身份规则；`api-integration-fixture-fixed.log` 180 passed，之后新增预检回归的最终全套为 188 |
| API 预检与静态 | 首/二轮 typecheck 分别发现内部素材集合缺 DB 推导类型、测试使用未配置的 Promise.withResolvers/未归一 Hono 返回值；Biome 首轮拒绝 finally 内 throw；预检合跑首轮 40 passed/6 failed，图像 fixture 没声明 image slot，真实 prepare 在屏障前拒绝 | 使用 DB insert 推导类型、本地有界 barrier、Promise.resolve、全部清理后聚合抛错与 canonical image input；保留拒绝断言。最终 46、188、类型/Biome 通过；全部日志名见 API 摘要 |
| DB 回填/清理锁序审查 | 首轮 5 项已过后发现 receipt.sourceRunId 误承接普通 refinement parent；另发现 API 原 purge 锁序与 worker retention 相反，restore 竞争会使用旧快照 | 0011 仅歧义旧 retry 写 source，增加 refinement seed；最终 PG 5 项重跑通过。清理按 run→receipt 加锁并锁后重查，API/worker 真 PG 回归通过；不把审查发现编造为一次失败测试 |
| 根 Biome 预检 | `biome-preflight.log` 退出 1，生成的 DB snapshot 格式与 journal 末尾换行不符合格式要求 | 仅格式修正两份 JSON 后完成最终实际 PG/全仓 check；`migration-format.log` 和统一摘要保留，不能说最终 check 首次失败或生产 SQL 执行失败 |
| worker 普通单测首轮 | `b13-worker/unit-first.log` 76 passed/1 failed/79 gated skipped；旧断言仍期望 lease 文案，当前发送权限拒绝使用新的固定文案 | 对照生产语义修断言，未改拒绝行为；最后 77 passed/83 gated skipped，完整集成 83 passed |
| worker 实际生产入口首轮 | `b13-worker-production-bin/integration-first.log` 3 failed：业务断言已完成，但 SIGTERM 退出 1；`exit-diagnostic.log` 1 failed/2 skipped，确认 Graphile 默认信号处理器已 stop，bin 再 stop 抛 `Runner is already stopped` | 生产 bin 禁用 Graphile 的信号处理器，由入口统一处理；防重复信号，依次 await runner.stop、销毁 S3、关闭 PG，失败静态诊断并退出 1。修复后定向 3/完整 83 通过，实际 SIGTERM PID 均退出 0、观察到剩余 PG 连接 0 |

#### 5.6.4 明确限制与下一阶段入口

- 本机实际 production bin 使用 Node/tsx 直接 fork，`NODE_ENV=production` 且最小环境；不是部署容器、打包可执行文件或生产主机验收。先前 task 测试入口与新增真实 bin 证据分别保留。
- worker 杀进程恢复在确认 PID 退出和 PG 断开后，对任务拥有的数据库显式调用 `force_unlock_workers` 并使应用 lease 到期；证明重新认领不重发，**不证明自然超时等待**。SIGTERM 用例每个正常退出 PID 发送一次；重复信号保护已有实现，但没有独立的同时信号故障矩阵。
- 本地 loopback S3 明确 HeadBucket 成功，CreateBucket fallback 未使用；收到图片/HTTP 200 不等于真实扣费。当前 gateway 没有可信上游账单接入，已 claim/已发后成本维持 unknown/null；404、失败、取消、无资产均不能推导为免费。捕获子进程输出未出现合成 credential canary，不代替所有部署日志的审计。
- 本批仅保护已持久化的回执/key。迁移前已硬删、无证据的旧键无法重建；真实历史来源审定、旧备份恢复时不覆盖当前回执、联合升级/回滚仍需运维任务独立验证。
- 接续 SP-P4 明确的账号托管图像连接、local call→remote receipt 持久映射和 query-only 恢复；旧 BYOK/旧 managed Provider 不自动改付款主体。SP-P5 参考图/R/S、实际账单、云 Agent、全资产和发布仍开放；管理员后台是当前 goal 已授权的后续阶段，必须在剩余 v2.5 任务全部闭合后启动，不能代用户批准费用。

### 5.7 B14：同源下载准备（2026-09-08，本机实现与合成验收通过）

本批为 SP-P4 的下载支撑切片：新增 `GET /api/v1/assets/:id/content`，由已登录用户通过第一方 API 读取自己的生成结果，服务端检查 S3 实际图片与 PG 元数据后返回附件。**完整 SP-P4 尚未完成**：桌面托管连接、提交/恢复适配器、local call→remote receipt 持久关联和桌面验收仍待后续切片。本节时间均为 Asia/Shanghai，不把 B13 或本批较早结果累加成新的通过总数。

#### 5.7.1 验收行为与实际证据

| 阶段/行为 | 已验证内容 | 证据范围 |
|---|---|---|
| T1/T2 读取权限与兼容 | 正常 BA 会话和 asset/run 双重归属校验；无会话 401，恢复态 403，外部主体/未知资产 404，均在 S3 前拒绝；无效 ID 或携带 URL/objectKey 查询参数 400。拥有者仍可读软删除历史，硬删后 404；原 `/assets/:id/url` 302 保留 | `generation-asset-content.integration.test.ts`，真实 BA 实现、隔离 PG 与 loopback S3；权限行和 bearer 为合成 fixture，不是上游账号登录验收 |
| T2 传输、长度与错误 | 仅从服务器配置的 bucket/数据库 objectKey 读取；一个请求、无内部重试或跳转。声明长度和实际累计均受 30 MiB 限制，拒绝空成功、超大声明、无声明的超大流、合法正 Content-Length 对应短体、途中断开。错误响应在 AWS 解析前销毁，空体 404/XML NoSuchKey 均保留静态 404，其他异常为静态 503 | `asset-content-storage.test.ts` 14 项真实 HTTP；不回显 endpoint/objectKey/凭据，错误体不继续解析或转发。存储层正常读取故意返回错误的 HTTP MIME，最终 MIME 以解码为准 |
| T2 内容一致性与上传限制 | 图片完整解码，只接受静态 PNG/JPEG/WebP；尺寸/像素/字节/sha256 与 PG 一致。异常 SVG、截断图片、hash/MIME/尺寸/长度不符均拒绝；大于 20 MiB 且不超过 30 MiB 的合法 PNG 下载成功，同一图片使用上传默认 decoder 仍被拒绝 | 原公共上传 20 MiB 保留；30 MiB 是生成输出读取的显式服务器策略，未放宽上传路由。复用 decoder 的格式、动画、尺寸回归随就地 45 项覆盖 |
| T2 读取期间 purge/替换 | S3 hold 期间可以真实提交 purge 或对象键替换；读取没有跨网络持有 DB 锁；最后重新查询归属/元数据，变化则 404，不返回旧快照 | content 集成的两个并发用例；成功及指定拒绝/并发场景核对 receipt/event/Graphile job 无新增，New API 调用计数为 0 |
| T3 真实客户端取消 | 本机临时 `createServer(getRequestListener(app.fetch))`，真实 fetch/bearer 进入 BA→PG→S3，等到 S3 hold 后取消客户端；独立 2 秒窗口内观察 S3 response close，早于该用例配置的 30 秒读取 deadline | 使用真实 `@hono/node-server` listener，验证路由 `raw.signal` 接线；释放 barrier/关闭 listener 的 finally 在断言之后，不能由清理动作代替 abort 证明。另有已取消时 HTTP 0、部分 body 取消、200 ms 测试 deadline 的存储专项 |
| T1/T4 合流 | API 完整集成、就地测试、typecheck、限定 Biome、全仓 check 与 source 内容扫描 | 下表均有实际退出码；本批没有新增 UI E2E、安装包、专门 DB 迁移批次或部署证据 |

#### 5.7.2 最终结果、清单与去重

| 检查 | 实际命令与最终结果 | 原始报告/限制 |
|---|---|---|
| 完整 API 集成 | `pnpm --filter @musefold/api test:integration`：11:43:27，138.05 秒，14 文件/211 passed、0 failed/skipped，实际退出 0，进程已结束 | [API 摘要](../../tests/v25/.results/b14/api-validation-summary.json)、[完整日志](../../tests/v25/.results/b14/api-integration-final.log)。包含 23 项 content 与原账号/备份/回执/方案回归；这是完整复跑，不是把专项数量加到 B13 的 188 上 |
| 同源内容/HTTP 边界 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/generation-asset-content.integration.test.ts src/modules/generation/__tests__/asset-content-storage.test.ts`：11:41:35，5.75 秒，2 文件/37 passed，0 failed/skipped，实际退出 0 | [日志](../../tests/v25/.results/b14/http-boundaries.log)：23 content + 14 storage。23 已包含于完整 API 211；14 也被就地/默认测试收集，不重复累计 |
| 就地逻辑/解码/存储 | `pnpm --filter @musefold/api exec vitest run src/modules/generation/__tests__ src/modules/design-scheme-assets/__tests__`：11:42:41，0.730 秒，5 文件/45 passed，0 failed/skipped，实际退出 0 | [最终日志](../../tests/v25/.results/b14/api-unit-verified.log)；早先 `api-unit-final.log` 44 passed 是增加短体案例前的检查点 |
| 类型与 Biome | `pnpm --filter @musefold/api typecheck` 退出 0；限定本批 12 文件 Biome 退出 0，0 errors、**1 warning** | [类型日志](../../tests/v25/.results/b14/api-typecheck-verified.log)、[Biome 日志](../../tests/v25/.results/b14/api-biome-verified.log)。warning 为 `s3-signer.ts:142` 的 `lint/complexity/useOptionalChain`，冻结后未为此修改源码；不能写“0 warnings” |
| 全仓 check | `pnpm run check`：11:47:14–11:47:33，35/35、28 cached，实际退出 0；根 238 文件/2055 passed/5 gated skipped，features 50 文件/598 passed，API 285 passed/210 gated skipped，worker 77 passed/83 gated skipped | [check 摘要](../../tests/v25/.results/b14/check-summary.json)、[日志](../../tests/v25/.results/b14/check.log)。210 个 gated 场景由完整 API 211（另含非 gated detail）独立执行；worker 是原缓存输出，本批未新跑 worker 集成，保留 B13 的真实 83 项报告及原范围 |
| source 扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b14/security-source.json`：11:43:54，1151 文件、12,496,956 字节，0 findings/errors/accepted、退出 0 | [扫描报告](../../tests/v25/.results/b14/security-source.json)。只证明该规则集下的源码内容扫描，不代替依赖漏洞、已安装产物或部署扫描 |
| 冻结与范围差异 | API 92 文件摘要 `e0987f28cb288fd7f6a0236534e2d28eff38ff200cb5e8615e58173650b51e7f`，完整集成前后无漂移；全仓 1247 项摘要 `389ac3ff537775777eea4de7c72b3e4c75a292e94802d7f13fa235e58e5d2c72`，API/check 后无漂移 | [API 最终清单](../../tests/v25/.results/b14/api-source-after-final.json)、[全仓清单](../../tests/v25/.results/b14/source-files.json)、[相对 B13 差异](../../tests/v25/.results/b14/source-delta-from-b13.json)：12 文件全部在 apps/api；未提交本机检查点，不是干净 commit、远程 CI 或发布 |

API `test:integration` 自动启用 RUN_DATABASE_TESTS 并创建 disposable PostgreSQL；以上命令不需要真实上游账号或付费凭据。报告中的运行环境均为合成配置，不输出实际 bearer、key 或数据库连接串。全仓统计含缓存与相互覆盖的套件，不相加为独立场景总数。

#### 5.7.3 前序检查点与失败记录

- `storage-first.log`：13 passed/退出 0，尚未加入合法正长度短体；`content-integration-first.log`：21 passed/退出 0，尚未加入 malformed/query 与真实 HTTP 客户端断线用例。
- `content-integration-combined.log`：11:37:44，7.15 秒，4 文件/68 passed/退出 0；当时为 content 22 + receipt 24 + scheme assets 13 + scheme runs 9。它是阶段组合结果，不替代后来 23 项 content 或完整 211；与最终结果不累加。
- `api-typecheck-second.log` 实际退出 1：fixture 被推导为过窄的 `Buffer<ArrayBuffer>`，集成赋入 `Buffer<ArrayBufferLike>` 时 TS2322。修正合成 fixture 的 Buffer 类型后第三轮和最终类型检查通过；没有放宽生产图片验证或测试断言。原始[失败日志](../../tests/v25/.results/b14/api-typecheck-second.log)保留。
- 初次只读审查发现：若在读取 HTTP 状态前对所有响应应用“Content-Length 必须大于零”，合法空体 404 会被误转成可重试 503。实现改为先按状态拒绝并销毁错误体，保留静态 404；空体/XML 两种缺失在 storage 和 content 集成均有回归。该问题是**源码审查发现并修复**，没有对应的实际失败测试轮，不编造失败数量。
- 限定终审核对了真实临时 listener 的断线链路、2 秒观察窗口、S3 30 秒配置及短体拒绝；没有新增必修问题。较早“仅存储层 AbortController、尚无 API HTTP 断线”和“尚无正长度短体专项”的限制已由上述增量解除，不应继续登记为未覆盖；production bin/容器的边界仍保留。

#### 5.7.4 仍未验证的范围与接续入口

- 真实 HTTP 断线证据来自本机临时 Hono listener，不是 `apps/api/src/bin.ts` 子进程、部署容器或真实终端网络。存储专项缩短 deadline 来验证有界行为；不能说已经逐次自然等待生产 30 秒超时。
- Sharp 解码已有 10 秒超时，signal 在解码前后检查，不能即时取消正在进行的解码。最后元数据复查是此次读取的线性化时点；其后发生 purge 无法撤回已经交付的字节。
- 本批未改 PG schema、未独立执行根 `pnpm run db:migrate` 或新的迁移验收批次；API 集成自身的建库/迁移初始化属于集成前置。未新跑 worker 集成、UI E2E、package/installer-smoke、远程 CI、生产部署/回滚或付费接口。不能把 check 内的 build/缓存输出称为这些已执行。
- 接续 SP-P4：把明确的账号托管图像连接、预算确认、冻结身份提交、local call→remote receipt 和仅查询恢复接入桌面，再通过同源内容接口下载资产。此次只读下载不新建生成/回执/队列，不补足付款状态、真实账单或旧本地备份防重付；旧 BYOK 不自动改绑。SP-P5 和剩余 v2.5 任务继续开放，管理员后台按当前 goal 授权在迁移任务全部闭合后启动。

### 5.8 B15：桌面防回退基础（2026-09-08，本机验收通过）

本批只完成 SP-P4-D1：SQLite 检查点、独立密文控制文件和事务协调协议。**正式 safeStorage 装配、预算/远端关联全入口、restoreBackup 与托管发送还未接线，完整 P4 仍开放。** 本节时间为 Asia/Shanghai；[统一摘要](../../tests/v25/.results/b15/validation-summary.json)保存命令、退出码、源码与证据适用范围。

#### 5.8.1 行为、故障与验收出口

| 场景 | 实际实现/测试 | 验收结果 |
|---|---|---|
| 旧库升级 | 真实 0007 结构写入预算 6、已用 2.5，再应用 0008/replay；检查外键和 integrity_check；原 0006→0007 用例仍保留 | 数据保留、检查点为空；迁移和读取不生成 namespace/锚或开启托管 |
| 安全事务 | 先落 pending 锚，再 SQLite IMMEDIATE CAS 同事务修改预算示例和检查点，最后提交锚；同 scope 的两个实例串行 | stale CAS 不执行回调；回调失败回滚业务和检查点，保留 pending 限制；原生 async 回调在执行前拒绝，外层事务拒绝 |
| 写失败 | pending 写失败、DB 回调失败、最终锚写失败 | 第一种不改 DB；第二种保留旧 DB 与 pending、只核对；第三种仅在 DB 精确匹配 pending.to 时补齐锚，不降低版本 |
| 真实进程崩溃 | 独立 Node/tsx 子进程在 pending 已持久化、DB 已提交、锚已提交三个实际时点暂停；父进程 SIGKILL，观察 close，再以新 PID 打开同一 SQLite/文件 | 三时点分别为只核对、可补齐锚、记录一致；合成调用方 HTTP POST 都为 0。成功对照 POST=1；这是 core 返回边界，未证明正式托管调用恢复 |
| 真实旧备份 | 通过 SQLite backup API 保存 revision=0 的旧库，完成 revision=1 操作并正常关闭全部持库进程，再替换 DB 文件 | 新进程检测不一致，拒绝新预算变更；不覆盖锚、不重发合成请求。该测试没有调用正式 restoreBackup |
| 文件与异常 | 明文 16 KiB、密文 64 KiB 上限；临时文件 flush/原子替换；显式链接检查与 O_NOFOLLOW，拒绝目录/FIFO；解密、损坏、缺失和超限 | 读取不自动修复；失败用固定错误；加密失败保留旧文件；Unix 新文件 0600。测试使用合成 AES-GCM，未替代真实 safeStorage 验证 |
| 恢复限制 | restore_pending 先持久化；仅显式恢复匹配的安全检查点 | 旧/新/同 revision 不同 hash 均不能自动覆盖另一侧；guard active 只表示记录一致，不授权旧调用重新 POST |

#### 5.8.2 实际命令、结果与源码对应

| 门禁 | 实际结果 | 证据 |
|---|---|---|
| SQLite generate/bundle | 初次生成 0008，bundle 9 项；最终 `db:generate` exit 0，No schema changes；`db:bundle` exit 0 | [生成复核](../../tests/v25/.results/b15/migration-generate-final.log)、[bundle](../../tests/v25/.results/b15/migration-bundle-final.log)。初次命令只有工具退出证据，没有补造原始日志 |
| 定向回归 | 12:20:17，根 vitest 指定 6 文件：guard、managed process、managed schema、旧 spend、旧 spend process、bundle freshness；52 passed，0 failed/skipped，exit 0 | [实际命令与时长](../../tests/v25/.results/b15/unit-final-summary.json)、[输出](../../tests/v25/.results/b15/unit-final.log) |
| 全仓 `pnpm run check` | 12:19:13–12:19:42，35/35、0 cached，exit 0；根 241 文件通过/1 gated 文件跳过，2082 passed/5 skipped；features 598 | [命令摘要](../../tests/v25/.results/b15/check-summary.json)、[输出](../../tests/v25/.results/b15/check.log)。包含 lint/types/单测/边界与双端构建；存在依赖构建提示，不等于零 warning |
| Electron | 12:16:00–12:19:00，`pnpm exec playwright test -c tests/v25 --project electron`；81 passed/2 skipped/0 failed/flaky，exit 0，真实构建和窗口 | [报告](../../tests/v25/.results/b15/electron-report.json)、[命令](../../tests/v25/.results/b15/electron-summary.json)。跳过 live 账号 CRUD 与真实 TvT key 用例，未提供真实凭据；本批未新跑 Web 项目 |
| 最后审查与产物对应 | E2E 启动后对未接入宿主的两个新模块补显式链接检查、修正加密注释；随后完整 check/定向测试重跑 | [两文件差异](../../tests/v25/.results/b15/review-delta.json)、[21 项 Electron 构建字节对照](../../tests/v25/.results/b15/electron-build-comparison.json)均明确记录。最终重建与 E2E 所测产物完全一致；没有伪造一次“最终修改后重跑 Electron” |
| 内容扫描 | 12:20:17，1162 文件、12,616,719 字节；0 findings/errors/accepted，exit 0 | [source 报告](../../tests/v25/.results/b15/security-source.json)；不等于依赖漏洞审计或安装包扫描 |

最终源码/配置/资源 1258 项，摘要 `be7e16cb31f1f54488efd403e1e96ae2d2ddc707e2c5ff48bc41da6cbd4a3edc`，工作树未提交。相对 B14 仅 16 个 core/desktop-contracts/desktop-db 文件变化，见[差异清单](../../tests/v25/.results/b15/source-delta-from-b14.json)；API/worker/PG/宿主和 UI 源码未变。根 check 中 API 285 passed/210 gated skipped、worker 77/83、DB 39/5 是默认单测口径，本批未重跑真实 PG/API/worker 集成；B13/B14 集成仍保留原批次身份。52 是 2082 的子集，不能相加。

#### 5.8.3 前序结果、审查修复与限制

- 首轮 3 文件 34 passed；损坏密文 fixture 触发 AES-GCM 短 tag 弃用提示，测试加密器显式要求 16 字节 tag 后消除。随后 5 文件 47 passed，增加 FIFO 与旧进程回归后 6 文件 52 passed。均有原始日志，未发生被隐藏的测试失败。
- 审查发现仅在 async 回调返回后拒绝 Promise 不能阻止后续执行，改为调用前拒绝原生 async 并增加回归。普通回调仍必须是受信的同步 SQLite 代码，检测 thenable 不能取消任意异步工作。
- 初次全仓 check 35/35、0 cached；最终文件链接/注释修正后再次 35/35、0 cached。前序源码与日志保留 `pre-review-*`，未覆盖为最终证据。
- 同一目录必须由单宿主独占；scope mutex 只覆盖同进程实例。Unix 使用目录 fsync，Windows 未原生验证且不承诺断电持久性；DB 与锚同时被外部回退仍不能只靠本地判定。
- 不触正式用户数据库、真实付费调用、生产服务或管理员端。下一步按任务卡 P4-D2/D3 与 P4-E1 接线，再做实际桌面提交/恢复的端到端矩阵；本批的 Electron 通过是既有行为回归，不是尚未接入 guard 的生产保护证明。

### 5.9 B16：主进程安全存储与正式备份恢复（2026-09-08，本机验收通过）

本批接 SP-P4-D2 的宿主支撑，正式 restoreBackup 已使用安全存储锚与数据库访问隔离。显式账号托管连接、首个 POST 前的远端关联、预算全入口、回执及用户核对/恢复准入仍未接通，不能据本批宣称完整 P4 或旧备份防重复付费完成。时间为 Asia/Shanghai；原始日志位于 `tests/v25/.results/b16/`。

#### 5.9.1 功能与证据对应

| 验收点 | 实际行为 | 证据范围 |
|---|---|---|
| 正式 OS 加密 | 直接调用 Electron safeStorage；不可用/Linux basic_text 拒绝；Windows 等待 Local State 密钥记录，20 秒超时拒绝写锚 | security 4 项含模拟 Windows 时间推进；真实 macOS Electron 经生产适配器读取并更新锚。没有 Windows 原生或断电证明 |
| 数据库访问隔离 | 恢复进入隔离后 getDb/initDb 不可用，closeDb 不解除；异步访问 token 因 epoch/连接变化失效，旧句柄关闭后无法写新库 | core 初始化与正式恢复单测；真实 Electron 恢复后再次 IPC 写入拒绝、新 PID 可以读恢复库 |
| 正式恢复顺序 | 排他校验原文件与 staging → 进入 DB 隔离 → abort/drain 已登记托管操作 → 停同步 → 独立安全快照 → restore_pending → 关库/替换 | 真实 SQLite 和文件；阻塞任务收到 abort 后未退出时不关库，新登记工作与并发恢复被拒绝；drain 超时不继续替换 |
| 备份版本 | 核对 quick_check、user_version 和当前已知 Drizzle 前缀 | 未来/改写/缺段迁移链在修改当前库前拒绝；旧正常备份可用。没有新增 SQL migration |
| 安全副本 | `recovery-safety-*` 使用一致性快照、文件 flush 和适用目录 flush；普通十份 prune 不处理该前缀 | 真实数据恢复为旧值，安全副本保留恢复前新值；额外制造十五份普通备份再 prune，安全副本仍存在且可列出 |
| 失败与重启 | 锚异常阻止替换；安装失败回迁原文件但本 PID 保持隔离；不在 catch 中重新 initDb；安装后的清理失败不反向回滚 | 真实文件故障注入与新 PID；无旧标记用户不创建锚，已损坏锚不自动重生。没有宣称任意断电/整机快照可恢复 |
| 用户出口 | 普通坏备份保留确认重试；隔离失败关闭确认框、禁用当前卡再次备份/恢复并给显式重启；成功仍自动调用 relaunch | 共享设置专项新增用例；最终 Electron 损坏锚场景经可见设置操作走正式 IPC。保留说明准确区分普通十份与安全副本 |

#### 5.9.2 实际运行与适用清单

- 核心恢复/OS/域/初始化专项：12:40:17，4 文件 **42 passed**、0 failed/skipped，vitest 0.846 秒，actual exit 0；[日志](../../tests/v25/.results/b16/unit-third.log)。12:33 首轮 3 文件 34 passed；增加迁移链测试后两轮失败记录见下文。
- 共享设置：12:47:28，`pnpm --filter @musefold/features exec vitest run src/settings/__tests__/settings.test.tsx`，**53 passed**，exit 0；[命令摘要](../../tests/v25/.results/b16/features-settings-summary.json)。该数为 features 599 的子集。
- 最终全仓：12:48:19–12:48:45，`pnpm run check` **35/35，26 cached，exit 0**；根 **2099 passed/5 gated skipped**（243 文件通过/1 gated 文件），features **599 passed**。UI 调整前同批 check 为 35/35、0 cached，根 2099/features 598；不把两轮相加。[最终命令](../../tests/v25/.results/b16/check-final-summary.json)、[输出](../../tests/v25/.results/b16/check-final.log)。API 285/210 gated、worker 77/83 gated、DB 39/5 gated为默认门禁口径，本批没有重跑真实 PG/API/worker 集成。
- 先行 Electron 恢复专项：12:42:04–12:42:11，2 passed、exit 0，使用正式 IPC/safeStorage/真实重启；[报告](../../tests/v25/.results/b16/electron-restore-report.json)。UI 修改前完整 Electron：12:43:15–12:46:19，83 passed/2 skipped/0 failed/flaky，exit 0；[前序报告](../../tests/v25/.results/b16/electron-pre-ui-report.json)。这些保留为前序证据，最终三形态报告另记。
- 最终 source 扫描：12:48:59，**1167 文件、12,653,335 字节，0 findings/errors/accepted，exit 0**；[报告](../../tests/v25/.results/b16/security-source-final.json)。不是依赖漏洞审计或安装产物扫描。
- 当前源码/配置/资源 **1263 项**，摘要 `bd0343b02397c79f41cef13cb9f82ee65bc41f8b7d2ee0abd35dec580578ddb4`；相对 B15 的 [12 文件差异](../../tests/v25/.results/b16/source-delta-from-b15.json)仅在 core DB、桌面安全存储/恢复/域、共享备份卡和测试。工作树未提交，不是干净 commit。UI 前源码另存 `pre-ui-source-files.json`，不能把其 E2E 冒充最终源码的完整验收。

最终 `pnpm run test:e2e` 于 **12:48:57–12:54:54** 运行并退出 0，包含先构建 Web/Electron 再执行三项目。**244 passed / 7 skipped / 0 failed / 0 flaky**：Web desktop 81/2、Web mobile 80/3、Electron 83/2。跳过为三项真实登录（未注入凭据）、一项真实 TvT key 和三项不适用视口场景；没有跳过恢复验收。最终损坏锚用例经可见设置 UI 操作，验证确认框关闭、重新备份/恢复禁用、显式重启按钮可达及新 PID 保留异常锚。报告见[完整 E2E](../../tests/v25/.results/b16/e2e-final-report.json)、[实际命令](../../tests/v25/.results/b16/e2e-final-summary.json)和[统一摘要](../../tests/v25/.results/b16/validation-summary.json)。最终 source 清单在 check/E2E 后无漂移，沿用既有视觉基线未更新快照。先行 2 项和 83 项均是阶段检查，不能再与最终 244 相加。

#### 5.9.3 失败历史与未完成边界

1. `unit-second.log` 为 35 passed/2 failed，`unit-os-first.log` 为 40 passed/2 failed：fixture 按 Drizzle 的可空 id 定位，MAX/MIN(id) 为 null，没有真正改写/删除迁移。当前 SQLite ledger 使用 SERIAL 而非 INTEGER PRIMARY KEY，不能假定自动编号；改用非空 created_at 定位并断言 changes=1 后，42 项通过。未放松迁移前缀校验。
2. 首次定向 Playwright 命令把文件名放在可变参数 `--project electron` 后，CLI 将它当作第二个项目，exit 1，未运行测试。改用 `--project=electron` 后两项通过；两份日志均保留。
3. B16 复制的 gate runner 起初保留 B15 输出目录，首次 check 两个新文件在退出后移至 B16，并修正 runner；未覆盖任何既有 B15 报告。原位置与迁移原因记录在 `check-first-summary.json`，不虚构另一轮 check。
4. 正式恢复的 Electron 锚由测试合成初始化，再由真实生产适配器处理；不新增只供测试的启用 IPC，不调用真实付费接口。新旧 PID 覆盖正常关闭/重启，不是本批新增正式宿主 SIGKILL 测试；B15 的 core 三时点 SIGKILL 保留其原适用范围。
5. `withManagedExecution`/work scope 已可供未来 POST/poll/download 使用，目前正式托管提交尚未接入；排空测试不证明真实云任务已取消或零费用。现有 BYOK、独立设计方案库、同步与预算的完整恢复组合仍需后续矩阵。
6. 安全副本现不自动清理，受控回收后续处理；Windows 原生、断电、DB+锚整套回退、真实账单、签名安装包、远程 CI/部署/回滚及管理员尚未完成。

### 5.10 B17：托管 G 持久关联与预算回执核心（2026-09-08，本机核心验收通过）

本批实现 P4-D3/E1 的核心协调器和增量 SQLite 0009，不开放正式桌面托管发送。记录以 Asia/Shanghai 计时，报告目录 `tests/v25/.results/b17/`。契约、core 数据/服务与 API 测试共 17 个源码文件相对 B16 变化；API/worker 的生产实现和 PG schema 未改变。

#### 5.10.1 验收范围

| 行为 | 本批实现与验证 | 仍需完成 |
|---|---|---|
| POST 前持久关联 | 原始请求、稳定 key、固定 binding/authEpoch、local call/run、发送状态及 receipt 落入受管 SQLite；登记和确认阶段已标记托管归属 | 正式宿主绑定准备、执行 port 和用户连接选择 |
| 原 key 恢复 | 内存首发资格只给本次新登记；记录 unclaimed 也不能在新进程恢复发送资格。四个真实 SIGKILL/新 PID 窗口包含登记后、claim 后、HTTP 已收但无回包及合成已 purge 回执 | 正式 Electron 付费路径/参考图/取消/下载的联合矩阵 |
| 预算与回执 | queued 保留预留，claimed/未知终态跨月保护；可信未发送终态归零，provider_reported 按原月计一次；重复/乱序不重复审计或金额 | 所有共享预算设置和老入口整体接入 guard；真实账单不在本批证明范围 |
| 身份与一致性 | key/operation/issuer/principal/binding/receipt/run 不匹配拒绝；同主体新登录可查旧凭据版本，另一账号不可接管；异步锚写后再验宿主访问 | 正式账号切换/登录 UI 与实际宿主 CAS 接线 |
| 失败保护 | 预检拒绝不写 pending；实际 SQLite 审计失败回滚 receipt/预算/checkpoint，锚保留 query-only；最后锚 commit 失败不给发送许可 | 完整用户核对/匹配备份恢复出口和多路径恢复 |
| 旧路径兼容 | 通用 recover 不结束托管请求，直接旧 claim/complete/finish/确认写拒绝接管；旧 0008 升级为空关联表，保留预算；既有 BYOK 单测回归 | 产品启用后所有共用额度操作仍须联合验收 |

#### 5.10.2 实际结果与源码身份

- 新专项首轮：13:13:17，契约和账本两文件 **40 passed**；增加真实进程测试后 13:16:13 三文件 **44 passed**。再增补跨月 unknown 与高版本状态倒退测试，最终 13:22:10 六文件（含既有 guard/spend 和 bundle freshness 回归）**82 passed / 0 failed/skipped**，exit 0；[最终命令](../../tests/v25/.results/b17/unit-final-summary.json)、[日志](../../tests/v25/.results/b17/unit-final.log)。这是根测试的子集，不能相加。
- `pnpm run check`：最终 13:20:54–13:21:29，**35/35、0 cached、exit 0**；根 **2145 passed / 5 gated skipped**（246 文件通过/1 gated），features **599 passed**，含双端构建、类型和依赖边界；[摘要](../../tests/v25/.results/b17/check-second-summary.json)。默认 API 285/211 gated、worker 77/83 gated、DB 39/5 gated 不是新一轮真实集成通过。
- 真 PG 回执专项：13:18:45，**25 passed**、exit 0，含新跨运行时场景：SQLite 子进程向实际 Hono/PG admission 提交，DB commit 后服务器扣住响应，SIGKILL；凭据轮换、新登录 epoch 后新 PID 查询原 receipt；取消、软删、purge 后再次新 PID 查询，**1 POST/2 GET、只保留 1 receipt**。主体及授权会话由 fixture 显式合成，API middleware 注入身份，服务层真实查 PG 授权；没有重新验证 Better Auth 登录或 Provider/S3 发送。[命令](../../tests/v25/.results/b17/api-receipts-second-summary.json)。最终完整 API 集成于 **13:22:09–13:24:39** 执行，**14 文件 212 passed / 0 failed/skipped，exit 0**；[完整命令](../../tests/v25/.results/b17/api-final-summary.json)、[日志](../../tests/v25/.results/b17/api-final.log)。该套件含既有自然租约和真实进程恢复回归，未以短超时替代。
- source 扫描：13:22:10–13:22:12，**1178 文件、12,798,674 字节，0 findings/errors/accepted，exit 0**；[报告](../../tests/v25/.results/b17/security-source.json)。不等同于依赖漏洞审计、安装产物扫描或生产安全验收。
- 当前源码/配置/资源 **1274 项**，摘要 `b8b9c7a2448a7cd243946502cb9aac8efe931f353ca47058f4b767c3d93742d7`，HEAD 仍为 `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交工作树；[相对 B16 的 17 文件差异](../../tests/v25/.results/b17/source-delta-from-b16.json)。格式修复前源码另存 `pre-format-source-files.json`，不继承其失败门禁为当前通过。最终 check/专项/API/Electron 后源码清单无漂移，统一结果见[本批摘要](../../tests/v25/.results/b17/validation-summary.json)。

#### 5.10.3 失败、重跑和证据限制

1. 首次 core typecheck 因通用返回值推导含 undefined 失败；给协调器显式泛型约束后通过，未取消返回值校验。初次类型错误输出在当前任务工具记录；修复后命令保存 `typecheck-second-summary.json`。
2. 首次真 PG 专项 **24 passed / 1 failed**，测试子进程路径多退了一级，ready 前退出。修正相对路径，并把新增测试中不存在的 softDelete 调用改为现有 remove 后，25 项通过；原始 `api-receipts-first.log` 保留。
3. 首次全仓 check 因新生成 Drizzle snapshot/journal 未按 Biome 格式化退出 1，其他正在运行任务被中断，其派生 esbuild 停止输出不作独立产品缺陷。只格式化新 snapshot 和 journal 后完整重跑通过；未改冻结面中的历史 lint 提示。
4. 本批核心协调器仍只有测试 transport 调用。未实现新的用户托管连接、自动启用、正式付费 POST/取消/下载、所有共享预算写入协调、匹配恢复 UI；不据此关闭完整 P4-D3/E1、G-SPEND-02、迁移整包或管理员前置。
5. 不新增 Windows 原生、正式签名安装包、真实历史备份材料、远程 CI、生产部署/回滚和付费账单结论；B16 完整 Web/Electron E2E 保留其原源码范围。本批不修改 UI，构建后 Electron 于 **13:21:54–13:25:00** 运行，**83 passed / 2 skipped / 0 failed/flaky，exit 0**；[报告](../../tests/v25/.results/b17/electron-report.json)、[命令](../../tests/v25/.results/b17/electron-summary.json)。跳过为未注入真实 key 与活体账号凭据；是既有宿主路径和正式备份恢复回归，不是尚未接线的托管产品 E2E。

### 5.11 B18：主进程托管 HTTP 与 core 执行接缝（2026-09-08，本机验收通过）

本批完成 P4-A/C 的账号和执行适配支撑，仍无正式用户托管生成调用方。时间为 Asia/Shanghai，报告目录 `tests/v25/.results/b18/`；macOS arm64、Node v25.8.1、pnpm 11.24.0。相对 B17 共 10 个源码/测试路径，无 UI、schema、API/worker 生产变更。

#### 5.11.1 实现、验收标准与实际证据

| 验收点 | 实现与断言 | 证据边界 |
|---|---|---|
| 账号捕获 | 只接已验证 principal；固定 issuer/authEpoch，异步后重读持久会话。账号变更在等待慢订阅者前令旧同步 guard 失效；迟到 401 不清新登录 | 真实 account-domain 方法与测试凭据存储；客户端 HTTP 套件注入捕获账号，不能当作新一轮真实 BA 登录 |
| 单次首发 | 当前 binding 查询与严格身份校验 → B17 claim → 固定 raw body/key POST；POST 回包不能独自释放预算，随后只读 receipt | 真回环 HTTP、SQLite、账本和加密锚文件（合成 cipher）；首发1 POST/2 GET，重复调用不再 POST；不是本批真实 PG admission 或付费 Provider |
| 未知结果 | 坏 POST 回包保留 unknown，之后 GET 可核对；receipt 404 保留 unknown，不生成新 key 或释放费用 | 实际 HTTP 次数与预算状态联合断言；既有 B17 真实 SIGKILL/PG 证据保留原源码范围 |
| 传输边界 | 只使用捕获 issuer 的内部路径；禁止重定向；JSON 1 MiB 上限，默认完整请求/读取15秒期限；不回显错误正文或 bearer | 超长 header/stream、坏 JSON、非 JSON、重定向、阻塞响应体测试；期限测试注入100毫秒，不宣称等待过完整15秒 |
| 生命周期 | 工厂接 B16 withManagedExecution；恢复排空 abort 并等待 HTTP 结束；工厂回调退出后 retained client/ledger 失效 | 真实 work scope 和 HTTP body 阻塞/中止；新客户端尚无用户入口，因此不是正式生成途中点击恢复的端到端验收 |
| core transport | 不含 Provider Key，接 raw prompt，拒绝 port/provider 不匹配、与旧 execution 混用及普通本地 retry；异步后身份失效不写资产或晚到终态 | core 真 SQLite 与注入 transport；旧 Provider 行为回归；尚无主进程 poll/download→core 成功链 |
| 启动恢复兼容 | createDesktopGenerationPersistence 的本地终态补记排除已有 managed 关联，不再误 finish 或导致初始化失败 | 真 SQLite 与实际启动补记函数，托管请求仍 running/unknown，零外部发送；BYOK 既有用例保留 |

#### 5.11.2 分阶段命令与结果

1. **T1 定向类型与测试**：13:38:29 `pnpm run typecheck` exit 0。13:41:49 四文件专项 **36 passed / 0 failed/skipped**（client15、account6、durable-generation8、core7），exit 0；[实际命令](../../tests/v25/.results/b18/unit-second-summary.json)、[日志](../../tests/v25/.results/b18/unit-second.log)。前序2文件13项、client15项是同组子集，不累计。归档 fixture 修复后 13:46:33 单文件 **4 passed**，原5000毫秒期限未改；[日志](../../tests/v25/.results/b18/archive-fix.log)。
2. **T2 HTTP/SQLite**：已包含在上述36项，真实进程内 HTTP listener、受管 SQLite 和锚协调共同运行。没有另跑 API/worker 真 PG 集成或数据库迁移；B17 的 API212项保留其原批次，不能写成本批通过数。
3. **全仓门禁**：13:46:55–13:47:13 `pnpm run check` **35/35、30 cached、exit 0**；根 **2167 passed/5 gated skipped**（247文件通过/1 gated），features **599 passed**。类型、双端 build、lint、依赖边界按脚本执行；30项缓存如实保留。[最终命令](../../tests/v25/.results/b18/check-final-summary.json)、[输出](../../tests/v25/.results/b18/check-final.log)。默认 API285/211 gated、worker77/83 gated、DB39/5 gated 不代表本批新跑真实集成。
4. **T3 Electron**：构建后于 **13:47:35–13:50:50** 执行 `pnpm exec playwright test -c tests/v25 --project=electron`，**83 passed / 2 skipped / 0 failed/flaky，exit 0**；[报告](../../tests/v25/.results/b18/electron-report.json)、[命令](../../tests/v25/.results/b18/electron-summary.json)。skip 为未注入真实 key 与活体账号。验证既有真实宿主、工作台和正式备份恢复回归；没有新增用户托管链 E2E，没有重跑完整 Web 三形态套件或更换视觉基线。
5. **source 内容扫描**：13:47:36，**1180文件、12,830,476字节，0 findings/errors/accepted，exit 0**；[报告](../../tests/v25/.results/b18/security-source.json)。不是依赖漏洞、安装包或生产安全验收。
6. **源码一致性**：最终 **1276项**，摘要 `ceeead243aeee426217ed4dad48a57d7f7e4351feaeade3f6a900e64a50d13a1`；HEAD仍 `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加 dirty tree。[相对B17的10文件差异](../../tests/v25/.results/b18/source-delta-from-b17.json)、[无漂移核对](../../tests/v25/.results/b18/source-verification-final.json)、[统一摘要](../../tests/v25/.results/b18/validation-summary.json)。归档修复前清单另存 `pre-archive-fix-source-files.json`；专项早于该单一测试 fixture 修正，最终check/Electron在修正后执行。

#### 5.11.3 首次失败与后续未验事项

- 13:35、13:36 两次 typecheck exit 2，`never` 箭头函数未产生需要的控制流收窄，导致 response/parsed 可空诊断。改为明确返回 never 的函数声明后通过；两份原摘要/日志保留，没有用断言或放宽类型跳过校验。
- 首次 check 13:42:19–13:42:47 **34/35、0 cached、exit 1**；根2166 passed/1 failed/5 gated skipped。唯一失败是设计方案 ZIP 条目上限测试在5000毫秒超时：fixture 对1025个微小条目逐个提交压缩工作。仅该计数用例改用存储型 ZIP，保留真实归档解析、1025条目、原拒绝文本和原期限；压缩比攻击测试继续压缩。定向4项与完整check复跑通过，原 `check-first.log` 保留。
- B18 是适配层实现验收；正式用户连接/显式启用、准备/确认、全部共享预算写入保护、取消意图、资产下载/幂等入账、匹配备份核对和 P5/P6 仍开放。不以 HTTP1次或 Electron83项关闭整个 G-SPEND-02。
- 未运行本批 Windows 原生、断电、历史真实备份、包/签名、公证、部署/回滚、真实支付或管理员验收。管理员继续依赖 v2.5 整包完成。

### 5.12 B19：共享预算写入与异步结算（2026-09-08，本机验收通过）

本批保护共享策略预算与旧请求写入口，接宿主异步落盘；不开放用户托管生成。时间为Asia/Shanghai，报告目录 `tests/v25/.results/b19/`。最终源码相对B18共21路径；无UI、DB schema或API/worker生产变更。

#### 5.12.1 实现与验收证据

| 验收点 | 实现与实际验证 | 边界 |
|---|---|---|
| 写资格统一 | 检查点commit的同步SQLite事务内授予写资格；预算上限、兼容opening用量、受托管预算影响的登记/确认/call/finish不能从另一个repository直接写 | 真SQLite与独立密文锚文件；外部BYOK独立账本仍可执行且不冲销账号预算 |
| 启用前兼容 | 预算改动与enable共用同一排他锁；没有DB标记也没有独立锚时才走未启用事务，不创建namespace；拒绝async/thenable并回滚 | 真实0007预算初始化与迁移回归；标记或锚仅缺一侧则拒绝，不把旧备份重新识别为新用户 |
| 老托管记录 | 没有remote关联的托管预留/调用仍受保护，通用recover和启动终态补记不擅自结束它们 | 保留原状态与预算；不补造身份/回执。用户启用前排空与恢复核对仍待P4产品接线 |
| 预算并发与unknown | 降低上限与并发G登记按同一锁排序，只有足额请求自动占用；预算增加和跨月兼容用量不消除持久unknown | 真SQLite账本/guard联合测试；B17按原预算月处理远端回执继续回归 |
| 宿主设置与结算 | setMonthlyBudget等待guard落稳后返回；兼容结算异步，重复finish等待同一Promise，落稳前保留预留 | 实际宿主方法/SQLite/文件；设置域及G/R/S用例以可控延迟证明顺序；不使用睡眠冒充落盘完成 |
| 失败与排空 | 拒绝非法金额；预算写失败回滚checkpoint，pending不删除；DB已commit但锚末次写失败阻止续写，仅允许核对；drain使迟到预算回调失效 | 实际work scope、SQLite和文件，注入持久化故障；恢复中不提前关闭活跃操作 |
| API兼容闸门 | GenerationBudget允许异步settle/finish，成功事件及结果等待完成；settle拒绝保留unknown且不自动放行下一请求；清理再次拒绝也无未处理Promise | 包测试与宿主兼容测试，不替代未来用户托管执行器 |
| 系统安全存储 | 正式IPC修改预算后SQLite/checkpoint与实际safeStorage密文一致；新PID保存同值不再推进，改为0再推进一次 | 新Electron测试以合成checkpoint初始化，无专用测试启用IPC；真实主进程/密文/新PID，未调用付费接口 |

#### 5.12.2 阶段测试和源码身份

- T1/T2专项：14:15:20十文件 **177 passed/0 failed/skipped**，exit0；[实际命令](../../tests/v25/.results/b19/unit-final-summary.json)、[日志](../../tests/v25/.results/b19/unit-final.log)。随后增加一项未启用事务的thenable回滚测试，已被最终全仓check覆盖；不把177改写为未实际运行的178。更早172项、89项是阶段子集，不叠加。
- 全仓check：14:16:36–14:17:09 **35/35、0cached、exit0**；新增Electron预算测试后最终14:22:00–14:22:19再跑 **35/35、30cached、exit0**，根 **2189passed/5gated skipped**（249文件通过/1 gated），features **599passed**。[最终命令](../../tests/v25/.results/b19/check-final-summary.json)、[输出](../../tests/v25/.results/b19/check-final.log)。默认API285/211gated、worker77/83gated、DB39/5gated，不冒充完整真集成重跑。
- 真实PG回执专项：14:17:06–14:17:13，**1文件25passed，exit0**，含SQLite子进程向实际Hono/PG提交、丢回包后SIGKILL、新PID/凭据轮换/purge后只读查询原key。[命令](../../tests/v25/.results/b19/api-receipts-summary.json)。不是完整API212项；主体授权由fixture合成，不是新一轮BA登录或真实付费Provider。
- 先行Electron完整回归：14:17:25–14:20:49，83passed/2skipped，exit0；[报告](../../tests/v25/.results/b19/electron-before-budget-report.json)。新增正式预算IPC专项14:21:33–14:21:41 **1passed**，exit0，实际checkpoint序列0→1→重启同值1→改0为2；[专项报告](../../tests/v25/.results/b19/electron-budget-report.json)。
- 最终Electron：**14:22:52–14:26:10**，`pnpm exec playwright test -c tests/v25 --project=electron` **84passed/2skipped/0failed/flaky，exit0**；[报告](../../tests/v25/.results/b19/electron-final-report.json)、[命令](../../tests/v25/.results/b19/electron-final-summary.json)。先行83项和专项1项不与最终84项相加。跳过为缺少真实key/活体账号；没有改视觉基线或重跑完整Web三形态套件。
- 最终source扫描14:22:53，**1182文件、12,865,185字节，0findings/errors/accepted，exit0**；[报告](../../tests/v25/.results/b19/security-source-final.json)。最终清单 **1278项**，摘要 `3b9be5d51987b6d94ceaf3e8478935dd9a916ee8da44a558e1f6b666248fbe88`，仍为HEAD加dirty工作树；[相对B18的21路径](../../tests/v25/.results/b19/source-delta-from-b18.json)、[无漂移核对](../../tests/v25/.results/b19/source-verification-final.json)、[统一摘要](../../tests/v25/.results/b19/validation-summary.json)。

PG专项和第一次全仓/83项Electron所对应清单另存 `before-budget-e2e-source-files.json`，摘要77121eaafbee2869d50d54f2f7ee67e7720a32b9549f898f5b6dfc6cc70d7299；最终唯一差异是新增Electron预算用例，生产/core/API字节未变。最终check/Electron在新清单上执行，PG不冒充又重跑。

#### 5.12.3 首次失败与未完成边界

1. typecheck-first退出2：测试settle回调直接返回Array.push的number，与新的void/Promise<void>接口不匹配；改为void函数体后通过，没有放宽接口。
2. unit-first为80passed/1failed：真实0007 fixture尚无checkpoint表，新的预算初始化守卫查询失败。仅在表不存在的合法迁移前阶段识别为未启用，主进程仍检查独立锚；修复后172项通过。没有删除迁移用例或跳过旧库。
3. unit-third为88passed/1failed：新增测试误用`:id`，正式路由实际为`:jobId`；修正测试路由与参数后89项通过，未更改产品路由。原日志均保留。
4. B19完成写入口保护和异步结算；用户显式启用时的legacy在途/内存预留核对、原请求恢复出口，G准备/确认/生成/取消/下载全链及P5/P6仍未闭合。直接拒绝旧写入不等于已恢复旧任务，也不能只调用guard.enable便开放产品。
5. 本批没有PG/SQLite增量迁移、Windows原生、断电、真实历史数据恢复、付费账单、签名安装包、安全全出口、部署/回滚或管理员验收。完整迁移与管理员前置继续开放。

### 5.13 B20：启用前的持久账本检查（2026-09-08，本机验收通过）

本批只改 core 的启用检查及测试，共4条源码路径；没有新增用户入口。最终源码1279项，摘要 `90fea1684e1d72d7345190b3e29cc3bb10e895ced0aecb140ac8e969c840e4d4`，HEAD加dirty工作树；[增量清单](../../tests/v25/.results/b20/source-delta-from-b19.json)、[无漂移核对](../../tests/v25/.results/b20/source-verification-final.json)、[统一结果](../../tests/v25/.results/b20/validation-summary.json)。时间均为Asia/Shanghai。

| 验收场景 | 实际结果 |
|---|---|
| 旧托管授权、待确认、执行中或费用unknown | enable在写锚前拒绝，SQLite字节、预算和请求不变；无新namespace、无网络发送 |
| 跨月/其他scope及异常终态 | 不只检查当前月剩余额度；held/unknown、未结束托管call均阻止启用，terminal标签不能掩盖调用 |
| 旧关联仍在、checkpoint和锚丢失 | 拒绝重建namespace，保留关联等待核对；没有将旧身份重绑定新账号 |
| 已拒绝确认、已结束旧请求、活跃BYOK | 允许检查点初始化，旧记录原样保留；BYOK后续仍能结束，不冲销账号预算 |
| pending落盘期间另一SQLite连接登记旧任务 | commit事务内复查并拒绝，保留pending/query_only及原预留；不擅自擦锚重试或伪造结算 |
| 原有保护回归 | B19两项旧记录防绕过fixture改为在已启用库中经协调器布置，保留所有直接写拒绝断言；合法新enable不再跨过活跃旧记录 |

阶段结果（同一源码）：

- T1/T2，14:37:13–14:37:18：`pnpm exec vitest run` 指定enablement/shared-budget/guard/ledger/process五文件，**66passed，0failed/skipped，exit0**，含新增10项；[完整命令](../../tests/v25/.results/b20/unit-first-summary.json)、[日志](../../tests/v25/.results/b20/unit-first.log)。真实SQLite、文件及第二连接；加密器为合成fixture。既有进程用例一并回归，不把它们说成用户启用流程的SIGKILL验收。
- 全仓，14:38:04–14:38:43：`pnpm run check` **35/35、0cached、exit0**；根**2199passed/5gated skipped**，features**599passed**；[命令](../../tests/v25/.results/b20/check-final-summary.json)、[日志](../../tests/v25/.results/b20/check-final.log)。默认API/worker/DB集成仍受环境gate，不代表本批重跑真实PG全矩阵。
- T3桌面，14:38:53–14:42:01：构建后`pnpm exec playwright test -c tests/v25 --project=electron` **84passed/2skipped/0failed/flaky，exit0**；[报告](../../tests/v25/.results/b20/electron-final-report.json)、[命令](../../tests/v25/.results/b20/electron-final-summary.json)。保留既有真实safeStorage/新PID恢复/预算IPC回归；2项跳过仍为活体账号/真实key前置缺失。未新增启用IPC，不能将这组回归当成可见启用产品验收。
- 源扫描，14:38:45–14:38:45：**1183文件、12,875,698字节，0findings/errors/accepted，exit0**；[报告](../../tests/v25/.results/b20/security-source-final.json)。这是源码内容规则扫描，不替代依赖漏洞、安装包、运行全出口或生产安全验收。

首轮专项、全仓及Electron均通过，没有失败后重跑或刷新视觉基线；构建沿用现有的`use client`与sourcemap提示，退出码为0。本批没有UI/PG/SQLite schema变化、完整Web E2E、原生Windows、实际历史库、安装包、部署/付费或管理员验收。

文档本地链接/代码围栏检查通过。整包校验首次调用缺少`--slug`退出2；修正参数后[实际校验](../../tests/v25/.results/b20/spec-review-final-summary.json)退出1，原因是整体任务与验收仍未完成，并非本批测试失败；两个原始日志均保留。本批通过不改写整包验收状态。

**未闭合项**：宿主legacy内存预留及操作准入/排空、真实账号绑定、可见启用/核对出口，以及G准备确认/生成/取消/下载/恢复仍需一起接通。此检查只防止持久旧任务被新namespace接管；拒绝启用不等于旧任务已恢复。尤其pending落盘后检测到竞争会保留query_only，后续必须提供核对出口，不能自动清零解锁。P4、后续迁移及管理员前置仍开放。

### 5.14 B21：桌面账号云图像首条产品链（2026-09-08，本机分层验收通过）

本批接通显式账号云连接、普通G无参考输入的一次提交、持久取消意图、受控下载与本地幂等投影，并提供原任务核对。**这不是完整P4、生产费用或迁移整包验收。** 最终源码1290项，摘要 `ac876c6132f8fa0f295e50fdf4e5d1bff363c2b50d594eabc9ffbeccd2c09b96`，HEAD加dirty工作树；相对B20变动38条源码路径。见[统一结果](../../tests/v25/.results/b21/validation-summary.json)、[增量](../../tests/v25/.results/b21/source-delta-from-b20.json)、[源码无漂移](../../tests/v25/.results/b21/source-verification-final.json)。时间为Asia/Shanghai。

| 验收条目 | 实際覆盖与结果 | 边界 |
|---|---|---|
| 可见显式连接 | 真实Electron登录→设置连接→展示账号/服务→一次性review确认→默认keyless连接；preview和取消不创建/发送 | 云API身份/binding为回环fixture；正式safeStorage/IPC/SQLite是真的 |
| 身份与旧预算准入 | 一次性review消费、凭据/会话变化拒绝；legacy预留全部结束才进入；启用中拒绝新旧工作；退役后不接旧预留；work scope排空 | 完整旧未映射任务诊断、全部确认过期/换号时点仍按P4-R |
| G实际编排 | 真实core、SQLite和HTTP生成1/2/4张；默认auto参数及原始prompt冻结；普通发送直接交互授权；未支持关联Prompt/引用在登记前拒绝 | Provider图像/费用为合成值，无真实付费；参考图/R/S仍P5 |
| 取消与费用 | claim前取消0生图POST，claim后未知费用不释放；取消回包失败保留意图，迟到成功和成本仍入账；失败/取消已知成本写历史 | 不承诺点击停止后零费用；取消POST可幂等补发，generation POST不可自动重发 |
| 下载与本机投影 | 只用当前服务owned-asset content路由；拒绝伪asset、重定向、类型/字节数/尺寸错误与超限；真实文件与元数据核对；重复核对无重复资产/费用 | 不跟随返回asset.url；单位图片上限30MiB；临时/孤儿文件完整GC另卡 |
| 丢回包、404与重启 | POST/下载错误只查询原任务；404不改零费用；真实Electron正常退出、新PID复用密文会话后只GET原任务与资产，最终成功且总生图POST=1 | 不是正式宿主全部SIGKILL或断电矩阵；B17核心进程证据不冒充本批产品强杀证据 |
| 设置共享组件 | optional accountCloud域缺失时Web不显示；确认显示冻结账号；换号后旧review无请求；原任务query/cancel分开；无身份不读取恢复清单 | 当前只显示最近20条；分页/purge和旧无关联记录诊断待P4-R1 |

阶段执行结果：

1. 早期类型检查15:07:10–15:07:17通过，仅覆盖当时尚未补测试的开发源码；不替代最终门禁。后续定向4文件 **88passed/0failed**（15:24:33–15:24:39），[命令/日志](../../tests/v25/.results/b21/targeted-second-summary.json)；共享账号UI两文件 **49passed**（含新增7项），[记录](../../tests/v25/.results/b21/features-first-summary.json)。定向之后新增的下载拒绝和排他work scope用例由最终全仓覆盖，不能把88改写为最终专项重跑数字。
2. 最终全仓，15:27:29–15:27:49，`pnpm run check` **35/35、30cached、exit0**；根 **2229passed/5gated skipped**，features **606passed**。[完整命令](../../tests/v25/.results/b21/check-fourth-summary.json)、[日志](../../tests/v25/.results/b21/check-fourth.log)。API/Worker/DB默认集成gate仍跳过，不算当前B21真实PG合流通过。
3. 真实Electron专项，修复默认比例后 **1passed/0failed**，包含新PID及原任务恢复；[报告](../../tests/v25/.results/b21/electron-cloud-third-report.json)、[命令](../../tests/v25/.results/b21/electron-cloud-third-summary.json)。随后完整回归再次执行同一用例，不累加为两个不同场景。
4. 完整三形态，15:28:40–15:35:02，`pnpm run test:e2e`（重新构建双端）**246passed/7skipped/0failed/0flaky，exit0**。PC **81/2**、移动 **80/3**、Electron **85/2**；[完整报告](../../tests/v25/.results/b21/e2e-final-report.json)、[命令](../../tests/v25/.results/b21/e2e-final-summary.json)、[项目计数与跳过理由](../../tests/v25/.results/b21/e2e-counts.json)。7跳过=3个活体登录缺环境、1个真实图像Key缺环境、3个不适用视口的互补测试；没有将必测新增路径skip。**未刷新任何视觉基线。**
5. 源码内容扫描，15:29:12–15:29:12，**1194文件、12,973,910字节，0findings/errors/accepted，exit0**；[报告](../../tests/v25/.results/b21/security-source-final.json)。该扫描不是依赖漏洞扫描、全运行出口/安装包或生产安全验收。最终check/E2E后源码无漂移，`git diff --check`通过。

首次失败与修复（原日志保留，不隐藏失败重跑）：

| 原记录 | 原因和修复 |
|---|---|
| targeted-first：两套件加载失败，41项已跑通过 | 新模块静态导入settings导致electron-store过早初始化；改为实际操作中加载，不给旧测试强行开放生产存储 |
| runtime-first：8failed/45passed | 新连接ID的hex散列加前缀超过64字符；改完整SHA256的base64url编码，仍保留完整散列熵 |
| runtime-second：6failed/3passed | 缺省negative被显式写成undefined，JSON账本拒绝；可选字段不存在时省略 |
| runtime-third：6failed/3passed，4个fixture异常 | 合成job.costPoints小数和asset缺expiresAt不符合现有契约；修fixture，未放宽契约 |
| check-first | 8个新文件格式错误；只修涉及文件，旧warning不据此写成新失败 |
| check-second | 旧Automation数据库stub对checkpoint查询也返回Provider，触发正确的拒绝；缩小stub语义，保留全部旧预算/结算断言 |
| check-third | 拒绝不支持输入的测试缺GenerateImageRequest必填n；补齐fixture |
| electron-cloud-first | `--project electron 文件名`将文件名当项目名，零测试退出1；改`--project=electron` |
| electron-cloud-second | 默认自动比例仍携带undefined，实际UI无生图POST；省略未给比例并将运行联测改为默认参数覆盖；第三次专项及最终完整回归通过 |

原始命令、时间和日志全部列在[统一结果gates](../../tests/v25/.results/b21/validation-summary.json)。文档本地链接/围栏/行限检查通过；整包脚本退出1，保留未完成任务和验收项，[实际检查](../../tests/v25/.results/b21/spec-review-final-summary.json)不是本批业务测试失败，也不允许据此关闭整体goal。没有新PG/SQLite schema，没有当前实际Hono/PG产品合流、真实收费、Windows原生、正式宿主强杀全集、真实历史库、安装包、部署回滚或管理员验收。P4-R1..R4、P5/P6及其他卡仍开放，整包验收不得勾完。

### 5.15 B22：原云任务恢复分页、素材可用性与旧托管诊断（2026-09-08，本机分层验收通过）

**范围与结论**：复用 B21 显式云连接、一次提交和原任务回执。当前 owner 的清单按 created_at/id 稳定游标每页20条，包含终态；不按可变化的状态过滤导致漏项。成功回执、费用已知、本机素材完整是三个独立状态。成功但已 purge 的任务结束本机执行状态并说明图片不可获取；本机文件缺失只重取原资产、比对校验和/元数据并保留原行。旧未映射托管记录按与启用相同的阻塞谓词列本机诊断，可在未登录时定位，但没有重绑/清零/清锚/重发操作。关闭 B22 的本机恢复交互切片，P4 父卡及 R2/R3/R4 保持开放。

**阶段、流程与实际结果**（时间为上海时区；专项是全仓测试的子集，不相加成总量）：

| 阶段 | 实际命令与步骤 | 结果与证据 |
|---|---|---|
| T0 契约/边界审阅 | 从 contracts 定义 page/recovery/legacy strict schema，再同步 platform、单通道IPC、desktop gateway、features；未改PG/SQLite schema或版本号 | 游标禁止额外owner参数；请求ID/时间/原因无Prompt、payer或本机路径；就地IPC证明legacy不获取云会话，核对完成后重新检查owner；就地检查纳入check |
| T1 恢复核心 | `pnpm exec vitest run apps/desktop/electron/system/__tests__/account-cloud-recovery.test.ts apps/desktop/electron/system/__tests__/managed-cloud-runtime.test.ts packages/core/src/services/__tests__/managed-enablement.test.ts packages/contracts/src/__tests__/account-cloud.test.ts` | 16:11:38–16:11:44，4文件/33passed/exit0。[命令](../../tests/v25/.results/b22/recovery-third-summary.json)、[日志](../../tests/v25/.results/b22/recovery-third.log)。后加IPC测试由最终check覆盖 |
| T1 共享交互 | `pnpm --filter @musefold/features exec vitest run src/account/__tests__/account-cloud.test.tsx src/account/__tests__/account-cloud-recovery.test.tsx src/history/__tests__/generation-recovery-notice.test.tsx` | 16:13:16–16:13:18，3文件/15passed/exit0。[精确时间与命令](../../tests/v25/.results/b22/features-second-summary.json)、[日志](../../tests/v25/.results/b22/features-second.log) |
| T1 全仓/双端产物 | `pnpm run check` | 16:15:05–16:15:28，35/35、29cached、根2241passed/5gated skipped、features614passed、exit0；包含边界、类型、lint、单测及双端build。[命令](../../tests/v25/.results/b22/check-third-summary.json)、[日志](../../tests/v25/.results/b22/check-third.log)。缓存测试来自相同输入，不称全冷运行 |
| T2 既有真实回执回归 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/generation-receipts.integration.test.ts` | 16:15:41–16:15:48，真实PG17 Testcontainers/Hono、1文件/25passed/0skipped/exit0。[命令](../../tests/v25/.results/b22/pg-receipts-summary.json)、[日志](../../tests/v25/.results/b22/pg-receipts.log)。包含既有core子进程和同key恢复；**没有接当前正式main runtime至该服务，不关闭R2** |
| T3 完整产品回归 | `pnpm run test:e2e`，先重建，再PC/移动/真实Electron串行 | 16:15:50–16:21:46，247passed/7skipped/0failed/flaky，PC81/2、移动80/3、Electron86/2，exit0。[精确时间与命令](../../tests/v25/.results/b22/e2e-first-summary.json)、[JSON报告](../../tests/v25/.results/b22/e2e-first-report.json)、[项目与逐项skip](../../tests/v25/.results/b22/e2e-counts.json)；无视觉baseline更新 |
| 内容扫描/一致性 | `node scripts/security/scan.mjs source --report tests/v25/.results/b22/security-source-final.json`；冻结源码前后SHA256 | 16:15:41–16:15:42，1201文件/13,022,198字节，0findings/errors/accepted，exit0。[扫描](../../tests/v25/.results/b22/security-source-final.json)、[源码无漂移](../../tests/v25/.results/b22/source-verification-final.json)。只证明源码内容规则，不替代安装包/依赖漏洞/生产安全 |

**验收行为与证据映射**：

- 43条同时间云请求实际使用SQLite/加密文件登记，按20/20/3读取；第一页的任务结清、另有新记录到达后，后页原43个ID无重无漏。不同issuer/principal游标、另一诊断域游标或无效编码拒绝；同owner重登允许只读查询。
- 23条本机旧托管记录按20/3诊断，已结清历史和外部BYOK不混入；旧unknown即便执行被标终态仍显示未知费用。列表读取前后数据库字节一致，实际启用仍拒绝未结记录。映射后的账号云记录不重复列为旧记录。
- 主进程HTTP/SQLite测试覆盖1/2/4张、purge、文件丢失、回包丢失、费用和重复核对；素材恢复逐位置检查SHA256/字节数/MIME/宽高，不重复资产或收费。列表可用性读取实际文件存在及尺寸；并非每次轮询重新哈希所有本机图片。
- 真实Electron两条场景都通过可见登录→连接确认→普通发送→故意丢POST回包→正常关闭→新PID→核对原任务。成功素材场景落盘后删除合成文件，再点核对，字节恢复且资产整行不变；purge场景本机run为success、资产0行、无asset GET、显示已清理说明。每场景生图POST始终1、实际费用4、无隐式sync、SQLite/账号文件未泄漏合成bearer。使用真实主进程/preload/共享UI/SQLite/macOS safeStorage，API/Provider与图片费用均为本机合成fixture。
- 共享组件验证21条云记录、23条旧诊断、失败游标刷新、purge不提供替代生图、未知费用仍可核对、本机完整且费用已知才隐藏说明、旧账号异步结果拒绝。Web消费同一共享代码，但本机accountCloud域仍按能力只在桌面显示。

**首次失败与修复**：保留typecheck-first（分页回调推断unknown）、recovery-first（测试helper漏闭合括号）、recovery-second（测试ledger缺assertCurrent参数）、check-first（Biome对链式map需要第二次格式化）、check-second（全仓并发构建/测试下44次持久登记fsync超过默认5秒）。最后一项只给该实际落盘测试20秒，保留43条/相同时间/状态变化/唯一性断言，未改生产超时或减少样本；最终check-third全仓通过。详情和每次原始日志入口集中在[统一报告](../../tests/v25/.results/b22/validation-summary.json)。

**适用源码**：HEAD仍为`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加dirty工作树；1297项摘要`3250169f8d434be5adc26d7449b1058904b288ea6691be9836f29a59a266c375`，相对B21共26路径。[清单](../../tests/v25/.results/b22/source-files.json)、[差异](../../tests/v25/.results/b22/source-delta-from-b21.json)。文档回写不改变该源清单。

**未验与后续领取**：7项E2E跳过沿用既有条件：PC/移动活体登录各1、Electron活体登录1、真实TvT Key1、视口专属场景3；默认根5项PG gate由显式回执25项回归之外的范围继续登记，不能把所有gated场景当已跑。未跑Windows原生、正式主进程→实际Hono/PG产品合流、全宿主SIGKILL/旧备份确认、断电、真实付费、真实历史库、安装包、生产部署/回滚或管理员。下一条按[路线图 §6.10](./V25-MIGRATION-ROADMAP.md)领取P4-R2，再R3/R4；P5/P6、云Agent/包和完整GC/发布仍在原任务范围。

### 5.16 B23：正式桌面客户端与真实云服务合流（2026-09-08，本机联合验收通过）

**本批实际改变**：建立测试专用、隔离子进程的真服务联合环境。正式 Hono generation/asset 路由和 AccountService 执行绑定读取 PG17（运行真实迁移），真实 Graphile 队列驱动 worker 子进程，worker 使用正式任务、租约、发送claim、Provider HTTP与S3上传路径。桌面调用 B21/B22 正式main runtime/client/SQLite/持久锚；真实Electron用正式账号存储、preload和共享界面。测试认证/status和预置身份、Provider/S3是合成服务，不执行真实付费请求、不加产品后门。main/pr工作流的Linux数据库集成job已新增联合专项和JUnit产物，配置存在不代表本轮已跑远程CI。

**修复的真实问题**：bound排队任务被取消时，API已确认未发送，但原cost_points仍为null，桌面B22可用性说明仍认为金额未知。API现在在取消事务内仅对bound且dispatch=not_started的回执写not_sent/0；不改claimed或legacy未知。桌面对旧终态not_sent回执以可信未发送证明识别零费用，金额尚未填充不再误报未知。实际上游成功/失败/发送后取消没有可信金额时仍为unknown/null，不能从成功或取消推算免费。生产schema、版本号和冻结面未改。

| 阶段 | 流程与命令 | 最终结果与证据 |
|---|---|---|
| T1 契约/旧数据保护 | 就地回归旧null未发送证明、active/unknown不得变零；API额外验证legacy取消仍unknown/null；全仓`pnpm run check` | 35/35、30cached；根2242passed/17gated skipped，features614passed，exit0。[check命令/时间](../../tests/v25/.results/b23/check-final-second-summary.json)、[日志](../../tests/v25/.results/b23/check-final-second.log) |
| T2 实际主进程服务联合 | `RUN_DATABASE_TESTS=true pnpm exec vitest run apps/desktop/electron/system/__tests__/managed-cloud-service.integration.test.ts apps/desktop/electron/system/__tests__/account-cloud-recovery.test.ts` | 2文件18passed（12联合+6本机恢复），0skipped/failed，exit0；[命令/时间](../../tests/v25/.results/b23/joint-final-second-summary.json)、[日志](../../tests/v25/.results/b23/joint-final-second.log) |
| T2 完整API回归 | `pnpm --filter @musefold/api run test:integration` | 14文件213passed、0skipped/failed、exit0；包括实际备份SIGKILL与120秒租约自然到期，不改时钟或截止时间。[命令/时间](../../tests/v25/.results/b23/api-final-second-summary.json)、[日志](../../tests/v25/.results/b23/api-final-second.log) |
| T3 实际Electron联合专项 | 构建后`RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron electron.account-cloud-service.spec.ts` | 1passed/0skipped/failed，四图/丢回包/关闭/新PID/缺文件恢复。[报告](../../tests/v25/.results/b23/electron-joint-first-report.json)。随后完整三形态重跑覆盖最终源码 |
| T3 完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e` | 248passed/7skipped/0failed/flaky；PC81/2、移动80/3、Electron87/2，exit0，未更新视觉baseline。[命令/时间](../../tests/v25/.results/b23/e2e-final-summary.json)、[JSON](../../tests/v25/.results/b23/e2e-final-report.json)、[各项目和逐条skip](../../tests/v25/.results/b23/e2e-counts.json) |
| 内容与源码一致性 | `node scripts/security/scan.mjs source --report tests/v25/.results/b23/security-source-final.json`；冻结清单前后比对 | 1205文件、13,065,486字节、0findings/errors/accepted、exit0。[扫描](../../tests/v25/.results/b23/security-source-final.json)、[清单](../../tests/v25/.results/b23/source-files.json)、[无漂移](../../tests/v25/.results/b23/source-verification-final.json) |

**12项联合矩阵的验收**：

1. 1/2/4张各一项；API实际收到的冻结body/key/binding与SQLite一致，worker只调用一次Provider，默认auto不伪造size参数，负面词按正式规则合并。每张图片内容/宽度不同，逐position比较本机字节、宽高、长度与原输出，防止“复制第一张也能过”。成功的真实回执unknown/null保持本机预算unknown，重复核对不重提交。
2. POST回包丢失后worker完成再purge：原receipt/key保留，本机结束为success，素材明确purged且不替代生图，未知费用保留。
3. 本机文件丢失并轮换凭据后，仍按原owner/key查询旧binding回执、恢复原资产，资产整行不重复/不改身份。
4. worker启动前取消排队任务：Provider零调用，PG终态not_sent/0，本机取消且已知零。
5. 两个并发授权分别2张与4张：两条原key/回执、两次Provider调用、六个正确归属资产，不混淆payer/binding。
6. API接受后、worker claim前轮换凭据：旧授权不发送Provider，真实失败回执有未发送零费用证明。
7. Provider在途时换号：旧回调不能落原结果，外账号核对拒绝，真实Hono按外账号查询原key为404；原账号新登录可核对一次已存在结果，不新增Provider调用。
8. Provider已dispatch后取消：保留claimed/unknown/null，不因取消变免费；只有一次Provider调用。
9. 当前不支持的Prompt引用在登记和实际API POST之前拒绝，远端run/Provider均为0。
10. 实际Provider HTTP500：失败/claimed/unknown/null，预算unknown保留，Provider只有一次。

前三个张数参数场景各计1，其余各计1，共12；本机恢复6项为独立补充，不重复计入全仓总数。真实Electron通过可见账号登录/连接确认/Composer选择4张/发送，故意丢API回包后正常关闭；worker在桌面关闭期间完成，第二PID核对原任务并取得四张不同原图，再删除第一张合成文件并恢复，SQLite资产整行不变。API POST=1、Provider POST=1、云/本机资产各4，费用unknown/null，合成bearer未进入SQLite。生成与素材响应由真实Hono路由读取PG及受控对象存储产生。

**首次失败与修复记录**：joint-first找出取消回执null金额与可用性判定不一致；joint-second暴露新增测试漏import，以及测试错误要求取消后1秒内同步投影（正式轮询为1.5秒），补import并等待可观察终态；joint-third在旧操作还active时核对是无IO的no-op，改为等待旧操作退出后验证具体MANAGED_IDENTITY_CHANGED和实际404；api-final新增legacy fixture未清authorizing_session_id/auth_revision，触发真实binding CHECK，按旧schema修正fixture，完整213重跑通过。没有放宽数据库约束、删断言或改生产轮询。初始与最终报告全部纳入[统一摘要](../../tests/v25/.results/b23/validation-summary.json)。

**源码与限制**：HEAD仍为dcdf8d036c27f87e33de301ad4077a3110bb5b7f加dirty工作树。1301项最终摘要`9c6233b1c379b06201620fa0503b8a685accec60814ec7d7e951be70a16b9c7a`，差异见[相对B22](../../tests/v25/.results/b23/source-delta-from-b22.json)。17项默认根skip含新12项真服务gate，已由显式联合命令全部执行；其余5项PG默认gate不因此改为已跑。7项E2E既有跳过与B22相同，新真服务Electron本次显式开启并通过。未跑完整worker集成集（本批worker代码未改），不把选中task流程等同所有worker故障/GC验收。未跑真实收费/独立正额账单及跨月回写、当前联合fixture内的真实Better Auth/New API登录、Windows原生、实际Electron逐点SIGKILL与备份确认、真实历史用户库、安装包、生产发布/回滚或远程CI。

下一条执行P4-R3，再R4，具体任务与判定见[路线图 §6.11](./V25-MIGRATION-ROADMAP.md)。费用P6须继续核对可信账单/原月原payer，不把B23未知或合成数据当完成。整包和管理员前置继续开放。

### 5.17 2026-09-08 B24：实际 Electron 强杀与真实任务备份确认（首批通过，R3 未全闭合）

**实际修复**：`finishLocal` 在 durable unclaimed + cancel intent 已成立时，把本地 `generation_runs.actual_cost` 同步为 0，并返回 `cost: 0`。此前恢复面/费用账本已知未发送，而本地历史仍为 null；本次真实 Electron 领取前强杀找出了不一致。已领取但 POST 前崩溃仍保持 running/未知；实际上游已接收或已发送取消也不改零。无 PG/SQLite schema、API/worker 生产逻辑、版本号或新 IPC 改动。

**真实程度**：正式 Electron 主进程/preload/UI、macOS 系统 safeStorage、受管 SQLite、Hono/PG17/Graphile/worker 与 HTTP/S3 transport。账号登录/status、Provider 出图和对象存储服务来自 B23 合成 fixture。仅测试通过 `app.evaluate` 包装主进程方法定位时点，写隔离标记后 SIGSTOP，由父测试 SIGKILL；不新增产品后门，不替换系统加密。PID 与终止信号均断言，正常 close 仅用于独立备份恢复测试，绝不充作强杀证据。

| 场景 | 强杀/转换时证据 | 新进程或确认后的结果 |
|---|---|---|
| claim 前 | 第二个 submit pending 即将加密，SQLite仍unclaimed、0远端run、0资产 | 显式取消0生图POST/0Provider；原key/namespace不变；本地cancelled且0费用 |
| claim 完整落稳、POST 前 | fetch调用前标记，SQLite query_only、PG无run | 原key查询404；不补发、不清零，原本地run仍running/费用null |
| API 接收后、本地未读回包 | 真实创建响应201，PG有原run，本地无回执 | 原worker完成后新PID取原4张图；1API POST/1Provider；未知费用保留 |
| 未调度取消回包 | 真实cancel 200，durable intent已落稳、local ack仍空 | 新PID继续原取消/核对；1API生图POST/0Provider，明确未发送为0 |
| Provider已领取取消回包 | 实际Provider请求已到受控HTTP，cancel 200后强杀 | 仍1API生图POST/1Provider，不把取消当免费；成本unknown/null |
| 下载首块 | 实际资产GET已返回，首块数据尚未交付客户端 | 重取原资产，最终4图字节/顺序一致，无新生图 |
| 写文件前 | 下载完整字节已核验、临时文件尚未写 | 原run成功与未知金额保留；恢复完整4张 |
| rename 后、资产SQL前 | 首个确定性图片已存在，资产表仍0行 | 新PID沿用同一图片身份，最终4条；重复核对不重复资产 |
| 完整本地投影后 | 上述4条有图路径分别观察4条资产后再次SIGKILL | 再次新PID资产ID/路径/校验和及费用不变，API与Provider仍各1 |
| 旧/匹配安全备份 | 真正生成任务后正式restore旧库，安全备份保留原任务；4个不同PID | 旧库query_only且无review，拒绝发送；匹配安全备份仍query_only，UI明确确认后active；原图/费用保留 |
| 过期/换号/再次恢复后的review | 主进程Date.now前移120001ms；其后实际登录B/A、正式DB恢复；旧review重用 | 均拒绝，锚维持query_only；时钟测试不声明自然等待120秒；转换发生在review创建后、apply调用前，不等同apply内部竞争 |

**本批最终门禁**（同源码，未更新视觉基线）：

| 层级 | 命令/实际结果 | 报告 |
|---|---|---|
| 全仓 | `pnpm run check`：35/35，根2243passed/17gated skipped、features614 | [check](../../tests/v25/.results/b24/check-final-fourth-summary.json) |
| 联合专项 | `RUN_DATABASE_TESTS=true pnpm exec vitest run apps/desktop/electron/system/__tests__/managed-cloud-service.integration.test.ts apps/desktop/electron/system/__tests__/managed-cloud-runtime.test.ts apps/desktop/electron/system/__tests__/account-cloud-recovery.test.ts`：3文件34passed（12真服务+16runtime+6recovery） | [joint](../../tests/v25/.results/b24/joint-final-fifth-summary.json) |
| Electron专项 | `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron 'electron.cloud-(crash\|backup-confirmation).spec.ts'`：9passed；后续细化测试断言亦由最终全量覆盖 | [首次通过报告](../../tests/v25/.results/b24/crash-fourth-report.json) |
| 完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`：257passed/7skipped/0failed/flaky；web-desktop 81/2、web-mobile 80/3、electron 96/2 | [最终全量](../../tests/v25/.results/b24/e2e-final-report.json)、[跳过明细](../../tests/v25/.results/b24/e2e-counts.json) |
| 内容安全 | `node scripts/security/scan.mjs source --report tests/v25/.results/b24/security-source-final-third.json`：1208文件，0findings/errors/accepted | [扫描](../../tests/v25/.results/b24/security-source-final-third.json) |

**失败保留**：首次导入未公开schema失败，改用真实模块；最早fixture错误读取发送前尚不存在的Pictures目录，修正缺失处理和暂停进程清理；crash-third为6pass/1fail，实际费用不一致修复后9项通过。新增本机单测原先给从未发送的请求伪造成功回执，被严格ledger拒绝，按真实API 404修正；首次check保留。首轮完整三形态256pass/7skip/1fail：既有豆包入口仍停在真实网页状态加载，单独复跑2项通过；改为仅在测试隔离partition提供固定未登录HTML，保留冻结状态适配/IPC及入口断言，最终全量重新执行。该入口证据不再依赖真实豆包可用性，也不代表扫码登录内部验收；[首次全量失败报告](../../tests/v25/.results/b24/e2e-first-failed-report.json)保留。第二轮全量在既有两图布局断言采到交错入场动画的184/185像素坐标；保留严格同Y/不同X条件并轮询最终布局，不改CSS或快照。发现后停止该次运行，exit130：175pass/5skip/1fail/1interrupted/82未跑，[中断报告](../../tests/v25/.results/b24/e2e-second-interrupted-report.json)完整保留；不能与其他报告拼凑全绿。定向PC/移动各连续3次、共6pass后，最终另跑完整三形态，[专项报告](../../tests/v25/.results/b24/grid-final-report.json)保留。并行全仓与联合测试时，原1秒默认等待不足以完成真实HTTP/fsync/下载，改为4秒有界等待，原素材/身份/金额断言均保留，最终34项联合与全仓均通过。

**证据与未验**：1304项源码摘要`df35cfe5e4d5fa76b111e8fa18f1684c2f6e1512188154981e36b572814e4637`，相对B23只有[7个路径](../../tests/v25/.results/b24/source-delta-from-b23.json)。完整结构化[故障/恢复证据](../../tests/v25/.results/b24/formal-crash-backup-evidence.json)保留前后SQLite/PG、系统锚、原key和PID，临时用户目录已脱敏；[统一摘要](../../tests/v25/.results/b24/validation-summary.json)同时保存全部首次失败与最终命令。既有7项E2E skip仍为3个真实账号、1个真实中转key及3个平台布局专属条件；9个新增场景本次全部显式执行。17项根默认skip的12个联合gate本次已另跑，不将剩余5个默认PG gate误报为已跑。

API/worker生产代码和schema未改，本批没有重跑完整API/worker集成集或独立迁移CLI；上次完整API为B23的213项，不能改记B24。B16损坏锚使用合成初始checkpoint，本批未用实际托管任务补齐缺损锚；claim双持久化中点、apply内部换号/恢复竞争、确认写入失败仍按[路线图 §6.12](./V25-MIGRATION-ROADMAP.md)继续。未验真实收费/独立正额账单/跨月产品结算、Windows原生、断电/整机回退、真实历史用户库、最终安装包/部署回滚或远程CI；管理员未启动。R3、P4、G-SPEND-02及迁移整包均保持部分完成。

### 5.18 2026-09-08 B25：恢复确认的持久提交、缺损锚与执行中竞争

**结论与适用范围**：P4-R3-C1..C4 在本机 macOS 的正式宿主矩阵已验收。整包、P4-R4、P5/P6 与管理员前置仍未完成。本批没有数据库 DDL、迁移链或 UI 布局变更。原请求/原 key/namespace、素材行、费用投影不变；成功 resume 单独推进 checkpoint revision 一次。统一入口：[结果与命令清单](../../tests/v25/.results/b25/validation-summary.json)。

| 阶段 | 实际执行与结果 | 证据及边界 |
|---|---|---|
| T0 首次复现 | 恢复 guard 新测试最初 2 failed/15 passed：写入已安装后抛错仍 active；写入期间确认失效仍提交。修复后 core/runtime 2文件36passed | [首次日志](../../tests/v25/.results/b25/resume-first.log)、[修复后](../../tests/v25/.results/b25/resume-second-summary.json)；真实 SQLite/加密文件，core cipher fixture 不是系统 safeStorage |
| T1 全仓 | 最终 check 35/35；根2249passed/17 gated skipped、features614passed；类型/lint/边界/双端构建通过 | [命令及时间](../../tests/v25/.results/b25/check-final-second-summary.json)、[日志](../../tests/v25/.results/b25/check-final-second.log)。首次全仓35/35、0cached也通过；最终缓存只计相同输入，不称全冷 |
| T2 实际服务联合 | 正式 main 到真实 Hono/PG/Graphile/worker 与恢复回归；5文件63passed（真实服务12/runtime16/recovery6/guard20/contracts9），0skipped | [命令及时间](../../tests/v25/.results/b25/joint-final-second-summary.json)、[日志](../../tests/v25/.results/b25/joint-final-second.log)。身份/status/Provider/S3为合成服务，非实际正额账单 |
| T3 精准故障与三形态 | 新增17项：claim提交中点1、缺损锚2、确认内部竞争5、文件失败7、确认强杀2；完整回归 **274passed/7skipped/0failed/flaky** | [完整命令](../../tests/v25/.results/b25/e2e-final-second-summary.json)、[JSON报告](../../tests/v25/.results/b25/e2e-final-report.json)、[项目和逐项skip](../../tests/v25/.results/b25/e2e-counts.json)、[26项故障/备份原始证据](../../tests/v25/.results/b25/formal-crash-backup-evidence.json)；不更新视觉基线 |
| 内容扫描与源码 | 冻结源码1306项，SHA256 `7bd7b59729519d834aad5540ef7487aa6486a9674a9a555c98f8e0be8c1a2f6c`；源码规则扫描1210文件，0findings/errors/accepted | [源码清单](../../tests/v25/.results/b25/source-files.json)、[前后核对](../../tests/v25/.results/b25/source-verification-final.json)、[源码内容扫描](../../tests/v25/.results/b25/security-source-final-second.json)。HEAD仍dcdf8d0加dirty工作树；不冒充clean提交、产物或依赖漏洞扫描 |

**逐项验收映射**：

| 条件 | 触发/观察方法 | 必须成立的断言 |
|---|---|---|
| R3-C1 | 正式 main 的第二个 submit 已 SQLite commit，整理锚前同步停住并由父进程 SIGKILL；新 PID 解密停机前实际文件字节 | 密文 pending.submit.to 与 SQLite checkpoint/marker 一致，旧 committed 落后一版；领取不回退成未发送；GET 原 key，API POST/Provider/资产均0 |
| R3-C2 | 先真实生成1张，再在隔离 userData 正常关闭后分别移除/破坏锚，启动新 PID；调用新生成与正式恢复，再重启复核 | missing 为 query_only、corrupt 为 blocked；不提供 resume review；发送/恢复拒绝；坏文件保留，不重建 namespace；原 SQLite 记录、素材、费用不变；远端仍1 POST/1 Provider/1素材 |
| R3-C3 | resume 调用已开始，在真实 binding HTTP 返回或准备写入中异步等待；此时实际登录另一账号/启动正式恢复，或主进程时钟+120001ms | 旧确认拒绝，checkpoint不前进；恢复屏障阻止旧DB访问并完成排空；回原账号/重启仍受限，必须新界面确认；仅此次新确认 revision+1；费用/原素材和调用数不变 |
| R3-C4 准备失败 | 分别 open、write、临时文件fsync、rename、目录fsync 注入一次失败；目录fsync命中在rename之后 | 调用失败，已安装pending也不授权；重启仍query_only，显式重新核对才成功；原checkpoint不前进，不以删锚处理 |
| R3-C4 整理失败 | SQLite授权提交后，再于整理write或目录fsync注入失败 | 这是已知提交后的整理失败；返回active与数据库事实一致，重启只接受pending.resume.to精确匹配；核对可整理文件但不再次推进revision、不再次发送 |
| 确认强杀中点 | 准备rename后、SQLite提交前；或SQLite提交后、整理加密前；主进程SIGSTOP后父进程SIGKILL，新PID解密停机前文件 | 前者DB=from、query_only须新确认；后者DB=to、已授权active；每个场景均只推进一次revision，原任务/费用/素材与1次生成调用不变 |

**协议和解释**：新增的 `pending.kind=resume` 是本机控制协议。准备态自身无发送资格；提交时再次同步核对账号、DB epoch、review有效期，随SQLite CAS一起完成；之后整理文件不再是第二次授权。恢复操作保留query_only语义，即使先前resume已提交也不会自动解除新的恢复限制。未提交的普通budget/claim不能借此恢复；core专项明确拒绝。磁盘写错与SIGKILL证明进程故障边界，不证明整机断电或攻击者同时回滚整库和系统密文。

**测试失效与修复记录**：首次Electron专项因测试比较`/var`目录、实际锚使用规范化的`/private/var`而未命中I/O钩子，14passed/5failed后主动中断，另1interrupted/6未运行，exit130；修正测试realpath后16项全部通过。首轮完整三形态273passed/7skipped/1failed，唯一失败是既有豆包入口悬停子菜单未展开；原测试隔离重复5次全部通过（10项），未复现根因。该入口跳转测试改为点击实际子菜单触发器、核对aria-expanded，再保留原登录文案与目标断言，修改后重复5次也全过；生产界面/冻结豆包不变，不据此宣称覆盖所有原生悬停时序。原生交互仍随G-UI平台矩阵验证。全部首次日志/报告与最终结果均保留于统一报告failureNotes/gates，不以最终通过覆盖首次错误。到期验证是实际main时钟注入，并非自然等待120秒；换号和恢复为真实并发IPC，不是仅在review生成和apply调用之间顺序切换。

**未执行/不能据此宣称**：Windows原生safeStorage/强杀/目录持久性、整机断电/快照回退、真实付费Provider、独立可信正额账单与跨月结算、实际历史用户库/双设备迁移、最终安装包/依赖安全扫描/生产部署回滚/远程MCP/管理员。完整API与worker套件本批未重跑（未改服务端或schema），相关正式服务联合和全仓默认单测已执行。发布卡仍须完成原生平台及外部条件。

下一阶段：[P4-R4任务拆解和goal](./V25-MIGRATION-ROADMAP.md)。

### 5.19 2026-09-08 B26：显式重试合同、费用准入与正式产品链

**结论**：本批显式重试主链已验证，R4 其余交互/故障/legacy/BYOK/R/S 入口矩阵仍开放，B26 原任务/P4/迁移整包不提前勾选。报告基于 HEAD `dcdf8d0` 加未提交工作树，源码 1307 项，SHA256 `5342cbb0df26f103ba89e49887fac42cb583ca1a854fd7e9faa791927d42c9dc`；[源码清单](../../tests/v25/.results/b26/source-files.json)、[相对 B25 的 20 个路径](../../tests/v25/.results/b26/source-delta-from-b25.json)、[末次无漂移核对](../../tests/v25/.results/b26/source-verification-final.json)。统一入口：[完整摘要](../../tests/v25/.results/b26/validation-summary.json)。没有新增 DDL、worker 生产代码或视觉基线变更。

| 阶段 | 实际执行和结果 | 来源与覆盖边界 |
|---|---|---|
| T1 定向合同/账本 | 修正非法 receipt 测试数据后 ledger-second 两文件52passed；runtime-first 五文件88passed；最终全仓覆盖后续增量 | [账本日志](../../tests/v25/.results/b26/ledger-second.log)、[主进程接缝](../../tests/v25/.results/b26/runtime-first.log)。这些早期运行不是最终同源码全集 |
| T1 全仓门禁 | check-final 35/35，30cached；根2259passed/20gated skipped，features614passed；lint/类型/边界/双端构建通过 | [命令时间](../../tests/v25/.results/b26/check-final-summary.json)、[日志](../../tests/v25/.results/b26/check-final.log)。首次 check 35/35、0cached；根20个默认skip含本批另跑的15个实际服务场景和5个PG门禁，不能把后5项算成本批已跑 |
| T2 正式主进程联合 | 10 文件 171 passed、0skipped：真实服务15、runtime/client/IPC/gateway/core execution 88、ledger37、公共合同12、桌面合同16、legacy barrier3 | [命令时间](../../tests/v25/.results/b26/joint-final-summary.json)、[日志](../../tests/v25/.results/b26/joint-final.log)。真实 HTTP/PG/Graphile/worker，认证/status/Provider/S3 为合成服务 |
| T2 API 完整集成 | 14 文件 220 passed；包含新旧重试规则、回执/队列事务、完整既有 API integration | [命令时间](../../tests/v25/.results/b26/api-final-summary.json)、[日志](../../tests/v25/.results/b26/api-final.log)。从 API 包入口执行；没有将 root Vitest 忽略的 API 文件算成通过 |
| T3 Electron 定向 | 首次1passed/1failed，增加列表加载前置后2passed；界面取消/重试、回包损坏、新 PID 同意图并发；未知费用/旧 string 托管调用拒绝 | [首次报告](../../tests/v25/.results/b26/electron-first-report.json)、[通过报告](../../tests/v25/.results/b26/electron-second-report.json)。实际 safeStorage 与隔离 userData，未用正式用户数据 |
| T3 完整三形态 | **276passed/7skipped/0failed/0flaky**；PC81/2skip、Mobile80/3skip、Electron115/2skip；含既有强杀/备份/恢复确认回归 | [命令时间](../../tests/v25/.results/b26/e2e-final-summary.json)、[JSON报告](../../tests/v25/.results/b26/e2e-final-report.json)、[逐项目和逐条skip](../../tests/v25/.results/b26/e2e-counts.json)、[新 PID 父子请求证据](../../tests/v25/.results/b26/formal-retry-evidence.json) |
| 内容扫描 | source规则扫描1211文件，0findings/errors/accepted | [扫描报告](../../tests/v25/.results/b26/security-source-final.json)；这是源码内容规则扫描，不是依赖漏洞、最终安装包或生产安全验收 |

**行为验收与证据强度**：

| 验收点 | 本批实际断言 | 尚不能据此宣称 |
|---|---|---|
| 新授权/同意图 | IPC 保留 caller key；真实服务并发两次同 key 和实际 Electron 新 PID 并发均返回同一子任务；总 ordinary POST=1、retry POST=1、Provider=1 | 两个独立 UUID 的快速用户点击自动合并；全部历史菜单错误反馈 |
| 原始关系与付款方 | 固定本地父 request 与云 parent run；retry 回执的 operation/sourceRunId 精确匹配；新 credential version 可增加、原 payer/请求/父费用不变 | 改换 payer 继续同一重试；生产正额账单证明 |
| 丢回包与恢复 | 实际 API 已接受后返回坏 JSON；重启新 PID 后原 key 查询恢复原素材，原父取消费用0保留、子成功费用unknown保留 | 重试专属每个 SIGKILL 中点、取消丢回包和恢复中换号都已覆盖 |
| 未知/历史边界 | core 拒绝排队/未知/成功/purge/错误 owner/payer/输入；API 拒绝缺回执、legacy_unbound、未知成本、状态/终态不一致和付款方变化；已接受 API key 在父 purge 后仍按原绑定重放 | 自动修复历史账本或重新绑定旧用户费用 |
| 已知正额 | API 使用 SQL 设置合法已结费用3的合成父记录，新重试保留该金额和旧 binding；core 对重复回执只结算一次 | 上游独立账单核验、完整跨月/退款处理；这些仍属于 P6 |
| 本机未发送取消 | core 真 SQLite 验证 unclaimed+cancelled+无 call/receipt 可新授权 ordinary create，并保留本地父 request | B26 此时尚未验证实际 Electron 故障到重试全链；B28 已补本机验收，见 §5.21 |
| 旧入口 | string IPC 对普通 BYOK 保留既有分支；旧 string 托管请求明确拒绝，要求携带显式意图；legacy barrier 3项与既有回归通过 | 全部 legacy 内存预留/异步结算与新启用竞争、云启用前后 BYOK/R/S 产品兼容；后续 C3/C4 必补 |

**首次失败与修复**：ledger-first 3项失败源于合成 queued/claimed-not-sent 回执违反既有合法性规则，修正 fixture，保留生产校验。types-first 暴露误插入 cancel 分支的 command 引用及 unknown 入参未收窄，已修复，最终 check 通过。joint-second 从仓库根传入 API 文件名，但 root Vitest 配置排除了 API，实际只有3文件43项；随后 api-first 从正确包入口执行2文件61项，最终又执行完整 API 套件，不把未加载文件计数。electron-first 的恢复按钮 `all()` 在异步列表加载前返回空数组，未实际点击核对；改成先断言两个按钮均已出现，再逐项点击，保留素材、费用和调用次数断言，electron-second及最终三形态通过。首次报告与日志均保留，不覆写历史失败。

**本批未验**：完整 worker 集成套件和独立 migrate CLI（无 worker/DDL 变更）；R4 剩余交互及真实旧入口矩阵；Windows 原生、真实收费/可信账单、完整跨月、真实脱敏旧库与双设备、最终安装包/依赖扫描、CI远端、生产部署/回滚/外部MCP、管理员。7项E2E skip仍为3个真实账号、1个真实中转Key、3个平台布局条件；新增2项本次显式执行。下一步 [R4-C1..C5 的任务、验收和 goal](./V25-MIGRATION-ROADMAP.md)，达标后才关闭 R4/P4。

### 5.20 2026-09-08 B27：工作台/历史重试交互与入口资格

**结论**：R4-C1 的工作台、历史列表、详情三个实际手动重试入口已通过本机验收；只关闭本批，不关闭 B26 原 R4 任务、P4 或整包。代码基于 HEAD `dcdf8d0` 加未提交工作树，源码 1309 项、SHA256 `8d7de8a9c596d518a2b567bafb703482a826f7b340596581e29ec1919e4e4f0c`，相对 B26 14 个路径。没有新增后端授权、DDL、worker 生产代码或视觉基线；测试服务 fixture 新增可暂停的 binding 响应，专用于证明真实宿主的跨屏 pending。

证据入口：[统一摘要](../../tests/v25/.results/b27/validation-summary.json)、[源码清单](../../tests/v25/.results/b27/source-files.json)、[相对 B26 差异](../../tests/v25/.results/b27/source-delta-from-b26.json)、[最终无漂移核对](../../tests/v25/.results/b27/source-verification-final.json)。历史结果继续保留，不把 B26 的完整 API 集成数字重新算为本批。

| 阶段 | 实际流程与结果 | 证据及边界 |
|---|---|---|
| T0 入口审计 | 反查真实 API/桌面 retry 只接受 failed/cancelled；工作台原先还显示 succeeded/expired 按钮。核对当前历史只有列表和详情，没有额外重试右键菜单 | 按真实合同统一入口，成功任务保留复制/参考信息和删除；不新增“重新生成”功能替代原合同 |
| T1 组件/交互 | 最终5文件 75 passed：同步双击、两个 hook/组件共享、mutation 自动重放、失败释放、独立原任务并发、账号变化后的旧错误隔离；历史列表/详情 pending 和未知费用引导 | [命令与时间](../../tests/v25/.results/b27/features-final-summary.json)、[日志](../../tests/v25/.results/b27/features-final.log)。fake gateway/deferred Promise/toast mock；不是实际账号服务或账单 |
| T1 全仓 | 最终 check 35/35、30cached；根 2259 passed/20 gated skipped，features 622 passed；类型/lint/边界/双端 build 通过 | [命令时间](../../tests/v25/.results/b27/check-final-summary.json)、[日志](../../tests/v25/.results/b27/check-final.log)。默认 API/worker/DB gated 集成未执行的部分仍算 skip，不用“全仓通过”替代它们 |
| T2 正式服务 | 正式 main runtime→真实 Hono/PG/Graphile/worker 的既有联合1文件 15 passed，包含父子关联、同 key 并发、轮换、损坏回包、unknown 拒绝 | [命令时间](../../tests/v25/.results/b27/service-final-summary.json)、[日志](../../tests/v25/.results/b27/service-final.log)。身份/Provider/S3为合成服务；本批修改的 fixture 已回归 |
| T3 定向三形态 | 首次即 32 passed、0skip/failed/flaky；PC/Mobile 历史各15项，Electron2项 | [命令时间](../../tests/v25/.results/b27/retry-ui-e2e-first-summary.json)、[JSON报告](../../tests/v25/.results/b27/retry-ui-e2e-first-report.json)。Web 为受控 HTTP 409；Electron 使用实际服务与隔离 userData |
| T3 完整三形态 | **278 passed/7 skipped/0failed/0flaky**；web-desktop 82通过/2跳过、web-mobile 81通过/3跳过、electron 115通过/2跳过 | [命令时间](../../tests/v25/.results/b27/e2e-final-summary.json)、[JSON报告](../../tests/v25/.results/b27/e2e-final-report.json)、[分项目及逐项skip](../../tests/v25/.results/b27/e2e-counts.json)。实际 Electron 含既有强杀、备份和恢复回归；本批不更新视觉基线 |
| 内容扫描 | source 规则扫描 1213 文件，0findings/errors/accepted | [报告](../../tests/v25/.results/b27/security-source-final.json)。仅源码内容扫描，不等同依赖漏洞、安装包或生产扫描 |

**按行为验收，而非只按总数验收**：

| 验收点 | 实际触发与断言 | 保障边界 |
|---|---|---|
| 同步重复点击 | 两次 DOM `button.click()` 在同一 evaluate 内执行；unit 也同时调用两个 hook；首次 gateway/API 意图只有1个 | UUID 在准入后生成，避免只靠 React 下一帧 disabled；不合并用户在上次交互结束后的新明确意图 |
| 跨入口 pending | Electron 在真实 binding GET 暂停期间从工作台跳历史，再打开详情，三个按钮均 disabled；Web 列表提交后详情也 disabled | 按 QueryClient/账号 epoch/原任务共享；不跨独立渲染进程或重启共享 Promise |
| 自动重放与释放 | 组件中网络首次失败、mutation 自动重试沿用相同参数/key；最终成功或失败释放准入；再次点击 key 不同 | 仅复用该 mutation 的网络重放。未知远端执行是否允许新意图由持久账本/后端裁决，不用 UI Promise 代替 |
| 失败可见 | PC/Mobile 实际 toast 展示“重试未完成”和服务器原因；列表/详情恢复可操作；组件证明只有一次错误提示及账号云核对动作 | 当前三个手动入口；兑换后的独立续发仍会吞异常，已明确登记 C4，不计为本批已修 |
| 账号隔离 | hook 中旧账号请求尚未结束时切 epoch，再对同 ID 发起当前账号交互；旧失败不提示、新 pending 不被旧 finally 清除；不同原任务可并行 | 这是共享层测试；重试准备中真实账号/备份恢复故障仍需 C2 |
| 资格与费用 | 成功/过期不显示后端拒绝的重试；账号云失败/取消且费用已知、未purge才显示；unknown 保留核对说明 | UI 显示不授予发送权限；实际 Electron unknown 场景额外直接调用 structured/旧 string IPC，均拒绝且 retry POST=0，原费用仍 null |
| 实际父子与新 PID | Electron 同步双击→跨屏 pending→服务端接受后坏回包→关闭/新 PID→同意图并发→核对下载；原父取消费用0不变，子成功费用unknown不被写零 | 总 ordinary POST=1、retry POST=1、Provider=1，两个本地持久请求与同一父子关联。见[原始证据](../../tests/v25/.results/b27/formal-retry-evidence.json)；此例为正常关闭后新 PID，不冒充重试中点 SIGKILL |

**首次失败与修复**：features-first 为1 failed/70 passed，原引用测试用 fake host 对成功任务点重试，真实两端都不接受；保留成功任务原输入/引用断言，新增无重试断言，再用取消任务验证重试后的冻结输入。首次全仓 check 在新测试的非规范错误码强转处 TS2352 失败，改为合同内 `INTERNAL_ERROR`，不放宽生产 schema。Turbo 当时29/34后中断依赖任务，退出130的被取消构建不算另一个独立产品故障。其后 check-second/final、组件-final 及定向/完整 E2E 均通过。首次日志见 [features-first](../../tests/v25/.results/b27/features-first.log) 和 [check-first](../../tests/v25/.results/b27/check-first.log)，时间与退出码均在统一摘要 gates 中保留。

**未验与下一步**：UI pending 只持续到本次 mutation 结束，远端任务可以继续执行；新意图是新授权，不声称在整个远端生命周期禁止所有后续重试。R4-C2 专属 claim/POST/取消故障、未领取取消新授权、父清理/再次轮换与换号恢复，C3 真实旧入口预留/异步结算，C4 BYOK/R/S 与兑换续发仍按[路线图 §6.15](./V25-MIGRATION-ROADMAP.md)执行。API/worker 完整集成与独立 migrate CLI 本批未另跑（没有对应生产/DDL变化）；默认门禁未执行项仍保留。7个 E2E skip 为真实账号/中转 Key 和视口条件，逐项列在报告；新增场景均实际执行。原生 Windows、断电、真实账单/跨月全集、历史用户库/双设备、最终安装包/依赖扫描/远程CI/生产部署回滚/外部MCP与管理员，不能从本批本机结果推断完成。


### 5.21 2026-09-08 B28：真实桌面重试故障、身份切换与原任务恢复

**结论：R4-C2 的本机 macOS 矩阵通过；R4/P4 和整包仍部分完成。** 本批增加测试及 fixture，没有修改生产费用/授权逻辑、数据库结构、产品界面或视觉基线。源码身份为 HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交树，共 1312 项，摘要 `1bae587d59ba8c56efa81e492cd78f1e23cb0a4ee798a658f5cf252c4eaed192`；相对 B27 仅 4 个测试文件变化。摘要覆盖源码/测试/配置，文档与结果不在该摘要内，不能把摘要当作 clean commit。

执行顺序为首次强杀专项 → 首次恢复专项 → 加强精确终态/并发重放断言 → 可见恢复与原父财务快照 → 最终源码 check → 源码内容扫描 → 完整三形态 E2E。期间没有失败；加强断言后的早期报告继续保留为阶段证据，不冒充最终源码复跑。完整报告及命令时间见[统一摘要](../../tests/v25/.results/b28/validation-summary.json)。

| 阶段 | 实际命令 / 报告 | 实际结果与口径 |
|---|---|---|
| 首次强杀专项 | `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron electron.retry-faults.spec.ts`；`retry-crash-first-report.json` | 7通过，0失败/跳过；7 个强杀与未领取新授权场景 |
| 首次恢复专项 | 同上，文件改为 `electron.retry-recovery.spec.ts`；`retry-recovery-first-report.json` | 10通过，0失败/跳过；6 个换号/恢复竞争、2 个父生命周期、2 个取消坏回包 |
| 加强后的两文件专项 | 两文件同次运行；`retry-final-report.json` | 17通过，0失败/跳过；加入 SIGKILL 后相同原意图并发重放、精确终态与 Provider 次数 |
| 可见恢复增量 | `electron.retry-recovery.spec.ts -g '已接受重试遇'`；`ui-recovery-final-report.json` | 2通过，0失败/跳过；实际设置页核对、图片落盘/本地终态及父财务快照；仍早于最终证据路径脱敏 |
| 最终源码统一门禁 | `pnpm run check`；`check-final-third-summary.json` | 35/35任务通过，32项缓存；根单测 2259通过/20门控跳过，features 622通过。缓存不是全部重新执行 |
| 最终源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b28/security-source-final-third.json` | 1216文件，0发现/错误/豁免；只证明本规则覆盖的源码内容，不代替依赖漏洞扫描和安装包扫描 |
| 完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`；[最终报告](../../tests/v25/.results/b28/e2e-final-report.json) | 295通过/7跳过/0失败/0 flaky；web-desktop 82通过/2跳过；web-mobile 81通过/3跳过；electron 132通过/2跳过；17 个新增场景均实际运行 |

以上报告均位于 `tests/v25/.results/b28/`。完整 E2E 运行时间为 2026-09-08T12:51:22.080683+00:00 至 2026-09-08T13:07:47.564442+00:00（UTC；北京时间加8小时）。跳过项的名称和条件见[项目计数与跳过清单](../../tests/v25/.results/b28/e2e-counts.json)，没有以默认数据库 skip 代替这17项真实服务测试。未另跑完整 API/worker 集成套件和 migrate CLI：本批仅测试变化，新增 E2E 启动实际 API/PG/worker；B26 的 API 220 项属于历史证据，不记作本批结果。

| 验收组 | 场景数量与实际断言 |
|---|---|
| 重试专属强杀 | 6：领取前、claim 已提交/锚待提交、retry POST 前、实际201回包后、排队取消200后、Provider 已领取取消200后。记录精确命中点/URL、SIGKILL、新旧 PID、SQLite/checkpoint/密文锚、父子 key、付款方与月份；重启后两个并发原意图回放返回同一本机子任务，查询不再 POST |
| 未领取取消后的新授权 | 1：普通父请求领取前强杀，重启后实际历史页面取消并重试；父无云 receipt、费用0，新子请求按 ordinary_create 入队，保留本地父关系；不是假造 explicit_retry 的远端父 |
| 换号与真实恢复竞争 | 6：首次 binding、领取前第二次 binding、已接受子请求的 receipt 等待，各与 account login / system.restoreBackup 交错；旧响应不写新身份或恢复后的库。晚阶段本地 run 可见不等于云发送已授权 |
| 已接受子任务遇父生命周期变化 | 2：坏201后父被purge或凭据再次轮换，新 PID 重放原 retry 明确拒绝并指引原任务核对；实际设置页 GET 恢复同一子任务。父purge后子成功并落图；发送前再次轮换则子失败、未发送费用0；不制造替代任务 |
| 取消回包损坏 | 2：排队/已领取两种实际200坏JSON；取消意图持久保留，新 PID 核对同一子任务。排队取消已知0；已领取保持未知，不因回包错误释放成0 |

每组均比较父请求原 binding、budget_month、预留、调用费用及回执，证明子请求没有重写父财务事实；不是跨月模拟或真实正额账单核对。17 份附件汇总见[故障证据](../../tests/v25/.results/b28/formal-retry-fault-evidence.json)，保存了次数/终态/原意图与父子状态，合成 userData 路径已替换。

**真实与合成边界**：Electron 主进程、safeStorage、SQLite、Hono、PostgreSQL、Graphile 和 worker 是实际运行；身份/Provider/S3 使用隔离合成服务。测试仅在自有 fetch/safeStorage 边界暂停，断言发生过目标调用；没有生产测试后门。强杀测试使用 POSIX SIGSTOP/SIGKILL，不代表 Windows 原生强杀、断电或整机回滚。

**恢复边界**：备份早于子请求时，恢复会按备份移除较新的本机记录，晚到回执不能复活该记录，锚保持 query_only；本机没有记录不等于云端未执行，也不承诺从旧备份恢复完整云任务列表。父清理/再次轮换后的原 retry 命令当前会重新校验并拒绝，已接受子任务通过独立 GET 核对入口恢复；本批验证该行为，没有把它描述为自动重试成功。

**后续**：C3 先证明正式 legacy 入口可达性，再验异步结算/启用及换号恢复竞争；C4 补 BYOK/R/S/兑换续发反馈和并发；C5 按原 R4 条件合流。阶段拆解和下一 goal 见[路线图 §6.16](./V25-MIGRATION-ROADMAP.md)。Windows 原生、可信正额账单/完整跨月、真实历史数据/两设备、最终安装包/安全/部署/MCP 仍独立待验，管理员未启动。


文档交付检查：14份文件的相对链接目标、代码围栏及3000行限制检查通过，`git diff --check`通过，冻结源码无漂移。迁移任务包校验仍为退出码1（38/44任务完成、1项整体验收未勾选），准确表示整包未完成；不能把本批测试通过改写为迁移验收通过。详见统一摘要中的 `docs-final`、`diff-final`、`spec-final` 记录。

### 5.22 2026-09-08 B29：兑换到账、生成恢复与桌面额度引导

**结论：兑换恢复的本机交互切片通过；完整 C3/C4、R4/P4 和迁移整包仍未完成。** 本批修改共享账号/生成 hooks、账号面板/设置导航、恢复意图消费及桌面历史错误映射，不改 API 兑换服务、授权/费用账本、schema 或视觉基线。源码为 HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交树，共 1315 项，摘要 `da51f777c45d0f34758d9999faad1caad34c1c6208f938e48950ea0e376aa8a2`。源码清单包含测试与配置，不包含文档和结果；不能当作已提交版本。

执行顺序：定向组件 → 兼容回调修复 → 全仓检查/构建 → 新增界面用例首次运行 → 修正 HTTP fixture 与桌面额度映射 → 复跑界面 → 最终源码 check/扫描 → 完整三形态。原始失败报告全部保留，不用最终通过覆盖首次结果。精确命令与 UTC 时间见[统一摘要](../../tests/v25/.results/b29/validation-summary.json)。

| 阶段 | 实际命令 / 报告 | 实际结果及口径 |
|---|---|---|
| 组件首次 | `pnpm --filter @musefold/features exec vitest run src/account/__tests__/redeem-recovery.test.tsx src/account/__tests__/account.test.tsx src/workbench/__tests__/retry-action.test.tsx src/workbench/__tests__/account-recovery-generation.test.tsx`；`features-first.log` | 58通过/3失败；把原 `request` 回调改成 Promise 破坏了原 void 调用契约，测试 act 作用域泄漏。修源码保留 void `request`，另加 `requestAsync`，未删原测试 |
| 组件复跑/扩充 | 同上；`features-second.log` / `features-final.log` | 61通过；再加“已返回失败子任务不能显示进行中”，最终62通过，其中9项新用例 |
| 旧入口基线复跑 | `pnpm exec vitest run apps/desktop/electron/main/__tests__/automation-durable-generation.test.ts apps/desktop/electron/main/__tests__/automation-durable-runs.test.ts apps/desktop/electron/system/__tests__/legacy-managed-spend.test.ts` | 3文件24通过。真实 SQLite/部分回环 Provider，DB/keychain/宿主装配等按 fixture 替换；不是正式 Electron C3 全链验收 |
| 界面首次 | `pnpm exec playwright test -c tests/v25 web.redeem-recovery.spec.ts electron.redeem-recovery.spec.ts`；`redeem-e2e-first-report.json` | 2通过/3失败。两条 Web 失败是 fixture 使用了契约外的 `CONFLICT` 错误码，HTTP 正确退回通用提示；改为契约码。Electron 先暴露 `NO_BALANCE` fixture 不应代表官方额度，再核对真实 core 的 `ACCOUNT/QUOTA` 也被 IPC 降级，补生产映射与正反例 |
| 界面复跑 | 同上；`redeem-e2e-second-report.json` | 5通过/0失败/跳过：PC/移动各2，Electron1。真实浏览器/生产构建和实际 Electron/main/SQLite；兑换 HTTP 为合成，未调用付费上游 |
| 最终源码统一门禁 | `pnpm run check`；`check-final-summary.json` | 35/35通过，32项缓存；根单测2260通过/20门控跳过，features 631通过；新增主进程正反例由该门禁覆盖。此前两次 check 也通过，最终记录为当前源码 |
| 最终源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b29/security-source-final.json` | 1219文件，0发现/错误/豁免；不代表依赖、安装包或生产扫描 |
| 完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`；[最终报告](../../tests/v25/.results/b29/e2e-final-report.json) | 300通过/7跳过/0失败/0 flaky；web-desktop 84通过/2跳过；web-mobile 83通过/3跳过；electron 133通过/2跳过；新增5项均实际运行 |

报告在 `tests/v25/.results/b29/`。完整 E2E 时间 2026-09-08T13:32:49.813049+00:00 至 2026-09-08T13:48:51.229636+00:00（UTC，北京时间加8小时）。[跳过清单](../../tests/v25/.results/b29/e2e-counts.json)逐项记录视口条件与 live 凭据门控；默认单测里的数据库 skip 不被计作通过，完整 E2E 明确启用既有实际 Hono/PG/worker 场景。当前没有 API/worker 生产或 DDL 变化，因此未另跑完整服务集成和 migrate CLI；历史通过数不充作本批结果。

| 验收行为 | 实际断言与范围 |
|---|---|
| 到账与续发独立 | 先收到兑换结果就更新余额并提示成功；续发等待时独立 pending。请求被拒绝显示失败，已返回 failed 子任务也显示失败；生成失败不能把兑换 mutation 变成失败或重新兑换 |
| 原任务导航 | Web 请求失败返回原任务；返回失败子任务则选择子任务；Electron 通过正式历史→账号→兑换→历史链路。用提示词/错误差异确认目标，未只断言路由变化 |
| 并发与重放 | 组件分别验证手动先发、兑换先发都共享一个未结束 retry；create 的原输入与原 key 在配置网络重试后保持不变。共享仅覆盖 mutation 期间，不承诺跨进程或整个远端生命周期 |
| 账号与意图竞争 | 兑换响应或生成结果到达前换号，旧结果不更新余额/提示/恢复状态；兑换等待期间新选择另一恢复意图，旧兑换不消费它；兑换失败保留意图，禁用自动兑换重试 |
| 桌面官方/BYOK 区分 | core 历史托管错误 `ACCOUNT/QUOTA` 与正式契约码保留兑换引导；通用 BYOK `NO_BALANCE` 保留上游错误语义。真实 Electron 种入已结束官方额度失败记录，原连接缺失时失败可见；合成账号只兑换一次且无云生图 API 请求 |

**证据限制**：账号兑换和 Provider 均为合成或不调用；未核对真实 New API 兑换码/账单，不证明完整跨月或正额计费。UI 恢复提示是组件状态，不跨页面/重启保存；原任务持久恢复仍走已有网关。C3 只读审计及24项既有测试不能替代旧在途、异步结算与启用的实际宿主矩阵。C4 的 BYOK/默认切换/R/S 全路径仍待验，详见[路线图 §6.17](./V25-MIGRATION-ROADMAP.md)。Windows 原生、真实历史库/两设备、最终安装包/依赖扫描/远程CI/部署回滚/外部MCP及管理员不由本轮本机结果覆盖。



文档交付核对：本轮14份文件的相对链接目标、围栏与3000行限制检查通过，`git diff --check`通过，最终源码无漂移。迁移任务包为39/45任务完成、1项整体验收未勾选，校验退出码1准确表示整包尚未验收；只关闭B29，不关闭B26/R4/P4。实际记录见本批统一摘要中的文档、diff和任务包检查。

### 5.23 2026-09-08 B30：旧账号执行准入、自备重试与持久启用

最终源码 **1321项**，摘要 `1ab821e097e6d54ddf2ffb3245fa31774f9c607ea1b48270e3e7b9ac4c91ef19`，基于 HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交工作树；[相对 B29 增量](../../tests/v25/.results/b30/source-delta-from-b29.json)、[无漂移核对](../../tests/v25/.results/b30/source-verification-final.json)、[统一报告](../../tests/v25/.results/b30/validation-summary.json)。没有数据库 DDL、版本号或视觉基线修改。B30 的完整 C3/C4 总任务仍开放，以下是已经实际执行的子范围。

| 阶段 | 实际命令/入口与结果 | 能证明什么 |
|---|---|---|
| T1 核心与多进程定向 | `pnpm exec vitest run packages/core/src/services/__tests__/generation-legacy-account.test.ts packages/core/src/db/repositories/__tests__/automation-spend-process.test.ts`，2文件7通过，exit0；[命令](../../tests/v25/.results/b30/model-and-process-summary.json) | 三项新 core 测试覆盖旧账号直接/伪选 BYOK retry 拒绝、独立 BYOK 错误分类，以及模型默认改变/调用者输入改变后重放原 body；四项既有 SQLite 子进程仲裁保留 |
| T0/T1 最终全仓 | `pnpm run check`，35/35 成功，30缓存，exit0；根2264通过/20条件跳过，features632通过；[命令](../../tests/v25/.results/b30/check-final-summary.json)、[输出](../../tests/v25/.results/b30/check-final.log) | Biome/typecheck/单测/双端 build/依赖边界通过。默认被环境 gate 的 API/worker/DB 集成不能算本批独立全集重跑 |
| T2/T3 旧账号正式入口 | `pnpm exec playwright test -c tests/v25 --project=electron electron.legacy-generation.spec.ts`，1通过；[报告](../../tests/v25/.results/b30/legacy-electron-routes-report.json) | 实际 Electron/SQLite/safeStorage/Automation discovery；普通 G、两种本地 retry、本地方案、实际 Automation G/R/S 均不把旧未绑定 Key 发上游；历史详情可转连接设置 |
| T3 BYOK 兼容 | 同配置指定 `electron.byok-cloud-compat.spec.ts`，修复后1通过；[报告](../../tests/v25/.results/b30/byok-electron-second-report.json) | 云启用前生成/取消/两种重试保留 body，云默认下自备 A/B 选择正确，本地方案与 Skill 独立出图；最终全量进一步断言合成凭据标识与实际模型对应 |
| T3 持久启用 | 同配置指定 `electron.legacy-enablement.spec.ts`，修正 locator 后3通过；[报告](../../tests/v25/.results/b30/legacy-enablement-second-report.json) | 其他 scope/旧月份 held、unknown、terminal 但未结 call 均阻止实际 UI/IPC 启用，提交时重查事前 review；原费用/连接不变，无新锚/checkpoint |
| T3 同源码完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`，**305通过/7跳过/0失败/0 flaky，exit0**；web-desktop 84通过/2跳过；web-mobile 83通过/3跳过；electron 138通过/2跳过；[命令](../../tests/v25/.results/b30/e2e-final-summary.json)、[报告](../../tests/v25/.results/b30/e2e-final-report.json)、[分项目及跳过理由](../../tests/v25/.results/b30/e2e-counts.json) | 本批新增5项均实际执行，沿用既有真实 Hono/PG/队列/worker 与强杀恢复场景。专项计数不与全量相加；开始2026-09-08T22:16:58.705694+08:00，结束2026-09-08T22:33:31.888139+08:00（Asia/Shanghai） |
| 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b30/security-source-final.json`，1225文件，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b30/security-source-final.json) | 当前源码内容规则通过；不代表依赖漏洞、安装包或生产安全全验 |

首次失败必须保留：

1. **实际发送准入缺陷**：`legacy-reproduce` 1失败；同一旧账号 Provider 在正式 Automation 被拒绝，而本地 G 实际发出1次 HTTP 图像请求。公共 core 增加未绑定账号准入防护后，正式 G/retry/R/S 测试的图像/文本发送均为0。[原始失败](../../tests/v25/.results/b30/legacy-reproduce-report.json)。历史托管配置按 baseline 的 openai-compatible/account 形状预置，没有关闭正式持久包装。
2. **默认模型快照缺陷**：`byok-electron-first` 1失败；首次 body 为 `fixture-a`，取消后 retry body 变为 `unknown`。core 现在在创建 run 前解析默认模型，新增回归改变当前配置和调用者参数仍保留原 body。[原始失败](../../tests/v25/.results/b30/byok-electron-first-report.json)。旧历史里已有的 `unknown` 没有被猜测或覆盖，该恢复分类仍列下一条任务。
3. 新 core fixture 起初漏填契约要求的 size/quality，`check-first` 类型检查失败；补齐测试输入，没有放宽契约。[记录](../../tests/v25/.results/b30/check-first-summary.json)。
4. `check-model` 有1项既有 SQLite 独立进程用例超出默认5000ms，其余根2263通过；单独复跑7项及最终全仓均通过，未增加 timeout 或删断言。[原始日志](../../tests/v25/.results/b30/check-model.log)。按一次发生且复跑通过记录，不宣称已证明所有环境均无时序风险。
5. 启用专项首次3失败，原因是相同错误同时出现在状态文本和 toast，通用文本 locator 不唯一。改为状态元素，并准确断言 blocked/no-review 与事前 review 的提交复查，第二次3通过；没有为这个测试修改产品。[首次报告](../../tests/v25/.results/b30/legacy-enablement-first-report.json)。

真实性与限制：真实的是正式 macOS Electron、主进程 IPC、系统 safeStorage、SQLite、Automation G/R/S 包装及 HTTP 请求。账号身份/执行绑定、生图/文本响应为回环合成服务；GitHub 使用已有 E2E REST reader origin override，不代表真实公开来源 archive 验收。费用启用用例在另一个实际 SQLite 连接通过 repository 布置历史记录；它证明历史持久数据约束，不能代表当前未绑定入口取得了付费授权。BYOK R/S 五条调用都为 external，托管策略/月份/已记费用/预留不变；没有正额真实上游账单。

未覆盖的完整 C3 在途/最终结算/换号恢复矩阵、C4 剩余双向组合和不同连接管理入口、历史 unknown-model 恢复、CLI/MCP 二进制端到端、原生 Windows、真实旧库/两设备、最终安装包/依赖扫描/远程 CI/部署回滚仍归原卡。原条件及可复制下一条 goal 见[路线图 §6.18](./V25-MIGRATION-ROADMAP.md)，管理员未启动。


### 5.24 2026-09-08 B31：共用连接规则、双向自备兼容与实际客户端

本批源码 **1325项**，摘要 `40aba6dcc793e5f053194a9ee07f2c10107291b5a88dbd4d965814131915335e`，HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交工作树；相对 B30 **7条路径**，没有 schema/版本号/视觉基线变更。[增量清单](../../tests/v25/.results/b31/source-delta-from-b30.json)、[最终无漂移](../../tests/v25/.results/b31/source-verification-final.json)、[统一报告](../../tests/v25/.results/b31/validation-summary.json)。B31 完成既定本机连接规则和兼容子任务，原 R4/P4/整包未关闭。

| 阶段 | 实际命令与结果 | 验证范围 |
|---|---|---|
| T1 专项单元/事务 | `pnpm exec vitest run apps/desktop/electron/system/__tests__/provider-connections.test.ts apps/desktop/electron/main/ipc-v25/__tests__/providers-domain.test.ts`，2文件25通过，含10项新用例，exit0；[命令/日志](../../tests/v25/.results/b31/provider-unit-first-summary.json) | Key零写、可信激活等待/拒绝、缺失目标、默认接管、SQL触发器强制创建/接管失败后的事务回滚；真实SQLite，账号验证器/keychain与无关IO为明确替身 |
| T0/T1 最终全仓 | `pnpm run check`，35/35成功、32缓存，根2274通过/20条件跳过，features632通过，exit0；[命令](../../tests/v25/.results/b31/check-final-summary.json)、[输出](../../tests/v25/.results/b31/check-final.log) | lint/typecheck/单测/双端build/依赖边界；没有把默认跳过的服务器集成当作本批独立全集重跑 |
| T3 正式宿主专项 | `pnpm exec playwright test -c tests/v25 --project=electron electron.local-provider-policy.spec.ts electron.byok-cloud-compat.spec.ts electron.agent-clients.spec.ts`，7通过/0失败，exit0；[报告](../../tests/v25/.results/b31/provider-target-final-report.json) | 5项本地管理正反例、1项扩展双向BYOK、1项真实CLI/MCP多场景；合计不是7个单一HTTP请求 |
| T3 实际 CLI/MCP | `electron.agent-clients.spec.ts` 在启动测试App前以 `scripts/build-cli.mjs` 构建分发入口，再开独立Node CLI/MCP进程；正确命令格式下1通过；[专项报告](../../tests/v25/.results/b31/agent-clients-second-report.json)、[最终入口文件摘要](../../tests/v25/.results/b31/client-artifacts.json) | MCP SDK通过真实stdio JSON-RPC；两个客户端各G/R/S自备成功/旧账号拒绝，总12次业务调用；自备图像6次、文本2次，旧账号增加0次发送。不是外部远程MCP或headless守护验收 |
| T3 最终完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`，**311通过/7跳过/0失败/0 flaky，exit0**；web-desktop 84通过/2跳过；web-mobile 83通过/3跳过；electron 144通过/2跳过；[命令](../../tests/v25/.results/b31/e2e-final-summary.json)、[报告](../../tests/v25/.results/b31/e2e-final-report.json)、[项目计数/跳过原因](../../tests/v25/.results/b31/e2e-counts.json) | 新增6项及扩展1项均运行；沿用真实Hono/PG/Graphile/worker和旧恢复故障。专项不能与全量相加。开始2026-09-08T22:58:32.680329+08:00，结束2026-09-08T23:14:49.007320+08:00（Asia/Shanghai） |
| 源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b31/security-source-final.json`，1229文件，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b31/security-source-final.json) | 内容规则扫描，不等于依赖漏洞、最终安装包或生产全出口安全验收 |

本批行为证据：

- **保护边界**：正式本地质询不能创建云保留类型、不能给云连接写Key、不能退出账号后激活云连接；拒绝后Provider记录不变。删除默认自备连接不再自动选择旧云/旧账号行。
- **合法管理**：实际文件质询→本地HTTP新建/保存合成Key→当前可信云连接激活与探测→切回自备生成成功→删除后另一条自备接管。实际HTTP模型和合成凭据标识一致。
- **双向BYOK**：云启用前后均取消原任务并用两种retry输入形式重放，原body/Provider/模型/密钥来源不变；两个阶段都执行正式本地方案/Skill，累计10条R/S调用的付款类别均external，托管策略/月份/已记费用/预留不变，无云G创建POST。
- **客户端**：CLI使用实际构建入口与进程退出码/NDJSON，MCP使用实际构建入口及SDK/stdio。两者实际执行G/R/S，旧未绑定账号错误均保留 `PAYMENT_IDENTITY_UNBOUND`，没有移除持久wrapper或把函数调用当客户端。

首次失败与处理：

1. `local-policy-reproduce` **4失败**。创建云类型、云Key写入、退出后激活三项都错误返回200；实际界面IPC删除默认连接后，旧云行被置为active。共享主进程服务修复准入与接管、本地创建加入类型检查/事务后四项通过，并补合法本地管理与事务单测。[原始失败报告](../../tests/v25/.results/b31/local-policy-reproduce-report.json)。
2. `agent-clients-first` **1失败**，fixture把 `--json -y` 放在命令前，而现有CLI解析器要求命令在前，因此退出2；改为既有正式用法的 `musefold generate ... --json -y` 等格式，第二次通过。[首次报告](../../tests/v25/.results/b31/agent-clients-first-report.json)。未为测试改CLI语法或放宽错误断言。
3. 专项单元、两次全仓检查和最终专项通过；没有更新视觉基线或提高超时来掩盖失败。此前B30的首次模型/入口缺陷记录原样保留。

真实组件包括macOS Electron、主进程IPC、safeStorage、SQLite、正式local challenge文件与HTTP、CLI/MCP独立进程。认证/执行绑定、生图/文本响应仍为回环合成服务，GitHub采用已有E2E REST reader origin override。它们不证明真实上游账单、公开来源archive、CLI/MCP账号云托管G/R/S、原生Windows、最终安装包、远程CI/部署回滚或真实旧用户库。C4.4历史unknown模型与C3原条件适用性/C5合流仍按[路线图 §6.19](./V25-MIGRATION-ROADMAP.md)完成；管理员未启动。


### 5.25 2026-09-08 B32：旧模型缺失的明确重试反馈

本批冻结源码 **1327项**，摘要 `8ef7aa3d4db46ec9bd8134df1275e456b7db64c52108df589e55533f8ed89034`，HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交工作树。相对 B31 的[源码增量](../../tests/v25/.results/b32/source-delta-from-b31.json)、[最终无漂移](../../tests/v25/.results/b32/source-verification-final.json)、[统一报告](../../tests/v25/.results/b32/validation-summary.json)均已保存。无 DDL、版本号、视觉基线、收费或账号生产逻辑变更。仅关闭 B32 本机恢复子任务，原 C3/C5/R4/P4 和整包仍部分完成。

| 阶段 | 实际命令 / 结果 | 覆盖与限制 |
|---|---|---|
| T1 core/IPC | `pnpm exec vitest run packages/core/src/services/__tests__/generation-legacy-account.test.ts apps/desktop/electron/main/ipc-v25/__tests__/workbench-domain.test.ts`，2文件44通过，7项新用例，exit0；[第二次专项](../../tests/v25/.results/b32/model-unit-second-summary.json) | 实际 SQLite，unknown 变体拒绝、原整行/费用不变、key读取与HTTP不增、无重试子记录；云 transport 为显式端口替身，证明本地校验不拦该独立路径。后续补齐测试类型必填 n，最终全仓再次覆盖 |
| T1 注册测试修正 | `pnpm --filter @musefold/features exec vitest run src/account/__tests__/account.test.tsx`，1文件43通过，exit0；[报告](../../tests/v25/.results/b32/account-regression-second-summary.json) | fake gateway。保留等待期间模式锁定；成功后登录态及表单卸载，失败后模式/提交解锁；净增1项，不改账号产品逻辑 |
| T0/T1 最终全仓 | `pnpm run check`，35/35成功、30缓存；根2281通过/20条件跳过，features633通过，exit0；[命令](../../tests/v25/.results/b32/check-final-summary.json)、[输出](../../tests/v25/.results/b32/check-final.log) | lint/typecheck/单测/双端build/依赖边界。未把默认条件跳过的服务器集成写成单独全集重跑 |
| T3 首轮真实宿主专项 | `pnpm exec playwright test -c tests/v25 --project=electron electron.retry-model.spec.ts electron.byok-cloud-compat.spec.ts electron.cloud-retry.spec.ts`，2通过/2跳过/0失败，exit0；[报告](../../tests/v25/.results/b32/model-target-first-report.json) | 新模型恢复、自备双向通过。此命令未设 RUN_DATABASE_TESTS，因此两项云重试跳过；不能记成4通过，后续完整三形态已实际运行这两项 |
| T3 最终完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e`，**312通过/7跳过/0失败/0 flaky，exit0**；web-desktop 84通过/2跳过；web-mobile 83通过/3跳过；electron 145通过/2跳过；[命令](../../tests/v25/.results/b32/e2e-final-summary.json)、[报告](../../tests/v25/.results/b32/e2e-final-report.json)、[计数和跳过原因](../../tests/v25/.results/b32/e2e-counts.json) | 新增历史模型恢复1项，原云重试2项与自备兼容1项全部通过；真实 Hono/PG/Graphile/worker 及原崩溃/恢复用例保留。开始2026-09-08T23:36:11.735634+08:00，结束2026-09-08T23:52:40.594495+08:00，Asia/Shanghai；专项和全量不相加 |
| 源码扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b32/security-source-final.json`，1231文件，0 findings/errors/accepted，exit0；[报告](../../tests/v25/.results/b32/security-source-final.json) | 源码内容规则，不等于依赖漏洞/最终安装包/生产出口全部安全验收 |

真实用户恢复证据：从已停止的隔离测试 App 中写入历史 cancelled/unknown/费用3的合成记录；重启后两种 IPC retry 都明确拒绝，历史详情点击重试显示说明且 pending 结束，图像调用0。用户进入连接设置看到当前模型及默认状态，再到工作台新建生成成功：实际 body 的 model=`fixture-a`、合成凭据标签a、图像调用1。原历史整行不变，无指向原记录的重试子任务；新记录模型正确、parentRunId为空。该流程不自动复制/提交旧输入，不按当前模型冒充旧意图。

首次失败均留存：

1. [真实桌面首次失败](../../tests/v25/.results/b32/model-reproduce-report.json)：修复前原 unknown 模型被接受，返回运行中子任务，未按预期拒绝。此报告证明错误受理与子记录，不单凭该失败点声称已观察到完整收费结果。
2. [单元首次失败](../../tests/v25/.results/b32/model-unit-first-summary.json)：fixture尝试写空白模型，被既有SQLite CHECK拒绝；改为可持久化的unknown大小写/外侧空白变体，保留约束。
3. [全仓首次失败](../../tests/v25/.results/b32/check-first-summary.json)：新测试请求缺必填n；补齐测试入参。
4. [全仓第二次失败](../../tests/v25/.results/b32/check-second-summary.json)：既有注册挂起测试等待成功后的表单启用，但产品进入登录态，且该fixture的getStatus仍报未登录。已改为一致的登录状态与稳定结果断言，并独立保留失败解锁场景。
5. 首次修改测试误把普通getStatus方法当vi.fn，导致[专项失败](../../tests/v25/.results/b32/account-regression-summary.json)及[第三次全仓失败](../../tests/v25/.results/b32/check-third-summary.json)；改为实际方法替换后43项与第四次/最终全仓通过。没有改产品注册流程、删断言或提高超时。

认证、绑定和图像响应仍为合成回环服务；历史库为自建fixture，核心key loader/remote transport和组件gateway为明确替身。无真实旧用户库、收费账单、Windows原生、最终安装包、远程CI/生产部署回滚证明。C3 原条件和 C5 最终映射按[路线图 §6.20](./V25-MIGRATION-ROADMAP.md)继续；管理员未启动。


### 5.26 B33：守护进程在途退出与桌面接管（2026-09-09）

**结论**：关闭 B33 生命周期切片。`musefold serve` 停止时先关闭生成准入、取消并等待当前生成完成，再关库、释放目录；重复 stop 复用同一 Promise。桌面接管已遇到的旧守护时，等待原 PID 实际退出，不能把锁文件提前消失当成进程结束；原进程超时仍活则拒绝接管。原 C3/C5、B30/B26/R4/P4 与整包继续开放。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 的未提交工作树，1329 个源码/配置/测试输入，SHA-256 `f4b05a835c6b2fe676530ac0f6d25c3bc7c699175995d2ac024fc7e1e6a708ad`。相对 B32 仅五个源码路径变化：CLI serve 及新增就地测试、桌面 takeover 及现有测试、新增真实 Electron serve 接管用例。清单与最终无漂移结果见[源码清单](../../tests/v25/.results/b33/source-files.json)和[核对报告](../../tests/v25/.results/b33/source-verification-final.json)。诊断脚本和文档不属于该源码摘要；脚本单独保留。

| 阶段 | 实际流程与命令 | 结果和可证明范围 |
|---|---|---|
| T0 真实缺陷 | B32 分发 CLI 在隔离目录向悬停的合成 Provider 发送一次，SIGTERM 后观察 PID/owner/SQLite，之后释放图像 | 原 owner/discovery 提前消失，PID/run 仍存活，迟到响应写闭库且 run 卡在 running；[原始观察](../../tests/v25/.results/b32/headless-shutdown-observation.json)和[stderr](../../tests/v25/.results/b32/headless-shutdown-stderr.log)保留 |
| T1 实际生命周期与旧进程兼容 | `pnpm exec vitest run packages/cli/src/__tests__/serve-runtime.test.ts apps/desktop/electron/main/__tests__/headless-takeover.test.ts` | 2 文件 6 项通过，新增 3 项；真实 SQLite/HTTP、取消排空/重复 stop、真实子进程提前删锁后延迟退出/超时仍活。旧行为子进程是可控 fixture，不是旧版安装包 |
| T1 全仓 | `pnpm run check`，最终 `check-verified` | 35/35，30 缓存；root 2284通过/20条件跳过，features 633通过；含双端构建/类型/lint/边界。各 workspace 集成 skip 不能加入执行数 |
| T1 超时复核 | `pnpm exec vitest run apps/desktop/electron/system/__tests__/managed-cloud-runtime.test.ts` | 16 项通过；前次全仓同文件 receipt 404 等待 POST 超时，测试及生产代码均未因此改动；原因未证实，不写成“缺陷已修” |
| T2 实际分发 SIGTERM | [独立观察脚本](../../.results/v25/2026-09-08-development/b33/headless-shutdown-verify.mjs)，实际 CLI、环境变量密钥、回环 HTTP 和 SQLite | 受理202/上游1次，SIGTERM 后进程 exit0、run cancelled、实际费用保持未知；没有闭库错误，迟到 Provider 不造成新发送。执行早于最终桌面兼容改动，CLI 本身相同；不混充整个最终源码端到端结果 |
| T3 实际桌面/守护专项 | 分发 CLI 与 Electron 目标首次 2 项通过；最终全量中再次运行同一用例 | 环境变量 BYOK 成功；旧 account 拒绝且不增加上游次数；在途生成取消、守护正常 exit0 后桌面接管；桌面持锁时第二个 serve 拒绝；新的桌面 BYOK 生成成功。上游总调用3次且凭据标签一致 |
| T3 完整三形态 | `RUN_DATABASE_TESTS=true pnpm run test:e2e` | 313通过/7跳过/0失败/0 flaky；web-desktop 84通过/2跳过；web-mobile 83通过/3跳过；electron 146通过/2跳过。北京时间 2026-09-09T00:07:58.185713+08:00 至 2026-09-09T00:23:37.711509+08:00。报告逐项保存 skip 原因，不把移动视口当作原生移动 App 或 Safari 验证 |
| 源码出口扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b33/security-source-final.json` | 通过，扫描目标 1233 文件；不是依赖漏洞、签名产物或生产环境安全扫描 |

首次两轮 check 的诊断 `.mjs` 存在未使用变量/格式错误，已经修正且保留真实缺陷报告；第三轮通过。中间名为 `check-final` 的运行实际失败：既有 receipt 404 用例在默认等待窗口内没观察到 POST；最终成功报告使用明确的 `check-verified` 名称。报告同时保留失败和独立复核，不删除测试或无限重跑来掩盖问题。

**真实/替身边界**：进程、SQLite、HTTP、分发 CLI、Electron、safeStorage 与启动接管是真实路径；Provider/凭据/旧 account 数据为测试自有合成输入，没有真实用户数据或付费请求。取消只代表本地停止等待并不再写资产，不承诺第三方已退款或没有执行。费用保持 null，不改成0。提前删锁 fixture 证明接管函数对“已识别原进程”的处理，不能证明在桌面启动前锁与 discovery 均已丢失时还能发现旧进程，更不能替代历史安装包升级/回滚验收。

统一证据：[汇总](../../tests/v25/.results/b33/validation-summary.json)、[三形态计数及跳过项](../../tests/v25/.results/b33/e2e-counts.json)、[完整报告](../../tests/v25/.results/b33/e2e-final-report.json)、[源码扫描](../../tests/v25/.results/b33/security-source-final.json)。接续任务/验收/goal 见[路线图 §6.21](./V25-MIGRATION-ROADMAP.md)。原 Windows、可信历史库、实际账单、完整 C3/C5/P5/P6、云 Agent/包、worker/GC 与部署回滚仍由原卡承担。


### 5.27 B34：云端可信 GitHub 来源持久准备（2026-09-09）

**结论**：内部单来源切片通过本机验收；公开云端 Agent、完整 GC 和整包保持开放。实现/状态机、逐用例范围和后续目标见 [来源验证](./V25-CLOUD-SOURCE-VALIDATION.md)。全部使用隔离测试数据；GitHub/S3 为回环 HTTP，S3 调用使用生产 SDK；模型和付费 Provider 调用为 0。未新增产品 UI 或桌面主进程改动，因此本批没有重跑完整 E2E；B33 的 313 passed/7 skipped 属于上一批源码，不作为 B34 的通过证据。

最终来源：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交树；1342 个源码/配置/测试文件，摘要 `e9bceed201403168857c414cee7c53c0e6439f4b292e09e9e63a0433a56a9cf9`。运行前捕获清单，文档完成后复核；这不是 clean commit。下列时间为北京时间，原始 JSON 保存 UTC。

| 阶段 | 实际命令 | 最终结果与时间 | 范围/证据 |
|---|---|---|---|
| T1 | `pnpm run check` | 00:54:28–00:55:10，退出 0，Turbo 35/35（25 缓存）；根 2287 passed/20 gated skipped，features 633 passed | `b34/check-fixed-final-summary.json` 与同名 log；含 contracts 3 项新增测试及 DB schema/journal 断言。check 默认跳过的 DB 集成由下两项单独实跑，不重复相加 |
| T2 API | `pnpm --filter @musefold/api run test:integration` | 00:54:28–00:57:22，退出 0；15 文件、234 passed，0 failed/skipped | `b34/api-fixed-final-summary.json/log`；其中来源 14 项，真实 PG/回环 GitHub/S3、独立 Node PID；既有恢复测试也包含自然 120 秒租约等待 |
| T2 worker | `pnpm --filter @musefold/worker run test:integration` | 00:54:28–00:55:34，退出 0；8 文件、84 passed，0 failed/skipped | `b34/worker-fixed-final-summary.json/log`；来源对象专项属于 3 项 cleanup 集成之一。存储删除使用计数替身 |
| T2 upgrade | 来源集成内实际执行 `pnpm run db:migrate` | 随最终 API 集成通过 | disposable PG17 从已应用 0000–0011 的旧行升至 0013，包含 owner FK/status 约束；无生产数据库操作 |
| 定向修复 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/source-preparation.integration.test.ts` | 00:53:51–00:53:59，14 passed | `b34/source-integration-fixed-summary.json/log`；随后增加重复维护为 0 的断言，已由最终 API 234 项覆盖 |
| 源码扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b34/security-source-fixed-final.json` | 00:54:28–00:54:30，退出 0；1246 文件，0 findings/errors | 规则 `v25-content-1`，不代表依赖漏洞审计、所有运行出口或新安装包已扫描 |

上述相对报告均位于 `tests/v25/.results/`，汇总为 `b34/validation-summary.json`；源码清单 `b34/source-files.json`。临时报告不保证跨机器存在，公开结论与具体命令/边界保存在本文。

**首次失败与复跑**：

1. `check-first` 因本批文件/生成迁移快照格式失败；只修相应文件。
2. `check-second` 因旧测试假设 0011 是 journal 最后一条失败。改为验证原 idx=11 位置及内容，允许追加 0012/0013；不改历史 SQL、不删约束断言。
3. 前一轮 `check-final`、API 234、worker 84 和扫描曾通过；随后增加最后方案引用删除反向用例，`released-reference-reproduce` 于 00:49:16–00:49:22 退出 1，**2 failed/12 因 -t 筛选 skipped**，两种引用形式均期望回收 1 实际 0。修复退役选择条件后，以本表 `*-fixed-final` 全量复跑作为最终证据；之前通过数字不冒充新代码验证。

**文档交付核对**：15 份文档/任务文件、701 个本地链接目标、代码围栏与 3000 行上限检查通过，`git diff --check` 通过，源码清单复核零漂移。迁移包检查仍退出 1（43/50 任务、1 条验收未勾选），准确表示整包未完成，不能换算成功能完成率。

**仍待验证**：上传途中实际 SIGKILL 与自然上传租约恢复、图片/多来源完整持久链、公开 HTTP Agent 会话/确认/事件/取消、模型调用与费用、全账号删除/所有资产 GC、真实旧库/跨版本安装包、最终三形态合流及 Windows/发布/生产。内部服务两个正常退出/新建 PID 的证据不能替代上传中强杀。仅关闭 B34，不关闭 C3/C5、R4/P4、P5/P6、G-CLOUD-02 或整包。

### 5.28 B35：Agent 持久会话、来源队列与准确确认（2026-09-09）

**本机切片通过**：canonical 202 session、真实鉴权/owner API、事件游标、精确逐源确认、取消先于 start、Graphile 原子入队与独立消费角色已实现。来源确认后仍明确 compiler blocker；无模型调用，不返回虚假草稿，原同步接口及共享产品尚未接编译。实现与逐项验收见[会话验证 §7](./V25-CLOUD-SOURCE-VALIDATION.md)，运行角色见[架构 §10](./V25-ARCHITECTURE.md)。

最终工作树 1355 个源码/配置/测试文件，SHA-256 `1766638f936a1b4431b70cadb705aa3df7b986451e6c876f2931e8265ac1c79d`，HEAD 仍 `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交增量，不能按 HEAD 重建本批。清单 `b35/source-files.json`；报告均相对 `tests/v25/.results/`。下表是北京时间。

| 阶段 | 实际命令 | 结果/时间 | 证据和适用边界 |
|---|---|---|---|
| T1 全仓 | `pnpm run check` | 01:32:42–01:33:07，退出 0；35/35（29 缓存），根 2291 passed/20 gated skipped，features 633 passed | `b35/check-third-final-summary.json/log`；类型、边界、lint、单测及双端 build。根新增 3 个合同及 1 个 API-client 测试，数字不与子包重复相加 |
| T2 API 全量 | `pnpm --filter @musefold/api run test:integration` | 01:33:40–01:36:02，退出 0；16 文件、248 passed，0 failed/skipped | `b35/api-third-final-summary.json/log`；含 B35 会话 14 项、B34 来源 14 项及既有 API/迁移/恢复全集 |
| T2 Worker 全量 | `pnpm --filter @musefold/worker run test:integration` | 01:24:29–01:25:50，退出 0；8 文件、84 passed，0 failed/skipped | `b35/worker-final-summary.json/log`；本批 DB/contracts/来源 queued 清理输入。它运行后仅新增 API 路由错误包装及其集成断言（见下方源码范围说明），Worker 消费输入未变 |
| T2 增量升级 | 集成中调用根 `pnpm run db:migrate` | 最终 API 内通过 | PG17 从 0013 升 0014 保留原准备记录；另有 B34 0011→latest 回归，使用隔离库、无生产迁移 |
| 定向队列/进程 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-agent.integration.test.ts` | `agent-integration-bin` 14 passed，退出 0；其后错误脱敏断言由最终 API 248 覆盖 | 两个真实 Node PID 运行生产 consumer 按来源阶段接续；另直接运行正式 Agent bin、处理纯文本并 SIGTERM 退出0。前两者是回环来源夹具，正式 bin 用例无 GitHub/模型调用 |
| 失败补验 | ZIP/SQLite 进程两个既有文件的定向 Vitest | 01:27:23–01:27:25，2 文件、15 passed，退出 0 | `b35/timeout-target-summary.json/log`；不改原断言/超时；随后完整 check 再通过 |
| API 错误出口 | 会话集成 `-t 'rolls back'` | 01:31:00–01:31:06，1 passed/13 因筛选 skipped | `b35/agent-safe-error-summary.json/log`；入队失败 HTTP 503，创建说明/数据库诊断不回显，事务仍完整回滚；最终 API 再覆盖 |
| 源码扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b35/security-source-second-final.json` | 01:32:43–01:32:48，1259 文件，0 findings/errors，退出 0 | 规则 v25-content-1；不是安装包、依赖漏洞、全运行出口或生产安全验收 |

**源码与重跑口径**：`source-before-error-wrapping.json` 的摘要为 `dfd6da79bc073bad026285b165a4346983d9f48085bbc2c0a3b0221f09cc4c6f`，该版本通过 Worker 84 项和第二轮 API 248 项。之后只改 `apps/api/src/modules/design-scheme-agent/routes.ts` 与会话集成文件，用脱敏 AppError 截断可能包含创建说明的 PG 异常；最终 check、API 全量和源码扫描均在上表最终摘要上完成。不要将不同批次的全仓身份混写；Worker 的实际依赖输入保持不变，未因无关 API 包装修正重复该门禁。没有 UI/桌面实现改动，本批未运行完整 E2E、安装包或 Compose 部署，B33 数字只保留历史。

**首次失败及处理**：

1. `agent-integration-first` 在准备阶段因测试 cwd 指向仓库父目录失败，8 个用例未执行；另有 fixture 导出名和未使用 canonical parser 导致类型错误。修复测试装配后继续。
2. `agent-integration-second` 6 passed/2 failed：清理查询错误地把 S3 writes 元数据对象当作键；CSRF 使用了未签名 Cookie 因而首先 401。分别改为实际对象键与正确签名会话，保留引用清理和 CSRF 403 断言，第三轮8项通过。随后增加并发、在途取消、真实进程和队列修复至14项。
3. `check-first` 遇构建并发删除 `electron.vite.config.<timestamp>.mjs` 导致依赖扫描 ENOENT，其余任务被中断。精准排除该临时生成路径，继续扫描真实 `electron.vite.config.ts`，零依赖违规清单未增加豁免。
4. 第一轮完整 check/API/worker 并行运行时，旧 ZIP 读取、SQLite writer 进程和 PG replay 超过默认 5 秒；分别保留 `check-final`（2 failed）、`api-final`（1 failed）和成功 Worker 记录。独立15项与后续完整 check、API 分开重跑通过；观察到并行负载相关性，不把它写成已证实根因或已修复测试缺陷，未修改这些测试断言/超时。
5. API 第二轮248通过后补错误脱敏，定向回滚用例及最终全量248再通过；首次成功不替代最终修正验证。

**未闭合范围**：模型配置/收费授权/发送身份、Analyst/Compiler/Reviser、真实完成草稿、modify/update、共享 UI/事件适配、图片/历史/专用包；上传中实际 SIGKILL/自然租约、全来源/账号删除/事件和元数据 retention、规模性能、Windows/真实旧数据/安装包/生产部署与回滚。仅关闭 B35 的会话来源切片；原 C3/C5/R4/P4/P5/P6 与整包、管理员依赖保持。

### 5.29 B36：共享角色契约/提示词与真实桌面模型回归（2026-09-09）

**结论**：G-CLOUD-02 编译阶段的共享基础已接回桌面，云端文本执行仍未开放。新增 contracts 单一模型 schema、domain 三角色 prompt 与 JSON framing，旧 desktop-contracts 只 re-export；三个桌面角色及 text-adapter 实际消费共享代码。运行身份/付款/自动重试/SQLite IO 没有搬进 domain。详细边界及下一步见[来源验证 §8](./V25-CLOUD-SOURCE-VALIDATION.md)。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加 dirty 工作树，最终 1365 项、摘要 `182f9ad4b2991bf4fe19eaa13517b7d3e2c209210277c8de86b2c889b99bff2a`。相对 B35 新增 10、修改 6、删除 0；最终清单与报告为 `tests/v25/.results/b36/source-files.json`、`validation-summary.json`。本机 macOS arm64、Node v25.8.1、pnpm 11.24.0。未改版本、迁移、依赖边界豁免或生产配置。

| 验证 | 实际命令/报告 | 最终结果与范围 |
|---|---|---|
| 共享与桌面编排专项 | `roles-complete.log` 的 7 文件 Vitest 命令 | 35 passed、0 failed/skipped；含 18 项新测试及既有创建/修改/text-adapter；真实 SQLite 编排，模型/来源用例按 fixture 替代 |
| 旧/新提示词对比 | `.results/v25/2026-09-09-development/b36/verify-prompt-parity.cjs` → `prompt-parity.json` | 保存的旧三角色与新 wrapper/domain，在10组输入的 system/user 内容逐字一致；transport 为捕获替身，不是模型行为评估 |
| 全仓检查 | `pnpm run check` → `check-final.log` | 退出0，35/35、30 cached；根2309 passed/20 gated skipped，features633 passed；构建与依赖边界通过，不累加包间重复统计 |
| 真实桌面模型接线专项 | `pnpm exec playwright test -c tests/v25 --project=electron electron.scheme-agent-model.spec.ts` | 1 passed；真实 Electron/main/IPC→回环 chat/completions→SQLite 草稿/新修订；新 PID 重读当前和数据库旧版事实，2次文本POST，重启0新增POST |
| Electron 含隔离数据库 | `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project electron` → `electron-database-report.json` | 147 passed/2 skipped、0 failed/flaky；含新增模型用例；逐条 skip 原因见报告，不外推 Windows 或真实上游 |
| 源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b36/security-source-final.json` | 1269 文件、0 findings/errors，退出0；不代替安装包/依赖漏洞/生产扫描 |

**两项跳过**：`活体登录 → 提示词 CRUD` 缺少 `MUSEFOLD_LIVE_E2E=1` 与测试密码；`Electron AI 连接使用真实 TvT 生图 key 且只展示尾号` 缺少 `MUSEFOLD_E2E_IMAGE_API_KEY`。分别归真实账号与中转站连接验证；已有隔离服务通过不能替代。逐项记录为 `tests/v25/.results/b36/electron-skips.json`。

**执行层级**：新增模型测试通过 v25 `musefold:invoke` 调用实际主进程创建和修改，Provider 是本地 HTTP 合成 JSON 响应，凭据为测试字符串。检查 Runtime 不采用模型传入的 scheme/revision/input/module/source 标识，旧修订不被覆盖；模型专项每次运行发出2次文本POST，新 PID 只读不再次调用模型。它没有通过共享 UI 创建弹窗操作，也没有证明生产模型质量、云端付款或云端 Agent 完成。原 Electron UI/运行/恢复矩阵由全项目回归另行覆盖。

**首次失败与补验顺序**：

1. `roles-target` 29 passed/1 failed：测试统计整个 user 消息的字母 x，误计仓库标签中的 x；改用正文独有的甲/乙字符，保留每文件20,000/总计120,000限制。修正后30项通过，增加修订/JSON测试后最终35项通过。
2. `check-first` 因临时提示词对比脚本格式不合规退出1，其余任务中断；只格式化该脚本，第二次全仓检查通过。后补真实 Electron 测试文件，最终再跑 check 通过。
3. 先运行默认 Electron，100 passed/48 gated skipped；当时未含后补的模型专项。随后开启 `RUN_DATABASE_TESTS=true` 并包含新文件重跑全项目，以上表最终结果为准，不把默认 skip 算通过。
4. 模型专项首次命令把文件名放在变长 `--project electron` 后，被当成另一个 project，退出1且未执行测试；改用 `--project=electron` 后通过，最终 Electron 全项目再次包含该用例。没有修改产品断言或放宽超时。

**未验/未完成**：B36 没有改数据库 schema、API/worker 实现或 features UI；没有单独重跑 API/worker integration 命令、完整 Web 双视口、安装包或生产部署。B35 API248/worker84、B33全三形态313/7仅保留其历史身份。云端独立文本身份与原操作授权、逐调用持久发送/unknown、真实云草稿、修改/更新、素材/包/共享界面，以及原费用/兼容/GC/迁移/发布条件继续开放。仅关闭 B36，整包和管理员前置未完成。

### 5.30 B37：云端文本调用与事务草稿（2026-09-09）

**结论**：G-CLOUD-02 新异步 create 的文字/已确认 GitHub 来源后端通过本机验收。独立文本授权与共享身份锁、持久单次调用/结果/unknown、语义校验、PG 草稿/事件已接入；原同步 Agent、修改/更新、素材/包/共享 UI 和整包仍开放。协议与边界见[来源验证 §9](./V25-CLOUD-SOURCE-VALIDATION.md)。

**源码与环境**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加 dirty 工作树，最终 1381 项、摘要 `e7a7bd43bf0265c8e9119255052ad599e1f03434dc719389b84dab6bebd5e5e3`；相对 B36 新增16、修改16、删除0。macOS arm64 / Node v25.8.1 / pnpm 11.24.0 / disposable PG17。最终清单、增量和统一报告在 `tests/v25/.results/b37/`，`source-files.json`、`source-delta-from-b36.json`、`validation-summary.json`；每条命令有 log 与含 UTC 起止时间/退出码的 summary。未提交、未改版本、未部署。

| 阶段 | 实际命令 / 报告 | 结果及可证明范围 |
|---|---|---|
| T1 合同/纯语义/旧图像身份回归 | `units-second.log` 的三文件 Vitest 命令 | 34 passed：文本合同3、云语义10、既有 DB 图像身份21；不累加到全仓重复计数 |
| T1 文本 transport / client | 全仓 API / api-client 单测；`transport-second.log` 为早期6项 | 最终 transport7项（含后补响应体 deadline），client2项含新增 offer；真实回环HTTP断连/redirect/503/512KiB；120秒 deadline 用 fake timers/abort stream |
| T2 新文本完整集成 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-text.integration.test.ts` → `text-complete.log` | 20 passed、0 failed/skipped；实际鉴权/PG/HTTP/S3、强杀/新PID、正式 Graphile bin；含真实详情和图像 prepare 持久/重放且 generation_runs=0 |
| T2 API 全集 | `pnpm --filter @musefold/api run test:integration` → `api-integration.log` | 17文件268 passed、0 failed/skipped；含 B34/B35、授权/恢复/同步/运行等既有回归；自然等待案例按其原时钟执行 |
| T2 Worker 全集 | `pnpm --filter @musefold/worker run test:integration` → `worker-integration.log` | 8文件84 passed、0 failed/skipped；抽公共身份后图像 worker 仍通过 |
| 数据迁移 | 新文本 fixture 先应用至0014、种旧会话，实际执行根 `pnpm run db:migrate` 至0015 | 保留旧 cancelled/source 行、无自动文本授权；同时全 API 继续回放既有迁移。只在隔离库执行，不是生产升级 |
| 全仓门禁 | `pnpm run check` → `check-complete.log` | 35/35通过；根2323 passed/20 gated skipped、features633 passed；API默认 gate 的 DB skip 已由独立 integration补验；不把重复/skip加为新通过 |
| 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b37/security-source-complete.json` | 1285文件、0 findings/errors；不是依赖漏洞或最终安装包扫描 |

**最终版本对齐**：完整 API/worker 在最初冻结源码上启动。之后只有两份迁移 JSON 元数据格式化（`migration-format-proof.json` 证明解析值完全相同、SQL 未改）和新文本测试加强：把纯规则 trial 准备改为正式 `DesignSchemeRunService.prepare` 并补齐禁止存储 IO 的测试 signer。生产 TypeScript/SQL 未在完整 API/worker 启动后变化；最终20项文本、check和扫描覆盖最终清单。不将较早日志冒称为最后一次修改后的完整全集复跑。

**20项实际行为**：纯想法一次 Compiler；两来源逐项确认完才2次 Analyst+1次 Compiler；同意图重放和旧会话0新增调用；先取消后启动0新模型GET/POST；伪造 payer/model、缺权限、跨owner、调用上限、模型不在列表均拒绝；发送前凭据/会话/授权revision/配置模型变化0POST；并发消费者1POST；取消/撤权后的迟到输出保留费用事实但0草稿；drop/503/redirect持久unknown且0重发；非法模板/fidelity/证据0草稿且0修复重试；坏S3字节/到期0POST；落库触发器失败回滚草稿，另一真实PID用已完成结果落库且POST总数1；真实SIGKILL后新PID保留sent，显式期限注入后即使父已取消也转unknown；正式bin消费并SIGTERM退出0。

**首败与修复，均保留日志**：

1. `typecheck-first`：变量 optional 收窄未被 arrow never helper 识别，改函数声明；`units-first` 的 source kind 夹具和 `transport-first` 的必需 env 夹具错误，修输入后34/6通过，后补 deadline进入最终7项。
2. `text-integration-first`：16 passed/4 failed。真实草稿持久化漏填必需 `sourceUris/sourceAssetIds`，补回冻结来源和空资产数组；第二次20通过。没有把失败任务改成成功空草稿。
3. `typecheck-third`：测试详情参数误用schemeId而非id、未解析unknown事件JSON；修正调用和canonical parse。
4. `check-first`：Drizzle新snapshot/journal格式不符，只改格式并保存JSON等价证明；Turbo取消其他任务产生的EPIPE不作为独立产品失败。随后check35/35通过。
5. 增强正式图像prepare测试后 `check-final` 因测试 signer 缺必需接口方法失败；补齐“不应被调用”的 read/put/remove throw方法，最终 `check-complete` 与 `text-complete`通过。没有弱化生产门禁。

**真实/替身限制**：真实 Better Auth 与 Hono请求管线、PG17、Graphile、Node PID、回环模型/GitHub/S3 HTTP；模型JSON和凭据为合成fixture，API没有独立TCP listener/浏览器产品。强杀是真的，150秒claim过期用SQL时钟边界注入；不称为自然期限或生产容器恢复。文本token usage不是账单；没有付费模型或实际生图。未复跑完整Web/Electron E2E、安装包、生产/回滚；B36 Electron147/2和B33完整三形态313/7保留历史身份。

**未完成**：云端modify/checkUpdate、全部图片/历史与专用包、共享异步UI；全中断点/自然期限、来源图片采纳、prompt/事件retention、账号删除、性能/索引、实际配置模型能力与部署回退；原费用C3/C5/P5/P6、worker/GC/旧库/同步/平台发布仍按原条件。只关闭 B37 切片，父卡及管理员前置不关闭。接续[路线图 §6.25](./V25-MIGRATION-ROADMAP.md)。

### 5.31 B38：云端异步修改、基线竞争与正式版保护（2026-09-09）

**结论**：G-CLOUD-02.4 的新异步modify后端本机验收通过。必填expectedVersion/text授权、服务端基线、单次Reviser、原来源/资产保留及原子修订/完成事件已接；正式版current保持，新修订进入working draft。协议见[云端修改 §10](./V25-CLOUD-SOURCE-VALIDATION.md)，后续U1–U4上游更新见[路线图 §6.26](./V25-MIGRATION-ROADMAP.md)。原同步501、共享UI/包和整包仍开放。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加dirty工作树，1387项，摘要 `488605abce3916acbf4898f13030a50e310df8a5d9286a12f6f3055d63c613a9`。相对B37新增6、修改12、删除0；精确增量以 `tests/v25/.results/b38/source-delta-from-b37.json` 为准。本机macOS arm64、Node25.8.1、pnpm11.24.0，isolated PG17。完整API/worker、最终check和扫描均在同一冻结清单执行，之后只补文档/报告，未改版本、提交或部署。统一报告为该目录 `validation-summary.json`。

| 阶段 | 实际命令/日志（B38报告目录） | 最终结果与证据边界 |
|---|---|---|
| T1 合同/纯修订 | `units-second.log`；最终check又覆盖相同源码 | 2文件10 passed，新增modify合同1与domain6；合同文件共4项；client最终3项含新增modify授权/取消透传1项 |
| T2 modify专项 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-modify.integration.test.ts` → `modify-third.log` | 22 passed，0 failed/skipped；完整API随后在最终源码再次包含全部22项 |
| T2 API全集 | `pnpm --filter @musefold/api run test:integration` → `api-integration.log` | 18文件290 passed，0 failed/skipped；含原create20项、来源/同步/账号/费用/运行及update抽事务入口回归 |
| T2 worker全集 | `pnpm --filter @musefold/worker run test:integration` → `worker-integration.log` | 8文件84 passed，0 failed/skipped；原图像worker/回收等回归，不等同新Agent产品验收 |
| 数据迁移 | modify fixture先应用至0015并种旧text/call，再运行根 `pnpm run db:migrate` 至0016 | 保留旧来源/取消会话、原compiler unknown和null revision_base；新reviser持久有效，只有隔离PG升级证据 |
| 全仓门禁 | `pnpm run check` → `check-complete.log` | 35/35通过，根2331 passed/20 gated skipped、features633 passed；lint/typecheck/单测/双宿主构建/边界；不把重复包测试或skip累计为新通过 |
| 首次超时复验 | `pnpm exec vitest run packages/core/src/db/repositories/__tests__/automation-spend-process.test.ts` → `spend-process-repeat.log` | 4 passed，未修改生产代码、断言或超时；随后最终check整体通过 |
| 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b38/security-source-final.json` | 1291文件、0 findings/errors；不代替依赖漏洞、安装包或生产扫描 |

**22项专项证明的行为**：

- 当前草稿一次Reviser后为新child，旧revision内容保持；详情读到新稿，completed/event与结果一致；同execution重放0新增GET/POST、换意图409、跨owner读404。
- 正式版保留current，修改生成working draft并可从精确working draft继续。正式状态、成功trial与cover由SQL合成样本提供，未执行真实出图/选封面/正式化链；此项只证明版本保护。
- 已绑定GitHub快照跨准备TTL后仍继承，不重抓HTTP或增加Analyst；原snapshot和bindings保持。真实PNG通过stage/create后修改仍保留，实际S3 content bytes一致；正式 `DesignSchemeRunService.prepare` 可持久试运行计划，generation_runs保持0。不是实际生图。
- 伪造revision、旧version、跨owner、客户端篡改baseDocument在发现/付费前拒绝；发送前改名/删除/凭据或授权版本失效均0POST；两不同意图在held HTTP上可各1POST，释放后只一项CAS成功，另一项BASE_REVISION_CHANGED，旧稿不被覆盖。
- 发送中取消/删除/改名/撤权获胜后，迟到输出仅记录调用事实，不恢复父任务或覆盖基线；drop/503/非法变量或verified输出为unknown/invalid，reconcile/重投不重发；modify先取消后启动保持墓碑。
- DB触发器使修订写入失败，父任务仍compiling、旧版不变、合法调用结果保留；另一真实PID可完成落库，累计1POST。
- 真实SIGKILL发生在模型HTTP已收到POST后，另一PID仍见sent且不重发；取消后用显式SQL期限注入触发维护，调用转unknown而父仍cancelled。生产 `agent-worker-bin.ts` 实际消费modify、保存child，SIGTERM排空并exit0。

**首败及修复**：`units-first` 为9 passed/1 failed，imageRole夹具用了不合法subject，改成canonical subject-reference后10通过；`modify-first` 在beforeAll旧行种入处因SQL未引用保留字authorization失败，20项未执行，修正SQL引号；`modify-second` 为19 passed/1 failed，正式样本缺必要trial/cover，补完整合成状态，未放宽正式版schema。增加实际SIGKILL/bin后 `modify-third` 22通过。`check-final` 首轮根2330 passed/1 failed/20 skipped，既有SQLite多进程5秒超时；当时check/API/worker并行运行，资源竞争是可能因素而非已证明原因。待集成结束，原4项专项及完整check通过；不隐藏首败、不增加测试重试或超时。

**真实/替身与未验**：真实Better Auth/Hono app.request、PG17、Graphile、Node PID与回环模型/GitHub/S3 HTTP；凭据/JSON/正式状态为明确fixture，Hono没有独立TCP listener或浏览器操作。每例先用真实create构建base，再清零模型观察数组，所称0/1POST是修改阶段计数，不代表base生成免费。强杀是真的，150秒claim边界为SQL时钟注入，不是自然期限；没有真实付费模型、生产账单、图像生成或生产容器恢复。

本批没有features/桌面主进程或SQLite改动，未复跑完整Web/Electron E2E、安装包、生产/回滚。根20项gated skip仍分别为DB generation-execution5和桌面managed-cloud-service15；不计为通过，本批API/worker全集不能替代这20个具体入口，历史验证仅保持其原源码身份。B36 Electron147/2、B33完整三形态313/7同样是历史结果。上游更新、全部图片/历史与包、共享异步UI、自然期限/全断点/retention/账号删除、旧新消费者回滚与原C3/C5/P5/P6/GC/旧库/同步/平台发布继续开放；只关闭B38，管理员未启动。

### 5.32 B39：云端上游更新与独立编译授权（2026-09-09）

**结论**：新异步check-update后端完成免费检查、逐变化源确认、单独文本授权和事务新修订；G-CLOUD-02.5后端本机验收通过，原同步501/共享产品和整包仍开放。发现并修复“新文档已换来源但PG仍复制旧绑定，导致实际试运行拒绝”的缺陷；旧版本自身绑定保留。协议见[上游更新 §11](./V25-CLOUD-SOURCE-VALIDATION.md)，下一目标为[路线图 §6.27](./V25-MIGRATION-ROADMAP.md)的素材/历史、包与产品合流。

**源码与环境**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加dirty工作树，1394项，摘要 `b0d47bf519901bdb0df79525c90a97902de09626691a86d84bcf0702dec81b82`；相对B38新增7、修改11、删除0。macOS arm64、Node25.8.1、pnpm11.24.0、disposable PG17。本批未改桌面版本、提交或部署。最终完整API/worker、check和扫描使用同一冻结清单；报告/增量/逐命令UTC时间与退出码均在 `tests/v25/.results/b39/`，统一报告 `validation-summary.json`。

| 阶段 | 实际命令/报告 | 最终结果与可证明范围 |
|---|---|---|
| T1 合同/纯更新 | `pnpm exec vitest run packages/contracts/src/__tests__/design-scheme-update.test.ts packages/domain/src/design-scheme/__tests__/cloud-update.test.ts` → `units-third.log` | 2文件9 passed（合同3、纯更新6）；精确替换来源/保留未变来源、输入/证据/身份校验；最终check又覆盖 |
| T1 API client | 全仓api-client单测，新增免费检查/显式authorize-update/取消透传测试 | 该Agent client文件4项，新增1；start不会自动提交授权，保留原会话版本/费用范围 |
| T2 上游更新专项 | `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-update.integration.test.ts` → `update-fifth.log` | 22 passed、0 failed/skipped；完整API随后在最终源码再次包含这22项 |
| T2 API全集 | `pnpm --filter @musefold/api run test:integration` → `api-integration.log` | 19文件312 passed、0 failed/skipped；包括原create20/modify22、确定性update、来源/运行/账号/费用/同步等回归 |
| T2 worker全集 | `pnpm --filter @musefold/worker run test:integration` → `worker-integration.log` | 8文件84 passed、0 failed/skipped；原图像worker/清理等回归 |
| 数据迁移 | 更新fixture先应用至0016、种旧来源/会话/text/unknown，再执行根 `pnpm run db:migrate` 至0017 | 旧update_context/revision_base保持null，compiler unknown不变；仅隔离PG升级证据 |
| 全仓检查 | `pnpm run check` → `check-first.log` | 首次完整门禁退出0，35/35、0 cached；根2341 passed/20 gated skipped，features633 passed；lint/typecheck/单测/双宿主构建/边界通过 |
| 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b39/security-source-final.json` | 1298文件，0 findings/errors；不等于依赖漏洞、安装包或生产扫描 |

**22项实际行为及层级**：

- 无来源和全部未变化为真实持久终态，无模型GET/POST、无修订；重放不再读取GitHub。原requestedRef main实际进入commit请求，未变化暂存被cancelled，旧绑定保留。
- 显示C版本后分支移动到D，确认与编译仍采用C且0额外GitHub读取；completed/event与真实详情一致。原revision及PG绑定仍是A，新revision及PG绑定只含C。
- 两个独立来源快照各自确认，旧确认不推进下一项；最后才进入authorization-required。只一源变化时保留另一源旧快照，授权2调用；两源变化授权3调用。此多来源夹具是同一仓库的两个独立快照，不外推不同仓库组合语义或生产模型质量。
- 同授权重放不再发现模型；并发相同授权只保存一份text执行、每角色一次POST。授权会话版本变化、错误调用上限、跨owner/伪造身份和未完成确认均拒绝；旧基线检查前拒绝，拒绝确认或先取消后启动保持终态。
- 派发前改名/删除/撤权0POST；Analyst发送中取消/改名/撤权不再发Compiler、不落新稿。drop/503为unknown，非法证据为invalid，维护或重投不自动补发。
- 触发器强制修订保存失败后，合法Analyst/Compiler输出已持久、原稿不变；实际新PID复用结果完成更新，总计2POST。
- 实际SIGKILL在Analyst POST已被接收后发生，新PID保留sent且不发Compiler；取消后显式SQL期限注入使调用unknown，父仍cancelled。正式Graphile bin实际消费已确认/已授权更新，2调用完成新child，SIGTERM排空exit0。
- 真实PNG stage/create后，更新保留图片/S3 bytes；正式current与其旧来源保持，working draft拥有新来源。实际RunService.prepare接受该新稿并生成正确图像binding/4步计划，generation_runs=0。成功trial/formal状态是明确SQL夹具，未把它当成真实出图/正式化证据。

**首次失败及修复（日志不覆盖）**：

1. `typecheck-first`：异步回调中nullable revision_base的类型收窄失效；使用已验证的冻结context.base，第二次通过。
2. `update-first`：新合同对带refinement的schema调用pick，模块加载失败，0测试执行；改为复用canonical字段schema显式定义检查输入，保留原验证。
3. `units-first`：3 passed/6 failed，快照夹具漏evidencePath/textExcerpt；补字段后最终9通过。`update-second`：13 passed/1 failed，测试调用不存在的delete而非既有remove；修正调用。
4. 辅助测试扩充脚本未识别Biome格式化后的describe结尾，修复未落盘；`units-second`/`update-third`因此重复相同夹具失败。修辅助脚本后补齐真实PID/bin与素材用例；没有把未执行的修复写成已生效。
5. `update-fourth`：21 passed/1 failed，为真实新修订引用缺陷。删除“无条件复制旧绑定”逻辑，新版本仅根据自身文档建引用，旧版本不变；新增直接PG绑定断言，实际试运行准备随后通过。`update-fifth`22通过，最终API312/worker84/check全部通过。未删除失败断言、放宽来源校验或增加超时。

**真实/替身与未验**：真实PG17、Better Auth/Hono app.request、Graphile、Node PID及回环模型/GitHub/S3 HTTP；账号与模型JSON合成，未启动独立API TCP listener/共享页面，未调用真实收费模型或生图。每例先用实际cloud create建立基线，随后清零模型观察数组；0/2/3POST指更新阶段，不表示基线创建免费。强杀为真，150秒claim过期用SQL注入，非自然期限；旧账号备份恢复的自然等待用例虽在API全集中执行，也不替代更新claim的自然期限证据。

无features/桌面主进程/SQLite改动，未复跑完整Web/Electron E2E、安装包、生产及回滚。根20项gated skip（DB generation-execution5、桌面managed-cloud-service15）不计通过，完整API/worker不能替代这20个具体入口；B36 Electron147/2、B33三形态313/7均保持历史身份。素材/历史输入、来源图片采纳、专用包/共享UI、全上传/发布断点、自然期限/retention/账号删除/历史引用一致性/旧新消费者回滚和原C3/C5/P5/P6、worker/GC/旧库/同步/平台发布继续开放。仅关闭B39后端切片，整包及管理员前置未完成。

### 5.33 B40 上传素材独立副本、原子草稿资产与恢复（2026-09-09）

**结论与边界**：已完成D1–D2中的上传图片后端切片，解除新异步create对本人已上传图片的blocker；固定独立副本、顺序及真实元数据，模型前校验、草稿资产原子晋升，实际详情和含必需图片输入的RunService.prepare通过。没有做图像视觉解析，也没有自动增加必需图片槽。历史作品/提示词、仓库图片自动采用、专用包、共享页面和原同步501继续开放；G-CLOUD父卡、原C3/C5/P5/P6、worker/GC/旧库/平台生产和管理员前置没有关闭。

**源码与环境**：HEAD仍为`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加dirty工作树；未提交/推送/改桌面版本/部署。macOS arm64、Node25.8.1，真实PG17容器。最终1401文件摘要`2fbde61db44bb1d6a4e3cfa318bf84079a4b024e7bd5b722156944174bb4eabd`；相对B39新增7、修改12、删除0。[阶段报告](../../tests/v25/.results/b40/validation-summary.json)、[最终源码](../../tests/v25/.results/b40/source-files.json)、[变更集合](../../tests/v25/.results/b40/source-delta-from-b39.json)。

| 门禁 / 流程 | 实际结果 | 证据与适用范围 |
|---|---|---|
| T1 contracts/domain | 2文件5 passed，0 failed/skipped；DB新增nullable合同由全仓40项DB测试覆盖 | `units-first.log`；唯一选择/副本、字节总限、拒绝客户端上下文/键、顺序/槽位/能力声明 |
| T2 上传专项（最终含于API全集） | 18 passed，0 failed/skipped | `design-scheme-materials.integration.test.ts`；最终结果见`api-full.log`，先前15项单跑通过不替代后增3项 |
| T2 API全套 | 20文件330 passed，0 failed/skipped，exit0 | `api-full.log`，145.96s；真实Hono app.request、Better Auth/PG/Graphile、AWS SDK→回环S3、模型HTTP/新PID |
| T2 worker全套 | 8文件85 passed，0 failed/skipped，exit0 | `worker-full.log`，28.79s；本批新增1项真实PG的未晋升副本/孤儿TTL→outbox清理，S3删除是注入回调 |
| PG升级 | 0017链旧source/session→根`pnpm run db:migrate`→0018通过，旧记录保留且materials=null | 嵌在上传专项beforeAll；只加nullable JSON列，0000–0017 SQL未变；不是生产回放 |
| 统一门禁最终 | `pnpm run check` 35/35 successful，2 cached，exit0；根2347 passed/20 gated skipped，features633 passed | `check-second.log`，44.98s；两项缓存来自同输入的先前通过项，根/构建等重新执行；见下方默认skip边界 |
| 源码扫描最终 | 1305文件，0 findings/errors，exit0 | `scan-after-format.log`、`security-source-final.json`；源码扫描不代替各平台发布包扫描 |
| T3/T4/T5 | 本批未复跑 | 无共享屏幕/桌面源码变更；未跑产品E2E/安装包/生产，B36 Electron147P2S、B33三形态313P7S为历史结果 |

**精确源码差异说明**：API与worker全集运行于1401文件摘要`4ac478d11210f85602753eb85ed05211c076514f876c7911a5e5e1a2859df9e8`，[该快照](../../tests/v25/.results/b40/source-before-worker-format.json)保留。之后仅对`apps/worker/src/__tests__/object-cleanup.integration.test.ts`的Drizzle链式调用换行执行Biome格式修复；所有产品/迁移/API测试代码未变。最终check与源码扫描用上表最终摘要。没有将格式前集成报告伪称为最终字节快照；该纯格式变化未重复运行完整PG全集。

**18项专项覆盖**：两张不同真实PNG按选择顺序复制/原件删除后仍可编译，准确资产和内容读取/纯文本prepare；外用户图片0模型GET/POST；重复选择与错误hash/origin/role/多余元数据拒绝、合法元数据成功；同ID重放不重新复制或读取原件；副本bytes/过期/丢失三类在收费前拦截；付费请求期间副本消失→保留已完成调用但无草稿无重发；先取消后启动0复制，以及POST中取消无发布；上游断连接unknown不重发；PUT写后失败的可发现outbox；GitHub已确认文字+上传图片双输入；资产插入事务回滚后真实新PID沿原副本落库总1POST；并发相同请求只一份上下文/草稿，未入选副本仍在注册表；历史输入继续明确blocked；真实SIGKILL后新PID不重发、取消/SQL租约到期巡检；实际必需图片槽使用已保存副本准备试运行；父任务到期不调用模型也不延长副本期限。

**已保留的失败与修正**：

1. `typecheck-first`失败：新增测试误用详情方法/构造参数和可选document，复制字节的Uint8Array泛型不符。按真实get/RunService/GenerationService合同修正测试；产品使用`Uint8Array.from`构造独立有界字节。`typecheck-second`通过。
2. `materials-first`为11P/1F：一个测试连续获取报价触发真实限流。改为一次明确报价后多组独立execution做非法输入验证；不放松服务限流。`materials-second`15P通过。
3. 新增真实图片试运行后`materials-third`17P/1F：夹具用了不存在的`imageRole=subject`，模型输出被正确判为非法；修正为canonical `subject-reference`，最终API中的18项通过。
4. `check-first`2/20任务成功后因新worker测试文件的格式差异退出1，Turbo终止同批子进程并出现EPIPE；不能计为测试全失败，也不能计已执行一半为通过。仅修复链式调用格式，最终`check-second`35/35。原有warning/info保留，不冒充零告警。

**默认跳过与证据层级**：最终root的20项为DB generation-execution5和desktop managed-cloud-service15环境门控，未在本批另行解锁，不能计入通过。check中API默认292P/329S、worker77P/85S、DB40P/5S；上表独立API/worker全集解除对应后端门控，不自动证明desktop那15项。模型内容、账号凭据为合成夹具；没有真实模型质量/费用、独立API TCP监听器或浏览器。使用小尺寸真实PNG与完整sharp解码，128MiB/64张边界主要是合同/实现约束，未作最大负载压测。SIGKILL和新PID真实，150s租约与24h/25h清理时间由SQL/传入时钟注入；API旧账号恢复自然120s测试通过不能外推为上传任务自然到期证据。worker删除回调验证PG/outbox及调用，不等同真实S3 DELETE。未声称修改/更新中新增图片、全部资产retention/账号删除或生产回滚已验收。

后续H1–H3/R1/D3/D4与原E条件见[路线图 §6.28](./V25-MIGRATION-ROADMAP.md)。管理员按全部迁移完成后再接续，不能代批费用或清除unknown后重发。


### 5.34 B41 本人历史与选定提示词、混合来源和修订继承（2026-09-09）

**结论**：H1–H3历史素材后端已实现并通过下列专项/完整服务测试：可信历史身份与字节、独立图片副本、完整有界选定正向提示词、GitHub与历史同时参与编译、创建/修改/更新/详情及实际图片prepare。文本模型没有接收图片像素。仓库图片采用、专用包和共享异步UI未完成，原同步501与G-CLOUD父卡、费用C3/C5/P5/P6、全worker/GC/旧库/同步/发布及管理员前置保持开放。

**源码**：HEAD为`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加dirty工作树；最终1405文件摘要`b787f9870812ad4a86d9019be5d30877788c926038a861628fb4a6e46385ab66`。未提交/推送/修改桌面版本或部署。环境macOS arm64、Node25.8.1、真实PG17隔离容器。[统一报告](../../tests/v25/.results/b41/validation-summary.json)、[最终源码](../../tests/v25/.results/b41/source-files.json)、[相对B40变更](../../tests/v25/.results/b41/source-delta-from-b40.json)。

| 阶段 / 原样命令（工作目录为仓库根） | 实际结果 | 证据与边界 |
|---|---|---|
| T1 `pnpm exec vitest run packages/contracts/src/__tests__/design-scheme-history.test.ts packages/domain/src/design-scheme/__tests__/cloud-history.test.ts` | 2文件5 passed，0 failed/skipped；最终更强合同/既有混合输入断言由check覆盖 | `units-first.log`；完整自由文本、显式纳入/上限、来源/快照形状与17/33快照边界、混合prompt和引用 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-history.integration.test.ts` | 最终专项25 passed，0 failed/skipped | `history-fifth.log`，最终25项同时包含于API全集；真实PG/S3字节/模型HTTP/新PID |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api test:integration` | 21文件355 passed，0 failed/skipped，exit0，145.37s | `api-full.log`；包含既有费用、SIGKILL、来源、创建/修改/更新及B40素材回归 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker test:integration` | 8文件85 passed，0 failed/skipped，exit0，26.69s | `worker-full.log`；既有PG/outbox/注册表清理回归，没有新增历史专属自然TTL或真实S3 DELETE测试 |
| PG/SQLite | 无本批新DDL | 使用既有0018 materials及来源JSON；集成继续执行隔离旧链→根db:migrate，不外推生产升级 |
| `pnpm run check` 最终 | 35/35 successful，0 cached，exit0；根2352 passed/20 gated skipped，features633 passed，37.42s | `check-second.log`；Biome/typecheck/unit/双端build/依赖边界通过。首次失败见下文 |
| T3 默认Electron全集，再启用数据库补跑7文件 | 默认101 passed/48 skipped；补跑46 passed/0 failed/skipped；按测试ID去重共147 passed/2外部环境skipped，0 failed/flaky | `electron-full.log`、`electron-database-second.log`与[去重清单](../../tests/v25/.results/b41/electron-coverage.json)；两轮执行，不能称单轮147P。真实桌面回归不代表新云端异步页面已接通 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b41/security-source-final.json` | 1309文件，0 findings/errors，exit0 | `scan-final.log`及扫描JSON；最终断言修正后重跑，源码扫描不等于平台包扫描 |
| Web全产品 / T4 / T5 | 本批未运行 | Electron前置启动production Web build不构成PC/Mobile Web产品E2E；无安装包/真实付费/生产部署回滚 |

**API/worker的精确源码身份**：这两套全集运行时摘要为`6a54d5ef6d0ad86187e0ba1235da96ff5029650d3be7acddeab4ad01f87e9aa4`，[当时快照](../../tests/v25/.results/b41/source-before-precedence-test.json)已保存。此后仅修改`packages/domain/src/design-scheme/__tests__/agent-prompts.test.ts`中旧的“忽略历史”断言，改为要求两类输入都保留；产品代码、contracts、迁移以及API/worker测试字节全部一致。最终check/Electron/扫描针对最终摘要，未将早先报告伪称为最终逐字节快照，也未因根单测断言单独重复耗时PG全集。

**25项历史专项**：完整提示词与真实图片副本/原历史删除后get和content；includePrompt=false不保存或发送私有文本；跨owner、错run、已删、运行中、错误hash/路径/尺寸、缺快照、正文与请求不符、单条超限十组拒绝；复制时删除在入队前拒绝且副本已登记；GitHub+上传+历史混合与真实evidencePath；原件消失后重复execution不重新发现模型或复制；资产插入触发器回滚历史快照/草稿/资产，真实不同PID沿已完成结果接续仅1次POST；取消/unknown/付费中副本丢失三类无发布和无重发；确定性入口拒绝伪造historyItems；modify/update保留多角色历史及图片、原正式current和真实新草稿prepare；必需图片槽使用已保存历史副本；超过8份提示词和混合超过64图在付费前拒绝；持久正文遭篡改时在模型前拦截。

**失败和修正（原日志保留）**：

1. `history-first`19P/1F：伪造历史上下文的拒绝路径先对undefined算摘要，返回TypeError。产品增加缺失trusted history的显式拒绝，后续返回预期VALIDATION_FAILED。
2. `typecheck-second/third`：新增测试可选snapshot/document未收窄，直接调用typed create缺少schema默认字段。改用canonical parse及显式sourcePackages/sourceAssets/historySources数组，最终全仓typecheck通过。
3. `history-third`21P/3F：新增正式样本留下被FK引用的run，后续beforeEach先删scheme失败。修正夹具依赖删除顺序，保留产品FK；fourth24P、加入正文防篡改后fifth25P及API全集通过。
4. `check-full`根2351P/1F/20S，32/35任务成功：既有共享prompt单测仍要求有仓库时忽略历史，正是本次要修复的行为。现在同时验证历史文本、仓库优先指导/evidencePath和无视觉解析说明，并保留输入不变/确定性断言。最终check35/35、0缓存；未删除测试或放松产品校验。

**证据限制与默认skip**：Hono使用真实middleware的app.request，未启动独立API监听器；S3为AWS SDK访问回环协议夹具，模型/账号为合成输入。历史succeeded行、promptSnapshot以及正式版保护中的trial/cover/formal由SQL建立，不能计为真实历史生图、试跑或正式化。历史事务恢复使用真实不同Node PID和实际Agent服务，但本批没有新增历史专属SIGKILL；全集中的既有B40等强杀测试另有其自身范围。真实PNG为4×3小图；完整8000/32000文本限制与64图/128MiB限制的合同验证不等于最大负载测试。17快照schema通过不等于实际16个仓库加历史的联网压力验证。

**Electron补跑命令与跳过核对**：先执行`pnpm exec playwright test -c tests/v25 --project electron`，101P/48S；其中46项为数据库环境门控。已使用`RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 electron.account-cloud-service.spec.ts electron.cloud-backup-confirmation.spec.ts electron.cloud-crash.spec.ts electron.cloud-retry.spec.ts electron.resume-faults.spec.ts electron.retry-faults.spec.ts electron.retry-recovery.spec.ts --project=electron`补齐46P，测试ID与第一轮被跳过项一一对应，无重复计数。两份原始report和去重清单保留。本次剩余仅`electron.live-account`真实账号登录、`electron.sync`真实中转站Key验证两项外部资源门控，不记通过。补跑首命令把文件放在可变参数`--project`后，CLI误识别为项目名，未启动测试即退出1；修正参数顺序后独立留存成功报告，没有修改测试来消除skip。

根20项仍为DB generation-execution5、desktop managed-cloud-service15门控；默认API292P/354S、worker77P/85S、DB40P/5S，独立后端全集只解除其对应门控，不自动证明桌面15项。Electron默认46项DB跳过已经独立补验；只保留上述两项live门控，不能把第一轮48S直接作为最终未验数。API旧账号恢复自然120秒租约通过不证明历史Agent1h或副本24h自然期限。全GC/账号删除/来源与提示词retention、换图修订、旧新消费者回滚及完整平台发布保留原验收。

后续可直接领取[路线图§6.29](./V25-MIGRATION-ROADMAP.md)的R1.1–R1.4；随后D3包、D4共享产品和原E条件。管理员在全v2.5完成后依G-OPS-01→03进入，复用原技术栈。

### 5.35 B42 已确认仓库图片采用、来源溯源与更新资产事务（2026-09-09）

**结论**：R1.1–R1.4后端已实施并通过下列验证。已确认快照/持久Analyst报告决定采用与舍弃，真实图片独立复制并固定来源/path/imageRole/hash；创建/修改/更新/详情/图片prepare一致，更新只替换变化来源图片，旧revision/正式current保持。纯文本兼容回归发现并修复了空采用记录错误要求AssetService的问题。文本模型不接收像素；专用包、共享异步页面、原E联合验收及管理员前置仍开放。

**同源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加未提交工作树；1410源码/配置/测试文件，摘要`841cdd3ca5ca401d6c1f52e43847a5429f3439ab02e9deda81e37bd0a00675c8`。相对B41新增5文件、修改9文件、无删除。最终API/worker/check/Electron/扫描均在兼容修复之后，源码核对无漂移。macOS arm64、Node25.8.1、隔离PG17；未提交/推送/修改桌面版本或部署。[统一报告](../../tests/v25/.results/b42/validation-summary.json)、[源码清单](../../tests/v25/.results/b42/source-files.json)、[相对B41差异](../../tests/v25/.results/b42/source-delta-from-b41.json)。下面日志相对`tests/v25/.results/b42/`，精确UTC起止及命令见对应`*-summary.json`。

| 阶段 / 实际命令（仓库根） | 实际结果 | 证据与适用范围 |
|---|---|---|
| T1 `pnpm exec vitest run packages/contracts/src/__tests__/design-scheme-repository-images.test.ts packages/domain/src/design-scheme/__tests__/repository-materials.test.ts` | 2文件4 passed，0 failed/skipped | `units-first.log`；合同兼容/来源角色/去重/冲突/限制/有序采用与舍弃，最终check仍覆盖 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-repository-materials.integration.test.ts` | 最终专项22 passed，0 failed/skipped，16.01s | `repository-fifth.log`；纯文本兼容修复前运行，之后全部22项包含于最终API全集，不重复累计 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-text.integration.test.ts` | 修复后20 passed，0 failed/skipped，11.92s | `text-compat-second.log`；原纯文本、单次调用/授权/取消等集成回归；首次19P/1F见下文 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api test:integration` | 22文件377 passed，0 failed/skipped，exit0，151.88s | `api-full.log`；09-09 11:38:53–11:41:25北京时间；含所有上传/历史/仓库/文字/更新和费用回归 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker test:integration` | 8文件85 passed，0 failed/skipped，exit0，28.55s | `worker-full.log`；11:44:50–11:45:18；本批无worker修改，复用原暂存注册表/引用/outbox/retention测试，不称新增仓库专属自然TTL |
| PG/SQLite | 无新DDL | 复用0018 materials与来源/文档JSON；集成继续在隔离库旧0017状态执行根db:migrate到0018，不是本批新增迁移或生产升级 |
| `pnpm run check` 最终 | 35/35 successful，**28 cached**，exit0，27.43s；根2356P/20门控S，features633P | `check-second.log`；11:45:40–11:46:07；Biome/typecheck/unit/双端build/依赖边界通过，缓存命中如实保留 |
| T3 `pnpm exec playwright test -c tests/v25 electron.design-schemes.spec.ts electron.scheme-agent-model.spec.ts electron.workbench.spec.ts --project=electron` | **16 passed，0 failed/skipped/flaky**，exit0，50.08s | `electron-focused.log`及[原始JSON](../../tests/v25/.results/b42/electron-report.json)；11:47:30–11:48:20；方案包往返/改名/删除/取消，共享Agent模型创建/修订/新PID，工作台引用/生成/取消/多图/持久草稿和浅色快照 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b42/security-source-final.json` | 1314文件，0 findings/errors，exit0 | `scan-final.log`与[扫描JSON](../../tests/v25/.results/b42/security-source-final.json)，不是安装包或生产出口扫描 |
| 完整Electron / PC-Mobile Web / T4 / T5 | 本批未运行 | 本批只改canonical可选字段和云端域/API；无共享屏幕/桌面产品代码变更，故补相关桌面定向。B41完整Electron与B33完整三形态仍为历史；前置启动Web构建不算Web产品E2E |

**22项仓库专项的验收映射**：

- 可信来源与采用：确认后移动分支不再抓取；按报告只采纳真实style.png并记录未选图片；两个仓库同名路径与上传/历史四类素材得到独立正确资产；同路径同role去重，角色冲突拒绝；不存在路径/文本路径拒绝，损坏PNG在更早来源准备就被拒绝；所有图片未选时保留空采用与舍弃说明。
- 限制与防篡改：3×24=72张在副本复制和Compiler前拒绝；合同覆盖组合64张/128MiB边界，但未执行最大字节负载；确定性更新不能改写仓库路径或抹掉新资产provenance，跨owner不能读图片；复制元数据篡改及Compiler期间对象丢失不发布草稿。
- 修订一致性：modify在原来源准备到期后保留资产且不重新取GitHub；两源更新只替换变化源，原正式current/旧图片/未变来源保留，新revision绑定与文档一致；新报告不采用任何图片时，新revision移除相应图片，旧revision仍能读取，提示不再谎称全部旧图片保留；实际RunService.prepare消费图片资产。
- 并发和持久恢复：两调用并发免费采用仅一个上下文/Compiler/草稿，输家暂存副本仍有注册记录；创建/更新资产插入触发器失败回滚引用和指针，实际新PID复用既有采用ID与已完成模型结果；采用决定尚未入库时失败，新PID只重做免费复制、不重复Analyst，原副本仍可发现。
- 取消与unknown：复制中取消、Compiler响应未知均不发布且不额外POST；实际子进程在Compiler已POST后被SIGKILL，新PID拒绝重发，后续取消/SQL推进租约/reconcile保留unknown事实。发送次数由真实回环HTTP计数核查。

**首次失败、修复和复跑**：`typecheck-first`发现可空Row与request收窄问题，显式类型/条件修复后通过；`repository-first`5P/6F中，多仓库ZIP夹具用了固定根目录，改为实际仓库名+commit，另将负例断言对齐更早发生的真实failed/0或1次POST拒绝，未放宽产品校验；`repository-second`10P/1F是update helper在未变来源检查的queued中间态提前结束，修正有界推进与canonical update.changes断言后third11P、fourth19P、fifth22P。`check-first`35/35、0缓存通过后，专门的`text-compat-first`仍发现**生产兼容缺陷**19P/1F：空repositories使lockMaterials误要求AssetService。修复为始终核对上下文摘要、只有真实图片才锁暂存资产，原文本20项和最终API377项通过。保存[兼容修复前源码](../../tests/v25/.results/b42/source-before-compat-fix.json)，此前摘要`baa4f4233a52a97454a551b70edf754cadeee5d1f730f0fb224db5942725ed97`不能冒充最终。所有首败日志保留，没有删测试或放宽超时；最终check仍有28项有效缓存，不称35项全部重算。

**真实与替身边界**：Hono真实鉴权用app.request，未启动本批独立API监听器；S3为AWS SDK访问回环协议夹具并读写实际PNG，模型/GitHub/账号使用合成回环HTTP。新仓库用例的formal/trial/cover由SQL建立，不代表真实云端生图/试跑/正式化；真实图片是5×4小图。并发采用用例为同一Node中的并发服务调用，另有实际不同PID/强杀用例，二者不混称跨进程并发。选择只表达来源证据与保留参考素材，不代表视觉理解，许可证固定null而不信模型自行声称MIT。

**skip与生命周期**：默认根2356P/20S仍为DB generation-execution5及desktop managed-cloud-service15；默认API292P/376S、worker77P/85S、DB40P/5S。独立API/worker全集解除各自对应门控，不把根桌面15项顺带记为通过，也不把默认与集成结果相加。Electron本次所选16项无skip；B41全集147P/2外部S属于历史范围。新副本24h/Agent1h自然期限、全部账号删除/GC/旧新消费者/最大字节负载未验证，SQL推进过期不冒充自然等待。API旧账号测试自然等待120s仍只证明它自身的租约。源包/资产晋升前产生的孤儿不是零：均先登记，取消/失败/并发输家可由既有清理机制发现；全生命周期继续按G-DATA验收。

下一阶段[路线图§6.30](./V25-MIGRATION-ROADMAP.md)已经按F1–F5拆解专用包的合同/暂存/导入/导出/跨端往返、验收与待执行测试；随后D4共享产品和原E条件。管理员等全部v2.5闭合后再按G-OPS-01→03接入，不创建第二套账号/账务/任务状态机。

### 5.36 B43：共享方案包编解码与桌面新素材往返（2026-09-09）

**范围与当前结论**：完成G-CLOUD-05的共享归档基础：contracts统一v1/v2实体与预算，新增Node包`@musefold/scheme-package`供API和Electron主进程消费；桌面实际读写迁入同一实现。修复新素材导入时ID重映射、historyItems/仓库图片字段在SQLite JSON、core和IPC桥接中的丢失。云端暂存/确认/事务导入/导出三个原接口仍501，不能把Node加载成功当作云端产品闭环。规范与剩余兼容限制见[包验证文档](./V25-PACKAGE-VALIDATION.md)。

**源码与证据**：所有本批命令/起止UTC/退出码保留在`tests/v25/.results/b43/*-summary.json`及同名日志。统一结果见[阶段JSON](../../tests/v25/.results/b43/validation-summary.json)。工作树仍dirty，HEAD没有包含本批变更，不能当成发布checkpoint。API/worker使用的1422文件摘要为`b0eb2afbb6c6ad397d75b576f8de2595e27022eb17cece42141231cc32785ac9`（`source-before-legacy-test.json`）；随后只新增两项桌面v1测试，得到`7228e68b3a9b5923a2d609425e9bb1a1e70be83ffc15d3c65c390f43c554a296`，定向73项/check-final/首轮Electron/扫描使用该版本。最后修复Electron恢复用例的等待条件，最终1422文件摘要`a94805b7f9721f96ac65014d8b5a1b23abe1c5e62540912d675165799e0ed22f`，生产源码与API/worker验证时一致；两份测试差异不能隐去，原始快照均保存。

| 阶段 / 实际命令 | 实际结果 | 证明范围与限制 |
|---|---|---|
| T1 共享codec+contracts+桌面share/archive/host/source-ingestion七文件（完整命令见`codec-final-summary.json`） | 73 passed，0 failed/skipped，exit0，1.97s | 新ZIP内容图/恶意包、API cwd独立Node、桌面旧功能与新素材立即往返；不是云HTTP接口 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api test:integration` | 22文件377 passed，0 failed/skipped，exit0，156.13s | 原完整API回归；新codec实际消费另由T1子进程证明，尚无云包事务测试 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker test:integration` | 8文件85 passed，0 failed/skipped，exit0，33.07s | 原队列/资产清理回归，本批无新worker行为 |
| `pnpm run check` 全量重算轮 | 36/36 successful，0缓存，exit0，54.36s；根2382P/20门控S、features633P | `check-second.log`；新Node包增加一个typecheck任务，不能和此前35任务混用 |
| `pnpm run check` 增补v1测试后 | 36/36 successful，31缓存，exit0，30.84s；根2384P/20门控S、features633P | `check-final.log`；实际重算与缓存分列 |
| `pnpm run check` E2E等待修复后 | 36/36 successful，33缓存，exit0，9.52s；根2384P/20门控S、features633P | `check-after-e2e-wait-fix.log`，结果使用最终源码；没有更改产品或构建输出 |
| T3 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron` | 首轮146 passed / 1 failed / 2 skipped，exit1，888.47s | [原始完整报告](../../tests/v25/.results/b43/electron-first-report.json)；唯一失败为等待竞态，原始报告及error-context保留 |
| T3 修复后 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 electron.account-cloud.spec.ts --project=electron --repeat-each=5` | 两场景各5轮，共10 passed，0 failed/skipped，exit0，63.05s | [修复后原始报告](../../tests/v25/.results/b43/electron-recovery-fixed-report.json)；按文件/标题/project合并两轮得到147个通过场景、2个外部skip，**不是单次完整命令全绿**；自动重试0，首次失败不隐藏 |
| 源码扫描 `node scripts/security/scan.mjs source --report tests/v25/.results/b43/security-source-after-e2e-wait-fix.json` | 1326文件，0 findings/errors，exit0 | `scan-after-e2e-wait-fix.log`，修复后最终源码复扫；不证明安装包或运行出口安全 |
| PG/SQLite迁移、PC/Mobile Web、T4/T5 | 本批无新DDL；Web产品/平台包/生产未运行 | 复用原scan_json，不把已有PG迁移回归称新增升级；Electron启动Web服务器不算Web产品测试 |

**新增测试对验收的对应关系**：

- 共享归档23项：同一混合仓库+历史真实PNG包经bytes/file往返；同进程固定输入确定性；十类重算外层hash后的内部篡改仍拒绝（资产hash/大小、来源hash/总量、仓库路径/快照/角色、历史图片/正文、跨来源资产）；CRC破坏、输入Buffer事后修改、1025目录、文件目录冲突、v1版本选择、加密/符号链接、非法UTF-8，以及大小写/Unicode/前缀/Windows设备名/ADS等路径问题。
- Node宿主1项：从真实`apps/api`工作目录启动独立Node，经workspace导出加载同一个包，实际读入ZIP并重写相同hash；没有加载Electron/SQLite，也没有启动HTTP上传服务。合同1项核对v1严格字段和统一限制。
- 桌面新增3项：真实SQLite导入混合包→实际IPC get→导出→shared reader→再次导入，断言新资产/快照身份与完整历史正文；v1合法旧实体成功成为新draft；v1 envelope合法但scheme实体非法时不发布半成品。已有桌面45项回归继续保留。
- 混合包导出资格由测试SQL明确建立formal状态，不能当成真实付费试跑/正式化；每次导入仍是draft。图片为小尺寸实际PNG，magic验证不是完整解码/最大负载测试，云端资产入口仍需既有真实图像解码。

**首败与处理**：`codec-first`3P/13F是夹具prompt.kind误填user-task，修正为真实input-template；`format-first`发现control-character正则，改用charCodeAt保持相同拒绝语义；`codec-third`69P/1F是加密STORE夹具先触发ZIP大小拒绝，改为合法DEFLATE加密夹具以验证明确加密路径；`check-first`是archiver.EntryData不存在type字段，删除错误测试参数并用真实目录尾斜杠生成目录。没有删除测试或放松资源预算。首轮Electron恢复用例在连接状态已显示、异步任务列表未加载时执行一次isVisible并跳过核对，最终SQLite仍running；修复为等待真实“核对原任务”按钮点击，完成记录也在列表中且重复核对仅GET，保留单次生成POST/真实重启/实际素材落盘及恢复全部断言，未延长超时。修复后两个真实重启场景各5次全通过，等待和动作通过Playwright真实按钮执行；仅该测试等待逻辑变化，故补跑此文件，未再次重复其余已通过的145项。合并证据见[去重报告](../../tests/v25/.results/b43/electron-combined-summary.json)，不能把首败隐藏为单轮全绿。

**Electron跳过**：`electron.live-account`活体登录/提示词CRUD需要MUSEFOLD_LIVE_E2E和测试账号；`electron.sync`真实TvT连接需要MUSEFOLD_E2E_IMAGE_API_KEY。两项未运行，分别保留外部账号/真实连接验收；DB门控本轮显式开启。首轮与补验报告中flaky均0，仅表示没有自动重试分类，不能抹去已记录的一次人工修复前失败。

**剩余边界和接续**：默认根20S仍为5项DB generation-execution及15项desktop managed-cloud-service；默认API/worker门控与独立集成结果不累加。完整三形态历史证据仍为B33。未验最大包内存/并发、Windows/跨locale排序恒等、v1云转换、导入后modify/update再导出、share-import kind兼容、自然TTL、云端包生命周期及原C3/C5/P5/P6/worker/账号删除/旧库同步/发布。按[路线图§6.31](./V25-MIGRATION-ROADMAP.md) F1兼容→F2暂存→F3私有导入依据和事务→F4导出下载→F5/D4产品合流→原E联合验收接续，管理员仍待整个v2.5完成后实施。

### 5.37 B44：导入方案修订继承、来源更新与新PID往返（2026-09-09）

**结论**：修复导入混合方案modify丢assetIds/repositoryImages，以及缺少仓库元数据导致update返回no-source。新core解析器区分资产原始归属与版本显式继承，export/prepare/run统一消费；更新固定新来源和图片，只替换变化来源，完整历史正文进入Compiler。原正式current、旧来源/资产与新版本试跑/封面资格保持。专用包云端、共享产品及原E仍未闭合，管理员未启动。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加未提交工作树，1427文件摘要`7b3f2032c4035dc30671f4f2c7d69ce9aa070c723cb3af8a7716909461472e43`；相对B43新增5、修改9、无删除。第一次check在1426文件摘要`b44d0222b10c06563fe799ccf5ad36cf9a1127e81a55a58ad8a9d8a64c4cabe5`上执行，随后仅新增Electron测试文件，产品代码相同；该阶段check、定向Electron和首轮完整Electron对应这一构建。审查随后修复Windows路径分隔符并新增路径测试，最终源码1427文件摘要`15077b90f428d41eef7a3818ce003c0727d757668fe024cfa1a7f4236efe94d9`；只改update-materials及imported-revision测试两处。路径专项6P和原定向全集128P已通过，最终check/完整Electron均已在这一构建复验，源码核对无漂移。macOS arm64、Node25.8.1。无新DDL/应用版本变更、提交/推送或部署。[源码清单](../../tests/v25/.results/b44/source-files.json)、[相对B43差异](../../tests/v25/.results/b44/source-delta-from-b43.json)、[统一报告](../../tests/v25/.results/b44/validation-summary.json)。下列日志位于`tests/v25/.results/b44/`，真实命令和UTC时间见对应`*-summary.json`。

| 阶段 / 实际命令 | 结果 | 适用范围与证据 |
|---|---|---|
| T1/T2 定向Vitest（完整12文件列表见`desktop-final-summary.json`） | 12文件127P，0F/S，1.41s | core引用5项、导入修订5项、run adapter新增1项及既有modify/update/share/计划等回归；不是127个新增测试 |
| `pnpm run check` 首次 | 36/36成功、0缓存，39.17s，exit0 | Biome/typecheck/unit/双端build/边界；新增Electron文件之前，`check-first.log` |
| `pnpm run check` 路径修复前 | 36/36成功、31缓存，24.08s，exit0；根2395P/20门控S，features633P | `check-final.log`；09-09 13:11:37–13:12:01北京时间，缓存如实保留 |
| T3 `pnpm exec playwright test -c tests/v25 electron.imported-scheme-revision.spec.ts --project=electron` | 专项最终1P，0F/S/flaky，7.48s（路径修复前） | `electron-import-third.log`及[原始JSON](../../tests/v25/.results/b44/electron-import-final-report.json)；先前两次夹具失败另存，不重复累计 |
| T3 首轮 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron`（路径修复前） | 148P/2外部S，0F/flaky，exit0，761.08s | `electron-full.log`与[首轮JSON](../../tests/v25/.results/b44/electron-full-report.json)；不是最终源码 |
| T1/T2 路径修复后的定向全集 | 12文件128P，0F/S | `desktop-after-path.log`；额外1项实际Node win32/posix语义及越界检查，非Windows OS |
| 最终 `pnpm run check` | 36/36成功、31缓存，25.07s，exit0；根2396P/20门控S，features633P | `check-after-path.log`；与最终源码一致 |
| T3 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron` 最终 | 148P/2外部S，0F/flaky，exit0，747.60s | `electron-full-after-path.log`与[最终JSON](../../tests/v25/.results/b44/electron-full-after-path-report.json)；单次完整运行，自动重试0，两轮不重复计数 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b44/security-source-final.json` | 1331文件，0findings/errors，exit0，0.67s | 最终路径修复后再次扫描，结果相同；[扫描JSON](../../tests/v25/.results/b44/security-source-after-path.json)与`scan-after-path.log`，源码扫描，不是安装包/生产出口 |
| API/worker全集、Web产品E2E、T4/T5 | 本批未执行 | 无API/worker/共享Node codec/合同/共享页面源码变更；B43的API377P/worker85P、B33完整三形态属历史，不冒充B44复验 |

**验收映射**：core测试验证旧无声明自有资产、显式继承、重复/缺失/跨方案拒绝、未继承旧资产不能重新加入，以及新资产写入失败时revision/指针回滚。混合包测试使用实际SQLite与来源文件，验证导入→modify/update→真实IPC prepare→export/shared reader→再次导入；更新采纳新图与不采纳新图两种路径都保留历史正文，变化来源替换但旧修订不变。触发器故障回滚scheme/revision/snapshot/asset和已知新来源目录，移除测试触发器后原方案仍可导出再导入。实际run adapter读取旧原始asset/stage/清理，上传fallback没有被调用，旧源文件保留。

**真实Electron新增场景**：共享ZIP经原生picker既有E2E接缝实际导入，主进程调用回环模型角色生成修订，关闭应用；通过既有repository创建合成已完成trial和当前版本独有的PNG封面以建立导出资格，再启动不同PID，真实IPC读取与导出，shared reader检查历史正文及3张资产（继承2张+测试封面1张），再次导入为新draft且无成功试跑。模型POST仅1次。这证明真实归档、主进程、SQLite与新PID保留，不证明实际付费生图或完整正式化产品链。GitHub resolver/模型为替身，小PNG为合成图；没有真实外部仓库联网或像素理解。

**首败与修复**：首次导入专项0P/2F暴露modify字段丢失和update缺来源；修复后新helper误读parse result.data，改为value。后续Analyst许可/输入、prepare quality和run参数夹具修正为现有严格合同；既有update partial mock补真实helpers及getPath，断言核对新package/snapshot/hash。typecheck首次错误为未定义IO_ERROR，改现有INVALID_STATE。回滚测试首败是触发器仍作用于独立再导入，验证回滚后移除触发器。复核发现新路径检查会拒绝Windows正常分隔符，改用宿主relative/isAbsolute检查包含关系再统一分隔符，并用Node win32/posix测试正常路径与跨盘/目录外/父级拒绝；不冒充真实Windows环境。Electron首次未解BridgeEnvelope、第二次Compiler空inputs不满足min1，修复夹具并按既有repository建立本版本试跑/封面样本；第三次通过。前两份Electron JSON及其他首败日志保留。B45开始时辅助脚本误写B44 typecheck-first.log，原stdout无法恢复；原命令/时间/退出1摘要从本批统一报告恢复，日志现明确标记此证据缺口，后续check通过证据完好。未放松产品校验、删除测试或扩大超时。

**仍需验收**：本批图片仅字节/hash/头部/尺寸校验，不是完整decode；共享codec跨locale排序、createdBy/parent/来源显式metadata冲突/v1云转换/旧消费者仍开放。更新Compiler完整未变化来源规则及legacy历史合流尚未全部证明。目录回滚覆盖persist已返回ID，返回前写盘失败/SIGKILL/清理失败须统一孤儿对账；不能宣称全GC或自然期限已验。默认根20项、API376项、worker85项、DB5项门控skip没有被check自动覆盖。最终全Electron开启DB门控，仅跳过live-account真实账号和sync真实中转站Key两项外部资源用例，跳过不记通过；证明其对应产品测试，不等于API/worker独立全集。本机记录不能替代Windows、两设备、平台安装包、安全扫描/部署回滚与远程MCP。下一阶段验收及可复制goal见[路线图§6.32](./V25-MIGRATION-ROADMAP.md)。

### 5.38 B45：旧包共享解码、版本来源事实及跨locale摘要（2026-09-09）

**结论**：legacy文档schema与双向桥归入contracts单源，桌面旧入口重导出；IPC/分享保留创建来源、父版本、约束证据及编译轨迹。仓储以实际操作/原列写读创建事实，旧JSON不回写且旧parent不猜测；share-import真实kind跨SQLite/IPC/导出保留。Node共用v1正文/来源解码和canonical来源一致性，新导出固定en-US排序，旧locale逐个核对精确摘要；最终v2形状/算法/版本不变，没有新增hashOrder字段。云端三个原包HTTP入口仍501，完整产品/原E/管理员前置未完成。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加未提交工作树，1436文件摘要`2225fecf2c57bd81e6dcc44b504141d8dc69c46094356d60cee48aac955e3a5a`；相对B44新增9、修改12、无删除。最终API/worker在`efc276687d419b56f5b87e145ada4f5145f3025fe38c577f3cb6c0a1fb96d053`执行，之后仅content-hash.test.ts改为异步复用子进程，所有产品源码相同。最终check/扫描/完整Electron使用最终测试源码。早期排序方案源码及原断言修复另留清单，不把早期green当最终证据。[统一报告](../../tests/v25/.results/b45/validation-summary.json)、[源码清单](../../tests/v25/.results/b45/source-files.json)、[相对B44差异](../../tests/v25/.results/b45/source-delta-from-b44.json)。macOS arm64、Node25.8.1，无新DDL/应用版本变化、提交/推送或部署；原工作树保留。

| 阶段 / 实际命令 | 结果 | 证据与范围 |
|---|---|---|
| T1/T2 定向Vitest，精确14文件范围见`content-final-summary.json` | 126P，0F/S，3.04s | `content-final.log`；文档桥3项、旧内容解码6项、来源冲突6项、四locale及Unicode2项、原包/修订与core；这是合计回归数，非126个新增测试 |
| T1 locale子进程改造后 `pnpm exec vitest run packages/scheme-package/src/__tests__/content-hash.test.ts apps/desktop/electron/main/skill-import/__tests__/zip-reader.test.ts` | 2文件13P，0F/S，0.83s | `locale-process-final.log`；4个新Node进程复用两轮I/O，保留4种实际默认locale、5包×4环境20次交叉读取及原超时限制 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api test:integration` 最终产品版本 | 22文件377P，0F/S，exit0，207.68s | `api-after-hash-policy.log`；14:04:04–14:07:32北京时间；之前API377P另存，不重复累计 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker test:integration` 最终产品版本 | 8文件85P，0F/S，exit0，101.93s | `worker-after-hash-policy.log`；同一并行窗口，之前85P另存，不重复累计 |
| 最终 `pnpm run check` | 36/36成功，**0缓存**，exit0，39.87s；根2416P/20门控S、features633P | `check-after-test-process-fix.log`；14:07:47–14:08:27；Biome/typecheck/unit/双端build/边界完整重算 |
| T3 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 --project=electron` | **148P / 2外部S / 0F / 0flaky**，exit0，778.82s | [完整原始JSON](../../tests/v25/.results/b45/electron-full-report.json)、`electron-full.log`；最终构建完整150项，单worker、0自动重试；跳过为真实账号登录及真实中转站连接，均缺各自显式凭据/开关 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b45/security-source-after-test-process-fix.json` | 1340文件，0findings/errors，exit0，0.65s | [扫描JSON](../../tests/v25/.results/b45/security-source-after-test-process-fix.json)；源码扫描，不是安装包或生产出口扫描 |
| Web产品E2E / T4 / T5 | 本批未执行 | 未改共享页面；B33三形态属历史，Windows、安装包、生产/回滚及远程MCP仍待原卡验收 |

**具体验收证据**：文档JSON往返保留createdBy/createdAt/parent、约束evidencePath、compilerVersion、trace.kind/output/running状态；旧无元数据文档仍读，history伪URI不进入共享定位。真实仓储新建/结构化编辑/Agent修改验证实际user/agent/import和精确基线，伪造父版本被仓储实际值替代；旧行创建列只读补充、JSON原样。真实混合包modify后IPC/export保留谱系，share-import快照的存量行与canonical种类往返不丢失；导入仍生成新root且无试跑资格。

v1真实ZIP在桌面旧导入和独立API工作目录Node中消费：完整长正文、真实PNG源索引和scan原值可读取，重复来源目录、同来源文本/图片同名、非法UTF-8、revision错配拒绝。预览只作为归档内预览索引，不授予成功试跑或封面；现有桌面v1导入不将preview持久为方案资产，云F3还须明确保留/映射策略。共享decoder不执行scan，也不把它当Agent确认。canonical来源非空URI/ref/commit/hash与snapshot不一致拒绝，冗余省略及已定义等价hash/仓库后缀通过。

摘要验证启动en-US、zh-CN、sv-SE、tr-TR默认locale的真实Node进程：含ä/z路径的旧摘要产生不同值，新固定排序一致，各进程对5份归档互读，共20次；错误总摘要仍拒绝。没有仿真改变localeCompare，也未新增v2字段或格式号。reader兼容本运行时支持的候选默认collation，不证明所有历史ICU/Unicode版本/自定义collation；完整Node/Electron升级与Windows发布矩阵保持待验。实际图片只用小PNG，不把魔数或文件索引等同完整像素解码/最大负载。

**首次失败与修复**：content-first中6项调用了错误测试helper名，改用既有refreshDocument；旧mutate包夹具也须按最终导出的固定排序重算真实摘要。check-first因String.isWellFormed缺少TS lib声明失败，改有界UTF-8 roundtrip检查，未升级目标或扩大输入。check-second唯一失败为旧modify断言要求parent为空，按合同与真实仓储改为精确基线和agent。格式策略收敛后check与API/worker并行，locale测试30s、既有ZIP限制5s两项超时；改造新测试为4个异步复用进程并串行复验，保留原断言/时间限制，13项定向及最终全仓通过。该并发窗口比独立执行更慢，资源竞争是推断，未宣称已定位操作系统层原因。各次stdout/命令/时间/退出码保留在对应日志与summary。

**证据工具事故**：本批第一次typecheck辅助脚本沿用了B44输出目录，覆盖B44 typecheck-first原stdout。已将本次成功typecheck输出移至B45，并从B44统一报告恢复其原命令/时间/退出1摘要；原stdout无法恢复，B44该日志明确标记缺口，后续green-check报告未受影响。已修复脚本目录，不能把恢复的说明当作原始失败输出。

**范围限制**：API用真实PG及既有迁移回放，上游/账号/S3沿原回环夹具；无生产迁移/联网仓库或真实付费模型。默认check的根20项、API376项、worker85项和DB5项门控skip按原范围保留，独立API/worker只覆盖对应全集。完整Electron的真实进程与SQL/模型替身以原用例为准；本批扩充实际包往返的创建来源/父版本断言，导出资格仍由repository合成trial/PNG建立，不能称真实付费试跑。F2持久包、F3原子导入、F4下载、F5/D4共享产品、全生命周期及原E全部条件仍开放；下一goal见[路线图§6.33](./V25-MIGRATION-ROADMAP.md)。

### 5.39 B46：云端方案包持久上传、精确确认与清理租约（2026-09-09）

**结论**：新增云端包begin/binary PUT/get/decision/cancel，API与api-client已接；owner/request/字节hash/格式/解析版本/账号授权摘要持久化，先登记对象/outbox再PUT，确认前重读精确字节并事务复查身份。v1/v2沿共享codec，取消/拒绝/失败与租约和既有worker清理协调。确认不创建方案/资产或授权花费；旧宿主prepare/import/export仍501，F3/F4/F5/D4和原E、管理员前置继续开放。行为详见[包验证§8](./V25-PACKAGE-VALIDATION.md)，下一goal见[路线图§6.34](./V25-MIGRATION-ROADMAP.md)。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加未提交工作树；最终1455文件摘要`79032af137f1cd31e0bd919f88bba44763479f7342158788d8b430a40f9668e9`。相对B45新增19/修改11/删除0；worker完整运行在`7967831acfb488f238de2fc8e8d57551eb4325a56748096500ce18abe240a6d9`，之后只有既有Agent测试的子进程启动组织改变，产品源码完全相同。最终API/check/扫描对应最终测试源码；报告存[统一JSON](../../tests/v25/.results/b46/validation-summary.json)、[源码清单](../../tests/v25/.results/b46/source-files.json)、[相对B45](../../tests/v25/.results/b46/source-delta-from-b45.json)。macOS arm64/Node25.8.1；无提交/推送/应用版本变化/生产部署。

| 阶段/真实命令 | 最终或明确范围结果 | 证据与限制 |
|---|---|---|
| T1 contracts/client | contracts7P、client3P，0F/S；最终check均包含 | `unit-first.log`、`client-first.log`；根Vitest只收集契约文件，unit-first命令列出的API bytes路径未被根include收集，不能误计；bytes/storage实际由API范围另验 |
| T2 定向API包服务及流/S3 | 3文件25P，0F/S | `packages-final.log`；19包集成+4流+2存储，后续终态登记/公共错误码修复已在最终API/check复验；25非25个接口 |
| T2 最终API全集 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api test:integration` | 23文件396P，0F/S，exit0，155.40s | `api-final.log`；首次全集395P/1F另存，最终全量取本行，不能合并掩盖首败 |
| T2 worker全集 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker test:integration` | 9文件88P，0F/S，exit0，70.31s | `worker-full.log`；新增3项含于88；产品源码与最终相同 |
| 最终 `pnpm run check` | 36/36成功、30缓存，exit0，30.13s | `check-final.log`；root2426P/20门控S、features633P；API默认298P/395门控S、worker77P/88门控S，独立全集各自明确补验 |
| 源码内容扫描 | 1362文件/1归档，0findings/errors，exit0，0.96s | [扫描JSON](../../tests/v25/.results/b46/security-source-final.json)；扫描包含合成v1归档，不代表安装包/生产出口扫描 |
| T3/T4/T5 | 本批未执行 | 未改features/UI/桌面主进程；B45完整Electron148P/2外部S和B33完整三形态只属历史构建。跨端产品、平台安装包/生产迁移/回滚/远程MCP另验 |

**实际验收**：新隔离PG17经根`pnpm run db:migrate`应用真实0019；完整API保留既有多个旧schema起点升级回放，worker也应用相同迁移链。新表无旧列/旧行回写；两份生成JSON只格式整理，解析前后等价另存`migration-metadata-format-equivalence.json`。没有将DDL生成成功等同生产升级或旧二进制兼容。

二进制HTTP测试启动真实Hono Node服务，按未知Content-Length的分块流接收；PG中先有stage/registry/outbox，S3回环HTTP用真实AWS SDK收发相同字节，新Service实例可读。覆盖同请求并发幂等/不同hash拒绝、跨owner/匿名拒绝、截断/超量/错误hash/非法ZIP、不覆盖重放、取消与迟到PUT、变更确认/存储对象/授权/过期、S3已写但返回失败，以及最终事务触发器拒绝ready后回滚。最终失败/取消/拒绝的registry为cleanup_pending，不遗留available假象。额外验证JSON限制只作用包POST，原其他路由保留自身策略。

真实v1 ZIP暂存并确认，预览仍单独计数且业务asset表为空；v2实际归档沿共享writer。S3存储专项真实写读21MiB，证明包存储不误用图片20MiB上限；额外用1024字节预算验证超量拒绝。这不是256MiB完整包、最大解压、双并发或多API实例RSS/吞吐压力测试。限额源码为每owner3暂存、每API实例2个上传/确认读取、包256MiB/JSON8KiB；owner并发准入已验，全部负载组合后续另验。

**进程与GC**：两个本批场景分别在已认领尚未收齐请求、S3已PUT但尚未完成DB状态提交处杀实际Node PID；新Node PID读取同一uploading，原对象写次数分别0/1，不自动重传；随后显式注入租约到期边界，retire并拒绝旧请求。进程是专用测试入口，后一个场景用storage包装器暂停，不冒充生产bin完整崩溃矩阵。worker新增3项证明取消仍受未到期租约保护、崩溃认领退休/队列和幂等ack、user级联后outbox存活。新增GC用例直接调用已有store的ack，未执行真实远程S3删除；实际删除/失败重试实现和既有worker全集继续复用，完整账号删除/自然保留期/全GC仍归原E。

**首次失败与修复**：`packages-first`在beforeAll因合成manifest漏mimeType失败（0P/12未执行），补齐既有契约，未放宽产品。`check-first`因新fixture生成辅助脚本和两份迁移JSON未格式化失败，其余中断不称独立缺陷；格式后JSON语义等价。`check-second`暴露API错误码NOT_FOUND不在公共合同、测试ServerType关闭方法与unknown JSON类型；改既有VALIDATION_FAILED+404、受类型保护的关闭和真实schema.parse，未扩大合同。检查发现包JSON中间件原先会影响后续路由，改为两个明确路径并加9000字节无关路由回归；终态registry清理和PUT续租后补偿deadline也已修。

首次完整API为395P/1F，既有“两实际worker PID”用例在API/worker并行窗口超过5秒；独立原用例1P/13筛选S。将该测试两次`pnpm exec tsx`改为直接Node `--import tsx`，保留不同真实PID、顺序、IO次数、旧确认拒绝和原超时，完整Agent文件14P。减少包装进程的启动开销后重跑完整API；资源竞争为依据并发/独立观察的推断，未宣称定位系统瓶颈。所有原失败stdout/退出码/时间保留，不删除断言或增加超时。

**适用边界**：新包HTTP认证解析是显式会话fixture，服务实际锁PG账号/会话/授权；完整API其他既有测试有各自实际Better Auth范围，不把它外推本包已做真实账号登录。S3是回环协议fixture，未接生产桶；来源ZIP/PNG/账号与授权资料为合成，未联网源仓库/真实付费模型。确认与上传均零模型调用，但未完成F3私有导入依据、完整像素解码/新ID与来源映射、原子草稿/回执或F4下载，原prepare/import/export和共享页面仍未合流。最大负载、全部旧库/ICU/平台、自然TTL与生产灰度/回退、最终整包和管理员仍待验收。


### 5.40 B47：私有导入内容准备与固定身份映射（2026-09-09）

**范围与结论**：API新增三个私有内容准备文件及两个就地测试/夹具文件；actual v1/v2 bytes复用共享codec、legacy桥与已有sharp解码。新scheme/revision/package/snapshot/asset ID、完整历史/来源正文、图片、编译证据和来源类型/许可保留；旧封面/输出只作example，旧scan不授予权限。详见[包验证§9](./V25-PACKAGE-VALIDATION.md)。**无生产调用方、HTTP接线或PG原子导入；F3整项仍未完成。**

**源码身份**：原分支与HEAD仍`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`，加未提交工作树。最终1460个源码文件摘要`80d153c9548f2e35ebefe3527df7932bd3478efa5f5c07125e9036dc78359b8e`；相对B46仅新增5个文件，已有文件0修改/0删除（源码快照范围，不含文档/任务包）。[源码清单](../../tests/v25/.results/b47/source-files.json)、[增量](../../tests/v25/.results/b47/source-delta.json)与[统一报告](../../tests/v25/.results/b47/validation-summary.json)可追溯。macOS arm64，实际Node进程和工作区依赖；本批不变更应用版本、DDL或部署。

| 阶段 / 实际命令 | 最终结果 | 证据及适用边界 |
|---|---|---|
| T1定向 `pnpm --filter @musefold/api exec vitest run src/modules/design-scheme-packages/__tests__/import-content.test.ts` | 1文件20P/0F/0S，Vitest 0.794s，命令1.24s | [定向日志](../../tests/v25/.results/b47/import-after-mime-fix.log)，真实ZIP/像素/新PID；不涉及数据库与S3 |
| T0 `pnpm run check` | 36/36，30缓存，命令25.50s，exit0 | [完整日志](../../tests/v25/.results/b47/check-after-mime-fix.log)，lint/typecheck/边界/测试/桌面构建及Next生产构建。根2426P/20门控S，features633P；API默认318P/395门控S，worker默认77P/88门控S，其他包结果在原日志；缓存命中非本轮重算 |
| 内容扫描 `node scripts/security/scan.mjs source --report tests/v25/.results/b47/security-source-final.json` | 1367文件、1归档、0 findings/errors，exit0 | [扫描报告](../../tests/v25/.results/b47/security-source-final.json)；不代替依赖漏洞、安装包或生产出口扫描 |
| 文档/源码一致性 | 本节回填后校验相对链接/围栏/行数、manifest和源码漂移 | 报告存本批目录；链接检查不核对标题锚点或正文语义。父迁移任务仍有未完成项，不能写spec全通过 |

**具体覆盖**：v2真实混合GitHub/历史资料，完整提示词超过2000字符且逐字节保留；仓库imageRole和snapshot/asset/hash关联，原外部历史selection只留出处，编译规则仍指向本document来源。cover/output均降为example。错误图片尺寸、合法PNG签名但截断像素、未知编译source、同一package ID冒充不同种类来源、悬空legacy asset/snapshot均拒绝。v1旧来源与预览实际解码，manifest-only来源补绑定，目录精确身份可区分同仓库资料，不唯一时拒绝；原scan中的伪history/trial不进入trusted snapshot。canonical大小写/sha256前缀在来源、文件和资产中一致归一。

同一固定seed/时间的重复准备结果一致，新的服务端seed映射完全隔离；真实`Node --import tsx`新PID读取同一ZIP，JSON化计划逐项相同。这只是**纯内容重建**，没有杀进程、数据库幂等回执或失效epoch接管测试。测试还将v1/v2计划放进合成formal envelope，经过真实共享writer再读/映射，正文和图片完整；这不是真实付费试跑、正式化或跨宿主下载。

**首次失败与修复**：最早API typecheck在legacy资产数组推导处报TS7034/TS7005，改用现有asset schema推导元数据类型；原输出保留在会话工具记录，统一报告为重述，不冒充已保存的原始日志。初始14P，追加归一/输入固定后16P。补codec往返后首轮19P/1F（[原日志](../../tests/v25/.results/b47/import-final.log)）：夹具把`SKILL.md`按后缀标成application/json，真实source元数据为text/plain；完整check也以同一失败退出，34/36任务成功（[原check](../../tests/v25/.results/b47/check-final.log)）。夹具改为从来源元数据选MIME，保留原拒绝条件；最终20P及完整check通过。首次源码摘要`3ca3928599066e0237c8d9a48f56651bdc53e6d0cb88ef2d648d9e91b12cf7e9`和最终之间仅新fixture变化，首次文件名中的final不表示成功，退出码与报告结果为准。

**未验收范围**：没有本批开启数据库的API/worker全集、新迁移、实际S3晋升/原子草稿/HTTP导入、租约并发/账号撤销/取消/到期/SIGKILL/实际GC、UI/Electron或生产测试。B46真实PG API396P/worker88P、B45完整Electron和B33三形态只保留历史引用，不计作本批复验。全部legacy历史字段组合、不同ICU/Windows、大包/多实例压力、原E及管理员前置继续。下一目标：[路线图§6.35](./V25-MIGRATION-ROADMAP.md)。


### 5.41 B48：云端持久原子导入与幂等回执（2026-09-09）

**范围与结论**：生产app的import-package已调用私有导入服务，PG0020保存固定身份/确认/租约/回执，完整来源/资产/草稿事务提交；worker保留被引用导入对象的清理intent。实际行为与大图读取修复见[包验证§10](./V25-PACKAGE-VALIDATION.md)。本节只关闭原子导入后端切片；正式导出、共享产品和整个迁移未闭合。

**源码身份**：原分支、HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加未提交工作树；最终1467源码文件摘要 `460aae4e44fd074279966420a92ea50ad5fa0f20912432b75db3174e01e443f0`，相对B47新增7/修改14/删除0（不含文档/任务包）。[源码清单](../../tests/v25/.results/b48/source-files.json)、[增量](../../tests/v25/.results/b48/source-delta.json)、[统一报告](../../tests/v25/.results/b48/validation-summary.json)对应本批最终检查和数据库全集。环境为macOS arm64、隔离PG17、实际Node/Hono/AWS SDK；未提交、推送、改应用版本或部署。

| 阶段 / 实际命令 | 最终结果 | 证据及边界 |
|---|---|---|
| T1 `pnpm exec vitest run packages/contracts/src/__tests__/design-scheme-package-staging.test.ts packages/contracts/src/__tests__/design-scheme.test.ts packages/db/src/__tests__/schema.test.ts` | 3文件41P，0F/S，命令0.947s | [合同/schema日志](../../tests/v25/.results/b48/contracts-final.log)；imported必要事实、原合同与owner外键 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-package-import.integration.test.ts` | 1文件28P，0F/S，命令13.12s | [导入日志](../../tests/v25/.results/b48/import-final.log)；新增文件最终也包含于API全集，不重复累计 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/package-cleanup.integration.test.ts` | 1文件5P，0F/S，命令4.75s | [包清理日志](../../tests/v25/.results/b48/cleanup-first.log)；包含于worker全集 |
| T0 `pnpm run check` | 36/36，0缓存，命令45.30s，exit0 | [完整日志](../../tests/v25/.results/b48/check-first.log)；根2427P/20门控S，features633P；API默认318P/423门控S，worker默认77P/90门控S。含lint/typecheck/边界、单测、双端构建；默认跳过不算数据库通过 |
| T2 `pnpm --filter @musefold/api run test:integration` | 24文件424P，0F/S，命令147.33s，exit0 | [API全集](../../tests/v25/.results/b48/api-final.log)；实际开启数据库，新包测试beforeAll执行根db:migrate；全集另包含单列detail文件 |
| T2 `pnpm --filter @musefold/worker run test:integration` | 9文件90P，0F/S，Vitest30.68s，exit0 | [worker全集](../../tests/v25/.results/b48/worker-final.log)；真实PG/队列及原故障矩阵，不是生产集群验收 |
| 内容扫描 `node scripts/security/scan.mjs source --report tests/v25/.results/b48/security-source-final.json` | 1374文件、1归档，0 findings/errors，exit0 | [扫描报告](../../tests/v25/.results/b48/security-source-final.json)；不是依赖漏洞/平台安装包/生产出口扫描 |
| 文档与源码 | 回填后校验本地链接/围栏/行数、manifest与源码漂移 | 统一报告登记最终结果；不检验标题锚点和全部正文语义，父迁移任务仍未完成 |

**真实覆盖**：v1/v2 ZIP从确认到实际HTTP POST、S3字节和PG新草稿，真实get摘要等于回执、完整来源正文超过2000字符、素材content可读取，跨owner404；v1不可信scan不进入可信历史。哈希前缀/大小写重放同回执；错误hash/格式/确认/解析版本/过期/取消/授权均拒绝，重复请求不多创建。完成后实际修改或deletedAt软删仍只返回原回执，新正常会话可只读重放，recovery_only拒绝；这不是硬删除全生命周期已验。

写入期间取消、原会话到期、授权版本变化和账号删除均不能提交草稿；S3 PUT确实落对象后返回错误保留retryable/outbox，同seed新attempt可恢复；PG触发器故障回滚方案/来源/素材/结果，未留下半草稿。实际结构化immutable update保留来源、assetIds和repositoryImages；运行测试调用既有RunService.prepare核验本人导入参考素材，0 generation runs/模型调用，不把准备成功称为真实付费试跑或正式导出。

**进程与对象GC**：三个专用Node测试进程分别在读完原包、完成首个真实PUT、提交完成但未返回回执处SIGKILL；不同新PID读取同一PG并恢复。未到期running先409，随后显式在PG注入租约到期；种子/逻辑ID不变、attempt变化，已提交结果无额外PUT。另测旧attempt暂停PUT、新epoch完成后释放旧调用，旧调用409且不覆盖当前对象。测试入口和存储暂停包装器不冒充生产bin，未覆盖任意长SIGSTOP后继续网络写入的所有孤儿竞争。

worker包清理5项包括B46原3项及本批2项：只保护当前有效attempt租约；有source/asset引用时延后并保留outbox，账号级联后队列仍存在，显式置为到期后实际AWS SDK→回环S3 DeleteObjects协议删除对象并ack。引用样本由PG SQL构造，使用内存对象集合提供S3协议响应；没有真实生产桶，也未自然等待24小时保留期。完整来源孤儿、硬purge、元数据保留和账号全量GC仍属原E。

**大图实证**：实际生成4096×1800未压缩PNG大于20MiB，作为包内图片导入，默认20MiB测试存储仅在服务传显式预算时放行，实际content逐字节相同；因此验证了导入64MiB单条预算的读取接线。不是64MiB/256MiB极值包、最大像素或多实例内存压测；完整像素/尺寸和归属约束继续使用原实现。

**首次失败及修复**：第一轮导入15P/2F（[原日志](../../tests/v25/.results/b48/import-first.log)），一项夹具写入PG不支持的legacy身份mode，另一项给无图片槽的文档传参考图。分别改为真实recovery_only负例及在实际归档中声明可选图片槽，未放宽模式或能力校验；后续20P/23P留存。补修订用例后27P/1F（[原日志](../../tests/v25/.results/b48/import-fourth.log)），测试误读update.revisionId，第二次typecheck同时报TS2339；改读实际update.document.revisionId，最终28P/check/API/worker全部通过。首次typecheck成功、第二次失败及各轮输出/退出码分别保存，不能因文件名final推断结果。

DDL生成器的复合FK顺序在执行前审查发现并调整，本批新0020先增加父唯一约束再创建FK；没有伪造失败迁移记录，没有修改旧SQL。生成JSON只记录最终格式化结果，未保存独立前后语义比较产物。辅助patch一次上下文不匹配后重新定位插入，未覆盖原工作树。

**真实/替身及未验**：新增Hono包测试的会话解析使用显式fixture，实际账号/身份/session/授权锁在PG；不声称本包已走真实BetterAuth登录。所有账号、包、PNG、原文和来源均合成，S3为回环协议fixture，无真实模型/生产账务。B48没有改共享UI/桌面主进程，未复跑完整Electron或PC/Mobile产品E2E；B45完整Electron和B33三形态仅为历史。F3剩余Agent/上游更新联合、自然期限、旧消费者/ICU/Windows、最大包/并发、F4导出/F5/D4、原E发布和管理员前置继续开放。下一步见[路线图§6.36](./V25-MIGRATION-ROADMAP.md)。

### 5.42 B49：云端正式方案归档与受控字节下载（2026-09-09）

**范围与结论**：新增正式包导出请求/状态/取消/二进制下载接口、PG0021和api-client完整字节/hash验证；旧export-package与prepare宿主接缝、共享交付尚未接通。正式版本、当版本trial/cover、来源和素材逐次核对，服务端ready不是用户已保存。详见[专用包§11](./V25-PACKAGE-VALIDATION.md)。只关闭本后端切片，不关闭F4全链、F5/D4或整包。

**源码身份**：HEAD `dcdf8d036c27f87e33de301ad4077a3110bb5b7f` 加原分支未提交工作树。最终1479源码文件摘要 `ecc26a953d5fcce6bfb3650d9ef595d5f279ce1e83c3c988f815b7ac67cadee3`，对B48新增12/修改10/删除0，不含文档/任务包。[清单](../../tests/v25/.results/b49/source-files.json)、[增量](../../tests/v25/.results/b49/source-delta.json)、[统一报告](../../tests/v25/.results/b49/validation-summary.json)可追溯。首次冻结摘要edc13235…之后仅export-service及client测试格式化变化，另存source-before-format.json；最终check/数据库全集/扫描匹配最终源码。macOS arm64、隔离PG17，未提交/推送/改版本/部署。

| 阶段 / 实际命令 | 最终结果 | 证据与适用边界 |
|---|---|---|
| T1 `pnpm exec vitest run packages/contracts/src/__tests__/design-scheme-package-export.test.ts packages/api-client/src/__tests__/design-scheme-package-exports.test.ts packages/db/src/__tests__/schema.test.ts` | 3文件22P，0F/S，命令0.903s | [合同/client/schema](../../tests/v25/.results/b49/contracts-client-first.log)；精确版本/不接owner或路径、ready必要字节事实、完整下载与错误/取消 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-package-export.integration.test.ts` | 1文件30P，0F/S，Vitest18.78s | [导出定向](../../tests/v25/.results/b49/export-final.log)；实际HTTP/PG/S3、三个真实SIGKILL及独立新PID；同30项已包含在API全集，不再相加 |
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/package-cleanup.integration.test.ts` | 1文件7P，0F/S，命令3.74s | [清理定向](../../tests/v25/.results/b49/cleanup-first.log)；原5项及新增导出租约/账号删除真实DeleteObjects协议2项，包含于worker全集 |
| T0 `pnpm run check` | 36/36，5缓存，命令48.80s，exit0 | [最终完整检查](../../tests/v25/.results/b49/check-final.log)；root2442P/20门控S，features633P，api-client86P；API默认318P/453门控S、worker默认77P/92门控S。默认门控跳过不等于数据库通过 |
| T2 `pnpm --filter @musefold/api run test:integration` | 25文件454P，0F/S，命令149.42s，exit0 | [API全集](../../tests/v25/.results/b49/api-final.log)；新导出beforeAll实际执行根db:migrate，PG0021随隔离库应用，其他历史迁移/费用/恢复用例原样保留 |
| T2 `pnpm --filter @musefold/worker run test:integration` | 9文件92P，0F/S，exit0 | [worker全集](../../tests/v25/.results/b49/worker-final.log)；既有真实队列/故障矩阵与新导出清理，无生产集群声明 |
| 源码内容扫描 `node scripts/security/scan.mjs source --report tests/v25/.results/b49/security-source-after-format.json` | 1386文件、1归档，0 findings/errors，exit0 | [最终扫描](../../tests/v25/.results/b49/security-source-after-format.json)；扫描的是源码树及其中既有归档，不是本批实际导出文件独立扫描或正式发布产物扫描 |
| 文档与一致性 | 回填后核对本地链接/围栏/行数、manifest、源码无漂移及git diff --check | 最终结果见统一报告；整体任务仍不完整，不能写spec全通过 |

**真实业务覆盖**：实际v1/v2包经B46/B48服务导入，走既有selectCover/formalize，再从真实HTTP新出口取canonical v2 ZIP。shared reader重读及私有导入内容映射验证完整正文超过2000字符、来源/图片与独立新身份；不相关working draft资产排除，显式继承资产保留。缺trial/cover、draft、旧revision、错误version、删除方案、非正常会话均在PUT前拒绝；原请求幂等且不重写，同键不同内容拒绝。下载响应private/no-store/nosniff/attachment，归档manifest不含objectKey、内部存储前缀或授权摘要；不把这些字段断言当作全部秘密/路径扫描。

**封面角色修复**：首次实际v2导出发现所选封面可能本身是repository/reference或history/example；直接改为cover会破坏codec对来源图的严格校验。修复为保留原角色，仅归档增加稳定ID的cover内容副本；不新增PG资产、不改来源链接、不放宽shared reader。专门两个用例以repositoryImages和historyItems的真实声明定位所选图，验证原角色、副本hash、无PG新增行与真实ZIP通过。素材总数含副本仍限128。

**故障与进程**：S3真实PUT期间并发重放只见preparing，取消/撤权/到期/改版本/删除账号不能提交ready，实际落物有独立outbox。PUT已落但返回错误留failed原记录，显式新请求使用不同key；PG ready更新触发器失败回滚hash/大小和状态提交，失败对象仍能追溯。读取下载字节期间同样验证取消、撤权、版本变化或账号删除后不返回文件；源对象或归档被篡改拒绝。

三个实际Node测试helper分别在源文件read、归档PUT、ready已提交但尚未打印结果处SIGKILL。不同新PID重放原请求，未完成者显式注入租约过期后显示expired且不重写对象，已ready者返回同一记录并可实际下载；新副本必须显式new request。进程不是生产bin，暂停在测试storage包装器中；不宣称自动续建、自然2分钟到期或任意长暂停的全故障矩阵。

**GC与客户端**：worker以真实PG查询证明ready受TTL保护、取消仍保留在途lease，过期后解除；独立outbox在账号级联删除导出记录后继续存在，显式置为due后实际AWS SDK→本机S3 DeleteObjects协议删除并ack。协议fixture记录被删key，不是生产远端桶；24小时延期和自然保留/来源孤儿仍另验。客户端测试使用fetch Response流替身，覆盖完整字节/hash、截断/超长/错误Content-Length或MIME/hash、鉴权错误和取消；凭据include及redirect:error可见。没有浏览器文件保存或跨宿主产品测试。

**首次失败及修复**：第一轮24项失败均来自formalize测试夹具漏confirmed:true，合同在入参阶段拒绝；修复夹具不放宽正式化。第二轮13P/11F，一项update夹具漏baseRevisionId，主要产品缺陷为上述封面角色导致实际归档校验失败，等PUT的用例因此5秒到期；不是S3/生产性能已定位。修复字段和归档cover副本后24P。新增进程与定向角色用例后29P/1F，测试仅按origin=cloud-run选中了非historyItems图片；改为按实际来源关联选图，最终30P。原日志分别为[首轮](../../tests/v25/.results/b49/export-first.log)、[第二轮](../../tests/v25/.results/b49/export-second.log)、[角色夹具失败](../../tests/v25/.results/b49/export-fourth.log)，未删产品断言或增加原失败用例超时。

首次check因两个新文件格式未达到稳定输出失败（5成功/20已调度）；再次格式化export-service和client测试、根Biome error级扫描通过后完整check通过，产品逻辑未变。两次独立API typecheck均exit0。源码首冻结与最终格式差异留证；被check中断的其他测试不作为额外产品缺陷累计。

**未验与适用范围**：新增包HTTP认证解析为fixture，PG账号/身份/会话/授权锁真实；trial完成行由SQL夹具建立，正式化服务真实执行，不是付费模型或真实worker试跑完成的证据。所有包/图片/来源/账号均合成，本机S3协议fixture。未运行本批完整PC/Mobile/Electron产品E2E、真实BetterAuth包操作、实际导出文件独立secret/path扫描、最大64MiB/256MiB包/多实例压测、自然TTL、旧消费者/ICU/Windows和生产部署回滚。B45完整Electron/B33三形态只作历史。F3/F4剩余联合、F5/D4、原E及管理员前置按[路线图§6.37](./V25-MIGRATION-ROADMAP.md)继续。

### 5.43 B50：云端导入页面与确认弹窗快速重开修复（2026-09-09）

本批把已有云端持久上传/精确确认/原子导入接进共享页面。文件、格式、预览、状态/关闭、同一回执重试和草稿详情导航统一走可选packageImport接缝；Desktop原生导入保留。账号切换阻止异步续步，账号刷新失败隐藏旧预览且禁确认。行为见[专用包§12](./V25-PACKAGE-VALIDATION.md)，交互见[UI§8B、D36–D37](./V25-UI-SPEC.md)。

| 验证 | 本批结果 | 边界 |
|---|---|---|
| 导入组件/控制器 | 15P，含显式确认、重复点击、响应丢失、迟到begin/上传关闭、精确绑定、换号/刷新失败 | fake gateway与摘要fixture；真实SHA256另由浏览器核对 |
| package client | 4P（包含于api-client87P） | 精确bytes/signal/credentials/schema及实际gateway挂载；非真实服务 |
| AlertDialog就地测试 | 2P，包含于ui15P | 明确确认、取消/Esc、焦点归还和可访问性；jsdom不证明CSS动画 |
| PC/移动专项 | 14P，零失败/跳过，包括包页面8项和账号恢复/快速重开6项 | 真实生产浏览器/文件/hash/视觉/焦点/导航；HTTP为契约fixture |
| 完整check | 36/36，26缓存；根2443P/20门控S、features648P、ui15P、api-client87P | 数据库默认门控不当作通过；计数不累加为唯一总量 |
| 开启数据库条件的完整E2E | **325P / 7S，0F/0 flaky** | 实际命令`RUN_DATABASE_TESTS=true pnpm run test:e2e`，已有真实隔离Hono/PG/worker/SQLite及进程路径已运行；新包UI仍是HTTP夹具。各项目及skip逐项见报告 |
| 源码内容扫描 | 1393文件/1归档，0命中/0错误 | 仅源码，不是新生成导出包独立扫描或平台安装包扫描 |

最终源码1486文件，摘要`159885cd176722b491010bc06d99b2d944c10be08d21bd558ede5c98219296a3`；相对B49新增7/修改10/删除0。两张新增包预览快照已查看；已有截图未在本批更新。[统一报告](../../tests/v25/.results/b50/validation-summary.json)、[完整E2E](../../tests/v25/.results/b50/e2e-all-database-report.json)、[源码清单](../../tests/v25/.results/b50/source-files.json)、[差异](../../tests/v25/.results/b50/source-delta.json)可复核。原始命令、起止时间、退出码及日志保留在统一报告。最终skip的名称、原因和补跑条件逐项见[跳过清单](../../tests/v25/.results/b50/skipped-cases.json)：视口专属互斥由对应项目覆盖，真实登录/中转站凭据路径仍归G-CLOUD-06/G-RELEASE，不能当作生产通过。

**失败与修复**：首轮格式需要第二次格式化；浏览器发现阶段的prompt模块fixture不符合schema，按canonical修正。features测试引入Node crypto触发既有依赖规则，改用摘要fixture并保留真实浏览器hash断言，没有加豁免。首次check-final里既有桌面素材恢复等待失败；未改该测试/生产逻辑，同组16P及同源码完整重跑通过，原因未充分证明，保留时间敏感记录。新增账号刷新失败保护时主动中止一次旧源码全量E2E，未把它计作通过。

完整默认E2E随后出现**276P/1F/53S**：移动账号恢复框取消后重开，遮罩拦点击。独立浏览器第25次（iteration24）复现并保存[DOM证据](../../tests/v25/.results/b50/dialog-repro.json)；同z50的内容先于遮罩，确认为两个portal退出时差导致顺序反转。新回归扩大实际退出时差，在修复前PC/移动均失败（[2F报告](../../tests/v25/.results/b50/modal-regression-before-report.json)）；修复只把AlertDialog内容放进自己的遮罩，同组挂载并统一淡入淡出/时长，保留缩放、焦点和明确确认，普通click回归通过。就地焦点测试首败来自未等待Radix自身延迟恢复，按实际异步焦点验收，未扩大生产延时。随后完整check及开启数据库条件的全量E2E通过；不以force click、删测试、改截图或调大原失败超时掩盖。

**未闭合与下一步**：新包页面还没有实际登录/API/PG/S3真包联合、刷新恢复、三方向包交换和最大文件/自然TTL验证；B49的真实归档/原子导入证据可引用但不自动升级成本批产品全链。正式包宿主交付、异步Agent共享产品、F3/F4剩余试跑/更新/独立扫描及原E继续[路线图§6.38](./V25-MIGRATION-ROADMAP.md)。管理员前置未满足，整包不关闭；无提交/推送/应用版本变化/生产部署。

### 5.44 B51：正式方案包下载交付与移动详情布局（2026-09-09）

可选packageExport接缝已把正式版本准备、原请求重试和完整文件下载接入共享页面；Web宿主区分文件成功close后的delivered与浏览器download-started。账号/取消/迟到结果均有保护，Desktop原生导出沿用。图片复核发现的窄屏标题与待验证版本说明挤压也已修复。行为见[专用包§13](./V25-PACKAGE-VALIDATION.md)、[UI§8C/D38–D39](./V25-UI-SPEC.md)，后续见[路线图§6.39](./V25-MIGRATION-ROADMAP.md)。

| 阶段 / 命令 | 实际结果 | 证据与局限 |
|---|---|---|
| T1 contracts / host / features | 新合同1P、Web宿主10P、features导出11P | 就地单测；Web宿主实际SHA256/流读取，File System Access选择器/写文件为jsdom替身；features fake gateway |
| T3 PC/移动生产浏览器专项 | 28P，0F/0S，其中新导出10项、既有方案18项 | 实际download事件、保存文件bytes/hash读回、原请求重试/撤权/中止、响应式和焦点；HTTP为非ZIP合成内容 |
| T0/T1/T4 `pnpm run check` | 36/36，27缓存；根2444P/20门控S，features659P，Web宿主36P，api-client87P，ui15P | 相同源码最终通过；各包计数不累计为独立总数；API/worker默认门控的集成测试未在此命令执行 |
| T3/T4 `RUN_DATABASE_TESTS=true pnpm run test:e2e` | **335P / 7S，0F/0 flaky** | 完整PC/移动/Electron；启用已有真实隔离Hono/PG/worker/SQLite与进程恢复路径；新包UI的HTTP夹具仍不等于真实包后端联调 |
| 内容扫描 `node scripts/security/scan.mjs source` | 1399文件/1归档，0命中/0错误 | 仅本轮源码/配置扫描，不是新生成正式ZIP包或平台安装包的独立扫描 |

最终1492源码文件，摘要`11c92e956b1de9ccbe20501d1b8420033f88d4f22378f4cf1f5fd28cf21fc000`；对B50新增6/修改7/删除0。[统一报告](../../tests/v25/.results/b51/validation-summary.json)保存命令起止时间/退出码与日志；[完整E2E报告](../../tests/v25/.results/b51/e2e-complete-report.json)、[逐例结果](../../tests/v25/.results/b51/e2e-cases.json)、[跳过清单](../../tests/v25/.results/b51/skipped-cases.json)、[源码清单](../../tests/v25/.results/b51/source-files.json)、[差异](../../tests/v25/.results/b51/source-delta.json)可复核。最终PC/移动截图及移动修复前图已查看，没有更新任何既有视觉基线。

**首败与修复记录**：首次lint需要新文件再格式化；宿主字节单测遇到jsdom/Node不同realm的Uint8Array相等判断，改为逐字节比较，仍核对完整字节；新renderHook未提供initialProps导致类型推断失败，补显式初值。浏览器fixture先遗漏正式方案trial/cover必填条件，发现阶段即拒绝，补合规合成状态；不能当真实试跑。首轮专项24P/4F由于错误信封缺requestId，第二轮26P/2F由于不存在的FORBIDDEN错误码；依现有合同修fixture，未削弱生产解析或错误断言。

截图检查发现移动标题受固定动作挤压，实际20px；新增浏览器几何回归在旧产物上1F。将窄屏动作独立成行，保留桌面横排。新断言初版错将正常六字标题恰好120px视为失败，导致18P/10F；修为至少120px，仍拒绝旧20px并保留高度/横向溢出断言。复核又发现待验证版本说明仅52px宽，同样先记录1F再修窄屏说明/动作分行，保留至少150px断言。最终28项专项与完整门禁通过。两次仅终止本任务拥有进程树的全量运行（布局审查、断言校正）分别保留中止记录，不计作成功或完整执行。

文档终验：23份文档/1026个相对链接目标无缺失、围栏及3000行检查通过；manifest守卫12P，git diff --check通过，源码零漂移。迁移验收脚本仍为60/67任务完成、1项清单未勾选，退出1表示整包确实未完成；不因本批通过改成已验收。

**真实边界与剩余条件**：新增浏览器测试使用真实生产页面/下载与文件读回，但网络和非ZIP字节是夹具；保存选择器/磁盘错误为宿主单测替身。B49实际后端归档/PG/S3/新PID证据继续有效，不自动升级成B51三方向产品真包验收。F5-R刷新/多页面恢复、F5-X三方向真包/真实身份/文件系统，D4异步Agent产品，F3/F4真实Agent/上游更新/worker试跑/自然TTL/新包扫描及原E继续。Safari/WebKit、原生File System Access、移动系统文件管理器、大文件也未在本批验证。管理员未启动，父卡及整包不关闭，无提交/推送/版本改动/生产部署。

### 5.45 文档盘点与下一轮goal拆解（2026-09-09，仅文档）

**范围**：核对当前API装配/旧同步接口/新Agent路由、方案包控制器、B51报告与源码摘要；修正路线图、测试手册和UI能力表中过时的B46/B49/B50摘要；任务卡§5新增F5-R、F5-X、D4、F3/F4及原E的逐项开发内容、依赖、验收出口和goal正文。管理员沿用迁移全部完成后的独立三阶段，本次没有启动后台开发。

| 核验 | 本次实际结果 | 结论边界 |
|---|---|---|
| B51源码清单核对 | 1492项，摘要仍为`11c92e956b1de9ccbe20501d1b8420033f88d4f22378f4cf1f5fd28cf21fc000`，零漂移 | 当前实现可引用B51对应场景；本次没有新增产品测试结果 |
| `pnpm exec vitest run tests/repo/migration-evidence-manifest.test.ts` | 12通过、退出0 | 证明证据清单结构/规则有效，不证明其中未登记项已经验收 |
| 文档链接、围栏、行数与`git diff --check` | 无缺失目标、围栏配对、未超过3000行；diff检查退出0 | 相对链接目标检查不包含Markdown锚点渲染或产品行为 |
| spec验收脚本（`--slug 2026-09-01_migrate-v21-to-v25 --compact`） | 60/67任务、1项未勾选，退出1 | 迁移仍未完成，保留原清单，不因本次文档整理勾选 |
| 全量check/E2E、实际云服务、产物、部署 | 本次未执行 | 仍引用§5.44及相应历史专项；后续按新任务实际重跑 |

当前产品测试结果仍是B51的check与335P/7S完整E2E；7个skip中实际账号/密钥等外部条件与互斥视口用例按§5.44逐例解释，不能统称“全部场景通过”。**下一阶段结果为待执行**：F5-R的reload/两页真实回执、F5-X的三方向真包、D4真实Agent产品及原E最终发布，均没有因本次盘点获得通过证据。

后续执行按T0范围/源码→T1就地与源码门禁→T2真实事务/进程→T3产品→T4产物/扫描→T5部署推进；新增PG迁移必须在隔离库执行，生产发布另按对应goal范围。精确命令见本文§3–4，逐项验收见任务卡§5，不将计划测试结果预填为成功。

### 5.46 B52：服务器导入记录与共享刷新恢复（2026-09-09）

**本批结论**：导入恢复切片已通过完整check及开启数据库条件的PC Web、Mobile Web、Electron回归，父卡与整包仍未完成。新增GET恢复列表/回执、原文件重选、明确继续、关闭保留与明确取消，行为见[专用包§14](./V25-PACKAGE-VALIDATION.md)和UI§8B/D40；没有新的PG迁移。

| 阶段 | 已取得实际结果 | 证明范围 |
|---|---|---|
| T1 contracts/client | 合同与staging合计10P，client5P | 分页/只读投影约束、GET与credential、拒绝私有字段和越界输入 |
| T2 真实PG/HTTP/S3 | 导入/上传53P；随后连同导出共83P | 新增6项覆盖丢begin、精确分页、真实在途、完成后过期/删除、撤权和重试上限；S3是本地协议fixture |
| T3 首轮PC/移动专项 | 16P/2F，18项均执行 | 两个失败仅为新增说明/取消入口导致预览截图变化；真实ZIP+Hono/PG/S3的reload/两页面各已通过，账号解析为fixture |
| T3 两张预览基线 | 查看新旧差异后仅更新对应PC/移动预览，定向2P | 新增保留记录文案与明确取消动作，无其他视觉基线替换 |
| T1/T4 `pnpm run check` | 最终36/36，16缓存；根2447P/20S，features666P、client88P、Web宿主36P、ui15P | 默认API/worker数据库集成仍门控；各包计数不相加成唯一总数 |
| T3/T4 `RUN_DATABASE_TESTS=true pnpm run test:e2e` | **345P / 7S，0F/0 flaky** | 新增实际ZIP/Hono/PG/S3的PC/移动恢复各1项及HTTP夹具恢复8项；全部现有三形态场景按门控执行，真实账号/中转站仍跳过 |
| 源码扫描 | `source --report tests/v25/.results/b52/source-security.json`退出0；1409文件/1归档，0命中/0错误 | 仅源码/配置，不等于新归档或各平台发布产物扫描 |

**首次失败与修复**：首轮check的两份新浏览器测试还需格式化，lint退出1并中断其他任务，伴随EPIPE不计作通过；修正后再次完整check。第二轮出现既有New API纯注入传输用例的取消断言失败：20ms墙钟在全仓并发负载下可能先于fetch微任务到期，测试不能保证进入所命名的“fetch忽略abort后迟到”场景。仅将两个纯模拟用例改为受控定时器/performance时钟，先断言fetch启动，再推进原20ms期限、验证不等待cancel和迟到body恰好取消一次；真实HTTP超时测试不改。传输专项50P，随后完整check通过。第一次扫描遗漏必需的`--report`，退出2；补实际参数后退出0，前一次不记扫描成功。

源码清单1502项，摘要`f0b3dc3fbcfd1eda916fa7bb1bfd2dfcf7510b2f020d9fd6e1e7366a2938c93d`；相对B51新增10、修改15、删除0，含两张预览基线及上述既有测试修复。命令起止/退出/日志保存在`tests/v25/.results/b52/`。源码门禁后没有继续修改产品；文档整理不当作新产品验证。

**未覆盖条件**：真实Better Auth登录、Desktop↔Web/Web↔Web全部方向、导出刷新恢复、自然期限与最大文件、Safari/原生文件管理器、Agent/worker试跑/正式化/独立新包扫描及原E均不由本批代替。B52不关闭G-CLOUD-05/06或整包，管理员尚未启动；接续任务见路线图§6.40与任务卡§5.1的F5-R.E。

**最终证据**：[统一报告](../../tests/v25/.results/b52/validation-summary.json)记录原样命令、起止时间、退出码、首次失败和真实/替身范围；[完整E2E](../../tests/v25/.results/b52/e2e-complete-report.json)、[逐例结果](../../tests/v25/.results/b52/e2e-cases.json)、[跳过清单](../../tests/v25/.results/b52/skipped-cases.json)、[源码清单](../../tests/v25/.results/b52/source-files.json)与[源码差异](../../tests/v25/.results/b52/source-delta.json)可以复核。完整E2E共352项，345P / 7S，0F/0 flaky；7项skip逐例保留原原因：3个真实账号、1个真实中转站、3个互斥视口，后者已核对对应项目实际通过，前四项仍须实际环境补验。计数不抵扣其他父卡未验条件。

PC/移动两张`recovered-import`截图已查看：记录状态、原回执动作、说明与关闭按钮可读，未见横向挤压；仅此前两张预览baseline按实际文案变化更新。真实ZIP浏览器证据分别存[PC报告](../../tests/v25/.results/b52/runtime-web-desktop.json)与[移动报告](../../tests/v25/.results/b52/runtime-web-mobile.json)，记录提交一次、刷新/第二页面只读恢复、草稿/资产与对象写次数不增加。没有把测试身份解析写成真实Better Auth登录，也没有新增产品范围之外的源码修改。

文档终验：23份文档、1052个相对链接目标均有效，围栏/3000行限制、git diff --check与源码零漂移检查通过；manifest守卫12P。迁移验收脚本为61/68任务、1项未勾选，退出1，整包仍未完成。结果存`tests/v25/.results/b52/documentation-validation.json`，不把阶段通过误记为整包验收。当前分支含未提交改动，摘要不是发布commit；无提交、推送、版本变更或生产部署。

### 5.47 B53：导出记录与刷新恢复（2026-09-09）

**结论**：导出恢复切片通过本机适用门禁；本人原归档分页/资格核对、共享历史入口、明确下载、关闭保留与独立取消已接。无新DDL或第二套归档状态机；正常新会话只能发现原记录，不能继承旧下载授权。行为见[专用包§15](./V25-PACKAGE-VALIDATION.md)、UI§8C/D41，后续见[路线图§6.41](./V25-MIGRATION-ROADMAP.md)。

| 阶段 / 实际命令 | 结果 | 证明范围与限制 |
|---|---|---|
| T1 contracts/client/API route/features定向 | 2P / 10P / 1P / 18P | 严格只读合同、私有字段拒绝、GET/缓存、明确恢复/取消、epoch及账号查询错误；组件使用fake gateway |
| T2 实际PG/HTTP/S3导出 | 首轮40P；增加新正常会话后导出与导入合跑75P，上传单独19P | 最终三个文件共94项（41导出+34导入+19上传）；含PG精度分页、未续租/未读写对象、在途、撤权/取消/过期/版本/删除及不同会话 |
| T3 第一轮生产浏览器专项 | 56项，53P/3F | 两个真实ZIP用例的下载次数过滤误计了导入PUT；一个移动列表视觉差异。完整原始报告保留 |
| T3 修复后的真实ZIP导出专项 | PC/移动2P，0F/0S | 真正导入/封面/正式化/归档服务，丢begin回包、reload/两页、明确下载与文件readback/hash/重新解析；身份解析及SQL成功trial仍是fixture |
| T0/T1/T4 `pnpm run check` | 最终36/36，31缓存；根2450P/20门控S、features673P、client89P、Web宿主36P、ui15P | 各包计数不能相加为唯一总数；默认API/worker数据库集成门控仍存在 |
| T3/T4 `RUN_DATABASE_TESTS=true pnpm run test:e2e` | **355P / 7S，0F/0 flaky** | 完整PC/移动/Electron，362项；真实账号/中转站等skip单列，不能外推生产可用 |
| T4 源码内容扫描 | 1416文件/1归档，0命中/0错误 | 当前源码/配置范围 |
| T4 新生成ZIP独立扫描 | 专项2份、完整E2E另2份实际文件分别扫描，均0命中/0错误 | 每份报告绑定对应真实bytes/hash，不能将专项归档身份替代完整运行生成的新文件；不等于各平台安装包扫描 |

最终1509源码文件，摘要`525b0f9a5e057dee1eb63ebc4d8d3c1138b58e8446a1f5ef8565fe05dc5895c4`；对B52新增7/修改17/删除0，包含唯一更新的移动`design-schemes-list.png`。先查看新旧图再更新1张基线、定向1P；PC/移动历史入口与恢复框截图已复核。完整源码冻结后未再修改产品。[统一报告](../../tests/v25/.results/b53/validation-summary.json)、[完整E2E](../../tests/v25/.results/b53/e2e-complete-report.json)、[逐例结果](../../tests/v25/.results/b53/e2e-cases.json)、[跳过清单](../../tests/v25/.results/b53/skipped-cases.json)、[源码清单](../../tests/v25/.results/b53/source-files.json)与[差异](../../tests/v25/.results/b53/source-delta.json)保留原样命令/起止/退出及报告关系。7个skip保留3个实际账号、1个真实中转站及3个互斥视口，已核对互斥视口对应项目实际通过。

**首败与修复**：真实ZIP已经交付成功，但新增断言用`endsWith('/content')`把前置导入的PUT算进下载，得到2次；修正为原export的精确GET路径，仍要求一次下载、一次begin、无DELETE和对象写入不增加，不能放宽成任意次数。移动“导出记录”动作使搜索与工具区分行，实际截图清晰且未横向溢出，按D41登记并只更新对应基线。交付成功后原恢复刷新动作已无用途，复核中一并隐藏，保留明确交付反馈。没有force click、调大超时或删除测试。

组合PG命令第一次误写一个不存在的upload文件筛选，实际仅匹配导出/导入两个文件75P；随后单独执行真实`design-scheme-packages.integration.test.ts`19P。前一次不能写成三文件全集；最终94项分别有对应命令报告。

**证据维护事件**：最初复制的runner仍写入B52目录，覆盖B52的recovery-contracts/client/features三份原始日志。已将本轮真实输出迁入B53并修正runner；B52原命令摘要从未受影响的汇总报告恢复，三份旧原始日志无法恢复，明确标记不可用，不伪造文件。B52完整check、E2E、PG、源码扫描和摘要报告均未受影响。记录见`tests/v25/.results/b53/evidence-maintenance-incident.json`及B52汇总报告的对应标记。

**未闭合**：真实Better Auth/实际外部账号、三个跨宿主方向、最大文件/自然TTL、Safari及原生文件选择器、实际Agent修改/更新与worker试跑→正式化→导出、完整数据/平台/安全/部署回滚与远程MCP仍按原父卡继续。SQL成功trial不是实际试跑；本批只收导出恢复切片，P01、G-CLOUD-05/06、整包和管理员前置仍开放。无提交/推送/版本变更/生产部署。文档终验：23份文档、1066个相对链接目标/围栏/行数检查无问题，manifest专项12P，diff空白检查通过、源码无漂移。任务包检查退出1：62/69项完成、验收清单仍有1项未勾选，符合整包未闭合事实；不能据此宣称全量验收通过。实际命令及输出见`tests/v25/.results/b53/documentation-validation.json`。

### 5.48 B54：真实登录与三方向 v2 方案包交换（2026-09-09）

**结论**：本机身份与文件往返切片通过；生产Better Auth/account hooks/Hono、隔离PG、实际Web/桌面文件IO已联合。行为及替身边界见[专用包§16](./V25-PACKAGE-VALIDATION.md)。Web图片显示仍缺宿主地址接线，不把包内图片字节正确等同于页面已经显示。

| 阶段 / 实际命令 | 结果 | 证明范围 |
|---|---|---|
| T2 `RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/package-exchange-auth.integration.test.ts src/__tests__/integration/api.integration.test.ts` | 原语料33P；最终不同图片语料再次33P，0S | 新增5个身份/Origin/撤权/会话条件与原API28项；上游New API为受控fixture，认证与授权装配是真实实现 |
| T3 初步三方向专项 | PC/移动Web2P，Electron双向1P | 实际导出ZIP落盘、读取、重新解析和再次导入；早期专项不是最终全量身份 |
| T0/T1/T4 原语料 `pnpm run check` | 36/36，30缓存 | 源码1518项，摘要见下方；默认数据库skip不算实际PG通过 |
| T3/T4 `RUN_DATABASE_TESTS=true pnpm run test:e2e` | **358P / 7S，0F/0 flaky**，365项 | PC/移动Chromium及Electron完整回归；对应原语料冻结源码 |
| T3 最终 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 package-exchange.spec.ts` | **3P，0F/0S/0 flaky** | 三种不同PNG颜色/尺寸/hash及Unicode名称；三个方向完整语义、归档与SQLite图片读回；仅测试语料和断言变化 |
| T0/T1/T4 最终 `pnpm run check` | 36/36，31缓存；根2450P/20门控S、features673P，包内计数不相加 | 最终源码完整检查；没有把早前全量E2E重命名为最终源码全量 |
| T4 源码及实际文件扫描 | 最终源码1426文件/1归档、全量生成6份ZIP、最终专项另6份ZIP，均0命中/0错误 | 每组6份含2份输入语料与4份实际导出；各自文件hash独立，不重复套用另一运行的归档身份 |

**源码与证据对应**：全量E2E使用1518文件摘要`81539ba8b979645e2960df7f24ff0697eb943bcd04a049e128dfc31455e912a6`。随后仅新增不同图片语料fixture，并修改其两个调用点及两端专项断言；最终1519文件摘要`5aae120bee8ec4b03fc42f5dd4367fe8475674673f67c7f9aa8e562b74b07d7e`。生产实现、UI、数据库迁移、依赖和视觉基线均未变。最终完整check、身份33项及三方向3项、源码/新ZIP扫描使用后一个摘要；全量保留前一个摘要。两组证据按各自适用范围并列，不宣称最终语料重跑了全部E2E。

[统一报告](../../tests/v25/.results/b54/validation-summary.json)、[全量报告](../../tests/v25/.results/b54/full-report.json)、[最终专项](../../tests/v25/.results/b54/final-corpus-report.json)、[跳过清单](../../tests/v25/.results/b54/full-skips.json)、[源码清单](../../tests/v25/.results/b54/source-files.json)与[语料差异](../../tests/v25/.results/b54/distinct-corpus-delta.json)保留原样命令/起止/退出及文件关系。7个skip逐项沿用并核对：3个实际账号、1个真实中转站、3个互斥视口；互斥视口对应项目实际通过。不是全部外部环境已验收。

**首败与修复**：auth首轮4P/1F，把包状态误写为Agent的confirmation-required，按canonical包合同改为ready；Web首次CLI参数误消费文件名，没有执行用例；Electron首次误用构造fixture的content，正式codec返回entries。check首次空fixture解构lint、第二次HTTP/HTTP2关闭能力收窄及unknown JSON合同解析失败，修复后通过。归档扫描首次target ID误含文件名中的点，被配置校验拒绝、未执行扫描；只修ID并对原文件重新扫描，首次命令/配置/退出码另存。最终check另一次被.results内语料草稿格式阻断；Biome会检查该草稿，只格式化草稿后重跑，已测源码未改。没有改服务状态、放宽文件一致性或删除用例。复核发现原语料三张图片相同，主动改为不同内容并复跑，防止映射交换被相同hash掩盖。

**限制与后续**：实际Better Auth cookie不等于生产New API活体账号；S3为回环协议服务。trial成功用SQL/本地repository资格fixture，封面/正式化仍由实际服务执行；不等于Agent/worker真实试跑。桌面采用既有E2E路径注入，不验证系统文件对话框；浏览器走实际下载fallback，不证明原生FSA。v1/畸形语料全方向、最大包/自然TTL、Safari/移动文件管理器、Web图片显示、完整Agent与试跑、各平台产物/生产回滚/远程MCP继续。下一步Web方案图片接线→F5-X剩余兼容/边界→D4异步Agent与F3/F4真实试跑联合，再按原E完成数据、四端及发布验收。整包未闭合，管理员未启动。 无提交、推送、版本修改或生产部署。

### 5.49 B55：Web方案图片与共享加载恢复（2026-09-09）

**结论**：F5-X.IMG本机切片通过。Web薄宿主注入canonical opaque资产ID对应的同源受保护地址；列表、Inspector、详情封面、相册和灯箱使用共享图片封装，复用FadeImage。失败可明确重试同一图片，换源清除旧错误，灯箱与当前资产集合关联，关闭后归还触发器或相册焦点；不触发新生成或归档写入。

| 阶段 / 实际命令 | 实际结果 | 证明范围 |
|---|---|---|
| T1 features首次定向、Web宿主定向 | 30P、19P | 首次图片4项与方案26项；地址10项与挂载9项。后续新增资产移除关闭灯箱单测，最终features全包678P |
| T3 Web方案及图片首次专项 | 20项，18P/2F | 原PC/移动方案各9项通过，新增两项在Escape后焦点归还失败；此前三图真实解码/像素/hash与灯箱已成功 |
| T3 `RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-images.spec.ts --project=web-desktop --project=web-mobile` | 修复后2P，0F/0S/0 flaky | 实际图片、翻图、灯箱/Escape焦点、列表/Inspector/详情；受控断网→错误→明确重试；他人404、退出401、重新登录恢复、删除404及reload页面失败态 |
| T3/T4 首次完整回归 | **359P/1F/7S，0 flaky**；[首次全量报告](../../tests/v25/.results/b55/full-first-report.json) | PC新用例在图片与焦点断言通过后，采集ready截图遇到URL重挂载导致旧相册节点脱离；修正采集后重跑，不记此轮通过 |
| T3/T4 第二轮完整回归（主动中止） | **219P/148S，退出130** | 人工截图发现错误图标穿透后停止；未运行/被中止项不记作正式环境skip，修复后另跑完整门禁 |
| T0/T1/T4 `pnpm run check` | **36/36，27缓存**；features678P、Web47P、根2450P/20门控S | 最终源码，默认数据库门控不算T2通过；包内统计不相加为唯一总数 |
| T3/T4 `RUN_DATABASE_TESTS=true pnpm run test:e2e` | **360P / 7S，0F/0 flaky**，367项 | 最终源码完整PC/移动Chromium与Electron；包含不同图片语料三方向交换回归和新图片用例 |
| T4 源码/实际ZIP独立扫描 | 源码1431文件/1归档；首次及最终全量各8份ZIP，中止轮另6份，均0命中/0错误 | 8份为交换回归2输入+4实际导出，新图片用例另2输入；分别绑定实际bytes/hash，未冒充平台安装包扫描 |

**源码与原始证据**：最终1524文件摘要`c291a6c8dc63ba62621d317770a60e6e40dd8f16781906f0d5af009e462dc6c7`，对B54新增5/修改6/删除0；完整check、完整E2E及源码扫描均对应此冻结源码。较早images-focus的2P专项早于两处微调：共享空态去除“本机”和对应单测断言；最终完整门禁覆盖这两处，不重标早前专项身份。首次全量源码摘要保存在source-before-capture-fix.json；之后修正新增用例的ready截图采集与重新解码确认，第二轮源码保存在source-before-error-surface-fix.json；再修复错误占位背景并添加不透明断言，最终全量绑定本文最终摘要。无视觉基线变更。[统一报告](../../tests/v25/.results/b55/validation-summary.json)、[全量报告](../../tests/v25/.results/b55/full-report.json)、[逐例](../../tests/v25/.results/b55/full-cases.json)、[skip](../../tests/v25/.results/b55/full-skips.json)、[源码](../../tests/v25/.results/b55/source-files.json)、[差异](../../tests/v25/.results/b55/source-delta.json)与[实际文件](../../tests/v25/.results/b55/full-files.json)保留原样命令、时间、退出码及关系。

**首败与修复**：首次两个新用例均暴露灯箱关闭后原按钮失焦，已保存触发器引用并显式归还；触发器被移除时回到相册区域。原焦点断言保留，没有force click、延长超时或重置截图。第二轮在Web图片用例通过后，人工截图发现后层错误图标透过前层叠到说明文字，已主动SIGINT中止并保留219P/148S的未完成报告；148项不记作正式环境skip。给失败占位加不透明背景，并加真实浏览器颜色alpha=255断言，专项和最终完整门禁重新执行。首次完整回归另发现URL-keyed页面重挂载使ready元素截图持有旧节点；改为采集页面视口并在截图后重新验证当前图片解码，保留所有原功能断言，最终专项和全量重跑。额外单测覆盖当前资产移除后关闭灯箱、恢复元数据不自动重开。中间root build只构建桌面，核对脚本后通过完整check重建Web才重跑专项，没有以旧Web构建报告通过。

**真实与替身**：真实Better Auth/account hooks/Hono、隔离PG、AWS SDK/S3协议、生产浏览器与实际PNG字节；上游New API账号与S3服务为本机受控fixture，trial成功由SQL资格fixture提供，网络失败由浏览器精确拦截注入。封面与正式化服务实际执行，但不是worker实际试跑。跨owner/登出/删除验收的是新的受保护读取和刷新后的失败态，不承诺服务端撤权会抹去另一未刷新页面已解码的像素。

**跳过及限制**：7项skip逐项与B54核对，3个实际账号、1个真实中转站、3个互斥视口；互斥视口对应项目实际通过。中止轮PC/移动六张ready/error/lightbox截图已复核，修复后同最终源码的两张错误截图再次确认；实际层级与限制登记[视觉记录](../../tests/v25/.results/b55/visual-review.json)。Safari、系统文件选择器/移动文件管理器、v1/负语料全集、最大包/自然TTL、实际Agent与worker联合、全平台安装包与生产回滚仍待。继续F5-X剩余兼容/环境边界、D4异步Agent共享产品与F3/F4真实试跑联合，再按原E完成可靠性、数据、四端及发布。整包未闭合，管理员未启动。 无提交、推送、版本修改或生产部署。

**文档终验**：23份文档、1091个相对链接目标及围栏/行数检查无问题；manifest专项12P，diff空白检查通过，最终源码无漂移。任务包检查退出1：64/71项完成，验收清单仍1项未勾选，符合整包未闭合事实；不把本批通过当作整个迁移验收通过。命令和输出见`tests/v25/.results/b55/documentation-validation.json`。

### 5.50 B56：异步Agent共享接缝与本人原执行发现（2026-09-09）

B56已复用七个异步Agent客户端入口并接入可选gateway，补严格入参/执行身份/事件校验；新增本人只读执行历史、不可变创建时间和稳定分页。共享恢复页面、创建授权及修改/更新尚待接入。 B56：合同19P、客户端51P、Agent真实PG20P；完整API集成482P、worker集成92P；完整check36/36（17缓存）。源码1532项摘要`6f6d0793a6cb8e113fb7ddd3ecbacd8b370ad436631dd130f9e587ac4f8b350d`，相对B55新增8/修改14/删除0，源码扫描1439文件/1归档零命中/错误。首败与范围见测试手册§5.50及tests/v25/.results/b56/validation-summary.json。仅关闭异步接缝/执行发现基础，共享恢复UI与D4-C/D/E、F3/F4、F5-X剩余及原E保持开放。

**验收覆盖**：API丢受理回包后找到原execution，重放原意图仍只有1会话/1初始事件/1队列任务；微秒相邻及同时间id排序、分页中任务更新/新增、跨owner/缺失/删除游标；过期列表不转状态/续租/确认/新增IO，原get才推进expired；受限/过期/非active身份和错误session-owner拒绝，新正常session只读发现；本人/他人/已删方案名称与私有输入隔离。创建时间迁移和重复执行见数据迁移§27。metadata投影用SQL夹具不能证明模型已完成草稿。

| 阶段 | 实际命令（根目录；日志名位于 `tests/v25/.results/b56`） | 结果 / 秒 |
|---|---|---|
| T0 | `pnpm --filter @musefold/db run db:generate`；`migration-generate.log` | 生成0022；0.763s |
| T1 | `pnpm --filter @musefold/contracts exec vitest run src/__tests__/design-scheme-agent-history.test.ts src/__tests__/design-scheme-agent.test.ts`；`contracts-second.log` | 19P；0.824s |
| T1 | `pnpm --filter @musefold/api-client exec vitest run src/__tests__/design-scheme-agent.test.ts src/__tests__/design-scheme-agent-gateway.test.ts src/__tests__/design-schemes.test.ts src/__tests__/gateway.test.ts`；`client-third.log` | 51P；0.877s |
| T2 | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-agent.integration.test.ts`；`agent-integration-second.log` | 20P，含真实CLI迁移两次；11.331s |
| T2 | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration`；`api-integration.log` | 482P / 26文件 / 0S；174.855s |
| T2 | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker run test:integration`；`worker-integration.log` | 92P / 9文件 / 0S；78.523s |
| 首败复验 | `pnpm --filter @musefold/api exec vitest run src/modules/design-scheme-packages/__tests__/import-content.test.ts`；`import-process-isolated.log` | 20P；1.396s |
| 首败复验 | `pnpm exec vitest run packages/core/src/db/repositories/__tests__/automation-spend-process.test.ts`；`spend-process-isolated.log` | 4P；2.266s |
| 统一门禁 | `pnpm run check`；`check-second.log` | 36/36，17缓存；52.130s |
| 内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b56/source-security.json`；`source-security.log` | 1439文件/1归档，0命中/错误；4.050s |

**首败全部保留**：合同/client首轮因对refined Zod对象调用pick而加载失败，改为引用原schema.shape字段；client第二轮50P/1F为新202夹具漏三项必需数组，补齐后51P。Agent首轮3P/16F：过期会话读取被Better Auth真实删除，旧测试仅UPDATE时间不能恢复其授权，导致后续401/超时；改为测试会话/授权upsert并在每例前隔离，20P重跑通过。check首轮只完成19/28任务，既有归档新Node进程及SQLite writer进程用例分别触发约5秒超时；受影响两文件独立复验20P/4P，然后完整check通过。未改生产超时、未删除/放松断言；高并发冷门禁下进程启动竞争是可能原因，不将推断当作已证明根因。

**真实与未验边界**：隔离PG17、Hono、Better Auth会话解析、Graphile及各测试标记的真实PID实际运行；上游账号/GitHub/S3/模型在相应测试中是受控夹具。完整check默认API481、worker92、db5和根20条件用例跳过，其中API/worker本批分别通过显式数据库整组命令实跑；不能将db5或根20自动记通过。没有新UI/桌面IPC/Playwright源码变更，本批未跑新完整Playwright，B55的360P/7S只归B55。真实共享页面reload/双页、外部付费模型、系统安装包、新发布文件及生产迁移/回滚仍待验。源码扫描包含既有归档夹具，不等于新发布包验收。

所有实际命令、起止时间、退出码、源码摘要与首败汇总见[本批报告](../../tests/v25/.results/b56/validation-summary.json)。下一步按任务卡§5.7.1完成恢复页面及独立授权，不关闭D4、F3/F4、G-CLOUD、P01或整包。

B56文档复核：23份文档、1100个本地链接目标无缺失；manifest守卫12P，diff空白检查通过，源码零漂移。父任务包65/72且仍有1项未勾验收，检查器按未完成返回1；任务数量不能换算功能完成百分比。原始结果见`tests/v25/.results/b56/documentation-validation.json`。

### 5.51 B57：共享创建授权、原任务恢复与页面协议验收（2026-09-09）

本节是B57结束时的历史快照；当时保留的实际创建合流已由§5.52 B58完成，不修改下述原始测试结果。

B57已接共享云端创建的独立文本授权、逐源确认、本人任务分页与原执行恢复；工作台只在completed后报草稿成功。页面协议已验，实际Agent服务产品合流、修改/更新及完整试跑链仍待。

B57：新增mapper/controller18项、连既有方案组件专项52P；新增PC/移动协议流程4P；完整check36/36，数据库条件完整E2E 364P / 7S，0F/0 flaky。源码1540项摘要`648602ad13b33b8f2aea55d00517ff0a564d00b1d73c5b7e4e7bfa1d3b297465`，相对B56新增8/修改7/删除0；源码扫描1447文件/1归档及本轮10份真实方案ZIP独立扫描均零命中/错误。实际命令、首败和限制见测试手册§5.51及tests/v25/.results/b57/validation-summary.json。B57的实际API/PG产品联合未完成，任务保持进行中；父卡、整包和管理员前置不关闭。

**源码范围与行为**：新增5份共享实现、3份测试文件，修改工作台/方案中心/市场意图接线及一张移动基线。仅消费现有可选agent gateway，无新PG迁移/API状态机。创建输入保留GitHub精确ref路径并去重；历史只传run/asset身份及includePrompt，不把预览URL或客户端prompt快照作为服务端素材。明确核对offer后才发原请求，冻结模型和来源数+1上限；单次输出8192来自报价。重复点击无并发start，显式重放仍为原id/原文本授权；历史查询不生成授权。事件核对id/操作/seq/version/游标，旧版本不覆盖新状态，账号变化或读取错误隐藏旧内容。关闭不是取消；工作台只在completed后清正文和报成功。

| 阶段 | 实际命令/报告（日志均在tests/v25/.results/b57） | 结果 |
|---|---|---|
| T1 定向 | `pnpm --filter @musefold/features exec vitest run src/design-schemes/__tests__/agent-flow.test.tsx src/design-schemes/__tests__/agent-presentation.test.ts src/design-schemes/__tests__/integration.test.tsx src/design-schemes/__tests__/design-schemes.test.tsx`；features-focused-second | 52P，含新增18项；2.947s |
| T3 协议页面 | browser-fifth-summary.json完整命令；所选两文件、双视口及grep参数见下方 | 新增4P及PC列表1P；移动列表1F为基线变化，见下文 |
| T3 单张基线 | `pnpm exec playwright test -c tests/v25 web.design-schemes.spec.ts --project web-mobile --grep '壳导航注册' --update-snapshots`；mobile-baseline | 1P；仅更新已复核移动列表图；1.960s |
| 统一门禁 | `pnpm run check`；check-final | 36/36；24.596s |
| 数据库条件完整E2E | `env RUN_DATABASE_TESTS=true pnpm run test:e2e`；full-e2e、full-e2e-report.json | 364P / 7S，0F/0 flaky；1105.149s |
| 本轮方案归档扫描 | `node scripts/security/scan.mjs plan --plan tests/v25/.results/b57/full-scan-plan.json --report tests/v25/.results/b57/full-package-security.json`；full-package-security | 10份实际ZIP，0命中/错误；0.367s |
| 源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b57/source-security.json`；source-scan-second | 1447文件/1归档，0命中/错误；0.641s |

浏览器专项实际命令（历史首败复验，完整回归另见上表）：

```bash
pnpm exec playwright test -c tests/v25 web.scheme-agent.spec.ts web.design-schemes.spec.ts --project web-desktop --project web-mobile --grep 'explicit cloud|workbench reports|壳导航注册'
```

**阶段流程与真实边界**：本批T0保护工作树并记录源摘要；T1 mapper/controller和既有功能回归；T3新页面使用真实生产共享UI与api-client，但账号、来源、文本和草稿HTTP为确定性夹具。完整数据库条件E2E继续包含已有真实PG/Better Auth/Worker/进程用例，各用例上游与存储替身仍按原定义；不因此认定新增Agent页面已完成实际PG联调。T2新Agent创建产品链、T4最终四端产物及T5生产均未完成。B56实际API482P/worker92P仅为历史，本批未复跑这两组全集。

**跳过与产物范围**：完整E2E的7项skip与B55一致：3个实际账号用例缺显式live环境，1个实际中转站用例缺专用key，3个互斥视口用例在对应项目执行通过；逐项理由保存在full-e2e-skips.json。完整check根2479P/20S、features696P、client97P；默认API320P/481S、worker77P/92S、db40P/5S不自动升级成数据库整组通过。full-e2e-artifacts中共12份方案文件，10份为实际ZIP并逐份按hash入扫描清单；另2份是已有HTTP下载交付测试的非ZIP字节夹具，未冒充真实归档。扫描本轮生成文件不代表发布安装包已验。

**首次失败与修复**：首次source typecheck发现commitHash可空，改为明确缺失显示；首次组件47P/5F是断言早于TanStack异步通知，改waitFor等待实际错误状态，保留原拒绝断言。第二次typecheck及第一次check因Testing Library误用Playwright的exact参数失败，去掉不支持的测试参数；check-first只完成29/35，不计通过，后续完整check通过。浏览器first因账号夹具缺必填字段正确停在登录提示，主动中止130（runner未生成summary，保留部分report/log）；second被自身残留next-server占用端口拒绝，核实PID89631后仅终止该测试进程。third4F因夹具sourceLabel默认空值无法再次解析，补实际来源标签；fourth2P/2F是草稿详情断言用了不存在文案，改断言真实draft属性和等待试运行。两轮截图批检发现移动面板无左右留白，修正16px留白与标题关闭按钮空间并增加几何断言；fifth四条新流程通过，移动列表因新增44px任务按钮改变高度，仅复核更新一张基线。首次扫描误写不存在脚本退出1，保留失败后按仓库真实scan.mjs入口执行。

**视觉证据**：四张最终PC/移动授权/来源截图位于browser-fifth-artifacts；检测器单次3目标无命中。独立终审为`ship`，范围限新Dialog/Sheet四张截图，未声称整应用或实际付费模型验收；[终审记录](../../tests/v25/.results/b57/finish-review.md)。移动主体可滚动，底部说明和关闭/取消保持可见。

**未关闭范围与后续**：B57保留实际API/PG共享创建联合验收，按[任务卡§5.7.2](./V25-MIGRATION-GOALS.md)继续；修改/更新及真实Agent→worker试跑→封面→正式化→导出、F5-X和原E不缩减。管理员依赖全部迁移完成。无提交/推送/版本变化/打包/生产部署。完整命令时间、源码身份、首败、skip和限制见[本批报告](../../tests/v25/.results/b57/validation-summary.json)。

**文档终验**：23份文档、1108个本地链接目标及围栏/行数检查无问题；manifest专项12P，diff空白检查通过，1540份冻结源码零漂移。父任务包65/73、验收清单仍1项未勾选，检查器按未完成返回1；任务数量不换算功能完成百分比。原始命令和输出见`tests/v25/.results/b57/documentation-validation.json`。

### 5.52 B58：实际 Agent 与共享创建页面合流（2026-09-09）

**当前验收状态**：新增PC/移动真实服务专项14P，实际API关联集成71P，最终check36/36已通过；固定源码的完整数据库条件E2E 378P / 7S，0F/0 flaky；B57/B58创建与恢复验收闭合，父卡继续。源码1545项摘要`4ad6c44b0517c78df78854e500f13c0d5ee3429e1414510389505e145a758e52`，相对B57新增5/修改3/删除0。本批不改变共享UI或视觉基线。

**实际装配**：生产`createApp`增加可选Agent服务注入，与既有services装配方式一致；默认仍构造原服务，认证、正常账号检查、限流和路由均保留。隔离设施复用原方案包测试的真实Better Auth、账号凭据委托和加密存储、Hono、PG17及全部迁移、AWS SDK；新增实际Graphile Agent消费者与文本HTTP。New API账号、文本模型、GitHub和S3服务为本机受控上游，生产中没有增加测试旁路环境变量。消费者与API位于同一测试进程，不称为正式worker bin或独立进程重启验收。

| 场景（各PC/移动1例，共14例） | 实际操作与必须成立的结果 |
|---|---|
| 纯描述创建 | offer之前/独立授权之前无付费调用；原execution最终只产生1份草稿、1次compiler调用 |
| 两GitHub来源 | 真实读取冻结SHA和许可证文件，逐个确认；全部确认前模型POST为0，最终2次analyst+1次compiler，授权上限3；不把全局offer17当成授权 |
| 丢受理响应/关闭/双页 | 先让真实POST返回202且已落PG，再只丢回包；关闭、刷新、新页从本人历史找到原执行。重放原请求不新建任务/草稿，不增加模型发现、来源IO或调用；原queue job身份不变 |
| 确认来源前取消 | 第二页明确取消，原页核对同一cancelled状态，来源确认入口消失，零模型调用/零草稿 |
| 他人访问及在途撤权 | 第二账号历史为空、读原execution返回404；原账号已发送模型时撤权，旧任务内容隐藏，模型迟到结果不能落草稿 |
| 历史素材 | 经实际历史选择器选择本人已有PNG、明确携带提示词意图，完成后草稿资产hash与历史图一致，正文仅completed后清空，hasSuccessfulTrial仍false |
| 已发送取消/未知结果 | 已发送后取消或模型上游断开，关闭/reload/刷新仍只有原1次发送；零新草稿，费用保持unknown，不自动重试。两种情形各独立1例/视口 |

表内丢响应/双页是前两种创建用例共同步骤；已发送取消与未知结果各自独立，因此合计7例×2视口。历史记录与4×3 PNG是预置的SQL/S3历史材料，用来验证真实owner解析、图片读取/复制和草稿合流；不能据此认定“Agent→生图worker实际试跑”通过。未使用SQL给新方案补成功trial资格。

| 阶段 | 实际命令（根目录；日志位于tests/v25/.results/b58） | 本次结果 |
|---|---|---|
| T2装配与回归 | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-browser.integration.test.ts src/__tests__/integration/package-exchange-auth.integration.test.ts src/__tests__/integration/design-scheme-agent.integration.test.ts src/__tests__/integration/design-scheme-text.integration.test.ts src/__tests__/integration/design-scheme-history.integration.test.ts`；api-joint-final | 5文件71P；13.397秒 |
| T3新增真实页面 | `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-agent-runtime.spec.ts --project web-desktop --project web-mobile`；browser-seventh | 14P；124.903秒；该专项之后只新增本轮截图采集及集成测试JSON类型守卫，完整回归验证最终源码 |
| 统一门禁 | `pnpm run check`；check-final-second | 36/36；10.914秒 |
| T3完整回归 | `env RUN_DATABASE_TESTS=true pnpm run test:e2e`；full-e2e | 378P / 7S，0F/0 flaky；1208.238秒 |
| 源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b58/source-security-final.json`；source-security-final | 1452文件/1既有归档，0命中/错误；1.127秒 |
| 本轮产物扫描 | `node scripts/security/scan.mjs plan --plan tests/v25/.results/b58/full-scan-plan.json --report tests/v25/.results/b58/full-package-security.json`；full-package-security | 10份实际ZIP，0命中/错误；0.116秒 |

**首败与修复**：首次typecheck暴露测试授权回调被推断为字面量type predicate和ServerType含HTTP2差异，显式boolean签名及属性守卫后通过。首次装配1F/浏览器6F是新增快照SQL直接使用保留字authorization，改为`t.authorization`。浏览器second2P/4F为测试误把user-brief排除于来源、误以移动默认分支SPDX代表冻结commit；改按GitHub来源类型计数并断言真实“未声明”，源码本来已保留license字节而不推断SPDX。

third3P/7F包括测试结束时页面轮询尚未排空、服务先关闭导致socket hang up；先页面导航离场、等待所有转发回调结束，再关服务。该轮错误地同时执行check构建，Next产物被重建后6个后续页面未水合；固定构建并串行浏览器后消失，此为已记录的环境诊断，不指认为生产缺陷。错误栈含临时合成BA cookie的4份证据只脱敏cookie值，保留失败路径/堆栈，未使用真实凭据。

fourth/fifth各8P/2F来自历史夹具错误使用登录名邮箱、随后又错误把AccountSummary.id当本地principal；当前身份的email由principal派生，AccountSummary.id为上游付款账号。改从实际Better Auth会话解析user.id用于隔离夹具。history-sixth2F为点击导航后过早读取query，改等真实详情出现再读取。seventh14P；最后check首次33/36失败于新login.json返回unknown，增加运行时字段检查而非断言强转，最终check通过。各轮日志、报告和截图分别保存，详情见`first-failures.json`，不删首败、不调宽生产超时、不放松安全断言。

**视觉与范围**：最终完整回归采集8张实际来源/草稿/历史图片视图，已逐张目检；来源面板、待验证草稿与参考材料可见，未改基线。历史草稿图包含瞬时成功toast且只覆盖采集视口，不作为完整页面几何认证；4×3合成图被现有相册放大不代表产品生成画质。既有Musefold创建来源文案有重复展示，属非阻断的存量呈现，不影响身份、授权或草稿状态。逐图hash与观察见`tests/v25/.results/b58/visual-review.json`。

**下一步**：按[任务卡§5.7.3](./V25-MIGRATION-GOALS.md)接modify的冻结版本/独立1次授权，再接check-update/authorizeUpdate及真实图像worker联合。B58不覆盖实际收费上游、完整图像试跑/封面/转正/包链、正式Agent进程重启、全平台安装包、生产与全部原E；管理员仍等待整包。无提交、推送、版本修改或生产操作。

**完整回归边界**：完整报告共385项，7项跳过逐条保存在`full-e2e-skips.json`；3个实际账号、1个实际中转站缺显式live条件，3个互斥视口用例在对应项目实跑。check根2479P/20S、features696P、client97P，默认API320P/482S、worker77P/92S、db40P/5S；本批71项API实际数据库集成是所选五文件，不能称为API/worker整组复跑。完整产物12份方案文件，其中10份实际ZIP按hash独立扫描，其余2份为原HTTP交付字节夹具。源扫描与本批ZIP不替代发布安装包扫描。实际命令、时间、首败和源码身份见[本批报告](../../tests/v25/.results/b58/validation-summary.json)。

**文档终验**：23份文档、1119个本地链接目标及围栏/行数无问题；manifest守卫12P，diff空白检查通过，1545项冻结源码零漂移。父任务包67/74且仍1项验收未勾，检查器按尚未完成返回1；不把任务数量换算功能完成百分比。原始输出见`tests/v25/.results/b58/documentation-validation.json`。

### 5.53 B59：共享云端修改、版本依据与独立文本授权（2026-09-10）

B59组件专项83P、实际API三文件28P、PC/移动真实服务专项12P；完整check36/36（31缓存），最终数据库条件完整E2E **390P / 7S，0F/0 flaky**（1296.018秒）。最终源码1546项摘要`6f9aa0a1cc8821f29f92c5392ab6ae698b8b719b3f2c1f5df8f66f6dbc8f164f`，相对B58新增1/修改16/删除0；源码1453文件/1既有归档，以及本轮22份实际ZIP扫描均零命中/错误。

**源码及生产范围**：HEAD仍为`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`加原dirty工作树；本批没有提交、推送、版本修改、新DDL或生产部署。实现位于共享features：附件保存同次读取的version；mapper严格解析canonical modify；创建/恢复控制器扩展modify；Dialog/Sheet显示独立一次调用授权；工作台接入onModify且仅completed清空正文。原Desktop本地回调与后端业务协议保留，不新建会话/费用服务。最终check/E2E及扫描使用[冻结源码](../../tests/v25/.results/b59/source-files.json)，[增量](../../tests/v25/.results/b59/source-delta.json)可追溯。

| 新增场景（每个PC/移动各1，共12例） | 实际行为与验收结果 |
|---|---|
| 成功、丢202与连续修改 | 实际导入基底→详情→工作台→独立1次授权；授权前关闭保留描述且零会话/调用。实际202已落PG后丢回包，关闭/reload/两页恢复与原请求重放保持唯一执行/queue job及调用数。新版本parent/全部资产正确、原正式revision不变；打开待验证版本后二次修改使用其精确revision和新version，各自只授权1次Reviser |
| 提交前版本变化 | 进入授权面后用实际HTTP改名产生新version；原修改拒绝且提示“本次修改未提交”，0次文本调用/0会话；不自动换依据或重放，关闭保留描述及服务器新名称 |
| 已发送后版本变化 | 模型在途时实际修改方案版本，迟到结果blocked、不写新draft、不覆盖当前正式版；刷新不增加调用 |
| 已发送后取消 | 实际独立确认取消，原执行cancelled；费用unknown仍保留、零新draft，恢复只读、不重新发送 |
| 已发送后撤权 | 实际账号授权撤销，旧页面内容隐藏；迟到模型不能提交新draft，原正式版保持 |
| 上游响应未知 | 文本HTTP断开，原执行blocked且cost unknown；关闭/reload/刷新仍1次发送、零新draft、保留修改描述 |

成功场景另在最终完整回归中明确点击“更新正式版本”：新revision未成功试跑时实际服务拒绝，原正式revision不变。**这是不能继承旧试跑资格的负例，不是新版本成功试跑/转正的正向证据。** 六类场景的真实断言见[浏览器用例](../../tests/v25/web.scheme-modify-runtime.spec.ts)。

**真实与替身边界**：共享页面/api-client、Better Auth实际登录与账号委托/密文凭据、Hono、PG17/迁移、Graphile Agent消费者、AWS SDK和文本HTTP为真实调用链。New API账号、文本模型、GitHub及S3上游为本机受控服务；Agent消费者运行在隔离fixture进程内。每例先通过真实导入入口导入合成多图既有方案，只有这个**既有基底**用fixture历史trial加实际HTTP封面/正式化准备为正式版；任何新Agent修改结果均未用SQL写trial资格。不能把测试基底准备称为真实新版本图像worker成功。

| 阶段 | 实际命令（根目录；报告目录tests/v25/.results/b59） | 本次结果 |
|---|---|---|
| T1共享组件与状态 | `pnpm --filter @musefold/features exec vitest run src/design-schemes/__tests__/agent-flow.test.tsx src/design-schemes/__tests__/agent-presentation.test.ts src/design-schemes/__tests__/integration-store.test.ts src/design-schemes/__tests__/integration.test.tsx src/workbench/__tests__/workbench-schemes.test.tsx src/workbench/__tests__/composer-scheme.test.tsx`；features-second | 6文件83P；3.178秒；含新增11项 |
| T2实际服务 | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-modify.integration.test.ts src/__tests__/integration/agent-browser.integration.test.ts src/__tests__/integration/package-exchange-auth.integration.test.ts`；api-first | 3文件28P / 0S；14.907秒 |
| T3新增真实页面 | `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-modify-runtime.spec.ts --project web-desktop --project web-mobile`；browser-first | 12P / 0S / 0F；106.529秒；此后只追加测试转正拒绝断言和测试类型守卫，生产实现相同，最终全量覆盖最终测试 |
| 统一门禁 | `pnpm run check`；check-final | 36/36，31缓存；23.724秒。根2485P/20S，features707P，client97P；默认API320P/482S、worker77P/92S、db40P/5S |
| T3完整回归 | `env RUN_DATABASE_TESTS=true pnpm run test:e2e`；full-e2e | 390P / 7S，0F/0 flaky；1296.018秒；含新增12例及新版本转正拒绝断言 |
| 源码内容扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b59/source-security.json`；source-scan | 1453文件/1既有归档，0命中/错误；0.718秒 |
| 本轮实际归档扫描 | `node scripts/security/scan.mjs plan --plan tests/v25/.results/b59/full-scan-plan.json --report tests/v25/.results/b59/full-package-security.json`；full-package-security | 22份实际ZIP，0命中/错误；0.175秒 |

**第一次失败与修复**：typecheck-first退出1，是既有测试六处附件缺少新增必需expectedVersion，给当前/working-draft各自补正确fixture版本，没有弱化必需字段。features-first为75P/1F，新增断言使用了本仓库未装的jest-dom matcher；改为既有Vitest的文本及元素存在断言后83P。check-first已36/36，追加转正拒绝与测试类型守卫后check-final再次36/36。新浏览器专项首轮12P，最终全量未修改基线/放宽生产超时或删用例。命令时间/退出码及原日志分别保留于[首次失败](../../tests/v25/.results/b59/first-failures.json)和[统一报告](../../tests/v25/.results/b59/validation-summary.json)。

**完整回归的适用性**：报告397项，其中390通过、7跳过、0失败/不稳定。7项逐条保存于[跳过清单](../../tests/v25/.results/b59/full-e2e-skips.json)：3个实际账号及1个实际中转站缺显式live条件；3个互斥视口用例在对应项目已运行。所选API28项不是API/worker全部数据库集成重跑，默认check中的门控skip不能算通过。本轮归档共24份，其中12份为修改用例的合成既有方案输入ZIP，另外10份是既有跨宿主导出/交换ZIP，其余2份为HTTP交付字节夹具；不能称为22份新版本正式导出。旧正式基底通过fixture历史trial及实际封面/正式化HTTP准备，新Agent版本未用SQL补试跑资格。实际收费上游、正式Agent进程重启、真实新版本出图全链、全部GC/迁移/文件环境/各平台包/生产与回滚仍待。

**视觉证据**：[四截图与代码审查](../../tests/v25/.results/b59/finish-review.md) disposition `ship`，仅覆盖B59局部扩展；授权图为Dialog/Sheet正文裁剪，结果图为既有详情视口。移动为高DPR截图，不构成全页面几何、计算对比度、实际焦点/动效或失败/取消截图认证。detector只执行一轮且结果`[]`；无新上线图像或视觉baseline变更。UI规范§8A/§10.2及documenter记录已同步。截图来源/hash和范围见[视觉记录](../../tests/v25/.results/b59/visual-review.json)。

**下一步及完成口径**：只关闭B59 D4-D1/D2修改切片；按[任务卡§5.7.4](./V25-MIGRATION-GOALS.md)接免费check-update/逐源采用、expectedSessionVersion独立授权，再接D4-J真generation worker出图联合。F5-X、原E、G-CLOUD/P01、整包与管理员前置保持开放，不以测试数量估迁移百分比。

**文档终验**：23份文档、1140个本地链接目标及围栏/行数检查无问题；manifest守卫12P，diff空白检查通过，1546项冻结源码零漂移。父任务包68/75且仍1项验收未勾，检查器按未完成返回1；这些数量不代表功能完成百分比。原始输出见`tests/v25/.results/b59/documentation-validation.json`。

### 5.54 B60：免费上游检查、逐源采用与独立更新授权（2026-09-10）

B60初期组件专项91P（最终check含恢复回归后features716P）、实际API三文件45P、PC/移动真实服务专项18P；完整check36/36，最终数据库条件完整E2E **408P / 7S，0F/0 flaky**（1625.283秒）。最终源码1547项摘要`33ae75cbe64bd849c7d7e378086afc23914f71dcbef95d42d91efa202b4e063b`，相对B59新增1/修改8/删除0；源码1454文件/1既有归档及本轮22份实际ZIP扫描均零命中/错误。

**实现及身份**：以原dirty工作树为基础，HEAD仍为`dcdf8d036c27f87e33de301ad4077a3110bb5b7f`。共享详情根据可选Agent能力进入既有Dialog/Sheet，冻结同一次详情读取的方案version和revision；控制器把免费check-update与后续付费authorizeUpdate分开保存、分开恢复。无新DDL、生产后端服务、业务账本、版本修改、提交、推送或部署。生产改动、测试改动及其哈希见[源码清单](../../tests/v25/.results/b60/source-files.json)和[相对B59增量](../../tests/v25/.results/b60/source-delta.json)。

| 验收场景（PC/移动各9例，共18例） | 结果及明确断言 |
|---|---|
| 没有GitHub来源 | 用户明确发起免费检查；终态可从历史恢复；不展示付费入口，不增加模型发现、调用或授权，原文档不变 |
| 来源没有变化 | 对固定版本完成免费检查；同样零新增模型调用/授权，原文档不变 |
| 单源变化的完整更新 | 基底由真实Agent从两个来源创建并实际选择两张图片；仅design来源变化，先逐源确认，再单独核对模型与费用；变化来源数1意味着最多2次模型调用（Analyst+Compiler） |
| 丢回复、关窗、双页和重载（纳入成功例） | 免费start的实际202回包丢失后核实原执行；恢复后清除过期错误。两页恢复及原免费请求重放不增加来源I/O；确认来源/查看offer后关闭仍零新增文本调用。付费授权的实际200回包丢失后用原版本/原payload重放，不增加队列、调用或来源I/O |
| 来源采用前取消 | 独立取消确认生效；零新增付费授权/模型调用；原方案文档不变 |
| 发送后方案版本变化 | 模型在途时真实HTTP改名使版本变化；迟到结果不能覆盖新状态或写新revision |
| 付费发送后取消 | 取消后的迟到结果不能提交；已发送费用保持unknown，刷新/恢复不再发送 |
| 付费发送后撤权 | 实际撤销账号授权后隐藏旧会话，迟到模型不能写结果 |
| 上游响应未知 | 模型连接断开后原执行blocked/费用unknown；不重发不确定调用、不写新版本 |
| 免费提交前版本竞争 | 打开检查面板后真实HTTP改名；冻结旧版本的请求被拒绝并提示“本次检查未提交”，不会暗中换依据/发起新执行 |

**成功的边界**：最终仍是`draft`，`hasSuccessfulTrial=false`，新revision的parent等于原revision。未变化layout的snapshot与图片引用完全保留，变化design采用已确认commit及新内容hash，实际执行恰为一个Analyst和一个Compiler。B60新用例没有用SQL写入试跑/正式资格；不能把保存新草稿视为成功出图或正式化。详情结果文案按实际scheme.status区分待验证草稿与保留旧正式版的新版本。

**组件状态验收**：免费start不携带text；从历史恢复authorization-required后需要重新明确获取offer；offer绑定读取时session.version，版本变化拒绝代批；原付费请求重放保留原expectedSessionVersion；切换账号拒绝迟到状态。新增自动恢复回归使用异步get返回权威状态，证明无需人工刷新或再次写入即可清除旧错误；同版本普通轮询仍保留错误。

| 阶段 | 实际命令（根目录）及报告名 | 本次结果 |
|---|---|---|
| T1初期组件 | `pnpm --filter @musefold/features exec vitest run src/design-schemes/__tests__/agent-flow.test.tsx src/design-schemes/__tests__/agent-presentation.test.ts src/design-schemes/__tests__/integration-store.test.ts src/design-schemes/__tests__/integration.test.tsx src/workbench/__tests__/workbench-schemes.test.tsx src/workbench/__tests__/composer-scheme.test.tsx`；features-first | 6文件91P，3.306秒；此后追加自动恢复回归由最终check覆盖，不能把该初期命令称为92P |
| T2实际API | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/design-scheme-update.integration.test.ts src/__tests__/integration/agent-browser.integration.test.ts src/__tests__/integration/design-scheme-modify.integration.test.ts`；api-final | 3文件45P，15.472秒；最后UI恢复修复前运行，API/fixture此后未改变；包含既有Agent进程用例的限定范围 |
| 统一门禁 | `pnpm run check`；check-frozen-final | 36/36，31.081秒；features716P、根2485P/20S、client97P；默认API320P/482S、worker77P/92S、db40P/5S |
| T3最终更新专项 | `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-update-runtime.spec.ts --project web-desktop --project web-mobile`；browser-recovery-final | 18P/0S/0F，302.578秒；绑定最终源码，六张截图来自此轮 |
| T3全部双端回归 | `env RUN_DATABASE_TESTS=true pnpm run test:e2e`；full-e2e | 408P/7S，0F/0 flaky，1625.283秒；包含Electron及PC/移动既有回归 |
| 最终源码扫描 | `node scripts/security/scan.mjs source --report tests/v25/.results/b60/source-security-frozen-final.json`；source-frozen-final | 1454文件/1既有归档，0命中/错误，0.792秒 |
| 本轮实际归档扫描 | `node scripts/security/scan.mjs plan --plan tests/v25/.results/b60/full-scan-plan.json --report tests/v25/.results/b60/full-package-security.json`；full-package-security | 22份ZIP，0命中/错误，0.165秒 |

命令起止时间、退出码与对应日志见[统一报告](../../tests/v25/.results/b60/validation-summary.json)。`api-final`和早期组件/浏览器证据按各自源码阶段保留；最后恢复修复后的check、专项、全量和扫描才绑定最终manifest，不能混称“生产源码从首轮起未变”。

**首次失败及处理**：

1. typecheck-first：新断言使用Testing Library不支持的`exact`选项，去掉该选项，字符串name匹配保留。
2. browser-first：13P/3F。两例误认为authorize-update响应为202，按实际协议改为200；免费start仍202。一例在隔离后端启动120秒超时，尚未进入产品取消操作；保留原超时，修正异常情况下的fixture释放和模型hold退出竞态。仅清理经进程身份核实的两条孤儿测试进程。
3. browser-second：16P/2F。受控Analyst未选择仓库图片，实际流水线按规则未采纳图片；补明确style-reference选择及基底两张图片断言，保留原图片保护断言。
4. browser-third：17P/1F。PC未知结果用例的账号status GET在route.fetch处ECONNRESET，报告未到产品状态断言失败；同一代码/场景原样重跑两个视口2P（39.371秒）。错误日志仅脱敏短期测试会话cookie值，保留方法、路径、错误与堆栈。
5. 六截图首轮复核发现原执行恢复后仍显示旧错误；修复为首次有效状态或新版本到达时清除，增加自动恢复回归，并修正草稿/已有正式版措辞。截图等待临时toast消失，未放宽产品超时、修改视觉基线或删除场景。最终源码专项和全量另验。

[首败记录](../../tests/v25/.results/b60/first-failures.json)保留前三轮失败和具体修复；早期通过不能覆盖后续修改的验收要求。

**真实依赖与跳过**：真实共享UI/api-client、Better Auth登录/账号委托/密文凭据、Hono、PG17/迁移、Graphile Agent消费者、AWS SDK和文本HTTP；New API账号、GitHub、文本模型与S3为本机受控上游。消费者在隔离fixture进程中运行，不代表全部生产进程生命周期。完整报告415项中7跳过详见[逐条清单](../../tests/v25/.results/b60/full-e2e-skips.json)：3实际账号和1实际中转站缺live条件，3互斥视口用例在对应项目运行。所选45项API不是API/worker全部数据库集成重跑，默认check门控skip不能算通过。

B60新用例的基底由真实Agent创建，未用SQL制造试跑/正式资格；账号上游、GitHub、文本模型与S3为本机受控服务。全量归档24份：12份B59修改用例的合成既有基底输入ZIP、10份既有跨宿主导出/交换ZIP、2份HTTP交付字节夹具；它们不证明新方案已经通过生图试跑并正式导出。真实收费上游、完整新版本出图链、全部生命周期/各平台包及生产回滚继续待验。

**视觉记录**：[独立六截图与代码评审](../../tests/v25/.results/b60/finish-review.md) disposition `ship`，仅覆盖本轮共享更新扩展。 六图分别为PC/移动来源确认、费用授权和结果；前两类是Dialog/Sheet正文裁剪，结果是既有详情视口，移动为高DPR。不能据此认证整页几何、实际焦点/动效或计算对比度。detector仅一轮且`[]`；无新增上线图像/视觉baseline。截图原件/hash及评审范围见[视觉记录](../../tests/v25/.results/b60/visual-review.json)，UI规范§8A/§10.2与documenter按最终实现同步。

**下一步与阶段流程**：按[任务卡§5.7.5](./V25-MIGRATION-GOALS.md)依次完成D4-J0真实generation worker共用夹具→J1三形态新方案真实试跑→J2封面/正式化→J3新版本独立试跑/promote→J4实际包跨端交付→J5失败矩阵。每阶段先跑新增API/worker集成、再跑真实页面专项，变更完成后统一check/E2E/扫描并登记源码身份；未运行项目保持待执行。F5-X、原E和全部父卡继续开放，管理员尚未进入实施。

**B60文档终验**：本地文档链接目标、围栏及行数检查通过；manifest守卫12P，diff空白检查通过，1547项冻结源码零漂移。父任务包69/76，仍1项验收未勾，检查器按未完成返回1；不把该数量当作功能完成百分比。原始输出见[文档校验](../../tests/v25/.results/b60/documentation-validation.json)。

<!-- B61:START -->
### 5.55 B61：真实新方案试跑、连续版本与专用包联合（进行中）

B61进行中：新增取消前后、上游unknown和丢受理回包联合回归，实际API3P及PC/移动8P。真实generation worker已接入；纯描述、GitHub和历史素材三形态在PC/移动Web完成新方案出图、封面、正式化和实际方案包往返，GitHub还完成修改与上游更新后的独立新试跑/新封面/promote。修复新版本加载时Agent进度窗口重建，以及原生云端历史素材导出缺失完整内容。

新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。

**证据层级**：实际共享页面/api-client、Better Auth及账号委托、Hono、PG17/迁移、Graphile Agent消费者、独立`apps/worker/src/bin.ts`进程和AWS SDK。仅New API账号、文本/图像HTTP、GitHub与S3为受控上游；返回真实PNG并核对输入/输出字节hash。历史生图记录只是预置来源材料；新方案试跑、封面及正式化均走实际产品操作，不调用seedTrial、不用SQL写成功资格。新建/文本/图像分别计数，图像费用不继承文本授权。

| 阶段 | 实际命令及报告 | 结果 |
|---|---|---|
| T1生命周期 | `pnpm --filter @musefold/features exec vitest run src/design-schemes/__tests__/detail-agent-lifecycle.test.tsx`；ui-regression-third | 1P，1.314秒；新revision加载/失败不重建原Agent观察者 |
| T1历史内容 | `pnpm --filter @musefold/api exec vitest run src/modules/design-scheme-packages/__tests__/export-history-content.test.ts`；export-regression-second | 3P，1.207秒；全文与图片真实归档读回、篡改拒绝 |
| T2实际API | `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation.integration.test.ts src/__tests__/integration/design-scheme-package-export.integration.test.ts`；api-joint-export | 42P，50.194秒；此后仅测试变化，业务/API实现/fixture未变 |
| 统一检查 | `pnpm run check`；check-final-stage | 36/36，24.623秒；默认数据库门控skip不算已跑集成 |
| T3三形态与连续升级 | `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile`；browser-sixth | 6P/0S/0F/0 flaky，120.974秒；同一新结果导出/重新导入，Github两轮新trial/promote |
| T3完整回归 | `env RUN_DATABASE_TESTS=true pnpm run test:e2e`；full-e2e-stage | 414P/7S/0F/0 flaky，1755.771秒；PC133P/2S，移动132P/3S，Electron149P/2S。对应1554项正向阶段源码；扩展测试后的全套未重跑 |
| T4源码 | `node scripts/security/scan.mjs source --report tests/v25/.results/b61/source-security.json` | 0命中/错误，0.730秒 |
| T4阶段实际归档 | `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/stage-scan-plan.json --report tests/v25/.results/b61/stage-package-security.json` | 16份实际ZIP，0命中/错误，0.197秒；包含各历史重跑留存，最终专项产生6份，不能称16个独立业务场景 |

完整命令、起止UTC、源码身份与范围见[阶段统一报告](../../tests/v25/.results/b61/validation-summary.json)。源码清单[正向阶段1554项](../../tests/v25/.results/b61/source-full-e2e.json)对应最终专项与check；后续如改变源码需重新冻结，不把先前通过自动绑定新源码。

**J5故障增量的执行流程与结果（全量之后，仅新增两个测试文件）**

| 层级/命令 | 场景和关键断言 | 实际结果 |
|---|---|---|
| T2 `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-faults.integration.test.ts` | 实际新Agent草稿→prepare/run；发送前取消0图像POST，发送后取消/上游断连各1POST；队列确认处理完并SIGTERM退出后查资产/资格；同execution重放仍一份run；发送后费用未知保持null | api-faults-first：3P，13.444秒 |
| T3 `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts --project web-desktop --project web-mobile` | 每次从真实Agent创建开始，PC/移动各4场景：取消前/后、unknown、实际受理但丢POST回包；原请求/事件executionId、revision、双账本和图像调用次数一致；输入保留，刷新与详情再读不重发 | browser-faults-third：8P/0S/0F/0 flaky，78.449秒 |
| 统一检查 `pnpm run check` | 新测试解析唯一cancel契约，默认DB门控跳过不能替代上一行实际运行 | check-faults-focus-final：36/36，6.683秒 |
| T4 `node scripts/security/scan.mjs source --report tests/v25/.results/b61/source-faults-focus-security.json` | 当前源码扫描 | 0命中/错误，0.701秒 |
| T4 `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/full-classified-scan-plan.json --report tests/v25/.results/b61/full-package-security-classified.json` | 全量留存28个真实ZIP、2份纯文本UI下载替身；当前故障用例不产生新归档 | 0命中/错误，0.182秒 |

**状态口径**：发送后取消的API回包确认取消请求已记录，generation先是cancelling，scheme仍可executing；释放受控上游后收敛cancelled，不接纳迟到成功输出。unknown明确GENERATION_UPSTREAM_UNKNOWN、retryable=false、recoveryAction=none，无成功trial。丢失受理回包时，真实后台可完成一次试跑并获得trial资格，但方案仍为draft；页面错误不抹去实际成功，也不自动重新发图或正式化。恢复原任务的验证包括API重放、浏览器原事件再读、刷新和详情，不冒充完整详情查询故障恢复/跨会话凭据撤销/进程崩溃矩阵。

**新增测试首次失败**：check-faults-first因cancel JSON为unknown不能直接读status，改用canonical schema解析后通过。browser-faults-first 6P/2F错误地在释放held响应前等待终态，改核对cancelling后再收敛，未更改生产状态机。browser-faults-second 6P/2F在PC unknown、移动lost-acceptance提交前超时，现场主题为空、正文已填、按钮禁用且无图像任务；源码可见进入方案Composer后rAF聚焦正文，测试未等待该动作。增加可观察的初始聚焦完成、两字段值及按钮可用断言后第三轮8P。焦点抢占是结合源码/现场的诊断，未记录浏览器逐事件时序，不能说已证明额外的生产字段清空缺陷；没有重填循环、定时sleep或放宽180秒超时。

**全量与源码对应**：414P/7S全量属于[source-full-e2e.json](../../tests/v25/.results/b61/source-full-e2e.json)的1554项；PC133P/2S、移动132P/3S、Electron149P/2S。7项skip为4项缺活体账号/真实中转站凭据，以及3项不适用视口，未计作真实外部服务或平台验证。之后仅新增API故障与浏览器故障两个测试文件；该故障阶段[1556项源码](../../tests/v25/.results/b61/source-faults-final.json)摘要`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，与全量快照的[差异清单](../../tests/v25/.results/b61/fault-source-delta.json)没有业务、fixture、原测试或构建变更。当前check、故障3P/8P与扫描按各自报告登记；扩展后的整套E2E尚未重新执行。

**归档扫描首次失败**：原计划把30份同扩展名文件都当ZIP，0命中但2解析错误。核对`web.design-scheme-package-export.spec.ts:13`，两份都是26字节`complete-export-ui-fixture`，不是真实产品归档。保存[原文件/字节/哈希分类](../../tests/v25/.results/b61/full-marker-classification.json)，按28ZIP+两份字节完全一致的纯文本副本复扫通过；未改扫描规则、豁免异常或删除原失败报告。截至正向专项保留的16份ZIP也已独立扫描通过。测试数据的重复导出数量不等于独立业务覆盖数。

**首次失败与修复**（原日志均保留）：

1. API请求漏掉必需的promptReferenceSelections导致400，补明确空数组后实际链1P；第二次同样失败因缩进特定补丁未应用，未称修复后通过。初期check扫描到归档draft.ts格式错误，将准备稿保留为.ts.txt，不改lint范围。
2. browser-first0P/6F为点击后抢读路由；等待详情挂载。browser-second2P/4F为模型只声明文本输入且未选择运行参考图；声明image-set并通过现有文件选择入口提交真实素材，未自动注入资产。
3. browser-third2P/4F：S3 fixture GET错误地统一octet-stream，worker严格拒绝PNG元数据不符；保留PUT Content-Type。历史资产为cloud-run/example，不按reference或非cloud-run误筛，明确选初始草稿已有材料。
4. 两轮material专项各0P/2F定位产品缺口：更新实际completed后，working revision加载态卸载观察者；原生云历史来源文件缺第二个blob且无excerpt。分别修复观察者生命周期、读取冻结历史图片/完整提示词；仍校验size/hash/MIME，不回读可变原历史。
5. 新回归首次失败仅fixture缺promptProgram、误把fixture对象当ZIP、Radix点击时序；补合法合同数据/encode/await userEvent后1P+3P，API typecheck通过。
6. browser-fourth退出130：1P/1F/1中断/3未跑，报告将后四项归入skipped；GitHub实际两次trial/promote后被旧封面规则拒绝导出，历史任务尚未产出保存文件即由已核对PID的SIGINT终止，原因未完整确定，不计通过。原测试进程全部清理。补选本revision确切输出为封面；后续历史单独1P，不把它说成中断轮通过。
7. browser-fifth4P/2F：设封面后立即promote使用旧版本，CAS正确拒绝。等待服务器确认封面后再升级；最终browser-sixth6P。导出只比较获准revision资产，不将详情的旧版全部资产误当应导出的内容。没有删除旧封面负例、放宽CAS或加自动付费重试。

详见[首败记录](../../tests/v25/.results/b61/first-failures.json)。最终六张详情截图已作一轮集中检查：[视觉记录](../../tests/v25/.results/b61/visual-review.json)。图像为受控24×16纯色PNG，移动高DPR、详情视口裁剪并包含临时成功toast；只证明既有布局与对应像素显示，不是新视觉基线、完整焦点/对比度/动效或外部生图质量认证。

**阶段结论与剩余任务**：历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 按[任务卡§5.7.6](./V25-MIGRATION-GOALS.md)继续同一新结果跨宿主与J5逐项故障注入；每项先做实际API/worker双账本验证，再补PC/移动真实操作，最后冻结代码执行统一门禁并独立扫描每份本轮新归档。B61保持未勾，69/77是任务计数，不是迁移完成百分比。
<!-- B61:J4 START -->
**J4-b同一真实新结果跨宿主（2026-09-10最新增量）**

B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。

| 步骤 | 操作与必须成立的验收 | 当前结果 |
|---|---|---|
| 1 云端新结果 | 实际Agent创建三形态草稿→独立图像授权/prepare/run→真实generation bin→本版输出/封面/正式化；GitHub再分别modify与update后独立新trial/promote | 三形态通过；图像HTTP共1/3/1次，材料型明确选择原素材字节，文本授权不借给图像 |
| 2 Web实际导出→桌面导入 | 下载实际ZIP，经桌面原生路径注入入口导入；全新ID/草稿/无trial/parent=null；正文、来源及全部资产逐项核对 | 三形态通过；只读SQLite查新revision的run为空，无SQL授予资格 |
| 3 桌面独立试跑 | 主进程安全存储BYOK配置、新PID加载模型目录；工作台实际IPC/core生图，材料型明确选择本地来源文件；核对model/endpoint/input hash/一次HTTP | 各1次实际本地图像请求；scheme trial completed、core run success、generated asset available；素材字节与受管hash一致 |
| 4 新封面/正式化/重启 | 用本次local-run图片为封面→正式化→关进程→新PID读取原SQLite→实际文件导出 | 三形态通过；document、正式状态、trial资格、确切封面持久化；导出保留获准正文与元数据 |
| 5 桌面包→另一Web账号 | Mobile Chromium视口从实际Desktop ZIP导入；身份、revision、来源/图片ID重新映射 | 三形态通过；新草稿不继承trial，来源/全文/素材hash一致；导入没有新增文本或图像调用 |

生产修复位于`apps/desktop/electron/main/design-scheme/share.ts`：已有接纳MIME优先，仅缺失的legacy文本行按路径推断。原GitHub README.md声明text/plain，导入正确但重新导出被改为text/markdown；新单测先红（1F/20未选），修复后完整分享套件21P。未放宽包校验、图片嗅探、内容hash或版本资格。

测试比较仅归一合同允许的同一时间ISO/epoch毫秒与可空repositoryUrl的缺省值；保留MIME/正文/hash严格比较。相册切图先等待界面显示本次资产总数，再选择确切新输出；没有对失效点击反复重试、延长超时或修改相册生产代码。

| 测试/命令 | 实际结果与报告 |
|---|---|
| `pnpm exec vitest run apps/desktop/electron/main/design-scheme/__tests__/share.test.ts` | crosshost-mime-green：21P，1.678秒；红例及其源变化保留 |
| `pnpm run check` | check-crosshost-third：36/36，24.711秒；已重新构建桌面修复 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 electron.scheme-trial-exchange.spec.ts --project electron` | crosshost-third：3P/0S/0F/0 flaky，83.409秒；[逐例执行/版本/字节证据](../../tests/v25/.results/b61/crosshost-cases.json) |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 '(electron\..*|web\.(scheme-trial-runtime|package-exchange))\.spec\.ts'` | 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/crosshost-source-security.json` | 零命中/错误，0.706秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/crosshost-scan-plan.json --report tests/v25/.results/b61/crosshost-package-security.json` | 留存三轮13份真实ZIP均有效，零命中/错误，0.125秒；最终三形态6份，不等于13个独立业务场景 |

**首败保留**：crosshost-first 0P/3F（72.368秒）停在云包成功导入后的编译时间表示比较；按canonical同一时刻比较后第二轮0P/3F（76.896秒）：brief实际桌面trial已完成，但相册尚未刷新就点击下一张；GitHub完成桌面试跑/重启/导出后发现MIME被覆盖；history发现无repositoryUrl时undefined/null比较差异。分别等待可观察资产总数、修复实际导出MIME、归一可空来源字段后第三轮3P。第一项是结合界面缓存与后续通过的时序诊断，未声称完整逐事件证明；全部原报告/产物保留。

**源码与证据**：最终1559项摘要`907a4f3d39388c217932ebc8fe85186bf93bb0d2ef21ca8e19e8c913cafff20a`，相对故障阶段新增3测试/helper、修改4文件、删除0；见[固定源码](../../tests/v25/.results/b61/source-crosshost-final.json)、[差异](../../tests/v25/.results/b61/crosshost-source-delta.json)、[实际文件hash](../../tests/v25/.results/b61/crosshost-files.json)。旧414P/7S全量和3P/8P故障专项仍分别绑定原1554/1556项，不能直接当作此修复后的完整Web回归。新增Web helper为既有创建流程抽取，packageMeaning亦影响旧交换测试，因此在本轮受影响回归中复验。

**真实/替身与剩余**：真实BA/Hono/PG/Graphile/bin、Electron IPC/core/SQLite/文件及独立进程；账号/文本/图像/GitHub/S3上游受控，图像为24×16 PNG。原生文件选择仍是既有路径注入，手机网页为Chromium移动视口；无系统picker取消、Safari/移动文件管理器、Windows或已安装发行包证据。正常重启不等于异常worker恢复或自然租约到期。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。
<!-- B61:J4-REGRESSION -->
**最终受影响回归与扫描（03:54:41 UTC完成）**：完整Electron **152P/2S**，PC网页4P、移动网页4P，合计**160P/2S/0F/0 flaky**，1004.633秒；三类新增跨宿主用例在该完整桌面回归再次通过。两项跳过分别是`electron.live-account.spec.ts`缺`MUSEFOLD_LIVE_E2E=1/MUSEFOLD_E2E_PASSWORD`，以及`electron.sync.spec.ts`真实TvT连接缺`MUSEFOLD_E2E_IMAGE_API_KEY`；需相应实际环境另验，不能计作外部服务通过。[逐例与跳过](../../tests/v25/.results/b61/crosshost-regression-result.json)、[完整原报告](../../tests/v25/.results/b61/crosshost-regression-report.json)。网页范围仅旧package-exchange与原三形态trial-runtime，未重跑所有Web用例；旧414P/7S全量仍保留原源码身份。

`node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/crosshost-regression-scan-plan.json --report tests/v25/.results/b61/crosshost-regression-package-security.json`扫描本次回归留存18份真实ZIP，退出0、零命中/错误（0.147秒）；其中12份来自真实新trial导出（Web正向6、跨端6），6份来自既有交换夹具（含2份输入ZIP）。不把既有夹具的资格当作新方案资格；新增J4用例始终实际试跑。此前专项/首败留存13份ZIP另已扫描，两个文件集合与hash分别登记。[本轮文件](../../tests/v25/.results/b61/crosshost-regression-files.json)。最后源码核对1559项、摘要907a4f3d…、drift=[]；回归期间只补文档和独立API临时诊断，没有修改产品、测试或构建输入。

<!-- B61:J4 END -->
<!-- B61:AUTHORITY-READ START -->
**J5授权与读取故障固化（2026-09-10最新）**

B61新增正式回归：授权失效/真实登出发送前后及版本冲突API6P（25.606秒）；PC/移动故障专项12P/0S/0F/0 flaky（127.780秒），含原取消/unknown/丢回包8项与新增事件/任务读取失败、详情错误态及显式重试4项。check36/36（33.404秒，30缓存），源码扫描零命中/错误。

| 场景/验收 | 实际结果与限制 |
|---|---|
| recovery_only模式/授权revision变化，发送前与发送后各一例 | 实际新Agent草稿→prepare/run→generation bin；既有fixture仅注入授权失效。发送前0图像/双run failed/无资产；发送后保留唯一已授权调用的实际成功输出，仍draft；旧会话请求403。此为授权表注入，不等同上游撤key |
| 实际Better Auth登出，发送前与发送后各一例 | `/api/auth/sign-out`200，旧Cookie详情/重放401；前后分别0/1图像调用；清空队列、bin退出0后查持久账本与资产。使用新登录会话读取原owner的原document/trial与原execution事件，不产生新图像调用 |
| select-cover/formalize各一例版本冲突 | 从实际新trial开始，真实rename递增summary.version；旧expectedVersion409，保留draft、trial、最新summary.name及完整不可变document；显式使用当前版本才能成功。实际API串行控制两个客户端的CAS次序，尚非浏览器双页或working-draft promote组合 |
| events GET503 / run GET503，PC与移动各一例 | 已受理任务的GET各失败1次，页面显示提交错误且原主题/正文保留；释放真实已发送HTTP后后台完成原任务，仍draft。随后详情GET保持503，经框架自动GET重试仍显示错误（各记录2次失败GET），点击界面“重试”后恢复。原execution/run/events、双账本/新资产及仅1次图像请求可查；没有重复POST |
| 原取消前/后、unknown、丢受理回包 | 原双视口8项包含在本轮12项中复验；同一请求/费用未知/资格边界保持，无删除旧断言 |

| 阶段与原样命令 | 结果 |
|---|---|
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-authority.integration.test.ts` | api-authority-second：6P，25.606秒；含重新登录后的真实详情与原执行事件验证 |
| `pnpm run check` | check-authority-read：36/36，30缓存，33.404秒；默认数据库门控skip不代替上行实际API运行 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts --project web-desktop --project web-mobile` | browser-read-first：12P/0S/0F/0 flaky，127.780秒；PC6+移动6；[原报告](../../tests/v25/.results/b61/browser-read-first-report.json)、[逐例注入次数/执行/账本](../../tests/v25/.results/b61/authority-read-cases.json) |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/authority-read-source-security.json` | 零命中/错误，0.806秒；本轮不生成新的方案ZIP，未把旧31份归档重算为新扫描 |

**首次失败与修复**：api-authority-first 4P/2F（23.373秒），两个登出用例在重新登录后读详情返回401。独立实际BA诊断确认signin响应依次删除session_token/session_data/dont_remember，再设置新的同名session_token；新测试helper把空的旧值和新值串在同一Cookie头，服务端取旧值。按浏览器规则读取每条Set-Cookie并执行删除/同名替换后同一诊断200、完整6P。[去敏诊断](../../tests/v25/.results/b61/authority-cookie-diagnostic.json)只记录Cookie名与长度，不保存token值。只修测试Cookie处理，未清掉负例中的旧会话、绕过401/403、放宽登录验证或修改生产认证。

**源码身份/适用范围**：最终1561项摘要`0cde8ba71fae30ee8466b63f02e160e15fbae51ab2846ee379197d1edbeb5871`；相对1559仅新增API实际试跑客户端helper、授权集成测试，并扩展原web.scheme-trial-faults测试。没有产品/构建/迁移变化。[固定清单](../../tests/v25/.results/b61/source-authority-read-final.json)、[三路径差异](../../tests/v25/.results/b61/authority-read-source-delta.json)。首次失败清单另存source-authority-before-cookie-fix.json（摘要3946f19e…）。旧完整Electron152P/2S及受影响Web8P仍绑定1559，旧414P/7S全量仍绑定1554；本轮不冒称又执行过全套。相同生产字节与新增6P/12P/check/扫描分别登记于[统一报告](../../tests/v25/.results/b61/validation-summary.json)。

前述六项临时API诊断现已固化为本轮六项实际回归，并加强新登录读取；临时原报告继续保留历史身份，不另加成12项API测试。当前当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。 全部迁移完成后才启动与现有Next.js/Hono/contracts/PG兼容的管理员端。

<!-- B61:AUTHORITY-READ END -->
<!-- B61:PROCESS-NATURAL START -->
**J5-d实际进程与自然租约（2026-09-10）**

B61新增实际进程3项已验：领取前强杀后新PID一次成功；发送后强杀/暂停经生产10分钟租约自然到期与分钟巡检收敛unknown，图像请求仍各1次；旧暂停进程恢复后终态/回执不变、无新增资产。API完整集成496P、Worker完整集成92P，网页故障专项12P；最终check及源码扫描通过。

实际Better Auth/Hono、隔离PostgreSQL、Graphile及生产bin；外部模型/GitHub/S3为本地HTTP协议fixture。每例从实际新Agent草稿和显式run开始，不写SQL授予trial、不修改租约或强制解锁/注入队列。只信号控制fixture所属PID，系统状态确认SIGSTOP。此次macOS无跳过，Windows明确跳过这些POSIX信号用例，不能扩称Windows或部署容器通过。

| 场景 | 已验事实及限制 |
|---|---|
| queued领取前强杀 | epoch0/0图像；旧PID退出SIGKILL，新PID只领取原任务，1次请求/1组输出，原draft获得真实trial但不自动正式化；正常关闭后队列为空 |
| 发送后强杀 | epoch1/claimed，实际10分钟lease到期后生产分钟cron恢复failed/GENERATION_UPSTREAM_UNKNOWN，费用null且不可自动重试；1次图像、0资产/0成功trial，原execution重放同一run。旧Graphile job仍有dead-worker锁，但key清空、attempts耗尽，新恢复job完成；不证明4小时旧锁清除 |
| 发送后暂停/恢复 | 暂停heartbeat，另一PID自然到期后裁决unknown；向暂停连接放行原响应，再SIGCONT，等待旧job退队并正常关闭。原run/receipt逐字段不变，无新对象；生产HTTP120秒超时可能先终止请求，所以不把此例当作已解码迟到图片或S3上传补偿证明 |
| 自然时间证据 | 每2秒只读观察，到期前状态/deadline变化会被保存为失败，不会被poll后续成功掩盖；finishedAt不早于deadline，attempt_count仍1。UTC/PID/原记录见[逐例证据](../../tests/v25/.results/b61/process-natural-cases.json) |

| 原样命令 | 结果 |
|---|---|
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-process.integration.test.ts --reporter=verbose --reporter=json --outputFile=../../tests/v25/.results/b61/api-process-natural-first.json` | api-process-natural-first：退出0，648.913秒 |
| `pnpm --filter @musefold/api typecheck` | process-typecheck-second：退出0，1.577秒 |
| `pnpm --filter @musefold/api typecheck` | process-context-typecheck：退出1，1.670秒 |
| `pnpm --filter @musefold/api typecheck` | process-context-typecheck-second：退出0，1.518秒 |
| `pnpm run check` | check-process-context：退出1，4.331秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-process-full.json` | api-process-full：退出1，682.831秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --exclude '**/agent-generation-process.integration.test.ts' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-process-rerun.json` | api-process-rerun：退出0，154.233秒 |
| `pnpm --filter @musefold/worker run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-process-full.json` | worker-process-full：退出0，33.531秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts --project web-desktop --project web-mobile` | browser-process-regression：退出0，128.714秒 |
| `pnpm run check` | check-process-context-final：退出0，13.495秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/process-context-source-security.json` | process-context-source-security：退出0，1.602秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-process-context-full.json` | api-process-context-full：退出0，647.763秒 |

**首败与修复**：初次专项3P（648.913秒）但类型检查发现Vitest链声明顺序问题；改为it.skipIf(...).concurrent.each后类型检查/check通过。完整API首次489P/7F/0S：6项为授权用例默认5000ms超时；另1项暂停用例在自然恢复之后使用全局expect.poll，另一并发用例结束导致上下文丢失，后续断言中断，不能算通过。将授权测试时限显式设为120000ms，保留内部20秒轮询及全部401/403/409、账本和调用断言；重跑其余完整API（仅排除当时仍在运行的自然进程文件；该轮随后记录了上述断言上下文失败）493P/0F/0S。随后修复并发断言：每例使用自己的test-context expect，并传给暂停/实际Agent客户端helper；it.each传递context的初次改法被类型检查拒绝，改为两个具名并发test。最终重新运行完整API496P/0F/0S，包含全部3项实际进程场景；原失败及中间493P报告保留。[首次失败登记](../../tests/v25/.results/b61/first-failures.json)。

**源码身份**：最终1562项摘要`498cb19c1f77130331993d544c12417d1b45ccdb85a612125c315524a1349322`，[交付清单](../../tests/v25/.results/b61/source-process-delivery-final.json)；相对1561新增1进程测试、修改3个共用fixture及1个授权测试时限，[差异](../../tests/v25/.results/b61/process-natural-source-delta.json)。最终完整API/进程、check及源码扫描绑定上述最终清单；Worker92项/网页12项仍绑定`8a1262e2ca9aef8f93722293ebf554ff0f4dcd4bd369cd956187b9a476b36357`，它们执行的生产代码、测试及fixture字节未变，后续只修API测试时限与并发断言helper。未在运行期间构建或修改生产依赖。无生产代码、迁移、UI、安装包或新方案ZIP变化；本轮未重跑完整Electron/全部网页，未复用旧归档假称新扫描。统一报告新增processNaturalSlice，历史结果保留各自身份。

自然领取后未发送的epoch替换、取消交错、迟到上传/新引用保护、J5-e与F5-X/原E、平台包/生产回滚仍待；管理员前置保持开放。 父任务69/77不变。

<!-- B61:PROCESS-NATURAL END -->
<!-- B61:ASSETS-EPOCH START -->
**J5-d/e资产与自然租约（2026-09-10运行，2026-09-12回填）**

B61新增7项资产/进程联合已验：参考图篡改或删除时零图像发送；实际10分钟租约后未发送任务由新PID以epoch2成功，取消交错与迟到PUT隔离；写入后删除失败保留对象并跨新PID等待实际5分钟退避再清理。完整API503P、Worker92P，网页正向与故障18P；check36/36及源码、6份实际新方案ZIP扫描通过。

| 场景 | 实际结果与验收范围 |
|---|---|
| 参考图篡改/删除（2项） | 实际登录、新Agent草稿、multipart上传201、prepare/run受理后损坏/删除对象，再启动正式generation bin；epoch1，0图像请求、1文本请求，failed/not_started/cost0，不产生资产或trial，原revision不变。这里的零发送是图像，创建草稿所需的已授权文本调用确实发生 |
| GET读取被暂停 | 实际SIGSTOP后新PID不提前接管，10分钟原租约自然到期才epoch2成功，1次images/edits且参考hash一致；放行旧GET再SIGCONT，旧任务退队且不能改变新结果/回执/图片，维护不删除引用对象 |
| GET读取与取消 | 原PID暂停后通过真实cancel路由取消，运行先cancelling；自然恢复为cancelled，epoch1/0图像/cost0，无trial，原参考对象仍保留 |
| PUT写入后迟到，含取消（2项） | 图像已调用且对象已写入，只扣住HTTP200响应；新PID在自然租约到期裁决failed/unknown、epoch1/费用null。放行旧PUT再恢复旧PID，原run/receipt/detail不变，清理意图到期后删除精确孤立对象；共1次图像，无假trial |
| 删除失败与自然退避 | S3完整写入后返回403（不是断线），实际维护收到HTTP200内逐对象Error，队列attempt1/S3DeleteObjectsError且对象不丢；换新PID后提前维护不绕过next_attempt_at，等待真实5分钟再清理，最终对象/队列空，原失败回执不变 |

每例从实际Better Auth/Hono、隔离PG和Graphile、正式`apps/worker/src/bin.ts`运行；模型与S3是本地HTTP协议fixture，未用SQL制造成功trial或改租约期限。所有信号只控制自建PID。GET/PUT四例原deadline为05:40:34.384/.403/.397/.424 UTC，恢复均不早于deadline；退避deadline05:35:34.642 UTC，05:35:35.376清理完成。逐例PID、租约、epoch、hash、对象及回执见[7项证据](../../tests/v25/.results/b61/assets-epoch-cases.json)。对象维护由测试显式向Graphile加入正式maintenance/cleanup任务；它验证真实维护实现，不冒称自然小时cron触发。POSIX暂停场景本机无skip，Windows尚未验证。

| 原样命令 | 结果 |
|---|---|
| `pnpm --filter @musefold/api typecheck` | assets-fixture-typecheck：退出0，3.078秒 |
| `pnpm --filter @musefold/api typecheck` | assets-typecheck-first：退出1，1.493秒 |
| `pnpm --filter @musefold/api typecheck` | assets-typecheck-second：退出0，1.578秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-assets.integration.test.ts -t 'a reference (tamper|delete)' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-reference-first.json` | assets-reference-first：退出1，8.693秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-assets.integration.test.ts -t 'a reference (tamper|delete)' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-reference-second.json` | assets-reference-second：退出0，9.347秒 |
| `pnpm --filter @musefold/api typecheck` | assets-cancel-typecheck：退出0，1.489秒 |
| `pnpm run check` | check-assets-cancel：退出0，14.576秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-assets-full.json` | api-assets-full：退出0，666.679秒 |
| `pnpm --filter @musefold/worker run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-assets-full.json` | worker-assets-full：退出0，33.543秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | browser-assets-regression：退出0，241.511秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/assets-source-security.json` | assets-source-security：退出0，1.535秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/assets-browser-scan-plan.json --report tests/v25/.results/b61/assets-browser-package-security.json` | assets-browser-package-security：退出0，0.098秒 |

**首败**：类型检查发现Buffer与空数组联合类型，改显式缺失guard；首次参考图用例2F/404来自新测试helper误用路由，改真实挂载`/api/v1/reference-images`后2P/3S（当时5项，3项由名称过滤未运行）；补2项取消后最终7项均包含在完整API503P/0F/0S中。首次失败不删除，见[first-failures](../../tests/v25/.results/b61/first-failures.json)。

**源码和产物**：此阶段1563项摘要`354f94939f70d0d8deccb703a2f14c1954ef780a0cbf9d1341df7ea8b88ff4b0`，[不可变快照](../../tests/v25/.results/b61/source-assets-epoch-final.json)。相对上一阶段新增1资产集成测试、修改3个fixture，无生产/DB/schema/UI改动；[源码差异](../../tests/v25/.results/b61/assets-epoch-source-delta.json)。API503P（666.679秒）、Worker92P（33.543秒）、网页18P/0S/0F/0flaky（241.511秒），check36/36（31缓存，14.576秒）均对应此阶段源码。网页仅PC/移动正向6项+故障12项，未重跑全部Web/Electron；正向由真实新Agent试跑、封面正式化导出，未seedTrial。生成的[6份实际新ZIP与hash](../../tests/v25/.results/b61/assets-browser-files.json)全部独立扫描0命中/错误。此前414P/7S和160P/2S各自历史源码身份保持，不改称本轮完整E2E。

PG输出落库/丢提交回包、cleanup与新引用竞争、J5其余/F5-X/原E及全平台/生产回滚仍待；本片未证明S3连接断开，完整迁移与管理员前置保持开放。 统一报告新增assetEpochSlice；后续断线增量单独登记，父任务仍69/77、B61不勾选。

<!-- B61:ASSETS-EPOCH END -->
<!-- B61:ASSETS-WIRE START -->
**J5-e实际S3连接中断（2026-09-12）**

B61补齐2项真实S3回包断线测试：写成后首次断线由SDK同key重传成功；持续断线后原任务保留unknown费用，新PID维护删除孤立对象。两例各1次图像调用，成功资产跨重启/维护保留，失败不产生trial。最终完整API505P、Worker92P，check36/36及源码扫描通过。

S3协议fixture接收并保存完整对象后直接`response.destroy()`，不发送HTTP状态或错误body；正式generation bin使用原AWS SDK重试策略，未替换task list或S3客户端。一次断线重试同一个key后成功；持续断线在SDK重试耗尽后失败。每例均实际Better Auth→新Agent草稿→prepare/run→正式bin，再停止旧进程、启动新PID、重放同一execution并运行实际维护。不SQL伪造trial、改租约、改费用或换key发起第二次生图。模型/S3仍是本地受控HTTP服务；这里只证明本机进程和协议处理，不宣称外部存储供应商可用性。

| 场景 | 原/新PID | 实际PUT/断线次数 | 图像调用 | 维护后对象数 |
|---|---|---|---|---|
| lost-put-once | 69588→69608 | 2 / 1 | 1 | 1 |
| lost-put-always | 69807→69862 | 3 / 3 | 1 | 0 |

单次断线：generation succeeded、方案run completed、epoch1，1份资产和真实trial；SDK多次PUT共享同一对象key，重启、重放与维护后图片hash不变、无清理队列。持续断线：generation/方案run均failed，receipt claimed/unknown/costnull；保留generation_compensation意图，newPID实际maintenance删除精确孤立key，原失败回执/方案不改、无trial。两例既检查真实generation.design_scheme_run_id关联，又检查独立实体ID及状态，不能将方案runId混同生图任务id。[完整9项逐例证据](../../tests/v25/.results/b61/assets-wire-cases.json)含本轮重跑的前7项自然时间场景。

| 原样命令 | 结果 |
|---|---|
| `pnpm --filter @musefold/api run typecheck` | assets-wire-typecheck：退出0，3.037秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-assets.integration.test.ts -t 'lost S3 PUT response' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-wire-first.json` | assets-wire-first：退出1，10.398秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-assets.integration.test.ts -t 'lost S3 PUT response' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-wire-second.json` | assets-wire-second：退出0，11.152秒 |
| `pnpm run check` | check-assets-wire：退出0，13.873秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-assets-wire-full.json` | api-assets-wire-full：退出0，712.996秒 |
| `pnpm --filter @musefold/worker run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-assets-wire-full.json` | worker-assets-wire-full：退出0，62.362秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/assets-wire-source-security.json` | assets-wire-source-security：退出0，2.216秒 |

**首败与修复**：首次专项2F/7S（10.398秒），新断言错误地把方案执行ID当作generation id；源码本来使用两实体及外键。修正为明确跨表关联并区分completed/succeeded后，第二次2P/7S（11.152秒）；7S均为名称过滤，不是本机平台失败跳过。最终完整API505P/0F/0S（712.996秒）包含全部9项资产和原3项自然进程场景；未修改生产业务绕过断言，见[first-failures](../../tests/v25/.results/b61/first-failures.json)。

**当前源码**：1563项摘要`67674ff103f04e78bc29d19072a6b7660f4d06270c5c17008f3c704dc1692062`，[快照](../../tests/v25/.results/b61/source-assets-wire-final.json)及[差异](../../tests/v25/.results/b61/assets-wire-source-delta.json)；相对354f仅改3个API测试/fixture，无生产/迁移/UI变更。完整check36/36（31缓存，13.873秒）、Worker92P（62.362秒）、源码扫描0命中/错误均绑定当前源码。两处新fault模式默认关闭；只增加测试证据中的key hash、PUT与断线次数，不输出凭据或提示词。

**浏览器与产物范围**：本次未重跑网页/Electron或生成新ZIP；上轮网页18P和6份实际ZIP扫描明确属于354f源码及assetEpochSlice，不能改称本次完整E2E。本次API完整回归覆盖共用fixture默认路径，后续完整产品合流仍由J5-f执行。历史496P/503P、各次first fail及源码快照保留原身份，统一报告新增assetWireSlice并刷新sourceScope。

继续PG输出落库冲突/提交回包丢失、cleanup与新引用争用、其余J5/F5-X/原E及全平台/生产回滚；B61和整包未关闭，管理员尚未开始。 本地检查通过不意味着69/77父任务或正式生产验收完成。

<!-- B61:ASSETS-WIRE END -->
<!-- B61:ASSETS-DATABASE START -->
**J5-e.DB1/DB2真实新Agent数据库故障（2026-09-12）**

B61新增2项实际数据库故障已验：输出登记错误使generation/方案资产、trial和完成事件整体回滚；PG已提交而回包断线时，独立连接证实成功，新PID清理保留受引用图片。两例各1次图像调用、原版本/费用回执不被重启改写。完整API507P、Worker92P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。

| 场景 | 旧/新PID | 生图终态 | evaluation记录 | 新PID维护后对象数 |
|---|---|---|---|---|
| output-rollback | 75926→75934 | failed | 0 | 0 |
| commit-response | 76020→76075 | succeeded | 1 | 1 |

**DB1输出登记回滚**：隔离数据库中为design_scheme_assets安装fixture专用BEFORE INSERT trigger。它先在当前事务内关联generation_assets→generation_runs→design_scheme_runs，确认同一用户和revision的生图输出已经插入，再递增独立sequence并抛真实PG异常。sequence回滚后仍记录1次命中，不是向业务表写成功资格。实际Agent新草稿经正式run/production bin触发错误：两个资产表、evaluation和两种完成事件均无残留；方案仍原draft、无trial，generation/方案run failed、receipt claimed/unknown/costnull。对象已上传，持久generation_compensation由新PID维护精确删除；重放同execution、账本和原文不变。trigger/sequence仅在自建DB安装，收尾删除；未修改生产迁移或schema。

**DB2提交回包丢失**：只把fixture正式generation bin的DATABASE_URL指向本地TCP代理，API和观察者仍独立直连同一PG。代理处理当前无TLS PostgreSQL v3消息：看到该连接generation_assets INSERT及COMMIT后，扣住服务器实际CommandComplete(COMMIT)和后续响应；从另一连接读取generation succeeded、真实trial与已落库资产，才主动断开被扣住的连接。此时原worker收不到提交确认并走补偿，但成功终态/receipt逐字段不变、图像调用仍1次。原1小时安全清理意图转为立即可处理；新PID真实维护重新核对canonical引用，保留对象/hash并移除陈旧意图，不会把已成功图片删除。原/新worker均正常退出0。

每例实际Better Auth→新Agent→prepare/run→正式`apps/worker/src/bin.ts`，没有SQL授予trial、改run状态、lease或费用。模型与S3为本地受控HTTPfixture；DB1是PG trigger故障，DB2是真实连接回包故障；无TLS代理仅用于隔离PG测试，不是产品数据库代理。实际维护由显式Graphile任务驱动，不宣称自然小时cron。成功生图的费用仍可为unknown（fixture没有权威成本），不可据成功图片推算或写0。具体日期、PID、server heldAt、独立读取、完成事件/对象与清理记录见[两项证据](../../tests/v25/.results/b61/assets-database-cases.json)。

| 原样命令 | 结果 |
|---|---|
| `pnpm --filter @musefold/api run typecheck` | assets-database-typecheck：退出0，1.618秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-database.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-database-first.json` | assets-database-first：退出0，10.477秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-assets-database-full.json` | api-assets-database-first-full：退出1，675.645秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-database.integration.test.ts src/__tests__/integration/agent-generation-assets.integration.test.ts -t 'actual new Agent trial database outcomes|reference .*fails before paid dispatch' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/assets-database-close-regression.json` | assets-database-close-regression：退出0，12.224秒 |
| `pnpm run check` | check-assets-database-close：退出0，12.074秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-assets-database-close-full.json` | api-assets-database-close-full：退出0，669.325秒 |
| `pnpm --filter @musefold/worker run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-assets-database-close-full.json` | worker-assets-database-close-full：退出0，55.374秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/assets-database-close-source-security.json` | assets-database-close-source-security：退出0，2.128秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | browser-assets-database-close：退出0，245.496秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/database-close-browser-scan-plan.json --report tests/v25/.results/b61/database-close-browser-package-security.json` | database-close-browser-package-security：退出0，0.098秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | browser-assets-database：退出0，242.130秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/database-browser-scan-plan.json --report tests/v25/.results/b61/database-browser-package-security.json` | database-browser-package-security：退出0，0.100秒 |

**结果与身份**：新增定向首次2P/0F/0S（10.477秒），首次完整回归的507项断言全部通过，Vitest JSON甚至写success=true，但进程退出1：一个未处理PG57P01异常，不能登记整组通过。序列化客户端为_ending=true/_ended=false，结合本地pg-pool源码确认pool.end可在idle客户端真正end之前完成；共用package-exchange fixture随即停止PG，撞上仍关闭中的连接。现已逐连接跟踪end并在停容器前等待完成，pool error记录并在close抛错，绝不忽略异常；复用仓库既有连接清理纪律。定向4P/7S（名称过滤，12.224秒）后重新完整回归；首次失败原报告保留为api-assets-database-first-full，见[first-failures](../../tests/v25/.results/b61/first-failures.json)。最终完整API507P/0F/0S（669.325秒）包含这2项及全部既有资产/进程场景，最终无未处理异常且进程退出0；Worker92P/0F/0S（55.374秒），check36/36（31缓存，12.074秒），源码扫描0命中/错误。

当前1565项源码摘要`35a6acb4b61d3243b426ff63593c76f636a66457fb0cc4bff423e6d9b570f161`，[源码快照](../../tests/v25/.results/b61/source-assets-database-final.json)及[差异](../../tests/v25/.results/b61/assets-database-source-delta.json)：新增数据库fault fixture和数据库集成测试，修改共用Agent fixture的可选装配及package-exchange fixture的PG连接关闭顺序；无生产/迁移/UI改动。首次2P/完整首轮507断言通过但exit1/首轮网页18P及6ZIP在76dd5216源码，关闭顺序修复后的完整API/check/worker/网页与新ZIP扫描绑定当前35a6acb4源码，历史报告不覆盖。为验证共用fixture的可选装配不破坏默认路径，本片另跑PC/移动网页正向6项及故障12项，18P/0S/0F/0flaky（245.496秒），覆盖真实新Agent试跑、封面正式化、导出/导入和恢复；只跑这两文件，未重跑完整Web/Electron。新生成的[6份实际ZIP](../../tests/v25/.results/b61/database-close-browser-files.json)均独立扫描0命中/错误，报告与产物已归档为browser-assets-database-close；不是重复扫描旧文件。本片修复前后共12份实际新ZIP：首次76dd的6份与最终35a6的6份均已独立扫描通过，统一报告分列firstBrowserAttempt与finalPackages，不能把两轮18P相加冒称36项不同用例。更早18P/六ZIP仍保持354f历史身份。统一报告新增assetDatabaseSlice并刷新sourceScope。

接续GC1真实新引用与清理竞争、其余J5数据库/权限/版本组合及F5-X/原E、全平台与生产回滚；B61和整包未关闭，管理员尚未开始。 特别是claim→保护查询→删除与真实新增引用的两种次序，以及原数据库并发/约束冲突组合，不由单个trigger回滚或提交断线自动证明；原J5-e/父任务69/77保持开放。

<!-- B61:ASSETS-DATABASE END -->
<!-- B61:CLEANUP START -->
### 引用与清理竞争：GC1本机先后次序及候选批次修复（2026-09-12）

B61新增真实新Agent引用/清理两种次序2项及Worker批次回收1项已验。修复已采用的过期参考图每次维护反复入队10轮的问题：候选排除方案引用，加锁后再次复查；保留最终对象保护。完整API509P、Worker93P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。

**实际发现与修复**：首次API两项安全断言通过，但隔离审计trigger记录同一已引用object key在一次实际维护中INSERT→UPDATE→DELETE重复10轮（30条审计）。追加“不得反复入队”断言后正式复现失败（api-cleanup-churn-red）。生产`PostgresObjectCleanupStore.queueExpiredReferences`现在在候选选择排除`design_scheme_generation_references`，并在取得upload行锁后用新查询复核；最终findProtected及持久清理outbox沿用。没有DDL、第二套资产状态或费用/UI修改。对象key索引使用既有schema。

| 场景 | 实际执行与验收 |
|---|---|
| 引用先提交 | 正常登录→新Agent→上传PNG→prepare/run实际提交canonical引用；正式generation bin在GET屏障处暂停（SIGSTOP并用ps确认），仅加速reference expiry。第二个实际PID运行维护；同一图片hash/引用保留、无物理删除、修复后无重复清理入队。释放GET/恢复原PID后仅1次图像调用、1次成功trial，正文及draft身份不变；两个PID正常退出0。 |
| 清理先领取 | 仅加速未采用参考图expiry；正式维护claim后在真实S3批量删除之前hold响应/删除动作。此时upload为cleanup_pending、审计记录INSERT0/UPDATE1，字节仍在。实际run入口404且无generation/scheme run、引用、回执或图像调用；释放后精确删除1个key，上传登记和outbox清空，再请求仍拒绝且原draft不变。 |
| 候选批次/purge | Worker store级真实PG fixture构造101个受引用上传及1个孤立上传，每个引用独立run、position0（满足真实约束）。候选仅取孤立对象；物理删除关联run后101个原引用按100+1重新可清理。删除由spy断言，非实际S3；不以此赋予产品试跑资格。 |

本轮两个实际产品场景分别覆盖引用已提交后维护、维护已领取后发起采用；不证明所有事务中间交错。参考过期时间在隔离PG中主动调整，未改租约/资格/费用，不能作为自然24小时TTL验收。Worker批次测试使用数据库状态fixture和删除spy，仅证明清理store候选与purge语义；真实新Agent资格仅来自API两项的正常产品流程。Windows暂停进程场景明确skip，本机macOS实际无skip。

**首次失败保留**：api-cleanup-churn-red是上述生产重复入队缺陷；cleanup-target从仓库根执行时配置未收集API/Worker文件，改用各包命令；worker-cleanup-target误从db导入worker常量，已修正；worker-cleanup-fixed最初将101引用塞入同一run，触发position<16数据库约束，并使共享fixture后两例受到残留数据影响，已改独立run并为本例添加finally精确清理。归档扫描首轮误用不存在的artifacts命令，退出2且未产报告；改用plan命令后六份新ZIP扫描通过。约束未被放宽，既有断言未删除。最终Worker定向5P，API定向2P；首次日志及各次退出码均保留。

| 原样命令 | 退出码 | 时长 |
|---|---|---|
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-cleanup-first.json` | 0 | 9.547秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-cleanup.integration.test.ts '--testNamePattern=accepted reference' --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-cleanup-churn-red.json` | 1 | 6.434秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec vitest run apps/api/src/__tests__/integration/agent-generation-cleanup.integration.test.ts apps/worker/src/__tests__/object-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=tests/v25/.results/b61/cleanup-target.json` | 1 | 0.490秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/object-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-cleanup-target.json` | 1 | 3.489秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/object-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-cleanup-fixed.json` | 1 | 15.054秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-cleanup-fixed.json` | 0 | 9.151秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/worker exec vitest run src/__tests__/object-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-cleanup-valid-fixture.json` | 0 | 4.153秒 |
| `pnpm run check` | 0 | 11.544秒 |
| `pnpm --filter @musefold/api run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-cleanup-full.json` | 0 | 694.224秒 |
| `pnpm --filter @musefold/worker run test:integration --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/worker-cleanup-full.json` | 0 | 63.702秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/cleanup-source-security.json` | 0 | 4.161秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-faults.spec.ts web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | 0 | 264.950秒 |
| `node scripts/security/scan.mjs artifacts --plan tests/v25/.results/b61/cleanup-browser-scan-plan.json --report tests/v25/.results/b61/cleanup-browser-package-security.json` | 2 | 0.066秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/cleanup-browser-scan-plan.json --report tests/v25/.results/b61/cleanup-browser-package-security.json` | 0 | 0.094秒 |

最终完整API509P/0F/0S、Worker93P/0F/0S，无Unhandled Errors，进程均退出0；统一check36/36。网页仅重跑实际新Agent正向6项与故障12项（PC/移动18P/0S/0F/0flaky），非完整Web/Electron；本次新增[6份真实方案ZIP](../../tests/v25/.results/b61/cleanup-browser-files.json)及源码独立扫描零命中/错误。上游身份委托、文本/图像模型、GitHub和S3为本地受控HTTP，API/PG/Graphile/正式generation bin是真实执行；不宣称真实供应商费用或生产部署通过。

当前1567项源码摘要`69d5898ee13921ae04aa5eb9cd83aefffd2698ea9a6817e95576ede603efb408`，见[源码快照](../../tests/v25/.results/b61/source-cleanup-final.json)、[本轮差异](../../tests/v25/.results/b61/cleanup-source-delta.json)与[实际两项证据](../../tests/v25/.results/b61/cleanup-cases.json)。完整回归/扫描绑定该快照；早期定向在最终store测试fixture修正前执行，首轮未另行冻结完整源码，不将其冒认当前快照。统一报告新增cleanupSlice，历史assetDatabaseSlice等保留原身份。

继续J5浏览器撤权/跨owner/版本promote与素材交叉故障、在途预检后引用变化等剩余并发；F5-X自然TTL/格式/容量/系统文件交付、原E、全平台和生产回滚仍待。B61、迁移整包及管理员前置保持开放。 当前父任务69/77及最终验收未勾选，不以新增测试数量计算产品完成率。

<!-- B61:CLEANUP END -->
<!-- B61:INFLIGHT-ISOLATION START -->
### 在途预检与双页面身份：GC1.2 / J5-c增量（2026-09-12）

B61新增在途参考图读取与物理清理交错1项已验：旧GET返回有效字节，事务内重验仍404，零图像调用/新任务/回执/trial。双页面实际登出及独立账号隔离在PC/移动4场景通过，重新登录只恢复原结果。API定向9P，统一check36/36及源码扫描通过；本轮仅测试变化。

**GC1.2实际交错**：真实新Agent与用户上传PNG，prepare后发起正式run，API已读取available元数据并到达S3 GET屏障；此时尚无canonical引用。仅在自建PG调整该reference过期时间，然后启动正式generation bin、执行真实维护并观察原对象物理删除，upload/outbox清空。旧GET仍扣住之前捕获的有效字节，放行后图像解析能成功，但正式run事务内重新查元数据返回404，未创建generation/scheme run、回执、trial或图像调用；重放仍拒绝，原draft不变，worker正常退出0。既有服务重验正确，无生产修复。实际哈希、屏障、删除次数见[GC1.2证据](../../tests/v25/.results/b61/inflight-cleanup-case.json)。这是在途HTTP字节与数据库重验场景，过期时间人为加速，不计自然24小时TTL，也不是网络断线测试。

**J5-c实际UI与账号隔离**：在真实新Agent纯描述草稿上经Composer提交一次试跑，发送前暂不启动generation、发送后扣住图像回包。相同BrowserContext的第二页进入设置账号卡，使用真实退出AlertDialog；旧页detail/run/cancel均401并显示既有scheme-submit-error，不自动再POST生图。发送前启动worker后任务失败且图像0次；发送后释放已有调用，原任务成功且图像1次。退出后重开详情显示错误，无成功详情。另建独立BrowserContext/真实另一账号登录，原detail/run/events/submit/cancel均404，成功场景的图片content也404；直接打开详情仅错误。原账号通过实际账号表单重新登录，旧页刷新只恢复原draft/原run；发送后才有1次真实trial，图像hash与原输出一致，模型调用均1次。该新账号Context复制主页视口尺寸，未单独模拟触摸/移动UA；主流程在正式PC及Chromium移动项目运行，不等同Safari实机。

4条[双页面证据](../../tests/v25/.results/b61/logout-isolation-cases.json)分别标注项目、发送阶段、实际401/404、原run与调用数量。仅覆盖列出的只读入口和run/cancel越权，不据此关闭所有管理动作/跨owner/provider撤key/promote竞争。没有SQL授予新trial或正式资格，BA/API/PG/Graphile/正式bin真实，New API委托与模型/S3是本地受控上游。

**验证与首败**：在途新增运行最初3P，但统一check的API类型检查失败：Hono request可能同步或异步返回，不能直接赋给optional Promise。测试改用Promise.resolve并保留确定的局部请求句柄，finally释放屏障后等待请求再关资源。修复后check36/36、API两文件9P；首轮双页4P之后只给该网页文件追加独立账号检查，最终仍4P（更完整断言，非额外4条不同场景），check与源码扫描通过。生产代码/共享fixture/UI/迁移均未修改，没有本轮新方案ZIP；不把旧6ZIP算作本轮产物。

| 原样命令 | 退出码 | 时长 |
|---|---|---|
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-cleanup.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-cleanup-inflight.json` | 0 | 13.782秒 |
| `pnpm run check` | 1 | 5.340秒 |
| `pnpm run check` | 0 | 25.608秒 |
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/agent-generation-cleanup.integration.test.ts src/__tests__/integration/agent-generation-authority.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-inflight-authority.json` | 0 | 22.758秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-logout.spec.ts --project web-desktop --project web-mobile` | 0 | 48.299秒 |
| `pnpm run check` | 0 | 6.653秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-logout.spec.ts --project web-desktop --project web-mobile` | 0 | 53.034秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/inflight-isolation-source-security.json` | 0 | 0.706秒 |

当前1568项8fdc36f1…；API9P在9109d9e9…执行，其API测试/生产源码与当前逐文件一致，后续仅给网页测试追加独立账号检查。最近完整API509P/Worker93P/网页18P及6ZIP扫描属于上轮69d5898e…，本轮未重跑完整后端或全部E2E，不写成全量510P。 API定向9项=本文件3项清理场景+既有6项API授权/版本回归，0F/0S且无未处理异常；网页最终4P/0F/0S/0flaky。当前完整[源码快照](../../tests/v25/.results/b61/source-inflight-isolation-final.json)摘要`8fdc36f1f847cd5d842715e4391521e38358770fc50945c069984a5101f3a9d5`，[差异](../../tests/v25/.results/b61/inflight-isolation-source-delta.json)仅新增网页测试、扩展API测试。API对应修复类型后的[9109快照](../../tests/v25/.results/b61/source-inflight-logout-first.json)与最终快照的API测试字节相同；先前未修类型的运行不冒认为该快照。报告/产物已分别归档browser-logout-first和browser-logout-isolation，统一报告新增inflightIsolationSlice并刷新sourceScope。

接续J5-c真实provider撤key、working-draft promote版本竞争与素材型交叉故障，再完成F5-X/原E/全平台/生产回滚。B61、整包及管理员前置仍开放。 父任务仍69/77、最终验收未勾；本轮没有生产部署或管理员开发。

<!-- B61:INFLIGHT-ISOLATION END -->
<!-- B61:PROMOTE-CONFLICT START -->
### 双页面封面竞争与明确转正恢复（2026-09-12）

B61新增双页面封面竞争后的working-draft转正验证：修改、上游更新各在PC/移动触发真实409，保留旧正式版、新试跑及资产；刷新后明确选回新版本封面并转正，零新增生图。专项2P，包含原三形态创建在内的该文件完整回归8P/0F/0S/0flaky；check与源码、10份当轮实际方案ZIP扫描通过。

**真实流程与验收**：复用真实GitHub Agent创建、初次trial与正式版，分别走modify、check-update生成独立working revision，再实际试跑并选该版本输出封面。第一页点击更新正式版本，测试仅扣住该真实POST（请求体由合同解析），第二页在同一账号会话的真实相册选择另一张已留存旧版输出作为封面。第二页写入使版本加1后，放行原POST到实际Hono服务，返回409并有可见提示；summary等于第二页写入结果，原正式document、新working document及全部资产、generation/scheme运行账本、文本/图像调用均保持。没有SQL授予试跑资格或伪造409。

主页面随后刷新，用户明确选回先前已试跑的新版本输出封面，版本再加1；再次点击转正，旧正式版才被新revision替代。两轮升级后图像总调用仍为3（初次、modify、update各1），冲突、选择封面与重新转正不追加生图。最终实际导出新正式版ZIP并重新导入新草稿，核对本版资产集合、来源/正文及图片hash，导入不继承trial资格。PC与Chromium移动各1条联合测试、每条含modify/update两次竞争，共4份[竞争证据](../../tests/v25/.results/b61/browser-promote-regression-cases.json)。不等同Safari或所有跨页面操作的穷举。

**首败与修正**：首次命令漏RUN_DATABASE_TESTS导致2S，exit0不计通过。随后测试误点仅draft可见的rename菜单，PC超时；定位后中止重复移动场景与诊断运行，退出130如实保留，trace证实正式菜单没有该项。改用实际可用的封面选择，并给关键导航/点击设置有界等待、捕获响应等待拒绝，避免未处理Promise遮住原失败。下一轮2F发生在导出：竞争选择了旧revision封面，旧请求已正确409，重新转正也已成功，但导出按既有合同拒绝旧版封面。修正用户流程为刷新后明确选回新trial封面再转正，没有改业务语义、放宽导出校验或在后台偷偷选封面。首败报告分别为[跳过](../../tests/v25/.results/b61/browser-promote-conflict-skipped-report.json)、[错误菜单](../../tests/v25/.results/b61/browser-promote-conflict-first-report.json)、[诊断trace报告](../../tests/v25/.results/b61/browser-promote-diagnostic-report.json)、[旧封面导出拒绝](../../tests/v25/.results/b61/browser-promote-cover-first-report.json)。

**最终结果**：新冲突专项2P/0F/0S/0flaky（70.565秒），随后同一文件全部8场景通过：brief/github/history原6项加新github-conflict双视口2项。后一次8P是包含前述场景的回归，不写成10种独立场景。两次运行实际生成2+8=10份不同归档文件，均按当轮路径/hash独立扫描，未拿旧文件充数；[扫描计划](../../tests/v25/.results/b61/promote-archive-scan-plan.json)与[结果](../../tests/v25/.results/b61/promote-archive-security.json)零命中/错误。check36/36及[源码扫描](../../tests/v25/.results/b61/promote-final-source-security.json)通过。

| 原样命令 | 退出码 | 时长 |
|---|---|---|
| `pnpm run check` | 0 | 6.523秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-runtime.spec.ts --grep github-conflict --project web-desktop --project web-mobile` | 0 | 70.565秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | 0 | 183.492秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/promote-final-source-security.json` | 0 | 0.706秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/promote-archive-scan-plan.json --report tests/v25/.results/b61/promote-archive-security.json` | 0 | 0.108秒 |

当前1569项源码13a5b41e…，仅3个浏览器测试文件变化；没有修改生产服务、UI、数据库或共享后端fixture。历史完整API509P/Worker93P属69d5898e清理批次，前轮API9P/登出4P属其已记快照；本轮未重跑完整后端或全部E2E。 [最终源码快照](../../tests/v25/.results/b61/source-promote-final.json)摘要`13a5b41e702f083624ccade6e42d90d46d7cc9bc87c41efd97272784040b6c1f`；[差异](../../tests/v25/.results/b61/promote-source-delta.json)只新增竞争helper、扩展原正向helper可选回调及新增测试场景。受控部分为New API身份上游、文本/图像HTTP、GitHub/S3；BA/Hono/PG/Agent/正式generation bin及浏览器产品行为真实。报告和产物已分别归档browser-promote-restored与browser-promote-regression；统一报告新增promoteConflictSlice，保留历史API/worker结果所属快照。

继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。

<!-- B61:PROMOTE-CONFLICT END -->
<!-- B61:PROVIDER-RECOVERY START -->
### 上游凭据撤销与工作台迟到会话恢复（2026-09-12）

B61上游凭据撤销已接真实HTTP鉴权边界：纯文本/参考图、发送前/后共API4场景与PC/移动8场景通过；连同隔离单测和原授权/生图回归API12P。已接收调用可完成，后续撤销凭据请求401且费用未知；重新启用相同测试key只恢复读取，新试跑必须明确prepare/提交。

**上游边界**：复用实际Better Auth登录产生的加密凭据，文本HTTP先观察真实Authorization；测试上游仅保存key的SHA-256摘要及撤销集合，按后续实际请求头决定200/401，不修改account_session_authorizations或credential表。独立HTTP单测证明已用key撤销后401、另一key仍200、缺头401、重新启用后200，快照不泄漏key。文本/图片服务、New API身份委托、S3均为本地受控上游；API、PG、Agent与generation正式bin实际运行。

API和UI均覆盖text/reference-image × before/after-dispatch。发送前撤销后worker仍会发送一次HTTP请求，上游401，不把“未受理生成”谎报成“未发请求”：generation.upstream_request_sent为true，失败回执dispatch=claimed、costPoints=null/costProvenance=unknown，零输出/新trial。发送后撤销不会撤回已接收并扣住的图像调用，释放后原run成功；用户明确再次prepare/submit才产生第二个被401拒绝的run，不影响原成功资格。再次启用同一测试key后，原execution回放/刷新/详情读取只恢复旧记录；明确的新prepare/submit才创建新run成功。所有首次Agent文本调用保持1次，图片接受次数和401鉴权请求次数分别记录；参考图实际字节hash逐次核对，无SQL注入新trial。

[API4场景证据](../../tests/v25/.results/b61/provider-api-cases.json)包含原/拒绝/新run、上游请求hash与回执；[浏览器8场景](../../tests/v25/.results/b61/browser-provider-cases.json)包含双视口、输入类型、原结果、失败和恢复、实际POST数量。浏览器失败时保留正文和必需变量、费用未知；上游恢复后的刷新不自动追加调用，后续按按钮明确生成的新请求均有独立executionId。重新启用同key不等于凭据轮换或重新登录流程；没有测试真实付费供应商或Safari。

**生产缺陷与先红后绿**：第一轮浏览器3P/5F，包含重复进入有历史任务的Composer后不应依赖的自动焦点断言，以及参考图重新提交持续禁用。通过就地单测扣住首次listSessions，在方案挂载、用户输入新正文/变量并上传图片后才返回旧会话，旧代码稳定用旧正文覆盖新输入并清掉图片（ui-provider-hydration-red）。WorkbenchScreen原先schemeIntentApplied仅保护方案附件，仍执行clearReferences/setComposer；修复为这次迟到加载完整让位于新方案输入，同时消费pending prompt标志，并只在会话尚未装载时置该一次性标志。后续主动切到其他会话仍清空旧方案/参考图并加载目标草稿。新增有/无pending prompt两种情况，连同原方案/参考素材测试31P；测试操作显式点正文再输入，未加固定sleep/force click或关闭必需图片校验。

**完整E2E与交互复验首败**：完整E2E首轮112P/1F后中止（exit130），337项为跳过或未执行；初始GitHub试跑两张参考图已上传但提交禁用，挂载正文的下一帧聚焦与主题填入存在时序竞争，补等待正文聚焦及主题值断言。其后专项6P/2F，纯描述/历史素材已正式化，导出菜单被成功toast遮挡；click重试停留在toast导致自动消失计时暂停。导出helper移开鼠标并等待toast移除，再普通点击菜单；未使用force、固定sleep或更改产品toast。首次报告分别为[e2e首轮](../../tests/v25/.results/b61/e2e-provider-full-first-report.json)与[焦点专项](../../tests/v25/.results/b61/browser-provider-focus-regression-report.json)。最终专项及完整结果按下表记录。

**测试首败**：首轮API1P/4F来自测试直接修改prepared.executionId，却没有为新执行走prepare，服务409符合授权约束。测试改为每次新提交前走真实prepare，未放宽生产验证；修复后定向5P，再与原授权6项/正向生图1项合跑12P，0F/0S且无未处理异常。[首轮API](../../tests/v25/.results/b61/api-provider-first.json)、[首轮浏览器](../../tests/v25/.results/b61/browser-provider-first-report.json)、[确定性UI复现](../../tests/v25/.results/b61/ui-provider-hydration-red.log)保留。最终浏览器8P/0F/0S/0flaky（88.215秒）、31项就地回归、check36/36及源码扫描通过。

完整E2E首轮112P/1F后中止（337项跳过或未执行）；焦点修正后的专项6P/2F进一步定位toast遮挡。补齐正常指针等待后，三形态试跑/版本竞争/导出重导入专项8P/0F/0S/0flaky。完整Web/移动/Electron复验尚未完成，不记整包通过。

| 原样命令 | 退出码 | 时长 |
|---|---|---|
| `env RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/fixtures/__tests__/provider-authorization.test.ts src/__tests__/integration/agent-generation-provider.integration.test.ts src/__tests__/integration/agent-generation-authority.integration.test.ts src/__tests__/integration/agent-generation.integration.test.ts --reporter=default --reporter=json --outputFile=../../tests/v25/.results/b61/api-provider-regression.json` | 0 | 30.216秒 |
| `pnpm --filter @musefold/features exec vitest run src/workbench/__tests__/workbench-schemes.test.tsx src/workbench/__tests__/workbench-references.test.tsx` | 0 | 3.491秒 |
| `pnpm run check` | 0 | 25.663秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-provider.spec.ts --project web-desktop --project web-mobile` | 0 | 88.215秒 |
| `node scripts/security/scan.mjs source --report tests/v25/.results/b61/provider-interaction-source-security.json` | 0 | 0.772秒 |
| `node scripts/security/scan.mjs plan --plan tests/v25/.results/b61/provider-full-archive-plan.json --report tests/v25/.results/b61/provider-partial-archive-security.json` | 0 | 0.621秒 |
| `env RUN_DATABASE_TESTS=true pnpm exec playwright test -c tests/v25 web.scheme-trial-runtime.spec.ts --project web-desktop --project web-mobile` | 0 | 224.114秒 |

当前1573项源码7b1778db…；API12P运行于fea659ab…，API代码逐文件与当前相同，后续只有工作台/就地单测/浏览器测试变化。凭据浏览器8P与就地31P属于493f8933…，当前另改试跑测试等待焦点与导出测试移开鼠标等待成功提示消失；历史完整API509P/Worker93P保留69d5898e归属，不改写成当前全量结果。 [当前源码快照](../../tests/v25/.results/b61/source-provider-toast.json)摘要`7b1778db239a979faf64ecec0a6135bcc61de4fbebe212a871190c38dfa535e6`；[差异](../../tests/v25/.results/b61/provider-source-delta.json)列出新增测试/受控上游和唯一生产改动WorkbenchScreen。API12P在[浏览器首轮快照](../../tests/v25/.results/b61/source-provider-browser-first.json)运行，API所有文件与当前逐一相同。统一报告新增providerRecoverySlice；本次凭据浏览器专项没有生成方案ZIP。首轮完整E2E与两轮试跑交互专项共留存27份真实ZIP及1份明确下载UI替身，已按[独立清单](../../tests/v25/.results/b61/provider-partial-archive-inventory.json)扫描零命中/错误；真实ZIP中也包含原有包测试fixture，不能全部称作新Agent试跑产物。最终完整E2E新增归档的扫描结果以本节完整运行条目为准。

继续J5-a/b素材与取消/unknown/丢回包/读取恢复组合及J5-f最终收口，再接F5-X、原E、四端/平台发布和生产回滚。上游采用本地受控HTTP，不是付费供应商实网；恢复是重新启用同一合成key，不声称验证key轮换或管理员代授权。B61、完整迁移与管理员前置仍开放。

<!-- B61:PROVIDER-RECOVERY END -->
<!-- B61:MATERIAL-FAULTS START -->
### 素材型试跑故障与取消受理顺序（2026-09-12）

B61已扩展纯文本/参考图输入×取消前后、unknown、受理回包丢失、事件/任务读取中断共六类故障的双视口测试；参考图经真实上传，核对正式run的冻结引用ID、实际图像端点和字节SHA256。 素材故障24项与修改/更新30项联合专项54P/0F/0S/0flaky（642.820秒）。

[B61原验收对照](../../tests/v25/.results/b61/b61-acceptance-review.json)将原boundary/verify整理为12条，逐项列出实现、历史证据与当前门禁；对照表已核对当前完整API/worker/E2E与源码/实际归档扫描，原12项范围通过；仅关闭B61，整包与发布仍开放。

测试复用同一真实Better Auth/Hono/PG/Agent/generation正式进程，文本、图像、身份委托和S3上游为本地受控服务。纯文本与参考图各覆盖六类故障，PC/移动Chromium视口各执行一次，共24项；修改/更新两份原文件全部回归30项。参考图来自本轮6×4 PNG并经Composer上传；必需图片缺失先证明提交禁用，上传后正常启用，不通过SQL授予试跑资格。

取消前无图像调用；取消后/unknown保留未知费用，无成功trial；已受理但丢回包及读取中断允许原run完成并取得trial，但仍为草稿。正文和主题保留、原方案document一致，事件执行ID与两份run账本关联，任务队列清空并正常退出worker。图像调用逐一核对generations/edits端点、引用字节长度/MIME/SHA256，run冻结executionSettings.referenceAssetIds数量与输入形态一致；刷新/恢复详情不产生第二次POST或图像调用。读取故障含一次events/run503及详情持续503到可见错误态，再点击重试恢复；它们是明确UI网络注入，非真实公网断网。

**首败与修复**：第二轮完整E2E（e2e-provider-full-final）106P/1F后中止，343项为跳过或未执行；失败是修改取消测试点击后立即释放模型，取消事务尚未被观察到提交，任务先完成。修改/更新测试现等待UI显示已取消再释放，沿用创建测试已有顺序，未改变服务端终态语义。新增素材专项首轮6P/10F后中止（另有1项中断，剩余未运行）；新增断言误读顶层referenceAssetIds，已按contracts改为executionSettings.referenceAssetIds。 首次报告为[e2e取消失败](../../tests/v25/.results/b61/e2e-provider-full-final-report.json)和[素材断言失败](../../tests/v25/.results/b61/browser-material-faults-report.json)。修改取消在首次专项即通过，完整结果以本节最终专项为准。无force click、固定sleep、放宽生产取消或费用验证。

同源码完整E2E 455P/7S/0F/0flaky（2284.791秒），跳过项按实际项目/原因保留；当轮真实归档和明确UI替身分别扫描通过。

同源码API完整集成514P/0F/0S（673.167秒）；同源码Worker完整集成93P/0F/0S（53.911秒）。统一check退出0，源码扫描零命中/错误；具体命令、时长及结果写入统一报告materialFaultSlice。当前1573项源码85917a2c…，本片仅修改三份浏览器测试；生产工作台修复仍为493f快照的实现。API12属于fea、凭据浏览器8/就地31属于493f、试跑交互8属于7b1778db，各自保持原证据范围；历史API509/Worker93不改写为当前全量结果。 [冻结源码](../../tests/v25/.results/b61/source-material-contract.json)摘要`85917a2c7b6aa64602c7b2d5326a4ac9233b7139ebeb59ab5ad0b0f5177bf2ed`。[24项场景证据](../../tests/v25/.results/b61/material-fault-cases.json)逐项记录输入形态、端点/hash、原执行/状态与读取故障次数。六轮历史/当前浏览器运行共56份真实ZIP及2份明确UI替身，经[独立清单](../../tests/v25/.results/b61/material-stage-archive-inventory.json)分类扫描零命中/错误；其中素材故障本身不导出ZIP，修改/更新使用历史导入基线，其归档fixture不是新Agent试跑资格。最终完整E2E新增36份实际ZIP与2份明确UI文本替身已追加扫描；七轮合计92份ZIP与4份UI替身均零命中/错误，见[最终分类清单](../../tests/v25/.results/b61/material-full-archive-inventory.json)和[扫描结果](../../tests/v25/.results/b61/material-full-archive-security.json)。每份文件的来源沿各生成测试保留，不把历史输入fixture当作新试跑成果。

完整回归分项目：PC Web 152P/2S、Mobile Web 151P/3S、Electron 152P/2S。7项均为明确条件跳过：3项live-account缺启用条件/账号密码，1项Electron真实中转连接缺图像API key，3项壳行为属于另一视口；无未执行或中断冒充skip，见[逐项报告及skipInventory](../../tests/v25/.results/b61/e2e-material-full-result.json)。这些真实外部环境用例不计通过，仍由账号/连接及发布验收承接。

B61原boundary/verify的12项验收对照已通过，关闭D4-J联合试跑批次；接续F5-X旧格式/异常/容量/自然期限/原生交付、原E数据与同步、四端/平台发布及生产回滚。管理员仍在全部迁移闭合后开始。
<!-- B61:MATERIAL-FAULTS END -->
<!-- B61:END -->

**B61运行期诊断补记**：在完整E2E冻结源码期间，另用独立PG和实际bin做3项临时API诊断，12.259秒、退出0。发送前取消0图像POST；发送后取消和HTTP断连unknown各1POST，文本调用各1次，原execution重放保持单一run/双账本，没有新资产或成功trial，三个worker均SIGTERM退出0。unknown返回`GENERATION_UPSTREAM_UNKNOWN`且retryable=false。此为[临时运行报告](../../tests/v25/.results/b61/j5-runtime-probe.json)，该条保留临时诊断的历史身份；完整E2E结束后已固化为上表API3P及浏览器8P，仍不替代J5进程故障/撤权/全矩阵。


<!-- B61:AUTH-PROBE -->
**J5-c授权边界临时诊断（不是正式回归完成）**：完整桌面回归期间，以独立PG/真实Agent草稿/实际generation bin诊断两场景，10.015秒、退出0。通过既有fixture把session authorization改为recovery_only并增加revision：发送前0图像请求、双run failed、无新资产；已发送后1请求可正常完成并保存原输出，但方案仍draft。两场景旧会话详情读取和run重放均403。后者不能误写成“所有撤权后的原输出都必须丢弃”或“未发生费用”；后续验证应拒绝新增操作，并如实保留已获授权的执行事实。报告：[原始诊断](../../tests/v25/.results/b61/j5-auth-probe.json)。最初诊断因根目录workspace包导入解析失败，在fixture启动前退出；改为读取同一contracts源码后通过。此为SQL注入授权失效，尚非用户登出、上游撤key、T3恢复或版本竞争；仍须固化测试并完成J5-c全部条件。

<!-- B61:AUTH-EXTRA -->
**J5-c临时诊断续项**：随后以实际Better Auth登出接口代替SQL授权失效，发送前/后两场景退出0（9.147秒），旧会话详情和重放均401；原请求零发送/一次完成的边界相同。[登出诊断](../../tests/v25/.results/b61/j5-logout-probe.json)。另从实际新trial开始，经真实rename递增summary.version后，旧版本select-cover/formalize均409，保留draft及原trial/不可变正文；使用当前版本显式操作成功且模型调用不增加，两场景退出0（9.523秒）。[版本诊断](../../tests/v25/.results/b61/j5-version-probe.json)。首轮误把可变方案名与不可变revision.name混同，改断言summary.name及document整体未变；未改生产重命名。以上四场景仍是临时API诊断，未计入21P或162项回归，不代表双浏览器、正式版promote、上游撤key或J5-c全组合已验。

## 6. 每个 goal 的测试报告模板

复制到该 goal 的任务包或持久报告位置；将结论摘要回写 [goal 文档](./V25-MIGRATION-GOALS.md)、[迁移卡](./V25-MIGRATION-CARDS.md) 以及现有 [manifest](./V25-EVIDENCE-MANIFEST.json)。manifest 继续使用当前 schema，需扩充字段时先改契约与守卫。

```text
任务：G-...
日期与时区：待填写
起始/结束 checkpoint：待填写
工作树改动是否已纳入 checkpoint：待填写
环境：OS / 架构 / Node / pnpm / 数据库 / 浏览器或 Electron
范围：验收条目；涉及宿主；本次明确未执行的条目
命令：原样记录，不含凭据或真实用户内容
证据层级：source / unit / mock-e2e / runtime-e2e / live / package / prod
真实组件：待填写
替身组件及局限：待填写
首次结果：待执行（P/F/S 数量，退出码，retry 次数）
失败原因与修复：待填写或不适用
重跑范围与结果：待执行；是否同一版本，是否全量，是否去重
跳过：逐项给测试名、原因、补跑条件、归属 goal
视觉：baseline 变更及审阅结果；截图/trace 脱敏检查
报告/产物：持久路径或 CI artifact；构建 hash；保留政策
验收结论：待执行 / 部分通过 / 通过 / 阻塞（附具体原因）
剩余项：归属 goal、依赖、下一条可执行命令
回写：tasks/checklist、迁移卡、manifest 是否一致
```

报告存相对仓库路径或受控 CI artifact 链接，不写真实账号身份、Prompt 正文、密钥、绝对本机路径或结果资产。B9 已配置 list/JSON/HTML reporters，分别写入普通 E2E 与 package 的独立目录；本地报告与真正的 CI artifact 分开登记，未执行的 CI 不宣称成功。

只有**本 goal 的验收行为已完成、必要阶段已执行且证据匹配**时才能把 goal 标为完成。测试数量增加、UI 卡片出现、接口由 501 改成 200、构建成功或“批次完成”都不能单独代替完整验收。

<!-- B62:CORPUS START -->
## 5.56 B62：共用语料跨端导入与桌面旧格式完整性（已验收）

B62已修复桌面导入旧版方案包后来源/图片在共享详情中丢失：两宿主共用既有旧格式内容映射，桌面重绑来源与资产ID、保存完整正文/图片、隔离旧scan，导入仍为无试跑资格的新草稿。

**范围与实现**：原F5-X.C要求同一份v1/v2合法、混合图片/来源/Unicode，以及CRC、资产hash、来源hash、重复entry、大小写/Unicode别名、越界路径、不支持版本、加密、symlink共12类输入。永久生成器为[package-import-corpus](../../apps/api/src/__tests__/fixtures/package-import-corpus.ts)，复用现有ZIP编解码；每次运行只生成一次保存文件，两个reader及两个Web账号读取同一路径，Electron picker接缝只复制相同字节并核对SHA256。UI选择旧格式为显式用户动作。

**实际发现与修复**：首轮v1在Web保留来源和两图，桌面详情来源/资产为空。桌面旧路径未重绑旧文档ID、未登记图片、保存不可映射旧commit；已从现有API提取[旧包内容映射](../../packages/scheme-package/src/legacy-import-content.ts)，由宿主分别注入现有图像探测/解码和持久化。共享包只处理已验证内容与身份映射，不引入数据库、网络、Sharp或Electron依赖。Desktop沿现有受管目录和SQL事务保存；错误清理该次导入根目录。完整来源正文和图片/预览保留为引用/示例，不根据旧scan中的任意ID、confirmed或trial标记授予可信历史、封面、正式或试跑资格。非标准旧commit留在私有溯源，canonical commit为null；歧义来源与无字节可映射的声明拒绝。

**本次证明范围**：真实Better Auth/Hono/PG/AWS SDK与Electron IPC/SQLite；账号上游和S3为本地受控服务。PC/移动为Chromium双视口；Electron文件路径经E2E接缝注入，不代替真实系统picker或Safari。服务fixture只增加只读canonical/受管字节快照；此用例不调用seedTrial、不用SQL制造资格。每类坏包均显示对应包校验错误，canonical表逐行不变；合法包另查完整来源text、图片hash、全新ID、draft/no-trial/no-cover，桌面新PID重启及Web刷新后详情保持。

**当前结果**：12份永久语料的file/bytes reader一致；真实PC Web、Mobile Web、Electron共36个导入场景通过（6次合法新草稿、30次坏包拒绝），并验证刷新/新PID重启后的内容、原数据不变与图片hash。当前check36/36通过；API导入/导出/身份专项80P在此前6cc49667…执行，其API及共享生产源码与当前逐文件一致，之后仅测试比较helper变化。当前1579项源码5171ca41…的源码与三轮留存6份合法ZIP扫描零命中/错误；30份故意无效语料另记拒绝，不计为安全交付ZIP。 36个场景属于一个完整跨宿主Playwright测试（1P/0F/0S/0flaky，63.221秒），不是36条独立测试。[逐场景证据](../../tests/v25/.results/b62/host-corpus-cases.json)、[终态报告](../../tests/v25/.results/b62/corpus-host-nullable-result.json)、[冻结源码](../../tests/v25/.results/b62/source-legacy-nullable.json)、[源码扫描](../../tests/v25/.results/b62/source-corpus-final.json)。前次共享归档/桌面专项64P；当前check再次包含desktop share22项、legacy-content10项与API永久reader12项。

**首次失败完整保留**：见[失败账本](../../tests/v25/.results/b62/first-failures.json)。两轮实际宿主失败的报告/语料分别保存为corpus-host-execution和corpus-host-legacy-fixed；首轮CLI参数错误未运行测试，不绑定旧报告。类型检查发现跨宿主测试依赖，已把可移植legacy fixture放入共享测试目录；只移除该次错误编译产生的8份声明文件。缺省commit与null属于合同允许的无值，修正比较不减少正文/来源/图片/资格断言。

**归档与清理边界**：[分类清单](../../tests/v25/.results/b62/corpus-archive-inventory.json)含三次生成的36份真实输入，其中6份合法ZIP扫描通过，30份故意破坏结构/哈希的样本按reader/host拒绝保存。[合法包扫描报告](../../tests/v25/.results/b62/corpus-archive-security.json)。首次失败运行未走到所有host拒绝场景，30条最终host拒绝以最终36场景报告为准。失败暂存记录/对象不等于canonical写入；自然TTL与物理回收仍在F5-X.T，未声称所有暂存对象已删除。

**最终回归及原范围验收**：最终受影响回归163P/2S/0F/0flaky（1180.304秒）：完整Electron153P/2S，PC/移动Web各5P；两项skip分别缺真实登录凭据和生图key，保留为发布条件。四次实际宿主运行累计保存72个文件副本，其中30份有效ZIP扫描零命中/错误、42份故意无效输入另记拒绝；包含复制的picker输入，不把副本数写成独立测试数。最终回归自身新增22份有效ZIP和11份坏包输入。 [完整受影响回归终态](../../tests/v25/.results/b62/corpus-affected-e2e-result.json)、[本轮36场景](../../tests/v25/.results/b62/host-corpus-final-cases.json)、[全部实际文件分类](../../tests/v25/.results/b62/corpus-final-archive-inventory.json)、[归档扫描](../../tests/v25/.results/b62/corpus-final-archive-security.json)、[原F5-X.C四项验收审计](../../tests/v25/.results/b62/b62-acceptance-review.json)。

B62/F5-X.C四项原定验收已通过，仅关闭本卡。继续F5-X.L容量及资源/失败清理，再接T自然期限、H系统文件交付与原E、平台包、生产回滚和远程MCP；完整迁移及管理员前置保持开放。

<!-- B62:CORPUS END -->

<!-- F5-X:L-API-PREPARATION START -->
## 5.57 F5-X.L：实际容量边界与 API 准备（未关闭）

2026-09-13（实际运行UTC 2026-09-12 15:59–16:26）。F5-X.L容量准备已推进到真实API：12份保存样本完成24次file/bytes reader判定和12条实际HTTP导入/拒绝流程（6允许、6拒绝），覆盖原始合同的manifest、条目数、64MiB条目、256MiB归档/展开量与压缩比。6份当前允许ZIP扫描零命中/错误。尚未完成永久回归集成、Web UI/Electron入口、并发资源与中途写入失败清理，F5-X.L继续开放。

| 约束 | 允许样本 | 拒绝样本 | 两个共享 reader / 实际 API |
|---|---|---|---|
| manifest | 4,194,304 字节 | 4,194,305 字节 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |
| ZIP 条目（含目录） | 1,024 条 | 1,025 条 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |
| 单条目 | 67,108,864 字节 | 67,108,865 字节 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |
| 归档实际字节 | 268,435,456 字节 | 268,435,457 字节 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |
| 解压总字节（含 manifest） | 268,435,456 字节 | 268,435,457 字节 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |
| 实际 deflate 压缩比 | 199.976352 倍 | 200.014497 倍 | 判定一致；允许包完整导入，拒绝包零 canonical/对象写入 |

**样本真实性**：使用[唯一限制合同](../../packages/contracts/src/design-scheme-package-limits.ts)的当前数值，未缩小常量。单条目与归档使用实际随机二进制来源文件；展开量使用真实随机可打印正文，deflate后归档实际字节小于归档上限，分别隔离两个256MiB约束。manifest与ZIP中央目录/条目真实大小逐项核对；归档边界通过调整实际来源文件长度计入ZIP开销，没有稀疏文件或伪造目录大小。压缩比使用实际deflate输出的相邻随机前缀长度，中央目录compressedSize核对一致；约200上下两侧通过，不声称精确ratio=200已验。

**真实 API 出口**：每个样本使用独立 disposable PG、实际Better Auth登录和Hono TCP HTTP服务，调用begin→PUT content→显式decision→import-package→详情；实际AWS SDK连接本地受控S3服务。合法输入落为新draft/no-trial/no-cover，逐个读取真实对象核对来源文件和资产hash。非法归档总大小在begin拒绝，其他超限在上传解析拒绝；均断言所有canonical表为零、S3对象与PUT次数为零。记录cleanup队列数量但未冒称队列已经物理清空；没有SQL插入或伪造试跑资格。该准备未驱动浏览器或Electron。

**资源测量的范围**：大样本的file/bytes reader分别在独立Node进程执行，最大峰值RSS为1,402,160 KiB（约1.34 GiB），包括Node/模块和读入，不含生成器；测量运行时为本机darwin arm64、Node v25.8.1。API探测进程同时承载HTTP测试客户端、API和内存S3，最大RSS 2,872,112 KiB，不能当作生产API单进程内存。四个小样本的原reader测量仍为准备进程累计峰值，不与独立reader混算。实际服务/宿主并发内存预算和超时后的释放仍待，不能据本次可读/可导入就关闭资源验收。

**保留的首次问题**：第一组大样本复用旧shared mixedPackage中的PNG，ZIP及图片签名读取通过，但API完整像素解码preflight拒绝。原样本和reader结果保留为reader-only历史；新的capacity-host-v1从已有API importFixture复用真实Sharp PNG，重新生成八份大样本，当前12条实际HTTP流程全部通过。另一次测试断言把file reader的超大文件报错和bytes reader报错混同，按两入口实际错误分别断言后，对原文件复验通过。均未修改或放宽生产reader/图片解码器。

**可追溯结果**：[当前12样本、文件hash、ZIP实际指标、24次读取和12条HTTP结果](../../tests/v25/.results/b63/capacity-host-v1-results.json)、[6份当前允许ZIP扫描](../../tests/v25/.results/b63/capacity-host-v1-security.json)、[首次问题](../../tests/v25/.results/b63/first-failures.json)。产品源码仍为B62的1579项5171ca41…；本片仅增加隔离准备脚本/输出和文档，尚未将生成器或探测集成到永久测试。B62的check与受影响回归仍按原源码归属，准备命令不冒充新的统一check或整个L通过。

**下一轮的固定范围**：

1. 将可复用样本生成/真实上限判定纳入永久测试，采用可完整解码图片；一次生成并保存hash，让reader、API、Web与Electron消费相同文件。大样本逐个隔离运行，保留资源实测，不在日常并行测试中无界生成多份256MiB包。
2. 补Web UI与真实Electron IPC/SQLite对上述同一文件的导入，检查来源正文/二进制/图片实际字节、新草稿身份、超限拒绝前后canonical不变及重启读回。
3. 补允许最大包在对象/受管文件写入中途失败、取消或断开后的实际清理，验证并发准入、在途内存/耗时和资源释放；按服务/宿主实际部署预算裁定，发现缺口修复后跑适用门禁。
4. 当前十二样本不替代自然到期/cleanup竞争的F5-X.T或原生picker/系统适用性的F5-X.H；只按原F5-X.L验收条件关闭L，不修改父任务范围。

<!-- F5-X:L-API-PREPARATION END -->

## 5.58 B63：永久容量语料、真实宿主与失败清理（进行中）

2026-09-13（运行 UTC 2026-09-12）。本节接续 §5.57 的准备记录；B63/F5-X.L 原范围不变，尚未关闭。已完成永久容量生成器及双 reader 回归、PC Web/移动视口/真实 Electron 同文件导入，已补云端最大允许包的中途写入失败、取消、断线及实际清理，继续资源和桌面文件故障验收。

**实际产品修复**：真实 Next.js rewrite 曾按默认 10 MiB 截断上传。Web 配置现从唯一合同引用 `archiveBytes`，使用已安装 Next 的 `experimental.proxyClientMaxBodySize`；API 仍保留自己的真实字节/摘要校验和并发限制。随后实测完整 256 MiB 已到 API 并返回 200，但 Chromium 页面在原始 Uint8Array 上传路径崩溃。共享 API client 改为发送不可变 Blob，保持二进制内容、认证、取消和响应合同；子数组测试验证只发送指定字节，后续修改原数组不改变请求内容。相同最大包与全部容量边界复验通过。这里只证明所测路径恢复，不据此宣称生产并发内存预算已验。

**永久测试与流程**：生成器复用现有 `rawZip`、可完整解码的图片夹具和合同上限，每个大样本在独立子进程生成后保存。file/bytes reader 分别在新进程判定；同一保存文件交给两种 Web 视口和真实 Electron。合法输入逐项核对来源、正文/二进制和图片字节 hash、新身份、draft/no-trial/no-cover；网页刷新和 Electron 新 PID 重启后再次核对。非法输入在确认/正式落库前拒绝，原 canonical 表保持不变。Web 使用真实 Next standalone rewrite 加本地流式 TCP 转发到隔离 API，避免 Playwright 将 256 MiB 请求序列化成巨型字符串。转发保留实际 cookie；不注入所有者身份，不用 SQL 产生试跑资格。

| 已执行门禁 | 结果 | 证据与范围 |
|---|---|---|
| 六类真实边界 × 允许/拒绝 | 12P / 0F / 0S / 0 flaky，220.497 秒 | 每条包含三个宿主，共 36 场景；其中 18 次合法导入、18 次超限拒绝。两个独立 reader 共 24 次判定 |
| 实际 256 MiB 单项复验 | 1P / 0F / 0S | 完整边界回归前的独立诊断，不与上述 12 条相加为独立覆盖 |
| 当时统一检查 | 36/36 | 1587 项源码 `3b2169e5…`，含 Next 真实 cloneable body 字节测试、Blob 子数组测试及永久小样本测试 |
| 实际容量归档扫描 | 16 个合法 ZIP，0 命中 / 0 错误 | 已归档各轮共 28 个输入；12 个故意超限输入单列，不当作安全交付包；文件副本数不当作测试数 |

[12 条终态报告](../../tests/v25/.results/b63/capacity-hosts-blob-all-result.json)、[36 场景及真实 HTTP 字节记录](../../tests/v25/.results/b63/capacity-three-host-cases.json)、[当时冻结源码](../../tests/v25/.results/b63/source-binary-blob.json)、[当时统一检查](../../tests/v25/.results/b63/capacity-binary-blob-check-summary.json)、[当时源码扫描](../../tests/v25/.results/b63/capacity-source-blob.json)、[文件分类](../../tests/v25/.results/b63/capacity-permanent-archive-inventory.json)、[归档扫描](../../tests/v25/.results/b63/capacity-permanent-archive-security.json)。当前继续追加故障测试，后续源码与门禁另行记录，不能把以上数字写成后续全量验证。

**首败保留**：宿主回归先发现 route 清理竞争和 Playwright 大请求字符串上限，修正测试转发后暴露上述 Next 截断与浏览器崩溃。Next cloneable body 单测曾使用错误的 Readable 类型，随后巨型 Buffer 深比较触发测试进程 OOM；改用真实 IncomingMessage 和逐字节原生 Buffer.equals。故障测试首轮的 Vitest context 参数、跨 realm Response 断言问题亦保留，后者实际收到预期 503。[永久测试失败账本](../../tests/v25/.results/b63/permanent-first-failures.json)与原 §5.57 准备失败账本分别保留；受控中止留下的未执行项不计为新的产品缺陷。

**尚待验收**：云端最大包失败后的实际清理已通过下述三例；仍需并发准入、API/桌面单独进程资源预算和释放、桌面受管文件中途失败、适用宿主回归及最终证据复核。Chromium 移动视口不代替 Safari/实际移动文件管理器，Electron 路径注入不代替系统保存/取消；这些继续归 F5-X.H。自然 staging/回执期限及完整 cleanup 竞争仍归 F5-X.T，本片两分钟上传租约测试不能替代全部自然 TTL。原 E 数据/费用/worker、四端发布、生产回滚及远程 MCP 仍保留，管理员在迁移全部完成后启动。

**本轮独立 reader 实测**：24 次读取的峰值 RSS 最大 1412256 KiB，单次读取最长 1148.26 ms；[逐 reader 记录](../../tests/v25/.results/b63/capacity-permanent-reader-resources.json)。该值包括运行时和输入加载，不含生成器与后续 hash 复核；不是生产 API 或并发宿主的内存验收结论。


**最大包故障与自然清理增量**：当前 1589 项源码 `702a93c4…` 新增永久实际 API 故障测试 3P（380.537 秒），既有 API 导入集成回归 34P（14.065 秒）、统一检查 36/36（15.089 秒）、源码扫描零命中/错误。相对上述 1587 项源码只变化三个测试/fixture 文件，生产代码相同；不把旧完整后端或全部 E2E 数字冒作当前通过。

| 故障 | 实际触发与断言 | 自然清理验收 |
|---|---|---|
| 存储写成后报错 | 256 MiB 真实包导入中，S3 已完整写入一个 64 MiB 来源文件后返回 403；API 返回 503，可重试且无结果回执 | 原 canonical 表不变；两分钟租约到期前运行维护不删除残留；原 worker 干净退出，新 PID 在自然到期后物理删除全部残留 |
| 用户取消 | 在上述 64 MiB PUT 回包暂停期间调用真实取消 API，再放行迟到成功回包；原导入 409 | 无半方案/无试跑，取消两次可重入；到期前保护、到期后新 PID 清理成立 |
| 客户端断线 | 在同一实际 PUT 阶段中止 HTTP 客户端请求；客户端 AbortError，服务端最终为 retryable/null result | 零 canonical 增量；显式取消保留的 stage 后，真实时钟跨原租约并由新 PID 清空对象与 outbox |

每例使用真实 Better Auth、Hono TCP、PG、AWS SDK 与 `apps/worker/src/bin.ts`；S3 为本地协议夹具。故障定位在至少一个完整 64 MiB 来源文件写成之后，未缩小合同、未改数据库 deadline/epoch、未用假时钟、未写 SQL 制造方案或资格。维护通过真实队列显式触发，**不是证明每小时自动巡检调度**；测试为上传/导入两分钟租约，不替代 staging/回执全部 TTL。成功导入引用的保护与桌面文件写失败另验。本轮 RSS 是 API/客户端/内存 S3 测试进程累计峰值，不能用作生产内存预算。

[三例原时间、实际文件 hash、残留与删除 hash、旧/新 PID 和最终零对象/空队列](../../tests/v25/.results/b63/capacity-fault-results.json)、[API 回归](../../tests/v25/.results/b63/capacity-import-regression-summary.json)、[当前统一检查](../../tests/v25/.results/b63/capacity-faults-final-check-summary.json)、[当前源码扫描](../../tests/v25/.results/b63/capacity-faults-source-security.json)。

**关联宿主回归首轮**：15 条原有方案导入、试跑/修改/转正、交换与旧格式回归首轮 7P/1 超时/7 未执行。移动 GitHub 场景的页面显示 Next 脚本分块加载失败；该运行与会重建 Web 的统一检查重叠。保留[完整失败报告](../../tests/v25/.results/b63/capacity-affected-hosts-result.json)与[构建时间对照](../../tests/v25/.results/b63/capacity-build-overlap.json)，随后构建结束后串行重跑整组已15P/0F/0S/0flaky；不放宽超时、不删除断言，首轮未执行项仍按原记录保留。

**故障输入及首轮关联回归归档扫描**：新增12份合法ZIP（3轮故障测试生成的最大包输入、9份首轮关联回归实际产物）扫描零命中/错误。[分类清单](../../tests/v25/.results/b63/capacity-fault-archive-inventory.json)、[扫描结果](../../tests/v25/.results/b63/capacity-fault-archive-security.json)。这些文件不包含正在进行的固定构建复验产物，后者完成后另记。


**本轮最终回归与证据收口（B63 仍开放）**：固定构建后，原有 PC Web/移动/Electron 关联回归 **15P/0F/0S/0 flaky，407.579 秒**，每个项目各5项；包含旧格式同文件语料、双向包交换、真实新方案试跑/修改/转正和再导入。测试的是上述5个受影响文件，**不是全部Web/Electron E2E重跑**。首轮失败仅证明页面分块加载错误与重建重叠，未记录该资源的确切HTTP失败码；稳定构建复验无产品代码改动通过。[完整终态](../../tests/v25/.results/b63/capacity-affected-hosts-stable-result.json)。

固定构建复验新增33个保存文件，22份合法ZIP扫描零命中/错误，11份故意无效输入另记；[分类](../../tests/v25/.results/b63/capacity-stable-archive-inventory.json)、[扫描](../../tests/v25/.results/b63/capacity-stable-archive-security.json)。连同此前容量和故障/首轮关联回归，本节三张分类清单共73个文件副本，其中50份合法ZIP扫描通过、23份故意无效输入，副本数量不作为覆盖条数。

最终源码 **1589项 `4ea8a79e…`**。在 `702a93c4…` 的故障3P/API34P/宿主15P之后，仅将故障测试默认证据目录从 `.results` 调整为已有 CI 收集的 `test-results` 并加注释；测试断言、实际服务及产品代码完全相同，本机已验运行仍使用显式 `PACKAGE_CAPACITY_EVIDENCE_DIR`。该目录调整未重跑六分钟故障或宿主测试，最终统一检查36/36（12.768秒）与源码扫描通过；这不代表已执行云端CI。[最终源码](../../tests/v25/.results/b63/source-capacity-faults-ci-artifacts.json)、[最终检查](../../tests/v25/.results/b63/capacity-ci-artifacts-check-summary.json)、[源码扫描](../../tests/v25/.results/b63/capacity-ci-source-security.json)。

下一步按原 F5-X.L 完成并发准入、API/桌面单独进程内存与耗时/释放、桌面真实部分文件写入失败清理。此三项云端故障成功不替代这些条件；F5-X.T/H、原E、全部平台与生产验收继续保留。B63 不勾选、整包不关闭、管理员尚未开始。

## 5.59 B63：桌面真实磁盘满与最大包并发（进行中）

2026-09-13（运行UTC 2026-09-12）。接续§5.58，继续原F5-X.L；本轮补齐HFS+磁盘空间不足下的导入清理，以及真实API两个最大请求在途/第三请求拒绝/取消后恢复接纳。资源单独进程预算尚未验收，B63和整包仍开放。

**桌面真实文件系统故障**：永久用例 `electron.package-disk-full.spec.ts` 使用实际256MiB归档和两个共享reader，再驱动真实Electron UI/IPC。hdiutil创建128MiB HFS+测试映像，仅挂载到本次新建且为空的 `design-scheme-imports` 目录；SQLite、原归档及两份安全staging副本均在外面，避免在准备复制阶段提前失败。文件写观察器调用原Node写入函数、原样返回/重抛，不注入错误或修改字节；记录操作系统实际结果。

初始可用131,035,136字节。95字节图片和第一个67,108,864字节来源文件完整落盘后，第二个64MiB文件由真实操作系统返回 **ENOSPC**。HFS+在分配阶段拒绝，失败文件为0字节；这证明**多文件导入已部分写成后的失败清理**，不宣称失败的单个文件已经写入部分字节。导入根目录及暂存包均清空，canonical SQLite和来源状态与导入前一致，无新方案/回执/试跑。

关闭该Electron进程并卸载映像后，新PID读取原库仍一致；显式选择**同一份文件**成功导入新draft/no-trial/no-cover，实际来源hash完整。再次新PID重启，方案和来源读回一致，原输入hash不变。测试映像均已卸载并清理；不触及用户正式App或已有目录。该测试只证明本机macOS/HFS+，不替代Windows/APFS或真实系统picker；路径选择仍经现有E2E接缝注入。

[桌面原始文件写入、错误、3个PID与恢复结果](../../tests/v25/.results/b63/disk-full-result.json)、[专项1P终态](../../tests/v25/.results/b63/capacity-disk-allocation-result.json)、[无残留挂载检查](../../tests/v25/.results/b63/disk-mount-cleanup.json)、[两轮实际256MiB输入扫描](../../tests/v25/.results/b63/disk-archive-security.json)。专项18.221秒，源码1591项`95bada4d…`；之后追加API并发测试，在当前源码又通过桌面磁盘满专项。

**实际并发接纳**：复用现有API/importer和唯一上限，测试夹具只扩展为最多暂停两个真实S3回包；没有改生产active计数或直接制造running状态。同一真实账号按产品流程登记3份独立stage（同一保存的256MiB输入），第4份begin被owner配额429拒绝。上传在两个完整S3 PUT之后暂停回包；导入在两个真实stage GET处暂停。数据库确认两个请求确实在途后，第三请求收到429且不新增S3写入或canonical数据，第三份stage仍保持原状态。取消第一个、放行在途回包：第一个409，第二个200；随后第三个以原stage显式重试200，active恢复0。导入仅产生两个独立新草稿，来源字节hash一致，无任何试跑资格。

上传和导入两项均已执行通过，当前逐项证据见[真实并发记录](../../tests/v25/.results/b63/concurrency-results.json)。并发接纳是**单API进程两个在途请求**；跨API进程的owner stage配额依原PG锁语义，本次只验证同进程实际调用，不冒称部署集群压力测试。fixture结束销毁PG/S3不作为GC证据，真实清理继续引用§5.58的独立自然租约用例。

**首次问题保留**：hdiutil空映像创建不能使用仅适用于srcfolder/srcdevice的format参数，改为type UDIF；macOS返回规范化的 `/private/var` 挂载路径，按realpath核对并保证异常后只卸载本测试映像。首轮桌面断言错误地要求ENOSPC文件必须大于0字节，观察记录显示HFS+分配时拒绝；保留真实64MiB先行成功及ENOSPC断言，按实际系统语义记录失败文件0字节，未修改产品写入或清理。API并发首轮2项运行通过，统一检查因测试数组缺少推导类型失败；添加由已有客户端返回值推导的类型后通过。关联Electron首轮漏开数据库测试环境变量，仅磁盘满1P、另两项2S；明确保留该记录，另以RUN_DATABASE_TESTS=true补跑原包交换与语料，不将skip写成通过。

**本轮资源范围**：并发测试进程含API、客户端、内存S3及累积对象，峰值超过5GiB；它不是独立API RSS。当前还需拆分API/S3/客户端进程测量内存/耗时/释放，以及桌面主进程与renderer的实际预算。未通过这些原条件前不关闭F5-X.L，不把当前主机可运行等同部署规格可承受。完整自然TTL、文件系统/浏览器平台矩阵、原E及最终发布继续按原任务执行。

**并发与关联回归终态**：上述1592项源码 `ea749546…` 的联合API专项 **39P/0F/0S，384.238秒**，由2项最大包并发、3项自然租约故障及34项既有导入组成；并非完整API集成。统一检查36/36。漏开数据库条件的Electron运行保留1P/2S，另以正确条件补跑原包交换和旧格式语料 **2P/0F/0S，79.229秒**。六个证据根目录共21份输入副本，10份合法ZIP扫描零命中/错误，11份故意无效输入另记；副本不作为独立测试数量。[API终态](../../tests/v25/.results/b63/capacity-concurrency-faults-regression-summary.json)、[关联Electron终态](../../tests/v25/.results/b63/capacity-disk-exchange-regression-result.json)、[合法包分类](../../tests/v25/.results/b63/disk-concurrency-archive-inventory.json)、[扫描](../../tests/v25/.results/b63/disk-concurrency-archive-security.json)。

**磁盘不足提示修复（当前源码）**：真实HFS+用例暴露产品把磁盘不足显示为“分享包内容无法安全导入”。导入准备和持久化现按底层 `ENOSPC/EDQUOT/SQLITE_FULL` 返回“磁盘空间不足，导入未完成。请释放空间后重试。”，使用既有错误合同和显式重试；清理顺序保持不变，错误不泄漏本地路径。新增4项就地测试覆盖空间不足、磁盘配额、非空间类权限错误和SQLite容量错误，整个share测试 **26P**。这4项是错误注入单测；实际文件系统故障仍由真实HFS+用例证明，不把模拟SQLITE_FULL当作真实数据库磁盘满。

当前1592项源码为 `04059e51…`；相对上述 `ea749546…` 只改桌面share实现、就地测试与真实磁盘满E2E期望提示，API源码未变。统一检查36/36（24.839秒）、源码扫描零命中/错误。数据库条件完整Electron回归已 **166P/2S/0F/0 flaky（1161.465秒）**，两项skip分别缺真实登录凭据与生图Key，保留为发布条件。该项目还包含六维容量的PC/移动Web/Electron共36个场景，但不等同完整Web项目复跑。[源码](../../tests/v25/.results/b63/source-disk-message.json)、[26项单测](../../tests/v25/.results/b63/capacity-disk-message-unit-summary.json)、[统一检查](../../tests/v25/.results/b63/capacity-disk-message-check-summary.json)、[源码扫描](../../tests/v25/.results/b63/capacity-disk-message-source-security.json)。

## 5.60 B63：独立进程资源测量准备（进行中）

2026-09-13，当前源码 `04059e51…`。为消除§5.59合并fixture的内存混算，运行正式 `apps/api/src/bin.ts`，其JS堆和PG连接池独立于S3夹具与客户端；三者PID分别为47955、47954、47920。身份通过本地受控New API HTTP和实际Better Auth登录，数据库为隔离PG。复用已保存并扫描的同一256MiB输入，读取前复核SHA256；不改变包限制、不强制GC、不向数据库写成功状态。

**流程已实际完成（135.932秒）**：同一API进程连续两轮，每轮三个stage、两个真实最大上传在途、第三个429、取消第一个409、第二个200、第三个显式重试200；随后两个真实最大导入同时进行，各生成独立草稿。每轮结束按实际时钟观察15/30/45/60秒。两轮最终共4个草稿、28条来源文件hash与实际对象一致，零试跑、零running导入。API/S3子进程收到SIGTERM后已退出，隔离PG已销毁；夹具销毁不作为产品GC证明。

| API独立进程观测点 | RSS（MiB） | ArrayBuffer（MiB） | 解释 |
|---|---:|---:|---|
| 登录后基线 | 386.4 | 2.2 | 包含Node/tsx及正式API装配 |
| 第一轮两个上传在途 | 2210.9 | 770.2 | S3在另一进程，不计入API |
| 第一轮导入完成 | 3042.5 | 1026.9 | 全程API累计峰值3045MiB，约2.97GiB |
| 第一轮空闲60秒 | 935.9 | 2.1 | 大Buffer已回收，RSS仍高于基线 |
| 第二轮导入完成 | 2798.2 | 1538.4 | 同一API进程再次承载完整负载 |
| 第二轮空闲60秒 | 2439.0 | 1538.4 | 本观察窗内大Buffer仍计入外部内存，释放验收不能登记完成 |

各阶段同时记录heapUsed、external、RSS、累计峰值、事件循环最大延迟、S3与客户端独立数据。该主机同期运行完整Electron回归，所以耗时/延迟**不是独占主机基准**；操作系统RSS、V8外部内存和累计峰值不能混为一项。第二轮60秒内未回到基线不直接证明内存泄漏，也不能写成资源充分释放。部署编排当前未给出API硬内存预算，本次不以主机内存足够或提高预算宣布通过。

[逐阶段摘要、脚本hash及真实命令](../../tests/v25/.results/b63/resource-api-preparation-results.json)、[全部100ms采样与操作记录](../../tests/v25/.results/b63/resource-api-v1/result.json)。本片是已执行的测量准备，尚未纳入永久资源回归；下一步检查大包复制与对象生命周期、测量桌面主进程/renderer，再根据适用部署约束形成资源验收。F5-X.L保持开放，T/H、原E、全部平台及正式发布的原条件不变。

**重复负载复核**：为区分空闲GC时机和持续增长，使用相同源码/输入在另一个正式API进程连续执行4轮上述流程，每轮仍保留60秒自然空闲。264.691秒完成8个独立草稿、56条来源文件hash校验和零试跑。API累计峰值约3089MiB，后续轮次未继续抬高；本观察窗没有显示随轮数持续增长的泄漏，但仍不能据此声称任意长期负载无泄漏或低内存部署通过。初次两轮与四轮运行分别保存，不把四轮计为首次两轮的同一进程。两轮之后曾出现的大Buffer计数也不能被追溯改写成“始终立即释放”。[四轮实际采样摘要与退出记录](../../tests/v25/.results/b63/resource-api-repeated-results.json)。下一项源码改进将消除上传“逐块复制后再整包合并”和导入SHA256前的多余整包复制，保留共享异步解码器必须的不可变快照与所有大小/hash校验。

**磁盘提示修复最终宿主证据**：上述完整Electron包含实际HFS+磁盘满新提示（16.3秒）、同文件显式恢复、两个新PID读回，以及全部12容量用例、原包语料/交换和真实试跑/修改/转正流程。归档留存34份文件副本，17份合法ZIP扫描零命中/错误，17份故意无效输入按对应容量/语料SHA256单列。无测试磁盘映像残留。[完整终态与skip说明](../../tests/v25/.results/b63/capacity-disk-message-electron-result.json)、[归档分类](../../tests/v25/.results/b63/capacity-disk-message-electron-archive-inventory.json)、[实际包扫描](../../tests/v25/.results/b63/capacity-disk-message-electron-archive-security.json)、[挂载清理](../../tests/v25/.results/b63/disk-message-mount-cleanup.json)。均归属04059e51…；后续资源优化不能直接继承为新源码完整回归。

**桌面独立进程测量完成**：同一保存的256MiB输入，真实Electron UI/IPC/SQLite连续导入两次，每次观察60秒自然空闲，随后关闭主进程、新PID读取两个草稿及完整来源hash；132.112秒完成。主进程基线244MiB、累计峰值1496MiB，第二轮不抬高峰值；两轮空闲60秒RSS分别525MiB/782MiB，新PID重启225MiB。共享界面的renderer单独记录，观测峰值262944KiB（约257MiB）。`getAppMetrics`按PID/创建时间区分主进程、renderer与辅助进程；主进程`resourceUsage`补足同步解码期间计时器无法运行时的峰值。Electron的ArrayBuffer字段在本次运行报告为0，不用该值证明没有Buffer分配；保留RSS、Chromium内存和原采样，而不与API的V8计数直接相加。

桌面进程及本次独立userData已关闭/清理。首次独立脚本因Node/tsx未载入工作区别名，在Electron启动前失败；复跑显式采用现有 `tooling/tsconfig.base.json`，未改产品配置。所有测量属于本机开发构建和路径注入，未替代系统picker、Windows或签名安装包。[桌面逐阶段结果、主/renderer PID及新进程读回](../../tests/v25/.results/b63/resource-desktop-preparation-results.json)。

## 5.61 B63：减少最大包的重复内存分配（进行中）

2026-09-13。根据§5.60的实际测量，当前仅改API的三个文件：`readPackageUpload`在准入之后分配一份按受管声明大小限定的自有缓冲，逐块复制真实字节，移除“保留所有分块副本再整包合并”的第二份分配；读取完成前必须通过精确长度检查，错误/超限/取消不返回部分缓冲，finally仍取消并释放reader。补充声明长度安全整数检查。导入的同步SHA256直接读取已有Uint8Array，移除一份256MiB的无用复制；共享异步解码器的不可变快照保持原样，未放宽hash/大小/CRC或并发限制。

新增9个就地用例覆盖可复用底层缓冲的subarray偏移、部分收包后取消、部分收包后连接失败及无效声明长度；上传读取单元共 **13P**。API生产差异仅两处，第三个文件是测试，桌面与共享codec源码相对04059e51…逐文件相同。[源差异](../../tests/v25/.results/b63/buffer-source-delta.json)、[单测](../../tests/v25/.results/b63/capacity-buffer-unit-summary.json)。

当前1592项源码 **`b0698cad…`**，统一检查36/36（13.873秒）与源码扫描零命中/错误。首轮check因四份忽略目录内的测量脚本未格式化而失败，已按仓库格式修复；不添加扫描排除、不放宽门禁。格式化前原脚本快照与首次失败均保留，产品源码及测试未因此改变。[当前检查](../../tests/v25/.results/b63/capacity-buffer-formatted-check-summary.json)、[源码扫描](../../tests/v25/.results/b63/capacity-buffer-source-security.json)、[冻结源码](../../tests/v25/.results/b63/source-buffer-owned.json)。

同源码最终 **API专项39P/0F/0S（382.351秒）**，包含2并发、3自然故障与34既有导入；**受影响宿主14P/0F/0S/0 flaky（293.630秒）**，含六维容量×双边界共36个真实PC Web/移动视口/Electron场景、旧格式共同语料与双向包交换。完整Electron166P/2S仍归04059e51…，不冒作本API修改后的全量结果。[API终态](../../tests/v25/.results/b63/capacity-buffer-api-regression-summary.json)、[宿主完整结果](../../tests/v25/.results/b63/capacity-buffer-hosts-result.json)。

正式API独立进程的同输入四轮测量也完成（264.624秒）：8个新草稿、56条来源文件hash、零试跑/零running，子进程退出及隔离PG关闭均已执行。观测峰值由修改前四轮的3163072KiB下降到2627104KiB，即约 **3.02→2.51GiB，少523.4MiB**。这是两次本机实际观测，前后均有其他测试负载，不能当作生产内存保证或独占主机性能对比。四轮空闲60秒后的RSS分别952.7/1433.1/2144.9/2249.1MiB；不声称所有大Buffer立即归还操作系统。后两轮未继续抬高峰值，但更广的混合请求/慢下载、适用部署预算与长期资源行为仍需按范围验收。[四轮原样本、源码、PID、采样与前后对比](../../tests/v25/.results/b63/resource-api-buffer-owned-results.json)。

本轮宿主产生27份方案包输入/交付副本，API新增两份实际最大包，共29份；12份合法ZIP扫描零命中/错误，17份故意无效输入按语料/容量metadata的hash另列，不计为安全交付包。资源探测复用了此前已扫描的同一文件，不额外计为新包。[分类清单](../../tests/v25/.results/b63/capacity-buffer-final-archive-inventory.json)、[扫描终态](../../tests/v25/.results/b63/capacity-buffer-final-archive-security.json)。F5-X.L仍开放；继续核验上传/导入/导出不同准入池的组合和下载回压下的资源持有期限，再汇总原L的实际验收，不追加“空闲立即回到基线”的新产品保证。T/H、原E、正式平台/部署与管理员启动条件不变。


## 5.62 B63：统一包操作资源名额与慢下载释放

2026-09-13。本轮根据实际HTTP故障补齐F5-X.L的混合并发与下载生命周期。当前1596项源码为 `63102ada7ee2f9dc53979379e3fbdaadd42a23799fbcd5e8d008daaa2bced07e`；相对§5.61共11个API实现/测试文件变化，桌面、共享codec、契约和数据库迁移未改。[源码快照](../../tests/v25/.results/b63/source-shared-final.json)、[逐文件范围](../../tests/v25/.results/b63/shared-source-delta.json)。

**三个实际缺口与修复**：

1. 原下载在返回完整Response后立刻释放export名额。两个真实HTTP客户端停止读取时，第三下载仍200。现在使用64KiB自有分块响应，完整消费、客户端取消/断开或60秒没有消费进展才释放名额；同时去掉abort监听器和整包持有引用。分块不使用仍引用整包的subarray，不放宽原长度/hash和下载授权校验。60秒是连接无进展期限，不是整个下载的总时长；持续读取会重置计时。
2. 本地安装的Hono将HEAD派发至GET，再直接丢弃body。新增真实HTTP用例先复现第三个HEAD错误429，路由现显式取消body后返回无正文响应，保留长度/hash和授权校验。HEAD元数据读取仍会执行完整受控内容检查；没有新增绕过完整性校验的路径。
3. 原上传/确认、导入、导出各有两个独立名额，两个实际256MiB上传暂停于S3写入回包时，第三个已确认包导入仍200。新增每个createApp独立的共享预算，以上重操作共用两个名额，不排队保留请求body；超额上传立即取消输入流。状态查询、取消和拒绝不占重操作名额，现有owner三stage配额和PG锁不变。这是单API进程保障，不能写成跨进程全局内存限制。

[下载首败](../../tests/v25/.results/b63/capacity-download-first-summary.json)、[HEAD首败](../../tests/v25/.results/b63/capacity-download-head-first-summary.json)、[混合请求产品首败](../../tests/v25/.results/b63/capacity-mixed-product-first-summary.json)、[共享名额定向复验](../../tests/v25/.results/b63/capacity-shared-mixed-summary.json)。最初混合测试缺expect导入、空闲测试poll参数名错误均属测试设施问题，分别保留，未混作产品复现。[完整首败台账](../../tests/v25/.results/b63/permanent-first-failures.json)。

**最终验证**：统一检查 **36/36（14.066秒）**，包含5项下载流与2项共享预算就地单测；源码安全扫描零命中/错误。同源码API导入/导出/并发/自然故障联合回归 **84P/0F/0S（377.883秒）**，包括44项导出（含HEAD及两种慢下载）、34项导入、3项最大包并发及3项自然故障清理。受影响宿主 **14P/0F/0S/0 flaky（291.070秒）**，包括六维容量的36个真实PC/移动视口/Electron场景、共同语料和包交换；不等同本次完整Web/Electron重跑。[API终态](../../tests/v25/.results/b63/capacity-shared-api-regression-summary.json)、[宿主终态及逐项范围](../../tests/v25/.results/b63/capacity-shared-hosts-result.json)。[统一检查](../../tests/v25/.results/b63/capacity-shared-final-check-summary.json)、[源码扫描](../../tests/v25/.results/b63/capacity-shared-source-security.json)。先前43项导出通过属于加入HEAD和统一预算之前的源码，不计入当前最终结果。

**测试与交付边界**：慢下载用实际64MiB条目生成的合法包、真实Hono TCP/S3字节和暂停客户端；验证两个未读完响应、第三429且不再读对象，以及断开/实际等待60秒后的恢复。归档准备和上传同时受到下载名额限制，上传输入流被取消，元数据仍可查。用例保存实际S3导出文件及hash供独立扫描。本轮断开后约85毫秒恢复，空闲模式实际等待60,470毫秒后恢复；两个导出文件分别67,143,014与67,144,181字节，不冒称256MiB下载吞吐基准。该导出服务测试沿用SQL试跑资格及header身份fixture，不证明真实付费供应商/登录流程；产品新Agent试跑仍由B61独立证据承接。混合最大包用例使用实际createApp、Better Auth、PG和S3协议，证明上传时导入和导出读均限流、查询/取消可用、名额释放后原stage显式导入成功。缺失exportId由繁忙429恢复为正常404用于核对生产装配，不冒称该探针已交付真实归档。

本轮含首败和复验留存40份输入/交付副本，23份实际合法ZIP（含两份真实下载导出）扫描零命中/错误，17份故意无效输入按hash另列。副本数量不等于独立测试数量。[文件分类](../../tests/v25/.results/b63/capacity-shared-final-archive-inventory.json)、[实际归档扫描](../../tests/v25/.results/b63/capacity-shared-final-archive-security.json)、[扫描终态](../../tests/v25/.results/b63/capacity-shared-final-archive-scan-summary.json)。资源观测沿用§5.60–5.61的确切源码、独立PID和范围，不增加立即GC承诺，不将本机峰值当生产内存规格。F5-X.T自然一小时有效期及回执/清理竞争、F5-X.H系统文件交付、原E、全平台发布与管理员前置继续保留。


**B63原验收审计结论：通过，仅关闭F5-X.L。** [逐条证据与保留范围](../../tests/v25/.results/b63/capacity-acceptance.json)按原任务boundary/verify逐项对照：

| 原验收 | 证明及实际边界 |
|---|---|
| 六维真实边界、两个reader、跨宿主 | 当前12容量用例/36产品场景；不修改限额，不用小文件替代256MiB |
| 合法完整新草稿、超限拒绝 | 当前宿主语料与API34项导入，正文/图片hash、原状态及试跑身份断言 |
| API部分写入后失败/取消/断线清理 | 当前3项真实64MiB PUT、原2分钟租约及新PID worker，实际删除对象且零canonical变化 |
| 桌面部分写入失败及恢复 | §5.59实际HFS+ ENOSPC、零残留、SQLite不变、同文件新PID恢复；桌面源码本片未变 |
| 并发和资源持有/释放 | 当前3项最大包并发、真实慢下载60秒/断开、HEAD、完整归档hash及7项就地单测 |
| 内存/耗时测量 | §5.60–5.61独立API/S3/客户端四轮、桌面main/renderer两轮、自然空闲及新PID读回；保持原源码归属及观测限制 |
| 适用门禁、安全与首败可追溯 | 当前check36/36、API84P、宿主14P、源码与23合法ZIP扫描；所有首败和修复保留 |

下一批F5-X.T按原合同等待一小时上传/导出期限自然经过，证明已完成导入的持久回执不随上传TTL丢失，并补清理与在途/新引用竞争。该回执当前没有独立“一小时后删除”规则，不为验收虚构回执TTL。T/H、原E、全平台发布、真实凭据条件与管理员前置均不因B63完成而关闭。


## 5.63 B64：自然期限与清理竞争（原范围已验收）

2026-09-13最终结论：本节末原一小时用例与逐条验收通过；以下运行中描述保留当时状态。

2026-09-13。B63已按原范围完成；本批最初新增API测试夹具和集成用例，复用生产一小时上传/导出期限、两分钟IO租约、持久导入回执与实际Worker。当前1598项源码为 `c555b61d4911ca88f90b34fa6a43f22ea53f6e898b45b5b178354a5685bf3c85`；生产实现、合同和迁移相对B63逐文件不变。[源码](../../tests/v25/.results/b64/source-lifetime-run.json)。

**已执行预检**：真实Better Auth/Hono/PG/S3创建方案包，实际导入两份，其中一份经产品remove删除；另一份借既有SQL试跑fixture建立正式导出资格，经真实HTTP下载并校验hash。随后创建待上传/已确认/待进行在途导入的三份stage。在S3实际PUT/GET回包处建立同步点，独立PG事务只持有stage/export行锁，不改任何字段。通过pg_blocking_pids确认两个真实API请求等待该锁，再释放；导入成功且下载字节hash完整，Worker使用不同真实PID干净替换。该预检证明设施和到期前正向行为，不能证明期限已经经过。独立预检 **1P/1筛选跳过（7.172秒）**，后续仅将hash参数转换修为共享函数要求的Buffer类型。[预检终态](../../tests/v25/.results/b64/lifetime-preflight-window-summary.json)。

**自然运行源码的统一检查**：36/36（14.159秒），当前一小时自然期限测试尚在运行。首轮时间断言错误地要求PG事务起点created_at与稍后JS计算的expiry差值精确一小时，实际相差2ms；已改为原始HTTP准备窗口加原TTL的上下界检查，未改数据库日期或生产合同。另一次check发现测试向sha256传Uint8Array的类型不符，已改用Buffer。两次属于设施问题，保留原日志与失败。[检查](../../tests/v25/.results/b64/lifetime-typed-check-summary.json)、[首败台账](../../tests/v25/.results/b64/first-failures.json)。

**自然期限运行计划与判定**：

| 阶段 | 实际动作 | 必须证明，当前均等待长时用例结果 |
|---|---|---|
| 建立期限 | 保存服务器原始expiresAt、一小时常量、开始/观察时间、原输入/实际导出hash；提前运行维护 | 有效stage/export对象保留；已导入来源及资产完整 |
| 在途跨期 | 到最早原deadline前55秒才发起真实导入和下载；S3回包后用真实PG锁使两个请求停在下一次权威检查 | pg_blocking_pids证明实际等待，禁止用虚构running行或修改时钟制造状态 |
| 原期限经过 | 等最后一个原deadline经过，新PID生产Worker在请求仍被锁阻塞时维护 | 过期归档与未提交导入的部分对象实际删除；已采用引用、软删除保留期内资产及hash仍在 |
| 迟到请求 | 解锁实际请求并读取响应，再尝试过期上传/导入/下载 | 返回受控拒绝，无新的canonical写入、S3 PUT或归档正文 |
| 持久回执 | 读取和重放成功/已删除方案的原导入回执 | 已完成回执不随上传一小时TTL消失；返回原身份、不重复导入、不复活被删方案；原期限不被读取续期 |

小型真实共享归档用于期限测试，B63最大包证据不重复构造。SQL试跑资格只用于构造正式导出前置，不声称本批执行真实模型收费或新Agent试跑。S3/上游身份服务仍是本机受控协议端；Hono、Better Auth、PG事务和Worker为实际实现。自然期限使用原墙上时钟，每30秒保存进度；macOS以caffeinate -i随测试进程防止空闲睡眠，不改系统时钟或关闭显示器节能策略。

本机启动命令如下；`RUN_PACKAGE_LIFETIME_TESTS=true`单独启用长时测试，因为现有常规CI集成job仅25分钟。默认条件跳过不能算本项通过；现已接入下述独立长时门禁，远端执行仍待发布阶段验证。

```sh
RUN_DATABASE_TESTS=true RUN_PACKAGE_LIFETIME_TESTS=true PACKAGE_LIFETIME_EVIDENCE_DIR="$PWD/tests/v25/.results/b64/natural-first" pnpm --filter @musefold/api exec vitest run src/__tests__/integration/package-lifetime.integration.test.ts
```

本次真实进程使用上述变量的绝对证据路径，由run-gate保存原命令与最终日志。开始UTC19:23:51，本组自然期限约UTC20:24:00（上海2026-09-13 04:24）后才可核对最终结果；这不是提前宣告通过。F5-X.T其余清理/新引用交错须按原卡审计，H、原E、全平台/生产回滚和管理员前置仍开放。


**准备产物扫描已完成**：当前源码零命中/错误；四次准备过程留存8份合法输入/实际导出ZIP，扫描零命中/错误，包含失败预检保留的文件副本。自然用例结束后的结果仍需独立判定，不把已通过扫描写成已通过自然TTL。[当前源码扫描](../../tests/v25/.results/b64/lifetime-typed-source-security.json)、[文件hash清单](../../tests/v25/.results/b64/preparation-archive-inventory.json)、[归档扫描](../../tests/v25/.results/b64/preparation-archive-security.json)。


**独立H原生文件交付检查的环境限制**：自然期限等待期间，仅启动了独立临时userData的Electron测试窗口并请求原生导入对话框，未注入路径。系统UI工具返回“Mac已锁屏，自动解锁失败”，无法继续核对选择/取消/保存；已异步请求用户方便时解锁。测试窗口因模态框阻止正常退出，经核对专属PID后终止并删除其独立临时目录。此尝试不算H通过、不影响一小时后端进程。原探针日志的通用`probe-passed`只表示控制循环退出，实际没有执行两项native验证；独立状态记录明确为external-blocked，后续探针已改为只有两项实际检查成立才使用通过标签，并为重跑创建新目录。[限制与清理证据](../../tests/v25/.results/b64/native-attempt.json)。


**独立长时CI门禁（本机已验证门禁逻辑，远端未执行）**：新增[复用工作流](../../.github/workflows/package-lifetime.yml)，由Main/Release调用。job 85分钟、实际测试步骤70分钟，显式启用数据库及自然期限开关，保存Vitest JSON和证据；失败也上传产物且缺产物报错。Release的macOS/Windows打包依赖此job，发布经打包依赖传递。不会由常规25分钟集成job的默认skip替代。新增[校验器](../../scripts/verify-package-lifetime.mjs)要求两个实际用例无失败/skip/TODO、自然原deadline至少完整一小时且检查发生于到期后、Worker干净退出、两组结果完整、4份输入/导出归档与记录hash一致，再生成实际ZIP扫描计划。门禁通过不替代其他发布条件。

| 本次验证 | 实际结果与范围 |
|---|---|
| 门禁与发布依赖单测 | 13P，0.633秒；包含skip、缺用例、不完整/陈旧报告、缩短期限、篡改文件和Worker异常退出拒绝。正向是合成报告/hash单测，不声称真实一小时已结束。[记录](../../tests/v25/.results/b64/lifetime-gate-unit-summary.json) |
| 当前统一检查 | 36/36，28.059秒；[记录](../../tests/v25/.results/b64/lifetime-gate-check-summary.json) |
| 实际默认skip负对照 | 完整文件实际运行1P/1S，命令退出0；校验器退出1，原因Lifetime tests were skipped or left pending。预期拒绝成立，不记为产品故障。[运行](../../tests/v25/.results/b64/lifetime-reporter-negative-summary.json)、[拒绝记录](../../tests/v25/.results/b64/reporter-negative/rejection.json) |
| 内容扫描 | 当前[源码扫描](../../tests/v25/.results/b64/lifetime-gate-source-security.json)和负对照新生成[2份实际ZIP扫描](../../tests/v25/.results/b64/reporter-negative/archive-security.json)均零命中/错误；[文件清单](../../tests/v25/.results/b64/reporter-negative/archive-inventory.json)单独保存，不重复累计早先8份 |

当前1601项源码`dd4d24360e86aefafa67eab3b1dc32849ea66111f41beaaa3bc32391ebff931a`见[门禁源码](../../tests/v25/.results/b64/source-lifetime-gate.json)。相对正在运行的一小时源码c555b61d…仅变更6个CI/校验器/仓库测试文件，[差异](../../tests/v25/.results/b64/lifetime-gate-delta.json)逐文件列明，未改变自然运行的API/Worker/contracts/db依赖。该首次自然运行未启用JSON reporter，不能伪造报告声称它验证了新CI校验器完整正向；自然期限结果按原日志/真实结果记录，专用工作流的实际正向仍需正式运行。T原范围、H、原E及完整迁移保持开放。


**原租约接续与新引用竞争（2026-09-13，本机2P/0F/0S）**：新增[自然租约竞争测试](../../apps/api/src/__tests__/integration/package-import-lease-race.integration.test.ts)，复用真实Better Auth/Hono/PG/S3与正式Worker bin。原导入在实际SDK PUT完成后停于测试屏障；等待原两分钟租约自然经过，再通过同一产品HTTP输入显式启动epoch2。原seed不变，新attempt使用独立对象命名空间。两种顺序分别为清理旧对象后新导入，以及Worker已领取旧对象并停在真实S3 DELETE之前时新导入提交；随后解除屏障，旧请求409、无额外PUT，原回执和新canonical数据不被旧请求覆盖。再等待新对象的原outbox清理时间并维护，旧对象已删除，新来源/资产hash仍一致，重放返回同一结果且不再写入；stage原一小时期限未更改。每种顺序都实际替换Worker PID并正常退出。该测试屏障模拟SDK完成后的API执行停顿，未暂停操作系统API进程，未更改生产S3 30秒超时或租约长度，没有SQL造试跑资格或模型调用。

| 验证 | 最终结果与证据 |
|---|---|
| 两种自然租约竞争顺序 | 2P/0F/0S，490.453秒；每项观察旧租约和新对象清理期限，非只等一个两分钟。[逐项期限/PID/对象数](../../tests/v25/.results/b64/lease-race-results.json)、[原始命令](../../tests/v25/.results/b64/lease-race-barrier-summary.json) |
| 当前统一检查 | 36/36，14.863秒；[记录](../../tests/v25/.results/b64/lease-race-barrier-check-summary.json) |
| 原包API回归 | staging/import/export/真实身份4文件共102P/0F/0S，84.039秒，执行源码dd4d2436…；之后仅新增本测试，已测API/Worker生产实现与这些测试逐文件不变。[记录](../../tests/v25/.results/b64/lifetime-package-api-regression-summary.json) |
| 原Worker回归 | package-cleanup/object-cleanup两文件12P/0F/0S，7.739秒，同样执行于dd4d2436…；含SQL状态fixture，不全部是自然期限。[记录](../../tests/v25/.results/b64/lifetime-worker-regression-summary.json) |
| 扫描 | 当前[源码扫描](../../tests/v25/.results/b64/lease-race-source-security.json)、初败/复验4份实际输入[ZIP扫描](../../tests/v25/.results/b64/lease-race-archive-security.json)，以及API回归4份实际输入/导出[ZIP扫描](../../tests/v25/.results/b64/package-api-regression-archive-security.json)均零命中/错误；文件清单分别留存，不将副本数当独立测试数 |

**首败与修复**：首次用例将S3响应扣住两分钟，生产SDK在30秒先超时，旧请求返回503，两种顺序均未到预期409断言。首轮2F/255.606秒保留于[日志/命令](../../tests/v25/.results/b64/lease-race-first-summary.json)，原源码8f2d172d…的单文件[完整字节](../../tests/v25/.results/b64/lease-race-first-source.ts)与冻结hash一致。该运行加载旧测试变换，但Vitest报错展示代码框时读到了正在修改的新文件；定位以保留原字节及错误断言为准。修正只在真实PUT完成之后加测试屏障，保持生产超时、旧请求409和全部数据/清理断言，再完整2P；[首败台账](../../tests/v25/.results/b64/first-failures.json)记录两次源码和范围。

当前1602项源码`def62aeb5dbbcb092376ab9d72b701c515fecfe4e53f8859c6b3c62cc7b6ecd6`见[源码清单](../../tests/v25/.results/b64/source-lease-race-barrier.json)。相对dd4d2436…只新增这个独立测试文件，原自然一小时运行c555b61d…的全部依赖不变。此增量证明自然两分钟租约及两种新引用交错；一小时期限仍待原进程终态，不关闭B64/F5-X.T。[原范围验收对照](../../tests/v25/.results/b64/lifetime-acceptance.json)保留尚未证明条目。H的Mac仍锁屏，2026-09-13再次系统工具检查确认未解锁；不重复要求用户操作，不影响后端测试。


**B64最终原范围验收：通过（2026-09-13）**。原实际一小时运行从UTC19:23:50.315至20:24:01.862，**2P/0F/0S，3611.546秒**；包含同次预检与自然到期，不能将此前预检另加成独立通过数量。[终态与精确期限](../../tests/v25/.results/b64/natural-results.json)、[实际命令/日志](../../tests/v25/.results/b64/lifetime-natural-first-summary.json)。原期限最晚20:24:00.817，实际检查20:24:01.590；Worker由58420替换为65997，正常退出0。两个实际请求在期限经过时仍被PG锁阻塞，由新Worker先维护；解锁后导入/下载拒绝，过期重试不新增canonical/S3写入。已完成与产品已删除方案的原导入回执可读/重放，不复活数据；12个已采用来源/资产对象hash保持。8次删除事件含一次重复key，独立对象为7个，不把删除事件数当唯一对象数。

两种自然两分钟租约新引用竞争另2P，原API102P/Worker12P及适用check按上述确切源码承接。[原验收逐项对照](../../tests/v25/.results/b64/lifetime-acceptance.json)确认原T完成，仅勾B64。当前工作树另含B65已验PG测试；[源码适用性](../../tests/v25/.results/b64/final-source-applicability.json)证明自然运行c555b61d…的API/Worker/共享依赖未改，不把它改记成最新源码新跑。一小时首轮采用默认reporter，未伪造Vitest JSON；专用CI的真实正向运行仍归发布条件。

本批全部18份实际合法输入/导出ZIP已扫描，结束后按字节hash复核与扫描时一致，零命中/错误；其中包含首败输入及副本。[最终文件及扫描对应](../../tests/v25/.results/b64/final-archive-verification.json)。没有新增ZIP需要重复扫描。H原生选择/保存/Safari/移动文件系统、原E其余、实际CI/全平台包/生产回滚与远程MCP、管理员前置继续保留。

## 5.64 B65：PG中间版本、回填与事务回滚（D03.4已验）

2026-09-13。在一小时原期限等待期间，补齐原D03.4空库replay以外的PG升级矩阵；仅新增[数据库升级集成测试](../../apps/api/src/__tests__/integration/migrate-upgrade.integration.test.ts)，生产迁移SQL与migrateDatabase未改。原SQL按journal前缀逐字复制到临时测试目录，用同一Drizzle迁移器建立历史schema，再由生产migrateDatabase升级latest。每个场景使用同一Testcontainers PostgreSQL中的独立数据库，结束后关闭连接并删除自有库；未读取活动App或用户数据库。

| 原要求 | 实际结果与边界 |
|---|---|
| 每个中间schema→latest与幂等 | 23前缀从0000至0022均通过；另保留原fresh/replay用例。原user/Unicode提示词/JSON/版本/软删时间不变；从0003起已有的scheme/revision/asset身份、来源标记和对象key/hash保持 |
| 结构与迁移记录 | 每个最终schema的列/约束/索引等价fresh latest；23条迁移记录顺序、时间和SHA256与原SQL对应；重复回放记录不变。未新增生产启动时的篡改检测保证 |
| owner/version/document负例 | 每个前缀升级后，跨owner资产更新因FK拒绝23503、version=0与错误document identity因CHECK拒绝23514，失败后原方案记录不变 |
| 历史参考图回填0004 | 同owner重复参考保留最早元数据并建立两条run链接，另一owner使用独立引用；非法ID/非数组不生成引用；名称/MIME/大小回退与原24小时元数据期限按SQL验证。仅PG引用元数据，不是旧S3文件迁移或自然24小时测试 |
| 账号身份回填0009 | 旧new_api_user_id和密文只保留为旧数据；身份/凭据仍unverified、无payer来源/正常会话授权，重复回放不改身份 |
| 执行回执回填0011 | 普通/成功/显式重试/方案/跨owner同key的5份旧回执按原run身份建立，无key记录不造回执；付款绑定、授权与已知费用不臆造；旧cost_points仍留在run，回执cost为unknown/null；原创建/完成时间和请求保留 |
| Agent创建时间回填0022 | 原view.createdAt优先；缺失/null时采用旧updated_at，其他原字段不变；重复回放不续写创建时间 |
| 真事务失败及恢复 | 从前缀1、11、22分别运行余下全部迁移，在实际最后CREATE INDEX处由隔离PG event trigger抛出确认的P0001；此前DDL/回填及journal整体回滚，数据/schema/ledger与开始前一致。撤去故障后正常升级；非生产down迁移/备份回滚 |

最终 **31P/0F/0S（20.460秒）**：新增文件30项（23前缀+4回填+3故障恢复）及原fresh replay1项。[最终命令](../../tests/v25/.results/b65/pg-upgrade-all-backfills-summary.json)、[逐条原验收](../../tests/v25/.results/b65/acceptance.json)。统一检查 **36/36（16.849秒）**，[检查记录](../../tests/v25/.results/b65/pg-upgrade-all-check-summary.json)；[最终源码扫描](../../tests/v25/.results/b65/all-backfills-source-security.json)零命中/错误。本批没有输出方案ZIP或安装器，不把源码扫描写成产物扫描。

最终1603项源码`b88e2b033c0375cdd3d6779d523681f7acbd1ee8d083eb51684231ebf0e096e2`，[清单](../../tests/v25/.results/b65/source-all-backfills.json)。相对B64只新增独立PG测试文件，B64运行依赖未变。逐步扩充的24P、27P、29P和最终31P各按其源码留存，不累加为独立总数；本批没有失败运行，没有通过删除断言或改SQL让矩阵变绿。所有数据为代码合成SQL fixture，不是经脱敏的真实旧库，也不证明账号登录/付费试跑或对象实际存在。

D03.4原范围已通过，只勾B65。真实旧SQLite/备份恢复、双客户端同步与撤权/游标/冲突、四端功能、产物内联迁移及生产部署回滚仍属D03/原E与发布父卡；完整迁移与管理员前置未满足。H当前仍受本机锁屏和其他平台环境限制，后续优先补可独立执行的两设备/真实API同步验收，同时保留H材料条件。


## 5.65 B66：两独立客户端真实同步与恢复（D03.5已验收）

2026-09-13。本批针对D03.5：新增[两进程集成测试](../../tests/repo/v25-sync-two-devices.test.ts)、[进程控制器](../../tests/repo/fixtures/sync-device-process.ts)与[core就地客户端fixture](../../packages/core/src/sync/__tests__/fixtures/two-device-client.ts)。两客户端有不同PID、独立磁盘SQLite和deviceId，通过两个实际Better Auth登录会话连接真实Hono/SyncService/Testcontainers PG。提示词创建/修改、outbox、冲突决议和同步引擎使用生产代码；本地folder/tag目录由测试建行，再经生产repository入队。所有数据库和目录由测试创建、销毁，不读取用户活动App。

| 验收场景 | 已取得的实际证据 |
|---|---|
| 分页与关系 | folder/tag/prompt均实际走limit=1的第二页；空设备bootstrap保留提示词分类和标签引用，SQLite integrity/FK通过 |
| 离线内容 | 断网后本地新建仍在持久outbox中；恢复网络后另一设备可读到相同ID和内容 |
| 三种冲突 | 同一旧版本两设备分别离线修改，真实服务产生local/remote快照；remote、local、duplicate三种决议各自验收，最终两库内容一致，副本有独立ID，队列与冲突清空 |
| 回包丢失与新PID | 服务端已提交后抑制回包交付给引擎；旧PID被SIGKILL，同一SQLite由新PID打开，deviceId与原mutation保留；拉取相同结果自动完成确认。原请求再并发重放返回duplicate，改payload重放rejected，PG实体、changelog与mutation receipt各只有一份 |
| 推送中途撤销 | 实际PG trigger/advisory lock阻塞首条mutation，同时排队撤销设备；pg_blocking_pids证明锁依赖。首条提交后撤销生效，第二条拒绝；本地完整两条队列保留，另一设备可拉取首条并继续写入 |
| 游标过期恢复 | 合成91天历史日志，经生产trimExpiredSyncRecords裁剪后抬高水位；真实HTTP返回SYNC_CURSOR_EXPIRED，本地reset保留两条离线mutation与deviceId；重新bootstrap保留冲突及本地新建，显式决议后两库合流，服务端设备水位不倒退 |
| 全部日志过期 | 两条日志全部裁剪后水位为2；旧设备实际410后bootstrap取得第二版、cursor=2且可继续pull。原device保留；两次并发无操作裁剪不改水位/updatedAt；另一全新owner得到空列表和可用cursor，不泄露旧owner内容 |
| pull与裁剪交错 | 实际HTTP pull读取retention后在device行锁等待；PG blocking pids证明交错，再提交裁剪并释放锁。pull在一致快照中返回第二版delta而非空结果；该HTTP子场景不冒充Electron凭据桥验收 |

**修复一：已提交内容的假冲突。** `DesktopSyncRepository.applyRemoteChange`仅在pending状态、持久请求与当前本地内容均匹配云端快照时完成确认；删除需云端tombstone，upsert需非删除快照。已有显式冲突不自动决议；更新后的不同内容继续保留。就地测试覆盖pull/bootstrap在退避期的相同内容、较新本地修改、删除与upsert的区分。

**修复二：空日志与并发裁剪。** [真实缺陷重现](../../tests/v25/.results/b66/empty-retention-repro.json)证明旧实现删除两条日志后水位仍为0，旧cursor=1收到200/空delta/nextCursor=0，bootstrap却已有第二版。现由`nextSyncMinAvailableCursor`计入本次删除的最大seq；worker条件upsert保证并发裁剪水位不下降、无操作不改updatedAt；API bootstrap/status/空pull的游标至少为retention水位，pull用repeatable read保持水位检查与delta读取一致。不改90天常量，不新增迁移SQL。

| 验证阶段 | 实际结果与证据 |
|---|---|
| 原core修复专项，62b1f744… | 40P/0F/0S，30.582秒：真实两设备7、repository20、engine6、CI守卫7；[摘要](../../tests/v25/.results/b66/final-sync-summary.json)、[测试报告](../../tests/v25/.results/b66/final-vitest.json) |
| 同一core版本完整Electron，62b1f744… | 166P/2外部S/0F/0flaky，1151.046秒；[报告与skip清单](../../tests/v25/.results/b66/electron-full-result.json)。17份实际ZIP扫描零命中/错误，17份故意非法输入单列；[库存](../../tests/v25/.results/b66/electron-full-archive-inventory.json)、[扫描](../../tests/v25/.results/b66/electron-full-archive-security.json) |
| 后端retention修复专项，df6478b1… | 35P/0F/0S，34.306秒：九项真实双设备、DB retention6、core repository20；[摘要](../../tests/v25/.results/b66/retention-sync-summary.json)、[测试报告](../../tests/v25/.results/b66/retention-vitest.json)。根命令虽列worker路径但未收集该文件；其5项单测由下列全仓check实际执行 |
| 当前全仓check，df6478b1… | 36/36，32.122秒；含worker sync-retention单测5P，默认环境的集成skip不计通过；[摘要](../../tests/v25/.results/b66/retention-check-final-summary.json)、[日志](../../tests/v25/.results/b66/retention-check-final.log) |
| 当前源码扫描，df6478b1… | 零命中/错误；[扫描](../../tests/v25/.results/b66/retention-source-security.json)。只证明源码树，不替代尚未生成的各平台安装器 |
| 当前完整API集成，df6478b1… | 40文件、556P/1S/0F，651.460秒；唯一skip为独立开关控制的一小时自然生命周期，本轮未重跑该专用卡。[摘要](../../tests/v25/.results/b66/retention-api-integration-summary.json)、[实际报告](../../tests/v25/.results/b66/retention-api-vitest.json)；实际10分钟生图租约恢复、大包失败清理及2分钟导入租约竞争均通过 |
| 当前完整worker集成，df6478b1… | 9文件、93P/0S/0F，29.396秒；含真实PG retention、对象/包清理、生产bin与进程恢复。[摘要](../../tests/v25/.results/b66/retention-worker-integration-summary.json)、[实际报告](../../tests/v25/.results/b66/retention-worker-vitest.json) |
| 当前API实际归档扫描 | 按本轮起止时间与唯一生成目录归档8目录、10份ZIP（3份真实导出、7份有效合成输入），原件与副本完整hash一致；零命中/错误。[清单](../../tests/v25/.results/b66/retention-api-archive-inventory.json)、[扫描](../../tests/v25/.results/b66/retention-api-archive-security.json) |

**源码归属与首败**：当前1606项源码摘要`df6478b1d5cdc90d523efc62128b0ca8b4a48829654f97966774098cbeec7810`，[清单](../../tests/v25/.results/b66/source-files.json)。完整Electron原摘要为`62b1f7446d442fa5f3b5027a568f0ae8a0480e73a9ae801eaecf93674aad7fb0`，[原清单](../../tests/v25/.results/b66/source-electron.json)与[之后六处后端/测试变化](../../tests/v25/.results/b66/source-retention-diff.json)明确分开：desktop/core未变，后端新行为由当前真实HTTP/PG矩阵与集成验证承接，不能把旧Electron报告改标为新摘要。不同阶段用例有重叠，不累加成完成率。[首败记录](../../tests/v25/.results/b66/first-failures.json)保留测试观测/fixture、类型引用、真实缺陷、扫描配置和检查格式问题。最新check首次因证据JSON缺末尾换行中断，补换行后完整重跑成功，未把中断任务记作成功。

**适用边界**：PR/Main/Release数据库job已接入整份九项测试，RUN_DATABASE_TESTS=1并上传报告；实际远程CI仍属发布卡。Electron两项skip分别需要外部真实账号和真实生图API配置，不能记为通过。Node测试运输层使用真实会话cookie，不代替D03.6 Electron凭据epoch桥、A→B→A/显式adopt或copy；上游New API/S3为受控fixture，设备撤销由测试PG写入控制面状态，不宣称管理员界面；91天时间为合成历史，不声称自然等待。真实旧库、原生文件交付、Windows、全资产GC及生产验收仍按原范围继续，完整2.5与管理员前置保持开放。

**最终逐条验收**：[B66验收记录](../../tests/v25/.results/b66/acceptance.json)核对原D03.5及新增空表/并发缺陷、九份真实场景记录、适用门禁与全部44份保留文件hash（其中17份故意非法输入不计有效归档扫描）。B66/D03.5关闭；D03父卡、四端/发布与完整迁移继续开放。任务包75/82为不同粒度任务的勾选数，不是开发完成百分比。下一项仍为D03.6真实Electron账号切换/同意状态/本机方案隔离，未转入管理员开发。


## 5.66 B67：真实 Electron 换号与同步隔离（已验收，2026-09-13）

**当前结果**：D03.6 三项真实服务场景及完整 Electron 回归通过，原范围逐条核验后仅关闭 B67；D03 父卡和完整迁移继续开放。相对 B66 只有六处测试设施/用例变化，没有新增产品 API、UI、迁移 SQL 或同步实现。[源码差异](../../tests/v25/.results/b67/source-diff.json)、[当前源码清单](../../tests/v25/.results/b67/source-files.json)，1611 项摘要 `1e141feafab4d06bf41c3246a61dae3203e1b97f341e8a03c362b35d9855a24a`。

| 原 D03.6 条件 | 实际验证 |
|---|---|
| 明确复制与新账号不自动接管 | 真实 UI 登录 A，目标库不存在且无同步请求；预览本机库并确认复制全部四条提示词（含三条内置示例），原库保持不变、同意仍 unset、outbox 为空；另行开启才上传 |
| A→B→A 及暂停队列 | A 暂停后编辑、新建两条待同步记录；B 初次登录无目标库、不接收 A 队列，明确建立空库并开启后只上传 B 内容；返回 A 仍 paused，设备/游标/队列保持，明确恢复后仅推送 A 内容 |
| 新进程与本机设计方案隔离 | 同一测试 userData 由新 Electron PID 打开，账号选择、enabled、设备、内容保留，SQLite integrity/FK 通过；独立方案库七张业务表逻辑 hash 在切号和重启前后相同，云端方案/生成数量为零 |
| 真实登录失效与恢复 | 在隔离 PG 中令该测试账号实际 Better Auth session 过期，生产同步 HTTP 返回 401，IPC/UI 为 auth_blocked，待同步 mutation 保留；重新经 UI 登录后原设备和原 mutation 恢复，PG 只有原回执 |
| 已提交的迟到回包 | 生产 API 完成 A push 后代理暂扣回包；实际退出 A/登录 B 并完成 B 写入，再释放 A 回包，B 本机/PG 不变；返回 A 后原队列确认完成，mutation receipt 只有一份 |

| 阶段 | 实际结果 |
|---|---|
| 三项 Electron 专项 | 3P/0S/0F/0flaky，58.016 秒；[命令](../../tests/v25/.results/b67/identity-recovery-summary.json)、[逐项报告](../../tests/v25/.results/b67/identity-recovery-result.json)、[专项及全量共六份实际数据与进程记录核验](../../tests/v25/.results/b67/acceptance.json) |
| 原身份服务进程回归 | 5P/0S/0F，43.952 秒；验证共享代理默认行为、丢登录回包、刷新租约、异常进程与登出竞争；[命令](../../tests/v25/.results/b67/api-identity-regression-summary.json)、[Vitest 报告](../../apps/api/test-results/b67-identity-vitest.json) |
| 同步单元回归 | 50P/0S/0F：IPC24、repository20、engine6；[报告](../../tests/v25/.results/b67/sync-unit-vitest.json) |
| 当前统一检查与源码扫描 | check36/36，8.705 秒；[检查](../../tests/v25/.results/b67/check-auth-fixture-summary.json)。源码扫描零命中/错误；[扫描](../../tests/v25/.results/b67/source-security.json) |
| 同源码完整 Electron | 169P/2外部S/0F/0flaky，1233.223秒；[逐项报告与skip清单](../../tests/v25/.results/b67/electron-full-result.json)。两项需要真实账号/生图配置，保留为发布条件；新跨账号三项无skip |
| 本轮实际归档扫描 | 17份有效ZIP零命中/错误，17份故意非法输入另列；[文件hash清单](../../tests/v25/.results/b67/electron-full-archive-inventory.json)、[扫描](../../tests/v25/.results/b67/electron-full-archive-security.json)。全部留存文件hash已重新核对；不代表尚未生成的各平台安装器 |

**首败与修正**：首次检查发现两个测试清理代码 lint 错误；首次 Electron 命令误把文件名传作 project，未运行测试。实际首轮 0P/1F/2未执行，发现复制断言遗漏新安装内置的三条示例；下一轮 1P/2F，一处同类断言未改全，另一处直接调用真实 IPC 时缺少契约必需 nullable 字段。修正为完整源库比对及 `newPromptDocumentSchema` 形状后，上表三项全部通过；这两类失败属于测试设施，没有修改产品去迎合错误预期。[首轮报告](../../tests/v25/.results/b67/identity-matrix-result.json)、[第二轮报告](../../tests/v25/.results/b67/identity-copy-result.json)保留原结果。

**范围与后续**：测试使用自有临时 userData、真实 Electron/preload/main/core、生产 API bin、Better Auth、PG17，只有上游 New API 为受控 HTTP；不读取正式 App 数据库，也不使用付费图像服务。独立方案的 trial/封面来自合成夹具，仅证明本机库不被切号改写，不冒充真实出图验收。已有账号返回时保留同步同意的行为与生产实现一致，已修正 UI 规范 §7.3 的旧句。真实脱敏旧库、备份故障补验、完整资产 GC、原生文件交付、全部平台发布及生产回滚仍按原范围继续；管理员尚未开始。

**本批验收结论**：[逐条验收](../../tests/v25/.results/b67/acceptance.json)核对三类真实场景在专项与完整回归中的六份记录、账号/队列/回执、进程退出及适用门禁；原产品源码未改，不重复运行未受影响的完整API/worker。UI规范仅纠正既有持久同意语义，未改变界面或视觉基线。为下一项核对的既有旧库23P作为[独立基线](../../tests/v25/.results/b67/legacy-baseline-vitest.json)，不算新增故障补验通过。继续原D03.1–3/7及原E、完整迁移与管理员前置；任务包76/83是勾选数，不是开发百分比。


## 5.67 B68：旧 SQLite 数据等价与备份失败恢复（已验收，2026-09-13）

**结论**：只关闭原D03.2/3合成旧库与备份故障补验；D03.1真实脱敏旧库、D03.7打包内联、原E和完整迁移保持开放。复用D03-A及原生产迁移器，生产代码、历史SQL、契约和UI均未改。当前1611项源码`01efbb13e7e48cb41f7df59d6314b9f86af051e90c406543cd9bc4474b835b0a`相对B67只变化三份测试：takeover-replay、managed-cloud-runtime及zip-reader；[逐文件差异](../../tests/v25/.results/b68/source-diff-final.json)。

| 原验收范围 | 实际验证 |
|---|---|
| 旧库字段、引用与归属 | legacy20的17张保留表逐列逐行比较；原有run/asset与历史转入新增行分别断言。沿用原用例覆盖FTS漂移修复、非ASCII/长相对路径、三种同意、workspace映射、设备/游标/重试/outbox/conflict/tombstone和归档会话；新workspace时间按真实生成区间验证 |
| 历史统一账本 | 成功/失败正文、负面词、参数、提示词引用、provider/model、时间/耗时、图片路径和位置保留；point=12.5不变，cny_cent=725按已有映射为7.25，失败历史不新增图片 |
| 独立方案库 | v4→v8保留所有原业务列、稳定meta与旧journal；真实迁移步骤写表/改数据后抛错，逻辑hash及version4不变，再运行原迁移链成功；重复升级无变化、core库hash不变。这里只证明每个方案迁移步骤原子，不声称跨整条链事务 |
| 备份生成失败 | 自有文件阻止mkdir；两个候选VACUUM目标均为已存在的非空有效SQLite，实际备份失败不修改原库，也不覆盖已存在目标数据。移除测试故障后升级成功 |
| 备份后与事务失败 | 首条待应用SQL、后续写入、最终必需表验证三处失败；已完成的VACUUM副本与原始逻辑hash相等，原库schema/data/user_version/journal完整回滚，移除故障后原库与恢复副本均可升级并重复noop |
| 持久证据 | [28份阶段摘要/8组场景](../../tests/v25/.results/b68/database-stages-final.json)：before、rollback、backup、原库/副本恢复对应hash、版本、integrity/FK，来自实际捕获日志；不保存真实用户正文/凭据 |

| 执行 | 实际结果与证据 |
|---|---|
| 当前源码最终联合专项 | 6文件59P/0F/0S，4.683秒：[命令/终态](../../tests/v25/.results/b68/acceptance-replay-summary.json)、[Vitest](../../tests/v25/.results/b68/acceptance-replay-vitest.json)、[日志](../../tests/v25/.results/b68/acceptance-replay.log)。其中D03四文件31P（fixture6、takeover12、core takeover7、scheme6），相关回归28P（managed runtime16、ZIP12）；不把59项全部称为迁移新增测试 |
| 当前源码统一检查 | `pnpm run check` EXIT0，36/36，26.318秒：[命令](../../tests/v25/.results/b68/stable-check-summary.json)、[日志](../../tests/v25/.results/b68/stable-check.log)。root2522P/29条件S；API普通check不启用integration的556项，另有既有条件skip。该命令通过不证明这些实际外部场景已执行 |
| 源码扫描 | [当前扫描](../../tests/v25/.results/b68/stable-source-security.json)零命中/错误；本片没有安装器或产品导出归档产物，测试自有ZIP随cleanup删除，不冒充正式产物扫描 |
| 继承证据边界 | B67完整Electron169P/2外部S属`1e141fea…`，其生产源码与当前一致；本片只改测试，不重跑整套Electron/API/worker，也不将旧报告改标为当前整个源码摘要 |
| 逐条验收 | [acceptance.json](../../tests/v25/.results/b68/acceptance.json)核验实际59项结果、28记录、源码一致性、门禁与九份证据文件hash；complete仅限B68，overallV25Complete=false |

**首败与修正**：初始VACUUM故障目标为普通文本，得到“not a database”而非预期“already exists”；改为有效非空SQLite并核对目标数据不变。阶段记录helper首次typecheck发现pragma为unknown，补运行时数组判断。其后统一检查2F：ZIP随机大文件level9压缩超时5秒；资产恢复默认1秒轮询未等到请求。原样两文件单独复跑27P，并不由此认定生产缺陷。ZIP测试改用真实STORE条目和确定性16MiB+1字节，明确断言大小错误且将数量上限单列，原压缩炸弹用例保留；恢复fixture等待故障响应实际finish再解除故障，避免“看见请求就取消故障”的竞态，两个阶段使用4秒有界等待、总测试10秒，原回执/资产恢复和零重复POST/扣费断言不变。最终相关28P与统一检查均通过。首败报告：[VACUUM](../../tests/v25/.results/b68/exact-replay-summary.json)、[类型](../../tests/v25/.results/b68/recorded-check-summary.json)、[统一检查两项失败](../../tests/v25/.results/b68/typed-check-summary.json)、[原样复跑](../../tests/v25/.results/b68/failure-repro-vitest.json)。

**限制与接续**：全部数据为原D03-A合成语料及自有临时数据库，保留独立方案v4 scaffold的原provenance限制。尚无获授权真实v2.1脱敏副本，不能宣称全量历史用户数据已验证；SQLite可打开/恢复再升级也不代表旧App可启动。后续按原E补费用/Worker剩余状态矩阵与完整retention/GC，随后原生交付、实际CI/全平台安装签名、生产备份回滚与远程MCP；管理员在完整v2.5验收后开始。


## 5.68 B69：Worker状态矩阵与正式容器（运行可靠性已验，2026-09-13）

**结论与范围**：原W01.1–6/W02.1–6已逐项核验，关闭B69/E-W运行可靠性；完整v2.5、费用/GC、原生交付及发布仍开放。本批只改三份Worker测试/fixture及PR/Main/Release三份workflow，没有修改生产worker、API、SQL、收费或租约规则。当前1612项源码`ba1bf2371605e5380c5db3992c9807f48169557145ac2f76374b096d09b0de92`，对B68的[6路径差异](../../tests/v25/.results/b69/source-diff.json)已核对。

| 状态/条件 | 实际行为与证据 |
|---|---|
| queued，未发送，年龄<5分钟 | 重复reconcile保留完整原行、不主动补队列；随后正常投递仅调用一次。与有效租约和6分钟前queued在同一真实PG/两进程场景比较 |
| queued，年龄≥5分钟 | 实际reconcile按稳定job key补投，成功一次；原进程在领取前被强杀也能由新PID消费原队列 |
| queued却已有sent/claimed | 三种持久防御组合（sent-only、receipt-only、both）均unknown，0新HTTP/资产、epoch不增加；重复投递不改终态回执。这是故意不一致的旧记录防御，正常claim原子写两边 |
| running/cancelling，有效租约 | acquire/reconcile不抢占；旧heartbeat不得延长替代者租约；有效行逐字段不变 |
| running，过期且未发送 | 有可信原授权才允许新epoch继续；旧进程释放后不能发送、markFailed或改写新结果 |
| cancelling，过期且未发送 | 直接cancelled、0图像调用，不借取消意图重跑 |
| running/cancelling，过期且sent或claimed | 失联结果记GENERATION_UPSTREAM_UNKNOWN；已claim但HTTP前、HTTP已受理两种强杀均不重发；不猜测费用为0 |
| 原成功/失败/取消终态 | 重启、重复投递与巡检不增加终态事件/资产；防御unknown回执完整行及revision保持不变 |
| 上传后暂停再取消/巡检 | 原两种取消状态均拒绝迟到finalize，0可见资产；持久孤儿清理经保护复查完成。另有实际API取消+自然租约后恢复旧进程，正文/方案双账本和现有资产不变 |
| active但lease=null | 当前唯一进入running的生产事务同时写epoch和10分钟lease，终局事务才清lease，API取消保留其原lease；支持的状态转换不会生成该组合。SQL/恢复裁决不凭缺失租约授予执行权；本卡不承诺修复任意人工损坏数据库 |
| 正式镜像进程 | 原Dockerfile、非root用户musefold与原CMD实际运行；两轮共4容器具不同容器ID/VM PID。正常退出0；在已受理HTTP时SIGKILL退出137，新容器处理原reconcile为unknown，0重复发送 |

W01的三种终止位置、正常关闭、新PID恢复、取消及成功/上传/清理恢复分别由process18、production-bin3及container2覆盖；W02的旧heartbeat、claim、fail、两种finalize与巡检/清理竞争亦在上述真实PG矩阵及自然期案例中核对。只在未发送分支允许新epoch，上游已发送时新worker写unknown，不制造“新epoch再次生成”的伪场景。完整逐项对应见[12项原要求核验](../../tests/v25/.results/b69/acceptance.json)。

| 命令/证据 | 实际结果 |
|---|---|
| 正式镜像构建 | `docker build --file apps/worker/Dockerfile --tag musefold-worker-b69:local .`，75.449秒EXIT0；实际Linux/arm64，image `sha256:0df9e953357ff92f6ac73004320814d8c980505bbc654217776dab03e21c411c`；[构建记录](../../tests/v25/.results/b69/container-build-summary.json)、[镜像身份](../../tests/v25/.results/b69/image-manifest.json)。构建输入a63b4ba2…，后续仅测试/workflow变化，生产输入逐文件相同 |
| 正式容器专项 | 首次2P/0F/0S，11.600秒，[报告](../../tests/v25/.results/b69/official-container-vitest.json)。此时源码9fbc5616…；随后仅修测试cleanup/格式并接CI，最终完整集成再次实际运行两项 |
| 当前完整Worker集成 | `RUN_WORKER_CONTAINER_TESTS=true WORKER_CONTAINER_IMAGE=musefold-worker-b69:local pnpm --filter @musefold/worker run test:integration`，10文件99P/0F/0S，45.826秒；[命令](../../tests/v25/.results/b69/worker-integration-summary.json)、[逐项报告](../../tests/v25/.results/b69/worker-integration-vitest.json)、[日志](../../tests/v25/.results/b69/worker-integration.log)。18进程+2容器包含其中，不重复相加 |
| 当前统一检查/扫描 | check36/36、33.899秒EXIT0，[记录](../../tests/v25/.results/b69/final-check-summary.json)；[源码扫描](../../tests/v25/.results/b69/source-security.json)零命中/错误。普通check条件skip不算集成执行；上述显式全Worker99P无skip |
| 进程与清理记录 | [20份实际记录](../../tests/v25/.results/b69/runtime-records.json)保存合成run、PID/退出、原回执、epoch/lease、终态事件/资产/对象键hash。逐条核对所有未知费用为null、已记录Provider次数均为1、每run一条终态事件；4个本轮实际容器已删除 |
| 自然期限复用 | B66源码df6478b1…的API资产9P+进程3P；其中6个原10分钟租约等待和1个5分钟清理backoff，7份实际wait记录含不同PID，租约剩余均>9分钟。源码与原断言已复查；涉及真实API取消/参考读取/已上传产物、SIGKILL/SIGSTOP/SIGCONT；[原报告](../../tests/v25/.results/b66/retention-api-vitest.json)、[原日志](../../tests/v25/.results/b66/retention-api-integration.log)。这些API/自然fixture及生产worker逐文件与当前相同，不把它们改标为当前完整API结果 |
| CI接线 | PR/Main/Release先构建正式worker镜像，再显式开启容器测试并保留JUnit；本机执行通过不等于远端CI执行通过，远端结果归E-R |

**首败**：进程矩阵首次17P/1F：补投年轻queued任务时被原带永久before-upstream屏障的fixture worker再次领取，导致等待超时；先等待原任务完成并正常退出该fixture，再由普通worker接收，18P通过。保留[首败](../../tests/v25/.results/b69/process-matrix-vitest.json)与[修后](../../tests/v25/.results/b69/process-matrix-final-vitest.json)。容器首次通过后check发现cleanup在finally抛错会覆盖原异常及一处格式错误；移除动作仍在finally全量执行，清理结果校验移到finally后，当前全量99P/check通过，[首次check](../../tests/v25/.results/b69/container-check-summary.json)。不将这些fixture问题称为生产重发缺陷。

**验收边界**：[acceptance.json](../../tests/v25/.results/b69/acceptance.json)完整核对原12项、当前99P/20记录、7份历史自然等待、镜像身份与12份证据hash。当前进程/容器专项明确调整自有DB的lease来缩短故障测试；自然10分钟证据另列且未改生产默认值。仅Linux arm64本地正式镜像，其他目标架构、远端CI/发布、真实生产部署/回滚及Windows原生行为保持E-R/E-P/E-U范围。容器日志核对已知合成秘密，源码扫描不代表基镜像漏洞扫描、所有镜像层/安装器或整个生产环境安全审计。未知对象无DB意图的发现、完整retention/GC与费用兼容尚待；管理员未开始。

## 5.69 B70：提示词恢复与永久删除竞争（本片已验，2026-09-13）

**修复范围**：API 单条 purge、emptyTrash 和 Worker 30 天 retention。真实 PG 锁交错重现恢复后被删除、错误 delete 同步日志、清空误删后来才软删的行。修复在原服务事务中锁定候选并按确切 ID 删除；不改 UI、schema、30/90 天常量或 usage 审计政策。当前 1613 项源码 `fa9d51c9769f698805e11518b24bfbba6840879fa1f2bc74218fbdf9490b17fc`。

| 验收条件 | 实际证据 |
|---|---|
| 恢复先提交，定期 purge 后执行 | 真实 PG holder 持锁并恢复，retention 等待后重新检查条件，purged=0；正文/usage 保留。首败 2P/1F，修后 retention/runtime 联合 10P |
| 恢复先提交，单条 purge / 清空后执行 | 实际 PromptService restore；单条拒绝删除活跃行，清空返回 0；正文、标签、usage 保留，只存在 upsert v2，不能制造 delete v2 |
| 单条 purge / 清空先提交 | 迟到 restore 返回 PROMPT_NOT_FOUND/404；不产生 upsert；主行与链接消失，既有手动 purge 的 usage 审计保留 |
| 清空期间另一行才进入回收站 | 实际锁住 snapshot join，候选选取后另一行由真实服务软删；只删除初选集合、返回 1，后来记录与 delete 日志保留；下次清空 1，再次 0 |
| 权限及幂等 | 不同 owner 返回 404，正常行拒绝永久删除；其他 owner 完整记录/关联/usage 不变，重复空清理返回 0 |

| 实际执行 | 结果 |
|---|---|
| 修复前 API 确认复现 | 3P/3F，三项均为上述实际竞态；[报告](../../tests/v25/.results/b70/api-purge-confirmed-vitest.json) |
| 修复后 API 定向及既有乐观锁 | 18P/0F/0S，4.243 秒；[命令](../../tests/v25/.results/b70/api-purge-fixed-summary.json)、[报告](../../tests/v25/.results/b70/api-purge-fixed-vitest.json) |
| 修复后 Worker 定向 | 10P/0F/0S，3.856 秒；[报告](../../tests/v25/.results/b70/retention-fixed-vitest.json) |
| 当前完整 Worker | 100P/0F/0S，37.254 秒；[命令](../../tests/v25/.results/b70/worker-integration-summary.json)、[报告](../../tests/v25/.results/b70/worker-integration-vitest.json)。其中正式容器使用本批新镜像 `sha256:7d5de608fad44815495c245414e312cfafcc7b35bd78a1ce8fa72de51461e3de`，Linux arm64、非 root 与原 CMD |
| 当前统一检查与源码扫描 | check36/36，27.935 秒；[命令](../../tests/v25/.results/b70/typed-check-summary.json)、[源码扫描](../../tests/v25/.results/b70/source-security.json)零命中/错误 |
| 第一轮完整 API | 560P/2F/1S，680.125 秒；[报告](../../tests/v25/.results/b70/api-integration-vitest.json)。两项旧方案素材测试触发默认 5 秒期限；[原样专项复验](../../tests/v25/.results/b70/api-materials-recheck-vitest.json)已通过，未修改测试超时或产品代码来掩盖失败 |
| 当前源码完整 API | 562P/0F/1S，704.889 秒；[命令](../../tests/v25/.results/b70/api-purge-typed-summary.json)、[完整报告](../../tests/v25/.results/b70/api-purge-typed-vitest.json)。唯一 skip 是需单独启用的一小时 package lifetime 场景，B64 自然期限证据保持原归属；新 Prompt 6 项均已执行通过 |
| 实际归档扫描 | 两轮重叠 API 执行期间留存 20 份合法 ZIP，其中 6 份实际导出；[清单与 hash](../../tests/v25/.results/b70/api-archive-inventory.json)、[扫描](../../tests/v25/.results/b70/api-archive-security.json)零命中/错误。包含首轮失败期间产物，不逐份臆测属于哪一轮，也不把文件数计为测试数 |
| 逐项验收 | [七项范围核对与证据 hash](../../tests/v25/.results/b70/acceptance.json)已通过，仅关闭 B70；[四路径差异](../../tests/v25/.results/b70/source-diff.json)和[实际镜像/容器](../../tests/v25/.results/b70/image-manifest.json)对应本批源码 |

**源码与首次失败**：定向通过和首轮 API/镜像构建运行在 `b6fd1ea4…`；之后只给新测试的 Promise 联合类型补显式泛型，消除第一次 check 的 TS2345，生产依赖不变。当前第二轮命令本想定向复验，但 `test:integration` 的默认目录与附加路径是合并筛选，实际再次执行整个 API 集成；如实按完整报告计数，不把它写成 6 项专项。原样素材专项22P与当前完整API均通过，首轮两个超时仍保留为失败历史。第一版 API 1P/5F 中另含重复 tag 名和预期错误码不符的两处 fixture 问题；修正后留下 3P/3F 的真实产品复现，历史报告均保留。

**后续边界**：完整 D01/D02 仍待，具体实体/资产差异见[生命周期核对](./V25-DATA-LIFECYCLE.md)。Desktop 500 条清空缺口、Folder/Tag、Session、全量 GC、费用、真实旧库、原生交付和各平台/生产条件不随 B70 关闭；管理员尚未开始。

## 5.70 B71：Desktop 完整清空与失败回滚（本片已验，2026-09-13）

**实际修复**：v25 `prompts.emptyTrash` 原来使用 `listDeleted()`，受 LIMIT 500 约束，且逐条独立提交。现改为原 core `purgeAllDeleted()`，将候选 SELECT 也移到同一 SQLite 事务中；全部 FTS、关联、主行和 delete outbox 同成同败，成功后仅调度一次同步。无 UI、契约、schema 或收费规则变化。当前源码 1615 项 `c91882da55fb61f2da7f41b64335e063d66125acb1fab068ed452b9360ebbb09`。

| 验证 | 实际结果 |
|---|---|
| 原 IPC 缺陷复现 | 修正外部账号夹具后，保留原列表/逐条删除路径，两个真实失败：[报告](../../tests/v25/.results/b71/empty-trash-confirmed-vitest.json)。501 条只返回 500；第二次 DELETE 由 SQLite trigger 抛错时首条及其 outbox 已提交 |
| SQLite 与同步专项 | 29P/0F/0S，1.157 秒；新 2 项、原 Prompt IPC 7 项、同步 repository 20 项；[报告](../../tests/v25/.results/b71/empty-trash-final-vitest.json)。已验证其他 workspace 同 ID、活跃和 legacy 行、FTS/标签链接保留；远端已知 version2 的 501 条 delete outbox，重复清空零变化；故障回滚后可重试 |
| 当前统一检查与构建 | check36/36，42.894 秒，[检查](../../tests/v25/.results/b71/check-fixed-summary.json)；随后明确 `pnpm run build`，3.578 秒，[构建](../../tests/v25/.results/b71/build-summary.json)；[源码扫描](../../tests/v25/.results/b71/source-security.json)零命中/错误 |
| 真实 Electron 专项 | 14P/0F/0S/0flaky，24.762 秒；[报告](../../tests/v25/.results/b71/electron-focused-run-result.json)。新测试由实际 preload/IPC 创建并软删 501 条，清空返回 501、随后 0；关闭后同 userData 新 PID，首尾记录不存在、活跃内容保留、再次清空 0。另 13 项为既有提示词交互/双主题视觉回归 |
| 完整 Electron | 170P/0F/2S/0flaky，1306.953秒；[命令](../../tests/v25/.results/b71/electron-full-summary.json)、[逐项报告及skip清单](../../tests/v25/.results/b71/electron-full-result.json)。新501条场景实际执行通过；两项分别缺实网账号测试密码及真实中转站key，均未执行，不计通过 |
| 实际归档扫描 | 17份合法ZIP、17份故意非法输入、0份明确UI替身分类留存；[清单及hash](../../tests/v25/.results/b71/electron-full-archive-inventory.json)、[合法输入扫描](../../tests/v25/.results/b71/electron-full-archive-security.json)零命中/错误，非法输入不伪装成合法包扫描通过 |
| 原范围逐项验收 | [六项核对及证据hash](../../tests/v25/.results/b71/acceptance.json)通过；两轮实际IPC/PID附件分别保留。相对B70仅四路径变化，API/worker/DB无改动，未重复执行其全集 |

**首败及范围**：最初新测试两个失败中，501 条场景先碰到 foreign fixture 没有账号主行的 FK 错误，另一项已实际证明部分提交；补齐外部账号后重新保留原 IPC 得到上述 500/501 和部分提交两个实际失败。修复后首次统一检查发现新 E2E 的空解构 lint，已修并全绿；首次 Playwright 命令误把文件名作为 project、未执行，改用 `--project=electron` 后 14 项通过。保留原失败，不更改生产规则迎合夹具。B70 API/worker 生产依赖未被此 Desktop 改动修改；完整回收站分页、Folder/Tag、Session 和 GC 仍按原 D01/D02 接续，仅 B71 清空切片关闭，完整迁移保持开放。独立审查已实际复现云端置顶/微秒分页漏项及桌面查询截断、显式workspace写后读取错误，见[生命周期§5](./V25-DATA-LIFECYCLE.md)；这些尚未修复，不计入本批验收。


## 5.71 B72：云端提示词分页完整性（本片已验，2026-09-13）

**已修行为**：保留原四种 API 排序。最近更新游标加入 `is_pinned`，时间边界直接保存 PostgreSQL 六位微秒，不经过 JS Date 截断；标题游标使用数据库 `lower(title)`，避免 JS 与 PG 的 Unicode 大小写转换差异。SQL 继续带 owner 和原过滤条件，锚点删除后仍可按其值继续。实体公开时间字段、schema、费用与 Desktop 产品源码未变。

**游标边界**：使用带版本和 sort 的内部游标，严格检查必要字段、日期/整数范围、非法 NUL 和 sort 变化。旧游标缺失置顶状态及精确时间，无法可靠恢复原边界，因此返回 `VALIDATION_FAILED` 并提示刷新列表；不猜测状态或静默跳回第一页。这是读取分页的恢复策略，不修改用户记录或权限。

| 执行阶段 | 实际结果 / 证据 |
|---|---|
| 原实现的新增验收集 | 12P/19F/0S，[31项报告](../../tests/v25/.results/b72/pagination-repro-vitest.json)、[命令](../../tests/v25/.results/b72/pagination-repro-summary.json)。失败含置顶漏项/重复、微秒遗漏、Unicode遗漏和新增游标验证要求；旧格式被拒绝属于本批明确的兼容策略，不能将19项都描述为19个独立生产缺陷 |
| 首轮修复专项 | 43P/0F/0S，4.858秒，[报告](../../tests/v25/.results/b72/pagination-fixed-vitest.json)；新31项加原Prompt purge及路由12项 |
| 扩充筛选与校验专项 | 54P/0F/0S，6.401秒，[报告](../../tests/v25/.results/b72/pagination-final-vitest.json)。新42项覆盖四sort/多页尺寸/同值ID/微秒/Unicode/锚点删除、owner与搜索/置顶/回收站/文件夹/多标签、字段缺失与畸形游标；另12项为原回归。源码35f6cf4d…，随后仅给新增测试的deletePrompt调用补明确expectedVersion=2以符合类型签名，生产代码相同 |
| 当前统一检查 | check36/36，31.085秒，[记录](../../tests/v25/.results/b72/check-fixed-summary.json)；当前1616项源码 `43cfe90d8cd87e7fc21835140035957c6fdf8da5b5fdfd1ea77ae40b6f5eafa1`。普通check中的数据库条件skip不能算集成通过 |
| 当前源码扫描 | [扫描报告](../../tests/v25/.results/b72/source-security.json)零命中/错误；不替代新实际ZIP或安装包扫描 |
| 完整 API | 604P/0F/1S，647.276秒；[命令](../../tests/v25/.results/b72/api-integration-summary.json)、[完整报告](../../tests/v25/.results/b72/api-integration-vitest.json)。新42项全部通过；唯一skip为单独启用的一小时自然期限测试，历史B64证据不改标为本轮 |
| 实际归档与验收 | 本轮8个自有目录10份合法ZIP（3份实际导出）；[清单及hash](../../tests/v25/.results/b72/api-archive-inventory.json)、[扫描](../../tests/v25/.results/b72/api-archive-security.json)零命中/错误。[七项逐条核对](../../tests/v25/.results/b72/acceptance.json)通过，仅关闭B72 |

**首次统一检查失败**：6个自有临时审查/草稿TS文件被根Biome遍历，触发格式检查并中止其他任务。原输入已完整归档为`.source.txt`，正式新增测试仍在API测试目录；[路径映射](../../tests/v25/.results/b72/scratch-source-archive.json)、[原失败日志](../../tests/v25/.results/b72/check.log)保留。未修改lint/test排除规则、未删除正式测试；修后完整check通过。

**未完成范围**：B72本片已验收，完整迁移仍未关闭。Desktop普通/搜索/回收站列表上限、显式workspace写后读取和共享deletedOnly回收站接缝继续原D01.1/2；四种排序的跨宿主完整parity、Folder/Tag/Session/GC、费用及发布条件保持开放。B71的170P/2实网条件S只证明对应桌面源码与场景，不改标为本批云端全量结果。


## 5.72 B73：Desktop SQL 分页与回收站查询（续篇）

B73已验收：当前check/API专项及真实三端专项、完整E2E476P/7S和实际归档扫描通过，仅关闭本卡。为保持单文件行数限制，详细范围、首败、源码归属和验收出口接[测试记录续篇§5.72](./V25-MIGRATION-TESTING-CONTINUED.md)。
