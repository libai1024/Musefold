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

## 31. 桌面端实现进度（2026-08-26）

桌面端已完成 Command Palette、Onboarding Theater，以及第一批通用浮层原语和工作台菜单升级。响应式章节仍是后续实现依据，本阶段按开发约定不做手机端测试，也不把桌面通过等同于移动端通过。

### 31.1 Command Palette

已落地：

- 独立 `Command` 层级，scrim 使用 `--scrim-command`，不与普通 Dialog 混用。
- 面板宽度 `min(560px, calc(100vw - 32px))`，圆角 16px，使用实色 raised surface 与 `--shadow-dialog`。
- 搜索输入 40px，结果行最小 40px，行内图标、主标签、辅助信息保持稳定槽位。
- 输入使用 combobox 语义，结果区使用 listbox / option 语义；活动项通过 `aria-activedescendant` 暴露。
- 上下键切换活动项时自动将目标行滚入视口，Enter 执行动作，Escape 由 Radix Dialog 关闭。
- 不在面板中长期展示快捷键教学文字，键盘能力保留为标准交互。

对应实现：

```text
apps/desktop/src/components/command/CommandPalette.tsx
apps/desktop/src/styles/overlays-v2.css
```

### 31.2 Onboarding Theater

已落地：

- 保留 Shell 轮廓的 modal Theater，不再替换成全屏业务页面。
- 1440×900 桌面视口下，surface 固定为 1080×720；更小桌面视口使用 `100vw/100vh - 48px` 约束。
- Theater 圆角 20px；按钮、输入和局部图标控制统一为 8px；状态标签与进度条才允许使用 pill。
- Dark surface 为 `#25272a`、scrim 为 `rgba(0,0,0,.68)`；Light surface 为 `#fff`、scrim 为 `rgba(20,20,24,.32)`。
- 欢迎页使用“品牌标识 + 两行主标题 + 主次动作 + 真实创作图像”的左右结构，图像保持稳定 1:1 比例与 16px 圆角。
- 连接、账号登录和连接校验回到 Operate 表单布局，不继续套用欢迎页的大型展示语言。
- 二维码位于内容区，不再进入底部动作行；底部只保留返回、刷新/获取、确认等命令。
- 首次生成成功后，真实图像占据主舞台，参数与提示词退后，只保留结果状态与“进入创作”。
- 首次打开焦点进入 Theater；后续步骤切换后焦点进入当前标题；关闭仍由 Radix 恢复触发端焦点语义。
- reduced motion 下取消 scrim blur 和 Theater 编排等待，交互路径保持可用。

对应实现：

```text
apps/desktop/src/features/onboarding/OnboardingFlow.tsx
apps/desktop/src/features/onboarding/OnboardingStepWelcome.tsx
apps/desktop/src/features/onboarding/OnboardingStepConnect.tsx
apps/desktop/src/features/onboarding/OnboardingStepValidate.tsx
apps/desktop/src/features/onboarding/OnboardingStepFirstImage.tsx
apps/desktop/src/features/onboarding/onboarding-ui.tsx
apps/desktop/src/styles/overlays-v2.css
```

### 31.3 桌面门禁

新增 `tests/e2e/test_40_overlays_v2_desktop.py`，仅使用 1440×900 桌面视口，验证：

- Onboarding 1080×720 居中几何、20px Theater 圆角、8px 控件圆角。
- Light / Dark 实色 surface 与独立 scrim。
- 欢迎图像稳定 1:1、步骤焦点迁移、账号表单不越界。
- Command Palette 560px 宽度、16px 圆角、输入自动聚焦与键盘活动项迁移。

### 31.4 Phase C 通用浮层（第一批）

共享原语已落地：

- `Dialog` 使用 `--scrim-dialog`、实色 `--surface-raised`、16px `--radius-dialog` 和 `--shadow-dialog`。
- 新增 `DialogBody`，与 Header / Footer 形成稳定结构；Footer 保持至少一个中型控件高度，不因 busy 状态跳动。
- Dropdown / Select 浮层使用实色 `--bg-popover`、8px 圆角、1px border 和 `--shadow-pop`；菜单行 32px、内部圆角 6px。
- Dropdown / Select 分别使用 Radix transform origin，避免不同定位原语共享错误的动画锚点。
- Toast 固定为 icon / body / action / close 四槽布局；success、danger、warning、accent 同时通过图标、边框和语义色表达。
- Toast 文案保持 12px 主标题与 meta 描述，操作按钮不改变通知宽度结构。

