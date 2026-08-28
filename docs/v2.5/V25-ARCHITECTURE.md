# Musefold v2.5 系统架构

> **状态**:已批准
>
> **日期**:2026-08-28
>
> **范围**:技术栈、仓库形状、分层与数据流、服务端、桌面端、Web 端、测试与门禁、CI/CD

## 0. 结论摘要

1. **复用发生在包一级,不靠宿主框架**。`packages/features` 承载页面级产品模块(屏幕组件 + TanStack Query hooks),`packages/ui` 承载 shadcn/ui 组件与 Tailwind v4 token;Next.js 与 Electron 渲染层都是薄宿主。
2. **数据接缝只有一个**:`packages/platform` 的 `MusefoldGateway` 接口。Web 宿主用 Hono `hc` 类型化客户端实现;桌面宿主用单通道 typed IPC(每方法 zod 校验)实现。
3. **桌面壳保留 Electron**,渲染层与构建链重做。后端整体重建(Hono + Drizzle + Better Auth),账号事实源是自托管 New API 网关。
4. **治理靠标准工具而非自研机器**:Biome、Turborepo、Playwright、Changesets 替代 14 个自研门禁与发布 evidence 脚本;保留 dependency-cruiser(少量新规则)与单文件 ≤3000 行硬上限。

## 1. 技术栈(2026-08 版本核查)

| 层 | v2.5 选型 | 版本依据(核查于 2026-08-28) |
|---|---|---|
| Web 框架 | Next.js(App Router + Turbopack + React Compiler) | 16.3 于 2026-08-03 稳定,含 Instant Navigations 与 Playwright `instant()` 测试助手 |
| React | React 19 + React Compiler | Next 16 默认集成,替代手写 memo/useCallback |
| UI 组件 | shadcn/ui(CLI v4 monorepo 模式) | CLI v4 于 2026-03 发布,原生 monorepo、`registry:base`、agent skills |
| 样式 | Tailwind CSS v4(`@source` 跨包扫描) | 仓库已有 v4.3 |
| 状态/数据 | Zustand 5 + TanStack Query 5 + zod 4 | 保留,已是当前主流 |
| 桌面壳 | Electron 43 + electron-vite 5 | 43 为当前稳定版;渲染层不用 Next 静态导出 |
| 服务端框架 | Hono 4.12+(`@hono/zod-openapi`) | OpenAPI 从代码生成;`hc` RPC 客户端零代码生成 |
| 身份 | Better Auth 1.7(`@better-auth/mcp` + `@better-auth/cimd`) | 支持 MCP 2026-07-28 授权规范与 OAuth 2.1 Provider |
| ORM | Drizzle ORM + drizzle-kit(pg-core 与 better-sqlite3 双方言) | generate → review → migrate 生产纪律 |
| 队列 | graphile-worker(保留) | PG 原生队列,无额外基础设施 |
| MCP | 官方 TypeScript SDK v2(Streamable HTTP) | 2026-07-28 规范,四个 Tier 1 SDK 同步发布 |
| 包管理 | pnpm(`workspace:*`) | `.npmrc` 设 `node-linker=hoisted` 以兼容 electron-builder |
| 任务编排 | Turborepo 2(affected + 远程缓存) | `turbo boundaries` 仍 experimental,不接管依赖门禁 |
| Lint/Format | Biome 2 | 单二进制,嵌套 monorepo 配置,类型感知 lint |
| 单测 | Vitest 4(保留) | — |
| E2E | @playwright/test(web + `_electron` 桌面 + 视觉快照) | Python/pytest 桌面 E2E 退役 |
| 版本发布 | Changesets + tag 驱动 GitHub Actions;electron-builder 26 + electron-updater 保留 | — |

被替代/退役:Vite SPA(Web 宿主)、Fastify、自研 `packages/ui` 体系、手写 CSS 体系、ESLint + Prettier、npm workspaces、Python 测试栈、自研 openapi:check / release evidence / detect-layers / Skill-Impact hook / no-emoji 脚本。

## 2. 目标仓库形状

