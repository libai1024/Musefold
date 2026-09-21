# Musefold v2.5 数据迁移方案

> **状态**:已批准
>
> **日期**:2026-08-28
>
> **前提**:线上无真实用户(账号事实源为自托管 New API 网关);数据迁移的保护对象是开发者本机桌面数据与自托管环境的可重建性。

## 1. 桌面 SQLite(唯一必须保数据的线)

开发者本机的提示词库、历史与设置必须在升级到 v2.5 构建后完整可用。

流程(M4-e 已落地,实施细化:**原位接管而非搬运**——legacy 链终态即 Drizzle baseline,零数据拷贝零语义变换,风险面最小):

1. **对齐**:首启仍先跑 core legacy 迁移链(0001→0020)把旧库带到终态(user_version=20);非终态旧库拒绝接管并报错;
2. **备份**:接管一瞬 `VACUUM INTO` 生成带时间戳备份(userData/backups);
3. **接管**:`@musefold/desktop-db` 的 baseline(终态 `sqlite_master` 忠实导出,含 CHECK/partial 索引/FTS5)对既有库 fake-apply 标记为已应用,全新空库则真跑 baseline(不再走 legacy 链);随后应用 Drizzle 增量迁移(首个:0001 workbench_drafts);
4. **校验**:按当前 `REQUIRED_TABLES` + FTS + `__drizzle_migrations` 完整性断言,缺一拒绝启动;
5. **后续增量**:schema 变更全部走 `drizzle-kit generate` → 手工审阅 → `db:bundle` 内联(Electron 生产包无 fs 依赖)→ 启动时 migrate;core `run-migrations` 冻结在 0020,M5c 删除。

测试(`packages/desktop-db/__tests__`):「baseline 空库 ≡ legacy 链库」逐表列/索引一致性、既有库接管零搬运保数据、备份可开、重入 noop、增量迁移在被接管库上生效、非终态拒绝。

## 2. 服务端 PostgreSQL

无真实用户,**不做旧库 introspect,不做兼容层**:

1. `packages/db` 直接定义全新 Drizzle schema,生成 baseline 迁移;
2. 自托管环境重建数据库(旧 `apps/web-api` 的 13 个迁移与数据作废);
3. 后续变更遵守 expand/contract:写行与 drop 分属不同迁移,破坏性 SQL 必须在 PR 中显式标注。

## 3. 账号体系

- 事实源:New API 网关(自托管)。用户名/密码、余额、兑换码、模型令牌均在 New API 侧,不迁移。
- Musefold PG 侧只有:用户关联记录(Musefold user id ↔ New API 身份)、Better Auth 会话表、MCP OAuth 客户端与 grant 表——全部新建,无历史包袱。
- 桌面端已登录状态在升级后失效一次(重新登录),同步开关按「登录 ≠ 同步」语义保持关闭,由用户显式开启。
- MCP 客户端按 2026-07-28 规范(CIMD)重新授权,旧 grant 作废。

## 4. 热更与升级通道

- 无存量用户,不设旧客户端兼容窗口;旧安装包直接作废,v2.5 起重新分发。
- electron-updater feed 与签名密钥沿用现有配置;`update-protocol`(Ed25519 内容热更)协议不变,v2.5 构建重新出首个 manifest。

## 5. 不可逆动作清单

以下动作执行前必须确认对应批次验收已过:

| 动作 | 所在批次 | 前置 |
|---|---|---|
| 删除旧 `apps/web-api` 与其迁移 | M2-07 | 新 api 部署成功且 E2E 通过 |
| 自托管 PG 重建 | M2-07 | 同上 |
| 删除旧渲染层与旧包 | M4-e / M5-c1 | 对应域双端 E2E + 快照全绿 |
| 删除 Python 测试栈 | M5-a1 | Playwright Electron E2E 覆盖等价场景 |

代码批次可以回退到 `v2.5-baseline` tag；数据库回退须先核对 schema 兼容性并使用经过校验的迁移前备份，不能将 git 回退等同于数据库回退。

## 6. 实施期增量与账号证据恢复（2026-09-08）

前五节的“无真实用户/重建”是 08-28 架构重置时的前提，不是清空当前开发库、既有 v2.5 数据或用户本机库的授权。当前 B12 对已经存在的 PG 旧行采用增量迁移和保留证据的恢复流程：

- `0009_mean_hercules.sql` 增加受管身份、会话授权与恢复申请，旧 credential/relay 缺少可信来源时保持未验证，不用当前上游地址或可变用户映射自动回填历史 payer。此前真实 0008→0009 与迁移 replay 的通过记录见开发记录。
- `0010_account_recovery_backup_evidence.sql` 增加隔离备份证据表和到期清理索引；不恢复旧 BA/OAuth bearer，不将暂存证据自动激活。源库须隔离恢复到受支持的 0008，固定完整证据集合、部署/谱系/issuer 与独立审定记录后，经 CLI inspect/stage 和原申请人重试再次核对。
- 备份工具不执行整库 restore；不得让旧库 worker 处理历史 queued run，也不得覆盖现库执行与费用记录。历史执行付款归属和非删除回执由 SP-P2/P3 单独迁移/验收。
- 申请/证据到期即时拒绝使用；成功恢复在事务内清除对应暂存密文，worker 周期清理到期候选/备份密文并保留非秘密来源记录。

实际命令、支持范围、失败回退和操作权限见[可信备份恢复运维流程](./V25-ACCOUNT-RECOVERY-OPS.md)；阶段结果见[开发记录 B12](./V25-DEVELOPMENT-LOG.md)。本节不宣称真实生产备份或生产恢复已经执行。

## 7. 执行回执增量与联合升级（B13，2026-09-08）

B13 的 SP-P2/P3 已通过本机实现与合成验收：最终空库实际 CLI、旧行 PG 集成、API/worker 完整集成及全仓 check 通过；未执行生产迁移、容器部署、新 UI E2E 或安装包。以下上线/回滚流程是待执行任务约束，不是已发生的生产操作。后续 B14/P4 接线必须另记源码与证据。

### 7.1 表结构、保留规则与旧行回填

`0011_generation_execution_receipts.sql` 新增独立 `generation_execution_receipts`（22 列）及 generation run 的可空关联。回执以 principal+idempotencyKey 唯一，并记录原 run、操作、逻辑/最终请求摘要、冻结 binding、授权会话版本、发送/费用来源与清理时间。它不通过 user/session/run/scheme 外键级联删除；run→receipt 的复合外键约束主体一致。运行历史与资产可以清理，接受过的请求键继续保留。

历史迁移保留以下区别：

