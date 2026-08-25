# 12 · 积分成本契约

## 唯一口径

Musefold 的历史、估算、实际成本、自动化预算、CLI 和 MCP 统一使用用户可见积分：

- `1 积分 = ¥0.1`
- `1 积分 = 50,000` 账号服务端原始配额
- 成本允许小数，`roundPoints` 保留最多 6 位小数

人民币分和账号原始配额只允许出现在 Provider 边界和旧数据迁移中，不得进入公开 API、预算判断、审计记录或 UI 状态。

## 运行时数据流

1. 非托管 Provider 不保存或读取本地单价；成功记录的 `history.cost` 为 `NULL`，自动化预算门按不计费直接放行。
2. 账号托管模型价格在供给阶段换算为 `unitPoints`；账号余额仍保存原始配额，仅展示时换算。托管价格未知时必须进入确认流程。
3. Doubao 网页 Provider 成本固定为 0，并继续进入云端 quota、budget 和审计体系。
4. Core 返回 `cost`、`costPoints` 和固定的 `costUnit: "point"`。
5. Automation API 使用 `points`、`estimatedPoints`、`actualPoints`、`costPoints`、`declaredBudgetPoints` 和 `remainingBudgetPoints`。
6. CLI `--max-cost` 的单位为积分；MCP 和 Skill 不做二次换算。

## 升级兼容

数据库 v16 将旧账号历史值除以 50,000、旧 BYOK 历史值除以 10，统一写成 `point`；旧审计值除以 10，并把列重命名为 `estimated_points` / `actual_points`。这些既有历史成本仍保留，新的非托管生成不再写成本。

electron-store 读取兼容只服务托管账号：旧托管 Provider 单价和账号会话图片单价除以 50,000 后写回积分字段。旧 `unitCents` 到 points 的懒迁移同样只对托管 Provider 生效；非托管 pricing 条目会被清理。旧自动化预算分值除以 10。导出格式 v3 的已记录 `history.cost` 单位始终为积分。

## 开发约束

- 新公开契约不得新增 `*Cents` 成本字段。
- 换算必须在 Provider 或旧数据边界完成，不得在预算层按 Provider 类型换算。
- 预算只按成功结果的 `costPoints` 冲销；托管账号价格未知必须进入确认流程，非托管 Provider 则视为不计费直接放行。
- 账号余额原始配额不得直接写入 `history.cost`。
- CLI、MCP、Skills 和 UI 对已记录成本明确显示“积分”，对非托管 Provider 明确显示“不计费”。

关键代码位于 `packages/core/src/pricing.ts`、`packages/core/src/db/migrations/0016_cost_points.ts`、`packages/core/src/services/generation.ts`、`packages/automation-server/src/generation-routes.ts`、CLI、MCP 和 Musefold Skill。
