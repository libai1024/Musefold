# Musefold 前端开发规范

> **状态**：v1.3 配套规范（随 v1.3 架构演进更新）
>
> **日期**：2026-08-21
>
> **适用范围**：`apps/desktop`（渲染层）、`apps/web`、`packages/ui`、`packages/product-ui` 及其余前端相关 workspace 包
>
> **权威**：与源码冲突时以源码为准；分层与依赖规则以 [v1.2.2 架构文档](../v1.2.2/V122-ARCHITECTURE.md) §3 为准，v1.3 增量见 [v1.3 架构文档](../v1.3/V13-ARCHITECTURE.md) §3

## 0. 技术栈（业界标准 × 本项目实践）

| 层 | 业界推荐 | 本项目采用 | 差异与理由 |
|---|---|---|---|
| 语言 | TypeScript | TypeScript（strict） | 一致 |
| UI 框架 | React + Next.js / Vue + Nuxt | **React 18 + Vite**（非 Next/Nuxt） | 桌面 Electron 渲染层与 Web SPA 都无 SSR/SEO 需求；`apps/web` 是未来 Capacitor iOS 的复用基础，纯 SPA 是 v1.1 技术决策（D3）冻结结论 |
| 架构方法 | Feature-Sliced Design | **monorepo 包级 FSD 等价实现**（contracts→domain→product-ui→hosts，v1.3 起 feature 级同层不互导） | FSD 的 layers/slices 语义由包结构承载，不再 `src/` 内重排七层目录 |
| 服务端状态 | TanStack Query | **TanStack Query（v1.3 引入）** | gateway 六端口即 queryFn 边界；此前 18 个 store 手写缓存，v1.3 STATE 卡迁移 |
| 样式 | Tailwind CSS + shadcn/ui | **Tailwind v4（桌面）+ `@musefold/ui` 原语库（mf-ui token 类）**；Web 端手写 CSS（v1.3 待统一） | 不引入 shadcn/ui：`@musefold/ui` 是等价的内部组件库，且被像素级视觉门禁锁定 |
| 表单 | React Hook Form + Zod | **React Hook Form + Zod**（已装） | 已符合；v1.3 规范为「新表单一律 RHF+Zod」，存量表单迁移分批 |
| 契约校验 | Zod | Zod v4（全仓统一） | 一致；契约单一来源 `packages/contracts` |
| 单元/组件测试 | Vitest + Testing Library | **Vitest 4**（渲染用 `renderToStaticMarkup`，无 jsdom/RTL） | 现状如此；新测试允许引入 RTL 评估，但存量测试体例（轻量 DOM 断言）继续有效 |
| E2E | Playwright | **Python pytest + Playwright**（`tests/e2e/`，桌面 222 例）+ Web Playwright TS（`apps/web/e2e/`） | 双轨保持；桌面 E2E 是每张任务卡的回归安全网 |
| Lint / 格式化 | ESLint + Prettier | ESLint（棘轮启用）+ Prettier | 一致；`max-lines-per-file` 棘轮 v1.3 上线 |
| 边界强制 | — | **dependency-cruiser（20+ 条规则，CI 门禁）** | 超出业界标准配置，是本仓库核心竞争力 |
| CI | 完整配套 | GitHub Actions 四条发布 lane + affected 流水线 + 视觉门禁 | 一致且更严 |

## 1. 目录与文件组织

### 1.1 monorepo 总览

```text
apps/
  desktop/          Electron 应用（main / preload / src 渲染层）
  web/              Web SPA（薄宿主）
  web-api/          Fastify API（后端，不属于本文档范围）
  generation-worker/ Graphile Worker（同上）
packages/
  contracts/        云契约（Zod）：唯一实体规范形状
  domain/           业务规则 + 六端口 Gateway + capability
  desktop-contracts/ IPC Api 面 + 存储行模型（v1.3 起行模型 storage-only）
  ui/               设计 token + UI 原语（唯一直接 import lucide-react 的文件）
  product-ui/       共享产品组件 + controller +（v1.3）页面编排 hook
  cloud-client/     Cloud HTTP 客户端
  core/             桌面本地核（SQLite/Provider/同步，主进程专属）
  …                 automation-server / client / cli / mcp / new-api-client / …
tooling/            tsconfig.base / eslint 基线 / dependency-cruiser / aliases 单点
tests/e2e/          Python Playwright（桌面主 E2E）
```

