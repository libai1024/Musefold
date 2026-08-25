# 00. Musefold 2.0 Visual Foundation

## 1. 方向定义

Musefold 2.0 的视觉不是“更深的黑色 + 更多圆角”，而是把工作区分成有物理关系的表面：窗口、导航、创作桌、媒体、工具和浮层各自有明确边界。

目标质感：

- 安静的 Graphite 工作台。
- Ember 只标记行动、选中、焦点和生成进度。
- 图片结果有重量，文字和控制不抢图片。
- 组件有触感，但不做夸张 3D 或玻璃效果。
- 黑夜和明亮模式是同一系统的两个寄存器，而不是两套颜色随意替换。

## 2. 浅色配色方案

浅色模式使用低黄度的瓷白和暖灰，不使用纯白铺满全部表面。

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `--bg-window` | `#f6f6f4` | 应用最底层背景 |
| `--bg-sidebar` | `#efefec` | 左侧导航和会话区 |
| `--bg-work` | `#fafaf8` | MainView 创作桌 |
| `--bg-elevated` | `#ffffff` | Composer、设置卡片、结果工具 |
| `--bg-inset` | `#f0f0ed` | 输入区、列表分组、图片占位 |
| `--bg-popover` | `#fdfcf9` | 菜单、Popover、Dialog |
| `--fg-primary` | `#202124` | 标题、正文、当前任务 |
| `--fg-secondary` | `#55575c` | 描述、摘要、辅助控件 |
| `--fg-tertiary` | `#74777c` | 时间、计数、placeholder |
| `--fg-quaternary` | `#a1a3a9` | disabled、非重点信息 |
| `--border-subtle` | `rgba(24,24,29,.07)` | surface 内部分隔 |
| `--border-default` | `#dfdfdb` | 输入框、卡片边界 |
| `--border-strong` | `#c8c8c3` | hover、拖拽、焦点附近 |
| `--accent` | `#d6653f` | Ember 主动作和选中 |
| `--accent-soft` | `rgba(214,101,63,.12)` | selected、引用、生成态底色 |
| `--success` | `#2a7b4a` | 成功、已保存 |
| `--warning` | `#a96d1d` | 注意、资源不足 |
| `--danger` | `#b54935` | 删除、失败、不可逆操作 |
| `--info` | `#3f739e` | 中性信息、提示 |

浅色表面之间的明度差要小。高级感来自边界和留白，不来自白色卡片大量堆叠。

## 3. 黑夜配色方案

黑夜模式使用石墨灰，不使用纯黑。图片和结果需要比背景更亮的承托面。

| Token | 建议值 | 用途 |
| --- | --- | --- |
| `--bg-window` | `#151619` | 应用最底层背景 |
| `--bg-sidebar` | `#1b1c1f` | 左侧导航和会话区 |
| `--bg-work` | `#1d1f22` | MainView 创作桌 |
| `--bg-elevated` | `#25272a` | Composer、设置卡片、结果工具 |
| `--bg-inset` | `#121315` | 输入区、列表分组、图片占位 |
| `--bg-popover` | `#2b2d31` | 菜单、Popover、Dialog |
| `--fg-primary` | `#f4f4f1` | 标题、正文、当前任务 |
| `--fg-secondary` | `#c6c7ca` | 描述、摘要、辅助控件 |
| `--fg-tertiary` | `#a0a2a7` | 时间、计数、placeholder |
| `--fg-quaternary` | `#62656d` | disabled、非重点信息 |
| `--border-subtle` | `rgba(255,255,255,.075)` | surface 内部分隔 |
| `--border-default` | `#33353a` | 输入框、卡片边界 |
| `--border-strong` | `#4a4d53` | hover、拖拽、焦点附近 |
| `--accent` | `#ef7a52` | Ember 主动作和选中 |
| `--accent-soft` | `rgba(239,122,82,.15)` | selected、引用、生成态底色 |
| `--success` | `#75d493` | 成功、已保存 |
| `--warning` | `#e7ad54` | 注意、资源不足 |
| `--danger` | `#ff8b70` | 删除、失败、不可逆操作 |
| `--info` | `#78b7d5` | 中性信息、提示 |

黑夜模式的 `--bg-elevated` 与 `--bg-work` 必须有足够差异，否则 Composer、结果卡片和右侧面板会失去层次。

## 4. 表面材质

### 4.1 Window Surface

- 不放业务内容。
- 只负责窗口底色、标题栏和系统安全区。
- 浅色为瓷白灰，黑夜为石墨灰。
- 不使用内容区 blur。

