# 10. Phase B：Sidebar、MainView 与 Dock 实现方案

> 状态：设计方案，待进入代码迭代
>
> 本文件承接 `08-component-upgrade-matrix.md` 与 `09-phase-a-token-and-primitives.md`，只讨论产品主壳层。目标是把 Musefold 2.0 的桌面布局稳定为：固定左侧工作区导航 + 中央任务工作台 + 可独立收起的右侧上下文面板。

## 1. 本阶段目标

Phase B 不新增业务入口，不改变生成、会话、提示词、方案或设置的数据契约，只升级这些内容在桌面窗口中的承载方式。

需要达成的视觉和行为结果：

1. 左侧 Sidebar 是固定的工作区导航，不随 MainView 滚动。
2. MainView 是一个具有真实表面层级的连续工作台，桌面默认拥有 4px 的视觉内缩和 12px 圆角。
3. 右侧 Context Dock 是独立布局列，可以收起、恢复和调整内容占用，不伪装成覆盖在页面上的浮层。
4. Sidebar、MainView、Dock 之间只保留极细的 shell seam 和必要的呼吸间距。
5. 侧栏收起、窗口缩放、窄屏抽屉、键盘调整宽度、设置全屏等既有行为继续有效。
6. Light 与 Dark 使用相同几何，不通过切换主题改变页面结构。

本阶段的完成标准不是“看起来像三栏”，而是用户在切换页面、打开会话、开始生成和查看上下文时，始终能判断自己处于哪个工作区，以及哪些控件属于当前页面、哪些控件属于全局壳层。

## 2. ZCode 参考对照

本阶段直接对比以下本地截图，不以网上的产品宣传图替代实际状态：

![ZCode MainView dark](/Users/wangwei/Project/Musefold/docs/v2.0/ui-design/references/zcode/zcode-mainview-dark.jpeg)

![ZCode new task dark](/Users/wangwei/Project/Musefold/docs/v2.0/ui-design/references/zcode/zcode-new-task-dark.jpeg)

### 2.1 参考中值得保留的关系

| 观察 | ZCode 的感受 | Musefold 2.0 的采用方式 |
|---|---|---|
| 左栏 | 有明确的固定起点，入口和会话分组稳定 | 保留固定导航列，区分功能入口与最近会话 |
| 主区 | 内容成为最大视觉表面，边界非常克制 | MainView 使用 12px 圆角与 4px 内缩，但不加厚边框 |
| 工具区 | 新任务/输入区像被放在主区里的工具面板 | Composer 作为 raised tool，和媒体时间线形成层级 |
| 空隙 | 面板之间有极细的缝，表面不是一整块无差别背景 | 采用 1px shell seam + 4px surface inset + 8px content gap |
| 质感 | 主要依赖暗部层级、细边界、很轻的阴影 | 不使用渐变和玻璃模糊，使用 Graphite 表面与 Ember 状态色 |
| 信息密度 | 常驻导航不会抢走内容焦点 | 侧栏固定但低对比，选中态仅用浅层面与 Ember 图标强调 |

### 2.2 不直接复制的部分

1. 不复制 ZCode 的品牌文案、图标形状、产品命名或具体业务入口。
2. 不把所有上下文都做成浮在 MainView 上方的卡片。右侧 Dock 在桌面默认是布局列。
3. 不用黑色背景加白色大卡片承载所有功能。Musefold 的媒体、提示词、方案和生成状态需要不同的表面层级。
4. 不把圆角扩大到每一层。外部工作面、媒体卡、工具输入、列表行各自有不同半径。
5. 不把“高级感”实现为大面积金色、紫色或霓虹发光。Ember 只表示动作和状态。

## 3. 当前代码基线

### 3.1 共享布局层

| 文件 | 当前职责 | Phase B 处理 |
|---|---|---|
| `packages/product-ui/src/navigation/ProductSidebarLayout.tsx` | 控制侧栏宽度、拖拽、键盘调整、响应式抽屉、scrim | 保留行为，迁移几何 token 和宽度基线 |
| `packages/product-ui/src/navigation/ProductSidebar.tsx` | 渲染品牌、New Design、主导航、会话插槽、账户和 footer | 保留插槽 API，升级行高、激活面和层级 |
| `packages/product-ui/src/navigation/product-nav.tsx` | 根据能力与当前视图构建导航项 | 不改业务映射，只修正入口顺序和标签策略时另立任务 |
| `packages/product-ui/src/styles.css` | Sidebar、SidebarLayout、Topbar 和 settings 结构样式 | 只迁移与主壳相关的结构和 token 引用 |
| `packages/ui/src/tokens.css` | 主题色、背景层、字号、圆角、阴影和动效 token | Phase A 已定义语义别名，Phase B 只消费别名 |

