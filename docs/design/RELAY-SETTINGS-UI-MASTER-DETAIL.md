# 中转站设置 UI 美化设计(Master-Detail)

> 状态:第一步、第二步已落地(2026-08-24)。本文件描述「生图中转站」与
> 「Agent 中转站」两个设置 section 的 UI 升级方案,分两步交付。视觉规格遵守
> `docs/design/SETTINGS-UI-REDESIGN-v1.4.1.md`,token 单一事实源为
> `packages/ui/src/tokens.css`。
>
> **v2 注记(2026-08-24)**:两分区已合并为一个「中转站」分区(分段控件双 tab),
> master-detail 交互与 testid 契约不变;新结构与偏差见
> `SETTINGS-IA-CONSOLIDATION-v2.md`。

## 背景

参考「模型设置」类产品的 master-detail 交互(左栏供应商列表 + 右栏就地编辑),
对照当前实现:

- 现状是「列表 + 弹窗编辑」:列表行只读,编辑走 `ProviderDialog.tsx`(566 行,
  位于 `apps/desktop/src/features/generation/components/`)与
  `AiConnectionDialog.tsx`(561 行)。
- 状态不可见:是否启用、Key 是否配置、测试是否通过,要点开弹窗或行内测试才知道。
- 两个 section(`ProvidersSection.tsx` / `AiConnectionsSection.tsx`)严格同构,
  同一套方案两边同时落地。

## 设计目标

- 状态一眼可见:启用/默认/Key 缺失/测试结果在列表层直接表达。
- 编辑就地完成:消灭弹窗,选中即编辑。
- 视觉语言收敛到既有规范:Ember 主色、卡片 12 / 控件 6 / 徽标 4 圆角,
  禁胶囊按钮,不新增 token。

## 第一步:视觉对齐(不动信息架构)—— 已落地(2026-08-24)

保留「列表 + 弹窗」骨架,只做视觉与状态表达升级。

### 列表行(`ConnectionRow` 骨架不变)

| 元素 | 规格 |
| --- | --- |
| 状态点 | icon 砖右下角 8px 圆点:测试通过 `--success`;缺少密钥 `--warning`;测试失败 `--danger`;未测试/测试中 `--border-default` 灰 |
| 徽标 | 「默认」保留 `bg-primary` 反色砖 |
| meta 行 | 维持 font-mono 单行(baseUrl · 模型 · `Key ····{suffix}`);模型名用 `displayModelName` 别名(现状已用);「缺少密钥」用 `--warning` 色(现状已是) |
| 操作 | 「设为默认 / 测试连接(Zap)/ 编辑 / 删除(InlineConfirm)」不变 |

落地要点:

- 状态点由纯函数 `resolveConnectionDot`(`apps/desktop/src/features/settings/components/connection-status.ts`)
  统一产出 `{ tone, label }`,`ConnectionRow` 新增 `statusDot` prop 渲染
  (a11y:`title` + `sr-only` 文本,testid 派生为 `{row-testid}-status`)。
  两个 section 共用同一映射,测试覆盖在 `settings/__tests__/connection-status.test.ts`。
- **偏差修正 1:数据模型没有「启用/禁用」字段**(只有 `isActive`=默认),不虚构
  「已启用/已停用」徽标——状态表达全部由状态点承载。原方案徽标行的
  StatusBadge success/subtle 一条随之取消。
- **偏差修正 2:doubao-web 类型无密钥概念**,状态点只随测试状态走
  (`keyAgnostic` 分支);其余类型缺密钥优先于测试结果亮 warning。
- 生图 `skipped`(无密钥跳过测试)映射 warning;`testing`/`idle`/无记录映射灰色。

### 弹窗内表单

- 字段分组排序:「连接」(名称 / Base URL / API Key)→「模型」(模型列表 + 拉取)→「计费」(仅生图弹窗)。
  分组间用既有发丝线节奏(`border-t border-border-subtle` + padding),未新造分组标题组件。
- 模型从胶囊选项改为行式列表:共享组件 `apps/desktop/src/components/ui/model-option-list.tsx`
  (`ModelOptionList`,role=listbox/option,行 = 模型名 + 选中态 Check,px-3 py-1.5 行节奏),
  两个弹窗共用;容器与选项的既有 testid 全部保留(E2E 依赖)。
