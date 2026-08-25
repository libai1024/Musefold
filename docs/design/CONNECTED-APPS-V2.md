# 已连接应用 v2：默认开放全部能力 + 卡片重设计

> 状态：已落地（2026-08-24）。范围：Cloud MCP 连接的授权默认值、能力编辑与双端共享卡片 UI。
> 前置阅读：`docs/v1.1/V11-CLOUD-MCP-AND-SKILLS.md`（scope→工具映射、审批与预算模型）。

## 一、授权默认值（服务端）

- **默认开放全部能力**：`ensureGrant`（apps/web-api/src/modules/oauth/service.ts）新建与
  re-consent 时固定写入全部 `MCP_SCOPES`（6 项），不再只存客户端请求的子集；approve
  路由用 `grant.scopes` 给 oidc-provider 授予 resource scope，保证 access token 与
  grant 一致（否则 `assertScope` 仍会拦）。
- **默认额度 100 积分**：新连接 `max_points_per_generation` / `max_points_per_day`
  均默认 100（`MCP_DEFAULT_BUDGET_POINTS`）。生图模式仍默认 `ask_each_time`——
  「能力」默认放开，「花钱」默认最严；预算只影响「预算内自动」路径。
- 现有连接不自动提权；用户重新走 consent 等价于手动全开（upsert 覆盖 scopes，不重置预算）。
- consent 页文案改为「允许后默认开放全部能力 + 100 积分默认额度」，附中文能力清单。

## 二、能力可编辑（契约 + 服务端）

- `updateMcpConnectionSchema`（packages/contracts/src/connections.ts）新增
  `scopes: z.array(mcpScopeSchema).min(1).optional()`。
- `updateConnection`：**扩大**（新集合含旧集合没有的 scope）与切自动/提额/恢复连接
  同级，需要 `reauthPassword`；收窄免密即时生效。
- 桌面链路（IPC / cloud-client）经 contracts schema 透传，零改动。

## 三、卡片 UI（packages/product-ui/src/account/ConnectedAppsScreen.tsx，双端共享）

- 头部：客户端名 + 状态 · 相对时间「最近使用 X / 尚未使用」（消费 `lastUsedAt`）+
  全选时「全部能力」徽标。
- 能力区：6 项中文 chip（账户信息 / 提示词·读 / 提示词·写 / 技能·读 / 生图·读 /
  生图·写），点选即保存；扩大触发既有密码重认证弹窗；至少保留一项。
- 策略区：生图模式改 `SettingsSegmentedControl`（每次审批 / 预算内自动）；单次/每日
  预算输入明确单位「积分」。
- 空态：连接引导文案 + 可选 `mcpServerUrl` prop 渲染「复制服务器地址」
  （桌面传账号服务器 origin + `/api/musefold/mcp`；web 用 `location.origin`）。
- testid 契约：保留 `connected-apps-screen` / `connection-row`；新增
  `connection-scope-{scope}`、`connection-mode-{id}-{value}`、
  `connection-all-capabilities`、`connection-copy-server-url`。

## 四、测试

- contracts 单测：update schema 含 scopes（合法 / 空 / 未知 scope 拒绝）。
- web-api 集成（database.integration.test.ts，需 Docker/testcontainers）：
  ensureGrant 新建=全集+100/100、收窄免密、扩大 401→带 reauth 成功、re-consent 回全集。
- product-ui views.test：chip/徽标/分段模式/相对时间/空态引导断言。
- e2e：test_05 签出空态断言保持；test_11 connected-apps 截图为存档（无像素基线）。

## 五、Skill-Impact

是——改变新连接的默认授予范围（部分→全部 scope）、PATCH `/connections/:id`
新增 `scopes` 字段、consent 页文案与默认额度。对外行为变化需在发布说明中声明。

## 已知欠账

- `apps/web-api` 两个存量失败套件（`app.test.ts` / `generation/routes.test.ts`，
  `zod/v4/core` 与 fastify-zod-openapi 的导出失配）在干净 HEAD 同样失败，与本任务无关；
  主门禁 `npm run check` 不包含它们，待单独修复。
- 集成测试新增用例需 Docker 环境（CI / `test:integration:v1.1`）才能执行。
