# Musefold v2.1 Web / Desktop Parity 系统架构

> **状态**：目标架构冻结；capability v2 与 Desktop 同步登录硬门禁基础批次实施中
>
> **日期**：2026-08-27
>
> **范围**：共享产品合同、宿主能力例外、数据来源、同步启用边界、Cloud Agent / Skills 安全面
>
> **目的**：让同一 cloud-safe 能力在 Web 与 Desktop 只有一条契约与编排路径，同时保留 Desktop local-first 和浏览器 cloud-first 的诚实差异

## 0. 结论摘要

v2.1 在 v1.3 的“共享实体 + Query + page-controller”和 v2.0 的共享空间/响应式基线上增加一层**产品一致合同**：

1. **一致性的单位是能力，不是页面截图**。同一能力必须共享业务名、输入输出、状态、错误、动作权限与验收；视觉仍由共享 surface 门禁约束。
2. **宿主差异只能来自 capability**。本地文件、安全存储、SQLite 离线写、Electron 窗口与浏览器 Web Share/OAuth 回跳是合法差异；同一能力因历史原因写了两遍不是例外。
3. **来源是实体的一等上下文**。共享实体形状仍来自 contracts；`local | cloud | synced` 是资源来源/可用动作上下文，不允许用第二套实体表达。
4. **Desktop 账号登录与数据上传分离**。登录、注册或账号切换完成后，同步开关一律保持关闭；只有登录后的用户显式开启才允许 bootstrap 与 push。
5. **Cloud Agent 使用闭合白名单**。Cloud MCP 不按本地 MCP 的工具全集做减法，而只注册 7 个读取账号、模型、Prompt 与官方 Skill 上下文的只读工具；写入与花费动作不属于 Agent 工具面。
6. **兼容发布先于切换**。服务端与 contracts 先扩展兼容，Desktop/Web 再逐域切换，最后才允许 contract 清理；同步数据只前滚，不做破坏性回滚。

## 1. 当前基线与本版本修订

### 1.1 已有资产

- `packages/contracts` 是唯一实体规范形状，web-api 出入参由 Zod 校验。
- `packages/domain` 提供共享业务规则与 Gateway 端口。
- `packages/product-ui` 已承载共享组件、Query key 与 page-controller。
- Web 通过 cloud-client / HTTPS 访问 PostgreSQL；Desktop 通过 IPC / core 访问 SQLite，并有提示词 outbox 增量同步。
- Cloud MCP 当前在 web-api 内注册账号、提示词、官方 Skill、生图与历史工具；本地 MCP/Automation 是另一信任边界。
- v2.0 已冻结 `760px` compact shell、`680px` phone/触控/软键盘与大屏共享几何。

### 1.2 仍需解决的问题

| 问题 | 影响 | v2.1 处理 |
|---|---|---|
| “双端一致”没有可审计能力目录 | 单端功能可在实现中自然长出 | parity catalog + host exception registry + repo 守卫 |
| 页面共享不代表动作/状态共享 | 同一按钮在两端错误、刷新和权限语义不同 | capability + controller + error/state 合同单点 |
| 本地与云端记录来源未形成统一产品语义 | UI 可能展示不可执行动作，或把云资产当本地文件 | provenance 上下文 + capability action gating |
| Desktop 同步只有 `enabled` 布尔值 | 无法清楚表达首次未决定、暂停、鉴权阻塞 | 账号级 consent 状态机，兼容现有 enabled 数据 |
| Cloud MCP 工具由注册代码事实形成 | 新工具可能绕过文档、scope 或 Skill 评审 | 精确 allowlist manifest 与 tools/list 契约测试 |

## 2. Parity 的判定模型

一项能力只有同时满足六个维度才算一致：

| 维度 | 必须一致的内容 | 允许差异 |
|---|---|---|
| Capability | 能否做、前置条件、不可用原因 | capability 明确为宿主专属 |
| Contract | 实体、命令、错误码、幂等与版本语义 | transport envelope |
| Orchestration | Query key、mutation、失效、分页、冲突与重试 | 端口实现、缓存介质 |
| Product state | loading/empty/error/disabled/conflict/approval | 宿主环境状态，如 offline、safeStorage unavailable |
| Surface | 信息架构、控件语义、动作名称、响应式形态 | Electron titlebar、Web safe-area 等 shell 胶水 |
| Evidence | 单测、双端 E2E、共享视觉或显式例外测试 | 平台专属 E2E 驱动方式 |

