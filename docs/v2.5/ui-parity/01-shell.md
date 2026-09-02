# 01 主界面(应用壳 + 顶栏 + 主视图) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。逐项对照旧版(`v2.5-baseline`,commit `0e5be61`)与当前 v2.5 实现的组件、布局、交互、动效与 UIUX 细节。
> **旧版源码**:`apps/desktop/src/components/layout/{AppShell,TitleBar,WindowControls}.tsx` + `packages/product-ui/src/navigation/{ProductSidebarLayout,ProductTopbar}.tsx` + `packages/product-ui/src/styles.css`。
> **新版源码**:`packages/features/src/shell/AppShell.tsx` + 宿主 `apps/desktop/src/v25/main.tsx`、`apps/web-next/src/app/layout.tsx`。
> **原则**:核心目标是让用户获得与旧版基本一致的 UI、动效与交互体验;代码量不是评判标准。下文「差距」按体验影响分级,P0 = 用户可直接感知的体验回退。

---

## 1. 结论与迁移状态

壳的信息架构与 U01 核心几何已经收口:侧栏恢复 220–360px/32vw 调宽与旧键持久化,普通产品屏恢复四边 4px 浮岛工作面,`<768px` 使用同源五段式模态抽屉并具备焦点圈闭/归还、`inert` 和自动关闭。剩余差值集中在桌面原生装壳(Win/Linux 窗口控件、内容顶拖拽带)、⌘K 暂缓期接线、Automation 确认面和顶栏任务摘要落点。macOS 全屏 inset 已由 U01-fullscreen-inset 接入,品牌行按 78px(非全屏) / 12px(原生全屏)切换。移动端底部标签栏是新增能力,旧版没有对位物。

## 2. 布局对照

### 2.1 旧版几何(桌面)

```text
┌────────────────────────────────────────────────────────┐
│ 侧栏 rail(248px 默认,220–360 可拖) │ mainview-frame     │
│ - drag-region(整栏可拖窗口)        │  padding: 4px      │
│ - 品牌行(inset 12/86px 让红绿灯)   │ ┌────────────────┐ │
│                                    │ │ TitleBar 44px  │ │
│                                    │ │ ─────────────  │ │
│                                    │ │ mainview-      │ │
│                                    │ │ surface        │ │
│                                    │ │ (bg-work,      │ │
│                                    │ │  radius 12px,  │ │
│                                    │ │  shadow-sm)    │ │
│                                    │ └────────────────┘ │
└────────────────────────────────────────────────────────┘
```

- **窗底**:`--bg-window #f6f6f4`;主视图外框 `mf-mainview-frame` 以 `--gap-surface-inset: 4px` 内缩,内部 `mf-mainview-surface` 是 `--bg-work #fafaf8` + `--radius-work 12px` + `--shadow-sm` 的**浮岛工作面**——侧栏与内容之间露出 4px 窗底色缝,这是 v2.0 Phase B 的标志性质感。
- **侧栏宽度体系**:默认 248px,最小 220,最大 `min(360px, 32vw)`;宽度持久化到 `localStorage('musefold:sidebar-width')`,历史越界值 clamp 回区间。
- **断点**:旧版 `≤760px`;v2.5 以 Tailwind `md` 接缝收口为 `<768px` overlay Drawer(宽 `min(320px, max(220px, calc(100vw - 28px)))`),避免 761–767px 侧栏/抽屉均不可达;功能结果不变。
- **顶栏**:44px 高,`border-bottom: border-subtle`,左 12px 右 8px 内距,透明背景(坐在工作面上)。
- **设置页特例**:`settings-product-shell` modifier 取消 frame 内缩与圆角,设置以全屏工作区呈现,自带拖拽条与(Win/Linux)窗口控件。

### 2.2 新版几何

