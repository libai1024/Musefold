# Musefold v1.3 系统架构

> **状态**：Phase 0 与 ENT-01/02/03 已落地；ENT-04 起继续
>
> **日期**：2026-08-21
>
> **范围**：实体类型统一、服务端状态分层、宿主编排收敛、巨型文件拆分、边界治理规则
>
> **目的**：把双端开发的「两条变更路径」收敛为「一条」；降低维护成本、提高组件复用；不改变任何用户可见行为

## 0. 结论摘要

v1.3 在 v1.2.2 基线（包级 DAG、六端口 Gateway、depcruise 机器边界）之上做四个收敛，全部围绕同一命题——**让「同一产品能力」在双端只有一份需要维护的实现**：

1. **实体形状收敛到 contracts**。渲染层与 product-ui 只允许出现 `packages/contracts` 文档形状；SQLite 行模型降级为存储细节（`core`/主进程/mappers 专属），`DesktopExtras` 返回「contracts 形状 + 桌面扩展」组合类型。存储 schema 不动（ENT-B 留触发条件）。见第 4 节。
2. **服务端状态收敛到 TanStack Query**。gateway 六端口即 queryFn 边界，缓存/去重/失效/竞态由库接管；Zustand 收敛为纯 UI state。见第 5.1 节。
3. **页面编排收敛到 product-ui**。过滤、选择、分页、错误处理、动作分发以页面编排 hook（`useHistoryPageController` 等）下沉共享层，Web `App.tsx` 与桌面 pages/stores 复用同一编排层，宿主只剩路由挂载与平台差异。见第 5.2 节。
4. **代码级治理机器化**。`max-lines-per-file` 棘轮、`renderer-features-isolated`（feature 同层不互导）、store 命名统一、ipc/preload 分域；`GenerationWorkbench.tsx`（2,932+ 行）等巨型文件按内联组件边界拆分，多数 widget 上提 product-ui。见第 6 节。

技术栈不变。对 v1.2.2 决策的修订与理由见[技术选型与决策](./V13-TECHNOLOGY-DECISIONS.md)。

## 1. 现状与问题定位

### 1.1 规模基线（2026-08-21 实测）

| 区域 | 生产代码 | 说明 |
|---|---|---|
| `apps/desktop/src`（渲染） | 166 文件 / 约 3.1 万行 | `features/` 占 91%（28,177 行 / 123 文件） |
| `apps/desktop/electron`（主进程+preload） | 174 文件 / 约 3.1 万行 | 与渲染层等重 |
| `packages/product-ui` | 64 文件 / 约 6.9 千行（不含 css） | 30 个 workbench 组件 + 3 controller，被桌面 15 文件、Web 6 文件消费 |
| `apps/web/src` | 20 文件 / 约 4.6 千行 | 薄宿主，但 `App.tsx` 单文件约 1,373 行编排 |
| `packages/domain` | 22 文件 / 1,321 行 | 六端口 + 业务规则 |
| 渲染层巨型文件 | 见 1.6 | v1.2.2 点名后仍在增长 |

### 1.2 缺口一：实体类型暴露面不对称（v1.2.2 缺口一的残留）

`DesktopExtras`（`desktop-contracts/src/desktop-extras.ts`）为保真直通行模型，`HistoryRecord` 等 SQLite 行类型经 `ipc.ts` 与 extras 签名进入渲染层 store 与组件（`features/history/store.ts` 的类型即 `HistoryRecord`）。Web 端 kysely 行类型从未离开 `web-api`。两端对「存储形状是否上浮」不对称；`runtime/mappers/`（epoch↔ISO、枚举改名 `success`→`succeeded`、offset↔cursor、错误码映射）只覆盖共享端口面，extras 面绕过 mapper，每个新界面重复支付类型税与转换税。

### 1.3 缺口二：宿主编排两套（v1.2.2 缺口四未解）

Web `App.tsx`（约 1,373 行）与桌面 `pages/` + 18 个 zustand store 对同一批 product-ui 组件平行实现：列表过滤、选中态、分页、错误处理、动作分发、账号状态装配。v1.2.2 只收敛了 transport（六端口），编排层原样保留。新增一个列表能力 = Web 编排一遍 + 桌面 store 一遍 + 两端各接一遍组件。

### 1.4 缺口三：无服务端状态层

全仓（desktop/web/product-ui）0 个 query 库。18 个 store 以 `loading`/`error`/`statsLoading`/`statsError` 字段手写异步标志，缓存、去重、失效、竞态各自为政；v1.2.2 D3 所写「Web 走 gateway + query cache」与现实不符（Web 同样手写）。持久化另有一份手写 localStorage 迁移逻辑（`stores/app.ts:14–42`）。

### 1.5 缺口四：feature 边界名存实亡

