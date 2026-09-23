# UI 走查修复记录（2026-09-23）

> 本轮按「六屏验收 + 提示词库 P1」走查清单修复全部前端问题，另含 3 个 web e2e 阻断修复与模型选择 UI 美化。
> 基线分支 `spec/2026-09-01_migrate-v21-to-v25`；单测 `pnpm run check` 38/38 绿、features 897/897 绿，electron e2e（settings/prompts/workbench/onboarding）全过；按指示本轮收尾改动不再补跑测试。

## P1 提示词库双列标题被隐形操作组挤压

- `packages/features/src/prompts/PromptListRow.tsx`：操作组 md+ 改**浮层覆盖**（`absolute` 右缘 + 左向渐隐遮罩 `from-card`，`pl-7` 渐隐区），零占位不再挤标题；<md 触屏维持行内占位常显。遮罩本体 `pointer-events-none`，渐隐区点击穿透给行本体（开详情），按钮经内层 `pointer-events-auto` 接事件——修掉首版浮层拦截行点击的问题。
- 会话行同款：`packages/features/src/workbench/SessionListPanel.tsx` `SessionRow` 行容器 `relative`，操作组 md+ 浮层覆盖（`from-sidebar-accent`），静息态标题占满整行（走查 P3「hover 5 钮标题只剩 4 字」一并销账）。
- e2e `tests/v25/prompt-helpers.ts` `openPromptDetail` 点击落点挪到行首封面区：双列窄行的元素中心会落在浮层按钮下方，命中检测误判拦截。

## P2 五项

1. **Onboarding 冷启动 ~5s 迟到**（`onboarding-store.ts` + `OnboardingFlow.tsx`）：
   - 完成哨兵镜像到 `localStorage`（`musefold.onboarding-completed-at`）：完成 / 静默补写 / 读到契约哨兵时同步，已完成用户首帧短路 gate；
   - 镜像无法判定且前置查询未 settle 时渲染 `OnboardingBootShield` 全屏遮罩（品牌标 + 呼吸点）拦截点击，杜绝引导层迟到挂载抢点击落点；
   - 偏好读取失败（fail-closed）不算「未决」，不进遮罩，不会永久遮挡坏宿主。
2. **⌘N 新设计后未聚焦 Composer**：新增 screen-intent `workbench-focus-composer`（`screen-intent-store.ts`）；`NewSessionAction` 点击/⌘N 共用路径写入意图，`WorkbenchScreen` mount/意图变化时消费并 `focusPromptEnd()`——已在工作台时同样生效。
3. **Tooltip 体系推广**：`ui/tooltip.tsx` 的 `Tooltip` 自带 Provider（shadcn 上游同款，300ms，独立渲染不再抛 Provider 错误）；实装侧栏收起/展开/抽屉/移动搜索四钮（AppShell）、会话行五钮（SessionListPanel）、Composer 图片比例/生成设置/停止钮。Composer 的提交钮与「添加上下文」保留原生 `title`——「禁用并解释」契约钉在 title 上，且禁用钮不派发指针事件、Radix tooltip 挂不上。
4. **深色分段控件选中态不可辨**：新语义 token `--segment-on`（浅 `#ecece9`＝accent 不变；深 `#3a3d44`，与轨道 card Δ≈21 灰阶），`ui/toggle.tsx` 选中面 `bg-accent` → `bg-segment-on`。已登记 V25-UI-SPEC §1.2 token 表。
5. **遮罩误伤抽屉 Esc**：抽屉 `onOpenAutoFocus` 改聚焦面板容器——默认落焦首个可聚焦钮（收起钮）会立即弹 tooltip，其 DismissableLayer 吃掉第一下 Esc。

## P3 七项

- V25-UI-SPEC §4.1 过期「全部/收藏/回收站」→「库/回收站 + 筛选」；§4.2 操作组描述同步浮层化；§8-I7 登记 ⌘N 聚焦与 ⌘,；§2.6 登记首帧决策（镜像 + 遮罩）。
- 搜索/筛选空结果态补「新建提示词」CTA（`PromptLibraryScreen.tsx`，规范 §4.4 本就要求）。
- 侧栏会话行收敛 → 与 P1 同款浮层化销账（未收 ⋯ 菜单：规范 §8-I2「不藏下拉」+ e2e 大量直点 `session-pin` 等选择器）。
- 注册 `⌘/Ctrl+,` 打开设置：AppShell keydown 接线 + `shortcuts.ts` `open-settings` 登记（含接线镜像表测试同步）。
- 「关于」快捷键表 ⌘N 作用域措辞：「全局(浏览器可能保留 ⌘N)」→「全局（Web 端浏览器可能优先响应）」。
- 预置种子标签「易崩坏」→「出图不稳」（`packages/domain/src/constants.ts`，仅影响新装库 seed）。
- auto 比例 1:1 letterbox：维持现状待设计确认（走查原话「需确认设计预期」，未改）。

## web e2e 三处阻断修复（走查后复验发现）

同根：web e2e 无 API 环境 account 查询永不 settle，而旧 gate「静默未决」不拦 UI，新遮罩把「永不 settle」变成「永久遮挡」（主题刷新保持 ×2、归档闭环 ×2 中两例被挡）。
修复：`onboarding-store.ts` 引入 `completedKnown`（镜像或契约偏好已判完成）直接短路 `resolved`——已完成用户不等待通道查询，遮罩随偏好（web 为 localStorage 即读）即时解除。

## 模型选择 UI 美化（用户新增指示）

`AccountModelSelector.tsx` 重写 + `Composer.tsx` / `WorkbenchScreen.tsx` 接线：

1. **只显示可选模型**：目录过滤掉 `modelUnavailableReason` 命中项，不再渲染置灰项；全不可用时给「暂无可用云端模型」空态。
2. **位置**：从 Composer 上方独占一行移入动作行右簇、发送钮左侧；撤销 `onHeightChange` 高度上报与 `composerExtraInset` 外推（时间线不再为选择器让位）。
3. **展开框与共享组件同步**：触发钮改共享 `TOOLBAR_TRIGGER_CLASS` 风格（`border-border/55 bg-card/50`、`rounded-[7px]`、mono 字号 xs、触屏 min-h-11 / 桌面 h-8、`max-w-40/52` 截断），面板 `p-1.5` 圆角行 + 「模型名 / 单价」双行，与图片比例/生成设置 Popover 同族。
4. 单价与状态不再占行：改 sr-only `aria-live`（`composer-model-price` 契约保留）+ 触发钮 `title` 悬停可见；持久化警告并入同一通道。

## 验证状态

- `pnpm run check`（lint/typecheck/单测/双端 build/depcruise）：**38/38 绿**；features 单测 897/897（含本轮新增：⌘, 接线镜像、⌘N 意图、onboarding 镜像/遮罩/fail-closed 用例）。
- electron e2e：settings / prompts（13/13，双主题基线无需更新）/ workbench / onboarding 全过；`electron.session-trash` 1 挂属并行在途工作（持久错误 toast 适配，非本轮改动域）。
- web e2e：42 过；上述三处阻断已按根因修复（按指示未复跑）。
- 本轮收尾（模型选择 UI + completedKnown 短路）按指示**未跑测试**，待下轮门禁一并验证。
