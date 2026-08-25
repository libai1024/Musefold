# 08. 跨页面组件升级矩阵

## 1. 文档定位

前 8 个设计文件描述页面级视觉和交互。本文件把这些结论落到现有代码分层，明确哪些组件进入 `packages/ui`，哪些组件属于 `packages/product-ui`，哪些组件继续留在桌面宿主。

目标是：

```text
先统一 token 和原子组件
→ 再统一布局和跨端产品组件
→ 最后升级页面宿主
```

不新建第二套 UI 框架，不复制一份桌面组件到 Web，也不在业务页面散落新的品牌色。

## 2. ZCode 参照

![ZCode 三栏主界面](./references/zcode/zcode-mainview-dark.jpeg)

ZCode 的三栏结构对应到 Musefold：

```text
ZCode Workspace Sidebar → Musefold Product Sidebar
ZCode MainView          → Musefold Creation Workbench
ZCode Right Dock        → Musefold Context / Inspector Dock
ZCode Composer          → Musefold Prompt Composer
ZCode Task Row          → Musefold Session / Asset Row
```

编码语义不能直接进入 Musefold：

```text
项目 / 分支 / Terminal / Changes
→
会话 / 来源 / 参数 / 图片结果 / 方案运行
```

## 3. 代码分层

```text
packages/ui
  tokens、icons、Button、Input、Popover、Dialog 等原子 UI

packages/product-ui
  Sidebar、Workbench、Asset Row、Inspector、Settings 等跨端产品组件

apps/desktop/src
  Electron 窗口、IPC、本地文件、桌面专属布局和能力

apps/web/src
  Web 宿主、移动端布局、云端平台差异
```

落位判定：

| 组件特征 | 落位 |
| --- | --- |
| 只依赖视觉 token 和 React | `packages/ui` |
| 跨端产品 UI，只依赖 contracts/domain 回调 | `packages/product-ui` |
| 依赖 Electron、IPC、本地文件 | `apps/desktop` feature |
| 只服务一个桌面页面且暂时没有第二消费者 | 当前宿主 feature |
| 纯跨域业务逻辑 | `domain` |

## 4. 原子组件升级矩阵

| 组件 | 当前职责 | 2.0 重点 | 状态 |
| --- | --- | --- | --- |
| Button | 文字/图标动作 | surface、pressed、focus、Ember primary | 待升级 |
| IconButton | 图标动作 | 28/32px hit area、tooltip、focus | 待升级 |
| Input | 单行输入 | inset/elevated、focus ring、error | 待升级 |
| Textarea | 多行输入 | Composer 质感、自动高度、error | 待升级 |
| Select | 选择器 | Popover、selected、键盘导航 | 待升级 |
| Switch | 开关 | track、thumb、checked、disabled | 待升级 |
| Tabs | 页面切换 | selected indicator、紧凑圆角 | 待升级 |
| Segmented | 互斥模式 | inset selected、focus、disabled | 待升级 |
| Badge | 状态标签 | 生命周期/语义色区分 | 待升级 |
| Dialog | 阻断/编辑 | 16px radius、统一 footer | 待升级 |
| Popover | 局部菜单 | 8-12px radius、shadow-pop | 待升级 |
| Tooltip | 图标解释 | 6px radius、短说明 | 待升级 |
| Toast | 瞬时反馈 | success/error/info 统一结构 | 待升级 |
| Empty | 空数据 | 原因 + 下一步动作 | 待升级 |
| Loading | 加载状态 | 稳定尺寸 skeleton | 待升级 |
| Error | 错误状态 | 错误原因 + 恢复动作 | 待升级 |

## 5. Token 升级矩阵

现有 token 继续作为单一事实源，2.0 通过补充语义名称和 Shell token 实现，不在业务页面新建色值。

```css
--surface-window
--surface-sidebar
--surface-work
--surface-raised
--surface-inset
--surface-popover
--surface-media

--radius-tooltip
--radius-control
--radius-work
--radius-media
--radius-dialog

--gap-shell
--gap-surface-inset
--gap-content
--gap-section
--gap-page

--shadow-sm
--shadow-pop
--shadow-dialog
--shadow-composer

--border-subtle
--border-default
--border-strong
--border-focus
```

建议映射：

| 语义 | Light | Dark |
| --- | --- | --- |
| surface-window | `#f6f6f4` | `#151619` |
| surface-sidebar | `#efefec` | `#1b1c1f` |
| surface-work | `#fafaf8` | `#1d1f22` |
| surface-raised | `#ffffff` | `#25272a` |
| surface-inset | `#f0f0ed` | `#121315` |
| surface-popover | `#fdfcf9` | `#2b2d31` |
| surface-media | `#ffffff` | `#2a2c30` |

## 6. 圆角和阴影矩阵

| 层级 | 圆角 | 阴影 | 典型组件 |
| --- | ---: | --- | --- |
| Tooltip | 6px | none/sm | tooltip |
| Compact control | 6-8px | none | icon button、menu row |
| Normal control | 8px | sm | button、input、nav row |
| Work surface | 12px | none/sm | MainView、Composer、Inspector |
| Media surface | 14px | sm | result card、cover |
| Dialog surface | 16px | dialog | Dialog、Lightbox |
| Theater surface | 20px | dialog | onboarding |

