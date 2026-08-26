# Musefold 2.0 Web 账号对齐、响应式收敛与 CI/CD 部署交付计划

> **状态**：`WF-00`、`WF-01` 已完成（2026-08-26）；其余 13 张卡未开始。状态列只登记事实与交付时登记的验收数字，本文件不追加任何未执行的测试声明。
>
> **日期**：2026-08-26（WF-01 验收返工修订：卡片清单、排除项与 ACC/CI 卡内容按批准范围修正）
>
> **范围**：Web 账号对齐（ACC，全栈卡）、双端响应式收敛（UI/QA）、CI/CD 部署交付（CI/REL）三个主题的执行卡片登记处。视觉与交互依据是 [ui-design](./ui-design/README.md) 各页文件，本文件只回答「谁、按什么顺序、改哪些文件、按什么层级验收、现在到哪一步」。
>
> **读法**：卡片格式参照 [v1.4 交付计划](../v1.4/V14-DELIVERY-PLAN.md)。方向问题回 `ui-design/07-overlays-onboarding-responsive.md` 等页面文件，流水线语义回 [v1.2.1 CI/CD](../v1.2.1/V121-DELIVERY-PLAN.md)，本文件不重复页面级设计细节。

## 0. 已确认范围（2026-08-26 冻结，WF-01 验收修订版）

1. **断点语义冻结**：`760px = compact shell`（侧栏 drawer、Dock 关闭、MainView 单列，仍是桌面指针/键盘交互模型的紧凑形态）；`680px = phone / 触控 / 键盘`（触控目标、软键盘 inset、safe-area、底部 Composer 从这一档生效）；`390px` 为手机基准宽度。已写入 `ui-design/07` §12 断点语义块。
2. **Prompt 手机形态**：查看与编辑使用**全页子状态**（page sub-state），不使用 bottom sheet。已写入 `ui-design/07` §12.2 / §26。
3. **History 手机形态**：详情使用 **bottom sheet**，不做成全页。已写入 `ui-design/07` §12.2 / §26。
4. **大屏几何共享**：大于 760px 的视口（含 Web 大屏）与桌面共享同一套 shell 几何（Sidebar / MainView / Dock 比例、圆角、间距 token）；平台差异只按 **capability** 保留（hover、键盘快捷键、触控目标、滚动条、安全区），不按端复制第二套布局。
5. **账号对齐是全栈卡**：`packages/contracts`、`packages/domain`、`packages/cloud-client`、桌面 account mapper（`apps/desktop/src/runtime/mappers/account.ts`）、`apps/web-api` 账号模块测试与 OpenAPI 同步**允许并要求**随卡改动（见 ACC-01）；不设「后端不动」限制。
6. **Web 账号闭环**：登录**与注册**双闭环（ACC-02）；账号数据走 TanStack Query、额度以服务端为唯一真值并在**生图终态刷新**（ACC-03）；兑换码在 Web 提供入口，双端账号表面统一为共享组件（ACC-04）。
7. **CI/CD**：先恢复现有远端 CI 绿灯（CI-01），再做生产门禁加固——相关路径的 Web E2E / 共享视觉 / OpenAPI / Postgres 集成门禁、多提交 range 漏层修复、手动部署只准已通过 CI 的 main SHA（CI-02）；最终本地门禁与视觉验收（REL-01）后执行生产部署与冒烟（REL-02）。

## 1. 明确排除

| 排除项 | 说明 |
| --- | --- |
| 桌面宿主能力 | Electron 主进程行为、IPC 语义、utilityProcess 拆分、SQLite schema 等宿主专属改造不在卡内；AGENTS.md 登记的架构欠账保持现状 |
| 桌面不存在的新账号功能 | 只把桌面已有的账号能力（登录、会话、额度、兑换）对齐到 Web，不发明桌面没有的账号功能 |
| 桌面安装包 | 不构建、不发布桌面安装产物；`apps/desktop/package.json` 的 `version` 遵循 AGENTS.md 红线由发布流程统一管理，卡内不动 |

## 2. 交付原则

