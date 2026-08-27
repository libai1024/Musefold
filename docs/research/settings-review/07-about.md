# 关于 App 页 review

> 本报告仅基于代码分析:截图 `/tmp/musefold-settings-review/baseline/07-about-dark.png` 在当前分析环境无法读取图像内容,「截图观察」一节由代码结构与既有 settings 版式规律(globals.css / settings.css / product-ui SettingsComponents)推断,未经像素级核对,明暗一致性结论以 token 审计为准。
>
> 设计基准:`docs/research/codex-tui-ui-research.md`(克制、只读状态卡、渐进披露、能看到的就能执行)+ `DESIGN.md`(Graphite/Porcelain/Ember,tabular figures,无 emoji)。

评审对象:`AboutAppSection.tsx`(新页壳)、`AboutSection.tsx`(512 行,四卡)、`UpdateChannelRow.tsx`、`third-party-notices.ts`(实际位于 `apps/desktop/src/features/settings/third-party-notices.ts`,不在 components/ 下,import 路径 `../third-party-notices` 正确)。

## 截图观察(代码推断)

页面结构:页壳 `SectionShell`(h1「关于 App」+ 单行描述)下纵向四张 `SettingsCard`(h2)+ 页尾一条无边框注记:

1. **应用信息**:品牌区 72px 方形容器(MusefoldLogoAnimated 44px)+ 名称/副标题/slogan/开发者四行文案,右上角复制版本按钮(mono 两行 `v{app}` / `DB schema {n}`,Copy → Check 反馈 1.5s)。品牌区整体克制,符合「precise studio instrument」定位,没有营销 hero。
2. **应用更新**:三行——更新通道(ChoiceChips 三段或锁定态纯文本)、内容层状态 + 「检查内容更新」、应用更新状态机行(检查/最新/可下载/下载中/已下载重启,右侧动作按钮随状态换文案与图标)。
3. **支持**:三行(产品文档/问题反馈/开源许可),动作分别为打开/复制信息/查看(弹 Dialog)。
4. **键盘快捷键**:五行静态 `label + Kbd 序列`。
5. 页尾 ShieldCheck + 本地优先/密钥加密安全声明(11px tertiary)。

拆分后信息量判断:4 卡 + 1 注记对一个「关于」页是合适密度,不空也不挤;「数据存储」同批拆出后两页各自成立,本页没有残留数据类内容。卡片顺序(信息 → 更新 → 支持 → 快捷键)按用户关心度递减排列,快捷键与主题关联最弱放最后,正确。

## 代码问题(file:line)

均为 `apps/desktop/src/features/settings/components/` 下文件,单独标注者除外。