工作台实例已落地：

- Composer 的“添加上下文”保留全宽锚定布局，并补齐首项聚焦、上下键循环、Home / End、Tab 收起、Escape 关闭与焦点归还。
- 分组之间使用真实 `separator` 语义，不再通过下一组标题的上边框模拟。
- 会话 Context Menu 使用实色 popover surface，圆角 8px、`--shadow-pop`、32px 菜单行；危险项始终使用 danger text。
- 会话菜单打开后首项获得焦点，方向键循环；Escape 关闭时将焦点归还打开前的控件。
- 页面内动作菜单按页面逐实例迁移；Prompt、History、Scheme 与 Workbench 的批次记录见下文，保留各自的业务锚定和宿主注入能力。

对应实现：

```text
packages/ui/src/extended-primitives.tsx
packages/ui/src/toast-primitives.tsx
packages/ui/src/primitives.css
packages/product-ui/src/workbench/WorkbenchContextMenu.tsx
packages/product-ui/src/workbench/WorkbenchSessionContextMenu.tsx
apps/desktop/src/components/ui/toast-host.tsx
```

### 31.5 Phase C Prompt 菜单（第二批）

已落地：

- `PromptLibraryHeaderActions` 与 `PromptDetailScreen` 从手写绝对定位菜单迁移到共享 Dropdown 原语。
- 顶部菜单锚定“提示词库操作”按钮；详情菜单锚定“提示词操作”按钮，不再借动作组容器定位。
- 桌面注入的导入、分享和创建方案使用 `DropdownMenuItem`，与回收站、编辑、复制、置顶和删除共享同一键盘集合。
- 打开后首项获得焦点；方向键、Home / End、Escape 和焦点归还均有桌面行为门禁。
- Dropdown 的 Home / End 在共享 Content 捕获阶段按 DOM 顺序处理，避免宿主注入项的注册顺序改变键盘结果。
- 菜单项焦点使用整行 highlight，不继承桌面全局橙色外描边；危险项保留 danger text。
- Prompt 删除确认补齐 `DialogBody`，继续保持 16px Dialog、raised surface 与 dialog shadow。

对应实现：

```text
packages/product-ui/src/library/PromptLibraryHeaderActions.tsx
packages/product-ui/src/library/PromptDetailScreen.tsx
apps/desktop/src/pages/LibraryPage.tsx
apps/desktop/src/features/library/components/PromptDetailView.tsx
packages/ui/src/dropdown-menu-content.tsx
packages/ui/src/extended-primitives.tsx
tests/e2e/test_42_prompt_overlays_v2_desktop.py
```

尚未完成：

- 760px、680px 与 390px 响应式门禁。

### 31.6 Phase C History 菜单（第三批）

已落地：

- `GenerationHistoryDetailActions` 从手写绝对定位菜单迁移到共享 Dropdown 原语，Desktop / Web 共用同一菜单与删除确认结构。
- 桌面 Inspector 只常驻再次制作、存为提示词和创建设计方案；复制、文件管理与删除进入“更多操作”。
- 196px 菜单与触发器右边缘对齐，在底部空间不足时自动向上展开；Portal 不改变 Inspector 和动作栏几何。
- 桌面注入的打开文件夹、复制图片、删除记录与源文件使用 `DropdownMenuItem`，参与同一键盘集合。
- 删除动作使用真实 separator 和 danger text；删除记录、删除源文件、清理历史 Dialog 补齐 `DialogBody`。
- 打开后首项聚焦；Home / End、Escape、焦点归还以及切换记录时关闭旧浮层均已覆盖。
- 桌面删除说明明确本地使用统计会随历史记录变化；Web 继续使用可恢复的回收站语义。

对应实现：