禁用的视觉模式：

- 每个 row 都使用大卡片。
- 卡片内部继续嵌套卡片。
- 所有按钮都使用 pill。
- 使用彩色 glow 表达普通 hover。
- 通过阴影替代信息层级。

## 7. 导航组件矩阵

涉及：

- `packages/product-ui/src/navigation/ProductSidebar.tsx`
- `packages/product-ui/src/navigation/ProductSidebarLayout.tsx`
- `packages/product-ui/src/navigation/ProductTopbar.tsx`
- `packages/product-ui/src/navigation/product-nav.tsx`
- `apps/desktop/src/components/layout/Sidebar.tsx`
- `apps/desktop/src/components/layout/SidebarAccessSwitcher.tsx`

升级顺序：

```text
Sidebar Layout
→ Sidebar Header
→ New Design
→ Feature Navigation
→ Session List
→ Footer
→ Resize Handle
```

目标：

- Sidebar 默认宽度 248px。
- 最小宽度 220px。
- MainView 视觉内缩约 4px。
- Sidebar/MainView 1px 分缝。
- 导航行 8px 圆角。
- 会话行 8px 圆角。
- selected 使用 Ember soft。
- hover 不改变行高。
- Footer 独立固定。
- 窄屏变 drawer。

## 8. 会话行矩阵

会话行不是基础 Button，也不直接等于历史 Asset Row。它有自己的状态：

```text
idle
running
unread
pinned
selected
archived
renaming
error
```

可共享的部分：

- row surface。
- 8px radius。
- 44/40px density。
- hover action slot。
- metadata typography。
- selected surface。

不可共享的部分：

- 会话状态和历史生成状态。
- 置顶、归档和删除逻辑。
- 会话标题编辑。

## 9. 工作台组件矩阵

涉及：

- `WorkbenchPageFrame`
- `WorkbenchComposerFrame`
- `WorkbenchComposerSurface`
- `WorkbenchComposerContextTray`
- `WorkbenchComposerToolbar`
- `WorkbenchResultGrid`
- `WorkbenchGenerationResultCard`
- `WorkbenchGenerationTurn`
- `WorkbenchTimelineViewport`

组件关系：

```text
WorkbenchPageFrame
├── Task Header
├── Timeline
│   ├── Prompt Block
│   ├── Context Block
│   ├── Generation State
│   └── Result Grid
├── Right Context Dock
└── Composer
    ├── Context Tray
    ├── Prompt Surface
    ├── Mode Bar
    └── Control Bar
```

组件职责：

| 组件 | 2.0 责任 |
| --- | --- |
| PageFrame | 三栏、MainView 外框、底部 Composer 位置 |
| ComposerFrame | 12px raised surface、内边距、拖拽态 |
| ContextTray | 来源卡片和横向引用列表 |
| ComposerToolbar | 模型、比例、质量、数量、生成 |
| ResultGrid | 稳定宽度、列数和画幅比例 |
| ResultCard | 媒体 surface、hover 动作、结果状态 |
| TimelineViewport | 独立滚动和状态追加 |

右侧 Dock 不应该混入 Composer 的业务逻辑。

## 10. Composer 状态矩阵

| 状态 | 输入区 | 控制行 | 主按钮 |
| --- | --- | --- | --- |
| empty | placeholder | 参数可选 | disabled |
| typing | prompt text | 参数可改 | enabled |
| attached | 引用卡可见 | 来源可移除 | enabled |
| running | 输入可读 | 部分锁定 | Stop |
| stopped | 保留草稿 | 可继续编辑 | 生成 |
| success | 保留 prompt | 可复用 | 生成/继续 |
| error | 保留 prompt | 显示错误 | Retry |
| scheme locked | 规则只读 | 变量可改 | 试运行 |

组件状态不能让 Composer 外框尺寸不稳定。

## 11. 资产行视觉原语

提示词库、设计方案和生成历史可以共享视觉骨架，但不能共享业务实体类型。

```text
AssetRow
├── Thumbnail / Cover
├── Title
├── Summary
├── Metadata
├── Status
└── Hover Actions
```

建议形成：

```text
product-ui
├── PromptListRow
├── SchemeListRow
├── GenerationHistoryRow
└── shared asset-row primitives
```

shared primitive 只负责：

- row surface。
- thumbnail slot。
- title/summary/meta slots。
- status slot。
- action slot。
- selected/hover/focus 样式。

它不定义 Prompt、Scheme 或 History 的业务形状。

## 12. 资产行状态矩阵

| 组件 | 默认 | Hover | Selected | 危险 | 空/错 |
| --- | --- | --- | --- | --- | --- |
| Prompt Row | 摘要/标签 | 使用/复制/编辑 | Inspector 打开 | 删除 | 列表错误 |
| Scheme Row | 来源/状态 | 使用/试运行/删除 | 详情打开 | 移除 | 无方案 |
| History Row | 状态/模型 | 复用/下载/更多 | Inspector 打开 | 回收站 | 生成失败 |

