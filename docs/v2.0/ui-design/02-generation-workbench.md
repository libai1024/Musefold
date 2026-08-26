# 02. 新设计与生成工作台

## 1. 页面定位

这是 Musefold 2.0 的核心页面。它不是普通聊天页面，也不是一张巨型生成表单，而是一个连续的图像创作任务：

```text
选择创作上下文
→ 写入提示词
→ 添加参考素材
→ 选择模式和参数
→ 生成
→ 比较结果
→ 保存、微调、复用或加入方案
```

## 2. ZCode 对比截图

### 2.1 新建任务参照

![ZCode 新建任务](./references/zcode/zcode-new-task-dark.jpeg)

ZCode 新建任务页有三个关键关系：

- 欢迎内容位于中央工作区。
- Composer 处于页面下方中心。
- 项目上下文和模板入口靠近 Composer。

Musefold 2.0 保留这个关系，但欢迎内容要服务于图像创作，模板要变成提示词、方案和参考图的快速入口。

本次新增的空对话布局进一步明确为：品牌锁定区在 Composer 上方，且品牌锁定区由 Logo + 名称、换行后的提示语组成。它是新对话分支的首屏结构，不取代已有任务中的媒体时间线。具体尺寸、按钮和状态见 `11-new-conversation-empty-state.md`。

### 2.2 已有任务参照

![ZCode 已有任务与右侧面板](./references/zcode/zcode-mainview-dark.jpeg)

ZCode 已有任务页可借鉴：

- 左侧会话持续存在。
- 中间任务内容独立滚动。
- 右侧面板独立占列。
- Composer 贴近 MainView 底部。

不能照搬：思考过程、Terminal、Changes 和代码文件输出必须改为 Musefold 的图像、提示词、模型和方案语义。

## 3. 2.0 桌面结构

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Task Header: 会话标题   [Musefold] [来源]                    [Dock] [更多]   │
├──────────────────────────────┬──────────────────────────────────────────────┤
│                              │                                              │
│  Timeline / Creation Stream  │  Context Dock                                │
│                              │  参考素材 / 参数 / 历史 / 方案                 │
│  User Prompt                 │                                              │
│  Context Attachments         │                                              │
│  Generation Result Grid      │                                              │
│  Result Actions              │                                              │
│                              │                                              │
├──────────────────────────────┴──────────────────────────────────────────────┤
│ Context Tray                                                                  │
│ Composer Prompt                                                               │
│ [图像] [设计方案] [模型] [比例] [质量] [数量]                         [生成] │
└─────────────────────────────────────────────────────────────────────────────┘
```

MainView 内部是单列纵向工作流，结果网格可以在中间形成局部宽面，但不能溢出主列。

## 4. Light / Dark 页面配色

| 区域 | Light | Dark |
| --- | --- | --- |
| MainView | `--bg-work #fafaf8` | `--bg-work #1d1f22` |
| Task Header | work surface + subtle bottom border | work surface + subtle bottom border |
| Composer | `--bg-elevated #fff` | `--bg-elevated #25272a` |
| Prompt input | `--bg-inset #f0f0ed` | `--bg-inset #121315` |
| Context Tray | elevated/inset mix | elevated/inset mix |
| Result surface | white media frame | `#2a2c30` media frame |
| Selected context | accent soft | accent soft |
| Generate button | Ember `#d6653f` | Ember `#ef7a52` |
| Running state | success/Ember text | success/Ember text |
| Error | danger surface 10% | danger surface 16% |

生成按钮是页面唯一的 Ember 高权重实心按钮。保存、微调、加入方案使用 secondary 或 ghost。

## 5. Task Header

结构：

```text
┌────────────────────────────────────────────────────────────┐
│ [icon] 参考一组雨天街景  · 4 张图   [方案]       [Dock] [⋯] │
└────────────────────────────────────────────────────────────┘
```

组件：

