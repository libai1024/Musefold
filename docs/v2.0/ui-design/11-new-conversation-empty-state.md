# 11. 新对话首屏：品牌锁定区与 Composer

> 状态：基于本地参考页面的 2.0 设计方案
>
> 参考页面：`http://127.0.0.1:58627/sessions/session_0bbb4d0b-f8e6-4bc0-a034-40c666f47013`
>
> 相关文件：`02-generation-workbench.md`、`00-visual-foundation.md`、`10-phase-b-sidebar-layout.md`

## 1. 页面定位

新对话不是一个空白占位页，也不是营销 Hero。它是用户进入 Musefold 后第一次开始创作的工作台入口，必须在第一眼回答三件事：

1. 这是 Musefold 的创作空间。
2. 我可以在这里描述一个视觉目标。
3. 我可以马上进入 Composer，而不是先寻找“新建”按钮。

首屏布局固定为：

```text
固定 Sidebar
        │
        └── MainView 新对话空态
              ├── Logo + Musefold
              ├── 换行提示语
              └── Composer
                    ├── Prompt 输入区
                    ├── 附件 / 创作模式
                    ├── 模型 / 参数 / 生成
                    └── 当前工作区 / 方案来源
```

它和已有任务共享同一 Composer 数据模型，但不是同一个垂直定位：

| 状态 | 主内容 | Composer 位置 | 品牌锁定区 |
|---|---|---|---|
| 新对话空态 | Logo、名称、提示语 | 主区中下部，紧跟品牌区 | 显示 |
| 已有会话 | 消息/生成时间线 | 贴近底部，固定宽度 | 隐藏 |
| 生成中 | 运行状态和结果 | 底部保持可见 | 隐藏 |
| 重新开始 | 清空草稿后的空态 | 回到空态锚点 | 显示 |

## 2. 参考页面与 ZCode 对照

![ZCode 新建任务参考](./references/zcode/zcode-new-task-dark.jpeg)

参考页面的 DOM 结构是：

```text
.panes.chat-scroll
└── .content-wrap.align-center
    ├── .empty-spacer
    ├── .empty-hint
    │   ├── .empty-doodle
    │   └── .empty-hint-text
    ├── .empty-composer
    │   └── .composer-card
    │       ├── .input-row
    │       └── .toolbar
    ├── .composer-footer
    │   └── .ws-bar
    └── .empty-spacer.empty-tail
```

本地页面的实测布局基线（1280×720 viewport）：

| 节点 | 实测结果 | 2.0 采用方式 |
|---|---:|---|
| MainView 主区 | x=270，宽 1010px | 由三栏 Shell 剩余空间提供 |
| 内容列 | x=393，宽 760px | 新对话使用 `max-width: 760px` |
| 空态品牌/提示区域 | 宽 760px | 替换为 Musefold Brand Lockup |
| Composer 外卡 | 宽约 728px | 内容列左右保留约 16px |
| Composer 输入区 | 高约 42-69px | 通过内容长度在范围内增长 |
| Toolbar | 高 44px | 左右两组稳定排列 |
| 工作区条 | 高约 56-70px | 当前工作区 / 方案来源 |
| 已有会话 Header | 高 48px | 复用 Task Header |

保留的空间关系：

- 内容列窄于 MainView，避免 Composer 横向铺满工作台。
- 空态信息和 Composer 同一条中心轴。
- Composer 的输入区、控制区和工作区条是连续工具，不是三张卡片。
- 已有会话时，Composer 与消息流共享同一内容列宽度。

必须替换的语义：

- Kimi doodle → Musefold Logo Mark。
- “还没有消息” → 面向图像创作的短提示语。
- Kimi 模型 pill → Musefold 模型与质量选择器。
- “选择文件夹” → 当前工作区 / 方案来源。
- Agent 权限 pill → 创作模式或生成确认模式；没有对应能力时隐藏，不虚构控制项。

## 3. MainView 几何

### 3.1 桌面宽屏