`apps/desktop/src/features/*` 存在 26+ 文件跨 feature 相对导入：settings×9、design-schemes×6（深入 `generation/workbench/{store,types,SkillRuntimeAttachment}`）、history×4（`HistoryDetail` 同时导入 generation/workbench/library）；`generation/workbench/store.ts` 反向依赖 `account/doubao-store` 与 `history/store`。depcruise 只约束包级，feature 级无规则。features 因此是目录分类而非可独立删改的模块。

### 1.6 缺口五：巨型文件缺乏机器约束

`GenerationWorkbench.tsx` 2,932 行（14 个内联组件，composer 单段约 1,200 行）、`workbench/store.ts` 1,932 行（`WorkbenchState` 约 123 个成员、72 处 fan-in）、`SchemeRuntimeDetail.tsx` 1,131 行、`OnboardingFlow.tsx` 886 行、`AccountSection.tsx` 855 行；主进程 `doubao-web/browser-service.ts` 1,107 行、`preload/index.ts` 616 行。v1.2.2 文档以 2,942/2,080 行点名后不降反升，证明无 lint/depcruise 约束的尺寸共识不成立。

## 2. 目标目录结构（相对 v1.2.2 的增量）

```text
packages/
  product-ui/src/
    workbench/ …                # 不变：workbench 组件 + controller
    library/ history/ account/ navigation/ …
    page-controllers/           # 新增：页面编排 hook（第 5.2 节）
      history-page-controller.ts
      library-page-controller.ts
      generate-page-controller.ts
      query-client.ts           # createMusefoldQueryClient() 配置工厂
  desktop-contracts/src/
    ipc/                        # 拆分：按域组合面，Api 聚合类型不变（GOV-04）
      prompt.ts history.ts workbench.ts account.ts generation.ts system.ts …
    desktop-extras.ts           # 签名文档化：contracts 形状 + 桌面扩展（ENT-02）
    models.ts                   # 收缩为存储行类型，引用面受限（ENT-04）
  contracts/                    # 不变：唯一实体规范形状

apps/desktop/src/
  runtime/                      # 不变：gateway/extras/host-services + mappers（唯一转换点）
  features/<name>/
    store.ts                    # 统一命名：纯 UI state + 宿主动作（GOV-03）
    components/                 # 统一目录（settings 的 sections/ 归并）
    __tests__/
  pages/                        # 薄挂载：调 product-ui 页面编排 hook
apps/web/src/
  App.tsx                       # 拆解：视图切换 + 挂载，编排进 page-controllers
  views/*.tsx                   # 薄挂载，同桌面 pages 对等

apps/desktop/electron/preload/
  index.ts                      # 拆分：按域组装模块，仍单次 exposeInMainWorld（GOV-04）
```

要点：**不新增包、不重排 FSD 目录**。product-ui 承担页面编排（决策 D3），desktop-contracts 内部分域，hosts 变薄。monorepo 包结构与 v1.2.2 第 2 节完全一致。

## 3. 分层与依赖规则（v1.3 增量）

v1.2.2 §3.2 全部规则继续有效。v1.3 新增/修订：

```text
新增 depcruise：
renderer-features-isolated   apps/desktop/src/features/<a>/** 禁止 import features/<b>/**
                            baseline 冻结存量（26+ 文件），只减不增
renderer-row-models-banned   apps/desktop/src/{features,components,pages,stores,lib}/**
                            禁止 import desktop-contracts 行模型（models 及 re-export 路径）
                            例外：runtime/mappers/**、runtime/desktop-gateway.ts、__tests__
product-ui-query-allowed     product-ui 允许 @tanstack/react-query；其余禁令不变
                            （window.api / cloud-client / electron / desktop-contracts 仍禁）

新增 ESLint：
max-lines-per-file           warn 600 / error 1200；baseline 冻结存量超标清单，只减不增
store-persist-only           store 持久化只经 zustand persist middleware（禁手写 localStorage，
                            按 feature 迁移完成分批启用）

修订：
desktop-contracts 内部        ipc.ts 拆为 ipc/ 域模块；desktop-extras.ts 类型面只引用
                            contracts + domain + 行模型仅限 ipc/ 传输签名
```

分层图在 v1.2.2 §3.1 基础上唯一的变化：`product-ui → 双宿主 stores` 的边变为 `product-ui(page-controllers) → gateway 端口`（经依赖注入），stores 退化为宿主内部 UI state，不再位于数据路径上。

## 4. 实体统一设计（ENT-A：类型层统一）

### 4.1 原则

