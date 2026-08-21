# Musefold v1.3 迁移计划

> **状态**：Phase 0、Phase 1、STATE-01~03 与 ORCH-01~04 已完成；SPLIT-01 已完成；SPLIT-02 起继续
>
> **日期**：2026-08-21
>
> **总原则**：每张任务卡独立合并、独立可回滚；先立规则后搬代码（棘轮 baseline 只减不增）；类型切换即删旧引用，不留兼容 re-export；不改变任何用户可见行为

前置条件已满足：v1.2.2 Phase 0–3 全部落地（depcruise 0 违规、桌面 E2E 222 例、视觉门禁在用）。v1.3 不动发布链路，不依赖 v1.2.1 外部 evidence 门禁；每卡回归安全网 = 全仓 `check` + `check:v1.1` + 桌面 E2E + 共享视觉门禁。

## 0. 交付原则（沿用并增补）

1. **CI/CD 是安全网**。每卡必跑 v1.2.1/v1.2.2 交付的门禁；安全网红时不开下一卡。
2. **规则先行**。GOV 卡（尺寸/feature 隔离/行模型禁令）先于对应搬代码卡上线，baseline 冻结存量，只减不增。
3. **切换即删除**。行类型、服务端 store 面、编排重复段在切换卡内一并删除，防止新旧并存漂移。
4. **共享层最小增量**。product-ui 只新增 `@tanstack/react-query` 一个外部依赖；page-controllers 只依赖 domain 端口与注入服务。
5. **机械步骤与逻辑步骤分离**。拆文件的第一步是零逻辑变更的移动提交（便于 review 与 `git log --follow`），行为修改另开提交。

## 1. 阶段总览

| 阶段 | 内容 | 开工条件 | 相对规模 |
|---|---|---|---|
| Phase 0 治理地基 | GOV-01~04：尺寸棘轮、feature 隔离、命名统一、ipc/preload 分域 | 随时（纯仓库侧） | 小 |
| Phase 1 实体统一 | ENT-01~04：行模型止血、history/library/account→workbench 逐域文档化、models 收缩 | Phase 0 的 GOV-01/02 已上线 | **已完成（2026-08-21）** |
| Phase 2 状态与编排 | STATE-01~03 + ORCH-01~04：Query 引入与读路径迁移；page-controllers 下沉、App.tsx 拆解、共享导航配置 | ENT-02/03 完成后编排 hook 才有统一实体可操作；STATE-01 先于全部 ORCH 卡 | **已完成（2026-08-21）**：服务端镜像字段清零留给 SPLIT-03 |
| Phase 3 拆分与复用 | SPLIT-01~04 + REUSE-01~03：工作台拆分与上提、巨型文件消化、互导清零 | STATE/ORCH 主卡完成（新结构就位） | 大 |

卡间依赖细目：ENT-01 → ENT-02~04；STATE-01 → ORCH-01~04；ORCH-02/03 ↔ ENT-02/03（同域类型与编排可同批）；SPLIT-02 依赖 SPLIT-01；REUSE-03 依赖 REUSE-01。

## 2. Phase 0：治理地基

### 任务

- `V13-GOV-01`：~~ESLint `max-lines-per-file` 上线（warn 600 / error 1200，作用域：全部 `apps/*/src`、`packages/*/src`、`apps/desktop/electron` 生产代码）。以 baseline 文件登记存量超标清单（实测约 15 个：`GenerationWorkbench.tsx`、`workbench/store.ts`、`SchemeRuntimeDetail.tsx`、`OnboardingFlow.tsx`、`AccountSection.tsx`、`browser-service.ts`、`extended-primitives.tsx` 等），清单内文件 warn、清单外文件 error；清单只减不增。~~ **已完成（2026-08-21）**。实测超标 23 个（含 web-api 2 个、core 2 个），全量登记进 `tooling/file-size-baseline.json`。

  **裁定（实现形态与原卡的差异）**：ESLint 没有名为 `max-lines-per-file` 的内建规则，采用内建 `max-lines`（语义等同）；且 ESLint 同一规则无法同时配置 warn 600 与 error 1200 两档。落地为双层：ESLint `max-lines` warn 600（非 baseline 文件，编辑器即时反馈）+ `tests/repo/file-size-ratchet.test.ts` 作为 CI 硬门禁（三条断言：未登记超标即失败、登记上限不可超越、失效条目必须移除——比原卡双阈值更严，新文件即受 600 行约束）。

  验证：repo 守卫 3 条 + 全部 repo 测试 18 条通过；探针 601 行文件先红（未登记超标报错）后绿；baseline 文件 ESLint 静音确认、611 行新文件 warn 确认；全仓 `tsc -b` 通过。✅
  回滚：revert 规则提交；baseline 文件独立于规则文件。

