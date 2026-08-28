# Musefold v2.1 Web / Desktop 产品一致迁移交付计划

> **状态**：`DOC-01` 已完成；`GOV-01/GOV-02` capability 基础、`SYNC-02/SYNC-03` 登录硬门禁基础批次进行中；其余迁移、产品面、Agent、QA 与发布卡未开始
>
> **日期**：2026-08-27
>
> **范围**：执行 [Parity 架构](./V21-PARITY-ARCHITECTURE.md)、[功能矩阵](./V21-FEATURE-HOST-MATRIX.md)、[Desktop 同步与数据迁移](./V21-DESKTOP-SYNC-AND-DATA-MIGRATION.md)、[Cloud Agent / Skills 白名单](./V21-CLOUD-AGENT-SKILLS-ALLOWLIST.md)
>
> **读法**：本文件是 v2.1 执行卡唯一登记处，只回答“按什么顺序、改哪些边界、怎样验收、怎样回滚、是否影响 Skill”。实现中如需改变冻结结论，先修对应架构文档再改源码。

## 0. 交付原则

1. **文档与守卫先行**。先机器化 parity/exception/tool allowlist，再迁数据与产品面；不能靠评审记忆维持一致。
2. **服务器 expand 在前，客户端切换在后，contract 最后**。旧 Desktop/Web 在兼容窗口内必须可用。
3. **登录不代表同步同意**。任何 `unset/paused` 路径的网络请求都视为 P0 数据安全缺陷。
4. **逐域切换、切换即删重复**。账号、库、工作台、历史按卡迁移；一张卡内消除该域平行 controller/store 语义。
5. **Host exception 只走白名单**。新增差异先登记 `HX-*`、fallback、数据边界和 evidence。
6. **数据迁移只前滚**。回滚功能和读写路径，不删除 outbox/conflict/tombstone/consent 或用户内容。
7. **Agent 权限默认闭合**。未列工具不注册；Skill 不能扩大 scope/预算/工具；所有花费留在用户可见 GenerationGateway，并继续遵守幂等与确认边界。
8. **每张源码卡独立 Skill-Impact**。只要触及 App 源码就按 `CONTRIBUTING.md` 写 trailer；Agent 对外面变化必须 `updated`。
9. **状态只登记事实**。未执行的命令不预写为通过；测试数字只在卡完成时回填。
10. **版本号留给发布卡**。实现卡不修改 `apps/desktop/package.json` 的 `version`；即使进入 REL，也按发布流程与真实产物协调，禁止提前占号。

## 1. 验收层级

| 层级 | 内容 | 命令/证据 |
|---|---|---|
| L0 | 文档、格式与 repo 守卫 | `git diff --check`；适用 `vitest run tests/repo/...` |
| L1 | 就地单测、typecheck、边界 | `npm run check` 中对应段；包/域定向 Vitest |
| L2 | contracts/API/数据库 | `npm run openapi:check`、`npm run test:integration:v1.1`、SQLite migration/core tests |
| L3 | Web 产品路径 | `npm run check:v1.1`、`npm run test:e2e:web` |
| L4 | Desktop 产品/数据路径 | 先 `npm run build`，再定向/全量 `pytest tests/e2e/...` |
| L5 | 共享产品面 | `npm run test:visual:shared` + 功能矩阵逐行 evidence |
| L6 | 真实环境/发布 | 两台 Desktop + Web、两个远程 MCP 客户端、staging、CI/deploy、rollback drill |

每张卡只要求声明的层级，但触及共享 UI 必须包含 L5；触及 contracts/web-api 必须包含 L2；触及主进程同步必须包含 L4。

## 2. 阶段总览

| 阶段 | 卡片 | 依赖 | 结果 | 状态 |
|---|---|---|---|---|
| 文档基线 | `DOC-01` | 无 | v2.1 完整权威文档与总索引 | 已完成 |
| Phase 0 合同与守卫 | `GOV-01…03` | DOC-01 | parity/exception/Agent allowlist 机器约束 | GOV-01/02 基础进行中 |
| Phase 1 数据与同步 | `DATA-01…03`、`SYNC-01…03` | GOV 卡 | 兼容数据来源与显式同步状态机 | SYNC-02/03 基础进行中 |
| Phase 2 产品面一致 | `PAR-01…05` | DATA/SYNC 对应卡 | 账号、库、工作台、历史、响应式动作收敛 | 未开始 |
| Phase 3 Agent / Skills | `AGENT-01…03` | GOV-03、DATA-01 | 7 工具只读白名单、官方 Skill、GenerationGateway 隔离与审计 | 未开始 |
| Phase 4 QA 与回滚 | `QA-01…03` | 全部实现卡 | 双端、跨设备、安全与回滚证据 | 未开始 |
| Phase 5 发布 | `REL-01…03` | QA 全部 | 兼容上线、灰度、外部门禁与文档收口 | 未开始 |