### 3.2 桌面宿主层

| 文件 | 当前职责 | Phase B 处理 |
|---|---|---|
| `apps/desktop/src/components/layout/AppShell.tsx` | TitleBar、SidebarLayout、Main 容器、CommandPalette、Toast 和确认卡 | 将主内容容器改为明确的 MainView surface，保持全局 overlay 挂载点 |
| `apps/desktop/src/components/layout/Sidebar.tsx` | 注入桌面导航、会话列表、账户入口和能力切换 | 只调整注入顺序和 label，不把桌面逻辑下沉到 product-ui |
| `apps/desktop/src/components/layout/TitleBar.tsx` | 桌面标题区与窗口拖拽 | 作为 MainView 内的 topbar，和页面标题保持视觉连续 |
| `apps/desktop/src/components/layout/SidebarAccessSwitcher.tsx` | 底部访问/Provider 状态切换 | 保留在 Sidebar footer，升级紧凑状态和 tooltip |
| `apps/desktop/src/styles/globals.css` | 桌面宿主的全局结构样式 | 只修复 MainView 外壳和全屏设置覆盖关系 |

### 3.3 现有行为红线

- `ProductSidebarLayout` 的 `open`、`onOpenChange`、`storageKey` 和 `compactDismissKey` 语义不变。
- `Sidebar` 不直接使用 Electron API，桌面能力继续经现有 runtime/host 服务注入。
- `ProductSidebar` 继续使用 `@musefold/ui` 的 Button、IconButton 和 icons，不直接引入 `lucide-react`。
- `hideSidebar` 为 true 时，设置工作区可以占满窗口，但不得被新的 MainView 圆角样式截断交互区域。
- 侧栏宽度持久化仍使用现有 localStorage key，升级时兼容 200-488px 的历史值并做新的 clamp。

## 4. 2.0 桌面 Shell 结构

### 4.1 推荐 DOM 关系

```text
.mf-product-sidebar-layout                         // Window shell
├── .mf-product-sidebar-rail                       // 固定左列
│   └── .mf-product-sidebar                         // Sidebar surface
├── .mf-product-sidebar-resize-handle              // 桌面宽度控制
├── .mf-mainview-frame                              // MainView 视觉内缩层
│   ├── .mf-mainview-topbar                         // TitleBar / page topbar
│   └── main.mf-mainview-surface                    // 中央连续工作台
│       ├── page content / timeline / library
│       └── local overlays mounted by page
├── .mf-context-dock-frame                          // optional right column
│   └── aside.mf-context-dock                       // Inspector / references / settings context
├── .mf-product-sidebar-scrim                       // compact drawer scrim
└── global overlays                                 // command, toast, confirm
```

这里的 `MainView` 不是一张孤立的卡片。推荐分成 frame 和 surface 两层：

1. `frame` 负责 4px 的内缩和窗口边缘留白。
2. `surface` 负责 12px 圆角、背景表面和内部滚动。
3. topbar 与 surface 共享同一工作区背景，避免标题栏像被塞进卡片。
4. 主页面的媒体卡、Composer、筛选条可以在 surface 内形成局部层级，但不再包一层全页 card。

### 4.2 桌面几何

| 区域 | 2.0 默认 | 可变范围 | 备注 |
|---|---:|---:|---|
| TitleBar | 44px | 40-48px | 与系统拖拽区和页面标题共用 |
| Sidebar | 248px | 220-360px | 通过拖拽和键盘改变；超宽窗口不超过 32vw |
| shell seam | 1px | 固定 | 只表达区域分界，不制造厚框 |
| MainView inset | 4px | 4px | 视觉内缩，不参与业务布局宽度计算 |
| MainView radius | 12px | 固定 | 仅桌面宽屏启用；窄屏降低到 8px |
| Dock | 304px | 260-420px | 可独立关闭；面板内部滚动 |
| Dock gap | 4px | 4px | 与 MainView 保持极细的缝 |
| 页面内容 gap | 8px | 8-16px | 由具体页面密度决定 |

### 4.3 Shell 示意图

