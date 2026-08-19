# Musefold v1.1 Web 后端交付计划

本轮交付增量：Web 最近对话已接入共享上下文菜单与会话软删除接口，提示词库搜索已接入 Cloud gateway 服务端查询并防止过期响应覆盖；fixture 与 typed client 保持同一 `q`/版本契约。提示词引用卡片和全文预览已由 Desktop/Web 共用，正文通过生成来源快照传递。对应共享产品 UI 测试为 `37/37`，Web E2E 为 `11/11`，真实 Cloud/staging 浏览器验收仍未替代。

> **状态**：首版任务分解
>
> **范围**：账号、Web 制作工作台、生成历史、云端提示词库、桌面/Web 提示词同步、Cloud MCP 和共享 UI
>
> **当前实现状态（2026-08-19）**：M0-M7 已有可运行代码基线和本地集成验证；这不是 production release。M4 的 Desktop Prompt/Folder/Tag 双向同步、独立 usage event outbox、opaque 设备会话、设备游标、撤销检查、冲突 UI 和账号生命周期已完成代码闭环，仍需两台真实设备与 Web 联调；M7 已切换到 PostgreSQL 持久化 `oidc-provider`，官方 MCP SDK 协议测试、签名 `resource_link`、PostgreSQL 限流和 grant 级并发预算已通过。M8 已覆盖 Web 提示词/历史完整生命周期、核心生成闭环、共享历史主从工作区和桌面/手机 Playwright 门禁，Desktop/Web 也已共同消费提示词、历史详情、页面标题工具条、WorkbenchPageFrame、WorkbenchTimelineViewport、共享 Composer、Turn/用户消息/助手头/结果网格/Generation Result 核心、共享助手头像和账户摘要；Web 的 `useWorkbenchDraftSyncController` 已统一串行 debounce、版本冲突、会话切换失效和提交前 flush，带请求序列保护的 `useWorkbenchSessionController` 已统一 Web 最近会话列表的替换、更新、移除、加载、错误和并行打开状态，`useWorkbenchGenerationSyncController` 已统一 Web 跨会话活跃任务的快照订阅、SSE 游标、断线退避和终态收敛，Desktop active/archived/open/rename/archive/restore/delete 已复用同一 session reducer 规则并加入 IPC 请求序列保护。Web 已增加同源视觉场景截图与响应式几何门禁，`npm run test:visual:shared` 已对十一项共享区域执行 Desktop/Web 中心裁剪像素比较：Workbench `1196x848` 的平均像素误差 `0.0124`、变化像素比例 `2.77%`；Workbench result `589x502` 为 `0.0187`、`3.15%`；提示词库列表 `960x353` 为 `0.0149`、`3.89%`；提示词详情 `880x545` 为 `0.0045`、`1.45%`；历史详情 `296x459` 为 `0.0373`、`6.97%`；完整历史工作区共同区域 `960x766` 为 `0.0456`、`7.71%`；账号摘要 `680x156` 为 `0.0105`、`2.29%`；Cloud MCP 连接页 `958x271` 为 `0.0152`、`4.87%`；失败态 `589x498` 为 `0.00383`、`0.75%`；桌面取消态 `589x498` 为 `0.00308`、`0.53%`；手机取消态 `351x393` 为 `0.00651`、`1.28%`，均低于阈值。桌面视觉 QA `5/5`、Desktop 账号 E2E `4/4`、Product UI `35/35`、Desktop 设置 E2E `45/45` 和 Web E2E `11/11` 已通过；Web 与 Desktop 账户/Cloud MCP 连接页面均由共享 `@musefold/product-ui` 承载，Desktop 通过集中式 `cloud-connections-store` 和 Cloud 会话 IPC 接入列表、策略更新和撤销。Generation Worker 已完成 PostgreSQL heartbeat、MinIO bucket 创建/写入/读回/清理实连，并补齐过期 lease 的安全恢复。剩余真实 new-api staging 生图、两个远程 MCP 客户端、跨设备后台快照、真实 Cloud 浏览器验收和上线加固仍未验收。

本轮 Desktop 工作台 E2E `29/29` 通过，普通生图结果的头像、状态文案、结果比例和存提示词 footer 已完成双端统一；Skill、豆包、本地文件和批量图片操作仍由 Desktop capability slot 保留。

当前 UI 验收修订（2026-08-19）：共享产品 UI 当前为 `37/37`，共享视觉区域为 `13/13`；新增提示词引用卡片和全文悬停预览已通过 Desktop/Web 视觉比较。文档中旧的 `35/35` 与十一项视觉门禁数字仅代表此前阶段记录。

