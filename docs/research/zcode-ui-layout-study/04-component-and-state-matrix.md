# 04. 组件、状态与布局矩阵

这份矩阵用于把前面逐页观察转换成可实现、可测试的 UI 规格。尺寸均为截屏估算，不应当替代源码 token；实现时应先抽成 CSS variables 或设计系统 token。

## 1. 组件目录

| 组件 | 所在位置 | 主要状态 | 是否改变主布局 |
| --- | --- | --- | --- |
| App Shell | 全局 | light/dark、zoom、language | 否，影响主题和比例 |
| Workspace Sidebar | 左侧 | expanded、collapsed、resizing | 是，改变 MainView 宽度 |
| Project/Group Segmented | 左栏顶部 | selected tab、hover、focus | 否 |
| Project Row | 左栏列表 | collapsed、expanded、selected、hover | 子项显隐 |
| Task Row | 左栏列表 | selected、hover、pinned、archived | 列表排序/可见性 |
| Splitter | 左栏/右栏边界 | idle、dragging、keyboard focus | 是，改变相邻列 |
| Task Header | MainView 顶部 | idle、running、error | 否 |
| Project/Branch Pill | Task Header/Composer | selected、open、disabled | 否，打开 popover |
| Message Block | MainView | user、assistant、system、error | 只影响自身高度 |
| Thinking Disclosure | 消息流 | collapsed、expanded | 只影响消息高度 |
| Tool Group | 消息流 | running、collapsed、completed、failed | 只影响消息高度 |
| File/Diff Summary | 工具结果 | collapsed、expanded、selected | 可联动右侧面板 |
| Composer | MainView 底部 | empty、focused、typing、working、disabled | 高度可变但底部固定 |
| Permission Selector | Composer | mode selected、open、danger | 否，打开 popover |
| Model Selector | Composer | vendor/model selected、open | 否 |
| Right Context Dock | MainView 右侧 | open、closed、resizing | 是 |
| Right Tab Search | 右侧标签栏 | closed、open、querying | 否，局部 popover |
| Settings Nav | 设置左栏 | selected、hover | 内容路由变化 |
| Settings Row | 设置内容 | switch/select/button/disabled | 一般不改变整体布局 |
| Command Center | 顶层 | closed、open、querying、selected | 遮罩覆盖，不改变底层列宽 |
| Onboarding Modal | 顶层 | open、close、migration、start | 遮罩覆盖并锁定底层 |
| Toast/Feedback | 全局 | success、error、loading | 不改变主布局 |

## 2. 核心按钮地图

### 2.1 工作区与任务

| 按钮 | 视觉等级 | 目标区域 | 典型反馈 |
| --- | --- | --- | --- |
| 新建任务 | primary action | 新建任务页/Composer | 创建任务并切换 MainView |
| 搜索 | icon + shortcut | command center | 遮罩、输入框聚焦 |
| 自动化 | secondary navigation | 自动化页 | 页面导航 |
| 插件市场 | secondary navigation | 插件市场 | 页面导航 |
| 收起全部 | quiet action | 项目列表 | 所有节点折叠 |
| 筛选和排序 | quiet action | 项目列表 | popover |
| 归档 | quiet action | 项目列表 | 归档视图或状态切换 |
| 添加项目 | primary/secondary | 项目列表 | 创建或打开文件夹 |
| 新建分组 | secondary | 分组列表 | 出现命名输入或新分组 |
| 置顶任务 | hover action | 任务行 | 排序变化、toast |
| 归档任务 | hover/destructive action | 任务行 | 确认或立即归档 |

### 2.2 MainView 与 Composer

| 按钮 | 位置 | 说明 |
| --- | --- | --- |
| 更多 | Task Header | 低频任务动作 |
| 添加上下文 | Composer | 附件、@、/ 菜单 |
| 权限模式 | Composer | 变更前确认、自动编辑、计划模式、完全访问 |
| 模型 | Composer | tvt-glm、tvt-gpt、tvt-claude、kimi、管理模型 |
| 推理等级 | Composer | 极高/最高等模式 |
| 发送 | Composer | 提交新任务，空输入时禁用 |
| 停止 | Composer | 运行中替换发送 |
| 展开/收起思考 | 消息流 | 显示或隐藏次级过程 |
| 展开/收起工具组 | 消息流 | 显示工具输入输出 |
| 复制 | 消息操作 | 复制正文、代码或输出 |
| 反馈 | 消息操作 | 正向/负向反馈 |
| Fork | 消息操作 | 创建分支任务路径 |
| 侧边面板 | Task Header/工具栏 | 打开或关闭右侧 dock |

