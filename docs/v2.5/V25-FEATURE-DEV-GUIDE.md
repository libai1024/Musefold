# V25-FEATURE-DEV-GUIDE — v2.5 新功能开发最佳实践指南

> **状态**:实践指南(非规范源)
>
> **日期**:2026-08-29
>
> **定位**:回答「在 v2.5 架构下开发一个新功能,每一步怎么做、代码写成什么样、怎么复用、怎么测」。规范裁决权在源码与四份规范文档([架构](./V25-ARCHITECTURE.md) / [交付计划](./V25-DELIVERY-PLAN.md) / [数据迁移](./V25-DATA-MIGRATION.md) / [UI 规范](./V25-UI-SPEC.md));本文与它们冲突时以后者为准,发现过期顺手回写本文。
>
> **读者**:所有向本仓库交付代码的人与 AI 代理。约束入口仍是根 `AGENTS.md` + 目标目录就近 `AGENTS.md`,本文不替代它们,只把「怎么落地」展开。

---

## 0. 心智模型:一次开发,四端复用

复用的单位是**包**,不是宿主框架。页面级产品模块在 `packages/features` 只写一份,四个交付面(Windows / macOS 桌面、PC Web、Mobile Web)由两个薄宿主承载;宿主只做三件事:**路由挂载、壳注入、gateway 注入**,永远不写业务 UI。

```text
                    packages/ui(shadcn 原语 + token,零产品语义)
                            ↑
packages/contracts → packages/features(屏幕组件 + Query hooks + 域内 store)
 (zod 唯一实体源)           ↑ 只依赖接口
                    packages/platform(MusefoldGateway 接口 + queryKeys + capabilities)
                            ↑ 宿主注入实现
        ┌───────────────────┴────────────────────┐
   apps/web-next(Next.js 16)              apps/desktop 渲染壳(src/v25 薄壳)
   gateway = packages/api-client           gateway = desktop-gateway(typed IPC)
        │ HTTPS(同源 /api/*)                    │ musefold:invoke 单通道
   apps/api(Hono + zod-openapi)            Electron 主进程 ipc-v25/<域>-domain.ts
        │                                        │
   PostgreSQL(packages/db)                 SQLite(packages/desktop-db 受管)
```

**一个功能的六层走线**(后文各节逐层展开,§8 有完整 checklist):

| 层 | 位置 | 产出 |
|---|---|---|
| 1. 契约 | `packages/contracts/src/<域>.ts` | zod schema + `z.infer` 类型 + schema 测试 |
| 2. 接缝 | `packages/platform/src/gateway.ts` / `query-keys.ts` | gateway 接口方法 + query key |
| 3. 功能 | `packages/features/src/<域>/` | 屏组件 + hooks + 就地测试(**四端只写这一份**) |
| 4. Web 数据链 | `apps/api/src/modules/<域>/` + `packages/api-client` | Hono 路由 + service + HTTP 实现 |
| 5. 桌面数据链 | `apps/desktop/electron/main/ipc-v25/` + `src/v25/desktop-gateway.ts` | 域方法表 + invoke 映射 |
| 6. 宿主挂载 | `apps/web-next/src/app/<路由>/page.tsx` + `apps/desktop/src/v25/main.tsx` | 各一处薄包装(新屏才需要) |

判断自己写的东西放对没放对,先问:**这段代码换一个宿主还成立吗?** 成立 → features/共享包;不成立 → 宿主或主进程。依赖方向由 `tooling/dependency-cruiser.cjs` 机器强制(0 豁免),写之前拿不准就看 `packages/AGENTS.md` 的格架图。

---

## 1. 开工前:判定改动触达哪几层

| 改动类型 | 触达层 | 必读 |
|---|---|---|
| 纯 UI 调整(布局/文案/交互) | features(+ ui 如缺原语) | V25-UI-SPEC 对应章节;差异须登记其 §9 |
| 给现有实体加字段 | contracts → api + api-client → ipc-v25 域 → features | `packages/AGENTS.md` contracts 节 |
| 给现有域加方法 | contracts(如需新形状)→ platform → 双端实现 → features | 本文 §8-A |
| 全新域/新屏 | 全部六层 + 宿主挂载 + E2E | 本文 §8-B;先补 V25-UI-SPEC 规格 |
| 桌面本地能力(文件/密钥/系统) | ipc-v25 域 + capabilities flag | `apps/desktop/AGENTS.md` |
| SQLite 表结构 | packages/desktop-db 迁移流程 | `apps/desktop/AGENTS.md` 迁移节 |
| PG 表结构 | packages/db(expand/contract) | V25-DATA-MIGRATION |
| 新 UI 原语 | packages/ui(shadcn CLI 装入) | V25-UI-SPEC §10.1 |

两条最容易放错的边界:

