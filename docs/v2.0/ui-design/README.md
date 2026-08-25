# Musefold 2.0 UI Design

版本：v2.0 设计讨论基线
日期：2026-08
状态：页面级设计方案，尚未进入源码实现

## 1. 设计目标

Musefold 2.0 采用以下组合：

```text
Codex 的任务连续性
+ ZCode 的三栏工作台
+ Musefold 的图像创作对象
+ Graphite / Ember 的材质和品牌状态
```

目标不是复制 ZCode，而是把 ZCode 的空间模型转译为视觉创作工作流：

```text
固定左侧工作区导航
        +
中央创作任务工作台
        +
可独立收起的右侧上下文面板
```

中央区域必须是页面主角；左右栏服务于定位、上下文和复用，不覆盖创作内容。

## 2. 页面设计文件

| 文件 | 页面/系统 | 主要讨论内容 |
| --- | --- | --- |
| `00-visual-foundation.md` | 2.0 视觉基础 | 浅色/深色配色、圆角、表面、阴影、间距、组件质感 |
| `01-shell-and-sidebar.md` | AppShell 与左侧工作区 | 三栏骨架、侧栏、标题栏、会话列表、折叠和 resize |
| `02-generation-workbench.md` | 新设计/生成工作台 | MainView、Composer、时间线、结果图、右侧 Dock |
| `11-new-conversation-empty-state.md` | 新对话首屏 | 品牌锁定区、提示语、空态 Composer、工作区入口、响应式 |
| `03-prompt-library.md` | 提示词库 | 列表、搜索、详情、编辑、置顶、回收站 |
| `04-design-schemes.md` | 设计方案 | 我的方案、发现、新建、运行详情、结果相册 |
| `05-generation-history.md` | 生成历史 | 历史列表、筛选、详情 Inspector、成本、Lightbox |
| `06-settings-and-integrations.md` | 设置、账户、接入 | 六个设置分区、服务商、开放能力、数据和归档 |
| `07-overlays-onboarding-responsive.md` | 浮层、引导、响应式 | Command Palette、Popover、Dialog、Onboarding、Mobile |

每个文件控制在 1000 行以内。`README.md` 负责索引，不承载具体页面细节。

## 3. ZCode 参照截图

截图位于 `references/zcode/`：

| 文件 | 参照状态 |
| --- | --- |
| `zcode-mainview-dark.jpeg` | 已有任务、左侧项目任务列表、中央 MainView、右侧上下文面板 |
| `zcode-new-task-dark.jpeg` | 新建任务、欢迎语、Composer、项目入口和模板建议 |
| `zcode-settings-index-dark.jpeg` | 设置双栏、分组导航、section、设置行和右侧开关 |
| `zcode-onboarding-dark.jpeg` | 首次启动引导 modal、遮罩、主次按钮和右侧视觉区域 |

每个核心页面文件必须至少引用一张截图，并在“对比 ZCode”章节中记录：

1. 继承的空间关系。
2. 必须替换的业务语义。
3. Musefold 2.0 的视觉差异。
4. 不能照搬的编码专属组件。

## 4. 当前源码边界

设计方案基于现有实现，不预设全量重构：

- 原子组件：`packages/ui`
- 跨端产品组件：`packages/product-ui`
- 桌面能力和 IPC 接入：`apps/desktop/src`
- 页面编排：page-controller 和现有 feature store
- 桌面工作台：`apps/desktop/src/features/generation/workbench`
- 提示词库：`apps/desktop/src/pages/LibraryPage.tsx` 与 `packages/product-ui/src/library`
- 设计方案：`apps/desktop/src/features/design-schemes`
- 生成历史：`apps/desktop/src/pages/HistoryPage.tsx` 与 `packages/product-ui/src/history`
- 设置：`apps/desktop/src/features/settings` 与 `packages/product-ui/src/settings`

## 5. 共同空间基线

桌面宽窗口建议按以下比例实现：

```text
window
├── title bar                 44px
├── sidebar                   248px default / 220px min
├── splitter                  1px visual + 8px interaction area
├── MainView                  flex: 1
└── right dock                280-320px, collapsible
```

右侧 Dock 是参与布局的独立列，不是覆盖中央内容的抽屉。窄屏时才切换为 drawer 或 bottom sheet。

## 6. 设计讨论方式

建议按以下顺序讨论和实施：

1. 先讨论 `00-visual-foundation.md`，锁定材质、颜色、圆角和阴影。
2. 再讨论 `01-shell-and-sidebar.md`，确认三栏比例和侧栏信息架构。
3. 再讨论 `02-generation-workbench.md`，这是最重要的核心页面。
4. 按提示词库、设计方案、历史、设置逐页推进。
5. 最后统一浮层、引导和移动端。

每次讨论一个页面时，必须同时看对应 ZCode 截图，不允许只凭文档文字判断。

## 7. 新对话首屏补充基线

本版本新增的 `11-new-conversation-empty-state.md` 以本地参考页
`http://127.0.0.1:58627/` 的空对话 DOM 和截图为布局输入。它不是把 Musefold 改成聊天产品，而是吸收以下空间关系：

```text
品牌 Logo + 名称
        ↓
品牌提示语
        ↓
新对话 Composer
        ↓
工作区 / 项目选择条
```

该首屏是 `02-generation-workbench.md` 的新任务分支；已有任务仍使用媒体优先时间线。两者共享 Composer 的数据和交互骨架，但空态首屏需要更强的品牌识别和更安静的垂直居中。
