# Musefold v1.2.2 迁移计划

> **状态**：Phase 0、Phase 1a 已完成；Phase 2 部分完成（GW-01 domain / GW-02 / GW-03 / GW-05 / GW-07（两刀 fa45f74 + 83d9f71）/ GW-08 已完成），GW-04 / GW-06 未开工，GW-01 WebGateway `implements` 补卡等待 web 并行工作流收口；Phase 3 部分完成（SHARE-06 / 01 / 05 / 02 / 03），仅剩 SHARE-04（与 Phase 2 stores 同批）；Phase 1b 未开工
>
> **日期**：2026-08-20
>
> **前置**：Phase 1a 须 v1.2.1 仓库侧里程碑（M1、M4、M5、M7）完成且桌面回归安全网全绿（已于 2026-08-20 达成，Phase 1a 同日完成）；Phase 1b 须 v1.2.1 发布门禁全部通过，且 Phase 1a 稳定运行一周；Phase 0 可与 v1.2.1 M4–M7 并行
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
| Phase 0 工程化地基 | 依赖声明、zod v4、tooling/、depcruise、project references | 随时（纯仓库侧，与 v1.2.1 M4–M7 并行） | **已完成（2026-08-20）** |
| Phase 1a 源码目录迁移 | `src/`、`electron/`、`shared/` 归位；别名与 CI 映射同步 | v1.2.1 仓库侧里程碑（M1、M4、M5、M7）完成且桌面回归安全网全绿（2026-08-20 已达成） | **已完成（2026-08-20）** |
| Phase 1b App manifest 下移 | 根 package.json 变纯 workspace root | v1.2.1 发布门禁全部通过 + Phase 1a 稳定运行一周 | 集中 1–2 天 + freeze 窗口 |
| Phase 2 桌面 Gateway | domain 端口做全、`DesktopGateway`、stores 逐个切换 | Phase 1a 完成（已达成）；注意与 web 侧并行工作流的协调 | **部分完成（2026-08-20）**：GW-01（domain）/ 02 / 03 / 05 / 07（两刀 fa45f74 + 83d9f71）/ 08 已完成；GW-01 WebGateway `implements` 补卡等待 web 并行工作流收口；GW-04 / 06 未开工 |
| Phase 3 共享逻辑归位 | 纯函数、UI 原语、客户端去重、工作台 store 拆分 | 可与 Phase 2 交错；纯仓库侧，不依赖 Phase 1b | **部分完成（2026-08-20）**：SHARE-06 / 01 / 05 / 02 / 03 已完成；仅剩 SHARE-04（与 Phase 2 stores 同批） |

## 2. Phase 0：工程化地基

不动目录、不改行为，全部可与 v1.2.1 并行。

### 任务

- `V122-BASE-01`：~~补全 `packages/core`、`cli`、`client`、`automation-server` 的真实依赖~~ **已完成（2026-08-20）**。core：contracts/better-sqlite3/openai/ulid；cli：automation-server/client/core；automation-server：core；client 无生产 npm 依赖。`packages/mcp` 测试对 core/automation-server 的引用已于 2026-08-20 补进其 `devDependencies`（原计划留待 Phase 3，因成本极低提前收口）；同批复查 16 个 workspace 包，无其余漏声明。根应用的同类缺口见下方 Phase 1 输入。
- `V122-BASE-02`：~~zod 统一 v4~~ **已完成（2026-08-20）**。`@modelcontextprotocol/sdk` 1.30.0 的 peer 已允许 `^3.25 || ^4.0`，mcp 直接升到与根一致的 `^4.4.3`，无 API 适配，无例外。
- `V122-BASE-03`：~~版本收口与 cli 改名~~ **已完成（2026-08-20）**。15 个 private 包统一 `0.0.0-internal`；实证 npm 11 下 `*` 引用正常链接 prerelease workspace 包（不去 registry），无需退到 `0.0.0`。cli 已改名 `@musefold/cli`，bin 不变。
- `V122-BASE-04`：~~建立 `tooling/`~~ **已完成（2026-08-20）**。`tooling/{tsconfig.base.json, eslint.config.base.mjs, dependency-cruiser.cjs, dependency-cruiser-known-violations.json}`（扁平布局，未用子目录）；18 条分层规则映射架构 3.2 节；baseline 初始 6 条存量违规（1 条 `web-no-desktop`：`apps/web/src/account-format.ts → shared/constants.ts`；5 条 `no-circular` warn），只许减不许增。

  **baseline 已于 2026-08-20 归零**，`no-circular` 同步升为 `error`，`dependency-cruiser-known-violations.json` 现为空数组：
  - `web-no-desktop`：越界内容只有计费常量 `ACCOUNT_QUOTA_PER_POINT`。它是服务端计费口径（new-api `QuotaPerUnit`），两端必须显示同一数值，因此归位到 `packages/contracts/src/billing.ts`（零 import 叶子模块），`shared/constants.ts` 改为 re-export 保持桌面侧调用不变。同时删掉 `apps/web` 的 vite/vitest `@shared` 别名，让该越界在解析层面不可达，而非只靠规则事后拦。
  - 3 条 `no-circular`（web `runtime` ⇄ `fixture-runtime`、`electron/account` ⇄ `cloud-sync`、workbench `store` ⇄ `stores/app`）环上均有 `dynamic-import` 边——动态 import 正是刻意打破初始化顺序环的手段，计为违规会逼人改写法绕过规则。改用 dependency-cruiser 17.4.3 的 `to.viaOnly.dependencyTypesNot: ['dynamic-import']`（语义经源码 `src/validate/matchers.mjs` 核实：环上至少一条该类型边即不命中），静态环仍一律拦。
  - 2 条 type-only 环（`shared/types/models` ⇄ `providers`、`providers` ⇄ `skill-runtime`）：被双向引用的类型抽到叶子模块 `shared/types/generation-snapshots.ts`，原路径 re-export 保持导出面不变。
