# v2.5 云端设计方案运行：B10 实现与验证

> 2026-09-07，G-CLOUD-03 固定路径切片已通过本机验收；完整云端设计方案和正式发布仍未完成。工作树包含未提交的 B2–B10 改动，不能仅用 HEAD 重建本批。统一检查、E2E、包身份见[开发记录](./V25-DEVELOPMENT-LOG.md)，剩余任务见[任务卡](./V25-MIGRATION-GOALS.md)。

## 1. 本批提供的能力

Web 工作台可以运行已有方案并取消：按 exact revision、trial/formal、槽位值、Prompt 引用版本、参考图暂存 ID、张数和当前会话向服务端 prepare，再以同一 executionId 提交并等待持久终态。共享 hook 不携带凭据、磁盘路径或对象存储键；Desktop 同步修复张数选择未随方案运行提交的问题。

当前只支持固定 inspect → compile → generate → evaluate 路径、cloud-default / musefold-image-pro 和 1/2/4 张。repair、自定义 workflow、尚不支持的费用上限等明确拒绝。这里的 compile 是确定性计划编译，不代表云端 Agent 创建/修改已经实现；市场、Agent 和专用包的其他 blocker 保留。

关键实现：[API 权威运行服务](../../apps/api/src/modules/design-scheme-runs/service.ts)、[Worker 双账本](../../apps/worker/src/design-scheme-runs.ts)、[API-client](../../packages/api-client/src/design-schemes.ts)、[共享运行 hook](../../packages/features/src/design-schemes/use-scheme-run-handlers.ts)。

## 2. 权威身份、状态和资产边界

| 接缝 | 本批行为与约束 |
|---|---|
| prepare | 从本人方案、exact revision、formal/trial 选择和可信来源重建固定计划；只 prepare 不入队。保留持久 execution 身份、有效期、输入摘要及取消 tombstone |
| run | 重新核对本人、方案版本/选择、Prompt expectedVersion、计划和参考字节；同 executionId 同输入重放幂等，不同输入冲突。两类 run 与队列在受控事务中创建 |
| cancel | 包括 prepare 前、prepare 中、排队/执行中和终态；与 run 仲裁，取消获胜后不出现迟到的未取消入队或成功覆盖 |
| 双账本 | generation run 与 design-scheme run、steps/evaluation/events 对齐；成功、失败、取消和 unknown 按同一事务及有效 lease/epoch 收敛 |
| trial / formal | trial 输出登记 cloud-run 来源与 output 角色的方案相册资产；formal 只进生成历史，零新增方案资产；云运行不能自动获得本机 trial 或封面资格 |
| 参考图 | owner/run/asset/order/objectKey/hash 由服务端固定，复核实际字节；复合 owner 外键隔离。引用已晋升后不因原 staging 过期/discard 或 soft delete 被 GC 误删 |
| 删除与补偿 | purge/empty-trash 和失败产物通过既有 cleanup outbox 交接；仍被引用的对象保留。已提交但提交回包丢失不误删成功资产 |
| 事件与产品状态 | 持久游标可恢复；客户端观察同一 executionId 到终态，事件监听器异常不破坏运行。成功清输入，拒绝保留输入，取消保持中性反馈 |

PG 新增迁移为 `0008_spooky_elektra.sql`；Desktop 独立方案库升级至 v8，以支持 cloud-run/output 的专用包往返和详情读取。受管 Desktop 主库的 8 条迁移属于另一条 SQLite 迁移链，不能将两个版本号混为一谈。

[Worker 生图 HTTP](../../apps/worker/src/image-gateway.ts)在实际请求前校验发送资格，禁止自动重定向，并在发送 hook 前后检查 abort。真实 307/308 的 generation/edit 测试观察到首个 POST 各 1 次、重定向目标 0 次；hook 前/期间取消观察到 fetch 0。已经发送而结果不明仍使用 unknown，不自动重试付费请求，也不承诺取消即免收费。

输出评估沿用既有图片格式头与几何检查；本批未给 Worker 输出新增完整 Sharp 解码或视觉质量判断。API 上传的完整图片解码与 Worker 成图检查是不同的验证边界。

## 3. 阶段测试与实际结果

日志与脱敏摘要位于 `.results/v25/2026-09-07-development/cloud-run/`；下表全部使用隔离数据和假 Provider，不是实际付费记录。重叠套件不相加。

