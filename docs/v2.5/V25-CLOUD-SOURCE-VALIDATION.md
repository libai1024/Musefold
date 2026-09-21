# 云端设计方案来源准备：实现、验证与接续任务

> 当前增量：2026-09-10 B60见§19；§1–18保留各批历史。完整任务以[goal任务卡](./V25-MIGRATION-GOALS.md)为准，局部验收不代表完整Agent出图/生命周期/整包完成。

## 1. B34 阶段能做什么（历史记录，当前增量见 §7–8）

云端新增内部 `DesignSchemeSourcePreparationService`：读取一个公开 GitHub 来源并冻结到具体 commit，将完整文件字节存入受管对象存储，元数据及准备状态存入 PostgreSQL。后续确认和读取使用这份已保存的来源，不再次下载移动分支。并发重复准备、拒绝、取消、过期、对象上传失败均有持久状态和清理路径。

**这仍是内部服务，尚未挂载公开 Agent API 或共享产品页面。** 带完整 document 的确定性创建继续可用；缺 document 的 Agent create、modify、confirm-install、check-update 仍保留未实现响应。没有模型请求，没有新增 Cloud MCP 工具，也没有管理员端实现。

| 层 | 实际改动 | 代码入口 |
|---|---|---|
| 单一合同 | 准备输入、状态视图、带 confirmationId 的决定；返回视图禁止对象键 | [contracts](../../packages/contracts/src/design-scheme-source-preparation.ts) |
| 持久身份 | owner/executionId 复合主键，requestHash、快照 owner 外键、上传租约、过期和退役标记 | [schema](../../packages/db/src/schema/design-scheme-source-preparations.ts) |
| 来源服务 | 固定 SHA reader → 先登记对象 → PUT → ready → 明确确认 → 完整字节复核 | [service](../../apps/api/src/modules/design-schemes/source-preparation.ts) |
| 确定性创建/更新 | 服务端来源在首次绑定前必须已确认且有效；sources 与 sourceSnapshotIds 都登记 canonical 绑定 | [方案服务](../../apps/api/src/modules/design-schemes/service.ts) |
| 回收 | 有界退役、引用检查、原子移除对象键并入清理 outbox；最后引用释放后再次回收 | [cleanup](../../packages/db/src/design-scheme-source-cleanup.ts) |
| Worker | maintenance 调度来源退役；对象删除前保护仍存在的 source_files.object_key | [tasks](../../apps/worker/src/tasks.ts) |

## 2. 状态与数据边界

1. **领取**：`(userId, executionId)` 只允许一个准备请求。同 ID 同输入读取原状态，同 ID 不同输入拒绝；失败/过期重放不重新读取上游。需要重新准备时使用新 executionId。
2. **读取与登记**：复用 B12 的受限 GitHub reader。先解析仓库身份和 commit，再按该 SHA 读取归档；原始固定来源的文件 hash、总字节、仓库/tree/archive 证据进入 PG。许可证文件原字节保留；无法证明的 license 仍为 unknown/null。
3. **上传**：私有对象键在 PUT 前入库，每次 PUT 前在事务内复核状态并续租。准备有效期 1 小时，上传租约 2 分钟；当前 S3 SDK 单次请求超时 30 秒。没有把 DB 事务跨网络 PUT 长时间持有。
4. **确认**：单来源准备有独立 confirmationId，决定必须同时匹配 owner、executionId 和 confirmationId。同决定幂等，相反决定及已过期确认拒绝。`install` 表示允许后续消费该来源，不能据此执行仓库脚本或新增花费。
5. **读取**：仅 confirmed 且未过期状态允许 `readConfirmed`；从受管存储读完整字节并核对清单、尺寸、内容 hash，返回前重验状态。返回给内部消费者的内容不是截断的 textExcerpt。
6. **取消与失败**：已登记任务可取消，上传在途时保留租约；写入者返回后不能发布 ready。PUT 结果不明也有对象注册及清理记录；过期写入晚到时重新入清理 outbox，避免之前的清理确认使晚到对象永久遗留。
7. **引用与回收**：准备过期禁止继续确认/读取，但已绑定方案 revision 的字节仍被保护；最后绑定删除后可再次挑选已退役准备，清空对象键并入 outbox，随后重复维护不再次处理。每轮最多 100 条并使用行锁及 SKIP LOCKED。
8. **保留身份**：清理保留准备行和来源元数据作为幂等墓碑，不通过删除 executionId 重置读取。元数据长期 retention、账号删除和 bucket inventory 仍由后续完整数据治理覆盖。

旧客户端提交的 sourceSnapshot 元数据不因本次功能自动变成可信服务端来源；它没有对应准备记录，不能通过新服务的 confirmed 字节读取。已有正式来源绑定可继续保留，不因准备 TTL 结束破坏历史 revision。

## 3. 已执行验证及证明范围

最终命令、数量和失败历史集中记录于 [测试手册 §5.27](./V25-MIGRATION-TESTING.md)。以下逐项对应真实测试，不把内部方法调用写成公开 HTTP 产品验收。

| 场景 | 执行方式 | 已验证的断言 |
|---|---|---|
| 固定来源完整字节 | 实际 PG、回环 GitHub HTTP、生产 S3 SDK/回环 S3 HTTP | 长正文超过 excerpt 仍完整；移动分支不改变已确认来源；一次准备 3 次 GitHub 请求、2 次 PUT |
| 并发/重复/冲突 | 两个服务实例访问同 PG | 一次领取；同 ID 改输入冲突，不重复上游读取 |
| 跨进程恢复 | 两个实际 Node 子进程分别创建服务和 PG pool | 第二个 PID 读取第一进程持久快照，分支变化后仍不重抓；这是准备完成后的进程更换，不是上传途中 SIGKILL |
| 身份隔离 | 两用户、实际复合外键 | 非 owner 查询/确认/取消/读取拒绝；跨 owner snapshot 关联由 PG 拒绝；错误 confirmationId 不推进 |
| 相反决定竞争 | 并发 install/cancel | 恰有一个决定成功；拒绝后的 install 不可复活 |
| 上传部分成功/结果不明 | 回环 S3 实际写入后返回失败 | 状态失败，已尝试对象入 outbox，重复准备无额外 PUT |
| 在途取消 | 暂停实际 PUT 响应，取消后放行 | 租约未结束时不提前退役；晚到上传不能发布或继续上传下一个文件 |
| stale upload lease | 测试 SQL 使租约到期，先清理确认，再放行 PUT | 晚写入被拒绝并重建清理意图；这是显式过期注入，不是自然等候 2 分钟 |
| 过期/损坏 | PG 到期与 S3 内容篡改 | 过期只读状态不重新准备；损坏字节在交给消费者前拒绝 |
| 确定性 document 创建 | sources / sourceSnapshotIds 两种形式 | 确认前不能绕过；确认后建立绑定；过期保持保护；最后引用删除后回收；重复维护为 0 |
| Worker 删除保护 | 实际 PG/outbox、可计数的存储删除替身 | key 被引用时零删除；退役解绑后 outbox 允许一次删除；该专项未验证真实 S3 DELETE 协议 |
| 迁移 | disposable PG17，先应用 0000–0011 并种旧用户，再实际执行根 db:migrate | 0012/0013 可增量升级并保留旧用户，owner/status 约束生效 |

来源持久集成使用合成文本和 LICENSE 文件；B12 reader 的图片安全专项是先前记录，不能据此称 B34 已实测图片持久化全集。所有凭据/仓库/上游均为测试数据，模型及付费 Provider 调用次数为 0。

## 4. 发现与修复

- 新迁移使旧测试“0011 必须为最后一条”失效。改为检查它仍位于原来的 journal 第 11 号位置，保留原迁移内容与顺序断言，允许增量追加；未修改已应用的旧 SQL。
- 补充最后引用删除用例时，两种 document 引用形式都复现回收次数为 0。原因是过期但仍被引用的准备已记 retiredAt，之后维护只选 retiredAt 为空行。现允许重新挑选“已退役但仍有未引用对象键”的记录；实际重跑验证释放后回收一次，随后为 0。首次失败日志保留，不被最终通过覆盖。
- 首次全仓检查的新增文件/生成快照格式问题已按对应文件修复；没有删除测试或放宽原业务断言。

## 5. 下一条 goal 应如何拆

