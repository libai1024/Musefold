# v2.5 数据生命周期与资产清理核对

**B77已验收（2026-09-14）：** 保留期、分批维护、同步提交/游标与Automation/Skill保留授权政策的原R01–R05已按25条逐项验收。当前check36/36、完整Worker236P/0S、完整Electron185P/2外部凭据S/0F/0flaky、源码及17实际ZIP扫描通过，输入归属与跳过原因保留。任务包86/93，**还剩7个大阶段**；下一接完整资产GC，管理员在v2.5全部闭合后启动。详见[最终验收](../../tests/v25/.results/b77/acceptance.json)与[测试续篇§5.76.28](./V25-MIGRATION-TESTING-CONTINUED.md)。

核对日期：2026-09-13。本表服务于 [G-DATA-01 / 02 / 03](./V25-MIGRATION-GOALS.md)，记录当前实现、目标和缺口，**不是整组验收通过声明**。初始核对源码为 B70 的 `fa9d51c9…`，后续行按各批实际结果更新；B73验收为 `cb081ade…`，完整E2E476P/7S与实际归档扫描已通过；真实数据库测试结果另见测试手册，不把源码阅读计为运行通过。

**当前状态（2026-09-13）：** B74/B75分类及B76 Session原范围已验收。B76完整三端497P/7S/0F/0flaky；当前check36/36、实际本地macOS arm64包fresh/两旧前缀升级3P及源码/真实产物扫描通过。原后端API697P/1专用小时S、worker101P/0S保持准确源码归属。§9诊断和阶段记录是历史过程；最终证据见[测试续篇§5.75.9](./V25-MIGRATION-TESTING-CONTINUED.md)。继续§4的D01.3/4/6保留期、有界维护和Automation/Skill审计策略；完整D01/D02及迁移仍开放。

## 1. 实体与动作

PC Web 和 Mobile Web 使用同一个 API，下面合并为 Web；交互仍须分别实测。Desktop 使用本机 SQLite，提示词按 workspace 隔离，方案为独立机器本地库。软删、归档、永久删除分别记录，避免以列表中不可见推断物理数据已删除。

| 实体 / 动作 | 当前 Web | 当前 Desktop | 原目标与剩余验收 |
|---|---|---|---|
| Prompt 列表 / 回收站 | B72修精确游标；B73以deletedOnly在SQL内筛选，true优先includeDeleted | B73改为SQL筛选后有界LIMIT/OFFSET；v25不再拼接被截断的列表；显式workspace写后回读已修 | 1001搜索/501回收站与三端实际恢复/过滤/错误重试专项通过，完整E2E476P/7S与实际扫描已通过；跨宿主完整排序parity及D01父卡仍开放 |
| Prompt 软删 / 恢复 | 改 `deletedAt`、版本与同步日志；恢复保留关联 | core 更新行、FTS 与当前 workspace outbox | 反复删除、版本冲突、不存在、跨 owner 和双客户端均须有明确结果；不得将数据恢复理解为重新授权费用 |
| Prompt 单条永久删除 | 要求已软删；删除主行及标签链接，保留软引用 usage 审计；写 delete 日志 | 要求已软删；core 清 FTS、链接和主行，入同步 outbox | B70 修复 Web 与 restore 的真实行锁竞争；本机同步调度与跨进程行为仍按 D01.2 补验 |
| Prompt 清空回收站 | B70 锁定候选集后按确切 ID 删除；返回实际条数，后来才软删的行留给下一次操作 | B71 已将 IPC 的 500 条展示列表改接 `purgeAllDeleted()`；候选查询、删除、FTS 与同步在同一事务 | 501 条/工作区/已知云版本墓碑、第二次删除失败回滚和真实 Electron 新 PID 专项已验；完整桌面170P/0F/2S/0flaky与源码/实际归档扫描通过，仅B71清空切片关闭 |
| Prompt 自动清理 | Worker 软删满 30 天可 purge，事务内删除 usage；B70 先锁候选再删关联 | 本轮未证明与云端相同的自动保留期执行入口 | 不擅自改变手动 purge 与定期 purge 的 usage 保留差异；先确定审计要求，再对齐各宿主 |
| Folder 删除 | B75已接主表硬删/最小持久删除身份/引用锁与bootstrap投影，拒绝restore；旧软删分批回填、长期离线和事务矩阵已验 | B74 core事务detach直接child/Prompt再硬删并保留grandchild；B75进一步拒绝已删分类的local恢复，remote采用保留Prompt正文 | B75原范围已验，含完整E2E488P/7S与当轮归档扫描；不关闭完整D01，详见测试续篇§5.74.6 |
| Tag 删除 | B75已接主表硬删/持久删除身份、引用锁及旧数据回填，拒绝restore；真实标签引用/清理两种竞争顺序已测 | B74 core清链接/硬删/刷新FTS及outbox，保留Prompt已有delete意图；B75补永久删除冲突保护 | 保留/过期日志下双独立Electron及新PID已验证；B75已验，完整生命周期仍按后续范围处理 |
| Generation 列表 / 回收站 | `deletedOnly` 优先于 `includeDeleted` | 消费同一查询契约 | 含运行中状态、分页与过滤；不能把客户端过滤当作后端权限 |
| Generation 软删 / 恢复 | 保留资产；永久删除前校验已软删终态 | 单条 remove 改 `deleted_at`；批量清理仅软删终态；restore 清空删除时间 | D01.2 核对进行中任务可达性、取消与恢复组合，保留原任务及费用事实 |
| Generation purge / 清空 | 有序锁定行，释放资产与输入引用时登记 cleanup；保留独立执行回执的原 key、结果与费用来源 | 0012持久清理意图与作品删除同事务；两入口统一pictures/previews规范路径、device/inode复查及剩余作品/执行/方案来源保护，每轮100文件，失败退避及启动续跑 | **D02 未闭合**：本轮66项专项通过，实际Electron与完整门禁见§11；全部类别、未知孤儿、并发OS路径替换仍待 |
| Session 归档 / 取消归档 | `archivedAt` 与 `deletedAt` 独立；`archivedOnly` 只返未删已归档记录 | 同一语义 | 取消归档经 update 的 `archived:false`；从软删恢复只清 `deletedAt`，保留原 `archivedAt`，不会自动回到主列表 |
| Session 删除 / 恢复 / purge | B76已贯通严格`deletedOnly`、版本CAS、purge/全量清空；事务锁协调恢复/生成，作品关联置空且回执保留 | B76已接真实版本、原子草稿写入及0011永久身份保护；共享回收站恢复/清理与新PID已验 | B76原范围已验，含完整三端497P/7S和实际包内升级3P；作品/图片/费用保持，迟到ensure不复活。完整retention/资产GC另续 |
| Design scheme / revision / run | 来源、版本、资产与运行有独立持久记录；GC 保护 canonical 资产和来源 | 独立方案库，revision 文档可显式继续引用旧版 asset ID | D02 不能仅按 asset 的原始 revision 或方案是否出现在列表判孤儿；软删方案的合法历史引用仍保护 |
| Sync 日志 / 幂等结果 | 90 天裁剪，水位取当前、已删最大 seq、存活最小 seq 三者的安全上界；保留设备 | 消费水位和 bootstrap 恢复，保留本机未同步修改 | B66 已验恢复；D01.4 若分批裁剪，不能造成增量空洞且不提升水位，或把旧水位写回 |
| Automation / Skill 运行及审计 | Cloud MCP 仍只读，不能增加删除/花费工具 | 原服务语义保留，通用 Skill 对话 UI 暂缓 | D01.3/6 仍需明确这些现存服务的保留政策与 destructive 授权矩阵；不得机械套 Prompt 30 天或删除冻结服务 |

代码入口：[Prompt 契约](../../packages/contracts/src/prompt.ts)、[会话/历史契约](../../packages/contracts/src/workbench.ts)、[gateway](../../packages/platform/src/gateway.ts)、[API PromptService](../../apps/api/src/modules/prompts/service.ts)、[Desktop Prompt IPC](../../apps/desktop/electron/main/ipc-v25/prompts-domain.ts)、[core Prompt repository](../../packages/core/src/db/repositories/prompts.ts)、[API Workbench](../../apps/api/src/modules/workbench/service.ts)、[Desktop Workbench IPC](../../apps/desktop/electron/main/ipc-v25/workbench-domain.ts)、[Desktop 批量历史清理](../../apps/desktop/electron/main/ipc-v25/history-domain.ts)、[API Generation](../../apps/api/src/modules/generation/service.ts)。

## 2. 云端资产、引用与实际删除者

| 资产类别 | 创建与持久引用 | 保留 / 租约 | 当前物理清理及待补 |
|---|---|---|---|
| 生成图片 | generation worker 写 `users/<owner>/generations/<run>/…`；成功记录在 `generation_assets`，费用回执独立 | 成功记录即使软删仍保护；终态软删 30 天可释放。queued 前缀或有效执行 lease 保护未提交输出 | purge/补偿写 `object_cleanup_queue`，Worker DeleteObjects；无 DB 意图窗口仍需 inventory |
| Composer 参考图 | API 上传，`generation_reference_uploads`；run 通过 `generation_reference_links`，方案通过冻结 reference 引用 | 普通上传 24 小时；只要有效链接仍在，就不能因原上传期限已到删除 | 过期候选最多 100 条，行锁后重新检查链接；无引用才置 cleanup_pending 并入队 |
| 方案上传 / 已采用图片 | assets 服务上传并登记；转为 `design_scheme_assets` 或冻结的 `design_scheme_generation_references` | canonical 引用保护，不按上传 TTL 覆盖已采用资产 | 共享 cleanup 复查两类表；全方案删除/账号级联后的重新发现仍需全集验证 |
| GitHub / 文本来源固定副本 | source preparation 写对象，`design_scheme_source_files` 存 key；binding 引用 snapshot | preparation 默认一小时，读取时 upload lease；已被 binding 采用的来源长期保护 | source retirement 每批最多100父记录、跨来源共享1000文件预算；锁定未采用文件，清key与登记cleanup同事务，后续继续剩余文件；保留来源元数据 |
| 专用包上传原件 | package stage 服务写 `scheme-packages/…`；stage 和 upload 登记 | stage 一小时有效；上传 lease 未到期或 ready/confirmed 未过期时保护 | 创建阶段已有延后 cleanup 意图；retire stage 每批 100，再由共享 Worker 删除 |
| 专用包导入副本 | importer 写 `scheme-imports/<stage>/<attempt>/…`，原子登记 source/asset 与导入回执 | running import lease 保护该 attempt 前缀；导入成功后由 canonical 表保护 | 受保护的 imported key 保留延后意图，不直接丢弃，以便账号级联后回收；旧 epoch 不得删除新 attempt |
| 专用包导出归档 | export 服务写对象并保存持久 export 行和延后 cleanup 意图 | 默认一小时；有效 export lease 或未过期 ready 保护 | 到期/取消后经过共享队列；浏览器开始下载不等于文件保存成功；自然期限见 B64 |
| 写成但 DB 未落意图的对象 | S3 成功与 DB 提交之间的中断窗口，可能根本没有 queue 行 | 必须等待最小宽限期，并复查所有 canonical 引用、上传与执行 lease | 受管前缀 inventory 扫描+24小时宽限+候选复查已接入（0025/0028，见 §14/§16 与 `apps/worker/src/object-inventory*.ts`）；候选物理删除执行器已由 §16 落地，剩余为完整联合验收与容量/多桶后续卡 |
| 删除失败 / abandoned | cleanup 行保留 reason、attempt、lastError、nextAttemptAt、abandonedAt | 失败从 5 分钟指数退避，最长 24 小时；最多 12 次；受保护项延后且不消耗尝试 | HTTP 成功仍需检查 per-object Errors；不 ack 失败。未来管理端恢复 abandoned 时仍须重新校验引用 |

当前 cleanup 每批最多100，最多10批，并返回expiredReferences/deleted/protected/failed计数。B77已将generation/Prompt/sync父候选限制为1000，generation/Prompt每类子表各有独立1000行预算；来源父候选100且全批共享1000文件预算。对象队列各写入已接两秒事务锁等待边界（§10.7）。这些是行数及单次锁等待限制，不代表整个维护轮次或外部S3总耗时已有上限。生产入口按小时运行cleanup，reconcile按分钟运行。

代码入口：[清理存储与保护查询](../../apps/worker/src/tasks.ts)、[运行调度](../../apps/worker/src/bin.ts)、[30/90 天常量](../../packages/db/src/retention.ts)、[运行及 Prompt retention](../../apps/worker/src/retention.ts)、[sync retention](../../apps/worker/src/sync-retention.ts)、[退避与队列](../../packages/db/src/object-cleanup.ts)、[来源退役](../../packages/db/src/design-scheme-source-cleanup.ts)、[包暂存退役](../../packages/db/src/design-scheme-package-cleanup.ts)、[来源准备](../../apps/api/src/modules/design-schemes/source-preparation.ts)、[方案资产](../../apps/api/src/modules/design-scheme-assets/service.ts)、[上传包](../../apps/api/src/modules/design-scheme-packages/service.ts)、[导入](../../apps/api/src/modules/design-scheme-packages/import-service.ts)、[导出](../../apps/api/src/modules/design-scheme-packages/export-service.ts)。

## 3. Desktop 受管文件目录

| 类别 | 创建 / 引用事实 | 当前清理 | 尚需证明 |
|---|---|---|---|
| 生成图片及预览 | generation 服务和本机资产行；可能被方案或后续输入引用 | 单条/批量 purge 删除行后尝试 rm；未提交生成有补偿清理 | 清理必须复查所有引用，失败后有持久意图或可重复发现；路径变更、父目录符号链接不能删除受管根外文件 |
| Composer 上传 | Workbench IPC 的 referenceUploadsDir 下受管副本；会话草稿和历史 params 可继续引用 | 已有上传及 id→文件解析；本轮未发现覆盖全部引用的统一 TTL 清理 | 关闭 Composer 不等于无引用；不得删用户选择的源文件；长时间暂停后恢复、跨会话使用需验 |
| 方案来源及 revision asset | 独立方案库 source/asset/store_key；canonical revision document 可保留旧资产 ID | 已有受管文件解析和 inode 身份验证用于读取；不是完整 GC | 不把读取保护当作删除保护；旧版 revision/source/run/封面等引用全集须用于 GC |
| 方案包 stage / verify 副本 | `staging/design-scheme-packages/<webContentsId>/<stageId>`；描述符复制、固定 hash、唯一消费及活跃保护 | 已接独占锁后的20条/批启动扫描，取消/关闭不提前删在途文件，失败目录可重发现；35项专项和真实Electron4项通过 | 跨进程在lstat与unlink间替换仍已复现；句柄相对删除原型通过但未装入产品。完整回归/慢复制/暂停/Windows与其他类别继续，见§17和测试续篇§5.81.1 |
| 导出分享包及用户保存位置 | archive/package-host 向用户选择的交付位置写文件 | 属于用户已交付文件 | 用户保存的输出不是临时 GC 候选；内部临时归档和外部交付位置必须分开验证 |

