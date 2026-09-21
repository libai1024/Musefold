# v2.5 云端市场发现验证

> 2026-09-07，B11 / G-CLOUD-04。本批已通过本机统一验收；最终结果见本文和[开发记录](./V25-DEVELOPMENT-LOG.md)为准。此处市场是公开 GitHub 仓库发现；安装、Agent 编译和方案执行分别按对应任务卡验收。

## 1. 已实现的接缝

- 已登录的 `GET /api/v1/design-schemes/market` 经 `requireSession`、`DesignSchemeService.searchMarket` 调用独立市场服务，保留现有 query/limit/cursor 与 canonical 候选合同。
- 只请求固定 `https://api.github.com/search/repositories`，使用匿名 GET、禁止重定向、不带 GitHub token。返回 repositoryUrl/fullName、许可证、默认 ref、stars/topics、匹配和风险摘要；没有解析固定来源 commit，`commit` 保持 null。
- 校验 GitHub JSON 和候选合同，包括字段长度、日期、条数、公开性、仓库名与精确 HTTPS URL 对齐。私有或 fork 仓库不进入候选；没有合成成功结果。
- 不下载仓库或文件、不创建/安装方案、不生成图像、不接入投稿/交易/审核后台。搜索结果也不是未来来源安装授权，G-CLOUD-02 仍须重新解析固定 ref/commit 并确认。

## 2. 分页、缓存和限流

| 维度 | 实现口径与限制 |
|---|---|
| 查询 | canonical trim 后规范化连续空白；拒绝控制字符。缓存键为 query 哈希、limit、逻辑页；不缓存用户身份或原始 GitHub JSON |
| 分页 | 游标绑定 query 哈希、limit 和页码，拒绝错配/畸形游标。只访问搜索前 1000 条；非整除的末页以受控上游区间读取后切片，不超越 1000 边界，不跟随上游 Link URL |
| 正常缓存 | 公共进程缓存，5 分钟 TTL；命中返回 `fromCache=true`，保留原 `fetchedAt`，其他用户只能复用相同公开候选 |
| 失败回退 | TTL 后最多再保留 15 分钟；仅允许指定临时故障回退，不能用旧缓存掩盖非法参数/数据。每次回退重查年龄，不刷新时间或过期窗口 |
| 资源边界 | 上游 10 秒、2 MiB；缓存最多 128 页/8 MiB；每实例最多 4 个不同上游请求；同查询请求合并；短失败冷却 5 秒，失败缓存有条数上限 |
| 用户限额 | PG 原子账本，每用户 30 次/分钟；缓存命中和共享请求也扣此限额，不能借公共缓存绕过入口约束 |
| 上游限额 | PG 原子账本，匿名搜索总计 10 次/分钟，跨用户、跨 API 实例共享，仅 cache miss 请求消耗；外部 GitHub/IP 配额仍可能先耗尽 |
| 生命周期 | 缓存不持久化，重启丢失，多副本各自缓存；PG 配额共享。没有新增表或迁移 |

