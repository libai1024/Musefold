# Musefold v2.1 Cloud Agent / Skills 只读工具白名单

> **状态**：机器 manifest 已实施；Cloud MCP 仅注册按 scope/rollout 过滤的七项只读工具
>
> **日期**：2026-08-27
>
> **范围**：`apps/web-api` Cloud MCP、OAuth scopes、官方 Skill registry 与 Web/Desktop Cloud Agent 客户端；不修改本地 stdio MCP / loopback Automation 的既有能力

## 0. 核心结论

1. Cloud Agent 只用于读取官方 Skills、读取必要创作上下文、思考、分析和优化提示词。
2. Cloud MCP 采用精确注册白名单；未列入机器 manifest 的工具不注册，不以运行时 403 代替隐藏。
3. Agent 工具全部只读，不写 Prompt、不创建或取消生成、不提高 scope/预算，也不调用任意外部网络。
4. 用户确认的生图继续经过产品内可见的 `GenerationGateway`：展示模型、估价、费用边界和确认状态；Agent 只能产出建议或优化后的 prompt。
5. Cloud MCP 不连接 Electron、loopback Automation、本地 Provider、safeStorage、文件系统或浏览器控制。
6. Skill 只提供固定版本的指导与输入 schema，不能扩大 scope、工具、预算或数据访问。
7. Cloud 不执行 Skill 中的 shell、JavaScript、Python、网络抓取或仓库脚本，不接受任意 GitHub URL。

## 1. 精确白名单

| Tool | Scope | 数据 | 关键约束 |
|---|---|---|---|
| `musefold_status` | `account:read` | 脱敏连接、resource、scope 与 capability 摘要 | 不返回 token、内部 endpoint 或本地能力 |
| `get_account_status` | `account:read` | 脱敏账号、额度与可用性 | 不返回密码、Cookie、上游 token 或 Provider 配置 |
| `list_models` | `account:read` | 官方云模型 alias、能力与公开费用信息 | Web 只列官方模型，不暴露 Provider/Key |
| `search_prompts` | `prompts:read` | 当前 owner 的云端 Prompt 摘要 | 限制查询长度、分页和返回数，默认排除 deleted |
| `get_prompt` | `prompts:read` | 单个云端规范 Prompt | owner 隔离，不返回 Desktop 路径或扩展字段 |
| `list_skills` | `skills:read` | `published` 官方 Skill 元数据 | 只列已审核、无代码、固定版本/hash 的条目 |
| `get_skill` | `skills:read` | 固定版本 Skill 内容、输入 schema 与 hash | 必须指定 `id + version`，不解析任意 URL |

**白名单基数：7。** `tools/list` 必须精确等于 manifest 按 grant scope 和 rollout 过滤后的集合。新增、删除或重命名工具必须先修改本文件、功能矩阵和 Skill-Impact。

## 2. GenerationGateway 边界

Cloud Agent 可以输出：

- 对用户 prompt 的分析；
- 基于官方 Skill 的结构化建议；
- 优化后的正向/负向 prompt；
- 建议模型、尺寸、比例与参数，前提是取值来自 `list_models` 和 Skill schema。

Cloud Agent 不可以直接执行：

- 保存或覆盖 Prompt；
- 创建、重试、等待或取消生成任务；
- 预留或扣除额度；
- 上传参考图或解析任意图片 URL；
- 修改 Agent grant、scope、预算、模型白名单或审批策略。

产品内生成流程必须是：

```text
Agent 读取上下文并返回 prompt 建议
→ 用户在可见 UI 检查/编辑
→ GenerationGateway 重新校验模型、参数与估价
→ 用户确认费用边界
→ 使用稳定 idempotency key 提交
→ 产品 UI 查询、取消或重试任务
```

Agent 返回内容不是授权，也不能携带可执行命令。GenerationGateway 对 owner、输入 schema、模型目录、费用和幂等重新校验。

## 3. 明确禁止注册

| 类别 | 例子 | 原因 |
|---|---|---|
| Prompt 写入 | `save_prompt`、删除/恢复 Prompt | Agent 只提供建议，写操作由用户产品面完成 |
| 生成与花费 | `generate_image`、`retry_generation`、`cancel_generation` | 费用与状态变更必须留在可见 GenerationGateway |
| 任务/历史扩读 | `get_generation`、`wait_for_generation`、`list_history` | 不是阅读 Skill 和优化 Prompt 的必要上下文 |
| 本地 Provider/设置 | `select_provider`、`open_provider_setup`、set key | Cloud 无 safeStorage 与本机交互前提 |
| 本地文件 | 任意路径读写、打开目录、上传本机路径字符串 | 路径泄漏、穿越与权限边界错误 |
| 任意网络/浏览器 | fetch URL、浏览器自动化、webhook、代理请求 | SSRF、数据外传和跨站权限风险 |
| 代码执行 | shell、JavaScript、Python、仓库脚本 | 远程代码执行与 Skill 供应链风险 |
| 本地设计方案运行 | `run_scheme` | Cloud Agent 只读官方 Skill；不接触 Desktop local runtime |
| 任意 GitHub Skill | `run_github_skill`、任意 repo URL | Cloud 只允许官方 registry |
| 权限管理 | 提高 scope、预算、允许模型、恢复 grant | Agent 不能提高自己的授权 |
| 密钥与会话 | 读 token/JWT/Cookie/API Key | 最小披露原则 |
| 破坏性账号动作 | 删账号、删云数据、撤销其他客户端 | 超出 Cloud Agent 产品范围 |

## 4. Scope 与授权