- 有 key 的旧 run 回填 `legacy_unbound`，没有 key 的旧 run 不凭空生成业务 key。binding、授权会话及两种新摘要均为空；不借当前 credential 推定历史付款人。
- 真实 `designSchemeRunId` 关联判定方案操作，不能只看 `scheme:` 前缀。旧 `runKind=retry` 也可能来自普通 create 参数，因此记 `legacy_unknown`；仅该歧义旧 retry 保留 parent 作为来源线索，普通 refinement 的 parent 留在原 run，receipt.sourceRunId 为 null。
- 旧成本值仍在原 run；回执以 unknown/null 保留未核实状态，不把估算升级成账单，也不把旧 false 发送标记一概解释成免费。
- 迁移前已经硬删、没有独立 key 证据的历史无法重建。旧备份只能用于受控核对与数据恢复，不能覆盖当前回执表后重新派发旧队列。

新 bound 回执要求完整冻结 binding、授权会话/版本与两种摘要；`legacy_unknown` 只能保持 `legacy_unbound`。unknown 费用必须为 null，provider_reported 必须有金额且不能是负数；数据库约束区分来源，但不能自行证明上游账单真实。旧成功行或已有发送标记的行保守记 claimed，其余 not_started；旧 false 不足以回填 confirmed_not_sent。

API 新入队时使用真实 BA sessionId（不是工作台 sessionId），与 worker 共用账号事务校验和归一请求摘要。校验按 user→identity/credential→BA session/authorization 的顺序加共享锁，验证主体、两端 issuer、payer、凭据 ref/version 与正常有效授权；worker 在参考图读取后、claim 事务中重查冻结信息和 run epoch，再使用该事务返回的固定密文快照。API 原子写回执/run/队列；purge、empty-trash 和 worker retention 先锁 run，再更新独立回执。不能把单独表升级当成这些运行时保护已启用。

### 7.2 本机迁移验证与保留的历史结果