- 会话/设计标题。
- 结果数量或状态摘要。
- 当前来源标签。
- 方案或历史关联标签。
- 右侧 Dock 开关。
- 更多菜单。

细节：

- 高度 44-48px。
- 内边距 16px。
- 圆角不使用独立大卡片，保持 MainView 连续表面。
- 底部 border 只使用 1px subtle。
- 标题 14-16px / 600。
- 摘要 11px / 400。

## 6. 新建任务欢迎态

```text
                   [Musefold Mark] Musefold
                 把想法变成可生成的视觉

                         Composer
```

新对话空态不使用单独的大插画或营销 Hero。品牌 Logo 与名称位于第一行，提示语单独换行并保持低对比；Composer 紧跟其后，成为首屏唯一主操作面。这个结构对应参考页中“空态内容 → 输入框 → 工具栏 → 工作区条”的连续关系，但将 Kimi 的 doodle 和聊天提示替换为 Musefold 的创作品牌锁定区。

Light：欢迎内容使用深色文字，建议按钮为低对比 raised surface。

Dark：欢迎内容使用近白文字，建议按钮使用透明边框和微亮 hover。

欢迎态不能像营销 Hero：

- 不使用全屏大图背景。
- 不使用渐变文字。
- 不添加多余说明段落。
- 建议项必须能直接改变 Composer 草稿或打开对应入口。

首屏的推荐入口不再以三枚营销式按钮横向排列。它们改为 Composer 上方或输入区内的低权重快捷建议，最多显示三项；点击后只填入草稿或打开上下文，不自动生成。

## 7. Composer 总体结构

```text
┌───────────────────────────────────────────────────────────────┐
│ Context Tray                                                   │
│ [历史 4 张图] [参考提示词] [方案变量] [Skill]                  │
├───────────────────────────────────────────────────────────────┤
│ Prompt Surface                                                 │
│ 描述你想生成的画面                                             │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ [图像] [设计方案]   [模型] [比例] [质量] [数量]        [生成]  │
└───────────────────────────────────────────────────────────────┘
```

Composer 规格：

- 最大宽度跟随 MainView，不单独固定为某个宽度。
- 已有任务 Composer 圆角 12px；新对话首屏 Composer 外框可提升为 20px，形成品牌焦点。
- Light 使用白色 elevated surface + subtle border。
- Dark 使用 `#25272a` + `shadow-composer`。
- 运行中边框可使用 Ember 20-30% 提示状态。
- 拖拽图片时显示 inset overlay，不改变外框尺寸。
- 输入高度可增长，但设置最大高度并在内部滚动。
- Composer 和底部窗口安全区保持 16-24px 间距。

## 8. Context Tray

Context Tray 的对象：

- 历史图片来源。
- 提示词引用。
- 设计方案来源。
- Skill 来源。
- 微调目标图。
- 当前添加的图片。

每个引用卡：

- 高度 44-52px。
- 圆角 8px。
- 1px default border。
- 左侧小缩略图或语义图标。
- 中间标题和来源说明。
- 右侧移除按钮。

Light：引用卡用白色或浅灰表面。

Dark：引用卡用 `--bg-popover` 或 `--bg-inset`，避免和 Composer 外框融为一体。

移除按钮默认弱化，hover 变 danger；不可误触发来源清除。

## 9. Mode Bar

当前功能模式：

- `图像`
- `设计方案`
- 方案运行时的锁定状态
- 微调/Skill 附着状态

建议使用 segmented control：

- 外框圆角 8px。
- 每项高度 28-30px。
- selected 使用 `--accent-soft`。
- selected icon 使用 Ember。
- disabled 仅降低文字和图标，不改变布局。

设计方案不是普通的第三个 tab，而是进入另一种 Composer 参数模式，必须显示当前模式状态。

## 10. Control Bar

控制项：