本轮视觉门禁增量：`npm run test:visual:shared` 已扩展为十六项共享区域，并新增完整侧栏、桌面/手机 Composer、成功/失败/取消结果态、`390x844` 手机取消态、提示词引用卡片和全文悬停预览；Web E2E 当前 `13/13`，Desktop 视觉 QA `5/5`，新增区域均低于门禁。

当前验证基线（2026-08-19）：本地 `check:v1.1`、数据库集成 smoke、Web E2E、共享视觉门禁和 `release:preflight` 均通过；共享 Product UI 为 `40/40`，共享视觉区域为 `16/16`，Web E2E 为 `13/13`。本地 Web API `60162` 已以真实 new-api 账号完成登录、真实生图、MCP SDK 双客户端和兑换码增额核验（`500000` 点）。本地通过不替代远程 staging、双设备、远程 MCP 客户端及生产签名/公证验收。
Cloud MCP 全量验收补充：14 个工具、两个独立 Streamable HTTP 客户端、PKCE/同意/refresh/revoke、审批态幂等任务、等待/取消、历史签名资源和撤销后 401 已在本地真实账号链路通过；`pending_approval -> cancelled` 已补入领域状态机。远程 MCP URL 和生产 OAuth 配置仍待发布环境验证。

本轮新增 `WorkbenchComposerFrame` 与 `ProductSidebarLayout` 两个完整共享壳层，Desktop/Web 不再分别拥有 Composer 内部布局或侧栏 rail。侧栏统一宽度持久化、指针/键盘 resize、双击恢复、折叠和窄屏抽屉；独立视觉契约为 `243x900`，平均像素误差 `0.01503`、变化像素 `2.48%`，两端主工作区均为 `1196x848`。共享视觉门禁现覆盖十六项区域，Web E2E `13/13`、Desktop 工作台 E2E `29/29`、Product UI `40/40`；边界检查禁止宿主绕开完整 Composer/侧栏共享壳层。

本轮新增共享生成快照适配基础：`@musefold/product-ui` 统一 Desktop/Web 的时间线排序、同 id upsert、最新快照选择、活跃任务筛选、Cloud/Desktop 状态到结果表面状态的映射，并以 `37/37` 共享组件测试覆盖；同时统一工作台结果态头像、状态文案、比例和存提示词 footer，并新增结果态及提示词引用态视觉差异门禁。完整跨设备后台生成恢复仍需真实 Cloud 浏览器和双设备 staging 验收。

最新状态修订（2026-08-19）：共享产品 UI 为 `38/38`；新增 `GenerationRetryAction` 统一 Desktop/Web 失败与取消结果的图标、20px 几何、忙碌旋转、禁用和无障碍语义。共享视觉门禁仍为 `13/13`，历史详情运行时宽度已统一为 `285x459`；Web E2E `11/11`、Desktop 工作台 E2E `29/29`、`check:v1.1` 和 Electron/Web 构建均通过。旧的 `35/35`、`37/37`、十一项视觉指标仅作为历史记录保留。

## 0. 交付原则

1. 先冻结 contracts 和数据库不变量，再开发 UI 联调，避免 fixture 形状演变成生产契约。
2. 每个里程碑交付可运行的纵向闭环，不长期保留只有 route 没有隔离测试的半成品。
3. PostgreSQL 是业务事实源，也是 P0 的 session、限流和持久队列；不引入无法用当前负载证明收益的第二套数据基础设施。
4. 同步与提示词 CRUD 共用一个 application service，不能形成两套写入规则。
5. 共享包变化持续运行桌面回归，Web 依赖不能渗入 Electron/core。

## 1. 里程碑总览

| 里程碑                | 交付结果                                                                   | 依赖  |
| --------------------- | -------------------------------------------------------------------------- | ----- |
| M0 契约冻结           | P0 DTO、错误码、状态机、OpenAPI 和 capability 完整                         | 无    |
| M1 服务基座           | Node 24/Fastify、PostgreSQL、Kysely、Graphile Worker、迁移、RLS、CI 可运行 | M0    |
| M2 账号 BFF           | new-api 注册/登录/续期/额度/兑换、HttpOnly session                         | M1    |
| M3 云端提示词库       | Prompt/folder/tag CRUD、搜索、版本冲突、回收站                             | M2    |
| M4 云同步             | sync log/push/pull/bootstrap、桌面 outbox、冲突 UI                         | M3    |
| M5 Web 工作台         | 会话和草稿持久化、工作台恢复、历史框架                                     | M2    |
| M6 生图闭环           | Graphile Worker、new-api、生图资产、可恢复 SSE、重试                       | M5    |
| M7 Cloud MCP          | OAuth、远程 MCP、官方 Skill、预算/审批和连接管理                           | M2/M6 |
| M8 共享 UI 与产品联调 | Web 去 fixture、共享产品组件、完整闭环和移动端                             | M3-M7 |
| M9 上线加固           | 备份、恢复、监控、压测、安全、staging/production 发布                      | M8    |

