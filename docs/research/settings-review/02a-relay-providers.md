# 中转站·生图 tab review

> 评审对象:设置「中转站」页「生图」tab(master-detail:左 240px 列表 + 右就地编辑)。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(克制、按使用时机分层、渐进披露、动词短语按钮、语义色 token)+ `DESIGN.md`(Graphite/Porcelain/Ember)。
> 红线核对:ProviderDetailPanel.tsx 528 行(门禁 600,余量 72);图标全部经 `components/ui/icons` 转发,无直接 lucide-react import;未触碰版本号;全部文件无 emoji。

## 截图观察

**本报告仅基于代码分析**——评审所用截图(`02a-relay-providers-dark.png` / `02a-relay-providers-light.png`)无法被本次分析模型读取,以下布局结论来自 `settings.css` 与组件代码的静态推导,像素级问题(间距、对齐、具体色值渲染)未覆盖。

从代码可推导的版面结构:

- 页壳 `SectionShell`(title「中转站」+ 一句描述 + 密钥安全说明),下方 `relay-tab-bar` 内是「生图 / Agent」分段控件(product-ui `SettingsSegmentedControl`,radiogroup 语义),双通道都被能力门控关闭时不渲染 tab。
- 主体 `SettingsCard`(标题「已配置服务商」)内是 `MasterDetail`:左 rail 240px(`grid-template-columns: 240px minmax(0,1fr)`),行内 28px 品牌图标砖 + 右下角 8px 状态点 + 名称 + 11px 等宽 meta(模型 ID)+「默认」徽标;rail 底部 hairline 分隔的「新建服务商」ghost 按钮。
- 右栏详情:头部(标题 + 默认徽标/设为默认)→ hairline →「连接」分组(名称/Base URL/API Key 或豆包登录)→ 分隔线 →「模型」分组(模型输入 + 可选拉取列表 + 拉取按钮)→ 测试结果 banner → sticky 底部操作条(左:删除 icon 按钮→行内确认;右:dirty 圆点 + 放弃/测试连接/保存)。
- <960px rail 降级为顶部横向滚动列表(meta 隐藏),<639px 操作条换行、danger 槽独占一行——降级是有意的「受支持的画法」,符合 Codex 报告 §4.4。
- 色彩全走语义 token(`--fg-*`/`--border-subtle`/`--bg-active`/`--success` 等),明暗一致性由 token 体系保证,无硬编码色值。

## 代码问题(file:line)

### A. 校验与反馈

1. **校验错误信息完全不可见(P0)**。`ProviderDetailPanel.tsx:117-124` 的 `validate` 产出「请填写名称 / 请填写 Base URL / 请填写模型」,`useDraftForm` 也暴露 `errors`/`errorFor`(product-ui `forms/useDraftForm.ts:82-87`),但 ProviderDetailPanel 全文无一处渲染;字段外壳 `Field`(apps/desktop/src/features/generation/components/provider-dialog-parts.tsx:18-25)只是 label + children 的包装,**没有错误槽位**。结果:保存(:523)、测试(:519)、拉取(:446)按钮静默禁用,用户得不到任何原因。直接违反 DESIGN.md「disabled 状态」要求与 Codex 报告 §3.2「置灰 + 原因文案,不隐藏原因」原则。`AiConnectionDetailPanel.tsx`(563 行)同样不渲染 errorFor,同一问题。
2. **「拉取模型」要求模型必填,逻辑倒置(P0)**。拉取的目的就是发现可用模型,但 `handleLoadModels` 的前置校验(`ProviderDetailPanel.tsx:446` `disabled={!valid || …}`)要求 model 非空(:122)。预设预填时无感,自定义接入(空 model)时用户必须先瞎填一个模型 ID 才能拉取列表。「测试连接」(:519)同理——不选模型也应允许测连通。
3. **测试结果 banner 无 live region(P1)**。`ValidationResultBanner.tsx` 根节点是普通 div,无 `role="status"`/`aria-live`,异步到达的测试结果读屏器不播报。

### B. dirty 状态与数据安全

4. **dirty 时切换左栏条目/tab 静默丢弃编辑(P0)**。rail 行点击(`ProvidersSection.tsx:79-82`)直接清 creating + 换 selectedId,而详情面板按 key remount(`ProvidersSection.tsx:100`),未保存的名称/Base URL/输入到一半的 API Key 全部蒸发,无任何确认。切换「生图/Agent」tab、切走设置分区同理。「测试连接」/「拉取」先落库再继续编辑的补救注释(:228-230)只覆盖测试路径,不覆盖用户手动切换。
5. **「放弃」按钮语义漂移(P1)**。新建草稿点了「测试连接」后 `persist()` 已落库创建(:164-191 记住 `createdId`),此时按钮文案从「取消」变「放弃」(:513),但点击执行的是 `onCreated(createdId)`(:209-214)——**名为放弃,实则保留**。用户以为丢弃,列表里却多出一个半成品条目。文案与行为矛盾,也违背 Codex「Esc/取消恒等于安全默认」的硬契约精神。