依赖图：

```text
DOC-01
  ├─ GOV-01 ─┬─ DATA-01 ─→ DATA-02 ─→ DATA-03 ─┬─ PAR-02
  │          │                                  ├─ PAR-03
  │          └─ GOV-02 ─────────────────────────┼─ PAR-04
  ├─ SYNC-01 ─→ SYNC-02 ─→ SYNC-03 ────────────└─ PAR-01
  └─ GOV-03 ─→ AGENT-01 ─→ AGENT-02 ─→ AGENT-03

PAR-01…04 ─→ PAR-05
全部 PAR/AGENT ─→ QA-01 ─┬─ QA-02
                          └─ QA-03
QA-01…03 ─→ REL-01 ─→ REL-02 ─→ REL-03
```

`SYNC-01` 实际开工仍要求 `GOV-01` 已合并，图中省略交叉边以保持可读。

## 3. 文档基线

### DOC-01 v2.1 权威文档

**状态：已完成（2026-08-27）。只修改文档。**

- 创建 `docs/v2.1/`：版本范围、Parity 架构、功能/host exception 矩阵、Desktop 同步与数据迁移、Cloud Agent/Skills 白名单、完整交付计划。
- 更新 `docs/README.md` 当前基线与权威顺序。
- 对 `docs/frontend/DEVELOPMENT-GUIDE.md` 做最小前瞻说明：v2.1 已批准但目标态仍按卡实施，当前代码事实优先。
- `CONTRIBUTING.md` 已完整覆盖 App 源码 trailer 与 Agent Skill 发布，不为纯文档批次重复改写。
- 文件所有权：`docs/v2.1/**`、`docs/README.md`、必要时 `docs/frontend/DEVELOPMENT-GUIDE.md`。
- 验收：L0，至少 dev-guide freshness 与适用 repo docs tests；确认 git diff 只有文档，且不触碰现有未跟踪文件。
- 回滚：删除 v2.1 新目录并还原索引/规范增量；无数据与运行时影响。
- Skill-Impact：纯文档，无 App 源码，提交时可不写 trailer；本任务不提交。

## 4. Phase 0：合同与机器守卫

### GOV-01 Parity catalog 与 Host Exception registry

**状态：未开始。依赖 DOC-01。**

- 在 domain 或 tooling 落可序列化 parity capability catalog；为每项记录 surface、hosts、来源、fallback、exception id 与 evidence id。
- 把 `HX-*` 精确清单机器化；repo test 校验：exception id 唯一、矩阵闭合、无“temporary/暂未实现”理由、每个 `H/N` 都有测试证据。
- 不在 catalog 放 UI 文案，不引入平台 API。
- 文件所有权：`packages/domain/src/capabilities*`、`tooling/`、`tests/repo/`、对应就地 tests。
- 验收：L1；探针新增未登记单端 capability 必须先红后绿；边界 0 新豁免。
- 回滚：revert catalog/守卫提交；不影响运行时行为。
- Skill-Impact：大概率 `none`，理由必须说明仅增加内部 parity 元数据、未改变 CLI/MCP/Automation/capabilities 对外响应；若对外 capabilities 读取该 catalog，则改为 `updated`。

### GOV-02 共享来源、可用性与错误语义

**状态：未开始。依赖 GOV-01。**

- 在 contracts/domain 定义最小 provenance/capability/error 语义；来源作为上下文或组合，不造 Local/Cloud 平行实体。
- controller 只接显式 capability，不做 UA/platform 探测；不可用原因使用稳定 code，文案留 product-ui。
- repo/depcruise 守卫禁止 product-ui 新增平台探测与宿主 client 依赖。
- 文件所有权：`packages/contracts`、`packages/domain`、`packages/product-ui` 基础 controller/types、`tooling/`、就地 tests。
- 验收：L1、L2（若 contracts 出入参变化）；旧响应无新字段仍能 parse。
- 回滚：optional/default 字段可停止消费；不删除扩展字段。
- Skill-Impact：若 capabilities/API 对 Agent 可见则 `updated`；否则 `none` 并逐项说明工具/参数/授权未变。

