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
| Button | 文字/图标动作 | surface、pressed、focus、Ember primary | 共享层已升级 |
| IconButton | 图标动作 | 28/32px hit area、tooltip、focus | 共享层已升级 |
| Input | 单行输入 | inset/elevated、focus ring、error | 共享层已升级 |
| Textarea | 多行输入 | Composer 质感、自动高度、error | 共享层已升级 |
| Select | 选择器 | Popover、selected、键盘导航 | 共享层已升级 |
| Switch | 开关 | track、thumb、checked、disabled | 共享层已升级，设置组合保留在 product-ui |
| Tabs | 页面切换 | selected indicator、紧凑圆角 | 共享层已升级 |
| Segmented | 互斥模式 | inset selected、focus、disabled | 共享层已升级 |
| Badge | 状态标签 | 生命周期/语义色区分 | 共享层已升级 |
| Dialog | 阻断/编辑 | 16px radius、统一 footer | 共享层与常规桌面实例已升级 |
| Popover | 局部菜单 | 8-12px radius、shadow-pop | 共享层已升级，Workbench Composer 已迁移 |
| Tooltip | 图标解释 | 6px radius、短说明 | 共享层已升级 |
| Toast | 瞬时反馈 | success/error/info 统一结构 | 共享层与桌面宿主已升级 |
| Empty | 空数据 | 原因 + 下一步动作 | 共享层已升级 |
| Loading | 加载状态 | 稳定尺寸 skeleton | 共享层已升级 |
| Error | 错误状态 | 错误原因 + 恢复动作 | 共享层已升级 |

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

## 21. Phase C 实现进度（2026-08-26）

本批完成共享浮层原语、工作台高频入口与 Prompt 页面菜单，采用兼容式 API 升级，不修改业务实体和数据流。

### 21.1 已完成

- Dialog：统一 scrim、raised surface、16px 圆角和 dialog shadow；新增 `DialogBody` 结构槽位。
- Popover：Dropdown / Select 使用实色 popover surface、8px 外圆角、6px 行圆角、32px 普通行和 `shadow-pop`。
- Tooltip：6px 圆角、短文案、反色实色表面和 `shadow-sm`。
- Toast：固定语义图标、正文、可选动作、关闭四个槽位；桌面 `ToastHost` 不再使用页面级 utility class 组装外观。
- Composer 添加上下文菜单：收敛为 304px 紧凑浮层，补齐菜单键盘模型与分组 separator；Portal 不参与时间线布局。
- 会话 Context Menu：实色表面、token 阴影、32px 菜单行、危险项语义与首项焦点。
- Prompt 顶部与详情菜单：共享 Dropdown 定位、实色表面、首项焦点、Home / End、Escape 与触发器焦点归还。
- Prompt 删除确认：补齐 `DialogBody` 结构槽位。
- History 详情动作：高频动作常驻，文件与删除动作进入共享 Dropdown；桌面注入项加入同一键盘集合。
- History 删除与清理确认：使用 16px Dialog、统一 scrim / shadow 和 `DialogBody` 结构槽位。
- Sidebar 身份切换与应用菜单：侧栏底部两个触发器统一使用共享 Dropdown，向上锚定并保留官方账号、豆包账号、中转站和应用设置的业务动作。

### 21.2 迁移边界

当前登记的手写动作菜单已经清零。`SidebarAccessSwitcher` 虽然包含身份切换、异步模型验证和桌宠状态读取等宿主业务，但浮层本身已经统一到共享 Dropdown 原语；Dialog 业务实例按标准 Body 槽位完成迁移，不与动作菜单机械合并。

因此，Prompt、History、Scheme、Workbench 和 Sidebar 的动作菜单现在共享同一套 Portal、焦点、键盘和 dismissal 语义。

### 21.3 桌面验收口径

- 浮层表面必须是实色，不能依赖 blur 才可读。
- Popover / Context Menu 不改变 Sidebar、MainView、Dock 或 Composer 的几何。
- 普通菜单支持方向键、Home / End、Escape；关闭后按入口语义恢复焦点。
- Toast 只承载瞬时反馈，持续错误仍保留在发生位置。
- 本阶段只做桌面端验证；移动端响应式门禁按当前开发约定暂不执行。

### 21.4 Prompt 第二批门禁

`tests/e2e/test_42_prompt_overlays_v2_desktop.py` 固定使用 1440x900，覆盖提示词库顶部菜单与详情菜单的 Light / Dark surface、8px 圆角、`shadow-pop`、危险项语义、Home / End 和 Escape 焦点归还。本批不执行手机端测试。

### 21.5 History 第三批门禁

`tests/e2e/test_43_history_overlays_v2_desktop.py` 固定使用 1440x900，覆盖 History Inspector 的动作层级、196px Light / Dark 菜单、危险项分组、16px 删除 Dialog、Home / End、Escape 与触发器焦点归还。既有 `test_06_history.py` 继续验证复制图片、打开文件夹、删除记录、删除源文件、清理和存为提示词的业务结果。本批不执行手机端测试。