“两个页面看起来相似”不等于 parity；“共用一个组件但各自解释动作”也不等于 parity。

## 3. 目标分层

```text
contracts
  canonical entities + command/result schemas + error codes
        ↑
domain
  parity capability catalog + pure rules + Gateway ports
        ↑
product-ui
  page-controllers + Query/mutation + shared product surfaces
        ↑
        ├─ Web host
        │    cloud gateway → cloud-client → HTTPS → web-api/PostgreSQL
        │    browser capabilities: OAuth redirect, Web Share, download, safe-area
        │
        └─ Desktop host
             composite gateway
               ├─ local ports → IPC → core/SQLite/local Provider/files
               └─ cloud ports → opaque desktop session → web-api/PostgreSQL
             desktop capabilities: offline DB, safeStorage, filesystem, windows
```

### 3.1 共享层职责

- contracts 定义数据和命令的规范形状；类型一律由 schema 推导。
- domain 定义“这个能力需要什么 capability”和纯业务规则，不读取平台 API。
- product-ui 负责相同能力的编排与表面；平台差异通过显式 props/ports/capabilities 注入。
- 宿主只适配 transport、shell 与白名单内的能力差异，不重写共享业务流程。

### 3.2 禁止的捷径

- 在 product-ui 内检测 `window`、Electron、UA 或平台字符串后走两套业务分支。
- 为本地/云端各定义一套形状相近的产品实体。
- 因某端暂未接入就把共享动作复制到宿主，形成永久双实现。
- 以“Web 做不到本地文件”为由隐藏整个历史/工作台能力；应只禁用依赖本地文件的动作。

## 4. Capability 与 Host Exception

### 4.1 Capability 规则

每个用户动作必须能回答：

1. capability id 是什么；
2. 数据来源允许哪些值；
3. 当前宿主是否支持；
4. 不支持时是隐藏、禁用还是提供替代动作；
5. 哪个测试证明两端一致或例外成立。

capability 只描述能力，不携带 UI 文案。共享 controller 根据 capability 决定动作集合，组件只渲染 controller 给出的可用性与原因。

### 4.2 Host exception 登记字段

每个例外至少登记：

| 字段 | 含义 |
|---|---|
| `id` | 稳定标识，如 `HX-DESKTOP-FILESYSTEM` |
| `surface` | 受影响产品面 |
| `capability` | 被豁免的一致能力 |
| `host` | `desktop` 或 `web` |
| `reason` | 真实平台限制，不写“暂未实现” |
| `fallback` | 隐藏/禁用/替代动作及用户可见结果 |
| `dataBoundary` | 不得跨越的数据边界 |
| `evidence` | 专属测试或矩阵行 |
| `reviewTrigger` | 浏览器/产品能力变化后何时复审 |

没有登记的差异按缺陷处理。`V21-FEATURE-HOST-MATRIX.md` 是人类权威，实施时由 `GOV-01` 落成可供 repo test 读取的机器清单。

### 4.3 合法例外类别

- Desktop local-first：SQLite 离线读写、本地 Provider、safeStorage、本地文件路径、Finder/Explorer、窗口与托盘。
- Web cloud-first：HttpOnly Cookie、浏览器 OAuth 回跳、Web Share、对象存储签名 URL、后台 worker。
- 数据可用性：local-only 资产没有 HTTPS URL；cloud-only 资产没有本地绝对路径。
- 安全策略：Cloud Agent 无本地文件、Provider 设置、任意 GitHub Skill、写 Prompt 或直接生图等能力；设计方案本身属于双端产品面，但 Agent 只能读取官方 Skill 上下文；本地 MCP 不能复用 Cloud OAuth grant。

“开发成本高”“另一端以后再做”“现有代码不同”不是合法例外。