代码入口：[package staging](../../apps/desktop/electron/main/design-scheme/package-staging.ts)、[package host](../../apps/desktop/electron/main/design-scheme/package-host.ts)、[正常退出](../../apps/desktop/electron/main/application.ts)、[方案受管文件身份](../../apps/desktop/electron/main/design-scheme/asset-store.ts)、[revision 显式资产引用](../../packages/core/src/db/design-scheme/revision-assets.ts)、[生成补偿](../../packages/core/src/services/generation.ts)。

## 4. 接续实施与验收顺序

下列是原任务的执行顺序，不增加新的产品范围，也不将其中一片通过当作 D01/D02 父卡完成。

1. **D01.2 已在推进：** B70 已完成 Prompt restore 与三种 purge 的真实 PG 竞争验收；B71 已修 Desktop 500 条清空及部分提交，准确条数、无残留、其他 workspace、同步和事务失败恢复专项通过，完整桌面回归和实际归档扫描已通过。B73已独立修复v25列表分页上限，本片完整E2E及扫描已验，不能由B71清空通过推断列表已验。
2. **D01.1/2 双端行为：** B73 Prompt查询已验，接B74 Desktop分类事务/同步，再固定 Folder/Tag detach 与墓碑规则，复核旧 sync restore 兼容入口；补 Prompt/Session 回收站查询与 Session purge 接缝。任何契约变化均从 contracts 经 gateway 贯通双宿主，并覆盖现有客户端冲突与恢复。
3. **D01.3/4 retention：** 保留 30/90 天边界；实际 1001+ 行验证每次有界、锁占用、第二次继续、失败重跑及计数。sync 分批必须连同 cursor/bootstrap 一起验证。Automation/Skill 保留期先以现有审计和引用需求定政策。
4. **D02.2/3 云 GC：** 明确合法受管前缀；设计持久扫描游标、有限候选、最小宽限期和 dry-run。识别对象后先登记共享意图，实际删除前重查全部保护。用真实 S3-compatible 服务验证“对象存在但意图不存在”、新引用竞争、分页恢复及重复扫描。
5. **D02.4/5 Desktop / 故障：** 统一受管删除与引用保护，补磁盘失败补偿、启动残留发现；隔离目录中验证软链接/目录替换、原件保留、双窗口、新 PID 与长暂停。云端补逐对象失败、权限、停机及 abandoned。
6. **D01.5/6 与最终合流：** 三形态不可逆动作确认/取消、分页空态与恢复后刷新；本地 Agent destructive 权限与审计；Cloud MCP 保持只读。最后结合 D03 的真实旧库、同步、备份及产物内迁移收口，不覆盖缺失的原生或生产验收。

每片留存失败复现、修复后的命令/报告和源码摘要。源码改变后跑统一检查；涉及 API/Worker 跑真实数据库集成；涉及 Desktop 主进程先 build 后完整 Electron；共享组件/查询交互改变时再跑完整 E2E。外部真实旧库、各平台安装包与生产回滚依旧单列。

## 5. 查询缺陷的实际复现（2026-09-13，云端与桌面查询切片均已验）

以下审查在 B71 完整 Electron 运行期间进行：生产源码保持 `c91882da…`，仅向自有 PostgreSQL 17 / 临时 SQLite 写入合成夹具；没有读取正式用户库。这些是后续 D01.1/2 的缺陷证据，不计入 B71 清空验收。

| 条件 | 预期 / 实际 | 证据及后续动作 |
|---|---|---|
| API 最近更新，最旧项置顶，其余两项更新 | 完整查询顺序 0、2、1；limit=1 逐页实际仅 0，下一页为空 | [PG 复现](../../tests/v25/.results/b71/pagination-api-repro.json)。ORDER BY 含 is_pinned，但游标条件缺该字段；游标必须覆盖实际排序元组 |
| API 三行处于同一毫秒，时间分别相差 100 微秒 | updated / created / usage 三种排序逐页均只返回首项，漏两项；title 对照三项齐全 | [updated](../../tests/v25/.results/b71/pagination-api-precision-updated-desc-repro.json)、[created](../../tests/v25/.results/b71/pagination-api-precision-created-desc-repro.json)、[usage](../../tests/v25/.results/b71/pagination-api-precision-usage-desc-repro.json)、[title 对照](../../tests/v25/.results/b71/pagination-api-precision-title-asc-repro.json)。PG 时间经 JS Date 损失微秒，游标应保存数据库精度 |
| Desktop 1001 条活跃记录，随后软删其中 501 条 | 普通 list 返回 1000；搜索返回 500；listDeleted 返回 500，但 DB 确有 501 条已删 | [SQLite 复现](../../tests/v25/.results/b71/pagination-desktop-repro.json)。v25 对预先截断列表再切页，无法到达尾部；须在 SQL 内筛选与有界分页，保留原 FTS 能力 |
| Desktop 显式写入非当前 workspace | create/update 均实际写入目标空间，但返回“提示词写入后无法读取”；显式 get 能读取 | [SQLite 复现](../../tests/v25/.results/b71/prompt-workspace-readback-repro.json)。写后 get 丢失 scope，须随 workspace 回归修复，不能因响应报错假定写入未发生 |
| 共享回收站首个 API 页只有活跃记录 | 源码推断：页面再过滤为零项，进入空态且没有加载后续页入口 | B73已补deletedOnly贯通及PC/移动真实HTTP/PG验证：正常首个30条页全为活跃记录，回收站仍可读35条，翻页失败后重试、恢复和筛选清空均通过；本片完整回归与扫描已通过 |

实施顺序：先修 API 游标排序元组、时间精度与无效游标错误；随后贯通 Prompt 专用回收站筛选、Desktop SQL 分页及 workspace 写后读取，完成共享页面实际查询/恢复与四端门禁。该顺序不替代 §4 的 Folder/Tag/Session、retention、GC 和最终合流要求。

B72推进：上述API置顶/微秒/Unicode分页现已修复，54项专项、当前check、完整API604P/1专用小时S与10份本轮实际ZIP扫描通过，仅B72已验；B73已修桌面查询截断和workspace返回问题，当前check、API52及完整E2E476P/7S与扫描已通过。阶段结果见[测试手册§5.71](./V25-MIGRATION-TESTING.md)。

B73具体修复、首次失败、当前源码与剩余出口见[测试续篇§5.72](./V25-MIGRATION-TESTING-CONTINUED.md)。旧非分页core调用和listDeleted仍保留原上限，不能将本次v25修复外推为全部旧接口或D01/D02已完成。

## 6. 下一阶段 Folder/Tag 核对与固定验收（B73 回归期间准备）

2026-09-13：只读核对现有源码后，在隔离 Python SQLite 内存库执行当前 `0004_peaceful_lucky_pierre.sql` 的五张原始 CREATE TABLE 和 Desktop IPC 原始 DELETE SQL。未修改生产源码或正在运行的 B73 构建。[实测记录与源码hash](../../tests/v25/.results/b73/taxonomy-schema-repro.json)显示：无关联 Prompt 时删除 parent 连带删除 child；有关联 Prompt 时触发 `NOT NULL constraint failed: prompts.workspace_id`。原因是复合外键 `(workspace_id, folder_id) ON DELETE SET NULL` 会尝试将两个字段都置空。这是**原DDL/SQL诊断**，不是完整迁移链、真实IPC或两设备同步验收。

另据当前源码：Desktop 文件夹与标签 create/update/delete 直写表，没有入同步 outbox 或调用调度；标签删除虽级联清链接，但未在该路径重建关联 Prompt FTS。API 已有 detach、版本递增和变更日志，仍保存软删行，并且 sync restore 分支可恢复 Folder/Tag；原 D01.1 要求硬删且不可恢复，不能只隐藏 UI 来销账。

B73完整回归结束后，按原D01.1/2固定下列实施/验收出口；目前均未登记通过：

| 子项 | 实施边界 | 必须证明的行为 |
|---|---|---|
| Desktop分类事务 | 复用core/workspace/sync设施，先摘除直接关联再硬删，避免复合FK清空workspace；重用既有FTS更新 | parent/child/grandchild及各层Prompt保留，只有直接引用置空；其他workspace同ID不变；任意中点失败全部回滚 |
| Desktop分类同步 | create/update/delete进入既有outbox与调度，关联快照随事务更新；遵守已同意/暂停/未同意边界 | 云端已知版本生成正确墓碑；未同步create后delete不产生幽灵重建；换号、暂停恢复和新PID后无跨空间修改；不绕过同步同意 |
| 标签关联与搜索 | 删除仅清目标标签关系；重建受影响Prompt的FTS，保留其他标签与正文 | 标签词不再命中过时FTS，其他标签仍可搜索；零引用/多引用/已软删Prompt和重复删除有明确结果 |
| API分类硬删 | 沿现有事务/版本裁决/detach/change log，保留返回快照和同步幂等回执；明确旧软删行及restore兼容拒绝策略 | 表中目标行真正消失；并发关联/编辑不会生成悬挂引用；版本冲突无副作用；重复mutation返回原回执；旧restore不复活实体 |
| 离线及消费者兼容 | 审查SyncService getSnapshot/冲突响应/bootstrap与desktop applyCloudSnapshot，不机械删除用于关联重建的公共逻辑 | 两个独立客户端中更新/删除交错、丢回包重放、陈旧版本、分页bootstrap、归档或已删Prompt关联均一致；已接受的删除不因旧请求重建 |
| 产品与最终门禁 | 共享分类管理保留确认/取消、失败提示、筛选刷新和子项可见性，明确不可恢复 | 实际PC/移动/桌面交互、真实API/SQLite/两客户端、check、明确build及受影响完整E2E通过；本轮实际归档扫描后按原范围验收 |

该准备不提前新增或勾选已完成批次；Session回收站/purge、完整排序parity、retention、GC及其他原范围继续。若修复需要DDL，须按desktop-db内联迁移和PG expand/contract分别执行，不能仅改历史迁移文件。生产运行仍需先用真实IPC复现以上诊断并确认迁移后的实际表结构。

### 6.1 同源码实际 IPC 方法与完整初始化复现

上述DDL诊断现已进一步通过**真实IPC方法表的schema解析/handler和core getDb完整初始化迁移**复现。当前源码仍为B73 `cb081ade…`，SQLite3.53.4、foreign_keys=1；在自有磁盘临时库启用合成账号同步，仅将网络调度器替换为空函数以隔离外部调用。没有启动另一个Playwright或修改正在回归的源码。

[实际结果](../../tests/v25/.results/b73/taxonomy-ipc-repro.json)、[运行日志](../../tests/v25/.results/b73/taxonomy-ipc-repro.log)确认：

| 实际方法路径 | 实际结果 | 后续必须修复 |
|---|---|---|
| createFolder parent→child→grandchild，再removeFolder parent | 三层均消失 | 仅删除目标；直接child的parentId置空，grandchild仍属于child |
| createFolder→create Prompt引用→removeFolder | SQLITE_CONSTRAINT_NOTNULL，提示词和文件夹均保留 | 事务内明确摘除Prompt.folderId，不能依赖复合SET NULL |
| createTag→create Prompt带标签→updateTag改名→removeTag | 改名后的新词搜不到；删除后旧标签词仍返回该Prompt，数据库链接已为0 | 标签改名、删除同步更新受影响Prompt FTS，验证其他词和其他标签保留 |
| 同步enabled=true期间上述分类create/update/delete | outbox只有两个Prompt create，无Folder/Tag变更 | 分类操作进入既有事务/outbox，保留准入与暂停规则；以两客户端验证最终一致性 |

该证据证明当前真实方法/初始化后的本机行为，**不等同跨进程Electron传输、新PID持久性或远端双设备同步已验收**。受控输入的首两轮分别遗漏Prompt和Tag必填nullable字段而被Zod拒绝，已按原契约补齐；[首轮](../../tests/v25/.results/b73/taxonomy-ipc-first.log)、[第二轮](../../tests/v25/.results/b73/taxonomy-ipc-second.log)保留，未更改生产契约接受错误夹具。复现脚本/束文件存于自有结果目录的`.source.txt`，后续须将断言转为正式就地回归，不用临时诊断代替交付测试。

### 6.2 Desktop 分类修复草稿（未接入产品）

B73完整E2E使用的源码保持不变。已将下一阶段的core分类事务仓库、Prompt搜索索引入口及薄IPC适配准备为自有目录中的源文本，通过内存编译覆盖运行。[草稿结果](../../tests/v25/.results/b73/taxonomy-overlay-check.json)及[准确输入hash](../../tests/v25/.results/b73/taxonomy-overlay-evidence.json)仅证明这些草稿与原core完整初始化能在临时SQLite配合，不代表已修复当前产品或通过check/Electron/远端同步。

草稿已验证：仅删除parent、child置空父关联、grandchild保留层级；有关联Prompt时成功摘除而不清workspace；标签新名称进入FTS、旧词不再残留；分类CRUD产生outbox，未上云create后delete消去待发创建；已确认云version7的分类删除产生原版本墓碑；Prompt已存在的delete意图保持原mutationId和delete操作，不被关联刷新压成update。Folder删除中点及Tag索引更新后outbox写入失败均完整回滚，父子循环被拒绝。云回执使用显式合成输入注入现有repository，只算本机同步状态机证据。

