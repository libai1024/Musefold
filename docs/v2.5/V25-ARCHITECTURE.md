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


## 10. B35 云端 Agent 的持久来源执行角色（2026-09-09）

云端方案长任务采用附加的异步执行合同：`POST /design-schemes/agent/executions` 返回 202 会话快照，独立查询、游标事件、逐来源确认和取消接口按 owner 隔离。原 `createDesignSchemeResult` 继续只表示完成草稿；桌面和原确定性 document 创建不被异步结果替换。共享页面接入时必须经 platform 接缝，不能直接导入 api-client。

API 在同一 PG 事务中登记 Agent 会话、所有待处理来源身份、首个事件及 Graphile job。`apps/api/src/agent-worker-bin.ts` 是独立消费进程，复用 API 包内的来源服务/S3/错误约定；它只消费 `design-scheme.agent` 和自身 reconcile，原 `apps/worker` 继续承担图像生成及公共清理，两者共享 Graphile/PG 且不相互 import。这样不复制来源管线、不把 API App 装配引入生成 worker，也不增加突破依赖边界的共享包。

部署复用 API 镜像，以不同命令运行 `scheme-agent` 服务；Compose 已登记，生产执行/回滚仍归发布卡。开发独立启动：`pnpm --filter @musefold/api run dev:agent-worker`；普通运行：`pnpm --filter @musefold/api run start:agent-worker`。需要先执行 PG 与 Graphile 迁移并确保受管 bucket 可用，不能只启动 HTTP API 就期待后台任务完成。开发命令在自己的终端用 Ctrl-C 停止；现有 `dev:stop` 尚未覆盖服务端 tsx 进程，不以其成功输出判断该进程已停。

B35 只完成来源执行阶段：最多 16 个来源按次序确认，最多 4 个未结束会话/owner；初始取消可先登记墓碑；读请求不持有长网络事务；短事务、每页最多 100 事件、有界 reconcile/清理、来源 queued→reading CAS 和不可重发的过期状态支持并发与进程恢复。消费者并发 2，reconcile 每分钟执行、每轮最多 100 个活动会话。

源码中的 Agent Compiler 仍未接入，来源处理完成只产生明确 `AGENT_COMPILER_UNAVAILABLE`，不创建虚假草稿或调用模型。图片/历史输入暂以 `AGENT_ASSETS_UNAVAILABLE` 标记。原公开 Agent create/modify/confirm-install/check-update 仍保持 501，Cloud MCP 七只读工具不变。下一阶段才定义服务端模型配置/用户费用与发送资格，接入编译、修改/更新及共享产品状态。源码、生产 bin 与真实/替身证据见[来源和会话验证](./V25-CLOUD-SOURCE-VALIDATION.md)。


## 11. B36 共享 Agent 角色层（2026-09-09）

角色输入/输出 schema 的唯一实现进入 `packages/contracts/src/design-scheme-model.ts`，类型全部由 zod 推导；旧 desktop-contracts 路径仅兼容导出。Analyst/Compiler/Reviser 提示词与模型 JSON framing 位于 `packages/domain/src/design-scheme/`，仅依赖 contracts、没有 IO、模型 transport 或数据库。桌面三角色和 text-adapter 已实际消费，密钥/网络/重试/本地持久化仍由宿主负责。已有依赖方向未增加例外。

共享层提供格式与纯投影，不提供费用或来源授权。云端下一步应接固定文本模型、可信付款身份、逐调用持久发送标记和 schema/语义校验后的 PG 草稿；不得导入 Electron 适配器或继承其自动降级/格式重试。详情与实际/替身证据见[来源及共享角色验证 §8](./V25-CLOUD-SOURCE-VALIDATION.md)。


## 12. B37 云端文本执行接缝（2026-09-09）

API/独立scheme-agent角色通过相同 `SCHEME_AGENT_TEXT_MODEL` 选择服务端文本模型；空配置关闭，图像策略不变。contracts 增加独立 text binding/授权/进度，API client 新增只读模型 offer；trusted authSessionId 来自 middleware。db 的 `lockAccountExecutionIdentity` 共享原图像主体→身份→凭据→session→authorization 锁顺序，图像与文本分别构造自己的能力/模型 binding。

`AgentState` 复用 owner 行锁、事件、来源锁和到期转移；`DesignSchemeTextAuthority` 负责资格/只读模型发现，`DesignSchemeTextTransport` 负责受控HTTP和加密凭据使用，`DesignSchemeTextExecution` 负责单次持久claim/输出/unknown和事务草稿。domain 的 cloud-compiler 只做模型证据/变量/文档语义，不含IO。数据库/网络职责留在API，图像worker不依赖API包；没有新增边界豁免。