| Scope | 可见工具 | 默认 |
|---|---|---|
| `account:read` | status/account/models | 必需基础只读 |
| `prompts:read` | search/get prompt | 用户授权，可关闭 |
| `skills:read` | list/get skill | 用户授权，可关闭 |

- token audience 固定 Cloud MCP canonical resource；普通 REST Cookie 与 MCP bearer 不互换。
- scope 只缩小只读数据范围，不产生任何写入或花费能力。
- grant 暂停或撤销应立即阻断调用，不能等 access token 自然过期。
- 提高 scope 只能在 Musefold 用户 UI 中完成，并按账号安全策略重新认证。
- Desktop 与 Web 使用相同 Cloud 工具合同；Desktop 不把本地 Provider、文件或 Skills 注入 Cloud grant。

## 5. 官方 Skill 供应链

Cloud 只允许同时满足以下条件的 registry 条目：

- `status=published`；
- 官方或经明确审核的 publisher；
- 版本发布后不可变；
- Markdown 规范化后 content hash 固定；
- 输入是受限 JSON Schema；
- 内容不包含可执行附件；
- 发布记录可追溯 source commit、reviewer、时间与 hash。

`retired` Skill 不能用于新的 Agent 建议，但历史引用仍可按固定版本解释。调用流程为：

```text
list_skills
→ get_skill(id, version)
→ 客户端核对 contentHash
→ Agent 按 schema 收集输入并生成 prompt 建议
```

Skill Markdown 不在服务端执行。恶意指令出现时，仍会因工具不存在、只读 scope 和服务端 owner 校验而无法扩大权限。

## 6. 输入、输出与隐私

输入规则：

- 全部参数由 Zod/JSON Schema 限长、限枚举、限深度和 body 大小；
- Prompt 搜索与 Skill 输入有明确返回上限；
- 任意 URL、本地路径、owner id 和未声明字段一律拒绝，不静默忽略；
- 服务端从 token/session 推导 owner，不信任客户端 owner。

允许输出：

- 脱敏账号、额度与 capability；
- 官方模型目录的公开字段；
- 当前 owner 的云端 Prompt 文档；
- 官方 Skill 固定内容、schema、version 和 hash；
- 分析与优化后的 prompt 建议。

禁止输出：

- password、JWT、refresh/access token、Cookie、设备 bearer、API Key；
- 本地绝对路径、`file://`、bucket key、对象存储内部 endpoint；
- 未清洗上游响应、完整日志、内部 stack；
- 其他 owner 的存在性线索。

## 7. 审计、速率与故障隔离

每次调用只记录 request id、时间、tool、owner/grant 的不可逆标识、scope 决策、结果码、耗时和返回数量。不得记录完整参数、Prompt 正文、Skill 私有输入、token 或签名 URL。

- MCP route 单独限制 body、并发、账号速率与分页；
- Cloud MCP 可独立 kill switch，关闭时不影响 Web REST、GenerationGateway、Desktop local MCP 或本地数据；
- 单工具可由 rollout 下线；disabled 工具从 `tools/list` 消失；
- 只读 handler 不调用生成 worker、Provider、对象存储写入或 Prompt mutation service。

## 8. 白名单变更流程

任何工具名称、描述、参数、结果、scope、数据范围、Skill 行为或 rollout 变化必须：

1. 先更新本文件与功能矩阵；
2. 在 contracts/manifest 定义 schema 与 `readOnly` 元数据；
3. 做数据、权限、SSRF、供应链和审计威胁建模；
4. 更新 OAuth consent/connected apps UI；
5. 补 `tools/list` 精确集合、错 scope、撤销、owner 隔离和禁止类别测试；
6. 更新 MCP staging evidence；
7. 按 `CONTRIBUTING.md` 使用 `Skill-Impact: updated - <version>` 并同步官方 Skill；
8. 先灰度再公开，不允许服务端先静默注册。

内部重构只有在 `tools/list`、schema、语义、capability、数据范围和授权全部不变时，才可声明 `Skill-Impact: none - <具体理由>`。

## 9. 测试与发布门禁

自动化必须证明：

- manifest 与实际 `tools/list` 精确等于 7 个工具按 scope 过滤后的集合；
- 每个工具缺 scope、错 audience、过期或撤销 token 都拒绝；
- 7 个工具均为只读标注，handler 无 mutation/generation/provider 依赖；
- 所有禁止工具名和类别不存在；
- Prompt 注入或恶意 Skill 无法取得 token、文件、网络、写能力或花费能力；
- owner 隔离、分页上限、字段脱敏和审计无正文泄漏；
- `npm run test:cloud-mcp`、`npm run openapi:check`、`npm run test:integration:v1.1`、`npm run check` 全绿。

外部门禁：两个独立远程 MCP 客户端完成 OAuth、`tools/list`、Prompt/Skill 读取和 revoke；生产同构 HTTPS canonical resource 可用；官方 Skill version/hash 与 server registry、网站发布物一致；kill switch 演练成功。

## 10. 与本地 Agent 的关系

| 维度 | Cloud Agent | Local Agent |
|---|---|---|
| Transport | Streamable HTTP + OAuth | stdio + loopback Automation token |
| 数据 | 脱敏账号、官方模型、云 Prompt、官方 Skill | 本地库、Provider、文件、设计方案、固定 GitHub Skill |
| 写入/花费 | 无；交给用户可见 GenerationGateway | 按本地策略闸门、确认和预算 |
| Skill | 官方 registry，固定版本/hash | 本地正式方案或固定 commit 公共 Skill，仍不执行脚本 |
| 互通 | 不调用 local backend | 不接受 Cloud OAuth token |

两者可以共享 Prompt/Skill 契约语义，但不能共享 token、工具全集或信任边界。