1. **文档先行，代码分批**：断点语义与形态决策先冻结在 `ui-design/07`（`WF-01` 已完成），实现卡不得偏离；执行中发现设计矛盾时，先修文档再动代码。
2. **共享层单点**：断点值、几何与账号表面一律落在 `packages/product-ui` / `packages/ui`；`apps/web` 只保留宿主胶水（`PRODUCT_MOBILE_BREAKPOINT` 所在的 680px 块、`pointer: coarse`、safe-area），桌面只保留 Electron 专属能力。
3. **契约单一事实源**：账号实体形状只在 `packages/contracts` 定义，双端 `z.infer` 推导；ACC 卡内 contracts / domain / cloud-client / mapper / web-api 测试 / OpenAPI 同批演进，不出现「前端先行、契约欠账」的中间态跨卡存在。
4. **capability 差异显式化**：双端不一致必须是「能力不同」（有无 safeStorage、有无本地 Provider、有无 hover），不允许「同能力不同实现」；差异在 UI 卡与 ACC 卡登记。
5. **每张卡可独立回滚**：UI 卡按页面分批；桌面与 Web 表现分叉的中间态不得跨卡存在。
6. **状态登记不等于测试声明**：验收数字以交付时登记为准（如 WF-00 的 ui 17 / product-ui 98 / 代表性 Electron E2E 11 passed），本文件不代跑、不预支任何门禁结果。

## 3. 阶段总览与依赖图

| 阶段 | 卡 | 依赖 | 交付结果 | 状态 |
| --- | --- | --- | --- | --- |
| WF 基线与契约 | WF-00、WF-01 | — / WF-00 | 工作树收敛 + 任务卡与响应式契约 | 均已完成 |
| ACC 账号对齐 | ACC-01…04 | WF-01 / 前置 ACC 卡 | 端口与会话边界、登录注册闭环、额度真值、兑换与共享表面 | 未开始 |
| UI 响应式收敛 | UI-01…04 | WF-01（UI-04 另依赖 UI-01） | 侧栏 Drawer 化、Prompt 大屏对齐、History bottom sheet、手机收口 | 未开始 |
| QA 门禁 | QA-01 | ACC-01…04、UI-01…04 | 高价值验收矩阵 | 未开始 |
| CI/CD | CI-01、CI-02 | 无 / CI-01 + QA-01 | 恢复远端 CI 绿；生产门禁加固 | 未开始 |
| REL 收口 | REL-01、REL-02 | QA-01 / CI-02、REL-01 | 最终本地门禁与视觉验收；生产部署与冒烟 | 未开始 |

依赖图：

```text
WF-00 ──→ WF-01 ──┬──→ ACC-01 ──┬──→ ACC-02
                  │             ├──→ ACC-03 ──→ ACC-04
                  │             └──→ ACC-04（表面统一部分可先动）
                  ├──→ UI-01 ──→ UI-04
                  ├──→ UI-02
                  └──→ UI-03
CI-01（独立，尽早恢复绿）
ACC-01…04 + UI-01…04 ──→ QA-01 ──→ REL-01
CI-01 + QA-01 ──→ CI-02 ──→ REL-02（在 REL-01 之后执行）
```

## 4. WF 阶段：基线与契约

### WF-00 当前 v2 UI 工作树收敛

**状态：已完成。** 收敛共享工作树中未提交的 v2 UI 批次（Phase C 后续：共享 Dropdown 迁移、Workbench / History / Library 菜单与浮层、桌面 design-schemes / history / library features、`workspace-toolbars-v2.css` 等样式、配套 E2E 与共享层测试）。

- 交付时登记的验收：`packages/ui` 17、`packages/product-ui` 98、代表性 Electron E2E 11 passed。
- **文件所有权**：本卡覆盖当时工作树已改清单（`apps/desktop/src/features/*`、`packages/product-ui/src/{workbench,history,library}/*`、`packages/ui/src/{dropdown-menu-content,extended-primitives,primitives.css}`、`tests/e2e/test_{02,06,26,38,41,42,43}_*.py` 等），不再扩面。

### WF-01 任务卡与响应式契约

**状态：完成（2026-08-26；本文件为验收返工后的修订版）。** 交付物：

- 本文件：15 张卡、依赖、文件所有权、验收层级与状态。
- `ui-design/07-overlays-onboarding-responsive.md` 最小修订：§12 断点语义块（760 compact shell / 680 phone-触控-键盘 / 大屏共享桌面几何按 capability 保留差异），§12.2 与 §26 把 Prompt 手机形态定为全页子状态、History 手机详情定为 bottom sheet。四处决策保留不变。
- `ui-design/README.md` 索引补本文件链接（`docs/v2.0/README.md` 不存在，`ui-design/README.md` 是 v2.0 当前唯一索引）。
- **验收**：`git diff --check` 干净；未触碰任何源码 / 测试 / 配置 / 版本号。遗留措辞同步登记：`ui-design/03` §340 与 `08` §13 由 UI-02 / UI-03 / REL-01 执行时同步。

## 5. ACC 阶段：Web 账号对齐（全栈卡）

### ACC-01 账号端口与会话边界修正

