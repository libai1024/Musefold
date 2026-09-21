# 04 提示词库 — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/pages/LibraryPage.tsx`(458 行)+ `apps/desktop/src/features/library/*`(store 594 行、`PromptEditor` / `PromptDetailView` / `PromptWorksPanel` / `TrashDialog`)+ `packages/product-ui/src/library/*`(9 文件,`PromptListRow` / `PromptLibraryScreen` / `PromptDetailScreen` / `PromptEditorForm`)。
> **新版源码**:`packages/features/src/prompts/{PromptLibraryScreen,PromptListRow,PromptDetailInspector,PromptRelatedWorks,PromptEditorDialog,SavePromptDialog,TaxonomyManager,hooks,format}.tsx`。

---

## 1. 结论与迁移状态

列表主体(分节/搜索/排序/编辑器/回收站)已迁且部分能力超过旧版(文件夹/标签筛选是旧版 UI 退役后在新版**恢复**的能力、排序控件是新增、回收站从弹窗提升为页内 tab)。此前破坏产品闭环的 P0(行「使用」动作)已于 2026-08-29 收口。**2026-09-06(B1-T1)收口 §8 全表 P1/P2/P3**:封面缩略(契约 `coverImageUrl` + PG 列 + 桌面 `media://` 映射)、详情 Inspector(含相关作品面板)、空态 CTA 与「清空回收站」、⌘S / `/` / ⌘K 三条快捷键、行更新时间与复制 Check、`prompt-highlight` 接收端。**2026-09-06(B2-T4)**:「全部」分节 >150 行虚拟化(`@tanstack/react-virtual` 3.14.9,置顶常驻,哨兵仍在列表末尾)。**2026-09-07(B5-T2)**:内容宽 ≥760px 且详情关闭时「全部」2 列(列距 28px / 行缝 4px),虚拟化按行成对;`prompt-grid[data-columns]`。密度 token 已接到行 `px/py/gap`。

## 2. 布局对照

| 区块 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 容器 | 960px 中轴整页滚动,`PromptLibraryWorkspace` 支持右侧 404px Inspector(开启时列表转单列) | `max-w-3xl`(768px)中轴单列;详情开启时转 `max-w-none` 单列 + 右侧 384px(`w-96`)Inspector,窄屏 Sheet | ✅ 对位(2026-09-06) |
| 页头 | 视图标题在顶栏;页内 scope tabs(全部/笺匣,带计数)+ 头部动作组(新建/刷新/回收站/更多菜单) | 页内 h1「提示词库」+ 总数 + 「新建提示词」主钮 | 结构对位;刷新钮由 TanStack 自动 refetch 取代(合理);笺匣随朱点冻结 |
| 工具条 | 搜索框(store 驱动) | 「库/回收站」tabs + 搜索 + 排序 Select + 文件夹 Select + 标签管理钮 | 新版更完整 |
| 标签筛选 | 无(v0.1 退役) | Badge 多选行 | **恢复的能力**,保留 |
| 列表 | 「置顶(常驻渲染)/全部(虚拟化)」分节;双列自适应(≥760px 内容宽 2 列),行高 72/76px + 4px 缝,28px 列距 | 「置顶」常驻单列 /「全部」>150 行 `useVirtualizer`(按行成对,`estimateSize` 72/76+4px,`measureElement` 动态);≥760px 且详情关闭 `grid-cols-2 gap-x-7`;分页 30 条 + 滚动哨兵 | ✅ 虚拟化(2026-09-06 B2-T4);✅ 双列(2026-09-07 B5-T2) |
| 回收站 | `TrashDialog` 弹窗(max-w-lg):条目行 + 行内二段确认「彻底删除」+「清空回收站」双重确认 | 页内 trash tab:行动作恢复/永久删除(AlertDialog 确认)+ 工具行「清空回收站」(AlertDialog 写明条数) | ✅ 对位(2026-09-06,`prompts.emptyTrash` 六层走线) |
| 密度 | `data-density` compact 行高切换 | 行 `px/py/gap` 消费 `--density-row-padding` / `--density-list-gap`;密度切换 `virtualizer.measure()` | ✅ 2026-09-06 B2-T4(舒适态保持原 Tailwind 像素,紧凑态走 token) |

