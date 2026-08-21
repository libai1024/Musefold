# Musefold v1.3

v1.3 是双端收敛版本。它不新增产品功能，交付的是：实体形状统一（contracts 成为唯一暴露给 UI 的实体形状）、状态分层（TanStack Query 接管服务端数据）、宿主编排收敛（页面编排 hook 下沉 product-ui）、巨型文件拆分与边界治理——目标是把「双端各写一套」的维护模式收敛为「一条变更路径」，降低双端开发难度与长期维护成本。

**当前进度（2026-08-21）**：Phase 0~3 全部任务卡（GOV/ENT/STATE/ORCH/SPLIT/REUSE）已完成，24 个提交，全部门禁绿；交付数据与经验见文末[交付总结](#交付总结2026-08-21)。

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
| Phase 3 拆分与复用 | SPLIT-01~04 + REUSE-01~03：工作台/store/方案详情拆分，widget 上提 product-ui，跨域组件下沉 | **已完成（2026-08-21）**：feature 互导 0、双端共享 product-ui 符号 64 个、桌面渲染层尺寸棘轮清零 |

## 已知风险

| 风险 | 缓解 |
|---|---|
| ENT-A 逐域切换期间新旧形状并存造成混淆 | 逐域独立任务卡、切换即删行类型引用；depcruise 规则先行止血，新增泄漏在 CI 拦截 |
| Query 引入改变数据刷新时序，桌面 E2E 出现抖动 | 读路径按域迁移（history/library/account 先行），每卡跑桌面 E2E 与视觉门禁；Query 配置单点（`createMusefoldQueryClient`）便于统一调 retry/staleTime |
| 编排 hook 下沉后 product-ui 依赖面扩大 | 只增 `@tanstack/react-query` 一个外部依赖；depcruise 规则同步收紧其余禁令；host-boundary 测试双端各留断言 |
| 工作台拆分引入行为回归（2,932 行、72 处 store fan-in） | 按内联组件边界机械拆文件为第一步（零逻辑变更）；store 切片与 fan-in 收敛随后分卡；每卡 E2E + 视觉门禁 |
| `max-lines` 棘轮与日常开发冲突 | baseline 只登记存量超标文件，新文件即受约束；存量清单随 SPLIT 卡消化，不要求日常开发顺手拆 |

风险实际发生情况：Query 时序抖动出现过（history/settings 若干 E2E 断言依赖旧刷新时机），按「改断言查 DOM、不把字段镜像回 store」处理；工作台拆分未出现行为回归（机械拆分 + 视觉门禁）；棘轮与日常开发未起冲突。

## 交付总结（2026-08-21）

### 数字

| 指标 | v1.3 前 | 现在 |
|---|---|---|
| feature 互导边（depcruise baseline） | 69 | **0**（known-violations 为空文件） |
| 渲染层 `desktop-contracts/models` import | 存量泄漏 | **0**（规则 error） |
| `max-lines` baseline 条目 | 23 | **12**，其中 `apps/desktop/src` **0** |
| Web `App.tsx` | 1,201 行 | 258 行 |
| `workbench/store.ts` | 1,932 行 | 99 行（切片 facade） |
| `GenerationWorkbench.tsx` | 2,932 行 | 43 行（装配壳） |
| 双端共同消费的 product-ui 导出 | 未度量 | 64 个（棘轮化） |
| `npm run lint` | 78 error（未进门禁） | 0，已进 `check` |
| 门禁 | typecheck/test/build | + lint、+ 3 类回潮守卫测试 |

用户可见行为：无变更（全程以桌面 E2E 222 项、Web E2E 19 项、共享视觉门禁为准绳）。

### 有效的做法

1. **先立机器约束，再改代码**。GOV 卡先把规则和 baseline 落地（`renderer-features-isolated`、`max-lines` 棘轮、行模型禁令），后续每张卡只需把 baseline 往下压。人类共识（v1.2.2 已点名巨型文件）在 v1.3 前反而继续增长，机器棘轮上线后再没反弹。
2. **baseline 归零而不是删机制**。空的 known-violations 文件仍在门禁链路里，一眼能看出「当前冻结了几条」；配合 `tests/repo/boundary-baselines.test.ts` 禁止两类规则重新进 baseline，比删掉规则文件更抗回潮。
3. **消除耦合先看模块性质**。纯函数下沉、写副作用外移、读入口收口，三条通道优先级从高到低（架构 §6.6）。只有第三条是「把边搬个位置」。
4. **过程度量要能被 CI 读出来**。「复用频率」落成 `product-ui-dual-host-reuse.test.ts` 的共享符号计数（当前 64，只增不减），比在文档里写「已复用」有约束力。
5. **E2E 断言查 DOM，不查被迁走的 store 字段**。STATE/SPLIT 把状态挪进 Query 后，几处读 store 的断言静默失效；一律改查渲染结果，既修好又更贴近意图。

### 踩过的坑

1. **只跑相关 E2E 子集会漏**。REUSE-03 跑全量才发现 `test_28` 自 SPLIT-03 起就失效。**收口卡必须跑全量**，中间卡跑子集要明确记录「未跑全量」。
2. **拆分留下的死代码不会自己消失**。SPLIT-01/02 之后积累 78 个 `no-unused-vars`（一处 57 个死解构），因为 `lint` 当时不在 `check` 里。拆分卡应当当场清理，或先把 lint 纳入门禁。
3. **陈旧的门禁脚本会静默失真**。`check-shared-ui-boundaries.mjs` 曾指向 SPLIT-01 已改名的文件，规则形同虚设。移动文件时要同步 grep 所有门禁脚本与守卫测试里的硬编码路径——`file-size-ratchet` 现在会校验 ESLint 静音清单与 baseline 键集一致，就是为堵这类漂移。
4. **CSS 媒体查询与 React state 不同步**。同一断点，遮罩用 CSS 类随视口同步翻转，`role` 要等 `matchMedia` 回调加一次渲染。E2E 里跨这两者的断言必须轮询。

### 遗留

最大的一条：**图库与历史页仍是双端各写一套**——工作台已经双端共享，这两个页面没跟上，ORCH 卡下沉的是 controller，视图组合没下沉。其余包括 ENT-B（SQLite schema 迁移）、Web 手写 CSS 与桌面 Tailwind 未统一、`max-lines` 尾部 12 条（表单库那条已于同日裁定：不引入，沉 `useDraftForm`）。完整清单与各自的触发条件见[迁移计划 §8](./V13-MIGRATION-PLAN.md)。