### GOV-03 Cloud Agent allowlist manifest 与守卫

**状态：已完成。依赖 DOC-01。**

- 建立单一 manifest：7 个只读 tool name、scope、schema 引用、数据上限与 rollout 状态。
- Cloud MCP 注册只能遍历/引用 manifest；repo test 精确校验 `tools/list`，禁止本地工具、写入工具和生成/花费工具进入 Cloud。
- 增加白名单基数、禁止工具名、readOnly 注解、Skill 版本/hash 的契约测试。
- 当前实现：`apps/web-api/src/modules/mcp/manifest.ts` 是唯一 Cloud 注册源；`tools/list` 按授权 scope 与 rollout 输出子集；OAuth consent 按客户端请求 scope 授权。
- 文件所有权：`apps/web-api/src/modules/mcp/`、必要的 `packages/contracts`、`tests/repo/`、staging scripts。
- 验收：L1、L2；7 工具逐项正例，禁止类别逐项负例；manifest 守卫、按 scope 的 tools/list 和 OAuth 子集授权测试通过。
- 回滚：关闭 manifest rollout，恢复当前只读集合；不得临时开放额外工具。
- Skill-Impact：若 tools/list/schema/描述/行为保持完全相同，可 `none` 并写精确理由；任何可见变化必须 `updated`。

### Phase 0 完成条件

- parity 与 exception 能被测试读取；新增差异无登记即 CI 红。
- Cloud tools/list 精确闭合；本地工具不可能通过普通 import 被 Cloud 注册。
- 共享实体无平行来源模型，product-ui 平台中立规则继续为 0 违规。

## 5. Phase 1：数据与 Desktop 同步

### DATA-01 Provenance 与能力合同 expand

**状态：未开始。依赖 GOV-01、GOV-02。**

- 为 Prompt/Generation/Asset/Session 的消费上下文增加来源与动作 capability；优先从 gateway 返回组合 view model，不污染 canonical entity。
- 定义 local path 与 signed URL 互斥/可并存规则；Web 永不收到绝对路径。
- contracts 新字段只能 optional/default 兼容；schema 注释写旧客户端/新客户端双向行为。
- 文件所有权：`packages/contracts`、`packages/domain`、desktop runtime mappers、cloud-client、web-api 对应 DTO/service tests。
- 验收：L1、L2；mapper 逐字段；旧 fixture 可读；敏感字段泄漏扫描。
- 回滚：停止消费新上下文，服务端/数据库保留 expand 字段。
- Skill-Impact：Agent 结果形状若变化则 `updated`；只内部 UI view model 可 `none`。

### DATA-02 Cloud/API/PostgreSQL 兼容扩展

**状态：未开始。依赖 DATA-01。**

- 按产品域增加 parity 所需服务能力，统一版本/错误/幂等语义；迁移只 expand，不 drop/rename。
- web-api、worker、cloud-client、OpenAPI 同批；旧 Web/Desktop 客户端继续核心读写。
- 所有 owner 查询保持 RLS/owner 条件；asset 只发短期签名 URL。
- 文件所有权：`apps/web-api/src/modules/{account,prompts,workbench,generation,sync,mcp}`、migrations、worker、cloud-client、contracts/OpenAPI。
- 验收：L1、L2；expand/contract 守卫、真 PostgreSQL、旧请求 fixture 兼容。
- 回滚：服务/客户端回旧读路径；schema 前滚保留。
- Skill-Impact：触及 Cloud MCP 可见 API/成本/能力时 `updated`，否则逐卡判定。

### DATA-03 双端 Gateway 与 Query 失效收敛

**状态：未开始。依赖 DATA-02。**

- Web cloud gateway 与 Desktop composite gateway 对同一 domain port 提供同形结果；本地扩展只走 capability/组合。
- Query keys、mutation 终态、account/history/library/workbench 失效路径单点；删除宿主重复刷新链。
- transport 错误映射到稳定 ApiErrorCode，不在组件里解析字符串。
- 文件所有权：`packages/domain`、`packages/product-ui/src/page-controllers`、`apps/web/src/runtime`、`apps/desktop/src/runtime`、就地 tests。
- 验收：L1、L3、L4；竞态、断线、重复 mutation 与终态刷新测试。
- 回滚：按域切回旧 adapter；保留兼容端口直到 PAR 域完成。
- Skill-Impact：通常 `none`；若 Automation/MCP 复用端口且可见行为变化则 `updated`。

