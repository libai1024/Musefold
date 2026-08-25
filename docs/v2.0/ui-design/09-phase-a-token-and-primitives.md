# 09. Phase A：Token 与原子组件实现方案

## 1. 阶段定位

Phase A 是 Musefold 2.0 的第一批代码改造。它不直接改页面布局，而是先把所有页面共同依赖的视觉基础收口：

```text
浅色/黑夜表面
圆角
边框
阴影
控件高度
焦点环
按钮 pressed
输入框 focus
状态色
```

先统一基础层，再升级 Sidebar、Composer、提示词库、方案、历史和设置，避免每个页面产生自己的近似圆角、灰色和阴影。

## 2. 现有代码边界

本阶段主要涉及：

- `packages/ui/src/tokens.css`
- `packages/ui/src/primitives.tsx`
- `packages/ui/src/primitives.css`
- `packages/ui/src/extended-primitives.tsx`
- `packages/ui/src/icons.ts`
- `packages/ui/src/__tests__/primitives.test.tsx`

暂时不改：

- 页面路由。
- 数据结构和 contracts。
- 生成逻辑。
- Composer 业务行为。
- Sidebar 信息架构。
- 数据库和迁移。
- IPC 和主进程逻辑。
- Agent、MCP、CLI、Automation 对外能力。
- `apps/desktop/package.json` 的版本号。

## 3. Token 迁移策略

不立即重命名所有旧 token。第一阶段增加语义别名，保留旧 token 兼容存量组件：

```css
--surface-window: var(--bg-window);
--surface-sidebar: var(--bg-sidebar);
--surface-work: var(--bg-elevated);
--surface-raised: var(--bg-elevated);
--surface-inset: var(--bg-inset);
--surface-popover: var(--bg-popover);
--surface-media: var(--bg-elevated);
```

这样可以：

- 避免一次修改大量业务组件。
- 保留当前视觉表现。
- 让新组件直接使用清晰的 2.0 语义名称。
- 后续逐步迁移旧命名。
- 降低跨端视觉回归风险。

## 4. 首批新增 Token

```css
--shell-sidebar-width: 248px;
--shell-sidebar-min-width: 220px;
--shell-dock-width: 304px;

--gap-shell: 1px;
--gap-surface-inset: 4px;
--gap-content: 8px;
--gap-section: 16px;
--gap-page: 24px;

--radius-tooltip: 6px;
--radius-control: 8px;
--radius-work: 12px;
--radius-media: 14px;
--radius-dialog: 16px;

--border-focus: var(--accent-ring);

--shadow-dialog:
  0 24px 70px rgba(20, 20, 24, 0.16);
```

Dark 模式只覆盖 surface、border 和 shadow，不重新定义组件结构：

```css
[data-theme="dark"] {
  --surface-window: #151619;
  --surface-sidebar: #1b1c1f;
  --surface-work: #1d1f22;
  --surface-raised: #25272a;
  --surface-inset: #121315;
  --surface-popover: #2b2d31;
  --surface-media: #2a2c30;
}
```

Light 模式：

```css
:root {
  --surface-window: #f6f6f4;
  --surface-sidebar: #efefec;
  --surface-work: #fafaf8;
  --surface-raised: #ffffff;
  --surface-inset: #f0f0ed;
  --surface-popover: #fdfcf9;
  --surface-media: #ffffff;
}
```

## 5. 表面 Token 使用规则

| Token | 使用位置 | 不应使用的位置 |
| --- | --- | --- |
| `surface-window` | Window、最底层 Shell | 普通卡片 |
| `surface-sidebar` | Sidebar、Settings nav、Inspector | 主按钮 |
| `surface-work` | MainView、页面内容 | Popover |
| `surface-raised` | Composer、Settings card、工具区 | Window 背景 |
| `surface-inset` | 输入框、代码/参数区、空状态 | 主页面背景 |
| `surface-popover` | Popover、Context Menu、Dialog | 普通列表行 |
| `surface-media` | 图片结果、缩略图承托 | 文本输入 |

每个业务组件只使用语义 token，不直接写新的 hex 值。

## 6. 圆角 Token

```css
--radius-tooltip: 6px;
--radius-control: 8px;
--radius-work: 12px;
--radius-media: 14px;
--radius-dialog: 16px;
--radius-theater: 20px;
```

使用关系：