- `V13-GOV-02`：~~depcruise 新规则 `renderer-features-isolated`：`apps/desktop/src/features/<a>/**` 禁止 import `features/<b>/**`（`__tests__` 豁免）。存量 26+ 违规进 `dependency-cruiser-known-violations.json`，只减不增。~~ **已完成（2026-08-21）**。

  **裁定（实现形态）**：depcruise 静态正则无法表达「from 与 to 分属不同 feature」的互斥，按 feature 目录在配置加载时 readdir 动态生成 N 条规则（`renderer-features-isolated-<feature>`，to 侧负向前瞻排除自身）；新增 feature 自动纳入约束。存量违规实测 **69 条边**（原卡「26+ 文件」为文件口径，边口径更细），全量进 baseline。

  验证：`check:boundaries` 通过（69 known ignored）；探针（onboarding store import library store）先红（`renderer-features-isolated-onboarding` error）后绿。✅
  回滚：revert 规则提交。

- `V13-GOV-03`：~~store 命名与目录统一：feature store 统一 `store.ts`（`doubao-store.ts`→`account/store.ts` 内域、`creationStore.ts`/`runStore.ts`/`skillRuntimeStore.ts` 归位命名）；settings `sections/` 归并入 `components/`（13 个 section 组件改名迁入）；`store-persist-only` ESLint 规则以关闭状态预置（按 STATE-03 分批启用）。~~ **已完成（2026-08-21）**。`creationStore.ts`→`creation-store.ts`、`runStore.ts`→`run-store.ts`、`skillRuntimeStore.ts`→`skill-runtime-store.ts`（kebab-case 统一；主 store 已是 `store.ts`，doubao/ai-connection/cloud-connections 已合规）；settings 13 个 section 组件 `git mv` 入 `components/`、`sections/` 删除；`store-persist-only` 以 off 预置（selector 锁 `localStorage.{get,set,remove}Item`，STATE-03 启用）。文件尺寸 baseline 与 depcruise baseline 路径同步（69 条不变）。

  **裁定**：纯移动 + import 改写提交，不改任何 store 逻辑。

  验证：全仓 `tsc -b`、`check:boundaries`（69 known）、repo 测试 18、settings+design-schemes feature 测试 29 全绿。✅
  回滚：revert 移动提交。

- `V13-GOV-04`：~~`desktop-contracts/src/ipc.ts` 拆为 `ipc/` 域模块（prompt/history/workbench/account/generation/system/…），`Api` 聚合类型与子路径导出面不变（消费方零改动）；`preload/index.ts` 按域拆组装模块，仍单次 `contextBridge.exposeInMainWorld` 单对象暴露。~~ **已完成（2026-08-21）**。`ipc.ts`（1,031 行）拆为 `ipc/{channels,prompt,history,workbench,generation,account,system,automation,share,misc,api,index}.ts`，原路径保留为 barrel（包 exports `./*` 通配与全部 `@musefold/desktop-contracts/ipc` 子路径消费方零改动）；`preload/index.ts`（616 行）拆为 `preload/api/{prompt,skill-runtime,design-scheme,generation,workbench,history,share,system,automation,account,misc}.ts`，index 收缩至 ~80 行（origin 迁移 + 组合 + 单次 expose）。两文件退出尺寸 baseline（23→21 条，棘轮收紧）。

  **裁定**：Api 按域抽为独立 namespace 接口（`PromptApi`、`HistoryApi` 等）再组合，形状与拆分前逐字段一致；不引入代码生成（D7）。

  验证：全仓 `tsc -b`、desktop-contracts 测试 22、`workspace-bundling` preload 断言 2、全仓 build（含 electron-vite preload bundle）、全量 vitest 181 files / 1,042 tests 通过；桌面 E2E 222 例随后台门禁执行。✅
  回滚：revert 拆分提交（聚合类型不变，无级联）。

### 完成条件

- 四条规则/约定上线且 CI 生效；baseline 登记完成、无新增豁免；全部门禁绿。

## 3. Phase 1：实体统一（ENT-A）

### 任务

