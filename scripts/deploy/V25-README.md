# v2.5 发布计划与迁移入口

这里是 G-RELEASE-04 的新入口。当前已实现**不执行部署的计划生成**、**镜像内受控迁移**与**受限运行角色授权**，并取得本机隔离 Compose 的业务、停写备份恢复和历史镜像回切证据。真实域名/TLS staging、正式产物来源绑定、生产发布和远程 MCP 仍未验收。不要把计划输出中的命令直接当成已获授权的生产操作。

## 旧 → 新资源审计

| 资源 | 旧入口 | v2.5 目标 / 当前状态 |
| --- | --- | --- |
| 镜像 | `musefold-v11`、可变 tag | API/Worker/Web 分离，计划仅接受完整 sha256；生产必须为 registry digest |
| Web | `apps/web/dist` 静态目录切换 | `apps/web-next/Dockerfile` standalone；构建 upstream 必须为 `http://api:8787` |
| 服务 | `v11-web-api` / `v11-worker` | `api` / `scheme-agent` / `worker` / `web`，独立 `musefold-v25-*` Compose project |
| 应用迁移 | 旧 npm workspace / 本地 pnpm 命令 | API 包内 `src/migrate-bin.ts` 调用同一 `@musefold/db` SQL migrations；实际镜像没有 pnpm（但存在 drizzle-kit，不能假定所有开发包均被排除） |
| Graphile schema | 旧 queue 命令 / worker 自动安装 | 同一受控迁移进程预先运行 Graphile migrations；三个独立无 DDL 角色已实际入队/消费，未迁移和未来 schema 变更须 fail-closed |
| 凭据 | `.env.v11`，共享角色假设 | API、Worker、scheme-agent、migration 四个独立私有 env 文件；隔离真实镜像角色验证通过，生产凭据仍须独立配置 |
| 域名/反代/OAuth | 旧域名默认值 | 显式同源 origin；除 loopback staging 外强制 HTTPS；Web 只绑定回环端口，TLS 反代仍需部署验收 |
| 健康 | `/health/ready` 默认值与实际接口不符 | `/healthz` 仅为 liveness；DB/schema、对象读写删、两种 worker ack、同源认证为独立 readiness，尚未实现完整探针 |
| 数据/卷 | 旧 host stack / 默认开发密码与端口 | 计划不创建或覆盖数据库和对象存储；独立备份、受限角色、bucket、TLS、持久存储及保留策略须先提供验证 |
| 回滚 | `.env.v11` 与旧目录符号链接 | 计划保留 previous 的三个镜像摘要；只允许应用回切，默认不做数据库 down 或删除卷；兼容扩展 schema 与恢复实测待完成 |

现有 `deploy:prod` / `deploy:rollback` 仍是旧版入口，不能用于 v2.5。为避免影响仍运行的旧系统，本增量不改写其资源或自动触发它们。`infra/v2.5/compose.yaml` 是本地开发环境，不是生产配置。

### 来源地址与存储启动保护

- API 的 `TRUST_PROXY` 默认 `false`，使用实际连接来源作为 MCP IP 限流依据，忽略客户端自报转发头。只有确认反代会正确追加/覆盖 `X-Forwarded-For` 后，才在独立 API env 中配置实际代理 IP/CIDR（逗号分隔，也支持 `loopback`、`linklocal`、`uniquelocal` 命名网段）；不得配置全部地址、跳数或将 `TRUSTED_ORIGINS` 当作代理信任。按最近连接到最远逐跳核对，在第一个非可信节点停止；错误/过长链回退实际连接，IPv6等价写法和IPv4映射地址归一。共享 Docker/私网范围不能未经核对一律信任；默认关闭时多个代理后用户可能共用限流桶，部署验收须核实实际拓扑。
- 生成 Worker 恢复 `S3_AUTO_CREATE_BUCKET=true|false`（默认 `true`，承旧本地策略）。HEAD 仅在确认404/缺桶时允许创建；`false`不创建，403/网络/服务故障不尝试创建。缺桶不能创建或创建失败均非零退出，关闭连接且不开始消费队列；日志不输出上游详情。生产建议由运维预建桶并显式配置 `false`。这项启动保护不代替对象写入/读取/删除的独立 readiness 验证。

