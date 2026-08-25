# 设置信息架构整合记录（v2）

> 状态：已落地（2026-08-24）。本文件记录设置分区 12 → 6 收敛、中转站双分区合并、
> 左下角身份菜单（ZCode 式）与解释文案精简的**实际落地结构**，供后续迭代对照。
> 取代 `SETTINGS-V2-ARCHITECTURE-v1.4.1.md` 的导航结构与
> `RELAY-SETTINGS-UI-MASTER-DETAIL.md` 的双分区前提；master-detail 交互本身不变。

## 分区映射

| 新分区 key | 新分区 | 旧分区（深链别名） | 内容组织 |
|---|---|---|---|
| `account` | 账号 | `access` + `doubao` + `account` | DoubaoSection + AccountSection 去壳堆叠；接入模式切换上移身份菜单 |
| `relay` | 中转站 | `providers` + `ai` | RelaySection：分段控件「生图 / Agent」双 tab，各自 master-detail |
| `preferences` | 偏好 | `generation` + `appearance` | GenerationSection + AppearanceSection 去壳堆叠 |
| `open` | 开放能力 | `automation` + `connections` | AutomationSection + ConnectedAppsSection 去壳堆叠 |
| `data` | 数据与关于 | `data` + `about` | DataSection + AboutSection 去壳堆叠 |
| `archived` | 已归档聊天 | 不变 | 契约要求保持最后一个分区 |

导航分组：账户与接入 / 通用 / 数据与应用（3 组 6 项）。

## 关键机制

- **深链别名**：`features/settings/store.ts` 的 `setSection()` 接受旧 key 并翻译
  （`providers`/`ai` → `relay` 且预选对应 `relayTab`；其余按上表）。侧栏、命令面板
  （`PRODUCT_COMMAND_CATALOG` 的 `act-providers`/`act-ai-connections`）、自动化事件、
  LibraryPage 等历史调用点无需改造。
- **能力门控**：`SETTINGS_SECTION_CAPABILITY` 值支持数组（任一开启即显示）——
  `relay: [byokProviders, agent]`、`open: [automation, cloudMcpConnections]`；
  RelaySection 内部再按 flag 过滤 tab，被关掉的 tab 深链回落到另一 tab。
- **身份菜单**（`SidebarAccessSwitcher`）：豆包 / 官方 / 中转站同列，跨模式互切。
  账号目标走 `switchAccountSource`（验证 + 动画 + 回滚）；从账号模式跨入中转站时，
  除验证生图通道外还把 Agent 通道切到 `preferredByokEntry` 并验证，任一失败不切换。
  未登录账号行显示「未登录 · 点击去登录」直达 `account` 分区（不再禁用置灰）。
- **删除项**：`AccessModeSection.tsx`（含 `AccessModeTransition` 全屏动画）、
  两个「通道边界」事实卡、AiConnectionsSection 页脚脚注、字段级密钥安全长文案
  （压缩为中转站页头一行「密钥仅保存在本机系统密钥链」）。

## testid 契约

- 保留：`settings-provider-row-*` / `settings-ai-row-*` / `settings-provider-new` /
  `settings-ai-new` / `provider-quick-switch` / `account-source-option-*` /
  `relay-model-option-*` / `relay-model-manage` / `sidebar-settings*`。
- 新增：`identity-switcher`（身份菜单容器，取代 `account-source-switcher` /
  `relay-model-switcher` 双容器）、`relay-tab-providers` / `relay-tab-ai`（分段控件）、
  `identity-account-settings`（菜单底部「账号设置」入口）、`relay-model-configure`
  （无中转站时的空态入口）。

## 偏差记录

- 提交拆分未能按计划执行：本次 IA 改造叠在大批未提交 WIP 之上（如
  `SettingsWorkspace.tsx` 为 WIP 新文件，SettingsView 直接依赖它），单独提交本任务
  文件集会产生无法独立编译的提交。需先落 WIP 或整体快照提交，再拆本任务增量。
- e2e 归因期间发现并顺手修复了三处 WIP 迁移遗留（均非 IA 改动引入，但阻塞门禁）：
  1. `ConnectedAppsSection` 迁移时误传 `showHeading={false}`，共享屏标题消失 → 移除
     包装恢复裸用 `ConnectedAppsScreen`；
  2. 设置行迁移到 product-ui `mf-settings-row` 后 padding 固定 14px，密度 token 失联
     （SET-07 失败）→ padding 改回 `var(--density-setting-row-y, 14px)`；
  3. product-ui 两条 `prefers-reduced-motion` 规则缺少桌面端 `data-motion` 闸门，用户
     显式选「完整动效」时过渡仍被清零 → 加 `html:not([data-motion='off'])` 前缀
     （Web 无该属性，行为不变）。
- `test_compact_density_updates_library_virtual_rows_without_overlap` 在 HEAD 基线
  （git worktree 复核）同样失败（虚拟行估算 1.7px 重叠），为存量问题，未在本任务处理。