| 控件 | 默认状态 | 打开/运行状态 |
| --- | --- | --- |
| 模型 | 当前模型名称 | Popover 显示供应商、模型和可用状态 |
| 比例 | `1:1` 等 | 画幅选择器，带预览比例 |
| 质量 | 草稿/标准/高质量 | 选项和成本提示 |
| 数量 | 1/2/4 等 | stepper 或菜单 |
| 生成 | enabled/disabled | running 时变为停止 |

控件之间使用 4-8px 间距，不能每项都做大按钮。

主生成按钮：

- 高度 34-38px。
- 圆角 8px。
- 图标 `WandSparkles` 或 `Send`。
- 空 prompt disabled。
- 运行中显示方形 Stop 图标。
- 错误后显示重试语义。

## 11. User Prompt Block

用户输入在时间线中显示为轻量内容块，不使用普通聊天气泡。

```text
┌──────────────────────────────────┐
│ 参考提示词                         │
│ 雨天街道、低饱和、电影感...         │
│ [历史来源] [4 张图片]               │
└──────────────────────────────────┘
```

Light：`--bg-elevated` + 1px subtle。

Dark：`--bg-elevated` 和 MainView 有低对比差。

圆角 10px，内边距 12px，正文 13px，来源标签 11px。

## 12. Generation Result Grid

结果区必须保留稳定画幅：

- 单图：最大宽度 480px。
- 双图：两列等宽。
- 2x2：四列/两列由内容宽度决定。
- 批量：三列起步，窄屏降为两列或一列。

结果卡：

- 圆角 14px。
- `aspect-ratio` 与实际图像一致。
- 1px media border。
- Light 使用轻微 `shadow-sm`。
- Dark 使用边界，不使用黑色大阴影。
- hover 使用局部 action overlay。

操作：

- 放大。
- 下载。
- 保存为提示词。
- 加入设计方案。
- 继续微调。
- 更多。

按钮使用 28px icon hit area，按钮表面为半透明但有实色兜底。

## 13. Result State

### Loading

- 保持图片容器比例。
- 使用低对比 skeleton 或单一 loading indicator。
- 不用 shimmer 大面积扫过图片。

### Success

- 结果以 `opacity + transform` 进入。
- 入场结束后回到普通 Operate 状态。
- 不添加持续循环动画。

### Partial Success

- 成功图片可操作。
- 失败项显示明确重试按钮。
- 顶部显示 `已完成 3/4`。

### Error

- 图片容器仍然保留。
- 显示错误原因、重试和查看详情。
- danger 不与 Ember 混用。

## 14. 右侧 Context Dock

```text
┌───────────────────────┐
│ 参考素材  参数  历史 方案 │
├───────────────────────┤
│ 当前标签内容             │
│                         │
│                         │
│                         │
└───────────────────────┘
```

Dock：

- 宽度 280-320px。
- 左边界 1px strong，拖拽区 8px。
- Light 使用 `--bg-sidebar` 或 `--bg-elevated`。
- Dark 使用 `--bg-sidebar`，比 Work Surface 略深。
- 标签高度 32px，selected 使用底部 Ember indicator 或 soft surface。
- 内容区独立滚动。

Dock 搜索是局部 Popover，不遮盖中央页面。

## 15. ZCode 借鉴与替换

借鉴：

- Composer 贴底。
- 当前任务是中央唯一主线。
- 右侧上下文面板独立占列。
- 新建任务欢迎态保持简洁。

替换：

- `Terminal` → 生成参数或模型状态。
- `Changes` → 生成结果变体和版本差异。
- `Explore` → 参考素材、提示词和方案上下文。
- 项目 pill → 当前创作空间/方案来源。
- 分支 pill → 当前版本或历史来源。

## 16. 验收

