# 07-00 设置壳(分组导航工作区) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。设置系列共 9 篇:本篇讲设置容器(导航/搜索/布局骨架),07-01~07-08 逐分区展开。
> **旧版源码**:`apps/desktop/src/features/settings/components/SettingsView.tsx` + `packages/product-ui/src/settings/SettingsWorkspace` + `apps/desktop/src/styles/settings.css`(627 行)+ `features/settings/store.ts`。
> **新版源码**:`packages/features/src/settings/SettingsScreen.tsx`(单列卡片流)。

---

## 1. 结论与迁移状态

旧设置是一个**独立全屏工作区**:隐藏产品标题栏与侧栏,自带三组八分区的左侧分组导航、导航关键词搜索、「返回工作区」动作,以及 Win/Linux 专用窗口控件与拖拽条。新版是**单列卡片流**(D10 已登记:分区少时导航反增成本),当前只有 5 张卡(外观/账号/云同步/AI 连接/数据),挂在普通屏容器内。D10 的约定是「分区 ≥5 时按 §6.1 目标形态切换」——随着 07 系列任务逐分区恢复,**设置壳升级为分组导航是一张确定要来的卡**,本篇即为那张卡的规格基准。

## 2. 旧版结构(恢复基准)

```text
┌ SettingsWorkspace(全屏,hideTitleBar + hideSidebar)────────────┐
│ settings-window-drag-region(顶部拖拽条)      [Win/Linux 控件] │
│ ┌ 左栏导航 ──────────────┬ mf-settings-content ────────────┐ │
│ │ [返回工作区] (ArrowLeft) │  SectionShell                   │ │
│ │ 搜索框(过滤导航项)      │   title + description           │ │
│ │ ── 账户与接入 ──        │   SettingsCard × n              │ │
│ │   账号 / 中转站          │    SettingRow(label+hint+控件) │ │
│ │ ── 通用 ──              │                                 │ │
│ │   偏好 / 开放能力        │                                 │ │
│ │ ── 数据与应用 ──        │                                 │ │
│ │   使用统计 / 数据存储 /  │                                 │ │
│ │   关于 App / 已归档聊天  │                                 │ │
│ └────────────────────────┴─────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

关键机制:

1. **三组八分区**:账户与接入(账号/中转站)、通用(偏好/开放能力)、数据与应用(使用统计/数据存储/关于 App/已归档聊天)。每项带图标与**搜索关键词表**(如账号 = 登录/注册/积分/云同步/豆包/兑换码…),搜索框按关键词过滤导航项而非过滤内容。
2. **能力门控**:`isCapabilityEntryVisible` 逐项过滤,空组整组隐藏——Web/桌面分发差异在导航层解决。
3. **深链兼容**:`setSection` 把 12 个旧分区 key(access/doubao/providers/ai/generation/appearance/automation/connections)翻译到 8 分区,并顺带定位中转站内部 tab;侧栏菜单、工作台引导、automation 事件都靠这些深链直达。
4. **分区状态持久化**:当前分区存 zustand + persist,重开设置回到上次分区。
5. **统一行组件**:`SettingsCard`(title+description 卡)+ `SettingRow`(左 label+hint、右控件)+ `ChoiceChips`/`SettingsSegmentedControl`(带图标的分段选择)——全部分区共用,是设置视觉一致性的根。

## 3. 新版现状

单列 `max-w-2xl` 卡片流:页头(标题 + 宿主 Badge)→ 外观卡 → 账号卡 → 云同步卡(能力开关)→ AI 连接卡(能力开关)→ 数据卡(宿主接线时)。无导航、无搜索、无深链(只有 `useScreenIntent` 的 trash 意图)、无独立工作区形态。shadcn `Card` 取代 `SettingsCard`,行内 flex 排布取代 `SettingRow`。

## 4. 判定与升级触发条件

| 项 | 判定 |
|---|---|
| 卡片流 vs 分组导航 | 维持 D10:当前 5 卡未到阈值。**07 系列每恢复一个分区重新评估;偏好拆出生成参数或恢复开放能力/关于任一分区时即达 ≥6,触发切换** |
| 独立全屏工作区 | 随分组导航同卡:隐藏壳侧栏 + 「返回工作区」+ 拖拽条(桌面);Web 保持普通路由页 |
| 导航搜索 | 随分组导航;关键词表从旧 `NAV_GROUPS` 原样搬 |
| 深链体系 | **先行任务(P2)**:`useScreenIntent` 扩展为 `settings-section` payload(替代旧 legacy key 翻译),侧栏 footer 菜单(02 §5)、Composer 无连接引导(现跳设置页顶)都需要它 |
| SettingRow/ChoiceChips 对位 | 恢复分组导航时在 features/settings 内建 `SettingRow` 复合组件(shadcn 原语拼装),先行统一现有 5 卡的行排布 |
| 分区记忆 | 随分组导航(persist 到偏好) |

## 5. 动效与 UIUX 细节

- 旧分区切换无过渡动画(直切,刻意);导航项 hover/active 背景过渡 `--dur-fast`。新版无导航不适用;恢复时沿用直切。
- 旧设置内容列宽约 640px 居中,`--density-setting-row-y` 控制行距(紧凑 0.5rem/舒适 0.75rem);新卡片流 `max-w-2xl`(672px)一致量级。密度体系随 01 §7。
- 旧「返回工作区」是键盘可达的显式出口(设置无侧栏时的唯一导航);新版设置仍在壳内,侧栏常在,出口天然存在——恢复全屏形态时必须带回。
- a11y:旧导航 `aria-current` + 分组 label;搜索框 `aria-label="搜索设置"`。恢复时沿用。

## 5.1 状态矩阵与双端行为(恢复分组导航时的验收基准)

| 状态 | 旧版行为 | 恢复要求 |
|---|---|---|
| 进入设置 | 恢复上次分区(persist);首次进入落「账号」 | 同;persist 走偏好通道而非裸 localStorage |
| 搜索无结果 | 导航区显示「没有匹配的设置项」,内容区保持当前分区 | 同,并给「清空搜索」快捷动作(I5 增补) |
| 分区被能力门控隐藏 | 深链落到该分区时回退到组内首个可见项 | 同;回退逻辑单测覆盖(旧 relay tab 回退是先例) |
| 窄窗(<760px) | 导航转顶部横向滚动条或抽屉(旧版桌面窗口最小宽度兜底,未真正适配窄屏) | **新版必须补移动形态**:导航转 Select 或分组 Accordion——这是旧版没做好、新版做得更好的机会点 |
| 键盘导航 | 上下键在导航项间移动,Enter 进入 | 同,`aria-current` 跟随 |

双端差异:桌面恢复「独立全屏工作区」(隐藏壳侧栏 + 返回钮 + 拖拽条 + Win/Linux 控件);Web 保持普通路由页(浏览器自带返回,壳侧栏保留)——两端共用分区内容组件,只有容器分叉,分叉点在宿主层而非 features 层(依赖方向红线)。

设置搜索的定位(恢复时想清再做):旧搜索只过滤**导航项**(按关键词表),不搜设置项内容;这个克制是对的——全文搜索设置内容的收益低、维护关键词表成本可控。关键词表随分区恢复逐个搬,新增分区(如语言)补词;关键词表本身放 features 内与导航目录同文件,单测断言「每个分区至少 3 个关键词」防退化。

## 6. 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P2~~ | ~~设置深链:screen-intent 扩展 `settings-section`~~ ✅ 已收口(2026-09-06):`{kind:'settings-section',section,highlight?}`;既有 `settings-account`/`settings-connections` 别名保留;Composer「前往设置添加」直达连接分区 | 双端深链滚动/高亮到目标卡 |
| P2 | `SettingRow`/`ChoiceRow` 复合组件统一现有 5 卡行排布 | 视觉快照无回退,行距/对齐一致 |
| P3(触发式) | 分组导航工作区:≥6 分区时启动;含三组导航/搜索/能力门控/分区记忆/桌面全屏形态 + 返回钮 | 对照本篇 §2 五条机制逐项验收 |

测试建议:分组导航落地时,E2E 至少覆盖「深链直达分区并滚动定位」「搜索过滤导航」「能力门控隐藏分区后深链回退」三条主路径,单测覆盖 legacy key 翻译表与关键词表完整性;视觉快照补设置工作区三形态(桌面全屏/Web 大屏/移动)。

## 7. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

设置是「安静 chrome」法则的主场:全屏几乎无 Ember、层级全靠字阶与行距——`SettingRow` 复合组件(§6 P2)是把这套纪律固化成代码的机会,规格一次定对,07 系列后续七个分区全部白得。

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 0700-C1 | C1 | `SettingRow` 工艺规格(挂靠 §6 P2) | 行高 ≥40px;左侧 label 13px `--foreground` + hint 11px `--muted-foreground`,右侧控件右对齐垂直居中;行间用间距分组(卡内不画满宽分隔线,00 §2-2);危险行文字 `--destructive` 但底色保持中性 |
| 0700-C2 | C1 | 控件态统一(挂靠 00 C-3) | Switch/Select/分段控件的 hover/press/focus-visible 六态过 00 §4;分段控件选中滑移 `--dur-fast` + `--ease-out` |
| 0700-C3 | C2 | 分组导航 Codex 形态(挂靠 §6 P3 触发式) | 导航项高 28px、图标 `size-4`、当前项 `--sidebar-accent` 底 + `aria-current`(不加左侧色条);分组标签 11px muted;搜索框 sticky 顶部;内容列 640px 居中承旧 |
