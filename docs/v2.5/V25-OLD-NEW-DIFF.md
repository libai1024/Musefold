# V25-OLD-NEW-DIFF — 旧版(v2.1 / `v2.5-baseline`)与新版(v2.5)对比

> **性质**:一次性审计报告,不是规范。规范以 [V25-UI-SPEC.md](./V25-UI-SPEC.md) 为唯一基准。**逐屏细化对照(含每屏任务清单)见 [ui-parity/ 系列](./ui-parity/README.md),排卡以那一组为准;本文保留总体量化视角。**
>
> **原则修正(2026-08-29)**:核心目标是新版与旧版 UI/动效/交互基本一致、体验可更好;代码量减少只是架构收敛的副产物,不是体验优劣的依据。本文 §2 的量化对比按此原则解读。
>
> **对比基线**:git tag `v2.5-baseline`(commit `0e5be61`,v2.1 进行中实现的最后快照) vs 当前工作树。
>
> **日期**:2026-08-29
>
> **口径**:代码量统计一律**排除测试文件**;桌面渲染层排除冻结面(`src/pet`)与 `src/preview`。

---

## 0. 一句话结论

信息架构、品牌语言、核心交互路径**基本原样承接**;实现层面把「桌面一套 + Web 一套 + 共享包一套」的三份平行渲染代码,收敛成「`features` 一份 + 两个薄宿主」,渲染层代码量降到旧版的约 **13%**,自定义 CSS 降到约 **2.4%**。

代价分两类:一类是**已登记的暂缓域**(设计方案、Skill 运行时、豆包网页、微调链、命令面板等,主进程语义都在,只是没有新 UI);另一类是**尚未登记的实现缺口**,其中全局 ErrorBoundary、参考图上传、图片 Lightbox 三项影响主路径,应优先排卡。完整清单见 §7。

---

## 1. 技术栈对比

| 维度 | 旧版 | 新版 | 影响 |
|---|---|---|---|
| Web 宿主 | `apps/web`,Vite + React 18 SPA | `apps/web-next`,Next.js 16.3 App Router + React 19 | 路由/SSR 由框架托管,宿主自己不再写导航状态机 |
| 桌面渲染层 | React 18,单 `App.tsx` 视图开关 | React 19,`src/v25` 薄壳 | 与 Web 同版本 React,共享包不需要双版本兼容 |
| 移动 Web | 无独立交付面(Web 端自适应) | 同一 Next.js 应用自适应 | 从「两端」变「四端」,同一份组件 |
| 样式 | Tailwind v4 + 11,857 行手写 CSS | Tailwind v4 + 281 行 token 定义 | 见 §3 |
| 组件底座 | 自研 `packages/ui` primitives + `packages/product-ui` 产品块 | shadcn/ui(经 CLI 装入 `packages/ui`) | 原语有上游可对齐,不再自研维护 |
| 数据接缝 | `desktopGateway` / `cloud-client` 各写一套 + `page-controllers` | `MusefoldGateway`(`packages/platform`)单接口,双实现 | features 内零 `isElectron` 分支 |
| 服务端 | `apps/web-api` + `apps/generation-worker` | `apps/api`(Hono + zod-openapi) + `apps/worker`(graphile-worker) | 契约优先,OpenAPI 由 zod 推导 |
| 包管理 / 任务 | npm workspaces | pnpm + Turborepo 2.10 | 缓存与并行,`check` 一条命令全覆盖 |
| Lint / Format | ESLint 10 + Prettier 3 | Biome 2.5 | 单进程,速度与规则一致性 |
| 治理门禁 | 14 个 repo 门禁 + capability 目录 + host exception 登记 + parity 守卫 | dependency-cruiser 边界规则(0 豁免) + 3000 行文件尺寸门禁 | 从「人工登记 + 多层守卫」变「机器强制的依赖方向」 |
| CI | 4 个 workflow,1,075 行 | 3 个 workflow,320 行 | `pr.yml` / `main.yml` / `release.yml` |
| 测试文件数 | 282 | 157 | 覆盖域缩小(见 §7),单测 + Playwright 三形态视觉快照 |

