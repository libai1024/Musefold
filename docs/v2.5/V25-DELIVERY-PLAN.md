# Musefold v2.5 交付计划

> **状态**:实施中
>
> **日期**:2026-08-28
>
> 批次只能按序推进;每批验收全绿后才进入下一批。旧测试随其覆盖的旧代码在对应批次删除,迁移全程保有安全网。

## 批次总览

```text
M0 基线冻结 → M1 工具链原子切换 → M2 服务端重建 → M3 共享层地基
→ M4 按域垂直切换(a 提示词库 / b 工作台 / c 历史 / d 账号 / e 桌面数据与 IPC)
→ M5 收尾(a 测试与门禁 / b 发布链 / c 清库与文档)
```

## M0 基线冻结

| 卡 | 内容 | 验收 |
|---|---|---|
| M0-01 | v2.1 进行中改动全部提交主干,打 tag `v2.5-baseline` | tag 存在,工作区干净 |
| M0-02 | 创建 `docs/v2.5`(README / ARCHITECTURE / DELIVERY-PLAN / DATA-MIGRATION),`docs/README.md` 挂载 v2.5 条目 | 文档入库 |

## M1 工具链原子切换

原则:只换底盘,不动业务代码;旧代码在新底盘上必须全绿。

| 卡 | 内容 | 验收 |
|---|---|---|
| M1-01 | npm → pnpm:`pnpm-workspace.yaml`、`workspace:*` 协议、`.npmrc`(`node-linker=hoisted`)、删除 `package-lock.json`、补幽灵依赖 | `pnpm install` 成功,双端 build 通过 |
| M1-02 | Turborepo 接管全部任务图:`turbo.json` 定义 build/test/typecheck/lint 及依赖关系,本地与 CI 统一走 turbo | `turbo run build test typecheck` 全绿 |
| M1-03 | Biome 2 上线:根 `biome.json` + 全仓一次性 format;legacy 目录 lint 放宽(仅 format + 少量规则) | `biome check` 全绿 |
| M1-04 | 三条新 workflow(pr.yml / main.yml / release.yml 骨架)替换旧四条;`.githooks` Skill-Impact hook 停用;旧自研门禁脚本从 scripts 引用中断开 | PR workflow 在 CI 跑通 |
| M1-05 | 根 package.json scripts 精简为新命令面(dev / build / test / lint / check 等) | 命令清单与文档一致 |

## M2 服务端重建(已完成)

| 卡 | 内容 | 验收 |
|---|---|---|
| M2-01 ✅ | `packages/db`:全新 Drizzle PG schema(Better Auth 核心表 + oauth* 插件表 + prompts/sync/workbench/generation/credentials/skills/ops,28 表),drizzle-kit generate 基线迁移 + 程序化 `migrateDatabase` | 迁移在空库可重放(集成测试即重放) |
| M2-02 ✅ | `apps/api` 骨架:Hono + `@hono/zod-openapi`(registry 注册 + zod 手动校验)+ AppError 错误模型 + zod env;/healthz;/api/v1/openapi.json | 集成测试(testcontainers 真 PG)10/10 通过 |
| M2-03 ✅ | Better Auth 落地:`newApiDelegation` 插件把登录/注册委托 New API,会话建立后固化中继凭据(relay_sessions)与生图 token(account_credentials,AES-GCM 单列密文);bearer + jwt + mcp + cimd 插件 | 登录成功/错误密码 401/会话保护/凭据固化集成测试 |
| M2-04 ✅ | 产品路由重建:account(余额/兑换,自动 refresh 中继 jwt)、prompts(乐观锁)、workbench、generation(幂等键 + graphile add_job 同事务入队 + SSE 事件)、sync(设备/bootstrap/pull/push 幂等重放) | 集成测试覆盖 CRUD/冲突/幂等/重放 |
| M2-05 ✅ | Cloud MCP:官方 TS SDK v2 `createMcpHandler`(legacy: 'reject')+ `requireMcpAuth`(JWT/JWKS)+ 按 scope 过滤的 7 个只读工具白名单 | manifest 单测锁定白名单;401 WWW-Authenticate 挑战集成测试 |
| M2-06 ✅ | `apps/worker`:graphile-worker + Drizzle,租约恢复(upstream_request_sent 永不盲重试)、image-gateway 语义原样搬运;`apps/generation-worker` 退役(删除在 M5c) | 租约决策/图像网关单测 8/8 |
| M2-07 ✅ | 部署:apps/api、apps/worker Dockerfile(pnpm deploy 隔离包)+ `infra/v2.5/compose.yaml`(PG17/minio/api/worker)+ main workflow 镜像构建 job;旧 `apps/web-api` 不再部署(源码删除在 M5c) | 本地镜像构建 + 启动冒烟通过 |

落地备注:云端 MCP 生图/审批/花费预留(v2.1 休眠功能)刻意不迁移;PG RLS + set_config 方案改为应用层 userId 过滤;限流从 SQL 函数改为应用层固定窗口原子 upsert。

## M3 共享层地基

