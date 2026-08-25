# 07. 浮层、引导与响应式状态

## 1. 页面定位

浮层是 2.0 的空间控制系统。必须区分：

```text
Tooltip       解释一个按钮
Popover       选择一个局部选项
Context Menu  处理一行或对象
Command       跨页面搜索和动作
Dialog        中断、编辑或确认
Theater Modal 引导和高价值首次体验
```

不能把所有交互都做成相同的圆角弹层。

## 2. ZCode 对比截图

### 2.1 引导弹窗

![ZCode 引导弹窗](./references/zcode/zcode-onboarding-dark.jpeg)

ZCode 引导值得借鉴：

- 背景保留可辨认的应用空间。
- 中央 modal 有明显左右信息层级。
- 主按钮和迁移按钮分级清晰。
- 关闭按钮在右上角。

Musefold 2.0 会把右侧视觉区域替换为真实创作图像或首张生成图，但不把它做成营销 Hero。

### 2.2 新建任务

![ZCode 新建任务](./references/zcode/zcode-new-task-dark.jpeg)

ZCode 的 Composer 和模板建议为 Musefold 的新建/命令入口提供参照。

## 3. Overlay 层级

```text
Layer 0  Window / Shell
Layer 1  Sidebar / MainView / Dock
Layer 2  Hover action / Tooltip
Layer 3  Popover / Context Menu
Layer 4  Command Palette + scrim
Layer 5  Dialog / Onboarding Modal + scrim
Layer 6  Toast / urgent status
```

规则：

- Popover 不暗化全屏。
- Context Menu 锚定对象，关闭后焦点回到对象。
- Command Palette 使用全屏 scrim，但底层仍保留结构轮廓。
- Dialog 锁定底层交互并恢复触发元素焦点。
- Onboarding 使用 Theater 表面，但不改变全局 Shell 的业务布局。

## 4. Light / Dark 浮层配色

| 浮层 | Light | Dark |
| --- | --- | --- |
| Tooltip | `#202124` + white text | `#f4f4f1` + dark text，仅在需要时反色 |
| Popover | `#fdfcf9` | `#2b2d31` |
| Context Menu | `#fdfcf9` | `#2b2d31` |
| Command Panel | `#fff` | `#25272a` |
| Dialog | `#fff` | `#2b2d31` |
| Onboarding | `#fff` + image surface | `#25272a` + image surface |
| Scrim | `rgba(20,20,24,.24-.42)` | `rgba(0,0,0,.58-.72)` |
| Danger Dialog | danger soft | danger soft |

所有浮层必须有实色兜底，不依赖 blur 才可读。

## 5. Tooltip

用于：

- 收起侧栏。
- 收起 Dock。
- 复制、下载、删除、更多。
- Lightbox 上一张/下一张。
- 低频图标按钮。

规格：

- 6px 圆角。
- 4-6px 垂直 padding，8px 水平 padding。
- 字号 11px。
- 只显示短名称，不放完整帮助文档。
- 延迟 300ms 左右。
- 键盘 focus 也能出现。

## 6. Popover

典型入口：

- 模型选择。
- 比例选择。
- 方案选择。
- 历史来源。
- 主题、密度和语言。
- 筛选和排序。
- 右侧 Dock 标签搜索。

规格：

- 圆角 8-12px，取决于内容复杂度。
- 1px default border。
- `shadow-pop`。
- 内部菜单项圆角 6px。
- 单项最小高度 32px，复杂项 48px。
- 选中项使用 check + accent soft。
- Escape 关闭。

Popover 不改变 MainView、Sidebar 或 Dock 宽度。

## 7. Context Menu

用于项目、会话、提示词、方案、历史结果的对象级动作。

菜单项分组：

- 主要动作。
- 复制/导出。
- 组织动作：置顶、归档、加入方案。
- 危险动作：删除。

危险项使用 danger text，只有在真实危险操作时使用；不要让每个“移除”都成为大红按钮。

## 8. Command Palette

```text
scrim
                ┌──────────────────────────────┐
                │ 搜索 Musefold                 │
                ├──────────────────────────────┤
                │ 最近会话                       │
                │ 新设计                         │
                │ 打开提示词库                   │
                │ 打开设计方案                   │
                │ 打开生成历史                   │
                │ 设置                           │
                └──────────────────────────────┘
```

规格：

- 最大宽度 560px。
- 宽度 `min(560px, calc(100vw - 32px))`。
- 圆角 16px。
- Light white surface + dialog shadow。
- Dark `#25272a` + dark shadow。
- 顶部输入框高度 40px。
- 结果行高度 36-44px。
- 支持分组、快捷键、键盘上下、Enter、Escape。

与 ZCode 的差异：结果不再围绕项目、文件和终端，而围绕新设计、提示词、方案、历史和设置。