```text
┌────────────────────────────────────────────────────────────────────────────┐
│  Sidebar 248      │  MainView frame 4px                 │ Dock 304         │
│  ┌──────────────┐ │  ┌───────────────────────────────┐  │ ┌──────────────┐ │
│  │ Brand        │ │  │ Topbar                        │  │ │ Context      │ │
│  │ New Design   │ │  ├───────────────────────────────┤  │ │ tabs         │ │
│  │ 功能         │ │  │                               │  │ │              │ │
│  │ 最近会话     │ │  │ MainView surface               │  │ │ references   │ │
│  │              │ │  │ timeline / library / composer │  │ │ parameters   │ │
│  │              │ │  │                               │  │ │              │ │
│  │ account      │ │  └───────────────────────────────┘  │ └──────────────┘ │
│  └──────────────┘ │        4px inset + 12px radius       │                  │
└────────────────────────────────────────────────────────────────────────────┘
```

在 1440px 宽度下，建议先使用 `248 + 1 + 4 + 304 + 4` 的固定壳层成本，剩余空间全部交给 MainView。页面内容再在 MainView 内设置最大阅读宽度，而不是让 Sidebar 或 Dock 随内容增长。

## 5. Sidebar 设计

### 5.1 纵向结构

```text
Sidebar 248px
├── Header 52px
│   ├── macOS traffic light safe inset / brand mark
│   └── collapse icon button
├── New Design 42px block
├── section label: 功能
├── primary nav rows
├── session list flex: 1
│   ├── list heading / optional filter
│   ├── active session
│   ├── pinned sessions
│   └── recent sessions
├── account row 52px
└── footer 56px
```

`session list` 是唯一允许吃掉剩余高度的区域。Header、New Design、主导航、account 和 footer 均为 flex-none，避免会话数量变化时底部账户入口漂移。

### 5.2 品牌与 Header

- Header 高度保持 52px，品牌图标 20px，品牌文字 13px / 600。
- 左侧 macOS 红绿黄窗口按钮安全区继续由 `headerStartInset` 注入，不能写死在共享组件里。
- collapse 使用 28px IconButton，半径 6px；hover 使用 `bg-hover`，不出现橙色填充。
- 品牌区域不使用大面积色块，不添加渐变或发光 logo。
- Windows/Linux 隐藏系统按钮时，品牌左边距回到 12px。

### 5.3 New Design

New Design 是 Sidebar 中唯一高优先级的入口：

| 属性 | Light | Dark |
|---|---|---|
| 高度 | 36px | 36px |
| 外边距 | 8px 8px 2px | 同左 |
| 半径 | 8px | 8px |
| 背景 | `bg-raised` | `bg-raised` |
| 边界 | `border-default` | `border-subtle` |
| 图标 | Ember | Ember |
| 文本 | `fg-primary` | `fg-primary` |
| 阴影 | `shadow-sm`，只在 hover 后可见 | `shadow-sm`，透明度降低 |

按钮内部分为图标、标题、shortcut 三段。shortcut 默认低对比，hover/focus 时恢复；文本过长时只截断标题，不挤压图标和 shortcut 的最小宽度。

### 5.4 主导航

- nav row 高度 32px，左右 padding 10px，半径 8px。
- row 间距 2px；section label 使用 11px tertiary/quaternary 文本。
- normal：透明背景、secondary 文本、16px 图标。
- hover：`bg-hover`，文本提升到 primary。
- active：`bg-active`，文本 primary，图标 Ember，字重 600；不使用粗橙色左边框。
- count badge 使用 inset surface，半径 999px，仅显示数字，不把 badge 做成主视觉。
- disabled 入口使用 opacity 0.5，并提供 disabled reason tooltip，不留下悬空的无响应按钮。

### 5.5 会话列表

会话列表必须满足“密集但可扫描”：

| 状态 | 行高 | 视觉处理 |
|---|---:|---|
| normal | 40px | 透明背景，标题 secondary |
| hover | 40px | `bg-hover`，右侧动作显示 |
| active | 44px | `bg-active`，标题 primary，左侧 Ember 状态点 |
| running | 44px | Ember 点轻微呼吸，文字不跳动 |
| unread | 40px | 标题 600，保留一个小圆点，不整行变橙 |
| pinned | 40px | pin icon 低对比，排序稳定 |
| loading | 40px | skeleton 复用文本宽度，不能改变行高 |
| error | 40px+ | 原地重试，不把 Sidebar 撑高 |

右侧 more/delete/rename 动作默认隐藏，hover、focus-within 或 active 时显示。动作按钮为 24px，半径 6px，tooltip 必须说明动作。右键菜单仍由桌面宿主处理，product-ui 只提供 row 的稳定点击区域和 test id。

