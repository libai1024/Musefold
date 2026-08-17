# Musefold v1.1 技术选型与架构决策

> **状态**：v1.1 P0 冻结基线
>
> **日期**：2026-08-17
>
> **目的**：基于 Musefold 的实际产品范围，在维护成本、扩展性、性能、安全和部署复杂度之间作出可解释选择

## 0. 最终推荐

v1.1 P0 采用模块化单体，而不是微服务：

```text
Caddy
  ├─ Web static
  └─ Fastify Web API
       ├─ REST / OpenAPI
       ├─ Web session / new-api account BFF
       ├─ OAuth authorization server
       └─ Cloud MCP / Streamable HTTP

PostgreSQL 16
  ├─ Musefold business data + RLS
  ├─ Web sessions / OAuth grants
  ├─ prompt sync change log
  └─ Graphile Worker durable queue

Generation Worker
  └─ new-api image gateway + S3-compatible object storage
```

技术栈冻结为：

| 层 | P0 选型 |
|---|---|
| Runtime | Node.js 24 LTS + TypeScript |
| HTTP | Fastify 5 |
| Validation/API | Zod 4 + `fastify-type-provider-zod` + OpenAPI 3.1 |
| Database | PostgreSQL 16，独立 database/schema/role |
| Query | Kysely + `pg` |
| Migration | SQL-first + `node-pg-migrate` |
| Background jobs | Graphile Worker |
| Session | PostgreSQL opaque session，Cookie 只保存随机 id |
| OAuth | `oidc-provider`，只启用 MCP 所需 OAuth 能力 |
| MCP | 当前 MCP TypeScript SDK，Streamable HTTP 作为 Fastify 模块 |
| Object storage | 外部 S3-compatible service + AWS SDK v3 |
| Web data state | TanStack Query；表单/临时交互使用局部状态或 Zustand |
| Desktop state | 保留现有 Zustand/IPC，不因 Web 强制重写 |
| Shared UI | React 18 + Tailwind 4 + `@musefold/ui/product-ui` |
| Test | Vitest + Testcontainers + Playwright |

P0 不使用 Redis、BullMQ、Kafka、Elasticsearch、Prisma、NestJS 或 Kubernetes。

## 1. 实际需求约束

这次选型以项目当前事实为准：

- 现有代码是 TypeScript npm workspace，Electron/React/Vite 已稳定运行。
- 开发和维护主体是一个小团队，不适合同时维护多种语言和大量基础设施。
- Web 首版是个人账户，不是团队协作平台，不需要组织/ACL/实时协同编辑。
- 核心请求是上游 I/O 型生图，单次耗时远高于本地 API 和 SQL；队列吞吐不是首要瓶颈。
- 必须保存提示词、同步日志、工作台会话、生成历史、OAuth grant、预算和审计。
- 必须支持断线恢复、重复请求幂等、worker 崩溃恢复和账号 owner 隔离。
- Cloud MCP 和 Web 使用同一账号、同一任务、同一历史，不能形成两套业务服务。
- UI 要真正复用桌面代码，不能复制一份 Web 实现。
- 当前服务器已经运行 new-api/PostgreSQL/Redis，但 Musefold Cloud 应与 new-api 表和缓存保持逻辑隔离。

P0 设计容量目标，不是业务上限：

- 单节点 API 100 RPS 级别。
- 1 至 20 个并发生图 worker，根据上游限额调整。
- 单账户 50,000 条提示词，整体百万级提示词记录。
- 数百个排队/运行任务，而不是每秒数千个短任务。

在这个范围内，增加 Redis 消息队列和多个公网服务不会带来用户可感知性能收益，反而增加部署、备份、故障恢复和一致性成本。

## 2. 决策指标

