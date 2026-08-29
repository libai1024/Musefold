# 02 侧边栏(导航 + 会话列表 + 账号区) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/components/layout/{Sidebar,SidebarAccessSwitcher,SidebarIdentityMenu,SidebarSettingsMenu,IdentityMenuBody}.tsx` + `packages/product-ui/src/navigation/ProductSidebar.tsx` + `packages/product-ui/src/workbench/{WorkbenchSessionList,WorkbenchSessionContextMenu,WorkbenchSessionDeleteDialog,WorkbenchSessionRenameDialog}.tsx`。
> **新版源码**:`packages/features/src/shell/AppShell.tsx`(aside 部分)+ `packages/features/src/workbench/SessionListPanel.tsx` + `packages/features/src/account/AccountFooter.tsx`。
> 容器级几何(宽度/断点/抽屉)见 [01-shell.md](./01-shell.md),本文只谈栏内内容。

---

## 1. 结论与迁移状态

侧栏五段式结构(品牌行 → 新设计钮 → 功能导航 → 对话区 → 底部账号)完整承接,行级动作(置顶/重命名/归档/删除)和状态点(running/unread)已实现且交互口径比旧版更符合 §8-I2(常驻操作组)。原三个成规模缺口中两个已收口(2026-08-29):**会话日期分组**(置顶/今天/昨天/更早 + sticky 组标题)与**右键菜单五项**(含「标记为未读」+ 触屏「更多」钮)均落在 `SessionListPanel`;剩余一个:**底部账号区从双菜单系统简化成了单一跳转钮**(身份切换、桌宠开关、设置深链全部依赖设置页兜底)。

## 2. 布局对照

### 2.1 五段式结构

| 段 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 品牌行 | `MusefoldMark` + "Musefold" + 收起钮;`--mf-sidebar-header-inset` 让红绿灯 | 同构(`h-12`,mark `size-4` + text-sm + 收起钮) | 一致 |
| 新设计钮 | 全宽按钮:`SquarePen` 图标 + 「新设计」+ 右侧 `<kbd>⌘N</kbd>`;title 带快捷键 | 同构(`variant=outline`,kbd 挂载后显示防 hydration 闪) | 一致,视觉从填充式变描边式(可接受,主色留给发送钮) |
| 功能导航 | 「功能」11px 分区标签 + 图标行;`data-active`、`aria-current`、可选 count 角标 | 同构;无 count 角标 | 基本一致;**count 角标能力未迁**(旧版接口有、桌面未使用,P3 观察) |
| 对话区 | 「最近对话」header + 分组列表(见 §3) | 「对话」标签 + 平铺列表 | **分组缺失,P1** |
| 底部 | 账号名片 + 双菜单(身份/应用) | `AccountFooter` 单钮 | **P1**,见 §5 |

### 2.2 行内几何

- 旧会话行:置顶钮(hover 渐显,行首)→ 状态点 → 标题 → 行尾动作组(归档常驻 hover、触屏「更多」钮);选中态 `data-selected` 背景。
- 新会话行:状态点 → 置顶 Pin 图标(常驻,`text-primary`)→ 标题 → hover/focus-within 渐显动作组(置顶/重命名/归档/删除四钮,`size-6`);选中 `bg-sidebar-accent`。
- 新版把「置顶」从行首 hover 钮改到行尾动作组、置顶态以行内 Pin 图标常显,信息密度和可达性都不劣于旧版,**维持新版口径**。

## 3. 会话列表交互对照

