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
| 表单 | React Hook Form + Zod | **不用表单库**：受控草稿 + 纯函数校验（`useDraftForm`） | 刻意偏离：RHF 装了一年 0 调用点，对话框复杂度在异步副作用而非字段校验，见 §3a |
| 契约校验 | Zod | Zod v4（全仓统一） | 一致；契约单一来源 `packages/contracts` |
| 单元/组件测试 | Vitest + Testing Library | **Vitest 4**（渲染用 `renderToStaticMarkup`，无 jsdom/RTL） | 现状如此；新测试允许引入 RTL 评估，但存量测试体例（轻量 DOM 断言）继续有效 |
| E2E | Playwright | **Python pytest + Playwright**（`tests/e2e/`）+ Web Playwright TS（`apps/web/e2e/`） | 双轨保持；桌面 E2E 是每张任务卡的回归安全网。用例数以当次 `pytest` 输出为准，不要把快照写进规范 |
| Lint / 格式化 | ESLint + Prettier | ESLint（`max-lines` warn 600）+ Prettier | CI 硬尺寸门禁在 `tests/repo/file-size-ratchet.test.ts`，不是 ESLint error 1200；`lint` 已纳入 `npm run check` |
| 边界强制 | — | **dependency-cruiser（CI 门禁）** | 静态规则 + 按 feature 目录动态生成的 `renderer-features-isolated-*`；条数随 feature 增减，以 `tooling/dependency-cruiser.cjs` 为准 |
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

- **feature 同层不互导**（depcruise `renderer-features-isolated`，v1.3；baseline 为 0，新增即红）：`features/<a>` 禁止 import `features/<b>`。跨域需求按性质选通道，优先级从上到下（详见 [v1.3 架构 §6.6](../v1.3/V13-ARCHITECTURE.md)）：

  1. 纯函数/常量 → 下沉 `apps/desktop/src/lib/`（或 domain / contracts / product-ui）；
  2. 跨域**写**副作用（A 域动作要求 B 域刷新）→ `runtime/*-side-effects.ts`，A 域不认识 B 域；
  3. 跨域**读**（要用兄弟域的 store/UI）→ `runtime/*-access.ts` 单一入口。

  业务确实不可分时才合并 feature。
- **页面组件把编排交给 page-controller**：`pages/*.tsx` 与 `views/*.tsx` 不重写过滤/分页/错误处理。它们仍会留下宿主胶水（store 订阅、虚拟化、桌面独有能力如回收站彻底删除）。目标是「编排单点」，不是把页面压到几十行。
- **文件尺寸**：ESLint `max-lines` warn 600；新文件超过 600 行由 `tests/repo/file-size-ratchet.test.ts` 拦下。baseline 只登记存量超标、只减不增（桌面渲染层已清零，尾部在主进程与 packages）。
- **测试就地放置**：`__tests__/` 与被测文件同目录；命名 `*.test.ts(x)`（不用 `.spec`）。

### 1.3 product-ui 三层内容

```text
packages/product-ui/src/
  workbench/ library/ history/ account/ navigation/   # 共享产品组件
  forms/                                              # 受控草稿表单（useDraftForm）
  page-controllers/                                   # 页面编排 hook
    query-client.ts                                   # createMusefoldQueryClient()
  workbench/workbenchSessionPreferences.ts            # 会话钉住/未读（localStorage helper）
```

- 组件只依赖 `@musefold/ui`、`@musefold/contracts`、`@musefold/domain`、`react`、`@tanstack/react-query`；禁 `window.api`、`cloud-client`、`electron`、`desktop-contracts`。
- controller/page-controller 一律显式 deps 注入（`{ ports…, platform }`），不引入 Context 隐式注入。

## 2. 分层与依赖规则（机器强制）

v1.2.2 §3.2 全部规则继续有效，v1.3 新增 `renderer-features-isolated-*`、`renderer-row-models-banned`、`product-ui-query-allowed`。速查：

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

`renderer-features-isolated-*` 与 `renderer-row-models-banned` 的 known-violations 已归零，禁止重新冻结（`tests/repo/boundary-baselines.test.ts`）。其余规则若确需豁免，才登记进 `tooling/dependency-cruiser-known-violations.json`，只减不增。

## 3. 实体与契约（v1.3 ENT）

- **contracts 是唯一暴露给 UI 的实体形状**。product-ui、store、组件中的实体类型一律来自 `@musefold/contracts`。
- **行模型是存储细节**：`desktop-contracts/models.ts` 行类型只允许出现在 core、主进程、`ipc/` 传输签名、`runtime/mappers/`。
- **桌面扩展用组合**：`GenerationJob & { localImagePath?; costUnit }`，禁止平行模型。
- **新增实体流程**：先 `packages/contracts` 定 schema → domain 端口（如需）→ 双端 gateway 实现 → mapper（桌面）→ page-controller → 组件。一步到位，不留「先在桌面行模型上做、以后再统一」。
- Zod schema 即文档：字段注释写业务语义（成本单位、快照冻结时机等），与 mapper 内的有损字段注释配对。

### 3.1 契约字段变更全流程（双端贯穿）

