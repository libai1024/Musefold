# 开放能力页 review

> 对象:设置「开放能力」页(`OpenCapabilitiesSection` → `AutomationSection` + `ConnectedAppsSection`)。
> 基准:`docs/research/codex-tui-ui-research.md`(克制、按使用时机分层、渐进披露)+ `DESIGN.md`(Graphite/Porcelain/Ember)。
> **本报告仅基于代码分析**:当前评审模型无法读取截图图像内容,`/tmp/musefold-settings-review/baseline/04-open-dark.png` 未能核验像素层;涉及视觉表现的结论均由代码与 CSS 推导,明暗一致性仅能确认 token 层面。

## 截图观察

(图像不可读,本节以代码推导的页面实际渲染结构代替,供对照截图核验。)

页面自上而下五个块,总滚动长度为设置中心之最:

1. **本地控制面卡**(`SettingsCard`):开关行(hint 显示 `运行中 · 127.0.0.1:port · API v1`)、token 行(遮蔽 code + 显示/复制/轮换三按钮)、预算行(数字输入 + 保存)。
2. **「在 Agent 里使用 Musefold」指引**(裸 div,不在卡内):引言两段 + 连续 hairline 列表容器,内含 5 个条目——Cursor(一键添加 primary 按钮 + 复制 JSON)、Codex/ChatGPT 桌面版(复制 TOML)、Claude Code(一键注册/未检测到命令)、Musefold 自动化 Skill(**最重条目**:状态摘要 + 已检查时间 + 安装/检查/打开/复制 4 按钮 + 自动更新开关 + 错误行 + URL + 三端版本明细 + 兼容性说明)、命令行工具(安装/修复/移除)。
3. **最近调用**(裸 div + 列表):20 条审计行,点击行展开完整 promptText。
4. **已连接应用**(`ConnectedAppsScreen`,product-ui 共享):每连接一张卡——scope chips(可点收窄/扩大)、生图模式分段控件、两个预算输入、暂停/撤销。
5. 空态时 Cloud MCP 部分显示登录引导或「复制服务器地址」。

关键事实:**Cursor/CLI snippet 在当前代码中从不内联渲染**——只有复制按钮(`AutomationSection.tsx:290/312/349`),复制的是剪贴板内容,页面上看不到片段本体。若截图显示有大段内联代码块,则截图来自旧版本。这比「默认折叠」更极端:用户复制前无法预览内容。

## 代码问题(file:line)

文件:`apps/desktop/src/features/settings/components/AutomationSection.tsx`(下称 A)、`ConnectedAppsSection.tsx`(下称 C)、product-ui `account/ConnectedAppsScreen.tsx`(下称 S)。

**尺寸与结构**

- A:1 全文件 580 行,距 600 硬门禁 20 行;`file-size-ratchet` baseline 只减不增,此文件已无任何承接新功能的余量。单组件 11 个 `useState`(A:47-57)、四条数据流(status/audit/budget/integration)混在一个函数组件里。
- A:245-516 「接入向导」约 270 行、A:357-467 Skill 单条目约 110 行,是最自然的两刀切点。
- A:247 / A:520 「在 Agent 里使用 Musefold」「最近调用」用 `<p>` 充当区块标题,页面无 heading 层级;而 S:211-216 `showHeading` 默认 `true` 渲染 `<h1>已配置应用`,C 未传 `showHeading={false}`——设置子页内出现 h1,与页级标题冲突(`settings.css:484` 的 `.settings-connected-apps` 覆写只改了宽度与 padding,未隐藏 header)。

**异步与错误处理(违反 DESIGN.md「每个 async 动作要有 loading/success/empty/recoverable error/disabled 五态」)**

- A:70-82 `refresh()`:`Promise.all` 四个 IPC 调用无 try/catch,任一 reject 即 unhandled rejection;初始加载无 loading 指示(仅表现为控件禁用),无 error 展示与重试路径。
- A:84-91 `copySnippet`、A:131-136 `copyToken`:裸 `navigator.clipboard.writeText` 无 try/catch;同页 S:195-204 `copyServerUrl` 却有完整失败处理与文案——一页两种标准。
- A:87-90 / A:135 `window.setTimeout` 无 cleanup,unmount 后仍 setState。
- A:226 预算保存仅拦 `Number.isNaN`:`Number('') === 0`,清空输入直接保存会把月预算误写成 0(0 = 逐次确认,语义变化用户未必察觉);负数仅靠 input 的 `min` 属性,手输 `-5` 可通过 `Number()` 校验直达 IPC。

