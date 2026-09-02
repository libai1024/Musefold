# Musefold v2.5 — 全栈推倒重做

> **状态**:已批准,实施中(基线 tag:`v2.5-baseline`)
>
> **日期**:2026-08-28
>
> **性质**:技术栈、系统架构、CI/CD、测试与门禁的整体重置。这是一次版本文档先行的大重构,按仓库惯例(参照 v1.3 / v2.1)以本目录为唯一事实源。

## 目标

一次开发页面与交互,复用到四个交付面:

| 交付面 | 宿主 | 说明 |
|---|---|---|
| Windows 桌面 | Electron 43 | 保留壳与主进程语义,渲染层与构建链重做 |
| macOS 桌面 | Electron 43 | 同上,签名/公证通道沿用 |
| PC Web | Next.js 16.3(单应用) | App Router,自适应大屏布局 |
| Mobile Web | Next.js 16.3(同一应用) | 同一套页面组件,自适应移动布局 |

复用的单位是**包**:`packages/features`(页面级产品模块)+ `packages/ui`(shadcn/ui 组件)被两个薄宿主消费;宿主只做路由挂载、壳与数据接缝注入。

## 与 v2.1 的关系

- v2.1 的进行中实现已全部随 `v2.5-baseline` 入库,**v2.1 交付计划终止**,不再继续实施。
- v2.1 冻结的六条产品/安全语义被 v2.5 原样继承(见架构文档「不随推倒消失的语义」)。
- v2.1 的治理机器(capability 目录、host exception 登记、parity 守卫、14 个 repo 门禁)随 v2.5 退役。

## 文档索引

| 文档 | 内容 |
|---|---|
| [V25-ARCHITECTURE.md](./V25-ARCHITECTURE.md) | 目标技术栈(含版本核查依据)、仓库形状、分层与数据流、决策记录 |
| [V25-DELIVERY-PLAN.md](./V25-DELIVERY-PLAN.md) | M0–M5 交付批次、卡片、验收标准与回退 |
| [V25-DATA-MIGRATION.md](./V25-DATA-MIGRATION.md) | 桌面 SQLite、PostgreSQL、账号体系、热更通道四条数据线 |
| [V25-UI-SPEC.md](./V25-UI-SPEC.md) | 渲染层唯一基准:壳与各屏布局、状态矩阵、交互约定、组件复用矩阵、与旧版差异登记 |
| [V25-FEATURE-DEV-GUIDE.md](./V25-FEATURE-DEV-GUIDE.md) | 实践指南(非规范):新功能六层走线(契约→接缝→features→双端→挂载)、复用与测试范式、效率与坑清单、端到端 checklist |
| [V25-MIGRATION-CARDS.md](./V25-MIGRATION-CARDS.md) | 实施台账(非规范):v2.1→v2.5 全功能迁移卡、依赖、状态、证据与冻结边界 |
| [V25-OLD-NEW-DIFF.md](./V25-OLD-NEW-DIFF.md) | 审计报告(非规范):旧版 `v2.5-baseline` 与当前实现的技术栈/代码量/逐屏 UI 与交互对比,含未迁清单与缺口 |
| [ui-parity/](./ui-parity/README.md) | **逐屏对照系列(16 篇)**:Codex 级质感基线(00,C 系列增益语汇)+ 主界面/侧栏/工作台/提示词库/历史/设计方案/设置(8 分区),每屏组件+布局+交互+动效+UIUX 五维对照与带优先级任务清单;UI/UX 交互任务的基石依据 |

## 实施期间的权威顺序

1. 当前源码与自动化测试;
2. 本目录(v2.5 目标,已批准);
3. 旧文档(`docs/v2.1` 及更早)仅作历史参考,与本目录冲突时以本目录为准;已迁移域的旧规范即时作废。

实施完成后(M5),根 `AGENTS.md` / `CLAUDE.md` 与 `docs/README.md` 权威顺序整体重写。