- [ ] Composer 是页面最清晰的交互工具。
- [ ] 图片结果有足够面积和稳定比例。
- [ ] Context Tray 能识别来源并可移除。
- [ ] 右侧 Dock 打开时不覆盖 MainView。
- [ ] Light/Dark 下 Composer 都有明显 raised surface。
- [ ] 生成按钮、运行中、停止、重试状态完整。
- [ ] 新建任务和已有任务使用同一 Composer 骨架。
- [ ] ZCode 的空间模型被继承，但没有编码语义残留。

## 17. 本轮讨论确认的工作台材质关系

本轮讨论确认：Musefold 2.0 的生成工作台应保持 ZCode 的“当前任务连续性”，但把中央内容从 Agent 文本流转译为媒体优先的创作时间线。

```text
当前创作会话
       ↓
提示词 / 参考图 / 生成结果
       ↓
结果操作和复用
       ↓
底部 Composer
```

MainView 不是普通聊天页面，也不是一张巨型生成表单。它应该连续呈现：

1. 当前创作上下文。
2. 用户提示词和引用来源。
3. 生成过程和状态。
4. 图片结果。
5. 保存、微调、加入方案和继续创作。

## 18. MainView 外层工作面

建议的 Shell 级关系：

```text
MainView 外框：12px
Window 到 MainView：4px
Sidebar 到 MainView：1px 分缝
MainView 到 Dock：1px 分缝
```

Light：

```text
Window：#f6f6f4
MainView：#fafaf8
Composer：#ffffff
```

Dark：

```text
Window：#151619
MainView：#1d1f22
Composer：#25272a
```

MainView 不使用大范围阴影。层次主要来自：

- 12px 外框圆角。
- 4px 视觉内缩。
- 1px 边界。
- MainView 与 Window 的轻微颜色差。
- Composer 的 raised surface。

## 19. Task Header 细节

```text
┌──────────────────────────────────────────────────────────────┐
│ [Image] 雨天城市人像   · 4 张图   [方案来源]     [Dock] [⋯] │
└──────────────────────────────────────────────────────────────┘
```

组件：


- 当前会话标题。
- 结果数量。
- 当前来源。
- 当前方案或历史来源。
- 右侧 Dock 开关。
- 更多菜单。

规格：

- 高度 44-48px。
- 内边距 16px。
- 标题 14-16px / 600。
- 摘要 11px。
- 只使用底部 1px subtle border。
- 不给 Task Header 单独增加大型圆角卡片。
- Dock 按钮使用 28px icon button。

Task Header 负责当前任务身份，不负责承载所有参数。比例、质量、数量等高频创作参数放入 Composer。

## 20. 新建任务欢迎态

```text
                   [Musefold Mark] Musefold
                 把想法变成可生成的视觉

                         Composer
```

这一状态与 `11-new-conversation-empty-state.md` 同步：品牌 Logo + 名称在上，提示语换行在下，Composer 紧随其后。品牌区不占用左侧导航的 Logo 位置；左侧导航仍是固定工作区入口，中央品牌锁定区只在新对话 MainView 中出现。

Light：

- 欢迎文字使用 `--fg-primary`。
- 建议动作使用低对比 raised surface。
- 页面保持 `--bg-work` 的连续背景。

Dark：

- 欢迎文字使用 `--fg-primary`。
- 建议动作使用透明边框和微亮 hover。
- Ember 只用于当前可执行的主动作。

欢迎态不能被设计成营销 Hero：

- 不使用全屏大图背景。
- 不使用渐变文字。
- 不加入多余说明段落。
- 建议项必须直接改变 Composer 草稿或打开对应功能。

## 21. Composer 四层结构

```text
Context Tray
参考图、历史来源、提示词引用、方案变量、Skill

Prompt Surface
多行提示词输入

Mode Bar
图像 / 设计方案 / 微调 / Skill

Control Bar
模型、比例、质量、数量、生成
```

完整示意：