可在总 goal 内按以下独立验收目标接续；不重新执行已完成的 reader 和 B34 服务切片。

| 顺序/映射 | 明确任务与产出 | 验收标准 | 阶段测试 |
|---|---|---|---|
| A，G-CLOUD-02.1/02.6/02.7 | 定义 canonical Agent 异步会话/结果/事件与取消合同；把来源准备接入已鉴权 owner 会话，明确单/多来源 confirmationId、过期、取消先于准备及重放；同步 Web/桌面兼容说明 | 不伪造成功 document；旧确认不能确认下一来源；Agent cancel 与 run cancel 分流；重启可查询原会话；普通用户越权为拒绝 | 合同单测 → 真 HTTP/PG 乱序、重放、跨账号 → API/worker/check；接 UI 后补完整 E2E |
| B，G-CLOUD-02.2 | 固定服务端文本模型配置和凭据/用户费用边界，抽纯编译输入与 schema 校验，接 brief→来源→编译→草稿；先 fake 模型验证 | 未确认来源不进入模型；非法输出无草稿；同执行不会因重试/重启重复调用；未知上游结果不盲目重发；无配置有真实错误 | fake 模型调用计数、真实 PG/HTTP；故障点覆盖发送前后与持久化；真实计费另列证据 |
| C，G-CLOUD-02.4/02.5 | 精确 baseRevision 修改；固定来源版本的上游更新检查；保留 current，产出 working draft | 跨 owner/过期 base/重复并发覆盖拒绝；无更新不编译；有更新不自动替换正式版；来源与采用项可追溯 | revision/owner 并发集成 → 服务重启 → 正式版始终可读 |
| D，G-CLOUD-01/05/06 | 补图片/历史来源及专用包云端往返；共享产品来源确认/事件/取消/失败恢复，联合已完成市场和固定运行 | 桌面、PC Web、Mobile Web 完整创建→确认→修改→运行→导入导出路径；失败与账号切换不串会话 | 资产安全与真 PG/S3 → 三形态 E2E → 包资产 hash/引用/清理 |
| E，G-DATA-02/G-WORKER | 全来源生命周期：上传中真正进程崩溃、自然租约回收、账号删除、bucket inventory、图片及多来源规模 | 所有对象有引用或可追踪清理意图；仍被引用的字节不误删；晚回包不复活；有界扫描和索引性能可记录 | 实际独立 API/worker PID、可控 HTTP/S3、自然时间与故障注入分栏 |

A/B 的协议和模型边界必须先落实到规范及合同；它们不自动改变现有 Cloud MCP 只读范围。C3/C5、SP-P5/P6 的费用和旧版本条件继续按 [费用边界](./V25-SPEND-BOUNDARIES.md)执行，B34 不关闭这些条件。

可直接使用的目标文本：

```text
接续 docs/v2.5/V25-CLOUD-SOURCE-VALIDATION.md §5 的 A 目标，
完成 G-CLOUD-02 的 canonical 异步会话、逐来源确认身份、查询/事件和取消接缝，
复用 B34 的持久来源准备，不重做 reader，不伪造 pending create 成功草稿。
证明 owner 隔离、同 executionId 去重、乱序确认、取消先于准备、过期和进程恢复；
保留未实现编译操作的真实 blocker，完成相应 T1/T2 及全仓 check，
回写任务、失败复跑、真实/替身边界和下一步。父卡及整包仅按原验收条件关闭。
```

## 6. 与完整迁移及管理员的关系

本切片解决云端 Agent 的来源持久基础，未解除“Agent 尚未实现”的用户功能缺口。完整迁移还需费用/旧入口兼容、全部资产 GC、真实旧库/同步、平台安装包、安全出口和生产部署回滚。详见 [路线图](./V25-MIGRATION-ROADMAP.md)。

管理员仍按迁移全部闭合后启动：先服务端权限及审计，再只读运行概览/任务排障/用户授权诊断，最后有限受控动作。复用 Next/Hono/Better Auth/PG/contracts/features，继续委托 New API 账号与账务；管理员不能代替用户确认花费。具体分解与验收已在 [G-OPS-01..03](./V25-MIGRATION-GOALS.md)逐卡定义。


## 7. B35：真实 API、持久事件与独立来源队列（2026-09-09）

本节更新 §1 的 B34 历史边界：**来源服务现已接到新的 Agent 会话 API 和独立队列消费角色**。原同步 Agent 接口和共享页面没有改为异步，也没有完成文本编译；§5 的 A 会话/确认/取消基础已实施，完整公开 Agent 产品仍须后续 B–E 合流。

### 7.1 公共协议与兼容

| 方法与路径（均在 `/api/v1` 下） | 输入/返回 | 语义 |
|---|---|---|
| POST `/design-schemes/agent/executions` | `{ operation: create, input: canonical create input }` → 202 session | 原子登记会话、来源、事件、队列；同 owner/executionId 同输入返回原状态，不同输入 409 |
| GET `/design-schemes/agent/executions/{executionId}` | session | owner 范围查询；检查到期后持久转 expired |
| GET `/design-schemes/agent/executions/{executionId}/events?afterSeq=N` | events + nextSeq | 持久单调版本，最多 100 条；未来 cursor 拒绝，不悄悄重置；跨 owner 拒绝 |
| POST `/design-schemes/agent/confirm-source` | executionId + confirmationId + install/cancel → session | 精确当前来源；已完成来源相同决定重放只读返回当前状态，相反决定拒绝；旧确认不能批准下一项 |
| POST `/design-schemes/agent/cancel` | executionId → session | 未开始也可登记 owner 范围取消墓碑；与图像 run.cancel 分流，不写生图 tombstone |

合同在 [design-scheme-agent.ts](../../packages/contracts/src/design-scheme-agent.ts)；独立 [API client](../../packages/api-client/src/design-scheme-agent.ts)提供显式 start/get/events/confirm/cancel，调用方持有 executionId/cursor，无隐藏内存轮询。原同步 `createDesignSchemeResultSchema`、桌面 gateway 和 Cloud MCP 不变。旧 confirmInstall 的 executionId+decision 不能被用来推进新的多来源会话。

session 只在 completed 时允许真实 result；confirmation-required 必须带 ready 来源；blocked/failed 必须有确定 blocker。未接模型时阻塞而不是成功，未接图片/历史素材时在来源读取前报告 blocker。来源视图和事件不返回 objectKey、服务端凭据或完整文件字节。

### 7.2 持久化、并发与运行

PG `0014_workable_firestar.sql` 增加 Agent sessions/events；源准备状态新增 queued。来源的取消身份在初始事务内就存在，worker 用 queued→reading CAS 领取；多个消费者只会有一个执行该来源 IO。每个来源仍使用 B34 的固定字节、租约及晚写补偿。

start 和 cancel-before-start 按 owner 串行准入，状态变更与事件同事务；source 决策由父会话锁和统一来源锁顺序保护。确认后入队下一来源。正常确认结束后的源码重投不重新读取来源；未完成来源租约到期后失败，需要新的显式执行，不悄悄换快照重抓。

会话有效期 1 小时；过期时取消子来源，reconcile 修复缺失 job、推进队列和到期状态，每轮最多 100 条，并轮转等待确认的会话以免长期占满前 100 条。公开 start 为每 owner 每分钟 20 次、同时 4 个活动会话；取消每分钟 60 次。消费进程并发 2；大规模数据下的扫描索引/吞吐/等待公平性仍需发布前性能验证。

运行角色和启动命令见[架构 §10](./V25-ARCHITECTURE.md)。Graphile 图像 worker 不消费 Agent task；新角色以 API 镜像内 `src/agent-worker-bin.ts` 独立运行，显式处理 SIGTERM/SIGINT 并在结束任务后关闭 S3/PG。Compose 配置已增加该角色，尚未实际部署新的 Compose 或生产环境。

### 7.3 真实验收与限制

最终数量、时间和失败复跑见[测试手册 §5.28](./V25-MIGRATION-TESTING.md)。会话集成覆盖：