以「给 `PromptDocument` 加一个字段」为完整走线（§8 是简化版速查）：

1. **contracts**：定 schema + 字段注释 + schema 测试（默认值、旧文档无该字段时的解析行为）。
2. **兼容性结论写进注释**：新字段 optional/带默认与否；旧客户端读新文档、新客户端读旧文档各自的行为是什么，一句话写清。
3. **web-api**：路由出入参校验 + 存储（需要列变更时走 expand/contract 迁移闸门，流程见 `apps/web-api/AGENTS.md`）。
4. **cloud-client**：透传，不重新定义形状。
5. **桌面**：`desktop-contracts` 行模型（如需）→ core repository → SQLite 迁移（新建迁移文件 + 登记 `run-migrations.ts` 清单，两处都要）→ `runtime/mappers/` 行↔文档映射 → mapper 测试逐字段断言。桌面存不下的字段在 mapper 里显式声明丢弃并注释原因。
6. **消费**：page-controller 的 Query/参数扩展 → 组件（双端一份）。
7. **门禁**：`npm run openapi:check` + `npm run check`；触及桌面行为跑 E2E；触及共享面跑视觉门禁。

**有损字段声明约定**：凡 mapper 中存在「文档有、行没有」或语义降级（精度损失、枚举合并）的字段，必须在转换处逐条注释，contracts 侧字段注释与之配对。禁止静默丢字段。枚举映射用 `as const satisfies Record<行枚举, 文档枚举>` 保证穷举——新增枚举值而漏映射必须编译失败，而不是运行时 undefined。

## 3a. 表单（受控草稿 + 纯函数校验）

**不引入表单库。** 2026-08-21 复核：`react-hook-form` 装了近一年、`useForm` 调用点 0 个，规范与现实不符；依赖已移除，规范改为描述实际范式。理由是本应用的「表单」复杂度不在字段校验上——`ProviderDialog`(20 个 useState / 12 处 await)、`AiConnectionDialog`(17 / 9) 的状态大半是拉模型列表、测连接、写系统钥匙串这类异步副作用与远端结果，表单库管不到；真正的字段部分（`PromptEditorForm`）只有草稿对象加 touched。引入表单库要在 product-ui 加运行时依赖，收益覆盖不了这个代价（v1.3 D3 只批准了 `@tanstack/react-query` 一个新依赖）。

范式是 `useDraftForm`（`@musefold/product-ui`）：

```tsx
const form = useDraftForm<Draft, "title" | "content">({ initial, validate });
// validate 是纯函数 (draft) => Partial<Record<Field, string>>，可用 zod 实现，也可以直接写判断
<Input
  value={form.draft.title}
  onChange={(e) => form.setField("title", e.target.value)}
  onBlur={() => form.markTouched("title")}
  aria-invalid={Boolean(form.errorFor("title"))}
/>;
// 提交：form.touchAll(["title", "content"]) 后判 form.valid
```

- `errorFor` 只在字段被碰过后吐错误；提交路径用 `touchAll` 一次点亮。
- `dirty` 与 `initial` 逐值比较；宿主换 `initial`（保存成功后）草稿与 touched 自动归位。
- 校验一律是纯函数，不在其中做 IO；跨端共享的校验放 domain。
- 提交副作用用 `useMutation`（见 §4），不写在校验里。
- 参考实现：`packages/product-ui/src/library/PromptEditorForm.tsx`。

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

### 5.1b 多端复用与上提工作流（product-ui ⇄ 宿主）

组件出现跨端需求时按此流程上提，禁止「复制一份改改」：

1. **确认第二消费者是真的**：双端都要用，还是「将来可能」？拿不准留宿主（灰区规则）。
2. **去平台化体检**（上提前逐项过）：
   - 依赖清单只含 `ui` / `contracts` / `domain` / `@tanstack/react-query` / `react`；出现 `window.api`、`cloud-client`、`electron`、`desktop-contracts` 或平台分支 → 先把差异改成 props / 端口注入（platform、ports 经 page-controller 传入，不在组件里探测平台）；
   - 数据获取在 page-controller，组件保持受控；toast / 剪贴板 / 下载等副作用一律经 `PlatformServices` 注入；
   - 样式只用 token 类与原子类；断点分工——移动档（`PRODUCT_MOBILE_BREAKPOINT`）归宿主媒体块，compact 折叠归 product-ui 自有媒体查询，两档不混写；
   - 图标经 `@musefold/ui` icons 唯一入口。
3. **零逻辑变更移动提交**（`git mv` 与内容修改分离），落位 `packages/product-ui/src/<域>/`。
4. **双宿主验证**：`tests/repo/product-ui-dual-host-reuse.test.ts` + `npm run test:visual:shared`（双端同像素，阈值只收紧不放宽）+ `npm run check:v1.1`。
5. **成为共享面后**：新 surface 纳入共享视觉门禁清单；query 依赖经 `tests/repo/product-ui-query-deps.test.ts` 守卫。

反向规则：共享组件长出单端专属行为时，不在 product-ui 里堆平台分支；把差异上移宿主，或拆成「共享内核 + 宿主外壳」两个组件。