### C. 死代码与文件尺寸

6. **doubao-web / managed 分支在本面板不可达(P1)**。`ProvidersSection.tsx:21-27` 已把 `managedBy === 'account'` 与 `type === 'doubao-web'` 过滤出 station 列表;预设选择器(provider-detail-parts.tsx:54)与空态引导(ProviderEmptyGuide.tsx:133)同样滤掉 doubao-web;`pickPreset` 无 seed 时回落 tvt。因此 ProviderDetailPanel 内的 `managed` 分支(:79、:118、:170-172、:329、:404-410)与 `isDoubaoWeb` 分支(:127、:347、:359-366、:368、:421)全是弹窗时代遗留的死分支,约 80-100 行,把文件撑到 528 行、距 600 门禁仅 72 行余量(`tests/repo/file-size-ratchet.test.ts` THRESHOLD=600)。

### D. 状态点与语义

7. **「正在测试」与「未测试」视觉相同(P1)**。`connection-status.ts:41-44` 把 `testing` 映射为 muted 灰点,与 default「未测试」(:44)同 tone,仅 hover title 文案不同。进行中状态应有独立视觉(Codex §2.5:活动点/spinner 是一等语义),否则用户点完「测试连接」在列表上得不到任何进行中反馈。
8. **relayMode=false 时「设为默认」直接消失而非置灰(P2)**。`ProvidersSection.tsx:28-30` 的 activeProvider 回退链 `find(id) ?? providers[0]` 可能落到账号/doubao 通道,此时 relay 条目的默认徽标不存在、也没有任何切换入口或原因说明(Codex §3.2:受管约束应「置灰 + 原因」,不是消失)。切换默认只能去生成视图,页内无出口。

### E. 渐进披露与细节

9. **keyUrl 提示不可点击(P2)**。`ProviderDetailPanel.tsx:392-396` 把预设的 keyUrl 渲染为纯文本 `<p>`(font-mono + Link2 图标),而 `handleValidationAction`(:304-308)已有 `window.open` 逻辑。「去拿密钥」是接入的首要路径,却要等测试失败后才能从 banner 里点开。
10. **API Key 输入框无 `autocomplete="off"`(P2)**。`ProviderDetailPanel.tsx:372-381`,Chromium 可能对 password 型输入触发保存密码/自动填充提示,干扰密钥输入。
11. **头部标题不随草稿联动(P2)**。`ProviderDetailPanel.tsx:321` 编辑中改名时头部仍显示旧名 `provider.name`,只有底部 dirty 圆点提示变化;显示 `draft.name`(或加「未保存」后缀)反馈更直接。
12. **空态引导预设行无图标(P2)**。`ProviderEmptyGuide.tsx:133-150` 预设行只有文字 + 箭头,而同列的「自定义添加」行有 Plus、generate 场景的行有 QrCode/UserRound;settings 场景下行首节奏不齐,预设行可复用 `ModelBrandIcon`。
13. **settings.css 注释过期(P2)**。`settings.css:159` 注释写「列内边距 16px 20px 20px」,实际值为 `padding: 18px 24px 20px`(:92);负 margin 数值(-24px/-20px)与实际一致,是注释说谎。
14. **拉取按钮包一层只为间距的 div(P2)**。`ProviderDetailPanel.tsx:440-456`,`<div className="mt-2">` 内只有一个 Button,可直接用按钮上的 mt 工具类。

### F. 共享组件(product-ui)

15. **`role="radio"` 无方向键导航(P1,涉及共享包)**。`packages/product-ui/src/settings/SettingsComponents.tsx:106-153` 用 `role="radiogroup"`/`role="radio"` + `aria-checked`,但按钮无 onKeyDown 处理 Arrow Up/Down/Left/Right,不符合 ARIA radio 模式;Tab + Enter 可用,但读屏器会按 radio 语义期望方向键操作。改用 toolbar/tablist 语义或补全键盘处理均可。

## 改进建议

### P0(交付阻塞级,建议本迭代修)

1. **校验错误可见化** —— `apps/desktop/src/features/generation/components/provider-dialog-parts.tsx` 的 `Field` 增加可选 `error?: string` 槽(11px `text-danger`,置于 children 下方);`ProviderDetailPanel.tsx` 每个 Field 传 `form.errorFor('name' | 'baseUrl' | 'model')`。保存按钮禁用时可在 `title` 上给一句话原因(「请先补全必填项」)。`AiConnectionDetailPanel.tsx` 同步接入。
2. **放宽拉取/测试的前置校验** —— `ProviderDetailPanel.tsx`:`handleLoadModels` 与 `handleTest` 改用「跳过 model」的局部合法判断(只看 name/baseUrl,可从 `form.errors` 过滤推导);拉取成功且 `draft.model` 为空时自动选首个可用模型(现有 :272 的单模型自动选中逻辑推广到空值场景)。按钮 disabled 条件同步拆开。
3. **dirty 切换守卫** —— `ProvidersSection.tsx` rail onClick 与 RelaySection tab 切换前,若当前面板 dirty 则弹 `InlineConfirm`(「放弃未保存的修改?」/放弃编辑·继续编辑)。需要 ProviderDetailPanel 通过 `onDirtyChange` 回调把 dirty 上抛,或把选中态+dirty 收进一个小的 panel-level state;低成本起点:只守 rail 点击与 tab 切换两条路径。

