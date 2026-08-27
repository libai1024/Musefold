# 数据存储页 review

> 评审对象:设置「数据存储」页(自「数据与关于」拆分独立成页,同批新增「关于 App」页)。
> 基准:`docs/research/codex-tui-ui-research.md`(克制、渐进披露、危险操作隔离、明确动词)+ `DESIGN.md`(Graphite/Porcelain/Ember)。
> **本报告仅基于代码分析**:截图 `/tmp/musefold-settings-review/baseline/06-data-dark.png` 无法被当前模型读取(不支持图像输入),「截图观察」一节为代码推导的预期渲染,明暗视觉结论均需人工比对截图复核。

## 截图观察

(代码推导,非直接观察)

预期画面:页面标题「数据存储」+ 描述一行,下方**唯一**一张「本地数据」卡,卡内自上而下:导出与导入行(右侧「导出」「导入」两个 outline 按钮)→ 数据库备份行(右侧图标刷新 + 「立即备份」)+ 常驻展开的备份列表框(手动/自动徽标、等宽文件名、时间·体积、「恢复」ghost 按钮)→ 图片输出 / 应用数据 / 备份目录三行(等宽路径 truncate + 「打开」)→ 诊断日志行(「查看」「打开」)→ 危险区行(「清空全部数据」danger 按钮,红色按钮是整页唯一 ember/danger 之外的高亮)。

由此可推断的视觉问题(需截图确认):整页只有一张卡,7 组行靠 border-b 细线串在一起,备份列表框嵌在行与行中间,卡片节奏被打断;危险区与普通行同构,仅按钮变红,隔离感不足;长路径(应用数据路径通常很深)会被 truncate 截断且无 title 提示。

## 代码问题(file:line)

### 页面与信息架构(拆分后)

1. **页面描述漏掉冠名内容、弱化危险项** — `DataStorageSection.tsx:8`「本机数据的导入导出、备份、日志与重置」:没提「存储位置」(页面叫「数据存储」的核心信息),且「重置」一词把「清空全部数据」说轻了。
2. **双层标题冗余 + 单卡承载四个关注点** — `DataSection.tsx:87-90`:页面标题「数据存储」下只有一张卡,卡又叫「本地数据」再带一句描述;迁移、备份、位置、日志、危险五类内容全靠 border-b 分隔。拆分后页面行数并不薄(7 组行 + 内嵌列表),薄的是**结构**——没有第二张卡来给页面塑形。
3. **危险区未物理隔离** — `DangerZonePanel.tsx:61-77`:危险区只是卡内最后一行,与「图片输出」行完全同构(同字号 label、同 border-b),仅按钮为 danger variant。基准(codex 报告 §2.3/§3.4「高成本/危险选项隔离 + 确认」)要求危险操作有独立视觉分区。
4. **备份列表常驻展开** — `BackupPanel.tsx:150-206`:max-h-56 内滚列表常驻展开,嵌在导出导入行与路径行之间;行 hint(`BackupPanel.tsx:110-112`)只说「保留最近的手动、导入前和升级前快照」却给不出份数。违反基准 §4.4「常驻信息只给单行,详情全部按需调出」。

### 术语与动词表达

5. **「备份」一词两用** — `DataSection.tsx:96` 导入导出行说「备份或迁移全部数据」,而下方 `BackupPanel.tsx:109` 是「数据库备份」。导出文件 ≠ 数据库快照,同页撞词直接制造困惑(用户想回滚会去点「导出」)。
6. **危险区三套说法** — `DangerZonePanel.tsx:75` 按钮「清空全部数据」、`:18` 确认短语「清空数据」、`:170` 确认按钮「永久清空」。用户可能照入口按钮全文输入「清空全部数据」而卡在校验。
7. **中英混用** — `DangerZonePanel.tsx:52` toast「Provider、API 密钥和图片文件保持不变」,同仓库他处一致用「服务商」(`ImportDialog.tsx:79`、`ExportDialog.tsx:158`)。
8. **入口动词偏短(轻微)** — `DataSection.tsx:106/114` 按钮仅「导出」「导入」两字,可接受但未达基准「完整动词短语」标准,也没有「…」暗示后续是对话框(mac HIG 惯例)。

### 路径信息展示与复制

9. **路径截断无 title、无复制** — `DataSection.tsx:128-129`:三个路径行 `truncate` 且无 `title`(对比 `BackupPanel.tsx:182` 的备份文件名反而有 `title={backup.file}`);没有任何复制途径,「应用数据」路径深且长,截断后既看不全也拿不走,只剩「打开」。
10. **getPaths 失败被静默吞掉** — `DataSection.tsx:36-37` `.catch(() => {})`:失败后三行永远「未读取」+ 禁用按钮,无重试;「未读取」是开发者视角文案。