- `V13-ENT-01`：~~depcruise 新规则 `renderer-row-models-banned`：`apps/desktop/src/{features,components,pages,stores,lib}/**` 禁止 import `@musefold/desktop-contracts` 行模型（`models` 及 re-export 它的子路径）。例外：`runtime/mappers/**`、`runtime/desktop-gateway.ts`、`__tests__`。存量引用进 baseline。~~ **已完成（2026-08-21）**。作用域补齐 `pet/`、`preview/` 两个渲染层目录；实测存量 **26 条边**（37 个文件中扣除 mappers/runtime/测试豁免），进 baseline（总计 95 条）。行模型泄漏自此冻结，新增即 CI 红。

  验证：探针（onboarding store import models）先红（`renderer-row-models-banned` error）后绿；repo 测试 18 通过。✅
  回滚：revert 规则提交。

- `V13-ENT-02`：~~history 域文档化。`DesktopExtras` history 面签名从 `HistoryRecord` 改为 `DesktopGenerationEntry`；`mappers/history.ts` 扩展承接 extras 面；`features/history/store.ts` 与 `HistoryDetail` 类型切换；行模型引用在本域清零。~~ **已完成（2026-08-21）**。新增 `packages/desktop-contracts/src/history-documents.ts`；extras 的 `listHistory` / `getHistory` / `relatedHistory` 经 mapper 返回文档形状；history store / 列表 / 详情 / 微调链 / 关联作品 / 方案来源选择器全部改用 `DesktopGenerationEntry`。`renderer-row-models-banned` 从 26 条边降到 13 条（history 域 + `promptParams`/`format` 清零）。

  **裁定（相对原卡的差异）**：
  1. **组合类型保留无损桌面字段**，而不是架构草稿里的三字段交集。`DesktopGenerationEntry extends GenerationJob` 另保留 `providerId` / `imagePath` / `cost` / `costUnit` / `params` / `createdAtMs` / 原始错误码 / `promptReferences` / `promptRelations`。丢掉这些会改变封面、成本、多图参数与关联作品文案。云契约无槽位的字段放扩展面，不平行再造一套历史模型。
  2. **`HistoryDetail` 不整文件搬进 product-ui**。共享呈现已是 `GenerationHistoryDetailContent` / `Actions` / `InspectorPanel`；桌面 `HistoryDetail` 是宿主适配器（reveal 文件、存为提示词、微调链、工作台回填）。整文件下沉会把 IPC/toast/workbench store 带进 product-ui，违反平台中立。编排薄挂载留给 ORCH-02。
  3. **查询面仍用桌面词表**：`listHistory({ status: 'success' })` 的 IPC 枚举不变；store 把 UI 的 `succeeded` 映射回 `success`。`historyStatusMeta` 同时接受 `success` 以免漏网行状态显示成失败。
  4. **`PromptParams` 迁到 `generation-snapshots`**，渲染层可安全引用生成参数包，不再经 `models`。
  5. **models 对 HistoryStats / PromptHistoryRelation 保留 re-export**，供 core / 主进程 / ipc 传输签名继续单点导入；渲染层由 depcruise 禁止 `models`。这不是给 UI 的兼容层。

  验证：全仓 `tsc -b`；vitest 181 files / 1045 tests；history/mapper/gateway/domain 定向 61；`check:boundaries` 825 modules / 0 新违规 / 82 known（行模型 13）；桌面历史 E2E `test_06_history.py` 15 passed。
  回滚：单卡 revert（类型面局部）。

- `V13-ENT-03`：~~library + account 域文档化。~~ **已完成（2026-08-21）**。新增 `packages/desktop-contracts/src/library-documents.ts`；extras 的 list/get/create/togglePin/listDeleted 经 mapper 返回 `DesktopLibraryPrompt`（`PromptDocument` + 封面路径 + epoch 便捷字段 + `contentNegative` + 桌面 `PromptParams`）。library store / 编辑器 / 详情 / 列表 / 笺 / 分享 / 工作台引用选择器全部改用文档形状。`renderer-row-models-banned` 从 13 条边降到 3 条（仅剩 ProviderConfig：generation store / ProviderDialog / ProvidersSection，留给 ENT-04）。`SearchHistoryItem` / `LibraryQuerySnapshot` 迁出 models，渲染层从 library-documents 导入。

  **裁定（相对原卡的差异）**：
  1. **组合类型保留无损桌面字段**，不是草稿里的单字段 `previewImagePath?`。丢掉 `coverImagePath` 会让列表封面空白；丢掉 epoch 便捷字段会让 `formatTime` 把 ISO 串当成 Invalid Date。
  2. **create 仍接受 `NewPrompt`**（含 `previewImagePath`），结果映射为文档。IPC 写面不变。
  3. **AccountStatus 不合成 AccountSession**。`AccountSession` 无法表达未登录，且会丢掉 `health` / `notices` / `deviceTokenSuffix` / `serverUrl` / `estImagesRemaining`（GW-05 已裁定走 extras 直通）。AccountStatus 本就不是 SQLite 行，account store 无 models 引用。cloudSync 同理。
  4. **source 词表跟云契约**：`shared`→`share`；SOURCE_LABEL 补 `generation`。筛选查询面仍用桌面 `PromptSource`（含 `slip`）。

  验证：全仓 `tsc -b`；vitest 181 files / 1046 tests；`check:boundaries` 826 modules / 0 新违规 / 72 known（行模型 3）；桌面 `test_02_library.py` + `test_06_history.py` 36 passed。
  回滚：单卡 revert。