**状态：未开始。依赖 WF-01。**

- 修正账号端口与会话边界，允许并要求以下层同批演进：`packages/contracts`（账号 / 会话实体与 zod schema）、`packages/domain`（账号域逻辑）、`packages/cloud-client`（账号端口调用）、`apps/desktop/src/runtime/mappers/account.ts`（桌面 account mapper，含 `account-mapper.test.ts`）、`apps/web-api/src/modules/account/`（`routes.ts` / `service.ts` / `session-store.ts` 及 `__tests__`）。
- OpenAPI 与实现同步：涉及出入参变更必须跑 `npm run openapi:check`；web-api 迁移另跑 `npm run test:integration:v1.1`（testcontainers 真 PostgreSQL）。
- **文件所有权**：上述五层路径 + `docs`（OpenAPI 产物）。
- **验收层级**：L1、OpenAPI 门禁、Postgres 集成门禁。

### ACC-02 Web 登录与注册闭环

**状态：未开始。依赖 ACC-01。**

- Web 登录**与注册**双闭环：`apps/web/src/screens/BootScreens.tsx`、`apps/web/src/oauth-return-to.ts`（含 `__tests__`）、`apps/web/src/runtime*.ts`，注册路径对齐 web-api 账号模块；fixture 模式「开发预览」标注语义双端一致。
- **文件所有权**：`apps/web/src/screens/`、`apps/web/src/oauth-return-to.ts`、`apps/web/src/runtime.ts` / `runtime-mode.ts`；web-api 侧随 ACC-01 契约。
- **验收层级**：L1、L3（登录与注册 e2e 双流）。

### ACC-03 账号 Query 与额度真值

**状态：未开始。依赖 ACC-01。**

- 账号数据接入 TanStack Query（`packages/product-ui/src/page-controllers/` 编排层与 Web 侧 query client），额度以服务端返回为唯一真值，消灭双端各自的本地推算副本。
- **生图终态额度刷新**：生成到达终态（成功 / 失败 / 取消）时刷新账号额度，桌面与 Web 同一条失效路径（桌面 `scheduleCloudSync()` 既有语义不重复造）。
- **文件所有权**：`packages/product-ui/src/page-controllers/`、账号相关 query hooks、`apps/desktop/src/runtime/account-access.ts`（消费侧）。
- **验收层级**：L1、L3、L4（终态刷新桌面行为）。

### ACC-04 兑换码与双端账号表面统一

**状态：未开始。依赖 ACC-01、ACC-03。**

- **Web 兑换 UI**：对齐桌面既有兑换入口（`apps/desktop/src/features/generation/workbench/InlineQuotaRedeem.tsx`、`features/account/store.ts`、设置 Account 面板），Web 提供兑换码输入与结果反馈。
- **双端账号表面统一**：`packages/product-ui/src/account/`（`AccountScreen.tsx`、`AccountSummaryPanel.tsx`）为唯一共享表面，双端身份摘要（身份名、积分/余额、可用状态、数据源）字段一致；兑换端口走 `packages/cloud-client` 与 web-api 账号模块。
- **文件所有权**：`packages/product-ui/src/account/`、Web 兑换视图（`apps/web/src/views/AccountView.tsx` 及宿主层）、`packages/cloud-client/src/index.ts`、web-api redeem 路由（随 ACC-01 契约）。
- **验收层级**：L1、L2、L3（兑换 e2e）。

## 6. UI 阶段：响应式收敛

### UI-01 共享侧栏 Drawer 化

**状态：未开始。依赖 WF-01。**

- 760px compact shell 下共享侧栏 drawer 化：scrim、点击导航 / 新设计自动关闭、`min(320px, calc(100vw - 28px))` 宽度（`ui-design/07` §12.1 / §25），桌面与 Web 同一实现。
- **文件所有权**：`packages/product-ui/src/navigation/ProductSidebarLayout.tsx`、`ProductSidebar.tsx`、`product-nav.tsx`、`packages/product-ui/src/styles.css`（760px 查询）、`apps/web/src/layout/WebNavigation.tsx`。
- **验收层级**：L1、L2、L3（760 档）。

### UI-02 Prompt 大屏 workspace 对齐

**状态：未开始。依赖 WF-01。**