### 对话框层级与关闭协议

11. **busy 期关闭守卫不统一** — `ImportDialog.tsx:175`、`ExportDialog.tsx:119` 把 `onOpenChange` 直通,Radix 的 Esc/遮罩/X 在 busy 中可直接关掉对话框:导入/导出继续后台跑、结果面板永久丢失;而 `BackupPanel.tsx:98-103`、`DangerZonePanel.tsx:38-42` 都有 busy 守卫。四个对话框两套协议。
12. **恢复成功态 Esc 被静默吞掉** — `BackupPanel.tsx:98-103` + `:211` `hideClose`:restored 后唯一出口是「立即重启」,Esc 触发的 onOpenChange 被忽略且无任何反馈。强制重启有数据一致性理由,但「按了 Esc 没反应」违背基准「Esc 恒等于安全出口」的表达契约。
13. **换策略统计期数字陈旧** — `ImportDialog.tsx:138-141` 切换策略触发重新 dryRun,期间 `:279-283` 预览行仍显示旧策略计数,无「重新统计中」态。
14. **尺寸与完成态不统一(轻微)** — 对话框宽度 480(`ExportDialog.tsx:120`)/ 500(`ImportDialog.tsx:176`)/ 440(`BackupPanel.tsx:210`)/ 460(`DangerZonePanel.tsx:80`)四种;done 态「完成」按钮 ghost(`ImportDialog.tsx:318`)vs 默认 variant(`DangerZonePanel.tsx:141`)。

### a11y 与明暗

15. **折叠状态不可感知** — `DataSection.tsx:153-155` 日志「查看/收起」无 `aria-expanded`/`aria-controls`;`:176` 日志 `<pre>` 无 `aria-label`(仅有装饰性 span「最近 300 行」)。
16. **ChoiceCards ARIA 模式不完整** — `ChoiceCards.tsx:32/42` `role="radiogroup"`+`role="radio"` 但无方向键导航(只能 Tab 逐个停),不符合 ARIA radio 模式。
17. **对比度风险(需浅色截图复核)** — `BackupPanel.tsx:185-187` 备份行 meta「时间 · 体积」用 `text-quaternary` + `text-meta`(约 11px)双重降级,浅色主题下存疑。
18. **done 态备份路径无出口** — `DangerZonePanel.tsx:99-100` `done.backupPath` truncate 无 title、无「打开位置」/复制(`ExportDialog.tsx:99` 的 toast 反而带「打开位置」action)。

### 红线检查(均通过)

- 单文件 ≤600 行:最大 `ImportDialog.tsx` 337 行,全组 1197 行,通过。
- 图标:六个文件全部经 `components/ui/icons` 中转,无直接 `lucide-react` import(`third-party-notices.ts:31` 仅许可声明),通过。
- 无 emoji:通过(`ImportDialog.tsx:197` 的 `✕`、各处 `·` 是符号,不是 emoji)。

## 改进建议(P0/P1/P2)

### P0

1. **危险区独立成卡** — `DataSection.tsx:183` + `DangerZonePanel.tsx`:把 DangerZonePanel 移出「本地数据」卡,作为页面底部独立 SettingsCard(标题维持「危险区」),与上方卡片留 16-24px 间距,可加 `border-danger/30` 描边或顶部 danger 细线做分区暗示。这是基准「危险操作隔离」的最低要求,也是本次拆分后给页面塑形的最省力手段(不动 product-ui,SectionShell 现有 API 足够)。
2. **路径行补 title 与复制** — `DataSection.tsx:121-141`:路径 `<p>` 加 `title={r.path}`;「打开」旁加 `iconSm` 复制按钮(Copy 图标 + `aria-label="复制路径"`,点击 `navigator.clipboard.writeText` + toast 短反馈)。路径是本页叫「数据存储」的理由,当前既看不全也复制不了。

### P1