- 真实 Better Auth 会话、PG 账号授权与 Hono `app.request` 请求管线；无会话、跨 owner、撤销会话和有效签名 Cookie 的跨站写入拒绝。该请求管线没有启动独立 API TCP listener，不称为浏览器产品端到端。
- 实际 PG/Graphile 事务入队；重复请求不重复登记；注入入队触发器失败时，父会话、来源身份和事件都回滚。
- 先取消后启动、先取消后消费均为零 GitHub/S3 IO；不会写入图像任务取消记录。猜测别人的 executionId 只可能创建自己 owner 下的取消墓碑，不影响原 owner。
- 两来源依次准备与确认，旧确认重放不推进第二来源；相反并发决定只成功一个；确认后明确 compiler blocker，模型调用 0。
- 两个消费者并发领取已经登记的来源，只有一次上游读取/PUT；缺队列记录由 reconcile 补回，完成来源重投不重复 IO。
- 父任务在 PUT 屏障中被取消，晚写入进入清理且不再发布确认或读取下一来源。屏障为注入的存储包装器，PUT 本身仍使用真实 SDK/回环 HTTP。
- 两个实际 Node 子进程运行生产 Graphile consumer，前一 PID 退出后，下一 PID 从已持久确认接续第二来源。它们使用回环 GitHub/S3 夹具；不是两次在同进程 new service 的替代描述。
- 另实际启动正式 `src/agent-worker-bin.ts`，消费纯文本排队任务到真实 compiler blocker，再 SIGTERM；进程正常退出 0。此用例没有调用 GitHub 或模型，不代表正式 bin 的上传中强杀与自然租约恢复。
- 真实 PG 从 0013 升至 0014，调用根 `pnpm run db:migrate`，保留原准备记录；B34 来源 14 项也在完整 API 集成中继续回归。

下一步从 §5 的 **B 编译链**继续：先固定服务端模型配置/用户费用边界与模型发送身份，抽纯编译输入/输出合同，再接真实持久草稿；之后 C 修改/更新、D 图片/专用包/产品、E 全生命周期。不要把 AGENT_COMPILER_UNAVAILABLE 改成默认空草稿来消除错误，也不要绕过确认提前把来源内容送给模型。上传中 SIGKILL、自然租约、账号删除、事件/元数据 retention、全部平台与生产部署仍按原卡验收。


### 7.4 编译阶段的当前配置事实

B35 接续核对：`AccountService.getExecutionBinding` 当前返回 `model=musefold-image-pro`、`capabilities: { image: true, text: false }`；API env 没有云文本模型配置。New API client 已有 listUserModels 和设备令牌管理，并不等于产品已经建立文本执行授权。后续应先定义服务端文本模型选择/能力和 owner/credential 证明、逐调用持久发送标记与费用来源，再接编译。保持现有图像 binding 及发送门禁，不把 text:false 直接改成 true，也不从当前登录用户猜测文本付款身份。

B35 核对时，桌面角色的 analystReport/compilerOutput schema 在 desktop-contracts，提示词角色调用在 Electron 装配；该共享抽取已由 B36 §8 实施并接回桌面。禁止 API 导入桌面数据库/密钥/orchestrator；共享基础通过不代表云文本通道已开放。

## 8. B36：共享模型契约与角色编译准备（2026-09-09）

本节替代 §7.4 最后一段的“尚待抽取”状态。结构化输出的唯一实现现为 [contracts/design-scheme-model](../../packages/contracts/src/design-scheme-model.ts)，旧 [desktop-contracts 入口](../../packages/desktop-contracts/src/design-scheme/agents.ts)仅重新导出。Analyst/Compiler/Reviser 输入类型均由 zod 推导，复用 canonical 文档枚举与修订投影；没有新增平行接口或包依赖。

三角色的纯提示词分别位于 domain 的 [analyst](../../packages/domain/src/design-scheme/analyst-prompt.ts)、[compiler](../../packages/domain/src/design-scheme/compiler-prompt.ts)、[reviser](../../packages/domain/src/design-scheme/reviser-prompt.ts)，JSON 文本提取位于 [model-json](../../packages/domain/src/design-scheme/model-json.ts)。桌面现有角色与 text-adapter 已实际消费它们。网络 transport、safeStorage、角色重试及 SQLite 编排留在桌面，API 后续可以只引用 contracts/domain。

**共享层职责与限制**：

- 模型输出保留原默认值、数量/长度限制和未知字段剥离。模型不能指定 scheme/owner、输入 ID、模块 order 或来源绑定；Runtime 分配后仍须校验完整 canonical revision。角色 schema 的通过不证明 evidencePaths 确实属于已确认来源，也不证明变量引用可运行，后续编译落库必须补这些语义校验。
- Analyst 保留每文件 20,000 字符、合计 120,000 字符的正文截断；Compiler 保留多来源顺序、冲突取舍指导与最多八条历史提示词；Reviser 保留现有编辑投影与输入槽位 ID，省去约束/模块的运行 ID、来源链接和编译历史。正文进入 user 消息；这不是对模型遵循提示词或抵抗注入的保证。
- 角色输入 schema 是宿主内部投影，不能直接作为公开 API 的来源/大小/费用验证。共享 builder 不读取文件或网络，不创建任务、不授权、不计费、不重试。JSON 提取仅容忍围栏和说明文字，之后必须 JSON.parse 与对应输出 schema 校验。
- 桌面原有有限校验修复和 response_format 降级仍由原适配器执行；云端不能直接导入该适配器，必须逐次持久记录发送资格，未知结果不能自动再调用。

专项与最终门禁结果回写[测试手册 §5.29](./V25-MIGRATION-TESTING.md)。B36 是 G-CLOUD-02 编译阶段的共享基础，不代表云端模型已经开放；B35 API 到来源确认后的 `AGENT_COMPILER_UNAVAILABLE` 仍保持真实。

### 8.1 接下来接入云端编译的确定边界

1. **文本配置与付款身份**：服务端明确选择文本模型和受控端点，冻结用户本次有界编译操作的模型/步骤/输出范围。当前 `AccountService.getExecutionBinding` 和 `lockGenerationExecutionAuthority` 都固定图像模型；后者的主体、身份、凭据、BA session、authorization 锁顺序可抽公共身份核对，但保留图像策略，不能改 text:false 放行文本。文本须验证同一上游 owner/credential 来源及实际模型资格，凭据仅在合法 claim 后解密。
2. **持久执行**：以 owner/execution/role/ordinal 标识调用，登记原 auth session/revision、付款与凭据版本、固定 prompt 摘要和请求参数；提交发送标记后才允许 POST。准备、发送、结果及费用独立，取消/到期/换凭据/会话撤销在发送前复查，已发送未知不重试。旧 B35 会话没有文本授权，不能因升级重投而自动付费。
3. **固定来源→分析→编译**：复用 `readConfirmed` 的 S3 字节/hash/owner 校验；只消费用户确认的来源，校验报告的证据路径与参考图片确实存在，持久每份有效报告。用共享 prompt 生成器构造请求，逐调用检查原授权范围，拒绝外部执行器与工具扩权。
4. **草稿落库与结果**：在持久角色结果基础上由运行时分配 scheme/revision/slot/module/source IDs；验证模板变量、输入和来源关系，事务创建草稿/引用并发布 completed。实际读取新草稿且能准备固定试运行，才算创建链验收。后续修改/更新、图片/历史素材、专用包和共享 UI 仍按原 C–E 任务接续。
5. **阶段测试**：真实 PG/鉴权/回环模型 HTTP，统计 POST 次数；覆盖同键并发、准备/claim/发送/回包/保存中断、取消/撤销/凭据轮换、格式失败和 unsupported、有效草稿重读及进程重启。真实生产 bin 与自然租约另留证，不能把普通对象重建或替身费用当作生产付款结论。


## 9. B37：显式文本授权、持久调用与真实云端草稿（2026-09-09）

本节更新 §7–§8 的历史结论：**新的异步 Agent create 后端现在可编译并持久保存草稿**。原 `POST /design-schemes` 不带 document 的同步创建、modify/checkUpdate、旧 confirm-install 和共享页面仍保留未实现边界。完成的是 G-CLOUD-02.2 的文字/已确认 GitHub 来源创建链，不是整张 Agent 产品卡。

### 9.1 配置与授权协议