### 2.3 设置与资源

| 按钮 | 页面 | 说明 |
| --- | --- | --- |
| 导入浏览器数据 | 浏览器 | 系统数据导入流程 |
| 清除缓存 | 浏览器 | 可 disabled，清理缓存 |
| 清除全部 | 浏览器 | 红色危险动作，需确认 |
| 刷新 | 资源列表页 | 重新读取插件、子智能体等 |
| 新建 | 子智能体/命令 | 新建资源 |
| 新建钩子 | 钩子 | 空状态的主动作 |
| 删除 | 子智能体/资源行 | 危险动作，最好确认 |
| 浏览插件 | 插件空状态 | 导航到市场/可用插件 |
| 返回工作区 | 设置 Shell | 离开设置 |
| 开始使用 ZCode | 引导 modal | 进入首次使用流程 |
| 数据迁移向导 | 引导 modal | 进入迁移流程 |
| Close | 引导 modal | 关闭 modal |

## 3. 颜色与视觉语义

由于研究对象是暗色桌面应用，颜色不要只按色相记忆，而应按语义分层：

| 语义 | 观察到的方向 | 使用场景 |
| --- | --- | --- |
| Base | 接近黑色/深灰 | 应用背景、MainView 基底 |
| Raised surface | 稍亮的深灰 | 卡片、Composer、工具组 |
| Border | 低对比灰 | 分隔、输入框、设置 card |
| Primary text | 高亮灰白 | 标题、主内容、当前任务 |
| Secondary text | 中低亮灰 | 描述、时间、辅助说明 |
| Accent | 绿色/蓝紫等局部强调 | 快速动作、selected、品牌入口 |
| Permission warning | 橙色 | 完全访问或风险配置 |
| Destructive | 红色 | 清除全部、删除、危险确认 |
| Success | 绿色 | 完成、连接成功、启用 |
| Focus | 明亮边框或 ring | 键盘焦点和可访问状态 |

避免把所有控件都做成同一颜色的实心胶囊。ZCode 的层级主要由留白、亮度、边框、文字权重和局部强调共同建立。

## 4. 尺寸关系与 token 建议

以下是截屏学习用的相对尺寸，不是最终实现值：

| 对象 | 估算/建议 |
| --- | --- |
| 左侧工作区栏 | 默认约 255 px，可拖拽，设 min/max |
| 右侧上下文 dock | 默认约 230-265 px，可收起和调整 |
| 普通图标按钮 hit area | 28-32 px 起步 |
| 设置行 | 固定最小高度，长说明允许自然增高 |
| 普通 card 圆角 | 约 8 px 或更小 |
| Composer 外框 | 主列宽度的 100%，底部固定，左右保留内容 padding |
| 全局搜索面板 | 约 490 px 宽，响应式限制 max-width |
| 引导 modal | 约 860 px 宽，左右双栏，窗口窄时改为单栏 |
| 右侧 tab | 固定高度，selected indicator 不改变 tab 高度 |
| 列表行 | 固定基线和 min-height，hover 不改变布局 |

建议 token：

```text
--shell-sidebar-width
--shell-sidebar-min-width
--shell-right-dock-width
--shell-splitter-width
--control-hit-size
--row-min-height
--card-radius
--panel-radius
--surface-0 / --surface-1 / --surface-2
--text-primary / --text-secondary / --text-muted
--accent / --warning / --danger / --success
```

## 5. 状态表达规则

### 5.1 交互状态

每个按钮/行至少检查：

- default：默认背景、文字和图标。
- hover：背景或边框改变，但不改变宽高。
- focus：键盘 focus ring 可见。
- active/pressed：菜单或按钮按下时有即时反馈。
- selected：当前 tab、项目、分支、模型、主题的持久状态。
- disabled：降低对比度并阻止动作，说明原因时用 tooltip 或辅助文本。
- loading：显示 spinner 或进度，不让文字跳动。
- error：错误信息与可重试动作同处可见区域。

### 5.2 容器状态