### SYNC-01 SQLite consent expand 迁移

**状态：未开始。依赖 GOV-01。**

- 增加 `consent_state/decided_at/version`；保留旧 `enabled`。
- 旧行按文档证据分类为 enabled/paused/unset；迁移事务化并由现有升级前备份保护。
- repository 提供 consent API 与双列兼容写；业务表/正文/路径零变更。
- 文件所有权：`packages/core/src/db/migrations`、`run-migrations.ts`、`packages/core/src/sync/repository.ts`、就地 migration/repository tests。
- 验收：L1、L2、L4 定向；旧库各类 fixture、升级/降级、幂等、备份恢复。
- 回滚：生产不执行破坏性 down；旧客户端继续用 `enabled`。开发期 down 只能在无真实 consent 数据时使用。
- Skill-Impact：`none`，须说明本地存储迁移不改变 Agent 工具面；如 status capabilities 暴露新状态则评估 `updated`。

### SYNC-02 主进程显式状态机

**状态：未开始。依赖 SYNC-01、DATA-02。**

- account reconciliation 按 owner 激活上下文；每次登录/注册/换号均 stop/abort 并强制 `enabled=false`，未显式开启不创建 client/session、不访问 `/sync/*`。
- 实现 awaiting_consent/enabling/idle/syncing/conflict/auth_blocked/error 派生态与 pause-after-boundary。
- 首次启用严格执行 register → bootstrap → pull → seed → push → pull；同一账号会话普通重启可恢复，重新登录仍需再次显式开启。
- kill switch 与 consent 分离；关闭功能不篡改用户决定。
- 文件所有权：`apps/desktop/electron/{account,cloud-sync}`、IPC/preload/desktop-contracts 必要增量、core engine tests。
- 验收：L1、L2、L4；网络 spy 证明未确认 0 请求；换号、重启、崩溃、撤销、离线恢复。
- 回滚：关闭新状态机读路径，兼容 `enabled` 继续运行；保留新列和元数据。
- Skill-Impact：cloud sync status/capability 若被 Automation/MCP 暴露则 `updated`；否则 `none` 需说明。

### SYNC-03 首次启用、暂停与冲突 UI

**状态：未开始。依赖 SYNC-02、PAR-01 可同卡协调。**

- 登录后显示明确范围、将上传的本地活动记录计数、不上传项、冲突策略与两个命令。
- 不用默认开启 toggle 代表同意；unset、paused、enabled 的文案和动作可区分。
- 显示 pending/conflict/error/auth_blocked；冲突三选一不降级。
- UI 只经 DesktopExtras/controller，不直连 preload。
- 文件所有权：Desktop account/settings feature、必要的 product-ui account surface、就地 tests。
- 验收：L1、L4、L5；登录未确认、暂不启用、启用、暂停/恢复、重启与冲突 E2E。
- 回滚：隐藏新 consent surface，回旧开关；新状态与数据保留。
- Skill-Impact：通常 `none`，理由为 UI/同步 consent 不改变 Agent 能力；若 connected capability 改动则重新判断。

### Phase 1 完成条件

- 未确认同步的账号在启动、登录、聚焦、resume、本地 mutation 后均为 0 sync 请求。
- 旧 enabled/disabled 数据分类与降级兼容通过；owner 不串线。
- cloud-safe entity/view model 与来源/动作能力可由双端同一 controller 消费。
- 所有 API/DB 扩展仍兼容旧客户端，无 contract/drop。

## 6. Phase 2：共享产品面一致

### PAR-01 账号、设置与连接管理

**状态：未开始。依赖 DATA-03、SYNC-03。**

- 账号摘要、额度、兑换、连接策略共用 controller/surface；错误、重认证、Query 失效一致。
- Desktop 注入同步/Provider/Automation host sections；Web 不渲染假入口。
- logout 清敏感 Query 与 transport，不删除本地/云创作数据。
- 文件所有权：`packages/product-ui/src/account|settings`、双端账号宿主、account page-controller。
- 验收：L1、L3、L4、L5；功能矩阵账号行逐项 evidence。
- 回滚：按 surface 回旧宿主壳，数据端口保持兼容。
- Skill-Impact：connected apps/capabilities 若改变 Agent 授权呈现，通常 `updated`；纯 surface 可 `none`。