```text
MainView surface
┌─────────────────────────────────────────────────────────────┐
│ optional Task Header                                        │
│                                                             │
│                    Brand Lockup                             │
│                  [mark] Musefold                            │
│                把想法变成可生成的视觉                       │
│                                                             │
│                    24-32px gap                              │
│             ┌──────────────────────────┐                    │
│             │ Composer                  │                    │
│             │ prompt                    │                    │
│             │ controls                  │                    │
│             │ workspace / scheme       │                    │
│             └──────────────────────────┘                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- MainView frame 使用 4px inset，surface 使用 12px radius。
- 新对话内容列最大宽度 760px，最小宽度为 `calc(100% - 32px)`。
- Brand Lockup 与 Composer 共用中心轴，不能分别用不同的 max-width。
- Composer 外卡最大宽度约 728px；如果内容列只有 680px，卡片随列收缩。
- 新对话不显示空的 Task Header；页面标题由 Sidebar 当前入口和 Brand Lockup 共同提供。
- 如果产品需要显示当前工作区标题，放在 Brand Lockup 上方 12px 的低对比 meta 行，不增加独立 header 卡片。

### 3.2 垂直定位

新对话需要“视觉居中但操作略靠下”：

```text
viewport height
├── top breathing space 约 15-20%
├── Brand Lockup 约 84-112px
├── gap 24-32px
├── Composer 约 180-220px
└── bottom breathing space 约 12-16%
```

不要使用固定 `top: 50%` 把 Composer 本身居中。推荐使用内容列的 flex column，并通过 `padding-block: clamp(72px, 16vh, 140px)` 控制首屏呼吸空间。这样键盘打开、窗口变矮、Composer 增高时，不会让 Logo 与输入框重叠。

## 4. Brand Lockup

### 4.1 组件结构

```text
.new-conversation-brand
├── .brand-line
│   ├── MusefoldMark
│   └── brand-name: Musefold
└── .brand-tagline: 把想法变成可生成的视觉
```

### 4.2 规格

| 项目 | Light | Dark |
|---|---|---|
| Logo Mark | Ember 或 primary 双色细节 | Ember 高亮但不发光 |
| Logo 尺寸 | 32×32px | 32×32px |
| 名称字号 | 22px / 650 | 22px / 650 |
| 名称颜色 | `fg-primary` | `fg-primary` |
| Logo 与名称间距 | 8px | 8px |
| 提示语字号 | 13px / 400 | 13px / 400 |
| 提示语颜色 | `fg-tertiary` | `fg-tertiary` |
| 行间距 | 8px | 8px |
| Brand 到 Composer | 24-32px | 24-32px |

品牌名称和提示语必须换行。不要把提示语放在名称右侧，也不要把 Logo 变成 Composer 内部的装饰图标。名称只在新对话中央出现一次，Sidebar 的品牌仍保持紧凑的 20px mark + 13px 名称。

### 4.3 文案规则

推荐提示语：

- `把想法变成可生成的视觉`
- `描述一个画面，开始你的创作`
- `从一句提示词开始，建立你的视觉方向`

只选一条，不轮播。提示语是界面定位，不是功能说明，不追加长段产品介绍。用户开始输入后，Brand Lockup 不应突然切换文案；提交首条任务后才退出空态。

## 5. Composer 外框

### 5.1 空态变体

空态 Composer 是首屏焦点，允许比已有任务 Composer 更柔和：

| 属性 | Light | Dark |
|---|---|---|
| 外框背景 | `bg-elevated #ffffff` | `bg-elevated #25272a` |
| 外框边界 | `border-default` 0.5-1px | `border-subtle` 1px |
| 外框半径 | 20px | 20px |
| 阴影 | `shadow-composer` 低强度 | 黑色 `shadow-composer` |
| 内部输入面 | `bg-inset #f0f0ed` 或透明 | `bg-inset #121315` 或透明 |
| 底部工作区条 | `bg-inset` 低对比 | `bg-inset` 低对比 |
| 默认外框宽度 | 728px max | 728px max |
| 最小左右边距 | 16px | 16px |

20px 是空态外框的上限，不表示每个内部元素都使用 20px。输入、selector、icon button 和状态 chip 继续使用 8px、6px 或 999px 的局部半径。

### 5.2 已有任务变体

已有任务 Composer 回到更紧凑的 12px 外框：

- 内容流和 Composer 之间更少的垂直间距。
- 不再显示中央 Brand Lockup。
- Context Tray 有内容时出现在输入区上方。
- Composer 仍保持约 728px 内容宽度。
- 当前工作区条仍作为 Composer 底部的一部分。

这样空态和已有任务可以共享 `ComposerFrame`，只通过 `variant="empty" | "active"` 改变外框半径、上下间距和 Brand Lockup，而不是复制两份组件。

## 6. Composer 内部层级

```text
┌───────────────────────────────────────────────┐
│ Prompt Surface                                 │  69px 起
│ 输入想生成的画面……                             │
├───────────────────────────────────────────────┤
│ [添加] [创作模式]              [模型/质量] [生成] │  44px
├───────────────────────────────────────────────┤
│ [当前工作区 / 方案来源                         │  56-70px
└───────────────────────────────────────────────┘
```

参考页的 DOM 把工作区条放在 Composer 外部的 footer；Musefold 2.0 视觉上仍保持连续，但组件 API 上建议让它成为 `ComposerFrame` 的 footer slot。这样可以同时支持：

- 空态显示当前工作区。
- 进入设计方案时显示方案来源。
- 没有工作区能力时隐藏 footer，并保持 Composer 的底部圆角。

### 6.1 Prompt Surface