接入时须先登记后续实施卡并把断言转入正式就地测试，补其他workspace同ID、暂停/未同意、重复删除和真实Electron新PID／双客户端验证，再执行适用完整门禁。草稿保留现有本机合成version映射与权限守卫，未声称完成全部跨宿主版本parity。正式接入前还需按contracts推导草稿内部数据类型并完成格式/类型检查。

云端硬删除仍须独立完成：不能只把现有soft-delete的UPDATE替换为DELETE。当前同步依赖实体快照、版本冲突、bootstrap和持久mutation回执；需检查删除后及90天日志/回执裁剪后的旧请求重放，决定持久删除标记如何阻止重建、旧restore如何稳定拒绝、离线客户端如何移除已不存在分类。并发引用创建与detach亦须真实PG锁测试，避免未记录的FK置空或误改关联。若需新PG删除标记表，按原expand/contract及迁移矩阵验收；这些条件没有被Desktop草稿通过所覆盖。

草稿矩阵增量（2026-09-13，仍未接入）：[最新运行](../../tests/v25/.results/b73/taxonomy-overlay-matrix.json)在原正向与回滚场景之外补六组验证：未同意时不新增outbox；暂停时保留分类编辑，真实DesktopSyncEngine.run对受控transport调用为0；同名标签创建/改名稳定拒绝且无部分写入；其他workspace同ID的行、关联、FTS完全保留；重复删除NOT_FOUND且状态不变；只存在于其他空间的parent不能被关联。最新草稿已用PromptTag的Pick推导内部字段并增加事务内同名校验，[准确输入hash](../../tests/v25/.results/b73/taxonomy-matrix-evidence.json)与第一版分别保留。实际Electron传输/新PID、正式就地测试及远端同步仍待，生产分类行为仍是§6.1的未修复实现。

就地测试准备增量：分类草稿已整理为166行core测试源，经实际Vitest与限定的Vite内存加载运行，[11P/0F/0S报告](../../tests/v25/.results/b73/taxonomy-draft-vitest.json)通过，[测试及草稿hash](../../tests/v25/.results/b73/taxonomy-draft-test-evidence.json)保留。覆盖关联保留/事务回滚/FTS及其他词/三种同步同意状态/真实引擎暂停零发送/同ID空间隔离/重名/循环/重复删除。测试源与实现都仍在自有草稿目录，未安装进产品或正式测试目录，不代表check、Electron或远端合流已验；待B73当前全量回归归档后正式接入并按原门禁复验。

B73最终结论（2026-09-13）：原七项验收通过，完整E2E476P/7S、源码与本轮45ZIP/2明确UI替身扫描通过；§6的后续分类诊断/草稿不计作当前产品修复。接B74正式安装Desktop分类事务与同步，再按原D01处理云硬删除和Session，完整D01/D02及v2.5仍开放。

## 7. B74正式接入状态

2026-09-13：上述草稿首次接入源码88d31b65…，正式core11/IPC3加既有回归共56P，check36/36通过。§6各阶段保留当时的源码与隔离证据，不能继续把B73的分类缺陷称为当前本机实现。

最新3c395774…已补共享删除确认、失败重试和焦点恢复；真实双Electron/API/PG复现并修复分类墓碑先发送造成关联Prompt自身版本冲突。分类墓碑现在等待其已知云引用对应的待发变更回执，含退避/失败，按owner/workspace隔离且不阻塞无关删除。实际两个独立客户端与新PID通过，双方待发队列和冲突均为0；check36/36、源码扫描通过，完整三端E2E及本轮归档扫描仍待终态。当前API仍soft-delete，云硬删/持久墓碑/旧restore及Session、完整D01/D02继续开放。详细结果见[测试续篇§5.73.1](./V25-MIGRATION-TESTING-CONTINUED.md)。

## 8. B75 云端分类永久删除：已复现缺口与实施出口

2026-09-13：在 B74 完整回归运行期间，生产源码保持 `3c395774…`。以下使用自有 PostgreSQL 17 与内存 SQLite，执行当前真实 service、同步引擎和维护函数；**尚未实现 B75，也未通过其产品验收**。命令、输入脚本/结果 hash、清理状态见[诊断证据](../../tests/v25/.results/b75/diagnostic-evidence.json)，完整测试边界见[测试续篇§5.74](./V25-MIGRATION-TESTING-CONTINUED.md)。

| 已执行条件 | 实际观察 | 实施要求 |
|---|---|---|
| 当前 deleteFolder/deleteTag，再调用 restore | 两张实体表各保留一行，restore 均成功 | 分类永久删除必须移除实体行；旧 restore 入口不能恢复分类 |
| 假设将已摘除关联的软删行直接 SQL 删除，再用真实 retention 函数执行显式 now+91 天清理 | 13 条 change log 和 2 条 mutation receipt 被清理；客户端先收到游标过期，重新 bootstrap 后仍留有云端不存在的父分类和标签 | 不能靠 bootstrap 中“缺席”表示删除；须保留可分页传递的持久删除事实 |
| 上述清理后重放原 create mutation | folder/tag 均返回 applied，原 ID 被重新建立 | 删除身份的有效期不能等同于 90 天回执保留期；同 mutationId 和新 mutationId 都不得复活旧 ID |
| 真实父级校验通过后暂停创建，先提交父级删除，再恢复创建 | Prompt 与子 Folder 两种情况都成功提交指向已删父级的引用 | 删除前必须与引用建立协调；仅校验 SELECT 或最后 DELETE 的锁不够 |

第二、三行是明确标注的“仅改为物理 DELETE”反例，并非当前产品已经物理删除；91 天由诊断传入时钟，不是自然等待。第四行使用测试屏障排列真实事务，未宣称暂停了操作系统进程。诊断没有 HTTP/鉴权覆盖；最终同步适配器已用合法 UUID 与当前 contracts 校验所有 sync 请求/响应。

### 8.1 数据与兼容设计约束

- 永久移除 Folder/Tag 主表记录，保留最小删除身份：所有者、实体类型/ID、最终版本、原创建时间及删除时间。长期记录不保留分类名称、颜色、分组、父级或完整实体 JSON；现有短期日志/幂等回执仍按原保留策略处理。账号删除按其既有所有权清理规则处理。
- 同步 bootstrap 必须按同一个 ID 排序合并活跃实体与删除身份，保持现有 limit/after、快照游标和 owner 隔离。优先使用当前契约可解析的已删快照投影；若采用此路径，名称须明确为删除标记，时间来自持久事实，不能伪装成原名称或临时生成创建时间。不能只新增旧客户端忽略的字段而宣称兼容。
- create/update/delete/restore 与 REST、sync 入口共用服务事务裁决。原回执仍在时维持指纹校验和原结果重放；回执过期后按持久删除身份拒绝重新创建或恢复。重复 delete 的返回/错误需在合同与测试中固定；跨所有者不能泄漏删除记录。不能通过无限保留完整回执实现永久删除。
- 引用校验、关联摘除、实体删除、删除身份与 change log 必须共同提交或共同回滚。锁协议必须覆盖 Prompt/Folder 引用写入、标签关联及删除竞争，明确锁顺序和维护任务交互；不得在持锁事务中等待外部网络。重点验证删除先提交和引用先提交两种顺序，以及回收站清理竞争。
- 当前 Desktop 冲突“采用本地”会把远端已删除分类排成 restore。服务器需拒绝该复活路径，Desktop core 与共享冲突界面同步表达分类不可恢复；不能只隐藏按钮。Prompt 的软删恢复、保留本地副本及未删分类的正常冲突处理保持原语义。
- 使用新增 PG 迁移，保留历史 SQL。既有软删分类必须完成关联修正、删除身份回填及实体清理；上线次序区分 expand、兼容读写和实际清理，验证中间前缀与失败回滚。旧写入者仍能复活分类时不能宣称可安全混跑；不得用删除新表的 down migration 回滚已生效删除。

### 8.2 可执行拆分与验收

以下同属原 D01.1/2，允许按子项实施，整卡必须联合验收；不是额外产品范围，也不替代 Session/retention/资产 GC。

| 子项 | 交付物 | 必须成立的验收 |
|---|---|---|
| B75.1 存储与迁移 | 最小删除身份、索引/约束、增量迁移及历史回填流程 | fresh replay、中间版本升级、已有软删/关联数据、同 ID 隔离、重复执行/失败回滚；主表目标物理消失且无名称等内容被长期转存 |
| B75.2 事务服务 | Folder/Tag 硬删除、引用保护、版本和旧 restore 裁决 | 正常/已删 Prompt、三层 Folder 与其他标签保留；陈旧版本无副作用；两种竞争顺序无悬挂引用；事务各中点失败全回滚 |
| B75.3 同步 | 删除身份参与分页 bootstrap、请求重放及稳定结果 | 90 天日志/回执清理后仍可同步删除；离线新 bootstrap 无遗留；原/新 mutationId 均不能复活；跨 owner 拒绝、丢回包重放、分页无漏重 |
| B75.4 消费者 | Desktop core 冲突处理与共享界面、旧协议边界 | 已删分类的采用本地/restore 被权威层拒绝且不污染 outbox；采用云端清理分类并保留正文；Prompt 恢复及其他冲突功能回归通过 |
| B75.5 真实联合 | API/PG、两个独立 Electron 客户端、PC/移动页面 | 创建/修改/删除、离线过期重连、并发冲突及新 PID 后数据一致；确认/取消/失败保留与重试可用；不以直接 service 诊断代替实际协议 |
| B75.6 完整门禁 | 当前源码检查、实际数据库及完整宿主回归、扫描和逐条审核 | 明确 migrate/check/build，API/worker 相关真实集成和完整 E2E，源码/本轮归档扫描通过；逐项记录失败、skip、版本与迁移/回滚限制 |

实施前历史状态：当时仅完成 T0 代码核对和上述两个诊断命令，等待B74回归终态后接入B75。当前已完成主要实现与专项证据，整卡仍待完整门禁；见本文开头及§8.4，不能把此历史段落作为当前待开发清单。

**B74已验收（2026-09-13，最新）：** Desktop分类事务、共享删除确认、FTS与真实双客户端同步/重启已完成；修复关联Prompt自身版本冲突。当前check36/36、明确build、完整三端E2E479P/7S/0F/0 flaky、源码及45份实际ZIP/2份UI替身扫描通过。7项skip逐项保留外部凭据与视口边界。接B75云端永久删除，再补Session、完整保留期/GC、费用和正式交付；管理员未开始。[最终测试及逐条验收](./V25-MIGRATION-TESTING-CONTINUED.md)。


### 8.3 B75 首轮正式实现

B74终态验收后，已接新增PG迁移0023、最小删除身份、Folder/Tag硬删除事务与引用锁、旧restore拒绝、请求ID复活冲突及bootstrap合并分页。当前3bb13839…的API27P、worker98P/2容器条件S、check36/36和源码扫描通过；根db:migrate在新隔离PG首次/重复均成功。首次正式测试9F及格式/类型修复均保留，详见[测试续篇§5.74.1](./V25-MIGRATION-TESTING-CONTINUED.md)。

§8开头诊断与§8.2“仅T0”文字是实施前历史快照；当前已经进入T1/T2，但B75.1–6均未按完整出口关闭。继续历史软删回填/前缀/回滚、长期裁剪/重放/分页及隔离矩阵、标签与purge竞争、Desktop core/共享冲突界面、真实双客户端及完整宿主验证。当前B75不能承接B74源码的全量E2E结论。


### 8.4 B75 当前接续：消费者与历史回填已接（2026-09-13）

Desktop core/IPC/共享UI的已删分类local拒绝已实现；真实双客户端离线编辑、云删除、冲突、新PID与remote采用已验，Prompt正文保留，正常分类与Prompt恢复回归通过。另接入0023后的独立分批回填工具：preview零写入、每批1–100、逐实体事务、原时间/版本、引用/日志修复、重复执行、失败重跑及异常数据拒绝；当前API/PG专项51P，包含34项历史前缀/回滚与7项回填验证。详细源码归属、首败和实际结果见测试续篇§5.74.2–3；此前“消费者/回填未实现”是历史阶段状态。

继续B75.2/3的完整owner/版本/并发/多页bootstrap与90天裁剪后原/新mutation重放，真实离线过期重连、新PID，再补当前完整API/worker/E2E、源码及新归档扫描和原六项审核。§8.2原验收范围不变；Session、全保留期/GC、费用与正式交付仍开放。


**B75长期离线与事务进展（2026-09-13）：** 90天边界/91天显式维护时钟裁剪、原/新请求防复活及每类205项混合分页已有真实HTTP/PG证据；双独立Electron的保留/过期日志与新PID专项4P。扩展分类事务与HTTP44P，覆盖中点回滚、跨owner、引用及实际worker清理竞争；该轮check36/36通过。当前正执行三形态分类与完整后端联合门禁，B75尚未验收，管理员未开始。准确源码、首败及测试时钟边界见[测试续篇§5.74.4](./V25-MIGRATION-TESTING-CONTINUED.md)。

## 9. 下一阶段 Session 核对（B75完整回归期间，未接入新功能）

2026-09-13，当前冻结源码`05cd8f1f…`保持不变。已使用自有PostgreSQL17、正式WorkbenchService和合成记录完成[分页诊断](../../tests/v25/.results/b75/session-pagination-diagnostic.json)：两条updated_at分别为`04:00:00.999002Z`、`04:00:00.999001Z`，limit=1。第一页返回较新记录，但游标把时间截成`.999Z`，第二页返回空、遗漏另一条实际存在的会话。该结果是缺陷复现，不是产品测试通过，也不含HTTP或浏览器覆盖。隔离数据库和连接均已关闭。

同一诊断验证归档→软删→恢复的现有云端语义正确：恢复只清deletedAt，原archivedAt不变，恢复后的会话仍在归档列表。后续实现应保留这一行为。

源码核对确定的接缝：