```text
┌──────────────────────────────────────────────────────────────┐
│ [历史 4 张图] [提示词引用] [方案变量] [参考图]                 │
├──────────────────────────────────────────────────────────────┤
│ 描述你想生成的画面                                             │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│ [图像] [设计方案]   [模型] [比例] [质量] [数量]          [生成] │
└──────────────────────────────────────────────────────────────┘
```

Composer 规格：

- 已有任务 Composer 圆角 12px；新对话首屏 Composer 外框可提升为 20px，形成品牌焦点。
- Light 使用 `#ffffff` + 1px border + 轻微 shadow。
- Dark 使用 `#25272a` + `shadow-composer`。
- 运行中边框使用 Ember 20-30% 低透明度。
- 输入区使用 inset surface。
- 底部控制行与输入区之间保持 1px 或 4px 视觉间距。
- Composer 外框与 MainView 底部保持 12-16px 间距。
- 输入区可增高，但必须设置最大高度并内部滚动。

Composer 是页面的主要操作工具，而不是普通页面底栏。

新对话变体的默认尺寸参考本地空态页面：内容列最大宽度约 760px，Composer 外框在内容列内保留 16px 左右内边距，卡片有效宽度约 728px；默认高度约 136px，底部工作区选择条约 56-70px。输入内容增长时只增加输入区高度，不改变品牌锁定区的位置锚点。

## 22. Context Tray 细节

当前 Musefold 已支持以下上下文来源：

- 历史来源。
- 提示词引用。
- 设计方案来源。
- Skill。
- 微调目标图。
- 多张参考图。

统一引用卡：

```text
┌──────────────────────────────┐
│ [thumb] 历史 · 4 张图片   [×] │
│        作为参考来源            │
└──────────────────────────────┘
```

规格：

- 高度 44-52px。
- 圆角 8px。
- 1px default border。
- 左侧缩略图或语义图标。
- 中间标题和来源说明。
- 右侧移除按钮。
- 默认移除按钮弱化，hover 后变为 danger。
- 多个引用横向滚动，但不能让 Composer 高度不断增长。

Light 下引用卡使用 white/elevated 或浅灰 surface；Dark 下使用 `--bg-popover` 或 `--bg-inset`，不能和 Composer 外框融为一体。

## 23. Mode Bar 细节

模式使用 segmented control：

```text
[ 图像 ] [ 设计方案 ]
```

规格：

- 高度 28-30px。
- 圆角 8px。
- selected 使用 `--accent-soft`。
- selected icon 使用 Ember。
- disabled 仅降低文字和图标对比。
- 不使用大卡片表达模式。

设计方案运行时，Mode Bar 显示锁定或运行状态，避免用户误以为可以随时改变模式。

## 24. Control Bar 细节

| 控件 | 默认形式 | 打开/运行状态 |
| --- | --- | --- |
| 模型 | Popover selector | 显示供应商、模型和可用状态 |
| 比例 | Selector | 显示画幅预览或比例标签 |
| 质量 | 紧凑 selector | 显示质量级别和成本提示 |
| 数量 | Stepper/selector | 显示当前数量和边界 |
| 生成 | Ember primary | running 时变为 Stop |
| 失败 | Retry | 显示失败原因或进入详情 |

控件之间使用 4-8px 间距，不能把每个参数都做成大型按钮。

生成按钮：

- 高度 34-38px。
- 圆角 8px。
- 图标 15-16px。
- 空输入时 disabled。
- 运行中切换为方形 Stop 图标。
- 失败后切换为 Retry 语义。
- 只有生成按钮使用高权重 Ember 实心表面。

## 25. User Prompt Block

用户输入在时间线中显示为轻量内容块，不使用普通聊天气泡：

```text
┌──────────────────────────────────┐
│ 参考提示词                         │
│ 雨天街道、低饱和、电影感...         │
│ [历史来源] [4 张图片]               │
└──────────────────────────────────┘
```

Light：`--bg-elevated` + 1px subtle border。

Dark：`--bg-elevated` 与 MainView 形成低对比差。

规格：