### 5.6 账户和 footer

- account row 固定在底部，外边距 8px，半径 8px。
- avatar 28px，Ember soft 只用于默认头像或当前账户识别，不把账户变成大色块。
- 两行账户信息使用 12px/11px，超长时省略。
- `SidebarAccessSwitcher` 放在 footer 的独立 32px 操作行，状态可用 icon + tooltip，不重复展示一段长说明。
- footer 与 account 之间至少保留 4px，避免视觉粘连。

## 6. MainView 设计

### 6.1 MainView 的表面原则

MainView 需要有“浮在窗口底色之上”的感觉，但仍是页面主空间：

```css
.mf-mainview-frame {
  min-width: 0;
  min-height: 0;
  padding: var(--gap-surface-inset);
  background: var(--bg-window);
}

.mf-mainview-surface {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-radius: var(--radius-work);
  background: var(--bg-work);
  box-shadow: var(--shadow-sm);
}
```

实际实现应优先使用已有 flex 结构和语义 token；以上仅说明层级，不要求复制类名或引入新的 CSS 框架。

### 6.2 TitleBar 与页面 topbar

- TitleBar 是壳层组件，但视觉上属于 MainView 顶部，不属于 Sidebar。
- 高度 44px，底部只使用 1px subtle border 或表面差异，不使用 2px 分割线。
- 左侧放页面标题或会话标题，最多两行中的一行；右侧放全局动作、窗口状态或页面上下文动作。
- 主页面标题不与 EmberMark 重叠。EmberMark 的 anchoring 需要落在 MainView 内的稳定角落，但不能盖住可点击内容。
- 主动作最多一个 Ember filled button，其余动作用 ghost/icon button。
- TitleBar 的拖拽区与按钮区必须由 `no-drag` 互斥标记保护。

### 6.3 页面内部滚动

- 外壳 `overflow: hidden`，页面内容区自行拥有唯一主滚动容器。
- 生成工作台的时间线、提示词库列表、历史列表不共用一个滚动条。
- MainView 右侧如果存在 Dock，Dock 只滚动自己的内容，不能推动 MainView 的宽度。
- 空状态、错误状态和 skeleton 必须占用与成功态一致的主内容区域，避免状态切换导致标题栏和 Composer 位移。

## 7. Context Dock 设计

### 7.1 定位和层级

Context Dock 是桌面工作区的第三列：

- 默认宽度 304px，最小 260px，最大 420px。
- 与 MainView 之间保留 4px shell gap，不使用大阴影制造浮层错觉。
- Dock 自身可有 12px radius；内部 tabs、section、field 使用 8px 或更小半径。
- Dock 背景采用 `bg-sidebar` 或独立的 `bg-dock` 语义面，不能直接使用纯黑。
- Dock 关闭后 MainView 获得全部剩余空间，MainView 不留下空白列。
- Dock 打开/关闭动画只改变 grid track 或 width，不对页面内容做 scale。

### 7.2 Dock Header

```text
┌──────────────────────────┐
│ Context title       [x]  │  44px
├──────────────────────────┤
│ References | Params      │  tabs 32px
├──────────────────────────┤
│ section content          │  independent scroll
└──────────────────────────┘
```

- close icon 28px，tooltip 为“收起上下文面板”。
- tabs 采用 underline 或低层 active surface，只选一种；本阶段建议 active surface，减少高亮线条。
- Dock 的标题和 tab 不能在窄宽度下换成两行；空间不足时减少 tab 文案或转为 select，而不是溢出。

### 7.3 Dock 与 MainView 的关系

| 场景 | MainView | Dock |
|---|---|---|
| 新设计空状态 | 保持完整宽度，Composer 位于中下部 | 默认关闭，首次需要上下文时打开 |
| 生成中 | 时间线持续可见 | 显示参数和运行状态，可收起 |
| 结果选中 | 选中媒体不离开主工作台 | Inspector 显示细节和复用动作 |
| Prompt Library | 列表可独立滚动 | 选中 prompt 时打开 Inspector |
| Design Scheme | 方案详情占主区 | 输入来源、能力和运行参数在 Dock |
| History | 历史列表占主区 | 详情 Inspector 默认关闭 |
| 窄屏 | MainView 全宽 | 变为 bottom sheet 或全屏面板 |

## 8. 响应式与收起策略

### 8.1 宽屏（> 960px）