- **features 禁止出现** `import 'electron'`、`import 'next/*'`、Node 内置、宿主路径、`window.api`——depcruise 直接拦截。宿主差异只有两个合法出口:`PlatformCapabilities` flag(条件渲染)和宿主回调 prop(如 `onOpenSettings`)。
- **纯 UI 状态不进契约**;桌面本地概念(文件路径等)不进 `contracts`(会被 schema 测试当作泄漏拦下)。

---

## 2. 第一步永远是契约(packages/contracts)

实体 = zod schema,全仓唯一形状源;任何消费方类型一律 `z.infer` 推导,禁止手写平行 interface。一个域文件的标准结构是「实体 → 输入变体 → 分页页 → 查询 schema → 类型导出」。

### 2.1 schema 写法惯例

```ts
// packages/contracts/src/workbench.ts(节选)
export const workbenchSessionSchema = z.object({
  id: entityIdSchema,                       // 公共原语一律来自 common.ts,不各写一套
  title: z.string().trim().min(1).max(120),
  version: z.number().int().positive(),     // 乐观锁
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),  // 软删标记
  /**
   * 会话行状态点(V25-UI-SPEC §3.3)的派生字段;
   * default null 使旧响应无损兼容。
   */
  latestJobStatus: generationJobSchema.shape.status.nullable().default(null),
});
```

- **跨域字段引用用 `.shape`**(`generationJobSchema.shape.status`),不复制枚举。
- **输入变体从实体派生**:`.pick()` 选字段、`.partial().extend({ expectedVersion })` 造 update 形状、`z.object({ title: xxxSchema.shape.title, … })` 逐字段复用。
- **加字段必须考虑兼容**:新字段带 `.default(...)` 或 `.nullable()`,让旧 wire 数据/旧存档解析不炸;兼容结论写进字段注释。
- **注释写业务语义**(规范章节号、成本单位、nullable 原因),不写「这是标题」式废话。schema 即文档。
- 查询串字段用 `common.ts` 的 `queryIntegerSchema`/`queryBooleanSchema`,**不用 `z.coerce`**(coerce 的 `z.input` 是 unknown,会毁掉 gateway 方法签名的类型价值)。

### 2.2 类型导出三分法

```ts
export type WorkbenchSession = z.infer<typeof workbenchSessionSchema>;           // 实体/出参
export type CreateWorkbenchSession = z.input<typeof createWorkbenchSessionSchema>; // 入参含 default,调用方可省略
export type ParsedWorkbenchSessionListQuery = z.output<typeof workbenchSessionListQuerySchema>; // 解析后(服务端视角)
```

| 场景 | 用法 |
|---|---|
| 出参实体 | `z.infer` |
| 入参且 schema 带 `.default()` | `z.input`(调用方省略默认字段) |
| handler 内解析后的形状 | `z.output`,类型名加 `Parsed` 前缀 |

### 2.3 schema 测试(契约包必须有)

`packages/contracts/src/__tests__/contracts.test.ts`,测**行为不变量**而非字段存在性,四类断言:

1. **默认值稳定**:`schema.parse({})` → `toMatchObject({ limit: 20, … })`;
2. **存量数据兼容**:旧形状(如布尔 `reducedMotion`)解析出新枚举,映射表写进用例注释;
3. **边界拒绝**:`safeParse({ id: '../escape' }).success` 为 `false`(路径穿越、超限数组、空字节);
4. **越权字段剥离**:`expect(parsed).not.toHaveProperty('imagePath')`——桌面本地路径不得泄漏进云契约。

---

## 3. 数据接缝(packages/platform)

platform 是**接口叶子**:只依赖 contracts,不含任何实现。features 对数据的全部认知就是这一个包。

### 3.1 gateway 接口

新方法加进对应域接口(`packages/platform/src/gateway.ts`);新域则新增 `<Domain>Gateway` interface 并挂到 `MusefoldGateway`。签名惯例:

- `update(id, patch)` 两参,不合并成单对象;
- 软删 `remove` 返回实体(方便乐观更新),硬删 `purge` 返回 `void`;
- 入出参类型全部 `import type` 自 contracts。

**宿主差异的表达只有两种,类型层各管一半**:

```ts
export interface MusefoldGateway {
  settings: SettingsGateway;      // 必选域:两端都有
  // …
  aiProviders?: AiProvidersGateway; // 桌面专属:可选属性,Web 宿主不实现
  sync?: SyncGateway;               // UI 以 capabilities 对应 flag 判断是否渲染
}
```

新增桌面专属能力时:gateway 加可选域 + `capabilities.ts` 加一个语义化 flag(`hasXxx`),两份常量(`DESKTOP_CAPABILITIES`/`WEB_CAPABILITIES`)同步补值。**features 里禁止 `isElectron`/userAgent 探测**,只认 flag。

### 3.2 query keys 工厂

key 只能来自 `queryKeys`(`packages/platform/src/query-keys.ts`),组件/hooks 禁止手拼数组——两宿主共用同一份 key,手拼会导致缓存失效错位。惯例:

- 每个可失效域有 `all()` 作失效前缀;
- 列表 key 把整个 query 对象嵌进 key 做缓存分区:`(query) => ['prompts', 'list', query] as const`;
- 同源数据、不同页结构(普通列表 vs 无限分页)拆两个 key,互不覆盖(参见 `generation.list` vs `generation.history` 的注释)。

### 3.3 注入与消费

宿主在根部包 `<PlatformProvider runtime={{ gateway, capabilities }}>`;features 内部经 `useGateway()` / `useCapabilities()` / `usePlatform()` 消费。缺 Provider 直接抛错,不静默降级。

---

## 4. packages/features:屏幕与 hooks(核心复用层)

### 4.1 目录、导出与依赖纪律

```text
packages/features/src/<域>/
  <Domain>Screen.tsx     # 屏组件(编排层),一屏一个
  <子部件>.tsx            # 同目录平铺,不建 components/ 子目录
  hooks.ts               # 该域全部 query/mutation hooks + 可测纯函数
  <thing>-store.ts       # 跨组件 UI 状态(zustand),按需
  index.ts               # 显式具名导出组件与类型;hooks 用 export * 整批放出
  __tests__/<域>.test.tsx
```

- 包导出**只有子路径**(`@musefold/features/workbench`),无根 barrel;**新增域要在 `packages/features/package.json` 的 `exports` 加一行**。
- 运行时依赖仅 `contracts` + `platform` + `ui` + `zustand`;React 与 TanStack Query 是 peer。
- 每个文件头 `'use client'`(Next RSC 边界;桌面 Vite 无感)。
- 跨域引用走相对路径(如 workbench 引 settings 的 `usePreferences`),同包内不绕子路径导出。

### 4.2 屏组件结构(编排层)

组件文件的固定组织顺序:`'use client'` → imports → 模块常量 → **导出的纯函数**(供单测直接断言)→ 内部工具 → Props interface → 组件。组件体内:hooks 集中顶部 → 派生值 → 事件处理 → JSX 节点变量 → return。

**Props 只收宿主回调,不收数据**:

```tsx
export interface WorkbenchScreenProps {
  /** Composer 无连接引导「前往设置」的切屏回调(宿主注入)。 */
  onOpenSettings?(): void;
  onOpenPrompts?(): void;
}
```

数据一律组件内经 hooks 自取——屏组件是自包含的,宿主不需要知道它要什么数据。子部件(如 `Composer`)保持**受控无状态**(`value`/`onChange`/`onSubmit`),不碰 gateway。契约类型与组件本地视图模型之间写显式双向转换函数(`draftToComposerValue`/`composerValueToDraft`),与组件同文件导出。

### 4.3 hooks 惯例(TanStack Query)

```ts
// 查询:key 来自 queryKeys,queryFn 只调 gateway
export function useSessionList(query: WorkbenchSessionListQuery = {}) {
  const { gateway } = usePlatform();
  return useQuery({
    queryKey: queryKeys.workbench.sessions(query),
    queryFn: () => gateway.workbench.listSessions(query),
    // 条件轮询:有活动任务才轮,从缓存数据自判,到终态自停
    refetchInterval: (q) => (q.state.data?.items.some(sessionHasActiveJob) ? 3_000 : false),
  });
}

// 变更:多参用对象包;写后失效用域级 all() 前缀
export function useUpdateSession() {
  const { gateway } = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; patch: UpdateWorkbenchSession }) =>
      gateway.workbench.updateSession(vars.id, vars.patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workbench.all() }),
  });
}
```

- 命名:查询 `use<Entity>List`/`use<Entity>s`,变更 `use<Verb><Entity>`。
- 域内共用的失效逻辑抽成本地 `useInvalidateXxx()`;跨域联动(生成推进影响会话排序)在失效函数里一并 invalidate 并注释原因。
- 无限分页:`useInfiniteQuery` + `initialPageParam: undefined as string | undefined` + `getNextPageParam: (last) => last.nextCursor ?? undefined`。
- 乐观更新(UI-SPEC §8-I6:列表内 CRUD 一律乐观):`onMutate` 快照 → `onError` 回滚 → `onSettled` 失效,参考 `settings/hooks.ts` 的完整三段式。
- 轮询是过渡机制(事件推送随后续卡接入),新轮询必须像上例一样**数据驱动、可自停**,判定函数导出供单测。
- hooks 文件同时放该域纯函数工具(格式化、query 构造),从 index 一并导出——单测直接测纯函数,不用渲染。

### 4.4 状态分工(zustand 只存 UI 指针)

| 状态种类 | 归属 | 反例 |
|---|---|---|
| 服务端数据(列表/详情/账号) | TanStack Query 缓存 | 存进 zustand = 违规 |
| 跨壳/屏 UI 指针(活动会话 id、跨屏意图) | zustand store(features 域内) | — |
| 组件局部状态(草稿、开合) | `useState`/`useRef` | — |
| 用户偏好 | 契约 `AppPreferences` 经 settings gateway | 手写 localStorage |