- 圆角 10px。
- 内边距 12px。
- 正文 13px。
- 来源标签 11px。
- 长 prompt 默认折叠摘要，展开时不改变邻近内容的操作语义。

## 26. Generation Result Grid

图片是 MainView 的视觉主角，必须使用稳定比例：

```text
单张：
┌──────────────────────┐
│                      │
│       image          │
│                      │
└──────────────────────┘

多张：
┌────────┐ ┌────────┐ ┌────────┐
│ image  │ │ image  │ │ image  │
└────────┘ └────────┘ └────────┘
```

结果卡：

- 圆角 14px。
- 固定 `aspect-ratio`。
- 1px media border。
- Light 使用轻微 `shadow-sm`。
- Dark 使用 `#2a2c30` 承托。
- hover 显示局部动作层。
- 不添加图片底部渐变遮罩。
- 加载和失败保持同样比例。

操作：

- 放大。
- 下载。
- 保存为提示词。
- 加入设计方案。
- 继续微调。
- 更多。

## 27. 生成状态

### 27.1 Loading

- 保持图片容器比例。
- 使用低对比 skeleton 或单一 loading indicator。
- 不使用大面积 shimmer。
- Composer 变为停止状态。

### 27.2 Success

- 图片使用 `opacity + transform` 进入。
- 动画结束后恢复静态 Operate 状态。
- 不做持续循环动画。
- 成功图立即显示保存、微调和加入方案动作。

### 27.3 Partial Success

```text
已完成 3/4
[成功图] [成功图] [成功图] [失败重试]
```

成功项可继续操作，失败项保持原比例并提供单项重试。

### 27.4 Error

- 失败项保留原比例。
- 显示错误原因。
- 提供 Retry。
- danger 不与 Ember 混用。

## 28. Right Context Dock

```text
┌───────────────────────┐
│ 参考素材  参数  历史 方案 │
├───────────────────────┤
│ 当前标签内容             │
│                         │
│                         │
│                         │
└───────────────────────┘
```

建议尺寸：

```text
default: 304px
min:     260px
max:     420px
```

Dock 视觉：

- Light 使用 `--bg-sidebar` 或 elevated。
- Dark 使用 `#1b1c1f`。
- MainView 与 Dock 之间 1px 分缝。
- Dock 外侧右上/右下使用 12px 圆角。
- 标签栏高度 32px。
- selected 使用底部 Ember indicator 或 accent soft。
- 内容区独立滚动。
- Dock 打开时 MainView 和 Composer 同时变窄。

建议标签：

```text
参考素材
参数
历史
设计方案
```

右侧标签搜索使用局部 Popover，不使用全屏遮罩。

## 29. 本轮工作台决策

### 29.1 工作台核心模型

推荐：

```text
媒体优先的连续时间线
```

保留 ZCode 的任务连续性，但让图片结果成为主内容；文字只解释上下文、状态和参数。

### 29.2 Composer 形式

推荐：

```text
Composer 作为 MainView 底部独立 raised tool
```

它不是普通页面底栏，而是每次创作都要反复使用的核心工具。

### 29.3 Right Dock 宽度

推荐：

```text
304px
```

280px 对图片缩略图、参数和来源卡略紧；320px 以上会明显压缩中央结果区。304px 是内容密度和主工作面之间的平衡点。

## 30. 本轮工作台验收

- [ ] MainView 是 12px 圆角工作面，而不是聊天气泡集合。
- [ ] Composer 是 12px raised tool，内部输入区是 inset surface。
- [ ] Context Tray 能识别来源并支持移除。
- [ ] Mode Bar 能表达图像、设计方案和锁定状态。
- [ ] 生成按钮是唯一高权重 Ember 实心按钮。
- [ ] 图片结果使用 14px 圆角和稳定比例。
- [ ] Loading、Success、Partial、Error 状态不改变结果尺寸。
- [ ] Right Dock 默认约 304px，打开时真实压缩 MainView。
- [ ] Dock 内部滚动，标签搜索使用局部 Popover。
- [ ] ZCode 的空间结构被继承，但没有编码语义残留。