### 1.2 渲染层 feature 结构（桌面与 Web 同构）

```text
apps/desktop/src/features/<name>/
  store.ts            # 纯 UI state（zustand）；v1.3 起服务端数据一律 Query
  components/         # 该 feature 的组件（settings 的 sections/ 已归并）
  __tests__/          # 就地测试（*.test.ts / *.test.tsx）
```

规则：

- **feature 同层不互导**（depcruise `renderer-features-isolated`，v1.3）：`features/<a>` 禁止 import `features/<b>`。跨域共享物下沉 product-ui / domain；业务不可分时合并 feature。
- **页面组件是薄挂载**：`apps/desktop/src/pages/*.tsx` 与 `apps/web/src/views/*.tsx` 只做路由挂载与平台差异，编排逻辑调 product-ui page-controller。
- **文件尺寸**：`max-lines-per-file` warn 600 / error 1200，baseline 只减不增（v1.3 GOV-01）。
- **测试就地放置**：`__tests__/` 与被测文件同目录；命名 `*.test.ts(x)`（不用 `.spec`）。

### 1.3 product-ui 三层内容

```text
packages/product-ui/src/
  workbench/ library/ history/ account/ navigation/   # 共享产品组件
  page-controllers/                                   # v1.3：页面编排 hook
    query-client.ts                                   # createMusefoldQueryClient()
  workbench/sessionPreferences.ts 等持久化 helper
```

- 组件只依赖 `@musefold/ui`、`@musefold/contracts`、`@musefold/domain`、`react`、`@tanstack/react-query`；禁 `window.api`、`cloud-client`、`electron`、`desktop-contracts`。
- controller/page-controller 一律显式 deps 注入（`{ ports…, platform }`），不引入 Context 隐式注入。

## 2. 分层与依赖规则（机器强制）

v1.2.2 §3.2 全部规则继续有效（20 条），v1.3 新增 3 条。速查：

```text
contracts          ← 仅 zod（叶子）
domain             ← contracts；禁 desktop-contracts / electron / fs / window.api
desktop-contracts  ← zod + domain + contracts + type-only update-protocol
ui                 ← 零 workspace 依赖（叶子）
product-ui         ← ui + contracts + domain + react-query；禁平台 API
cloud-client       ← contracts
core               ← contracts + desktop-contracts + better-sqlite3；禁 electron
apps/desktop 渲染层  ← 一切桌面侧包；禁 import 'electron'；禁 lib/ipc（runtime 适配器除外）
apps/web           ← contracts/domain/ui/product-ui/cloud-client；禁 desktop-contracts / core
循环依赖            ← 静态环全局禁止（dynamic-import 断环合法）
```

任何「规则禁止但确实需要」的场景：在 `tooling/dependency-cruiser-known-violations.json` 登记并注明理由，只减不增。

## 3. 实体与契约（v1.3 ENT）

- **contracts 是唯一暴露给 UI 的实体形状**。product-ui、store、组件中的实体类型一律来自 `@musefold/contracts`。
- **行模型是存储细节**：`desktop-contracts/models.ts` 行类型只允许出现在 core、主进程、`ipc/` 传输签名、`runtime/mappers/`。
- **桌面扩展用组合**：`GenerationJob & { localImagePath?; costUnit }`，禁止平行模型。
- **新增实体流程**：先 `packages/contracts` 定 schema → domain 端口（如需）→ 双端 gateway 实现 → mapper（桌面）→ page-controller → 组件。一步到位，不留「先在桌面行模型上做、以后再统一」。
- Zod schema 即文档：字段注释写业务语义（成本单位、快照冻结时机等），与 mapper 内的有损字段注释配对。

## 3a. 表单（React Hook Form + Zod）

- **新表单一律 RHF + Zod**（`useForm` + `zodResolver`），schema 放 feature 内或 domain（跨端共享时）。
- 受控轻输入（单 toggle、单选）不必上 RHF；中等复杂度以上（多字段、校验、脏检查、默认值回填）必须。
- zodResolver 的 schema 与 contracts 实体 schema 分开维护——表单 schema 描述「输入约束」，契约 schema 描述「传输形状」，二者经 `z.input`/`z.output` 或显式映射桥接，不共用。
- 提交动作用 `useMutation`（见 §4），RHF `handleSubmit` 内只做校验与取值，不写副作用。

