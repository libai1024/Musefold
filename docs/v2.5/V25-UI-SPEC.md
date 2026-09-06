# V25-UI-SPEC — v2.5 界面与交互规范(渲染层唯一基准)

> **状态**:已定稿,M4 各卡实施依据。发现规范与已交付代码矛盾时:先判定哪方错,修错的一方并回写本文件。
>
> **定位**:自顶向下锁定每个界面的布局、每个状态的 UI、交互方式与组件复用。M4a/M4b 已交付部分以本文件校准收尾;M4c/M4d 未动工部分以本文件为起点。
>
> **核心原则**:
> 1. **承旧优先**——信息架构、布局、文案、快捷键尽量与 v2.1 渲染层一致;用户不应感到「换了个产品」。
> 2. **有意优化须登记**——凡与旧版不同处,必须写进 §9 差异登记表,给出理由;未登记的差异视为回归。
> 3. **一套 UI 四端复用**——屏幕组件只写一份(`packages/features`),原语只用 `packages/ui`(shadcn);宿主只注入壳与数据接缝。
> 4. **主题可切换**——所有颜色/圆角/阴影经语义 token,组件内禁止硬编码色值;未来加主题 = 新增一份 token 覆盖,组件零改动。

---

## 0. 范围

### 0.1 本轮迁移的屏幕(M4)

| 域 | 屏幕 | 迁移卡 | 状态 |
|---|---|---|---|
| 应用壳 | 侧栏 + 顶栏 + 移动底栏 | M4b 收尾 | 部分交付,按 §2 校准 |
| 工作台(生成) | 时间线 + Composer + 空态 | M4b | 部分交付,按 §3 校准 |
| 提示词库 | 列表 / 编辑器 / 标签管理 / 回收站 | M4a ✅ | 已交付,§4 记录基准 |
| 生成历史 | 列表 + 筛选 + 详情 + 回收站 | M4c ✅ | 已交付,§5 记录基准 |
| 设计方案 | 我的方案 / 发现 / Inspector / 详情 / 试运行 | P01 | 迁移中;入口已挂载(P01-7,§8A),按 §8A 与 ui-parity/06 校准 |
| 设置 | 卡片流(分组导航后置) | M4d ✅ | 已交付,§6 记录基准 |
| 账号 / AI 连接 | 账号面板 / 连接管理 / 余额兑换 | M4d ✅ | 已交付,§7 记录基准 |

### 0.2 暂不迁移(保留旧实现或冻结,不进新渲染层)

| 项 | 处置 | 说明 |
|---|---|---|
| **桌宠(pet)** | 冻结,不迁移不确认 | 独立 renderer 入口按 D1 保留在旧栈,v2.5 渲染层不出现 |
| **EmberMark 朱点(右上角橙色小点)** | 冻结,不迁移不确认 | 外部任务活动指示,待后续版本重新设计 |
| 豆包网页模式(doubao-web) | 主进程语义保留,渲染层暂缓 | 保留账号/连接区可达入口;豆包专属渲染与限制提示后续排卡 |
| Skill runtime 会话 / GitHub Skill 导入 | 暂缓 | Composer「+」菜单相关项不迁 |
| 通用分享/导入 | 暂缓 | 设计方案专用 `.musefold.design` 导入/导出随设计方案域迁移(P01 进行中:Desktop 安全 staging/archive 与 domain 导入/导出已接线未验收;通用分享/导入本体仍暂缓) |
| 命令面板(⌘K) | 暂缓,壳预留入口 | 顶栏搜索按钮先跳提示词库搜索,后续接命令面板 |
| 微调(refinement)链 | 暂缓至 M4c 后评估 | 历史屏先展示 parentRunId 线索,不提供发起微调入口 |
| 归档会话浏览 | 已实现(设置·数据卡) | 会话「归档」动作与设置内归档列表、刷新、恢复、软删闭环;生成记录保留,永久清理留 D02 |

---

## 1. 设计基线:主题与 token

### 1.1 品牌体系(承 v2.1「Graphite / Ember」)

暖灰纸面 + 橙红 Ember 强调色;内容区靠稳定表面、发丝边框、克制阴影建立层级,拒绝大面积彩色块。

### 1.2 token 映射(旧 → 新,已在 M3 落地于 `packages/ui/src/styles/globals.css`)

| 旧 token(legacy-ui/tokens.css) | 新语义 token(shadcn 惯例) | 浅色值 | 深色值 |
|---|---|---|---|
| `--bg-window` | `--background` | `#f6f6f4` | `#151619` |
| `--bg-work` | `--card` / 工作面 | `#fafaf8` | `#1d1f22` |
| `--bg-sidebar` | `--sidebar` | `#efefec` | `#1b1c1f` |
| `--bg-popover` | `--popover` | `#fdfcf9` | `#2b2d31` |
| `--fg-primary` | `--foreground` | `#202124` | 近白 |
| `--fg-secondary/tertiary` | `--muted-foreground` | `#55575c` 系 | — |
| `--accent`(Ember) | `--primary` | `#d6653f` | `#ef7a52` |
| `--border-default` | `--border` | `#dfdfdb` | — |
| 状态色 | `--destructive` 等 | 承旧红/绿/黄 | — |

规则:
- 组件只允许引用语义 token(Tailwind 语义类:`bg-background`、`text-muted-foreground`、`border-border`、`text-primary`…),**禁止**出现 `#hex`、`rgb()`、调色板类(如 `text-orange-500`)。
- 主题切换机制:`<html>` 上 `.dark` 类(next-themes / 桌面偏好驱动)。未来新主题 = 在 globals.css 增加一个作用域 token 块,组件零改动。
- 字号基线 13px(承旧 `font-size: 13px`),密度紧凑;正文 `text-sm`(13px 映射),元信息 `text-xs`/11px。

### 1.3 图标与字体

- 图标唯一入口 `@musefold/ui/icons`(lucide 再导出),尺寸惯例:行内 `size-4`,行动按钮 `size-3.5~4`,空态插图 `size-5~6`。
- 字体:系统栈(SF Pro Text / Segoe UI Variable);品牌字体仅用于登录/关于页,不进日常界面。

---

## 2. 应用壳(AppShell)

### 2.1 布局(承旧版双端一致的侧栏模式)

```text
┌─────────────┬──────────────────────────────────────┐
│ 侧栏(sidebar 面)│ 顶栏(仅移动/收起态需要;桌面窗口用系统标题栏区)│
│ ┌─────────┐ │ ┌──────────────────────────────────┐ │
│ │品牌 + 收起│ │ │ 主区(工作面 bg-background)        │ │
│ │[新设计 ⌘N]│ │ │  各域屏幕组件(features 包)        │ │
│ │主导航     │ │ │                                  │ │
│ │ 工作台    │ │ │                                  │ │
│ │ 提示词库  │ │ │                                  │ │
│ │ 生成历史  │ │ │                                  │ │
│ │─────────│ │ │                                  │ │
│ │「对话」    │ │ │                                  │ │
│ │ 会话列表↕ │ │ │                                  │ │
│ │─────────│ │ │                                  │ │
│ │底部:账号/设置│ │                                  │ │
│ └─────────┘ │ └──────────────────────────────────┘ │
└─────────────┴──────────────────────────────────────┘
```

三种响应形态(同一组件,`md` 断点分叉):

| 形态 | 侧栏 | 导航 | 会话列表 |
|---|---|---|---|
| 桌面窗口(Electron) | 常驻,可收起(收起后主区左上出现展开钮) | 侧栏导航 | 侧栏「对话」区 |
| Web ≥ md | 同桌面 | 同桌面 | 同桌面 |
| Web < md(移动) | **overlay 抽屉**(同一五段式侧栏,<768px;`sidebar-drawer-open`) | 底部标签栏 + 抽屉主导航 | 抽屉「对话」区 + 工作台顶部会话选择器 |

### 2.2 侧栏构成(自上而下,承旧 `ProductSidebar`,2026-08-29 随 ZCode/Codex/Cursor 布局语法收口)