### 4.2 Sidebar Surface

- 比 MainView 更暗或更灰一层。
- 侧栏内部不使用大量卡片。
- 当前入口使用小面积 selected surface。
- 会话列表使用细行和内缩层级。

### 4.3 Work Surface

- MainView 保持连续，不把每一条消息都包成卡片。
- 结果图片和 Composer 作为局部 raised object。
- 任务头使用细分隔线，不使用大面积标题卡片。

### 4.4 Media Surface

- 固定宽高比。
- 图片四周可以有 1px 边界和 12-16px 圆角。
- 加载态保留最终图片尺寸。
- hover 遮罩只显示真实动作，不放装饰文字。

### 4.5 Popover / Modal Surface

- 实色背景。
- 1px border。
- `shadow-pop`。
- 内容边距 6-8px，Dialog 内容边距 20-24px。
- 不使用高亮外框模拟玻璃。

## 5. 圆角阶梯

```text
radius-xs  4px   metadata badge / tiny status
radius-sm  6px   menu item / icon button / compact row
radius-md  8px   normal button / input / nav row
radius-lg  12px  Composer / settings card / tool group
radius-xl  16px  image result / lightbox / dialog
radius-2xl 20px  onboarding or special Theater surface only
```

新对话首屏的 Composer 是一个有品牌焦点的特殊工具变体：外框最多使用 `radius-2xl 20px`，内部输入区、按钮和工作区选择条仍遵循 8px / 6px 的控件半径。进入已有任务后，Composer 回到 `radius-lg 12px` 的密集工作态，避免整个生成时间线变得过于圆润。

约束：

- 普通导航不要使用 16px 大圆角。
- 普通按钮不要默认变成 pill。
- 只有数量、状态、模型等紧凑标签可以使用近 pill 形状。
- 同一组件的不同状态不能改变圆角。

## 6. 边框与阴影

### 6.1 边框

| 状态 | Light | Dark | 用途 |
| --- | --- | --- | --- |
| subtle | 7% dark | 7.5% white | 非交互表面分割 |
| default | `#dfdfdb` | `#33353a` | 输入、卡片、Dock |
| strong | `#c8c8c3` | `#4a4d53` | hover、拖拽和打开 |
| accent | Ember 30% | Ember 35% | focus、selected、运行 |

### 6.2 阴影

```css
--shadow-sm: 0 1px 2px rgba(28, 30, 34, .06);
--shadow-pop: 0 16px 40px rgba(28, 30, 34, .08);
--shadow-dialog: 0 24px 70px rgba(20, 20, 24, .16);
```

黑夜模式只提高阴影不透明度，不改变为彩色 glow：

```css
--shadow-sm-dark: 0 1px 2px rgba(0, 0, 0, .38);
--shadow-pop-dark: 0 18px 46px rgba(0, 0, 0, .5);
--shadow-dialog-dark: 0 28px 80px rgba(0, 0, 0, .62);
```

规则：

- 普通列表行不用明显阴影。
- Composer 使用 `shadow-composer`，因为它是当前操作工具。
- Popover 和 Dialog 可以使用较强阴影。
- 图片结果优先使用边界和背景，不用大面积阴影。

## 7. 控件规格

| 控件 | 高度 | 圆角 | 质感 |
| --- | ---: | ---: | --- |
| icon button | 28-32px | 6-8px | ghost surface + hover background |
| compact button | 28px | 6px | 细边框，短标签 |
| normal button | 32px | 8px | raised surface 或 Ember |
| primary button | 34-38px | 8px | Ember surface + subtle press |
| input | 32-36px | 8px | inset/elevated 对比 |
| switch | 30x18px | 9px | thumb 有轻微内阴影 |
| tab | 30-34px | 6px | selected surface 或底部指示线 |
| chip | 22-28px | 5-8px | 低高度、弱边框 |

按钮按下时只改变 transform、阴影和表面，不改变布局尺寸。

## 8. 排版与间距

- Page title：16-18px / 600。
- Section title：13-15px / 600。
- Body：12-13px / 400-500。
- Meta：11px，不能承载唯一业务信息。
- 4px 基础间距，常用 8、12、16、24px。
- 页面内边距：24px，紧凑模式 16px。
- 数字、成本、数量和时间使用 tabular figures。
- 中文正文不使用 monospace。

## 9. 与 ZCode 的关系

参照截图：

![ZCode 三栏任务主界面](./references/zcode/zcode-mainview-dark.jpeg)

继承：