1. **contracts 是唯一暴露给 UI 的实体形状**。product-ui、renderer store、组件中出现的实体类型一律来自 `@musefold/contracts`。
2. **行模型是存储细节**。`desktop-contracts/models.ts` 的行类型只允许出现在：`packages/core`、`apps/desktop/electron/**`（主进程）、`desktop-contracts/src/ipc/**`（传输签名）、`apps/desktop/src/runtime/**`（gateway 实现与 mappers）。
3. **桌面扩展用组合，不用平行模型**。禁止再造与云语义重复但形状不同的整套类型（v1.2.2 已立，继续有效）；桌面专有字段以交集类型表达：

```ts
// desktop-contracts/src/desktop-extras.ts（目标形态）
import type { GenerationJob } from '@musefold/contracts';

/** 桌面历史条目：contracts 形状 + 本地语义扩展 */
export type DesktopGenerationEntry = GenerationJob & {
  providerId: string;
  imagePath: string | null;
  cost: number | null;
  costUnit: CostUnit;
  durationMs: number | null;
  params: PromptParams | null;
  createdAtMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  promptReferences?: PromptReference[];
  promptRelations?: PromptHistoryRelation[];
};

```

4. **mapper 仍是唯一转换点**。行↔文档转换全部集中在 `runtime/mappers/`；extras 实现内部走 mapper，不再直通行模型到签名。

### 4.2 数据路径（目标形态）

```text
core(SQLite 行) → 主进程 handler → IPC(行, ipc/ 域签名)
  → renderer runtime: DesktopExtras/Gateway 实现 → mappers(行→文档)
    → 页面编排 hook(Query 缓存) → product-ui 组件 / store(仅 UI state)

web-api(kysely 行) → HTTP(contracts) → cloud-client
  → renderer runtime: WebGateway → 同一组页面编排 hook → 同一批组件
```

两端从 gateway 之后完全同构——这是「一条变更路径」的实现载体。

### 4.3 逐域切换顺序

history（行类型泄漏最深、`HistoryDetail` 跨三域）→ library（`PromptRow`/`previewImagePath` 扩展）→ account（`AccountStatus` 面文档化）→ workbench（`DesktopWorkbenchSessionDocument` 已近文档形状，收尾）。每域一卡：签名切换 → mapper 扩展 → store 类型切换 → 行类型引用清除，独立合并独立回滚。

### 4.4 ENT-B（不在本版本）

`prompts` 表版本列、时间戳存储语义等 schema 迁移维持 v1.2.2 前置条件（云同步真实多设备稳定运行）。届时方向不变：行模型向 contracts 靠拢。ENT-A 完成后 ENT-B 只动 core 与 mapper，UI 层零感知。

## 5. 状态与编排设计

### 5.1 服务端状态：TanStack Query

- **边界**：gateway 六端口方法即 queryFn。`useQuery({ queryKey: ['history', query], queryFn: () => gateway.listGenerationHistory(query) })`。
- **配置单点**：`product-ui/src/page-controllers/query-client.ts` 导出 `createMusefoldQueryClient()`（staleTime、retry、mutation 失效约定），双宿主各自实例化并经 Provider 注入；编排 hook 不感知宿主。
- **store 收敛**：服务端镜像状态（列表、统计、账号状态）退出 zustand；store 只留 UI state（选中、草稿、面板开合、toast）。持久化统一 `persist` middleware，替换 `stores/app.ts` 手写迁移。
- **迁移顺序**：history → library → account → generation/workbench 读面；写操作以 `useMutation` + 精确失效链路替代 store action 内的手写刷新。

### 5.2 页面编排：page-controller 模式

既有 controller 命名（`useWorkbenchSessionController`）向上延伸一层：**page controller = 数据取用（Query）+ 过滤/选中/分页状态 + 动作分发（Mutation）+ 错误与 toast 装配**，参数只依赖 domain 端口与注入的 platform services：

```ts
// product-ui/src/page-controllers/history-page-controller.ts
export function useHistoryPageController(deps: {
  history: HistoryGateway & DesktopHistoryExtrasLike;  // 域端口 + 可选扩展面
  platform: PlatformServicesLike;                       // toast/download 等
}) {
  const query = useQuery(…); const filters = useState(…); …
  return { page, filters, setFilters, remove: (id) => …, stats: … };
}
```

宿主职责收敛为：

| 职责 | v1.2.2 现状 | v1.3 目标 |
|---|---|---|
| 数据取用/缓存/失效 | Web App.tsx 手写；桌面 store action 手写 | page controller + Query（共享一份） |
| 过滤/选中/分页状态 | 两端各写 | page controller（共享一份） |
| 动作分发与错误处理 | 两端各写 | page controller（共享一份） |
| 视图切换/路由 | Web App.tsx / 桌面 App.tsx | 各宿主保留（平台差异） |
| 平台服务（toast/下载/剪贴板） | toast store（桌面）/App.tsx 内联（Web） | `PlatformServices` 注入（GW-01 预留端口启用） |
| 桌面独有能力 | DesktopHostServices | 不变 |