## 31. 工作台动作菜单升级

工作台的高频动作分成两层：

```text
回合动作：再次制作 / 存为提示词 / 查看生成历史
结果动作：保存 / 复制 / 微调 / 打开所在目录 / 查看生成历史
```

### 31.1 回合动作

`WorkbenchTurnActions` 使用共享 `DropdownMenu`，触发器收敛为回合下方的省略号 `IconButton`，可访问名称为“更多回合操作”，hover tooltip 为“更多操作”。菜单固定向上展开，宽度 176px，使用 `--bg-popover`、8px 圆角和 `--shadow-pop`。由于内容通过 Portal 渲染，菜单不会把后续回合向下推，也不会改变 Composer 的居中靠下位置。

菜单行沿用 32px 紧凑密度，图标统一 14px，普通动作使用次级文字色，hover 使用整行高亮。宿主注入的“存为提示词”作为同一菜单集合中的单行控件参与键盘导航，不能再嵌套第二个 button。

### 31.2 结果卡片动作

结果卡片媒体表面保留保存、复制、微调三个高频图标动作；打开目录和查看历史属于低频动作，收纳在右下角的更多按钮中。共享菜单宽度 176px，向上展开并右边缘对齐卡片，避免被结果卡片或 MainView 的 overflow 裁剪。

```text
┌────────────── result media ──────────────┐
│                                          │
│  [保存] [复制] [微调]              [...] │
│                                      ┌───┐ │
│                                      │打开│ │
│                                      │历史│ │
│                                      └───┘ │
└──────────────────────────────────────────┘
```

两类菜单都由共享原语提供首项聚焦、方向键、Home / End、Escape 和触发器焦点归还。页面业务只负责动作和状态，不再维护 document 级 pointerdown / keydown 监听；因此菜单关闭不会误触发回合、卡片或 Composer 的外层交互。

### 31.3 主工作面与 Composer 叠层契约

已有会话的布局必须先建立中央主工作面，再把 Composer 作为它的贴底层：

```text
mf-workbench-page
└── mf-workbench-primary  position: relative / flex: 1 / column
    ├── mf-workbench-stage  flex: 1 / min-height: 0 / scroll
    └── Composer            absolute / inset: auto 0 0
```

主工作面是 Composer 的定位上下文，避免 Composer 相对整个窗口定位；时间线则通过底部 `220px` 安全内距保持末尾回合动作可见、可点击。该契约同时保证 Composer 始终位于中央工作区水平中心，不随右侧上下文面板的开关漂移到页面边缘。

### 31.4 Composer 上下文菜单第六批收口

Composer 左下角“添加上下文”入口使用紧凑动作菜单，不再横跨 Composer：浮层由共享 Dropdown 承载，向上展开，内容宽度限制为 `min(304px, calc(100vw - 16px))`，最大高度不超过可用桌面高度，避免把长列表推出窗口。

- 菜单表面使用 `--bg-popover`、8px 外圆角、`--shadow-pop` 和 1px 极细 border；富信息菜单项使用 6px 圆角、40px 最小高度。主动作只用 accent 图标建立优先级，不增加独立 inset 卡片；分组使用真实 `DropdownMenuLabel` / `DropdownMenuSeparator`。
- Portal 让菜单脱离 `mf-workbench-primary` 的 overflow 约束，但不改变 `mf-workbench-stage`、回合时间线底部安全内距和 Composer 的居中靠下定位。
- 首项聚焦、方向键、Home / End、Escape 和触发器焦点归还由共享原语负责；页面不再监听 document 级 pointerdown / keydown。
- 菜单动作仍保持原有业务 test id 和上下文来源分类，选中后只改变 Composer 的上下文状态，不重排已有回合。
