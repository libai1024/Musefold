# Musefold v1.2.2 迁移计划

> **状态**：任务分解，尚未开工
>
> **日期**：2026-08-20
>
> **前置**：v1.2.1 发布门禁全部通过（Phase 1 起）；Phase 0 可与 v1.2.1 M4–M7 并行
>
> **总原则**：每个任务卡独立合并、独立可回滚；纯移动提交与内容修改严格分离；不改变任何用户可见行为

## 0. 交付原则

1. **CI/CD 是安全网，不是障碍**。每个 Phase 的验收都跑 v1.2.1 交付的门禁（affected 流水线、桌面 E2E、共享视觉门禁、打包冒烟）。安全网没建好之前不动目录。
2. **`git mv` 与代码修改分离**。目录迁移提交只含移动与路径修正，便于 review 与 `git log --follow` 追溯；行为修改另开提交。
3. **先立规则，后搬代码**。depcruise 分层规则在 Phase 0 以 baseline（只准减少）模式上线，Phase 1–3 的每次搬迁都让违规数下降，禁止上升。
4. **抽象跟着已验证的形状走**。桌面 Gateway 的接口面以 Web `WebGateway` 已验证的形状为准上提到 domain，不发明新抽象。
5. **止损点明确**。每张任务卡列回滚方式；Phase 1b（App manifest 下移）是唯一需要 feature freeze 窗口的步骤。

## 1. 阶段总览

| 阶段 | 内容 | 开工条件 | 预期节奏 |
|---|---|---|---|
| Phase 0 工程化地基 | 依赖声明、zod v4、tooling/、depcruise、project references | 随时（纯仓库侧，与 v1.2.1 M4–M7 并行） | 每卡半天到一天 |
| Phase 1a 源码目录迁移 | `src/`、`electron/`、`shared/` 归位；别名与 CI 映射同步 | v1.2.1 发布门禁全部通过 | 集中 2–3 天完成 |
| Phase 1b App manifest 下移 | 根 package.json 变纯 workspace root | Phase 1a 稳定运行一周 | 集中 1–2 天 + freeze 窗口 |
| Phase 2 桌面 Gateway | domain 端口做全、`DesktopGateway`、stores 逐个切换 | Phase 1 完成 | 按 feature 逐卡推进 |
| Phase 3 共享逻辑归位 | 纯函数、UI 原语、客户端去重、工作台 store 拆分 | 可与 Phase 2 交错 | 按卡推进 |

## 2. Phase 0：工程化地基

不动目录、不改行为，全部可与 v1.2.1 并行。

### 任务

- `V122-BASE-01`：~~补全 `packages/core`、`cli`、`client`、`automation-server` 的真实依赖~~ **已完成（2026-08-20）**。core：contracts/better-sqlite3/openai/ulid；cli：automation-server/client/core；automation-server：core；client 无生产 npm 依赖。`packages/mcp` 测试对 core/automation-server 的引用缺声明，留待 Phase 3。
- `V122-BASE-02`：~~zod 统一 v4~~ **已完成（2026-08-20）**。`@modelcontextprotocol/sdk` 1.30.0 的 peer 已允许 `^3.25 || ^4.0`，mcp 直接升到与根一致的 `^4.4.3`，无 API 适配，无例外。
- `V122-BASE-03`：~~版本收口与 cli 改名~~ **已完成（2026-08-20）**。15 个 private 包统一 `0.0.0-internal`；实证 npm 11 下 `*` 引用正常链接 prerelease workspace 包（不去 registry），无需退到 `0.0.0`。cli 已改名 `@musefold/cli`，bin 不变。
- `V122-BASE-04`：~~建立 `tooling/`~~ **已完成（2026-08-20）**。`tooling/{tsconfig.base.json, eslint.config.base.mjs, dependency-cruiser.cjs, dependency-cruiser-known-violations.json}`（扁平布局，未用子目录）；18 条分层规则映射架构 3.2 节；baseline 共 6 条存量违规（1 条 `web-no-desktop`：`apps/web/src/account-format.ts → shared/constants.ts`；5 条 `no-circular` warn），只许减不许增。
- `V122-BASE-05`：~~全仓 project references~~ **已完成（2026-08-20）**。18 个 composite 项目，根 `tsc -b` 单入口，include 无重叠；声明产物进 gitignored `.tsout/`。实测全仓冷编译峰值约 1.18 GiB、增量约 0.25s，`typecheck:mcp` 8 GiB 特例已删除。
- `V122-BASE-06`：~~depcruise 接入 CI~~ **已完成（2026-08-20）**。`check:boundaries` 脚本 + turbo root task，ci.yml 主检查扩为 `typecheck test build lint check:boundaries`；与 `check:ui-boundaries` 并存。
- `V122-BASE-07`：~~清理死代码~~ **已完成（2026-08-20）**。删除 `src/features/{chat,composer,studio}` 空目录、`useDebounce.ts`、library store 中零引用的文件夹/标签/智能集/批量 actions（store 约 978 行减至 614 行）。后端退役面（IPC/preload/core repositories 的 folder/tag/batch/smartSet 通道）按规则保留，见下方 Phase 3 输入。

