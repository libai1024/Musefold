# 06 · PromptForge UI 设计系统

> 版本：0.1.1  
> 状态：v0.2 开发基线  
> 视觉方向：Graphite / Ember  
> 产品模式：Operate，高密度桌面生产力工具

本规范是 PromptForge renderer 的全局 UI 契约。v0.2 的新增页面、状态和组件必须优先复用本规范、`src/styles/globals.css` 中的语义 token 以及 `src/components/ui` 中的共享组件。

## 1. 设计目标

1. **任务优先**：用户应快速识别当前位置、当前状态和下一步动作，装饰不能抢占操作注意力。
2. **原生克制**：窗口壳层可使用 macOS vibrancy 或 Windows Mica，内容区域使用稳定实色表面、发丝边框和有限阴影。
3. **单一品牌色**：Ember 只用于品牌、主动作、选中和焦点，不用于大面积背景。
4. **高密度但可扫描**：保持桌面工具的信息效率，通过层级和分组解决拥挤，不通过缩小字号解决。
5. **完整状态**：所有控件和业务流程都要覆盖默认、hover、focus、active、disabled、loading、empty、success、failed、cancelled 和 retry。
6. **跨平台一致**：信息架构、组件语义和视觉层级一致；平台差异只进入标题栏、窗口材质和系统快捷键。

设计参数：

| 参数 | 值 | 含义 |
|---|---:|---|
| DESIGN_VARIANCE | 4 | 稳定网格，允许少量非对称层级 |
| MOTION_INTENSITY | 3 | 仅 hover、active 和状态转换 |
| VISUAL_DENSITY | 7 | 高频桌面工作台，紧凑但不牺牲可读性 |

## 2. 视觉语言

### 2.1 Graphite

Graphite 是界面的中性基础。深色模式使用带轻微冷感的石墨灰，浅色模式使用低黄度的暖白瓷面。禁止在同一主题里混用蓝灰、暖灰和纯黑。

### 2.2 Ember

Ember 是唯一品牌强调色。允许使用场景：

- 主按钮和品牌标记
- 当前导航、当前选项和选中内容
- 键盘焦点环
- 进度或执行中的关键反馈
- 文本链接和可操作强调

禁止使用场景：

- 大面积页面背景
- 装饰性渐变或外发光
- 与成功、警告、错误状态混用
- 同一视图出现第二个品牌强调色

### 2.3 材质边界

- 系统透明材质只属于窗口、标题栏和顶层浮层。
- 列表、设置项、检查器和工作区使用实色或近实色表面。
- 不在卡片内部嵌套卡片。
- 不同时使用明显边框和大范围阴影表达同一层级。
- `backdrop-filter` 必须有不依赖模糊的实色兜底。

## 3. 颜色 Token

颜色只能通过语义 token 使用。业务组件不得新增品牌色十六进制值。

### 3.1 Light

| Token | 值 | 用途 |
|---|---|---|
| `--bg-window` | `rgba(246,245,242,.78)` | 窗口背景 |
| `--bg-sidebar` | `rgba(237,235,231,.62)` | 导航壳层 |
| `--bg-elevated` | `rgba(255,255,253,.90)` | 主内容表面 |
| `--bg-popover` | `rgba(253,252,249,.97)` | 菜单、对话框 |
| `--bg-inset` | `rgba(24,24,29,.045)` | 输入区、分组底色 |
| `--bg-hover` | `rgba(24,24,29,.06)` | hover |
| `--bg-active` | `rgba(24,24,29,.09)` | selected、pressed |
| `--fg-primary` | `#191A1D` | 标题、正文主信息 |
| `--fg-secondary` | `#55585F` | 辅助正文 |
| `--fg-tertiary` | `#73767E` | 元数据、placeholder |
| `--fg-quaternary` | `#A1A3A9` | disabled、弱分隔信息 |
| `--accent` | `#C35431` | Ember 主色 |
| `--success` | `#2F8F5B` | 成功 |
| `--warning` | `#A96D1D` | 警告 |
| `--danger` | `#BD433D` | 错误、危险操作 |
| `--info` | `#3F739E` | 中性信息 |

### 3.2 Dark

