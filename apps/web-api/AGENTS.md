# apps/web-api(+ generation-worker)— 后端开发约束

Fastify + PostgreSQL + graphile-worker。出入参校验、实体形状一律来自 `packages/contracts`(zod),不在本应用内定义平行模型。

## 结构

```text
src/modules/{account,auth,generation,health,mcp,oauth,prompts,rate-limit,sync,workbench}
src/database/  连接与迁移运行时;migrations/  node-pg-migrate 的 .cjs 迁移文件
src/storage/   对象存储访问
```

- 新功能按域进 `modules/<域>/`,不把业务塞进 `app.ts`/`bin.ts`。
- generation-worker(apps/generation-worker)是同一 compose 栈的队列消费者,依赖同样的 contracts 与迁移;depcruise 禁它依赖前端/桌面包。

## 迁移(PostgreSQL,与桌面 SQLite 迁移是两套独立体系)

1. 新建 `migrations/000NNN_描述.cjs`(node-pg-migrate),`npm run db:migrate:v1.1` 应用、`db:rollback:v1.1` 回滚。
2. **Expand/contract 闸门(CI 强制)**:一个迁移的 `up()` 里,写行(INSERT/UPDATE/DELETE)与 `DROP COLUMN` 不得同时出现——这是对旧版本 API 还在服务流量时的前滚安全约束。拆成两个迁移分批上。
3. 破坏性变更(rename/drop)一律走 expand → 双版本兼容期 → contract 三步,先在 PR 里说明兼容计划。
4. 队列表结构由 generation-worker 侧迁移管理(`npm run queue:migrate:v1.1`),不要混进 web-api 迁移。

## 测试

- 单测:`npm run test:web-api`(vitest,mock 边界按现有用例体例)。
- 集成:`npm run test:integration:v1.1`——testcontainers 起真 PostgreSQL,跑迁移 + graphile-worker + 各服务(角色权限、Session、RateLimiter、OAuth 全套)。改 schema / 迁移 / 队列后必跑。
- 契约:`npm run openapi:check` 保持 OpenAPI 与实现同步。

## 部署红线

- 生产只经 `.github/workflows/deploy.yml`(self-hosted runner 执行 `scripts/deploy/run.mjs`):content 层 symlink 原子切换,service 层按 sha 打镜像 + `/health/ready` 门控滚动重启。
- ❌ 不要手工改生产主机上的文件、compose 或 `.deploy-state.json`;回滚走 `scripts/deploy/rollback.mjs`(基于 deploy-state),不要手拼命令。
- 本地栈:`npm run dev:v1.1:infra`(postgres/minio compose),不要把本地 compose 当生产配置用(生产是 `infra/v1.1/remote-compose.yaml`)。
