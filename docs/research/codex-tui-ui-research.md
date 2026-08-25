# Codex TUI(openai/codex)界面源码调研报告

> 调研对象:openai/codex 仓库 main 分支快照(2026-08 浅克隆),核心代码位于 `codex-rs/tui/`(Rust + ratatui + crossterm)。
> 调研目的:为 Musefold 下一阶段 UI 改造提供参考。Codex 是终端聊天式 Agent 产品,与 Musefold 的「会话式生图 / 方案运行时」界面在交互形态上高度同构(消息流 + 输入区 + 审批 + 模型/参数设置),其设计决策可直接映射到 Electron + React 桌面端。
> 注:Codex 没有独立的设计规范文档,其规范内嵌在源码注释与常量命名中;本报告引用的文件路径均相对 `codex-rs/tui/src/`。

---

## 1. 总体架构:它解决了什么 UI 问题

Codex TUI 面对的核心矛盾与任何「流式 AI 会话 UI」相同:

- 内容持续流入(流式 token、工具事件),UI 必须高频更新;
- 已产出的内容是历史,不应因新内容而抖动、重排、重渲染;
- 用户随时可能打字、按快捷键、resize 窗口,输入不能被流式输出干扰;
- AI 输出不可信(畸形 markdown、超长输出、巨型粘贴),渲染层必须防御。

它的答案是四条架构主线,均可搬移到 React 桌面端:

### 1.1 「已提交历史 vs 活动区域」物理分层

终端被分成两层(`insert_history.rs` + `chatwidget/rendering.rs`):

- **已提交历史**:渲染成行后写进终端 scrollback,从此不可变、不再参与任何重绘;
- **活动区域**:一个高度可变的 viewport,每帧全量重绘,只包含——正在流式输出的 tail cell、状态指示行、输入框(composer)、弹窗。

React 映射:**历史消息列表用 memoized 虚拟列表,提交即冻结;流式 tail 是独立组件,单独高频更新。**不要让每条历史消息参与每帧 reconciliation。Musefold 的 `SchemeRunConversation` / `SkillRuntimeConversation` 可直接采用此分层。

### 1.2 事件总线解耦

- 所有 widget 不直接持有 App,只发语义事件(`AppEvent::InsertHistoryCell`、`OpenAgentPicker`、`Exit`…,`app_event.rs` 一个上百变体的大枚举);
- `AppEventSender` 是 `UnboundedSender` 薄封装,任何后台任务/组件都能克隆持有;
- App 层主循环 `tokio::select!` 统一消费:内部事件、服务器事件、终端输入三路汇合(`app/startup.rs:686`)。

React 映射:聊天组件不直接调 store/IPC,发语义 action,由主 Store 统一处理。Musefold 已有 Zustand + page-controllers 编排层,可把「会话内事件」收敛为显式 action 枚举,尤其利好 automation / 多方案并行场景。

### 1.3 按需重绘 + 全局帧合并

- 没有固定 tick 循环;组件通过 `FrameRequester::schedule_frame()` / `schedule_frame_in(dur)` 预约重绘;
- 请求进 mpsc,由 `FrameScheduler` 合并(coalesce)成单次绘制,`FrameRateLimiter` 上限 120fps;
- 动画组件在 render 时「顺便预约下一帧」(`status_indicator_widget.rs:238` 里 `schedule_frame_in(32ms)`),自续动画,无中央调度器。

React 映射:loading 动画/shimmer 用 rAF 自续 + 全局 scheduler 合并,不要每个动画组件各开 `setInterval`。

### 1.4 流式渲染四段流水线(`streaming/`)