| 命令 / 场景 | 实际结果 | 证据范围 |
|---|---|---|
| `pnpm --filter @musefold/api run test:integration` | 6 文件、67 passed、0 failed/skipped，退出 0，22:32:13 | `api-integration.log`；真实 PG、HTTP、queue；包含原脚本漏掉的详情文件 3 个 PG 用例和 1 个路由单测 |
| `pnpm --filter @musefold/worker run test:integration` | 5 文件、47 passed、0 failed/skipped，退出 0，22:32:15 | `worker-integration.log`；含方案双账本 25 项、既有 11 项真进程及其他 runtime/GC/retention 用例 |
| 最终统一 check 中 API 普通单测 | 66 passed / 66 gated skipped，退出 0 | 默认不启用数据库测试；数据库结果以上一行独立 integration 为准 |
| 最终统一 check 中 Worker 普通单测 | 63 passed / 47 gated skipped，退出 0 | 包括最终 redirect/abort 修复；不能以 skip 代替 integration |
| isolated PostgreSQL 17：0007 → 0008，再 CLI replay | 两次 `pnpm run db:migrate` 均退出 0，journal 8→9→9 | `migration-0008-report.json`、`migration-0008.log`、`migration-0008-reproduction.ts` |
| Web 方案双视口定向 E2E | 12 passed、0 failed/skipped，13.5 秒 | `tests/v25/.results/b10/cloud-run-web/`；HTTP mock，覆盖成功/拒绝/取消，不能称浏览器连接真实云后端 |
| 最终完整 E2E | 224 passed、8 skipped、0 failed/flaky，退出 0 | `tests/v25/.results/b10/e2e/`；production standalone + 新 Electron bundle，未重生视觉快照；完整 skip 说明见开发记录 |
| API/Worker 阶段 Docker | Node 24.20 / Linux arm64 依赖导入通过；API Sharp 0.35.4 完整 PNG 解码通过 | 两份 stage build log 和 `validation-summary.json`；镜像早于最后 redirect/abort 修复，不是最终源码镜像身份或部署证明 |

精确迁移验证在 0007 库先写 repository/local-run/uploaded 旧资产和普通生成旧行，升至 0008 后核对旧字段保留、旧生成的 schemeRunId 为 null、新 cloud-run 来源可写，重复 CLI 不改变结果。首次 fixture 缺少 canonical promptProgram 被拒绝，已保存失败日志，补齐夹具后在新的隔离库重跑；未改生产逻辑或 SQL 迁就夹具。

[API 集成](../../apps/api/src/__tests__/integration/design-scheme-runs.integration.test.ts)覆盖 prepare/run 并发幂等、篡改/跨 owner/版本冲突、prepare 前取消、会话归属事务回滚、Prompt 版本重查、run/cancel 竞争、参考字节变化、HTTP→真实队列→独立 worker→假 Provider 的 trial/formal/working-draft 链路。

[Worker 方案集成](../../apps/worker/src/__tests__/design-scheme-runs.integration.test.ts)覆盖上游失败、部分上传、stale epoch、迟到上传、试运行登记事务回滚、已提交但回包丢失、跨 owner 引用外键、流式参考图上限、soft delete/purge 引用保护及重复引用清理。[进程测试](../../apps/worker/src/__tests__/process-runtime.integration.test.ts)使用真实新 PID；但不能由普通 generation 的 kill/restart 证明每个方案故障组合都已经过真实进程终止。

## 4. 本批限制与下一阶段

- G-CLOUD-02/04/05/06 继续完成云 Agent 创建/修改/来源确认、GitHub 发现、专用包和完整三形态产品链。已有固定运行不等于全部方案功能完成。
- Worker 生产 bin/容器的完整恢复、所有方案故障与实际 kill/relaunch 的组合、真实 S3 行为和全部资产生命周期仍须补验。
- 可信 payer/credential version、跨账号恢复、不会随历史 purge 删除的执行回执、真实账单与未知成本处理按[费用边界 §10](./V25-SPEND-BOUNDARIES.md)拆解；不从结果成功推导已核实费用。
- 没有执行真实付费 Provider、真实账号登录、Windows 包、远程 CI 或生产部署。本批 API/Worker 阶段镜像不能代替最终生产镜像及回滚验证。
- Cloud MCP 保持七工具只读，管理员后台仍为可选增量。任务包整体验收未通过；B10 切片通过只关闭本文明确列出的范围。