---

## 2. 仓库形状与代码复用度

### 2.1 总量

| 层 | 旧版 | 新版 |
|---|---|---|
| 桌面渲染层 | 248 文件 / 35,389 行 | 2 文件 / 246 行(`apps/desktop/src/v25`) |
| Web 渲染层 | 63 文件 / 9,369 行(`apps/web/src`) | 11 文件 / 229 行(`apps/web-next/src`) |
| 共享渲染包 | 100 文件 / 12,852 行(`product-ui` + `ui`) | 59 文件 / 6,902 行(`features` + `ui`) |
| **渲染层合计** | **411 文件 / 57,610 行** | **72 文件 / 7,377 行** |
| 自定义 CSS | 11,857 行 | 281 行 |

复用率的实质变化:旧版共享包只占渲染代码的 22%,页面级装配在桌面与 Web 各写一遍;新版共享包占 94%,宿主只剩路由挂载 + 壳注入。

### 2.2 逐域对照

| 产品域 | 旧版实现(desktop features + product-ui) | 新版 `packages/features` | 说明 |
|---|---|---|---|
| 壳 / 导航 | `components/layout` 2,300 + `command` 391 + `product-ui/navigation` 871 = **3,562** | `shell` **207** | 旧壳含 TitleBar/Sidebar/朱点/命令面板/自动化确认卡;新壳只做侧栏 + 移动底栏 |
| 工作台 | `features/generation` 8,674 + `product-ui/workbench` 4,280 = **12,954** | `workbench` **1,518** | 旧版含设计方案、Skill 运行时、素材库、微调、参考图、多张生成 |
| 提示词库 | `features/library` 1,352 + `product-ui/library` 1,268 = **2,620** | `prompts` **1,111** | 虚拟化 + Inspector 详情栏未迁(见 §5.2) |
| 生成历史 | `features/history` 1,966 + `product-ui/history` 1,330 = **3,296** | `history` **1,086** | Lightbox、磁盘用量、清理菜单未迁 |
| 设置 | `features/settings` 9,154 + `product-ui/settings` 538 = **9,692** | `settings` **274** | 新版只 5 张卡,旧版 20+ 分区 |
| 账号 / 连接 | `features/account` 245 + `product-ui/account` 693 = **938** | `account` **1,048** | 唯一「变重」的域:账密登录 + 连接管理 + 云同步全部内联进设置页 |
| 页面控制器 | `product-ui/page-controllers` **1,783** | 无 | 由 TanStack Query hooks 直接取代 |

### 2.3 单文件尺寸

| | 旧版 Top 3 | 新版 Top 3 |
|---|---|---|
| 1 | `DesignSchemesPage.tsx` 600 行 | `SessionListPanel.tsx` 385 行 |
| 2 | `library/store.ts` 594 行 | `PromptLibraryScreen.tsx` 382 行 |
| 3 | `HistoryDetail.tsx` 560 行 | `AiConnectionsPanel.tsx` 360 行 |

两代都远低于 3000 行门禁;新版最大文件比旧版最大文件小 36%,且 `features` 内没有 500 行以上文件。

---

## 3. 样式与 token 体系

这是变化最剧烈的一层。

| | 旧版 | 新版 |
|---|---|---|
| token 数量 | 约 90 个自定义 CSS 变量(`--bg-*` `--fg-*` `--surface-*` `--density-*` `--radius-*` `--shadow-*` `--dur-*` `--ease-*` `--scrim-*` `--shell-*` `--gap-*`) | 32 个 shadcn 标准变量 + 4 个扩展(`success` `warning` `info` + 两条 ease) |
| 主题切换 | `[data-theme="dark"]` 属性选择器 | `.dark` class + `@custom-variant` |
| 密度切换 | `[data-density="compact"]` 覆盖 7 个 `--density-*` | 无(暂缓) |
| 双寄存器 | `[data-ui-register="theater" \| "operate"]`,Theater 专用 token 作用域隔离 | 无(概念退役) |
| 组件样式载体 | `product-ui/styles.css` 7,443 行 + `ui/primitives.css` 1,701 行 + 5 个页面级 CSS 文件 | Tailwind 工具类 + `@theme inline` 映射,145 行 |
| 硬编码色值 | 页面级 CSS 内大量存在 | 门禁抽查为 0(V25-UI-SPEC §11-4) |

