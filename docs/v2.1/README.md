# Musefold v2.1：Web / Desktop 产品一致迁移

> **状态**：架构与范围已批准并冻结；capability v2 与 Desktop 登录同步硬门禁基础批次实施中，完整产品迁移未完成
>
> **日期**：2026-08-27
>
> **版本性质**：产品能力收敛与数据边界治理版本，不在文档批次提前修改桌面版本号

v2.1 把 Web 与 Desktop 从“共享组件较多、能力仍按宿主演进”推进到“共享产品合同优先、宿主差异必须登记”。一致不表示把 Electron 和浏览器做成同一种运行时，也不表示登录后自动上传本地数据；它表示同一项 cloud-safe 产品能力只有一份契约、编排、状态语义和验收标准，差异只能来自明确的宿主能力与数据来源。

## 文档

| 文档 | 作用 |
|---|---|
| [Parity 系统架构](./V21-PARITY-ARCHITECTURE.md) | 一致性定义、目标分层、数据来源、capability/exception 机制、迁移顺序与架构恒真式 |
| [功能与宿主例外矩阵](./V21-FEATURE-HOST-MATRIX.md) | 每项能力的双端目标、当前差距、允许的 host exception 与验收口径 |
| [Desktop 同步与数据迁移](./V21-DESKTOP-SYNC-AND-DATA-MIGRATION.md) | 登录后显式启用同步状态机、首次合并、兼容策略、发布顺序、回滚与数据不丢失规则 |
| [Cloud Agent / Skills 白名单](./V21-CLOUD-AGENT-SKILLS-ALLOWLIST.md) | 7 个只读工具、scope/数据上限、GenerationGateway 隔离、Skill 供应链边界与变更流程 |
| [交付计划](./V21-DELIVERY-PLAN.md) | Phase 0–5 全部执行卡、依赖、文件所有权、验收层级、回滚、发布门禁与 Skill-Impact |

## 版本范围

| 属于 v2.1 | 不属于 v2.1 |
|---|---|
| Web / Desktop 共享能力目录与 host exception 机器白名单 | 用 Web 模拟本地文件系统、safeStorage、Electron 窗口或本地 Provider |
| 账号、工作台、提示词库、历史、设置中 cloud-safe 能力的产品语义对齐 | 强制把本地 Provider、API Key、本地图片路径、桌面设计方案上传云端 |
| shared contracts / domain / product-ui / page-controller 单路径收敛 | 新建平行实体、平行页面状态机或按 `platform ===` 复制业务分支 |
| Desktop 登录后显式选择是否启用提示词同步；每次登录均保持关闭 | 登录即默认上传、登录后恢复旧开启状态、退出登录时删除本地数据 |
| 本地与云端记录在共享视图中的来源标识与能力降级 | 把所有历史图片自动迁移到对象存储，或把云任务伪装成本地文件 |
| Cloud Agent / Skills 精确工具白名单与发布审计 | 任意 URL Skill、仓库脚本执行、shell、任意网络或文件读取工具 |
| expand/contract、灰度、kill switch、兼容与回滚门禁 | React 19、Tauri、pnpm、utilityProcess、ENT-B 无关 schema 重构 |
| 每张源码卡的 Skill-Impact 判定 | 在本批文档中提前修改 `apps/desktop/package.json` 的 `version` |

## 冻结结论

1. **共享合同优先**：cloud-safe 能力默认双端一致；新增单端差异必须先登记到矩阵，不能由实现自行形成事实。
2. **宿主例外是白名单**：只有本地文件、系统安全存储、离线数据库、浏览器 OAuth/分享、后台云任务等真实能力差异可以例外。
3. **数据来源显式**：`local`、`cloud`、`synced` 不互相伪装。共享组件消费统一文档形状，同时通过 capability 决定动作是否可用。
4. **同步必须主动启用**：Desktop 登录只建立“可选择同步”的账号上下文；首次上传和 bootstrap 必须由用户显式确认。
5. **登录后保持关闭**：账号登录、注册、登出再登录或账号切换都将该 owner 的同步开关置为关闭；只有登录后的用户显式操作可以再次开启。普通 App 重启不等同于重新登录。
6. **Cloud Agent 默认闭合**：工具注册采用精确白名单；Skill 只读已发布、固定版本、固定 hash、无代码内容。
7. **服务器先兼容、客户端后切换**：数据与 API 演进走 expand → 双版本兼容 → contract；contract 不与首次客户端切换同批。
8. **迁移可停、数据不可逆删**：回滚靠功能开关、读路径回退和停止同步；不得靠删除 outbox、冲突、墓碑或本地原始记录恢复旧版。

## 阶段总览

| 阶段 | 卡片 | 交付结果 |
|---|---|---|
| Phase 0 合同与守卫 | `GOV-01…03` | parity catalog、host exception 白名单、Cloud Agent 工具白名单机器化 |
| Phase 1 数据与同步 | `DATA-01…03`、`SYNC-01…03` | 来源模型、兼容迁移、显式同步状态机、首次合并与冲突恢复 |
| Phase 2 共享产品面 | `PAR-01…04` | 账号/设置、提示词库、工作台、历史按共享合同收敛 |
| Phase 3 Agent / Skills | `AGENT-01…03` | 7 工具只读注册、官方 Skill 固定版本、GenerationGateway 隔离与审计闭环 |
| Phase 4 QA 与灰度 | `QA-01…03` | 双端矩阵、跨设备与断网场景、迁移/回滚演练 |
| Phase 5 发布收口 | `REL-01…03` | 兼容发布、灰度放量、文档与 Skill-Impact 证据收口 |

详细依赖、文件所有权和逐卡门禁见[交付计划](./V21-DELIVERY-PLAN.md)。基础批次已开始实施 capability v2 与 Desktop 同步登录硬门禁；其余卡片状态以交付计划和当前源码、测试为准，不得根据目标态推断完整迁移已经完成。

## 上游与接棒关系

- v1.3 的 contracts 单一实体、TanStack Query、page-controller 与 feature 隔离继续作为分层基线；v2.1 不重开这些选型。
- v1.4/v2.0 的共享视觉、响应式断点与交付卡格式继续有效；v2.1 只增加能力一致、宿主例外和数据来源维度。
- v1.1 的提示词同步协议和 Cloud MCP 安全模型是当前实现基线；v2.1 对“首次启用状态”和“工具白名单治理”作增量接棒，未被本文明确修订的协议条款继续有效。
- v0.4 的本地 Automation / MCP / CLI 安全边界继续有效；Cloud Agent 不复用本地文件与 Provider 能力。
