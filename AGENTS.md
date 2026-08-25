# Musefold / 未像 — AI 开发代理约束

> 本文件是所有 AI 编码代理进入本仓库的第一入口。与 `README.md`(面向人类)互补。
> 就近优先:修改子目录代码时,先读该目录树中最近的 `AGENTS.md`(apps/desktop、packages、apps/web、apps/web-api 各有一份)。
> 本文件组是 Codex / Cursor / Claude Code 等的原生格式(Cursor 支持根目录与嵌套 AGENTS.md,就近覆盖全局)。**不要**再往 `.cursor/rules`、`.cursorrules` 或其他私有格式复制副本——约束只有一个事实源,就是这组文件。

## 项目是什么

面向个人创作者的 AI 生图与提示词管理产品,桌面(Electron)+ Web 双端 monorepo:

```text
apps/desktop    Electron 主产品(main / preload / 渲染层三段,sqlite 本地优先)
apps/web        Web SPA(手机浏览器优先,薄宿主)
apps/web-api    Fastify + PostgreSQL 后端(账号/云同步/生图)
apps/generation-worker  graphile-worker 生图队列消费者
packages/       13 个共享包:contracts(唯一实体契约)、domain、desktop-contracts、
                ui、product-ui、core(桌面本地核)、cloud-client、…(详见 packages/AGENTS.md)
```

数据流(两端在 product-ui / ui / domain 三层共享,在数据接入层分叉):

```text
视图(桌面 features / web views)
  → Zustand(UI state)+ TanStack Query(服务端数据)
  → product-ui page-controllers(双端同一份编排)
  → 桌面: runtime/desktop-gateway → IPC → 主进程 ipc/* → core(SQLite)
  → Web:  cloud-client → HTTPS → web-api → PostgreSQL
```

## 权威顺序(冲突时以此裁决)

1. 当前源码、数据库迁移和自动化测试。
2. `docs/frontend/DEVELOPMENT-GUIDE.md`(渲染层分层基线)、`docs/v1.3`、`docs/v1.2.2`。
3. 完整顺序见 `docs/README.md`「权威顺序」节。

**文档写的东西可能过期,代码和测试不会。**发现文档与代码矛盾时:以代码为准,顺手修文档(本仓库有 `tests/repo/dev-guide-freshness.test.ts` 守卫规范不说谎,改动 DEVELOPMENT-GUIDE 后必须跑它)。

## 开始任何任务前

1. 读本文件 + 目标目录最近的 `AGENTS.md`。
2. 涉及渲染层/组件/状态/表单:通读 `docs/frontend/DEVELOPMENT-GUIDE.md`。
3. 不确定改动是否影响 Agent 对外能力(CLI / MCP / Automation API):读 `CONTRIBUTING.md` 的 Skill-Impact 规则,答案几乎总是「有影响,需要声明」。

## 命令矩阵(按改动类型选跑,交付前必须全绿)

| 改动类型 | 必跑 | 说明 |
|---|---|---|
| 任何源码 | `npm run check` | lint(含 no-emoji)+ 两条边界检查 + typecheck + 单测 + 双端 build,一条命令全覆盖 |
| 桌面渲染层组件 | 另跑 `npm run test:visual:shared` | 共享 UI 双端像素门禁 |
| 共享 UI / Web 面 | 另跑 `npm run check:v1.1` + `npm run test:e2e:web` | Web 生产边界 + Playwright |
| contracts / web-api 出入参 | 另跑 `npm run openapi:check` | OpenAPI 与实现同步 |
| 桌面行为(主进程/IPC/数据) | 另跑桌面 E2E:`pytest tests/e2e/…` | Python + Playwright,先 `npm run build`(参照 `.github/workflows/desktop-ci.yml`) |
| SQLite schema | 迁移测试 + 全量 `npm run test` | 流程见 apps/desktop/AGENTS.md |
| web-api 迁移 | `npm run test:integration:v1.1` | testcontainers 真 PostgreSQL |

日常:`npm run dev`(桌面)、`npm run dev:web`(Web)。停止开发进程用 `npm run dev:stop`,不要 kill 正式版 App。

## 全局红线(违反即返工,与 DEVELOPMENT-GUIDE §9 配套)

- ❌ 版本号:不要动 `apps/desktop/package.json` 的 `version`。版本由发布流程(REL 卡)统一管理,刻意不提前改。
- ❌ 依赖方向:不要手工绕过 depcruise 规则(`npm run check:boundaries` 会拦);不要往 `tooling/dependency-cruiser-known-violations.json` 加新豁免。
- ❌ 实体形状:不要在任何包里定义与 `packages/contracts` 平行但形状不同的实体类型;类型一律 `z.infer` 推导,不手写第二份 interface。
- ❌ 密钥:API Key / 凭据只经主进程系统安全存储(safeStorage),不进渲染层、SQLite、日志、导出文件。
- ❌ 图标:不直接 import `lucide-react`,唯一入口 `@musefold/ui` icons。
- ❌ 文件尺寸:新文件 ≤ 600 行(`tests/repo/file-size-ratchet.test.ts` 硬门禁,baseline 只减不增)。
- ❌ 提交:含 App 源码的提交必须带 `Skill-Impact:` trailer(本地 hook + CI 双重强制,`--no-verify` 绕不过远端);格式 `type(scope): subject`。
- ❌ 测试:新代码必须带就地 `__tests__/`;不删测试来让门禁变绿;发现测试断言与现实不符时,先确认是测试错还是代码错,修错的一方。

## 已知架构欠账(登记在案,禁止顺手重构)

这些是**有意的排队项**,各自挂在版本交付计划里。遇到时保持现状、按局部惯例写,不要在无关任务里「顺手修」:

- 主进程重任务(生图编排 / doubao-web / automation-server)未拆 utilityProcess——不要自行引入进程拆分。
- 桌面 `prompts` 表无 `version` 列,乐观锁是 mapper 里的合成常量(v1.3 ENT-B 登记)。
- IPC 入参无统一运行时 zod 校验(AI 边界处已有局部校验);preload 桥无 `satisfies Api`。
- 云同步触发靠写 handler 手动调 `scheduleCloudSync()`。
- ESLint `no-explicit-any` 尚为 off(ratchet 未回收)。

大重构(进程模型、schema 迁移、依赖规则变更)必须先立版本文档(docs/vX.Y 目录 + 交付计划卡),像 v1.3 / v1.4 那样走,不接受混入功能提交。

## 文档地图

- `docs/frontend/DEVELOPMENT-GUIDE.md` — 渲染层全部深度规范(实体/状态/表单/组件/测试/红线)
- `docs/README.md` — 文档权威顺序与版本文档索引
- `CONTRIBUTING.md` — 提交规范与 Skill-Impact
- `DESIGN.md` / `PRODUCT.md` — 设计系统与产品原则
- 就近约束:`apps/desktop/AGENTS.md`、`packages/AGENTS.md`、`apps/web/AGENTS.md`、`apps/web-api/AGENTS.md`