M4 与 M5 可在 M3 数据模型稳定后并行；M6 依赖 M5 的会话/run 契约；M7 的 OAuth 基座可与 M5/M6 并行，spend 工具必须等 M6 完成。

## 2. M0：契约冻结

### 任务

- `V11-CONTRACT-01`：补齐 `PromptDocument` 的 rating、pinOrder、lastUsedAt、source/sourceUrl、deletedAt。
- `V11-CONTRACT-02`：新增 folder/tag、workbench session、generation history DTO。
- `V11-CONTRACT-03`：新增 sync device/bootstrap/pull/push/conflict DTO。
- `V11-CONTRACT-04`：冻结 `ApiErrorEnvelope` 和 P0 错误码。
- `V11-CONTRACT-05`：在 domain 中实现 generation/workbench 状态机和同步 mutation 校验。
- `V11-CONTRACT-06`：生成 OpenAPI 3.1，增加破坏性变更检查。
- `V11-CONTRACT-07`：更新 capability manifest，移除已废弃配方能力，启用 Web workbench/history/promptSync/cloudMcpConnections。

### 完成条件

- contracts/domain 单测覆盖每个 schema 的成功和拒绝样例。
- 云端 DTO 不含 Provider id、本地路径、Key 或 Electron 句柄。
- `npm run check:v1.1` 和桌面 `npm run typecheck` 通过。

## 3. M1：服务基座

### 任务

- `V11-BASE-01`：创建 `apps/web-api` 和 `apps/generation-worker` workspace。
- `V11-BASE-02`：实现 Zod 环境配置、Fastify 组合根、request id、日志脱敏和统一错误处理。
- `V11-BASE-03`：建立 PostgreSQL 16/MinIO 的本地 Compose；生产对象存储使用外部 S3-compatible service。
- `V11-BASE-04`：引入 Kysely + `pg` + `node-pg-migrate`，创建 SQL-first 迁移目录和独立迁移命令。
- `V11-BASE-05`：创建 app/migration/worker/queue 三类数据库权限边界，启用 RLS，并通过受控 wrapper 暴露 Graphile enqueue。
- `V11-BASE-06`：实现 `/health/live`、`/health/ready` 和 worker heartbeat。
- `V11-BASE-07`：建立 Testcontainers integration harness 和 CI service cache。

### 完成条件

- 一条命令启动本地 API、worker、PostgreSQL 和 MinIO。
- 空库可迁移，重复迁移无副作用；错误 schema version 时 API 不 ready。
- owner A/B 的 RLS 骨架测试通过。
- 日志测试确认 Authorization、Cookie、token/password 字段被移除。

## 4. M2：账号 BFF

### 任务

- `V11-AUTH-01`：从 Electron account client 抽取 cloud-safe new-api gateway 契约，不复用 keychain 实现。
- `V11-AUTH-02`：实现注册、登录、refresh、self、quota、redeem 的 Web adapter 和 golden tests。
- `V11-AUTH-03`：实现 PostgreSQL opaque session、Cookie、session rotation、refresh rotation 和过期清理。
- `V11-AUTH-04`：实现 Origin + CSRF nonce、PostgreSQL token bucket 限流和 Caddy 粗限流。
- `V11-AUTH-05`：实现账户级 `musefold-web` 设备令牌供给和加密 credential vault。
- `V11-AUTH-06`：实现退出、设备会话撤销和账号删除前置状态。
- `V11-AUTH-07`：实现 Web 登录/注册/额度/兑换 UI 对接。

### 完成条件

- 浏览器 storage 中没有 JWT、refresh 或 `sk-`。
- 两个 API 实例连接同一 PostgreSQL 时会话可继续使用。
- refresh 并发为 single-flight/原子轮换，旧值不会覆盖新值。
- 真实 staging new-api 注册、登录、额度和兑换 smoke test 通过。

## 5. M3：云端提示词库

### 任务

