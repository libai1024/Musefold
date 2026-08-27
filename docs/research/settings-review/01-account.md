# 账号页 review

> 评审对象:设置 → 账号(未登录态截图为基准,结合已登录态代码推演)。
> 设计语言基准:`docs/research/codex-tui-ui-research.md`(克制、按使用时机分层、渐进披露、动词短语按钮、语义色 token)+ `DESIGN.md`(Graphite/Porcelain/Ember)。
> **说明:本次会话模型不支持图像输入,两张截图未能读取,本报告仅基于代码分析**。「截图观察」一节为代码 + CSS 推演的视觉结论,标注了依据,待人工对照截图核实。

## 截图观察(基于代码推演,含明暗差异推演)

未登录态页面结构:`SectionShell`(标题「账号」+ 描述)→ `AccountSignedOutForm`(520px 限宽表单卡)→ `DoubaoSection`(全宽卡)。推演要点:

1. **同页两种卡片宽度,视觉断裂**。表单卡 `max-w-[520px]`(`AccountSignedOutForm.tsx:56`)居中窄卡,下方豆包卡无宽度限制、吃满 section 的 880px(`packages/product-ui/src/styles.css:508` `.mf-settings-section` max-width 880px)。未登录首屏上下两卡宽度差约 360px,左右边缘不对齐——这是未登录截图里最显眼的构图问题。
2. **已登录态限宽又不一致**。`AccountScreen` 自带 `max-width: 680px`(`styles.css:1056-1059`),已登录时上半页(概览/兑换/模型/同步/公告/设备卡)全在 680px 内,而豆包卡仍是 880px。520(未登录)/ 680(已登录)/ 880(豆包)三个宽度并存,同一设置页没有统一的「内容栏宽」。
3. **两套卡片几何并存,浅色下层级不一致、深色下趋同**。`mf-account-surface`(`styles.css:1061-1068`,border + radius + **无阴影**)与 `mf-settings-card`(`styles.css:557-564`,border + radius + **shadow-sm**)。已登录页面上两种卡混排:浅色主题下 Porcelain 底上 shadow-sm 可见,「模型/同步/公告/设备」卡比「概览/兑换」surface 看起来更「浮」;深色 graphite 底上 shadow-sm 几乎不可见,两套卡反而视觉统一——同一页面在明暗两个主题下的层级关系不一样,违反明暗一致性。
4. **warning 呈现强度在深色下骤降**。豆包安全验证提示用 `bg-warning/5 + border-warning/30`(`DoubaoSection.tsx:212`),5% 透明度底色在 graphite 深底上基本不可见、在浅底上是淡黄块;而云同步错误用无边框底色的 `InlineMessage`(左竖线 + 纯文字,`account-section-ui.tsx:32-45`)。同为 warning,两个组件、两种强度,且其一在深色下近乎失效。
5. **「收起服务器设置」折叠不彻底**。折叠入口收起了输入区,但当前服务器地址仍以 `font-mono text-meta` 常驻一行(`AccountSignedOutForm.tsx:186`)。低频诊断信息收了控件没收值,折叠语义不完整(此行有信息价值,问题在「收起」文案承诺了收纳却没收干净)。
6. **表单卡内文案层次**。卡片 description「推荐通道:一次登录…」与 SectionShell 页描述「优先使用 Musefold 官方账号登录与生图…」语义重复,同屏两段「官方优先」的营销式说明;底部还有第三段「暂不注册?使用下方豆包…」。单卡三段辅助文案,密度偏高,主任务(登录表单)被说明文字包夹。
7. **明暗差异中表现正确、无需改的**:豆包二维码 `bg-white`(`DoubaoSection.tsx:240`)在深色主题下是页面唯一大块纯白,视觉突兀但为扫码功能必需,且已加 `p-2` 白边框缓冲;`settings-facts` 格子与卡身同为 `bg-elevated`、仅靠 1px `border-subtle` 细线分隔(`apps/desktop/src/styles/settings.css:439-454`),这套 hairline 在明暗两主题下都自洽,是 Codex「表格分隔线 = 前景向背景混 20%」理念的正确落地。

## 代码问题(file:line)