| Token | 值 | 用途 |
|---|---|---|
| `--bg-window` | `rgba(13,14,17,.88)` | 窗口背景 |
| `--bg-sidebar` | `rgba(20,21,25,.72)` | 导航壳层 |
| `--bg-elevated` | `rgba(28,29,34,.90)` | 主内容表面 |
| `--bg-popover` | `rgba(34,35,41,.97)` | 菜单、对话框 |
| `--bg-inset` | `rgba(0,0,0,.32)` | 输入区、分组底色 |
| `--bg-hover` | `rgba(255,255,255,.065)` | hover |
| `--bg-active` | `rgba(255,255,255,.10)` | selected、pressed |
| `--fg-primary` | `#F4F4F1` | 标题、正文主信息 |
| `--fg-secondary` | `#B1B3B8` | 辅助正文 |
| `--fg-tertiary` | `#8A8D95` | 元数据、placeholder |
| `--fg-quaternary` | `#62656D` | disabled、弱分隔信息 |
| `--accent` | `#F07B52` | Ember 主色 |
| `--success` | `#55C88D` | 成功 |
| `--warning` | `#E7AD54` | 警告 |
| `--danger` | `#ED7B74` | 错误、危险操作 |
| `--info` | `#78B7D5` | 中性信息 |

### 3.3 使用规则

- 正文和关键标签使用 `primary` 或 `secondary`。
- `tertiary` 仅用于可被忽略但仍需读取的元数据。
- `quaternary` 不承载必要信息。
- 彩色背景必须搭配 `on-accent` 或 `on-danger`，不能假设白色文字始终可读。
- 语义色不能代替品牌色，品牌色也不能表达错误或成功。

## 4. 排版

使用平台系统字体，不下载第三方字体：

```css
font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont,
  "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
```

代码、ID、时间、成本和数值使用：

```css
font-family: "SF Mono", "Cascadia Code", "JetBrains Mono",
  ui-monospace, monospace;
```

| 层级 | 大小 | 字重 | 用途 |
|---|---:|---:|---|
| Page title | 15-16px | 600 | 页面和设置分区标题 |
| Section title | 13-15px | 600 | 面板标题、主要分组 |
| Body | 12-13px | 400-500 | 控件、正文、列表主信息 |
| Metadata | 10-11px | 400-500 | 时间、模型、计数、提示 |

规则：

- 字号下限为 10px，10px 只用于短元数据。
- 页面内不使用负字距，不依赖全大写制造层级。
- 重要中文文案不使用 monospace。
- 正文行长控制在 65-75 个英文字符的等效宽度。
- 数字列使用 `tabular-nums`，防止动态值引发布局跳动。

## 5. 间距与密度

基础单位为 4px。常用间距为 4、8、12、16、24、32px。

- 控件内部：6-12px
- 同组元素：4-8px
- 相关分组：12-16px
- 页面区块：24-32px
- 页面默认边距：24px
- Compact 页面边距：16px

密度切换只调整间距、行高和缩略图尺寸，不缩放字体。

## 6. 圆角与边框

| Token | 值 | 用途 |
|---|---:|---|
| `radius-xs` | 5px | 徽章、菜单项、标签 |
| `radius-sm` | 7px | 按钮、输入、导航项 |
| `radius-md` | 10px | 卡片、应用主表面 |
| `radius-lg` | 14px | 对话框、媒体结果 |
| `radius-xl` | 20px | 仅特殊媒体或引导场景 |

- pill 仅用于紧凑计数和不可编辑标签。
- 普通按钮不使用 pill。
- 分隔线优先使用 `border-subtle`，可交互边界使用 `border-default`。
- `border-strong` 只用于 hover、拖放目标和高风险边界。

## 7. 应用布局

### 7.1 Shell

- TitleBar：44px
- Global Sidebar：216px
- Settings Sidebar：168px
- Inspector：320px
- 主内容使用 `100dvh`，不得使用 `100vh` 或 `h-screen`。
- 宽度小于 640px 时，全局侧栏变为遮罩抽屉。
- 宽度小于 900px 时，Library Inspector 默认隐藏。

### 7.2 页面头

页面头统一使用 `PageHeader`：

- 左侧：页面图标、标题、计数、短副标题
- 右侧：页面级操作
- 主操作最多一个，其他操作使用图标按钮或菜单
- 640px 以下动作区允许换行，不允许按钮文字在桌面端换行

### 7.3 列表与卡片

- 线性历史、设置和导航优先使用平面行，不为每一行增加明显阴影。
- Prompt、生成结果和媒体作品可以使用卡片，因为边界表达真实对象。
- 选中态使用 `accent-soft + accent border`，不能只改变文字颜色。
- hover 不改变几何尺寸，避免虚拟化列表跳动。

## 8. 共享组件

### 8.1 Button

- `default`：唯一主动作
- `subtle`：品牌相关次级动作
- `outline`：普通次级动作
- `ghost`：工具栏和行内动作
- `danger`：不可逆操作
- 按下反馈为 1px 位移和 `scale(.98)`，不得使用夸张弹跳