- 左侧工作区、中间工作台、右侧上下文 Dock。
- 右侧面板真实参与宽度计算。
- Composer 作为工作台底部的主控制单元。
- 暗色表面、极细分隔线、紧凑圆角。

替换：

- ZCode 的代码、分支、终端和 Changes 换成图像、提示词、参数和方案。
- ZCode 的工具输出容器换成图片结果和创作资产。
- ZCode 的中性灰强调换成 Graphite / Ember 的品牌状态。
- ZCode 的技术任务密度不能压缩图片结果的可读面积。

## 10. 视觉验收

- Light/Dark 表面层级等价。
- 侧栏、MainView、Dock 一眼可分辨，但没有粗重分隔。
- hover、pressed、focus 不改变布局尺寸。
- 普通卡片不出现多层嵌套。
- 图片加载和失败不会使页面跳动。
- 主动作始终只有一个 Ember 实心高权重按钮。
- 2.0 的高级感来自材质层级，不来自渐变、发光和过度阴影。

## 11. 本轮讨论确认的材质层级

本轮讨论进一步确认：Musefold 2.0 的质感不来自“更深的黑色”或“更多圆角”，而来自相邻表面之间很小但稳定的差异。

应用表面分为五层：

```text
Layer 0  Window
         应用最底层背景

Layer 1  Sidebar
         左侧工作区导航和会话列表

Layer 2  Work Surface
         中央任务工作台

Layer 3  Raised Tool
         Composer、设置卡片、工具栏、Inspector

Layer 4  Media / Popover
         图片结果、菜单、Dialog、Lightbox
```

这些层级不能只通过阴影表达。推荐的优先级是：

1. 表面颜色差异。
2. 1px 极细边界。
3. 内外间距。
4. 轻微阴影。
5. 只有在必要时才使用明显浮层阴影。

## 12. 2.0 Shell 表面关系

```text
┌────────────────────────────────────────────────────────────┐
│ Window                                                     │
│ ┌──────────────┐┌────────────────────────┐┌──────────────┐ │
│ │ Sidebar      ││ Main Work Surface      ││ Context Dock │ │
│ │              ││                        ││              │ │
│ │              ││ rounded outer surface  ││              │ │
│ │              ││                        ││              │ │
│ └──────────────┘└────────────────────────┘└──────────────┘ │
└────────────────────────────────────────────────────────────┘
```

这里的“叠加”是视觉叠加，不是实际覆盖：

- Sidebar 仍然是独立布局列。
- MainView 不使用 absolute 覆盖 Sidebar。
- MainView 作为一块圆角工作面贴近 Sidebar。
- 中间分缝保持约 1px。
- MainView 可以相对 Window 保留 4-8px 的视觉内缩。
- Dock 与 MainView 之间也保持约 1px 的分缝。
- 只有窄屏 drawer 才使用遮罩覆盖。

## 13. 极细空隙 Token

```text
--shell-gap: 1px
--surface-inset: 4px
--content-gap: 8px
--section-gap: 16px
--page-gap: 24px
```

使用规则：

| 空隙 | 使用位置 | 目的 |
| ---: | --- | --- |
| 1px | Sidebar/MainView、MainView/Dock | 表达 Shell 边界 |
| 4px | 主工作面相对 Window 的内缩 | 形成嵌入感 |
| 8px | 同一工具组、列表行内部 | 保持紧凑但可扫描 |
| 16px | Composer 与内容、section 之间 | 建立局部呼吸 |
| 24px | 页面区块之间 | 建立页面级层级 |

极细空隙只用于 Shell 级边界，不能把所有内容都压成 1px 间距。组件内部仍然需要 8-16px 的可读空间。

## 14. 圆角决策

2.0 不采用全站统一的大圆角。推荐的最终阶梯如下：

| 对象 | 圆角 | 设计语义 |
| --- | ---: | --- |
| Tooltip | 6px | 轻量解释层 |
| Icon button | 6px | 紧凑工具 |
| Navigation row | 8px | 可选工作区入口 |
| Normal button | 8px | 常规动作 |
| Input | 8px | 表单控件 |
| MainView outer surface | 12px | 中央工作面 |
| Composer | 12px | 主创作工具 |
| Inspector | 12px | 上下文工具 |
| Image result | 14px | 视觉媒体对象 |
| Lightbox/Dialog | 16px | 临时阻断层 |
| Onboarding Theater | 20px | 特殊首次体验 |

圆角规则：