store 惯例:`create<XxxState>()` 单文件一个 store;派生逻辑写成**导出纯函数**(入参是显式 state 切片,如 `isSessionUnread(seenAt, unreadMarks, session)`)而不是塞进 store;组件用**细粒度 selector**(`useActiveSession((s) => s.activeSessionId)`)订阅,不整取。跨屏传递(库「送入制作」→ 工作台)用 consume-once 字段(`pendingDraft` 装载即清),不用事件总线。

### 4.5 响应式:同一组件适配 PC 与移动

PC/移动**不是两套组件**,是同一 features 屏幕的 CSS 分叉:

- 默认工具:Tailwind `md:` 断点互斥渲染两种形态(`md:hidden` / `hidden md:flex`)。壳层三形态(桌面窗口 / Web≥md / Web<md 底部标签栏)全部在 `features/shell/AppShell.tsx` 内解决,宿主无感。
- **JS 媒体查询是例外**,仅当两种形态 DOM 结构真的不同(历史屏 Inspector 内嵌右栏 vs Sheet 抽屉)才用 `useMediaQuery`(`useSyncExternalStore` 三参形式,SSR/jsdom 安全回退 false)。
- 宿主相关的几何量由宿主传入,组件不自算:两宿主给屏组件套 `h-[calc(100dvh-7rem)] md:h-dvh`(窄屏壳 3rem 顶栏 + 4rem 底栏);macOS 红绿灯让位经 `brandInset` prop。
- 移动端无 hover:操作组常显(UI-SPEC §9-D1),表单优先 Sheet,触达尺寸从宽。

### 4.6 UI 原语与 token 纪律

- 原语只用 `@musefold/ui`:`@musefold/ui/components/<name>`、图标唯一入口 `@musefold/ui/icons`(禁直连 lucide-react)、`cn()` 来自 `@musefold/ui/lib/utils`。缺原语用 shadcn CLI 装入 ui 包,**禁止在 features/宿主内新建平行原语**。
- 颜色/圆角/阴影只允许语义 token 类(`bg-background`、`text-muted-foreground`、`border-border`、`text-primary`);**禁止** `#hex`、`rgb()`、调色板类(`text-orange-500`)。主题切换靠 `<html>.dark`,新主题 = globals.css 加一个 token 覆盖块,组件零改动。
- 动效时长/缓动用 token(`duration-(--dur-fast)`、`ease-(--ease-out)`),裸毫秒值评审打回;必须尊重减少动效(全局压制机制已内建于 ui 包 globals.css)。
- 交互反馈遵守 UI-SPEC §8 九条约定(I1–I9):四态齐全(loading/empty/error/ready)、动作不藏浮层、破坏性动作 AlertDialog、乐观更新失败回滚 + toast、图标钮必带 `aria-label`。
- 每个交互元素带 `data-testid`,命名 `<域>-<对象>-<动作>`,列表行 `<域>-row-<id>`;E2E 只允许 testid/role 定位,这是单测与 E2E 共用的稳定契约。

---

## 5. Web 端接入(apps/api → packages/api-client → apps/web-next)

### 5.1 apps/api:契约直接成为路由

模块化组织 `apps/api/src/modules/<域>/{routes.ts,service.ts}`:routes 只做「schema 绑定 + service 调用」,业务在 service(便于集成测试直测 service)。

```ts
// apps/api/src/modules/workbench/routes.ts(节选)
route(
  app,
  {
    method: 'patch',
    path: '/workbench/sessions/{id}',
    tags,
    params: idParams,
    body: updateWorkbenchSessionSchema,   // contracts schema 直接进路由定义
    response: workbenchSessionSchema,     // OpenAPI 与实现天然同步
  },
  async (c, input) => c.json(await service.update(c.get('userId'), input.params.id, input.body)),
);
```

REST 惯例:集合 `GET/POST /xxx`,单体 `GET/PATCH/DELETE /xxx/{id}`,动作用子资源 `POST /xxx/{id}/restore|purge|cancel|retry`。鉴权走 `createAuthedRouter()`(userId 从上下文取,应用层按 userId 过滤);错误统一 AppError → 契约错误信封(`{ error: { code, message, retryable, requestId } }`)。写路径注意幂等(生成类接口收 `idempotency-key` 头)。PG 表结构改动走 `packages/db` 的 expand/contract 迁移,迁移 SQL 必须进 PR 评审。

### 5.2 packages/api-client:gateway 的 HTTP 实现

一方法一段 REST 映射,**出参 schema 必填、一律 zod 复核**:

```ts
listSessions: (query: WorkbenchSessionListQuery) =>
  http.request({
    method: 'GET',
    path: '/workbench/sessions',
    query: { ...query },
    response: workbenchSessionPageSchema,
  }),
```

