# 账号页 v2：官方优先 · 豆包体验通道

> 状态：已落地（2026-08-24）。范围：桌面端「设置 → 账号」信息架构重排、「开发者选项」更名为「豆包前台」、侧栏身份菜单官方优先。
> 前置阅读：`docs/design/SETTINGS-IA-CONSOLIDATION-v2.md`（v2 设置整合）、`doc/v1.0/04-generation-and-provider.md`（豆包网页通道与额度机制）。

## 产品定位（本页的裁决原则）

- **官方账号优先**：Musefold 官方账号是推荐主通道（登录即托管生图 + Agent，无 API Key）。
- **豆包为体验/备用通道**：官方未就绪时供用户体验；每日限 10 次提交（`DOUBAO_WEB_DAILY_IMAGE_LIMIT`，主进程按「账号名 + 本地自然日」强制，失败也计数）以降低账号风控风险。**本次不新增限额机制**，只把限量的防封号语义在 UI 上显性化。
- 已确认决策：官方已登录时豆包**保留为备用通道**（不隐藏、不禁用），文案标注「官方优先」。

## 一、账号页信息架构（apps/desktop AccountSettingsSection）

```
SectionShell「账号」（唯一壳；描述声明官方优先）
├─ 官方账号区（AccountSection，第一位）
│   ├─ 未登录：卡「登录 / 注册 Musefold 账号」
│   │   · 描述「推荐通道…」；表单与 testid 不变
│   │   · 新增引导：「暂不注册？使用下方豆包 · 体验通道，每日最多 10 张」
│   │   · 「使用其他账号服务器」折叠项保留
│   └─ 已登录（原巨型卡拆为一卡一职责）：
│       账户概览（settings-account-signed-in：AccountSummaryPanel + 健康 pill + 失效/不可达错误）
│       额度与兑换（兑换码表单）
│       账号内置模型（account-managed-models）
│       数据与同步（AccountCloudSyncPanel，去内嵌 border-b）
│       服务公告（仅 notices>0 渲染）
│       登录与设备（当前账号/令牌后缀/服务器 URL/两段式退出登录）
└─ 豆包 · 体验通道区（DoubaoSection，第二位）
    单卡（原「豆包账号」+「登录与保护」两卡合并）：
      · 描述即定位：「官方账号的备用生图通道；每个自然日最多提交 10 次，降低账号风控风险」
      · 官方已登录附注「推荐优先使用官方通道」
      · Facts（账号/今日用量/运行方式）+ 网页登录 / 每日保护限制 / 豆包前台 三行
```

修复的布局欠账：三层同叫「账号」的 SectionShell 嵌套（h1 重复）收敛为顶层一层；7 类异构内容手工 border-b 分隔的巨型卡拆为分组卡片，与其他设置分区节奏一致。

## 二、「开发者选项」→「豆包前台」（行为不变）

- 行 label「豆包前台」；hint：开＝「正在显示豆包网页前台，可实时查看后台自动化过程；下次启动自动恢复后台运行」，关＝「豆包在后台隐藏运行，登录二维码仍在应用内展示」。开关 aria-label「显示/隐藏豆包前台」。
- 验证提示改为引导打开「豆包前台」。
- 渲染层 store 字段 `doubaoDeveloperMode` → `doubaoForeground`（仍非持久化，每次启动恢复关闭）。**testid 保留** `settings-doubao-developer-row/toggle`；IPC 通道 `provider:setWebDeveloperVisible` 与主进程 `developerWindowVisible` 命名不动（非用户可见契约，避免无谓涟漪）。

## 三、入口一致性

- 侧栏身份菜单 `identityAccounts` 顺序对调：官方在前、豆包在后（`SidebarAccessSwitcher.tsx`，官方优先的入口表达）。
- 设置导航「账号」keywords 增加「体验通道」。

## 测试契约（不变项）

`settings-account-signed-out/in`、`account-username/password/confirm-password`、`account-{mode}-submit`、`account-managed-models`、`account-cloud-sync`、`settings-account-summary-panel`（视觉契约）、`settings-doubao-open`、「每日保护限制」行、「退出登录/确认退出」、`account-source-option-*`。
更新：`model-hub-ui.test.ts` 豆包前台改名断言（label/hint/store 字段）。

## Skill-Impact

`no`——纯渲染层 UI/文案/内部字段重命名；不改对外能力（IPC、自动化 API、MCP 均未动），豆包每日限额机制维持 10 次。