- API 和 `scheme-agent` 消费角色显式配置相同的 `SCHEME_AGENT_TEXT_MODEL`，端点固定为服务端 `NEW_API_BASE_URL`；空或未设置时禁用文本调用，不猜默认模型、不接受客户端 endpoint 或 API Key。Compose 已传入该配置，尚未部署。
- 新增鉴权 GET `/api/v1/design-schemes/agent/text-model`，每 owner 每分钟最多5次。验证账号/凭据/原会话后，用加密凭据快照进行只读 `/v1/models` 查询，要求运营配置的模型对该 token 可见，随后复验身份/版本。模型列表只有 ID，不能证明模型质量或所有参数兼容；这些仍须 staging 验证。
- 新 start 在原 `{operation:'create', input}` 上增加可选 `text`：冻结独立 text binding、`maxModelCalls=来源数+1`（1–17）、`maxOutputTokens=8192`、`acceptUnknownCost=true`。Binding 含可信 principal/payer、credential ref/version、服务端 model、`cloud-agent/agent-text-v1` 及 `{image:false,text:true}`。原 image binding 仍为 `cloud-default/musefold-image-pro` 和 `{image:true,text:false}`。
- `authSessionId` 由实际 Better Auth middleware 提供；服务端持久记录原 session 与 authorization revision，客户端不能指定它。`packages/db` 只共享主体→身份→凭据→session→authorization 的原锁顺序，模型策略仍分属图像/文本服务。
- 旧 B35 请求没有 `text` 就不会因升级自动收费，确认结束后仍报 compiler blocker。相同 executionId 重放/先取消后启动先查原意图或墓碑，不重新发现模型或调用；不同输入冲突拒绝。

用户接受的是一次固定步骤、输出 token 上限的未知费用文本操作，不是无限额度，也不是管理员代批。模型的 usage 仅是返回的 input/output tokens；没有独立账单时成本保持 unknown，不能换算成已核实扣费。界面展示并提交该授权属于后续 G-CLOUD-06。

### 9.2 持久状态与发送规则

PG 0015 增加 `design_scheme_text_executions` 和 `design_scheme_text_calls`。前者保存原会话/版本及授权，不复制明文凭据；后者按 owner/execution/ordinal 唯一保存角色、固定 prompt 与 request hash、发送标记、期限、合法输出及 token 用量。logout 不级联删除已发送记录；账号整体删除/长期 retention 仍须完整治理卡处理。

会话经来源逐项确认后进入 `compiling`。每个来源只安排一次 Analyst，最后一次 Compiler。首次发送资格在事务中重验原授权、取消/到期、已确认来源及引用可用性，写 `sent` 后才解密并 POST；同 ordinal 重复消费者得不到第二次资格。API 已有每 owner 4 个活动任务限制包含 compiling，独立消费并发2。

文本 POST 固定非流式 JSON 输出、8192 max_tokens，120秒网络/响应体期限、512KiB 响应上限，拒绝重定向且无自动修复、降级或重试。持久 claim 的150秒期限用于判定未知，**不是重新发送资格**。断连/503/重定向/无法判定响应以及进程强杀后的过期 claim 保留 unknown；取消/过期任务的 stale call 也由每轮最多100条的维护转为 unknown，不清空后重试。

`callsSent` 表示已持久领取发送资格；进程可能在领取后、真正 POST 前死亡，所以它不是已到达上游的精确计数。首次领取后 cost=unknown，即便最终取消或草稿保存失败也不回写零费用。迟到的合法输出可以记录完成事实，但不能恢复 cancelled/expired 会话、发出下一次调用或保存草稿。已完成角色结果可供新 PID 接续；未知角色结果不能自动接续。

### 9.3 来源校验与事务草稿

只读取用户已确认的固定 PG/S3 快照，复查文件字节长度/hash/owner；不重抓移动分支、不执行仓库代码。Analyst 的规则须有本次文字文件证据，参考图路径须真实存在；Compiler 的证据必须属于这些快照，文本变量声明/引用一一对应，不允许重复、未知、残缺占位符或缺少 input-template/style-rule。Runtime 分配 scheme/revision/slot/module/source IDs，拒绝模型自称 verified、无来源自称 faithful，以及有 unsupported 报告却自称 faithful。

输出经过完整 revision schema 后，在同一 PG 事务中重验身份与来源、调用确定性 `DesignSchemeService.createInTransaction` 保存草稿/来源引用，并写 completed/event。触发器模拟保存失败时回滚草稿和完成事件，已经合法完成的模型结果保留；新进程可落库且不重复收费调用。实际草稿能由详情服务读取，并进入已有 `DesignSchemeRunService.prepare`：生成独立、正确的图像执行 binding/固定计划，重复准备返回相同结果且不创建 generation_run。

本批支持文字编译和已确认 GitHub 文字证据，不将来源图片自动导入为方案参考资产；图片/历史上下文、专用包、修改/上游更新和共享异步 UI 仍由后续任务完成。模型描述的真实性、实际图像质量和真实账单不能由合成 JSON 测试证明。

### 9.4 验收与接续

逐命令、首败、最终计数和实际/替身边界见[测试手册 §5.30](./V25-MIGRATION-TESTING.md)，任务接续见[路线图 §6.25](./V25-MIGRATION-ROADMAP.md)。自然租约到期、全取消/存储/发布中断点、账号删除/事件与 prompt retention、索引与吞吐、模型 capability 实测及旧新消费者部署回滚还未整体验收。原 C3/C5、P5/P6、worker/GC/旧库/最终平台发布条件继续开放，管理员依赖不变。


## 10. B38 云端异步修改与正式版保护（2026-09-09）

新异步请求支持 `operation=modify`，输入为 canonical modify 加必需 `expectedVersion`，且必须带独立text授权。本次只允许一次Reviser；旧同步modify合同/501与桌面语义不变。取消接口可带operation，先取消后启动也能返回modify墓碑；省略operation仍兼容create。重复execution先读取原意图或墓碑，已存在任务不再发现模型；同ID不同请求返回冲突。

`DesignSchemeRevisionAuthority` 在模型发现前核对本人live scheme、精确版本以及当前draft或正式current/working-draft基线。客户端baseDocument只用于与实际PG文档比较，不能替换原文档。入队、领取发送资格及最终落库再次锁定和验证同一基础版本。model请求不持有长事务；单次调用的发送/unknown/已完成结果复用规则与§9相同。并发两个不同修改意图可各自已发送一次，但只有仍匹配base/version的结果能提交，另一项报告 `AGENT_BASE_REVISION_CHANGED`，费用保持unknown。

domain `cloud-reviser` 复用Compiler变量/证据校验，运行时分配新revision并指向精确parent，保留原sources/sourceSnapshotIds/assetIds/parameters。已有图片槽唯一匹配时保留其ID与限制；冲突ID由运行时排除。不采纳模型伪造的存储身份，不接受自称verified或把原非faithful提升为faithful。已有GitHub来源在绑定后可跨准备TTL使用，不重拉分支或再跑Analyst；这不表示支持修改中添加新来源/图片或上游更新。

确定性 `DesignSchemeService.updateInTransaction` 与原update共用实现，先锁scheme再验来源/资产，CAS更新指针；与Agent完成事件同一事务。草稿更新current，正式方案只更新workingDraft及版本，原正式文档不变。API装配和独立scheme-agent bin均注入既有AssetService，保留的图片仍由实际所有权规则验证。事务失败时不留下半修订/完成事件，已合法保存的模型结果供新PID继续；取消、到期、撤权、改名、删除及其他版本变化不能被迟到结果覆盖。

详细22项专项、完整回归、迁移、首败和证据层级见[测试手册 §5.31](./V25-MIGRATION-TESTING.md)。真实PG/HTTP/PID不等于真实付费模型或共享页面；正式版保护样本的trial/cover/formal为明确SQL夹具，未把它计为真实试跑/正式化。上游更新按[路线图 §6.26](./V25-MIGRATION-ROADMAP.md)，产品/包、全断点/自然期限/retention/账号删除、旧新版本部署回退仍开放。


## 11. B39 上游更新：检查、确认与付费编译分离（2026-09-09）

新异步 `operation=check-update` 只收本人scheme/baseRevision/expectedVersion，不接受text、客户端baseDocument或来源URL替换。服务端冻结实际基线、原快照和来源请求。优先使用B34准备记录的原requestedRef；没有该信息的导入快照保留其持久ref/SHA，不猜当前default branch。缺少可核对的GitHub绑定/commit/hash拒绝检查，不伪报up-to-date。旧同步check-update与桌面合同不变。