- 侧栏默认 248px,最小 220、最大 `min(360px,32vw)`;指针拖拽、键盘 ±16/Home/End、双击复位共用夹取入口,沿用 `localStorage('musefold:sidebar-width')`。
- 普通产品屏的 `mainview-frame` 四边 4px inset,内部 `mainview-surface` 为 12px 圆角 + `bg-card` + `shadow-sm`;设置屏按旧 `settings-product-shell` 语义保持全出血,不套 frame/圆角/阴影。
- `<768px` 常驻侧栏转左侧模态 `Sheet`,主工作面与底栏 `inert`;焦点圈闭、Escape、焦点归还、导航/新设计/会话自动关闭齐全。移动 header 与底部标签栏继续保留。
- 桌面宿主 `md+` 无顶栏(D5 有意差异:取消常驻顶栏换取内容区最大化);收起态使用布局流内 40px 窄轨展开钮,不覆盖屏幕内容。

### 2.3 布局差异表

| 项 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 侧栏宽 | 248px,220–360 拖拽 + 键盘 + 双击复位 | 同旧 + 32vw 动态上限 | ✅ 已收口(U01) |
| 宽度持久化 | localStorage | 沿用同一键 `musefold:sidebar-width` | ✅ 已收口(U01) |
| 工作面浮岛 | 4px inset + 12px 圆角 + shadow | 普通屏同旧;设置屏保持全出血 | ✅ 已收口(U01) |
| 中屏形态 | ≤760px 侧栏转抽屉,内容满宽 | <768px 模态抽屉,与 Tailwind md 无缝衔接 | ✅ 已收口(U01;修复 761–767 不可达区) |
| 顶栏 | 44px 常驻,承载会话上下文 | 无(D5 已批准) | 已登记差异,但顶栏承载的**会话菜单/任务摘要**没有着落,见 §4 |
| 移动底部标签栏 | 无 | h-16 四项 | 新增,保留 |
| 设置独立工作区 | 全屏 + 自带拖拽条 | 与普通屏同容器 | P2(依赖设置分组导航恢复,见 07 系列) |

## 3. 组件对照

| 旧组件 | 职责 | 新版对位 | 状态 |
|---|---|---|---|
| `ProductSidebarLayout` | 侧栏容器/拖宽/断点/抽屉/焦点治理 | `AppShell` + `sidebar-layout` | ✅ U01 核心行为已迁;原生窗口增量见 §7 |
| `ProductTopbar` | 44px 顶栏骨架(icon+title+suffix+actions) | 无 | D5 取消,组件不再需要 |
| `TitleBar` | 视图标题、会话菜单、任务摘要、搜索钮、素材库钮、窗口控件 | 无 | **功能移交未完成**(见 §4) |
| `WindowControls` / `MinimizeWindowButton` | Win/Linux 自绘窗口控件、mac 最小化 | 无 | **P1 缺口**(Windows 交付面装壳时必须有) |
| `CommandPalette`(⌘K) | 全局搜索与命令 | 无(§0.2 暂缓,壳预留入口) | 已登记暂缓 |
| `EmberMark` 朱点 | 外部任务活动指示 + 笺匣 | 冻结不迁(D8) | 已登记 |
| `AutomationConfirmCard` | 外部 Agent 花钱动作确认 | 无 | **P1 缺口**(automation 仍可直连主进程,渲染层无确认闸) |
| `GlobalErrorBoundary` + `global-error-dialog` | 渲染异常兜底 + 恢复 | `ShellErrorBoundary`/`ShellErrorFallback` + web-next `error.tsx`/`global-error.tsx` | ✅ 已收口(2026-08-29):双宿主挂载,错误卡带「重试/重载」双路径 |
| `ToastProvider/ToastHost`(Radix) | 全局 toast,右滑关闭,3500ms | sonner `Toaster`(bottom-right) | 已对位,行为细节见 §5 |
| `TooltipProvider`(300ms delay) | 全局 tooltip 时序 | 各屏自带 `TooltipProvider`(400ms) | 已对位;时序 300→400ms,建议统一回 300 |

## 4. 交互对照