| 交互 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 日期分组 | `groupWorkbenchSessions`:置顶 → 今天 → 昨天 → 更早,组内按 `updatedAt` 降序;组标题 `<h3>`,`aria-label="今天的对话"` | ✅ 已收口(2026-08-29):`groupWorkbenchSessions` 移植进 `SessionListPanel`(now 注入可测,置顶为偏好通道入参),`<section aria-label>` + sticky 组标题(02-C1 一并落地) | 收口 |
| 打开会话 | 点击行主体;`aria-label` 拼接状态语(「正在生成」/「未读」) | 同;`aria-label` 无状态语(状态点自带 aria-label) | 一致(a11y 口径不同但等价) |
| 置顶/取消置顶 | 行首 hover 钮 + 右键菜单;`aria-pressed` | 行尾钮;偏好通道持久化 | 一致偏优(D6 登记) |
| 重命名 | 右键菜单进入行内 `<form>`:Input(maxLength 80)+「保存」钮,Esc 取消;顶栏菜单走 `WorkbenchSessionRenameDialog` 对话框 | 行尾钮进入行内 Input + Check 钮,Enter 提交 / Esc 取消 | 一致;**maxLength 80 丢了**(新版不限长,契约 120),P3 对齐契约即可 |
| 归档 | 行尾 hover 钮 + 右键菜单;归档即清未读 | 行尾钮;归档清置顶、清活动会话 | 一致 |
| 删除 | 仅右键菜单入口 → `WorkbenchSessionDeleteDialog` 确认 | 行尾钮 → AlertDialog 确认(文案说明图片保留在历史) | 一致偏优(入口从浮层提为常驻,I2) |
| **标记为未读** | 右键菜单项:手动把会话标回未读点 | ✅ 已收口(2026-08-29):`session-store.markUnread`(unreadMarks 覆盖 seenAt),打开会话/markSeen 即清;右键与「更多」菜单双入口 | 收口 |
| 右键菜单 | `WorkbenchSessionContextMenu`:坐标锚定、焦点圈闭、关闭归还焦点到行;键盘 ContextMenu 键 / Shift+F10 触发 | ✅ 已收口(2026-08-29):ui 包新增 radix `ContextMenu` 原语,五项(置顶/重命名/归档/标记未读/删除)与「更多」DropdownMenu 同构单源;焦点圈闭/归还与 Shift+F10 由 Radix 承接 | 收口;触屏「更多」钮(`session-more`)一并恢复,动作组 `pointer-coarse:opacity-100` 常显 |
| 状态点 | `data-status` 三态;running 走 `status-breathe` 呼吸动画(1.8s 缩放+透明度) | running = `animate-pulse`(透明度闪烁),unread = 实心点 | **P2 动效降级**:旧版是缩放呼吸,新版是标准 pulse;恢复 `status-breathe` keyframes 到 ui 包 |
| 读取失败 | 错误卡:标题 + 消息 + 重试钮;`WORKBENCH_SESSION_RESTART_REQUIRED` 特判「需要重启应用」+ 立即重启钮(调 `system.relaunch`) | 错误文案 + 重试钮 | **P2 缺口**:重启特判是桌面 SQLite 迁移失败的逃生门,装桌面壳时必须恢复 |
| 加载态 | 「正在读取对话」spinner 行 | 3 条 Skeleton | 新版更优(I1),维持 |
| 空态 | 文案「还没有对话。点『新设计』开始…」 | 同文案 | 一致 |

## 4. 会话菜单能力矩阵(承 01 §4-4)

旧版同一组会话动作有三个入口:侧栏行 hover、侧栏行右键菜单、顶栏会话菜单。新版只剩侧栏行常驻钮一个入口。逐能力盘点:

| 能力 | 旧入口 | 新入口 | 缺口 |
|---|---|---|---|
| 置顶 | 三处 | 行尾钮 | 无 |
| 重命名 | 右键 + 顶栏(Dialog) | 行尾钮(行内编辑) | 无 |
| 归档 | 行 hover + 右键 + 顶栏 | 行尾钮 | 无 |
| 删除 | 右键 + 顶栏 | 行尾钮 | 无 |
| 标记未读 | 右键 + 顶栏 | 右键 + 更多菜单 | ~~是~~ 已收口 |
| 任务摘要 readout | 顶栏 | — | 是(归工作台屏,见 03 §4) |

**结论**:~~不必复刻三入口冗余,但右键菜单(桌面惯性极强的交互)+ 标记未读要回来~~ ✅ 已收口(2026-08-29):最终实现比原方案更正统——radix `ContextMenu` 原语(而非 DropdownMenu 挂 onContextMenu)+ 触屏「更多」DropdownMenu,五项菜单数组单源,两菜单同构渲染。

## 5. 底部账号区对照

旧版是**双菜单系统**(`SidebarAccessSwitcher`):

1. **身份菜单**(`SidebarIdentityMenu` → `IdentityMenuBody`):账号名片(头像/名称/积分)、正式/体验通道切换(带 `AccountIdentityTransition` 全屏过场动画,交换动画结束才真正 `switchAccountSource`)、「配置中转站」「管理生图中转站」「管理 Agent 中转站」「账号设置」四条设置深链(直达设置对应分区与 relay tab)。
2. **应用菜单**(`SidebarSettingsMenu`):桌宠开关、「应用设置」入口;两菜单互斥开启。