## 3. 列表行对照

| 元素 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 缩略图 | 44/48px:封面图(`coverImagePath`,「存为提示词」时取首张成功图)或 FileText 占位 | 44px(`PromptCover`):有 `coverImageUrl` 显图(FadeImage 淡入 + hover `scale-[1.06]` 于 overflow-hidden 内),否则 FileText 占位;详情头部 48px 同组件 | ✅ 对位(2026-09-06):契约 `promptDocumentSchema.coverImageUrl` 为 path-free URL(https / `media://` / data / loopback),桌面由主进程把受管路径转 `media://`,绝对路径不出主进程 |
| 标题行 | 标题 + 置顶态 | Pin 图标 + 标题 + 星级(rating>0 时) | 一致偏优(星级上行) |
| 摘要 | description 优先,fallback 正文 | 同 | 一致 |
| 元信息 | 使用 n 次 · 更新时间 · 标签文本串 | 使用 n 次 · 更新时间(相对时间,复用侧栏 `sessionRelativeTime`)+ 标签 Badge(最多 4 + 溢出计数) | ✅ 对位(2026-09-06) |
| 行动作 | 复制(成功换 Check 图标 1.2s)+「使用」文字钮(常驻) | 「使用」文字钮 + 复制(Copy→Check 1.2s,toast 保留)/编辑/置顶/移入回收站(hover 渐显,触屏常显);回收站行:恢复/永久删除 | ✅ 对位(使用 2026-08-29,Check 反馈 2026-09-06) |
| 行点击 | 打开详情(Inspector/详情页) | 打开详情 Inspector(回收站行同样开详情,主动作换「恢复」) | ✅ 对位(2026-09-06) |
| 高亮态 | `data-highlighted`(选中/跨屏高亮),`aria-current` | `data-highlighted` + `aria-current` + `mf-row-highlight` 背景脉冲 + 平滑滚动居中(`skipMotion()` 闸门);详情选中行 `data-selected` | ✅ 对位(2026-09-06) |

## 4. 编辑器对照

| 项 | 旧版 `PromptEditorForm` | 新版 `PromptEditorDialog` | 判定 |
|---|---|---|---|
| 字段 | 标题*、描述、正文*、反向词(**可折叠**)、置顶开关 | 标题*、内容*、负向词(常驻)、备注、文件夹 Select、评分 Select、标签多选、置顶开关 | 新版字段更全(文件夹/评分/标签直编是恢复能力) |
| 保存 | 提交钮 + **Cmd/Ctrl+S**;副标题提示快捷键 | 提交钮 + ⌘/Ctrl+S(DialogContent `onKeyDown`,dirty 且可提交才落库;无条件吞浏览器「保存网页」) | ✅ 对位(2026-09-06);已进 `PRODUCT_SHORTCUTS`(`prompt-editor-save`) |
| 关闭防护 | Esc 与点外关闭被拦截(`preventDefault`),必须走「放弃」钮——防误关丢稿 | ShadCN Dialog 接管 Esc/点外/X/取消,脏表单弹 ShadCN AlertDialog「放弃修改?」确认;保存失败保留编辑值 | **已收口(2026-08-29)**:共享 features 组件与 Web/Electron 测试覆盖 clean 直关、Escape/外点/X 拦截、继续编辑、放弃修改和失败保值 |
| 打开快照 | 打开即写入当前文档 | 同一次打开(`id`/`new`)只快照一次;Strict remount 与对象引用变化不覆盖已输入(D26) | **已收口(2026-09-07,B7-T4)** |
| 错误 | 表单内错误条「保存失败,改动仍保留」 | mutation 错误 toast,表单保留 | 等价(I4) |
| 笺誊清 | slip 源特殊标题「誊清这枚笺」+ 保存转 manual | 不适用(笺匣冻结) | 挂点登记 |

## 5. 详情视图(旧 Inspector)对照

旧版行点击 → 右侧 404px `PromptDetailScreen`(窄屏转单页,`layout='page'|'inspector'`),结构:导航(返回)→ 头部(置顶标记/标题/来源标签/时间元信息 + 更多菜单 + 主动作「使用」)→ 正文(含反向词块)→ **相关作品面板**(`PromptWorksPanel`:该提示词生成的历史缩略格,点击跳历史)→ 元数据(创建/更新时间、来源:本机创建/导入/分享导入/笺/生成入库)。更多菜单:编辑/复制/置顶/分享(暂缓域)/创建方案(暂缓域)/删除。