| 接缝 | 当前事实 | 下一阶段验收要求 |
|---|---|---|
| contracts / gateway | workbenchSessionListQuery没有deletedOnly；WorkbenchGateway有软删/恢复，没有purge/清空 | 从现有合同扩展回收站查询和永久清理，明确与archivedOnly组合的裁决；贯通API客户端、IPC和共享页面 |
| 云端列表 | PG以updated_at/id倒序，但游标转JS Date丢失微秒 | 同排序元组保留PG精度；有界多页无遗漏/重复，错误和跨筛选游标明确拒绝；实际HTTP复验 |
| 桌面列表 | v25 IPC使用OFFSET，非法cursor解析失败回到0 | 核对分页期间插入/删除/更新行为，落实与云端相同的查询语义；不能把返回第一页冒充游标合法 |
| Session→作品 | SQLite的generation_runs.workbench_session_id为ON DELETE SET NULL；PG generation_runs.session_id当前无FK | purge只删除会话/草稿，作品、资产、执行/费用记录保持；PG显式按owner摘除session关联，并协调生图写入/恢复/维护竞争；不能依赖不存在的PG外键 |
| 桌面写入 | v25返回SYNTHETIC_VERSION；update未使用expectedVersion，标题/归档/草稿多步写入 | 会话parity实施时核对版本与原子性，不把当前合成版本当作已验证的CAS；如需SQLite增量schema，走受管迁移及bundle流程 |

以上是原D01.1/2和parity范围的准备信息，尚未建立已完成的新批次，也不提前关闭B75。建议接续任务先完成Session查询/版本和事务基础，再贯通回收站产品与purge；最终覆盖正常/归档/软删/恢复/永久删除、实际作品保留、失败回滚、跨owner、引用先提交/清理先提交、双宿主与新PID。完整retention/GC和费用/发布仍按原任务依赖推进。

### 9.1 实际桌面IPC/SQLite诊断（源码未改）

[四组隔离诊断](../../tests/v25/.results/b75/session-ipc-diagnostic.json)现已通过真实`workbench-domain`输入schema/handler和core数据库完整初始化复现；[运行结果](../../tests/v25/.results/b75/session-ipc-diagnostic-vitest.json)中的4项通过表示“确认当前缺陷”，不表示产品正确。Electron路径/日志/生图适配器替身只为隔离环境；generation调用为0。没有启动另一份Electron、没有测试跨进程IPC或新PID，临时SQLite及目录均已关闭。

| 实际操作 | 当前可重复结果 | 实施出口 |
|---|---|---|
| 创建会话后用expectedVersion=999改标题 | 写入成功，返回version仍为1 | 持久版本及原子CAS，陈旧写入无任何副作用；所有相关写者与迁移兼容需一起核对 |
| 标题+归档+草稿一起更新，SQLite触发器在草稿写入处抛错 | 标题和归档已提交，草稿仍为旧值 | 同一个会话业务写入在单个SQLite事务中提交/回滚，失败不返回部分成功 |
| createSession时草稿INSERT抛错 | 已留下会话行，草稿行不存在 | 会话与初始草稿原子创建，失败后无孤立空会话 |
| 三条记录按updated_at倒序，读limit=1后删除第一页记录，再续cursor | OFFSET=1跳过仍存在的中间记录；非法cursor也被当作第一页接受 | 使用严格游标与明确分页语义，删除上一页内容不导致后续静态记录漏项，错误游标不得静默回退 |

首轮3项复现、1项夹具失败的记录亦保留：[原结果](../../tests/v25/.results/b75/session-ipc-diagnostic-first-vitest.json)。当时仅把updated_at设为10/20/30，违反现有`updated_at >= created_at`检查；已改为合成的同一合法created_at及其后的三个updated_at，数据库约束保持不变。没有修改生产代码或放宽约束来制造结果。

### 9.2 Session接续子任务与验收顺序

下列是原D01.1/2与会话parity的任务拆解，不增加重复父卡，不表示已实施；B75门禁终态后按当前源码重新核对。

1. **S01 查询与合同**：补deletedOnly及与archivedOnly/includeArchived/includeDeleted的明确组合规则；沿现有响应合同保持实体字段，从contracts推导。PG保留排序元组的微秒精度；Desktop从OFFSET切到严格游标并明确旧游标失效恢复。验收单页/多页/相同时间、前页删除、新记录、错误游标和筛选切换，实际HTTP/IPC返回一致。
2. **S02 桌面写入原子性与版本**：将会话/草稿业务事务放入core存储服务，IPC保持薄接线；新增受管SQLite版本迁移时必须生成内联bundle。核对WorkbenchRepository的ensure/touch、v25创建/编辑/归档/软删/恢复及存量入口，明确哪些变化增加业务版本，避免某个写者绕过CAS。验收陈旧版本零变更、两个写者竞争只有合法结果、create/update中点失败全回滚、旧库升级和新PID持久性。
3. **S03 双端永久清理**：沿现有gateway/API/IPC补单条purge及需要的清空能力，只允许回收站记录。Session、草稿清理与作品session引用摘除原子提交；generation、资产、原请求/费用/执行账本保留。PG不能依赖不存在的session FK；核对本机迟到ensure/生图恢复是否会重建已清理会话。验收恢复先提交/清理先提交、生成引用先提交/清理先提交、跨owner、重复动作及事务中点失败，不自动重发生成请求。
4. **S04 共享产品闭环**：先按V25-UI-SPEC更新会话回收站状态矩阵，再复用已有数据/归档和删除确认组件接入查询、恢复、永久删除/清空、失败保留及重试。恢复已归档会话仍回归档，删除/永久清理当前会话后导航与草稿不串会话；窄屏/键盘/焦点、关闭取消、计数与列表刷新有实际宿主证据。
5. **S05 联合验收**：正式就地单测→实际PG/SQLite故障与竞争→实际API/PC/mobile/Electron及新PID→当前migrate/check/build/完整E2E→源码与实际新产物扫描，保存首败、skip和源码归属。若涉及新迁移，补fresh/prefix/字段等价/回滚与安装包内迁移；不能把隔离诊断4项通过当成S01–S05完成。

可领取的准备目标：**完成S01的严格会话查询和多页行为，复用本节已复现的PG/IPC诊断建立正式红→绿回归；不提前关闭完整Session父范围。** 完整Session目标应携带S01–S05全部出口。保留期、Automation/Skill审计与资产GC继续按原D01/D02下游处理。

### 9.3 B76 查询切片接入（2026-09-13）

S01生产实现已接入：contracts新增deletedOnly，有效过滤依次为回收站、仅归档、其余包含开关。回收站包含普通及已归档的删除会话；归档视图仍排除已删除会话。新游标包含版本、存储类型、有效过滤、ID和六位小数UTC时间，拒绝旧OFFSET、旧无版本云游标、畸形编码及变更有效筛选的续页；等价筛选开关可继续翻页。拒绝时提示刷新列表。公共实体时间字段不变。

PG直接使用数据库微秒排序值和C字节序ID作为边界；Desktop会话查询移到core，使用SQLite时间/ID的keyset及BINARY顺序，IPC只转换输出和结构化错误。作品历史的原OFFSET解析未改。分页为有界的当前位置续读，翻页期间新增或更新到边界之前的记录通过刷新列表取得，不宣称跨多次请求的冻结数据库快照。

正式红测复现微秒漏项、回收站筛选缺失和游标未严格拒绝：PG11P/10F、本地7P/10F，部分失败共享同一分页根因，不是20个独立缺陷。修复后PG21P、本地契约/core/IPC及既有工作台84P、check通过；新增真实API bin/Better Auth/PG回收站分页/跨owner/归档恢复后联合22P，客户端完整文件30P。准确源码与阶段结果见[测试续篇§5.75.1](./V25-MIGRATION-TESTING-CONTINUED.md)。

该查询切片不代表B76整卡验收。S02后续实现见§9.4；S03永久清理及生成引用竞争、S04共享会话回收站界面、S05完整实际宿主/迁移/门禁和产物扫描仍待。

### 9.4 B76 会话版本与事务接入（2026-09-13，专项通过、整卡未验收）

SQLite新增受管增量0010，Session已有记录和新记录默认version=1，11份迁移已内联。core集中创建、读取、修改、删除/恢复和旧草稿导入：创建与草稿写入同事务，组合修改只增一次版本，陈旧版本或已删除会话拒绝修改且零变更。旧rename/archive/softDelete也递增版本；仅生图活动touch更新排序时间，不改变草稿业务版本，时间不倒退。列表的行、版本、草稿和派生任务读取使用同一SQLite读事务，防止另一进程在中途提交造成版本与草稿错配。旧提示词引用的固定版本回退仍独立保留，不再和Session共用常量。

旧草稿仅补入现有会话尚无草稿的记录，每次实际补入增一次版本，不覆盖新草稿、不移动会话排序时间；整批中途失败全部回滚。12000字符及旧比例草稿保持可读，改标题不重写草稿。PG原有CAS继续复用，另补已删除状态预检和UPDATE谓词，与Desktop一致。

本地97项专项通过，含9个历史受管前缀数据保留、全新/重复迁移、故障回滚、旧写者失效、两个独立OS进程在SQLite写锁下争写及第三个新PID读取胜者；随后IPC完整文件11项通过，增加另一连接在列表两次读取之间提交的实际交错。PG写入5项加查询/实际HTTP联合27项通过。源码、首败和检查归属见[测试续篇§5.75.2](./V25-MIGRATION-TESTING-CONTINUED.md)。当前没有B76完整Electron/三形态E2E或安装包迁移验收，不能把专项结果当作整卡完成；继续S03–S05与原九阶段。

### 9.5 B76 永久清理服务接入（2026-09-13，产品界面/完整宿主验收待续）

共享gateway新增`workbench.purgeSession(id)`和`workbench.emptyTrash()`，统一返回本次实际删除的`{ purged }`。HTTP分别为`POST /workbench/sessions/{id}/purge`和`POST /workbench/sessions/empty-trash`；Desktop单通道IPC同名接线。不存在或不属于当前云账号的ID返回0，不泄漏存在性；未软删会话拒绝永久删除。清空覆盖已归档及未加载页的全部回收站记录，空回收站返回0。两端均在同一事务中删除会话/草稿并摘除作品的session关联，保留作品、资产、原请求、费用和执行记录。PG按锁定集合分500个ID执行SQL，整体仍是一笔事务；并发新进入回收站的行留给后续动作。

SQLite新增0011受管迁移，12份SQL已内联。`workbench_session_deletions`仅保留ID与清理时刻，不保留标题/草稿，也不按普通回收站期限过期，否则旧入口可再次使用相同ID。INSERT及改ID的数据库触发器与legacy ensure共同拒绝复用；旧recipe库导入遇此ID跳过会话、仅导入关联置空的作品。尚未接管Drizzle的旧迁移路径没有此表时保持原合并语义；已受管启动会先迁移/校验再合并，不能用这个兼容分支跳过新库保护。

PG不新增Session墓碑：公开create由服务端分配新ID，缺失ID不能由生成入口ensure重建。普通生成查询取得Session共享行锁直到任务/回执提交；方案生成原有共享锁保留。显式重试读取原作品后还要重验并锁定继承的会话关联，防止旧快照在清理后重新挂接。恢复与永久清理使用冲突行锁，恢复胜出则purge拒绝，purge胜出则恢复404。清理本身不发生成请求，不改变原幂等回执。

专项证据包括501条清空、事务故障/DDL回滚、新PID旧库导入、真实core生成入口阻断、HTTP身份隔离与重复调用、PG恢复/清理两种锁顺序、生成准入先持锁及重试旧快照竞争。准确计数、夹具修正及源码归属见[测试续篇§5.75.3](./V25-MIGRATION-TESTING-CONTINUED.md)。Desktop同时恢复/清理的实际双宿主行为、共享回收站界面及完整API/worker/E2E/产物门禁仍需在S04–S05合流，本节不关闭B76或全生命周期父卡。


### 9.6 B76 S04共享界面接入（2026-09-13，整卡开放）

设置数据卡已有会话回收站；恢复保持归档位置，永久删除/全量清空使用独立确认和实际计数，失败保留并可重试。列表加载错误与后页错误分别处理，未加载页交给服务端全量清空。当前会话删除/归档成功才导航，保留既有剩余会话回退，无剩余会话才清空旧草稿；分页未出现须按ID核对，网络错误不当作删除。

133项组件/工作台联合、真实API/PG的PC/mobile及实际Electron/SQLite新PID共3项通过，当前统一检查和源码扫描通过，准确源码及首败见[测试续篇§5.75.4](./V25-MIGRATION-TESTING-CONTINUED.md)。原完整E2E已因确认草稿覆盖缺陷而主动停止；后续修复与真实宿主结果见测试续篇§5.75.5，整卡门禁继续开放。