### P1(下一迭代)

4. **修正「放弃」语义** —— `ProviderDetailPanel.tsx:209-214`:`createdId` 存在时按钮改文案「完成」并直接 `onCreated(createdId)`;或提供真丢弃路径(`deleteProvider(createdId)` 后 `onDiscardNew()`)。二选一,消除「放弃却保留」的矛盾。
5. **剥离死代码 + 拆分模型分组** —— `ProviderDetailPanel.tsx`:删除全部 managed / isDoubaoWeb 死分支(本面板入口已保证不可达,必要时留一行注释说明不变式);把「模型」分组(输入 + ModelOptionList + 拉取 + 错误/hint,约 :403-468)析出到 `provider-detail-models.tsx`。文件预计 528 → ~380 行,远离 600 门禁;`AiConnectionDetailPanel.tsx`(563 行)顺带做同类瘦身。**不得以拆分为名改变行为**。
6. **testing 状态点视觉区分** —— `MasterDetail.tsx` `ConnectionStatusDot` 或 settings.css:为 `data-tone` 增加 testing 专属画法(accent 色或 1.2s pulse),动画必须走既有 `prefers-reduced-motion` 门控(settings.css:366-373 已有先例,桌面 `data-motion='off'` 语义)。可能需要 `connection-status.ts` 把 testing 从 muted 拆成独立 tone。
7. **测试结果播报** —— `ValidationResultBanner.tsx` 根节点加 `role="status"` + `aria-live="polite"`(失败分支可用 `role="alert"`)。
8. **分段控件键盘补全(涉及共享包 product-ui)** —— `SettingsComponents.tsx` SettingsSegmentedControl 补 Arrow 键移动选中(roving tabindex 或受控焦点),或降级为 `role="tablist"`。改动波及 Web 端同组件,交付前跑 `npm run check:v1.1` + `npm run test:e2e:web`。

### P2(择机)

9. **keyUrl 变为可点链接** —— `ProviderDetailPanel.tsx:392-396` 改为 `<a href rel="noopener noreferrer">` 或 button 调 `window.open`(复用 :304-308 逻辑),保留等宽小字样式。
10. **API Key 输入框加 `autocomplete="off"`**(与 `spellCheck={false}` 一并),`ProviderDetailPanel.tsx:372-381`。
11. **relayMode=false 时给「设为默认」置灰入口 + 原因文案**(「当前生图走账号通道,切换默认请到生成页」),替代直接消失;同时修 `ProvidersSection.tsx:28-30` 回退链在 activeProviderId 失效时的 relayMode 误判。
12. **头部标题显示 `draft.name`**(空值回落旧名),`ProviderDetailPanel.tsx:321`。
13. **空态预设行加 `ModelBrandIcon` 图标砖**,对齐 generate 场景行式节奏,`ProviderEmptyGuide.tsx:133-150`。
14. **修 settings.css:159 过期注释**(改为「列内边距 18px 24px 20px」);顺手去掉 :440 只为间距的包裹 div。

## 保持不动

- **图标入口**:全部经 `components/ui/icons` 转发(Plus/Eye/Zap/Loader2/Link2/Trash2/Check/AlertCircle/ExternalLink/ArrowRight/Image/QrCode/UserRound),无直接 lucide-react,红线合规。
- **语义 token 用色**:rail 选中态用低对比 `--bg-active`(MasterDetail.tsx 头注释已说明是贴近设置导航的有意决策),Ember/accent 只出现在主按钮、dirty 圆点、focus ring——与 DESIGN「单一 ember 强调」一致,不建议改成 accent 指示条。
- **<960px / <639px 降级**:横向滚动 rail + meta 隐藏 + 操作条换行是显式设计的「受支持画法」,不是待修问题。
- **API Key 遮蔽与只写语义**:password 型 + eye 切换(带 aria-label/title)、已保存态显示 `····后缀` 状态行、密钥不回显只覆盖——安全模型正确,不要为了「回显」加需求。
- **底部操作条布局**:破坏性操作隔离在最左(danger 槽)、主操作最右、dirty 圆点带 sr-only——符合 macOS 惯例与 a11y。
- **测试/拉取先落库再继续编辑的补救注释**(:228-230、:264):是 remount 策略下的正确取舍,dirty 守卫(P0-3)落地后依然成立。
- **relayTab 能力门控 + 深链回落**(RelaySection.tsx:22-27)、**分段 tab 仅双通道可见时渲染**:渐进披露做得对。
- **InlineConfirm 行内二次确认**、状态点 sr-only 文本、`aria-current`/`aria-pressed`/fieldset+legend 等既有 a11y 处理。
- 版本号、依赖方向、`tests/repo/file-size-ratchet.test.ts` baseline:均未触碰。