**✅ 已收口(2026-09-06,B1-T1)**:`packages/features/src/prompts/PromptDetailInspector.tsx` 承旧结构 ——
导航(「提示词详情」+ 关闭)→ 头部(封面 48px / 置顶标记 / 标题 / 回收站 Badge / 描述 / `来源 · 使用 n 次 · 更新于 …` / 标签 / 更多菜单 / 主动作「使用」,回收站行换「恢复」)→ 正文 + 反向词(各带 Copy→Check 复制钮)→ **相关作品面板**(`PromptRelatedWorks`)→ 元数据(来源 / 创建 / 更新 / 使用次数)。
md+ 内嵌右栏 384px(与历史屏 `HistoryInspector` 同构口径),窄屏装 `Sheet`;更多菜单只留编辑/复制正文/置顶/移入回收站,「分享/创建方案」随暂缓域与方案域各自入口不进本菜单。

**相关作品的数据口径(2026-09-06 B4-T1)**:`generationHistoryQuerySchema` 已有可选 `promptId`;面板下推 `generation.list({ promptId, status:'succeeded', limit:100 })`,API 与桌面 `generation.list` 按 `r.prompt_id` 过滤,客户端只留 `assets.length > 0`。`limit` 缺省 20 防 SQLite `LIMIT NaN`。超过一页仍可能漏,完整跨页由生成域后续卡。
缩略点击写 `screen-intent` `{ kind: 'history-select', jobId }` 并调宿主 `onOpenHistory`(B1 已注入 desktop-shell / web prompts page);未注入时缩略退成只读画廊,不留死链接。

## 6. 性能与数据行为对照

| 项 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 大库渲染 | `@tanstack/react-virtual` 虚拟化「全部」区,140+ 条 DOM 有界;置顶区常驻;`scrollMargin` 挂页面滚动;密度切换重测行高 | 无限查询分页(30/页)+ 滚动哨兵 +「加载更多」钮;「全部」/回收站 >150 行 `useVirtualizer`(md+ 屏内 `overflow-y-auto`;`<md` 页面滚动走 window 视口);置顶常驻;密度切换 `measure()`;宽屏按行成对 | ✅ 2026-09-06 B2-T4 + 2026-09-07 B5-T2 |
| 搜索 | store 同步过滤(FTS5 兜底) | `useDeferredValue` + 服务端 `q` | 新版更优 |
| 跨屏高亮 | `pendingHighlightPromptId` 消费一次即清,虚拟区 `scrollToIndex` / 常驻区 `scrollIntoView` 平滑居中 | `useScreenIntent` 处理 `prompts-trash` / `prompt-highlight` / `prompts-focus-search`,消费一次即清;高亮行 `scrollIntoView({ block: 'center', behavior: skipMotion() ? 'auto' : 'smooth' })` | ✅ 对位(2026-09-06);意图 effect 依赖 intent 值本身,同屏重复触发也会消费 |
| 乐观更新 | store 手工维护 | TanStack invalidation | 等价 |

## 7. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 行 hover | 背景色过渡(`--dur-fast`),缩略图 `scale(1.06)` 于 overflow-hidden 内(reduce 取消) | 边框+背景过渡 + 封面 `group-hover:scale-[1.06]`(overflow-hidden 内,`--dur-fast`) | ✅ 对位(2026-09-06);reduce 由 globals.css 全局压制规则接管 |
| 复制反馈 | 图标 Copy→Check 1.2s 回弹 | 行内 + 详情内均 Copy→Check 1.2s,toast 保留 | ✅ 对位(2026-09-06) |
| 高亮入场 | 高亮行背景脉冲提示(CSS) | `mf-row-highlight`(accent → transparent 2s),reduce 下由全局压制瞬时化 | ✅ 对位 |
| 编辑器开合 | `dialog-in`(6px 下落 + 0.98 scale,180ms) | shadcn 默认 zoom/fade | 等价 |
| 空态 | 图标 + 文案 + 主 CTA(三种空态:无匹配/匣中无笺/无提示词) | 图标 + 文案 + CTA:筛选空态「清除筛选」、空库「新建提示词」、回收站空态无 CTA | ✅ 对位(2026-09-06,I5 全覆盖) |

