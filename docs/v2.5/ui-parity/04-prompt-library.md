# 04 提示词库 — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/pages/LibraryPage.tsx`(458 行)+ `apps/desktop/src/features/library/*`(store 594 行、`PromptEditor` / `PromptDetailView` / `PromptWorksPanel` / `TrashDialog`)+ `packages/product-ui/src/library/*`(9 文件,`PromptListRow` / `PromptLibraryScreen` / `PromptDetailScreen` / `PromptEditorForm`)。
> **新版源码**:`packages/features/src/prompts/{PromptLibraryScreen,PromptListRow,PromptEditorDialog,TaxonomyManager,hooks}.tsx`。

---

## 1. 结论与迁移状态

列表主体(分节/搜索/排序/编辑器/回收站)已迁且部分能力超过旧版(文件夹/标签筛选是旧版 UI 退役后在新版**恢复**的能力、排序控件是新增、回收站从弹窗提升为页内 tab)。此前破坏产品闭环的 P0(行「使用」动作)已于 2026-08-29 收口:行尾常驻「使用」→ `pendingDraft` 送工作台草稿 + 使用计数 + 切屏 + toast「已送入制作」。剩余结构性缺口三块:行缩略图(封面)、详情视图(Inspector/相关作品)、大库虚拟化。

## 2. 布局对照

| 区块 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 容器 | 960px 中轴整页滚动,`PromptLibraryWorkspace` 支持右侧 404px Inspector(开启时列表转单列) | `max-w-3xl`(768px)中轴单列 | 中轴一致量级;Inspector 见 §5 |
| 页头 | 视图标题在顶栏;页内 scope tabs(全部/笺匣,带计数)+ 头部动作组(新建/刷新/回收站/更多菜单) | 页内 h1「提示词库」+ 总数 + 「新建提示词」主钮 | 结构对位;刷新钮由 TanStack 自动 refetch 取代(合理);笺匣随朱点冻结 |
| 工具条 | 搜索框(store 驱动) | 「库/回收站」tabs + 搜索 + 排序 Select + 文件夹 Select + 标签管理钮 | 新版更完整 |
| 标签筛选 | 无(v0.1 退役) | Badge 多选行 | **恢复的能力**,保留 |
| 列表 | 「置顶(常驻渲染)/全部(虚拟化)」分节;双列自适应(≥760px 内容宽 2 列),行高 72/76px + 4px 缝,28px 列距 | 「置顶/全部」分节,单列,分页 30 条 +「加载更多」 | 分节承接;**双列 + 虚拟化缺失**,见 §6 |
| 回收站 | `TrashDialog` 弹窗(max-w-lg):条目行 + 行内二段确认「彻底删除」+「清空回收站」双重确认 | 页内 trash tab:行动作恢复/永久删除(AlertDialog 确认) | 交互升级合理;**「清空回收站」批量动作缺失,P2** |
| 密度 | `data-density` compact 行高切换 | 无 | 随密度体系(01 §7)P2 |

## 3. 列表行对照

| 元素 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 缩略图 | 44/48px:封面图(`coverImagePath`,「存为提示词」时取首张成功图)或 FileText 占位 | 44px FileText 占位,**契约无封面字段** | **P1 缺口**:封面是扫库时最强的识别锚;需契约加 `coverAssetUrl`(云)/`coverImagePath`(桌面)+ 存为提示词时写入 |
| 标题行 | 标题 + 置顶态 | Pin 图标 + 标题 + 星级(rating>0 时) | 一致偏优(星级上行) |
| 摘要 | description 优先,fallback 正文 | 同 | 一致 |
| 元信息 | 使用 n 次 · 更新时间 · 标签文本串 | 使用 n 次 + 标签 Badge(最多 4 + 溢出计数) | **更新时间缺失,P3** |
| 行动作 | 复制(成功换 Check 图标 1.2s)+「使用」文字钮(常驻) | 「使用」文字钮(✅ 已收口 2026-08-29)+ 复制/编辑/置顶/移入回收站(hover 渐显,触屏常显);回收站行:恢复/永久删除 | 「使用」闭环已通;复制成功的 Check 反馈缺(P3,现走 toast) |
| 行点击 | 打开详情(Inspector/详情页) | 打开编辑器(回收站行点击=恢复) | 详情视图缺位期的权宜;详情恢复后行点击应回到「打开详情」 |
| 高亮态 | `data-highlighted`(选中/跨屏高亮),`aria-current` | 无 | 随「存为提示词 → 跳库高亮」链路恢复(03 §7 P1 的接收端) |