- `ApiHttp` 单点封装 fetch:`credentials: 'include'`(cookie 会话)、baseUrl 空串保持相对路径(同源部署)、fetch 可注入(测试用 fetchStub 断言 URL/body)。
- 错误收敛为 `ApiRequestError(code, message, status, retryable, requestId?)`,三级降级解析(契约信封 → Better Auth 顶层形状 → 兜底 INTERNAL_ERROR);网络层 TypeError 原样透出。
- 包类型是 `CloudDataGateway = Omit<MusefoldGateway, 'settings'>`——settings 是宿主本地关切,由宿主组装补齐。api-client 依赖只允许 contracts + platform(depcruise 强制)。

### 5.3 apps/web-next:薄壳挂载

- **新屏 = 一个 `src/app/<路由>/page.tsx`**,内容只有:`'use client'`、import 屏组件、高度容器、宿主回调接 `router.push`:

```tsx
'use client';
import { WorkbenchScreen } from '@musefold/features/workbench';
import { useRouter } from 'next/navigation';

export default function WorkbenchPage() {
  const router = useRouter();
  return (
    <div className="h-[calc(100dvh-7rem)] md:h-dvh">
      <WorkbenchScreen onOpenSettings={() => router.push('/settings')} />
    </div>
  );
}
```

- 全局装配已就绪不需动:`lib/providers.tsx`(QueryClient 用 `useState` 惰性初始化——SSR 每请求一实例;`createWebGateway()` = api-client 云域 + localStorage settings 域)、`layout.tsx`(主题防闪 `THEME_BOOT_SCRIPT`)、`components/app-shell.tsx`(壳接线,`activeId` 从 pathname 反推)。
- 认证零 SDK:同源部署 + cookie 隐式携带。dev 由 `next.config.ts` rewrites 反代 `/api/*` 到本地 API,生产由部署层同域路由;**API 刻意不开 CORS**(D12),不要为「联调方便」加。
- 样式无需配置:`globals.css` 的 `@source` 已声明跨包扫描(ui/features/自身);若 features 加了新目录结构不用动,加了**新包**才要补 `@source` 与 `transpilePackages`。

### 5.4 移动端 = 同一应用

不存在「移动端项目」:Web < md 自动切移动形态(壳层底部标签栏 + 顶栏,features 内断点分叉)。开发时用浏览器设备模拟器对照 `web-mobile` E2E 项目的 iPhone 13 视口(390×844)自查;凡新增屏幕,web-desktop 与 web-mobile 两个 E2E project 会各跑一遍同一份 spec,移动形态不是可选项。

---

## 6. 桌面端接入(apps/desktop)

### 6.1 数据域一律走单通道桥

链路:`desktop-gateway.ts`(渲染层)→ `preload/v25.ts`(纯转发,永远不要加逻辑)→ `ipcMain.handle('musefold:invoke')` → 域方法表 → SQLite。**不要绕开桥另开 IPC 通道**——遗留多通道面(updater/pet)是冻结清单。

主进程侧,方法表条目 = `input schema + handle`:

```ts
// apps/desktop/electron/main/ipc-v25/workbench-domain.ts(示意,模式与真实代码一致)
const updateSessionInput = z.object({ id: entityIdSchema, patch: updateWorkbenchSessionSchema });

'workbench.updateSession': {
  input: updateSessionInput,
  handle: async (input) => {
    const { id, patch } = input as z.output<typeof updateSessionInput>;
    const row = getSessionRow(id);            // 找不到 → throw new BridgeError('NOT_FOUND', '会话不存在')
    if (row.deleted_at != null) throw new BridgeError('CONFLICT', '会话已删除');
    // …直写 SQLite,返回契约形状
    return sessionRowToDocument(row, /* draft, latestJob */);
  },
},
```

惯例与红线:

- 方法名 `'<域>.<方法>'` 与 gateway 方法一一同名;新域在 `gateway-bridge.ts` 的 `buildMethods()` 展开 `...buildXxxDomainMethods()`。
- **错误走信封,不走异常序列化**:业务错误抛 `BridgeError(code, message)`,桥统一转 `{ ok: false, code, message }`;message 一律中文、面向用户、带下一步动作(「任务仍在进行中,请先取消」)。已知第三方异常在 handler 内翻译成 BridgeError,未知异常留给桥兜底 INTERNAL_ERROR。非致命副作用失败(清理文件等)只 `logger.warn` 不中断。
- SQLite 行(snake_case)与契约文档(camelCase)之间写显式 `<entity>RowToDocument` 映射;行 interface `<Entity>Row` 只活在 domain 文件内,**不得泄漏到渲染层**。列表查询用「LIMIT n+1 探测下一页 + 批量读联表(`readXxxMap`)防 N+1」。
- 安全:渲染层自报的路径/URL 不可信,`media://` 必须解析并校验落在受管根目录内(防目录穿越);密钥只经主进程 `safeStorage`,SQLite 只存 `has_key`/`key_suffix` 展示位。