| 指标 | 权重 | 判断方式 |
|---|---:|---|
| 可维护性 | 30% | 服务/数据源数量、调试路径、迁移和本地开发复杂度 |
| 安全与一致性 | 20% | owner/RLS、凭据边界、任务原子性、OAuth 标准符合度 |
| 扩展性 | 20% | 能否替换 Provider、拆 worker/MCP、增加功能而不重写领域层 |
| 性能 | 15% | API 延迟、队列恢复、查询和搜索能力；不追求无意义的极限 QPS |
| 生态与人才 | 10% | 官方支持、TypeScript 类型、测试工具和长期维护情况 |
| 资源成本 | 5% | 单服务器内存、托管服务数量和运维成本 |

### 2.1 架构方案比较

评分为 1 至 5，表示对当前需求的适合度，不是技术本身的绝对优劣。

| 方案 | 维护 | 安全/一致性 | 扩展 | 性能 | 生态 | 成本 | 加权结论 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fastify 模块化单体 + PostgreSQL queue | 5 | 5 | 4 | 4 | 4 | 5 | **4.55** |
| Fastify API + Redis/BullMQ + 独立 MCP service | 3 | 4 | 5 | 5 | 5 | 3 | **4.05** |
| NestJS 微服务 + Redis/Kafka | 2 | 4 | 5 | 5 | 5 | 1 | **3.55** |
| Serverless API + 托管队列/数据库 | 3 | 3 | 4 | 3 | 4 | 3 | **3.35** |

第二种方案并非错误，但它解决的是更高队列吞吐和独立扩缩容问题。P0 尚未出现这些问题，不应提前支付复杂度成本。

## 3. Runtime：Node.js 24 LTS

选择 Node 24，不选择 Node 22 或当前非 LTS Node 26：

- 2026-08-17 时 Node 24 仍是 LTS，官方支持至 2028-04-30。
- Node 22 将于 2027-04-30 结束支持，新服务刚上线就进入较短升级窗口。
- Fastify 5 官方支持 Node 24；Kysely 当前版本要求 Node >= 22。
- Node 26 要到 2026-10-28 才进入 LTS，不用于当前生产基线。

约束：

- 后端镜像锁定 `node:24.x` 的明确 patch/digest。
- Electron 内置 Node 版本不需要与服务端一致；共享包不能依赖 Node 24-only API。
- CI 同时运行 Node 24 后端门禁和 Electron/Desktop 门禁。

## 4. HTTP：Fastify 5

### 选择原因

- 与现有 TypeScript/Node workspace 一致。
- 插件 encapsulation 适合模块化单体，可隔离 account/prompts/sync/generation/oauth/mcp。
- 内建 Pino 日志，schema 驱动请求处理，SSE/streaming 和原始 Node request 可用于 MCP transport。
- 性能远高于本项目实际需要，API 不会成为生图主瓶颈。
- Fastify 5 官方支持 Node 20/22/24/26，目前最新 5.x 仍在 LTS 计划内。

### 不选择 NestJS

NestJS 的 DI/module 适合大团队和大量服务，但会增加 decorator、adapter、测试容器和样板代码。本项目已有明确的 TypeScript ports，不需要框架再提供一套领域容器。

### 不选择 Hono

Hono 很轻，适合 edge runtime，但当前服务需要 Node PostgreSQL pool、OAuth provider、MCP SDK、SSE 和后台 worker。Fastify 的 Node 服务生态更符合实际部署。

## 5. Contracts：Zod 4 + OpenAPI

- 保留现有 `@musefold/contracts` 和 Zod 4，避免更换校验体系。
- Fastify 使用 `fastify-type-provider-zod`，route 输入/输出与 Zod schema 同源。
- OpenAPI 从 route/schema 生成，并用 `openapi-fetch` 生成/约束 Cloud client。
- Desktop IPC 类型可以映射到 contracts，但不能强迫本地路径等 desktop-only 字段进入云 DTO。
- OpenAPI 是 REST 客户端契约；MCP tool schema 从同一 Zod 领域输入派生，不再手写另一份字段规则。

## 6. Database：PostgreSQL 16