### 完成条件

- `npm run check` 与 `npm run check:v1.1` 语义不变且全绿。✅
- `npm ls` 无 workspace 包缺失声明告警；depcruise baseline 建立且 CI 生效。✅
- typecheck 收敛为一条 `tsc -b`（或按包的 turbo 任务），无 8 GiB 堆特例。✅

Phase 0 于 2026-08-20 全部完成。

### Phase 0 沉淀的 Phase 3 输入

- **`@shared/*` 别名消费清单**（Phase 3 拆迁 `shared/` 的依据）：`packages/core` 消费面最大（constants、pricing、types/{enums,models,providers,ipc,workbench,design-scheme}、design-scheme/{prompt-compiler,schema}）；`packages/cli` 生产代码消费 constants、pricing；`packages/automation-server` 生产代码消费 types/providers、constants；`packages/client` 零别名。
- **退役后端面**（前端 store 死路径已删，以下保留待 Phase 3 决断）：`electron/main/ipc/{folders,tags,prompts,smartSets}.ts` 的 folder/tag/batch/smartSet 通道、preload 对应暴露、`packages/core` 的 folders/tags/smartSets repositories——导入导出与 E2E 仍在使用其中一部分，不能整体删除。
- **已知测试竞态**：根 vitest 并行时 brand-migration 相关测试与 `packages/cli/dist` 写入偶发撞车（Phase 0 期间观测到一次），重跑即过；Phase 1 前应将该测试的临时目录与真实 `dist/` 隔离。

## 3. Phase 1：目录重构

### Phase 1a：源码目录迁移（根 package.json 暂不动）

- `V122-DIR-01`：`git mv src apps/desktop/src`、`git mv electron apps/desktop/electron`；`electron.vite.config.ts` 迁至 `apps/desktop/` 并更新入口路径；根 package.json 暂时保留 App manifest 角色，`main` 字段指向新输出路径。
- `V122-DIR-02`：新建 `packages/desktop-contracts`，`git mv shared/types/*` 迁入；其余 `shared/` 文件按[架构文档第 6 节](./V122-ARCHITECTURE.md)归位 domain/core/desktop-contracts；`@shared/*` 别名由 `desktop-contracts` 兼容 re-export。
- `V122-DIR-03`：收敛别名：`@renderer`、`@main` 只在 `apps/desktop` 的 tsconfig 与 vite 配置中定义；删除 `vitest.config.ts`、`electron.vite.config.ts` 中与 tsconfig 重复的 alias 表。
- `V122-DIR-04`：更新 v1.2.1 的层级路径映射（`.github/layer-paths.yml`）：外壳层 `apps/desktop/electron/`、内容层 `apps/desktop/src/`、新增 `packages/desktop-contracts`。构造四类提交各验证一次触发正确。
- `V122-DIR-05`：门禁：`check` + `check:v1.1` + 桌面 E2E + 共享视觉门禁 + `package:mac:adhoc` 冒烟。

**回滚**：1a 全部是移动与路径修正，revert 迁移提交即回滚。

### Phase 1b：App manifest 下移（需 feature freeze 窗口）