## 生成不发布计划

准备一个私有 release JSON，然后执行：

```sh
pnpm run deploy:v25:plan --manifest /absolute/private/release.json
```

此命令只读 JSON 并向 stdout 输出计划，不写 Compose、不调用 Docker、不读取 env 文件、不上传镜像、不创建容器。`--execute` 等未知参数会失败。计划固定为 `publicationAuthorized: false`，执行前仍需核对原 R04.1–8。

输入字段（全部必需，`previous` 除外）：

- `formatVersion: 1`；`environment: staging | production`；与环境匹配的独立 `project: musefold-v25-staging[-suffix] | musefold-v25-production[-suffix]`。
- `publicBaseUrl` 为无凭据、路径、query、fragment 的 origin；`webPort` 为回环监听端口。
- `source` 为 `commit`（40 位 Git SHA）、`treeSha256`（64 位源码清单 SHA256）、`dirty`。生产拒绝 dirty，包括 previous。
- `images.api/worker/web` 为 `registry/repository@sha256:<64 hex>`。隔离 staging 也接受本地 `sha256:<64 hex>`；tag 或缩写不接受。
- `envFiles.api/worker/schemeAgent/migration` 为部署目录内四个不同的 `.env` 文件名，不接受绝对路径或目录穿越。JSON 中禁止携带密码等额外字段；这些文件须独立限权并保存在仓库外。
- 可选 `previous: { source, images }`，保存已验收上一版真实身份。运行 env 的向后兼容需单独审核，不能由镜像摘要推断。

计划的 Compose 没有 `build`，也不自动拉取标签：先验证并预装指定镜像，再执行单次 migration，迁移失败不得启动新版本。迁移后还有不可跳过的 `apply-runtime-grants` 人工审核步骤，不是可直接循环执行的命令数组；授权及验证通过后才可 roll-runtime。运行服务不接触 migration env。API 的容器健康状态只证明进程存活，不能当成发布成功。

## 镜像内迁移

API 镜像的专用 entry 为 `./node_modules/.bin/tsx src/migrate-bin.ts`。只读取：

- `MIGRATION_DATABASE_URL`：专用迁移连接，不能用 `DATABASE_URL` 隐式代替。
- `MIGRATION_RELEASE`：这次计划的完整 Git SHA。

入口先取得 PostgreSQL session advisory lock，拒绝另一个受控迁移同时执行；随后按顺序运行应用与 Graphile migrations。可幂等回放；两套 schema 不冒称单一事务。失败时进程非零退出并关闭连接，不把 SQL、密码、URL 写进日志。正常成功只输出状态和 release。数据库备份与迁移权限不是由此入口自动创建。

## 运行角色授权

与本次 source hash 绑定的 `infra/v2.5/runtime-grants.sql` 在两套迁移之后，由专用 migration owner 执行。先在私有环境中配置三个独立 LOGIN 角色：`musefold_v25_api`、`musefold_v25_worker`、`musefold_v25_agent`；脚本不创建或输出密码。角色必须无其他角色成员关系、对象所有权、SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS；数据库或其他 schema 继承的 CREATE 权限也会拒绝。

授权仅涵盖受信服务所需 DML、序列与函数执行，不授予 TRUNCATE、DDL 或迁移账本写入。Graphile 0.17 的四张私有表保持 RLS 开启，并只为上述三个角色添加定向策略；不对 PUBLIC 放行、不关闭 RLS，也不冒称按租户/服务域隔离。Graphile 迁移版本不是 19 或 RLS 表集合发生变化时，整次授权事务回滚并要求重新审查；重放仅更新本脚本命名的策略。升级 Graphile 必须重新验证此文件。

实际非 root/read-only API 与两个 Worker 容器已使用独立受限凭据启动并确认两个 reconcile 任务完成；另外验证所有角色 DDL/账本写入被拒绝、无关角色即使获得 DML 仍不能入队、schema 变化会回滚授权。后续业务证据见下节，受限角色本身不能代替业务就绪。