### 21.6 Scheme 第四批门禁

`SchemeActionMenu`、`SchemeCreateMenu` 和 `SchemeRunVariableFields` 已迁移到共享 Dropdown 原语：

- 方案详情 `...` 菜单使用 200px 内容宽度、8px 外圆角、`shadow-pop`，危险项由 separator 隔开。
- 新建来源菜单使用 286px 内容宽度和双行菜单项，不被列表滚动容器裁剪。
- 运行 Composer 的可选变量菜单从底部向上展开，选择后关闭并将焦点归还按钮。
- 共享 Content 在 Electron pointer-open 路径主动聚焦首项，统一提供方向键、Home / End、Escape 和触发器焦点归还。
- 方案附件详情仍是富信息 dialog，不与动作型 Dropdown 混用。

`tests/e2e/test_26_scheme_center_delete.py` 固定使用桌面视口，覆盖方案详情菜单 Dark / Light surface、8px 圆角、`shadow-pop`、Home / End、Escape、焦点归还和删除确认；本批不执行手机端测试。

### 21.7 Workbench 第五批门禁

`WorkbenchTurnActions` 与 `WorkbenchGenerationResultCard` 已完成共享 Dropdown 迁移：

- 回合动作菜单使用 176px `DropdownMenuContent`，`side="top"`，Portal 只负责浮层层级，不改变时间线布局。
- 结果卡片的目录与历史动作使用 176px `DropdownMenuContent`，媒体表面上的保存、复制、微调仍保持高频图标按钮位置。
- 回合与方案页的“更多”入口使用共享省略号 `IconButton`；触发器靠 tooltip 和可访问名称表达语义，不再占用文字按钮宽度。
- 回合宿主注入项使用 `DropdownMenuItem asChild`，兼容 `GenerationSavePromptAction` 的业务状态和禁用态。
- `packages/product-ui/src/workbench/__tests__/workbench-overlays.test.ts` 固定检查共享原语、既有测试钩子和无 document 级菜单监听。
- `tests/e2e/test_08_generation_workbench.py` 继续覆盖回合菜单存为提示词以及结果菜单打开目录的桌面行为；本批不执行手机端测试。

### 21.8 Sidebar Access Switcher 第六批门禁

侧栏身份入口参考 ZCode 的底部工作区入口：触发器仍然是侧栏内的常驻身份行和设置图标，展开内容改由共享 Portal 承载，不能把菜单节点插回 Sidebar 的 `overflow` 容器。

```text
Sidebar Footer
├── [avatar] 当前生图身份 / 余额或模型          [v]
└──                                           [settings]

身份菜单（向上展开，292px）
├── 当前身份摘要
├── 生图账号
│   ├── Musefold 官方账号 / 积分余额             [✓]
│   └── 豆包账号 / 今日剩余次数
├── 中转站
│   ├── 已配置模型 / 模型友好名                   [✓]
│   └── 配置中转站
└── 管理中转站 / 账号设置

应用菜单（向上展开，220px）
├── Musefold
├── [power] 显示桌宠 / 隐藏桌宠
└── [settings] 应用设置
```

实现口径：

- 身份菜单使用 `DropdownMenuContent side="top" align="start" sideOffset={6}`，宽度 292px；应用菜单使用 `side="top" align="end" sideOffset={6}`，宽度 220px，保证设置图标右边缘对齐。
- 两个内容面均为实色 `--bg-popover`，外圆角 12px、1px `--border-default` 和 `--shadow-pop`；深色继承 ZCode 风格的高对比 raised surface，明亮色使用 foundation 的浅色 popover，不能依赖 blur 才可读。
- 菜单内部采用 8px 行圆角、40px 最小行高、8px 内边距；身份行是图标、双行名称/状态和尾部 Check 的三段式布局，标题和余额允许截断但不能改变行高。
- 账号、中转站和底部管理动作由真实 `DropdownMenuLabel` / `DropdownMenuSeparator` 分组；当前项使用 `data-active` + accent-soft 背景，不使用不适用于 `menuitem` 的 `aria-selected`。
- 中转站和桌宠是异步动作：选择中转站时阻止 Dropdown 自动关闭，保留 Loader 和禁用态，验证成功后再关闭；点击桌宠开关时保留同一菜单内的忙碌反馈。
- Radix 负责 outside click、Escape、方向键和焦点归还；共享 Content 负责首项聚焦以及 Home / End。身份切换失败只产生 toast，不把菜单重排成错误页。
- 两个菜单设置 `z-index: 75`，高于侧栏和 MainView，但不覆盖 Dialog / Command 层级；Portal 开关不会改变 Sidebar 宽度、MainView 圆角、Composer 位置或右侧 Dock 宽度。

桌面门禁固定使用 1440×900，Dark / Light 各覆盖身份菜单和应用菜单的 surface、12px 圆角、阴影、首项焦点、Home / End、Escape 和触发器焦点归还；`tests/e2e/test_32_v05_account.py` 继续覆盖真实账号与中转站切换，本批不执行手机端测试。