- Prompt 库大屏（>760px）对齐 v2 workspace 几何：列表 / 详情列布局、Inspector 参与布局不覆盖列表、12px 工作面圆角与间距 token，与桌面同源（`ui-design/03`；大屏几何共享见 `ui-design/07` §12）。
- 同步 `ui-design/03` §340 措辞与手机全页子状态决策一致（归本卡，因大屏与手机形态同页落地）。
- **文件所有权**：`packages/product-ui/src/library/PromptLibraryScreen.tsx`、`PromptDetailScreen.tsx`、`apps/web/src/views/PromptLibraryView.tsx`、`apps/desktop/src/pages/LibraryPage.tsx`、`docs/v2.0/ui-design/03-prompt-library.md`（措辞同步）。
- **验收层级**：L1、L2、L3。

### UI-03 History 手机详情 bottom sheet

**状态：未开始。依赖 WF-01。**

- 680px phone 档 History 详情使用 bottom sheet：拖拽 / 关闭语义、与桌面 Inspector（`GenerationHistoryDetailScreen`）共享数据与动作结构、文件管理与删除确认在 sheet 内可达。
- 同步 `ui-design/08` §13 Inspector「窄屏转换」泛称：History 用 bottom sheet、Prompt 用全页子状态。
- **文件所有权**：`packages/product-ui/src/history/`、`apps/web/src/views/HistoryView.tsx`、`apps/desktop/src/features/history/components/HistoryDetail.tsx`、`docs/v2.0/ui-design/08-component-upgrade-matrix.md`（措辞同步）。
- **验收层级**：L1、L2、L3（680 / 390 档）。

### UI-04 Settings / Account / Workbench 手机收口

**状态：未开始。依赖 UI-01。**

- 680px phone 档三个面的收口：Settings（分区导航）、Account（含 ACC-04 后的共享表面）、Workbench（底部 Composer、软键盘 inset、触控目标 44px、无横向滚动、safe-area），语义见 `ui-design/07` §12.2 / §26 / §27。
- **文件所有权**：`packages/product-ui/src/settings/`、`account/`、`workbench/` 相关组件与 `styles.css` 680px 查询、`apps/web/src/styles.css`（680px 宿主胶水）。
- **验收层级**：L1、L3（680 / 390 档）。

## 7. QA 阶段：门禁

### QA-01 高价值验收矩阵

**状态：未开始。依赖 ACC-01…04、UI-01…04。**

- 高价值路径 × 视口 × 主题的验收矩阵：登录 / 注册 / 兑换 / 生成终态 / 库 / 历史 / 设置，覆盖 760 / 680 / 390 三档与 Light / Dark；接管 Phase C 各批「本批不执行手机端测试」登记的响应式遗留。
- 现状登记：`apps/web/e2e/mobile.spec.ts` 已有 390×844 触控场景；760 / 680 档与账号流为新增，不声称现有用例通过与否。
- **文件所有权**：`apps/web/e2e/mobile.spec.ts`（扩展）、`apps/web/e2e/workspace.spec.ts`（或按主题新增 spec）、`tests/e2e/`（桌面按需）。
- **验收层级**：L3、L4。

## 8. CI/CD 阶段

### CI-01 恢复现有远端 CI 红灯

**状态：未开始。依赖：无，应尽早执行。**

- 定位并修复当前远端 CI（`ci.yml`）失败项，恢复既有门禁绿；本卡不新增门禁、不改判定语义，只修红。
- **文件所有权**：随失败项定位（预期在本次 v2 UI 工作树相关路径或既有门禁脚本），`.github/workflows/ci.yml` 只在失败源于工作流本身时才动。
- **验收层级**：L5（远端 CI 实际回绿为准）。

### CI-02 生产门禁加固

**状态：未开始。依赖 CI-01、QA-01。** 必含三项：

1. **相关路径门禁接入**：Web E2E（`npm run test:e2e:web`）、共享视觉（`npm run test:visual:shared`）、OpenAPI（`npm run openapi:check`）、Postgres 集成（`npm run test:integration:v1.1`）按层检测触发——相关路径变更必跑，其余路径不重复跑（沿用 `.github/scripts/detect-layers.mjs` 层机制）。
2. **多提交 range 漏层修复**：`deploy.yml` Detect layers 与 `detect-layers.mjs` 目前按 `SHA^..SHA` 单提交 diff 计算层，多提交推送的 range 会漏层（中间提交触发的层不被部署）；改为按推送 range 全量计算。
3. **手动部署约束**：`workflow_dispatch` 手动部署只允许部署**已通过 CI 的 main SHA**——目标 SHA 必须能对应到一次成功的 main CI 运行，未验证 SHA 拒绝部署。
- **文件所有权**：`.github/workflows/ci.yml`、`.github/workflows/deploy.yml`、`.github/scripts/detect-layers.mjs`。
- **验收层级**：L5（以流水线实际行为为准：层触发正确、range 不漏、未验证 SHA 被拒）。