1. **快捷键卡描述与实际不符(诚实性)** — `AboutSection.tsx:283` 写「当前工作区可用的主要快捷操作」,但 `packages/domain/src/navigation-catalog.ts:19` 注释自述「⌘K / ⌘N 由命令面板监听;F / Enter 只作展示」,且 `matchProductModifierShortcut`(navigation-catalog.ts:212-224)只匹配 k/n——**「搜索 ⌘F」在桌面端没有任何 keydown 监听**;「发送 Enter / 换行 Shift+Enter」只在 composer 聚焦时成立,与「工作区可用」的全局语气冲突。违反 Codex §3.8「过滤与执行共用同一 gating——能看到的就能执行」。
2. **下载进度数字未用 tabular figures** — `AboutSection.tsx:438` `${Math.round(...)}% · ${formatBytes(...)} / ${formatBytes(...)}` 用默认字体;DESIGN.md Typography 节明确「Use tabular figures for quota, dimensions, and job progress」,下载进度即 job progress,数字逐帧变化会引起行宽抖动。版本号处(234 行 `font-mono`)做对了,进度处漏了。
3. **更新状态行初始态谎报** — `AboutSection.tsx:404` `status?.state ?? 'checking'`:IPC `getState` 返回前页面显示「正在检查更新」+ 旋转图标,实际什么都没在检查;而 ContentLayerRow 有真实的「尚未检查」态(387 行)。两行同卡相邻,初始态语义不一致。
4. **状态变化无读屏播报** — `AboutSection.tsx:464-465` 更新行的 title/description 在 checking→available→downloading→downloaded 间切换,容器无 `aria-live`;同 repo `AccessTransitions.tsx:119` 已有 `aria-live="polite"` 先例,设置域不一致。
5. **复制版本按钮的可访问名不含动作** — `AboutSection.tsx:227-245`:按钮 accessible name 由可见文本计算为「v1.2.3 DB schema 5」,「复制」语义只存在于 `title` tooltip(不参与默认可访问名计算);Check 反馈切换(240-244)亦无播报。
6. **快捷键键序无整体语义** — `AboutSection.tsx:287-290` 每个 key 独立 `<Kbd>`,读屏器会读成「Command」「K」两个孤立词条;键序容器缺 `aria-label="⌘K"` 之类的整读标签。五条数据用 div 布局而非 dl/table 尚可接受(量小)。
7. **UpdateRow 三元链 46 行** — `AboutSection.tsx:410-455` title/description/action 三条嵌套三元;同文件 ContentLayer 状态文案用的是两层 Record 映射(47-76 行),同页两种风格,前者新增状态时极易插错分支。
8. **512 行文件的天然拆分缝未做** — `AboutSection.tsx` 512 行(红线 ≤600 未破,但同页已抽出 `UpdateChannelRow.tsx` 先例):337-393(ContentLayerRow + 两个 label map + formatContentCheckLabel)、395-486(UpdateRow + formatBytes)、488-512(SupportRow)三段各自内聚,与品牌卡/编排逻辑零耦合。
9. **页面/卡片描述复述标题** — `AboutAppSection.tsx:8`「应用版本、更新通道、支持资源与键盘快捷键。」逐字罗列四张卡的标题,描述没有提供标题之外的信息;`AboutSection.tsx:214`「Musefold 版本、品牌与数据库结构信息」同理。Codex §4.4:常驻信息只给单行且要有增量价值。
10. **「内容层」术语直接暴露** — `AboutSection.tsx:360`「内容层 · {versionLabel}」是工程内部概念;status→人话映射(47-76 行)做得很好,但行标题本身仍是 jargon,与整页「应用更新」的人话风格不齐。
11. **ContentLayer 状态不订阅推送** — `AboutSection.tsx:103-109` 只在挂载与手动检查后拉取 `getContentState`;`onStateChanged` 只喂 `updateStatus`。主进程侧内容层状态变化(后台安装 pendingVersion)不会反映到本页,与「卡片是活的」(Codex §3.6)有差距。
12. **失败兜底文案是开发者语言** — `AboutSection.tsx:121-123` `'Musefold 未读取 · DB 未读取'` 会原样进剪贴板与反馈模板;235-238 行把「未读取」当永久内容渲染在 mono 版本位,无重试入口。
13. **状态映射无单测** — `__tests__/about-update-channel.test.tsx` 覆盖通道切换,但 UpdateRow 的 8 态文案映射(410-455)与 ContentLayer 的 22 条 label 映射(47-76)是纯函数,contracts 增改 status 时会静默落入「未知状态」,无测试兜底。

红线核查:文件 ≤600 行(512,通过);图标全部经 `components/ui/icons`(`icons.ts` 仅 re-export `@musefold/ui/icons`,合规,`lucide-react` 字样只出现在第三方许可清单数据里);全页无 emoji,分隔用 `·` 中点(合规);颜色全语义 token,无硬编码色值。

## 改进建议

### P0

1. **快捷键表只列真实存在的快捷键**(涉及共享包 `packages/domain`)。二选一:
   - 删:从 `navigation-catalog.ts:20-26` 的 `PRODUCT_SHORTCUTS` 移除 `search`(⌘F 未接线)与 `newline`(Shift+Enter 属 composer 语境),或
   - 接:给 ⌘F 接入全局搜索焦点逻辑(挂在 CommandPalette 同层全局 keydown),并给「发送/换行」标注作用域(如「输入框内」列)。
   同步把 `AboutSection.tsx:283` 卡片描述改为可验证的表述(如「全局快捷键,⌘K 打开命令面板查看全部」),并考虑在卡尾加一行「命令面板内有更多操作」引导,让静态表与命令面板动态提示互为入口而非两套事实。

### P1