### 为什么保持 16

- 现有服务器已使用 PostgreSQL 16，统一主版本降低备份、监控和升级成本。
- PostgreSQL 16 官方支持到 2028-11-09，覆盖 v1.1 生命周期。
- RLS、`pg_trgm`、JSONB、`LISTEN/NOTIFY`、`SKIP LOCKED` 和事务能力满足当前全部需求。
- PostgreSQL 18 虽是当前新版本，但没有 P0 必需特性值得为此增加生产升级差异。

### 隔离方式

- 可以使用同一 PostgreSQL cluster，但 Musefold Cloud 使用独立 database、owner、migration role、API role 和 worker role。
- 不直接 join new-api 表；`owner_id` 只是 new-api user id 的投影。
- new-api 数据库故障或升级不能自动运行 Musefold migration。
- `app` schema 的 owner 业务表启用 FORCE RLS；API/worker 业务角色没有 BYPASSRLS。
- `auth` schema 保存 Web session、OAuth code/token family 和限流 bucket。因为这些记录在识别 owner 前按哈希或客户端标识查询，不强套 owner RLS，而是只向 session/OAuth adapter 暴露 `SECURITY DEFINER` 窄函数；普通 repository 无表权限。
- `graphile_worker` schema 由 queue role 管理；API 只能执行白名单 enqueue wrapper，worker 处理业务数据时仍使用受 RLS 约束的业务角色。

## 7. Query：Kysely，不使用全功能 ORM

### 选择 Kysely

- 它是接近 SQL 的类型安全 query builder，运行时开销小。
- 适合本项目大量 owner 条件、事务、JSONB、复合索引和手写 RLS SQL。
- 与现有桌面端显式 SQL 思维一致，团队不需要学习一套复杂 entity lifecycle。
- 遇到 PostgreSQL 特性时可以使用受参数化保护的 SQL template escape hatch。

### Migration

- migration 以 SQL/`node-pg-migrate` 为事实来源。
- RLS policy、extension、security-definer function、Graphile Worker wrapper 和 trigram index 都必须在 migration 中可见。
- Kysely database types 可用 codegen 从临时迁移后的数据库生成，并在 CI 检查 diff。

### 为什么不选 Drizzle

Drizzle 适合 schema-as-code 和常规 CRUD，但本项目的 RLS、Graphile SQL function、扩展和复杂策略最终仍要写 SQL。形成“部分 Drizzle schema + 部分原生 migration”会出现两个理解入口。Kysely + SQL-first 更直接。

### 为什么不选 Prisma

Prisma 的模型和 CRUD 体验成熟，但本项目重度依赖 request-scoped `SET LOCAL`、RLS、PostgreSQL function、复合 owner 约束和自定义搜索。为这些能力绕过 Prisma 会让抽象收益下降，同时引入生成 client/engine 和额外迁移规则。

## 8. Queue：Graphile Worker，不使用 Redis/BullMQ

### 选择原因

- Graphile Worker 是 PostgreSQL 原生 Node job queue，支持延迟、重试、priority、job key 和独立 worker。
- API 可以在创建 `generation_runs` 的同一数据库事务中调用 `graphile_worker.add_job()`。
- 不需要“先写 PostgreSQL，再发 Redis”的 transactional outbox/dispatcher。
- PostgreSQL 备份同时覆盖任务事实和待执行 job，灾难恢复路径更短。
- 生图任务吞吐由上游模型限制，PostgreSQL queue 的性能余量足够。

### 原子创建

```sql
BEGIN;
INSERT INTO generation_runs (..., status) VALUES (..., 'queued');
SELECT musefold.enqueue_generation(:run_id); -- 受控 SECURITY DEFINER wrapper
COMMIT;
```

`musefold.enqueue_generation()` 固定 task identifier、payload 白名单、`max_attempts` 和 `job_key`。API role 不直接获得 Graphile Worker owner 权限。

### 幂等边界