1. **换行门控收集**(`markdown_stream.rs`):只攒原始 markdown 源码,只提交到最后一个 `\n` 为止——**未完成的行永不渲染**,避免半个表格/代码围栏闪现畸形;
2. **stable/tail 两区模型**:已提交部分进 stable 队列,可变尾巴留在 tail;表格有额外 holdback,整张表未完成前不进 stable(`table_holdback.rs`);
3. **自适应两档流控**(`chunking.rs`):`Smooth` 档逐行打字机;队列积压超阈值切 `CatchUp` 一次排空;带迟滞窗口防档位抖动;
4. **完成后 consolidation**:流结束时把一串增量 cell 替换成一个「源码-backed」的规范 cell——resize/换字体时永远从原始 markdown 重排,而不是修补已折行的中间产物。

React 映射:流式 markdown 只在块边界(段落/表格/代码围栏闭合)后插入 DOM;未闭合块留在 tail 缓冲。流式中间态用轻量渲染,落地时交给完整管线(语法高亮、表格)。这比固定 throttle 更贴体验。

---

## 2. 主界面信息架构

### 2.1 消息流:HistoryCell 体系

核心抽象 `trait HistoryCell`(`history_cell/mod.rs:184`),一段会话 = 一个 cell 序列,每个 cell 自报:

| 方法 | 用途 |
|---|---|
| `display_lines(width)` | 主视口富文本呈现 |
| `raw_lines()` | 复制友好的纯文本 |
| `transcript_lines(width)` | 全屏 transcript 视图的呈现(**可与主视口不同**) |
| `desired_height(width)` | 高度度量(布局用) |
| `is_stream_continuation()` | 是否接上文(影响间距) |

主要 cell 类型与呈现规则:

- **用户消息**:首行 `› `(粗体 dim)前缀,续行两空格缩进;整体背景 = 终端背景 ±4%/12% 亮度偏移(亮底 +4% 黑、暗底 +12% 白,`style.rs::user_message_style`)——**与任何主题都自洽的派生色,不是固定色板条目**。@提及 cyan 高亮;图片显示 `[Image #N]` 占位;输入经 `sanitize_user_text` 剥离控制字符防注入。
- **AI 消息**:首行 `• ` dim 前缀;存原始 markdown 源码(resize reflow 的事实源)。
- **命令执行(ExecCell)**:三种显示模式——单命令 / exploring 组(read/list/search 聚合)/ compact 组(完成后折叠成一行 "Ran N commands · ctrl+t 看全")。单命令布局:`• Running/Ran` 标题(进行中旋转点、完成绿 •、失败红 •)+ 命令 + `  │ ` 前缀续行 + `  └ ` 前缀输出块;**输出上限 5 行,中间截断保头尾**,省略处 `… +N lines (ctrl+t to view)`;transcript 视图才完整展开。
- **diff(PatchHistoryCell)**:GitHub 风格配色,亮暗双主题调色板,行号 gutter + 语法高亮。
- **回合分隔线**(`separators.rs`):**只有「干了活」的回合**(执行了工具/命令)才画 `─ Worked for 1m 23s • tok: … ─` 分隔线;纯对话回合不画——装饰元素的存亡由内容价值决定。

层级缩进体系极简:全局只有 **2 列**一个核心缩进单位(`ui_consts.rs::LIVE_PREFIX_COLS`),顶层 gutter 两列(`› `/`• `/`$ `),详情用 `  └ `/`  │ ` 盒线字符表达从属。

### 2.2 底部输入区(ChatComposer)

`bottom_pane/chat_composer.rs`(约 1.3 万行,文件头注释是完整状态机文档)。值得借鉴的交互:

- **大粘贴折叠**:超 1000 字符的粘贴不展开进缓冲区,插入原子占位元素 `[Pasted Content N chars]`,全文存 `pending_pastes`,提交时才展开;**占位符被删则对应粘贴被剔除**。对 Musefold 粘贴长提示词/参考文本直接适用。
- **原子元素**:@提及、图片、粘贴占位都是不可拆分 token,删除时整体删除;斜杠命令名输完整后也「晋升」为原子元素。
- **图片附件**:粘贴内容若像文件路径且读得出图片尺寸 → 自动转附件,显示 `[Image #N]`。
- **弹窗与 footer 互斥**:补全弹窗渲染在 textarea 下方、**占据原本 footer 的区域**;无弹窗时才画 footer。
- **弹窗 dismiss 记忆**:Esc 关掉补全弹窗后,只要当前 token 文本不变就不再弹;编辑 token 才解除。
- **历史导航**:↑/↓ 召回历史(光标置行尾),Ctrl+R 增量搜索模式(footer 变搜索框)。
- **Esc = interrupt**:任务运行时 composer 依然可输入,输入排队,footer 显示 queue 提示。