- placeholder：`描述你想生成的画面…`。
- 最小高度 64px，默认可显示 2-3 行。
- `textarea` 不使用厚边框，依靠 Composer 外框和 inset surface 区分。
- focus 时只加 Ember 低透明 ring，不让整个外框变成橙色。
- 输入长于最大高度时内部滚动，Composer 不超过视口底部安全区。
- IME 中文输入时不提交；Enter 提交，Shift+Enter 换行，行为在 tooltip/aria label 中保持一致。

### 6.2 左侧工具组

左侧保持低频入口：

| 控件 | 规格 | 行为 |
|---|---|---|
| 添加附件 | 32px icon button，半径 8px | 打开附件菜单或文件选择 |
| 参考图 | 有参考图时显示 thumb chip | 可移除，不直接删除原文件 |
| 创作模式 | 仅能力存在时显示 | 在生成/确认模式间切换 |
| 快捷建议 | 最多 3 项，低权重 | 只填入草稿或打开上下文 |

添加附件使用 `Plus` 图标；不使用写死的 SVG。每个 icon button 都必须有 label 和 tooltip。附件拖拽覆盖层只覆盖 Composer，不遮挡 Brand Lockup。

### 6.3 右侧工具组

右侧按“先选择，再执行”排列：

```text
[模型] [质量/比例] [生成]
```

- 模型 selector 是 32px compact control，显示当前模型短名称。
- 质量、比例等高频参数可收进一个参数 Popover，避免小屏溢出。
- 生成按钮 34-38px，8px radius，Ember filled。
- 空 prompt 时生成按钮 disabled，但仍保留稳定尺寸。
- 运行中变成 Stop；失败后变成 Retry；状态切换不改变宽度。
- Ember 不用于模型可用状态、成功提示或错误提示。

### 6.4 工作区 / 方案来源条

底部条对应参考页的 `ws-bar`，但 Musefold 采用更明确的上下文语义：

```text
[Folder] Musefold / 当前工作区                         [⌄]
```

或：

```text
[Scheme] 雨天城市视觉方案                              [⌄]
```

- 高度 56-70px，包含安全的上下 padding。
- 文字 12px，图标 16px，右侧 chevron 14px。
- Light 使用 `bg-inset` 低对比灰，Dark 使用 `bg-inset` 低对比黑。
- 选择器展开为 Popover，不直接把工作区列表插入 Composer 高度。
- 没有工作区时显示 `选择工作区`，而不是 `暂无` 这种死状态；点击可打开创建或选择入口。

## 7. 空态交互状态

### 7.1 Initial

- Brand Lockup 可见。
- Prompt placeholder 可见。
- 生成按钮 disabled。
- 当前工作区条可用。
- Composer 使用 20px 外框。

### 7.2 Focused

- Brand Lockup 保持不动。
- 输入区 Ember focus ring 1-2px，透明度 0.24-0.32。
- 生成按钮仍根据文本长度决定 disabled/enabled。
- 不让整张 Composer 的阴影跳变过大。

### 7.3 Has Draft

- 输入区至少显示一行真实内容。
- 生成按钮 enabled。
- 快捷建议可隐藏，减少视觉干扰。
- 附件和参数选择不会让品牌区上下跳动。

### 7.4 Submitting

- 生成按钮切换 Stop 图标和运行文字 tooltip。
- Composer 外框保留原宽高；只更新状态和按钮内容。
- Brand Lockup 可以淡出，但不使用向上/向下位移造成跳变。
- 首条消息创建后页面切换到 active variant。

### 7.5 Error

- Composer 保留输入草稿。
- 错误提示出现在 Composer 下方或局部 status row，不插入大红色卡片。
- 生成按钮改为 Retry，保留稳定宽度。
- 错误文案不覆盖工作区条。

## 8. Light / Dark 配色

### 8.1 Light

```text
Window          #f6f6f4
Sidebar         #efefec
MainView        #fafaf8
Brand name      #202124
Tagline         #74777c
Composer        #ffffff
Prompt inset    #f0f0ed
Workspace bar   rgba(24,24,29,.045)
Ember           #d6653f
```

Light 下 Composer 不能和纯白窗口融为一体。使用 MainView 的暖灰背景、0.5-1px 边界和低强度 shadow-composer 建立层次。

### 8.2 Dark

```text
Window          #151619
Sidebar         #1b1c1f
MainView        #1d1f22
Brand name      #f4f4f1
Tagline         #a0a2a7
Composer        #25272a
Prompt inset    #121315
Workspace bar   rgba(0,0,0,.28)
Ember           #ef7a52
```

Dark 下不要把 Composer 做成纯黑，也不要给 Logo 叠加橙色 glow。对比来自 `#1d1f22` 到 `#25272a` 的表面关系，Ember 只用于 mark、focus 和生成。