- `V13-ENT-04`：~~workbench 域收尾与 `models.ts` 收缩。~~ **已完成（2026-08-21）**。`ProviderConfig` / `NewProviderConfig` / 定价类型从 `models.ts` 迁到 `providers.ts`（与 `ImageProvider` 同文件）；渲染层 generation/settings 从 `providers` 导入。workbench extras 本已返回 `WorkbenchSessionDocument`，无需二次映射。`renderer-row-models-banned` baseline 3→0；规则本已是 error，移出豁免后新增泄漏即 CI 红。`models.ts` 仅剩 Prompt/Folder/Tag/HistoryRecord 等存储行，并对迁出类型保留 core/主进程/ipc 用的 re-export。

  **裁定（相对原卡的差异）**：
  1. **不包一层 `DesktopProviderDocument`**。`ProviderConfig` 已是 UI 使用的无损配置形状（无明文 key），与 SQLite 行同形；再包一层只会复制字段。迁文件即完成「渲染层不碰 models」。
  2. **workbench 不重做会话形状**。`listDesktopWorkbenchSessions` / `getDesktopWorkbenchSession` 已是文档面；本卡只收口 Provider 泄漏。
  3. **models 对 ProviderConfig 保留 re-export**，供 core / 主进程 / ipc / preload 继续单点导入（与 ENT-02/03 同一口径）。这不是给 UI 的兼容层。

  验证：全仓 `tsc -b`；vitest 181 files / 1046 tests；`check:boundaries` 826 modules / 0 新违规 / 69 known（行模型 0）；桌面 `test_04_generate.py` + `test_05_settings.py` + `test_08_generation_workbench.py` + `test_02_library.py` + `test_06_history.py` 133 passed。
  回滚：单卡 revert；ENT-04 是收口卡，revert 需连同所依赖卡的类型面一起评估。

### 完成条件

- 渲染层与 product-ui 中 `desktop-contracts` 行模型 import 为 0（depcruise error 强制）；`DesktopExtras` 全部签名只引用 contracts 形状 + 组合扩展；SQLite schema 零变更。

## 4. Phase 2：状态与编排

### 任务

- `V13-STATE-01`：~~引入 TanStack Query。~~ **已完成（2026-08-21）**。`@tanstack/react-query@^5.101.4` 写入 product-ui + 双宿主；`createMusefoldQueryClient()` 单点配置（staleTime 30s、query retry 1、mutation retry 0、关闭 window-focus/reconnect 自动重拉）；桌面 `main.tsx` 与 Web `main.tsx` 各自实例化并套 `QueryClientProvider`。depcruise `product-ui-query-allowed` 禁止再引入 SWR/Redux/Zustand 等第二套查询库。本卡无读路径迁移。

  **裁定**：Query 默认偏保守——桌面窗口焦点频繁，默认 `refetchOnWindowFocus` 会把 IPC 打成风暴并让 E2E 抖动。失效约定以 `musefoldQueryKeys.<domain>.all` 前缀预埋，细粒度 key 留给 STATE-02。

  验证：全仓 `tsc -b`；vitest 184 files / 1051 tests；`check:boundaries` 830 modules / 0 新违规 / 69 known；Web 单测 15；桌面 `test_00_harness.py` + `test_02_library.py` 27 passed；`build:web` 通过。
  回滚：revert（无行为变化）。