## 5. 数据来源与动作能力

### 5.1 来源定义

| 来源 | 权威存储 | 可离线 | 典型资源 |
|---|---|---|---|
| `local` | Desktop SQLite / 本地文件 | 是 | 未启用同步的提示词、本地 Provider 生图、设计方案 |
| `cloud` | PostgreSQL / 私有对象存储 | Web 可读缓存但不可离线提交 | Web 会话、云任务、Cloud MCP 结果 |
| `synced` | 云版本为跨设备并发权威，Desktop 保留 SQLite 副本与 outbox | Desktop 是 | 已启用同步的 Prompt/Folder/Tag |

来源不取代实体 schema。需要桌面扩展时继续使用 v1.3 的组合类型；路径、设备游标和同步状态不得进入云端规范实体。

### 5.2 动作决策示例

| 动作 | `local` | `cloud` | `synced` |
|---|---|---|---|
| 编辑提示词 | Desktop 本地事务 | Web/云 mutation | Desktop outbox 或 Web mutation，均带版本 |
| 打开图片所在目录 | Desktop 且有受管本地路径 | 不可用 | 仅本地副本存在时可用 |
| 下载图片 | 本地另存 | 签名 URL 下载 | 按实际 asset capability |
| 冲突处理 | 不适用 | Web 409 编辑冲突 | Desktop 三选一，结果回云端 |
| Agent 读取 | 本地 MCP 按本地授权 | Cloud MCP 按 OAuth scope | Cloud MCP 只读云端规范副本 |

共享 UI 不根据路径字符串猜来源；来源和 capability 必须由 gateway/controller 显式提供。

## 6. 各产品域的目标路径

### 6.1 账号与设置

账号摘要、额度、兑换、Cloud Agent 连接管理共用 contracts/controller/surface。Desktop 另有同步、本地 Provider、Automation、更新等设置 section；Web 不显示无法执行的本地设置，但账号与连接策略语义不得分叉。

### 6.2 提示词库

Prompt/Folder/Tag 的 CRUD、搜索、置顶、回收站、版本冲突与恢复是 parity 能力。Desktop 的“永久删除本地记录”只有在云墓碑与同步状态允许时才作为 host exception；不能用本地硬删绕过云端保留策略。

### 6.3 工作台与生成

会话、草稿、生成提交、取消、重试、终态、保存提示词和额度刷新共用编排语义。Provider 选择、参考图来源和结果动作由 capability 决定：Desktop 可以使用本地 Provider/文件；Web 使用云模型、上传资产和签名 URL。

### 6.4 历史与资产

列表、状态、详情、重试、取消、保存提示词、软删/恢复与来源标签一致。成本统计、文件管理、虚拟化可按矩阵登记例外；同一云任务在两端必须使用同一状态与费用单位。

## 7. Desktop 同步边界

Desktop 登录成功不得直接产生 bootstrap、push 或上传本地提示词。账号变化只做：

1. 在改动账号凭据前停 scheduler、abort transport，并关闭旧 owner 同步；
2. 验证新会话是否是支持 Musefold Cloud 的身份；
3. 激活账号级本地同步上下文，同时强制 `enabled=false`；
4. 广播“已登录、同步未启用”的 UI 状态；
5. 只有用户在当前登录会话显式开启后才允许调度同步。

普通 App 重启不视为重新登录；若凭据会话未变化，可按持久化开关恢复运行。登录、注册、登出再登录和账号切换则必须再次显式开启。

完整状态机、旧 `enabled` 数据迁移、首次合并和回滚见 [Desktop 同步与数据迁移](./V21-DESKTOP-SYNC-AND-DATA-MIGRATION.md)。

## 8. Cloud Agent / Skills 边界

Cloud Agent 与本地 Agent 是两套后端能力面，共享产品语义但不共享信任前提：

```text
Cloud Agent → OAuth grant/scopes/budget → cloud-safe application services
Local Agent → stdio + loopback token/policy → Electron/core/local files
```

