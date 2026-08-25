# 设置界面 v2 架构记录（v1.4.1）

> 本文件记录 1.4.1 设置界面重构的**实际落地架构**，供后续迭代对照。
> 视觉方案见同目录 `SETTINGS-UI-REDESIGN-v1.4.1.md` 与 HTML 原型。
>
> **v2 注记（2026-08-24）**：NAV_GROUPS 已由五组 12 分区收敛为三组 6 分区，
> 旧分区 key 经 settings store 别名翻译兼容深链；新结构见
> `SETTINGS-IA-CONSOLIDATION-v2.md`。

## 分层

```text
packages/product-ui/src/settings/
  SettingsWorkspace.tsx    全屏布局壳：分组导航 + 搜索过滤（NFKC 归一）+ 移动端 tabs + 返回按钮/底部插槽
  SettingsComponents.tsx   展示原语：SettingsSection / SettingsCard / SettingsRow /
                           SettingsSegmentedControl / SettingsSwitch（a11y：radiogroup / switch）
apps/desktop/src/features/settings/components/SettingsView.tsx
  NAV_GROUPS 五组导航（账户与接入 / 模型与服务 / 创作偏好 / 开放能力 / 数据与应用），
  原有 12 个分区组件原样嵌入——功能零占位
apps/web/src/views/SettingsView.tsx
  WebSettingsView：account + connections 两分区嵌入共享壳（Web 暂保留全部设置内容）
```

## 关键决策

- **props 驱动，不做注册中心**：宿主传 groups/activeSection/search，共享层不持状态。
  此前的 `packages/settings-ui`（registry/store/platform-adapter 方案）已废弃删除。
- **token 单一事实源**：设置样式只用 `@musefold/ui/tokens.css` 的既有 token；
  `product-ui/styles.css` 的设置段不得自定义 token（`check:ui-boundaries` 门禁）。
  布局样式分宿主：桌面 `apps/desktop/src/styles/settings.css`（窗口控制/拖拽区），
  通用段在 `product-ui/styles.css`。
- **能力门控**：设置分区经 `runtime/capabilities` 的 `SETTINGS_SECTION_CAPABILITY`
  过滤（真实 ProductCapabilities 键：cloudMcpConnections / byokProviders / agent / automation）。
- **全屏**：设置视图下 `AppShell` 以 `hideSidebar + hideTitleBar` 运行；补 32px 拖拽区，
  win/linux 保留 `WindowControls`。mac 交通灯压拖拽区（真机待验）。
- **深链兼容**：分区状态仍在 `features/settings/store` 的 `section`——库页「数据」、
  自动化事件定向打开不需要改。
- **默认启用**：无开关、无灰度，v2 即设置界面本体；旧平铺导航已删。

## 契约守卫（已迁移到新结构）

- 「已归档聊天是最后一个设置分区」——NAV_GROUPS 中 archived 排在 about 之后。
- 契约测试断言 `NAV_GROUPS` 的 `id:`/`label:` 对；开关类断言共享原语
  （`<SettingsSwitch` / `testIdPrefix`），不再断言手写 markup。
- 双端复用基线 `BOTH_HOSTS_BASELINE = 68`（SettingsWorkspace 等符号双端消费后上调）。