- `V11-PROMPT-01`：创建 prompt/folder/tag/usage 表、索引、RLS 和迁移测试。
- `V11-PROMPT-02`：实现唯一 Prompt application service，供 REST 和 sync 共用。
- `V11-PROMPT-03`：实现 CRUD、软删除/恢复、乐观版本和统一 404。
- `V11-PROMPT-04`：实现 folder/tag 管理和关联完整性。
- `V11-PROMPT-05`：实现 `pg_trgm` 搜索、筛选和稳定游标分页。
- `V11-PROMPT-06`：实现幂等 usage events 和服务端 usageCount。
- `V11-PROMPT-07`：创建 `packages/cloud-client`，从 contracts 生成 typed 方法。
- `V11-PROMPT-08`：Web 提示词库去 fixture，完成列表、编辑、回收站和冲突提示。

### 完成条件

- 两账户隔离覆盖每个 prompt/folder/tag endpoint。
- 10,000 条个人提示词数据下默认列表和常见搜索达到约定性能门槛。
- 并发 PATCH 必有一方 409，任意一方内容都不被静默丢弃。
- Web 刷新、换设备登录后看到同一云端库。

### 当前进度（2026-08-18）

- Web Cloud gateway 已实现 prompt get/update/delete/restore，页面已具备详情、编辑、软删除、回收站恢复和版本冲突后的“载入云端/保留本地修改”处理。
- fixture gateway 与 typed Cloud client 使用同一 DTO；fixture 单测覆盖版本递增、过期版本拒绝、软删除过滤和恢复。
- Playwright 已覆盖编辑、删除和恢复的可见闭环。真实 Cloud API 浏览器验收、并发触发冲突 UI 的自动化用例和 10,000 条数据性能门槛仍待 staging 完成。

## 6. M4：提示词云同步

### 服务端任务

- `V11-SYNC-01`：创建 sync_devices/sync_changes/sync_mutations 表与索引/RLS。
- `V11-SYNC-02`：让 Prompt application service 在同一事务写实体和 change。
- `V11-SYNC-03`：实现 device、bootstrap、pull、push、status endpoints。
- `V11-SYNC-04`：实现 mutation 去重、批量逐项结果、cursor 过期和日志压缩边界。
- `V11-SYNC-05`：实现同步限流、body 限制和 payload 日志脱敏。
- `V11-SYNC-13`：实现独立 usage event push、设备校验和事件幂等。

### 桌面任务

- `V11-SYNC-06`：主库迁移，新增 sync account/entity state/outbox/conflicts。
- `V11-SYNC-07`：桌面 Prompt/Folder/Tag repository 写入事务型 outbox。
- `V11-SYNC-08`：实现 cloud-origin apply，避免 pull 产生回声 mutation。
- `V11-SYNC-09`：实现设备注册、首次合并、pull/push 循环、网络退避和暂停。
- `V11-SYNC-10`：设置页加入同步开关、状态、立即同步、错误和设备信息。
- `V11-SYNC-11`：实现冲突列表以及保留云端/本地/两份。
- `V11-SYNC-12`：导入导出时清理或重建 owner/device/cursor 规则。
- `V11-SYNC-13` 已完成本地 SQLite outbox、Cloud Client、`/sync/usage` 和 PostgreSQL/RLS 集成测试；事件不参与 prompt 内容版本冲突。

### 完成条件

- [V11-PROMPT-CLOUD-SYNC.md](./V11-PROMPT-CLOUD-SYNC.md) 第 16 节全部验收。
- 断网、请求重放、API 重启、桌面崩溃均不丢 mutation。
- HTTP 请求体检查证明本地图片路径和 Key 不离开桌面。
- 多账号切换不混用 cursor、outbox 或 cloud version。

### 当前进度（2026-08-18）

- `V11-SYNC-01` 至 `V11-SYNC-12` 的 Prompt/Folder/Tag 主路径已经实现，并通过 SQLite migration/core、Electron IPC、Web API PostgreSQL/RLS 集成测试。
- 桌面账号管理 JWT 只在主进程用于一次设备会话交换；同步阶段使用主进程内存中的 opaque bearer，渲染进程无法读取凭据。
- Folder 删除会把直接子文件夹移到根层级、直接提示词移到未分类；Tag 删除会解绑关系，所有受影响聚合均产生同步 change。
- 尚未满足 M4 完成条件：两台真实 Desktop + Web 跨网络验收、设备撤销后的完整会话重建、以及游标过期长周期测试。

## 7. M5：Web 工作台和历史骨架

