# Musefold v1.3 技术选型与决策

> **状态**：v1.3 选型冻结
>
> **日期**：2026-08-21
>
> **目的**：记录 v1.3「降低双端开发难度与维护复杂度」涉及的架构决策，明确对 v1.2.2 既有决策（D3/D7）的修订与解冻理由，避免重复讨论

v1.2.2 交付了双端 monorepo 基线：包级 DAG、桌面 Gateway 六端口、depcruise 机器边界。v1.3 不重开任何运行时选型（Electron/Fastify/Vite/React/npm 全部维持 v1.2.2 冻结结论），只处理 v1.2.2 留下的结构性候选：实体统一、宿主编排收敛，以及本轮实测暴露的代码级债务（巨型文件、feature 互导、手写缓存）。

## 0. 冻结结论

| 决策点 | 结论 | 类型 |
|---|---|---|
| D1 实体统一 | 两档推进：ENT-A 类型层统一（contracts 为唯一暴露给 UI 的实体形状，行模型降级为存储细节）立即执行；ENT-B 存储靠拢（schema 迁移）保留 v1.2.2 触发条件 | 解冻并修订 v1.2.2 D7 |
| D2 服务端状态 | 双端引入 TanStack Query；读路径 query 化，缓存/去重/失效/竞态不再手写 | 修订 v1.2.2 D3 |
| D3 编排层归属 | 页面级编排 hook 下沉 `packages/product-ui`（组件 + controller + 编排 hook 三位一体）；不新建 application 包 | 新增 |
| D4 feature 边界 | renderer `features/*` 互导由 depcruise 禁止，存量 baseline 冻结只减不增 | 新增 |
| D5 文件尺寸治理 | ESLint `max-lines-per-file` 棘轮：baseline 冻结当前超标清单，只减不增，清单清零后启用固定阈值 | 新增 |
| D6 状态分工 | Zustand 收敛为纯 UI state（选中/草稿/面板），持久化统一 `persist` middleware；服务端数据一律 TanStack Query | 新增 |
| D7 契约面治理 | `ipc.ts` 与 preload 按域拆分模块，契约类型单源；不引入代码生成 | 新增 |

## 1. 约束

- 维护主体仍是小团队；v1.2.1 发布链路、v1.2.2 边界规则与 E2E/视觉门禁语义不变。
- 不改变任何用户可见行为；每张任务卡独立合并、独立可回滚（沿用 v1.2.2 总原则）。
- `packages/product-ui` 约 1.1 万行、被双端消费且有像素级视觉门禁，是最高价值资产；任何决策不得削弱它的平台中立性（禁 `window.api`、`cloud-client`、`electron`、`desktop-contracts`）。
- 桌面主进程 + `packages/core` 约 3 万行 Node 代码与 SQLite 迁移谱系不动（ENT-B 之前）。

## 2. D1 实体统一：两档推进，修订 v1.2.2 D7

v1.2.2 D7「mapper 收口、不做实体统一」的前置条件是「云同步在真实多设备环境稳定运行」，其设想的数据层改造（SQLite 行模型向 `PromptDocument` 靠拢，含 `prompts` 表版本列迁移）风险确实不应轻动。但执行期暴露的事实是：**双模型的代价不在存储层，在类型暴露面**。`DesktopExtras` 直通行模型使 SQLite 行类型（`HistoryRecord` 等）经 IPC 泄入渲染层 store 与组件，而 Web 端的 PostgreSQL 行类型（kysely）从未离开 `web-api`——两端对「存储形状是否上浮」的处理是不对称的，桌面为此每个新界面重复支付类型税。

因此把「实体统一」拆成两档：

- **ENT-A 类型层统一（本版本执行）**：`packages/contracts` 文档形状是唯一允许出现在 product-ui、renderer store 与组件中的实体形状。`desktop-contracts` 行模型降级为存储细节，只允许 `packages/core`、主进程与 `runtime/mappers/` 引用（depcruise 强制）。`DesktopExtras` 的返回形状逐域从行模型改为「contracts 形状 + 桌面扩展字段」的组合类型（如 `GenerationJob & { localImagePath?: string; costUnit: CostUnit }`），不再出现与云语义平行但形状不同的整套类型。SQLite schema、行模型定义、mapper 的存在全部不变。
- **ENT-B 存储靠拢（保留 v1.2.2 触发条件）**：`prompts` 表版本列、时间戳语义对齐等 schema 迁移，仍以「云同步在真实多设备环境稳定运行」为前置，届时方向不变：行模型向 contracts 靠拢。