### 2.3 审批(approval)交互——权限确认 UI 的黄金标准

- 四类审批(Exec / ApplyPatch / Permissions / McpElicitation)统一为 `ApprovalRequest` 枚举,**复用通用选择列表组件**(`ListSelectionView`),不是独立控件;
- 选项文案是**完整动词短语**:`Yes, proceed` / `Yes, and don't ask again for commands that start with '…'` / `No, and tell Codex what to do differently`——不是 "Allow/Deny";
- **打字防误触**:审批到达时若用户正在打字,入延迟队列,等打字空闲后再弹出;多个审批 FIFO 排队;
- **Esc 恒等于 Cancel 的硬契约**:即使用户自定义键位,Esc 也被强制从「有副作用的选项」中剥离——**关闭弹窗绝不能静默变成某个决定**。

Musefold 的 `AutomationConfirmCard` 可直接对照此模式改造。

### 2.4 状态指示与 token 用量

- 工作中行(composer 上方一行):`[动画点] Working(12s • esc to interrupt) · [内联消息]`,details 用 `  └ ` 前缀最多 3 行;"Working" 文字是 shimmer 扫光,**扫光颜色从终端前景/背景派生**而非硬编码白;审批弹窗时计时器暂停;
- token 用量三处呈现:footer 右侧常驻 `N% context left`;`/status` 卡片详情;退出时一行摘要。常驻只给一行摘要,详情按需调出。

### 2.5 键盘体系

- 三层模型:`KeyBinding`(单键,跨终端归一化)→ `ShortcutHint`(显示层:`ctrl + c` / `⌥ + x`)→ `RuntimeKeymap`(按上下文分组:`app / chat / composer / editor / pager / list / approval`);
- 解析优先级:用户配置 → 全局回退 → 内置默认;解析期做**冲突校验**并产出带配置路径的报错;
- **防误触双击退出**:Ctrl+C/Ctrl+D 需同键按两次,第一次后 footer 显示 "press again",超时失效,且不同键不互相计数;
- 提示文案统一句式:「键 + 动词短语」,全小写、dim 样式,如 `ctrl + t to view transcript`、`? for shortcuts`。

---

## 3. 设置/配置体系

### 3.1 核心结论:Codex 没有「设置中心」

设置按**使用时机**分散成五种形态:

| 形态 | 用途 | 例子 |
|---|---|---|
| 全屏一次性流程 | first-run 决策 | onboarding(登录/信任目录)、更新提示、模型迁移 |
| 底部弹窗 | 可逆、高频切换 | /model、/theme、/keymap、/permissions、/experimental |
| 历史流内嵌卡片 | 只读信息,需要回看 | /status、/debug-config、/mcp |
| 全屏 pager overlay | 需专注阅读的长内容 | transcript(Ctrl+T)、diff |
| 直改配置文件 | 持久化落点 | 弹窗确认后经 `ConfigEditsBuilder` 最小化改写 config.toml |

形态选择边界:**是否需要稍后回看**(是→卡片,否→弹窗)、**是否 first-run 阻断决策**(是→全屏引导)。

### 3.2 配置分层与「值来自哪一层」