```text
packages/product-ui/src/history/GenerationHistoryDetailActions.tsx
packages/product-ui/src/history/GenerationHistoryDetailScreen.tsx
apps/desktop/src/features/history/components/HistoryDetail.tsx
apps/desktop/src/features/history/components/HistoryCleanupMenu.tsx
apps/web/src/views/HistoryView.tsx
tests/e2e/test_43_history_overlays_v2_desktop.py
```

### 31.7 Phase C Scheme 菜单（第四批）

已落地：

- `SchemeActionMenu` 的详情 `...` 操作迁移到共享 Dropdown；普通动作、条件动作、separator 和危险动作保持稳定顺序。
- `SchemeCreateMenu` 的五种来源迁移到共享 Dropdown Portal；286px 宽度、双行说明和不裁剪定位保持方案页设计。
- `SchemeRunVariableFields` 的“添加可选变量”迁移到共享 Dropdown，并从 Composer 底部向上锚定。
- 共享 `DropdownMenuContent` 在 Electron pointer-open 路径中主动聚焦第一个可用 menu item，同时保留调用方通过 `onOpenAutoFocus` 取消默认行为的能力。
- 方案附件详情仍保留 dialog 语义的富信息浮层；它和纯动作菜单的边界不混用。

对应实现：

```text
packages/ui/src/dropdown-menu-content.tsx
apps/desktop/src/features/design-schemes/SchemeActionMenu.tsx
apps/desktop/src/features/design-schemes/SchemeControlDeck.tsx
apps/desktop/src/features/design-schemes/SchemeListActions.tsx
apps/desktop/src/features/design-schemes/SchemeRunComposer.tsx
tests/e2e/test_26_scheme_center_delete.py
```

桌面门禁固定使用 Dark / Light 和 方案中心真实导入草稿，验证菜单 surface、8px 圆角、阴影、Home / End、Escape、焦点归还及删除确认。本批不执行手机端测试。

### 31.8 Phase C Workbench 菜单（第五批）

已落地：

- `WorkbenchTurnActions` 从手写 absolute 菜单迁移到共享 Dropdown；菜单从回合动作按钮向上展开，使用 176px 内容宽度，不再参与回合流的布局计算。
- 回合菜单继续保留“再次制作”“存为提示词”“查看生成历史”等宿主注入能力；`GenerationSavePromptAction` 通过 `asChild` 进入同一个键盘菜单集合，不产生嵌套按钮。
- `WorkbenchGenerationResultCard` 保留图片表面上的高频图标操作；“打开所在目录”和“查看生成历史”收纳进 144px 的共享更多菜单，向上展开并与卡片右边缘对齐。
- 两类菜单均使用实色 popover、8px 外圆角、`shadow-pop`、首项聚焦、方向键、Home / End、Escape 和触发器焦点归还；Portal 不改变 MainView、回合时间线或结果卡片的几何。
- 桌面端继续保留既有业务 `data-testid`，仅把浮层容器改为共享原语；移动端门禁按当前开发约定暂不执行。

对应实现与门禁：

```text
packages/product-ui/src/workbench/WorkbenchTurnActions.tsx
packages/product-ui/src/workbench/WorkbenchGenerationResultCard.tsx
packages/product-ui/src/workbench/__tests__/workbench-overlays.test.ts
tests/e2e/test_08_generation_workbench.py
```

既有工作台 E2E 继续验证存为提示词、打开所在目录和结果卡片操作；本批新增的共享原语契约测试验证菜单不会重新引入 document 级 pointerdown / keydown 监听。

### 31.9 Phase C Sidebar Access Switcher（第六批）

`SidebarAccessSwitcher` 的两个手写浮层已经迁移到共享 Dropdown，参考 ZCode 插件页和设置页的紧凑分组菜单：侧栏底部保留身份摘要，用户按需向上展开账号、豆包、中转站和应用操作。