### 21.9 Dialog 实例第七批门禁

常规桌面 Dialog 统一使用 `DialogHeader / DialogBody / DialogFooter`：Body 只承担布局和滚动槽位，业务 surface、列表行和媒体预览继续由内容自身表达。已覆盖服务商、设置、全局错误、回收站、备份与分享相关实例；无独立内容的简单确认弹窗保留 Header + Footer。

`PromptEditor` 的全宽表单与账号重认证表单是明确登记的 custom-layout boundary，不强行套用通用 Body，避免破坏编辑器连续 surface 和账号异步状态布局。

新增 `apps/desktop/src/components/ui/__tests__/dialog-structure.test.ts` 作为静态契约：普通实例必须存在成对的 `DialogBody`，两个自定义边界必须继续显式保留。桌面验收使用 1440×900 的 Dark / Light 视口，验证 Body 间距、16px Dialog、raised surface、Footer 对齐、busy 状态和长内容滚动；本批不执行手机端测试。

### 21.10 Switch 原子组件第八批门禁

`Switch` 已从 product-ui 的重复 CSS 上提到 `packages/ui`，成为跨端可复用的二元状态原语：

- `Switch` 统一输出 `role="switch"`、`aria-checked`、`data-state` 和稳定的 30×18px 视觉轨道；checked 状态只切换 surface 与 thumb 位移，不改变布局尺寸。
- 共享层负责轨道、thumb、44px 命中区、focus ring、disabled opacity 和 reduced-motion 过渡；颜色只引用 `tokens.css` 的 `--accent`、`--bg-active`、`--fg-primary` 与 `--on-accent`。
- `SettingsSwitch` 继续保留 `label`、`testId` 和现有 `onCheckedChange` API，作为设置页面的产品组合；`mf-settings-switch` 只承担兼容选择器，不再拥有第二套几何或状态 CSS。
- 原语允许宿主提供原生 `onClick`，只有事件未被阻止时才触发 `onCheckedChange`；disabled 仍由原生 button 语义阻止交互。

对应实现与契约：

```text
packages/ui/src/primitives.tsx
packages/ui/src/primitives.css
packages/ui/src/__tests__/primitives.test.tsx
packages/product-ui/src/settings/SettingsComponents.tsx
packages/product-ui/src/settings/__tests__/SettingsWorkspace.test.tsx
```

桌面验收固定覆盖 Settings 的 Dark / Light 开关、checked / unchecked、disabled、focus 和设置页现有业务 test id；本批不执行手机端测试。

### 21.11 Popover 原子组件第九批门禁

`Popover` 已从工作台实例里的重复 portal 与 document listener 提炼到 `packages/ui`，作为受控的局部浮层原语：

- `Popover` 只负责 open 状态、触发器切换、body portal、点击外部关闭、Escape 关闭与触发器焦点恢复；内容的业务宽度、高度和定位仍由产品层决定。
- `PopoverTrigger asChild` 保留现有 Button 的尺寸、图标、tooltip、test id 与 focus ring，不新增一层视觉 wrapper；触发器始终输出 `aria-expanded`。
- `PopoverContent` 使用 `--bg-popover`、`--border-default`、`--radius-md` 与 `--shadow-pop`，默认挂到 body，支持 `portal={false}` 作为静态内容或特殊宿主的逃生口。
- 工作台生成设置与比例选择器已移除各自的 `createPortal` 和 document-level listener；仍使用 `useWorkbenchPopoverPosition`，确保浮层是相对于整个 Composer surface 向上展开，而不是只贴着工具栏按钮。
- 选择比例、点击关闭按钮、点击外部和按 Escape 都经过同一条关闭路径，触发器焦点可恢复；内部选项的键盘导航继续由产品层保留。

方案运行 Composer 的附件详情也已接入同一原语：它使用 `portal={false}` 保留相对于方案芯片的向上定位，但关闭、Escape、外部点击与焦点恢复均由共享 Popover 处理；附件摘要、输入要求、查看详情、更换和移除这些业务内容不变。

对应实现与契约：

```text
packages/ui/src/popover.tsx
packages/ui/src/popover.css
packages/ui/src/__tests__/primitives.test.tsx
packages/product-ui/src/workbench/WorkbenchGenerationSettingsPopover.tsx
packages/product-ui/src/workbench/WorkbenchRatioPicker.tsx
packages/product-ui/src/workbench/__tests__/workbench-overlays.test.ts
apps/desktop/src/features/design-schemes/SchemeRunComposer.tsx
apps/desktop/src/features/design-schemes/__tests__/scheme-list-primitives.test.tsx
tests/e2e/test_44_scheme_attachment_popover_desktop.py
```

桌面验收固定覆盖 1440×900 的 Composer 设置、比例浮层和方案附件详情：打开/收起、浮层位于 Composer 上方、选项修改、Dark / Light surface、点击外部、Escape 焦点恢复；本批不执行手机端测试。
