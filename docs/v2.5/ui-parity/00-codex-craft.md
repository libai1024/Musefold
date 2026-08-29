# 00 Codex 级质感基线 — 跨屏工艺规范(C 系列增益的公共语汇)

> **性质**:横切基线,服务 01–08 各篇。参照产品是 **OpenAI Codex 桌面 App**(会话式 Agent 工作台,与 Musefold 结构同构:侧栏会话列表 + 贴底 Composer + 结果时间线)。本篇把它的质感(材质、密度、动效)与交互工艺翻译进 Musefold 既有的 Graphite/Ember token 体系——**参照的是工艺纪律,不是它的品牌**:暖灰纸面与 Ember 强调色不变,黑白极简不照搬。
> **与规范的关系**:V25-UI-SPEC 仍是唯一规范。本篇提出的 token 新增落地时写进 SPEC §1;改变旧版行为的项(如侧栏宽度过渡)先过 SPEC §9 差异登记;本篇不裁决冲突。
> **与 P 系列的关系**:P = 对旧版的回退(差距),C = 超越旧版的增益,即 README 原则「交互体验可以做得更好」的落点。**C 不与 P 抢排期**:C1 = 低风险高感知,挂靠同屏就近的 P 卡顺带交付或独立小卡;C2 = 涉及行为变化或产品判断,先评审再排卡。同屏还有 P0 未收口时,不单独为 C 开卡。

---

## 1. 为什么参照 Codex,参照它的什么

1. **产品同构**:两者都是「侧栏会话 + 中轴时间线 + 贴底 Composer」的桌面工作台。旧版已两处显式借用 Codex 交互(03 §3:气泡上方附件区、行首 Backspace 弹出引用胶囊),本篇把零星借用升级为系统性基线。
2. **气质同向**:SPEC §1.1 的品牌纪律(暖灰纸面、发丝边框、克制阴影、拒绝大面积彩色块)与 Codex 的「排版承重、近单色 chrome、唯一强调色」是同一套价值观。差距不在方向,在**执行精度**——时长有没有 token、按压有没有反馈、数字会不会跳动、焦点环是否处处可见。
3. **已有资产,恢复而非发明**:v2.0 双寄存器思想(Operate 日常操作面 / Theater 品牌时刻,承旧 tokens.css `data-ui-register`)与 Codex「安静的 chrome + 唯一的开奖时刻」同构;动效三态闸门(07-03 P0)已于 2026-08-29 收口——所有 C 系列动效天然受 `MotionSync` + 压制规则控制,这是本篇成立的前提。

## 2. 七条工艺法则(Codex 特征 → Musefold 落法)

1. **排版承重,色彩守衡**。层级靠字号(13/12/11)、字重(600/500/400)与前景两阶灰(`--foreground` / `--muted-foreground`)表达,不靠色块。Ember 只出现在:主 CTA、活动导航态、焦点环、品牌朱点、running 状态点;**一屏可视区内 filled 主色元素 ≤2**(当前工作台仅发送钮一处——新设计钮已改描边、主色让给发送钮,02 §2.1 的取舍就是本法则)。状态色(success/warning/destructive/info)只在状态发生处出现,不做装饰。
2. **表面阶梯,发丝分界**。四阶表面:`--background`(窗底)→ `--sidebar`(栏)→ `--card`(工作面/卡)→ `--popover`(浮层);相邻表面靠色阶差**或** 1px `--border` 分界,禁「双保险」(既画线又换色再加阴影)。阴影只许两处:工作面浮岛(承旧 `--shadow-sm: 0 1px 2px rgba(28,30,34,0.06)`)与浮层(承旧 `--shadow-pop: 0 16px 40px rgba(28,30,34,0.08)`),落地时按 SPEC §1 token 化。
3. **几何有度**。控件 8px(`--radius-lg`)、工作面与大图 12px(`--radius-xl`)、行内小缩略 6px(`--radius-md`)、chip/胶囊 full;**同一屏出现的圆角规格 ≤3 种**。胶囊留给「可反复拨动」的轻控件(比例/设置/筛选 chips),矩形圆角留给容器与主按钮。
4. **密度为桌面而生**。行内控件高 28–32px,列表行高 36–44px(密度体系 07-03 P2 落地前取窄值),13px 正文 / 12px 摘要 / 11px 元信息(SPEC §1.2 已定);间距走 4/8/12/16/24 步进,评审见奇数魔法值打回。
5. **动效快、静、有物理**。日常动效 90–260ms(§3 token 表),默认 `--ease-out`;位移 ≤8px、入场缩放 ≥0.97;`--ease-spring` 只给按压回弹与落定,禁用于纯 opacity。**全产品唯一 >260ms 的「剧场时刻」= 结果就位 reveal**(03 §7 P2,承旧 theater `--dur-theater-enter: 640ms`)——生成开奖值得剧场,其余一切都是幕后。全部动效过三态闸门(已收口),JS 驱动动效启动前查 `skipMotion()`(`@musefold/ui/lib/motion`)。
6. **键盘是一等公民**。每个浮层动作配 kbd 提示(§5.4 原语);焦点环处处可见(`focus-visible` 2px `--ring` + offset 2,鼠标点击不留环);Esc/Enter/⌘ 系语义全屏一致(I7);新交互先想键盘路径再想鼠标路径。「只列真实接线的快捷键」(07-07 规则)横切生效——kbd 提示与实际未绑定即撒谎。
7. **反馈就地、诚实**。状态在发生处呈现:行内红字、行首状态点、按钮内 Spinner;toast 只作离场通知,不承载需要处理的信息。骨架与内容同形(I1);数字不跳动(tabular-nums)、不撒谎(无数据显「—」不显 0,07-05 口径);进行中的动画豁免压制(`data-motion-exempt`,Spinner 已带)。