免费阶段复用PG/S3准备，每源解析一次分支到SHA、固定字节及清单。无GitHub来源终态 `no-source`；全部检查未变为 `up-to-date`，不需要确认或文本凭据发现，不创建修订。未变的新暂存标记cancelled，沿现有有界清理回收，原绑定不受影响。发现变化时展示新固定source及前后commit/hash标识，逐项 `confirm-source` 后继续下一来源；旧确认不会批准下一项。sourceCount表示全部检查来源，update.checkedSources表示已检查，confirmedSources只计已确认的变化来源，不能直接用confirmed/sourceCount判断完成。

全部变化源确认后进入 `authorization-required`。独立 `POST /design-schemes/agent/authorize-update` 收executionId、expectedSessionVersion、text：要求当前确认阶段版本，精确调用上限=变化来源数+1。经实际middleware会话绑定原付款身份/凭据/授权版本、复验基础方案和确认来源后，授权记录与queued/event/job同事务。原免费检查请求/哈希不被改写；相同授权重放返回已有状态且不再发现模型，不同会话版本或授权内容冲突。并发相同授权只有一个持久text执行；这是新的显式付费操作，不把早期检查会话暗中升级为批准花费。

每个变化来源一次Analyst，最后一次Compiler；未变来源和用户定制由原canonical文档作为编译上下文，未声称重新分析其字节。模型读取新确认快照，显示后分支再次移动不改变采用SHA。纯cloud-update校验输出/证据、替换确认的snapshot/package/ref/hash，保留未变来源/绑定ID、资产和参数，生成新child与更新trace；旧commit许可证不能继承成新许可。

真实试运行测试发现并修复：旧 `updateInTransaction` 会复制全部旧source bindings，再添加新文档bindings，导致新版本残留被替代快照。现在新修订只按自身文档建立引用，旧修订和自己的绑定不变。该修复同时适用于确定性update和异步modify/update，由完整API回归与实际试运行准备验证。新修订/指针及completed/event保持原子；正式current不被更新覆盖。

付款/单次claim/unknown/新PID复用规则沿§9–10。22项更新专项、迁移与完整门禁、首败及真实/替身范围见[测试手册 §5.32](./V25-MIGRATION-TESTING.md)。API使用Hono app.request，模型/账号为合成fixture；没有共享页面或真实付费/部署证据。来源确认的license仍为未知，不能把当前仓库SPDX当固定commit许可。素材/历史/专用包/共享产品与完整自然期限/删除/retention/版本回滚仍由[路线图 §6.27](./V25-MIGRATION-ROADMAP.md)及原治理卡继续。


## 12. B40 上传素材：固定副本与草稿资产（2026-09-09）

新异步 create 现在接受本人方案上传入口返回的 `sourceAssetIds`，可附完整 `sourceAssets` 供比较。服务端拒绝重复、额外/缺失元数据、错误 origin/role/hash、外用户或失效暂存；元数据来自完整图片解码，客户端不能提交冻结上下文或 objectKey。单图沿现有20MiB/尺寸/像素限制，总计最多64张、128MiB。仅这类已实现素材解除 `AGENT_ASSETS_UNAVAILABLE`；历史作品/提示词、客户端source document/package/snapshot/binding以及仓库图片自动采用继续明确阻断或待实现，不能把已接受图片计为完整Agent闭环。

服务端在新任务入队和付费模型调用前读取、解码和复制图片。每个副本先登记已有 `generation_reference_uploads` 再PUT，保留独立随机ID、真实hash/尺寸及选择顺序。`design_scheme_agent_sessions.materials` 存 canonical `DesignSchemeAgentMaterials`，把原选择ID映射到固定副本资产。原暂存图片不被消耗，可以继续使用或删除；任务依赖自己的副本。相同execution重放先读取原意图/墓碑，原图随后消失也不会重新复制或改选；并发新请求只选中一个持久上下文，失去入队竞争的副本仍由既有24h注册表回收。

副本TTL为24h，Agent TTL为1h。未完成、取消、失败、入队失败或部分复制的对象不建立永久方案引用，到期沿现有outbox处理；没有新增第二套GC。复制失败但PUT可能已写入时也保留清理记录。模型调用前逐项读取实际副本并复查内容，领取发送资格时在同一父会话事务内锁定暂存行、验证归属/存活/未被使用和元数据；提交草稿前再次读取、校验，最终 `AssetService.attach` 以冻结元数据精确比较实际字节后原子晋升。副本无效报告 `AGENT_MATERIALS_INVALID`，不把未知收费任务重新发给模型。

Compiler只收到上传图片数量及明确的能力说明，没有接收图片像素。Runtime把副本ID按原顺序写入 `document.assetIds`，添加参考来源和“未做视觉解析”的固定提示；fidelity最多adapted（unsupported保持），图片不能成为成功试运行/正式封面的证据。保留图片本身不会自动增加必需图片槽；模型根据用户需求合法声明图片槽时，已有RunService可实际使用这些资产作为引用。

草稿、资产晋升、completed与event同一事务。资产插入失败会回滚整个草稿及晋升，合法模型输出保留；新PID可使用同一副本与已完成输出落库，仅一次模型POST。取消、到期、上游未知和真实SIGKILL沿原协议处理。真实层级/首次失败/最终门禁及TTL时钟注入边界见[测试手册 §5.33](./V25-MIGRATION-TESTING.md)。共享页面、实际付费模型和图像质量、生产部署、全账号/全资产保留期未由本批证明。


## 13. B41 本人历史作品与所选提示词（2026-09-09）

本节接续§12：新异步create支持`historySources[{runId,assetId,includePrompt}]`。服务端只读本人、run/asset关系匹配、succeeded且未软删的历史；对象键必须等于该owner/run/asset的受管生成路径。实际S3字节经完整解码，hash、类型、大小和尺寸必须与PG一致。客户端不提交提示词正文、对象键、冻结快照或可信origin。确定性create拒绝调用方伪造的新historyItems。

选中提示词时，服务端要求`promptSnapshot.schemaVersion=1`，非空`finalPrompt`与实际`request.prompt`完全一致。保存完整正向finalPrompt，不另复制负面词或整个生成请求；未选中时不读取正文参与编译，缺失旧promptSnapshot也可仅采用图片。最多8份提示词，每份8000个JavaScript字符串长度单位，总计32000；超限拒绝，不能接受后静默截断。上传与历史图片合计最多64张、128MiB，单图沿现有20MiB/解码限制。最大组合的实际吞吐尚未压测。

复制沿B40暂存注册表，产生独立`cloud-run/example`资产。入队事务再次锁定原历史并核对状态、正文和图片元数据；复制中原历史删除或变化则拒绝。成功入队后以固定副本为准，原历史随后删除不破坏任务与已成方案。失败或未被选中的副本仍由既有24h暂存清理负责，不新增GC。每次文本调用前和提交前验证固定副本；未知调用不重发。

canonical `sourceSnapshot.historyItems`保存原选择、独立图片assetId、imagePath、可选promptPath及完整提示词。`files`保存真实图片/UTF8提示词的摘要和大小，提示词`textExcerpt=null`；正文在不可变快照JSON中，不是第二份S3文本对象。snapshot摘要覆盖files和historyItems，恢复进程也须核验正文/文件摘要。包含新historyItems却不符合合同的旧读取不能降级成丢失来源的legacy快照。未来专用包须由inline正文生成对应文本文件，并从真实asset读取图片，不能假定promptPath有S3 objectKey。

共享Compiler现在同时消费GitHub Analyst报告与选定历史提示词，修复原互斥分支丢弃历史文本的问题。提示词携带可核对的evidencePath；图片只提供数量与能力说明，未送像素给文本模型。创建时写history-image/example，选中正文另写conversation-turn/context；同一snapshot的多个语义绑定保留在canonical文档。PG每revision/snapshot的单一引用边按context→example→reference→normative取最高角色，用于归属/引用保护，不替代文档语义。新revision仍只根据自己的文档建引用，不恢复B39移除的旧绑定复制。

modify/update保留原历史快照、资产和正式current，文本修订继续明确未做视觉解析，不能将保留图片提升为faithful。updateContext快照上限由16扩至32，以容纳16个GitHub来源加历史；GitHub来源数与调用授权上限未扩大。真实详情和含必需图片槽的RunService.prepare消费独立图片副本；prepare通过不等于实际生成成功或正式化。