### 任务

- `V11-WB-01`：创建 workbench_sessions/generation_runs/assets/events 表、索引和 RLS。
- `V11-WB-02`：实现 session create/list/get/update/archive/delete/restore。
- `V11-WB-03`：实现草稿 debounce 保存和 `expectedVersion` 冲突。
- `V11-WB-04`：实现会话 run 列表和全局 history 游标分页。
- `V11-WB-05`：实现 retry/refinement 谱系和 prompt snapshot。
- `V11-WB-06`：Web 工作台从 URL/session 恢复草稿和历史状态。
- `V11-WB-07`：从云提示词进入工作台，保存生成提示词回云库。

### 完成条件

- 空 session 不产生大量垃圾记录；首次有效输入后可靠落库。
- 两设备并发编辑草稿返回明确冲突。
- 删除 session 不级联误删尚在恢复期的资产。
- 工作台刷新后恢复同一 session、草稿和 run 列表。

### 当前进度（2026-08-18）

- Web API 已实现 session create/list/get/update/archive/delete/restore，cloud-client/Web gateway 已补齐单会话读取；Web 启动时按 URL `session` 参数或最近会话恢复草稿、比例、质量和该会话完整 run 快照，并通过共享 `useWorkbenchGenerationSyncController` 订阅所有已载入会话中的活跃任务，按任务维护可恢复 SSE 游标，事件后读取完整任务快照确认状态。
- “新设计”现在清空当前会话上下文并延迟到首次有效提交才创建 session；从提示词或历史进入工作台会恢复对应 prompt/run/session，fixture 已按 `sessionId` 隔离历史并增加契约测试。
- Web 已实现 700ms debounce 草稿保存，所有更新通过单通道队列串行提交，并在会话切换时使旧请求失效；立即生图会等待同一队列，避免慢网络下用旧 `expectedVersion` 覆盖新输入。
- 两设备 `expectedVersion` 冲突会保留本机输入并展示“使用云端/保留本机”选择，API 与 fixture 都返回最新服务端 session 快照；纯函数单测、fixture 冲突契约和桌面宽度浏览器自动保存断言已通过。
- 会话列表/归档产品界面、真实 Cloud API 浏览器刷新恢复和双设备并发冲突验收仍待 staging 完成，因此 M5 尚未完成。

## 8. M6：异步生图闭环

### 任务

- `V11-GEN-01`：实现 generation create/idempotency/cancel/retry application service。
- `V11-GEN-02`：集成 Graphile Worker，并保证 generation run、event、job 在同一 PostgreSQL 事务提交。
- `V11-GEN-03`：实现受控 enqueue SQL wrapper，job key 固定为 run id，并验证并发去重。
- `V11-GEN-04`：实现 worker lease、状态机、恢复扫描和安全重试规则。
- `V11-GEN-05`：实现 new-api image gateway 和额度/模型/审核错误映射。
- `V11-GEN-06`：实现 S3 adapter、checksum、私有对象和签名 URL。
- `V11-GEN-07`：实现 generation events + PostgreSQL `LISTEN/NOTIFY` 唤醒的可恢复 SSE。
- `V11-GEN-08`：实现历史删除/恢复、30 天清理和孤儿对象清理。
- `V11-GEN-09`：Web 对接提交、进度、取消、失败、结果、重试、下载。

### 完成条件

- 同一个 idempotency key 并发提交只产生一个 run 和一次上游调用。
- API/worker 任一进程在关键阶段重启，任务得到确定终态。
- 上游结果未知时不自动重复调用和扣费。
- owner B 不能通过 asset id 获取 owner A 的签名 URL。

### 当前进度（2026-08-18）

- generation contract 已返回 `deletedAt`，Cloud client/Web gateway 已暴露 retry/delete/restore；PostgreSQL 集成测试验证默认历史排除软删除记录、`includeDeleted` 返回删除标记且恢复后重新可见。
- Web 历史详情已接入重试、取消、下载、存为提示词、软删除和回收站恢复，fixture 生命周期单测与桌面/手机 Playwright 闭环已通过。
- Web API 已提供生成 SSE，`generation_events` 通过 PostgreSQL `NOTIFY` 在事务提交后唤醒独立监听连接；Cloud client 按 `after` 游标和 `Last-Event-ID` 消费事件，Web 在事件到达后始终读取 `GET /generations/:id` 的完整快照，并在 SSE 断开时指数退避重连，fixture 与 API gateway 共用同一能力。Web 资产使用稳定同源 `/assets/:id/url` 跳转端点按次签名，Cloud MCP 的 `get_generation` 刷新短期签名 `resource_link`；`test:staging:v1.1` 已提供显式真实 API 生图、幂等重复提交、终态轮询、SSE durable replay 和签名资产读取。真实 staging、生图浏览器断线恢复、长时会话资产访问和 30 天清理任务仍未完成；worker 入口已实现过期 lease 的安全分类，下一步仍需在 staging 注入 worker 崩溃演练和恢复指标。