## 3. 动效 token(C-1 基建,唯一新增基础设施)

`packages/ui` globals.css `@theme` 现只有 `--ease-spring` / `--ease-smooth`,时长全靠 Tailwind 默认或裸值。补齐承旧 token(值 = v2.5-baseline `packages/ui/src/tokens.css` 原值):

| token | 值 | 用途 |
|---|---|---|
| `--dur-instant` | 90ms | 按压反馈、图标形态切换、文案 crossfade |
| `--dur-fast` | 130ms | hover 底色、行动作组渐显、菜单/Popover 入场 |
| `--dur-base` | 180ms | 气泡入场、Dialog、chip 弹出/离场 |
| `--dur-med` | 220ms | 抽屉/Inspector 滑入、侧栏宽度(若 C2 通过) |
| `--dur-slow` | 260ms | 大面积布局重排(慎用,通常应拆成局部动效) |
| `--ease-out` | cubic-bezier(0.22, 1, 0.36, 1) | 默认缓动(承旧) |
| `--ease-in-out` | cubic-bezier(0.65, 0, 0.35, 1) | 双向位移(承旧) |

- theater 时长(640ms)不进全局 token:承旧「泄漏防护」思路,定义在工作台结果 reveal 的作用域内(03 §7 P2 实现时随卡落地)。
- **使用规则**:组件动效一律引用 token,评审见裸 `duration-[NNNms]`/裸 transition 毫秒值打回(与 SPEC §1.2 禁裸色值同级);tw-animate 类默认时长与 token 冲突处以 token 覆盖。
- 出场时长 = 入场的 50–70%(离开比到来快,Codex/系统惯例)。

## 4. 交互六态规格(每个可交互元素逐态过一遍)

| 态 | 规格 | 锚点 |
|---|---|---|
| default | 语义 token 底/字;可交互性靠形状与位置表达,不靠常驻描边 | 法则 1/2 |
| hover | 底色升一阶(ghost 钮 → `--accent`;内容区行 → `--muted`;侧栏行 → `--sidebar-accent`),`--dur-fast`;hover 只做「预告」,**绝不承载唯一入口**(I2) | §5.2 |
| focus-visible | 2px `--ring` + offset 2;仅键盘触发;浮层内焦点圈闭 + Esc 关闭 + 归还触发器(I9) | 法则 6 |
| active(press) | scale 0.985 或底色再深一阶,`--dur-instant` + `--ease-out`;**触屏的主反馈**(无 hover 可用),全端必须有 | C-3 |
| disabled | opacity 50% + 不响应;必须给理由(`title` 或就近文案,承旧「请先连接服务商」先例),禁止无解释的死按钮 | I4 |
| loading | 按钮内 Spinner 替换图标 + disabled(I1);Spinner 自带 `data-motion-exempt` 豁免(已收口) | 法则 7 |

## 5. 组件语汇(Codex 解剖,各屏「Codex 增益」节按此引用)

### 5.1 Composer(产品的舞台中心)