1. **品牌行**:Musefold 标记 + 字标;右侧「收起侧栏」图标钮(`sidebar-collapse`)。macOS 非全屏时头部左侧让位红绿灯(inset 78px,宿主注入);原生全屏时交通灯隐藏,回落为 12px;非 macOS 为 0px。窗口状态由 v25 preload 的只读宿主信号提供,不进入业务 gateway。
2. **「新设计」行**:与导航行同构的轨道行样式(SquarePen + 文案 + 右列 kbd `⌘N`),不再用描边按钮(`session-create`)。
3. **主导航**(无分节标签):工作台、提示词库、设计方案(§8A,P01-7 起随 `hasDesignSchemes` capability 注册)、生成历史。**设置不占导航轨**,入口在底部账号区齿轮;活动项 `aria-current="page"` + 强调底色,行高 32px / 13px 字号。testid `nav-<id>`。
4. **「对话」分节 + 会话列表**(滚动区,详见 §3.3)。行尾静息态显示相对时间(刚刚/n 分钟/n 小时/n 天/M月D日,`session-updated-at`),hover/focus 让位给行动作组(display 切换,触屏常显动作)。
5. **底部账号区**(`AccountFooter`,承旧 `SidebarAccessSwitcher` 语义收敛):
   - **通道定位**:官方账号 = 生图推荐主通道;豆包 = 免费试用通道;中转站 = 第三方自备通道。
   - **触发钮显示当前生效通道**(`data-channel` 三态,由活跃本地连接解析):
     - `account`(无活跃本地连接、活跃行是账号托管行 `managedBy='account'`、或 Web):官方黑白标记(`MusefoldMark`,朱点降为单色 `[--primary:currentColor]`)+ 登录状态点(绿=已登录)+ 名称/积分(未登录=「登录账号 / 同步与云生图」);
     - `doubao`(活跃行 type=doubao-web):`DoubaoMark` + 「豆包 / 免费试用通道」;
     - `relay`(其余活跃行):Waypoints + 连接名 + 「中转站通道」。
     切换后即时更新(setActive 失效并刷新 aiProviders.list)。testid `account-footer` / `account-footer-signed-out`。
   - **菜单**:默认动作是登入/登出——未登录首项「登录 Musefold 账号」深链设置账户卡;已登录 = 名称/积分头 + 「账户与额度」+ 「登出」(AlertDialog 确认)。
   - **「更多连接」子菜单**(仅桌面 `hasLocalAiProviders`):官方账号(`MusefoldMark`)/中转站(Waypoints)/豆包(`DoubaoMark`)三行,**点击即切换活跃连接**(`aiProviders.setActive`,左下角显示与 Composer 预选跟随,toast 反馈);当前通道行显示勾选。官方账号行的切换落点是账号托管行(契约 `AiProvider.managedBy='account'`,V05 FR-GW-01 迁移库存在;无托管行且非当前时深链账户卡);中转站/豆包未配置时深链设置连接卡;尾行「连接设置」深链同卡。testid `account-menu-more/-official/-relay/-doubao/-connections`。
   - **齿轮钮**:直达设置,承 e2e `nav-settings` 契约。
   - 深链机制:`ScreenIntent`(`settings-account` / `settings-connections`)→ 设置屏滚动至目标卡 + 1.8s ring 高亮。

### 2.3 顶栏

- **Web ≥ md**:仅侧栏收起时在主区左上显示展开钮;不设常驻顶栏(承桌面口径,最大化内容区)。
- **Web < md(移动)**:常驻顶栏 = 抽屉触发钮 + 当前域图标/标题 + 搜索钮 + 额度 readout(Sparkles 图标 + 数字,`tabular-nums`)。抽屉使用 `Sheet` 左滑,宽 `min(320px,max(220px,100vw - 28px))`;打开时主工作面与底栏 `inert`,焦点圈闭,Escape/导航/新设计/会话打开均关闭,关闭后焦点归还触发前元素。
- **Electron**:系统标题栏区域为拖拽区(`drag-region`);Windows/Linux 渲染自绘窗口控制钮。主区不再叠加产品顶栏。

### 2.4 全局反馈设施(壳级 Provider)

| 设施 | 组件 | 约定 |
|---|---|---|
| Toast | `sonner`(ui 包 `<Toaster>`) | 右上(桌面)/顶部(移动);成功 2.5s 自动关,错误需手动关 |
| Tooltip | `TooltipProvider`(delay 300ms) | 壳级一次注入,屏幕组件内不再包 Provider |
| 确认对话框 | `AlertDialog` | 所有破坏性动作(删除/清空)必须走它,主按钮 destructive 色 |
| 对话框/抽屉 | `Dialog` / `Sheet` | 移动端表单优先 Sheet(底部滑出),桌面 Dialog 居中 |

### 2.5 壳交付状态(M4b 收尾记录,2026-08-28)

- [x] 会话列表迁入壳侧栏「对话」区:`SessionListPanel` + `NewSessionAction`(features/workbench),双宿主经 `action`/`sessions` 插槽注入;活动会话为 zustand 共享 store(`useActiveSession`)。
- [x] 侧栏品牌行(`MusefoldMark` 承旧几何,朱点走 `--primary`)+「功能」分节标签 + 收起/展开(收起态主区左上展开钮)。
- [x] 「新设计」钮含 kbd 提示(⌘N / Ctrl+N)与全局快捷键绑定(组件内,双宿主自动获得;浏览器保留键位时尽力而为)。
- [x] 桌面 macOS 红绿灯 inset(`brandInset` prop,收起态展开钮同步让位);侧栏为窗口拖拽区(桌面宿主 CSS 作用域)。
- [x] 移动顶栏:品牌标记 + 当前域标题 + 搜索钮(跳提示词库)+ 额度 readout(`MobileQuotaReadout`,宿主经 `mobileExtra` 插槽注入;未登录不占位)。
- [x] 会话置顶:偏好通道承接(`AppPreferences.pinnedSessionIds`,D6 同机制);置顶组排前、行首 Pin 标记、离场自动清偏好。
- [x] 会话行运行/未读状态点:契约会话实体补派生字段 `latestJobStatus`/`latestJobFinishedAt`(default null 兼容);running 动画点(queued/running/cancelling)、unread 实心点(本次运行期内完成且未查看,`useActiveSession.seenAt` 内存追踪);列表有活动生成时 3s 短轮询驱动翻终态。
- [x] 布局语法收口(2026-08-29,承 ZCode/Codex/Cursor 参照):设置移出导航轨(入口=footer 齿轮)、「新设计」改轨道行样式、「功能」分节标签取消、会话行尾相对时间戳;底部账号区升级身份菜单(官方黑白标触发钮、登入/登出默认动作、「更多连接」切换子菜单、ScreenIntent 设置深链),形态见 §2.2-5。
- [x] U01 壳几何收口(2026-08-29):侧栏默认 248px、220–360px/32vw 夹取,指针拖拽 + 键盘 ±16/Home/End + 双击复位,沿用 `musefold:sidebar-width`;桌面工作面四边 4px inset + 12px 圆角 + 阴影;`<768px` 使用同源模态抽屉,无 761–767px 不可达区。

### 2.6 首启引导层(U01-onboarding,2026-09-06 ✅,`packages/features/src/onboarding`)

- **挂载**:双宿主在 `PlatformProvider` 内、壳容器之后各挂一行 `<OnboardingFlow onOpenScreen>`(与 `Toaster` 同级);gate 未放行时返回 `null` 不占 DOM。切屏一律回调宿主既有导航,引导层不自建路由。
- **gate 判定**(`useOnboardingGate`):哨兵 `AppPreferences.onboardingCompletedAt` 非 null → 不弹;无哨兵且账号未登录、无可用本地 Provider(桌面)、豆包未登录(桌面)→ 弹;无哨兵但已具备任一生图通道 → 不弹并**静默补哨兵**(存量用户不回放);偏好读取失败 fail-closed(不弹也不写)。流程中途拿到通道不撤走已放行的引导。宿主差异只经 capability(`hasLocalAiProviders` / `hasDoubaoWebLogin`)。
- **形态**:`Dialog` `role=dialog aria-modal`,桌面 md+ 居中 640px 卡、移动全屏;步骤指示带 `aria-current`;关闭 = 跳过,经 AlertDialog 确认。
- **四步**:welcome(品牌行 / 标语 / 副文 theater reveal,60ms 错相,`skipMotion()` 命中直接终态)→ connect(三轨:官方账号 / 桌面 BYOK / 豆包免费试用;Web 只官方账号)→ validate(进入即自动确认一次;失败只给「重新确认」不给「继续」,可返回或跳过)→ first-image(只写 `pendingDraft` 送工作台,**不发起真实生图**)→ complete 写哨兵。完成、跳过、关闭写同一哨兵。
- **E2E 夹具**:`tests/v25/onboarding-helpers.ts` 单入口。Electron `launchV25App` 默认预置哨兵(`onboarding: 'pending'` 显式开启);Web 各 spec 顶层 `seedOnboardingCompleted`。