## 9. M7：Cloud MCP 与 Skills

### 任务

- `V11-MCP-01`：从当前 `packages/mcp` 抽取 `packages/mcp-tools` 和 `MusefoldToolBackend`。
- `V11-MCP-02`：LocalAutomationBackend 接回现有 stdio MCP，完成零行为变化回归。
- `V11-MCP-03`：在 `apps/web-api/src/modules/mcp` 挂载 Streamable HTTP 和 CloudBackend，直接复用 application services。
- `V11-MCP-04`：通过 `oidc-provider` 实现 OAuth metadata、Authorization Code + PKCE、token rotation、revoke、scope，以及预登记/CIMD 客户端发现；DCR 仅兼容旧客户端。
- `V11-MCP-05`：实现 connected apps、grant 暂停/撤销和 Web 管理 API。
- `V11-MCP-06`：实现 ask-each-time、自动预算、spend reservation 和 approval 状态机。
- `V11-MCP-07`：实现 Cloud MCP 状态、账号、模型、估价、提示词、生图、等待、取消和历史工具。
- `V11-MCP-08`：实现官方 Skill registry、版本/hash、list/get tools 和发布流程。
- `V11-MCP-09`：更新公开 Musefold SKILL.md，自动选择 Local/Cloud MCP 且不包含 token。
- `V11-MCP-10`：实现 `musefold://assets/{id}` ResourceLink 和签名 URL 刷新。
- `V11-MCP-11`：用至少两个远程 MCP 客户端完成 OAuth/生图兼容性测试。

### 完成条件

- 用户不安装 Desktop 也能用同一账号授权 AI 生图。
- 默认审批前不调用上游，自动预算并发不超额。
- 同一 idempotency key 只产生一个 run，断线后可继续等待。
- Cloud MCP 生图进入同一 Web 历史并保留 Skill/客户端来源。
- 本地 MCP/CLI/Automation 全量回归无变化。

### 当前进度（2026-08-18）

- `V11-MCP-03` 至 `V11-MCP-08`、`V11-MCP-10` 已有本地代码闭环；OAuth artifact 只保存 hash，MCP bearer 与 Web Cookie 认证边界分离。
- 官方 MCP SDK 已通过 initialize、tools/list、状态、生图工具调用和签名 HTTPS `resource_link` 测试；任务可跨 transport 会话按数据库状态继续查询。
- PostgreSQL token bucket 已接入账号敏感入口、同步和 MCP IP/grant，`TRUST_PROXY` 只接受明确代理地址；自动预算用 grant 行锁串行化，10 个并发请求不会超出日预算。
- spend reservation 已覆盖 owner/grant 复合外键、强制 RLS、取消/失败释放和成功结算。当前上游未返回实际点数时按预估值结算，上游结果未知时保留预留等待对账。
- connected apps Web UI 已接入真实策略 API，可编辑单次/每日预算、显示今日已结算/预留、暂停/恢复和撤销；切换自动模式、提高预算及恢复连接由后端强制 new-api 密码重认证。`1440x900` 与 `390x844` 页面检查无水平溢出。
- `V11-MCP-09` 的仓库 canonical Skill 已更新为 `v1.1.0-dev`，并通过 Electron Skill validator；实际官网部署仍需发布步骤完成后再验收。
- Web approval 页面已接入共享生成快照控制器，支持登录后恢复、审批后 SSE/轮询状态更新和终态签名图片展示；OAuth `returnTo` 仅允许同源 interaction 路径。
- 尚未满足 M7 完成条件：两个独立远程 MCP 客户端、真实 new-api staging 生图，以及连接详情最近活动/approval 的完整产品联调。
- `test:staging:mcp-sdk` 已能以两个独立官方 SDK transport 会话验证远程 MCP 的 initialize、tools/list、状态、Skills、历史，以及显式打开后的幂等生图/等待；尚未满足 M7 完成条件：两个真实远程 MCP 产品客户端、真实 new-api staging 生图，以及连接详情最近活动/approval 的完整产品联调。