```text
apps/
  web          Next.js 16.3(PC + mobile 自适应壳,路由薄包装)
  desktop      Electron 43(main + preload + 渲染薄壳;原 packages/core 并入)
  api          Hono + Better Auth + Drizzle(PG)+ Cloud MCP(Streamable HTTP)
  worker       graphile-worker 生图队列
packages/
  contracts    zod v4 实体与命令 schema —— 全仓唯一形状源(理念自 v1.x 继承)
  ui           shadcn/ui 组件 + Tailwind v4 tokens(shadcn CLI 管理)
  features     页面级产品模块:屏幕组件 + Query hooks(「一次开发」的单位)
  platform     MusefoldGateway 接口 + query keys + 宿主能力 flags
  api-client   Hono hc 类型化客户端(web 宿主的 gateway 实现)
  db           Drizzle PG schema + 迁移(api 与 worker 共享)
  cli          语义保留(对外能力面)
  mcp          本地 MCP,语义保留(对外能力面)
  automation-server  语义保留(对外能力面)
  update-protocol    内容热更协议,保留
  new-api-client     New API 网关客户端,保留
```

退役包:`domain`、`desktop-contracts`、`cloud-client`、`product-ui`、`core`(并回 `apps/desktop`)。

## 3. 分层与数据流

```text
                    packages/ui(shadcn 组件 + tokens)
                            ↑
packages/contracts → packages/features(屏幕 + Query hooks)
                            ↑ 依赖接口
                    packages/platform(MusefoldGateway + capabilities flags)
                            ↑ 宿主注入实现
        ┌───────────────────┴───────────────────┐
   apps/web(Next.js)                      apps/desktop 渲染层
   gateway = api-client(hc)                gateway = typed IPC 桥
        │ HTTPS                                  │ invoke(单通道,每方法 zod 校验)
   apps/api(Hono)                          Electron 主进程
   Better Auth / Drizzle / MCP              SQLite(Drizzle)/ safeStorage / 同步引擎
        │                                        │ 云同步、会话
   PostgreSQL ←──────────────────────────────────┘
```

规则:

- `features` 禁止 import 平台 API(`electron`、`next/*`、`window.api`、`node:*`);形态自适应用 Tailwind 断点与 container queries 在组件内解决。
- 宿主差异表达为 `platform` 接口上的能力 flags(如 `canRevealLocalFile`),由 TypeScript 类型约束,不设登记制度。
- PC/移动差异:同一 `features` 屏幕;壳层(侧栏 vs 底部导航)由 `apps/web` 按视口选择。

## 4. 服务端(apps/api)

- **Hono + `@hono/zod-openapi`**:contracts 的 zod schema 直接成为路由定义,OpenAPI 与实现天然同步(自研 openapi:check 失去存在必要)。
- **Better Auth 1.7**:会话骨架(Web HttpOnly cookie + 桌面设备会话)与 MCP OAuth 2.1 授权服务器(`@better-auth/mcp` + `@better-auth/cimd`,2026-07-28 profile)。**账号事实源是自托管 New API 网关**:登录凭据经 `new-api-client` 向 New API 校验,本地 PG 只存用户关联、会话与产品数据;余额/兑换/令牌均代理 New API。
- **Cloud MCP**:官方 TS SDK v2 + Streamable HTTP;**7 个只读工具白名单语义原样保留**,工具面不含写 Prompt、生图、花费动作。
- **Drizzle + drizzle-kit**:全新 schema(无真实用户,不做旧库 introspect);迁移 SQL 进 PR 评审,expand/contract 纪律保留。
- worker 与 api 共享 `packages/db`。

## 5. 桌面端(apps/desktop)

- **保留 Electron 的理由(决策记录 D1)**:7.6 万行 TypeScript 主进程/core(SQLite、safeStorage、electron-updater + Ed25519 内容热更、本地 Agent 能力面);doubao-web browser-service 依赖内嵌 Chromium;像素级视觉门禁要求跨 OS 渲染一致;Node 生态深绑定。Tauri 的体积/内存收益对本地生图工作站类 App 不是首要约束。
- 渲染层:electron-vite 薄壳消费 `features`/`ui`;窗口安全基线不变(`contextIsolation: true, nodeIntegration: false, sandbox: true`)。
- IPC 重做:单通道 typed invoke,每方法 zod 校验(清偿旧欠账),preload 纯转发。
- 主进程业务逻辑(生图编排、doubao-web、同步引擎、热更)**语义保留、结构搬迁**;SQLite 层迁 Drizzle(better-sqlite3 driver,同步 API)。
- 桌宠、preview 等独立 renderer 入口保留。