| 容器 | 状态变化 | 布局要求 |
| --- | --- | --- |
| 左栏 | 折叠/展开 | MainView 宽度跟随变化 |
| 项目树 | 节点展开/收起 | 缩进和箭头保持稳定 |
| Right dock | 打开/关闭 | 不覆盖 MainView，使用 grid/flex 改列宽 |
| Composer | 输入增高 | 不遮住消息，设 max-height |
| Tool group | 展开/收起 | 只改变组内容高度 |
| Command center | 打开/关闭 | 遮罩锁定底层焦点 |
| Onboarding | 打开/关闭 | 底层不可交互，关闭后返回触发页 |
| Settings list | 空/有数据 | 空状态提供唯一主动作 |

## 6. Overlay 层级矩阵

```text
Layer 0  app background / Shell
Layer 1  left sidebar + MainView + right dock
Layer 2  tooltip / hover action / local menu
Layer 3  popover: project, branch, model, permission, tab search
Layer 4  command center backdrop + centered panel
Layer 5  onboarding / confirmation modal
Layer 6  toast, only when it must float above modal
```

层级规则：

- 普通 popover 不要暗化整个页面。
- Command center 需要遮罩和焦点锁定。
- Onboarding modal 需要遮罩、关闭入口和返回焦点。
- tooltip 不能盖住正在操作的菜单项，也不能在 modal 背景上随机出现。
- 右侧 dock 本身属于 Layer 1，它不是 Layer 3 的抽屉。

## 7. 键盘与焦点检查

- `Cmd/Ctrl + N` 聚焦新任务或创建任务。
- `Cmd/Ctrl + K` 打开 command center 并聚焦搜索框。
- Popover 打开后，方向键移动选项，Enter 确认，Escape 关闭。
- Command center 关闭后焦点回到搜索按钮或触发控件。
- Composer 中按 Enter 发送，Shift+Enter 换行；实际行为需和产品设置一致。
- 运行中按 Escape 或点击停止应有明确中止反馈。
- switch、tab、icon button 都必须有可访问名称，不依赖图标形状。

## 8. 视觉回归截图点

建议至少固定以下截图状态：

1. 1208 x 766，新建任务，右侧面板关闭。
2. 1208 x 766，已有任务，右侧面板打开。
3. 1208 x 766，项目树展开并悬停任务行。
4. 全局搜索打开，结果分组可见。
5. Composer 权限菜单打开。
6. Composer 模型菜单打开。
7. 右侧标签搜索 popover 打开。
8. 设置常规页中段。
9. 设置子智能体页含已安装和内置列表。
10. 设置浏览器页含危险按钮。
11. 索引库页长说明和 switch 对齐。
12. 使用统计页含 KPI、热力图和趋势图。
13. 引导 modal 打开并覆盖设置背景。

每张截图应同时验证：没有文字越界、没有按钮重叠、滚动容器正确、选中状态可辨认、暗色对比足够。

## 9. 适配 Musefold 时的取舍

### 可直接借鉴

- 三栏 Shell 和可收起的右侧上下文 dock。
- Composer 底部固定、权限与模型分离。
- 项目/分组双视图和任务行 hover 动作。
- 设置区通用的 section + card row。
- 全局搜索与局部 popover 的分层关系。

### 需要重新命名或替换

- `Explore`、`Terminal`、`Changes` 需要映射到生图工作流，例如素材、生成队列、参数、版本和导出。
- Git 分支选择器可以替换为画布/项目版本/工作区选择器，但仍应保留当前上下文摘要。
- 完全访问、自动编辑、计划模式需要映射为生图任务的资源权限、自动发布或批处理模式。
- 代码索引库可以替换成提示词、素材和模型索引，但要保留本地数据和开关的解释。

## 10. 最终验收表

| 检查项 | 通过条件 |
| --- | --- |
| 布局 | 三栏在打开/关闭面板时没有遮挡 |
| 层级 | popover、command center、modal 的遮罩和 z-index 有差异 |
| 文本 | 长标题、长说明、错误信息都能换行或省略 |
| 按钮 | 常用动作可发现，图标按钮有 tooltip/aria label |
| 状态 | hover/focus/selected/disabled/loading/error 都可辨认 |
| 滚动 | 左栏、MainView、右栏、设置内容各自按职责滚动 |
| 空状态 | 空列表给出下一步动作，而不是只有说明 |
| 危险操作 | 删除、清除全部有颜色、文案和确认保护 |
| 键盘 | 搜索、选择器、Composer、modal 可用 Escape/Enter 操作 |
| 视觉 | 截图中无溢出、跳动、重叠和不必要的大卡片嵌套 |