Cloud 工具只能来自精确只读 allowlist，工具 scope、数据上限和审计都是合同的一部分。Agent 不获得写 Prompt、生图、取消任务、调整 scope 或预算的工具；用户确认的生成继续通过可见的 GenerationGateway 完成，Skill 不能扩大工具能力。完整清单见 [Cloud Agent / Skills 白名单](./V21-CLOUD-AGENT-SKILLS-ALLOWLIST.md)。

## 9. 兼容发布顺序

```text
A. 守卫与观测，不改行为
B. contracts/API/schema expand，旧客户端继续工作
C. Desktop sync consent 迁移，默认不上传
D. 各产品域逐卡切换到共享合同
E. Cloud Agent allowlist/Skill 发布同步
F. 双端与跨设备灰度
G. 至少一个兼容窗口后 contract 清理
```

- PostgreSQL 继续遵守 expand/contract：写行与 drop 不同迁移。
- SQLite 升级前保留自动备份；迁移只扩展元数据，不改 Prompt 正文与本地路径。
- 新客户端必须能读旧服务端兼容响应；旧客户端必须能在新服务端继续核心流程。
- 回滚优先关闭新读/写路径，不回滚已确认的云版本、outbox、冲突和墓碑。

## 10. 架构恒真式

1. contracts 仍是唯一产品实体形状。
2. product-ui 不依赖 platform API、cloud-client、desktop-contracts 或本地路径。
3. cloud-safe parity 能力不得出现双宿主平行 controller。
4. 所有 host exception 必须登记、可测试、可复审。
5. 登录、授权、同步启用是三个独立决定，不能互相隐式推导。
6. 未确认同步时，不注册设备、不 bootstrap、不 seed 上传 outbox、不发 prompt snapshot。
7. 密钥、本地绝对路径、设备 bearer、OAuth token 不进入渲染层、同步 payload、Agent 结果或日志。
8. Cloud Agent 未列入 allowlist 的工具不注册；Skill 不执行代码。
9. 花费动作必须经过幂等、预算或审批；模型不能提高自己的权限。
10. 发布回滚不得丢用户本地数据、未推送 mutation、冲突或云墓碑。

## 11. 决策记录

| 决策 | 结论 | 替代方案为何不采用 |
|---|---|---|
| D1 Parity 单位 | 以 capability contract 为单位 | 只按页面对齐会遗漏错误、动作与数据语义 |
| D2 共享层 | 继续 contracts/domain/product-ui，不新建 application 包 | v1.3 已证明 page-controller 在 product-ui 可控 |
| D3 宿主差异 | allowlist exception | 默认允许差异会重新形成双实现 |
| D4 来源模型 | 统一实体 + provenance/capability 上下文 | 平行 Local/Cloud 实体违反 contracts 单源 |
| D5 同步启用 | 登录后显式选择，账号级持久化 | 登录即上传违反 local-first 与用户预期 |
| D6 旧数据 | 保守迁移，无法证明选择时保持不上传 | 猜测启用会造成不可逆数据外发 |
| D7 Agent 工具 | 精确 Cloud allowlist | 从本地全集排除容易漏掉高权限工具 |
| D8 Skill | 官方、已发布、固定版本/hash、无代码 | 任意 URL/脚本不可审计且扩大供应链面 |
| D9 迁移 | expand/兼容/contract | 单批切换无法支持旧客户端和可靠回滚 |
| D10 发布 | capability/同步/Agent 独立 kill switch | 一个总开关无法定位数据与安全故障域 |

## 12. 相关文档

- [功能与宿主例外矩阵](./V21-FEATURE-HOST-MATRIX.md)
- [Desktop 同步与数据迁移](./V21-DESKTOP-SYNC-AND-DATA-MIGRATION.md)
- [Cloud Agent / Skills 白名单](./V21-CLOUD-AGENT-SKILLS-ALLOWLIST.md)
- [交付计划](./V21-DELIVERY-PLAN.md)
- [v1.3 系统架构](../v1.3/V13-ARCHITECTURE.md)
- [v1.1 提示词同步协议](../v1.1/V11-PROMPT-CLOUD-SYNC.md)
- [v1.1 Cloud MCP 与 Skills](../v1.1/V11-CLOUD-MCP-AND-SKILLS.md)