3. **备份列表渐进披露** — `BackupPanel.tsx`:改为与诊断日志同构的折叠行——常驻一行「数据库备份 | 共 N 份 · 最近 {formatDate(最新)}」+「查看」展开列表(首次展开才渲染),「刷新」「立即备份」留在行右侧。消除行间嵌列表的节奏断裂,落实「常驻单行、详情按需」。
4. **危险区确认短语对齐** — `DangerZonePanel.tsx:18`:`CONFIRM_PHRASE` 改为「清空全部数据」,与入口按钮(`:75`)一致;确认按钮(`:170`)可保留「永久清空」作后果强调,但短语必须等于用户刚点过的按钮文案。
5. **busy 关闭守卫统一** — `ImportDialog.tsx:175`、`ExportDialog.tsx:119`:包一层与 `BackupPanel.tsx:98` 同款的 `closeDialog`(busy 时拒绝关闭),四个对话框一个协议;Esc 在 busy 中被拦是有正当理由的安全行为,但要全组一致。
6. **术语排歧 + 中英统一** — `DataSection.tsx:96` 改「把全部数据导出为单一文件,用于迁移到其他设备或存档」;`DangerZonePanel.tsx:52`「Provider」→「服务商」。同页「备份」只留给数据库快照。
7. **页面重排为 2-3 张卡,描述同步改写** — `DataSection.tsx` + `DataStorageSection.tsx:8`:建议「存储位置」卡(三路径行 + 诊断日志)→「迁移与备份」卡(导出导入行 + BackupPanel)→「危险区」卡(见 P0-1);页面描述改「存储位置、导入导出、数据库备份、诊断日志与清空数据」。拆分后行数不薄,缺的是分组——重排后本页独立成页完全成立。若想保住与其他单卡页的节奏一致性,最低限度也要执行 P0-1。
8. **getPaths 失败可恢复** — `DataSection.tsx:31-38`:catch 里置 error 态,行内显示「路径读取失败」+「重试」按钮,替换永久「未读取」死状态。

### P2

9. **折叠区 a11y** — `DataSection.tsx:153`:`toggleLog` 按钮加 `aria-expanded={logOpen}`、`aria-controls`;`:176` `<pre>` 加 `aria-label="最近 300 行诊断日志"`。
10. **换策略统计中态** — `ImportDialog.tsx:279-283`:busy 时预览行显示「按新策略重新统计中…」,数字回来再显示。
11. **恢复成功态的 Esc 表达** — `BackupPanel.tsx`:保留强制重启,但在 `:216-219` DialogDescription 明示「完成恢复必须重启,此对话框无法先关闭」,让 Esc 被拦变成「有言在先」而非无声失效;或评估加「稍后重启(重启前勿编辑数据)」次级出口。
12. **对话框规格统一** — 四个对话框统一 460px(或 480px);done 态「完成」统一 ghost。均为桌面端文件,不涉及共享包。
13. **ChoiceCards 键盘模式补全** — `ChoiceCards.tsx`:radiogroup 容器加 onKeyDown 方向键移动焦点(Roving tabindex),或退一步去掉 radio role 用普通按钮组;导出/导入两个对话框共用,一次修两处。该组件在桌面 settings 目录,不涉及 product-ui。
14. **浅色对比度复核** — `BackupPanel.tsx:185` meta 行升 `text-tertiary` 或在浅色主题跑一次对比度检查(需截图/实测确认)。
15. **done 态备份路径出口** — `DangerZonePanel.tsx:99-100`:加 `title={done.backupPath}` 与「打开位置」按钮(复用 `api.system.openInFolder`)。
16. **入口动词补全(可选)** — `DataSection.tsx:106/114`:「导出数据…」「导入数据…」,省略号暗示后续对话框。

## 保持不动

- **拆分本身成立**:拆走「关于」后本页仍有 7 组行、4 个对话框、1 个内嵌列表,密度不薄,不需要并回,也不需要与「使用统计」或「已归档聊天」重组(导航组「数据与应用」四项结构合理)。
- **导入两段式管线**(`ImportDialog.tsx:4-9` 注释所述:dryRun 事务内真跑再回滚、换策略重算、替换策略强制备份、预览与真跑共用代码):预览数字真实可信,是基准「不骗人」原则的范本,保持。
- **危险区双重确认结构**(输入短语 + 按钮禁用至匹配 + danger variant)与确认框内「先导出」逃生门(`DangerZonePanel.tsx:146-157`):结构正确,只需对齐短语。
- **恢复备份强制重启**的唯一出口设计:有一致性理由,只需补表达(见 P2-11)。
- **导出对话框**:密钥永不出导出产物的安全声明卡(`ExportDialog.tsx:153-160`)、疑似密钥打码的双 toast(`:101-109`)、「选择位置并导出」这种完整动词短语(`:176`)、dryRun 统计随选项联动重算(`:69-79`)——全部保持。
- **备份徽标与行样式**:手动/自动徽标用中性 `bg-pressed`/`bg-inset` 而非彩色 pill,符合 DESIGN.md「pill 仅用于紧凑状态」;各行 `--density-setting-row-y` 跟随全局密度设置。
- **红线全部合规**:文件行数、图标经 `@musefold/ui` icons 中转、无 emoji。