**token 遮蔽与密钥交互**

- A:20-23 `maskToken`:遮蔽态显示**前 10 + 后 4** 字符,比业界惯例(GitHub 风格前 4/后 4)慷慨;且 `token.length <= 14` 分支**完全不遮蔽直接返回原文**——短 token 在「隐藏」态全量可见。
- 正向确认:token 只经剪贴板与 `title`(A:169,仅 revealed 态)呈现,不进日志/SQLite/导出;轮换后自动 `setRevealed(true)`(A:125)是合理引导。红线合规。

**审计列表(对照 Codex ExecCell「输出上限 5 行、中间截断保头尾」)**

- A:535-573 审计行是 `<button>` 内嵌 `<div>`/`<p>`(A:543、A:568)——button 内容模型为 phrasing content,HTML 不合法,a11y 树异常;且无 `aria-expanded`,屏幕阅读器不知道行可展开。
- A:556 `promptText.slice(0, 60)` 只保头不保尾,长 prompt 的关键目标词常在尾部。
- A:565 `toLocaleTimeString` 无日期分量,昨天及更早的记录显示成「像是今天的时间」。
- 审计数字列(A:559 积分)与预算 hint 无 `tabular-nums`,违反 DESIGN「quota 与进度用 tabular figures」。

**Skill 条目密度(全页最重)**

- A:357-467 单条目塞了 7 层信息:状态摘要、`已检查 ${完整 toLocaleString}`(A:364,时间戳全量输出噪音大)、4 个动作按钮(其中 2 个是 icon-only)、自动更新开关、checkError、URL、三端版本明细、兼容性说明。「已检查」绝对时间与 S:90-102 已有的 `relativeTime`(「3 分钟前」)是同一页两套时间格式标准。
- A:402-409 两个 icon-only `IconButton` 有 label(合规),但该条目同时有 4 个可点目标 + 1 开关,是误触与认知负担峰值。

**集成指引的分层(对照 Codex「按使用时机分层」)**

- 已注册客户端有「已配置」徽标(A:273/303/328),但条目形态与未配置完全同权重——一次性 setup 内容在配置完成后不降权、不折叠,回访用户每次都要滚过约 270 行指引才能到达「最近调用」和「已连接应用」这两个高频回看区。
- snippet copy-only(A:290/312/349):渐进披露方向正确,但缺少「复制的是什么」的预览出口——不是要默认展开,是要给一个折叠的展开态。

**其他**

- A:55 单一 `busy` 标志横跨三张卡:保存预算会同时禁用 token 轮换和 Skill 检查,粗粒度联动。
- 字号碎片化:11px / 11.5px / 12px / 12.5px / `text-meta`(= `--text-meta`)五档混用(A:167/212/247/520/527 等);DESIGN 规定 app label 12-14px,11px 低于下限,半号档位并发是排版漂移信号。
- S:263 scope chip 的「需密码确认」提示只在 `title` 属性里,依赖 hover——该组件为双端共享,Web 手机端无 hover,违反 DESIGN「mobile layouts never require hover」(涉及共享包)。
- 明暗一致性:settings.css 相关规则全部走语义 token(`--bg-elevated`/`--border-subtle`/`--danger` 等),无硬编码色、无暗色特判,token 层面双主题自洽(像素层无法核验,见开头声明)。
- 红线核查:图标全部经 `components/ui/icons` 与 `@musefold/ui/icons` 入口(A:4、S:1-11),无直接 lucide-react;全文无 emoji;580 < 600 当前合规;测试存在(`settings/__tests__/automation-section.test.ts` + e2e `test_32_integration_guide.py`)。

## 改进建议

### P0(红线贴线与错误处理,先做)

1. **拆分 AutomationSection.tsx**(580 行 → 4 个文件,纯搬移不改行为,现有测试应保持绿):
   - `LocalControlCard.tsx`:A:140-243 卡片 + `toggle`/`rotate`/`copyToken`/`maskToken` 及相关 state;
   - `IntegrationGuide.tsx`:A:245-516(接收 `integration`/`busy` props 或自取),内部再拆 `SkillManagementBlock.tsx`(A:357-467);
   - `AutomationAuditList.tsx`:A:518-577 + `AUDIT_*` 三个映射表(A:25-44);
   - 主文件回落到 <80 行,距 600 门禁恢复安全距离。目标文件均在 `apps/desktop/src/features/settings/components/`。