### PAR-02 提示词库全能力合同

**状态：未开始。依赖 DATA-03、SYNC-03。**

- CRUD、Folder/Tag、搜索/排序/置顶、回收站/恢复、冲突与 asset capability 共用 controller。
- Desktop local-only 与 synced 使用同一 Prompt 文档；同步状态是上下文。
- 永久删除遵守云墓碑/本地清理边界；不再有单端无登记动作。
- 文件所有权：contracts/domain library ports、product-ui library/controller、双端宿主、core/web-api 对应服务。
- 验收：L1–L5；跨设备删除/恢复/冲突；本地路径 HTTP 泄漏为 0。
- 回滚：按 library feature flag 回旧读写；不删除云版本/outbox。
- Skill-Impact：Cloud MCP search/get/save schema/行为变化必 `updated`；否则说明不影响。

### PAR-03 工作台与生成合同

**状态：未开始。依赖 DATA-03。**

- 会话/草稿、参数校验、Prompt 引用、估价、提交、取消、重试、终态额度刷新同一编排语义。
- Provider/model/reference/asset action 由 capability 注入；共享组件不探测平台。
- Web upload + cloud job 与 Desktop 受管路径 + local/cloud job 都映射同一状态词表。
- 文件所有权：contracts/domain generation/workbench、product-ui controllers/surfaces、双端 runtime/hosts、web-api/worker、Desktop generation adapters。
- 验收：L1–L5；成功/失败/取消/断线/重试/重复提交/额度刷新；参考图白名单。
- 回滚：按 generation source 切回旧 adapter；已创建 job 继续可查询，不重复调用 Provider。
- Skill-Impact：生成工具参数、能力、成本、状态或 Skill 引用变化必 `updated`。

### PAR-04 历史与资产合同

**状态：未开始。依赖 DATA-03、PAR-03。**

- 列表/详情/来源/状态/费用/筛选/取消/重试/存提示词/软删恢复共用 controller。
- 本地文件动作、Web Share、签名 URL、成本统计按 `HX-*` gating。
- 同一 cloud job 两端显示同一状态、费用单位和 Skill 来源。
- 文件所有权：product-ui history/controller、双端 history hosts、domain/contracts、asset adapters。
- 验收：L1–L5；共同数据集结果相同，宿主动作只在 capability 成立时出现。
- 回滚：回旧 history adapter/surface；保留 canonical job 数据。
- Skill-Impact：历史/资产产品合同变化若影响 Agent 可读 Prompt 上下文或 capability 则 `updated`；Generation job/history 不属于 v2.1 Agent 工具面。

### PAR-05 响应式、动作与文案收口

**状态：未开始。依赖 PAR-01…04。**

- 按 760/680/390 契约逐面核对导航、Prompt 全页子状态、History sheet、Settings、Account、Workbench。
- 核对所有动作名、disabled reason、empty/error/conflict/approval 状态与 icon；差异必须指向 `HX-*`。
- 共享 surface 变更同卡双端完成，不保留跨卡像素分叉。
- 文件所有权：`packages/product-ui`、`packages/ui`、双端宿主样式胶水、E2E/visual contracts。
- 验收：L3、L4、L5；Light/Dark、键盘/触控、无横向溢出、焦点恢复、减少动效。
- 回滚：按 surface revert；不改数据/API。
- Skill-Impact：通常 `none`，需说明只改 UI/响应式；capability 可见性变化则按实际更新。

### Phase 2 完成条件

- 功能矩阵所有 `P` 行具有自动化或明确外部 evidence；所有差异能指向 `HX-*`。
- cloud-safe 功能不再存在双宿主平行 controller；product-ui 平台中立门禁为 0 违规。
- shared visual 全绿，阈值未因 parity 迁移被无理由放宽。

## 7. Phase 3：Cloud Agent / Skills

### AGENT-01 精确只读工具注册与 scope

**状态：未开始。依赖 GOV-03、DATA-01。**