- `V13-STATE-02`：~~history/library/account 读路径 query 化。~~ **已完成（2026-08-21）**。桌面 history 列表/统计、library 列表/统计/回收站、account 状态写入 TanStack Query；history store 去掉 `records/loading/error/stats` 镜像；`desktopQueryClient` 模块单例供非 React 调用方 `setQueryData` / `invalidateQueries`。

  **裁定（相对原卡的差异）**：
  1. **Query key 用筛选快照，禁止把 `resolveDateRange(Date.now())` 写进 key。** 默认「近 30 天」的 from/to 每毫秒都变，写进 key 会导致每帧新查询、列表闪空、详情本地态（删除确认 / 存为提示词 / 灯箱）被卸掉。IPC 仍在 `queryFn` 里解析日期。
  2. **成本看板 `staleTime: 0` 且打开时 refetch**，对齐旧 `loadStats(open)`。进程外写库（E2E `insert_history`）后再打开不能吃 30s 空缓存。
  3. **写操作仍走 store action + 精确失效**，不在本卡改 `useMutation`。`workbench/store.ts`（1932 行棘轮顶格）与 DataSection 是非 React 调用方，仍用 `history.load()` 作为 `invalidateQueries` 别名；React 侧再包一层 mutation 与现有 action 重复。ORCH/SPLIT 再收口。
  4. **Web `App.tsx` 读路径不改**（1201 行棘轮），与 ORCH-02 同批。
  5. **`AccountSection.tsx`（855 行）仍读 `store.status`**，避免涨行；`initialize` / `onAccountChanged` 双写 query cache，`useAccountStatusQuery` 已就位供编排层挂载。
  6. **library `store.prompts` 保留为写缓冲**（乐观删除/置顶），列表同时 `setQueryData`；`library/store.ts` 必须 < 600 行。

  验证：全仓 `tsc -b`；vitest 184 files / 1052 tests；`check:boundaries` 834 modules / 0 新违规 / 69 known；桌面 `test_00_harness.py` + `test_02_library.py` + `test_06_history.py` 42 passed。✅
  回滚：revert 本卡提交。

- `V13-STATE-03`：~~持久化统一与写面收尾。~~ **已完成（2026-08-21）**。`stores/app.ts`、`settings/store.ts`、`onboarding/store.ts` 改为 zustand `persist`（版本化 key + migrate）；旧手写 key（主题/密度/动效/默认 Provider/引导哨兵/账号图源）启动时读取、首次写入后清除。`store-persist-only`（`no-restricted-syntax`）对 store glob 从 off 改为 error。

  **裁定（相对原卡的差异）**：
  1. **同步读新 key 再 persist 水合**，避免刷新时主题/密度闪回默认值。适配器每次现取 `localStorage`，不闭包模块加载时的 Storage 对象（测试 stub / 损坏的 jsdom 会把 `createJSONStorage` 打成 `setItem is not a function`）。
  2. **工作台 `draftController` 偏好与 session pins 仍走 helper**，它们不在 store glob 内；本卡只锁 `stores/**` 与 `**/store.ts` / `**/*-store.ts`。
  3. **写面 `useMutation` 仍不在本卡落地**（沿用 STATE-02 裁定 3：workbench/DataSection 非 React 调用方 + 棘轮顶格）。ORCH/SPLIT 再收口。

  验证：全仓 `tsc -b`；vitest 186 files / 1061 tests；store glob eslint `--max-warnings=0`；`check:boundaries` 841 modules / 69 known；桌面 `test_00_harness.py` + 外观持久化 + 密度列表 + `test_07_onboarding.py` 13 passed。✅
  回滚：revert 本卡提交（旧 key 读取路径仍在 migrate 里，回滚后旧安装不受影响）。

- `V13-ORCH-01`：~~page-controllers 骨架 + `PlatformServices` 填充。~~ **已完成（2026-08-21）**。domain `PlatformServices` 填入 toast / writeClipboard / download / openExternal；桌面 `createDesktopPlatformServices`（toast store + clipboard + 本地 `saveImage` / http `<a download>`），Web `createWebPlatformServices`（aria-live + 浏览器 API）。`useHistoryPageController` / `useLibraryPageController` / `useGeneratePageController` 骨架签名为显式 `deps`，禁止 Context。product-ui 增加 `@musefold/domain` 依赖。

  **裁定（相对原卡的差异）**：
  1. **PlatformServices 不并入 WebGateway / DesktopGateway。** GW-01 把它算作「六端口」之一是因为当时是空接口、任何实现都 satisfies。填入 toast 后若挂在 HTTP gateway 上，会强迫 Fixture/Http 实现 UI 副作用。编排 hook 的 `deps: { 端口…; platform }` 本就把平台能力与数据端口分开。数据端口仍是 5 个（Prompt/Workbench/Generation/History/Account）。
  2. **本卡不改 Web `App.tsx` / 桌面 pages**（1201/棘轮），避免骨架卡去拆编排。ORCH-02 才薄挂载。
  3. **download 对 http(s)/blob 走 `<a download>`，桌面本地路径走 `system.saveImage`。** 不把 IPC 形状写进 domain。

  验证：全仓 `tsc -b`；vitest 189 files / 1065 tests；`check:boundaries` 850 modules / 69 known；host-boundary 双端断言 + page-controllers 中立性扫描。✅
  回滚：revert 本卡提交。