行数与红线核查:8 个文件最大 301 行(`DoubaoSection.tsx`),全部 ≤600;图标全部经 `components/ui/icons`(即 `@musefold/ui/icons` re-export)或 `@musefold/ui/icons` 进入,无直接 lucide-react;全文案无 emoji。红线均合规。

问题清单:

1. `AccountSignedOutForm.tsx:128` — 登录/注册 busy 文案是「正在配置模型…」。按钮动词在等待态从「登录」变成「配置模型」,注册分支也显示同一句,用户无法把等待和刚才按下的动作对应起来。
2. `AccountSignedInPanel.tsx:212` — `SettingRow label={status.username} hint="当前账号"`:label/值语义颠倒。行组件的 label 位应放字段名「当前账号」,值才是用户名(参照同卡 217-227 行「账号服务器」的正确用法)。
3. `AccountSignedInPanel.tsx:148-168` — 「账号内置模型」整卡只承载两行静态只读文本(生图/Agent 模型名),独立成卡密度过低;模型名由 Musefold 固定,属于概览级事实,却占据了与「数据与同步」同级的卡片地位。
4. `AccountSignedInPanel.tsx:134-141` — `token-invalid` 态按钮文案「重新登录」,实际动作是 `logout()`。点击后回到登录表单(用户名已预填)确实构成重登路径,但按钮承诺与首步动作不符。
5. `AccountCloudSyncPanel.tsx:41`、`DoubaoSection.tsx:203` — `SettingsSwitch` 的 `aria-label` 随状态翻转(「启用提示词云同步」/「关闭提示词云同步」)。屏幕阅读器听到的是「点击后的效果」而非稳定控件名;开关语义应是「提示词云同步,开/关」。
6. `DoubaoSection.tsx:174-181` — `QrCode` 图标被用作登录状态指示(「扫码会话可用」旁边仍是二维码图标)。已登录态显示二维码图标,误导用户「需要扫码」;状态指示应使用语义状态图标或与概览一致的圆点。
7. `AccountSignedOutForm.tsx:131` — 「忘记密码?联系管理员重置。」面向个人创作者的产品出现「管理员」角色,文案世界观错位。
8. `AccountSignedOutForm.tsx:154` — 折叠入口「使用其他账号服务器」非动词短语,与同文件「收起服务器设置」(动词短语)句式不统一。
9. `DoubaoSection.tsx:218-220` — 卡片外常驻一段 4 行长的 11px 灰色尾注(登录与验证机制说明),低频解释性内容未做渐进披露,且与卡内 `SettingRow` hint 已有的说明(172、185 行)部分重复。
10. `AccountSignedInPanel.tsx:199` — `text-[11.5px]`:奇数半像素字号,token 体系外任意值;同文件还有大量 `text-[11px]`(如 116、213、239 行)与 `--text-meta: 11px`(`packages/ui/src/tokens.css:54`)并存。DESIGN.md 规定 app labels 12-14px,当前账号页大量正文型信息跑在 11px,低于规范下限。
11. `DoubaoSection.tsx:253` — 使用弯引号 `"刷新二维码"`,全页其他处用直角引号「」(214 行等),标点风格不统一。
12. `AccountSection.tsx:99-175` — 约 80 行云同步状态加载/操作逻辑内联在容器组件里,`AccountSection` 同时负责认证表单、公告已读持久化、服务器地址编辑、云同步四件事;`AccountSignedOutForm` 以 19 个 props 传入(31-51 行),props drilling 偏重。
13. `AccountSection.tsx:191` — 注册态两次密码不一致时 `submitAuth` 静默 `return`,无任何反馈。正常路径被按钮 disabled(`AccountSignedOutForm.tsx:125`)拦截,但表单 Enter 提交等边缘路径仍可能到达此分支且无声失败。
14. `AccountSection.tsx:93` — 用 `document.getElementById("account-username")?.focus()` 直接操作 DOM,绕过 React 引用;且该 effect 依赖 `accountSetupRequest`,`requestAnimationFrame` 内 consume,StrictMode 双执行下依赖 consume 的幂等性。
15. `account-section-ui.tsx:36` — `InlineMessage` 用 `mt-3 border-l pl-3` 竖线样式,与 `DoubaoSection.tsx:211-216` 的圆角淡底 banner 是两套并存的告警视觉,同页混用(见截图观察第 4 条)。
16. `packages/product-ui/src/settings/SettingsComponents.tsx:124-152` — `SettingsSegmentedControl` 声明 `role="radiogroup"/"radio"` 但选项是普通 button、仅支持点击,无方向键导航,radiogroup 语义与键盘行为不符(共享组件通用问题,账号页是主要使用方)。