---

## 3. 工作台(生成)——`packages/features/src/workbench`

### 3.1 屏幕布局

```text
┌───────────────────────────────────────────┐
│ 时间线(滚动区,居中列 max-w-3xl)              │
│  [回合 1] 用户气泡(右对齐)                   │
│           助手帧(头像+结果网格+动作行)         │
│  [回合 2] …                                │
│  ▼ 自动贴底(底部留白,内容可滚过卡片背后)        │
│ ┌─────────────────────────────────────┐   │
│ │ Composer 悬浮卡(728px 居中,浮起阴影)    │   │
│ │ 提示词多行输入(自动增高,Enter 发送)      │   │
│ │ [＋] [比例▾] [设置⚙▾]      [发送/停止] │ [参考素材 304px] │
│ └─────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

- **悬浮贴底(承旧 floating 布局)**:Composer 绝对定位贴底,轨道透明不截获事件;卡片 728px 居中、浮起阴影 + 轻透底毛玻璃,时间线内容列(同 728px 中轴)以底部留白从卡片背后滚过。运行中卡片边框转品牌色 30%。
- **空态(无回合)**:品牌锁定区(标记 + **时段问候语**(`workbench-empty-greeting`,早上/中午/下午/晚上四档,挂载后按本地时间计算防水合错位;矮视口隐藏)+ tagline 副标)+ 内联 Composer 居中(承旧 v2.0 §11 形态,20px 品牌焦点外框);垂直定位用 `clamp(72px,16vh,140px)` 顶距随窗口高度呼吸;首次发送后 Composer 落底。E2E 视觉基线用 `page.clock.setFixedTime` 钉问候档位。
- 会话列表不在本屏(住壳侧栏,§2.2);桌面可在工作区右侧展开 304px `PromptReferenceDock`;移动端在本屏顶部放会话选择器(§3.4),引用选择器改为底部 Dialog。

### 3.2 Composer 规格

| 控件 | 形态 | 契约字段 | 约定 |
|---|---|---|---|
| 提示词输入 | 多行 textarea,自动增高(76–180px) | `prompt` | Enter 或 ⌘/Ctrl+Enter 发送 / Shift+Enter 换行;IME 组合期(含 keyCode 229)不截获;占位语分支承旧:空会话「描述你想生成的图片…」/有回合「描述下一步调整…」;≥90% 限长时工具条尾部显示 `字数/上限` 计数 |
| 比例选择 | 形状预览触发钮(mono 值 + 几何色板)+ 368px 网格菜单 | `aspectRatio` | 目录承旧 v2.1 全集 11 档(1:1/2:3/3:4/3:2/4:3/4:5/5:4/9:16/16:9/21:9/auto 殿后);3 列卡片含形状预览 + 勾选,打开即聚焦当前项,方向键 ±1 环绕 + Home/End;**自定义比例已恢复(承旧 RatioPicker,D7 作废)**:网格下单一分隔带自定义行(W:H 整数输入 1–99,比例限 1:4–4:1,Enter/「应用」提交,非法非空值 `role=alert`「比例需在 1:4 与 4:1 之间」且弹层不关);自定义当前态 trigger/预览按实际 `W:H` 呈现,标题右侧显示「`W:H` / 自定义」,不回落 auto;数据流只传规范 `W:H`(domain 旧 `custom:W:H` 前缀不进 v2.5) |
| 生成设置 | 值摘要触发钮(显示当前质量档,反向词非空追加「· 反向词」)+ 304px 弹层 | `quality`、`negative` | 质量档 radio 组承旧命名:自动/标准/高清/超清(枚举值 auto/low/medium/high 不变);反向提示词 textarea 收进弹层(不常驻);数量锁 1(§9-D3) |
| Provider 选择 | 下拉(桌面显示本地连接;云端固定「Musefold 云生图」) | `providerId` | 无可用连接时禁用发送并给引导文案 |
| 「+」菜单 | 触发钮 + 菜单 | — | 「添加图片」+「提示词 / 从库中引用」;选择提示词时先完成菜单退出再打开素材面板,不得叠两层浮层;设计方案/Skill/历史来源项随各域后续卡恢复 |
| 发送/停止 | 36px 圆形主按钮(承旧),状态互斥 | — | 正文与 Prompt 引用均为空或无 Provider 时禁用;纯引用可显式发送;hover 上浮/按压下沉微动效;运行中变「停止生成」(Square 图标,Esc 亦可停止),取消中 spinner 禁用 |

testid 约定:`composer-prompt`、`composer-prompt-count`、`composer-submit`、`composer-cancel`、`composer-attach`、`workbench-context-ref-prompt`、`workbench-context-tray`、`prompt-reference-card`、`composer-ratio`、`composer-ratio-grid`、`composer-ratio-{w}x{h}`、`composer-ratio-custom-w/-h/-apply/-error`(自定义比例行)、`composer-settings`、`composer-quality`(radio 组,选项 `composer-quality-{id}`)、`composer-negative`、`composer-provider`、`composer-no-provider`(无连接引导行,含「前往设置」)。

### 3.3 会话列表(壳侧栏「对话」区)——`SessionListPanel`

行 = 状态点 + 标题(单行截断)+ hover 常驻操作组;承旧 `WorkbenchSessionList` 语义:

| 交互 | 触发 | 行为 |
|---|---|---|
| 打开 | 点击行 | 切到工作台并载入会话;清未读 |
| 重命名 | 行内操作钮 / 右键菜单 | 行内变输入框,Enter 提交、Esc 取消 |
| 置顶/取消置顶 | 操作钮 / 右键 | 置顶组排前;本地偏好存储 |
| 归档 | 右键菜单 | 移出列表;设置「数据」卡内的归档列表可刷新、恢复或软删 |
| 删除 | 右键菜单 → AlertDialog 确认 | 软删,可从回收站恢复(回收站入口:设置-数据,M4d) |
| 状态指示 | 行首点 | `running` 动画点(该会话有进行中生成)/`unread` 实心点/`idle` 无 |

状态矩阵:loading = 3 行 skeleton;error = 一句错误 + 「重试」;空 = 「还没有对话。点「新设计」开始,发送后会立即出现在这里。」(承旧文案)。

右键菜单为桌面增强入口,**不得是任何动作的唯一入口**(§8-I2):所有动作都有行内钮或对话框路径。

### 3.4 移动端形态

- 屏顶会话选择器(`session-picker`):当前会话名 + 下拉(会话列表复用同一数据 hook);旁置「新建」钮(`session-create-mobile`)。
- 时间线与 Composer 同桌面,Composer 贴底并处理软键盘 inset。
- Prompt 引用选择器使用焦点圈闭的底部 Dialog(`82dvh`,含安全区),面板内部独立滚动;背景主区与常驻底栏均 inert/遮罩,不得压住列表内容。打开时聚焦搜索;Esc/关闭钮收起并把焦点归还 `composer-attach`。桌面对应 304px 非模态内联 Dock,Esc 同样收起和归还焦点。

### 3.5 时间线回合(承旧 `WorkbenchGenerationTurn` 装配)

每回合 = 用户消息(右对齐气泡,含提交参数摘要)+ 助手帧(品牌头像 + 内容):

| job 状态 | 助手帧内容 |
|---|---|
| `queued` | 骨架格(按比例占位)+ 「排队中」 |
| `running` | 骨架格 + Spinner + 「生成中」;Composer 侧提供停止 |
| `succeeded` | 结果图网格(1 张即通栏,点击开灯箱/系统预览)+ 动作行:复制提示词、重试、删除 |
| `failed` | 错误卡:错误消息(contract `error.message`)+ 「重试」主动作 + 删除 |
| `cancelled` | 灰化卡「已取消」+ 重试 + 删除 |
| `pending_approval` / `rejected`(云) | 审批提示卡(文案承 API 语义),桌面不出现 |

- 删除回合走 AlertDialog;删除后时间线即时移除(乐观更新)。
- Prompt 引用随用户消息显示不可变快照卡(`job-prompt-reference`):标题、整条/片段徽标、可展开正文均取生成时快照,不回查当前 Prompt。纯引用任务不渲染空用户气泡;复制/编辑优先使用原始 `userPrompt`,不得把宿主合成后的 provider prompt 当作用户输入。源 Prompt 后续编辑/删除不改写旧回合。
- 新回合出现或状态推进时自动贴底滚动;用户手动上滚后暂停自动贴底(阈值 80px,回底恢复)。
- 时间线空态(有会话无回合):居中品牌空态(§3.1)。
- 时间线 loading:居中 Spinner;error:错误卡 + 重试。

### 3.6 数据与轮询

- 会话与历史走 TanStack Query(`queryKeys.workbench/generation`);运行中 job 以 2s 间隔轮询单 job 至终态(M4e IPC 事件流接入后替换为推送)。
- 提交:乐观插入 queued 回合 → 后台轮询;失败回滚并 toast。

---

## 4. 提示词库(M4a 已交付;2026-09-06 B1-T1 完整性收口,记录为基准)

### 4.1 布局

顶部工具行(搜索框 + 标签筛选 + 「新建提示词」主钮)→ Tabs(全部 / 收藏 / 回收站)→ 行式列表(承旧 v2.0 `PromptListRow` 信息架构)。

**详情(2026-09-06)**:md+ 为「列表 + 右侧详情 Inspector(384px,`w-96`)」双栏,详情开启时列表转单列(容器 `max-w-none`);<768px 详情装 `Sheet`,与生成历史 §5.1 同构。`PromptDetailInspector` = 头部(48px 封面 + 标题 + 置顶/评分)+ 正文(可复制,复制后图标转 Check)+ 「相关作品」面板(`PromptRelatedWorks`:该提示词产出的回合缩略,点击经 `history-select` 意图跳历史屏选中,宿主未注入 `onOpenHistory` 时退成只读画廊)+ 元数据(使用次数 / 创建 / 更新时间)。主动作「使用」(回填 Composer 并切工作台);更多菜单只含编辑 / 复制正文 / 置顶 / 移入回收站,「分享」属暂缓域(§0.2)。

### 4.2 列表行(`PromptListRow`)

封面缩略(44px;`coverImageUrl` 有图显图 + hover `scale-[1.06]`,无封面 FileText 占位;`PromptCover` 单源)+ 主体(置顶针 + 标题 + 评分星 / 摘要行 / 元信息行:使用次数 + 更新相对时间 + 标签 Badge ≤4 个 + 溢出计数)+ **常驻操作组**(使用/复制/编辑/置顶/移入回收站;回收站行只留「恢复」「永久删除」)。

- 操作组:桌面 hover/键盘聚焦渐显(`md:opacity-0 group-hover:opacity-100`),触屏常显。
- 点击行主体 = 打开详情(回收站行 = 恢复);编辑走操作组或详情菜单。
- 封面来源:工作台「存为提示词」写入首图;契约 `coverImageUrl` 为 path-free URL(https / `media:` / `data:` / loopback http,拒绝裸绝对路径)。PG 迁移 `0006_prompt_cover_image`;SQLite 复用 `preview_image_path` 槽位,IPC 层做 `media://` ↔ 受管路径双向映射,不新增列。
- **不使用下拉菜单藏动作**(§8-I2,E2E 稳定性教训)。