- `V122-DIR-06`：Electron App manifest 下移到 `apps/desktop/package.json`（`main`、App 依赖、electron-builder 配置、`postinstall` 的 `install-app-deps`）；根 package.json 变纯 workspace root，只留全局脚本与 devDependencies。`electron-builder.yml` 迁至 `apps/desktop/` 并验证原生依赖收集（`better-sqlite3`）在 workspace 布局下正确打入。
- `V122-DIR-07`：更新 `scripts/*.mjs` 中的路径引用（`run-builder`、`build-cli`、`clean-artifacts`、release 系列）；更新 `infra/v1.1/Dockerfile` 构建上下文（web-api 镜像不再安装桌面 App 依赖，构建应变轻）。
- `V122-DIR-08`：发布链路全验证：tag 触发打包 workflow、renderer bundle 构建路径（`apps/desktop/out/renderer`）、`minShellVersion` 推导脚本按包名解析 `@musefold/desktop-contracts`。
- `V122-DIR-09`：清理与文档：删除根目录遗留配置（`tsconfig.node.json`、`tsconfig.web.json` 等被 references 图取代的文件）；`doc/v1.0/README.md` 与 `docs/08-file-structure.md` 加「目录结构已被 v1.2.2 取代」横幅。

**回滚**：1b 合并前在分支上完成 mac + win 双平台打包冒烟；合并后若发现打包问题，revert 单个合并提交即可，运行时行为不受影响（用户侧无变化）。

### 完成条件

- 根目录不再有 `src/`、`electron/`、`shared/`；`apps/desktop` 结构与[架构文档第 2 节](./V122-ARCHITECTURE.md)一致。
- 打一个 tag 能产出与迁移前等价的签名安装包；`downloads` 产物清单逐项一致。
- 内容层/服务层/外壳层/纯文档四类提交的流水线触发与迁移前等价。
- `git log --follow` 能追溯任一被迁移文件的历史。

## 4. Phase 2：桌面 Gateway

### 任务

- `V122-GW-01`：在 `packages/domain` 上提端口：`PromptGateway`、`WorkbenchGateway`、`GenerationGateway`、`HistoryGateway`、`AccountGateway`、`PlatformServices`（形状以 `apps/web/src/runtime.ts` 的 `WebGateway` 为准）；`WebGateway` 改为 `implements` 这组端口，行为零变化。
- `V122-GW-02`：`apps/desktop/src/runtime/` 建 `DesktopGateway` 骨架与 `mappers/` 目录（行模型 ↔ 端口形状的转换全部收口于此）；宿主组装 runtime 对象注入 store 层。
- `V122-GW-03`：切换 `features/library/store.ts`（977 行，IPC 面最全，作为模式样板）。
- `V122-GW-04`：切换 `features/history/store.ts` 与历史相关组件内的直连 IPC（`HistoryDetail` 等）。
- `V122-GW-05`：切换 `features/account/store.ts` 与 `AccountSection` 的裸 `window.api.cloudSync`。
- `V122-GW-06`：切换 `features/generation/store.ts` 与工作台 store 的 IO 边（会话 CRUD、生图提交/进度；状态机部分留给 `V122-SHARE-04`）。
- `V122-GW-07`：切换 settings 桌面域（aiConnection、cloudConnections、provider）到 `DesktopExtras` 接口（类型来自 `desktop-contracts`，不进共享端口）。
- `V122-GW-08`：桌面接入 `getProductCapabilities('desktop')`，替代页面内散落的能力判断。
- `V122-GW-09`：depcruise 规则收口：迁移完成的 feature 目录禁止 import `lib/ipc` 与 `window.api`（从 baseline 豁免中移除）；桌宠窗口、窗口控件、预览桥保留显式豁免并注明理由。

### 完成条件

- 渲染进程直连 IPC 的文件数从 47+8 降到豁免清单内（预期 ≤ 6）。
- 桌面 E2E 与共享视觉门禁全绿；每张卡独立合并、独立可 revert。
- `DesktopGateway` 与 `WebGateway` 实现同一组 domain 端口，接口差异只剩桌面独有域（`DesktopExtras`）。

## 5. Phase 3：共享逻辑归位

可与 Phase 2 交错，按卡推进。

### 任务

