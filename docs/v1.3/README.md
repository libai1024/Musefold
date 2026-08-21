# Musefold v1.3

v1.3 是双端收敛版本。它不新增产品功能，交付的是：实体形状统一（contracts 成为唯一暴露给 UI 的实体形状）、状态分层（TanStack Query 接管服务端数据）、宿主编排收敛（页面编排 hook 下沉 product-ui）、巨型文件拆分与边界治理——目标是把「双端各写一套」的维护模式收敛为「一条变更路径」，降低双端开发难度与长期维护成本。

**当前进度（2026-08-21）**：Phase 0 与 Phase 1 完成；Phase 2 已完成 STATE-01~03 与 ORCH-01~04；SPLIT-01~04 已完成。REUSE-01 起继续。

## 文档

- [系统架构](./V13-ARCHITECTURE.md)
- [技术选型与决策](./V13-TECHNOLOGY-DECISIONS.md)
- [迁移计划](./V13-MIGRATION-PLAN.md)

## 核心结论

v1.2.2 之后，包级结构（DAG、六端口 gateway、机器边界）已经不是瓶颈。实测暴露的维护成本集中在五个代码级缺口，全部指向「双端开发要写两遍」或「边界没有机器强制」：

1. **双模型代价在类型暴露面而非存储层**。`DesktopExtras` 直通行模型，使 SQLite 行类型（`HistoryRecord` 等）经 IPC 泄入渲染层 store 与组件；Web 端的 PostgreSQL 行类型从未离开 `web-api`。两端对「存储形状是否上浮」处理不对称，每个新界面重复支付类型税。→ **ENT-A 类型层统一**：行模型降级为存储细节（depcruise 强制），`DesktopExtras` 返回 contracts 形状 + 桌面扩展组合类型；存储 schema 不动（ENT-B 留 v1.2.2 触发条件）。
2. **宿主编排仍是两套**（v1.2.2 缺口四未解）。Web `App.tsx`（约 1,373 行）与桌面 pages+stores 对同一批 product-ui 组件平行实现过滤、选择、分页、错误处理。→ **页面编排 hook 下沉 product-ui**（`useHistoryPageController` 等，对齐既有 controller 命名），宿主只剩路由挂载与平台差异。
3. **无服务端状态层**。全仓 0 个 query 库；18 个 zustand store 手写 `loading`/`error`/缓存/竞态。v1.2.2 D3 所写「Web 走 gateway + query cache」与现实不符。→ **双端引入 TanStack Query**，gateway 六端口即 queryFn 边界；Zustand 收敛为纯 UI state（persist middleware 统一持久化）。
4. **feature 边界名存实亡**。26+ 文件跨 feature 相对导入（design-schemes 深入 `generation/workbench/store`，workbench store 反向依赖 `account`/`history` store）。→ **depcruise `renderer-features-isolated`**：同层不互导，存量 baseline 只减不增；跨域共享物下沉 product-ui/domain。
5. **巨型文件在标记后继续增长**。`GenerationWorkbench.tsx`（2,932+ 行，14 个内联组件）、`workbench/store.ts`（1,932 行）、`SchemeRuntimeDetail.tsx`（1,131 行）等在 v1.2.2 文档点名后仍变大，证明无机器约束的尺寸共识不成立。→ **ESLint `max-lines-per-file` 棘轮** + SPLIT 任务卡逐个消化；拆出的 widget 模块多数上提 product-ui（复用顺带完成）。

## 范围

| 属于 v1.3 | 不属于 v1.3 |
|---|---|
| 实体类型层统一（ENT-A）：行模型 storage-only、`DesktopExtras` 签名文档化 | 实体存储靠拢（ENT-B）：schema 迁移、`prompts` 版本列（保留触发条件） |
| TanStack Query 双端引入，读路径 query 化，stores 收敛 UI state | 更换状态库（Redux 等）、统一双端状态库 |
| 页面编排 hook 下沉 product-ui，Web `App.tsx` 与桌面 pages/stores 复用同一编排层 | product-ui 平台中立性约束的放松（仍禁 `window.api`/`cloud-client`/`electron`/`desktop-contracts`） |
| 巨型文件拆分（工作台/方案详情/引导流）与 widget 上提 | 新增产品功能、改变任何用户可见行为 |
| `max-lines` 棘轮、feature 隔离规则、store 命名统一、ipc/preload 分域 | FSD 目录全量重排、新建 application 包、IPC 代码生成 |
| `docs/README.md` 权威序更新 | pnpm、React 19、Tauri（维持 v1.2.2 冻结） |

## 阶段总览

| 阶段 | 内容 | 依据 |
|---|---|---|
| Phase 0 治理地基 | GOV-01~04：尺寸棘轮、feature 隔离、命名统一、ipc/preload 分域 | **已完成（2026-08-21）** |
| Phase 1 实体统一 | ENT-01~04：行模型 storage-only 止血 → `DesktopExtras` 逐域文档化 → stores 类型切换 → `models.ts` 收缩 | **已完成（2026-08-21）** |
| Phase 2 状态与编排 | STATE-01~03 + ORCH-01~04：Query 引入与读路径迁移；编排 hook 下沉、`App.tsx` 拆解、桌面切换同一编排层 | **已完成（2026-08-21）** |
| Phase 3 拆分与复用 | SPLIT-01~04 + REUSE-01~03：工作台/store/方案详情拆分，widget 上提 product-ui，跨域组件下沉 | **进行中**：SPLIT-01~04 已完成 |

## 已知风险

| 风险 | 缓解 |
|---|---|
| ENT-A 逐域切换期间新旧形状并存造成混淆 | 逐域独立任务卡、切换即删行类型引用；depcruise 规则先行止血，新增泄漏在 CI 拦截 |
| Query 引入改变数据刷新时序，桌面 E2E 出现抖动 | 读路径按域迁移（history/library/account 先行），每卡跑桌面 E2E 与视觉门禁；Query 配置单点（`createMusefoldQueryClient`）便于统一调 retry/staleTime |
| 编排 hook 下沉后 product-ui 依赖面扩大 | 只增 `@tanstack/react-query` 一个外部依赖；depcruise 规则同步收紧其余禁令；host-boundary 测试双端各留断言 |
| 工作台拆分引入行为回归（2,932 行、72 处 store fan-in） | 按内联组件边界机械拆文件为第一步（零逻辑变更）；store 切片与 fan-in 收敛随后分卡；每卡 E2E + 视觉门禁 |
| `max-lines` 棘轮与日常开发冲突 | baseline 只登记存量超标文件，新文件即受约束；存量清单随 SPLIT 卡消化，不要求日常开发顺手拆 |