**B76最新进展（2026-09-13）：** 草稿冲突核对与会话回收站的真实PC/mobile/Electron六项已通过，追加桌面同时IPC恢复/永久删除两种顺序及新PID两项已通过；不同源码、截图及测试错误码首败分开记录。局部92P、统一检查36/36已有通过证据；继续当前完整后端与S03/S04剩余范围审核、S05全E2E和产物验收。原完整E2E已主动停止，B76及全迁移未验收，管理员未开始。详见[测试续篇§5.75.5](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B76最新进展（2026-09-13）：** 完整后端API697P/1专用小时S、worker101P/0S及8份实际方案ZIP扫描通过，准确源码分开保留。另复现并修复重新载入后旧排队草稿借用新版本的问题，工作台/写入器回归和check通过；PG清空集合两种竞争及新到达保留10项通过。当前9项真实宿主复验运行中，完整E2E和原范围验收继续；B76及全迁移未关闭，管理员未开始。详见[测试续篇§5.75.6](./V25-MIGRATION-TESTING-CONTINUED.md)。


**B76最新进展（2026-09-13）：** 已修复重新载入后的防抖/排队草稿及迟到回包隔离，真实三形态会话专项9项通过，包含作品落盘后清理及新PID。PG清空新到达/恢复竞争、隔离根迁移首次/重复、当前check与源码扫描通过；此前完整API697P/1专用小时S、worker101P/0S和8ZIP扫描保留准确归属。当前完整三端E2E运行中，B76及全迁移未验收，管理员未开始。详见[测试续篇§5.75.6](./V25-MIGRATION-TESTING-CONTINUED.md)。

**B76最终验收（2026-09-13）：** §9.2原S01–S05对应17项要求均有证据；当前实际包内升级及App/DMG/ZIP扫描通过。完整E2E497P/7S和后端/专项按各自源码记录，未取消任何原验收条件。仅关闭B76；下一接§4第3项保留期与有界维护，真实用户旧库和其他平台交付不由本地包证明替代。[验收报告](../../tests/v25/.results/b76/acceptance.json)。


## 10. B77 Automation/Skill保留政策核对历史（最终验收见§12）

当前源码区分至少四类数据，不能以Skill运行时30分钟缓存过期推断费用审计也可删除：

| 数据 | 当前源码事实 | B77必须保持或继续落实的条件 |
|---|---|---|
| SQLite `automation_audit` | `packages/core/src/services/audit.ts`完整记录G/R/S花费及批准路径；仅按200条限制读取，不裁剪持久表 | 沿用本机完整审计语义；30天Prompt/作品清理不能连带清除费用、批准路径或未知费用事实。需要逐入口持久性/删除引用测试 |
| 持久Automation请求/调用及managed执行账本 | `automation-spend.ts`终态与审计原子写入；`managed-generation-ledger.ts`亦写独立审计 | 保留幂等、原账号/月、授权与未知费用；历史/会话删除不等于撤销执行事实，不能复用旧key重发；逐表FK和清理入口仍须核验 |
| 端点请求NDJSON及内存环 | B77已接可信路由模板及串行轮转：当前/上一份各2MiB，新单条4096字节、排队200；内存环仍200，固定故障/恢复告警 | 旧大文件下一次成功写入前保留完整尾行；固定pending最多另2MiB，失败保持原文件并重试。实际文件14项及Electron停止/新PID已验；完整R05和最终宿主门禁继续，费用表不受此容量策略影响 |
| Skill暂态runtime和执行控制器 | 授权摘要和执行均检查30分钟精确到期（>=）；prepare同样惰性清理，执行控制器在finally释放 | 已有8项到期前/到点/过期、摘要不符、活跃取消和失败释放回归；仅暂态缓存过期，不删除持久费用或来源，不恢复冻结UI。完整宿主/逐入口矩阵继续 |

本节是基于源码的分类和实施约束，未声明审计全量验收。Cloud MCP继续只读，本地Agent不可逆动作按已有权限/确认/审计链逐入口验证；不得为了清理审计额外开放远程destructive工具。后台管理仍在全部2.5验收后启动。


### 10.1 本地授权修复与日志待办（2026-09-13）

11个本地入口包括Provider创建/密钥/删除/激活/验证、备份创建/列表/恢复、库导出/导入和Prompt删除。它们仍要求Bearer及60秒一次性文件质询；未知质询必须零文件动作，已签发质询无论成败只清理可信记录路径，刚好到期亦拒绝。路径误删正式红→绿、入口矩阵及真实Electron证据见[测试续篇§5.76.6–7](./V25-MIGRATION-TESTING-CONTINUED.md)。本地守卫通过不代表所有管理业务、审计保留或整个R05已验收。

端点日志下一步沿当前main.log的2MiB轮转惯例制定有界策略，区分最近诊断与完整费用事实；仍需处理单条上限、串行写入、现有大文件、写失败/恢复、重启和实际宿主证据。真实HTTP已观察到端点audit保留原始请求路径参数，需改为可信路由模板及受控未知标记，避免用户输入进入日志。这是待实施项，不是已有轮转/脱敏保证。SQLite费用、批准路径、持久执行/回执与来源引用继续保持原完整保留规则，不新增30天自动删除。

**§10.1更新：** 原始审计路径已在服务端改为可信路由模板/固定未知标记，111项Automation/MCP回归通过；实际Desktop磁盘记录尚在补验。端点NDJSON仍未轮转，完整费用审计保留与Skill运行时/有效引用的原矩阵尚未验收。详见测试续篇§5.76.8。

**实际磁盘补验（§5.76.9）：** 6d9bf7ca…Electron5项通过，确认本轮NDJSON不含原始路径参数/查询标记或token；持久费用表保留、端点轮转和完整R05仍待。初次读取错误目录的失败已保留。当前没有在跑的完整Electron，原全量必须补开数据库门控后重跑。


### 10.2 已接端点日志容量策略（2026-09-13）

§10.1“尚无轮转”是当时状态。当前`automation-request-log.ts`由主进程recordAudit消费，文件位置仍为`getPaths().logs`（core的LOGS_DIR_NAME命名空间）；当前/上一份各2MiB、4096字节新单条、200个排队/在写记录。固定pending在正常结束移除，崩溃最多遗留另2MiB，下一写入先清理；超大旧文件或半行按完整尾部恢复；I/O失败不继续追加突破容量，未完成替换的源文件保留，已完成轮转的最近内容在上一份中，失败请求的诊断可能缺失。发固定诊断并在后续写入恢复。新请求超过单条/队列预算会明确产生“诊断未保存”告警，业务费用仍沿原持久账本，不当作0费用或重新执行。

端点文件政策的真实文件、注入失败、宿主关闭排空/新PID与路径保护证据见[测试续篇§5.76.10](./V25-MIGRATION-TESTING-CONTINUED.md)。不把正常重启当作SIGKILL途中改写验证，也不把本地日志容量限制当作SQLite审计TTL。完整G/R/S费用与批准/回执保留、Skill暂态到期和有效引用、原R01–R05剩余仍待。

**10.2补验：** 受控子进程在pending同步后、rename前被SIGKILL，新PID恢复与残留清理诊断通过；详情见测试续篇§5.76.10。该诊断尚待固化长期测试，完整Electron当前已带数据库开关运行；不采用§10.1旧记录中的“无在跑进程”作为当前状态。


### 10.3 费用持久表与Skill暂态缓存的专项证据

真实SQLite清理测试17项覆盖三种费用结果×五个内容清理入口、七张非空表、重新打开数据库、200条读取上限与父表FK拒绝。费用未知在未来月份仍不能被当作0费用，同意图回读原请求且禁止重新claim。G/R/S完整审计走实际record服务，尚不等价于全部HTTP/授权/云GC联合验收。Skill精确TTL两处缺陷已修，8项专项包括活动取消及异常后控制器释放；原有运行不会仅因准备缓存过期被清除。详情见[测试续篇§5.76.11–12](./V25-MIGRATION-TESTING-CONTINUED.md)。当前e2d83acc…统一检查与源码扫描通过，完整Electron运行中；B77保持开放。


### 10.4 B77全阶段暂停与暂存子表锁边界

实际生产bin已验证两种maintenance别名暂停时十八张非空表和S3保持原样；新PID恢复完成八阶段，未到期数据保留；对象删除失败的持久重试可暂停并跨新PID恢复。另补包/来源各1001条分批，复现两种子表锁等待超过4秒，现统一复用db内2秒事务锁超时；失败回滚不污染池连接设置。当前8c2fb7f8…联合17P、worker本机118P/2正式容器S、统一检查及源码扫描通过，完整API在跑。父候选数有限不等于子资产总量和整轮时间已证明有限；原R01–R05仍须全部核对。证据见[测试续篇§5.76.13–14](./V25-MIGRATION-TESTING-CONTINUED.md)。


### 10.5 本轮已证实结果与下一处实际缺陷

来源文件清理现有100父候选/1000子文件共享预算；真实PG6项包含剩余续跑、入队失败全回滚、批次外行锁、绑定和上传租约保护。时区/费用回执/来源引用8项已通过，既有API699P/1专用小时S和8实际ZIP扫描已终态。当前文件预算生产修改对应的完整API已699P/1专用小时S、8实际ZIP扫描通过，当前统一检查已通过；详细来源及结果见[测试续篇§5.76.15–16](./V25-MIGRATION-TESTING-CONTINUED.md)。

生成资产、Prompt使用明细仍可随单个父记录一次清理1001行，已用真实PG复现。后续需有界且持久可续跑的永久删除过程，并协调restore、费用回执、输入引用与级联子表；不能恢复出部分已删的对象，也不能以只限制父行数当作全部处理有界。B77继续原R01–R05验收，完整物理GC/费用/交付及管理员按原先后关系推进。


### 10.6 已接关联行分批永久删除

§10.5中的生成资产/Prompt使用明细超量问题已修复，并扩展覆盖生成事件、普通/方案输入引用及Prompt标签链接。每类子表每事务1000行，整个候选集共享预算，所有相关子表清空后才删父；原30天门槛保持。首批`purge_started_at`表示不可逆，API隐藏该对象并拒绝恢复，之后可跨新PID继续；费用回执在首批记录永久清理且保持原金额、unknown和key，后续不重复增加revision。期间pause不撤回标记、不继续删除；后续批次失败仅回滚当批。

真实HTTP恢复竞争、旧库升级/迟到写入拒绝、正式bin首批后SIGKILL/暂停/新PID恢复和费用回执已取得专项证据。当前统一检查及Worker本机全src227P/2正式容器S通过；完整API仍运行。实际命令、首次失败、源码和剩余范围统一见[测试续篇§5.76.17–18](./V25-MIGRATION-TESTING-CONTINUED.md)。该进度未关闭B77，也不代替完整资产GC或费用父卡。


### 10.7 重试准入与对象队列锁协调

retry源run使用KEY SHARE抵御retention的FOR UPDATE/DELETE，保留Session关联可被清理的语义，并在准入前重新核对Session；新两种次序验证已在实际PG通过。对象队列过期入队/确认/保护丢弃/租约延后/失败退避统一两秒本事务锁预算；混合保护变更同事务回滚，失败保留durable intent供下一次维护。原费用及被引用对象保护语义不变。实际首败、修复、测试时钟限制及当前门禁见[测试续篇§5.76.19–20](./V25-MIGRATION-TESTING-CONTINUED.md)。B77与完整GC仍待各自原范围验收。


### 10.8 R05逐表与入口证据边界（接续依据）

以下核对现有用例实际内容，不新增父卡，不把服务层存储测试等同完整产品流程。源码归属见[本地输入核对](../../tests/v25/.results/b77/retention-r05-input-lineage.json)：本地Desktop/core/Automation/MCP、契约和Electron用例自e2d83acc…未改变；API/PG已经改变，因此不能把旧181P整体改称当前云端联合结果。

| 表 / 状态 | 实際入口与已有证据 | 原R05仍需核实的边界 |
|---|---|---|
| automation_audit | 实际audit.record为G/R/S写非空记录；200条读取上限不删除更早数据；跨月份/重开SQLite保持。17项专项中15项为三费用状态×五种内容动作 | record调用不能证明完整HTTP→批准→执行→审计链；核对这条链与当前删除入口的组合，复用原C3/P5/P6结果而不冒领费用父卡 |
| automation_spend_requests / automation_spend_calls | 真实ledger.register/claim/applyReceipt后非空，五种动作后逐字段相同；同意图回读原请求、重新claim被拒绝；删除被引用请求/call的FK负例 | 五种动作中的history-delete实际是softDelete，不能声称已经验证本地物理图片purge；完整资产GC保留原D02范围 |
| automation_spend_policies / automation_budget_periods | 同一真实SQLite夹具保留原月预算；unknown在未来月份仍消耗可用额度；policy FK拒绝 | 不等于已完成所有账号切换、备份恢复和真实月份费用联调；对应原费用/恢复父范围核对 |
| managed_generation_requests / managed_execution_checkpoint | 真实受管账本与加密anchor配合，费用回执后重开库、原key不得重新claim；以上七表均断言非空后才比较 | 全部管理入口造成的账号/epoch变化需复用并核对现有真实入口证据；禁止用空表相等替代持久性 |
| 端点NDJSON / request ring | 真实HTTP可信路由、11个local入口的token/一次性质询矩阵；实际文件轮转/错误恢复与SIGKILL；Electron启停/新PID保留 | 11入口矩阵的业务ops是spy：它证明授权守卫，不证明每项真实备份/导入/删除的业务后果；有正式Electron业务证据的入口单独关联 |
| Skill runtimes / executions Map | 8项在TTL前1ms/到点/过期、摘要变更、活动取消、异常finally释放；过期前允许正常执行，过期后不stage不调用provider | reader/provider是fixture；验证暂态寿命和有效引用保护，不声称真实仓库/图片/付费链或持久来源GC已经通过 |

对应就地源：[七表保留17项](../../packages/core/src/services/__tests__/automation-retention.test.ts)、[11入口授权矩阵](../../packages/automation-server/src/__tests__/local-routes.test.ts)、[Skill暂态8项](../../apps/desktop/electron/main/ipc/__tests__/skill-runtime-retention.test.ts)、[正式Electron端点日志](../../tests/v25/electron.automation-log-retention.spec.ts)、[正式Electron会话/作品保留](../../tests/v25/electron.session-generation-retention.spec.ts)。后者确实执行本地loopback生图与Session永久清理，但不保证七张费用表均非空；不能与七表服务测试简单相加后宣称端到端全表已验。

接续先选实际仍缺的组合：正常本地Agent请求产生非空执行/批准/费用记录→经真实受权内容删除入口→重启→逐表/冻结来源/原key回放核对；现有单元授权、TTL、日志轮转和已验Session产品流程均复用。涉及真实上游费用、全资产物理GC或旧库/备份的条件继续归原父范围，不能删掉这些条件，也不重复实现它们。


### 10.9 真实宿主七张非空费用表与物理清理补验

§10.8所列“真实G/R/S→非空七表→清理→新PID重放”的缺口已有两条长期Electron用例：单条purge和empty-trash均经过实际HTTP授权Prompt删除、IPC Prompt/Session/历史清理，七张非空表和四张正式来源表逐字段不变；两张被清理图片实际消失、R/S两张图片哈希保留。新PID重放原G/R/S key回同一任务且不新增图像/文本/GitHub/云生成调用。当前相关联合10P，实际范围和首次夹具失败见[测试续篇§5.76.24](./V25-MIGRATION-TESTING-CONTINUED.md)。

这补充正常成功路径的真实宿主证据；§10.8关于unknown/换号/备份、11入口业务spy、外部付费和全GC边界仍有效。局部物理清理正例不能证明所有受管路径/符号链接和磁盘删除故障安全。原R05与D02父范围继续，不新建重复父卡。


## 11. Desktop生成资产持久清理（原D02增量）

单条purge和清空回收站的四条真实负例已复现误删，现统一进入local_asset_cleanup事务意图；仅pictures/previews真实文件可清理，userData数据库/外部原件/symlink/目录拒绝。文件身份变化blocked、存活作品/执行参考图/方案资产和来源保护、失败退避、启动和每分钟100文件续跑已接。0012迁移及内联13项旧库升级/重放与相关66项通过；首次失败、准确源码及当前实际Electron状态见[测试续篇§5.76.25–26](./V25-MIGRATION-TESTING-CONTINUED.md)。

本节取代§1原“删除失败仅告警”和两种路径保护不一致的当前状态描述；保留旧文为历史证据。未知孤儿发现、其他资产类别、staging竞争及完整S3/Windows环境继续按原D02验收，不能以本轮生成文件清理闭合整个GC父卡。


## 12. B77原保留期与维护范围验收，完整GC接续

2026-09-14已完成B77原R01–R05的25条逐项验收，当前完整Worker236P/0S、完整Electron185P/2外部凭据S、实际同步7P+12P、check36/36及源码/17实际ZIP扫描通过。[最终证据和范围](./V25-MIGRATION-TESTING-CONTINUED.md#57628-b77原r01r05最终验收及接续2026-09-14)明确区分真实HTTP/SQLite/PG、回环S3与外部生产；保留期30/90天、暂态Skill30分钟、诊断日志容量和持久审计保留政策按各自语义执行。

§10各小节保留阶段历史。完整GC仍是当前下一阶段：沿§2资产目录补云端无DB意图对象的持久发现/宽限期/引用与租约复查，再补全部本机资产与staging。生成历史本轮持久删除/失败重启已有证据；不能外推为其他类别或任意OS竞争已验。费用、真实旧库/四端、发布部署继续原父任务，管理员仍在整包之后。


## 13. D02 云上传保护与真实对象存储故障验证（2026-09-14）

原 G-DATA-02 继续开放。D02.2 检查发现：`findProtected` 已保护 canonical 资产/来源/运行引用、包和执行租约，但未覆盖没有链接且 TTL 尚未到期的 `generation_reference_uploads`。这张表同时承载 Composer 参考图和方案图片上传。仅在过期扫描入口过滤 TTL 不够：历史残留或后续 inventory 入队的清理意图会直接进入最终删除检查。

当前查询将没有独立 package stage、`uploading` / `available` 且 `expires_at > now` 的记录列为临时保护；只延后清理，保留队列事实，不增加失败次数。到达精确期限后，原退休流程重新登记待清理并允许回收。`cleanup_pending` 的已失败上传不被单纯的未来期限永久保护；canonical 引用仍优先保护。共享 registry 中的专用包上传按 package stage 自己的状态/上传租约判断，取消后的包不会被 registry 的普通 TTL 额外延长。完整回归首次发现这一交叉条件，沿用原包取消测试确认修复，未改断言。

### 13.1 本轮实际覆盖

| 条件 | 实际证据与边界 |
|---|---|
| 普通参考图/方案上传 × uploading/available；到期前 1ms 与到点 | PostgreSQL 两条参数化测试各包含两类上传；首次 2F 复现缺口，修复后原文件 7P。删除器替身用于严格断言，不冒充对象存储证据 |
| 未链接 available 对象保留、到点删除、重复清理 | 独立 PostgreSQL + MinIO，真实 AWS SDK Put/Get/Head/Delete；使用注入时间验证 TTL，未自然等待 24 小时 |
| HTTP 200 携带逐对象 AccessDenied | 向真实 MinIO 发送匿名 DeleteObjects，直接断言响应 HTTP 200 和 Errors；生产删除器将错误留为 S3DeleteObjectsError，不确认删除 |
| 12 次删除失败、abandoned、显式恢复后的引用复查 | 每次真实权限失败后核对尝试次数和回退时间，显式加速 next_attempt_at；第 12 次停止自动重试。手动修改测试队列模拟未来管理恢复，新增合法上传仍保护；本轮没有新增管理 API |
| PUT 已落盘，响应被吞后客户端超时 | 受控回环代理把签名请求转发到真实 MinIO，吞掉成功响应；实际生产上传函数收到 TimeoutError 后，DB 意图仍在，GET 字节一致，随后 Worker 清理成功。此项证明已登记意图的恢复，完全无 DB 记录的对象发现仍未实现 |
| 存储实际停机/重启 | 停止独立容器后真实连接失败；DB 重试事实留存，重启后 GET 原字节并执行清理。回退时间显式加速；不声称生产存储故障演练 |

MinIO 镜像固定为 `minio/minio@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`，每套测试新建无挂载数据的独立容器并关闭。镜像实际 ID/version 记录在测试报告。首次真实存储测试 1P/2F：root 凭据不受桶策略限制，容器重新启动会改变随机端口；修正为匿名权限请求及重读宿主端口，未修改生产权限或放宽业务断言。

### 13.2 下一步仍按原 D02.3 接续

补充“对象存在但数据库没有记录”的受管 inventory：限定五类已知前缀，逐条识别合法 key 形状；按有限页读取并保存可重跑游标；对象最小宽限期、发现后的稳定身份复核与最终 DB 引用/租约检查同时成立才可入删除流程。遍历完成后必须能新开扫描发现游标之前的新增/变化对象，不能用一次游标永久跳过。

生产实现仍须验证重启/多 Worker 竞争、分页失败不越过未登记页、dry-run 不删除、对象覆盖后的宽限期重置、账户级联后无 registry 对象、有效的 source/revision/run/包引用保护，以及安全计数/匿名标识。现有 outbox 无法枚举这些对象，不以本轮通过代替 D02.3 或完整 GC 验收。Desktop 全类别 staging/竞争及原生 Windows 条件仍保留。

### 13.3 消费后上传账本保留政策出口（D02.2 残余收口，2026-09-14）

登记开放项「消费后上传账本保留政策出口」已收口：现状查询天然满足，**未改生产删除路径**，用语义定义加真实 PG/MinIO 集成测试钉死。

政策语义：已消费上传的 `generation_reference_uploads` 行对 retirement 的保护由两个独立机制叠加——行级引用（`generation_reference_links` 或 `design_scheme_generation_references` 存在即 permanent，**不看上传 TTL**）与 registry 自身 TTL（`uploading`/`available` 且 `expires_at > now` 为 leased）。纯年龄不构成出口；引用它的行按既有保留政策（B77 R01：软删终态 30 天分批 purge）消失后，保护经同一组查询自动退出，无独立清理动作。

消费路径分流与各自出口：

- 方案资产采用（design-scheme-assets `attach`）在同一事务插入 `design_scheme_assets` 并**删除 registry 行**——账本在消费时即退出，对象改由 canonical 资产行保护（含软删方案，见 §14.5 矩阵）。
- Composer run 消费保留 registry 行；run 软删满 30 天经 `purgeGenerationRetentionBatch` 分批 drain `generation_reference_links` 后 permanent 分支消失；registry 行 `expires_at` 早已过，由 `queueExpiredReferences` 置 `cleanup_pending` 并入队，retirement 授权通过，对象删除后 ack 同事务删除 queue 行与 registry 行。
- 方案 run 冻结引用（`design_scheme_generation_references`，采用后 registry 行已不存在）随 run purge 由 drain 直接入队（reason `generation_purge`），不经 registry TTL 扫描。

钉死证据（真实 PG 17 testcontainers + 固定摘要 MinIO，`RUN_DATABASE_TESTS=true`，命令与计数见 `tests/v25/.results/d02/ledger-exit-*.json`）：`apps/worker/src/__tests__/consumed-upload-ledger-exit.integration.test.ts`（2P）三态——TTL 内未消费（残留 intent 被 leased 拦下、TTL 扫描不入队）；已消费且 TTL 已过（链接在即 permanent、扫描仍不入队、对象存活且无退休哈希）；run 经真实 purge 后（链接 drain → registry 扫描重新入队 → 对象真实删除 404、退休哈希写入、queue 与 registry 行均被 ack 移除）。另钉方案 run 冻结引用经 purge 入队后真实删除的完整链。迟到引用 P0001 已由既有用例覆盖不重复：`storage-publication-guards`（退休键上的新 reference link 拒绝）、`reference-lease-matrix`（退休后 `design_scheme_generation_references`/`generation_assets`/export 租约写入拒绝）、`late-put-retirement`（registry 重注册拒绝）。

顺手单列修复（登记项「参考图 confirm 遇 P0001 在 HTTP 层是 500（app.ts 无 409 映射）」）：`GenerationService.uploadReferenceImage` 在原有补偿落库之后，把发布屏障的 P0001 映射为 `VALIDATION_FAILED` + HTTP 409 + `details.reason='REFERENCE_UPLOAD_RETIRED'`（对齐 package stage confirm 既有 409 先例），客户端重新上传即可；`late-put-retirement` 两条用例已改为钉死服务层与 HTTP 层 409（4P）。方案图片上传 confirm 原有自己的错误映射（非 500 裸错），不在本项内；worker/automation 直连路径不经 HTTP，无映射需求。


## 14. D02.3 受管对象发现已接入（2026-09-14；候选删除执行器见 §16 勘误）

新增 `object_inventory_cursors` 和 `object_inventory_candidates` 两张独立 PG 表，0025 expand 迁移只加表/索引，不修改既有实体、费用账本或删除 outbox。新候选不进入旧 Worker 会直接消费的 `object_cleanup_queue`；回滚到旧二进制不会把这些观察记录变成无身份检查的删除任务。~~本轮实现发现和持久观察，尚未实现这些新候选的物理删除执行器，不据此关闭 D02.3 或完整 GC。~~ **勘误（2026-09-15）：候选物理删除执行器已由 0028 迁移与 `apps/worker/src/object-inventory-delete.ts` 落地并接入 cron（现状见 §16），本节该句仅保留历史时序；D02.3 开发缺口关闭，剩余为完整联合验收与登记后续卡（退休表容量/多桶身份）。**

### 14.1 当前发现行为

- 原 `bin.ts` 每五分钟调度 `maintenance/inventory`，保留 `maintenance.inventory` 别名。一次分别读取五个受管前缀各一页，每页最多100个对象，单次最多500个；请求30秒中止，单次认领租约10分钟，DB锁等待仍为2秒。
- 前缀为 `users/`、`scheme-sources/`、`scheme-packages/`、`scheme-imports/`、`scheme-exports/`。前缀内仍校验实际 writer 产生的完整 key 形状（UUID、来源/导入hash等）；不认识的路径、任意私有文件、越界子路径均计数跳过。旧格式若未在白名单内需另行证明归属，不能凭年龄删除。
- 用桶和endpoint的摘要隔离存储 scope，不在日志记录其原文。`record` 和 `dry-run` 各有独立游标；dry-run只更新自身游标及安全计数，不修改候选记录，不写删除outbox，不删S3对象。
- 先短事务认领游标，在事务外读取S3页，再在事务内核对租约token、复查当前 canonical 引用/上传与包/执行租约、写候选并推进游标。候选写失败全部回滚，原 continuation token 保留。迟到响应遇到新持有者不能覆盖其进度。
- 候选保存 ETag、修改时间、字节数、首次/最近观察时间和最早处理时间。至少从首次观察和对象修改时间的较晚者起等待24小时；重复观察相同对象不延后期限。内容变化或相同内容的新修改时间都会重置宽限期。期限只表示可以进入后续检查，不是删除许可。
- 扫描到已受保护对象会去掉本scope对应的候选观察；扫描完成把游标归零，下一次从前端重扫，因此能发现旧游标之前新出现的对象。metadata本身的陈旧清理将在执行器处理缺失对象时补齐。
- `MAINTENANCE_CLEANUP_PAUSED` 同时暂停两种inventory别名；日志只有固定prefix/mode及scanned、unmanaged、invalid、protected、young、candidates、recorded、completed、busy计数。没有开放“全部清空”入口或管理员API。

### 14.2 已有实际证据

真实 MinIO/PG 专项覆盖七类合法 key、未关联且有效的上传保护、账户级联后的重新发现、1001对象分11页与新DB连接续跑、完成后发现词序更早的新对象、dry-run隔离、相同内容覆盖/不同内容覆盖重置宽限、候选写入trigger故障与S3错误不推进已有非空游标、两个扫描者及旧租约迟到响应。扫描只记录候选，GET仍可读原字节。

实际 `pnpm run db:migrate` 将已填充的0024前缀从25条升级到26条，执行两次后逐行保留提示词/旧清理记录，迁移ledger逐项匹配仓库SQL hash。真实 `bin.ts` 经Graphile调度两个暂停别名；另在真实S3页响应被代理暂扣时SIGKILL，新PID在显式加速旧租约到期后处理新的周期任务，恢复同一scope游标并记录候选。此项不声称自然等待10分钟，原死进程的Graphile锁定任务不被伪装成已经完成。

### 14.3 下一步必须完成的删除条件

对本次固定 MinIO 版本的临时桶探针发现：带正确ETag、错误 `IfMatchLastModifiedTime` 的 DeleteObject 仍删除对象；后续独立错误ETag探针也返回204并删除对象。两个探针均只触及独立临时桶，证据见 `tests/v25/.results/d02/inventory-delete-condition-probe.json`。SDK类型注释也仅为directory buckets声明修改时间条件。不能把发送了该header当作它已被存储端执行。后续必须核对可用的稳定版本/条件删除语义、不可变key与发布租约，证明最终引用检查后发生覆盖或发布竞争时不会误删新对象，再实现候选领取/重试/abandoned/安全计数及缺失对象幂等确认。

D02.1/2/4/5/6/7 全资产目录、canonical关联竞争、Desktop全类别staging/原生Windows和其余真实存储故障仍按原范围保留；自动发现已接入不等于整包或第一大阶段已验收。

### 14.4 发布屏障的实际缺口与原型边界

2026-09-14 独立PG/MinIO探针发现：旧outbox最后一次引用查询之后，独立SQL可以提交generation资产；真实DeleteObjects随后删除其文件并ack。原始证据 `tests/v25/.results/d02/publication-race-probe.json` 明确为数据库调度探针，不代表已通过真实API构造同一交错。它意味着新inventory执行器不能只再查询一次引用，也不能把候选直接交给当前outbox。

一次性数据库原型使用同对象事务锁、只保存key摘要的持久退休记录和canonical发布trigger。实际锁等待下，发布先完成→GC看到引用；GC退休先完成→迟到发布拒绝；退休回滚→发布恢复，三种次序成立。见 `tests/v25/.results/d02/publication-fence-prototype.json`。该原型仅覆盖generation_assets，没有安装到生产迁移；下一步必须覆盖来源/方案/参考图关联、上传与运行/导入租约、当前旧outbox以及新候选执行器，再用真实S3与进程中断验证。受管writer的不可变key和在途写入约束需要逐入口证明；不能用这个数据库原型宣称任意外部同key覆盖已安全。

### 14.5 云端资产目录与保护矩阵（D02.1，2026-09-14）

下表把 §2 云端表目录化为 D02.1 全类别清单。每行「引用/租约存在阻断退休（不写退休哈希）；引用按本行政策消失后可退休（写入退休哈希）」由 `apps/worker/src/__tests__/asset-protection-matrix.integration.test.ts`（真实 PG，10 类别 10P）逐类别强制；授权后的物理删除链由各类别既有套件分别覆盖（object-cleanup / package-cleanup / consumed-upload-ledger-exit / object-inventory-delete）。本轮未新增任何「全部清空」出口或不受控删除接口（D02.7 红线不变）。

| 类别（key 形状） | 创建者 | 引用者（保护表 / 发布屏障） | 保留期 | 租约 | 可重建性 | 实际删除者 |
|---|---|---|---|---|---|---|
| 生成图片 `users/<u>/generations/<run>/<uuid>` | worker `uploadImagesForGeneration`（PUT 先于 finalize） | `generation_assets`（`generation_assets_storage_publication`） | 成功行存活期（含软删）；软删终态 30 天 | 运行命名空间租约 `generation_runs(status,lease_expires_at)`（`generation_runs_storage_lease`） | 不可重建：同提示词不保证同图 | `purgeGenerationRetentionBatch` drain 并入队 → `object_cleanup_queue` → worker `processObjectCleanupBatch`（retire + DeleteObjects + ack） |
| Composer 参考图 `users/<u>/references/<uuid>` | API `uploadReferenceImage` 先注册后上传 | `generation_reference_uploads` registry + `generation_reference_links`（`generation_links_storage_publication`，0027 FOR SHARE） | 未消费 24h TTL；已消费随链接存活（不看 TTL），链接 drain 后回 TTL 扫描（§13.3） | registry TTL 即上传租约；`releaseReferenceImage` 仅把 expires_at 收紧到当前 | 用户原图不可由云端重建 | `queueExpiredReferences` 置 cleanup_pending 入队 → 共享 outbox；ack 同事务删 registry 行 |
| 方案已采用图片 `users/<u>/design-scheme-uploads/<uuid>` | API design-scheme-assets `stage`；`attach` 采用事务删 registry 行 | `design_scheme_assets`（`design_scheme_assets_storage_publication`） | 方案存活期（含软删；软删方案的合法历史引用仍保护） | 无独立租约 | 不可重建 | 方案行级联（账号删除）或未来方案 purge 后经 inventory 重新发现回收；硬删出口已钉死（见本节末） |
| 方案 run 冻结引用（坐标行，字节即方案资产） | API scheme run 创建写坐标 | `design_scheme_generation_references`（`design_scheme_references_storage_publication`） | run 存活期 | 无 | 字节可由方案资产重读 | run purge drain 并直接入队（`generation_purge`）→ 共享 outbox；方案资产仍在时对象保留 |
| 方案来源固定副本 `scheme-sources/<hash>/<snapshot>/<uuid>` | source preparation 写对象 | `design_scheme_source_files.object_key` + `design_scheme_source_bindings`（`design_scheme_sources_storage_publication`） | 未采用随 preparation（默认 1 小时）；已采用随 binding/revision 存活 | `upload_lease_until`（读取窗口） | 远端仓库可变，不保证可重建 | `retireDesignSchemeSourcePreparations` 清未绑定文件 key 并入队 → 共享 outbox |
| 专用包上传原件 `scheme-packages/<hash>/<uuid>` | package stage 服务（begin/upload/confirm） | `design_scheme_package_stages`（`package_stages_storage_publication`）+ 共享 registry 行 | stage 默认 1 小时 | `upload_lease_until` 或 ready/confirmed 未过期；registry TTL 不延长包租约 | 用户持有原包，可重新上传 | `retireDesignSchemePackageStages` 置 expired + registry cleanup_pending 入队 → 共享 outbox |
| 导入副本 `scheme-imports/<stage>/<attempt>/<hash>` | importer 原子写入 | running `design_scheme_package_imports` 前缀租约（`package_imports_storage_lease`）；提升后 canonical source/asset 行 | running 租约期；完成后由 canonical 表保护 | `lease_until`（epoch/attempt 过期不可续，P0001） | 导入产物可按固定 seed 重跑 | 租约到期后经既有延后 intent 入 outbox；账号级联后由 inventory 重新发现；旧 epoch 不得删新 attempt |
| 导出归档 `scheme-exports/<uuid>` | export 服务写对象 + 持久 export 行 + 延后 intent | `design_scheme_package_exports`（`package_exports_storage_publication`） | 默认 1 小时（B64） | `lease_until` 或 ready 未过期 | 可重建：由方案 revision 重新导出 | 时间型出口：lease 与 ready TTL 均过后，创建时登记的延后 intent 经共享 outbox 删除 |
| 未提交/中断生成输出（同上 key 形状） | worker PUT 与 finalize 之间的中断窗口 | 无 DB 行，或补偿 intent（`generation_compensation`） | 上传前登记的 1 小时宽限 intent | 运行命名空间租约同上 | 不可重建 | `executeGenerationAttempt` finally 入队 → 共享 outbox；无意图窗口由 inventory 发现 |
| 失败/中断 orphan（无任何 DB 意图） | 任意受管 writer 在 S3 成功与 DB 提交之间中断 | 无 | inventory 宽限：首次观察与对象 mtime 较晚者起 24 小时，覆盖/新 mtime 重置 | 无 | 不可重建 | `maintenance.inventory` 扫描 → `object_inventory_candidates` → `processObjectInventoryCandidates`（HEAD/精确 List 身份复核 + retire + DeleteObjects） |
| 退休哈希 `object_key_retirements` | retirement 执行器在最终引用检查后写入 | 无（发布屏障反向消费它） | 永久 | 无 | 仅 SHA-256，不含 owner/bucket/路径 | 不删除：防 key 复用的永久栅栏；无界增长与账本行退出同源，靠上表各类别出口控制来源 |

登记缺口保持开放：导出与导入租约为时间型出口，无独立退休函数；orphan 物理删除执行器见 §16。矩阵退出动作中使用真实退休入口（`purgeExpiredSoftDeletedRuns` / `retireDesignSchemeSourcePreparations` / `retireDesignSchemePackageStages`），方案资产行消失以行级联建模（与 object-cleanup 既有用例一致），不以直接 DELETE 宣称方案 purge 已实现。

方案硬删出口行（2026-09-14，D02 联合收口）：账号级联与显式方案行硬删的出口链已用真实 PG+MinIO 钉死（worker `scheme-hard-delete-exit.integration.test.ts` 2P），**未改生产删除路径、未新增「全部清空」出口**——软删方案资产/来源持续保护（政策不变，授权不写退休哈希、扫描不记候选）；`DELETE FROM "user"`（账号级联）或 `DELETE FROM design_schemes`（未来显式硬删的行级联形态）移除引用行后，孤儿对象经既有 inventory 重发现记候选（仅观察，字节仍可读），宽限后由既有候选执行器 HEAD/List 身份复核 + 退休授权 + 真实删除；方案行硬删后存活的用户级来源快照继续保护其固定副本，解绑后经既有 `retireDesignSchemeSourcePreparations` → 共享 outbox 退出；退休后迟到的 `design_scheme_assets` / `design_scheme_source_files` 发布被 P0001 拒绝；重复硬删与重复执行幂等。

计数/暂停接缝行（2026-09-14，D02.7 最小实现）：`collectObjectMaintenanceSnapshot`（packages/db，纯 SELECT 无副作用）汇总五类安全计数——GC 候选（outbox 存活 intent + inventory 存活观察）、保护（租约/保护延后 + 宽限观察中）、已删（`object_key_retirements` 退休事实）、失败、abandoned——对象标识一律 SHA-256 匿名化（与退休哈希同约定，各上限 100，不回显真实 key/签名 URL）；只读出口为 worker `maintenance.safety-snapshot` 任务（不登记 crontab，按需 add_job，日志只输出计数），供后台观察消费，不新增管理 UI。暂停接缝为既有进程级 `MAINTENANCE_CLEANUP_PAUSED`：执行器领取前检查，暂停只停止新领取、不中断已发存储删除，默认 `false` 不暂停；只读观察任务不被暂停门控（暂停期正是观察窗口）。证据：worker `maintenance-safety-seam.integration.test.ts` 1P + db `object-maintenance-stats.integration.test.ts` 3P。


## 15. 云对象删除授权与发布屏障（0026，2026-09-14）

旧 outbox 删除路径现调用 `retireUnprotectedObjects`：按稳定次序取得对象 key 和适用的生成/import 命名空间事务锁，重新查询当前引用与租约；未被保护的 key 保存永久 SHA-256 退休标记并提交，之后才执行存储删除。失败或崩溃不释放已提交的退休事实，重试仍检查现存引用。正常的新素材必须使用新 key，不能把一个已授权删除的 key 再发布为可用素材。

0026 对资产、来源、方案生图引用、上传 registry、包 stage/export 与引用 link 的发布写入进行检查；生成/import 租约使用相同命名空间锁，并拒绝过期同 epoch/attempt 续租。已提交引用先取得锁则 GC 保护；GC 先提交退休则晚到发布失败；退休事务回滚则允许正常发布。完整用例及当前未通过项见测试续篇 §5.79。

这不是对象存储条件删除保证。当前真实 MinIO 已证实忽略所探测的 Delete 条件，不能依赖这些请求头；外部任意覆盖同 key 不属于已证明的服务器受管写入协议。迟到 PUT 可以再次产生无有效引用的字节，仍须被 inventory 重新发现与回收。候选删除执行器及完整故障矩阵尚未完成。

上线与回滚须先暂停并排空所有旧 Worker 的维护执行；旧二进制不会调用新的退休授权，数据库 trigger 不能代替旧删除者参与协议。独立 inventory 表可防旧版直接消费新候选，但不能据此宣称旧 outbox 自动安全升级。当前没有执行部署或回滚。


### 15.1 参考图关联的 registry 身份固定（0027）

0026的link检查曾在锁住对象前读取registry key，实际并发证明该值可能在等待时被更新。0027对registry行加FOR SHARE直到关联提交，并将已有link的inactive registry纳入写入检查。保护对象以最终关联所到达的key为准，不能只检查事务开始时读出的key。原cleanup状态迁移仍允许；新红测/升级和未验边界见测试续篇§5.79.1。


## 16. inventory 候选物理删除与持久领取（0028，2026-09-14）

候选不再只用于观察：原inventory任务扫描后执行独立候选领取/删除。每批20项、4项并发，领取10分钟，HEAD/精确key List/Delete每次30秒上限；SQL锁保持短事务。扫描和删除以候选token协调，扫描跳过已领取或abandoned项，不刷新失败事实。最后一次领取中失联的记录在租约到期后进入abandoned，避免尝试次数达上限后隐形卡住。

HEAD的Last-Modified实际丢失毫秒，不能直接与List时间比较，也不能向下取整忽略同内容覆盖。执行器检查HEAD协议并以精确key List返回的etag/修改时间/大小复查观察身份；变化就重启原24小时宽限。最终事务复查所有现有引用/租约，并与候选身份一起提交退休授权；对象存储访问在事务外。删除成功但确认失败保留候选，下一次不存在响应可确认；退休哈希持续保留，防止迟到发布复用key。

独立候选表不进入旧outbox；5分钟至24小时退避，12次失败进入abandoned，人工重试仅模拟受控状态恢复并仍复查引用。程序只输出数量，不记录桶、key、请求URL或凭据。旧Worker暂停/排空部署规则继续适用；不以条件删除请求头作为保证。

真实MinIO/PG、1001对象、两种连接池、实际bin强杀/暂停恢复及升级证据见测试续篇§5.80。完整G-DATA-02未关闭：当前整组回归、迟到PUT和全引用/租约服务边界，以及Desktop staging各类路径仍须补验。


### 16.1 当前验证与D02.5接续

候选执行器完整Worker285P/0F/0S、check与源码扫描已通过；API仍在运行，完整GC未验收。Desktop原package-staging.cleanupOwner在受管根被符号链接替换时会沿父路径删除链接目标的owner子目录，已在隔离自有目录实际复现（desktop-staging-link-probe.json）。下一必须修复根/祖先路径与目录身份保护，并补启动残留、窗口竞争和真实Electron验证；不能把云端285P当作Desktop已验收。

## 17. Desktop 方案包 staging 的目录与进程生命周期（D02.5 继续）

2026-09-14 已将方案包 staging 从直接递归删除改为固定受管目录身份、平面文件白名单 unlink 和空目录 rmdir。可信父为当前独占的 userData；其系统别名首次规范化，下面的 root/owner/stage 不接受链接或普通目录替换。源文件先打开并校验描述符，复制完成后再次检查目录，消费仍校验原 SHA256 和独立副本。

状态为 preparation → preview → consuming → cleanup。取消 preparation 只禁止发布，等待在途复制/检查结束后清理；销毁 owner 或退出时 consuming 不再接收重复请求，但文件活到原消费者 finally。preview 和 consuming 不按年龄回收，因此进程暂停不会让另一个维护周期删掉活跃原料。

启动回收只在 main process 已取得 application owner lock 后执行。每批20个扫描条目，每stage最多32个文件，满批1秒继续、空闲60秒重扫；未知路径/文件不递归删除。失败目录仍在磁盘、下一进程可发现，计数只输出 scanned/deleted/protected/failed/pending；目前没有持久化尝试次数或 abandoned 记录，不能对外宣称这部分已实现。

隔离红测旧实现0P/7F，修复后 staging/host/archive 35P；真实 Electron 四条强杀新PID、双窗口、root symlink、POSIX 权限恢复4P/0F/0S/0flaky。具体来源、首败和完整回归进度见[测试续篇§5.81](./V25-MIGRATION-TESTING-CONTINUED.md)。独立进程主动替换路径、慢复制/暂停实测与Windows原生矩阵继续保留；全资产GC未关闭。

§17补充：当前源码387fc897…在最后路径检查与unlink系统调用间，被独立进程替换stage后仍会删到外部原件，已用自有目录和确定性调度点实际复现。POSIX目录句柄相对删除原型在Node与Electron通过，但未接入生产；详见[测试续篇§5.81.1](./V25-MIGRATION-TESTING-CONTINUED.md)。该缺陷是下一修复项，不将前述四条通过当作安全闭合。


## 18. Desktop 全资产 IO 与引用核对（2026-09-14，D02.1–7 未闭合）

§17的原型/未接入状态已由测试续篇§5.82更新：方案包生产现在使用原生目录句柄，校验后直接传字节给 importer；macOS实际包与扫描通过，完整Electron仍运行。core生成文件队列清理已在测试续篇§5.84接入句柄能力并通过check/包冒烟，前版完整Electron189通过/2外部条件跳过已终态。未入账补偿与CLI接线已写入新源码，源码专项通过，新增批次完整门禁仍待；其他类别继续核对。

| 类别 | 当前创建者 / 持久引用 | 保留、租约与可重建性 | 实际清理者及仍需完成的条件 |
|---|---|---|---|
| 生成图片与缩略图 | Provider落盘；`generated_assets.media_path`；generation params中的原参考图；方案`design_scheme_assets`和`source_files.store_key` | 已入账作品和剩余执行/方案来源受保护；清理意图与generation purge同SQLite事务。已删除图像不能承诺重生成相同内容 | core `local-asset-cleanup.ts`，每批100、失败持久退避；原检查/unlink目录替换缺陷及错误ack见测试§5.83；§5.84已正式接句柄，3个独立子进程根/祖先/父目录替换与原件/计数回归通过，新版完整Electron仍在验 |
| 生图已写文件但业务提交失败 | `generation.ts/cleanupUncommittedImages` 将本次返回的受管图片送入持久清理队列 | 仅补偿本次返回的pictures文件；当前不是全盘发现机制，崩溃窗口和其他合法引用保护仍要核对 | 已正式复用已有队列/引用/句柄，补取消及资产提交失败；持久重试、源/其他run保护与独立进程目录替换专项通过，见测试§5.86。CLI serve已装配同一native能力并在启动/维护/退出接续；构建声明重名及Ctrl-C抢先退出已由实际编译进程测试发现并修复，安装包及新增全量仍待。Provider返回前部分写盘缺口已由正式写入前预留/独占创建/fd身份先于内容/整次生成保护接入；11项真实IO与3项真实强杀回归通过，实际开发版与包内CLI写到一半强杀后，新PID启动自动回收残留且不重发生图，见测试§5.89–5.89.2。NULL身份空文件保留blocked，不计已回收；其他写者/无意图发现与完整GC仍待 |
| Composer / Agent / Skill 上传副本 | core `stageLocalImage(path, owner)` / `stageLocalImageBytes(input, owner)`；可信窗口、CLI/Automation服务及Skill/方案执行创建owner | 写入前持久清理意图、独占文件身份、在途写与owner存活保护已接；成功生成/方案资产/来源引用继续保护。草稿契约不存图片，不能仅按DB无草稿图片记录判定无引用 | §5.92–5.94已正式接字节上传及有界路径复制，方案finally改owner释放，真实HFS+故障和新PID参考图可读已验；窗口关闭/主文档重载/整应用退出释放已验。§5.97已正式接UI逐图移除/迟到完成的跨gateway释放与生成/兑换恢复保留责任，正在验证真实宿主；长驻Agent的显式释放与期限、全部类别发现和崩溃恢复继续，不能按年龄直接删除uploads |
| 方案GitHub/历史来源快照 | `source-ingestion.ts` 将图片写design-scheme-sources/snapshot，再保存source package/snapshot/files；revision有绑定 | 历史快照是固定证据；远端仓库可变或原历史图删除后，不保证可重建。仍存活来源或revision引用必须保护 | 历史来源失败/创建取消走递归rm；GitHub写入与DB提交之间存在待核对窗口。需检查引用释放、失败/崩溃孤儿发现以及句柄根保护；源码阅读尚不当作故障测试通过 |
| 导入方案正式素材 | `share.ts` 在design-scheme-imports/newSchemeId写入素材，然后事务发布方案/来源/资产记录 | 与方案包暂存不同：导入成功后是正式方案内容，必须由canonical来源/资产/文档引用保护，不能随staging清理 | prepare/persist失败递归删除importRoot；安全相对路径校验已有，但父目录替换、文件写完DB前崩溃、最后引用释放仍待实际验证 |
| 专用方案包暂存副本 | `DesignSchemePackageStaging` preparation→preview→consuming；owner和唯一消费事实在当前主进程 | 不以年龄过期活跃状态；启动扫描以App独占锁为前提。崩溃遗留可重发现；重建依赖用户原包，不动该原包 | 新原生目录句柄IO、每批20条/每stage32文件、取消/双窗口/强杀和权限恢复已有证据；选择源FIFO已在§5.84正式修复并有真实子进程回归；实际Node及macOS Electron复制暂停64秒、维护保护、导入/读回/清理已有证据（§5.85.2），永久回归待纳入，Windows和持久观察继续 |
| 用户选择的原图、输入包与已交付导出文件 | 文件选择器/用户指定路径；属于用户持有文件 | 不作为本机GC候选，不按文件名、扩展名、外部路径中的“staging”字样推定所有权 | 只能清理应用创建且具有受管身份的副本；同源外部原件保留是每条负例验收条件 |

源码入口：[本机清理](../../packages/core/src/services/local-asset-cleanup.ts)、[上传和读取](../../packages/core/src/providers/local-image.ts)、[未提交补偿](../../packages/core/src/services/generation.ts)、[来源快照](../../apps/desktop/electron/main/design-scheme/source-ingestion.ts)、[方案包导入](../../apps/desktop/electron/main/design-scheme/share.ts)、[暂存生命周期](../../apps/desktop/electron/main/design-scheme/package-staging.ts)。此表是当前目录的事实核对和缺口清单，不把“需核对”写成已具有保护，也不替代§2云端对象/引用表。

接续顺序：新增未提交补偿/CLI批次完整门禁与实际安装包、永久暂停回归→其他类别创建/引用/中断发现→Windows与持久staging重试→完整GC联合验收。复用原ledger/provenance，不为通过测试缩小到仅方案包；管理员观察端以最终计数/匿名标识为接缝，暂无不受控清空动作。

### 18.1 工作台上传生命周期的接续边界（2026-09-14）

源码核对及组件实际执行发现：文件读取尚未完成就切换会话/离开页面，当前代码仍启动宿主上传；旧读取/上传错误会在新的工作台弹出。账号epoch变化时也缺少旧上传入口及完成回包的隔离。原源码8项探测6F/2P；扩大测试又发现预览释放及异步mutation受理窗口，已正式修复。当前d9215df1…检查与features780P、PC/移动4项回归通过；正在执行完整三端test:e2e。这不是宿主文件释放验收，详见测试续篇§5.95。预览URL卸载测试初次通过，但扩大全部features后暴露React状态更新内的释放可能不执行；候选改同步资源集合后778项全过。两视口原production构建另已复现旧图仍发送，见§5.95.1。

后续释放协议须同时满足：

1. 参考图上传成功、移除/清空/卸载及迟到回包都可归还本次所有权；公共输入从contracts开始，Desktop由可信sender确定owner，云端由认证身份确定owner。不能让渲染层提交任意文件路径供删除。
2. 释放仅结束暂存持有，已有generation/方案/来源的持久引用和服务端在途租约仍有效；重复/跨窗口/跨账号释放不能删除他人文件。物理删除继续由既有安全清理执行器完成。
3. 发送前的建会话、方案prepare/run、已发送但尚未回包及费用恢复意图都须保留固定参考图。工作台关闭进入兑换页时，`spend-recovery-store`中的原输入不能因UI清理失去图片；重放按原意图/幂等键，释放不触发生图。
4. 释放回包丢失/离线/窗口强杀需要有界的持久回收，不能把仅存在React内存的重试承诺当作崩溃恢复。云端现有24小时上传TTL与本机持久队列、owner生命周期分别验证，不能相互替代。
5. 验证覆盖待文件读取取消、上传中离场、迟到成功/失败、切换账号、独立窗口、重复释放、引用保留及最后引用消失；再完成实际API/PG/S3与Electron测试、完整check/E2E和归档扫描。管理员及整包前置不随此子项关闭。

### 18.2 已上传副本显式释放的后端候选

2026-09-14：独立候选已验证严格id合同、云端owner限定的到期UPDATE，以及桌面可信sender限定的owner.release。真实BA/PG六项（含采用事务行锁）、native/SQLite三项、实际MinIO维护与重启重试三项通过；正式源码仍为完整三端回归中的d9215df1…，新协议尚未正式发布或接入UI。所有权移交与兑换恢复的前置条件仍见§18.1，具体命令、失败和适用边界见[测试续篇§5.96](./V25-MIGRATION-TESTING-CONTINUED.md)。


### 18.3 跨宿主临时引用已接入（2026-09-14）

§18.1五条作为完整验收约束保留。当前正式新增strict release id、可信sender/认证用户限制、视图/在途提交/兑换恢复独立保留责任及账号epoch清理。`consumeQuotaRecovery`移交持有记录，调用方finally归还；不再只返回没有生命周期的意图数据。HTTP空204按void schema校验，不能误判为需要重试的生成/兑换错误。当前源码清单e6ea59a7…/1785，正式API原整文件29P、实际MinIO扩展整文件8P；后者加载正式生产代码但仍是隔离测试装配，不是新Worker PID或真实收费模型。

上一d9215df1…的完整三端已513P/7S、49实际ZIP+2UI替身扫描通过；本次新接口须完成自己输入的统一检查、实际Electron/双视口及全量回归，不能继承旧证据。完整D02及后续七阶段仍开放。边界与首次失败见测试续篇§5.97。


### 18.4 本地读取与控制面退出候选（2026-09-14，未正式合入）

系统文件选择器授予读取的外部原图继续允许读取，稳定目录别名也保留；它们不因本轮读取修复成为GC删除对象。现有`readLocalImage`先检查头部再重新按路径读取整文件，已实际复现替换与增长后返回不同或超限内容。候选用同一文件句柄有界读取，复核文件身份/大小/时间与选择路径，按实际返回字节确定MIME和大小；受管副本仍由既有native目录句柄与owner处理。

Automation退出时发现文件删除抛错，已实际复现HTTP监听未关、CLI上传副本/数据库/owner.lock未释放。候选将发现文件清理失败记为固定诊断后继续关闭实际监听，使宿主原有上传释放和数据库关闭顺序走完；不把一个定位文件的清理失败当作服务仍须运行的理由，也不清除不属于本实例的发现文件。使用实际macOS目录权限失败，未把mock成功当作磁盘回收。

联合候选42项通过，含实际原生文件/SQLite/HTTP；当前完整E2E仍使用e6ea59a7…冻结正式源码。候选没有证明新安装包、Windows、独立CLI进程或长期Agent所有上传期限已验收。正式接入后仍须完整check、适用真实宿主回归与扫描。完整D02.1–7保持开放，详见[测试续篇§5.98](./V25-MIGRATION-TESTING-CONTINUED.md)。


### 18.5 读取与退出已正式接入

2026-09-14：§18.4候选已按真实文件/独立CLI证据正式接入。系统选择外部图片保持只读；临时副本删除仍通过既有owner和持久清理队列，未扩大目录授权。当前48ddbae7…/1786完整check38/38、42项专项和源码扫描通过，真实宿主/安装包及当前完整Electron继续。上一e6ea59三端517P/7S与49实际ZIP扫描已终态，不能替代本次新生产代码验收。见测试续篇§5.99；长期Agent显式释放、其他资产类别/引用与云端竞争、Windows仍按原D02.1–7推进。

### 18.6 Automation冻结引用与同步读取的已复现缺口

2026-09-14：`automation_spend_requests`已在生成历史前保存references与SHA256，但清理保护漏查该来源；owner释放后会删掉仍由请求保留的图片。实际SQLite/native与正式Desktop适配器均已复现。隔离候选补全所有scope/状态的冻结引用，坏快照停止删除；不改变账本保留政策，也不赋予任意路径删除权。

Agent `referenceHash`还存在独立同步读取：真实FIFO阻塞、检查后替换及超限增长已复现。候选非阻塞打开、有界分块哈希并复核选择路径/fd身份。64项候选联合及只读类型验证通过，正边界增量与真实Electron后续验证继续；均未写入正在执行完整Electron回归的8bdd4329正式源码。长驻Agent显式释放/自然期限及全部D02仍待，见测试续篇§5.100。

#### 18.6.1 长驻Automation上传接续验收边界（待实施）

- 沿现有认证控制面和core上传owner接线；释放输入只接受不可猜的上传ID，服务端映射到本实例实际创建的文件，拒绝任意path/owner字段。多个客户端使用同一控制面token属于同一授权主体，不能宣传为已实现独立客户端身份隔离；Cloud MCP七工具只读边界不变。
- 上传成功回执补明确可释放ID与期限。暂定复用云端普通上传24小时政策，发布成功后起算；显式释放可提前结束临时持有。原始用户文件不入候选。保留旧上传/生成调用兼容，不用新增释放失败触发重新付费。
- 生成受理前先取得在途引用保留责任，覆盖确认等待、Promise调度到host.run之间、执行与取消回包丢失。释放/期限仅结束上传者持有；最后消费者结束后再交由持久队列，并复查generation、方案/来源和Automation冻结引用。进程长暂停不能导致维护先删掉已经受理的原料。
- CLI部分上传失败、估价失败、成本上限拒绝、用户拒绝、正常完成和no-wait均结束调用方临时持有；no-wait不结束服务端执行持有。Ctrl-C和失联靠服务端期限/崩溃残留恢复，清理失败不掩盖原生成结果。
- 测试需覆盖未知/重复ID、额外字段、两个真实上传、释放与受理两种次序、并行任务复用同图、期限前1ms/到点、暂停越界、上传途中退出、实际新PID及失败重试。模拟时钟只作边界验证，自然期限另记真实计时；不能用缩短生产TTL或SQL快进冒充自然24小时结果。当前没有实现以上协议或开始自然24小时试验。