**结论**：ENT-A 不动存储，只收类型暴露面，风险是逐域可回滚的类型切换；它消解了 D7 当年「强行统一等于一次数据层改造」的顾虑，因为改造的对象从数据层缩小到边界签名。

## 3. D2 服务端状态：双端引入 TanStack Query

v1.2.2 D3 描述 Web 状态为「gateway + query cache」，实际全仓（desktop/web/product-ui）无任何 query 库——缓存、loading/error 标志、去重、失效、竞态全部手写散布在 18 个 zustand store 中（`loading`/`error`/`statsLoading`/`statsError` 逐字段重复）。这是文档与现实的最大偏差，也是 D3「两端差异被压缩到缓存策略一层」没有兑现的原因：两端的「缓存策略」各自手写且互不相同。

**结论**：双端统一引入 TanStack Query。gateway 六端口天然构成 queryFn 边界（`useQuery({ queryKey: ['history', query], queryFn: () => gateway.listGenerationHistory(query) })`）。`product-ui` 导出 `createMusefoldQueryClient()` 配置工厂（默认 staleTime、重试、错误边界约定单点定义），双宿主各自实例化，共享编排 hook 依赖注入的 QueryClient 行为一致。选 TanStack Query 而非 SWR：mutation + 失效链路是一等公民，与「写操作后精确失效」的桌面库/历史语义匹配。

不采用：RTK Query（引入 Redux 违背 D6 分工）；继续手写（竞态与失效 bug 面持续扩大）。

## 4. D3 编排层归属：下沉 product-ui，不新建 application 包

宿主编排重复（v1.2.2 缺口四）的现状：Web `App.tsx`（约 1,373 行）与桌面 pages+stores 是接同一批 product-ui 组件的两套平行编排——过滤、选择、分页、错误处理、动作分发在两端各写一份。收敛方向有两个候选：

| 候选 | 评估 |
|---|---|
| 新建 `packages/application` | 边界最「纯」，但 product-ui 已有 `useWorkbenchSessionController` 等 controller 层，编排 hook 与 controller 天然连续，拆两个包会把同一抽象层次切成两半，还要新增包边界与依赖规则 |
| 扩展 `product-ui` 为「组件 + controller + 页面编排 hook」 | 与既有 controller 命名连续（`useHistoryPageController` 对齐 `useWorkbenchSessionController`）；依赖面只增 `@tanstack/react-query` 一个外部库，平台中立性约束不变 |

**结论**：编排 hook 下沉 product-ui。前提是 D2 先行——编排 hook 内部用 `useQuery`/`useMutation` 取数，才能平台无关；这也是 STATE 先于 ORCH 的排序依据。product-ui 的 depcruise 规则同步放宽：允许 `@tanstack/react-query`，继续禁止 `window.api`、`cloud-client`、`electron`、`desktop-contracts`。

## 5. D4 feature 边界：同层不互导，机器强制

实测 renderer `features/*` 存在 26+ 文件跨 feature 相对导入（settings×9、design-schemes×6 深入 `generation/workbench/store`，workbench store 反向依赖 `account`、`history` store，`HistoryDetail` 同时导入三个 feature 的模块）。features 因此是目录分类而非模块边界——与 FSD「同层 slice 禁止互导」的核心规则相悖，也让「删掉一个 feature」不可想象。

**结论**：新增 depcruise 规则 `renderer-features-isolated`：`apps/desktop/src/features/<a>/**` 禁止 import `features/<b>/**`。存量违规进 baseline 冻结只减不增。消除路径两选一：多个 feature 都要的模块**下沉** product-ui（或 domain/contracts/lib），业务上不可分的**合并** feature。跨 feature 通信走 runtime 编排入口或 gateway，禁止 store 直接 import 兄弟 store。REUSE-01 裁定不合并 design-schemes×generation（baseline 67→17）；REUSE-03 收口到 0——纯函数下沉 `src/lib/`、跨域写副作用进 `runtime/*-side-effects`、跨域读经 `runtime/*-access`（三条通道见架构 §6.6）。

不采用：照搬 FSD 七层目录重排（monorepo 包结构已等价实现其分层语义，目录重排是无对价 churn）。

## 6. D5 文件尺寸治理：棘轮而非口号

`GenerationWorkbench.tsx` 自 v1.2.2 文档标记（2,942 行）后仍继续增长至 2,932+ 行（含 14 个内联组件），证明缺乏机器约束的尺寸共识不成立。同类曾超标：`workbench/store.ts` 1,932 行、`SchemeRuntimeDetail.tsx` 1,131 行、`OnboardingFlow.tsx` 886 行、`AccountSection.tsx` 855 行；主进程侧 `browser-service.ts` 1,107 行、`preload/index.ts` 616 行。SPLIT-01~04 已把上述渲染层文件拆到 ≤600 并退出棘轮；REUSE-03 再消化 `ProviderDialog.tsx`(622) 与 `PromptReferenceSidebar.tsx`(603)，桌面渲染层棘轮清零，尾部 12 条全在主进程与 packages。