- 容器:`--card` 面 + 1px `--border` + `--radius-xl`;时间线内容滚过 Composer 上缘时以 16–24px 渐隐遮罩过渡,不硬切(03 增益)。
- 控件行:左侧「+」/比例/设置为 ghost 胶囊(高 28px,hover `--accent`);右侧发送钮为 32px 圆形 filled 主色——本屏唯一 filled Ember(法则 1);idle=ArrowUp / running=Square / cancelling=Spinner 三态形变用 `--dur-instant` crossfade。
- 附件区:chips 位于输入框上方(承旧 Codex 式);chip 解剖 = 高 24px pill、16px 缩略或图标、名称单行截断、删除钮 hover/focus 显;光标 0 位按 Backspace 逐个弹出(03 挂点)。
- 键盘:Enter 发送 / Shift+Enter 换行 / ⌘Enter 别名(03 P3)/ Esc 收起浮层。

### 5.2 列表行(库/历史/会话/归档共用骨架)

- 结构:缩略图或状态点 → 主内容(标题 13px/500 + 摘要 12px muted)→ 元信息(11px muted,数字 tabular)→ 行尾 hover 渐显动作组(D1/I2 已定,触屏常显)。
- hover 底色见 §4;选中态中性底色**直切**(不动画,承旧刻意);press 底色再深一阶。
- 动作组图标钮 `size-6`,聚焦有环;主动作(如「使用」)用文字钮区别于图标组。

### 5.3 菜单与浮层

- 入场:opacity 0→1 + scale 0.98→1 + 4px 位移,`--dur-fast` + `--ease-out`,`transform-origin` 从触发器一侧;出场时长减半。
- 菜单项:高 28px、图标 `size-4`、危险项 `--destructive`;**快捷键右列**(`<Kbd>`,C-2);分组用 1px `--border` 分隔线,不用空行。
- Dialog 居中 / 移动端 Sheet(SPEC §2.4 已定);脏表单防误关是行为规则(04/07-02 P1),不属动效。

### 5.4 Kbd 原语(C-2)

- 形态:11px mono、1px `--border`、底 `--muted`、`--radius-sm`、内距 1px 6px;暗色下底 `--secondary`。
- 三处共用:菜单右列、tooltip 内联(「新设计 ⌘N」)、设置快捷键表(07-07);数据源 domain `PRODUCT_SHORTCUTS` 单源,只列已接线。

### 5.5 空态

- 品牌时刻只在两处:工作台空态(水印/呼吸/横滚,03 §5)与关于页品牌面板(07-07);其余屏空态 = 图标 `size-5` muted + 一句引导 + 主 CTA(I5),不塞插画、不放大色块。

### 5.6 骨架与图像占位(C-5)

- 骨架与内容同形(I1);图像缩略加载:占位 `bg-muted` → 载入后 opacity 0→1(`--dur-fast`),防白闪。
- 图像圆角两档:大图(结果卡/灯箱/详情封面)`--radius-xl`,行内小缩略(44–56px)`--radius-md`;不再出现第三种。
- 可点缩略 hover scale 1.06 于 overflow-hidden 内(承旧 04 §7,恢复封面时统一)。

### 5.7 滚动与滚动条(C-6)

- overlay 滚动条:宽 8px、thumb `--muted-foreground` 35% 圆角 full、hover 50%;macOS 用原生 overlay 不动,Windows/Linux 需样式化(装壳卡顺带)。
- 程序化滚动(贴底/回到最新/高亮居中)统一 rAF 或 `scrollIntoView({ behavior: 'smooth' })`,压制规则已把 reduce 下降为 auto。

### 5.8 数字与等宽(C-4)

- `tabular-nums`:积分、计数、耗时、延迟(NNNms)、时间戳、版本号、字数计数(03 已有)、灯箱「n / N」。
- 千分位统一走 `formatPoints` 同源逻辑;路径/令牌掩码/配置片段/错误码用 mono(07-04/07-06 已定,横切化)。

## 6. 跨屏 C 任务清单(屏内 C 任务见各篇「Codex 增益」节)