**品牌色原样保留**:陶土橙 `#d6653f`(深色 `#ef7a52`)、暖灰面 `#f6f6f4` / `#151619`、语义色四件套、8px 控件圆角,全部从旧 `tokens.css` 逐值搬进新 `globals.css`。视觉上是同一个产品;可主题化程度提升的原因是**去掉了绕过 token 的 7,443 行组件 CSS**,而不是换了配色。

主题切换能力的实际影响:旧版要改一个表面颜色,需要同时动 `tokens.css` 与若干 `product-ui/styles.css` 内的硬编码;新版只动 `:root` / `.dark` 两个块。

---

## 4. 应用壳:布局与交互

### 4.1 结构对照

```text
旧版(桌面)                          新版(双宿主同一份)
ToastProvider                        Toaster(sonner,宿主层)
└ TooltipProvider                    ├ md+ : aside 侧栏(w-60)
  └ ProductSidebarLayout             │   ├ 品牌行(MusefoldMark + 收起钮)
    ├ Sidebar                        │   ├ action 槽(新设计钮)
    │  ├ ProductSidebar(品牌/新设计) │   ├ nav(功能导航,aria-current)
    │  ├ WorkbenchSessionList        │   ├ sessions 槽(SessionListPanel)
    │  └ SidebarAccessSwitcher       │   └ footer 槽(AccountFooter)
    ├ TitleBar(ProductTopbar)        ├ 移动: header(品牌 + 标题 + 搜索)
    │  ├ 会话标题 + 任务摘要          │        + 底部 tab bar(fixed h-16)
    │  ├ 会话菜单(重命名/归档/删除)   └ main
    │  └ 搜索 / 素材库 / 窗口控件
    ├ main + EmberMark(朱点)
    ├ CommandPalette(⌘K)
    ├ ToastHost
    └ AutomationConfirmCard
```

### 4.2 保留的交互

- 侧栏可收起,收起后左上角给展开钮(旧版在 TitleBar `leading`,新版浮在内容区左上)。
- macOS 红绿灯让位:旧版 `headerStartInset = isMac && !fullscreen ? 86 : 12`;新版 `brandInset` prop 由桌面宿主注入,同一机制。
- 「新设计」在侧栏品牌行下方,⌘N 快捷键。
- 会话列表在导航下方,右键菜单 / 置顶 / 未读点 / 重命名 / 归档 / 删除确认。
- 账号入口在侧栏底部。

### 4.3 有意去掉的(已在 V25-UI-SPEC §9 登记)

| 旧设施 | 处置 | 登记号 |
|---|---|---|
| 常驻 ProductTopbar(Web 大屏) | 取消,只在侧栏收起时给展开钮 | D5 |
| 朱点 `EmberMark` + 笺匣 | 冻结不迁(用户指示) | D8 / §0.2 |
| 命令面板 `CommandPalette`(391 行) | 暂缓,⌘K 暂跳提示词库搜索 | §0.2 |
| `AutomationConfirmCard` | 暂缓(automation 域仍由主进程直连) | 未登记 |
| 双寄存器 `data-ui-register` | 概念退役 | — |
| 密度切换 `data-density` | 暂缓 | — |

### 4.4 未登记的真实缺口

- **`GlobalErrorBoundary` / `global-error-dialog` 没有对位实现**。旧版壳外层有全局错误边界 + 恢复对话框;新版 `features` 与两个宿主都没有 ErrorBoundary,`apps/web-next` 也没有 `error.tsx`。渲染期异常会整屏白。建议排卡补齐。

---

## 5. 逐屏对比

### 5.1 工作台(生成)