2. **下载进度数字加 tabular figures** — `AboutSection.tsx:438` 的容器 `<p>` 加 `tabular-nums`(或与版本号一致用 `font-mono`),对齐 DESIGN.md job progress 条款。
3. **拆出三个子组件文件** — 目标 `apps/desktop/src/features/settings/components/`:`AboutContentLayerRow.tsx`(收编 47-76 两个 label map + formatContentCheckLabel + ContentLayerRow,约 110 行)、`AboutUpdateRow.tsx`(UpdateRow + formatBytes,约 95 行)、`AboutSupportCard.tsx`(SupportRow + licenses Dialog,约 80 行);`AboutSection.tsx` 剩品牌卡与编排约 230 行。与既有 `UpdateChannelRow.tsx` 抽法对齐,四个行组件同粒度。注意各文件仍在 600 行线内,顺手把 `third-party-notices.ts` 的实际路径(features/settings/ 根)在文档类注释里写对。
4. **更新行加 aria-live + 补「尚未检查」初始态** — `AboutSection.tsx:459` 行容器加 `aria-live="polite"`(或仅状态文案节点);404 行初始态改为独立 `'unknown'` 分支显示「尚未检查」,与 ContentLayerRow:387 统一。
5. **描述去重** — `AboutAppSection.tsx:8` 改为用途导向单行,如「查看当前版本、检查更新,或获取文档与支持资源。」;`AboutSection.tsx:214` 应用信息卡描述可删或只留增量(「版本号、DB 结构版本与品牌信息」→ 直接省略 description,卡内已自明)。

### P2

6. **复制版本按钮语义补全** — `AboutSection.tsx:227` 加 `aria-label={\`复制版本信息 v${version?.app ?? '未读取'}\`}`;Check 切换处复用同一 live region 播报「已复制」。
7. **快捷键键序整读** — `AboutSection.tsx:287` 键序容器加 `aria-label={shortcut.keys.join('')}`,子 Kbd `aria-hidden`。
8. **UpdateRow 三元链改映射** — 与 ContentLayer 同风格,`Record<UpdateState, {title, description, action}>`(description 内的动态百分比对 downloading 单独拼),顺带为 13 条建议里的映射函数补 `__tests__` 就地单测。
9. **「内容层」改名** — 行标题改「内置资源 / 云端内容包」或「桌面内容包」,`CONTENT_CHECK_STATUS_LABELS` 已有的人话体系照用;类型从 `Record<string, string>` 收紧为 `Record<ContentLayerCheckSnapshot['status'], string>` 获得 exhaustive 检查。
10. **失败兜底文案** — `AboutSection.tsx:121-123` 版本读取失败改为「版本信息暂不可用」且剪贴板模板跳过该行,按钮位提供轻量重试(重跑 `getVersion`)。
11. **ContentLayer 订阅推送** — 若 desktop-contracts 提供内容层变更事件则订阅;没有则最低限度在 `checkContentNow` 与窗口重新聚焦时刷新,避免「重启后启用」长期滞留旧值。

共享包标注说明:1 涉及 `packages/domain`(涉及共享包);2-11 均在 `apps/desktop` 设置域内完成,不改 `packages/product-ui` / `packages/ui`(SettingsCard 的 description 是可选 prop,去重只改传参;Kbd 不动)。

## 保持不动

- **卡片顺序与四卡结构**:信息 → 更新 → 支持 → 快捷键,关心度递减;独立成页后信息量合适,不需再合并或再拆。
- **快捷键保留在设置里静态列出**:与命令面板共用 `PRODUCT_SHORTCUTS` 单一事实源是对的(修内容,不撤功能);命令面板 hint 与设置表互为补充而非冗余。
- **更新通道的锁定态与确认弹窗**:`UpdateChannelRow.tsx:87-88` 锁定时降级为纯文本值 + 原因文案(对应 Codex「置灰 + 原因,不隐藏」);确认弹窗取消在前、busy 态「切换中…」,安全默认正确。
- **支持卡三行与 openAboutResource 白名单**:不暴露裸 URL、反馈走「复制信息模板」而非跳转,离线优先一致,且有 E2E(`tests/e2e/test_05_settings.py:1357,1395`)守着。
- **复制版本交互**:右置按钮、mono 两行小字渐进披露 DB schema、Check 1.5s 反馈,符合克制基调。
- **品牌区版式**:72px 容器 + 四行文案层级(名称 15px semibold → 副标题 → slogan → 开发者 quaternary),无营销化元素,是全页最「Graphite/Porcelain」的一块。
- **本地优先注记留在关于页**:作为产品信任声明的落点,与数据存储页各自的 Shield 注记不重复(已核对无跨页复用)。
- **明暗一致性现状**:全语义 token,暗色下无已知问题(截图未能读取,建议人工补一眼亮色版式,重点看品牌容器 `bg-elevated` + `shadow-sm` 在亮色高亮背景上的层次)。