- 7 个只读工具全部从 manifest 注册并按 scope 可见；禁止类别从 tools/list 不可达。
- audience、Cookie/bearer 隔离、grant 暂停/撤销、Origin/Host/body/并发限制保持。
- Agent 不依赖 Prompt mutation、generation worker、Provider、对象存储写入或本地 runtime。
- 文件所有权：web-api mcp/oauth、contracts、Cloud MCP tests、staging scripts。
- 验收：L1、L2、L6 staging；tools/list 精确集合、错 scope/audience/revoke 全拒。
- 回滚：关闭 manifest rollout并恢复只读集合；不开放写入或花费工具。
- Skill-Impact：如果纯内部重构且外部完全不变可 `none`；实际 tools/list/描述/schema/scope 变化必须 `updated`。

### AGENT-02 官方 Skill registry 与固定快照

**状态：未开始。依赖 AGENT-01。**

- published-only、不可变 version、content hash、input schema、retired 历史可读/新任务不可用。
- generation 持久化 Skill id/version/hash/inputs/final prompt snapshot；服务端不执行 Markdown。
- 发布 pipeline 记录 source commit/reviewer/hash，并验证 server/website Skill 一致。
- 文件所有权：web-api mcp/skills、generation persistence、migrations（如需 expand）、网站 Skill 与发布脚本。
- 验收：L1、L2、L6；恶意 Markdown、hash mismatch、retired、schema 负例。
- 回滚：停止新 Skill 使用；历史 snapshot 保留可读。
- Skill-Impact：`updated - <version>`，同一 App 提交同步官方 Skill 与版本常量。

### AGENT-03 GenerationGateway 隔离、审计与 kill switch

**状态：未开始。依赖 AGENT-01、PAR-03。**

- Agent 只返回 prompt/参数建议，不保存 Prompt，不创建、等待、重试或取消 generation。
- 用户可见 GenerationGateway 重新校验模型、参数、估价与幂等，并承载所有费用确认和任务状态。
- Agent 不能修改 scope/预算/模型；提高权限只在用户 UI 重认证。
- 审计只记安全元数据；Cloud MCP/tool 独立 kill switch 演练。
- 文件所有权：web-api oauth/mcp、domain/product-ui generation gateway、integration/staging tests。
- 验收：L2、L3、L6；tools/list 无写入/花费工具，Agent handler 无 generation/provider 依赖，用户确认前 0 上游调用。
- 回滚：停 Cloud Agent 或单只读 tool；不影响 GenerationGateway 和已有 job。
- Skill-Impact：`updated - <version>`，因为 Agent 工具面与授权语义属于强制更新面。

### Phase 3 完成条件

- Cloud tools/list 只有精确白名单；所有禁止类别负例通过。
- Skill 版本/hash/inputs 可追溯且从不执行代码。
- 两个真实远程 MCP 客户端完成 OAuth、只读 `tools/list`、Prompt/Skill 上下文读取和 revoke。

## 8. Phase 4：QA、兼容与回滚

### QA-01 功能矩阵自动化验收

**状态：未开始。依赖全部 PAR/AGENT 卡。**

- 把矩阵每个 `P/H/N` 映射到 test/evidence id；repo test 禁止遗漏、重复或孤立 exception。
- 双端共用数据 fixture，验证结果集合、动作可用性、错误和状态一致。
- 执行全仓、Web、Desktop、视觉、OpenAPI、Postgres 门禁。
- 文件所有权：`tests/repo`、双端 E2E、visual scripts、docs 状态登记。
- 验收：L0–L5 全部；只登记实际输出。
- 回滚：测试/守卫不回滚以放行缺陷；修实现或经架构评审修改矩阵。
- Skill-Impact：测试-only 可不写；同提交含源码按源码卡决定。

### QA-02 跨设备、离线与冲突验收

**状态：未开始。依赖 SYNC-03、PAR-02、QA-01。**

- 两台真实 Desktop + Web：首次启用、双向 CRUD、离线并发、三种冲突结果、墓碑、cursor expired、撤销设备、换号。
- 覆盖升级旧 enabled 数据、降级旧客户端、崩溃恢复与大 outbox。
- 文件所有权：E2E harness/fixtures、staging evidence 登记；不把真实凭据写仓库。
- 验收：L6；fixture 只能预检，不能替代真实设备。
- 回滚：出现内容丢失/串号立即停 sync rollout；保留数据库和日志安全证据。
- Skill-Impact：测试/evidence-only 可不写。

