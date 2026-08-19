# Musefold v1.1

v1.1 是面向个人用户的 Web 产品面，支持手机浏览器；桌面端继续维护完整能力。

## 文档

- [Web 版总体架构](./V11-WEB-ARCHITECTURE.md)
- [技术选型与架构决策](./V11-TECHNOLOGY-DECISIONS.md)
- [Web 后端 MVP 实施规格](./V11-WEB-BACKEND-MVP.md)
- [提示词云同步协议](./V11-PROMPT-CLOUD-SYNC.md)
- [云端 MCP 与 Skills](./V11-CLOUD-MCP-AND-SKILLS.md)
- [Desktop/Web 共享 UI 架构](./V11-SHARED-UI-ARCHITECTURE.md)
- [Web 后端交付计划](./V11-BACKEND-DELIVERY-PLAN.md)

## 当前状态

- 已完成：现有桌面端边界回顾、共享代码判断、成熟架构调研、Web v1.1 架构基线。
- 本轮补充验证：Desktop 工作台 E2E `29/29` 与头像静态契约定向测试 `12/12` 通过；普通生图结果统一使用共享助手头像，Skill Agent 过程态继续保留 Desktop 专属头像。
- Phase 0-M7 已落地工作基线：`@musefold/contracts`、`@musefold/domain`、Fastify Web API、PostgreSQL/RLS、Graphile Worker、new-api 会话、提示词云同步、Web 工作台/历史、Cloud MCP 和 `oidc-provider` OAuth。
- Desktop Prompt/Folder/Tag 同步已接入真实 SQLite repository、事务型 outbox、账号生命周期、opaque 设备会话和设置页冲突处理；本地自动化测试已通过，跨两台 Desktop + Web 的实机联调仍是 M4 发布门禁。
- 已验证：共享类型检查与单测、13 版 Web 数据库迁移与 RLS/生成事件通知集成、SQLite 18 版本地迁移与独立 usage outbox、Web/Desktop 生产构建、桌面/手机浏览器核心生成流程、OIDC DCR/PKCE/refresh/MCP/revoke 本地闭环、官方 MCP SDK 的 Streamable HTTP/签名 `resource_link`，以及 Generation Worker PostgreSQL heartbeat 与 MinIO bucket 创建/写入/读回/清理。
- Cloud MCP 预算已用真实 PostgreSQL 验证 grant 级幂等、10 请求并发上限、审批重试、取消释放、成功结算和消费记录 RLS；敏感账号、同步及 MCP 入口已使用 PostgreSQL token bucket，可信代理必须显式配置。
- connected apps 页面已支持单次/每日预算、今日已结算/预留、暂停/恢复和撤销；提高自动化权限由后端强制 new-api 密码重认证，密码不写入 session 或 grant。
- 官网目录中的 canonical `SKILL.md` 已更新为 `v1.1.0-dev`，同时描述 Cloud/Local MCP 与 CLI 回退；服务器实际文件替换和两个远程 MCP 客户端验收仍待发布阶段完成。
- 本轮增量（2026-08-19）：Web 提示词库搜索已接入 typed Cloud gateway 的服务端 `q` 查询并防止旧响应覆盖新输入；最近对话已补齐置顶、重命名、归档、标记未读和软删除确认，Desktop/Web 共用上下文菜单与会话偏好协议。对应 Web E2E 为 `11/11`，真实 Cloud/staging 浏览器验收仍待完成。
- 本轮 UI 统一（2026-08-19）：Desktop 标题栏、Desktop/Web 侧栏和 Web 顶栏均使用共享会话菜单触发器、重命名弹层、删除确认、IconButton 语义以及统一的 portal/Escape/点击外部关闭行为；工作台提示词引用卡片和全文悬停预览也已统一，正文使用来源快照传递；共享 Product UI 测试当前为 `37/37`。
- 共享 UI 已继续落地：`@musefold/product-ui` 现在还提供工作台页面壳/时间线视口控制器、空态创作方向、最近会话列表、会话列表 reducer/controller、比例选择、生成设置、上下文菜单、共享提示词输入、提交/取消按钮、草稿保存状态、页面标题工具条、生成历史公共动作、历史检视导航 reducer/hook、共享历史主从工作区（宽屏列表 + 320px 检视器、手机详情返回）、`AccountSummaryPanel`、`AccountScreen` 和 `ConnectedAppsScreen`；Desktop/Web 共用这些控件的图标、弹层、键盘/Escape、点击外部关闭、状态标识和动作槽，Desktop 通过 capability action 保留本地图片、Skill、设计方案与 Agent 能力，Web 仅渲染个人工作台支持的提示词引用。Web 页面编排器已拆到 `apps/web/src/layout/WebNavigation.tsx` 与 `apps/web/src/views/`，`App.tsx` 只负责路由、会话状态和 gateway adapter 组合。Web 已完成提示词和工作台草稿的版本冲突处理，能从 URL/最近会话恢复草稿、参数和完整多 turn 生成快照；活动任务通过可恢复 SSE 更新，断线后按完整快照确认并退避重连。已有会话使用共享 `useWorkbenchDraftSyncController` 串行 debounce 云保存，会话列表使用 `useWorkbenchSessionController` 管理替换、更新、移除、加载和错误，冲突时可明确选择云端或本机版本，“新设计”会建立独立会话。Desktop active/archived/open/rename/archive/restore/delete 已由同一 session reducer 规则覆盖并有失败语义测试。工作台结果支持取消、原地重试、下载、存提示词，历史支持重试、取消、下载、存提示词、软删除和恢复。Web 的账户和 Cloud MCP 连接页面已经从 `App.tsx` 移入共享组件，Desktop 设置已接入同一 `ConnectedAppsScreen` 与 Cloud 会话 IPC，包含预算修改、密码二次认证、暂停/恢复和撤销确认。提示词详情 header、编辑表单、提示词库工具条、历史页面工具条和账户摘要已由 Desktop/Web 共用；`npm run test:visual:shared` 已覆盖 Workbench、Workbench result、提示词库列表/详情、历史详情内容、完整历史工作区、账号摘要和 Cloud MCP 连接页十一项差异门禁，并额外覆盖生成失败态、取消态和 `390x844` 手机结果态。剩余后台生成快照跨端统一、真实 Cloud API 浏览器验收和上线前真实环境门禁。Web fixture 已改为显式 opt-in，生产 bundle 泄漏检查以及 `1280x720`、`390x844` Playwright 主路径已加入持续门禁。
- 本轮 UI 进展（2026-08-19）：`@musefold/product-ui` 新增账户身份/额度/生图状态摘要、账户页和 Cloud MCP 连接策略页，Web 已移除对应的 App 内独立页面实现；Desktop 设置新增“已连接应用”分区，通过共享 `ConnectedAppsScreen`、集中式 `cloud-connections-store` 和 `cloudConnections` IPC 接入默认 Musefold Cloud 会话，密码重认证只作为一次请求参数转发，不落库。共享组件测试 `35/35`、Web E2E `11/11`、Desktop 工作台 E2E `29/29`、Desktop 设置 E2E `45/45`、Desktop 账号 E2E `4/4`、Desktop 视觉 QA `5/5` 已通过。十一项共享视觉区域均低于门禁：Workbench `1196x848` 为 `0.0124` / `2.77%`，Workbench result `589x502` 为 `0.0187` / `3.15%`，失败态 `589x498` 为 `0.00383` / `0.75%`，桌面取消态 `589x498` 为 `0.00308` / `0.53%`，手机取消态 `351x393` 为 `0.00651` / `1.28%`，提示词库列表 `960x353` 为 `0.0149` / `3.89%`，提示词详情 `880x545` 为 `0.0045` / `1.45%`，历史详情 `296x459` 为 `0.0373` / `6.97%`，完整历史工作区共同区域 `960x766` 为 `0.0456` / `7.71%`，账号摘要 `680x156` 为 `0.0105` / `2.29%`，Cloud MCP 连接页 `958x271` 为 `0.0152` / `4.87%`。Desktop 本地账号/云同步/兑换码仍按 capability 分开，真实 Cloud/staging 和生产发布门禁尚未完成。
- 当前 UI 验收修订（2026-08-19）：以上阶段记录之后，共享 Product UI 已更新为 `37/37`，共享视觉门禁已扩展为 `13/13`，新增提示词引用卡片 `300x48` 与全文预览 `320x98`；Desktop/Web 均通过，真实 Cloud/staging 和生产发布门禁仍未完成。
- 最新 UI 修订（2026-08-19）：共享 Product UI 为 `38/38`，新增共享 `GenerationRetryAction`，统一 Desktop/Web 失败与取消结果的重试图标、20px 控件几何、忙碌状态和无障碍语义；共享视觉门禁 `13/13`、Web E2E `11/11`、Desktop 工作台 E2E `29/29` 与 `check:v1.1` 均通过。真实 Cloud/staging 和生产发布门禁仍未完成。
- 当前验证基线（2026-08-19）：重新执行 `npm run check:v1.1`、本地数据库集成 smoke、Web Playwright 和共享视觉门禁后，共享 Product UI 为 `40/40`，共享视觉区域为 `16/16`，Web E2E 为 `13/13`，Desktop 视觉 QA 为 `5/5`；`npm run release:preflight` 也已通过。以上均为本地/fixture 验证，真实 staging 账号、远程 MCP 客户端、跨设备联调、签名/公证和远端 CI 仍属于外部发布门禁。
- 真实账号增量验收（2026-08-19）：本地 Web API `60162` 已使用账号 `1422958965` 完成真实 new-api 登录、读取、两条生图链路和 MCP SDK 双客户端闭环；兑换码验收先记录到一次上游 `502/INTERNAL_ERROR`，随后对同一 new-api 会话做定向核验成功，实际增加 `500000` 点，兑换后额度已读回。该证据覆盖本地 API 到真实 new-api，仍不等同于远程 staging、双设备和生产发布门禁。
- MCP 全量验收（2026-08-19）：本地 Cloud MCP 的 14 个工具已由两个独立官方 SDK 客户端完成 `tools/list` 和调用矩阵；OAuth PKCE/同意页/token、双客户端、账号/模型/提示词/Skill/估算、预算拒绝、审批态幂等生图、查询/等待/取消、历史签名资源、refresh/revoke 和撤销后 401 均通过。审批态现在允许安全转为 `cancelled`，未触发上游生图扣费；远程 MCP URL/生产 OAuth 仍属外部门禁。
- 已冻结首版：Web 制作工作台、生成历史、云端提示词库、桌面/Web 提示词双向同步和账号授权的 Cloud MCP 均进入 P0；参考图仍为后续能力。
- 已冻结后端：Node.js 24 + Fastify 5 + Zod/OpenAPI + PostgreSQL 16/Kysely + Graphile Worker + 外部 S3-compatible object storage；Musefold P0 不依赖 Redis。
- 已冻结云端 MCP：以 Fastify 模块挂载在 Web API，同进程复用 application services；达到文档中的独立扩容阈值后再拆服务。
- 已冻结 UI：Desktop/Web 共用产品组件、token 和交互状态机，仅平台 shell 与数据 adapter 分开。
- 当前仍未达到 production release：真实 new-api staging 生图、两个独立远程 MCP 客户端兼容性、两台真实 Desktop + Web 同步验收、跨设备后台生成快照验收、账号/连接管理跨端联调、备份恢复和生产 JWKS 配置仍按交付计划推进。
- 本轮新增显式真实环境验收命令：`test:staging:v1.1`、`test:staging:mcp-sdk`、`openapi:check`。默认 staging smoke 只读；提示词变更、兑换和真实生图必须显式打开环境开关，脚本不会输出凭据。共享 Product UI 新增 Desktop/Web 生成快照排序、upsert、活跃任务筛选、终态和结果表面状态适配，Web 已接入跨会话快照订阅与 SSE 断线退避；跨设备后台恢复仍待真实环境验收。