B41未新增PG/SQLite DDL，复用0018 nullable材料列和现有来源JSON；旧无historyItems快照仍可读。新版任务须由理解新合同的API和Agent消费者处理，旧新混跑与回滚仍由发布卡验收。完整测试、首败、实际PID/HTTP与SQL正式样本的边界见[测试手册§5.34](./V25-MIGRATION-TESTING.md)。仓库图片采用、专用包、共享页面、自然期限/全GC/账号删除及原治理发布条件继续见[路线图§6.29](./V25-MIGRATION-ROADMAP.md)。


## 14. B42 已确认仓库图片的采用与更新（2026-09-09）

本节接续B41：新异步create和check-update在所有相关Analyst结果持久完成后、Compiler领取发送资格前，采用报告referenceImages中的真实图片。只使用本次确认快照的完整字节，不读新的branch、不跟外部URL，也不相信模型提供的存储ID。原固定来源reader已进行ZIP路径/预算/完整图片解码；采用时再次核对真实hash、MIME与大小，再通过原暂存注册表复制。

**选择规则**：同一snapshot内相同path和imageRole只采用一次；同path但角色冲突拒绝，不任意取最后一项。不同snapshot即使文件名或字节相同也分别保存来源与资产。未被报告选择的图片记入omittedPaths，保留在不可变来源快照中，不进入方案assetIds；全部未选时也记录明确结果。不存在或文字路径被报告当图片会触发既有模型输出校验失败；无法解码的图片可更早在免费来源准备阶段失败。这些失败不进入Compiler。

imageRole是建议用途（style-reference、subject-reference等），资产role统一为reference、origin为repository；二者不能混用。当前没有固定commit许可识别的可信结论，资产license保持null：仓库元信息中的当前MIT或模型license文字不能证明本次文件的许可。正文分析和图片采用均未向文本模型发送像素，不能声称理解图片视觉内容；有保留图片的产物最多adapted，unsupported不提升。

**持久时点**：会话materials新增可选repositories，每个确认快照保存snapshotId、sourceContentHash、reportHash、采用图片的provenance与资产元数据、未选路径。副本先走既有registry-before-PUT，随后在原授权、父会话、来源锁与暂存检查内选定一份上下文；并发产生的未选副本仍有清理记录。已落库的采用记录由后续进程复用，不能改变assetId或重新付费跑Analyst。采用记录提交前的进程/存储/DB失败可能留下可发现副本；只允许重做免费复制，所有已完成文本调用保留。瞬态DB/存储故障不错误终止为素材非法；无效路径/角色/合同/字节则明确阻断。

Compiler及最终保存前核对采用记录与实际持久报告、确认快照/文件摘要和副本字节，claim事务比较会话素材摘要并锁暂存元数据。纯文本、没有任何选中图片的旧服务装配不要求资产服务；本批兼容回归已复现并修复该误拦截。文本授权仍是原来源数+1的独立有限调用，采用不增付费次数，unknown不重发。

**方案中的来源**：revision document新增可选repositoryImages，逐项保存snapshotId、sourceContentHash、relativePath、imageRole、assetId及文件contentHash。assetId必须属于本修订，snapshotId属于本修订来源，数据库中真实资产必须为本人同方案的repository/reference，且摘要/大小/类型对应固定GitHub文件。新采用资产的来源不能在后续document编辑中被删除或改成文字路径；旧无该可选字段的历史文档保留原读取语义。当前详情可读该映射、快照文件与实际图片；未采用项可由快照图片清单减去映射核对，并有明确数量提示。

**更新事务**：modify保留既有图片及来源；check-update只替换变化快照对应的已采用图片。未变仓库、上传图片和历史作品保留；变化来源不再选择某张图时，新修订移除其引用，旧revision仍保留旧图。更新先校验保留资产，再在新revision事务中晋升新副本、验证完整来源、建立新绑定及CAS切换草稿指针，并与Agent完成事件原子提交；正式current不变。新图插入失败后原版本和暂存记录保留，新PID可沿原调用结果及采用ID完成，不能回放付费模型。

总限制延续上传+历史+仓库合计64张、128MiB；每仓库报告最多24条建议。更新按保留图片加本次新图片核对总限，不按已被替换旧图重复计数。无新PG/SQLite DDL、第二套对象存储或GC；已晋升repository资产、旧revision引用和软删方案继续由既有保护逻辑处理，未晋升/失去竞争的副本沿24h注册表回收。最大字节负载、自然1h/24h期限及全账号/来源保留期仍须原治理卡验收。

实际PG/HTTP/S3、强杀/新PID、事务、兼容首败与完整门禁见[测试手册§5.35](./V25-MIGRATION-TESTING.md)。没有共享异步页面或云端方案包交付；接续[路线图§6.30](./V25-MIGRATION-ROADMAP.md)的D3包，再D4共享产品和原E条件，管理员依赖不变。

## 15. B56 共享异步接缝与本人执行发现（2026-09-09）

已有独立client七个执行方法复用到可选`designSchemes.agent`，新增只读`list`；Web沿既有cloud gateway工厂取得能力。单源类型来自contracts的z.infer；HTTP前严格校验意图，响应须匹配原executionId/start operation。事件须同execution、seq等于会话version、严格递增且nextSeq对应最后事件；空页保持请求游标，快照间合法seq间隙不自动触发新执行。202仍是受理，旧Desktop完成结果与来源确认协议继续兼容。

`GET /design-schemes/agent/executions?limit=20&cursor=...`仅向本人当前正常会话提供最多50条metadata，返回private/no-store。事务重新锁定主体、账号身份、BA会话及normal授权；复用由包服务提取的通用账号核对，不读取模型凭据或批准消费。结果仅含executionId/operation/status/version/createdAt/expiresAt/schemeId/schemeName，当前方案名称再次按owner及未删除过滤。无私有request/materials/updateContext、模型授权、完整输入或对象键。来源与费用确认仍由原执行服务逐次裁决。

只读列表保留最近持久状态，不替用户推进过期、取消或新建队列，不续租或读写对象；选择任务后get原执行才适用原状态转移。丢start回包可由列表找到同一execution，再次提交原意图仍只有一份会话/初始事件/队列任务。新正常登录可以发现原记录，但列表不授予旧文本消费权限。创建时间迁移、微秒分页、更新/新插入、跨owner/失效游标和已删除方案处理见[数据迁移§27](./V25-DATA-MIGRATION.md)与[测试手册§5.50](./V25-MIGRATION-TESTING.md)。

B56仅完成D4-A/B传输和发现基础。恢复页面、真实reload/双页面、共享授权与创建/修改/更新、Agent→真实worker试跑→正式化/导出尚须[任务卡§5.7](./V25-MIGRATION-GOALS.md)逐项完成。真实PG、Hono、Better Auth、进程和队列可与受控GitHub/S3/模型上游共同验证，不等于生产上游付费或全平台交付。


## 16. B57 共享创建授权与原任务恢复（2026-09-09，历史快照）

本节保留当时待验项；创建实际产品联合由§17 B58补齐。

共享工作台消费可选`designSchemes.agent`，明确读取offer、展示未知费用后，用户同意才发送create。冻结原executionId、文本binding、去重GitHub来源数+1次调用和offer单次输出上限；没有来源时只授权1次编译，系统offer的17次不是本次默认授权。历史只提交run/asset身份与includePrompt选择，实际素材与历史文本仍由服务端核对。GitHub tree/blob路径保留给现有服务解析。

共享Dialog/移动Sheet逐个显示固定来源、文件规模和许可证，`confirmSource`使用父executionId与当前confirmationId。关闭只结束本页等待；取消经独立确认。本人任务分页只用于发现，选中后读原get/events；丢受理响应不自动新建请求，明确重试仍使用原冻结请求。事件id、operation、seq/version和nextSeq受校验；账号变化、权限失效或读取错误隐藏旧来源与结果。completed才使工作台清空正文并报告草稿创建，图像试跑另行发起。