- `V122-BASE-05`：~~全仓 project references~~ **已完成（2026-08-20）**。18 个 composite 项目，根 `tsc -b` 单入口，include 无重叠；声明产物进 gitignored `.tsout/`。实测全仓冷编译峰值约 1.18 GiB、增量约 0.25s，`typecheck:mcp` 8 GiB 特例已删除。
- `V122-BASE-06`：~~depcruise 接入 CI~~ **已完成（2026-08-20）**。`check:boundaries` 脚本 + turbo root task，ci.yml 主检查扩为 `typecheck test build lint check:boundaries`；与 `check:ui-boundaries` 并存。
- `V122-BASE-07`：~~清理死代码~~ **已完成（2026-08-20）**。删除 `src/features/{chat,composer,studio}` 空目录、`useDebounce.ts`、library store 中零引用的文件夹/标签/智能集/批量 actions（store 约 978 行减至 614 行）。后端退役面（IPC/preload/core repositories 的 folder/tag/batch/smartSet 通道）按规则保留，见下方 Phase 3 输入。

### 完成条件

- `npm run check` 与 `npm run check:v1.1` 语义不变且全绿。✅
- `npm ls` 无 workspace 包缺失声明告警；depcruise baseline 建立且 CI 生效。✅
- typecheck 收敛为一条 `tsc -b`（或按包的 turbo 任务），无 8 GiB 堆特例。✅

Phase 0 于 2026-08-20 全部完成。

### Phase 0 沉淀的 Phase 3 输入

- **`@shared/*` 别名消费清单**（原为 Phase 3 拆迁 `shared/` 的依据；`shared/` 已于 Phase 1a DIR-02 解散）：`packages/core` 消费面最大（constants、pricing、types/{enums,models,providers,ipc,workbench,design-scheme}、design-scheme/{prompt-compiler,schema}）；`packages/cli` 生产代码消费 constants、pricing；`packages/automation-server` 生产代码消费 types/providers、constants；`packages/client` 零别名。残留的 `@shared/types/*` 直映与 ESLint 禁令已由 `V122-SHARE-06` 收口。
- **退役后端面**（前端 store 死路径已删）：~~以下保留待 Phase 3 决断：`electron/main/ipc/{folders,tags,prompts,smartSets}.ts` 的 folder/tag/batch/smartSet 通道、preload 对应暴露、`packages/core` 的 folders/tags/smartSets repositories——导入导出与 E2E 仍在使用其中一部分，不能整体删除。~~ **已决断落地（2026-08-20，069535e）**。审计修正了 Phase 0 注记——导入导出引擎从来不经这些 repo/IPC，一直是 `getDb()` 直写 SQL；真正挡删除的是 E2E 夹具与 library store 残留的 list 调用。删除链：18 条 IPC（folders 5、tags 5、smartSets 4、prompt batch 4）+ 18 个 preload 方法（含 folder/tag/smartSet 三命名空间）+ ipc.ts 常量与类型 + 23 个 repository 方法 + 3 个源文件（ipc/folders.ts、ipc/tags.ts、repositories/folders.ts）。保留：搜索历史 IPC、`tagsRepo.assignToPrompt`/`getByPromptId`（prompt 写路径）、`prompt.list({folderId,tagIds})`、导出信封 v3 的 folders/tags/smartSets 字段、云同步 folder/tag 入站与 bootstrap（独立 SQL）、schema 与迁移史全部不动。

  **后果声明**：foldersRepo 删除连带 `enqueueActiveAccountMutation('folder'|'tag')` 消失，桌面不再产生本地目录 CRUD 的 live mutation（UI 本就无写入口，已有行仍靠 bootstrap 上报）。E2E 夹具改 SQL 直写，`test_00_harness` 加负向断言锁 `window.api` 上退役命名空间不回流。基线保持 222/17。
- **已知测试竞态**：~~根 vitest 并行时 brand-migration 相关测试与 `packages/cli/dist` 写入偶发撞车~~ **已于 2026-08-20 修复**。根因不是临时目录问题，而是 `readProductText()` 递归扫描 `packages/**` 时把构建产物一起读了：该守卫要守的是源码，产物随时可重建，扫它既拖慢测试又会和并发构建抢文件。现按目录名跳过产物与依赖目录（`dist`/`out`/`node_modules`/`.turbo`/`.tsout` 等）并跳过符号链接；正反向都已验证（产物目录内放旧品牌串仍通过，`src/` 下放则失败）。

### Phase 0 沉淀的 Phase 1 输入