GitHub 的请求条数、搜索结果窗口与匿名搜索限制依据[官方 Search API 文档](https://docs.github.com/en/rest/search/search#search-repositories)。限额可能由上游调整，当前实现还处理 403/429 和 Retry-After/reset，不能把本地额度等同上游可用额度。

错误维持标准 API envelope，在 `details.operation=searchMarket` 和 `details.marketError` 区分非法查询/游标、GitHub 拒绝查询、限流、超时、上游失败、无效响应和不完整搜索；可恢复错误提供重试信息。市场以外尚未部署的 Agent/专用包等操作仍保留独立 501 合同。

## 3. 共享产品状态

发现屏只在明确搜索时请求。新搜索清空旧轮结果，迟到响应不覆盖新轮；网关切换或卸载使旧响应失效。同轮重复点击共享请求，适配器同步抛错后也可重试。每页保留 canonical 形状，视图聚合并按候选 ID 去重。

首屏区分等待输入、加载、零结果和失败；显示许可证与风险、缓存原获取时间，以及当前宿主安装能力。下一页失败保留前页候选，重试沿用原 query/limit/cursor；输入框未提交的修改不改变下一页条件。游标自循环和多跳回环都拒绝继续追加。多缓存页显示最早获取时间，fresh 页面不冒充缓存。

## 4. 分阶段验证与复跑命令

| 阶段 | 当前结果 | 证据及边界 |
|---|---|---|
| shared features | 2 文件 / 37 passed；typecheck/Biome 通过 | 新 hook 11 项 + 原方案 26 项；含同步 throw、旧响应、分页回环、缓存日期和界面状态 |
| API-client | 2 文件 / 26 passed；typecheck/Biome 通过 | 新市场 17 项 + 原方案 9 项；成功/缓存/分页、非法响应及 400/401/429/502/503，GET 无 body/重试/写副作用 |
| Web 专项 | 18 passed / 0 skipped / 0 failed / 0 flaky，14.9 秒 | PC/移动各 9 项；production standalone + 可控 HTTP fixture，截图已人工检查，无横向溢出；后续同步 throw 修复由单测和完整 E2E 再覆盖 |
| 真实 GitHub 只读 | 通过；2 次 GET，各 200 | 同一 production service 的第一页、跨主体缓存命中、下一页；查询 `topic:design-system`，每页 5 项。限流器仅记录调用，真实鉴权/PG 单独验证；不依赖即时排名做稳定断言 |
| API 真实鉴权/PG | 市场 5/5；完整 API integration 7 文件 / 72 passed，0 failed/skipped | Better Auth 实际会话、真实 middleware/routes 和 PostgreSQL 17；首轮 4 passed/1 failed 暴露 per-user 429 的 retryable 标记错误，修正实现后通过，未放宽断言 |
| 完整 Web/Electron E2E | 230 passed / 8 skipped / 0 failed / 0 flaky，4.5 分钟 | 当次双端构建；Web desktop 78/2 skip、mobile 76/4 skip、Electron 76/2 skip；报告 `tests/v25/.results/b11/e2e/`，跳过范围沿 B10，不证明真实账号/Key 或暂缓动作 |
| API 传输专项 | 2 文件 / 73 passed，0 skipped；typecheck/Biome 通过 | 4 项真实 loopback HTTP；固定上游、畸形载荷、资源界限、stale/冷却和最后分页矩阵 |
| 统一 check | 退出 0；35/35、24 cached | 根 228 文件/1899 tests、features 47/566、client 3/56；API 132 passed/71 gated skipped，真实集成另验 |
| source 扫描与身份 | 1079 文件/11,119,868 字节，0 findings/errors/exceptions；1175 项源码/配置/资源复核无变化 | `tests/v25/.results/b11/security-source-final.json` 和 `source-files.json`；清单范围包含 resources，非本批安装包或生产验收 |

阶段日志位于 `.results/v25/2026-09-07-development/b11-market/`；Web 报告及截图归档 `tests/v25/.results/b11/market-web/`；公开查询的字段级样本、请求数量和范围在 `public-github-report.json`。

从仓库根目录复跑，集成只使用 disposable PostgreSQL，不注入生产连接串：

```sh
pnpm --filter @musefold/api exec vitest run src/modules/design-schemes/__tests__/market-search.test.ts src/modules/design-schemes/__tests__/unavailable.test.ts
RUN_DATABASE_TESTS=true pnpm --filter @musefold/api exec vitest run src/__tests__/integration/market.integration.test.ts
pnpm --filter @musefold/api-client exec vitest run src/__tests__/market.test.ts src/__tests__/design-schemes.test.ts
pnpm --filter @musefold/features exec vitest run src/design-schemes/__tests__/use-market-search.test.tsx src/design-schemes/__tests__/design-schemes.test.tsx
pnpm run check
pnpm run test:e2e
```

完整 E2E 自行先构建 Web/桌面，请串行执行，避免与其他构建或占用 3399 的服务器并行。真实 GitHub 探测与稳定单测分开，不将临时上游故障或即时排序视为产品确定性断言。

## 5. 本批未关闭的任务

G-CLOUD-02 的来源冻结/确认与 Agent create/modify、G-CLOUD-05 专用包、G-CLOUD-06 三种形态全流程仍开放。费用身份和执行回执、完整资产 GC、Windows/正式签名/生产回滚等继续按[任务卡](./V25-MIGRATION-GOALS.md)执行。B10 的安装器及扫描仍属于 B10 历史产物，不能代表本批市场代码已经打包、签名或部署。