| 维度 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 布局 | 时间线 + 贴底 Composer;右侧可开素材库 Dock | 时间线 + 贴底 Composer;空态 Composer 居中 | 一致(素材库 Dock 暂缓) |
| 空态 | 品牌锁定区 + 三行逐字横滚动画 + 英文水印背景 | `MusefoldMark` + slogan + 三条静态建议行,点击回填草稿 | **有意简化**,D13 |
| Composer 输入 | `aria-label="提示词输入"`,Enter 发送 / Shift+Enter 换行 | 同,另加 `isComposing` 保护(中文输入法回车不误发) | 新版更严谨 |
| 比例 | `RatioPicker` 547 行,支持自定义比例输入 | Popover 六档预设(auto/1:1/4:3/3:4/16:9/9:16) | 自定义暂缓,D7 |
| 质量 | 设置弹层内 | 设置弹层内 | 一致 |
| 反向提示词 | 设置弹层内 | 设置弹层内(M4b 曾误做成常驻,已收回) | 一致,D4 |
| 张数 | 桌面可选 1/2/4 | 锁 1 张(契约 `count: literal(1)`) | 云端成本闸,D3 |
| Provider 选择 | Composer 工具条 | Composer 工具条 | 一致 |
| 无连接态 | `ProviderEmptyGuide` 组件 | 内联一行 + 「前往设置添加」按钮 | 一致(实现更轻) |
| 提交/停止互斥 | 提交钮切「停止」 | 同,另有 `cancelling` 中间态转 spinner | 新版更完整 |
| 参考图上传 | 拖拽 + 粘贴 + 文件选择(`workbench-image-input`) | 「+」钮占位禁用 | **缺口**,未登记 |
| 参考图侧栏 | `PromptReferenceSidebar` 516 行 | 无 | 暂缓 |
| 微调(refine) | `refine-prompt` / `refine-generate` / `RefinementTargetReference` | 无 | 暂缓 |
| Skill 运行时对话 | `PendingSkillConversation` / `SkillRuntimeAttachment` | 无 | §0.2 暂缓域 |
| 设计方案入口 | Composer「+」菜单 | 不出现 | D2 |
| 会话状态点 | `running` / `unread` / `idle`,localStorage 存未读 | 同三态,`session-store` 存 `seenAt`,`latestJobStatus` 由服务端/桥派生 | 一致,机制更契约化 |
| 会话置顶 | localStorage `sessionPreferences` | platform 偏好接口 `pinnedSessionIds` | D6,跨端同步待后续 |

### 5.2 提示词库

| 维度 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 容器 | 960px 居中,整页滚动 | `max-w-3xl` 居中 | 一致 |
| 分区 | 「置顶 / 全部」两段,标题带计数 | 同 | 一致 |
| 列表行 | 缩略图 + 标题/预览/元信息 + 行尾「使用」 | 同,操作组常驻(hover 渐显) | D1:从下拉菜单改常驻 |
| 虚拟化 | `@tanstack/react-virtual`,140+ 条时 DOM 有界,双列自适应 | 无虚拟化,分页 `limit: 30` + 「加载更多」 | **实现路线变化**,大库性能待观测 |
| 详情 | 右侧 404px Inspector,窄屏切单页 | 无 Inspector,编辑走 Dialog | **缺口**,SPEC §4.5 已登记 |
| 范围切换 | 「全部 / 笺匣」tab | 「库 / 回收站」tab | 笺匣随朱点冻结;回收站从 Dialog 提升为 tab |
| 回收站 | `TrashDialog` 弹层 | 页内 tab + 恢复/永久删除 | 新版可达性更好 |
| 排序 | 无显式排序控件 | 四档 Select(最近更新/创建/最常使用/标题) | 新增 |
| 筛选 | 文件夹/标签/评分/智能集**已从旧 UI 退役**(数据保留) | 文件夹 Select + 标签 Badge 多选 | **回归**:旧版退役的能力在新版恢复 |
| 导入 | 下拉菜单跳设置「数据」分区 | 无 | 暂缓(分享/导入域) |
| 高亮跳转 | Composer「存为提示词」→ 跳库并 `scrollIntoView` | 无 | 缺口(依赖参考图/存为提示词链路) |

### 5.3 生成历史

