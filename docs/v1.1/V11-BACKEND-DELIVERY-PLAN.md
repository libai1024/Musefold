# Musefold v1.1 Web 后端交付计划

> **状态**：首版任务分解
>
> **范围**：账号、Web 制作工作台、生成历史、云端提示词库、桌面/Web 提示词同步、Cloud MCP 和共享 UI

## 0. 交付原则

1. 先冻结 contracts 和数据库不变量，再开发 UI 联调，避免 fixture 形状演变成生产契约。
2. 每个里程碑交付可运行的纵向闭环，不长期保留只有 route 没有隔离测试的半成品。
3. PostgreSQL 是业务事实源，也是 P0 的 session、限流和持久队列；不引入无法用当前负载证明收益的第二套数据基础设施。
4. 同步与提示词 CRUD 共用一个 application service，不能形成两套写入规则。
5. 共享包变化持续运行桌面回归，Web 依赖不能渗入 Electron/core。

## 1. 里程碑总览

| 里程碑 | 交付结果 | 依赖 |
|---|---|---|
| M0 契约冻结 | P0 DTO、错误码、状态机、OpenAPI 和 capability 完整 | 无 |
| M1 服务基座 | Node 24/Fastify、PostgreSQL、Kysely、Graphile Worker、迁移、RLS、CI 可运行 | M0 |
| M2 账号 BFF | new-api 注册/登录/续期/额度/兑换、HttpOnly session | M1 |
| M3 云端提示词库 | Prompt/folder/tag CRUD、搜索、版本冲突、回收站 | M2 |
| M4 云同步 | sync log/push/pull/bootstrap、桌面 outbox、冲突 UI | M3 |
| M5 Web 工作台 | 会话和草稿持久化、工作台恢复、历史框架 | M2 |
| M6 生图闭环 | Graphile Worker、new-api、生图资产、可恢复 SSE、重试 | M5 |
| M7 Cloud MCP | OAuth、远程 MCP、官方 Skill、预算/审批和连接管理 | M2/M6 |
| M8 共享 UI 与产品联调 | Web 去 fixture、共享产品组件、完整闭环和移动端 | M3-M7 |
| M9 上线加固 | 备份、恢复、监控、压测、安全、staging/production 发布 | M8 |

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

## 6. M4：提示词云同步

### 服务端任务

- `V11-SYNC-01`：创建 sync_devices/sync_changes/sync_mutations 表与索引/RLS。
- `V11-SYNC-02`：让 Prompt application service 在同一事务写实体和 change。
- `V11-SYNC-03`：实现 device、bootstrap、pull、push、status endpoints。
- `V11-SYNC-04`：实现 mutation 去重、批量逐项结果、cursor 过期和日志压缩边界。
- `V11-SYNC-05`：实现同步限流、body 限制和 payload 日志脱敏。

### 桌面任务

- `V11-SYNC-06`：主库迁移，新增 sync account/entity state/outbox/conflicts。
- `V11-SYNC-07`：桌面 Prompt/Folder/Tag repository 写入事务型 outbox。
- `V11-SYNC-08`：实现 cloud-origin apply，避免 pull 产生回声 mutation。
- `V11-SYNC-09`：实现设备注册、首次合并、pull/push 循环、网络退避和暂停。
- `V11-SYNC-10`：设置页加入同步开关、状态、立即同步、错误和设备信息。
- `V11-SYNC-11`：实现冲突列表以及保留云端/本地/两份。
- `V11-SYNC-12`：导入导出时清理或重建 owner/device/cursor 规则。

### 完成条件

- [V11-PROMPT-CLOUD-SYNC.md](./V11-PROMPT-CLOUD-SYNC.md) 第 16 节全部验收。
- 断网、请求重放、API 重启、桌面崩溃均不丢 mutation。
- HTTP 请求体检查证明本地图片路径和 Key 不离开桌面。
- 多账号切换不混用 cursor、outbox 或 cloud version。

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
- `V11-UX-10`：建立相同 fixture 下 Desktop/Web 的共享视觉差异门禁。

### 完成条件

- Web 首屏不显示任何桌面专属入口。
- 工作台、提示词库和历史在 Desktop/Web 中来自同一 product-ui 源码。
- 页面刷新、前后台切换和慢网络下没有重复任务或内容丢失。
- Playwright 覆盖桌面宽度和手机宽度，无水平溢出和控件遮挡。
- 所有空态、错误态和恢复态都有可执行下一步。

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
- [ ] Desktop/Web 工作台、提示词库和历史来自共享组件并通过视觉差异门禁。
- [ ] RLS、对象 URL、CSRF、限流和日志脱敏通过。
- [ ] PostgreSQL/对象备份恢复与发布回滚演练通过。
- [ ] Desktop/Web/API/worker/Cloud MCP 模块全部门禁通过。