## 4. 编辑器对照

| 项 | 旧版 `PromptEditorForm` | 新版 `PromptEditorDialog` | 判定 |
|---|---|---|---|
| 字段 | 标题*、描述、正文*、反向词(**可折叠**)、置顶开关 | 标题*、内容*、负向词(常驻)、备注、文件夹 Select、评分 Select、标签多选、置顶开关 | 新版字段更全(文件夹/评分/标签直编是恢复能力) |
| 保存 | 提交钮 + **Cmd/Ctrl+S**;副标题提示快捷键 | 提交钮 | **⌘S 缺失,P2**(高频编辑肌记) |
| 关闭防护 | Esc 与点外关闭被拦截(`preventDefault`),必须走「放弃」钮——防误关丢稿 | Dialog 默认可 Esc/点外关闭 | **P1 缺口**:脏表单需拦截,加「放弃修改?」确认或禁用外关 |
| 错误 | 表单内错误条「保存失败,改动仍保留」 | mutation 错误 toast,表单保留 | 等价(I4) |
| 笺誊清 | slip 源特殊标题「誊清这枚笺」+ 保存转 manual | 不适用(笺匣冻结) | 挂点登记 |

## 5. 详情视图(旧 Inspector)对照

旧版行点击 → 右侧 404px `PromptDetailScreen`(窄屏转单页,`layout='page'|'inspector'`),结构:导航(返回)→ 头部(置顶标记/标题/来源标签/时间元信息 + 更多菜单 + 主动作「使用」)→ 正文(含反向词块)→ **相关作品面板**(`PromptWorksPanel`:该提示词生成的历史缩略格,点击跳历史)→ 元数据(创建/更新时间、来源:本机创建/导入/分享导入/笺/生成入库)。更多菜单:编辑/复制/置顶/分享(暂缓域)/创建方案(暂缓域)/删除。

新版**完全没有详情视图**(SPEC §4.5 已登记为遗留差值)。判定与建议:

- **P1**:恢复详情为右侧 Inspector(md+ 双栏,窄屏 Sheet),内容承旧结构;「分享/创建方案」两项菜单随暂缓域不迁。
- **相关作品面板**依赖「历史 ↔ 提示词」关联数据(旧 `linkHistoriesToPrompt`),与 03 §7「存为提示词」任务同链路,应同卡设计契约(`prompt.relatedRunIds` 或反向查询)。
- 详情恢复前,行点击开编辑器的权宜行为保留。

## 6. 性能与数据行为对照

| 项 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 大库渲染 | `@tanstack/react-virtual` 虚拟化「全部」区,140+ 条 DOM 有界;置顶区常驻;`scrollMargin` 挂页面滚动;密度切换重测行高 | 无限查询分页(30/页)+「加载更多」钮 | **路线差异**:分页控制了首屏 DOM,但用户连点加载后 DOM 仍无界。**P2:超过 ~150 行时引入虚拟化**(TanStack Virtual 与现分页可叠加),或改「加载更多」为滚动哨兵 + 窗口化 |
| 搜索 | store 同步过滤(FTS5 兜底) | `useDeferredValue` + 服务端 `q` | 新版更优 |
| 跨屏高亮 | `pendingHighlightPromptId` 消费一次即清,虚拟区 `scrollToIndex` / 常驻区 `scrollIntoView` 平滑居中 | `useScreenIntent` 只处理 trash 意图 | 随 §3 高亮任务恢复,机制复用 screen-intent |
| 乐观更新 | store 手工维护 | TanStack invalidation | 等价 |