- **根应用的依赖声明缺口**（「缺口五」在根目录的残留）：`electron/` 与 `src/` 生产代码大量 import `@musefold/core`、`@musefold/automation-server`，但根 `package.json` 未声明，靠 `tooling/tsconfig.base.json` 与 `vitest.config.ts` 的别名解析。**不能只补声明**：electron-vite 的 `externalizeDepsPlugin` 以 `dependencies` 为准，一旦声明就会把它们外部化，打包后的主进程将在运行时 require TS 源码——必须同步加入 `electron.vite.config.ts` 的 `externalizeDeps.exclude`（现有 `cloud-client`/`contracts`/`update-protocol` 就是这么处理的，见 `electron/main/__tests__/workspace-bundling.test.ts`）。该路径只有完整打包并启动才能验证，不在 `typecheck test build lint check:boundaries` 门禁覆盖内，因此并入 Phase 1a 的 `V122-DIR-01`（App manifest 与构建配置本就要一起动）一次做完，而不是先单独补声明。
- **lint 棘轮**：`tooling/eslint.config.base.mjs` 首批 8 条低违规规则已于 2026-08-20 清零并启用；第二批 `@typescript-eslint/no-unused-vars` 与 `@typescript-eslint/no-require-imports` 已于同日清零并启用（详见 v1.2.1 交付计划 `V121-CI-08`）。剩余 `react-hooks/set-state-in-effect` 47、`@typescript-eslint/no-explicit-any` 41、`react-hooks/exhaustive-deps` 12、`react-hooks/refs` 5、`react-hooks/immutability` 2、`react-hooks/incompatible-library` 2。其中 react-hooks 系列与 `no-explicit-any` 按既有裁定留 Phase 2 stores 切换同批，避免同一文件反复改动。`linterOptions.reportUnusedDisableDirectives` 仍为 `off`，其 6 处未使用指令中 5 处属 `exhaustive-deps`，须与该规则同批启用。

## 3. Phase 1：目录重构

**2026-08-20 修订**：Phase 1a（仅移动桌面目录：`src/`、`electron/`、`shared/`）的开工门禁由「v1.2.1 发布门禁全部通过」改为「v1.2.1 仓库侧里程碑（M1、M4、M5、M7）完成且桌面回归安全网全绿」，该条件已于 2026-08-20 达成。Phase 1b 维持原门禁（v1.2.1 发布门禁全部通过 + Phase 1a 稳定运行一周）。

1. [v1.2.1 交付原则 7](../v1.2.1/V121-DELIVERY-PLAN.md) 的目的是「迁移依赖 affected 流水线、自动部署与回滚作为回归安全网」。保护**桌面目录迁移**的安全网是：affected 流水线与 Turborepo 缓存（M1，已交付）、全仓 typecheck/test/build/lint/boundaries（Phase 0，已交付）、桌面 E2E 222 例与打包冒烟（M5 期间扩充，含 macOS 真包验证）——全部就绪且在用。
2. v1.2.1 发布门禁中尚未达成的项全部是外部条件：对象存储与 CDN 采购（CHAN-07）、生产服务器的部署身份与自托管 runner（M0/M2/M3）、签名证书（M6）。Phase 1a 只移动桌面代码，不触碰服务部署面、不触碰发布链路语义（层级路径映射仍是单点定义，DIR-04 专卡处理）；这些外部项无论完成与否都不构成对桌面迁移的回归保护，让目录迁移无限期等待采购只产生停滞。
3. 风险边界不变：Phase 1b 要动 `electron-builder.yml`、`infra/v1.1/Dockerfile` 与发布脚本（DIR-06/07/08），才真正依赖发布链路与服务器侧验证能力，因此 1b 门禁原样保留。1a 的回滚方式仍是 revert 单个迁移提交。

### Phase 1a：源码目录迁移（根 package.json 暂不动）

- `V122-DIR-01`：~~`git mv src apps/desktop/src`、`git mv electron apps/desktop/electron`；`electron.vite.config.ts` 迁至 `apps/desktop/` 并更新入口路径；根 package.json 暂时保留 App manifest 角色，`main` 字段指向新输出路径。~~ **已完成（2026-08-20）**。桌面应用迁入 `apps/desktop/`；根 package.json 仍为 App manifest（下移属 Phase 1b）。
- `V122-DIR-02`：~~新建 `packages/desktop-contracts`，`git mv shared/types/*` 迁入；其余 `shared/` 文件按[架构文档第 6 节](./V122-ARCHITECTURE.md)归位 domain/core/desktop-contracts；`@shared/*` 别名由 `desktop-contracts` 兼容 re-export。~~ **已完成（2026-08-20，fcd614f）**。`shared/` 已解散。`shared/types/*` 15 文件迁入新包 `@musefold/desktop-contracts`（`0.0.0-internal`，composite）；`@shared/types/*` 别名直映到包内，数百处 types import 零改动，**无 re-export 胶水**。其余 `@shared/<module>` import 全部改写为真实包名——单一兼容模块会把 `better-sqlite3` 拉进渲染层，故不走「一个 re-export 兜底」。

  归位（执行期按 import 图逐文件判定，订正架构 §6 预估）：
  - `design-scheme/` → `desktop-contracts`；
  - `diagnostics.ts`、`share.ts` 核实为纯函数（无 Node import，`Buffer` 仅特性探测）→ 留 `desktop-contracts`（预估曾写 core / `apps/desktop`）；
  - `export-format` / `generation-prompt` / `app-result` / `errors` → `packages/domain`；
  - `pricing` → `packages/core`（裁定：其类型面是桌面 SQLite 行模型即 desktop-contracts，而 domain 禁止依赖 desktop-contracts，故不能进 domain）；
  - `skill-scanner` → `apps/desktop/electron/main/skill-import/`（依赖 yaml 且仅主进程消费）；
  - 全仓守卫 `brand-migration` / `namespace` 测试 → `tests/repo/`。

  constants 拆分：产品常量 + `MUSEFOLD_SKILL_*` 三常量 → `packages/domain/src/constants.ts`；落盘路径类常量（`DB_NAME`、目录名、`FTS_TOKENIZE`）→ `packages/core/src/constants.ts`；billing 消费方直连 `@musefold/contracts/billing.js`。

  **裁定（预料外，2026-08-20）**：desktop-contracts 依赖 domain（`prompt-compiler` 运行时调 `generation-prompt`；type-only `AppResult`）与 type-only 的 update-protocol（`Channel`）——向下依赖、渲染安全。depcruise 新规则 `desktop-contracts-no-upward` 放行 domain / contracts / update-protocol，禁止 core / electron / renderer / apps。规则 18→19 条，0 违规（770 modules / 2951 deps）。

  `check-skill-update.mjs`：新路径优先、父 revision 回退 `shared/constants.ts`，self-test 扩跨路径分支。

  验证：turbo 30/30（18 包）、全量 E2E 221+1 重跑 / 17 skipped、adhoc 真包 + macOS 冒烟 2 passed。