渲染层 `desktop-gateway.ts` 补一行映射即可,**payload 打包形态必须与桥 input schema 精确对齐**(裸 id vs `{ id }` vs `{ id, patch }`——两边同改,类型不会帮你查这个):

```ts
updateSession: (id, patch) =>
  invoke('workbench.updateSession', { id, patch }, workbenchSessionSchema),
```

`invoke` 已内建三层处理:桥缺失 → 信封解封(`ok:false` 抛 `DesktopGatewayError(code, message)`)→ 出参 zod 复核。即**入参主进程校验、出参渲染层复核,两端各守一道**。

### 6.2 SQLite 迁移(表结构改动才需要)

事实源 `packages/desktop-db`:改 `src/schema.ts` → `pnpm --filter @musefold/desktop-db run db:generate` 生成增量 SQL → **必须再跑 `db:bundle`** 把迁移内联进 `src/migrations.generated.ts`(打包环境无 SQL 文件可读,漏这步产物启动即崩)→ 就地迁移测试(真实旧库结构 → 迁移 → 断言数据保留)。legacy 接管链(0001–0020 + fakeApplyBaseline)不要动。

### 6.3 新屏挂载(桌面侧)

`apps/desktop/src/v25/main.tsx` 是全部壳逻辑:无 router,`useState<ViewId>` + if 分发。新屏 = `ViewId` 目录(`features/shell/nav.ts` 的 `SHELL_NAV_ITEMS`,双宿主同一份)加项 + `DesktopView` 加分支。宿主特有行为(窗口拖拽区、Radix 浮层 no-drag 豁免)经 `data-testid`/`data-slot` 属性从 `globals.css` 反向挂载,不污染共享组件。

---

## 7. 测试:每层测什么、怎么测

新代码必须带就地 `__tests__/`;不删测试让门禁变绿;断言与现实矛盾时先裁定哪边错,修错的一方。

| 层 | 工具与模式 | 测什么 |
|---|---|---|
| contracts | vitest(根任务跑) | 默认值/兼容/拒绝/剥离四类不变量(§2.3) |
| features | vitest + jsdom + Testing Library(包内 config 跑) | fake gateway 注入,测屏组件行为与状态矩阵 |
| api-client | vitest + fetchStub | URL/query 序列化、body 形状、错误归一化 |
| apps/api | vitest;集成测试 testcontainers 真 PG(`test:integration` 单独开) | service CRUD/冲突/幂等/重放 |
| ipc-v25 域 | vitest + `vi.mock('electron')` + **真实临时目录 SQLite** | 直调方法表 `handle`,断言落库/磁盘副作用/BridgeError |
| 端到端 | Playwright 四 project(web-desktop / web-mobile / electron / package-smoke) | 主路径 + 视觉快照三形态 |
| 仓库门禁 | `tests/repo/`(文件尺寸/别名一致性/manifest 边界等) | 结构性约束,自动生效 |

### 7.1 features 测试范式(fake gateway)

```tsx
// 内存 gateway:按域接口标注类型,让 TS 保证 fake 与真实接口同形
const workbench: WorkbenchGateway = { listSessions: async () => ({ items: […], nextCursor: null }), … };
const gateway = memory as unknown as MusefoldGateway;   // 未实现域断言掉

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
render(<WorkbenchScreen />, {
  wrapper: ({ children }) => (
    <QueryClientProvider client={queryClient}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>{children}</PlatformProvider>
    </QueryClientProvider>
  ),
});
```

- 每次 render 新建 QueryClient(缓存天然隔离);zustand store 在 `beforeEach` 用 `setState` 手动复位。
- 轮询类逻辑让 fake 的 `list()`「读取即推进」状态,组件轮询自然到终态,免 fake timer。
- 跨组件协作(壳会话区 + 工作台屏共享 store)要**组合渲染**一起挂,分开渲染测不到。
- capabilities 作参数传入 render helper,同一用例集分别验 `WEB_/DESKTOP_CAPABILITIES` 的能力门控。
- 断言用 `getByTestId` + `data-*` 属性;导出的纯函数单独 `describe` 直测(注入固定 `now` 防时区漂移)。
- `describe` 名带规范坐标(「isSessionUnread(§3.3 未读点推导)」),测试直接引用 UI-SPEC 章节号。

### 7.2 主进程域测试范式(真 SQLite)

`mkdtempSync` 临时 userData + `configureCoreRuntime` 注入路径(真库真迁移),`vi.mock` 只顶掉 electron/logger/外部生图服务;种子数据裸 SQL 直插,断言回查 SQL + `existsSync` 验磁盘;直调 `methods['generation.purge'].handle(...)`,错误断言 `rejects.toThrow('中文片段')`。`vi.mock` 工厂需前置状态时用 `vi.hoisted()`。