- `ConfigLayerStack` 九层优先级:PackagedDefaults < MDM < System < EnterpriseManaged < User < User+profile < Project < SessionFlags < LegacyManaged;
- 每层带来源、版本指纹、`disabled_reason`(如项目目录未信任时项目层被禁用);
- `origins()` 记录每个字段最终来自哪一层;`/debug-config` 按优先级列出全部层 + 禁用原因,是排障出口;
- 受管约束直接映射为 **UI 置灰 + 原因文案**(`can_set()` 的错误信息即 `disabled_reason`)——不隐藏不可选项,置灰并解释。

**对 Musefold 极有参考价值**:模型定价/参数等设置若存在「官方默认 / 用户覆盖 / 方案级覆盖」多层,每个设置项旁应标注「当前值来自哪一层」。

### 3.3 设置 UI 如何写回配置:最小化保格式编辑

- **不是内存态 + 整体重写**:`toml_edit::DocumentMut` 保注释保格式,应用语义化编辑(`SetPath` / `ClearPath` / `SetModel`…),无实际变更不写盘,原子落盘;
- **运行时生效与持久化拆成两个事件**:模型选择发 `UpdateModel`(立即切)+ `PersistModelSelection`(异步写盘);写盘失败仅提示,不回滚运行时状态;
- **写目标随激活层切换**:激活 profile 时写到 profile 文件而非基础文件;
- 实验特性开关用「恢复默认即删键」策略,保持配置文件干净。

Musefold 映射:设置写入 SQLite 时应按字段 update 而非整行 replace;区分 session 级与持久级;异步落盘失败明确提示。

### 3.4 模型选择器:分级防误选

两级(实为三级)结构(`chatwidget/model_popups.rs`):

1. 第一级只列 auto 模式(fast/balanced/thorough)+ 末尾 "All models" 入口——**简单路径不被模型海淹没**;
2. 全量层选模型后进入第二级选 reasoning effort(每档带描述,默认档标 "(default)");
3. **昂贵档位(Max/Ultra)隔离到第三级 "More reasoning…"** 并带 ⚠ 用量警告,防止方向键误选;
4. 条目带 `is_current`(打勾)、`is_default`、`disabled_reason`(置灰 + 原因);子级接受后父级弹窗联动关闭。

Musefold 的 model-hub / 生图模型选择可照搬:「常用层 + 全量层 + 高级参数层」三级,高成本选项隔离 + 确认。

### 3.5 实时预览三件套(theme picker 模式)

外观类设置的黄金模式(`theme_picker.rs`):

1. **打开时快照**原值;
2. **`on_selection_changed` 即时应用**到真实内容(列表背后的聊天区立刻变色)+ 专用预览样例(宽屏侧栏半宽、窄屏降级为列表下方紧凑预览,断点显式);
3. **Esc 恢复快照,Enter 才持久化**;写盘失败回滚运行时并提示。

### 3.6 /status 卡片

- 滚入聊天历史的 dim 圆角边框卡片(内宽上限 56 列),分节:版本/链接 → 账户 → 会话键值(Model 带细节、Directory、Permissions 合成一句人话)→ 用量(token、context window、**rate-limit 进度条**);
- 键值对用 `FieldFormatter` 统一对齐(label 取最大宽度、dim,续行对齐 value 列);
- **卡片是活的**:插入时是 refreshing 态,后台数据到达后原地更新已滚动的卡片;过期数据加 "may be stale" 警告——等价于 GUI 里「打开期间响应外部变更」,Musefold 可用 TanStack Query 失效机制对应实现。

### 3.7 Onboarding 引导

- **步骤状态机 + 已完成步骤堆叠**:每步自描述 `StepState`(Hidden/InProgress/Complete),编排器只路由键盘事件给最后一个 InProgress 步骤;已完成步骤滚在上面成为「已答问卷」,而非逐页替换——比纯 wizard 分页更有掌控感;
- 细节:引导期用固定快捷键表(用户还没配 keymap);文本输入态屏蔽可打印退出键(API key 框里 q 是文本不是退出);步骤切换时丢弃缓冲的 Enter 防误触;显示可复制材料(设备码)时冻结动画。