1. **窗口拖拽区**:旧版整个侧栏是 `drag-region`,顶栏可拖,交互元素逐个 `no-drag`;设置页有专用 `settings-window-drag-region`。(2026-08-29 更新)侧栏拖拽区**已收口**:桌面宿主 `src/v25/globals.css` 对 `app-sidebar` 声明 drag、交互元素 no-drag。**踩坑记录**:Radix portal 浮层(账号上拉菜单/会话右键菜单/Select)叠在拖拽区上方时,真实鼠标点击会被当成窗口拖拽吞掉——已对 `[data-radix-popper-content-wrapper]` 与 dialog/sheet 的 overlay/content 槽整层 no-drag;**合成事件(Playwright/CDP)绕过窗口拖拽层,e2e 测不出此类缺陷,浮层新增时人工过一遍真实鼠标**。剩余:内容区顶部 12px 拖拽带 + 设置页专区(P1,随桌面装壳组;窗口已可经侧栏拖动,不再是可用性 P0)。
2. **红绿灯让位**:旧版双状态——侧栏展开时品牌行 `headerStartInset 86px`,收起时顶栏 leading `78px`,并跟随 `useWindowFullscreen()` 在全屏时退回 12px。新版宿主通过 `window:fullscreenChanged` 与 `window:isFullscreen` 感知原生状态,统一 `brandInset` 几何:macOS 非全屏 78px、原生全屏 12px,非 macOS 0px;收起态展开轨保持对应宿主让位。U01-fullscreen-inset 的 preload/主进程/renderer 接线与单测已通过;真实 macOS Electron E2E 尚未完成,当前 runner 无法让 shell BrowserWindow 获得前台焦点,需在允许 WindowServer 前台激活的 runner 复验。
3. **侧栏收起/展开**:收起态已改为布局流内 40px `sidebar-expand-rail`,展开钮不再覆盖工作台/设置内容;macOS 的 `brandInset` 会随原生全屏在 78px 与 12px 间切换,非 macOS 保持 0px。
4. **顶栏会话上下文**(旧 TitleBar 独有):当前会话标题(超 16 字截断)、任务摘要(`titlebar-task-summary`:活动标签 + 来源标签)、会话菜单触发器(置顶/重命名/归档/标记未读/删除,含 `WorkbenchSessionRenameDialog`)。D5 取消顶栏后,这组能力**部分**由侧栏行动作承接(置顶/重命名/归档/删除已有),但「标记未读」「任务摘要」无处安放。P1:在工作台屏内补会话标题行或将任务摘要并入时间线头部。
5. **compact 抽屉的焦点治理**:已恢复。记录 opener → 关闭后 `requestAnimationFrame` 归还(失效时 fallback 到触发钮);抽屉开启时主视图与底栏 `inert`;点击导航/新设计/会话自动关。账号区因当前菜单锚在抽屉内而保持打开,已在 V25-UI-SPEC §9 D15 登记。
6. **⌘K**:旧版顶栏搜索钮 + 快捷键开命令面板;新版移动 header 搜索钮跳提示词库,桌面 `md+` **没有任何搜索入口,⌘K 也未绑定**。P1:至少把「⌘K → 提示词库聚焦搜索框」的暂缓期约定(§0.2)接上。
7. **素材库开关**(旧顶栏,generate 视图专属):`aria-pressed` 双态、微调中禁用并给禁用理由 title。随素材库域暂缓,登记勿失。

## 5. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 侧栏拖宽 | `data-resizing` 抑制过渡,松手恢复 | 同旧;window pointermove/up/cancel,松手清理 | ✅ 已收口 |
| 抽屉开合 | Drawer slide-in(`--dur-med` + `--ease-smooth`) | Radix Sheet 同 token 开合 | ✅ 已收口 |
| Toast 进出 | `toast-in/out`:8px 上移淡入 130–180ms,右滑关闭 | sonner 默认动画 | 可接受,方向/时长接近 |
| 页面切换 | 无(直切) | 无 | 一致 |
| 收起/展开侧栏 | 宽度 0↔N 即时切换(无动画,刻意) | 条件渲染直切 | 一致 |
| 减弱动效 | `.reduce-motion` class + `data-motion` 三态双通道,压全部动画到 0.01ms | ✅ 已收口(2026-08-29):`MotionSync` 挂标记 + ui globals.css 双通道压制 + `skipMotion()` + Spinner `data-motion-exempt` | 三态语义完整承旧;后续所有动效任务的闸门已开 |