- `V122-DIR-03`：~~收敛别名：`@renderer`、`@main` 只在 `apps/desktop` 的 tsconfig 与 vite 配置中定义；删除 `vitest.config.ts`、`electron.vite.config.ts` 中与 tsconfig 重复的 alias 表。~~ **已完成（2026-08-20，12bf33d）**。运行时别名单点定义 `tooling/aliases.mjs`，electron.vite / vitest / vite.preview / build-cli 以 `pickAliases` 取名单（各配置 pick 名单与收敛前逐项相同）。tsconfig paths 因 `extends` 整表覆盖不合并、且无法 import JS，保持声明在 `tooling/tsconfig.base.json`，由新守卫测试 `tests/repo/alias-consistency.test.ts`（3 条）双向比对锁漂移。

  `tsconfig.node.json` / `tsconfig.web.json` 迁入 `apps/desktop/` 保留原名（无按名发现机制，node/web 词汇与既有脚本/规则一致）。

  **事实修正**：架构文档写的桌面别名 `@main` 实际代码中是 `@electron`——文档按代码现实修正（见 [架构文档](./V122-ARCHITECTURE.md)）。

  depcruise 对相对 extends 解析有缺陷（TS5083），`dependency-cruiser.cjs` 改用绝对路径。

  验证：turbo 30/30、根 vitest 164 files / 961 tests、冒烟 `reason=builtin`、内容更新 E2E 3 passed。
- `V122-DIR-04`：~~更新 v1.2.1 的层级路径映射（`.github/layer-paths.yml`）：外壳层 `apps/desktop/electron/`、内容层 `apps/desktop/src/`、新增 `packages/desktop-contracts`。构造四类提交各验证一次触发正确。~~ **已完成（2026-08-20，d440f48；补卡 da6754a）**。`layer-paths.yml` 切至 `apps/desktop/**`；旧 `src/`、`electron/`、`shared/` 条目删除；`packages/desktop-contracts` 双列 content+shell（渲染与主进程同时消费，照 update-protocol 模式，最保守）；`electron.vite.config.ts` 双列 content+shell 并撤出 infra。desktop E2E 门控组同步。四类构造变更验证触发正确。

  **补卡（三处映射缺口，da6754a）**：`packages/core/**` 补进 shell（主进程编译它）；`packages/domain/**` 补进 service（web-api 依赖）；迁走的桌面 tsconfig 撤出 infra、按编译单元拆归 shell（node）/ content（web），避免渲染 tsconfig 误点外壳车道。self-test 补断言。
- `V122-DIR-05`：~~门禁：`check` + `check:v1.1` + 桌面 E2E + 共享视觉门禁 + `package:mac:adhoc` 冒烟。~~ **已完成（2026-08-20）**。turbo 全门禁 30/30 + 全量桌面 E2E + adhoc 真包冒烟（DIR-02 内完成）+ `check:v1.1` 通过 + `test:visual:shared` 共享视觉门禁通过（web/desktop 视觉契约全对通过）。

Phase 1a 于 2026-08-20 全部完成，门禁全绿。

### Phase 1a 沉淀的 Phase 3 输入

- **`@shared/types/*` 兼容别名的删除与 import 全量改写**：~~DIR-02 为避免数百处 types import 改动，将 `@shared/types/*` 直映到 `packages/desktop-contracts`；删除该别名并改写全部 import 留 Phase 3（`V122-SHARE-06`）。~~ **已完成（2026-08-20）**，见 `V122-SHARE-06`。
- **ESLint `no-restricted-imports` 禁 `@shared`**：~~原计划在 Phase 1a 即禁止新增，执行期未落地；与别名删除同批收口，避免别名仍在时规则与现实打架。~~ **已完成（2026-08-20）**，与别名删除同批落地，见 `V122-SHARE-06`。

**回滚**：1a 全部是移动与路径修正，revert 迁移提交即回滚。

### Phase 1b：App manifest 下移（需 feature freeze 窗口）