## 9. Dialog

通用 Dialog：

- 宽度 400-560px。
- 圆角 16px。
- 头部 20px padding。
- 内容 20px padding。
- 底部 actions 16-20px padding。
- 取消使用 ghost/subtle。
- 确认使用 primary 或 danger。
- Escape 关闭非阻断 Dialog。

Dialog 场景：

- 删除/永久删除。
- 编辑提示词。
- 连接服务商。
- 导入/导出。
- 成本看板。
- 历史详情或媒体 Lightbox。

## 10. Onboarding Theater Surface

### 10.1 结构

```text
scrim + blurred shell
┌────────────────────────────────────────────────────────────┐
│ [首次启动]                                         [×]    │
│                                                            │
│ 左：Musefold 标识 / 文案 / 主次动作                         │
│                                                            │
│ 右：真实生成图或工作台预览                                  │
└────────────────────────────────────────────────────────────┘
```

### 10.2 Light

- Modal：`#fff`。
- 左侧文字：`#202124`。
- 主按钮：Ember。
- 右侧图像 surface：`#f0f0ed`。
- scrim：`rgba(20,20,24,.32)`。

### 10.3 Dark

- Modal：`#25272a`。
- 左侧文字：`#f4f4f1`。
- 主按钮：Ember。
- 右侧图像 surface：`#2a2c30`。
- scrim：`rgba(0,0,0,.68)`。

### 10.4 组件

- 标记标签：4-6px radius，11px。
- Logo/mark：40-48px。
- 标题：28-36px / 600，最多两行。
- 主按钮：38px 高，8px radius。
- 次按钮：38px 高，8px radius，outline。
- 右侧图像：16px radius，稳定 `aspect-ratio`。

不添加版本号、装饰章节编号或渐变背景。

## 11. Toast

Toast 只用于瞬时反馈：

- 已复制。
- 已保存。
- 已送入制作。
- 已加入方案。
- 连接测试成功。
- 操作失败。

规格：

- 圆角 8-10px。
- Light 使用 popover surface。
- Dark 使用 popover surface。
- 左侧语义图标，文字 12px。
- 成功/错误同时使用图标、文字和颜色。
- 不用 Toast 承载需要用户持续处理的错误。

## 12. 响应式布局

### 12.1 760px 以下

- 左侧 Sidebar 变 drawer。
- Dock 默认关闭。
- MainView 保持单列。
- Command Palette 保持居中但宽度缩小。

### 12.2 680px 以下

- TitleBar 仅保留页面标题、菜单和侧栏按钮。
- Composer 控制行允许换行。
- History Inspector 改为 bottom sheet。
- Prompt Detail 改为页面或 bottom sheet。
- 设计方案详情按“说明 / 运行 / 结果”分页。

### 12.3 390px

```text
┌────────────────────────┐
│ [菜单] 页面标题 [更多]  │
├────────────────────────┤
│ 内容单列               │
│                        │
├────────────────────────┤
│ Composer               │
│ [添加] [模型] [生成]    │
└────────────────────────┘
```

不能出现横向滚动；图片使用稳定比例，按钮文字自然换行或降为 icon + tooltip。

## 13. Accessibility

- 所有 icon button 有 aria-label 和 title。
- Popover 打开后焦点进入第一个可选项或搜索框。
- Dialog 关闭后焦点返回触发按钮。
- Command Palette 支持上下、Enter、Escape。
- Switch、tab、radio、segmented 语义正确。
- selected 状态不只依赖颜色。
- reduced motion 关闭弹性入场和 Theater 过渡，仅保留状态反馈。

## 14. 验收

- [ ] Popover、Command Palette、Dialog、Onboarding 层级清晰。
- [ ] Light/Dark 浮层均有实色兜底。
- [ ] 全部浮层可通过 Escape 关闭或按语义阻断。
- [ ] Onboarding 有主次按钮和真实创作内容。
- [ ] 760px、680px、390px 没有遮挡和横向滚动。
- [ ] 右侧 Dock 在窄屏转换为 sheet，而不是硬挤 MainView。
- [ ] 浮层组件使用 2.0 foundation 的圆角和阴影。

## 15. 本轮讨论确认的浮层层级

2.0 需要明确区分不同浮层，不能所有交互都使用同一种圆角弹层：

```text
Layer 0  Window / Shell
Layer 1  Sidebar / MainView / Dock
Layer 2  Hover Action / Tooltip
Layer 3  Popover / Context Menu
Layer 4  Command Palette + Scrim
Layer 5  Dialog / Onboarding Modal + Scrim
Layer 6  Toast / Urgent Status
```

层级规则：

- Popover 不暗化全屏。
- Context Menu 锚定对象，不遮住主要对象名称。
- Command Palette 使用全屏 scrim，但底层仍保留结构轮廓。
- Dialog 锁定底层交互并恢复触发元素焦点。
- Onboarding 使用 Theater 表面，但不改变全局 Shell 的业务布局。