| 维度 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 布局 | 主区列表 + 320px 右栏检视(可折叠) | `HistoryScreen` + `HistoryInspector` | 一致 |
| 筛选 | 折叠面板 + 活动筛选计数 badge | 常驻筛选栏 + 「清除筛选」钮,无计数 badge | 筛选维度一致;计数 badge 未迁,由 I5 的「清除筛选」承担同等提示作用 |
| Lightbox | `ImageLightbox`,左右键翻图 | 无 | **缺口** |
| 磁盘用量 | `HistoryDiskUsage` readout | 无 | 暂缓 |
| 清理菜单 | `HistoryCleanupMenu`(批量清理策略) | 无 | 暂缓 |
| 回收站 | — | tab + 恢复 + 永久删除(含 S3/磁盘资产清理) | **新增** |

### 5.4 设置

差距最大的一屏。

| | 旧版 | 新版 |
|---|---|---|
| 布局 | 独立工作区(隐藏 TitleBar + 分组导航 MasterDetail),627 行专用 CSS | `max-w-2xl` 单列卡片流 |
| 分区数 | 20+(外观/账号/云同步/AI 连接/生成/数据存储/备份/导入导出/自动化/自动化审计/已连接应用/开放能力/中转/豆包/归档对话/用量统计/危险区/关于/热更新…) | 5 张卡(外观、账号、云同步、AI 连接、数据) |
| 用量统计 | `UsageStatisticsCharts` + 500 行 CSS | 无 |
| 登录形态 | 独立登录屏 | 设置页账号卡内联账密表单,双端同一份(D9) |
| AI 连接 | `AiConnectionDetailPanel` + 新建时可选类型 | `AiConnectionsPanel`,固定 `openai-compatible`(D11),含「测试连接」 |
| 分组导航 | 有 | 暂无,分区 ≥5 时按 §6.1 切换(D10) |

新版设置页 274 行 vs 旧版 9,692 行,差值主要是**未迁分区**,不是同功能的简化。这一屏是后续工作量最集中的地方。

### 5.5 账号 / AI 连接

唯一「新版更重」的域(938 → 1,048 行),原因是把旧版散在三处的能力收进一屏:

- 旧独立登录屏 → 账号卡内联账密表单(少一跳,四端同一份)。
- 旧 `ProviderDialog` 520 行弹层 → `AiConnectionsPanel` 内联行 + 编辑弹层,并新增「测试连接」(探 `/models`,区分超时 / 401 / HTTP 错误)。
- 云同步从设置子分区 → 独立 `CloudSyncPanel`,由 `hasCloudSyncControls` 能力开关控制。

---

## 6. 交互约定的统一化

旧版的交互约定散在 `docs/06-ui-design-system.md` 与各页注释里,靠人工遵守;新版收敛成 V25-UI-SPEC §8 的九条(I1–I9),并由测试与门禁支撑:

| 约定 | 旧版状况 | 新版状况 |
|---|---|---|
| 破坏性动作必须 AlertDialog | 部分屏做了(会话删除),部分直接执行 | I3 强制;提示词/历史永久删除均有确认对话框 + 单测断言 |
| 动作不得只藏浮层 | 多屏用下拉菜单收纳行动作 | I2 强制常驻操作组(D1) |
| testid 命名 | 混杂(`titlebar-*` `workbench-*` `refine-*` `library-*`) | I8 统一 `<域>-<对象>-<动作>`,E2E 只允许 testid/role 定位 |
| 空态必须给 CTA | 提示词库做了,其他屏不一致 | I5 全屏统一 |
| 图标钮 `aria-label` | 大体有 | I9 强制 + 组件测试 |
| 视觉回归 | 无 E2E 视觉快照 | Playwright 三形态(web-desktop / web-mobile / electron)22 张基线 |

---

## 7. 尚未迁入新渲染层的清单

这里按「登记在何处」分三类,因为两份清单(V25-UI-SPEC §0.2 与根 `AGENTS.md` 暂缓域)内容并不完全重合。**凡登记项一律主进程语义保留,禁止顺手实现或删除。**

### 7.1 V25-UI-SPEC §0.2 已登记