本批新增mapper/controller18项与4条PC/移动协议页面测试；页面使用生产features/api-client，账号/来源/模型/草稿为HTTP夹具。不能将它们写成实际PG编译成功。完整门禁、首败、源摘要与准确结果统一见[测试手册§5.51](./V25-MIGRATION-TESTING.md)。B56真实后端证据保留历史；下一步[任务卡§5.7.2](./V25-MIGRATION-GOALS.md)B57-T2将新页面与实际BetterAuth/Hono/PG/文本上游/Agent队列合流，再做修改/更新及真实worker试跑、正式化和包导出。B57与D4父卡不因协议页面通过而关闭。

## 17. B58 实际Agent创建与共享页面联合（2026-09-09）

B58已验证共享云端Agent创建与实际Better Auth/Hono/PG/Graphile合流，涵盖纯描述、两GitHub来源、历史素材、丢回包/双页恢复和原请求重放、取消/撤权及未知费用。云端修改/更新入口、真实生图试跑到正式化与包交付的联合流程仍待。

B58真实服务PC/移动专项14P、关联API集成71P；完整check36/36，数据库条件完整E2E 378P / 7S，0F/0 flaky（1208.238秒）。最终源码1545项摘要`4ad6c44b0517c78df78854e500f13c0d5ee3429e1414510389505e145a758e52`，相对B57新增5/修改3/删除0；源码扫描1452文件/1既有归档、本轮10份实际方案ZIP独立扫描均零命中/错误。

纯描述实际1次compiler；两个固定GitHub来源全部明确确认前0次模型POST，之后2次analyst+1次compiler。实际202丢回包、关闭/reload/双页面及原请求重放维持单执行、原queue job和唯一草稿；取消、撤权和上游断开不重复发送。本人历史图经实际选择器进入草稿并核对hash，仍是待验证方案。

文本模型、GitHub、S3和上游账号为受控服务；历史图为预置材料，不代表新方案已经试跑。Agent消费者在测试进程内运行，不替代正式进程重启或实际收费上游、全平台包及生产验收。 8张实际截图复核未改变视觉基线；首败/修复、准确命令和跳过见[测试手册§5.52](./V25-MIGRATION-TESTING.md)。下一步按[任务卡§5.7.3](./V25-MIGRATION-GOALS.md)实现修改和上游更新授权，再执行真实出图联合，不关闭D4/G-CLOUD整卡。

## 18. B59 共享修改与实际服务联合（2026-09-10）

B59已接共享云端方案修改：同次读取冻结revision/version，独立最多1次文本授权，丢回包按原执行恢复，连续修改精确working draft；取消、冲突、撤权和unknown保留原正式版。下一步是免费上游检查/独立更新授权，以及真正生图worker试跑→封面→正式化→专用包联合。

唯一合同派生version字段进入UI附件，从current/working-draft的同次读取固定revision/version；严格mapper只提交execution/scheme/baseRevision/expectedVersion/instruction，不传UI标签或整份文档。复用创建控制器扩展modify，文本offer独立授权最多1次；原请求及operation冻结，关闭/失败保留正文，completed才结束等待。已知提交前冲突不自动查询/重放，要求从详情重新选择，绝不静默采用新版本。

B59组件专项83P、实际API三文件28P、PC/移动真实服务专项12P；完整check36/36（31缓存），最终数据库条件完整E2E **390P / 7S，0F/0 flaky**（1296.018秒）。最终源码1546项摘要`6f9aa0a1cc8821f29f92c5392ab6ae698b8b719b3f2c1f5df8f66f6dbc8f164f`，相对B58新增1/修改16/删除0；源码1453文件/1既有归档，以及本轮22份实际ZIP扫描均零命中/错误。 实际生产页面/api-client→Better Auth/Hono/PG/Graphile/文本HTTP已合流；上游账号、文本模型、GitHub、S3为受控服务。本轮归档共24份，其中12份为修改用例的合成既有方案输入ZIP，另外10份是既有跨宿主导出/交换ZIP，其余2份为HTTP交付字节夹具；不能称为22份新版本正式导出。旧正式基底通过fixture历史trial及实际封面/正式化HTTP准备，新Agent版本未用SQL补试跑资格。实际收费上游、正式Agent进程重启、真实新版本出图全链、全部GC/迁移/文件环境/各平台包/生产与回滚仍待。

具体流程、第一次失败与完整测试结果见[测试手册§5.53](./V25-MIGRATION-TESTING.md)。下一步复用已有update-workflow实现[任务卡§5.7.4](./V25-MIGRATION-GOALS.md)D4-E，不新建费用状态机；完整新版本出图联合与父卡保持开放。

## 19. B60 免费检查与独立更新授权的共享产品（2026-09-10）

B60已接共享上游更新：免费检查固定版本、逐变化来源采用、独立绑定会话版本的文本授权和原执行恢复；仅编译实际变化来源，未变化来源及图片保持。创建/修改/更新产品均已有实际后端合流证据，下一步是真正生图worker试跑、封面、正式化与方案包联合。

详情通过可选agent能力冻结canonical check-update输入；首次明确检查不加载模型或携带text授权，终态no-source/up-to-date可恢复但不显示消费入口。逐源面板展示固定提交变化、读取规模/许可证及采用数量，来源采用后仍无模型调用。authorization-required才显式获取offer并另行同意；授权payload固定原expectedSessionVersion、模型binding和变化数+1上限，原free start与paid授权重放分离。关闭不取消，取消有独立确认，撤权隐藏原会话；版本竞争和unknown不覆盖新状态。

B60初期组件专项91P（最终check含恢复回归后features716P）、实际API三文件45P、PC/移动真实服务专项18P；完整check36/36，最终数据库条件完整E2E **408P / 7S，0F/0 flaky**（1625.283秒）。最终源码1547项摘要`33ae75cbe64bd849c7d7e378086afc23914f71dcbef95d42d91efa202b4e063b`，相对B59新增1/修改8/删除0；源码1454文件/1既有归档及本轮22份实际ZIP扫描均零命中/错误。 B60新用例的基底由真实Agent创建，未用SQL制造试跑/正式资格；账号上游、GitHub、文本模型与S3为本机受控服务。全量归档24份：12份B59修改用例的合成既有基底输入ZIP、10份既有跨宿主导出/交换ZIP、2份HTTP交付字节夹具；它们不证明新方案已经通过生图试跑并正式导出。真实收费上游、完整新版本出图链、全部生命周期/各平台包及生产回滚继续待验。

实际新Agent草稿经一次变化源更新后仍是未试跑草稿；原未变化snapshot及PNG引用保持，变化源换到已确认commit和对应受管图片。PC/移动丢free start回包、来源确认后关闭/双页恢复、丢authorize回包及原授权重放均有实际事务/调用计数证据。当前正式版保护另有实际API集成范围，不能将本轮浏览器草稿说成已正式化。

源码、首败及未验范围见[测试手册§5.54](./V25-MIGRATION-TESTING.md)。后续[任务卡§5.7.5](./V25-MIGRATION-GOALS.md)接真正generation worker试跑、封面、正式化/升级与实际包联合；旧同步接缝完整兼容和原E仍保留。

<!-- B61:START -->
## 20. B61阶段：新Agent结果与实际生图链

B61进行中：新增取消前后、上游unknown和丢受理回包联合回归，实际API3P及PC/移动8P。真实generation worker已接入；纯描述、GitHub和历史素材三形态在PC/移动Web完成新方案出图、封面、正式化和实际方案包往返，GitHub还完成修改与上游更新后的独立新试跑/新封面/promote。修复新版本加载时Agent进度窗口重建，以及原生云端历史素材导出缺失完整内容。

保留来源图片不等于每次运行自动使用。三形态用例由受控Compiler按需声明image-set，再由用户经现有Composer文件入口明确选择已保留图片字节；实际worker的images/edits输入hash与所选素材一致，输入/输出/版本账本逐项核对。历史来源图保留cloud-run/example语义，新增trial输出为cloud-run/output。