## 16. Light / Dark 浮层表面

| 浮层 | Light | Dark |
| --- | --- | --- |
| Tooltip | `#202124` + 白字 | `#f4f4f1` + 深字 |
| Popover | `#fdfcf9` | `#2b2d31` |
| Context Menu | `#fdfcf9` | `#2b2d31` |
| Command Panel | `#ffffff` | `#25272a` |
| Dialog | `#ffffff` | `#2b2d31` |
| Onboarding | `#ffffff` + 图像面 | `#25272a` + 图像面 |
| Scrim | `rgba(20,20,24,.24-.42)` | `rgba(0,0,0,.58-.72)` |
| Danger Dialog | danger soft | danger soft |

所有浮层必须有实色背景，不依赖 blur 才可读。

## 17. Tooltip 细节

用于：

- 收起 Sidebar。
- 收起 Dock。
- 复制、下载、删除、更多。
- Lightbox 上一张/下一张。
- 低频 icon button。
- 收起文字后的窄屏导航。

规格：

- 圆角 6px。
- 水平 padding 8px。
- 垂直 padding 4-6px。
- 字号 11px。
- 只显示短名称。
- 延迟约 300ms。
- 键盘 focus 也能出现。
- 不承载复杂帮助文档。

## 18. Popover 细节

典型入口：

- 模型选择。
- 比例选择。
- 方案选择。
- 历史来源。
- 主题和密度。
- 筛选和排序。
- Dock 标签搜索。
- 账户和连接菜单。

规格：

- 圆角 8-12px。
- 1px default border。
- 使用 `shadow-pop`。
- 内部菜单项圆角 6px。
- 普通菜单项高度 32px。
- 复杂菜单项高度 48px。
- 当前项使用 check + Ember soft。
- Escape 关闭。
- 关闭后焦点返回触发按钮。

Popover 不改变 Sidebar、MainView 或 Dock 的宽度。

## 19. Context Menu 细节

用于会话、提示词、设计方案、历史结果、归档聊天和服务商行。

菜单分组：

```text
主要动作
复制/导出
组织动作
危险动作
```

危险项使用 danger text，但不能让每个“移除”都成为大红按钮。

菜单打开后：

- 锚定当前对象。
- 不遮住对象名称。
- Escape 关闭。
- 删除进入确认流程。
- 关闭后焦点返回原始对象。

## 20. Command Palette 细节

```text
scrim

                ┌──────────────────────────────┐
                │ 搜索 Musefold                 │
                ├──────────────────────────────┤
                │ 最近会话                       │
                │ 新设计                         │
                │ 打开提示词库                   │
                │ 打开设计方案                   │
                │ 打开生成历史                   │
                │ 设置                           │
                └──────────────────────────────┘
```

Musefold 命令分类：

```text
最近会话
创作动作
提示词
设计方案
历史结果
打开页面
设置
账户和接入
```

规格：

- 最大宽度 560px。
- 宽度 `min(560px, calc(100vw - 32px))`。
- 圆角 16px。
- Light 使用 white surface + dialog shadow。
- Dark 使用 `#25272a` + dark shadow。
- 顶部输入框高度 40px。
- 结果行高度 36-44px。
- 支持上下、Enter、Escape。
- 打开后焦点自动进入输入框。

## 21. Dialog 细节

通用 Dialog：

- 宽度 400-560px。
- 圆角 16px。
- Header padding 20px。
- Content padding 20px。
- Footer padding 16-20px。
- 取消使用 ghost/subtle。
- 确认使用 primary 或 danger。
- Escape 关闭非阻断 Dialog。
- 关闭后焦点返回触发按钮。

适用场景：

- 删除和永久删除。
- 编辑提示词。
- 连接服务商。
- 导入/导出。
- 成本看板。
- 图片 Lightbox。
- 账户切换。

不适用场景：

- 普通页面导航。
- 模型选择。
- 比例选择。
- 普通筛选。
- 低风险开关。

这些场景使用 Popover 或页面内结构。

## 22. Onboarding Theater Surface

```text
scrim + dim shell

┌────────────────────────────────────────────────────────────┐
│ [首次启动]                                         [×]    │
│                                                            │
│ 左：Musefold 标识 / 文案 / 主次动作                         │
│                                                            │
│ 右：真实生成图或工作台预览                                  │
└────────────────────────────────────────────────────────────┘
```

Light：

```text
Modal：#ffffff
左侧文字：#202124
主按钮：#d6653f
右侧图像面：#f0f0ed
Scrim：rgba(20,20,24,.32)
```

Dark：

```text
Modal：#25272a
左侧文字：#f4f4f1
主按钮：#ef7a52
右侧图像面：#2a2c30
Scrim：rgba(0,0,0,.68)
```