### 4.3 编辑器(`PromptEditorDialog`)

Dialog(桌面)承载:标题、内容 textarea、描述、标签多选(内联创建)、评分、置顶开关;保存/取消。校验错误就地红字。有未保存修改时 `⌘/Ctrl+S` 保存(`PRODUCT_SHORTCUTS` 单源登记)。

### 4.4 状态矩阵

| 状态 | UI |
|---|---|
| loading | 列表区 skeleton 行 ×5 |
| 空(全部) | 空态卡:图标 + 「还没有提示词」 + 「新建提示词」CTA |
| 空(搜索/筛选) | 「没有匹配的提示词」+ 清除筛选 + 「新建提示词」CTA |
| 空(回收站) | 「回收站是空的」 |
| 回收站非空 | 工具行「清空回收站」(AlertDialog 红主钮;契约 `prompts.emptyTrash` → `{ purged }`,六层齐;成功 toast 报条数) |
| error | 错误卡 + 重试 |

分页:列表尾部滚动哨兵(`IntersectionObserver` 提前一屏取下一页;无 IO 的环境退化为「加载更多」钮)。大库虚拟化(`@tanstack/react-virtual`,features 尚未声明依赖)登记为后续卡。

### 4.5 遗留差值(随 M4d 抛光收口)

- [ ] 标签管理器(TaxonomyManager)移动端切 Sheet。
- [x] 回收站内永久删除:契约 `prompts.purge`(仅已软删行合法),行动作「永久删除」+ AlertDialog 红主钮;桌面直删 SQLite(FTS 同步清理),云端硬删 PG 并广播 delete 同步事件。移入回收站维持不确认(可恢复,承旧)。
- [x] 2026-09-06(B1-T1):封面缩略、详情 Inspector/Sheet、行点击开详情、清除筛选/新建 CTA、清空回收站、⌘S、更新时间、复制 Check、`prompt-highlight` 接收端(存为提示词 → 跳库高亮)、⌘K / `/` 聚焦搜索。剩余:大库虚拟化;「相关作品」的 `promptId` 过滤下推到服务端(当前拉最近 100 回合客户端过滤,属生成域)。

---

## 5. 生成历史(M4c ✅;2026-09-06 B1-T2 完整性收口,ui-parity/05 §7 九项全部销账)

### 5.1 布局(承旧 `GenerationHistoryWorkspace`)

```text
筛选栏(sticky):搜索 | 状态▾ | 模型▾ | 时间预设▾ | 清除(计数) 
────────────────────────────────────────────
列表(行式,线程缩进):
 [缩略图] 提示词(单行截断) StatusBadge  模型·耗时·时间  [操作组]
   └▶ [缩略图] 微调子回合(缩进 26px + 拐角连接线)
────────────────────────────────────────────
分页:「加载更多」按钮(cursor 分页)
```

详情:点击行 → 右侧 Inspector(桌面 ≥lg 内嵌面板,8px 右移淡入;<lg 及移动 Sheet):大图预览 + 完整提示词/反向词(可复制)+ 参数区(固定次序:模型 / 尺寸 / 比例 / 质量 / 种子 / 成本 / 用时 / 创建时间,值未知即不渲染该行;契约字段 `durationMs` / `seed`,云端 seed 上游不回报故为 null)+ 错误区(归一标题 + 说明 + 「建议:xxx」,`history-detail-error-action`;上游原文与标题不同时另给原始码 · 原文一行作诊断)+ 微调链区(「来自」父记录 + 「派生 n 条」子记录,均可点跳选中;父记录不在结果集时降级「微调(来源记录已删除)」)+ 动作(重试按错误码目录 `canRetryGeneration` 放开、删除、跳到所属会话;桌面另有「在文件夹中显示」「复制图片」,`canRevealLocalFile` 门控,Lightbox 同享)。

### 5.2 筛选栏(承旧 `HistoryFilterBar`)