## 8. 差距 → 任务清单

> **已收口(2026-08-29)**:行「使用」动作(行尾文字钮 + `pendingDraft` 通道 + usageCount + toast)+ 编辑器脏表单防误关。
> **已收口(2026-09-06,B1-T1)**:下表除「大库虚拟化」外全部。
> **已收口(2026-09-06,B2-T4)**:大库虚拟化(>150)。
> **已收口(2026-09-07,B5-T2/T3)**:双列自适应(≥760px);Taxonomy `<md` Sheet。

| 优先级 | 任务 | 状态 / 验收要点 |
|---|---|---|
| P1 | 封面缩略:契约补封面字段,「存为提示词」写入首图;行/详情展示,hover 微缩放 | ✅ 2026-09-06。契约 `coverImageUrl`(path-free URL);PG `prompts.cover_image_url`(迁移 `0006_prompt_cover_image`);桌面复用 `preview_image_path` 槽位,IPC 层做 `media://` ↔ 受管路径双向映射(不新增 SQLite 列 —— 旧库 `coverImagePath = latest_work_image ?? preview_image_path` 已是同一语义,再加列就是重复真相);`SavePromptDialog` 写首张成功图 |
| P1 | 详情 Inspector:md+ 右栏(≈400px)/窄屏 Sheet;结构承旧(头部/正文/相关作品/元数据);行点击改「打开详情」;「使用」为详情主动作 | ✅ 2026-09-06,见 §5。相关作品跳历史的宿主接线待排(`onOpenHistory` + 历史屏消费 `history-select`) |
| P1 | 编辑器脏表单防误关:Esc/点外时若有改动弹「放弃修改?」确认 | ✅ 2026-08-29 |
| P2 | 搜索/筛选空态补「清除筛选」CTA;无提示词空态补「新建」钮;「清空回收站」双重确认批量动作 | ✅ 2026-09-06。`prompts.emptyTrash(): { purged }` 六层走线(contracts / platform / api-client / apps/api / ipc-v25 / desktop-gateway),AlertDialog 写明条数 |
| P2 | ⌘/Ctrl+S 保存;大库虚拟化(>150 行) | ⌘S ✅ 2026-09-06;虚拟化 ✅ 2026-09-06 B2-T4(置顶常驻,哨兵兼容)。双列 ✅ 2026-09-07 B5-T2 |
| P3 | 行元信息补更新时间;复制成功 Check 图标态;高亮跳转接收端(screen-intent 扩展 payload) | ✅ 2026-09-06 |

> 暂缓域挂点:笺匣 scope 与誊清流(朱点冻结)、分享/导入菜单项、「创建方案」菜单项(设计方案域,入口留在列表行而非详情菜单)。

## 9. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 04-C1 | C1 | 「/」聚焦搜索 | ✅ 2026-09-06。`PromptLibraryScreen` document keydown,输入框/文本域/`contenteditable` 内不抢键;⌘K 由 `AppShell` 监听 → 写 `prompts-focus-search` 意图 + 宿主 `onNavigate('prompts')`,由本屏消费聚焦。两条均已进 `PRODUCT_SHORTCUTS`(`prompts-focus-search` / `prompts-search`)|
| 04-C2 | C1 | 行排版精修(挂靠 00 C-4) | 元信息行 11px `--muted-foreground`,「使用 n 次」数字 tabular;标题 13px/500、摘要 12px;行内圆角走 `--radius-md`(00 §5.6 小缩略档) |
| 04-C3 | C1 | 封面载入淡入(挂靠 §8 封面 P1 + 00 C-5) | ✅ 2026-09-06。`PromptCover` 用 `FadeImage`(占位 `bg-muted` → onload opacity 0→1,`--dur-fast`)+ `group-hover:scale-[1.06]` 于 overflow-hidden 内 |
| 04-C4 | C2 | 编辑器打开即就位 | 新建:标题字段 autofocus;编辑:正文 autofocus 光标置尾(与 03 §6「聚焦置尾」同口径);Dialog 入场承 `dialog-in`(6px 下落,`--dur-base`) |