| 编号 | 级 | 任务 | 挂靠 / 验收要点 |
|---|---|---|---|
| C-1 | C1 | ✅ 已收口(2026-08-29):`@theme static` 增 `--dur-*` 五档 + `--ease-out`/`--ease-in-out`(§3 表,承旧原值,构建产物验证输出);首个消费方 Dialog/AlertDialog 入场 `duration-(--dur-base) ease-out`;单测锁 token 与消费方接线 | 评审规则「裸 ms 打回」即日生效 |
| C-2 | C1 | ◐ 部分收口(2026-08-29):`<Kbd>` 原语(ui 包,§5.4 形态)+ 快捷键单源 `PRODUCT_SHORTCUTS`/`shortcutDisplay`(落 features shell —— 边界规则禁 features→domain,产品语义归 features)+ 侧栏 ⌘N 消费 + 单测「接线镜像」断言 | 菜单右列随 02 P1 右键菜单接线、快捷键表随 07-07 P2 交付,均只消费本单源 |
| C-3 | C1 | ◐ 部分收口(2026-08-29):ui button base 落 `active:scale-[0.985]` + `active:duration-(--dur-instant)`,常态过渡 `--dur-fast` + 承旧 `ease-out`,全 variant/size 生效;单测锁 press 类 | 「行改底色深一阶」随各屏行组件落(02-C3 等) |
| C-4 | C1 | ◐ 部分收口(2026-08-29):现存 readout 已落 `tabular-nums` —— 历史行 meta(耗时/时间戳)、Inspector 参数值、提示词行(usageCount/评分/+N)、账号积分(名片+菜单)、云同步时间;Composer 字数与积分徽章原已有 | 未实现域(灯箱 n/N、版本号、usage 卡)随各自卡带 tabular 交付 |
| C-5 | C1 | ◐ 部分收口(2026-08-29):ui 新增 `FadeImage` 原语(占位 `bg-muted` 由容器给,载入后 opacity 0→1 `--dur-fast`,cached-image complete 兜底);工作台结果卡/灯箱升 `--radius-xl`(骨架同形跟进),历史缩略/Inspector/回合附件图统一接入 | 库封面随 04 P1 交付时消费同一原语 |
| C-6 | C1 | overlay 滚动条(Windows/Linux),挂靠 01 桌面装壳组 | Windows 打包冒烟目检 |
| C-7 | C2 | ceramic 主 CTA 收编评审:`apps/web-next` `/ceramic-button` 实验蒸馏——通用 press 规格并入 C-3;噪点纸面 + 双内描边 + 下沉 2px 的 hero 形态是否只用于「开始创作」类 CTA 由产品定;收编则样式 token 化进 `packages/ui`,宿主 demo 退役 | 评审卡;不通过则 demo 与样式一并清理 |
| C-8 | C2 | 焦点走查:逐屏 Tab 序 + focus-visible 可见性 + 浮层圈闭审计(I9 抽查) | 走查记录回填各篇;发现项按 P/C 分流登记 |

## 7. 反模式(评审打回清单)

1. 裸色值 / 调色板类(SPEC §1.2 已禁)与**裸动效毫秒值**(本篇扩展)。
2. 阴影当层级用(表面之间既换色又画线又加影)。
3. bounce/overshoot 用在 chrome 上(spring 只给按压与落定)。
4. hover-only 入口(违 I2);触屏无 press 反馈。
5. 装饰动画绕过闸门:CSS 内联 style 写 keyframes、JS 动效不查 `skipMotion()`。
6. 非剧场动效 >260ms;同屏两个「剧场时刻」。
7. kbd 提示未接线、快捷键表列未实现项(07-07 规则)。
8. 空态塞插画/大色块;toast 承载必须处理的信息(应就地呈现)。

## 8. 评审检查单(任何 UI 卡收口前过一遍)

- [ ] 颜色/圆角/阴影/时长全部引用 token,无裸值。
- [ ] 一屏 filled 主色 ≤2;状态色只在状态处。
- [ ] 相邻表面单一分界手段(色阶或发丝线)。
- [ ] 新增可交互元素六态齐全(§4),disabled 有理由。
- [ ] 动效 ≤260ms(剧场时刻除外),reduce 三态下行为正确(on 直达终态 / off 保留)。
- [ ] 键盘可达:Tab 序合理、focus-visible 可见、浮层 Esc + 焦点归还。
- [ ] 数字 tabular,无数据显「—」;骨架与内容同形。
- [ ] 快捷键提示与接线一致。
- [ ] 触屏路径完整(动作组常显、press 反馈、Sheet 形态)。
- [ ] 视觉快照三形态(web-desktop / web-mobile / electron)更新且经目检。

## 9. 维护约定

1. 新的跨屏工艺规则先进本篇,屏内增益进各篇「Codex 增益」节;两处都用 C 编号,不与 P 混排。
2. C 任务收口后同 P 任务口径销账(移到已收口备注);token/规则升格为规范时写进 V25-UI-SPEC §1 并在本篇留指针。
3. 本篇引用的承旧值(动效时长、阴影、圆角)以 `v2.5-baseline` tag 的 `packages/ui/src/tokens.css` 为出处;若实现时实测不适(如 13px 基线下 130ms 偏快),以实测为准回写本篇。
