# 11 · 契约与错误码索引

## 关键契约

| 领域 | 位置 |
| --- | --- |
| IPC/Preload API | `shared/types/ipc.ts` |
| 图像 Provider | `shared/types/providers.ts` |
| 工作台会话与 run | `shared/types/workbench.ts` |
| Skill Runtime | `shared/types/skill-runtime.ts` |
| 设计方案 | `shared/types/design-scheme.ts`、`shared/design-scheme/schema.ts` |
| Automation API | `packages/automation-server/src/*`、`packages/client/src/*` |
| Web v1.1 | `packages/contracts/src/*` |

## 通用错误域

| code | 含义 |
| --- | --- |
| `INVALID_INPUT` | 请求不符合 Schema 或业务限制 |
| `NOT_FOUND` | job、history、prompt 或 scheme 不存在 |
| `INVALID_STATE` | 当前状态不允许该操作 |
| `NOT_CONNECTED` | 本地控制面未就绪 |
| `ACCOUNT_REQUIRED` | 需要账号登录或兑换 |
| `PROVIDER_REQUIRED` | 没有可用的图像 Provider |
| `AUTH_ERROR` | Provider 或账号授权失效 |
| `RATE_LIMIT` | 上游限流 |
| `BUDGET_EXCEEDED` | 费用超过授权上限 |
| `CANCELLED` | 用户或客户端取消 |
| `INTERRUPTED` | 应用退出后恢复未完成运行 |
| `NETWORK_ERROR` | 网络或上游连接错误 |
| `INTERNAL_ERROR` | 未预期内部错误 |

## 实施要求

- 跨进程错误必须有稳定 code，用户文案可本地化。
- 不在 error message 中携带 API key、token、cookie 或未脱敏上游响应。
- 失败生图必须保留 history/run 事实；只有成功产物才创建 available asset。
- 所有支出操作必须是明确用户动作或已授权自动化。