| 卡 | 内容 | 验收 |
|---|---|---|
| M3-01 ✅ | shadcn/ui monorepo 初始化:`packages/ui` 重建(components.json、Tailwind v4 主题、现有设计 tokens 映射);旧包重命名 `packages/legacy-ui` 原位保活 | 组件单测 + 双宿主渲染一致(E2E 快照) |
| M3-02 ✅ | contracts 精炼:新增 preferences 契约;查询参数改 `queryIntegerSchema`/`queryBooleanSchema`(替代 z.coerce)修正类型推导 | schema 测试全绿 |
| M3-03 ✅ | `packages/platform`(MusefoldGateway + query keys + 能力 flags + PlatformProvider)、`packages/api-client`(fetch 封装 + zod 响应校验 + ApiRequestError)、`packages/features`(设置域 hooks/屏幕/ThemeSync) | 类型编译贯通 + 三包单测 |
| M3-04 ✅ | `apps/web-next` Next.js 16.3 壳:App Router + React Compiler、自适应壳(md+ 侧栏/移动底部导航)、Tailwind `@source` 跨包扫描、localStorage 偏好 gateway、防闪主题脚本 | dev/build 通过 |
| M3-05 ✅ | `apps/desktop` 新渲染壳:electron-vite `shellV25` 入口消费 features;`musefold:invoke` 单通道 IPC 桥(每方法 zod 校验 + 结构化错误信封)+ v25 preload;`MUSEFOLD_V25_SHELL=1` 切换 | build 通过,Electron E2E 冒烟 |
| M3-06 ✅ | 「设置」域打样:features/settings 贯通双宿主;`tests/v25` Playwright(web-desktop/web-mobile/electron 三 project)+ 首批视觉快照基线 4 张 | 双端 E2E 10/10,复跑稳定 |

落地备注:web-mobile 项目用 iPhone 13 视口但统一 Chromium 内核;Next dev 需 `allowedDevOrigins` 放行 127.0.0.1;Biome 开 `css.parser.tailwindDirectives`;React 类型统一 @types/react@19。旧 `apps/web` 壳保活至 M4 各域迁完。

## M4 按域垂直切换

每域固定动作:features 重建 → 双宿主接入 → 该域旧实现与旧测试删除 → 新 E2E + 快照。

| 卡 | 域 | 特有事项 |
|---|---|---|
| M4-a ✅ | 提示词库 | CRUD、搜索、置顶、回收站、文件夹/标签;桌面本地事务 + 云同步语义 |
| M4-b | 工作台/生成 | 会话、草稿、提交/取消/重试、Provider 选择(桌面本地 Provider 能力 flag) |
| M4-c | 历史 | 列表、筛选、详情、重试、软删/恢复、来源标签 |
| M4-d | 账号/连接 | New API 余额/兑换面、Cloud Agent 连接管理、同步开关(登录 ≠ 同步) |
| M4-e | 桌面数据与 IPC 收口 | SQLite → Drizzle 受管迁移(备份 → 迁移 → 校验);主进程结构搬迁完成;旧渲染层入口删除 |

M4-a 落地备注:
- features/prompts:行式列表(信息架构承自 v2.0 PromptListRow:缩略图/摘要/元信息/常驻操作组,操作不藏浮层)、「置顶/全部」分节、回收站 tab、文件夹与标签管理 Popover、编辑器对话框;全部走语义 token,零硬编码色。
- 双宿主:Web 走 api-client(M2 路由已就绪);桌面主进程 `ipc-v25/prompts-domain.ts` 挂 15 个 `prompts.*` 方法(contracts↔core 映射内嵌,folders/tags 目录直写 SQL,写路径保留 `scheduleCloudSync()`);共享壳 `features/shell/AppShell` 双宿主统一(Web 接 Next 路由、桌面本地视图切换)。
- E2E 教训:Electron 不能 `firstWindow()`(prefs 迁移窗口先开即关,须按 URL 等 v25 壳窗口);Playwright `workers:1` 串行(headed Electron 并行互抢 macOS 焦点,Radix 浮层失焦即关);行内常驻操作钮让用例免于浮层时序,32 用例三轮连跑全绿。
- 旧实现/旧测试物理删除集中到 M5-c(旧 CI 已不跑 Python E2E,旧壳保活到 M4-e 整体切换,安全网已转移到 tests/v25)。

## M5 收尾

| 卡 | 内容 | 验收 |
|---|---|---|
| M5-a1 | Playwright Electron E2E 全量(含打包产物冒烟);Python 测试栈删除 | CI 桌面 lane 全绿 |
| M5-a2 | 视觉快照全量基线;depcruise 新 5 条规则;单文件 ≤3000 行门禁 | 门禁在 PR workflow 生效 |
| M5-b1 | Changesets 接管版本;release.yml:tag → macOS(签名/公证)+ Windows 矩阵 → updater feed + GitHub Release | 一次端到端发布演练 |
| M5-b2 | 热更 feed 验证(update-protocol 通道) | 安装包可收到内容热更 |
| M5-c1 | 删除全部 legacy:旧包(domain/desktop-contracts/cloud-client/product-ui/core)、旧脚本、旧门禁、旧文档标注归档 | depcruise 0 违例 |
| M5-c2 | 重写 `AGENTS.md` / `CLAUDE.md` / 各目录 AGENTS.md / `docs/README.md` 权威顺序 | 新约束与实现一致 |

## 风险与回退

| 风险 | 缓解 | 回退 |
|---|---|---|
| pnpm 切换暴露幽灵依赖 | M1 集中补依赖声明 | 基线 tag 可整体回退 |
| Better Auth × New API 集成面 | M2-03 先 spike 三链路 | 保留旧 session-store 语义重写为备选 |
| doubao-web/生图编排搬迁 | 只搬不改算法,每步跟 E2E | 按域回退到基线实现 |
| 视觉全变 | M3-06 打样域先建基线再铺开 | 快照基线按域重置 |