- `V13-ORCH-02`：~~history + library 页面编排下沉。~~ **已完成（2026-08-21）**。`useHistoryPageController` / `useLibraryPageController` 落地（Query 取数、选中/检视、软删恢复、搜索防抖、剪贴板经 `platform.writeClipboard`）。Web `HistoryView` / `PromptLibraryView` 改为调 controller；`App.tsx` 拆除 history/library 回调编排，只留跨页（`onUse` / `onReuse` / 工作台 job 同步）与 Query 水合。桌面 `HistoryPage` / `LibraryPage` 薄挂载同一 hook，经 `listFn` 注入 extras 列表（不把 desktop-contracts 泄入 product-ui）。

  **裁定（相对原卡的差异）**：
  1. **桌面 extras 列表用 `listFn` + `listKey` 注入，而不是 `HistoryGateway & DesktopHistoryExtrasLike`。** product-ui 禁止 desktop-contracts；桌面 `listHistory` 返回 `DesktopGenerationEntry[]`（裸数组），Web `listGenerationHistory` 返回 `{ items, nextCursor }`。控制器按缓存实际形状读写（`upsertListCache` / `dropListCache`），禁止把 page 对象写进桌面数组 key（会打坏 STATE-02 `cachedHistoryRecords`）。
  2. **桌面 feature store 的写面（remove/retry/createPrompt 等）本卡不删。** workbench/store.ts（1932）与 DataSection / 命令面板 / 笺匣仍经 `useHistoryStore.getState().load()` 与 `useLibraryStore` 写路径；删掉会逼棘轮顶格文件扩 import。ORCH-03 / SPLIT-03 再迁。
  3. **Web 生成页仍 `useQuery` 默认提示词列表**（`WEB_LIBRARY_LIST_KEY`），供草稿引用回填；这不是 library 页编排，随 ORCH-03 进 generate controller。
  4. **搜索防抖 220ms 保持 Web 原值**（与 `PromptLibraryView` 原 `onSearch` 一致）；桌面搜索仍走 library store 已有 150ms 防抖，`listKey` 由宿主传入。
  5. **动作失败不在 controller 内 toast**，避免 Web 从行内 error 变成 live region。宿主既有错误 UI 不变。

  验证：全仓 `tsc -b`；vitest 190 files / 1072 tests；`check:boundaries` 853 modules / 69 known；`App.tsx` 1201 → 1092；Web E2E workspace history/library；桌面 E2E harness+library+history。
  回滚：revert 本卡提交。

- `V13-ORCH-03`：~~generate/workbench 编排收敛 + Web `App.tsx` 拆解完成。~~ **已完成（2026-08-21）**。`useGeneratePageController` 落地（会话 Query、草稿入口、生成提交/取消/重试/存提示词、跨页 reuse）。Web `App.tsx` 1092 → ≤300：视图切换 + 薄 view + 登录/审批 screens + Provider 装配。桌面 `GeneratePage` 挂载同一 hook（`listEnabled: false`）。

  **裁定（相对原卡的差异）**：
  1. **桌面不在本卡改 workbench/store.ts（1932 顶格）。** 共享 `WorkbenchGateway.updateWorkbenchSession` / `GenerationGateway.createGeneration` 在桌面未实现（草稿在渲染层、生成走 extras）。本卡只把 GeneratePage 顶层挂载对齐，会话镜像消费留给 SPLIT-03，避免 Generate 页多打一轮 IPC。
  2. **会话列表进 Query**（`musefoldQueryKeys.workbench.list`，默认 `{ limit: 20 }`）。Web 登录后 `listEnabled`，水合后再 enable。写后 `setQueryData` + `void invalidate()`，不 await。
  3. **product-ui 不 import contracts**，会话/任务类型从 gateway `ReturnType` 推断。composer→请求走 domain `composerToGenerationRequest`。
  4. **Web 专有登录/审批/MCP 连接留在宿主 screens**，controller 只管工作台会话/草稿/提交。动作失败不 toast，Web 行内 `actionError`。
  5. **桌面 feature store 写面不删**（ORCH-02 裁定延续）。

  验证：全仓 `tsc -b`；vitest 191 files / 1079 tests；`check:boundaries` 862 modules / 69 known；`App.tsx` 1092 → 258；Web E2E workspace 11；桌面 harness+generate+workbench 58。
  回滚：按端分卡 revert。