2. **refresh() 补齐五态**:A:70-82 包 try/catch,新增 `loadError` state,顶部渲染可恢复错误 + 重试按钮(复用 S 的 `role="alert"` 模式);status 为 null 时给 `role="status"` 的读取中提示,而非仅控件禁用。
3. **剪贴板统一**:抽 `useCopyWithFeedback(key)` hook(try/catch + 失败文案 + timeout cleanup),替换 A:84-91、A:131-136,并供 S:195-204 复用(hook 放 product-ui,**涉及共享包**)。

### P1(信息架构与渐进披露,对照 Codex 报告)

4. **按使用时机给集成指引分层**:已 `registered` 的客户端条目折叠为一行「已配置 ✓ · 重新添加」(Codex:已产出内容是历史,降低视觉权重);Skill 条目的三端版本明细(A:448-462)与兼容性说明(A:464-466)收进「详情」展开区;全部客户端已配置时指引整体可折叠为单行摘要。目标:`IntegrationGuide.tsx`(拆分后)。
5. **snippet 折叠预览**:每个「复制 X」旁加 chevron「预览」,默认收起,展开渲染只读 `<pre>`(等宽 + `bg-inset`,与 token 展示同一视觉语言);保持在「默认不可见、按需展开、复制仍是主路径」。目标:`IntegrationGuide.tsx`。
6. **token 遮蔽收紧**:`maskToken` 改为前 4-6 + `…` + 后 4,删除 `length <= 14` 全显分支;完整值仅经「显示」按钮获得(现交互已正确)。目标:`LocalControlCard.tsx`。
7. **审计行语义化**:外层改 `div[role="button"]`(或 button 内全部改 span + CSS block)修 HTML 合法性;加 `aria-expanded`;`slice(0,60)` 改「保头 N + … + 保尾 M」;时间跨天显示 `MM-dd HH:mm` 或相对化;数字列与预算加 `font-variant-numeric: tabular-nums`。目标:`AutomationAuditList.tsx` + `settings.css`。
8. **heading 结构**:接入指引与「最近调用」改 `h3`;`ConnectedAppsSection.tsx` 传 `showHeading={false}`,在设置页内自绘同级 `h3` 标题,消除页内 h1。目标:A(拆分后各文件)、C:32。

### P2(打磨)

9. **预算输入校验**:空串禁用保存或失焦回退当前值;保存前 `Math.max(0, ...)` clamp。目标:`LocalControlCard.tsx`。
10. **busy 分域**:`busyAction: 'toggle' | 'rotate' | 'budget' | 'integration'` 判等禁用,只锁相关控件。目标:A 各子组件。
11. **相对时间统一**:S:90-102 `relativeTime` 下沉到共享 util,Skill `checkedAt`(A:364)复用「3 分钟前」(**涉及共享包**)。
12. **字号归一**:11/11.5/12/12.5 收敛为 `text-meta` 与 12px 两档;11px 只用于 meta 辅助信息,可交互 label ≥12px。目标:A 全文件 + `settings.css`。
13. **scope chip 无 hover 提示**:「扩大能力需密码确认」从 `title` 挪进展开态内联文案或 chip 下方说明(**涉及共享包** S:263)。

## 保持不动

- **snippet copy-only 不回退**:不要改成默认展开的内联大代码块,方向正确,只按 P1-5 补折叠预览。
- **审计列表的连续 hairline 表面**(`settings.css:291` 有意设计)与 20 条上限、点击行展开的交互模型——这正是 Codex 式「常驻单行、详情按需」。
- **S 的审批类交互**:reauth Dialog(提权需密码)、撤销两步内联确认、`BudgetInput` onBlur 提交——是 Codex 审批黄金模式的 GUI 对应物,质量高于本页其余部分。
- **空态三态文案**(C:25-29 按登录态/自定义服务器分流)——按使用时机分层的正面样本。
- **SettingsSwitch 的 aria-label + title 双通道**(product-ui `SettingsComponents.tsx:165-185`)。
- **token 不落日志/SQLite/导出、图标经统一入口、无 emoji**——红线全合规处不动。
- **轮换后自动 revealed**(A:125)——新 token 立即可见可复制,是合理动线。