新PG表保存授权/调用事实，源读取与模型请求不占长数据库事务；付款身份在每次claim和最终落库前复验，模型原始错误不进入公开事件/队列诊断。合法输出可独立于草稿保存，后者和completed/event原子提交。旧无text授权会话不自动调用模型；shared UI和旧同步接口接入仍待。详见[文本执行 §9](./V25-CLOUD-SOURCE-VALIDATION.md)，升级/降级约束见[数据迁移 §15](./V25-DATA-MIGRATION.md)。


## 13. B38 精确基线修订接缝（2026-09-09）

canonical异步operation扩展modify，复用B37授权/账本/事件；新增 `DesignSchemeRevisionAuthority` 只做PG基线冻结/重验，domain `cloud-reviser` 只做纯输出语义/来源资产继承。API与scheme-agent装配既有AssetService，不向图像worker引入API依赖。确定性update抽出事务入口，先锁scheme再锁来源引用，Agent将新修订、指针CAS和completed/event放在同一事务内。

原version与revision同时约束发送和落库；长模型HTTP不持锁，最终竞争失败须保留已发送费用事实。当前正式版保持可用，后续修改可以明确选择新的working draft继续，不能用客户端baseDocument覆盖实际PG基线。新增协议没有直接暴露在features，原同步入口保持；共享页面仍须按platform接缝接入。实现/验收见[云端修改 §10](./V25-CLOUD-SOURCE-VALIDATION.md)，迁移兼容见[数据迁移 §16](./V25-DATA-MIGRATION.md)。


## 14. B39 免费来源检查与独立更新授权（2026-09-09）

`DesignSchemeUpdateWorkflow`复用AgentState、来源准备、RevisionAuthority与TextAuthority，在同一异步协议内推进免费检查/逐源确认/authorization-required；API另设authorize-update，冻结用户确认的会话版本与独立text范围。PG会话保存服务端update_context，初始请求及requestHash保持不变。授权后仍由既有TextExecution/Graphile逐调用推进，domain cloud-update仅构造新修订与来源关系，无新增宿主依赖。

确定性update不再把被替代的旧绑定复制到新revision；新文档的声明决定新绑定，旧revision仍保留自己的记录。这使现有RunService的权威来源校验能消费更新草稿，不通过放宽运行校验掩盖来源不一致。新协议/状态尚未进入shared features，后续沿platform接缝接入；详见[上游更新 §11](./V25-CLOUD-SOURCE-VALIDATION.md)。


## 15. 云端 Agent 上传素材冻结（B40 增量）

上传素材沿现有Hono/PG/S3资产服务接入异步Agent。contracts定义服务器写入的素材选择→副本映射，PG会话以nullable JSON保存；不向客户端暴露存储键。复制使用已有暂存注册表，先登记后PUT，模型前逐项完整解码/摘要验证，claim事务只锁元数据，提交草稿时资产与完成事件原子持久化。原上传与任务副本分离，使原图删除不改变已固定任务；取消/失去并发入队竞争/部分复制的副本由既有TTL/outbox回收，成功晋升沿方案资产引用保护。

纯domain负责把保留图片绑定至文档并声明能力边界，API负责IO与付费资格；文本模型仅看到图片数量和说明，没有视觉解析。本增量不新增图像模型授权、不自动产生必需图片槽、不改桌面既有角色调用。完整协议、限制与后续历史/仓库图片任务见[来源验证 §12](./V25-CLOUD-SOURCE-VALIDATION.md)。


## 16. B41 历史素材与多来源共享编译

历史读取、owner/run/asset核验、独立副本和入队锁属于API资产服务；唯一合同以可选historyItems保存固定来源和完整有界提示词，不引入第二套实体或GC。domain只做提示词合成、来源角色与资产引用：GitHub报告和历史文本可同时进入Compiler，保留图片不声明视觉理解。PG引用边聚合角色，canonical文档保留每个语义绑定；修改与更新继续保护原正式版并消费自己的来源关系。

已有nullable JSON容纳新增上下文，无PG/SQLite DDL。共享Compiler的桌面行为随Electron回归验证，云端异步协议仍需通过platform/features接入产品。协议和限制见[来源验证§13](./V25-CLOUD-SOURCE-VALIDATION.md)，实际测试结果见[测试手册§5.34](./V25-MIGRATION-TESTING.md)。


## 17. B42 仓库图片采用与修订资产

采用规则在domain，固定来源读取/复制在API资产模块，持久采用决定在原Agent会话；实体由contracts定义materials.repositories与revision.repositoryImages，不引入平行接口。已完成Analyst结果决定允许路径/用途，选择与副本固定后才进入Compiler；身份/单次调用沿原服务，免费复制失败不会重新调用Analyst。空图片记录保持纯文本服务兼容。