- AppShell 本身不需要明显圆角。
- MainView 外框是 12px，不能扩展成 20px 消费级大卡片。
- Composer 是 12px，内部输入区不再嵌套一个更大的卡片。
- 图片结果使用 14px，表达媒体对象的柔和边界。
- Dialog 使用 16px，强调它脱离工作台的临时性。
- 同一组件的 default、hover、pressed、focus 状态不能改变圆角。

## 15. 阴影决策

2.0 只保留三档通用阴影：

```css
--shadow-sm:
  0 1px 2px rgba(28, 30, 34, .06);

--shadow-pop:
  0 16px 40px rgba(28, 30, 34, .08);

--shadow-dialog:
  0 24px 70px rgba(20, 20, 24, .16);
```

黑夜模式只提高阴影不透明度，不引入彩色 glow：

```css
--shadow-sm-dark:
  0 1px 2px rgba(0, 0, 0, .38);

--shadow-pop-dark:
  0 18px 46px rgba(0, 0, 0, .50);

--shadow-dialog-dark:
  0 28px 80px rgba(0, 0, 0, .62);
```

使用决策：

- Sidebar 不使用大阴影。
- MainView 主要依靠颜色和边界，不使用浮层阴影。
- Composer 可以使用 `shadow-sm` 或现有 `shadow-composer`。
- Popover 使用 `shadow-pop`。
- Dialog 和 Lightbox 使用 `shadow-dialog`。
- 图片结果优先使用 media border 和承托面，不使用厚重黑影。

## 16. 组件触感决策

### 16.1 Button

Default：

- raised surface。
- 1px default border。
- 8px radius。

Hover：

- 背景提高一层。
- border 变为 strong。
- 不改变宽高。

Pressed：

```css
transform: translateY(1px);
box-shadow: none;
```

Focus：

- 使用 Ember ring。
- ring 不参与布局尺寸。
- 键盘焦点必须可见。

### 16.2 Composer

Composer 是 2.0 最重要的实体组件：

- 12px 圆角。
- Light 使用白色 raised surface。
- Dark 使用 `#25272a`。
- 外边框 1px。
- 运行中增加 Ember 低透明边界。
- 内部输入区使用 inset surface。
- 底部控制行与输入区之间保持 1px 或 4px 视觉间距。
- 生成按钮是页面唯一高权重 Ember 实心按钮。

### 16.3 Navigation Row

- 8px 圆角。
- 不使用阴影。
- hover 使用 `bg-hover`。
- selected 使用 `accent-soft`。
- icon 15px。
- 行高 30-32px。
- 文本和图标在状态变化时不改变位置。

### 16.4 Image Result Card

- 14px 圆角。
- 固定 `aspect-ratio`。
- 1px media border。
- Light 使用轻微 `shadow-sm`。
- Dark 主要依靠 `#2a2c30` 承托。
- hover 只显示真实操作，不添加图片底部渐变遮罩。

## 17. 三项基础决策

### 17.1 主模式

2.0 以深色作为主要质感基线，以明亮色作为同等完整的第二主题：

- ZCode 的三栏空间关系在深色中更容易观察和复盘。
- Musefold 的图片创作需要浅色模式保持同等专业度。
- Light/Dark 必须是同一层级系统，而不是简单的颜色翻转。

### 17.2 主工作台圆角

```text
MainView 外框：12px
Composer：12px
结果图片：14px
Dialog：16px
```

MainView 不使用 16-20px 的消费级大圆角，以保持桌面工作台属性。

### 17.3 Ember 使用范围

Ember 只用于：

```text
主生成按钮
当前导航
当前选中
键盘焦点环
生成中状态
可执行的品牌动作
```

Ember 不用于：

```text
普通卡片背景
所有 hover
所有链接
错误状态
大面积页面背景
```

错误、成功、警告使用各自的语义色，不和品牌色混淆。

## 18. 当前基础层验收

- [ ] 深色是主要质感基线，浅色是同等完整主题。
- [ ] Sidebar、MainView、Dock 只用极细分缝连接。
- [ ] MainView 是 12px 圆角工作面，而不是覆盖式抽屉。
- [ ] Composer 是 12px raised tool，内部输入区是 inset surface。
- [ ] 图片结果使用 14px 圆角和稳定比例。
- [ ] 普通按钮、导航行和输入框使用 6-8px 圆角。
- [ ] 阴影只有小、中、Dialog 三档。
- [ ] Ember 不表达错误和成功。
- [ ] 组件状态变化不改变布局尺寸。
- [ ] 高级感来自表面层级、边界和间距，而不是渐变和发光。