新版 `AccountFooter`:未登录=「登录账号」行,已登录=头像縮写 + 名称 + 积分,整钮点击进设置账号卡;`MobileQuotaReadout` 把积分放进移动顶栏。

判定:
- 账号名片信息(名称/积分)**已对位**,且加载/未登录/已登录三态齐全(旧版未登录时名片显示「未登录」)。
- 正式/体验**通道切换**随多通道账号体系暂缓(v2.5 凭据委托单通道),过场动画组件(`AccessTransitions`)登记勿删,待多通道回归时评估。
- 设置深链:旧四条深链依赖设置分组导航存在;当前设置是单列卡片流(D10),深链价值低。**随 07 系列恢复分组导航时,把 footer 升级为 DropdownMenu(账号设置/AI 连接/云同步三条深链 + 退出登录)**,P2。
- 桌宠开关:桌宠冻结(D8),开关随 automation/关于域后续排卡,P3。

## 6. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 行 hover 动作渐显 | CSS opacity 过渡(`--dur-fast`) | `transition-opacity`(Tailwind 默认 150ms) | 一致 |
| running 状态点 | `status-breathe` 1.8s 缩放呼吸(0.78→1 scale + 0.5→1 opacity) | ✅ 已恢复(2026-08-29):`mf-status-breathe`(ui globals.css,承旧值);工作台头像点按 03 §5 判定保留 Spinner 新形态 | 收口 |
| 菜单开合 | Radix Dropdown + `scale-fade-in`(`--ease-spring`) | ✅ 已恢复(2026-08-29):ContextMenu/DropdownMenu 均带 radix 开合动画(`data-[state]` fade+zoom) | 收口 |
| 身份切换过场 | `AccountIdentityTransition` 专用编排 | 暂缓 | 登记勿删 |
| 减弱动效 | 双通道压制 | ✅ 已收口(2026-08-29,见 01 §5) | 本篇动效任务(呼吸点/菜单开合)闸门已开 |

## 7. 差距 → 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P1~~ | ~~会话日期分组~~ ✅ 已收口(2026-08-29,见 §3 表);单测覆盖日界/置顶排序 | — |
| ~~P1~~ | ~~会话右键菜单 + 触屏「更多」钮~~ ✅ 已收口(2026-08-29,见 §4 结论);交互测试覆盖右键开合与菜单项 | — |
| ~~P1~~ | ~~「标记为未读」~~ ✅ 已收口(2026-08-29):实现为 `unreadMarks` 覆盖层(优先于 seenAt),单测覆盖标记/清除 | — |
| ~~P2~~ | ~~running 点恢复 `status-breathe` 呼吸~~ ✅ 已收口(2026-08-29,见 §6 表) | — |
| P2 | 会话读取失败的「需要重启应用」特判(桌面能力开关) | 桥抛 RESTART_REQUIRED 时显示重启钮 |
| P2 | AccountFooter 升级 DropdownMenu(设置深链 + 退出登录),随设置分组导航排卡 | 深链直达对应设置分区 |
| P3 | 重命名 maxLength 对齐契约 120;导航 count 角标接口预留 | — |

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

Codex 侧栏的可学之处恰好都压在本篇 P1 上:日期分组(Today/Yesterday/Previous 同构)、右键菜单带快捷键列、hover 渐显动作组。增益是在这些 P1 落地时顺带把工艺做足:

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 02-C1 | C1 | ✅ 分组标题 sticky(2026-08-29 随日期分组落地) | 组标题 11px `--muted-foreground`,`sticky top-0` 衬 `--sidebar` 底色,滚动时压住组内行;组间距 12px(`mb-3`);无分隔线 |
| 02-C2 | C1 | 右键菜单快捷键右列(挂起) | 当前五项菜单无一项有全局键位,按 00 法则 6 不渲染 Kbd 列(代码已留注释);待任一菜单项真实接线键位时补 |
| 02-C3 | C1 | 行六态补齐(挂靠 00 C-3) | 会话行/导航项 press 底色深一阶;选中态维持直切(承旧刻意,不动画);触屏 press 反馈必须可感 |
| 02-C4 | C2 | 新会话入列动画 | 「新设计」创建后新行 4px 上移淡入(`--dur-base` + `--ease-out`,过闸门);旧版无此动效,属纯增益,快照锁定后登记 SPEC §9 |