### 7.3 E2E 与视觉快照纪律

- Web spec 用 `page.route('**/api/v1/**')` 做带状态机的网络 mock(兜底 404 带 `mock 未覆盖:${method} ${path}` 诊断);Electron spec 反过来用真 IPC 真 SQLite,直接开库种数据/验落库(含「密钥明文不落库」断言)。
- 同一份 `web.*.spec.ts` 在桌面(1280×800)与移动(iPhone 13)视口各跑一遍;跨形态不对等的用例 `test.skip(project === 'web-mobile', '原因')` 显式登记。
- 视觉快照:固定时钟(`page.clock.setFixedTime`)钉住时段性 UI;时间戳等动态元素一律 `mask`;深浅色切换走真实设置路径且用例自含导航;截完复原状态,会改变视觉的输入类用例置文件末尾。
- 交付验收口径(UI-SPEC §11):布局对规范、状态矩阵全覆盖、三形态 E2E + 快照、`pnpm run check` 全绿、零硬编码色值。

---

## 8. 端到端标准走线(checklist)

### A. 给现有域加一个字段/方法(最常见)

1. **contracts**:改/加 schema(新字段配 `.default()`/`.nullable()`),补类型导出,补 schema 测试。
2. **platform**:方法进 `<Domain>Gateway`;新查询形态补 `queryKeys`。
3. **Web 链**:`apps/api/src/modules/<域>/` 路由 + service(+ PG 迁移如需);`packages/api-client/src/gateway.ts` 加 REST 映射 + 测试补 URL/body 断言。
4. **桌面链**:`ipc-v25/<域>-domain.ts` 方法表加条目(+ SQLite 迁移如需,记得 `db:bundle`);`desktop-gateway.ts` 加 invoke 映射(payload 形态对齐 input schema);域测试补用例。
5. **features**:`hooks.ts` 加 hook → 屏组件消费 → `__tests__` 的内存 gateway 补对应方法(TS 会因 fake 接口不完整报错——这是有意的门禁,别用 any 糊掉)。
6. **门禁**:`pnpm run check`;碰 UI 加跑 `pnpm run test:e2e`;碰主进程加跑 electron project;视觉变化按规矩重收基线。
7. **提交**:`feat(<scope>): <subject>`;UI 与旧版有意不同处登记 UI-SPEC §9;影响 CLI/MCP/Automation 对外能力时同步官方 Agent Skill(CONTRIBUTING)。

### B. 新增一个域/新屏(完整走线)

在 A 基础上追加:

1. 动工前先在 V25-UI-SPEC 补该屏规格(布局/状态矩阵/testid),按「承旧优先、差异登记」原则评审过再写代码。
2. contracts 新建 `src/<域>.ts` 并挂 `index.ts`;platform 新建 `<Domain>Gateway` 挂 `MusefoldGateway` + `queryKeys.<域>`。
3. features 新建 `src/<域>/`(§4.1 结构),**`package.json` exports 加子路径**。
4. 桌面新域:`ipc-v25/<域>-domain.ts` 的 `build<Domain>DomainMethods()` 在 `gateway-bridge.ts` 展开。
5. 宿主挂载:web-next 加 `app/<路由>/page.tsx`;导航项进 `features/shell/nav.ts` 的 `SHELL_NAV_ITEMS`(双宿主自动获得);桌面 `main.tsx` 的 `DesktopView` 加分支。
6. E2E:`tests/v25/web.<域>.spec.ts` + `electron.<域>.spec.ts` + 三形态视觉基线。

---

## 9. 效率手册

### 9.1 命令速查

| 场景 | 命令 |
|---|---|
| 桌面开发 | `pnpm run dev`(停用 `pnpm run dev:stop`,别 kill 正式版 App) |
| Web 开发 | `pnpm run dev:web`;调云链路再起 `pnpm run dev:infra` + `dev:api`(+ `dev:worker`) |
| 全量门禁(交付前必绿) | `pnpm run check` |
| 单包单测(内环最快) | `pnpm --filter @musefold/features run test`;根 `pnpm run test:watch` |
| E2E 全量 | `pnpm run test:e2e`(自带双端构建) |
| 仅 Electron E2E | `pnpm run build && pnpm exec playwright test -c tests/v25 --project electron` |
| 单跑一个用例 | 追加 `-g '<标题片段>'`(快照用例已自含导航,可单跑) |
| 重收视觉基线 | `--update-snapshots`;**布局改版用 `--update-snapshots=all`**(默认 changed 会静默留脏基线) |
| API 集成测试(真 PG) | `pnpm --filter @musefold/api run test:integration` |

### 9.2 让缓存为你干活