所有资产行：

- 保持固定最小高度。
- hover 不改变布局。
- action slot 预留宽度。
- 长标题省略。
- 缩略图保持固定尺寸。

## 13. Inspector 组件矩阵

建议共享视觉框架：

```text
InspectorFrame
InspectorHeader
InspectorSection
InspectorActionBar
InspectorEmpty
InspectorLoading
InspectorError
```

可以共享：

- 默认宽度 304-320px。
- 圆角 12px。
- Header 高度 44-48px。
- 内容独立滚动。
- section 间距 16px。
- 底部 action bar。
- 窄屏转换为 Bottom Sheet。

不能共享业务数据：

```text
PromptInspectorData
HistoryInspectorData
SchemeRuntimeData
WorkbenchContextData
```

Inspector 打开时参与主布局计算，不使用覆盖中央内容的 z-index 抽屉。

## 14. Settings 组件矩阵

现有组件：

- `SettingsWorkspace`
- `SettingsSection`
- `SettingsCard`
- `SettingsRow`
- `SettingsSwitch`
- `SettingsSegmentedControl`

2.0 主要做视觉收口，不更换信息架构：

```text
SettingsWorkspace
├── Settings Navigation
└── Settings Content
    ├── SettingsSection
    └── SettingsCard
        └── SettingsRow
```

统一目标：

- Card 12px radius。
- Row 右侧控件对齐。
- Section 间距 16-24px。
- Light/Dark surface 一致。
- Switch、Select、Stepper 风格一致。
- danger section 独立。
- loading/error/empty 完整。

## 15. Overlay 组件矩阵

| 组件 | 圆角 | 遮罩 | 是否改变布局 |
| --- | ---: | --- | --- |
| Tooltip | 6px | 否 | 否 |
| Popover | 8-12px | 否 | 否 |
| Context Menu | 8px | 否 | 否 |
| Command Palette | 16px | 是 | 否 |
| Dialog | 16px | 是 | 否 |
| Toast | 8-10px | 否 | 否 |
| Bottom Sheet | 16-20px | 是 | 移动端替换 |
| Lightbox | 16-20px | 是 | 否 |

Overlay 共享：

- 实色兜底。
- focus 管理。
- Escape 关闭。
- aria 语义。
- reduced motion。
- 统一 border/shadow/radius token。

## 16. 状态覆盖矩阵

所有共享组件至少检查：

```text
default
hover
focus
pressed
selected
disabled
loading
success
error
empty
```

页面重点状态：

```text
Sidebar
  collapsed / expanded / resizing

Composer
  empty / typing / attached / running / stopped / error

Result Card
  loading / success / partial / failed / selected

Asset Row
  default / hover / selected / pinned / archived / deleting

Inspector
  closed / open / loading / empty / error

Settings Row
  default / changed / saving / saved / failed
```

## 17. 推荐实施顺序

```text
Phase A  tokens.css
Phase B  Button / Input / IconButton / Select
Phase C  Tooltip / Popover / Dialog / Toast
Phase D  Sidebar / Layout / Session Row
Phase E  Composer / Result Card / Dock
Phase F  Asset Rows / Inspector
Phase G  Settings Components
Phase H  Desktop/Web visual integration
```

依赖关系：

```text
基础 token
   ↓
原子控件
   ↓
布局组件
   ↓
页面组件
   ↓
页面状态
   ↓
视觉回归
```

## 18. API 迁移策略

第一阶段尽量保持现有组件 API：

- 优先改 token 和 class。
- 通过新增可选 prop 扩展状态。
- 不同时修改业务数据和视觉 API。
- 不在页面中复制原子组件。
- 只有跨页面确实需要时才上提 product-ui。

第二阶段再处理必要的 API 扩展：

- `surface` 或 `tone`。
- `density`。
- `status`。
- `actionSlot`。
- `inspectorSlot`。

## 19. 本轮组件决策

### 19.1 InspectorFrame

推荐新建共享 `InspectorFrame`，只共享布局和视觉，不共享业务数据。

### 19.2 AssetRow

推荐新建轻量 Asset Row 视觉骨架，由 Prompt、Scheme、History 各自组合。

### 19.3 现有组件 API

推荐第一阶段保持现有 API，优先改 token 和 class；第二阶段再做必要 API 扩展。

## 20. 组件验收

- [ ] 原子组件来自 `packages/ui`，没有业务侧重复实现。
- [ ] 跨端产品组件来自 `packages/product-ui`。
- [ ] 桌面专属能力没有被错误上提到共享层。
- [ ] Sidebar、Composer、Inspector 和 Settings 使用同一套 token。
- [ ] Asset Row 共享视觉骨架但不共享业务实体类型。
- [ ] 所有状态有默认、hover、focus、disabled、loading、error 等覆盖。
- [ ] 组件状态变化不改变布局尺寸。
- [ ] 先升级 token 和原子组件，再升级页面宿主。
- [ ] 没有新增第二套图标、颜色或组件框架。
- [ ] 视觉门禁覆盖桌面、Web、Light、Dark 和窄屏。