- `V122-DIR-06`：Electron App manifest 下移到 `apps/desktop/package.json`（`main`、App 依赖、electron-builder 配置、`postinstall` 的 `install-app-deps`）；根 package.json 变纯 workspace root，只留全局脚本与 devDependencies。`electron-builder.yml` 迁至 `apps/desktop/` 并验证原生依赖收集（`better-sqlite3`）在 workspace 布局下正确打入。
- `V122-DIR-07`：更新 `scripts/*.mjs` 中的路径引用（`run-builder`、`build-cli`、`clean-artifacts`、release 系列）；更新 `infra/v1.1/Dockerfile` 构建上下文（web-api 镜像不再安装桌面 App 依赖，构建应变轻）。
- `V122-DIR-08`：发布链路全验证：tag 触发打包 workflow、renderer bundle 构建路径（`apps/desktop/out/renderer`）、`minShellVersion` 推导脚本按包名解析 `@musefold/desktop-contracts`。
- `V122-DIR-09`：清理与文档：删除 `apps/desktop/` 下迁入的 `tsconfig.node.json`、`tsconfig.web.json`（DIR-03 已自根目录迁入并保留原名）等被 references 图取代的文件；`doc/v1.0/README.md` 与 `docs/08-file-structure.md` 加「目录结构已被 v1.2.2 取代」横幅。

**回滚**：1b 合并前在分支上完成 mac + win 双平台打包冒烟；合并后若发现打包问题，revert 单个合并提交即可，运行时行为不受影响（用户侧无变化）。

### 完成条件

- 根目录不再有 `src/`、`electron/`、`shared/`；`apps/desktop` 结构与[架构文档第 2 节](./V122-ARCHITECTURE.md)一致。✅（Phase 1a：三处源码已迁走；`apps/desktop/package.json` 与 `electron-builder.yml` 下移属 Phase 1b）
- 打一个 tag 能产出与迁移前等价的签名安装包；`downloads` 产物清单逐项一致。
- 内容层/服务层/外壳层/纯文档四类提交的流水线触发与迁移前等价。
- `git log --follow` 能追溯任一被迁移文件的历史。

## 4. Phase 2：桌面 Gateway

**2026-08-20 修订**：Phase 2 的开工门禁由「Phase 1 完成」改为「Phase 1a 完成」，该条件已于 2026-08-20 达成。Phase 1b 维持原门禁（v1.2.1 发布门禁全部通过 + Phase 1a 稳定运行一周），与 Phase 2 解耦。

1. Phase 1b 只下移 App manifest 与 electron-builder 配置（DIR-06~09），动的是打包与发布链路；Phase 2 的 Gateway 卡（GW-01~09）全部是 domain 端口与渲染层 stores 的仓库侧重接线。两者无共享文件、无依赖关系。1b 被外部条件（签名证书、服务器部署身份）加一周稳定期锁死，让 Gateway 工作无限期等待，与 Phase 1a 门禁修订时驳回的「等采购」是同一种停滞。
2. 风险边界不变：Phase 2 每卡的回归保护本来就是仓库侧门禁（桌面 E2E、共享视觉门禁、turbo 全门禁），与 1b 的发布链路验证无关；GW 卡独立合并、独立 revert 的原则不变。
3. 注意事项：`V122-GW-01` 原计划同时改 `apps/web/src/runtime.ts` 为 `implements`。执行期因 web 侧并行未提交改动改为 domain 半卡；`implements` 补卡须等该工作流收口，避免工作树互相踩踏。端口不漂移由 `apps/web/src/__tests__/gateway-ports.typecheck.test.ts`（`satisfies`）锁住。

### 任务

- `V122-GW-01`：~~在 `packages/domain` 上提端口：`PromptGateway`、`WorkbenchGateway`、`GenerationGateway`、`HistoryGateway`、`AccountGateway`、`PlatformServices`（形状以 `apps/web/src/runtime.ts` 的 `WebGateway` 为准）；`WebGateway` 改为 `implements` 这组端口，行为零变化。~~ **已完成（2026-08-20，b12bbd8）**（domain 半卡）。在 `packages/domain` 上提六端口，签名照抄 `WebGateway` 现行形状，不改名不合并。分组：
  - PromptGateway：listPrompts / getPrompt / createPrompt / updatePrompt / deletePrompt / restorePrompt / usePrompt
  - WorkbenchGateway：list/get/create/update/deleteWorkbenchSession
  - GenerationGateway：createGeneration / getGeneration / streamGenerationEvents / cancelGeneration / retryGeneration / approveGeneration
  - HistoryGateway：listGenerationHistory / deleteGeneration / restoreGeneration
  - AccountGateway：getSession / login / logout / listConnections / updateConnection / revokeConnection
  - PlatformServices：**空接口**（WebGateway 当时没有 toast/download/clipboard/openExternal）
  - 未归组：`readonly mode: "api" | "fixture"`（宿主传输开关，非领域 IO）

  类型只引用 `@musefold/contracts` + domain。`WebGateway implements` 因 web 并行未提交改动**推迟**；用新增 `apps/web/src/__tests__/gateway-ports.typecheck.test.ts`（`satisfies`）锁不漂移。

  **裁定**：端口按 WebGateway 现行方法名原样上提，不发明新抽象；PlatformServices 保持空接口，不把计划中的 clipboard/download/openExternal 提前写进 domain。`mode` 不进领域端口。

  验证：`gateway-ports.typecheck.test.ts`（`satisfies`）锁端口与 `WebGateway` 形状不漂移。