## 10. M8：共享 UI 与产品联调

### 任务

- `V11-UX-01`：移除生产构建 fixture gateway，fixture 只在显式开发模式可见。
- `V11-UX-02`：打通提示词搜索 -> 带入工作台 -> 生图 -> 历史 -> 存回提示词。
- `V11-UX-03`：打通 session URL、浏览器刷新、SSE 重连和轮询兜底。
- `V11-UX-04`：账号失效、额度不足、冲突、限流、服务维护的完整 UI 状态。
- `V11-UX-05`：390x844 手机主路径、触控、软键盘、下载和系统分享。
- `V11-UX-06`：抽取 `@musefold/ui` token/primitives，Desktop 先接入且截图不变。
- `V11-UX-07`：抽取 `@musefold/product-ui` 的 Library/History/Workbench 页面组件。
- `V11-UX-08`：实现 Desktop IPC adapters 和 Web Cloud adapters，删除两端重复产品 UI。
- `V11-UX-09`：实现 connected apps、预算和 approval Web 页面。
- `V11-UX-10`：建立相同 fixture 下 Desktop/Web 的共享视觉差异门禁，覆盖内容区域与历史主从工作区。

### 完成条件

- Web 首屏不显示任何桌面专属入口。
- 工作台、提示词库和历史在 Desktop/Web 中来自同一 product-ui 源码。
- 页面刷新、前后台切换和慢网络下没有重复任务或内容丢失。
- Playwright 覆盖桌面宽度和手机宽度，无水平溢出和控件遮挡。
- 所有空态、错误态和恢复态都有可执行下一步。

### 当前进度（2026-08-18）

- `V11-UX-01` 已完成：`npm run dev:web` 默认连接真实 API，只有 `npm run dev:web:fixtures` 显式启用 fixture；生产构建检查会扫描全部 JavaScript 产物并阻止 fixture 账号、资源端点或 gateway 进入 bundle。
- `V11-UX-02` 的“提示词搜索 -> 带入工作台 -> 生图 -> 存回提示词 -> 历史”fixture 主路径已由 Playwright 覆盖；生成请求到云提示词 DTO 的映射位于共享 domain，保存动作由 Desktop/Web 共用 product-ui 组件。真实 API/worker 浏览器路径仍待 staging 完成。
- `V11-UX-05` 的 `390x844` 生成与历史主路径、移动导航及水平溢出检查已通过；软键盘、系统分享和真实设备下载仍待验收。
- `V11-UX-07` 已共享提示词列表/搜索/分区/详情 header/正文、提示词编辑器/回收站、生成历史列表/详情正文/回收站/公共动作、历史检视导航 reducer/hook、`GenerationHistoryWorkspace` 主从布局、页面标题工具条、`WorkbenchPageFrame`、`WorkbenchTimelineViewport`、`WorkbenchTimelineContent`、`useWorkbenchTimelineController`、composer toolbar、`WorkbenchComposerSurface`、`WorkbenchComposerPrompt`、`WorkbenchEmptyState`、`WorkbenchSessionList`、`useWorkbenchSessionController`、`useWorkbenchGenerationSyncController`、`WorkbenchContextMenu`、`WorkbenchRatioPicker`、`WorkbenchGenerationSettingsPopover`、`WorkbenchTurnFrame`、`WorkbenchUserMessage`、`WorkbenchAssistantFrame`、`WorkbenchAssistantHeader`、`WorkbenchResultGrid`、`GenerationResultSurface`、共享生成快照适配、`AccountSummaryPanel`、`AccountScreen` 和 `ConnectedAppsScreen`；Desktop/Web 已共同消费提示词、历史详情、账户摘要和工作台页面壳、时间线滚动行为、空态、会话列表、Composer 控件、用户消息复制/编辑、回合/生成结果的媒体、状态、结果网格与助手结果列核心，Desktop active/archived/open/rename/archive/restore/delete adapter 已复用 session reducer 规则。Web 页面编排器已拆分为 `apps/web/src/layout/WebNavigation.tsx` 和 `apps/web/src/views/`，`App.tsx` 仅保留 host 状态及 gateway adapter 组合；Web/ Desktop 账户与连接页面均已从共享组件渲染，Desktop 通过 `cloudConnections` IPC 复用 Cloud 会话；本地 Cloud client/Web gateway 已接入生成 SSE + 快照确认 + 断线退避，Web 工作台现在会恢复当前会话的完整多 turn 生成快照，并追踪已载入其他会话的活跃任务；真实 Cloud 浏览器验收、后台生成快照跨端完整恢复和真实 staging 仍待完成。
- `V11-UX-09` 的连接策略、预算、暂停/恢复、撤销和敏感操作重认证已完成；连接活动和审批列表仍待产品联调。
- `npm run test:e2e:web` 当前在 `1280x720` 与 `390x844` 十一条用例中检查主流程、共享空态建议回填、提示词编辑器的折叠/放弃确认/快捷保存、比例/生成设置/上下文弹层、跨会话后台生成追踪、浏览器错误、水平溢出、账户登录恢复、Cloud MCP 预算二次认证、暂停/恢复、撤销确认以及结果动作与浮动 composer 不相交；`visual-contract.spec.ts` 输出工作台、结果态工作台、提示词列表/详情、提示词引用卡片/全文预览、历史主从工作区、历史详情、账号摘要、Cloud MCP 连接页和手机工作台/提示词库截图。`npm run test:visual:shared` 还会运行 Web canonical fixture 和 Desktop visual QA，并对十三项共享区域做中心裁剪像素比较。桌面视觉 QA 本轮通过 `5/5`，Desktop 账号 E2E `4/4` 验证注册、双栈接入切换、固定官方模型和兑换；Desktop 设置 E2E `45/45` 还覆盖共享 Cloud MCP 连接页面的未登录状态，以及既有账号、AI 连接、数据导入导出和密度布局。真实 Cloud API、跨设备后台生成快照和真实 staging 场景仍待验收。