```text
Tooltip / tiny menu item      6px
Button / Input / Nav Row      8px
MainView / Composer / Dock    12px
Image Result / Cover          14px
Dialog / Lightbox             16px
Onboarding Theater            20px
```

约束：

- 普通导航不使用 16px 大圆角。
- 普通按钮不默认使用 pill。
- 只有模型、数量、状态等紧凑标签可以使用近 pill 形状。
- default、hover、pressed、focus 不能改变圆角。

## 7. 间距 Token

```css
--gap-shell: 1px;
--gap-surface-inset: 4px;
--gap-content: 8px;
--gap-section: 16px;
--gap-page: 24px;
```

使用关系：

| Token | 位置 |
| --- | --- |
| `gap-shell` | Sidebar/MainView、MainView/Dock 分缝 |
| `gap-surface-inset` | MainView 相对 Window 的视觉内缩 |
| `gap-content` | 同一工具组、列表行内部 |
| `gap-section` | Composer 与内容、设置 section |
| `gap-page` | 页面级区域和页面内边距 |

1px 只用于 Shell 级边界，不能把所有内容压成 1px。

## 8. 阴影 Token

保留小、中、Dialog 三档通用阴影：

```css
--shadow-sm:
  0 1px 2px rgba(28, 30, 34, 0.06);

--shadow-pop:
  0 16px 40px rgba(28, 30, 34, 0.08);

--shadow-dialog:
  0 24px 70px rgba(20, 20, 24, 0.16);
```

Dark：

```css
--shadow-sm-dark:
  0 1px 2px rgba(0, 0, 0, 0.38);

--shadow-pop-dark:
  0 18px 46px rgba(0, 0, 0, 0.50);

--shadow-dialog-dark:
  0 28px 80px rgba(0, 0, 0, 0.62);
```

使用规则：

- Sidebar 不使用大阴影。
- MainView 主要依靠颜色和边界。
- Composer 使用 `shadow-sm` 或现有 `shadow-composer`。
- Popover 使用 `shadow-pop`。
- Dialog 和 Lightbox 使用 `shadow-dialog`。
- 图片结果优先使用 media border，不使用厚重黑影。

禁止把阴影做成彩色 glow。

## 9. Button 升级

第一批覆盖：

- `primary`
- `outline`
- `subtle`
- `ghost`
- `danger`
- `icon`
- `iconSm`

状态：

```text
default
hover
pressed
focus-visible
disabled
busy
```

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
- 键盘焦点始终可见。

Busy：

- 保留按钮宽度。
- 只替换内容或在内容前加入 spinner。
- 不允许文字变化导致按钮跳动。

## 10. IconButton 升级

统一尺寸：

```text
iconXs：24px
iconSm：28px
icon：32px
```

要求：

- 必须有 accessible label。
- 默认提供 title。
- focus ring 可见。
- hover 不改变 hit area。
- 关闭、更多、复制、下载、删除、Dock 开关使用统一结构。
- 图标入口继续只从 `@musefold/ui/icons` 导出。

Icon 本身可以是 14-16px，但点击区域不能跟着缩小。

## 11. Input / Textarea 升级

统一规格：

- 高度 34-36px。
- 圆角 8px。
- 1px default border。
- Light 使用 elevated/inset surface。
- Dark 使用 `#121315` 或 `#25272a`。
- focus 使用 Ember ring。
- error 同时显示边框、错误文本和恢复说明。
- disabled 保持原尺寸。

Textarea 额外要求：

- 允许受控自动增高。
- 设置最大高度。
- 超出最大高度后内部滚动。
- placeholder 不代替 label。
- 输入状态不能造成 Composer 外框跳动。

## 12. Select / Popover 升级

Select：

- 本体 8px 圆角。
- 高度 32-36px。
- 当前值和下拉 icon 保持稳定对齐。
- disabled 保留边界和几何尺寸。

Popover：

- surface 使用 `surface-popover`。
- 圆角 8-12px。
- 1px default border。
- 使用 `shadow-pop`。
- 普通菜单项 32px 高。
- 复杂菜单项 48px 高。
- 菜单项圆角 6px。
- 当前项使用 check + accent soft。
- Escape 关闭并恢复触发控件焦点。

## 13. Dialog 升级

统一：