- 业务幂等仍由 `generation_runs(owner_id, idempotency_key)` 唯一约束保证。
- Graphile `job_key` 只是调度去重，不承担扣费 exactly-once 语义。
- 一旦上游请求已发送但响应未知，不自动重试 Provider；任何队列都无法消除这个外部副作用不确定性。
- worker 先条件更新 run 状态再执行，重复 job 读取终态后直接结束。

### 何时再引入 Redis/BullMQ

只有出现以下任一事实才重新评估：

- 每秒数百至上千个短任务，PostgreSQL queue 产生可测争用。
- 需要与非 PostgreSQL 服务共享同一高吞吐队列。
- queue/storage 必须独立扩缩容，且团队能够承担第二套持久系统。
- PostgreSQL p95 因 job polling/locking 明显恶化，且优化 worker concurrency 后仍不满足 SLO。

## 9. Session、限流与事件：P0 不使用 Redis

### Web session

- Cookie 保存 256-bit 随机 session id；数据库只保存其 hash。
- `web_sessions` 保存 owner、加密 refresh/JWT、CSRF nonce、绝对/空闲过期时间。
- 每个请求一次主键索引查询，符合 P0 负载；登出/撤销立即一致。
- 可增加单进程短 TTL read-through cache，但缓存不影响正确性。

### Rate limit

- Caddy 做粗粒度 IP/连接/body 限制。
- 登录、注册、兑换、OAuth token、sync push 和 generation create 使用 PostgreSQL token bucket/advisory lock。
- 普通只读 API 不为每次请求写 rate-limit 行。

### Progress/SSE

- `generation_events` 是可靠事件源。
- PostgreSQL `NOTIFY` 只负责唤醒 SSE listener；断线后按 event seq 补发。
- 不把 `NOTIFY` 当持久队列，也不把进度正确性依赖在单进程内存。

### Redis 引入触发器

- API 达到数百 RPS，session/rate-limit SQL 在 profiling 中成为显著瓶颈。
- 需要跨区域低延迟 session 或大量短生命周期 cache。
- SSE/通知规模超出 PostgreSQL connection/NOTIFY 的合理范围。

## 10. Cloud MCP：Fastify 模块，不单独部署

### P0 方式

- 在 `apps/web-api` 中挂载 `/api/musefold/mcp` Streamable HTTP route/plugin。
- MCP tool handler 直接调用同一 application service，不经过一次内部 HTTP 跳转。
- `packages/mcp-tools` 继续让本地 stdio MCP 和 Cloud MCP 共用工具 schema/结果映射。
- Transport、auth principal 和 asset 表达由 adapter 区分。

这仍然是“部署在服务器上的 MCP 服务”，只是首版与 Web API 同进程，减少一套镜像、健康检查、服务间身份和网络故障模式。

### 何时拆成独立进程

- MCP 流量、超时或发布频率与 REST API 明显不同。
- MCP 需要独立水平扩容或隔离连接资源。
- 安全审计要求独立网络区和部署权限。

由于 MCP/tool/application 边界已经是包接口，拆分时把 backend 换成内部 API client，不改工具契约。

## 11. OAuth：`oidc-provider`，不手写协议

### 选择原因

- `oidc-provider` 是 OpenID Certified 的 OAuth/OIDC authorization server 实现。
- 当前版本支持 PKCE、revocation、resource indicators、动态注册以及实验性 Client ID Metadata Documents。
- 可以把 new-api 登录后的 `owner_id` 作为交互结果，同时由 Musefold 签发 MCP resource token。
- PostgreSQL adapter 可保存 grant、code、refresh family；不引入另一套用户身份。

### MCP 2026-07-28 规范适配