- `V122-GW-02`：~~`apps/desktop/src/runtime/` 建 `DesktopGateway` 骨架与 `mappers/` 目录（行模型 ↔ 端口形状的转换全部收口于此）；宿主组装 runtime 对象注入 store 层。~~ **已完成（2026-08-20，fc197b8）**。`apps/desktop/src/runtime/` 骨架：`createDesktopGateway(api)` + 懒单例 `desktopGateway`。字段转换只在 `mappers/`。depcruise 第 20 条 `desktop-runtime-contracts-only-in-mappers`：runtime 组装层禁 contracts。PromptGateway 全实现（有损字段逐条注释）。其余按 IPC 能直映的做，对不齐的抛 `DesktopGatewayNotImplementedError`。骨架未接线，行为零变化。新增 19 条测试。

  **裁定**：`streamGenerationEvents` 定为 NotImplemented。桌面 `image.onProgress` 无 seq/终态，硬适配会编造序号；GW-06 前要决定扩 preload 还是桌面改拉模型。

  验证：新增 19 条测试；库 E2E 21 passed；turbo 28/30，红的是并行 web/product-ui 4 条，非本卡。
- `V122-GW-03`：~~切换 `features/library/store.ts`（977 行，IPC 面最全，作为模式样板）。~~ **已完成（2026-08-20，7790a35）**。library store 模式样板。走 gateway：update / delete / restore / copy 的 usePrompt；delete/restore 传合成 version 1。仍走 `api`：list / listDeleted / stats / togglePin / reorderPins / purge / searchHistory。create 仍走 `api.prompt.create`。新增 `applyPromptDocumentToRow`：update 回写保留封面路径。注入：模块级 `setLibraryPromptGatewayForTests`，无 React context。

  **裁定**：**list 不走端口**——云 `PromptListQuery` 表达不了桌面 search + 多维 filters + sortDir。**create 仍走 `api.prompt.create`**——`NewPromptDocument` 无 `previewImagePath`，笺与工作台「存为提示词」经端口会丢封面。

  验证：store+mapper 测试、库 E2E 21 passed、冒烟 `reason=builtin`。library 剩余 api 已由 GW-07 第一刀（fa45f74）切到 extras。
- `V122-GW-04`：切换 `features/history/store.ts` 与历史相关组件内的直连 IPC（`HistoryDetail` 等）。
- `V122-GW-05`：~~切换 `features/account/store.ts` 与 `AccountSection` 的裸 `window.api.cloudSync`。~~ **已完成（2026-08-20，34711b4）**。执行期按 import 图改裁定：实际切的是 `cloud-connections-store` 的 list/update/revoke → AccountGateway。当时未切：account/store login/status（AccountSession 有损，丢掉 deviceTokenSuffix/serverUrl/notices/health/estImagesRemaining）；AccountSection cloudSync（桌面独有）。二者已由 GW-07 第二刀（83d9f71）收口。契约测试改为断言网关方法名；新增 store 单测 6 条。

  **裁定**：**不按计划切 account/store 与 AccountSection cloudSync**——共享 AccountGateway 能接的是 cloud-connections 的 list/update/revoke；login/status 全量与 cloudSync 留给 GW-07（已由 83d9f71 收口）。

  验证：账号 E2E 4 条 + signed-out 已连接应用 1 条通过；turbo 除并行 4 红外全绿。
- `V122-GW-06`：切换 `features/generation/store.ts` 与工作台 store 的 IO 边（会话 CRUD、生图提交/进度；状态机部分留给 `V122-SHARE-04`）。**开工前裁定**：`streamGenerationEvents`（GW-02 已定为 NotImplemented：桌面 `image.onProgress` 无 seq/终态，硬适配会编造序号）——须先决定扩 preload 还是桌面改拉模型。
- `V122-GW-07`：~~切换 settings 桌面域（aiConnection、cloudConnections、provider）到 `DesktopExtras` 接口（类型来自 `desktop-contracts`，不进共享端口）。DesktopExtras 需覆盖 library 未进共享端口的桌面面：list（桌面查询面）、stats、pin/reorder、purge、带 `previewImagePath` 的 create、searchHistory；另补（GW-05）account login/status 全量、AccountSection cloudSync。~~ **已完成（2026-08-20，两刀 fa45f74 + 83d9f71）**。`PlatformServices` 仍空。

  第一刀（fa45f74，library extras）：新增扁平 `DesktopExtras`（`packages/desktop-contracts/src/desktop-extras.ts`）。library list/listDeleted/stats/create/togglePin/reorderPins/purge/searchHistory 直通行模型，不经 PromptDocument。library store 剩余 api 调用已切到 extras；update/delete/restore/usePrompt 仍走 PromptGateway。

  第二刀（83d9f71，account / cloudSync）：DesktopExtras 新增 account* 与 cloudSync* 扁平方法，直通 IPC，返回 AccountStatus / CloudSyncSummary，不经 AccountSession mapper。account/store.ts 去掉 lib/ipc；AccountSection 不再出现 window.api.cloudSync。两刀合起来，计划点名的 library extras + account login/status 全量 + cloudSync 已收口。

  **aiConnection / provider 未纳入本卡**：计划原文点了名，但仍直连 ipc。它们是设置桌面域的下一批，避免和账号切片抢同一文件；列入后续输入。cloudConnections 已由 GW-05 切到 AccountGateway。

  **裁定**：library 桌面查询/写面走 extras 行模型，不经共享 PromptDocument。account login/status 全量与 cloudSync 走 extras 直通桌面状态，不经 AccountSession mapper（共享 AccountGateway 的 getSession/login 仍有损）。

  验证：第一刀库 E2E 21 passed。第二刀 vitest 32 passed；账号 E2E 4；cloud 设置 1；tsc 通过。