## 9. 三栏 Shell 中的关系

```text
┌──────────────┬───────────────────────────────────┬──────────────┐
│ Sidebar      │ MainView                          │ Dock         │
│              │                                   │              │
│ 新设计       │           Brand Lockup             │ 默认关闭      │
│ 功能         │      Logo + Musefold              │              │
│ 最近会话     │      提示语                         │              │
│              │                                   │              │
│ 账户         │           Empty Composer            │              │
└──────────────┴───────────────────────────────────┴──────────────┘
```

- 新对话空态默认关闭右侧 Dock，给品牌和 Composer 留出完整中心空间。
- 如果用户从 Prompt Library、History 或 Design Scheme 进入新对话，Dock 可以预先打开，但 Brand Lockup 不应被 Dock 覆盖。
- Dock 打开后只压缩 MainView 内容列，不能把 Composer 变成浮层。
- Sidebar 的品牌和 MainView 的品牌锁定区是两个层级：左边是产品导航，中央是当前创作状态。

## 10. 响应式

### 10.1 960px 以上

- Brand Lockup 保持 32px mark + 22px 名称。
- Composer max-width 728px。
- 工作区条完整显示名称和来源。

### 10.2 680-960px

- 内容列宽度使用 `min(728px, calc(100% - 32px))`。
- 模型、质量和比例可合并到参数 Popover。
- Brand Lockup 不缩小字号，减少上下留白。
- Dock 默认收起。

### 10.3 390-680px

- MainView frame inset 0-2px，surface radius 8px。
- Logo 28px，名称 20px，提示语 12px。
- Composer 宽度为 `calc(100% - 24px)`，外框 radius 16px。
- 左右工具组允许换成两行，但发送按钮始终固定在可见区域。
- 工作区条只显示 mark + 短名称，完整来源在 Popover 中查看。
- Composer 底部使用 `env(safe-area-inset-bottom)`。

## 11. 可访问性与键盘行为

- `textarea` 使用可读的 label 或 placeholder，不把 Brand Lockup 当作 label。
- 发送按钮的 accessible name 同时表达状态：发送、停止、重试。
- 模型和工作区选择器使用 `aria-haspopup="menu"`，展开状态同步 `aria-expanded`。
- 附件菜单和工作区 Popover 关闭后，焦点返回对应触发按钮。
- 输入法组合期间不触发 Enter 提交。
- `prefers-reduced-motion` 下取消 Brand Lockup 淡出和 Composer 状态位移动画。
- disabled 的生成按钮仍可通过 aria-describedby 说明“输入提示词后可生成”。

## 12. 实现边界

推荐共享层负责：

- `NewConversationEmptyState` 的结构。
- `ComposerFrame` 的 empty/active variant。
- Brand Lockup、Prompt Surface、Toolbar、Workspace footer slots。
- 稳定的 test id、aria label 和尺寸 token。

桌面宿主负责：

- 当前工作区和方案来源的数据注入。
- 模型列表、生成参数和运行状态的 gateway 连接。
- 文件选择、IPC、Provider 能力和安全存储。

不在本文件引入：

- 新的数据库字段。
- 新的 IPC channel。
- 新的 Logo 资产格式。
- 与业务契约平行的 Composer 数据类型。
- 自动生成行为的改变。

## 13. 验收清单

- [ ] 新对话首屏出现 Logo + Musefold，提示语在下一行。
- [ ] Brand Lockup 和 Composer 共用 760px 内容列中心轴。
- [ ] Composer 默认约 728px 宽，空态外框 20px，已有任务外框 12px。
- [ ] 输入区、工具栏、工作区条保持连续组件关系。
- [ ] Light/Dark 的表面、边界、阴影和 Ember 使用符合 2.0 token。
- [ ] 空态、聚焦、有草稿、提交中、错误状态尺寸稳定。
- [ ] 空态默认不显示右侧 Dock；从上下文入口进入时 Dock 不覆盖 Composer。
- [ ] Sidebar 继续固定左侧，MainView 不被品牌区撑出额外横向滚动。
- [ ] 1280×720、1208×768、960×768、680×900、390×844 无重叠和溢出。
- [ ] 新对话推荐入口只填充草稿或打开上下文，不自动生成。
- [ ] 已有任务不重复显示 Brand Lockup，Composer 仍保留同一交互骨架。

## 14. 下一轮实现讨论

下一轮进入 Composer 细节，建议按以下顺序确认：

1. Prompt Surface 的默认高度和中文输入换行行为。
2. 左侧“添加附件 / 创作模式”是否全部保留，还是按能力动态隐藏。
3. 右侧模型、比例、质量和生成按钮在 728px 与移动宽度下的折叠规则。
4. `Musefold / 当前工作区` 选择条是否在空态默认显示，还是只有完成工作区选择后显示。