## 7. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 行 hover | 背景色过渡(`--dur-fast`),缩略图 `scale(1.06)` 于 overflow-hidden 内(reduce 取消) | 边框+背景过渡 | **P3**:缩略图微缩放是行级质感细节,随封面恢复一并做 |
| 复制反馈 | 图标 Copy→Check 1.2s 回弹 | toast | P3 恢复图标态(toast 保留) |
| 高亮入场 | 高亮行背景脉冲提示(CSS) | 无 | 随高亮链路 |
| 编辑器开合 | `dialog-in`(6px 下落 + 0.98 scale,180ms) | shadcn 默认 zoom/fade | 等价 |
| 空态 | 图标 + 文案 + 主 CTA(三种空态:无匹配/匣中无笺/无提示词) | 图标 + 文案(搜索空态无「清除筛选」钮) | **P2**:补筛选空态的「清除筛选」CTA(I5);无提示词空态补「新建」CTA(现文案引导但无钮) |

## 8. 差距 → 任务清单

> **已收口(2026-08-29)**:行「使用」动作(行尾文字钮 + `pendingDraft` 通道 + usageCount + toast)。详情视图恢复后需把「使用」同步为详情主动作(并入下表详情 P1 验收)。

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| P1 | 封面缩略:契约补封面字段,「存为提示词」写入首图;行/详情展示,hover 微缩放 | 有封面显图、无封面 FileText;快照更新 |
| P1 | 详情 Inspector:md+ 右栏(≈400px)/窄屏 Sheet;结构承旧(头部/正文/相关作品/元数据);行点击改「打开详情」;「使用」为详情主动作 | 相关作品可跳历史;编辑入口在详情菜单 |
| P1 | 编辑器脏表单防误关:Esc/点外时若有改动弹「放弃修改?」确认 | 空表单可直接关;脏表单需确认 |
| P2 | 搜索/筛选空态补「清除筛选」CTA;无提示词空态补「新建」钮;「清空回收站」双重确认批量动作 | I5 全覆盖 |
| P2 | ⌘/Ctrl+S 保存;大库虚拟化(>150 行) | 300 条 fixture 滚动帧率无回退 |
| P3 | 行元信息补更新时间;复制成功 Check 图标态;高亮跳转接收端(screen-intent 扩展 payload) | — |

> 暂缓域挂点:笺匣 scope 与誊清流(朱点冻结)、分享/导入菜单项、「创建方案」菜单项(设计方案域)。

## 9. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 04-C1 | C1 | 「/」聚焦搜索 | 焦点不在输入态时按 `/` 聚焦搜索框(Codex/GitHub 惯例);与 ⌘K(01 P1,跳库聚焦)同落点不同触发;接线后进 07-07 快捷键表 |
| 04-C2 | C1 | 行排版精修(挂靠 00 C-4) | 元信息行 11px `--muted-foreground`,「使用 n 次」数字 tabular;标题 13px/500、摘要 12px;行内圆角走 `--radius-md`(00 §5.6 小缩略档) |
| 04-C3 | C1 | 封面载入淡入(挂靠 §8 封面 P1 + 00 C-5) | 占位 `bg-muted` → onload opacity 0→1(`--dur-fast`);hover scale 1.06 于 overflow-hidden 内(§7 已列,合并交付) |
| 04-C4 | C2 | 编辑器打开即就位 | 新建:标题字段 autofocus;编辑:正文 autofocus 光标置尾(与 03 §6「聚焦置尾」同口径);Dialog 入场承 `dialog-in`(6px 下落,`--dur-base`) |