| 场景 | 最终实际命令/断言 | 结果与边界 |
|---|---|---|
| 新空库 CLI | 根 `pnpm run db:migrate` 连跑两次，DATABASE_URL 由 runner 注入到本任务拥有的 disposable `postgres:17-alpine` | 09-08 10:52:17 开始，两次 exit 0；迁移账本 12、receipt 22 列、run ref 存在、receipt 0；容器清理 exit 0。[最终报告](../../tests/v25/.results/b13/migration-summary-final.json)；03:51 [首轮](../../tests/v25/.results/b13/migration-summary.json)另存，不覆盖 |
| 有数据 0010→0011 | 开启 RUN_DATABASE_TESTS 并向 runner 提供任务专用 DATABASE_URL；`pnpm --filter @musefold/db exec vitest run src/__tests__/generation-execution.integration.test.ts`。测试在该隔离 PG 内另建自己拥有的数据库，先程序化迁到 0010，写入 5 条旧 run，再 migrate/replay；不是根 CLI 场景，也不是 dump/restore | 10:52:24，1 文件/5 passed、0 failed/skipped、退出 0；容器清理 0。[最终报告](../../tests/v25/.results/b13/db-integration-summary-final.json)。03:57 [首轮 5 项](../../tests/v25/.results/b13/db-integration-summary-first.json)发生于 refinement source 修正前，只作历史 |
| 回填与约束 | 5 条旧 run 包含普通、歧义 retry、带 parent 的 refinement、真实方案关联及 unkeyed；回填 4 条回执。断言旧 binding/授权/摘要为空、unknown/null、refinement 原 parent 不变/source null、仅 retry 保留 source；同 principal/key 唯一、跨 principal 同 key 可用、主体不符的 run ref 拒绝 | 同一最终 5 项覆盖 bound 完整性/费用约束、删除 run/方案/user 后 receipt 与 key 保留、真实账号锁阻止凭据并发更新且之后拒绝旧 binding；不能累加成另一套 5 项 |
| 与运行时合流 | `pnpm --filter @musefold/api test:integration` 13 文件/188 passed；`pnpm --filter @musefold/worker test:integration --reporter=verbose --silent=false` 8 文件/83 passed；`pnpm run check` 35/35、0 cached | 均实际 exit 0；API/worker 使用合成账号和 loopback HTTP/S3，含三入口原子入队、清理保留、最后 claim 及实际 worker bin 退出/重启。原始报告及失败史见[测试手册 §5.6](./V25-MIGRATION-TESTING.md#56-b13执行回执与发送身份2026-09-08本机实现与合成验收通过) |

首轮通过后审查发现普通 refinement 的 parent 被误用为 receipt 重试来源，随后修 0011 的 backfill 并补 seed/断言；上表最终两类 PG 验证均在修正后重新执行。schema 没有变化，未伪造新增 migration/snapshot。初期 DB 静态检查的项目引用/SQL 断言问题、API fixture 失败与 worker 实际 bin 双重 stop 缺陷均按当轮保留在[开发记录 B13](./V25-DEVELOPMENT-LOG.md)，不写成数据库迁移失败或隐藏为一次性全绿。

### 7.3 联合上线与回滚入口（待生产验收）

1. 暂停新增云端执行，排空或隔离旧 worker；记录在途 claim/发送/未知回执，不能为腾空队列把 unknown 改为未发送。确认目标库与新旧代码范围，保留经过校验的迁移前备份和独立执行回执恢复策略。
2. 先在隔离库验证目标 schema 与 0011/replay，再在受控目标执行根 `pnpm run db:migrate`；连接串只通过受控进程环境提供。核对旧行回填、约束、receipt 与 run 关联，不以空库 receipt 0 作为有旧行目标的预期值。
3. 联合启用识别 binding/receipt 的 API 和 worker，两个服务的 PUBLIC_BASE_URL、NEW_API_BASE_URL 与凭据解密配置必须一致；不得让旧 worker 消费新队列。验证正常入队、同键只读查询、发送身份拒绝、清理后 key 保留与停机/重启后 unknown 不重发，再恢复提交。
4. 失败时保持新提交和队列处理暂停，保留当前回执与未知状态；按实际 schema 兼容性选择前滚修复或兼容代码回滚。旧备份的数据恢复必须与当前回执保留分开核对，不能用覆盖整库的方法消除已接受 key 后重新执行。

仅落表不能获得发送校验：旧 worker 不认识这些字段，旧版本代码不能随意接回新队列。代码回滚仍须保持处理队列暂停，核对新 schema 与回执兼容性；不得以旧备份覆盖回执或将已 claim 的请求当作未执行重新入队。B13 本机实际结果与尚未执行的目标平台/生产检查见[测试手册 §5.6](./V25-MIGRATION-TESTING.md)。

本机已直接 fork 真正 worker production bin 验证 SIGTERM、SIGKILL 后新 PID 和重复投递；它仍是 Node/tsx + disposable PG/loopback 服务，crash 恢复使用任务库显式解锁/lease 到期，不是部署容器或自然超时证据。真实生产备份/恢复、签名安装包、实际账单和跨部署回滚仍须另验；SP-P4 的桌面托管连接及本地旧备份恢复没有因 0011 自动完成。


## 8. 本地防回退检查点基础（B15，2026-09-08）

SQLite `0008_thin_ezekiel_stane.sql` 仅增加 `managed_execution_checkpoint` 单行表（id=1、lineage_id、namespace、revision、head_hash、last_operation_id），不删除或重写旧业务表。revision 受安全整数范围约束，head_hash 为 64 位小写十六进制。Drizzle schema、snapshot、journal 与内联 bundle 同步生成，现有迁移链为 9 项；启动完整性列表增加该表。原 legacy 接管流程未改动。

真实 0007 结构先写预算与使用额，再升级并重放迁移，验证数据、外键及 integrity_check；checkpoint 仍为空。此前费用账本的 0006→0007 回归固定到原始迁移范围，避免新增 0008 后 slice(0,-1) 悄悄改变测试含义。生成器复跑报告 No schema changes，bundle freshness 通过。详细结果与对应源码清单见[测试手册 §5.8](./V25-MIGRATION-TESTING.md)。

该表只提供后续受管业务事务的控制记录。正式备份目前仍可能覆盖整个 data.db；B15 不修改 restoreBackup，不自动建立密文锚，不自动选择云端托管连接。后续必须先完成 safeStorage 主进程装配、预算/远端关联同事务接线、恢复生命周期隔离与安全备份保留，才能对用户承诺业务防回退。降级前也须核对运行时代码，不能删掉 checkpoint 或降低锚版本来解除限制。


## 9. 正式备份恢复与数据库访问隔离（B16，2026-09-08）

没有新增 SQL 迁移。正式 restoreBackup 现核对原备份与 staging 的完整性、旧 user_version 及 Drizzle 迁移前缀；user_version 不变也不能接收未来/改写/缺段迁移链。有效恢复从校验阶段排他，进入 DB 隔离后使旧生命周期 token 失效；getDb/initDb 不得在同一进程惰性重开恢复库，closeDb 也不清除隔离状态。

文件替换前排空已登记托管操作、停止同步，以旧句柄创建独立保留的 `recovery-safety-*` 安全备份，再用真实 safeStorage 写 restore_pending。旧用户没有托管标记则不创建锚；已有标记但密文异常则拒绝替换。文件安装失败尽力回迁原 DB，进程仍须重启；安全副本不参与普通十份保留清理，也不自动降锚来继续花费。

安全存储与正式恢复专项/真实 Electron IPC 的证据见测试手册 §5.9。托管连接、远端调用关联、预算全入口、显式匹配备份后的核对/恢复准入，以及 Windows 原生/断电/整机回退仍待后续验收；本节不是完整预算防回退或部署恢复完成声明。


## 10. B17：桌面托管生成的持久请求关联

SQLite 新增 `0009_dizzy_revanche.sql`，由 Drizzle schema 生成并内联进 desktop-db bundle（累计十条）。单表六列提供 request/call/issuer/principal/key 索引与严格 JSON 记录：保存原始请求、namespace、authEpoch/runtimeEpoch、固定 binding、提交状态及最新远端回执。请求与 call 有外键且不级联删除；不可清理该表来重置幂等键或预算。

旧 0008 库升级只创建空表，不凭当前账号补写旧调用，不生成锚或 namespace。真实 SQLite 旧库迁移/replay、预算保留及完整性校验在 B17 专项中验证；最终报告见 [测试手册 §5.10](./V25-MIGRATION-TESTING.md)。PG 本批没有新迁移，沿用 B13 的 0011 receipt。正式旧库/备份恢复、用户托管启用和全部预算入口仍按 P4/P6 联合验收。

## 11. B18：启动补记与远端访问生命周期

没有新增PG/SQLite迁移。`createDesktopGenerationPersistence` 初始化时会从本地终态补记旧Automation请求；本批新增排除 `managed_generation_requests` 关联，避免调用B17已禁止的通用finish而初始化失败，也避免本地失败覆盖远端unknown。真实SQLite回归证明请求保持running/unknown，零外部发送。

新客户端/账本工厂捕获账号与数据库访问资格，参加B16恢复排空，回调退出后失效；晚到回包不能写恢复后的库。正式用户提交、所有共享预算写入口及匹配备份核对仍待联合接线，不据本批修改重新计算迁移版本或宣称完整恢复通过。阶段证据见[测试手册 §5.11](./V25-MIGRATION-TESTING.md)。

## 12. B19：共享预算写保护（无新增迁移）

本批没有改变schema或迁移链。合法0007数据在checkpoint表创建前仍可初始化预算；当前受管库有检查点后不能直接重建丢失策略或重新导入electron-store的旧用量。主进程预算更新另核对独立锚，旧备份缺表/缺标记不等于从未启用。

旧托管请求即使没有remote关联，也不能通过通用recover/本地终态补记释放预算；保留数据待核对，不补写付款身份。明确用户启用时仍须处理旧在途与内存预留，不能以拒写替代恢复。真实SQLite与Electron预算/重启证据见[测试手册 §5.12](./V25-MIGRATION-TESTING.md)。

### B25：恢复确认的控制协议兼容性（无数据库 DDL）

本批只给本机加密锚操作增加 `kind=resume`。SQLite/PG schema及迁移链未变化。显式恢复确认先持久pending，最后同步核对当前账号/数据库/到期并CAS到下一revision；同lineage和namespace保持不变，业务记录和费用不改。已提交但尚未整理的pending可通过to与SQLite精确匹配确认；未提交则仍受限，须新review，不能删锚解锁。再次恢复先写query_only，不被已知提交识别绕过。

较旧二进制不认识pending.resume时会按schema读取失败保持受限，不能降低版本、删除pending或重写锚来绕过；应使用理解该协议的版本核对。整理完成后的锚继续使用既有version=1结构。成功resume现在revision+1，先前匹配的备份随后属于旧检查点，不能据其反向恢复消费资格。真实进程故障与备份证据见[测试手册 §5.18](./V25-MIGRATION-TESTING.md)；不承诺整机断电或同时回滚数据库和系统密文的可恢复性。

### B26：重试关联的 JSON 兼容性（无数据库 DDL）

managed_generation_requests 的严格 JSON 新增 `retryOf: null | { requestId, remoteRunId }`，本机旧普通记录缺此字段时解析为null；重新持久化时写入规范形状。普通记录原 inputHash/remoteKey 计算保持原规则，新重试额外将父 requestId 纳入输入哈希，防止同 key 替换父任务。本机已证明未发送取消没有 remoteRunId，下一次新授权用 ordinary_create；远端已有父任务时使用 explicit_retry，回执需匹配对应父ID。

PG/SQLite 表结构、迁移链、受管版本不变。较旧 strict schema 二进制无法理解新增字段，应保持读取失败/受限，不据“无DDL”承诺任意降级；不得删字段、删账本或改锚来恢复发送。升级读旧普通记录的合同测试与当前记录新PID恢复已有证据，完整旧用户库/跨版本安装包兼容仍待真实迁移和发布卡。

API 新 retry 仅接受可靠已知终态/费用和原 payer；缺回执/legacy_unbound 源记录须先完成核对，不能制造绑定。已接受 idempotency key 仍先走原意图重放，不因新准入规则改写其历史身份。实现和测试见[测试手册 §5.19](./V25-MIGRATION-TESTING.md)。


## 13. B34：云端来源准备及对象索引（2026-09-09）

PG 追加 `0012_black_orphan.sql`（`design_scheme_source_preparations`）和 `0013_freezing_grandmaster.sql`（source_files.object_key 索引）；由 Drizzle 生成，含对应 snapshot/journal。复合 owner/execution 主键、snapshot/owner 外键及 ready/status 检查约束限定准备状态，上传租约和到期字段支撑有界退役。旧 0000–0011 SQL 不改写，SQLite 与 desktop-db 本批无迁移。

来源集成先在 disposable PG17 应用至 0011 并种旧用户，再实际调用根 `pnpm run db:migrate` 到最新；最终 API 集成验证旧用户保留、跨 owner FK 拒绝及来源生命周期。旧 0011 测试改为检查它仍在原 journal 位置，不再禁止追加迁移。该证据不等于全部受支持 PG 中间版本、生产数据量或真实旧用户库的完整 upgrade 矩阵。

这是 expand 迁移，不执行 destructive down。未来部署须先运行迁移，再部署使用新表的 API/worker；回退旧二进制时新来源对象的维护责任必须保留，不能默认旧 worker 能清理新对象。发布卡仍须验证数据规模、索引锁影响及版本回滚组合。来源准备行/元数据保留作为幂等墓碑；账号删除和长期元数据 retention 仍由完整 G-DATA 治理。

数据事务、清理与验收证据见[来源验证](./V25-CLOUD-SOURCE-VALIDATION.md)和[测试手册 §5.27](./V25-MIGRATION-TESTING.md)。


## 14. B35：Agent 会话和来源 queued 状态（2026-09-09）

PG 追加 `0014_workable_firestar.sql`，含 `design_scheme_agent_sessions`、`design_scheme_agent_events`（owner/execution/seq 复合键与父 owner 外键）、到期/更新时间索引；来源准备状态允许 queued。初始会话与全部 queued 来源、事件、Graphile job 同一事务提交；失败不留下半登记会话。取消先于启动保留 requestHash/request 为 null 的明确墓碑，普通执行必须保留规范请求/哈希，不能清表重置同 ID。

实际集成从复制的 migration journal 截止 0013 构建旧库、种原来源行，再调用根 `pnpm run db:migrate` 升到 0014，确认旧记录保留。B34 从 0011 升最新的集成也继续运行。无 SQLite/desktop-db 迁移，不改旧 0000–0013 SQL。

上线顺序：先升级 PG/Graphile，保证受管 bucket 可用，再部署新 Agent 消费角色及 API。旧 image worker 不识别新 Agent 任务；只更新 API 会留下 queued 会话。回退二进制必须保留理解 queued/Agent 状态的新消费者或先暂停准入并排空/取消已登记任务，不能假定旧清理代码理解新增来源状态。生产规模索引开销、事件/元数据保留和完整回滚演练仍归 G-DATA/G-RELEASE。

迁移记录及实际/未验范围见[会话验证 §7](./V25-CLOUD-SOURCE-VALIDATION.md)和[测试手册 §5.28](./V25-MIGRATION-TESTING.md)。


## 15. B37 文本授权及调用记录（2026-09-09）

Drizzle追加 `0015_lively_scourge.sql`、snapshot/journal，仅新增text_executions/text_calls两表及约束；旧0000–0014 SQL、SQLite/desktop-db不变。owner/execution复合外键保证所属，ordinal限制0–16，角色/状态/完成输出一致性由数据库检查。text_executions保存原authSessionId但不建立session删除级联，退出登录不能抹去已领取调用；owner/父会话级联仍存在，账号删除与历史保留须按完整治理要求验收。

迁移验证从0014隔离库种旧来源/取消会话，实际执行根 `pnpm run db:migrate` 到0015并验证旧行保留且text授权表为空。旧会话没有text授权不会自动付费。生成的两份JSON元数据只做格式整理，前后解析值等价证明存B37报告；SQL没有借格式修复改写。

部署必须先expand PG，再同时提供相同模型配置的API和scheme-agent消费者。只更新API或回退到不理解compiling/text_calls的旧消费者会遗留任务；应停止新准入并排空/保留能处理文本记录的消费者，未知调用不得删表重置后重试。不执行destructive down，不因旧二进制不认识新状态承诺任意降级。生产规模扫描索引、prompt/事件保留、账号删除和完整回滚矩阵仍属于G-DATA/G-WORKER/G-RELEASE，见[测试手册 §5.30](./V25-MIGRATION-TESTING.md)。


## 16. B38 修订基线和Reviser角色（2026-09-09）

Drizzle追加 `0016_material_marvel_apes.sql` 与snapshot/journal：text_executions增加nullable `revision_base`，保存服务端冻结的expectedVersion/canonical document；text_calls的角色约束扩展reviser。旧0000–0015 SQL不改，SQLite/desktop-db不变。已有create授权行的revision_base保持null；新modify在服务内要求实际基线，不能从旧行自动推断修改意图。

新增集成先在隔离PG17应用至0015，种旧取消会话、旧来源、已有text_execution及unknown compiler调用，再实际运行根 `pnpm run db:migrate` 到0016。验证旧行和unknown原样保留、旧revision_base为null，新reviser可被持久。该JSON授权为迁移夹具，不是可执行身份；生产资格仍由严格合同和实际身份检查判定。完整API/worker又在同源码迁移链回放；具体结果见[测试手册 §5.31](./V25-MIGRATION-TESTING.md)。

上线须先expand数据库，再使API和所有scheme-agent消费者理解modify后开放新操作。旧消费者的strict create-only合同不能安全接收新modify任务，因此不能混用旧消费者消费新队列；回退需暂停新准入、排空或保留兼容消费者。保留revision_base/unknown调用，不通过删列、降级清表或转换create重发恢复。生产DDL锁开销、数据量、全旧新版本组合及回滚仍由发布/数据卡实测，本批没有部署。


## 17. B39 免费更新检查上下文（2026-09-09）

Drizzle追加 `0017_cuddly_post.sql` 与snapshot/journal：Agent会话新增nullable `update_context`，保存服务端原版本/文档、旧快照、原跟踪ref、逐源执行身份、检查/变化记录和授权阶段版本。原create/modify行保持null；text_executions沿用B38 revision_base，新更新在来源全部确认后才插入text授权。初始免费请求不被替换，因此同execution重放不会改变其意图。

更新集成在隔离PG17先应用到0016，种旧来源/会话/text/unknown compiler，再实际运行根 `pnpm run db:migrate` 至0017，验证旧update_context与revision_base仍null、unknown调用不变；完整API/worker在最终源码继续迁移回放。无SQLite/desktop-db迁移，不改0000–0016 SQL。新修订引用修复只影响之后update的写入，未对历史revision批量改写；旧数据治理仍须依据真实旧库检查历史声明与引用是否一致。

先expand数据库，再升级理解check-update/authorization-required/no-source/up-to-date及update_context的全部API/Agent消费者，最后开放新产品入口。旧消费者不能混合领取新任务；回退必须暂停准入、排空或保留兼容消费者，保留未知调用/确认上下文，不能删行转create重发。实际生产DDL锁、数据规模和旧新消费者回滚矩阵未执行，按发布/数据原卡验收。结果见[测试手册 §5.32](./V25-MIGRATION-TESTING.md)。


## 18. B40 Agent 素材上下文 expand migration

`0018_supreme_supernaut.sql` 仅向 `design_scheme_agent_sessions` 增加nullable `materials jsonb`，形状来自contracts的 `DesignSchemeAgentMaterials`。保留0000–0017 SQL；不新增SQLite迁移、并行实体接口或对象清理系统。旧会话读null，无图片旧任务继续原路径；原已blocked的历史/资产任务不会因升级自动获得新输入或收费资格。

新上下文按用户选择顺序固定原暂存ID与副本的canonical资产元数据。副本仍登记在 `generation_reference_uploads`，成功草稿事务删除相应暂存行并插入 `design_scheme_assets`，失败回滚恢复原暂存记录。没有被接纳的副本仍可按注册表发现；原用户上传不会被Agent成功创建消耗。对象删除/账号删除/生产保留期的全矩阵仍依原数据卡验收。

隔离PG从真实0017链建立旧会话，再执行根 `pnpm run db:migrate`，核对旧会话和nullable材料列；实际结果与完整API/worker门禁见[测试手册 §5.33](./V25-MIGRATION-TESTING.md)。这不是生产升级、回滚或真实旧用户库验收。


## 19. B41 历史来源JSON兼容与资产晋升

本批没有新增SQL或修改既有迁移。`materials.history`与`sourceSnapshot.historyItems`是canonical JSON的可选扩展；既有上传上下文与无该字段的旧快照保留原读取行为。新historyItems保存原run/asset选择、独立图片资产和完整选定正向提示词，文件摘要对应该正文的真实UTF8字节。不可把含新字段但校验失败的数据降级成丢失正文的旧快照。

同snapshot的image/example和prompt/context绑定在文档中并存，PG单一引用边仅聚合最高角色，无需改变主键。历史图片复用暂存注册表，完成事务原子晋升；原历史在入队后删除不级联删除该副本。账号删除、来源/提示词保留期及专用包中的完整来源移交仍属于后续全生命周期验收。

集成测试继续在隔离PG运行既有迁移链和根db:migrate，不能称为B41新增DDL验收。旧消费者不理解新增JSON语义，发布仍需先升级全部相关消费者，再开放入口；不能通过删除unknown调用或重建任务回退。实际结果见[测试手册§5.34](./V25-MIGRATION-TESTING.md)。


## 20. B42 仓库图片采用JSON与更新晋升

materials.repositories和revision.repositoryImages为canonical可选JSON字段，无新增SQL或修改既有迁移。前者冻结快照/报告摘要、采用图片及遗漏路径；后者把文件与真实图片资产关联。旧无新字段的文档仍可读取；理解新字段的API、Agent及客户端需一起升级，旧严格解析器混跑、导出兼容和生产回退尚未由本批证明。

创建与更新均复用generation_reference_uploads暂存表和design_scheme_assets正式资产。采用决定提交前失败或并发落败的副本有既有清理记录；决定提交后新PID沿相同ID恢复。更新新图晋升、新revision、来源边及指针/完成事件同一事务，旧revision资产不随新图替换删除。原来源到期不取消已建立的修订引用，真实全库/账号删除/自然保留期仍须治理联合卡补验。

测试使用隔离PG既有迁移链及根db:migrate；这不是新增DDL或生产升级。专项、实际新PID与SQL样本、完整API/worker和平台边界见[测试手册§5.35](./V25-MIGRATION-TESTING.md)。


## 21. B43 桌面包内素材元数据保留（无新DDL）

canonical与legacy文档桥新增可选repositoryImages，保持sourceSnapshotIds/assetIds及来源package/snapshot身份。导入后所有本地实体获得新ID，historyItems.imageAssetId与仓库图片provenance同步映射；历史原run/asset标识只作来源事实。受校验canonical snapshot放在既有scan_json.importedSnapshot，core读取重新校验并核对行身份，IPC不暴露原始scan。导出保留有效来源hash和完整选定历史正文。旧无这些可选字段的文档/scan继续读取；没有PG/SQLite列变更、生产迁移或应用版本变更。旧消费者可能剥离新增字段、导入后修改/更新和跨locale包兼容仍需独立验收，详见[包验证§4–§5](./V25-PACKAGE-VALIDATION.md)。

## 22. B44 桌面跨修订素材引用（无新DDL）

asset.revision_id保持创建版本；document.assetIds表达新版本明确继承，core读取时校验同方案/存在/去重，兼容旧文档自有素材。修改不会复制或挪动旧资产行；来源更新的新资产、文档、来源绑定和指针在同一SQLite事务发布。已导入canonical来源仍存于scan_json.importedSnapshot，完整历史与未变化来源继续保留，无PG/SQLite迁移或版本号修改。

旧revision及其文件保持，未来删除/GC必须检查其他document引用，不能仅按asset.revision_id判断可删。事务失败测试验证回滚和已知新目录清理；写盘中途未返回ID、强杀、清理失败仍须孤儿对账，不能以本批代替全GC验收。旧消费者可能丢失新字段，createdBy/parent、v1云转换、来源元数据冲突及跨locale兼容未闭合。测试与范围见[测试手册§5.37](./V25-MIGRATION-TESTING.md)。

## 23. B45 创建事实与来源种类保留（无新DDL）

legacy文档新增可选创建来源/时间/父版本、约束证据和编译轨迹字段，schema归入contracts单源，原包路径保持。新根版本由仓储设置parent=null，修改/结构化编辑设置精确基线parent；从包导入不继承原谱系或正式权限。旧JSON缺少创建信息时，只读使用已有revision列，不推测旧父版本、不回写数据。source_packages仍沿存量kind枚举，经过身份校验的scan_json.importedSnapshot保存share-import真实来源种类，读取和导出恢复该事实。

没有新增PG/SQLite迁移或修改既有DDL。旧消费者可能剥离新增JSON字段，旧二进制与不同ICU版本仍需发布矩阵验证；格式版本/摘要字段布局保持原v2，不能把本机四locale测试当作生产升级/回滚证据。详情见[专用包§7](./V25-PACKAGE-VALIDATION.md)。


## 24. B46 包上传确认的 expand migration

新增`0019_odd_loa.sql`及生成的schema快照：只创建`design_scheme_package_stages`，不改旧SQL、SQLite或既有行。owner/request唯一、对象唯一、大小/格式/状态和ready必要证据由PG约束；密钥/令牌不入表，authorityHash只摘要服务器观察的身份和会话授权版本。

对象仍登记既有reference_uploads/outbox，包表按user删除时级联，独立outbox不级联；终态暂存保留请求身份以阻止同键复活，业务元数据保留/批量治理归完整GC验收。尚未导入任何历史包到业务方案表。原有0011/0013/0014/0015/0016/0017起点迁移集成会继续回放到最新；本批新集成在隔离PG17实际运行根db:migrate。以最终测试记录为准，不代表生产升级或全部历史用户库兼容。

先部署DDL与理解新包租约的worker，再开放新API/客户端；回退时先停止新上传/确认并处理未到期租约与清理intent，不删除暂存表/outbox来伪造排空。生产发布和旧/新二进制混跑仍需G-RELEASE和F5验收。具体结果见[测试手册§5.39](./V25-MIGRATION-TESTING.md)。

B47只准备内存导入内容，无新DDL或业务表写入。F3后续迁移应增加持久请求/固定seed和时间/映射版本/回执及租约，不能从当前纯函数推断已经具备幂等落库；v1原commit/scan仅作私有出处，不能直接写可信snapshot scan或截断commit列。原包、源文件与素材都必须接既有登记/outbox并在PG提交前后保持租约保护，任务和验收见[路线图§6.35](./V25-MIGRATION-ROADMAP.md)。

## 25. B48 持久导入回执与状态扩展

新增0020_small_unicorn.sql及生成快照，创建design_scheme_package_imports；stage_id主键、(stage_id,user_id)复合外键保证同owner且随stage级联。stage新增(id,user_id)唯一约束与imported终态；终态仍须preview/confirmationHash。导入表约束parser/mapping/epoch为正、状态集合、completed必须有result及planHash。seed/时间在首次认领固定；result为不可变导入回执，provenance仅私有出处，无密钥。

生成器最初将新复合外键排在父表唯一约束之前，审查后在本次新SQL中调整为先唯一约束再外键；未改旧迁移。新API/worker集成在隔离PG17实际执行根pnpm run db:migrate；全部结果见[测试手册§5.41](./V25-MIGRATION-TESTING.md)。这不代表生产迁移或所有旧二进制兼容。

上线先应用DDL、升级理解import租约/持久清理intent的worker与API，再开放理解imported状态的客户端。回退先停止新增导入并核对未到期尝试、已提交结果与对象引用，保留新表/状态/outbox，不靠删除记录排空。已完成结果可供同owner新正常会话只读重放；原stage到期不能自动删除结果并复用同一请求。stage/import/provenance长期保留治理和孤立来源回收仍由原E完成，实际灰度及回滚尚未执行。

## 26. B49 持久正式包导出

新增0021_striped_valkyrie.sql与生成快照，创建design_scheme_package_exports；owner/request唯一、objectKey唯一、状态/正版本/字节上限/ready必要hash和size由PG检查。user外键级联，方案和版本身份保留为固定请求依据，由服务每次重验真实引用；未建立让方案删除悄悄删除导出回执的级联关系。request/basis/authority仅摘要，令牌和密钥不入表。

新集成使用隔离PG17运行根pnpm run db:migrate；不修改旧SQL或SQLite、不代表生产已迁移。先DDL、理解新导出对象租约的worker、API，再开放新客户端。停止新增导出后回退，保留在途租约/outbox和固定回执，旧客户端继续旧接口；不能删表来清空状态。原请求中断不自动续建，对象没有第二写入者；原请求可观察，重做需新请求。元数据长期保留、自然TTL、旧新二进制混跑及生产回滚仍须原E验收。实际结果见[测试手册§5.42](./V25-MIGRATION-TESTING.md)。

## 27. B56 Agent 历史创建时间与稳定分页

新增[0022_faithful_revanche.sql](../../packages/db/migrations/0022_faithful_revanche.sql)及Drizzle生成快照，在既有Agent会话增加非空`created_at`，默认当前时间；回填优先原公开view.createdAt，缺失时用旧updated_at。新增`(user_id, created_at DESC, execution_id DESC)`索引，原始请求、素材、事件、费用状态和旧迁移SQL保留。新start和cancel-before-start显式写同一创建时间；状态更新只改updated_at。游标在PG内比较原created_at/execution_id，不将JS毫秒截断值用于后续分页。

实际隔离PG17验证从0013保留旧来源记录，程序迁至0021后种入两份历史时间夹具，再执行根`pnpm run db:migrate`到0022，并重复执行同命令。断言原createdAt优先、缺失时间回退、view不改写、旧来源状态不变、索引存在、重复执行不改变回填结果。真实Agent集成20项、完整API集成482项及worker集成92项通过；最终门禁与首败见[测试手册§5.50](./V25-MIGRATION-TESTING.md)。这些是隔离环境结果，尚未生产执行。

上线先应用expand DDL再开放新查询；旧API仍能省略该列插入，新列默认时间有效。回退可关闭新历史能力并保留列/索引；不删除任务或费用回执。部署前在副本核对既有view时间可解析、表规模和DDL/回填锁等待；非法非空日期应中止迁移并核对来源，不能默默重写时间。旧新二进制混跑、大表锁时长与生产回滚仍由原E验收，未用本机小样本证明。

## 28. B66 同步恢复与 retention 水位（无新DDL）

本次复用既有SQLite outbox、PG sync_change_log/sync_retention_state/sync_devices，不新增列、不改旧迁移SQL。桌面仅在待同步请求与当前本地内容都等于远端已提交快照且删除语义一致时确认该条outbox；已登记冲突继续要求用户决议，新本地修改仍保留。丢回包后同库由新PID打开可以沿原mutation恢复，不重置设备或清空队列。

worker裁剪仍按原90天期限，但水位同时计入本次删除的最大seq，即使全部日志被清空，或created_at与seq并非同序。单例行条件upsert保证并发维护不能降低已有水位，无操作不改updatedAt；设备行不随日志裁剪删除。API bootstrap/status/空pull返回至少为该持久水位的游标，避免空日志时bootstrap不断返回0并反复410；pull的水位检查与delta读取使用同一repeatable read快照，避免等待设备锁时清理已提交而读到空页。

先失败重现、九项实际双客户端HTTP/PG恢复与当前后端门禁见[测试手册§5.65](./V25-MIGRATION-TESTING.md)。91天历史由测试构造，生产清理函数实际执行；不是自然等待90天，不证明已经被旧清理器丢弃且未记水位的历史状态可自动修复。升级部署应同时采用理解此水位的API与worker，保留持久水位和客户端账本，不能清零游标/删outbox冒充恢复；旧新二进制混跑、真实旧库及生产回滚仍需原D03/发布矩阵验收。


## 29. B67 账号切换与同步同意（无新DDL）

实际Electron验证首次登录不建立目标workspace、不复制旧库也不自动同步；用户明确复制后原库保留，目标同意仍unset，首次开启需另行同意。退出/换号停止旧传输并保留各owner的device/cursor/consent/outbox；回到已开启账号可恢复，暂停账号仍暂停。真实会话过期保留pending mutation，重登继续同一回执。独立本机设计方案库在整个切号/重启过程中逻辑内容不变，也不自动上传或绑定到云账号。

本批仅新增真实身份测试设施，无迁移SQL或生产同步代码变化；[测试手册§5.66](./V25-MIGRATION-TESTING.md)记录合成夹具、实际PG/Electron、首败及完整门禁范围。真实旧库、其余备份故障与asar内联迁移仍按D03原范围验证。


## 30. B68 精确数据与备份失败恢复（无新DDL）

原D03.2/3已用D03-A自有合成数据库补验：旧列及引用精确保留、历史成本单位与图片映射不变；新workspace时间单独验证，不抹平旧字段差异。备份mkdir/VACUUM真实失败、备份后/事务写入/最终校验失败均不留下半更新；VACUUM副本逻辑等价，移除故障后原库和恢复副本均可升级、重复noop。独立方案库按步骤原子升级，core库不受影响。

详见[测试手册§5.67](./V25-MIGRATION-TESTING.md)与[28份数据库阶段摘要](../../tests/v25/.results/b68/database-stages-final.json)。仅源码测试，无新SQL；真实v2.1脱敏旧库、旧App实启与asar产物内联不能由本批结果替代。


## 31. B75 分类永久删除身份的 expand migration（实施中）

[0023_long_red_skull.sql](../../packages/db/migrations/0023_long_red_skull.sql)新增`sync_taxonomy_tombstones`，仅保存user_id、entity_type、entity_id、最终version、原entity_created_at及deleted_at；主键为owner/type/id，类型限folder/tag、版本为正，账号FK级联删除。主键同时服务owner/type/ID分页；不保存分类名称或完整快照，不能随90天同步日志/幂等回执清理。

API新的分类删除与删除身份在同一事务提交；现有sync快照合同保持，读取标记投影为“已删除文件夹/标签”，时间来自持久事实。原短期变更日志/回执仍可以含当时完整快照，其保留期不在本批擅自改变。同一owner已删除身份不能再创建；owner不同的删除身份互不授权或泄漏内容。

当前迁移仅expand新表，**尚未批量回填/清理历史soft-deleted分类**。新服务会拒绝分类restore，并能在再次删除时处理旧软删行；这不替代正式历史数据回填。后续仍需迁移前缀、软删/异常关联语料、失败回滚和旧新写入者部署次序验证；新行为不能由旧API写者安全承接，不能宣称支持任意混跑或降级。不得删除持久标记、清空回执或用旧库覆盖已生效删除来回滚。

[实际根命令证据](../../tests/v25/.results/b75/db-migrate-cli.json)：自有全新PG17中`pnpm run db:migrate`首次及重复均退出0，累计24条迁移、新表6列一致，测试容器已关闭。当前API27项、worker98P/2容器条件S及check通过；精确源码、首败和待验范围见[测试续篇§5.74.1](./V25-MIGRATION-TESTING-CONTINUED.md)。没有生产部署、真实旧库迁移或完整B75验收。


### 31.1 B75 历史软删分类的分批回填工具（2026-09-13）

新增API运维命令`pnpm --filter @musefold/api run taxonomy:backfill`，显式从环境读取DATABASE_URL，没有本机/生产默认库。默认只预览，`--limit=50`限制本批候选数（1–100），`--apply`才实际执行。输出仅包含mode、selected、cleaned、skipped和hasMore计数，不输出分类名称、正文、账号或连接串。该工具不开放HTTP/管理员入口、不自动在用户请求中执行。

执行顺序：先在目标副本验证0023与回填，再执行expand迁移，停止并排空旧版分类写入者，部署理解永久删除身份的API/同步写入者，最后预览并分批apply。每轮重新选择仍soft-deleted的实体，直到再次预览selected=0；hasMore仅描述本次候选查询，不承诺并发运行期间整库已完成。当前实现不宣称支持任意旧新二进制混跑。

每个分类在独立PG事务中复用正式删除服务及既有topology/identity/行锁：锁后重验仍为soft-deleted，摘除本账号子级及Prompt关联，保留其正文与软删状态，递增受影响引用方版本并追加完整同步变更，记录最小持久删除身份、物理删除旧分类。原分类的删除时间及最终版本沿用持久数据；已完成分类不再次递增版本或产生重复删除日志。锁等待上限5秒、单SQL上限30秒，不在事务内调用网络。

**回滚粒度为每个分类事务**：本批前面已完成的分类保持提交；当前失败分类的关联、标记、实体和日志一起回滚，重跑从剩余实体继续。不能把这描述为整批全有或全无。锁前后发现已恢复成live或已被其他删除者处理时跳过，避免意外删除live分类。实体与删除身份同时存在、或有跨账号异常引用时明确拒绝并保留原数据，须先核对数据来源；不会自动搬迁/删除另一账号的数据。

该流程是0023后的数据回填阶段，没有改写0000–0023 SQL，也没有伪造新的schema迁移。回退应停止清理并保留已提交删除身份；不得删除新表、回滚到能复活分类的旧写者，或用旧备份覆盖已确认删除。实际隔离PG、前缀升级、故障回滚和CLI结果见测试续篇§5.74.3；生产锁时长、真实旧库与部署回滚仍独立待验。


## 32. B77 分批永久清理进度（0024 expand migration）

新增[0024_retention_purge_progress.sql](../../packages/db/migrations/0024_retention_purge_progress.sql)，累计25项PG迁移。生成记录和Prompt各加nullable `purge_started_at`，不对旧行回填删除状态；增资产/使用明细批次索引，CHECK限制只有已删除终态生成/已删除Prompt可开始purge；父触发器禁止撤回或改写既有标记，六类子表触发器以父行key-share锁拒绝开始purge后的迟到插入/更新。实际删除不触发此写入保护；费用回执独立保留，未改公共zod契约。

程序化及根CLI均使用当前SQL。自有PG fresh/repeat两次根`pnpm run db:migrate`退出0，25项账本一致；就地DB9项验证有数据0023升级及重复迁移不改变原字段、marker默认null、两类父标记/六类迟到子写入拒绝。[真实迁移结果](../../tests/v25/.results/b77/child-purge-owned-migration-result.json)。新snapshot/journal后续仅按Biome格式化，SQL未变；[输入归属](../../tests/v25/.results/b77/child-purge-migration-lineage.json)。这不是生产数据库迁移、真实用户SQLite或发布包升级的证明。

上线顺序：保持后台清理暂停，先expand schema，再部署识别marker的API和Worker，完成读取/恢复/回执及分批续跑验证后恢复维护。旧API不知道marker，不能与已启用新分批清理的Worker混跑；数据库拒绝恢复半条数据不代表旧API的展示与错误反馈已经兼容。

回滚时保留schema、已提交marker和独立费用回执；先暂停所有清理实例。不能通过清空marker或恢复旧整库来回退不可逆清理，也不能让旧API展示部分已清理对象。优先前滚修复；若必须回退代码，先以兼容版本完成/隔离正在清理的记录并验证旧版本可见性。以上是待交付执行条件，本轮没有操作任何生产库或发布服务。


## 33. Desktop 0012 本机资产清理意图（2026-09-13）

新增local_asset_cleanup独立表及state/next_attempt_at索引，记录本机路径、device/inode、待处理/阻止状态、重试时间、次数与固定原因。表不随作品/账号级联；原作品删除与意图写入同事务，文件动作在后续有界drain完成。此表为内部SQLite状态，不进入公共实体契约/渲染层，也不保存上游密钥或错误原文。

Drizzle生成0012_bizarre_morlun.sql，db:bundle已内联13项；有数据0011升级后原generation行逐字段相同、意图为空、重复升级不改变13项账本。新库、旧库接管及故障回滚相关66项通过，实际Electron新PID重试已有证据，当前完整宿主门禁仍运行。详见[测试续篇§5.76.25–26](./V25-MIGRATION-TESTING-CONTINUED.md)。

这是expand迁移，保留所有原表/列。旧二进制无法消费新清理意图，也不具备本轮修复的文件保护；不得将“旧程序能打开新库”当作清理/回滚功能已验。各平台包内迁移和正式回滚仍由原发布阶段取得实际证据。


## 34. 0025 inventory 发现表的 expand 迁移（2026-09-14）

新增 `object_inventory_cursors`（storage scope/prefix/mode复合主键、分页token和有期认领）与 `object_inventory_candidates`（scope/key复合主键、ETag/修改时间/大小/观察时间和宽限期索引）。不改旧表列、约束或外键，不回填或删除业务行；两表不依赖账号外键，账户级联后仍能保存发现事实。候选表与旧删除outbox隔离，旧Worker不会消费新观察记录；未知新任务的回滚处理及正式部署演练仍属于发布阶段。

新就地 `inventory-migration.integration.test.ts` 用仓库前25条SQL创建真实临时PG旧库，填入提示词和已有失败清理记录，再执行实际根命令 `pnpm run db:migrate` 两次，验证26条ledger hash、全部既有字段保留及新表为空。完整API前缀升级回归须在本轮收齐，不能以这一项代替生产迁移/回滚验收。扫描行为和待完成物理删除条件见[生命周期§14](./V25-DATA-LIFECYCLE.md)。


## 35. 0026 对象发布与删除授权保护（2026-09-14）

新增 `object_key_retirements`（SHA-256 主键、退休时间，无账号外键与原始路径）及发布/租约事务锁函数、10 个写入表的触发器。迁移不删除或改写已有业务数据；账本共 27 项。运行时在已提交退休 key 上发布有效对象会报 `ObjectStorageKeyRetired`；过期同执行 epoch 恢复有效租约会报 `ObjectStorageLeaseExpired`。永久退休记录不得随账号删除清空，失败删除也不能撤销退休。

已在 disposable PG 实际运行仓库 CLI 两次，并验证旧前缀数据与 outbox 保留、账本摘要及幂等；全前缀/故障升级专项 37 项通过，其中 0026 最后 `package_imports_storage_lease` trigger 注入失败验证事务回滚。见测试续篇 §5.79 和 publication-upgrade-result.json。当前完整 API 仍在运行，不能以专项替代全量验收。旧二进制回滚须结合生命周期 §15 的暂停维护条件；未执行实际生产迁移。


## 36. 0027 参考图关联锁住实际 registry key（2026-09-14）

追加迁移0027替换两个trigger函数，不重写0026或清理业务数据，账本28项。link发布先对generation_reference_uploads行取FOR SHARE，再取得对象锁并验证退休状态，防止等待期间key变化。inactive但已被link引用的registry也属于有效引用，修改时必须检查目标key是否退休；无引用的inactive清理意图保留原语义。真实PG红测两处失败→修复后联合24项通过；当前全升级故障矩阵与新源码完整门禁见测试续篇§5.79.1，不预记整包完成。


## 37. 0028 inventory 候选领取与失败事实（2026-09-14）

向object_inventory_candidates追加7列：claim_token、claim_until、attempt_count（默认0）、next_attempt_at（默认当前时间）、last_attempt_at、last_error、abandoned_at。新增领取token/到期成对约束、非负尝试次数约束和就绪索引；账本29项。原scope/key/etag/mtime/size/观察/宽限字段不改，独立于旧outbox与用户级联。

实际CLI已分别验证0024已有业务/outbox数据→最新，以及0027已有候选/游标→0028，各执行两次；后者原字段和游标逐项保留，新增领取为空、次数0，重复迁移不刷新next_attempt_at。全前缀/0028新增索引故障回滚39项通过。证据见测试续篇§5.80；这不证明生产大库锁时延、旧Worker混跑或正式部署回滚，仍按原发布卡执行。