## 改进建议

### P0(影响层级语言与基础正确性)

1. **统一卡片体系与内容栏宽** —「涉及共享包」。目标:`packages/product-ui/src/account/AccountScreen.tsx`、`packages/product-ui/src/styles.css`、`AccountSignedOutForm.tsx:56`。做法:
   - 给 `AccountScreen` 增加设置页 variant(或在 settings 上下文加 `.mf-settings-pane .mf-account-surface` 覆写),让 `mf-account-surface` 与 `mf-settings-card` 共用同一几何(border、radius、shadow-sm、header padding),消除同页两套卡片;
   - 收敛宽度:去掉 `AccountScreen` 的 680px 硬限宽,宽度统一由外层 section 控制(880px);未登录表单卡 `max-w-[520px]` 保留居中,但豆包卡同样限宽对齐(给 `DoubaoSection` 卡加同款 `max-w` 或由 SectionShell 统一约束),消灭 520/680/880 三宽并存。
2. **修正 busy 按钮动词** — `AccountSignedOutForm.tsx:128`:按 mode 分开,`登录中…` / `注册中…`;「正在配置模型」如需保留信息,移到登录成功后的 toast/InlineMessage,不要占用按钮文案。
3. **修正 SettingRow 语义颠倒** — `AccountSignedInPanel.tsx:212`:`label="当前账号"`,值放 `status.username`;令牌后缀一行维持现状即可。

### P1(信息架构与可访问性)

4. **「账号内置模型」并入账户概览** — `AccountSignedInPanel.tsx:148-168` + `packages/product-ui/src/account/AccountSummaryPanel.tsx:47-68`「涉及共享包」。做法:在 `AccountSummaryViewModel` 增加 `imageModel`/`agentModel`(或 `facts` 扩展位),概览 dl 由 3 列增到 5 项(或 3+2 两行),删掉整张独立卡——静态事实归概览,页面少一张卡、少一次「标题-描述-两行」的仪式性开销。这同时消掉 680px 内又一张卡的密度问题。
5. **开关 aria-label 固定为控件名** — `AccountCloudSyncPanel.tsx:41`、`DoubaoSection.tsx:203`:`aria-label` 恒为「提示词云同步」「豆包前台」,动作性描述(「启用/关闭…」)交给可见文案或 `aria-describedby`;调用侧即可修,不必动 `SettingsSwitch` 组件本身。
6. **登录状态指示换语义图标** — `DoubaoSection.tsx:174-181`:logged-in 用圆点/`ShieldCheck`,logged-out/待扫码才用 `QrCode`;让图标随状态而非随功能恒定。
7. **「忘记密码」文案改写** — `AccountSignedOutForm.tsx:131`:改为真实可行的指引(如「忘记密码?可通过注册邮箱自助重置」或删除该行——当前产品若无自助通道,宁可不承诺)。
8. **豆包尾注收敛** — `DoubaoSection.tsx:218-220`:压缩为单行 meta(「二维码仅在登录窗口短暂显示,不写入数据与日志」),其余细节收进 `SettingRow` hint 或帮助链接;同时删除与卡内 hint 重复的句子。
9. **告警样式统一** — `DoubaoSection.tsx:211-216` 改用 `InlineMessage tone="warning"`(本页已有组件);若确需淡底 banner,则在 `account-section-ui.tsx` 给 `InlineMessage` 增加 soft 变体并对深色主题用实底 token(如 `--warning-soft`)替代 `/5` 透明度,保证深浅两主题同等强度「涉及共享包」(可选)。
10. **「重新登录」按钮动作诚实化** — `AccountSignedInPanel.tsx:134-141`:文案改「退出并重新登录」,或点击后直接进入登录表单(现已有用户名预填,`AccountSection.tsx:78-81`)并在表单卡顶部保留失效原因 InlineMessage。

