# Musefold v1.1.1

v1.1.1 是 v1.1 产品线的移动端 UI 修订版：针对手机浏览器做 touch-first 重构，桌面端视觉与交互保持不变。按照 [Desktop/Web 共享 UI 架构](../v1.1/V11-SHARED-UI-ARCHITECTURE.md) 的约束，本次没有引入独立移动端代码树——全部改动落在共享包 `@musefold/ui`、`@musefold/product-ui` 与 `apps/web`，通过 `@media (max-width)`、`@media (hover: none)`、`@media (pointer: coarse)` 隔离移动端行为。

## 改动范围

### 1. 统一断点与视口

- 两个规范断点，Desktop/Web 共用：**680px（MOBILE）**——豆包式左抽屉（功能 + 最近对话 + 底部账号）、单列主区（对话主题 + 共用 composer）、list→detail 切换、bottom sheet；**760px（COMPACT）**——侧栏折叠为 overlay drawer。常量 `PRODUCT_MOBILE_BREAKPOINT` / `PRODUCT_SIDEBAR_COMPACT_BREAKPOINT` 定义在 `packages/product-ui/src/navigation/ProductSidebarLayout.tsx`，CSS 媒体查询与之对齐（原 520/640/820 查询全部收敛）。
- `apps/web/index.html` 视口 meta 增加 `interactive-widget=resizes-content`，让 Android 软键盘弹出时收缩 layout viewport。

### 2. Touch-first 交互

- `hover: none` 时列表行动作常显；最近对话行以一颗显式「…」按钮（`conversation-more`）打开完整上下文菜单，替代右键；hover 态 pin/archive 图标对与侧栏 resize 手柄在触屏隐藏。
- `pointer: coarse` 时控件提升到 40–44px 触控目标（图标按钮、composer 图标、segmented control、侧栏导航、生成按钮等），桌面尺寸不变。
- `<kbd>` 快捷键提示与下拉菜单 shortcut 在触屏隐藏；hover 高亮改为 `:active` 反馈。

### 3. 排版与表单

- 移动端所有输入框字号 ≥16px（composer、搜索、登录/提示词表单），消除 iOS Safari 聚焦自动缩放。
- ≤680px 提升基础字号：次级文本不低于 12px，正文 14–15px。

### 4. 工作台布局与软键盘

- 移除 `height: calc(100dvh - 140px)` 之类魔法数，改为从 `.app-main` 起的 flex 链 + `min-height: 0`；底部留白统一走 `--mobile-bottom-inset`（safe-area）与 product-ui 侧的 `--mf-workbench-bottom-inset`。
- 新增 `apps/web/src/layout/useKeyboardInset.ts`：基于 `visualViewport` 把 iOS 键盘遮挡高度写入 `--keyboard-inset` 并标记 `data-keyboard-open`；composer 保持在键盘上方可见。
- 移动端主区不再放 landing hero / 方向 ticker；空会话只保留共用 composer 与顶栏对话主题。右上角搜索和剩余积分不变。
- Composer 弹层（比例选择、生成设置）在 ≤680px 渲染为全宽 bottom sheet（`useWorkbenchPopoverPosition` + sheet 动画），桌面仍为锚定弹层。

### 5. 各屏移动端打磨

- History：更大的返回按钮、全宽 detail 图片、下载 + `navigator.share` 系统分享（不支持的宿主自动隐藏分享入口），关闭 V11-UX-05 遗留项。
- 生成结果：手机单列；图片预览统一走共享 `ImageLightbox`（触屏手势、下载、分享、复制提示词），替换原 `window.open`。共享工具在 `packages/product-ui/src/share.ts` 与 `apps/web/src/download-image.ts`。
- 对话框（重命名/删除等）：小屏全宽带边距，按钮纵向堆叠 ≥44px。Connections/Account 控件单列、按钮 ≥44px。

## 验证

- `npm run typecheck`
- `npm run test:e2e:web` —— 既有 `workspace.spec.ts` / `visual-contract.spec.ts`（含 390×844 主路径）+ 新增 `apps/web/e2e/mobile.spec.ts`（390×844 + 触屏模拟）：bottom sheet 几何、会话行「…」菜单、软键盘（视口收缩模拟）下 composer 保持可见、左抽屉导航、44px 触控目标契约、灯箱打开/下载入口。
- `npm run build:web`
- 桌面回归：≥1024px 视觉不变，由共享视觉门禁 `npm run test:visual:shared` 与桌面视口 e2e 覆盖。

## 版本标记

- `apps/web/package.json` description 更新为 `Musefold Web v1.1.1`（工作区包 version 维持 `0.0.0-internal` 内部约定）。
- 仓库无独立 changelog，本文件即 v1.1.1 发布说明；产品线文档仍见 [docs/v1.1](../v1.1/README.md)。