### 3.8 斜杠命令:单一事实源注册表

- `SlashCommand` 大枚举(strum 派生),每个命令自带:描述、是否支持行内参数、任务运行中是否可用、可见性门(平台/debug);
- **枚举顺序即展示顺序**(注释明令禁止按字母排序,高频在前);
- 弹窗过滤与执行分发**共用同一份 gating 函数**——「能看到的就能执行」。

Musefold 的 `CommandPalette` 应对照此模式:命令注册表单一事实源 + 显式编排顺序 + 上下文可用性门。

### 3.9 弹窗栈协议

- `BottomPane.view_stack: Vec<Box<dyn BottomPaneView>>`,**只有栈顶接收输入和渲染**;composer 永远在栈底之下,弹窗关闭后输入状态不丢;
- 子视图 Accepted 时可联动弹掉标了 `dismiss_after_child_accept` 的父视图(模型→参数两级选择后一起关);Cancelled 不连累父级;
- 支持**原地替换**(编辑完 keymap 回到列表并定位到刚编辑的行,不无限压栈);
- 通用 `ListSelectionView` 一个容器承载十余种弹窗:标题/副标题/footer hint、tabs、搜索过滤(开搜索后可打印字符进查询框、j/k 导航自动失效)、数字键直选、侧栏预览、disabled 项(跳过导航 + 原因)。

### 3.10 一次性确认弹窗协议

信任目录 / 更新 / 模型迁移共用同一模式:

- 选项 ≤ 4 个(超过就该换形态);
- **数字键直选** + 循环导航 + Esc = 安全默认项 + **默认焦点在推荐项**;
- 进入前丢弃缓冲输入,防启动期敲的 Enter 误触第一项;
- 选项带「记住此选择」变体("Always use..." 直接写配置,对应「不再提醒」持久化 dismiss)。

---

## 4. 视觉语言

### 4.1 语义色是函数,不是色板

- 唯一状态枚举 `StatusTone { Success, Attention, Failure }`,`status_style(tone, 背景亮度, 色彩能力)` 三输入决定输出:Success=绿、Failure=红、Attention=黄(**亮底下主动降级为默认前景色**,黄色在亮底可读性差);色彩能力不可探测时一律无彩色——**宁可没颜色也不输出可能不可读的颜色**;
- 强调/选中色:暗底 cyan,亮底换深色青 `(0, 95, 135)`;
- **派生色优于新增色**:用户气泡 = 背景 ±4%/12% 亮度混合;表格分隔线 = 前景向背景混 20%("存在感弱但不消失");shimmer 高亮 = 前景向背景混合而非白色。

CSS 映射:`color-mix(in srgb, var(--bg) 96%, black)` 派生气泡色/hairline 色,任意主题下自洽,色板条目极少。

### 4.2 排版

- 全局 2 列缩进单位;`› ` 用户 / `• ` agent / `  └ ` 详情三级前缀;
- 卡片 `╭╮╰╯` 全 dim,内容两侧 1 空格 padding;
- 同级多 hint 用 ` · `(dim 中点)分隔,状态内部用 ` • `;
- 键帽无特殊视觉,统一 `ctrl + t` 全小写格式 + dim + 动词短语句式;
- markdown 映射:H1 bold+underline、H2 bold、H3 bold+italic、行内 code cyan、link cyan+underline、blockquote green;**标题保留 `#` 原文不放大字号**(终端约束,但「不依赖字号表达层级」对信息密度高的 GUI 同样成立);
- 表格列分三类:Narrative / TokenHeavy(路径 URL,优先让出宽度)/ Compact(计数状态,最后折行);放不下时**转置成 key/value**——对窄面板里的数据展示直接可用。

### 4.3 动画

