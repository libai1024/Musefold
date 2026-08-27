# 使用统计页 review

> 评审对象:设置中心「使用统计」页(`UsageStatisticsSection` + `UsageStatisticsCharts` + `usage-statistics.ts` + `styles/usage-statistics.css`)。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(克制 / 密度 / 语义色 / 只读状态卡)、`DESIGN.md`(Graphite / Porcelain / Ember)。
> 注:任务描述把 `UsageStatisticsCharts.tsx` 列在 `components/` 下,实际路径是 `apps/desktop/src/features/settings/UsageStatisticsCharts.tsx`(由 `UsageStatisticsSection.tsx:26` 的 `../UsageStatisticsCharts` 导入),本报告按实际路径引用。

## 截图观察

说明:视觉分析模型本次不可用,截图观察来自对两张 PNG 的程序化像素分析(彩色像素聚类 + 逐行背景带结构),辅以代码推演;非完整目测,颜色/位置结论可靠,字形细节以代码为准。

结构(1440×900,暗亮两版布局一致):

- 0-117 标题栏/设置页头;120-228 汇总指标条(五格单行卡,亮 #ffffff / 暗 #222325,格间细分隔线);252-507 生成活动热力图面板;约 510-560 时间范围行(页底色、无框,h2 在左、分段控件在右);594-852 生成趋势面板(空态);876 起模型用量面板顶缘 —— **模型用量面板在 900px 视口处被截断,渠道统计与底部记账说明完全在折叠线以下**。
- 整页几乎无彩色,克制方向正确:ember 强调色仅两处 —— 汇总第 4 格「账号积分消耗」数值(x≈1027-1088,y≈144-161,暗 #da734f / 亮 #bf5f3e)和左侧设置导航选中指示(x≈23-35,y≈395-407)。空数据态下趋势折线、donut、渠道点均为零彩色。
- 唯一的蓝色出现在热力图图例(y≈480-488,x≈1308-1326):**全 0 状态下图例仍展示 level 1-4 的蓝色梯度样本**(`--mf-usage-chart-1` 的 color-mix 混色),暗示数据存在。
- 热力图区域实测:371 格全部 level-0 均一灰(暗 #222325 / 亮 #dddedb)。亮色模式下格子比白面板底(#ffffff)更深,空态下这是全页最大的视觉块,却是一面「均色格子墙」,无任何「暂无记录」说明。
- 趋势面板空态显示「该时间范围内暂无成功生成」居中文案(min-height 180px),暗亮一致。
- 汇总卡数值 20px 等宽字体、单位与数值同尺寸同字重(值字符串整体拼接,代码证实)。

## 代码问题(file:line)

以下路径前缀:`apps/desktop/src/`(S = features/settings/components/UsageStatisticsSection.tsx,C = features/settings/UsageStatisticsCharts.tsx,U = features/settings/usage-statistics.ts,CSS = styles/usage-statistics.css)。

1. **CSS:5-12 图表色是硬编码 hex 色板,不走语义 token,且无明暗两套**:蓝 #4b97eb / 绿 #45bd78 / 紫 #7b5ce0 / 红 #ef6468 / 橙 #f08a3e / 青 #45b9bc。DESIGN.md 明令「不用蓝紫主导的调色板」「克制」;同一组色明暗两主题共用,违反 Codex 基准「语义色是函数,不是色板」。
2. **CSS:181-203 热力图强度用蓝色**(chart-1 混色),而 ember 才是「creation, selection, active progress」的唯一点缀 —— 生成活动热力图正是 active progress 的教科书场景,现在却引入第六种色相。
3. **C:95 + C:272 渠道取色无单一事实源**:趋势图按「successCount>0 过滤后」的数组下标取色,渠道统计按全量 channels 下标(且 `index % 6` 循环,>6 渠道撞色);一旦某渠道成功数为 0 被趋势过滤,其后所有渠道在两个面板间颜色错位。模型分布(C:207、C:233)又共用同一色板 —— 模型 #1 与渠道 #1 同色,跨面板语义混淆。
4. **C:24-82 热力图无空态**:全 0 时照常渲染 371 个均一灰格子 + 蓝色图例(C:73-79)。违反 Codex 基准「装饰由内容价值决定;空状态不刷存在感」。
5. **C:119 / C:200 / C:261 空态条件 `xxx && !loading` 造成三态混乱**:首载(空 + loading)时,趋势图渲染只剩 4 条网格线的空 SVG(C:122-176,无 skeleton、无提示);模型环渲染 total=0 的空轨道 + 中心「0 次生成」;渠道面板渲染零行列表(仅一条孤悬 border-top,高度塌陷)。且空态 min-height 180px vs 趋势图有数据 260px,数据到达时布局跳动。
6. **S:96-124 加载中把「未知」渲染成「零」**:`allTime?.totalCount ?? 0` 显示「0 次 / 0% / 0 天」,数据到达后跳变为真实值。对指标卡这是误导(Codex /status 卡有 refreshing 态与数据态的显式区分)。
7. **CSS:54-65、362-366、396-400、443-451 数字用 ui-monospace 字体族**:DESIGN.md 的要求是 native UI stack + tabular figures(「Use tabular figures for quota…」),等宽字体族改变数字字形声调、与周围 UI 文字不协调,Windows 上还会落到 Courier New 一档。且单位「次 / 天 / 积分」与数值拼在同一字符串(S:98、S:110、S:115),同为 20px / 650 字重,单位无层级。
8. **小字号与对比度双重不足**:10/10.5/11px 文字遍布(CSS:79-85、147-155、205-213、307-311、437-441),DESIGN.md「App labels use 12-14px」;fg-quaternary 亮色 #a1a3a9 对白底 ≈ 2.52:1、暗色 #62656d 对 #25272a ≈ 2.56:1,10px 释义文字(「至少成功生成一次」「不含豆包与自建 Provider」等)远低于 WCAG AA 的 4.5:1;亮色 fg-tertiary #74777c 对白 4.49:1 也压线。渠道行 11px ember 数值(CSS:453-455)3.63:1,小字号下同样不达标。
9. **S:133-149 时间范围控件的位置与 a11y**:它是页面上唯一的裸 h2 行(无框、页底色),只控制其下三个面板却放在热力图之后,视觉上像整页过滤器。role=radio 按钮组没有 roving tabindex 与方向键导航(WAI-ARIA radio group 要求 Tab 只落选中项、方向键切换),也无 aria-controls 指明受控区域;每个按钮都可 Tab 聚焦。
10. **C:127 / C:62 图表缺文字等价**:趋势图 aria-label「各生成渠道趋势折线图」不含范围、渠道、任何数值;热力图容器 aria-label「过去 53 周生成活动热力图」无数据摘要。格子信息只有 title 悬停(C:68),键盘 / 触屏不可达。
11. **S:30 `now` 挂载时冻结**:页面跨天驻留后「近 7 日」窗口与热力图右端过期;refresh() 复用同一 now,刷新并不会推进时间窗。
12. **C:54 + CSS:128-139「每日」是伪控件**:带边框 + 内衬背景 + 圆角的 chip 样式,看起来可切换,实际不可交互(affordance lie)。
13. **CSS:313-320 模型分布无窄窗降级**:donut 220px + 列表 minmax(360px,1.3fr) 双列固定,内容宽 <760px 时横向溢出;@media(CSS:475-488)只处理了汇总卡,没覆盖 distribution 与渠道行。
14. **强调与空值语义小疵**:「当前积分」卡登录态有真实余额反而无强调(S:120-124),与「账号积分消耗」不成呼应;成功率在无任何尝试时显示「0%」(U:121-123),与「真实 0% 成功」不可区分。

**红线检查(合规)**:四个文件 198 / 386 / 123 / 488 行,均 ≤600;图标经 `components/ui/icons` 转发(S:6),未直接 import lucide-react;代码无 emoji。

## 改进建议

### P0

1. **图表色语义化,热力图归位 ember**。目标:`styles/usage-statistics.css:5-12、181-203`。做法:删除 6 个硬编码 hex,改为从现有 token 派生的序列 —— 热力图 level 1-4 用 `color-mix(in srgb, var(--accent) 28%/48%/72%/100%, var(--bg-inset))`(派生色优于新增色,任意主题自洽);分类色若保留多色相,至少给 `[data-theme]` 两套值并把蓝紫降为末位。若把序列提为全局 token(`packages/ui/src/tokens.css`)**涉及共享包**,需跑双端视觉门禁;先做本页局部变量即可不动共享包。
2. **渠道取色收敛为单一事实源**。目标:`features/settings/usage-statistics.ts`(新增 `channelColorIndex(channels, id)`)、`UsageStatisticsCharts.tsx:95、142、272`。做法:按 channelId 全量列表一次性分配颜色,趋势图、趋势图例、渠道统计行共用同一映射;>6 的渠道归入「其他」用中性灰,不循环撞色;模型分布改用 ink 灰阶 ramp(或 ember 单色明度序列),与渠道色彻底分流。
3. **空态三态收敛(空 / 加载中 / 有数据)**。目标:`UsageStatisticsCharts.tsx:24-82、119、200、261`、`styles/usage-statistics.css:457-465`。做法:热力图 total=0 且非 loading 时渲染 `UsageEmpty`(「暂无生成记录,生成一次后会在这里出现活动日历」)或保留日历但隐藏图例;加载中(空 + loading)显示与有数据等高的 skeleton(统一 min-height 260px / 180px 二选一),消灭「空网格线 SVG」「total=0 空环」「孤悬 border-top」三种残缺中间态。
4. **汇总卡「未知 ≠ 零」**。目标:`UsageStatisticsSection.tsx:96-124`。做法:`allTimeQuery.data` 未到时 value 渲染「—」、detail 留空或灰化(`data-pending`),数据到达后一次性填充,不再出现 0 → 真实值的跳变;成功率无尝试时也显示「—」。

### P1

5. **数字排版对齐 DESIGN.md**。目标:`styles/usage-statistics.css:54-65、362-366、396-400、443-451`、`UsageStatisticsSection.tsx:98-115`。做法:数值回到 native UI stack,加 `font-variant-numeric: tabular-nums`(满足「tabular figures」而不换字体族);值与单位拆分 —— 单位独立 `<span>`,12px / fg-tertiary / 500 字重,数值保持 20px / 650。
6. **小字提级与对比度修复**。目标:`styles/usage-statistics.css`(10px 处全部)。做法:承载语义的 10px 文字(summary detail、面板副标题、渠道 metric label)提到 11-12px 并从 fg-quaternary 升到 fg-tertiary;10px 仅保留给轴刻度与图例色块旁注;渠道行 ember 数值升一档字号或改深一档 ember(`#bc5535` 对白 4.6:1)。若动 fg-quaternary token 本身则**涉及共享包**(token 在 `packages/ui/src/tokens.css`),建议先只改本页用色。
7. **时间范围控件归位 + 键盘模型**。目标:`UsageStatisticsSection.tsx:133-149`。做法:把控件移入「生成趋势」面板 header 右侧(它只作用于趋势/模型/渠道三个面板),删掉裸 h2 行;radio 组实现 roving tabindex(仅选中项 tabIndex=0)+ 左右方向键切换,并给受控容器加 id + `aria-controls`。
8. **图表文字等价**。目标:`UsageStatisticsCharts.tsx:62、127`。做法:aria-label 拼接实际数据 —— 热力图:「过去 53 周共 N 次成功生成,活跃 M 天」;趋势图:「{rangeLabel}各渠道成功生成:{渠道 × 次数}」;格子 title 之外,给容器一个视觉隐藏的逐月摘要表(screen reader only)。
9. **消灭伪控件**。目标:`styles/usage-statistics.css:128-139`。「每日」改为无边框无背景的 dim 文本(同面板副标题样式),或直接并入副标题「过去 53 周的全渠道成功生成次数(按日)」。
10. **now 随刷新推进**。目标:`UsageStatisticsSection.tsx:30、50-57`。做法:`refresh()` 里 `setNow(Date.now())`(useMemo 链自动重算查询窗口),或挂 `refetchInterval`/窗口聚焦重取时一并更新。

### P2

11. 色盲友好:分类序列避开绿 #45bd78 与红 #ef6468 并置,趋势线可叠加 dash pattern 差异;默认最多画 3-4 条线,其余归「其他」。
12. 模型分布窄窗降级:`@media (max-width: 880px)` 时 donut 与列表单列堆叠(目标 `styles/usage-statistics.css:313-320`);渠道行 metric 列允许换行或转 key/value(Codex「表格放不下转 key/value」)。
13. 「当前积分」登录态与「账号积分消耗」做视觉分组(两卡相邻 + 共用「账号积分」小节),未登录时明确「登录后显示」而非「—」;三处积分口径说明(节描述、卡片 detail、底部 note)合并为一处,其余改「见下方说明」。
14. 长驻留过期提示:页面打开超过 24h 时在热力图 header 加「数据截至 {date}」stale 标记(Codex /status 卡的 "may be stale" 模式)。

## 保持不动

- 四文件行数与职责划分(198 / 386 / 123 / 488,红线合规;不要在本页顺手拆文件)。
- 图标唯一入口 `components/ui/icons`、全程无 emoji、`letter-spacing: 0` 的遵守。
- 汇总卡 value → label → detail 的三行层级、居中排版与 `data-testid` 命名体系(e2e `test_39_usage_statistics_v2_desktop.py` 依赖)。
- `SectionShell` 复用 product-ui(标题 h1 结构)及用 `className="mf-usage-section"` 挂页面样式的做法 —— 不为样式需求改共享包结构。
- 热力图 53 周 / 月份标签 951px 的精确对齐算法、`tickIndexes` 去重、`shortBucketLabel` 三种 key 解析(U 侧已有单测覆盖,改 UI 不动它们)。
- 错误条 `role="alert"`、刷新按钮 loading / aria-label / disabled 三态、渠道行「不计积分」诚实空值、`formatUsageCount` 的 zh-CN compact(万)格式。
- 趋势图/分布图在空态给出各自的中文一句话文案(而非空白),方向正确,只需统一高度与中间态。