### QA-03 安全与回滚演练

**状态：未开始。依赖 AGENT-03、QA-01。**

- 演练 parity 域开关、sync transport、单 Cloud tool、Cloud MCP 总开关、service rollback、旧客户端兼容。
- 扫描日志/HTTP/MCP 结果无 key/token/path/prompt payload；验证 owner/RLS 隔离。
- 验证回滚不删除 consent/outbox/conflict/tombstone/reservation/job/Skill snapshot。
- 文件所有权：deploy/release scripts（如需）、integration/staging tests、交付计划 evidence。
- 验收：L2、L6；每个 kill switch 有前后状态与恢复记录。
- 回滚：演练失败即阻塞 REL，不通过降低测试要求解决。
- Skill-Impact：若新增/改变外部回退行为或 capabilities，按实际 `updated`；证据-only 不写。

### Phase 4 完成条件

- 矩阵闭合、全部本地自动门禁全绿。
- 真实跨设备与两个远程 MCP 客户端门禁完成。
- 所有 kill switch 和降级路径证明不丢数据、不串 owner、不重复花费。

## 9. Phase 5：发布与收口

### REL-01 兼容服务端与 expand schema 上线

**状态：未开始。依赖 QA-01、QA-03。**

- 先部署 web-api/worker/contracts 兼容版本与 PostgreSQL expand migration；旧客户端 smoke。
- Cloud MCP 默认保持当前白名单/ask_each_time，新增能力按 tool rollout 关闭。
- 登记 SHA、迁移版本、健康检查、旧 Web/Desktop/MCP 客户端证据。
- 文件所有权：deploy pipeline、web-api/worker release config、本文发布记录。
- 验收：L6；CI 成功的 main SHA 才部署。
- 回滚：回滚 service 镜像；expand schema 保留。
- Skill-Impact：按随发布的 App 源码卡 trailer；未公开新 Agent 行为时不伪造 updated。

### REL-02 Desktop/Web 灰度与同步放量

**状态：未开始。依赖 REL-01、QA-02。**

- Web parity 面先灰度；Desktop consent/state machine 按账号/版本分批开放。
- 监测 unset 0 请求、bootstrap、outbox、conflict、owner mismatch、Agent budget/approval。
- 安装包版本只在真实构建发布卡按既有流程修改；本计划不预定具体版本号。
- 文件所有权：feature rollout/config、release evidence、真实下载 catalog（仅真实产物到位时）。
- 验收：L6；观察窗无数据/安全 P0，回滚演练可用。
- 回滚：按域/同步/Agent 独立开关关闭；不做 schema down。
- Skill-Impact：若 Agent 新行为随版本公开，必须 `updated - <version>` 并验证发布物一致。

### REL-03 Contract、文档与 Skill 收口

**状态：未开始。依赖 REL-02。**

- 逐行关闭功能矩阵，更新当前状态与真实数字；修 `DEVELOPMENT-GUIDE` 为已实施事实。
- 核对官方 Skill、server manifest、网站 Skill、版本常量与 `Skill-Impact` trailer。
- contract migration 只在兼容窗口与最低客户端条件满足后另批执行；未满足则登记为后续，不阻塞诚实的 v2.1 首发结论。
- `docs/README.md` 将 v2.1 标为已实施；v1.1 被接棒章节加注记。
- 文件所有权：docs、Skill 发布物、contract migration（如条件满足）、release evidence。
- 验收：L0–L6；`release:preflight`/Skill check/全门禁与外部 evidence。
- 回滚：文档状态只按事实回退；contract 未满足不执行，已执行后只前滚修复。
- Skill-Impact：docs-only 无 trailer；同批含 Skill/App 源码必须 `updated`。

## 10. 发布门禁

v2.1 宣布产品一致迁移完成前，缺一不可：