## 开发命令

```bash
npm run dev:web
npm run dev:web:fixtures
npm run check:v1.1
npm run test:e2e:web
npm run build:web
npm run storage:smoke --workspace @musefold/generation-worker
npm run test:staging:v1.1
npm run test:staging:mcp-sdk
npm run test:staging:mcp-full
npm run openapi:check
```

`npm run dev:web` 默认连接 `/api/musefold/v1`，也可通过 `VITE_API_BASE_URL` 覆盖。只有 `npm run dev:web:fixtures` 会启用 fixture gateway；fixture 模式始终在界面显示“开发预览”，且生产构建检查会阻止 fixture 数据进入产物。

### 新对话复测 Cloud MCP

本地 Web API、Generation Worker、PostgreSQL、MinIO 和 Web 已启动后，在仓库根目录运行：

```bash
MUSEFOLD_STAGING_BASE_URL=http://127.0.0.1:60162 \
MUSEFOLD_STAGING_USERNAME='<测试账号>' \
MUSEFOLD_STAGING_PASSWORD='<测试密码>' \
npm run test:staging:mcp-full
```

该命令用两个官方 MCP SDK 客户端严格检查当前 14 个 Cloud MCP 工具、OAuth PKCE/refresh/revoke、预算拒绝、待审批任务的幂等/查询/等待/取消和历史签名图片。默认不会批准生图，因此不调用上游付费接口；临时提示词、任务、token 和连接会自动清理。空白账号没有已发布 Skill 或历史图片时，可分别设置 `MUSEFOLD_STAGING_MCP_REQUIRE_SKILL=false`、`MUSEFOLD_STAGING_MCP_REQUIRE_ASSET=false`，但发布验收不应关闭这两项。
