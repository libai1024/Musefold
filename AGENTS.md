# Musefold / 未像 — AI 开发代理约束

> 本文件是所有 AI 编码代理进入本仓库的第一入口,与 `README.md`(面向人类)互补。
> 就近优先:改子目录代码时,先读该目录树中最近的 `AGENTS.md`(`apps/desktop`、`packages` 各有一份)。
> 约束只有一个事实源,就是这组文件——不要往 `.cursor/rules`、`.cursorrules` 等私有格式复制副本。

## 项目是什么

面向个人创作者的 AI 生图与提示词管理产品。v2.5 起「一次开发,四端复用」:页面级产品模块在共享包里只写一份,四个交付面(Windows / macOS 桌面、PC Web、Mobile Web)由两个薄宿主承载。

```text
apps/desktop    Electron 43 桌面壳(主进程 + v25 渲染壳 + 冻结的桌宠窗口),SQLite 本地优先
apps/web-next   Next.js 16 Web 壳(App Router,PC/移动同一应用自适应)
apps/api        Hono + PostgreSQL 后端(Better Auth 凭据委托 New API、云同步、生图、Cloud MCP)
apps/worker     graphile-worker 生图队列消费者
packages/       共享包:features(页面模块)、ui(shadcn 原语)、contracts(唯一实体契约)、
                platform(MusefoldGateway 接缝)、api-client、db(PG schema)、desktop-db(SQLite Drizzle)、
                core(桌面本地核)+ 桌面生态存量包(见 packages/AGENTS.md)
```

数据流(features 四端同一份,在 gateway 实现处分叉):

```text
视图(features 屏组件,TanStack Query + zod 契约)
  → MusefoldGateway(packages/platform 接口)
  → Web:    packages/api-client → HTTPS → apps/api → PostgreSQL
  → 桌面:  v25 desktop-gateway → 单通道 IPC(musefold:invoke)→ 主进程 ipc-v25/* → SQLite(desktop-db 受管)

窗口全屏/最大化等只读宿主信号属于窗口生命周期接缝,由主进程受控查询/事件经 v25 preload 提供给壳宿主;它们不进入业务 `MusefoldGateway` 或 `musefold:invoke` 数据方法表。

## 权威顺序(冲突时以此裁决)

1. 当前源码、数据库迁移和自动化测试。
2. [docs/v2.5](docs/v2.5/README.md) 四份文档:架构、交付计划、数据迁移、**UI 规范(V25-UI-SPEC,渲染层唯一基准)**。
3. 完整顺序见 `docs/README.md`「权威顺序」节;更早的版本文档仅作历史参考。

**文档写的东西可能过期,代码和测试不会。**发现矛盾时以代码为准,顺手修文档。

## 开始任何任务前

1. 读本文件 + 目标目录最近的 `AGENTS.md`。
2. 涉及屏幕/组件/交互:通读 `docs/v2.5/V25-UI-SPEC.md`(壳与各屏布局、状态矩阵、组件复用矩阵、暂缓域清单)。
3. 涉及实体形状或 API 出入参:从 `packages/contracts` 开始,类型一律 `z.infer` 推导。

## 命令矩阵(pnpm + turbo,交付前必须全绿)

| 改动类型 | 必跑 | 说明 |
|---|---|---|
| 任何源码 | `pnpm run check` | Biome lint + typecheck + 单测 + 双端 build + depcruise 边界,一条命令全覆盖 |
| features / ui / 双端屏幕 | 另跑 `pnpm run test:e2e` | Playwright:web(桌面/移动视口)+ Electron,含视觉快照 |
| 桌面主进程 / IPC / 数据 | 另跑 `pnpm exec playwright test -c tests/v25 --project electron` | 驱动真实 Electron 窗口(需先 `pnpm run build`) |
| SQLite schema | `packages/desktop-db` 迁移流程 | 见 `apps/desktop/AGENTS.md`;迁移必须内联进主进程 bundle |
| PG schema(packages/db) | `pnpm run db:migrate` + api/worker 单测 | expand/contract 纪律,见 docs/v2.5 数据迁移文档 |
| 打包产物 | `pnpm run package:mac:adhoc` 后跑 package-smoke | 发布矩阵(release.yml)自动执行 |

日常:`pnpm run dev`(桌面)、`pnpm run dev:web`(Web)、`pnpm run dev:api` / `dev:worker`(后端,先 `pnpm run dev:infra` 起 PostgreSQL)。停止开发进程用 `pnpm run dev:stop`,不要 kill 正式版 App。

## 全局红线(违反即返工)

- ❌ 版本号:`apps/desktop/package.json` 的 `version` 由发布流程管理(Changesets + 手动 tag),不要在功能提交里动。
- ❌ 依赖方向:`tooling/dependency-cruiser.cjs` 的边界规则是机器强制(0 豁免);features 禁触宿主、platform/ui/contracts 是叶子、packages/db 只进服务端。
- ❌ 实体形状:唯一事实源是 `packages/contracts` 的 zod schema;不在任何包里手写平行 interface。
- ❌ 密钥:API Key / bearer token 只经主进程 `safeStorage`(桌面)或服务端(云);不进渲染层、SQLite 明文、日志、导出文件。
- ❌ 文件尺寸:单文件 ≤ 3000 行(`tests/repo/file-size-limit.test.ts` 硬门禁)。
- ❌ 提交:格式 `type(scope): subject`。
- ❌ 测试:新代码必须带就地 `__tests__/`;不删测试来让门禁变绿;测试断言与现实不符时,先确认哪边错,修错的一方。
- ❌ 冻结面:桌宠(`src/pet` + 主进程 pet 域)与豆包网页渲染层入口是冻结面,保持现状不迁移不重构(V25-UI-SPEC §0.2)。

## 暂缓域(登记在案,禁止顺手实现或删除)

以下旧域「主进程语义保留、渲染层暂缓」,后续各自排卡接入 v25 面,遇到时不要顺手补 UI 也不要删服务代码:

- Skill 运行时对话、通用分享/导入、豆包网页登录管理、热更新控制面(设置「关于」卡)。设计方案已纳入 v2.1→v2.5 迁移,其专用 `.musefold.design` 导入/导出属于设计方案功能闭环。
- 服务函数分别在 `apps/desktop/electron/main/{design-scheme/,ipc/skill-runtime.ts,generation-facade.ts}`,由 automation(CLI / MCP / Automation API)直连,是 Agent 对外能力的一部分。

## 文档地图

- `docs/v2.5/` — 当前基线:架构 / 交付计划 / 数据迁移 / **UI 规范**
- `docs/README.md` — 文档权威顺序与版本文档索引
- `CONTRIBUTING.md` — 提交规范
- 就近约束:`apps/desktop/AGENTS.md`(主进程/IPC/迁移/E2E)、`packages/AGENTS.md`(包格架与契约)