- 身份菜单宽 292px，设置菜单宽 220px，均从 Sidebar Footer 向上展开，使用 6px 锚定间距；身份菜单左对齐身份行，设置菜单右对齐设置图标。
- 两者均通过 Portal 渲染，使用实色 popover、12px 外圆角、1px border、`shadow-pop` 和 8px 内部菜单行圆角。Dark / Light 只替换 token surface 与文字对比，不重写浮层结构。
- 身份菜单使用 `DropdownMenuLabel` 分成“生图账号”和“中转站”，真实 `DropdownMenuSeparator` 分隔底部的“管理中转站 / 账号设置”；当前身份由整行 accent-soft 背景和 Check 表达。
- 中转站连接测试与桌宠开关保留菜单内 busy 状态，异步完成后才关闭；账号切换仍进入原有验证和身份过渡动画。失败路径保持原 toast，不新增第二套错误浮层。
- 共享 Dropdown 提供首项聚焦、方向键、Home / End、Escape、outside click 和触发器焦点归还；组件不再监听 document pointerdown、keydown，也不维护手写 anchor 坐标。
- `z-index: 75` 只保证菜单高于 Sidebar / MainView 的普通层级，Dialog 和 Command 层级继续优先；浮层打开不改变 MainView、Composer 或 Right Dock 几何。

对应实现：

```text
apps/desktop/src/components/layout/SidebarAccessSwitcher.tsx
apps/desktop/src/components/layout/__tests__/model-hub-ui.test.ts
apps/desktop/src/styles/overlays-v2.css
tests/e2e/test_32_v05_account.py
tests/e2e/test_41_phase_c_overlays_v2_desktop.py
```

本批只执行桌面端验证，不执行手机端测试。

### 31.10 Phase C Dialog 实例（第七批）

本批完成常规桌面业务 Dialog 对共享 `Header / Body / Footer` 结构的迁移。`DialogBody` 是布局槽位，不新增第二层卡片表面；业务内容继续使用原来的 inset、raised、danger 和 media surface，避免出现“Dialog 里套卡片、卡片里再套卡片”的 ZCode 视觉问题。

已迁移的实例：

- 服务商配置、全局错误、设置中的危险区、导入、导出、豆包扫码登录、开源许可和数据库备份。
- 回收站、分享卡片预览和外部分享导入确认。
- `DialogFooter` 继续承载取消、确认、重试、保存和重启动作；busy 状态只替换按钮内容，不改变 Footer 的最小高度。

结构约束：

- `DialogHeader` 只放标题和说明；标题不承担内容区的状态提示。
- `DialogBody` 负责垂直节奏、内容滚动和状态切换；长列表的 `max-height` 与 `overflow-y-auto` 保留在 Body 或 Body 内部的内容面上。
- `DialogFooter` 只放跨内容区的最终动作；列表行内的恢复、删除和 PNG 操作仍留在内容区，保持动作与对象的邻近性。
- Body 不改变 Dialog 的 16px 圆角、raised surface、`--shadow-dialog` 和 scrim；Light / Dark 只由 foundation token 替换 surface 与文字对比。

有意保留的自定义边界：

- `PromptEditor` 是全宽编辑器表面，表单自己拥有标题、字段和底部动作，继续使用 `p-0` 的专用布局，避免被通用 Body padding 破坏编辑区连续性。
- `ConnectedAppsScreen` 的重认证表单是账号协议专用表面，包含服务商选择、授权说明和异步提交状态，继续保留 `mf-connected-app-reauth-form` 的定制几何。
- 只有“没有独立内容区”的确认弹窗可以仅使用 Header + Footer，例如会话删除、更新通道和归档会话确认；这不是漏迁移，而是 Body 没有可承载内容。

桌面门禁固定使用 1440×900，至少覆盖 Dark / Light 的 Body 间距、Dialog 圆角、raised surface、Footer 对齐、busy 状态和滚动内容；本批不执行手机端测试，760px、680px 与 390px 响应式门禁留在后续桌面布局收口阶段。

对应实现与契约：

```text
apps/desktop/src/components/ui/__tests__/dialog-structure.test.ts
apps/desktop/src/components/ui/global-error-dialog.tsx
apps/desktop/src/features/generation/components/ProviderDialog.tsx
apps/desktop/src/features/settings/components/{DangerZonePanel,ImportDialog,ExportDialog,DoubaoSection,AboutSection,BackupPanel}.tsx
apps/desktop/src/features/library/components/TrashDialog.tsx
apps/desktop/src/features/share/{ImportConfirmDialog,SharePromptDialog}.tsx
```