- `V13-ORCH-04`：~~共享导航配置与命令路由（v1.2.2 迁移计划 §6 预埋候选）。双端视图清单、快捷键、命令面板项的声明式配置收敛 domain/product-ui，宿主只注册差异项。~~ **已完成（2026-08-21）**。`packages/domain/src/navigation-catalog.ts` 持有侧栏清单、快捷键、命令面板静态项；product-ui `buildSidebarNavItems` / `productCommandIcon` 装配图标与主题文案。桌面 Sidebar / CommandPalette / AboutSection 与 Web 侧栏/顶栏标题消费同一份目录；宿主只绑定 `run`（Skill 草稿、设置分区、主题/侧栏）以及会话/提示词检索命中。

  **裁定**：
  1. **Web 提示词库侧栏 id 保持 `prompts`**（E2E `nav-prompts`），语义 id 为 `library`；不统一成 desktop 的 `library`。
  2. **本卡不给 Web 加命令面板**。命令目录 `hosts: desktop`；Web 只消费侧栏/标题/快捷键展示形状。
  3. **设置分区闸门仍留桌面 `SETTINGS_SECTION_CAPABILITY`**，不进导航目录。
  4. **命令面板的会话/提示词命中仍由宿主注入**（运行时检索，不是声明式配置）。
  5. **文案、快捷键、testid 不变**。⌘K / ⌘N 监听抽到 `matchProductModifierShortcut`，F / Enter 仍只出现在关于页。

  验证：domain/product-ui 单测；桌面 capabilities / navigation-routing / host-boundary；命令面板 E2E + 导航回归。
  回滚：单卡 revert。

### 完成条件

- Web `App.tsx` ≤ 300 行；桌面 pages 均为薄挂载；page-controllers 覆盖 history/library/generate 三面且双端共用；共享导航/命令目录落地；持久化全走 persist middleware。store 中服务端镜像字段清零交给 SPLIT-03。

## 5. Phase 3：拆分与复用

### 任务

- `V13-SPLIT-01`：~~`GenerationWorkbench.tsx` 机械拆分：14 个内联组件按[架构文档 6.1](./V13-ARCHITECTURE.md) 边界拆为独立文件，**零逻辑变更**（纯移动 + import/props 透传修正）。~~ **已完成（2026-08-21）**。内联组件迁到 `features/generation/workbench/` 同级文件；`WorkbenchComposer` 因超过 600 行再拆为 store hook / 编排 / chrome / view。`GenerationWorkbench.tsx` 退出尺寸 baseline（2932 → 组合层）。上提 product-ui 留给 SPLIT-02。

  **裁定**：
  1. **本卡不把 widget 上提 product-ui**（SPLIT-02）。先落在桌面 workbench 目录，保持 IPC/store 依赖原地。
  2. **新文件一律 ≤ 600**。TurnView 抽出 `GenerationTurnUserAttachments`；Composer 抽出 `useWorkbenchComposerStore` + `WorkbenchComposerChrome` + `WorkbenchComposerView`。
  3. **源码契约测试改为扫描 workbench 目录**，不断言单一巨型文件。
  4. **跨 feature 导入集中到 `workbenchCrossFeature.ts`**，known-violations 的 from 从 `GenerationWorkbench.tsx` 平移到该桥接文件（边数不变）。拆文件不得把同一条边复制成多条新违规。
  5. **视觉 QA 的 library 列表不再注入 zustand**（读面已在 ORCH-02 改走 Query）；改为 `loadAll` 后等待已创建条目的 `data-prompt-id`。

  验证：typecheck/test；工作台 E2E；视觉门禁。
  回滚：revert 移动提交。

- `V13-SPLIT-02`：widget 上提 product-ui：timeline/turn-view/result-card/draft-preview 及 composer 拆分件中纯产品 UI 部分迁入 `product-ui/workbench/`；桌面语义段（额度兑换、Skill/Scheme 采集、本地附件）留桌面经插槽组合；Web 工作台视图升级为共享 widget 直拼（REUSE-02 的一半）。

  **裁定**：上提判定规则——组件只依赖 contracts/domain 类型与回调 → 上提；依赖 desktop-contracts/IPC/本地文件 → 留桌面。灰区组件留桌面，出现第二个宿主消费者时再上提。

  验证：双端 E2E；视觉门禁（共享面双端同像素）。
  回滚：按 widget 分卡 revert。