## 9. REL 阶段：收口

### REL-01 最终本地门禁与视觉验收

**状态：未开始。依赖 QA-01（及全部功能卡）。**

- `npm run check`（lint / 边界 / typecheck / 单测 / 双端 build）与 `npm run check:v1.1` 全绿；`npm run test:visual:shared` 在终值阈值上绿；高价值面（账号、兑换、760 / 680 / 390 档）截图与人工走查登记。
- 同步 `ui-design/03` §340、`08` §13 若未在 UI-02 / UI-03 内完成的措辞残留；刷新本文件各卡状态与证据路径。
- **文件所有权**：根 `package.json` 脚本不新增前提下执行既有命令；`docs/v2.0/ui-design/README.md`、本文件。
- **验收层级**：L5。

### REL-02 CI/CD 生产部署与冒烟

**状态：未开始。依赖 CI-02、REL-01。**

- 走 `deploy.yml` content / service 分层按 git SHA 部署（自管 `musefold-prod` runner、`scripts/deploy/run.mjs` 执行）；部署后冒烟清单：账号登录 / 注册、兑换、额度展示、760 / 680 / 390 抽查项，登记 SHA、层、时间。
- **文件所有权**：`.github/workflows/deploy.yml`（如冒烟需流水线化）、`scripts/deploy/run.mjs`；冒烟清单登记到本文件附录。
- **验收层级**：L5（生产环境实际执行记录为准）。

## 10. 验收层级定义

| 层级 | 内容 | 命令 / 位置 |
| --- | --- | --- |
| L1 | 就地单测与契约测试、typecheck | 各包 `__tests__/`；`npm run check` 的 typecheck 段 |
| L2 | 双端共享视觉门禁（1440 档 surface 对照） | `npm run test:visual:shared` |
| L3 | Web Playwright（含 390 / 680 / 760 档） | `npm run test:e2e:web` |
| L4 | 桌面 E2E（1440×900 与窄窗，按需） | `pytest tests/e2e/…`（先 `npm run build`） |
| L5 | 全量门禁与交付（CI、OpenAPI、Postgres 集成、部署冒烟、文档同步） | `npm run check`、`npm run check:v1.1`、`npm run openapi:check`、`npm run test:integration:v1.1`、`ci.yml`、`deploy.yml` |

每张卡只要求其声明的层级；声明 L2 / L3 的 UI 卡必须同时满足「桌面与 Web 表现分叉的中间态不跨卡存在」。

## 11. 风险与复审触发器

| 风险 | 缓解 | 触发后动作 |
| --- | --- | --- |
| 远端 CI 红灯持续，新门禁无法落地 | CI-01 独立最前置，先恢复绿再加固 | 修复超两个工作日 → 冻结功能卡合并，先收 CI |
| contracts 演进造成双端 mapper / OpenAPI 漂移 | ACC-01 五层同批演进 + `openapi:check` 门禁 | 漂移出现 → 回滚该批，拆更小批 |
| 760 / 680 双断点在 Electron 窄窗与手机浏览器分叉 | WF-01 契约冻结，UI 卡按档位分开验收 | 连续两卡红 → 回 `ui-design/07` 复审断点语义 |
| range 漏层修复引入误报层、CI 时长上涨 | CI-02 层触发沿用既有层定义，只改 range 计算 | 误报 / 超时 → 收窄触发路径，不删用例 |
| 生图终态额度刷新与生成流耦合引入回归 | ACC-03 失效路径双端同源，L3 / L4 双验收 | 回归 → 先修刷新时序，不回退 Query 化 |
| 兑换路径安全边界（尝试次数 / 会话） | 沿用 web-api 账号模块既有语义，不另起一套 | 评审发现缺口 → 在 ACC-04 内补，不外溢 |

## 12. 相关文档

- [v2.0 UI 设计索引](./ui-design/README.md)
- [07 浮层、引导与响应式](./ui-design/07-overlays-onboarding-responsive.md)（断点语义权威）
- [03 提示词库](./ui-design/03-prompt-library.md)、[05 生成历史](./ui-design/05-generation-history.md)、[08 组件升级矩阵](./ui-design/08-component-upgrade-matrix.md)
- [v1.2.1 CI/CD 交付计划](../v1.2.1/V121-DELIVERY-PLAN.md)（content / service 分层与 SHA 部署语义）
- [v1.1 Web 文档索引](../v1.1/README.md)（账号 BFF 与 Web 架构现状）
- [v1.4 交付计划](../v1.4/V14-DELIVERY-PLAN.md)（卡片格式参照）