- 三栏可见；Sidebar 248px，Dock 304px。
- MainView 至少保留 520px 的有效内容宽度。
- 如果窗口不足以容纳 Sidebar + MainView min + Dock min，优先收起 Dock，再收起 Sidebar，不让 MainView 小于可用阈值。

### 8.2 紧凑桌面（761-960px）

- Sidebar 可以保留 220-248px。
- Dock 默认收起，打开时以右列出现，但不低于 260px。
- MainView 内部页面从双列降为单列；媒体结果可变成 2 列。
- 右侧面板按钮必须在 topbar 显示，不能依靠隐藏的 hover 区域。

### 8.3 抽屉（<= 760px）

- 复用现有 `ProductSidebarLayout` compact drawer 逻辑。
- Sidebar 变成左侧抽屉，宽度 `min(320px, calc(100vw - 28px))`，打开时有 scrim。
- scrim 只遮住 MainView，不遮住系统窗口控制区；点击 scrim 和完成导航都关闭抽屉。
- 抽屉打开时锁定 MainView 滚动，Escape 关闭，焦点回到触发按钮。

### 8.4 手机（<= 680px）

- MainView radius 降至 8px，frame inset 降至 0 或 2px，给安全区留 padding。
- Dock 改为 bottom sheet：默认占视口 78%，最大 560px，顶部圆角 16px。
- 侧栏抽屉内保留功能、会话、账户三组；footer 可在账户下方折叠。
- Composer 固定在内容底部时必须使用 `env(safe-area-inset-bottom)`，不能遮住输入框或发送按钮。

## 9. 迁移步骤

### Step B1：建立 Shell 语义层

1. 在 `packages/ui/src/tokens.css` 补齐 `bg-work`、`bg-dock`、`gap-shell`、`gap-surface-inset`、`radius-work`、`radius-dock` 等别名。
2. 保留 `bg-elevated`、`radius-lg` 等旧 token，先让旧页面继续解析。
3. 在 `packages/product-ui/src/styles.css` 把主壳新增样式限定在 `.mf-product-sidebar-layout` 下，避免影响 settings。

### Step B2：迁移 SidebarLayout 几何

1. 将默认宽度从 244px 调整为 248px，最小宽度从 200px 调整为 220px。
2. 读取历史 localStorage 后用 220-360px clamp；旧的 200-219px 值迁移到 220px。
3. 保持 resize handle 的鼠标、键盘、double-click 行为。
4. 桌面 rail 保持布局列，不用 absolute；只有 compact drawer 使用 absolute。
5. seam 使用 1px subtle border，禁止增加厚边框。

### Step B3：迁移 Sidebar 内容

1. 先改 CSS token、row 高度、radius 和 active surface。
2. 再调整品牌、New Design、导航、会话、账户、footer 的结构间距。
3. 逐一验证 `data-testid` 不变，避免破坏现有 views.test.tsx 和桌面 E2E。
4. 右键菜单、重命名、归档、删除、未读和 pin 状态保持现有行为。

### Step B4：建立 MainView frame

1. 在 `AppShell` 中将当前直接使用 `bg-elevated` 的主容器拆为 frame + surface 语义层。
2. TitleBar 与 `main` 处于同一个 MainView frame，避免标题栏和内容拥有两个不一致的圆角。
3. settings fullscreen 通过 modifier 取消 frame inset 和 radius，保持设置工作区全屏。
4. `CommandPalette`、`ToastHost`、`AutomationConfirmCard` 继续挂在 shell overlay 层，不放入页面滚动容器。

### Step B5：接入 Dock contract

1. 先在 workbench page-controller 层确定 `isContextDockOpen`、active tab 和 close/open handler 的 UI state 位置。
2. 再在 desktop feature 中渲染右侧 Dock；product-ui 只接收内容插槽和尺寸/状态 props。
3. 不把 Dock 状态写入 contracts，不让 Dock 直接调用 IPC。
4. Prompt、History、Scheme 的 Inspector 统一复用 Dock frame，不复制三套关闭、宽度和 focus trap 逻辑。

### Step B6：响应式回归

截图和交互至少验证：1440x900、1208x768、960x768、800x768、680x900、390x844。每个视口都检查：

- 文本无溢出；
- Sidebar 和 MainView 无重叠；
- Dock 关闭后没有空白轨道；
- Drawer scrim 不挡住抽屉；
- Composer 不被底部安全区遮挡；
- active/focus/running 状态没有引起尺寸跳变。

## 10. 测试和视觉门禁

### 10.1 共享组件测试