## 4. 数据获取与状态（v1.3 STATE）

### 4.1 分工

| 状态种类 | 归属 | 禁止 |
|---|---|---|
| 服务端数据（列表/统计/账号） | TanStack Query（queryKey 按域分层 `['history', query]`） | 存入 zustand store |
| UI state（选中/草稿/面板/toast） | zustand store 或组件局部 | 承载数据镜像 |
| 持久化偏好（主题/默认 Provider） | zustand `persist` middleware（版本化 key + migrate） | 手写 localStorage |
| 可分享状态（过滤/页码） | URL（Web）/ 会话偏好（桌面） | 深度嵌套入 store |

### 4.2 Query 约定

- QueryClient 配置单点：`createMusefoldQueryClient()`（staleTime/retry/失效约定），双宿主实例化后经 Provider 注入。
- queryFn 只调 gateway 端口方法；组件与 store 不感知 transport。
- 写后失效：mutation onSuccess 里 `qc.invalidateQueries({ queryKey: ['history'] })`，禁止手动 setState 同步缓存（settle 场景用 `setQueryData`，需注释）。
- 竞态由库接管；不在编排 hook 里手写 AbortController/序号守卫。

### 4.3 Store 规约

- store.ts 默认导出 `useXStore`；命名统一 `store.ts`（v1.3 GOV-03）。
- selector 消费（`useAppStore((s) => s.currentView)`），禁止解构整个 state。
- action 内不调 gateway（v1.3 后编排归 page-controller / Mutation）；toast 经 `PlatformServices` 注入。

## 5. 组件规范

### 5.1 分层判定（写组件前先回答归属）

| 组件特征 | 归属 |
|---|---|
| 纯产品 UI，只依赖 contracts/domain 类型与回调 | `product-ui`（上提共享） |
| 依赖 desktop-contracts / IPC / 本地文件 / 桌面语义 | 宿主 feature `components/` |
| 原子级控件（Button/Dialog/…） | `@musefold/ui` |
| 跨 domain 纯逻辑 | `domain` |

灰区规则：拿不准留宿主；出现第二个宿主消费者时再上提。

### 5.2 样式

- **桌面**：Tailwind v4 原子类为主（49/54 feature tsx 已用）+ `@musefold/ui` 原语；组合类名用 `tailwind-merge` 收敛。
- **Web**：现状手写 CSS；新组件优先复用 product-ui（其样式来自 ui 包 token 类），避免再造本地 CSS 体系。
- 设计 token 以 `packages/ui/src/tokens.css` 为单源；禁止在组件里硬编码色值/字号，使用 mf-ui token 类或 token CSS 变量。
- 图标唯一入口 `packages/ui/src/icons.ts`（lucide-react 直连全仓禁用，ESLint 强制）。
- 交互状态规范（loading/empty/error/disabled 全套、触达 44px、`prefers-reduced-motion`）遵循 [DESIGN.md](../../DESIGN.md)。

### 5.3 尺寸与拆分

- 单文件 ≤ 600 行（warn）/ 1200（error）；组件超过 ~200 行且含多个内联子组件时，把子组件拆为独立文件。
- 容器（编排）与展示分离：取数/分发进 page-controller，组件保持受控。
- 拆分第一步永远是零逻辑变更的移动提交（便于 review 与 `git log --follow`）。

## 5a. 错误处理

- Gateway/transport 错误：统一 `ApiErrorCode` 面（contracts）；编排 hook 捕获后经 `PlatformServices.toast` 或 ErrorBoundary 呈现，禁止组件内裸 try/catch 吞错。
- 契约校验失败（Zod parse 抛出）：按数据损坏处理（toast + log），不得静默忽略。
- 全局兜底：`GlobalErrorBoundary`；异步错误不进 React 错误边界，必须由 Mutation/Query 的 onError 链路处理。

## 6. 测试