- shimmer 扫光:余弦窗逐字符亮度,2s 周期,30fps 自续帧;颜色从环境派生;
- 活动点:TrueColor 下是扫光的 `•`,否则 600ms 闪烁;**没有 braille spinner**;
- **动效收敛于单一闸门** `motion.rs`:所有动画必须走 `MotionMode::{Animated, Reduced}` 分支,Reduced 是一等公民(静态 `•` / 纯文本),配置项 `animations_enabled`——GUI 对应 `prefers-reduced-motion` 的集中式 MotionProvider,禁止组件各自 import 动画库;
- ASCII 大动画仅用于 onboarding 欢迎页,视口不足时整体跳过。

### 4.4 信息密度与降级

- **宽度降级用优先级栈而非断点**:footer 注释里显式写死丢弃顺序——先丢右侧 context、再把 "tab to queue message" 缩成 "tab to queue"、再丢 "? for shortcuts"、最后只剩 mode("these rules were built out of trial and error")。GUI 工具栏/页头拥挤时也应有显式丢弃优先级列表,而不是每个组件各自 `@media`;
- 常驻信息只给单行;详情全部按需调出(Ctrl+T transcript、`?` 快捷键表、/status 卡片);
- **窄视口是受支持的画法,不是异常**:`usable_content_width -> Option`,`None` 是定义良好的 "prefix-only fallback" 渲染;
- 错误 `■ msg` 整行红;警告 `⚠ ` 黄;信息 `• ` dim + hint 更暗。

### 4.5 针对 LLM 输出的防御性适配层