- `V122-GW-08`：~~桌面接入 `getProductCapabilities('desktop')`，替代页面内散落的能力判断。~~ **已完成（2026-08-20，ae9723e）**。桌面接入 `getProductCapabilities('desktop')`，单点 `apps/desktop/src/runtime/capabilities.ts`。Sidebar / SettingsView / CommandPalette 按 flag 滤入口。修正过期 flag：`desktop.cloudMcpConnections` false→true（已连接应用存在）。命令面板 `act-providers`→byokProviders、`act-ai-connections`→agent，避免 ⌘K 后门。当前 flag 全 true，可见入口不变。工作台内部按钮不闸。

  **裁定**：能力判断单点 `runtime/capabilities.ts`；Sidebar / SettingsView / CommandPalette 按 flag 滤入口，工作台内部按钮不闸。过期 flag 与命令面板 action 对齐真实能力，避免 ⌘K 后门。

  验证：当前 flag 全 true，可见入口不变。
- `V122-GW-09`：depcruise 规则收口：迁移完成的 feature 目录禁止 import `lib/ipc` 与 `window.api`（从 baseline 豁免中移除）；桌宠窗口、窗口控件、预览桥保留显式豁免并注明理由。

### Phase 2 沉淀的后续输入

- **GW-06 前裁定 `streamGenerationEvents`**：GW-02 已定为 `DesktopGatewayNotImplementedError`。桌面 `image.onProgress` 无 seq/终态，硬适配会编造序号；须先决定扩 preload 还是桌面改拉模型。
- **settings aiConnection / provider**：GW-07 未纳入。计划原文点了名，仍直连 ipc。它们是设置桌面域的下一批，避免和账号切片抢同一文件。
- **`PlatformServices` 仍空**：GW-08 落地的是 capabilities，未填 PlatformServices。
- **GW-01 `WebGateway implements` 补卡**：等待 web 并行工作流收口；期间以 `gateway-ports.typecheck.test.ts`（`satisfies`）锁形状。

### 完成条件

- 渲染进程直连 IPC 的文件数从 47+8 降到豁免清单内（预期 ≤ 6）。
- 桌面 E2E 与共享视觉门禁全绿；每张卡独立合并、独立可 revert。
- `DesktopGateway` 与 `WebGateway` 实现同一组 domain 端口，接口差异只剩桌面独有域（`DesktopExtras`）。

## 5. Phase 3：共享逻辑归位

**启动裁定（2026-08-20）**：Phase 3 与 Phase 2 可交错、纯仓库侧，不依赖 Phase 1b 的 manifest 下移；在 Phase 1b 等待外部条件与稳定期期间先行推进。`V122-SHARE-06` / `01` / `05` / `02` / `03` 已完成；仅剩 `SHARE-04`（与 Phase 2 stores 切换同批）。

### 任务

- `V122-SHARE-01`：~~纯函数入 domain 并去重：`titleFromPromptContent`（桌面副本删除）、积分格式化（`src/lib/format.ts` 与 `apps/web/src/account-format.ts` 收敛）、`history/{lineage,filters,status}.ts`、generation `params.ts`/`presets.ts`。~~ **已完成（2026-08-20，2aba605）**。双端重复纯函数入 domain。上提：`titleFromPromptContent`（桌面副本删除，domain 原有实现为准）；积分格式化收敛为 `packages/domain/src/billing-format.ts`（`quotaToPoints` / `formatPoints`，`formatAccountPoints` 为 Web 已验证名的别名）；history 三件套 → `history-lineage.ts` / `history-filters.ts` / `history-status.ts`（Web 无对等实现，按「桌面独有但纯」上提；lineage 用结构化 `HistoryLineageNode` 解耦，domain 不 import desktop-contracts）；generation presets → `provider-presets.ts`。

  **不可合并清单（裁定）**：`buildImageRequest` / `RefineParams` 等（类型面是桌面 IPC 请求，Web 对等物是 `CloudGenerationRequest`，形状不同属产品差异）；`formatTime` / `formatCost` / `formatDuration` 留桌面。删除 6 个实现副本 + 5 个测试副本，改写 14 文件 import。

  验证：turbo 30/30、`check:v1.1`、视觉门禁、全量 E2E 222 passed / 17 skipped。
- `V122-SHARE-02`：~~UI 原语迁移收尾：dropdown-menu、select、slider、segmented、badge、scroll-area、kbd、skeleton、spinner、image-lightbox 迁入 `@musefold/ui`，删除 `src/components/ui/` 本地实现（约 1,000 行）。~~ **已完成（2026-08-20，20d5dc1）**。点名 10 原语全部迁入 `@musefold/ui`，跟随既有合并文件体例（`extended-primitives.tsx` + `primitives.css` 的 mf-ui token 类，不引入 cva/Tailwind）。审计发现 6 个原语当时零消费方（select/slider/segmented/badge/scroll-area/skeleton），仍迁入避免本地养死实现。`ImageLightbox`（276 行，深桌面耦合）参数化为 `src` + save/reveal/copy 回调，桌面留 84 行 IPC/toast 薄适配（`apps/desktop/src/components/image-lightbox.tsx`），消费方 API 与 E2E 选择器不变。桌面删 10 文件约 731 行，改写 8 文件 import。ui 包测试 5→9 条。

  **裁定**：`Badge`/`Spinner` 与既有 `StatusBadge`/`LoadingState` 职责不同，未强行合并。

  验证：turbo 30/30、`check:ui-boundaries`、`check:v1.1`、视觉门禁、桌面 E2E 222/17、Web E2E 13 passed。