| 层 | 工具 | 范围 |
|---|---|---|
| 单元/组件 | Vitest 4（`renderToStaticMarkup` 轻量渲染断言） | controller、store、mapper、纯函数、组件渲染 |
| 共享视觉门禁 | 像素级比对 | product-ui 共享面，双端同像素 |
| 桌面 E2E | Python pytest + Playwright（`tests/e2e/`） | 每张任务卡必跑 |
| Web E2E | Playwright TS（`apps/web/e2e/`） | Web 面 |
| 仓库守卫 | `tests/repo/`（别名一致性、品牌、防回潮） | CI |

规范：

- 新代码必须有就地的 `__tests__`；controller/page-controller 测纯逻辑（注入 fake 端口），不测 transport。
- mapper 测试是实体统一的回归网：行↔文档转换逐字段断言。
- E2E 不重复单测：只测关键路径与回归场景；夹具用 SQL 直写（`test_00_harness` 模式）。

## 7. Git 与 CI

### 7.1 提交

- 格式：`type(scope): subject`（feat/fix/refactor/test/docs/chore/…），subject 用祈使句。
- **含 App 源码的提交必须带 `Skill-Impact:` trailer**（Agent Skill 同步声明；本地 hook + CI 强制，格式见 [CONTRIBUTING.md](../../CONTRIBUTING.md)）。
- 纯移动（`git mv`）与内容修改严格分离。
- 提交前自检门禁：`npm run typecheck && npm run test && npm run lint && npm run check:boundaries`。

### 7.2 CI 门禁（每 PR 必绿）

`typecheck / test / build / lint / check:boundaries / check:ui-boundaries` + 按层级触发 E2E（`layer-paths.yml` 四条 lane：content / service / shell / infra；桌面变更必跑桌面 E2E）。

## 8. 新功能开发流程（端到端清单）

以「给提示词库加一个标签过滤」为例，v1.3 目标路径：

1. **契约**：`packages/contracts/src/prompt.ts` 加字段/schema → 单测。
2. **端口**（跨端能力才需要）：`domain` 对应 Gateway 签名扩展。
3. **双端实现**：web-api 路由 + `cloud-client`；桌面 mapper + IPC handler。
4. **编排**：`useLibraryPageController` 的过滤参数与 Query key 扩展（单点）。
5. **UI**：product-ui 过滤控件（双端同像素）；桌面特有挂载差异。
6. **测试**：mapper 单测 → controller 单测 → 双端 E2E 用例 → 视觉门禁。
7. **提交**：`feat(library): add tag filter (Skill-Impact: none)`。

v1.3 完成后，第 4–5 步双端只写一份。

## 9. 禁止事项速查（红线）

- ❌ store 中存 gateway/IPC 返回的服务端数据（v1.3 起）
- ❌ feature 直接 import 兄弟 feature 的模块/store（v1.3 起）
- ❌ 渲染层 import `electron`、`lib/ipc`、裸 `window.api`（runtime 适配器 5 个入口除外）
- ❌ product-ui 出现 `window.api` / `cloud-client` / `electron` / `desktop-contracts`
- ❌ 渲染层/UI 引用 `desktop-contracts` 行模型（v1.3 起；mapper 与传输签名除外）
- ❌ 手写 localStorage 持久化（persist middleware 之外）
- ❌ 直接 import `lucide-react`（唯一入口 `@musefold/ui` icons）
- ❌ 静态循环依赖
- ❌ 新增与云语义平行但形状不同的实体类型
- ❌ 未过门禁的巨型文件（baseline 之外新文件即受 max-lines 约束）
- ❌ API Key / 凭据进渲染层、SQLite、日志、导出文件（Electron 密钥红线）

## 10. 相关文档

- [v1.3 系统架构](../v1.3/V13-ARCHITECTURE.md)——目标架构与迁移卡
- [v1.2.2 系统架构](../v1.2.2/V122-ARCHITECTURE.md)——现行分层基线与依赖规则
- [v1.1 共享 UI 架构](../v1.1/V11-SHARED-UI-ARCHITECTURE.md)——product-ui 边界规则
- [DESIGN.md](../../DESIGN.md) / [PRODUCT.md](../../PRODUCT.md)——设计系统与产品原则
- [CONTRIBUTING.md](../../CONTRIBUTING.md)——提交规范与 Skill-Impact