### P2(细节打磨)

11. **字号收敛进 token** — `AccountSignedInPanel.tsx:199`(`text-[11.5px]`)及各处 `text-[11px]` 改用 `text-meta`;若 11px 低于可读预期,评估把 `--text-meta` 提到 12px 并对齐 DESIGN.md 的 12px 下限(改 token 需全局回归,先收敛任意值即可)。
12. **折叠入口动词化** — `AccountSignedOutForm.tsx:154`:「使用其他账号服务器」→「指定账号服务器」;收起态沿用动词。同时决定 186 行常驻地址行的去留:要么收进折叠区(彻底收纳),要么改 label「当前服务器」使其明确是状态展示。
13. **标点统一** — `DoubaoSection.tsx:253` 弯引号改「」,与全页一致。
14. **云同步逻辑提 hook** — `AccountSection.tsx:99-175` 提取 `useCloudSync(loggedIn)` 自定义 hook(就近 `__tests__`),`AccountSignedOutForm` 的 19 个 props 收敛为 `form` 对象 + 少量 handler;`AccountSection` 回到纯编排。
15. **边缘反馈补齐** — `AccountSection.tsx:191`:密码不一致时先 `setError`/显示 InlineMessage 再 return;`AccountSignedOutForm.tsx:110-116` 确认密码提示加 `aria-describedby` 关联。
16. **服务器「保存」按钮具体化** — `AccountSignedOutForm.tsx:182`:「保存」→「保存服务器地址」(低频表单里按钮自包含更稳)。
17. **分段控件键盘语义**(可延后)— `packages/product-ui/src/settings/SettingsComponents.tsx:124-152`「涉及共享包」:补方向键切换或改 `toolbar` 语义;属共享组件通用改造,建议单独立项不混入账号页。

## 保持不动(现状是对的)

1. **服务器设置折叠入口**(`AccountSignedOutForm.tsx:140-187`)与**退出登录两步内联确认**(`AccountSignedInPanel.tsx:228-260`):低频/危险操作渐进披露 + danger 变体确认按钮,正是 Codex「一次性确认」黄金模式的桌面化,方向完全正确。
2. **云同步冲突行内解决按钮**(「保留云端/保留本地/另存本地副本」,`AccountCloudSyncPanel.tsx:103-130`):完整动词短语、逐条就地处理,符合审批交互基准;`cloudSyncLabel` 的状态机文案(`account-section-helpers.ts:31-46`)覆盖全状态且克制。
3. **`settings-facts` 的 1px hairline 格子**(`apps/desktop/src/styles/settings.css:439-454`):格线用背景色当分隔线的画法,明暗两主题自洽,无需动。
4. **表单语义细节**:`autoComplete` 的 username/current-password/new-password 正确区分(`AccountSignedOutForm.tsx:79/92/109`);确认密码即时 `aria-invalid` + 文字提示;`InlineMessage` 的 `role="alert"/"status"` 分级(`account-section-ui.tsx:34`);`Field` 的 label/htmlFor 关联。这些是表单 a11y 的正确基线。
5. **二维码白底与登录弹窗**(`DoubaoSection.tsx:228-289`):白底功能必要;弹窗内 loading/scanned/verification 各态文案完备,刷新二维码按钮动词化——保持。
6. **未登录预填 lastUsername**(`AccountSection.tsx:78-81`)与公告已读 localStorage 记忆 + 最多 5 条上限(`AccountSection.tsx:64-70/176-186`):小而正确的体验细节。
7. **官方账号与豆包备用通道同页、主次明确**(`AccountSettingsSection.tsx`):SectionShell 描述已表达优先级,已登录官方账号时豆包卡内还有降级提示(`DoubaoSection.tsx:157-161`)——分层结构本身不要动,要动的只是上文的宽度与文案密度。
8. **红线全部合规**:8 文件最大 301 行;图标全部经统一入口;无 emoji;无版本号/依赖方向改动。