| 项 | 旧代码量 | 处置 |
|---|---|---|
| 桌宠(pet) | `src/pet` + 主进程 pet 域 | 冻结,独立 renderer 入口留旧栈 |
| EmberMark 朱点 | 含在 layout 内 | 冻结,待后续重新设计 |
| 设计方案(design-schemes) | 4,124 行 | 暂缓,侧栏与 Composer 均不出入口 |
| 豆包网页模式(doubao-web) | 含在 settings 域内 | 主进程语义保留,渲染层暂缓 |
| Skill runtime 会话 / GitHub Skill 导入 | 含在 generation 域内 | 暂缓 |
| 命令面板(⌘K) | 391 行 | 暂缓,壳预留入口,暂跳提示词库搜索 |
| 微调(refinement)链 | 含在 generation 域内 | 暂缓至 M4c 后评估 |
| 归档会话浏览 | 含在 settings 域内 | 暂缓,归档动作保留 |

### 7.2 仅在根 `AGENTS.md` 暂缓域登记(建议同步补进 §0.2)

| 项 | 旧代码量 | 主进程落点 |
|---|---|---|
| 分享 / 导入 | 474 行 | `generation-facade.ts` + 设置「数据」分区 |
| 热更新控制面(设置「关于」卡) | 含在 settings 域内 | 热更通道在 |

### 7.3 两份清单都未登记的缺口(建议排卡)

| 项 | 旧版对位实现 | 风险 |
|---|---|---|
| 全局 ErrorBoundary | `GlobalErrorBoundary` + `global-error-dialog` | 渲染期异常整屏白,无恢复入口 |
| 引导流程(onboarding) | 1,773 行 | 新用户首启无引导 |
| 参考图上传 | 拖拽 / 粘贴 / 文件选择 | 生图产品的核心输入之一,Composer 现为禁用占位 |
| 图片 Lightbox | `ImageLightbox` + 左右键翻图 | 历史屏无法放大看图 |
| 提示词详情 Inspector | 404px 右栏 | SPEC §4.5 已登记为遗留差值 |
| 大库虚拟化 | `@tanstack/react-virtual` | 改为分页,大库滚动性能待观测 |
| `AutomationConfirmCard` | 花钱动作确认卡 | automation 由主进程直连,渲染层无确认闸门 |
| 用量统计图表 | `UsageStatisticsCharts` + 500 行 CSS | 设置页无用量可视化 |
| 密度切换 | `data-density="compact"` | 紧凑模式能力丢失 |

---

## 8. 清理债

- `apps/web-next/src/app/ceramic-button/page.tsx` + `src/components/ceramic-button-demo.tsx`:设计实验页,未在任何导航中引用,应在交付前删除或移进 `preview/`。
- `packages/contracts` / `packages/core` / `packages/desktop-contracts` / `packages/domain` 下曾有一批误入库的 `.d.ts` / `.d.ts.map`,当前工作树已标记删除,需随提交清掉。
- 按 V25-UI-SPEC §10.3,各域垂直切换完成时同域旧实现应同卡删除;目前 `apps/desktop/src/features/*`、`packages/product-ui`、`apps/web` 仍全量在库,`packages/legacy-ui` 计划 M5c 整体退役。在此之前旧新两套并存,`check` 需同时跑通两套。

---

## 9. 复现本报告的方法

```bash
# 导出旧版渲染层到临时目录
git archive v2.5-baseline apps/desktop/src packages/product-ui packages/ui | tar -x -C /tmp/mf-old

# 旧版渲染层代码量(排除测试/冻结面)
git ls-tree -r --name-only v2.5-baseline apps/desktop/src \
  | grep -E '\.tsx?$' | grep -vE '/pet/|/preview/|__tests__' \
  | while read f; do git show "v2.5-baseline:$f" | wc -l; done \
  | awk '{s+=$1} END {print s}'

# 新版渲染层代码量
find packages/features/src packages/ui/src apps/web-next/src apps/desktop/src/v25 \
  -name '*.tsx' -o -name '*.ts' | grep -v __tests__ | xargs wc -l | tail -1
```