## 11. M9：上线加固

### 任务

- `V11-REL-01`：staging Compose/镜像、迁移 job、回滚脚本。
- `V11-REL-02`：Caddy 同源路由、Cookie、CSP/HSTS、可信代理配置。
- `V11-REL-03`：PostgreSQL PITR、Graphile job 恢复、对象存储保护和恢复演练。
- `V11-REL-04`：指标、dashboard、错误告警、Graphile queue/worker/SSE 告警。
- `V11-REL-05`：安全扫描、依赖审计、日志脱敏测试、RLS 全覆盖检查。
- `V11-REL-06`：容量测试、队列背压、单账号和 IP 限流验证。
- `V11-REL-07`：隐私说明、数据保留、账户删除和故障状态页。
- `V11-REL-08`：production canary、真实账号 smoke、回滚演练和发布记录。

### 完成条件

- 空库和上一 staging 版本都能升级；回滚步骤经过实际演练。
- 恢复演练能还原数据库和对象，RPO/RTO 有测量结果。
- 停止 worker 时 API 正常接受受控数量任务并显示排队；超过阈值主动背压。
- canary 期间生成成功率、同步冲突率和 5xx 在阈值内再全量发布。

## 12. 持续门禁

每个 PR 至少运行：

```bash
npm run typecheck
npm test
npm run build
npm run check:v1.1
```

后端开始落地后增加：

```bash
npm run test:web-api
npm run test:worker
npm run test:cloud-mcp
npm run test:integration:v1.1
npm run test:e2e:web
npm run openapi:check
```

合并阻断条件：

- contracts 破坏性变更没有版本说明。
- 迁移无升级测试或无回滚说明。
- 新 owner 表缺少 RLS policy 和隔离测试。
- 新写接口缺少幂等/并发策略。
- 日志或错误可能包含密码、token、兑换码、提示词正文。
- Web 共享改动导致桌面 typecheck/test/build 回归。

## 13. 上线验收清单

- [ ] new-api 注册、登录、refresh、额度、兑换真实联调通过。
- [ ] Web 提示词 CRUD、搜索、回收站和版本冲突通过。
- [ ] 两台桌面 + Web 的首次合并和双向增量同步通过。
- [ ] 三种冲突解决路径通过，正文零丢失。
- [ ] 工作台会话、草稿、任务和结果可跨刷新恢复。
- [ ] 生图幂等、取消、失败、重试和 SSE 重连通过。
- [ ] 历史下载、删除/恢复、保存为提示词通过。
- [ ] Cloud MCP OAuth、scope、审批、自动预算、撤销和 Skill 生图通过。
- [x] Desktop/Web 工作台、提示词库、历史、账号摘要和 Cloud MCP 连接页来自共享组件并通过视觉差异门禁。
- [ ] RLS、对象 URL、CSRF、限流和日志脱敏通过。
- [ ] PostgreSQL/对象备份恢复与发布回滚演练通过。
- [ ] Desktop/Web/API/worker/Cloud MCP 模块全部门禁通过。