更新对保留资产做所有权检查，在同一新revision事务中晋升新图片、核对来源并切换指针。新revision只保留自己的来源与图片，旧revision继续拥有原资产，正式current仍受保护。无PG/SQLite DDL和新GC系统；完整协议见[来源验证§14](./V25-CLOUD-SOURCE-VALIDATION.md)。没有将云端图片采用写入桌面宿主或新增共享页面，专用包/产品接缝仍按后续卡实施。


## 18. B43 Node归档共享包与宿主边界

新增`packages/scheme-package`：contracts中的v1/v2实体与限制→Node ZIP/CRC/内容引用校验/有界writer→桌面主进程或API/worker宿主。渲染层与domain不消费Node归档，API不导入桌面，包不含账号/数据库/网络。`scheme-package-node-hosts-only`与`scheme-package-contracts-only`硬门禁无豁免；workspace、TS引用、别名、Electron主进程bundle同步接线。桌面沿原入口实际读写共用codec，保留文件替换/权限/草稿语义；云端依赖可用但HTTP/暂存/PG导入尚待。完整边界、STORE体积取舍、新字段往返与未验兼容见[专用包验证](./V25-PACKAGE-VALIDATION.md)。

## 19. B44 桌面修订继承的单一读取规则

core的readRevisionAssetIds以受校验document.assetIds声明继承，以asset.revision_id保留原始归属并兼容旧版本自有素材。applyAgentRevision验证同方案、基线已引用或本次新建的资产，并在既有事务中写入新revision/asset/来源和指针；无第二套引用表或DDL。桌面modify、export、固定prepare与run adapter共用该解析器，不能再把素材的创建版本等同全部消费版本。旧正式current、成功试跑与本版本封面资格不因继承放宽。

update-materials复用domain采用规则；桌面宿主负责实际来源字节、hash、图片元数据及受管路径。更新只替换变化来源图片，历史正文进入Compiler且原版本不变。失败清理仅覆盖已获知ID的新来源目录；完整崩溃孤儿治理和GC需遵守跨版本引用保护，详见[专用包§6](./V25-PACKAGE-VALIDATION.md)。云端暂存、确认与事务导入仍按原Hono/PG/S3和清理outbox接续。

## 20. B45 旧包文档单源与共享解码

contracts同时拥有canonical实体和明确命名的legacy格式实体；desktop-contracts原路径重导出，双向文档桥属于contracts纯转换。Node归档包负责v1来源内容解码、来源元数据一致性和v2摘要，不引入Electron/SQLite/账号或网络。桌面IPC与分享共用文档桥，core仓储按实际操作决定创建来源/时间/父版本，校验后的importedSnapshot继续保留来源kind。

新导出沿v2原算法固定en-US collation；旧locale精确摘要兼容由共享reader处理，版本和v2字段不变。云端业务依然必须从本人持久确认取得私有导入依据，不能把格式解码变成Agent授权。具体规则、v1预览边界及ICU限制见[专用包§7](./V25-PACKAGE-VALIDATION.md)。


## 21. B46 云端方案包暂存与确认

新`design-scheme-packages`模块负责免费上传/内容确认，contracts定义无路径DTO，api-client以ApiHttp传原始字节；主机文件选择与共享产品留在后续合流。包字节校验沿共享scheme-package的v1/v2入口，服务不把包内编译或formal状态提升为权限。

PG0019保留请求/字节/解析版本/确认及身份摘要，事务锁正常账号、真实会话和授权版本；跨耗时IO再次核验。对象登记和清理outbox先于PUT，清理复用原worker并增加暂存/上传租约保护；HTTP、S3、账号或进程失败均不能自动重传或产生新方案。详见[包验证§8](./V25-PACKAGE-VALIDATION.md)。F3私有原子导入、F4下载及F5/D4共享产品仍开放。

B47在同一API模块新增私有内容准备，依赖contracts/shared codec与既有图片解码；没有持久化、账号授权或HTTP职责。服务端固定seed/时间映射新实体，保留完整字节及不可信出处；实际来源/资产只采用校验后的canonical元数据。F3后续需在持久授权/租约范围内调用并原子提交，不能公开内部plan或将它作为Agent材料授权。详见[包验证§9](./V25-PACKAGE-VALIDATION.md)。

## 22. B48 云端专用包原子导入