## 6. 测试与门禁

| 层 | 工具 | 说明 |
|---|---|---|
| 单测 | Vitest 4,就地 `__tests__/` | 惯例保留 |
| Web E2E | @playwright/test(可用 Next 16.3 `instant()` 助手) | — |
| 桌面 E2E | @playwright/test `_electron`(可测打包产物) | 替代 Python/pytest |
| 视觉回归 | Playwright `toHaveScreenshot`,双端共用 features 故事页 | 替代自研截图对比脚本 |
| 依赖边界 | dependency-cruiser,约 5 条规则 | contracts 叶子;features 禁平台 API;renderer 禁 electron;db 只进 server 侧;preload 纯转发 |
| 文件尺寸 | 单文件 ≤ 3000 行硬上限 | 简单硬检查,无 baseline ratchet |
| Lint/Format | Biome 2 | 替代 ESLint + Prettier + no-emoji 脚本 |

删除:14 个 repo 门禁、Skill-Impact commit hook、detect-layers、release evidence 脚本群、共享视觉自研脚本、`tooling/file-size-baseline.json`。

## 7. CI/CD

三条 workflow:

1. **PR**:`turbo run --affected`(biome + typecheck + vitest + build)→ Playwright web E2E + Electron smoke(xvfb)+ 视觉快照;Drizzle 迁移 SQL 变更强制进 review。
2. **main**:全量检查 → Docker 部署(Next standalone + Hono + worker),沿用自托管基础设施。
3. **Release**:Changesets 管版本与 changelog → tag 触发 macOS(arm64/x64,签名 + 公证)与 Windows 矩阵打包 → electron-updater feed + GitHub Release;`update-protocol` 内容热更通道保留。App semver 经发布流程定为 2.5.0。

## 8. 不随推倒消失的语义

1. contracts 是唯一产品实体形状,类型一律 `z.infer` 推导;
2. 桌面 local-first;登录、授权、同步启用是三个独立决定;
3. 密钥只经主进程 safeStorage,不进渲染层、SQLite、日志、导出文件;
4. Cloud MCP 只读白名单(7 工具),写入与花费动作不属于 Agent 工具面;
5. 数据库迁移 expand/contract 纪律;
6. 本地 Agent 能力面(CLI / 本地 MCP / Automation)继续存在。

## 9. 决策记录

| 决策 | 结论 | 替代方案为何不采用 |
|---|---|---|
| D1 桌面壳 | 保留 Electron 43 | Tauri 需 Rust 重写主进程且 doubao-web 依赖内嵌 Chromium;渲染跨 OS 不一致 |
| D2 Web 形态 | 单 Next.js 应用自适应 PC/移动 | 双应用增加宿主胶水,共享包已消除重复 |
| D3 后端 | 推倒重建(Hono + Drizzle + Better Auth) | Fastify 栈可用但用户决策整体重置;tRPC 不适配 MCP/OAuth 多客户端 |
| D4 账号 | New API 为事实源,Better Auth 只管会话与 MCP OAuth | 本地自建账号体系与 New API 重复,且无真实用户无迁移负担 |
| D5 桌面渲染层 | electron-vite,不用 Next 静态导出 | 桌面无 SSR 需求,少绑一条 Next 发布列车 |
| D6 复用机制 | features/ui 包级复用 + 单一 gateway 接缝 | v2.1 capability 目录 + 登记制治理成本过高 |
| D7 依赖门禁 | 保留 dependency-cruiser | `turbo boundaries` 2026-08 仍 experimental 且有 tsconfig alias bug |
| D8 部署 | 沿用自托管 Docker | Next 16.3 全部特性 standalone 可用,不强制 Vercel |
| D9 文件尺寸 | 单文件 ≤3000 行硬上限 | baseline ratchet 机制维护成本高于收益 |
| D10 迁移形状 | 工具链原子切换 + 业务按域垂直重建 | 工具链无法半仓渐进;业务一次性重写不可验收 |