- `check` 走 turbo:没改的包直接 cache hit,放心全量跑。但**根任务 cache hit 会重放旧日志**——怀疑「绿得不对劲」时 `--force` 复核(历史上 38 个 lint error 被 cache 掩盖过整整几卡)。
- `turbo.json` 的 `globalDependencies`(biome.json、各 tsconfig)一改全量失效,基建改动和业务改动分开提交,少交叉失效。
- vitest 分两层:根任务只扫 `*.test.ts`(node 环境),`.tsx` 组件测试由包内 config(jsdom)跑——写了组件测试却只跑根任务会漏,内环用 `--filter` 直跑目标包。

### 9.3 已知坑清单(前人踩过,登记在交付计划落地备注)

| 坑 | 规避 |
|---|---|
| 桌面渲染层改完直接跑 Electron E2E,跑的是旧代码 | Electron E2E 加载 `out/` 产物,先 `pnpm run build` |
| 残留 `next dev`(端口 3399)被 Playwright reuse,卡死或旧 UI | 跑 E2E 前清端口 |
| Electron E2E 用 `firstWindow()` 拿到即关的迁移窗口 | 用 `tests/v25/electron-helpers.ts` 的 `v25ShellPage()` 按 URL 等壳窗口 |
| 视觉基线含时间戳/时段问候,跑一次挂一次 | 动态元素 `mask`;`page.clock.setFixedTime` 钉时钟 |
| desktop-db 改 schema 后忘 `db:bundle` | 打包产物启动即崩;两步连跑 |
| `vi.fn(async (input) => …)` 吞参数类型推断 | fake 显式标注参数类型 |
| jsdom 无布局/Radix 缺 pointer capture | 滚动几何用 `Object.defineProperty` 注入;`beforeAll` 补 `hasPointerCapture` 等桩 |
| desktop-gateway payload 形态与桥 input schema 不齐 | 裸 id / `{ id }` / `{ id, patch }` 三态,两端同改同测 |
| 列表型守卫测试(如 vite 外部化清单)改配置忘同步 | 改构建配置时全局搜引用它的测试,同卡更新 |

### 9.4 与 AI 代理协作

- 约束单一事实源是 `AGENTS.md` 体系(根 + desktop + packages),**不往 `.cursor/rules` 等私有格式复制副本**;新约束沉淀回对应 AGENTS.md 或本指南。
- 派活时给足三坐标:目标域、触达层(§1 判定表)、验收命令。让代理先读就近 AGENTS.md 与 UI-SPEC 对应章节再动手。
- 测试的 `describe` 引用规范章节号、契约注释写业务语义——这些惯例的意义之一就是让人与代理都能从代码就地追溯到「为什么」。

---

## 10. 红线速查(违反即返工)

- ❌ features 内 import electron/next/宿主实现/Node 内置;用 `isElectron` 式宿主探测(合法出口只有 capabilities flag 与宿主回调 prop)
- ❌ 手写与契约平行的实体 interface(一律 `z.infer`)
- ❌ 组件硬编码色值/调色板类/裸毫秒动效值(只允许语义 token)
- ❌ queryKey 手拼数组(只允许 `queryKeys` 工厂)
- ❌ 绕开 `musefold:invoke` 单通道另开 IPC;preload 加转发之外的逻辑
- ❌ 密钥进渲染层/SQLite 明文/日志/导出文件(只经主进程 safeStorage 或服务端)
- ❌ 桥上用异常序列化传业务错误(一律 BridgeError → 信封)
- ❌ 动作只藏在下拉/右键浮层里;破坏性动作不过 AlertDialog
- ❌ 与旧版的 UI 差异不登记 UI-SPEC §9(未登记的差异视为回归)
- ❌ 新代码无就地 `__tests__/`;删测试换门禁绿
- ❌ 单文件 > 3000 行;功能提交动 `apps/desktop/package.json` 版本号
- ❌ 顺手实现或删除暂缓域(design-scheme / skill-runtime / 分享导入 / 豆包登录 / 热更控制面);触碰冻结面(桌宠、EmberMark 朱点)

## 11. 相关文档

- 根 [`AGENTS.md`](../../AGENTS.md) / [`apps/desktop/AGENTS.md`](../../apps/desktop/AGENTS.md) / [`packages/AGENTS.md`](../../packages/AGENTS.md) — 机器与人共用的开发约束(入口)
- [V25-ARCHITECTURE](./V25-ARCHITECTURE.md) — 技术栈、分层与决策记录
- [V25-UI-SPEC](./V25-UI-SPEC.md) — 渲染层唯一基准(布局/状态矩阵/交互约定/复用矩阵)
- [ui-parity 系列](./ui-parity/README.md) — 逐屏五维对照与任务清单(UI/UX 任务基石)
- [V25-DELIVERY-PLAN](./V25-DELIVERY-PLAN.md) — 各批次落地备注(坑清单的原始出处)
- [CONTRIBUTING](../../CONTRIBUTING.md) — 提交规范与 Agent Skill 同步义务