- 圆角 16px。
- `surface-popover`。
- `shadow-dialog`。
- Header padding 20px。
- Content padding 20px。
- Footer padding 16-20px。
- 取消使用 ghost/subtle。
- 确认使用 primary 或 danger。
- Escape 关闭非阻断 Dialog。
- 关闭后焦点返回触发按钮。

## 14. Switch / Tabs / Segmented

### Switch

- 轨道约 30x18px。
- 圆角 9px。
- thumb 具有轻微内阴影。
- checked 使用 Ember。
- disabled 保留几何尺寸。
- 状态不能只依靠颜色，外层需要可读 label。

### Tabs

- 高度 30-34px。
- 圆角 6-8px。
- 页面切换使用 selected indicator。
- selected indicator 不改变 tab 高度。

### Segmented

- 高度 28-32px。
- 圆角 8px。
- 使用 inset selected surface。
- 适用于图像/设计方案、主题、密度、我的方案/发现。
- 不与普通 Tabs 混用。

## 15. Status / Empty / Loading / Error

### Status

状态需要同时使用：

```text
图标 + 文案 + 语义色
```

Ember 只表示品牌动作、当前选中、焦点和运行中，不表达错误和成功。

### Empty

```text
说明当前为什么为空
提供一个直接的下一步动作
```

不使用巨型装饰卡片，不只写“暂无数据”。

### Loading

- skeleton 尺寸接近最终布局。
- 图片保留 aspect-ratio。
- 列表保留行高和操作列。
- 按钮 busy 保留宽度。

### Error

- 显示发生了什么。
- 显示数据是否安全。
- 显示如何恢复。
- 持续错误留在发生位置。
- Toast 只处理短暂反馈。

## 16. Phase A 页面检查点

Token 和原子组件修改后先检查：

```text
Light Button
Dark Button
Light Input
Dark Input
Light Popover
Dark Popover
Light Dialog
Dark Dialog
Disabled
Loading
Focus
Pressed
Danger
```

固定截图尺寸：

```text
1440 x 900
1208 x 766
800 x 900
390 x 844
```

## 17. Phase A 测试范围

可能涉及：

- `packages/ui/src/__tests__/primitives.test.tsx`
- `packages/ui/src/__tests__/tokens.test.ts`，若现有测试结构适合新增
- 共享 UI 视觉门禁。
- 桌面 Light/Dark 截图。
- Web Light/Dark 截图。

源码修改后按根命令矩阵执行：

```text
npm run check
npm run test:visual:shared
npm run check:v1.1
npm run test:e2e:web
```

如果只修改 `packages/ui`，也必须验证桌面和 Web，因为它是共享层。

## 18. Phase A 非目标

本阶段不同时：

- 修改 Sidebar 宽度和导航内容。
- 重写 Composer。
- 修改结果网格。
- 修改设置页面结构。
- 引入新 CSS 框架。
- 引入新的图标库。
- 在桌面 feature 复制 Button 或 Input。
- 修改 contracts 或业务数据。
- 修改 `apps/desktop/package.json` 版本号。

## 19. 推荐实现顺序

```text
1. 读取现有 token 和原语测试
2. 增加 surface/radius/gap/shadow 语义别名
3. 更新 Light/Dark 根变量
4. 升级 Button 和 IconButton
5. 升级 Input、Textarea 和 Select
6. 升级 Popover、Dialog、Tooltip
7. 升级 Switch、Tabs、Segmented
8. 补齐 loading、empty、error 状态
9. 跑共享视觉门禁
10. 再进入 Phase B Sidebar/Layout
```

每一步都应保持源码可编译和页面可启动，不把所有原子组件堆到一次大改中。

## 20. 本阶段最终验收

- [ ] 新增 2.0 语义 token，旧 token 仍兼容。
- [ ] Light/Dark 表面层级一致。
- [ ] Sidebar、MainView、Dock 所需 Shell token 已存在。
- [ ] Button、IconButton、Input、Textarea、Select、Popover、Dialog 状态完整。
- [ ] Switch、Tabs、Segmented 的 selected/focus/disabled 完整。
- [ ] 圆角和阴影来自 token，不散落硬编码。
- [ ] Icon button 有 accessible label 和 tooltip。
- [ ] loading、empty、error 不改变主要布局尺寸。
- [ ] 1440、1208、800、390 四组截图无溢出和重叠。
- [ ] `npm run check`、共享视觉门禁和受影响的端到端门禁通过。
- [ ] 本阶段没有修改页面业务行为、契约、数据库或对外能力。