Web `App.tsx` 由约 1,373 行编排拆解为：视图切换 + 3 个薄 view（调 page controller）+ Provider 装配；桌面 `pages/` 同步切换到同一组 controller，feature store 中对应的服务端面删除。`PlatformServices` 空接口（v1.2.2 遗留）在 ORCH 阶段填充 toast/download/clipboard/openExternal 的双端实现。

## 6. 巨型文件拆分与复用（SPLIT/REUSE）

### 6.1 GenerationWorkbench.tsx（2,932 行 → 组合层 + widget 模块）

按既有内联组件边界机械拆分为独立文件（第一步零逻辑变更）：

| 现内联组件（行号） | 去向 | 说明 |
|---|---|---|
| `GenerationWorkbench`（L142） | 桌面 `features/generation/workbench/`（组合层） | 只做装配与桌面扩展 |
| `WorkbenchTimeline`（L177） | product-ui `workbench/` | 纯产品 UI |
| `GenerationTurnView`（L307） | product-ui `workbench/` | 纯产品 UI |
| `GenerationResultCard`（L997） | product-ui `workbench/` | 保存/揭示动作经回调注入 |
| `WorkbenchComposer`（L1454–2646） | 拆 3–4 个子模块后上提 product-ui | 桌面附件/Skill/Scheme 采集器留桌面，经 composer 插槽组合 |
| `DraftImagesPreview`（L2647） | product-ui `workbench/` | 图片源经适配注入 |
| 额度兑换/内联胶囊等桌面语义段 | 留桌面 | 不强行共享 |

判断规则：组件只依赖 contracts/domain 类型与回调 → product-ui；依赖 desktop-contracts、IPC、本地文件 → 留桌面，边界以回调/插槽表达。

### 6.2 workbench/store.ts（1,932 行 → 窄 store + controller 复用）

三 controller（draft/session/generationSync，v1.2.2 SHARE-04）已就位；v1.3 把 `WorkbenchState`（约 123 成员）中的服务端镜像（会话列表、运行态）移入 page controller + Query，把跨域依赖（`account/doubao-store`、`history/store`）改经编排层/Query 取数，store 收敛为草稿与 UI 态。72 处 fan-in 随组件拆分与 controller 迁移同步收敛。

### 6.3 其余巨型文件

`SchemeRuntimeDetail.tsx`（1,131 行，design-schemes 桌面独有）按详情段落拆组件；`OnboardingFlow.tsx`（886 行）按步骤拆；`AccountSection.tsx`（855 行）拆 section 子组件并复用 product-ui account 面。主进程 `browser-service.ts`、`skill-runtime.ts` 等不属渲染层拆分范围，仅受 `max-lines` 棘轮约束渐进消化。

### 6.4 复用增强（REUSE）

- 跨 feature 共享组件下沉：`HistoryDetail`（跨 generation/workbench/library 三域）在 ENT history 卡中随类型统一下沉 product-ui `history/`。
- workbench widget 上提后 Web 侧即时受益：Web 工作台由 product-ui 面直拼，桌面扩展经插槽注入。
- 复用判定以 depcruise 佐证：feature 互导 baseline 归零之日即「全部共享物已归位」之时。

## 7. 与 v1.2.2 / v1.2.1 的衔接

| 既有资产 | v1.3 的影响 | 同步动作 |
|---|---|---|
| 六端口 Gateway（GW-01~09） | 不变；`PlatformServices` 由空接口填充 | ORCH 卡补双端实现 |
| depcruise 20 条规则 | 新增 3 条（§3），baseline 机制沿用 | GOV 卡落地 |
| CI 层级路径映射（layer-paths.yml） | 无目录迁移，映射不变 | — |
| 桌面 E2E / 共享视觉门禁 / `check`/`check:v1.1` | 语义不变 | 每卡必跑（回归安全网） |
| v1.2.2 D3/D7 决策 | 修订（见技术决策 D1/D2） | 决策文档已互链 |

## 8. 明确不变的部分

- 运行时技术栈（Electron / Fastify / Vite / React 18 / npm workspaces + Turborepo）与 v1.2.2 全部冻结结论。
- monorepo 包结构与 v1.2.2 目标目录一致；不新增包、不删除包。
- SQLite schema、迁移谱系、云同步协议、Web API v1 契约、错误码。
- `packages/ui` / `product-ui` 的平台中立约束与视觉门禁；Electron 密钥红线。

## 9. 相关文档

- [技术选型与决策](./V13-TECHNOLOGY-DECISIONS.md)
- [迁移计划](./V13-MIGRATION-PLAN.md)
- [v1.2.2 系统架构](../v1.2.2/V122-ARCHITECTURE.md)（本版本的基线；其第 5 节「实体统一列为 v1.3+ 候选」由本文第 4 节接棒）