- `packages/product-ui/src/__tests__/views.test.tsx`：保留现有 test id，增加默认 sidebar width、compact drawer 和 active row 的静态断言。
- `packages/product-ui/src/navigation/__tests__/product-nav.test.ts`：只验证导航映射，不在这里测试 CSS。
- 新增 `ProductContextDock` 时在相邻 `__tests__` 目录覆盖 open/closed、active tab、close callback 和 aria label。

### 10.2 桌面宿主测试

- `apps/desktop/src/__tests__/host-boundary.test.ts`：确认 Sidebar 仍通过 product-ui 共享组件渲染，没有绕过共享入口。
- AppShell 测试：确认 `hideSidebar` 时 sidebar 不可见、settings modifier 生效、全局 overlay 仍挂载。
- 桌面 E2E：侧栏收起/恢复、导航切换、会话右键菜单、生成中 active session、窗口缩放。

### 10.3 视觉检查

每个关键截图需同时保存 Light 和 Dark：

1. Sidebar 展开 + MainView 空状态。
2. Sidebar 展开 + 生成工作台 + Dock 展开。
3. Sidebar 收起 + MainView 全宽。
4. compact drawer 打开。
5. Dock bottom sheet 打开。
6. settings fullscreen。

检查重点不是像素是否完全相同，而是表面层级、圆角连续性、极细 seam、按钮 hit area 和文本密度是否符合 `00-visual-foundation.md`。

## 11. 非目标

- 本阶段不改页面业务入口排序，除非现有入口无法表达 2.0 工作区结构。
- 本阶段不重写会话列表数据获取、生成状态机、Prompt/History/Design Scheme controller。
- 本阶段不增加新的 IPC、数据库字段、云同步字段或自动化能力。
- 本阶段不制作新的品牌插画，不把截图作为生产 UI 资产。
- 本阶段不将右 Dock 与所有页面一次性接入；先建立壳层，再由各核心页面按 `02-07` 文档接入。

## 12. 设计决策记录

### D-B01：MainView 圆角只属于视觉 surface

决定：圆角和 4px 内缩放在 MainView surface/frame，不改变路由、滚动和页面组件的业务边界。

原因：这样可以得到 ZCode 截图中“主区从窗口底色中浮出”的质感，同时不会让页面内容卡在一个带圆角的内部 iframe 感容器里。

### D-B02：Dock 默认是布局列，不是浮层

决定：宽屏 Dock 参与 grid/flex 宽度分配；只有窄屏才转为 bottom sheet。

原因：上下文面板会长期承载参数、引用和 Inspector，布局列比浮层更稳定，也不会覆盖媒体结果和 Composer。

### D-B03：Sidebar 的宽度优先于装饰

决定：Sidebar 的主要质感由背景层、行间距和 active surface 提供，不增加厚边框、大阴影或大圆角。

原因：固定导航需要持续可见，过强的装饰会使工作区入口和会话列表显得像独立产品。

## 13. 阶段验收清单

- [ ] 默认 Sidebar 为 248px，最小 220px，历史宽度正确 clamp。
- [ ] Sidebar、MainView、Dock 的几何关系在 1440 和 1208 截图中稳定。
- [ ] MainView 有 4px inset 和 12px radius，settings fullscreen 不受影响。
- [ ] MainView 是最大内容表面，Sidebar 不随内容滚动。
- [ ] Dock 304px、可独立收起，关闭后不留空轨道。
- [ ] Dock 在 680px 以下变为 bottom sheet，Sidebar 在 760px 以下变为 drawer。
- [ ] New Design、active nav、running session、account、footer 的颜色和半径符合 2.0 token。
- [ ] Light/Dark 两套主题几何一致，Ember 不误用于错误和成功状态。
- [ ] 所有 icon button 有 label 和 tooltip，焦点环可见。
- [ ] `data-testid` 和现有桌面行为保持兼容。
- [ ] 共享 UI、桌面宿主、视觉截图和受影响 E2E 门禁通过。

## 14. 下一步讨论入口

下一轮建议只讨论 Sidebar 的第一屏：Header、New Design、功能导航和会话列表的顶部 240px。具体确认三件事：

1. 2.0 是否把 Sidebar 默认宽度锁定为 248px，还是保留 244px 作为兼容基线。
2. New Design 是否使用完整 Ember filled surface，还是保持 raised + Ember icon 的低饱和方案。
3. active nav 是采用整行 `bg-active`，还是使用更细的左侧状态标记。

确认后再进入对应 CSS 与组件改造，避免 Sidebar、MainView 和 Dock 同时漂移。