- 搜索:提示词/模型/错误信息,300ms 防抖,可清空。
- 状态 select:全部/排队/生成中/成功/失败/已取消。
- 模型 select:从结果集聚合的动态选项。
- 时间预设:今天/7 天/30 天(默认)/全部/**自定义区间**(起止日期,`from`/`to` ISO 全链下推)。
- 「清除筛选」仅在有活动筛选时出现,带活动计数 Badge。
- 契约映射:`GenerationHistoryQuery`(search/status/providerModel/from/to/cursor)。

### 5.3 行与状态

- 行左缩略图:成功 = 首资产图(lazy);失败/无图 = ImageOff/History 图标;运行中 = Spinner。
- StatusBadge 色调:成功绿/失败红/取消灰/运行中主色。
- 行元信息(状态徽标之后,各项以淡「·」真实 DOM 节点相隔,数字 `tabular-nums`):模型 · 成本「x 积分」 · 用时「ys」 · 错误标题 · 「+n 微调」 · 创建时间。成本与用时**仅成功行**渲染;`costPoints` / `durationMs` 为 null 时整项不渲染(不伪造 0);失败行以归一错误标题占位。
- 操作组(hover 常驻,同 §4.2 模式):重试(仅错误码目录允许,成功/拒绝/过期不给;取消一律可重试)、删除(回收站),运行中行为「取消」。
- 微调线程:`parentRunId` 归组缩进展示(只读,发起微调暂缓 §0.2);父记录不在结果集的孤儿子回合标注来源已删除。
- 列表状态矩阵:loading skeleton ×6 / 空「还没有生成记录,去工作台开始第一张图」+CTA / 筛选空「没有匹配的记录」+清除 / error+重试。
- 分页:滚动哨兵(`history-load-sentinel`,IO 提前一屏取下一页,无 IO 退化为按钮);大列表虚拟化登记为后续卡(同 §4.4)。

### 5.4 回收站与维护

Tabs 或筛选切换进回收站视图:行只留「恢复」与「永久删除」(AlertDialog,红主钮)✅。永久删除契约 `generation.purge`(仅已软删终态行合法):桌面硬删 run 行(资产行级联)并清理磁盘资产文件;云端硬删 PG 行并尽力清理对象存储(失败留孤儿对象给保留策略,不阻塞操作)。

回收站 tab 下另有维护工具行(`HistoryMaintenanceBar`):左侧磁盘用量(HardDrive + `formatBytes` + 文件数 + 刷新;`generation.getStorageUsage`,`canRevealLocalFile` 门控,Web 不渲染),右侧「清理」DropdownMenu 三项(清 30 天前 / 清失败与取消 / 清空回收站),各带 AlertDialog;前两项软删入回收站、图片文件仍保留,第三项永久删除并清理磁盘/对象存储。契约 `generation.cleanup({ scope })` → `{ affected }` 六层齐,成功 toast 报条数。桌面可选方法 `getStorageUsage` / `revealAsset` / `copyAssetToClipboard` 云网关不实现。

---

## 6. 设置(2026-09-03 分区注册表 + 分组导航交付;此前单列卡片流已退役)

### 6.1 布局(已交付)

- **md+**:左分组导航(220px,顶部搜索框)+ 右分区面板,容器 max-w-5xl;导航常驻,面板只渲染当前分区(其余分区不进 DOM)。
- **移动**:一级分区列表(带右缘 chevron)→ 二级分区面板(顶部返回行 + 分区标题);侧栏账号菜单深链直接进二级。
- **面板头**:仅移动端渲染(返回 + 标题定位);md+ 由分区内各卡片自述标题与描述,不重复面板头。
- **分区记忆**:离开设置再回来停在上次分区(`useSettingsNav`,内存态);记忆分区在当前宿主不可用时兜底首个可用分区。
- **搜索**:按分区标题 / 描述 / 关键词过滤导航(`filterSettingsSections`);无命中显示「没有匹配」;当前分区被过滤掉时面板保留不闪空。
- **深链**:`settings-account` / `settings-connections` 意图落到对应分区并短暂点亮面板(ring);宿主无目标分区(如 Web 无连接分区)兜底账号分区。

### 6.2 分区注册表(`packages/features/src/settings/sections.tsx`,唯一目录)

分区由 `SETTINGS_SECTIONS` 声明:分组 / 标题 / 描述 / 图标 / 搜索关键词 / capability 门(`isAvailable`,宿主不具备即整个分区不注册,D2 无死入口)/ 深链意图(`intents`)/ `render`。分组顺序 `SETTINGS_GROUPS`:通用 → 访问 → 应用。

| 分组 | 分区 id | 内容 | capability 门 | 状态 |
|---|---|---|---|---|
| 通用 | `appearance` | 外观卡:主题 / 动效三档 / 界面密度两档(带图标 `ToggleGroup`)+ 语言 Select;`ThemeSync` / `MotionSync` / `DensitySync` 宿主同处挂载;system 档 hint 挂载后读 `matchMedia` 动态显示当前解析值;偏好读取失败给「重试」钮。**生成参数卡**(`GenerationDefaultsCard`):默认比例(Composer 同一目录 + `auto`)/ 默认质量(自动/标准/高清/超清,与 Composer 文案一致);写入 `AppPreferences.defaultAspectRatio/defaultQuality`,新会话/空草稿继承,用户显式改过的草稿字段不被覆盖 | 恒真 | ✅(密度 token 已定义,列表行消费随后续卡) |
| 访问 | `account` | 登录(账密表单)/身份积分卡/兑换/退出(§7.1) | 恒真 | ✅ |
| 访问 | `sync` | 云同步开关(登录 ≠ 同步)/状态/立即同步(§7.3) | `hasCloudSyncControls` | ✅ |
| 访问 | `connections` | 生图连接卡 + Agent 文本连接卡(§7.2)+ 豆包免费试用卡(§0.2) | 三能力任一 | ✅ |
| 应用 | `data` | 回收站入口(提示词/生成历史)+ 已归档对话列表(刷新/恢复/软删)+ **本机数据面**(`DataStorageCard`):数据库备份(立即备份 / 列表 / 逐份恢复 → 确认覆盖并重启 `system.relaunch`)、存储位置(白名单 id,`displayPath` 是本域唯一路径出参;复制 / 打开)、诊断日志(按需读取,200KB 截断)、危险区(确认短语「清空全部数据」;清空前自动 `pre-reset` 快照并回显文件名) | 分区门:宿主接线 `onOpenScreen`;本机数据面:`hasLocalDataManagement` | ✅ |
| 应用 | `about` | `AboutCard`:品牌面板 + 版本行(桌面:版本 / 库结构版本 / 平台;Web:「Web 版」)+ 复制版本信息 / 反馈信息 + 查看文档(桌面 `system.openProductDocs`,随包本地文档;Web 无 system 域不渲染该行)+ 第三方声明 Dialog(`settings/third-party-notices.ts`,形状由 `thirdPartyNoticeSchema` 约束)+ 快捷键表(`shell/shortcuts.ts` `PRODUCT_SHORTCUTS` 单源)。更新检查体系仍属暂缓域(§0.2) | 恒真(双端) | ✅ |

数据面:桌面新 `system` 域(契约 `packages/contracts/src/system.ts`,`V25_METHODS_BY_DOMAIN.system` 11 方法:`getAppInfo · listBackups · createBackup · restoreBackup · listStorageLocations · openStorageLocation · readDiagnosticLog · clearAllData · openExternal · openProductDocs · relaunch`),出参除 `displayPath` 外 path-free,错误 message 经 `pathFreeMessage()` 过滤。`SystemGateway` 为可选(`gateway.system?`),Web 网关不实现。

### 6.3 控件约定

- 每分区 = 若干控件卡(`Card`:标题 + 描述 + 内容);行式控件:左标签+描述,右控件(Switch/Select/Button/`ToggleGroup` 段控件)。段控件在 <sm 铺满行宽、字号/内距收一档(`settings/segment-classes.ts`),sm+ 恢复 w-fit。
- 危险区(清数据等)`border-destructive/30` 卡;不可逆动作用**确认短语输入**(强于 AlertDialog),短语匹配后按钮由 outline 转 destructive 填充;其余破坏性动作 AlertDialog。
- 本机数据面只在 `hasLocalDataManagement` 宿主渲染。
- 所有写偏好即时生效 + 乐观更新,失败回滚 + toast;偏好读取失败态必须给「重试」。
- 偏好 patch 契约 `appPreferencesPatchSchema` 由完整 schema 剥掉 default 后 partial 派生:缺席字段保持缺席(zod 4 `.partial()` 会回填 default,桌面 bridge 先 parse 再 spread 时会把其它偏好打回默认)。

### 6.4 新增设置项的开发流程(规范;走线细则见 V25-FEATURE-DEV-GUIDE §8-C)

1. **归属判定**:属于已有分区 → 在该分区的卡里加一行控件,或在其 `render` 里加一张卡;需要新分区 → 走第 2 步。
2. **注册分区**:在 `SETTINGS_SECTIONS` 追加一条定义(分组/标题/描述/图标/关键词/capability 门/深链意图/render)。宿主差异只允许经 `isAvailable` 的 capability 表达;禁止在分区内探测宿主。
3. **数据面**:控件的数据走该域自己的 hooks(契约 → gateway → hooks),不在 sections 注册表里做数据编排。
4. **同步本节**:更新 §6.2 表格;有意差异登记 §9。
5. **测试**:sections 注册表测试(可用性/意图/搜索)+ 分区内控件的就地单测;涉及双端行为补 Web/Electron 设置 E2E;布局变化刷新设置视觉基线(§7.3 快照纪律)。
6. **导航/搜索/深链/记忆无需改动**:由 SettingsScreen 统一承载,新分区自动获得。

---

## 7. 账号与 AI 连接(M4d ✅)

### 7.1 账号面板(`AccountPanel`,设置页「账号」卡)

- **登录方式(纠正旧稿)**:双端同一账密表单(用户名/密码,登录↔注册切换)。凭据事实源是自托管 New API 网关,云端 `apps/api` 经 Better Auth `sign-in/new-api` 委托校验,本服务不存密码;Web 得同站 cookie,桌面得 bearer token(主进程 safeStorage 落盘)。旧稿「桌面 OAuth 回跳 / Web 登录页面」作废——没有第三方 IdP,独立登录页与浏览器回跳是多余间接层。
- 未登录:账号卡内联表单(用户名/密码/提交);登录失败错误红字在表单内(按 I4 表单口径,不用 error 卡)。
- 已登录:身份行(首字母头像 + 用户名 + 积分 readout + 可生图/余额不足 Badge)+ 兑换码行(输入框+兑换钮,成功 toast + 余额即时刷新)+ 退出登录(AlertDialog 确认)。
- 积分显示:`quota ÷ ACCOUNT_QUOTA_PER_POINT`(50000),最多一位小数(`formatPoints`)。
- 登录/退出后全量 invalidate/reset 查询缓存:登录前失败的会话/数据查询自动重取,退出不残留上个会话数据。
- 已连接应用列表(MCP 授权撤销):**推迟**——云端尚无连接列表端点,随云 MCP 管理卡交付。
- 壳侧栏底部 `AccountFooter`:官方黑白标触发钮 + 向上身份菜单(登入/登出为默认动作,桌面含「更多连接」切换子菜单),形态详见 §2.2-5;「账户与额度」「登录」深链本分区(滚动 + 高亮)。

### 7.2 AI 连接管理(`AiConnectionsPanel`,桌面专属,`hasLocalAiProviders` 开关)

- 列表行:行首 6px 状态点(缺 Key=`--warning` / 近测通过=`--success` / 未测=`--muted-foreground`/40%)+ 名称 + 「默认」Badge(活动连接)+ 副行(模型 · Base URL · 密钥尾号/未配置)+ 常驻操作(设为默认/测试/编辑/删除)。列表 `ORDER BY is_active DESC`,`generation.listProviders` 同序,Composer 未显式选择时预选 `providers[0]` = 默认连接。
- 新建/编辑 Dialog:名称、Base URL、模型(可输可选 `Combobox` + 「拉取模型列表」,`*.listModels`;草稿态凭 `{ baseUrl, apiKey }` 亦可拉取,Key 只在本次 IPC 往返里由主进程拼 Authorization,不落盘不入日志)、API Key(密文输入,只写不回显;编辑留空=不动)。未保存改动关闭需确认(`use-discard-guard`);新建 Dialog 内可草稿测试(不落库);无 Key 时拉模型/测试前置提示并聚焦密钥框。空态与 Dialog 顶部显示接入预设 chips(`connection-presets.ts`,承 v2.1 `AI_CONNECTION_PRESETS`)。类型不设 select:v2.5 新建一律 openai-compatible,存量异型数据兼容展示。
- 「测试连接」钮 ✅:行内 Plug 图标钮;主进程 `aiProviders.test` 真发探测(GET `{baseUrl}/models` 带 bearer,8s 超时),结果 `role="status"` 行内展示(成功「连接正常 · NNNms」绿字 tabular / 失败可读引导红字),不产生生成费用。删除同时清钥匙链(单测断言)。
- Key 只经主进程 safeStorage(keychain),SQLite 只存 has_key/key_suffix 展示位;渲染层不落任何密钥(红线承 v2.1)。
- 删除:AlertDialog(密钥一并删除,历史保留);删除默认连接时最近更新的一条自动接管默认。
- 数据面与工作台 Composer 的 Provider 下拉同源(SQLite providers 表),增删改后两处同时失效刷新。
- **Agent 连接卡**（`AgentConnectionsPanel`，2026-09-03，`hasAgentConnections` 开关，桌面专属）：与生图连接卡并列于同一「连接」区，共用 `ConnectionsPanel` 泛化面板（列表行 / 新建·编辑 Dialog / 设为默认 / 测试 / 删除），文案与 testid 前缀独立（`settings-agent-connections-card`、`agent-connection-*`）。数据面 `gateway.agentConnections`（6 方法）接主进程 `AiConnectionStore`——与设计方案 Agent（Analyst / Compiler / Reviser）和 Skill runtime 同一事实源，v2.1 已配置的文本连接直接出现；「默认」即 Agent 实际使用的连接。账号托管连接显示「账号托管」Badge，编辑/删除禁用。Key 同样只经主进程 keychain，渲染层只见 hasKey/keySuffix。2026-09-06(B1-T3)两卡同享模型拉取 combobox / 脏表单守卫 / 设为默认 / 状态点 / 预设 / 草稿测试,`aiProviders` 与 `agentConnections` 现各 7 方法(含 `listModels`)。仍未覆盖:Agent/生图 key 失效后的可解释引导(S01);「需要重启应用」逃生门随壳收尾接 `useRelaunchApp()`。

### 7.3 云同步卡(`CloudSyncPanel`,桌面专属,`hasCloudSyncControls` 开关;M4e ✅)

- **登录 ≠ 同步**:开关由用户显式打开;登录/登出/换账号自动关闭开关,须重新打开(不静默替新账号同步)。
- 未登录:开关禁用 + 副行「登录账号后可开启」。
- 关闭态(已登录):开关可用 + 副行「开启后提示词、文件夹与标签将同步到云端」。
- 开启态:副行「用户名 · 上次同步时间」;状态区 = 状态 Badge(已是最新/同步中/有冲突/出错)+ 待推送计数 + 冲突计数 + 「立即同步」钮(同步中禁用+Spinner);错误时红字详情。
- 开启即全量同步一轮(bootstrap→pull→push);此后写路径防抖 2s 触发 + 60s 兜底轮 + 启动恢复。
- 关闭只停调度,本地数据与账号记录不动(重开免重新 bootstrap)。
- 同步动作成功后失效提示词缓存(pull 可能带回远端变更)。
- **状态与 Electron E2E**:同步同意明确分为 `unset`、`enabled`、`paused`;Electron sync E2E 已验证 `unset`/`enabled`/`paused`/`conflict` 四态。`unset` 或 `paused` 时 transport 为 0，不发生同步传输。首次显式开启顺序固定为 `bootstrap → pull → push`;暂停期间本地 mutation 与 usage 继续累计，恢复后可继续同步。冲突必须逐条处理，逐条提供 `local`、`remote`、`duplicate` 解决动作，全部处理后状态回到 `idle`。登出再登录不丢失本地账本、待同步 mutation、usage 累计或冲突记录，且不会为新会话静默开启同步。
- **安全与视觉证据**:secret plaintext scan 通过;API key/bearer token 不出现在渲染层、SQLite、日志或导出文件。`sync-unset`、`sync-enabled`、`sync-paused`、`sync-conflict` 四张视觉截图已人工检查。

---

## 8. 交互与反馈统一约定

- **I1 加载**:首屏结构化 skeleton(行/卡同形);局部刷新用 Spinner;按钮内联 loading = Spinner 替换图标 + 禁用。
- **I2 动作可达性**:任何动作不得只藏在浮层(下拉/右键)里;主路径 = 常驻钮(hover 渐显视为常驻),浮层是补充。移动端(无 hover)操作组常显。
- **I3 破坏性动作**:不可恢复的(永久删除/清空/退出登录)必须 AlertDialog;可恢复的(移入回收站/归档)直接执行 + toast(带撤销时限)。
- **I4 错误**:查询错误就地错误卡(标题+消息+重试钮);变更错误 toast(保留用户输入);表单校验错误字段下红字。
- **I5 空态**:图标 + 一句引导 + 主 CTA(能创建的场景必须给 CTA);筛选空态给「清除筛选」。
- **I6 乐观更新**:列表内 CRUD 一律乐观 + 失败回滚;跨屏影响(如生成完成)靠 query invalidation。
- **I7 快捷键(桌面/Web 物理键盘)**:⌘N 新设计、⌘K 搜索提示词(全局:切到提示词库并聚焦搜索框,`shell/AppShell` 接线)、`/` 聚焦搜索框(提示词库非输入态)、⌘S 保存提示词(编辑器有未保存修改时)、Enter 发送、Shift+Enter 换行、Esc 关浮层/取消行内编辑。全部登记在 `packages/features/src/shell/shortcuts.ts` `PRODUCT_SHORTCUTS`(单源;关于卡快捷键表与 `shortcuts.test.ts` 接线镜像都读它)。
- **I8 testid**:`<域>-<对象>-<动作>` 蛇形连字;列表行 `<域>-row-<id>`;E2E 只允许用 testid/role 定位。
- **I9 可访问性**:图标钮必须 `aria-label`;活动导航 `aria-current`;浮层焦点圈闭 + Esc 关闭 + 焦点归还触发器。

### 8A. 设计方案(P01 迁移中，Desktop 入口已开)

> **状态**:`doing`(P01)。共享层与挂载已有源码与定向单测——`packages/contracts` 方案合同、`packages/features/src/design-schemes` 共享屏、Desktop v25 IPC/SQLite、`.musefold.design` 安全 staging/archive/domain 导入导出、Web API/client 确定性 CRUD。**P01-7 入口挂载已落地但 capability 按宿主分流**：Desktop `hasDesignSchemes=true`，侧栏注册「设计方案」并挂载详情、导入与 `media://` 封面解析；Web `/design-schemes` 与 `?scheme=<id>` 路由代码存在，但 `WEB_CAPABILITIES.hasDesignSchemes=false`，不向用户注册入口。Desktop canonical run/cancel/event transport 已部署；本轮新增 text-only `prepareRun`，由主进程从 exact revision、来源绑定和 Provider 事实生成 `desktop-fixed-v1` 四步计划并在执行前复核。**Desktop Workbench run/cancel 接缝已接通**（2026-09-01）：`designSchemes` 集成 prop 由单一宿主提交处理拆为 `onRun / onCancelRun / onCreate / onModify` + `runInputSupport`；桌面注入 `onRun`（prepareRun → run，await 终态）与 `onCancelRun`（复用同一 executionId），`runInputSupport='text-only'`。Composer 行为：运行中提交钮转停止钮（Esc 同义），成功后正文/槽位/引用清空、附件保留多轮；`blocked/failed` 在 Composer 上方就地显示 `scheme-submit-error` 并保留输入；取消为中性提示；含图片槽位的方案或已附参考图在 text-only 宿主下提交禁用并解释「当前环境的方案运行暂不支持图片输入」。真实 Electron 取消用例已证明方案经 IPC 进入回环 generation runtime 后，停止动作可令 Workbench generation ledger 与 Design Scheme run ledger 同时收敛为 `cancelled`，并保留 Composer 输入、避免提交方案资产。**Desktop Workbench Agent 缝已接通**（2026-09-03）：桌面注入 `onCreate`（brief 与历史来源身份 → 主进程 Agent Compiler 落草稿；brief 含 GitHub 地址时在 Composer 就地拒绝并解释）与 `onModify`（挂载附件 exact revision + 修改要求 → Reviser 产出待验证草稿，正式版本保持可用）；提交期间提交钮转 spinner，成功后正文清空、创建态清除 / 附件保留，失败在 `scheme-submit-error` 就地解释并保留输入。无 Agent 文本连接时主进程返回 `DESIGN_SCHEME_AGENT_AI_UNAVAILABLE`（可在「设置 → Agent 连接」配置，与 v2.1 文本连接同源，见 §7.2）。**GitHub Skill 来源已闭环**（2026-09-03）：brief 中粘贴的仓库地址由桌面提取为来源，主进程解析后停在安装确认；共享 `SourceInstallConfirmDialog`（AlertDialog，展示仓库、固定 ref/commit、文本/图片文件数与前几个文件名、许可证、「只读取规则、提示词与参考图片，不会执行仓库脚本」）提供「确认引入」/「取消创建」，决定经 `confirmInstall` 送回；多来源逐个确认；取消按中性提示处理。Agent 创建/修改期间 Composer 上方显示一行进度（Spinner + 「Repository Analyst 正在分析仓库…」/「Scheme Compiler 正在编译方案…」等 state 文案或运行中 trace 标题，`aria-live=polite`），终态即消失。**参考图运行已接通**（2026-09-03）：桌面 `runInputSupport=text-and-images`，Composer 参考图托盘里的就绪图片随「试运行 / 按方案生成」以上传暂存 id 提交，主进程按方案图片槽位声明顺序分配（必需槽位不足、超出全部槽位或方案无图片槽位时在 `scheme-submit-error` 就地解释并保留输入）；含图片槽位的方案不再禁用提交。**仍未完成**：Web run/assets/package、成功出图 E2E 与完整视觉证据；不把取消路径扩大解释为完整用户运行闭环。

- **入口与导航**:侧栏主导航(§2.2)已注册设计方案项(随 `hasDesignSchemes` capability);Composer「+」菜单的「寻找设计方案」与附件「查看详情」已通(详情深链 = `scheme-detail` screen intent / Web `?scheme=` 查询参数);历史来源项随本域恢复(§9-D2)。`/design-schemes` Web 路由与 Desktop 视图挂载即 P01-7。
- **屏幕结构**(共享 features 已有,承旧版布局):顶部控制台(scope tabs「我的方案/发现」+ 搜索 + 刷新 + 新建)→ 分节列表(正式/草稿两区,行 = 56px 封面 + 名称/保真度徽标 + 摘要/来源 + 主动作 + hover 删除)→ 右栏 Inspector(lg+ aside,窄屏 Sheet,参照历史 Inspector 模式);详情为整屏视图(文档分节 + 试运行相册);市场安装确认 = AlertDialog。
- **状态矩阵**(承 ui-parity/06 §5.1,当前唯一验收基准,不另发明状态):我的方案/发现/Inspector/详情/试运行相册各覆盖 loading/error/empty/ready;生命周期另覆盖 approval/pending、blocked、cancelled、failed、conflict/version mismatch。
- **交互约定**:遵守 §8 I1–I9(常驻动作组、破坏性动作 AlertDialog、就地错误 + 重试、空态给 CTA、testid `<域>-<对象>-<动作>`);组件只用 `packages/ui` 原语、Lucide 出口与语义 token。
- **差异登记**:本节不引入与旧版的有意差异;已批准差异见 §9(D2 入口恢复)。通用分享/导入与 Skill runtime 会话仍按 §0.2 暂缓。

---

## 9. 与旧版差异登记表(有意变化,已批准)

| # | 差异 | 旧版 | 新版 | 理由 |
|---|---|---|---|---|
| D1 | 列表行动作形态 | 部分屏用下拉菜单收纳 | 常驻操作组(hover 渐显) | 触屏可达性 + E2E 稳定性(M4a 教训);信息架构不变 |
| D2 | 设计方案/Skill/豆包入口 | Composer「+」菜单与侧栏入口 | 设计方案随 P01 恢复；Skill runtime 入口继续暂缓；豆包保留账号/连接区可达薄入口 | 用户已将设计方案纳入本轮迁移；Skill 与豆包专属 renderer 仍按 §0.2 冻结/暂缓，禁止死入口 |
| D3 | 单次生成张数 | 桌面可选 1/2/4 | 锁 1 张 | 契约 `count: literal(1)`(云端成本闸);多张随后续契约版本恢复 |
| D4 | 反向提示词位置 | 设置弹层内 | 同旧(弹层内) | M4b 首版曾常驻,按本规范收回弹层 |
| D5 | 顶栏(Web 大屏) | 常驻 ProductTopbar | 取消常驻,仅侧栏收起时给展开钮 | 与桌面口径统一,最大化内容区;额度 readout 移侧栏账号区 |
| D6 | 会话未读/置顶存储 | localStorage 偏好 | 同机制承接(platform 偏好接口) | 跨端同步待后续版本 |
| D7 | 自定义比例传输形态 | RatioPicker 支持,domain 内部用 `custom:W:H` 前缀 | UI 已恢复(§3.2 自定义行);v2.5 数据流只传 canonical `W:H`(每边 1–99 无前导零,比例限 1:4–4:1),`custom:` 前缀不落草稿/请求 | 契约与 UI 共用相同比例边界;是否自定义由「值不在预设目录」推导,无需前缀通道,同一比例不会产生多个幂等指纹 |
| D8 | 桌宠/朱点 | 常驻 | 冻结不迁 | 用户指示(2026-08-28) |
| D9 | 登录形态 | 独立登录屏(桌面)/登录页(Web 设想) | 设置页账号卡内联账密表单,双端同一份 | 凭据委托 New API(账密),无第三方 IdP;内联表单少一跳,四端一致 |
| D10 | 设置布局 | 分组导航工作区 | 已按 §6.1 目标形态交付(分组导航 + 分区面板,现 6 分区;2026-09-03 切换,此前单列卡片流退役) | 分区达阈值后与旧版形态一致,不再是差异;保留行号供历史引用 |
| D11 | AI 连接类型选择 | 新建时可选类型 | 固定 openai-compatible | v2.5 唯一受支持协议;豆包网页等随各自域后续排卡 |
| D12 | Web↔API 部署形态 | 分域(CORS) | 同源(宿主反代 /api/*) | 会话 cookie 同站直用,免 CORS/第三方 cookie 一整类问题;API 刻意不开 CORS |
| D13 | 工作台空态快捷建议 | 三行逐字横滚动画 + 英文水印背景(大段自定义 CSS) | **已撤销**(2026-08-29):水印 / 横滚 / mark 96px 按旧值恢复,减少动效双通道降级为静态三行(ui globals.css token 化) | 用户要求承旧;差异不再存在,行保留供历史引用 |
| D14 | Prompt 引用传输与快照 | renderer 可携带展示文本/标题参与后续编排 | renderer 只传 `promptId/scope/expectedVersion/range`;Web 服务端或 Desktop 主进程按 owner/workspace 解析,生成账本存不可变 title/text/version 快照 | 客户端文本不是权威数据;阻断越权/伪造,同时保证源编辑或删除后历史不漂移;功能结果与入口不变 |
| D15 | compact 抽屉账号区 | 点击账号区即关闭抽屉 | 点击账号区保持抽屉,完成身份/连接菜单动作后由动作自身导航或关闭 | 当前账号菜单以抽屉内触发器为锚,提前卸载会使登录/切换入口不可操作;导航、新设计和会话仍按旧语义自动关闭 |
| D16 | macOS brandInset 几何 | 展开/收起顶栏使用不同 inset,原生全屏回落 12px | v2.5 统一由单一 `brandInset` prop 承载:非全屏 78px、原生全屏 12px,非 macOS 0px | 保留交通灯让位和全屏回落结果,减少共享 AppShell 的平台分支;窗口状态走只读宿主信号,不进入业务数据通道 |
| D17 | 归档删除语义 | 旧版归档列表删除为永久删除 | v2.5 归档列表删除沿 `removeSession` 软删,生成 run/history 保留,真正 purge 延后 D02 | 与当前会话生命周期和数据保留策略一致,避免归档入口直接造成不可逆清理 |
| D18 | 界面密度消费范围 | 密度 token 即时作用于全部列表行/导航 | 2026-09-06 恢复 7 个 `--density-*` token + `data-density` 同步 + 设置两档 chips;提示词/历史/设置行与会话列表的 token 消费及紧凑态快照随后续卡 | 分两步落地避免与并行改行的卡冲突;token 先定义,消费点表见 MIGRATION-CARDS U05 |
| D19 | 「清空全部数据」边界 | 清七类业务表 + `prompts_fts` | 增清 `workbench_sessions` / `workbench_drafts`(十表 + fts) | v2.5 单账本下 runs 的 `workbench_session_id` 是 set null,只清 runs 会在工作台留下一串无轮次空对话;Provider / 密钥 / 图片文件仍不在边界内 |
| D20 | 第三方许可清单数据源 | 桌面 renderer 内静态表(桌面 only) | `packages/features/src/settings/third-party-notices.ts`(双端同一份),形状由 contracts `thirdPartyNoticeSchema` 约束 | 纯静态许可数据,双端都需可达;走 IPC 只多一跳,合规要求 Web 也能看到 |
| D21 | AI 连接编辑形态 | master-detail(左列表右表单) | 列表 + Dialog(新建/编辑),行首状态点 + 常驻操作 | 与提示词/历史屏的「列表 + 浮层」语法统一;信息与动作集合不变,D11 类型固定同时保留 |
| D22 | 历史「相关作品」过滤位置 | — (旧版无此面板) | 提示词详情拉最近 100 回合客户端按 `promptId` 过滤 | `GenerationHistoryQuery` 尚无 `promptId`;历史很长会漏,下推服务端登记为生成域后续卡 |

--- 组件复用矩阵

### 10.1 `packages/ui`(shadcn 原语,全端共用)

`button` `input` `textarea` `select` `dialog` `alert-dialog` `sheet` `dropdown-menu` `popover` `tooltip` `badge` `tabs` `card` `switch` `skeleton` `spinner` `scroll-area` `separator` `sonner(toaster)` + `icons`(lucide 唯一入口)。

新增原语必须经 shadcn CLI 装入 ui 包,禁止在 features/宿主内新建平行原语。

### 10.2 `packages/features`(屏幕与产品块,四端同一份)

| 模块 | 导出 | 消费方 |
|---|---|---|
| `app-shell` | `AppShell` `SidebarNav` `SessionListPanel` `MobileTabBar` | 两宿主 |
| `prompts` | `PromptLibraryScreen` `PromptListRow` `PromptEditorDialog` `TaxonomyManager` + hooks | 两宿主 |
| `workbench` | `WorkbenchScreen` `GenerationTimeline` `Composer` `SessionPicker` `PromptReferencePanel` `PromptReferenceDock` + hooks | 两宿主 |
| `history`(M4c) | `HistoryScreen` `HistoryFilterBar` `HistoryRow` `HistoryInspector` + hooks | 两宿主 |
| `design-schemes`(P01 迁移中,§8A) | `SchemesScreen` `SchemeControlDeck` `SchemeInspector` `SchemeDetailView` + hooks | 两宿主代码挂载；Desktop 入口开启(`hasDesignSchemes=true`)且 Workbench 运行缝 `onRun/onCancelRun`（含参考图）与 Agent 缝 `onCreate/onModify`（含 GitHub 安装确认）已接通，Web capability 关闭；Web 资产/包面与成功出图 E2E 待后续卡 |
| `settings` | `SettingsScreen` + 分区注册表 `sections.tsx` + 分区卡(`AppearanceCard` `GenerationDefaultsCard` `DataStorageCard` `AboutCard` …)+ `DensitySync` + system hooks | 两宿主(本机数据面 `hasLocalDataManagement`) |
| `account`(M4d/M4e) | `AccountPanel` `ConnectionsPanel`(泛化)→ `AiConnectionsPanel` / `AgentConnectionsPanel` `CloudSyncPanel` `AccountFooter` + hooks + `connection-presets` / `connection-status` | 两宿主(连接/同步面桌面 only,能力开关控制) |
| `onboarding`(U01,§2.6) | `OnboardingFlow` + `useOnboardingGate` / `useCompleteOnboarding` | 两宿主各一行挂载 |

宿主差异一律经 `MusefoldGateway` 能力开关(`PlatformCapabilities`)表达,禁止在 features 内写 `isElectron` 分支。

### 10.3 旧代码处置

各域垂直切换完成时,同域旧实现(`apps/desktop/src/features/<域>`、`packages/product-ui/<域>`、`apps/web/src` 对应视图)与旧测试同卡删除;`packages/legacy-ui` 于 M5c 整体退役。

---

## 11. 验收口径

每个 M4 卡交付时对照本文件逐屏核对:

1. 布局与 §2–§7 规格一致;差异要么修掉、要么补进 §9 登记。
2. 状态矩阵全覆盖(loading/empty/error/ready 至少四态有 UI,不允许白屏或悬空 Spinner)。
3. Playwright E2E 覆盖主路径 + 视觉快照(web-desktop / web-mobile / electron 三形态)。
4. `pnpm run check` 全绿;组件无硬编码色值(抽查)。
5. Electron sync E2E 覆盖 `unset`/`enabled`/`paused`/`conflict`、`unset`/`paused` zero transport、首次同步顺序、暂停期间 mutation/usage 累计、逐条 `local`/`remote`/`duplicate` 冲突解决、登出再登录保留语义。
6. secret plaintext scan 通过;四张同步视觉截图已人工检查。