## 本机隔离部署与恢复演练

`scripts/deploy/__tests__/v25-staging.integration.test.ts` 使用计划生成器输出的 Compose，创建独立 PG 数据库/角色、MinIO 和回环上游；不读取真实账号凭据，不调用付费上游，不触碰旧部署或用户数据库。实际生产镜像运行在非 root、只读、去 capability 配置中，Web 通过容器内部 `api:8787` 同源代理。

运行时设置 `RUN_V25_STAGING_TESTS=true`，并提供完整本地镜像 ID：`V25_API_IMAGE`、`WORKER_CONTAINER_IMAGE`、`V25_WEB_IMAGE`，然后运行：

```sh
pnpm exec vitest run scripts/deploy/__tests__/v25-staging.integration.test.ts
```

可选 `V25_STAGING_EVIDENCE_DIR` 保存已登录提示词页面截图；不导出浏览器会话或密码页。版本回切须另外设置 `RUN_V25_ROLLBACK_TESTS=true` 和三个与当前版本不同的完整 ID：`V25_PREVIOUS_API_IMAGE`、`V25_PREVIOUS_WORKER_IMAGE`、`V25_PREVIOUS_WEB_IMAGE`。未开启的场景显示 skip，不能算通过。

已实测范围：

- 两种 Worker 实际入队/消费、运行角色 DDL 拒绝及运行镜像 ID 核对。
- 1280/390 视口实际生产 Web 登录、创建提示词和刷新；owner 隔离、版本冲突、同步 push/pull 与同 mutation 重放、删除。退出缺 Origin 仍返回403，正常页面退出后受保护请求401。
- 受控图像上游成功/失败、已排队取消、幂等重放无额外生成；实际 MinIO 字节/hash、越权拒绝、清理后 bucket 和持久清理队列均为空。
- 停止四个运行服务后用 `pg_dump` 备份；恢复到同一隔离 PG 集群的新数据库及另一独立 MinIO。逐表逐行 hash 比较，重放迁移和权限授权，原库/对象不修改。对象复制中途故意失败时服务保持停止，恢复后以同一任务和资产读取原图片，不重新生图；恢复库的新修改不影响原库。
- 使用生成的 rollback steps 将 API/Worker/Web 实际切到不同的本地历史镜像；在现有扩展 schema 上读取原提示词/图片、完成受控生成，再切回当前镜像，迁移账本与结果保留。没有执行数据库 down。

边界：账号和图片上游是受控 HTTP，不是实网账号验证；对象存储是实际 MinIO，但其测试 root 凭据不证明生产 bucket 最小权限。恢复只覆盖停写快照，不覆盖在线时间点恢复、跨集群全局角色/密钥恢复、备份之后的授权撤销或整机故障。历史镜像是本机留存构建，不是已发布正式版本；计划中的 source 字段是明确的测试值，不能用作源码/产物证明。所有私有夹具备份与自建资源在测试结束后清理，只保留脱敏报告和可选页面截图。

## 验证与剩余工作

本地测试：

```sh
RUN_DEPLOY_COMPOSE_TESTS=true pnpm exec vitest run scripts/deploy/__tests__/v25-plan.test.ts
RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/deployment/__tests__/migrate.test.ts src/__tests__/integration/deployment-migrate.integration.test.ts
```

实际镜像测试还可通过 `RUN_V25_IMAGE_TESTS=true` 与本地完整 `V25_API_IMAGE=sha256:...`、`WORKER_CONTAINER_IMAGE=sha256:...` 执行 `scripts/deploy/__tests__/v25-{image,runtime-roles}.integration.test.ts`；默认跳过必须明确披露，不能当成镜像已验。

仍需：将业务 readiness 与真实部署运行手册合流；准确源码/产物绑定的真实 TLS staging 与生产权限/持久存储；真实发布候选升级中断、恢复与回切；两个独立远程 MCP 授权与撤销；远端 CI；明确生产授权后按同一审核包发布。本机演练不关闭这些原验收条件，planner 单测或 `/healthz` 成功也不能替代它们。