- `V13-SPLIT-03`：workbench store 窄化：会话列表/运行态等服务端镜像移交 page controller + Query；`account/doubao-store`、`history/store` 跨域依赖改经编排层取数（feature 互导 baseline 相应缩减）；`WorkbenchState` 目标 ≤ 40 成员、store ≤ 500 行。

  验证：工作台 E2E 全量；`check:boundaries`。
  回滚：单卡 revert。

- `V13-SPLIT-04`：其余巨型文件：`SchemeRuntimeDetail.tsx` 按详情段落拆组件；`OnboardingFlow.tsx` 按步骤拆；`AccountSection.tsx` 拆 section 子组件并复用 product-ui account 面；`max-lines` baseline 相应缩减。

  验证：对应域 E2E；视觉门禁。
  回滚：按文件分卡 revert。

- `V13-REUSE-01`：feature 耦合裁定与消除：design-schemes×6 处 `generation/workbench` 深入导入逐条裁定（下沉共享类型到 domain/contracts、经编排层取数，或合并 feature）；settings×9 处同理。

  **裁定**：合并 feature 仅在「业务上不可分」时采用；默认路径是下沉与编排层解耦。

  验证：`renderer-features-isolated` baseline 下降；对应 E2E。
  回滚：单条 revert。

- `V13-REUSE-02`：Web 工作台共享面验收：Web generate 视图由 product-ui widget 组合完成，桌面扩展经插槽注入；记录「同一 widget 双端复用」清单进本卡（复用频率的过程度量）。

  验证：Web E2E + 共享视觉门禁。
  回滚：Web 视图可独立回退旧组合。

- `V13-REUSE-03`：边界清零收口：`renderer-features-isolated` 与 `renderer-row-models-banned` baseline 归零、规则升 error；`max-lines` baseline 缩减至尾部清单（或清零）；补 `tests/repo/` 守卫测试锁三类回潮（互导、行模型上浮、超大文件）。

  验证：`check:boundaries` 0 违规；全部门禁。
  回滚：收口卡为规则提升，revert 需评估。

### 完成条件

- `GenerationWorkbench.tsx` ≤ 400 行（组合层）；`workbench/store.ts` ≤ 500 行；feature 互导 0；product-ui 消费方数量较基线上升（复用频率提升的度量）。

## 6. 发布门禁

以下门禁在 v1.3 视为完成的前提，缺一不可：

1. 新增 depcruise/ESLint 规则全部上线且 baseline 只减不增；REUSE-03 收口后 baseline 归零。
2. 渲染层与 product-ui 无 `desktop-contracts` 行模型 import；`DesktopExtras` 签名全部文档形状 + 组合扩展。
3. Web `App.tsx` ≤ 300 行；桌面 pages 薄挂载；page-controllers 双端共用。
4. store 无服务端镜像字段；持久化统一 persist middleware。
5. 巨型文件清单消化至目标行数；`max-lines` 棘轮在 CI 生效。
6. 桌面 E2E、Web E2E、共享视觉门禁、`check`、`check:v1.1` 全绿。
7. `docs/README.md` 权威序更新，v1.2.2 相关节加接棒注记；`README.md` 文档入口更新。

## 7. 风险与回滚

| 风险 | 缓解 | 回滚 |
|---|---|---|
| ENT 逐域切换期间形状并存混淆 | 切换即删除；depcruise 止血规则先行 | 单域卡 revert |
| Query 改变刷新时序导致 E2E 抖动 | 配置单点统一 retry/staleTime；按域迁移 | 按域卡 revert |
| 编排 hook 下沉后隐式平台依赖漏网 | 显式 deps 注入、禁 Context 隐式；host-boundary 测试 | 骨架卡可整体 revert |
| 工作台拆分行为回归 | SPLIT-01 零逻辑变更 + 视觉门禁像素比对 | revert 移动提交 |
| 棘轮与日常开发冲突 | baseline 只登记存量，新文件才受 error 约束 | 规则提交独立 revert |
| design-schemes/generation 裁定合并造成目录大迁移 | REUSE-01 先裁定后动手；合并是最后选项 | 纯移动提交可 revert |

## 8. 相关文档

- [系统架构](./V13-ARCHITECTURE.md)
- [技术选型与决策](./V13-TECHNOLOGY-DECISIONS.md)
- [v1.2.2 迁移计划](../v1.2.2/V122-MIGRATION-PLAN.md)（其第 6 节 v1.3+ 候选由本计划接棒）