组件：

- 标签 4-6px radius，11px。
- Logo 40-48px。
- 标题 28-36px / 600，最多两行。
- 主按钮 38px 高，8px radius。
- 次按钮 38px 高，8px radius，outline。
- 右侧图像 16px radius，稳定 aspect ratio。

不添加版本号、装饰性章节编号、渐变背景或大型发光 Logo。

## 23. Onboarding 流程

建议流程：

```text
欢迎使用 Musefold
        ↓
连接服务商
        ↓
选择图像来源
        ↓
生成第一张图
        ↓
查看结果并保存
```

Theater 只重点强化两个时刻：

```text
第一次进入
第一次生成成功
```

其它步骤使用 Operate 的清晰表单结构。

第一次成功时：

```text
Prompt / Controls 退后
真实图片成为主角
图片显形
显示保存、继续和加入方案
恢复工作台
```

不让每一步都变成大动画。

## 24. Toast 细节

只用于瞬时反馈：

- 已复制。
- 已保存。
- 已送入制作。
- 已加入方案。
- 连接测试成功。
- 操作失败。

规格：

- 圆角 8-10px。
- Light 使用 Popover surface。
- Dark 使用 Popover surface。
- 左侧语义图标。
- 文字 12px。
- 成功/错误同时使用图标、文字和颜色。
- 持续错误留在发生位置，不只使用 Toast。

## 25. 760px 以下

```text
Sidebar → Overlay Drawer
Dock → 默认关闭或 Bottom Sheet
MainView → 单列
```

行为：

- Sidebar 打开时显示 scrim。
- 点击新设计、导航或会话后关闭。
- Drawer 宽度使用 `min(320px, max(220px, calc(100vw - 28px)))`。
- Dock 不强行挤压中央内容。
- 图片结果降为两列或一列。
- Composer 控制行允许换行。

## 26. 680px 以下

- Sidebar 变为左侧 drawer。
- Dock 变为 bottom sheet。
- History Inspector 变为 bottom sheet。
- Prompt Inspector 变为详情页或 bottom sheet。
- 设计方案详情按“详情 / 运行 / 结果”切换。
- Composer 保持固定底部。
- 参数控件可以横向滚动，但页面整体不允许横向滚动。
- 页面标题和主要动作保持可见。

## 27. 390px 手机宽度

```text
┌────────────────────────┐
│ [菜单] 页面标题 [更多]  │
├────────────────────────┤
│ 内容单列               │
│                        │
├────────────────────────┤
│ Composer               │
│ [添加] [模型] [生成]    │
└────────────────────────┘
```

原则：

- 不出现横向滚动。
- 图片使用稳定比例。
- 文字按钮必要时变成 icon + tooltip。
- Composer 控制分成两行。
- 底部动作不被 Home Indicator 遮挡。
- Dialog 改为接近全宽 sheet。
- 内容 padding 16px。

## 28. Accessibility 与焦点

- 所有 icon button 有 `aria-label` 和 title。
- Popover 打开后焦点进入第一个选项或搜索框。
- Dialog 关闭后焦点返回触发按钮。
- Command Palette 支持上下、Enter、Escape。
- Switch、tab、radio、segmented 使用正确语义。
- selected 不只依赖颜色。
- reduced motion 关闭弹性入场和 Theater 过渡。
- 必要 loading 状态仍然保留。
- 键盘顺序与视觉顺序一致。

## 29. 本轮浮层决策

### 29.1 Onboarding Theater

推荐：

```text
首次欢迎和第一次生成成功使用 Theater
其它步骤使用 Operate
```

这样能形成品牌记忆，同时不会让设置和连接表单过度装饰。

### 29.2 移动端 Dock

推荐：

```text
Dock → Bottom Sheet
```

参考素材、参数和历史内容仍然保留，但不缩窄手机上的主工作台。

### 29.3 Command Palette 宽度

推荐：

```text
桌面最大 560px
移动端 calc(100vw - 32px)
```

它是跨页面动作中心，不是某一个功能页的搜索框。

## 30. 本轮浮层验收

- [ ] Popover、Command Palette、Dialog、Onboarding 层级清晰。
- [ ] Light/Dark 浮层均有实色兜底。
- [ ] 全部浮层可通过 Escape 关闭或按语义阻断。
- [ ] Onboarding 有主次按钮和真实创作内容。
- [ ] 760px、680px、390px 没有遮挡和横向滚动。
- [ ] 右侧 Dock 在窄屏转换为 sheet，而不是硬挤 MainView。
- [ ] Toast 只处理瞬时反馈。
- [ ] Dialog 关闭后焦点返回触发按钮。
- [ ] 浮层组件使用 2.0 foundation 的圆角和阴影。