- **偏差修正 3:不新增「+ 添加模型」按钮**——现状交互是「输入即添加」
  (手工模型 ID 经 `mergeModelOptions` 进入列表),拉取/刷新按钮从输入框右侧
  移到模型分组底部,能力不变,只改呈现。
- 预设与模型的 `rounded-full` 胶囊收为 `rounded-sm`(6px,`--radius-sm`);
  生图弹窗 managed 态的胶囊覆盖(`rounded-full px-4 shadow-none`)一并清理。
- doubao-web 分支从「模型之后」移入「连接」分组内(名称 / 豆包账号),字段能力不变。

## 第二步:Master-Detail 结构升级 —— 已落地(2026-08-24)

两个中转站 section 已改为左右分栏、就地编辑,settings 内不再弹编辑弹窗。

```text
┌─ SettingsCard(已配置服务商/连接)──────────────────────┐
│ ┌── 左栏 240px ──────┐ ┌── 右栏 详情面板 ──────────────┐ │
│ │ ▣ TvT(默认)        │ │ 名称   [默认徽标/设为默认] 🗑 │ │
│ │ ▣ 悟空云           │ │ 连接:名称 / Base URL / API Key│ │
│ │ ─────────────     │ │ 模型:输入 + ModelOptionList   │ │
│ │ + 新建服务商       │ │      + 拉取/刷新              │ │
│ │                   │ │ 计费单价(仅生图,底部分组)    │ │
│ │                   │ │ 测试结果 Banner / Capability  │ │
│ │                   │ │ [放弃] [测试连接] [保存]       │ │
│ └───────────────────┘ └─────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### 落点(全部为桌面薄组件,不进 product-ui)

- `settings/components/MasterDetail.tsx`:分栏容器 + 左栏行(`MasterDetailItem`)+
  `ConnectionStatusDot` + `InlineConfirm`(自 `ConnectionRow.tsx` 迁入,`ConnectionRow.tsx` 已删除)。
- `settings/components/ProviderDetailPanel.tsx`:生图详情面板;预设选择 / doubao-web 登录 /
  计费分组析出在 `provider-detail-parts.tsx`(文件尺寸门禁)。
- `settings/components/AiConnectionDetailPanel.tsx`:Agent 详情面板;预设卡片网格并入
  `AiConnectionDialogParts.tsx`(`AiConnectionPresetGrid`),纯函数在
  `ai-connection-panel-utils.ts`。
- 样式:`apps/desktop/src/styles/settings.css` 的 `.settings-md*` 一组,只用 tokens.css 既有
  token;`ConnectionRow` 的旧 `.settings-connection-row*` 规则已清理。
- 生图表单部件(`Field`/`PricingModeButton`/`mergeModelOptions`/`validatePricingDraft`)经
  `runtime/generation-access.ts` 桥接给 settings(features 同层不互导)。

### 左栏

- 行 = 品牌 icon + 名称 + 状态点(规格同第一步,testid 派生 `{row}-status` 不变)
  +(默认徽标);行 testid 沿用 `settings-provider-row-{id}` / `settings-ai-row-{id}`。
- 选中态复用 `SettingsWorkspace` 侧栏导航视觉:`radius-sm`(6px)、`bg-active`、
  无框、左侧 3px accent 条。
- 底部「+ 新建服务商 / 添加连接」ghost 按钮,testid 沿用 `settings-provider-new` /
  `settings-ai-new`。
- **无「预设/自定义」分组标题**:数据没有分组概念,按数据现实不虚构。

### 右栏详情面板

- 头部:名称 + 「设为默认」按钮(relay 模式且非默认)或「默认」徽标 +
  删除(`InlineConfirm` 行内二次确认)。
- 草稿态用 product-ui `useDraftForm`(实体字段:name/type/baseUrl/model 等);
  API Key(只写)与计费单价(独立 IPC)留局部状态。显式「放弃 / 测试连接 / 保存」;
  新建态「放弃」文案为「取消」并退出新建。
- 模型:`ModelOptionList` + 拉取(生图)/ 刷新(Agent)按钮,testid 全部沿用弹窗期约定。
- 测试结果:生图走 store `testProvider` + `ValidationResultBanner`(状态点/汇总条随
  testStatus 同步);Agent 走 `validate` + `CapabilityResult` 面板。
- 计费单价(仅生图)在详情面板底部「计费单价」分组,经 `api.settings.pricing` 读写。

### 新建流程

左栏底部按钮(或空态快捷入口)进入**新建草稿**:右栏顶部保留预设选择(生图预设行 /
Agent 预设卡片网格,仅新建态出现),保存/测试/刷新时才落库创建并选中。空态
(`ProviderEmptyGuide` settings 场景 / Agent 空态快捷预设)同样改为就地新建——
`ProviderEmptyGuide` 新增 `onOpenNew` 覆盖入口,settings 场景不再开弹窗。

### 必须保留的既有分支(均已保留)

- `doubao-web`:详情面板不显示 Base URL / Key,操作为「打开登录窗口」
  (`DoubaoWebLoginField`)。
- `managedBy='account'`:只读,仅模型选择(两个面板均保留分支;列表仍过滤托管条目)。
- Agent 侧 `routeKind`(厂商直连/兼容网关)分段与「撤销 Key」(详情面板 API Key 字段旁)。

### 响应式

`<960px` 时左栏降级为顶部横向可滚动列表(accent 条隐藏),详情面板单栏堆叠,
与 `SettingsWorkspace` 侧栏 → tabs 节奏一致(settings.css `@media (max-width: 959px)`)。

### 偏差记录(第二步)

1. **「已启用/停用」开关不做**:数据模型没有启用/禁用字段(同第一步偏差修正 1),
   详情面板头部用「设为默认 / 默认徽标」(isActive 语义)替代。
2. **`ProviderDialog.tsx` 保留不删**:它仍被 settings 之外的入口引用——
   `App.tsx`(自动化 `onSetupRequested` 草稿流程,全局挂载)、
   `HistoryDetail.tsx`(历史页编辑服务商)、`ProviderEmptyGuide` 的 generate/studio 场景。
   settings section 已完全不再调用 `openProviderDialog`;弹窗契约测试
   `provider-dialog-ui.test.ts` 保留不动。
3. **`AiConnectionDialog.tsx` 已删除**(仅 settings 引用);store 的
   `dialogOpen/editingConnection/dialogPresetId/openDialog/closeDialog` 一并移除,
   选中态改为 section 本地 state。`AiConnectionDialogParts.tsx` 文件名保留
   (Field/RouteButton/CapabilityResult/PresetGrid 继续被详情面板复用)。
4. **行级 meta 与行内操作随列表行退场**:左栏行为紧凑行(icon + 名称 + 状态点 + 默认徽标),
   baseUrl / 模型 / Key 后缀等 meta 与「测试连接 / 编辑 / 撤销 Key」操作全部收进详情面板;
   section 级「测试全部」与测试汇总条保留在卡片顶部。
5. **Agent 测试结果用 `CapabilityResult`**(自弹窗迁入详情面板),不是原方案写的
   `ConnectionTestSummary`——前者承载 capabilities 明细,信息更完整。
6. **预设选择去向**:详情面板顶部、仅新建态(没有选择「新建时先选预设」的独立步骤)。
7. **生图面板测试改走 `testProvider`**:测试结果写入 store testStatus,
   状态点与「测试全部」汇总条自动一致;弹窗期「测试时合并发现模型到列表」的行为取消,
   模型发现统一走「拉取」按钮。

## 落点与约束

| 事项 | 落点 |
| --- | --- |
| 布局/卡片/开关/徽标 | 复用 `packages/product-ui` 的 `SettingsCard` / `SettingsRow` / `SettingsSwitch` / `StatusBadge`,不新造共享原语 |
| 分栏容器 | 若双端复用价值成立,放 `packages/product-ui/src/settings`;否则为桌面薄组件 |
| 新增样式 | 只写 `apps/desktop/src/styles/settings.css`,只用 tokens.css 既有 token(`check:ui-boundaries` 门禁) |
| 颜色语义 | `--accent`(Ember)主色;状态一律 `--success` / `--warning` / `--danger`,不引入参考图绿色系 |
| 圆角 | 卡片 12 / 按钮输入 6 / 徽标 4 / 状态点圆形;清理存量 `rounded-full` |
| 数据模型 | 不变:`ProviderConfig`(desktop-contracts/providers.ts)/ `AiConnectionProfile`(desktop-contracts/ai.ts);Key 仍只走 safeStorage |
| 替换范围 | `AiConnectionDialog.tsx` 已删除,测试面板迁入详情面板;`ProviderDialog.tsx` 因 settings 外入口(App 自动化草稿 / HistoryDetail / 空态非 settings 场景)保留,见第二步偏差 2 |
| Web 端 | 不涉及(中转站为桌面独有,`byokProviders` 能力门控) |

## 验证

- `npm run check` 全绿(2026-08-24 两步落地后复跑均 exit 0)。
- 动共享样式或 product-ui 组件时:`npm run test:visual:shared`(本次未动,免跑)。
- 两个 section 的就地 `__tests__`(现有 `ai-connections-ui.test.ts` 等)
  同步更新;新增 master-detail 交互测试(选中切换、保存/放弃、删除确认、
  doubao-web 与 managed 分支)。

### 验证记录(2026-08-24)

- 桌面 E2E(`pytest tests/e2e/test_05_settings.py test_04_generate.py
  test_08_generation_workbench.py`,需 `env -u ELECTRON_RUN_AS_NODE`):
  改造引入的 1 条失败(`test_ai_connection_settings_model_fallback_and_export_isolation`)
  已修复——详情面板新建态下「测试/刷新」落库后不再切换选中项,避免面板 remount
  清空本地状态(`AiConnectionDetailPanel.tsx` / `ProviderDetailPanel.tsx` 的
  `handleTest`/`handleLoadModels`;选中切换只发生在保存时)。修复后重跑通过。
- 其余 4 条失败为工作区既有改动(v1.4.1 重设计未收尾项)导致,与本次改造无关,
  未修:已连接应用 heading 外移、density 链路换 product-ui `SettingsRow` 后
  compact 行高不生效、设置页 RatioPicker `variant="compact"` 不渲染
  `menu-summary`、settings 全屏隐藏侧栏使 `provider-quick-switch` 不可达(该条
  偶发通过,判为 flake)。这些测试适配应交回 v1.4.1 重设计工作流。

## 第三步:视觉与信息密度精修 —— 已落地(2026-08-24)

气质:macOS 系统设置(分组卡片+分组标题+右值灰字)× Linear/Raycast 克制密度
× Stripe/Vercel 密钥状态行与 sticky 操作条。不动信息架构与数据模型。

- 共享件(`MasterDetail.tsx`):列表行加 `meta` 二行(模型名/ baseUrl 灰字,
  解决同名不可分);新增 `PanelActions`(放弃/测试/保存 + dirty 圆点,sticky
  底部 `settings-md-actions`)、`PanelSectionTitle`(连接/模型/计费分组标题)。
- 详情面板:删除按钮从头迁至底部操作条左端(危险操作降权,保留 InlineConfirm);
  keySaved 时 `ApiKeyStatusRow`(Check+掩码+说明);Agent 侧 Key 整行 Stripe 式
  状态行(撤销同排);费用提示降为 Field hint。
- 列表层:测试汇总条迁入卡片头(清理负 margin);Agent 空态对齐生图行式节奏;
  生图预设选择器升级为卡片网格(`provider-preset-grid` / `provider-preset-option-*`);
  ProviderEmptyGuide settings 分支居中限宽+大 icon 砖。
- 结果条:`ValidationResultBanner` 成功/失败统一同构面板 + 左侧 3px 状态色条;
  详情面板补传 `modelCount`。
- 动效:accent 条/hover 过渡全部挂 `html:not([data-motion='off'])` 门控。

约束兑现:全部改动 ≤600 行(`ProviderDetailPanel` 590→594,受字段顺序源码断言
限制无法再析出);六条 settings.css 契约字面量、全部 e2e testid 逐条保留;
未动 product-ui / 主进程 / 契约。新增 testid:`settings-panel-dirty`、
`provider/ai-connection-section-*`、`provider/ai-connection-delete`、
`provider-api-key-status`、`ai-connection-key-status`、`provider-preset-*`、
`settings-ai-quick-custom`。

验证(2026-08-24):`npm run check` exit 0(1184 测试);e2e
test_04/05/07/08 共 104 条 103 过,唯一失败为存量
`test_compact_density_updates_library_virtual_rows_without_overlap`
(干净 HEAD 同样失败,见 SETTINGS-IA-CONSOLIDATION-v2.md 偏差记录)。
本轮由规划+实现两个子智能体接力完成,计划与实施分离。