- `V122-SHARE-01`：纯函数入 domain 并去重：`titleFromPromptContent`（桌面副本删除）、积分格式化（`src/lib/format.ts` 与 `apps/web/src/account-format.ts` 收敛）、`history/{lineage,filters,status}.ts`、generation `params.ts`/`presets.ts`。
- `V122-SHARE-02`：UI 原语迁移收尾：dropdown-menu、select、slider、segmented、badge、scroll-area、kbd、skeleton、spinner、image-lightbox 迁入 `@musefold/ui`，删除 `src/components/ui/` 本地实现（约 1,000 行）。
- `V122-SHARE-03`：new-api 客户端去重：`electron/account/api-client.ts` 切换到 `@musefold/new-api-client`，差异部分（设备令牌编排）留在 `electron/account/`。
- `V122-SHARE-04`：工作台 store（2,080 行）按 Web 已验证的三 controller 模式（session/draft-sync/generation-sync）拆分 IO 与状态机；可上提的 reducer 进 `product-ui`，IPC IO 留在 `DesktopGateway`。
- `V122-SHARE-05`：`check-shared-ui-boundaries.mjs` 中 import 类规则（图标唯一入口、禁私有 sidebar）折入 depcruise/ESLint；token 与 CSS 断言保留为脚本。
- `V122-SHARE-06`：删除 `@shared/*` 兼容 re-export 与全部残留引用，`desktop-contracts` 成为唯一入口。

### 完成条件

- 双端重复的纯函数与 UI 原语清零（以 depcruise + 全库 grep 验证）。
- `product-ui` 单测、共享视觉门禁、桌面 E2E、Web E2E 全绿。
- `@shared` 别名从 tsconfig 与 vite 配置中删除。

## 6. v1.3+ 候选（不在本版本门禁内）

| 项 | 前置条件 |
|---|---|
| Prompt/History 实体统一（SQLite 行模型向 `PromptDocument` 靠拢） | 云同步在真实多设备环境稳定运行（v1.1 M4 门禁通过） |
| 宿主编排进一步收敛（共享导航配置、页面命令路由） | Phase 2/3 完成后按痛点评估 |
| pnpm 迁移 | 见 [技术决策 D4 复审触发器](./V122-TECHNOLOGY-DECISIONS.md) |

## 7. 发布门禁

以下门禁在 v1.2.2 视为完成的前提，缺一不可：

1. 根目录无 `src/`、`electron/`、`shared/`；目录结构与架构文档一致。
2. tag 发布链路（v1.2.1 M6）在新目录结构下完整跑通一次，产出签名并公证的安装包，产物清单与迁移前逐项一致。
3. 内容层热更新的 renderer bundle 在新路径下构建、签名、发布到 `dev` 通道并完成一次真实更新。
4. depcruise 分层规则在 CI 生效，baseline 违规数比 Phase 0 建立时下降且无新增豁免。
5. 渲染进程直连 IPC 只存在于显式豁免清单。
6. 桌面 E2E、Web E2E、共享视觉门禁、`check`、`check:v1.1` 全绿；typecheck 单入口。
7. 双端重复的纯函数、UI 原语、new-api 客户端清零。
8. `docs/README.md` 权威顺序更新；被取代的目录规划文档已加横幅。

## 8. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| 1b 打包产物缺依赖（electron-builder 在 workspace 下的收集差异） | 分支上先跑 mac + win 双平台冒烟；`install-app-deps` 验证原生模块 | revert 单个合并提交 |
| 迁移与日常开发 rebase 冲突 | 1a/1b 各集中在 2–3 天窗口完成；纯移动提交易于机械 rebase | — |
| CI 路径过滤失配导致漏部署/误部署 | `V122-DIR-04` 用四类构造提交验证 | 映射文件单点回滚 |
| Gateway 切换引入行为回归 | 按 feature 逐卡合并；桌面 E2E + 视觉门禁每卡必跑 | 单卡 revert |
| 热更新 `minShellVersion` 推导在新路径失效 | `V122-DIR-08` 专项验证；推导按包名解析 | 阻塞发布,不阻塞代码合并 |
| `@shared` re-export 期间新代码继续引用旧路径 | ESLint no-restricted-imports 在 Phase 1a 即禁止新增 | — |

## 9. 相关文档

- [系统架构](./V122-ARCHITECTURE.md)
- [技术选型与决策](./V122-TECHNOLOGY-DECISIONS.md)
- [v1.2.1 交付计划](../v1.2.1/V121-DELIVERY-PLAN.md)（前置里程碑 M0–M7 与发布门禁）
- [v1.1 共享 UI 架构](../v1.1/V11-SHARED-UI-ARCHITECTURE.md)（边界规则与 Stage 1–5 迁移历史）