1. 功能矩阵所有 `P` 行有 evidence，所有差异只来自登记的 `HX-*`。
2. `npm run check`、`check:v1.1`、Web E2E、Desktop E2E、shared visual 全绿。
3. contracts/web-api 改动的 OpenAPI 与真 PostgreSQL 集成全绿；迁移遵守 expand/contract。
4. 新登录账号未确认同步时所有 `/sync/*` 请求为 0；既有 enabled/paused/unset 升降级兼容通过。
5. 两台真实 Desktop + Web 的首次合并、离线冲突、墓碑、换号、设备撤销与 cursor expired 完成。
6. Cloud MCP `tools/list` 精确等于 7 个只读工具按 scope 过滤结果；禁止写入、生成、花费和本地工具。
7. 两个独立远程 MCP 客户端完成 OAuth、Prompt/Skill 上下文读取和 revoke；GenerationGateway 仍要求用户可见确认。
8. Cloud Agent/Skill 无代码执行、任意网络、本地路径、凭据或跨 owner 数据；审计不记录敏感 payload。
9. parity、sync、Cloud MCP/tool kill switch 与 service rollback 全部演练，且不丢数据、不重复花费。
10. 所有 App 源码提交有准确 `Skill-Impact`；Agent 可见变化与官方 Skill/版本同步。
11. 真实发布产物到位前不修改桌面版本号或下载 catalog；发布后版本事实源一致。
12. `docs/README.md`、v2.1 状态和 DEVELOPMENT-GUIDE 只写已发生事实。

## 11. 风险与复审触发器

| 风险 | 缓解 | 触发后动作 |
|---|---|---|
| parity 被理解为“所有本地能力都上云” | capability/source/exception 三层合同 | 出现 Key/path/本地方案上传需求即暂停，单独安全评审 |
| 旧 enabled 数据误判导致静默上传 | 保守分类 + unset 0 请求测试 | 任一误上传证据立即停 sync rollout |
| 双端共享组件但动作语义仍分叉 | controller/action catalog + 矩阵 evidence | 差异无 HX 即按缺陷修复 |
| expand schema 与旧客户端不兼容 | 服务端先行、旧客户端 smoke、contract 延后 | 回滚服务读路径，schema 保留 |
| owner 切换串 outbox | owner 级 consent/repository/transport 隔离 | 全局停同步，禁止自动改 owner 数据 |
| Agent 工具白名单漂移 | manifest 单源 + tools/list 精确测试 | 下线额外工具、撤销 grant、审计影响 |
| Skill 提示注入扩大权限 | 工具不存在/服务端 scope/预算强制 | Skill 下线但保留历史 snapshot |
| GenerationGateway 重试重复花费 | 用户确认后使用稳定幂等键 + reservation + 任务状态机 | 停生成提交入口，保留 job/reservation 对账；Cloud Agent 无 spend tool |
| 回滚被误做成数据 down migration | kill switch + 前滚 schema | 阻止 down，发布修复版本 |
| 测试规模拖慢每卡 | 按 L0–L6 分层，中间卡定向、QA/REL 全量 | 不删门禁；优化 fixture/层触发 |

## 12. Skill-Impact 决策表

| 改动 | 预期声明 |
|---|---|
| 纯文档/测试/CI 且提交无 App 源码 | 可不写 trailer |
| 共享 UI、同步内部、数据库迁移，确认 CLI/MCP/Automation/capabilities/成本/授权均不变 | `Skill-Impact: none - <逐项核对后的具体理由>` |
| Cloud/Local MCP tools/list、名称、描述、schema、结果、错误、capabilities | `Skill-Impact: updated - <version>` |
| CLI 命令/参数、Automation API、setup/回退行为 | `Skill-Impact: updated - <version>` |
| Agent 成本单位、预算、审批、scope、授权或兼容回退 | `Skill-Impact: updated - <version>` |
| 官方/内置 Skill、Skill version/hash/registry 行为 | `Skill-Impact: updated - <version>` |

`none` 不是默认模板。每张源码卡在 PR/提交前必须实际核对本地 MCP、Cloud MCP、CLI、Automation API、capabilities、成本、授权、安装更新与兼容回退。

## 13. 相关文档

- [v2.1 README](./README.md)
- [Parity 系统架构](./V21-PARITY-ARCHITECTURE.md)
- [功能与 Host Exception 矩阵](./V21-FEATURE-HOST-MATRIX.md)
- [Desktop 同步与数据迁移](./V21-DESKTOP-SYNC-AND-DATA-MIGRATION.md)
- [Cloud Agent / Skills 白名单](./V21-CLOUD-AGENT-SKILLS-ALLOWLIST.md)
- [v2.0 Web 对齐交付计划](../v2.0/V20-WEB-ALIGNMENT-DELIVERY-PLAN.md)
- [v1.3 迁移计划](../v1.3/V13-MIGRATION-PLAN.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