**结论**：以 baseline 冻结存量超标清单，只减不增。原卡写的是 ESLint warn 600 / error 1,200，但同一规则无法双档，落地为 `max-lines` warn 600 + `tests/repo/file-size-ratchet.test.ts`（新文件即受 600 约束，比原卡更严）。「清单清零后把 error 下调至 800」这一步不再需要——硬门禁已经是 600。阈值依据：上线时 600 行以上约 3%，说明 600 是该仓库的真实工作粒度。

## 7. D6 状态分工：Zustand 收敛为 UI state

现状 18 个 store 混装三类职责：服务端数据镜像（history/library/account——归 D2 的 Query）、纯 UI state（选中、面板、草稿——留 Zustand）、副作用编排（toast、导航——留 Zustand）。持久化另有手写 localStorage 迁移逻辑（`stores/app.ts` 14–42 行）。

**结论**：D2 落地后，store 只保留 UI state 与宿主动作；持久化统一 `zustand/middleware` 的 `persist`（版本化 key + migrate 替换手写迁移）；服务端数据进入 store 属于 lint 可查的反模式（`no-restricted-syntax` 针对在 store 中存 gateway 返回值的模式按域分批启用）。双端不强行统一状态库——Web 侧本就无 Zustand，UI state 需求由编排 hook 内部 `useState`/context 承担。

## 8. D7 契约面治理：分域拆分，单源不生成

`desktop-contracts/src/ipc.ts` 已因膨胀分裂出 `desktop-extras.ts`（v1.2.2 GW-07），`preload/index.ts` 616 行单文件仍是全部通道的 contextBridge 汇聚点，新增域持续使其恶化。

**结论**：`ipc.ts` 按域拆分为 `ipc/{prompt,history,workbench,account,generation,system,…}.ts` 组合面，`Api` 聚合类型保持不变（消费方零改动）；preload 同步按域拆模块，`contextBridge.exposeInMainWorld` 仍单次调用、单对象暴露（Electron 安全要求），只是组装来源分域。不引入从类型自动生成绑定代码的方案：收益（省去手写透传）小于引入构建步骤与调试黑盒的成本，且分域拆分已把单文件压力消解。

## 9. D8 复用度量：共享符号棘轮，而非「像素相同」

v1.3 的复用目标此前只有定性表述（「product-ui 消费方数量较基线上升」），无法判定某张卡是否真的提高了复用。视觉门禁只能证明两端长得像，证明不了两端用的是同一份代码——Web 曾用手写 JSX 拼出与共享 widget 相同的像素。

**结论**：以「Web 与桌面生产源码同时 import 的 product-ui 导出符号数」为过程度量，棘轮化在 `tests/repo/product-ui-dual-host-reuse.test.ts`（REUSE-02 立基线 64）。只数生产源码，测试文件的 import 不计。指标下降即意味着某侧改回了宿主本地实现，CI 拦截。宿主特定面（结果卡动作、分享、桌面语义段）在架构 §6.5 逐条登记，属显式豁免而非遗漏。

## 10. 明确不采用与复审触发器

| 技术 | 不采用原因 | 复审触发器 |
|---|---|---|
| FSD 七层目录全量重排 / `src/entities/` | monorepo 包结构（contracts/domain/product-ui）已等价承载其分层语义；重排是无对价 churn | — |
| 新建 `packages/application` | 见 D3，与 product-ui controller 层割裂 | product-ui 依赖面失控时 |
| Redux / RTK / MobX | D6 分工下无对应痛点 | — |
| SWR | mutation 失效链路弱于 TanStack Query | — |
| IPC 绑定代码生成 | 见 D7 | 契约面继续失控增长时 |
| React 19 / React Compiler | 维持 v1.2.2 D3 冻结 | 同 v1.2.2 触发器 |
| pnpm | 维持 v1.2.2 D4 冻结 | 同 v1.2.2 触发器 |
| ENT-B schema 迁移 | 见 D1，前置条件未满足 | 云同步真实多设备稳定运行 |

## 11. 相关文档

- [系统架构](./V13-ARCHITECTURE.md)
- [迁移计划](./V13-MIGRATION-PLAN.md)
- [v1.2.2 技术选型与决策](../v1.2.2/V122-TECHNOLOGY-DECISIONS.md)（D3/D7 的原始论证，本文为修订记录）
