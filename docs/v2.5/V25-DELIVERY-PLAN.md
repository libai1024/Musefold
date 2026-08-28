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

## M2 服务端重建

| 卡 | 内容 | 验收 |
|---|---|---|
| M2-01 | `packages/db`:全新 Drizzle PG schema(用户关联、会话、prompts/folders/tags、生成任务、同步、MCP grants),drizzle-kit generate 基线迁移 | 迁移在空库可重放 |
| M2-02 | `apps/api` 骨架:Hono + `@hono/zod-openapi` + 错误模型 + 配置加载;health 路由;OpenAPI 端点 | 集成测试(testcontainers 真 PG)通过 |
| M2-03 | Better Auth 集成 spike → 落地:凭据校验委托 New API(经 `new-api-client`),Web cookie 会话 + 桌面设备会话 | 登录/会话/登出三链路集成测试 |
| M2-04 | 产品路由重建:account(余额/兑换代理 New API)、prompts、workbench、generation、sync | 契约测试对 contracts schema 全覆盖 |
| M2-05 | Cloud MCP:官方 TS SDK v2 + Streamable HTTP + `@better-auth/mcp` OAuth;7 个只读工具白名单 | tools/list 契约测试 = 白名单 |
| M2-06 | `apps/worker` 适配新 db schema;`apps/generation-worker` 退役 | 队列消费集成测试 |
| M2-07 | 部署切换:Docker compose 更新为新 api/worker;旧 `apps/web-api` 下线删除 | main workflow 部署成功 |

## M3 共享层地基

| 卡 | 内容 | 验收 |
|---|---|---|
| M3-01 | shadcn/ui monorepo 初始化:`packages/ui` 重建(components.json、Tailwind v4 主题、现有设计 tokens 映射) | 组件在两宿主渲染一致 |
| M3-02 | contracts 精炼:实体/命令 schema 按新 API 面收敛,类型全部 `z.infer` | schema 测试全绿 |
| M3-03 | `packages/platform`:MusefoldGateway 接口 + query keys + 能力 flags;`packages/api-client`(hc 封装) | 类型编译贯通 |
| M3-04 | `apps/web` 换 Next.js 16.3 壳:App Router、自适应布局壳(大屏侧栏/移动底部导航)、Tailwind `@source` | dev/build 通过 |
| M3-05 | `apps/desktop` 新渲染壳:electron-vite 入口消费 features;新 IPC 单通道桥(zod 校验)与 preload | dev 启动,冒烟 E2E |
| M3-06 | 「设置」域打样:features/settings 贯通双宿主,建立第一批视觉快照基线 | 双端设置页 E2E + 快照 |

## M4 按域垂直切换

每域固定动作:features 重建 → 双宿主接入 → 该域旧实现与旧测试删除 → 新 E2E + 快照。

| 卡 | 域 | 特有事项 |
|---|---|---|
| M4-a | 提示词库 | CRUD、搜索、置顶、回收站、文件夹/标签;桌面本地事务 + 云同步语义 |
| M4-b | 工作台/生成 | 会话、草稿、提交/取消/重试、Provider 选择(桌面本地 Provider 能力 flag) |
| M4-c | 历史 | 列表、筛选、详情、重试、软删/恢复、来源标签 |
| M4-d | 账号/连接 | New API 余额/兑换面、Cloud Agent 连接管理、同步开关(登录 ≠ 同步) |
| M4-e | 桌面数据与 IPC 收口 | SQLite → Drizzle 受管迁移(备份 → 迁移 → 校验);主进程结构搬迁完成;旧渲染层入口删除 |

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