- MCP resource server 实现 Protected Resource Metadata。
- authorization server 实现 OAuth metadata/OIDC discovery。
- 首选预注册客户端和 Client ID Metadata Documents（CIMD）。
- Dynamic Client Registration 已被最新 MCP 规范标记为 deprecated，只作为兼容 fallback，不作为主流程。
- Authorization Code + PKCE、issuer 校验、resource parameter 和 audience 校验必须开启。
- Scope 不足使用标准 `WWW-Authenticate` challenge 支持 step-up authorization。

### 风险控制

`oidc-provider` 维护者集中度较高，且 CIMD 属实验能力，因此：

- 通过 `AuthorizationService` port 隔离库类型。
- 锁定 minor/patch，升级前运行 OAuth/MCP conformance tests。
- 只启用 authorization code、refresh、revocation、resource indicator、CIMD/必要 DCR，不开放不需要的 grant。
- 若维护风险不可接受，可替换为 Ory Hydra 等独立 authorization server，而不改变业务账户和 MCP tool 层。

## 12. Object Storage：生产使用外部 S3-compatible

- AWS SDK v3 + `ObjectStorage` port，避免绑定具体厂商。
- 生产优先使用托管 S3-compatible 服务；开发测试使用 MinIO/Testcontainers。
- 不建议在与 PostgreSQL 相同的单块服务器磁盘上自建 MinIO：这不会提供真正故障隔离，还增加备份一致性问题。
- bucket 私有，API 按 owner 生成短期签名 URL；数据库保存 object key、checksum 和元数据。
- 如果受网络/数据驻留限制，可替换为兼容 S3 签名的国内对象存储 adapter。

## 13. Frontend 与共享 UI

### 冻结选择

- 保持 React 18，不在 UI 抽取阶段同时升级 React major。
- 保持 Tailwind 4 和现有 token，Web 接入相同构建链。
- `@musefold/product-ui` 共享 Workbench/Library/History 组件源码。
- Web server state 使用 TanStack Query，处理分页、revalidate、mutation 和失效。
- Web composer 草稿、drawer、selection 等临时状态使用局部 React state 或小型 Zustand store。
- Desktop 保留现有 Zustand + IPC adapters，逐步抽掉组件中的直接 `window.api`。

### 为什么不强制两端共用同一状态库

Web 是远程 server state，Desktop 是本地 SQLite/IPC 和事件；强行共用缓存实现会把平台差异带回 UI。真正需要共享的是 view、纯交互 reducer、命令和 gateway contract。两端 adapter/controller 可以不同，但不能复制产品组件和业务规则。

### Routing

- Web 使用 React Router 的稳定 URL/恢复能力。
- Desktop 保留内部 ViewKey。
- 共享 screen 只发 ProductCommand，不直接依赖任一路由库。

## 14. 不采用的方案

| 方案 | P0 不采用原因 |
|---|---|
| Redis + BullMQ | 多一个持久系统，并需要处理 DB/queue 原子性；当前吞吐无收益 |
| Kafka/NATS | 事件规模和团队体量不匹配 |
| NestJS 微服务 | 样板、部署和调试成本高于当前收益 |
| Prisma | 高级 PostgreSQL/RLS/SQL function 场景会大量绕过 ORM |
| Drizzle | 常规 schema DSL 与大量 SQL-first migration 形成双入口 |
| Supabase/Firebase | 与现有 new-api 身份、自己托管和桌面同步边界冲突 |
| Next.js 全栈 | 不需要 SSR/SEO；独立 API 更容易被 Desktop/Cloud MCP 共用 |
| Elasticsearch | 单账户/百万级 `pg_trgm` 足够，运营成本不合理 |
| 独立 Cloud MCP 服务 | P0 没有独立扩缩容需求，增加服务间鉴权和发布面 |
| 自写 OAuth server | 安全风险不可接受，标准细节和兼容性成本过高 |
| Kubernetes | 单服务器/少量进程阶段没有收益 |

## 15. 部署单元

P0 生产只需要：

```text
1. Caddy
2. Web static assets
3. web-api process/container
4. generation-worker process/container
5. PostgreSQL 16（可与 new-api 同 cluster，不同 database/role）
6. external S3-compatible object storage
7. backup/maintenance job
```