### 8.2 Input、Textarea、Select

- 标签始终位于输入框上方或同行左侧，placeholder 不替代标签。
- 默认使用 `elevated` 表面和 `border-default`。
- hover 使用 `border-strong`，focus 使用 Ember ring。
- 错误状态同时包含颜色、错误文本和恢复建议。

### 8.3 Dialog、Menu、Command Palette

- 使用 `popover` 实色表面和 `shadow-pop`。
- Dialog 只用于需要中断或确认的任务。
- 普通菜单圆角使用 7px，不叠加高光边框和 blur。
- Command Palette 最大宽度 560px，支持完整键盘路径。

### 8.4 Tabs 与 Segmented Control

- Tabs 切换内容视图，使用底部指示线。
- Segmented Control 切换互斥模式，使用内嵌选中面。
- 两者不能混用，也不能只靠颜色表达当前项。

### 8.5 Empty、Loading、Error

- Empty：说明当前为空的原因，并提供一个直接动作。
- Loading：骨架形状应接近最终布局；按钮内使用内联 spinner。
- Error：说明发生了什么、数据是否安全、用户如何恢复。
- Toast 只处理瞬时反馈，持续错误应留在发生位置。

## 9. 图标、图片与状态

- 全项目继续使用 `lucide-react`，不混入第二套图标库。
- 常规图标 14-16px，导航和空状态可使用 18-20px。
- 默认 strokeWidth 为 2，激活状态可使用 2.3。
- 图片容器必须定义稳定尺寸或 `aspect-ratio`，避免布局跳动。
- 图片上的覆盖层只允许表达加载、错误、选择或真实状态，不放装饰标签。
- 彩色圆点只表示真实连接或运行状态。

## 10. 动效

动效只表达反馈和状态变化：

| Token | 时长 | 用途 |
|---|---:|---|
| `dur-instant` | 90ms | pressed |
| `dur-fast` | 130ms | hover、focus |
| `dur-base` | 180ms | 菜单、toast |
| `dur-med` | 220ms | 面板展开、宽度变化 |
| `dur-slow` | 260ms | 较大状态转换 |

- 优先动画 `transform` 和 `opacity`。
- 不添加装饰性循环动画；运行状态脉冲和 loading spinner 例外。
- 必须支持用户显式减少动效以及 `prefers-reduced-motion`。
- 动画不能改变列表项测量尺寸。

## 11. 可访问性

- 正文和 placeholder 对比度至少 WCAG AA 4.5:1。
- 大文本至少 3:1。
- 所有交互元素提供可见 `focus-visible`。
- 图标按钮必须有 `aria-label` 或可用 `title`。
- 选中状态同时通过颜色和边界、图标或形状表达。
- 触控目标建议至少 32px；桌面紧凑图标按钮下限为 24px。
- 键盘顺序与视觉顺序一致，弹层支持 Escape 关闭并正确恢复焦点。

## 12. v0.2 开发约束

1. 新 UI 优先扩展现有语义 token 和共享组件，不在业务组件散落颜色字面量。
2. 不引入新的组件系统；继续使用 Radix primitives、Tailwind 和项目自有封装。
3. 不新增装饰渐变、外发光、纯黑背景或大面积玻璃卡片。
4. 新页面必须同时验证 light、dark、1440px、1100px、800px 和窄屏布局。
5. 新交互必须在同一任务中补齐 loading、empty、error 和 disabled 状态。
6. 修改组件 API 时同步更新文档、调用点和相关测试。
7. 组合画布将在后续重构。重构前不扩展其专属 UI；只能继承全局 token 和共享组件修复。

## 13. UI 验收清单

- [ ] Light 与 Dark 的层级等价，品牌色含义一致
- [ ] 主动作在 3 秒内可识别
- [ ] 没有嵌套卡片和无意义玻璃层
- [ ] 标题、正文、元数据层级清晰
- [ ] hover、focus、active、disabled 状态完整
- [ ] loading、empty、error、success 状态完整
- [ ] 按钮文本不换行，图标按钮有名称
- [ ] 800px 宽度下无裁切、遮挡和不可达操作
- [ ] 减少动效模式可用
- [ ] 没有业务组件新增硬编码品牌色
- [ ] 组合画布专属源码未被顺带扩改

## 14. 权威顺序

发生冲突时按以下顺序处理：

1. 用户当前明确需求
2. 已确认的 `docs/v0.2/DECISION-LOG.md`
3. 本设计系统
4. `docs/product` 中对应功能的 deep-dive
5. 现有组件实现

视觉例外必须记录原因、影响范围和回收条件，不能通过局部 CSS 悄悄形成第二套系统。