- LLM 常把表格包进 ```` ```md ```` 围栏——渲染前保守「拆围栏」;
- 用户输入剥离控制字符防注入;
- 表格放不下转 key/value;URL 永不折断(保可点击)。

**任何渲染 AI 生成内容的 UI 都该在渲染管线前留一层「保守纠正」,而不是假设输入是规范 markdown。**

---

## 5. 对 Musefold 下一阶段 UI 改造的落地建议

按「直接照搬 / 映射改造 / 理念参考」三档,结合现有代码结构:

### P0 — 直接照搬(交互模式成熟、与 Musefold 场景一一对应)

1. **会话视图双层冻结**:`SchemeRunConversation` / `SkillRuntimeConversation` 的历史消息 memo 化冻结,流式 tail 独立组件;流式 markdown 只在块边界提交,未闭合块留缓冲(消灭半个表格/代码块闪烁)。
2. **审批/确认卡黄金模式**(`AutomationConfirmCard`):选项文案改完整动词短语;打字中延迟弹出;Esc 恒等于取消的硬契约;多审批 FIFO 排队;选项 ≤4 + 默认焦点在推荐项 + 「记住此选择」变体。
3. **模型选择三级结构**(model-hub):常用层 + "All models" 全量层 + 高级参数层;高成本/高消耗选项隔离 + ⚠ 确认;条目带 当前✓/默认/置灰+原因。
4. **大粘贴折叠**:composer 超阈值粘贴变原子占位 token `[Pasted N chars]`,删占位即剔除内容,提交时展开。
5. **设置写回 = 最小化字段级 patch**:SQLite 按字段 update;运行时生效与持久化分离(先生效、写盘失败仅提示不回滚);设置项旁标注「值来自哪一层」(官方默认/用户覆盖/方案覆盖)。

### P1 — 映射改造(模式适用,需按 GUI 特性调整)

6. **命令面板单一事实源**(`CommandPalette`):命令注册表收敛为一份(描述、上下文可用性门、是否带参数);展示顺序显式编排禁字母排序;过滤与执行共用同一 gating。
7. **实时预览三件套**(主题/外观类设置):打开快照 → 选择即应用(真实内容 + 专用样例双预览)→ Esc 恢复 / Enter 持久化。
8. **通用选择列表容器**:把模型选择、审批、确认、历史选择器等收敛到一个 ListSelection 组件(搜索、tabs、disabled+原因、侧栏预览、数字键/快捷键直选),替代各自手写的弹窗。
9. **状态卡片活更新**:状态/用量类展示采用「键值对齐 + 分节 + 进度条」卡片;打开期间响应数据变更原地更新 + stale 标记(TanStack Query 失效机制天然支持)。
10. **Onboarding 步骤堆叠**:引导流程用「步骤状态机 + 已完成步骤可见堆叠」替代逐页替换 wizard。

### P2 — 理念参考(设计系统层面,对应 `docs/06-ui-design-system.md` 的演进)

11. **语义色函数化**:语义 token = f(角色, 明暗主题, 对比模式);气泡色/hairline/shimmer 色用 `color-mix` 从背景派生;低能力环境显式降级而非一套色值走天下。
12. **动效单一闸门**:集中式 MotionProvider 响应 `prefers-reduced-motion`;动画组件 rAF 自续 + 全局合并,禁散置 `setInterval`。
13. **键盘提示排版系统**:一份 kbd 格式化函数(全小写、`⌘/⌥` 平台差异)、一种 dim 样式、固定「键 + 动词短语」句式;`?` 调出快捷键总表 overlay。
14. **宽度降级优先级栈**:页头/侧栏/footer 拥挤时按显式丢弃列表降级,不做各自为政的 media query;窄窗口是「受支持的画法」。
15. **装饰由内容价值决定**:无实际产出的轮次不画分隔线/徽标;空状态不刷存在感。
16. **AI 输出防御层**:markdown 渲染管线前加保守纠正(拆多余围栏、表格转 key/value、URL 保完整);用户输入渲染前剥离注入字符。

---

## 6. 关键文件速查(供深入阅读)

| 主题 | 文件(`codex-rs/tui/src/` 相对路径) |
|---|---|
| 主循环/事件总线 | `app.rs`、`app/startup.rs`、`app/event_dispatch.rs`、`app_event.rs` |
| 帧调度 | `tui/frame_requester.rs`、`tui/frame_rate_limiter.rs` |
| 双层渲染/reflow | `insert_history.rs`、`transcript_reflow.rs`、`chatwidget/transcript.rs` |
| 消息 cell | `history_cell/mod.rs`、`history_cell/messages.rs`、`exec_cell/`、`diff_render.rs` |
| 流式管线 | `streaming/{mod,controller,chunking,commit_tick,table_holdback}.rs`、`markdown_stream.rs` |
| 输入区 | `bottom_pane/chat_composer.rs`、`paste_burst.rs`、`chat_composer_history.rs` |
| 审批 | `bottom_pane/approval_overlay.rs` |
| 通用弹窗 | `bottom_pane/list_selection_view.rs`、`bottom_pane/bottom_pane_view.rs`、`bottom_pane/mod.rs`(view_stack) |
| 状态指示/动画 | `status_indicator_widget.rs`、`shimmer.rs`、`motion.rs`、`frames.rs` |
| 模型选择 | `chatwidget/model_popups.rs`、`model_catalog.rs` |
| 设置写回 | `core/src/config/edit.rs`(ConfigEditsBuilder)、`tui/src/config_update.rs` |
| 配置分层 | `config/src/state.rs`(ConfigLayerStack)、`config/src/loader/mod.rs` |
| Onboarding | `onboarding/onboarding_screen.rs`、`welcome.rs`、`auth.rs`、`trust_directory.rs` |
| 斜杠命令 | `slash_command.rs`、`bottom_pane/command_popup.rs`、`chatwidget/slash_dispatch.rs` |
| 状态卡片 | `status/card.rs`、`status/format.rs` |
| 颜色/排版 | `style.rs`、`color.rs`、`ui_consts.rs`、`text_formatting.rs` |
| 键盘 | `keymap.rs`、`keymap/chords.rs`、`key_hint.rs` |
| 实时预览 | `theme_picker.rs`、`keymap_setup.rs` |

---

*报告生成:2026-08-25;调研方式:浅克隆仓库 + 三路并行源码深读(主界面架构 / 设置配置 / 视觉原语)。*