新增生命周期回归1P、历史导出/篡改回归3P、实际API联合与导出42P；最终正向浏览器6P/0S/0F/0 flaky（120.974秒），完整check36/36（24.623秒）。源码1554项摘要`d0b30e3906f758d9019c39444fc528da306333dc83d5b444b0c5c81d97b87bcc`，相对B60新增7/修改8/删除0；源码及截至专项的16份实际ZIP扫描零命中/错误。故障增量源码1556项`600e79e2a45394e468c056bdc1455ed66224d3f12204893b8d5f7623cc655b8d`，只新增2个测试文件；API3P（13.444秒）、浏览器8P（78.449秒）、最终check36/36（6.683秒）。全量实际28ZIP及2份纯文本UI下载替身正确分类扫描零命中/错误；最新源码复扫零命中/错误。 历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)、[后续任务§5.7.6](./V25-MIGRATION-GOALS.md)与[阶段报告](../../tests/v25/.results/b61/validation-summary.json)。
<!-- B61:J4 START -->
**J4-b最新进展（2026-09-10）**：B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 同源码完整Electron及受影响网页回归：160P/2S/0F/0 flaky（1004.633秒）；这不是全部Web用例重跑。 J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:J4 END -->
<!-- B61:AUTHORITY-READ START -->
**授权与读取恢复最新增量（2026-09-10）**：B61新增正式回归：授权失效/真实登出发送前后及版本冲突API6P（25.606秒）；PC/移动故障专项12P/0S/0F/0 flaky（127.780秒），含原取消/unknown/丢回包8项与新增事件/任务读取失败、详情错误态及显式重试4项。check36/36（33.404秒，30缓存），源码扫描零命中/错误。 当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。 证据与首次失败见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:AUTHORITY-READ END -->
<!-- B61:PROCESS-NATURAL START -->
**进程与自然租约增量（2026-09-10）**：B61新增实际进程3项已验：领取前强杀后新PID一次成功；发送后强杀/暂停经生产10分钟租约自然到期与分钟巡检收敛unknown，图像请求仍各1次；旧暂停进程恢复后终态/回执不变、无新增资产。API完整集成496P、Worker完整集成92P，网页故障专项12P；最终check及源码扫描通过。 自然领取后未发送的epoch替换、取消交错、迟到上传/新引用保护、J5-e与F5-X/原E、平台包/生产回滚仍待；管理员前置保持开放。 首次失败、复验和源码身份见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROCESS-NATURAL END -->
<!-- B61:ASSETS-EPOCH START -->
**资产与自然租约增量（测试2026-09-10，证据回填2026-09-12）**：B61新增7项资产/进程联合已验：参考图篡改或删除时零图像发送；实际10分钟租约后未发送任务由新PID以epoch2成功，取消交错与迟到PUT隔离；写入后删除失败保留对象并跨新PID等待实际5分钟退避再清理。完整API503P、Worker92P，网页正向与故障18P；check36/36及源码、6份实际新方案ZIP扫描通过。 PG输出落库/丢提交回包、cleanup与新引用竞争、J5其余/F5-X/原E及全平台/生产回滚仍待；本片未证明S3连接断开，完整迁移与管理员前置保持开放。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-EPOCH END -->
<!-- B61:ASSETS-WIRE START -->
**S3连接中断增量（2026-09-12）**：B61补齐2项真实S3回包断线测试：写成后首次断线由SDK同key重传成功；持续断线后原任务保留unknown费用，新PID维护删除孤立对象。两例各1次图像调用，成功资产跨重启/维护保留，失败不产生trial。最终完整API505P、Worker92P，check36/36及源码扫描通过。 继续PG输出落库冲突/提交回包丢失、cleanup与新引用争用、其余J5/F5-X/原E及全平台/生产回滚；B61和整包未关闭，管理员尚未开始。 源码、首次失败与实际证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-WIRE END -->
<!-- B61:ASSETS-DATABASE START -->
**数据库输出与提交回包增量（2026-09-12）**：B61新增2项实际数据库故障已验：输出登记错误使generation/方案资产、trial和完成事件整体回滚；PG已提交而回包断线时，独立连接证实成功，新PID清理保留受引用图片。两例各1次图像调用、原版本/费用回执不被重启改写。完整API507P、Worker92P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 接续GC1真实新引用与清理竞争、其余J5数据库/权限/版本组合及F5-X/原E、全平台与生产回滚；B61和整包未关闭，管理员尚未开始。 证据及注入边界见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:ASSETS-DATABASE END -->
<!-- B61:CLEANUP START -->
**引用与清理竞争增量（2026-09-12）**：B61新增真实新Agent引用/清理两种次序2项及Worker批次回收1项已验。修复已采用的过期参考图每次维护反复入队10轮的问题：候选排除方案引用，加锁后再次复查；保留最终对象保护。完整API509P、Worker93P、网页18P，check36/36及源码/6份新方案ZIP扫描通过。 继续J5浏览器撤权/跨owner/版本promote与素材交叉故障、在途预检后引用变化等剩余并发；F5-X自然TTL/格式/容量/系统文件交付、原E、全平台和生产回滚仍待。B61、迁移整包及管理员前置保持开放。 边界与真实证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:CLEANUP END -->
<!-- B61:INFLIGHT-ISOLATION START -->
**在途预检与浏览器身份增量（2026-09-12）**：B61新增在途参考图读取与物理清理交错1项已验：旧GET返回有效字节，事务内重验仍404，零图像调用/新任务/回执/trial。双页面实际登出及独立账号隔离在PC/移动4场景通过，重新登录只恢复原结果。API定向9P，统一check36/36及源码扫描通过；本轮仅测试变化。 接续J5-c真实provider撤key、working-draft promote版本竞争与素材型交叉故障，再完成F5-X/原E/全平台/生产回滚。B61、整包及管理员前置仍开放。 当前1568项8fdc36f1…；API9P在9109d9e9…执行，其API测试/生产源码与当前逐文件一致，后续仅给网页测试追加独立账号检查。最近完整API509P/Worker93P/网页18P及6ZIP扫描属于上轮69d5898e…，本轮未重跑完整后端或全部E2E，不写成全量510P。 详见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:INFLIGHT-ISOLATION END -->
<!-- B61:PROMOTE-CONFLICT START -->
2026-09-12：双页面改封面导致的旧转正请求409及显式恢复已验，修改/上游更新两种路径均完成真实新试跑和包往返。导出仍要求本revision封面，恢复流程由用户明确选回；不自动覆盖另一页选择或重新生图。继续J5-c上游凭据撤销、素材与其他故障组合及J5-f；F5-X、原E、四端/平台发布与生产回滚仍待。这里只关闭封面变化导致的promote CAS场景，不据此关闭所有并发交错或B61；管理员前置保持开放。 详细流程、首败与同源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:PROMOTE-CONFLICT END -->
<!-- B61:PROVIDER-RECOVERY START -->
2026-09-12：上游按实际合成凭据撤销的HTTP401与显式恢复已验，包含纯文本和参考图输入。实测还修复了工作台迟到会话加载覆盖新方案正文/图片的问题；主动切会话仍恢复目标内容。完整E2E首轮112P/1F后中止（337项跳过或未执行）；焦点修正后的专项6P/2F进一步定位toast遮挡。补齐正常指针等待后，三形态试跑/版本竞争/导出重导入专项8P/0F/0S/0flaky。完整Web/移动/Electron复验尚未完成，不记整包通过。 详细范围、首败和源码报告见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。继续J5-a/b素材与取消/unknown/丢回包/读取恢复组合及J5-f最终收口，再接F5-X、原E、四端/平台发布和生产回滚。上游采用本地受控HTTP，不是付费供应商实网；恢复是重新启用同一合成key，不声称验证key轮换或管理员代授权。B61、完整迁移与管理员前置仍开放。
<!-- B61:PROVIDER-RECOVERY END -->
<!-- B61:MATERIAL-FAULTS START -->
2026-09-12：B61已扩展纯文本/参考图输入×取消前后、unknown、受理回包丢失、事件/任务读取中断共六类故障的双视口测试；参考图经真实上传，核对正式run的冻结引用ID、实际图像端点和字节SHA256。 素材故障24项与修改/更新30项联合专项54P/0F/0S/0flaky（642.820秒）。 同源码API完整集成514P/0F/0S（673.167秒）；同源码Worker完整集成93P/0F/0S（53.911秒） 同源码完整E2E 455P/7S/0F/0flaky（2284.791秒），跳过项按实际项目/原因保留；当轮真实归档和明确UI替身分别扫描通过。 B61原boundary/verify的12项验收对照已通过，关闭D4-J联合试跑批次；接续F5-X旧格式/异常/容量/自然期限/原生交付、原E数据与同步、四端/平台发布及生产回滚。管理员仍在全部迁移闭合后开始。
<!-- B61:MATERIAL-FAULTS END -->
<!-- B61:END -->