## 6. UI/UX 细节

- **字阶**:旧顶栏标题 13px/600,分区标签 11px;新侧栏品牌 `text-sm`(14px)/600、「功能」标签 11px/medium + tracking-wide——分区标签口径一致,品牌字号大了 1px,可接受。
- **a11y**:整栏 `aside aria-label="Musefold 导航"`,主导航 `aria-label="主导航"` + `aria-current`;抽屉 `aria-modal` + sr-only `SheetTitle`;resize handle 完整 `role="separator"` + aria-value* + 键盘操作。Playwright 已覆盖真实焦点归还、Tab 留在 dialog、`inert` 两态和 765/768px 接缝。
- **testid 迁移**:旧 `product-sidebar-layout` / `mainview-surface` / `titlebar-*` → 新 `app-sidebar` / `app-bottom-nav` / `sidebar-collapse|expand`。E2E 已按新 id 编写,无双轨负担。
- **暗色**:两代同源 token(§1.2 映射),壳层无硬编码色,暗色下视觉等价。已由 `settings-dark` 快照锁定。

## 7. 差距 → 任务清单

> **已收口(2026-08-29)**:全局 ErrorBoundary、`reducedMotion` 三态、侧栏 drag-region、U01 侧栏调宽/旧键持久化/四边浮岛/`<768px` 模态抽屉/占位式展开轨/a11y 与 Web desktop/mobile E2E;macOS 全屏 inset 的 preload/主进程/renderer 接线与单测已收口,真实原生全屏 E2E 待补。

| 优先级 | 剩余任务 | 验收要点 |
|---|---|---|
| P1 | Win/Linux 窗口控件 | Windows 打包冒烟可最小化/最大化/关闭 |
| P1 | drag-region 收尾:内容区顶部 12px 拖拽带 + 设置页拖拽条(交互元素 no-drag) | Electron 真实鼠标验证内容区顶带可拖 |
| P1 | ⌘K 暂缓期接线:跳提示词库并聚焦搜索框 | 双端快捷键单测 |
| P1 | AutomationConfirmCard 迁入新壳 | automation 花钱动作弹确认卡 |
| P2 | TooltipProvider 统一 300ms | 单一壳级 Provider,屏组件不重复包裹 |

> 会话菜单缺项(标记未读/任务摘要)在 [02-sidebar.md](./02-sidebar.md) §4 展开;顶栏取消本身维持 D5 不翻案。

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

壳是「Codex 质感」的第一现场:Codex 的内容区同样是**侧栏色阶 + 内缩圆角工作面**的双面结构,旧版浮岛(§2.1)本就是同一语言——恢复浮岛(§7 P1)不只是补回退,也是本系列质感的地基。

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 01-C1 | C1 | 浮岛材质规格(挂靠 §7 浮岛 P1) | inset 4px(承旧 `--gap-surface-inset`)+ 12px 圆角(`--radius-xl`)+ 浮岛影承旧 `--shadow-sm`;**侧栏与工作面之间不画边框**,靠 `--sidebar`/`--background`/`--card` 三阶色差分离(00 §2-2),现有 1px 分隔线随浮岛移除 |
| 01-C2 | C1 | 壳级 hover/press 统一 | 收起/展开钮、导航项、账号 footer 同一口径:hover `--sidebar-accent` `--dur-fast`,press 深一阶(00 §4);挂靠 C-3 |
| 01-C3 | C2 | 侧栏收起/展开宽度过渡评估 | 220ms `--dur-med` + `--ease-smooth` 宽度动画(旧版刻意直切,**改行为须 SPEC §9 登记**);reduce 下直切;与拖宽的 `data-resizing` 抑制并存 |
| 01-C4 | C1 | Windows/Linux overlay 滚动条(= 00 §6 C-6) | 随 Win/Linux 装壳卡交付 |