- `V122-SHARE-03`：~~new-api 客户端去重：`electron/account/api-client.ts` 切换到 `@musefold/new-api-client`，差异部分（设备令牌编排）留在 `electron/account/`。~~ **已完成（2026-08-20，f6f1178）**。桌面 `api-client.ts` 377→83 行，HTTP 面全量切到 `@musefold/new-api-client`；生产净删 168 行。包加构造器级扩展点 `createError`（桌面注入 `RelayApiError` 保持 `instanceof` 与 `ACCOUNT/*` 码，web-api 短码不变），新增桌面独有端点 `listUserModels`/`getPricing`/`getNotices`。桌面 2FA/超时/5xx 文案写进包（web-api 按 code 映射不读 message，无影响）。设备令牌编排、failover、服务器 URL 用户文案留 `electron/account/`。根 dependencies 增 `@musefold/new-api-client` + electron.vite exclude。

  **裁定**：审计结论——管理面两端都是 JWT Bearer + Cookie，桌面 sk- 设备令牌只用于托管 Provider，认证并无分叉，无需 header 注入回调。

  验证：turbo 30/30、`check:v1.1`（new-api-client 9 passed、web-api 15/11 skipped）、冒烟、桌面 E2E 222/17。
- `V122-SHARE-04`：工作台 store（2,080 行）按 Web 已验证的三 controller 模式（session/draft-sync/generation-sync）拆分 IO 与状态机；可上提的 reducer 进 `product-ui`，IPC IO 留在 `DesktopGateway`。与 Phase 2 stores 切换同批，未开工。
- `V122-SHARE-05`：~~`check-shared-ui-boundaries.mjs` 中 import 类规则（图标唯一入口、禁私有 sidebar）折入 depcruise/ESLint；token 与 CSS 断言保留为脚本。~~ **已完成（2026-08-20，9e9f041）**。边界脚本 import 规则折入 ESLint。核实脚本 7 项检查中唯一 import 形的是 lucide-react 直连禁令 → `no-restricted-imports` regex `^lucide-react(?:/|$)`，`packages/ui/src/icons.ts` 唯一豁免，比旧脚本更严（深路径、全仓范围）。

  **裁定**：「禁私有 sidebar」核实为 CSS/JSX 断言而非 import 图，不硬造 depcruise 规则，留脚本。token / CSS / JSX 断言留 `check:ui-boundaries`。红绿验证（探针文件先红后绿）。depcruise 仍 19 条、0 豁免。
- `V122-SHARE-06`：~~删除 `@shared/types/*` 兼容别名并全量改写 import；ESLint `no-restricted-imports` 禁 `@shared`；`desktop-contracts` 成为唯一入口。~~ **已完成（2026-08-20，0bd0a28）**。删除 `@shared/types/*` 兼容别名。180 个消费方文件改写为 `@musefold/desktop-contracts/<mod>` 子路径（electron 76、src 78、core 22、automation-server 2、cli / mcp 各 1 测试）。别名从 `tooling/aliases.mjs`、`tooling/tsconfig.base.json` 与各 pickAliases 名单删除。ESLint `no-restricted-imports` 以 regex `^@shared(?:/|$)` 锁死；alias-consistency 守卫改为负向断言；depcruise 19 条规则保留 `'^@shared'` 作回流锁。

  **裁定（预料外）**：沙箱 preload 的包名 import 会被 `externalizeDepsPlugin` 外部化导致打包后 require 失败，已给 preload 补与 main 同语义的 `externalizeDeps.exclude`（desktop-contracts + domain），`workspace-bundling.test.ts` 扩 preload 断言。

  验证：turbo 30/30、全量 E2E 222 passed / 17 skipped。

### 完成条件

- 双端重复的纯函数与 UI 原语清零（以 depcruise + 全库 grep 验证）。
- `product-ui` 单测、共享视觉门禁、桌面 E2E、Web E2E 全绿。
- `@shared` 别名从 tsconfig 与 vite 配置中删除。✅（`V122-SHARE-06`）

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
| `@shared/types/*` 兼容别名残留、新代码继续走旧路径 | **已收口（2026-08-20，`V122-SHARE-06` / 0bd0a28）**：别名删除；ESLint `no-restricted-imports` 以 regex `^@shared(?:/|$)` 锁死；alias-consistency 守卫改为负向断言；depcruise 19 条规则保留 `'^@shared'` 作回流锁 | — |

## 9. 相关文档

- [系统架构](./V122-ARCHITECTURE.md)
- [技术选型与决策](./V122-TECHNOLOGY-DECISIONS.md)
- [v1.2.1 交付计划](../v1.2.1/V121-DELIVERY-PLAN.md)（前置里程碑 M0–M7 与发布门禁）
- [v1.1 共享 UI 架构](../v1.1/V11-SHARED-UI-ARCHITECTURE.md)（边界规则与 Stage 1–5 迁移历史）