new-api 已有 Redis 可以继续服务 new-api，但 Musefold P0 不建立对它的运行依赖。

数据库虽然是一个运行部件，但不是一个无边界的大权限池：`app`、`auth`、`graphile_worker` schema 和 migration/API/auth/worker/queue roles 必须在迁移与集成测试中分别验证。

本地开发：

```text
web-api + worker + PostgreSQL Testcontainer/Compose + MinIO
```

## 16. 性能策略

性能优先级：

1. 减少上游重复调用和重复扣费。
2. 图片不经过 API 进程转发，直接使用签名 URL。
3. Prompt/history 使用稳定 keyset cursor 和 owner 复合索引。
4. API connection pool 设硬上限，SSE 使用独立较小 pool/listener。
5. Worker concurrency 由上游限额和数据库连接预算控制。
6. 搜索先用规范化列 + `pg_trgm`；根据真实慢查询再优化。

首版 SLO 建议：

| 指标 | 目标 |
|---|---|
| 非生图 API p95 | < 200ms（同地域，不含 new-api） |
| Prompt list/search p95 | < 300ms（单账户 50k 条） |
| generation create p95 | < 300ms（只入库/入队） |
| worker 取队延迟 p95 | < 2s |
| owner 越权 | 0 |
| 重复幂等键重复上游调用 | 0 |

## 17. 依赖与升级策略

- `package-lock.json` 是发布输入，生产使用 `npm ci`。
- 基础框架固定 major，自动更新只到 patch/minor并经过 CI；OAuth/MCP/queue 依赖单独审查 release notes。
- Node/Fastify/PostgreSQL 每季度检查支持周期。
- PostgreSQL major 升级不与 Web 功能发布同一窗口。
- Testcontainers 使用与生产相同 PostgreSQL major。
- 对 Kysely、Graphile Worker、oidc-provider 和 MCP SDK 建立最小 adapter，领域层不导入其类型。

## 18. 扩展路线

| 触发事实 | 扩展动作 |
|---|---|
| Worker 饱和 | 横向增加 worker，不改 API |
| PostgreSQL queue 争用 | 调整 poll/concurrency/index；仍不足再迁 BullMQ/专用 queue |
| Session/rate-limit 成为 DB 热点 | 引入 Redis adapter |
| MCP 连接拖累 API | 把 MCP plugin 拆为独立进程，backend 改内部 client |
| Search 达到多租户千万级且中文相关性不足 | 引入专用搜索 adapter |
| 对象存储区域/成本变化 | 更换 S3 adapter/config，不改资产模型 |
| 账号系统更换 | 替换 AccountGateway，不改 owner 领域模型 |

这是刻意的“可演进单体”：先保持一个事务边界和最少运行部件，等监控出现真实瓶颈后再拆。

## 19. 官方依据

- [Node.js release schedule](https://github.com/nodejs/Release)：Node 24 LTS 支持到 2028-04-30。
- [Fastify LTS](https://fastify.dev/docs/latest/Reference/LTS/)：Fastify 5 支持 Node 20/22/24/26。
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)：PostgreSQL 16 支持到 2028-11-09。
- [Kysely](https://github.com/kysely-org/kysely)：类型安全、接近 SQL 的 TypeScript query builder。
- [Graphile Worker](https://worker.graphile.org/) 与 [SQL add_job](https://worker.graphile.org/docs/sql-add-job)：PostgreSQL job queue 和事务内入队。
- [oidc-provider](https://github.com/panva/node-oidc-provider)：OpenID Certified OAuth/OIDC authorization server，支持 PKCE、resource indicators 和 client registration。
- [MCP Authorization 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)：OAuth 2.1、Protected Resource Metadata、resource/audience 和 scope 要求。
- [MCP Client Registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)：CIMD 优先，DCR 仅兼容 fallback。