### 5.2 样式

- **桌面**：Tailwind v4 原子类为主 + `@musefold/ui` 原语；组合类名用 `tailwind-merge` 收敛。
- **Web**：现状手写 CSS；新组件优先复用 product-ui（其样式来自 ui 包 token 类），避免再造本地 CSS 体系。
- 设计 token 以 `packages/ui/src/tokens.css` 为单源；禁止在组件里硬编码色值/字号，使用 mf-ui token 类或 token CSS 变量。
- 图标唯一入口 `packages/ui/src/icons.ts`（lucide-react 直连全仓禁用，ESLint 强制）。
- 交互状态规范（loading/empty/error/disabled 全套、触达 44px、`prefers-reduced-motion`）遵循 [DESIGN.md](../../DESIGN.md)。

### 5.3 尺寸与拆分

- 单文件 ≤ 600 行（编辑器 warn；新文件超标即 CI 失败）；组件超过 ~200 行且含多个内联子组件时，把子组件拆为独立文件。
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
- 提交前自检门禁：`npm run check`（lint、两条边界检查、typecheck、test、双端 build）。触及桌面行为再跑桌面 E2E；触及共享 UI 再跑 `check:v1.1` / Web E2E / 共享视觉门禁。

### 7.2 CI 门禁（每 PR 必绿）

CI 源码检查（`ci.yml` 的 Source checks）跑：

`typecheck / test / build / lint / check:boundaries / check:ui-boundaries`

docs-only 变更跳过该 job。桌面 Linux / Windows E2E 在 GitHub 托管 runner 上跑（`.github/workflows/desktop-ci.yml`），由 `.github/layer-paths.yml` 的 **`desktop` 组**门控，不进 `ci.yml`，因此不挡住 Web/API 自动部署。content / service / shell 是发布分层，并不各自跑一套 E2E。macOS / Windows 安装包在打 `v*` tag 时由 `package-smoke.yml` 构建、上传，并由 `musefold-prod` 发布到官网 `downloads/`；首页链接 `version=latest`，随 catalog 自动换版。`format:check` 仍不进 CI（v1.2.1 裁定：全仓 format 会淹没 `git mv` 历史）。

## 8. 新功能开发流程（端到端清单）

以「给提示词库加一个标签过滤」为例，v1.3 目标路径：

1. **契约**：`packages/contracts/src/prompt.ts` 加字段/schema → 单测。
2. **端口**（跨端能力才需要）：`domain` 对应 Gateway 签名扩展。
3. **双端实现**：web-api 路由 + `cloud-client`；桌面 mapper + IPC handler。
4. **编排**：`useLibraryPageController` 的过滤参数与 Query key 扩展（单点）。
5. **UI**：product-ui 过滤控件（双端同像素）；桌面特有挂载差异。
6. **测试**：mapper 单测 → controller 单测 → 双端 E2E 用例 → 视觉门禁。
7. **提交**：`feat(library): add tag filter (Skill-Impact: none)`。

第 4–5 步双端只写一份（v1.3 已完成）。

## 9. 禁止事项速查（红线）

- ❌ store 中存 gateway/IPC 返回的服务端数据（v1.3 起）
- ❌ feature 直接 import 兄弟 feature 的模块/store（v1.3 起）
- ❌ 渲染层 import `electron`、`lib/ipc`、裸 `window.api`（仅 `runtime/desktop-host-services.ts` 可 import `lib/ipc`；裸 `window.api` 只属于 runtime 桥接、`lib/ipc`、预览桥、以及窗口壳探测 `lib/usePlatform.ts`）
- ❌ product-ui 出现 `window.api` / `cloud-client` / `electron` / `desktop-contracts`
- ❌ 渲染层/UI 引用 `desktop-contracts` 行模型（v1.3 起；mapper 与传输签名除外）
- ❌ 手写 localStorage 持久化（persist middleware 之外）
- ❌ 直接 import `lucide-react`（唯一入口 `@musefold/ui` icons）
- ❌ 静态循环依赖
- ❌ 新增与云语义平行但形状不同的实体类型
- ❌ 未过门禁的巨型文件（baseline 之外新文件即受 max-lines 约束）
- ❌ API Key / 凭据进渲染层、SQLite、日志、导出文件（Electron 密钥红线）

## 10. 相关文档

- 根 `AGENTS.md` 与 `apps/desktop` / `packages` / `apps/web` / `apps/web-api` 的就近 AGENTS.md——AI 代理开发约束入口（人类同样适用）
- [v1.3 系统架构](../v1.3/V13-ARCHITECTURE.md)——目标架构与迁移卡
- [v1.2.2 系统架构](../v1.2.2/V122-ARCHITECTURE.md)——现行分层基线与依赖规则
- [v1.1 共享 UI 架构](../v1.1/V11-SHARED-UI-ARCHITECTURE.md)——product-ui 边界规则
- [DESIGN.md](../../DESIGN.md) / [PRODUCT.md](../../PRODUCT.md)——设计系统与产品原则
- [CONTRIBUTING.md](../../CONTRIBUTING.md)——提交规范与 Skill-Impact