原import-package路由await私有导入服务；B46正常会话/精确确认、B47内容准备与PG0020持久记录串接，不能借用伪造Agent材料绕过普通create的可信历史检查。PG只在最终短事务落新草稿及完整来源/资产/回执；S3 IO在事务外，每个尝试独立对象key且先登记原outbox。重试固定业务身份，epoch控制提交；完成重放只读原回执，不重新创建已删除方案。

worker复用原对象清理器，保护当前租约及实际引用；导入对象的清理intent即使暂时被永久引用也延期保留，以便账号删除级联后回收。详情及大图读取预算见[包验证§10](./V25-PACKAGE-VALIDATION.md)。这只完成原子导入后端切片，F4正式导出、F5/D4共享产品和完整GC/发布仍待。

## 23. B49 正式归档与宿主交付分界

API新增正式包导出服务及无路径请求/状态/字节接缝，复用既有方案/来源读取、资产验证和共享writer。正常会话→本人正式精确版本/本版本trial与cover→固定basis→逐次IO前复核→原对象登记/outbox→S3→ready；下载读前读后再次授权。短事务不包含网络IO，worker沿既有清理器新增导出租约保护。

api-client只消费完整有界字节并检查hash，不声明保存成功。宿主不得把新增ready状态混进旧export结果联合。B49时原export-package和共享产品尚未接通，B51已通过独立host回执接入Web文件交付（见§25）；具体规则与来源图片兼作封面的归档副本见[专用包§11](./V25-PACKAGE-VALIDATION.md)。


## 24. B50 共享导入页面与确认弹窗生命周期

云端设计方案通过可选 `DesignSchemesGateway.packageImport` 暴露已有持久上传/预览确认接口，api-client实现，features消费。文件输入及Web Crypto使用宿主支持的标准浏览器能力，归档解析仍在Node服务端/桌面主进程；没有新增features→宿主/Node依赖或平行实体。Desktop未注入云端接缝，原生prepare/import继续。服务端import仍是原子事实源，客户端只有本次对话框的请求/epoch/预览投影；刷新恢复与正式导出交付不在本批完成范围。

完整回归发现AlertDialog的遮罩和内容各自portal在快速重开时发生DOM同层顺序反转。仅将确认内容放入自己的遮罩并作为同一个portal子树，遮罩承担统一淡入淡出/时长、内容保留缩放，权限和点击语义不变；没有新增弹窗原语或提高全局z-index。实际DOM复现与PC/移动修复前后的回归见[测试手册§5.43](./V25-MIGRATION-TESTING.md)。


## 25. B51 共享导出意图与宿主文件交付

features只管理选定正式版本、原请求/stage与账号epoch；platform增加可选packageExport及瞬时signal/assertCurrent文件守卫，实体结果仍从contracts的zod推导。Web宿主组合现有api-client与浏览器保存能力；不把Node归档解析、Next路由或文件句柄放入共享features，也不新增PG/HTTP/IPC方法表。旧exportPackage结果及原生保存保持兼容。

服务端ready与宿主delivery为不同合同。Web先在用户点击中获取保存位置，再核对原归档并下载完整bytes；可写文件成功close为delivered，Blob下载交接仅为download-started。无服务端createdAt的新元数据不冒充旧canonicalSharePackageMetadata。取消/身份变化阻止异步文件副作用；清理失败不推翻已发生的交付。见[专用包§13](./V25-PACKAGE-VALIDATION.md)与[UI§8C](./V25-UI-SPEC.md)。刷新恢复和三方向真包产品联合继续开放。

## 26. B52 导入恢复使用服务器持久事实

恢复入口读取已有package stages/imports，不引入浏览器包缓存或平行账本。新增owner-scoped GET列表/单项恢复，复用normal身份锁；stage与回执按同一SQL快照返回，稳定分页保留PG时间精度。contracts定义唯一恢复投影，platform/API client提供可选只读接缝，features承载记录列表与明确继续。权限、版本、确认、租约和重试仍由原写服务强制检查；恢复查询的canContinue只是当次提示。

上传TTL不决定已提交回执是否可读取。新的正常会话可核对本人完成记录，不自动获得旧未完成请求的写权限。页面卸载仅中止本地工作，明确取消才调用服务；恢复后的导入仍固定原文件hash/大小/格式及原请求，已完成结果只读。详见[专用包§14](./V25-PACKAGE-VALIDATION.md)。B53进一步复用PG exports接入只读历史与原资格核对：关闭或交付后保留原归档，明确取消单独确认；恢复查询不重新打包、读写对象或续租，不将ready解释为用户已保存。身份/版本/期限仍由原导出服务逐次核对，见[专用包§15](./V25-PACKAGE-VALIDATION.md)。完整真实身份/跨端交换和原生命周期/发布验收继续。
