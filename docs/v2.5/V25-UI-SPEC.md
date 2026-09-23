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
| 通用分享/导入 | 暂缓 | 设计方案专用 `.musefold.design` 导入/导出随设计方案域迁移(P01:Desktop 安全 staging/archive 与 domain 导入/导出已接线,B4-T5 E2E 已验收;通用分享/导入本体仍暂缓) |
| 命令面板(⌘K) | 暂缓,壳预留入口 | 顶栏搜索按钮先跳提示词库搜索,后续接命令面板 |
| 微调(refinement)链 | 暂缓至 M4c 后评估 | 历史屏先展示 parentRunId 线索,不提供发起微调入口 |
| 归档会话浏览 | 已实现(设置·数据卡);B76回收站扩展进行中 | 归档列表仍支持刷新、恢复与软删;独立会话回收站按§6.4接入恢复/永久清理,生成记录保留 |

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
| (新增,无旧对应)`--segment-on` | 段控件(ToggleGroup)选中面 | `#ecece9`(=accent) | `#3a3d44` |

`--segment-on` 说明(2026-09 走查 P2):深色下选中面若沿用 `--accent`(#2a2c30)与轨道 `--card`(#25272a)仅差 ~5 灰阶,选中态近乎不可辨;提到 `#3a3d44`(Δ≈21 灰阶)。浅色与 accent 同值,外观不变。

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
4. **「对话」分节 + 会话列表**(滚动区,详见 §3.3)。行尾静息态显示相对时间(刚刚/n 分钟/n 小时/n 天/M月D日,`session-updated-at`),hover/focus 让位给行动作组(display 切换,触屏常显动作)。行高/内距接 `--density-nav-y`;会话重命名 `maxLength` 120(与契约 `workbenchSessionSchema.title` 对齐)。`SessionListPanel` 读取失败特判 `WORKBENCH_SESSION_RESTART_REQUIRED` → 标题「需要重启应用」+「立即重启」(`useRelaunchApp`);Web 无 `system` 域降级为说明 + 重试。
5. **底部账号区**(`AccountFooter`,承旧 `SidebarAccessSwitcher` 语义收敛):
   - **通道定位**:官方账号 = 生图推荐主通道;豆包 = 免费试用通道;中转站 = 第三方自备通道。
   - **触发钮显示当前生效通道**(`data-channel` 三态,由活跃本地连接解析):
     - `account`(无活跃本地连接、活跃行是显式账号云连接 `type='musefold-cloud'`、或 Web):官方黑白标记(`MusefoldMark`,朱点降为单色 `[--primary:currentColor]`)+ 登录状态点(绿=已登录)+ 名称/积分(未登录=「登录账号 / 同步与云生图」);
     - `doubao`(活跃行 type=doubao-web):`DoubaoMark` + 「豆包 / 免费试用通道」;
     - `relay`(其余活跃行):Waypoints + 连接名 + 「中转站通道」。
     切换后即时更新(setActive 失效并刷新 aiProviders.list)。testid `account-footer` / `account-footer-signed-out`。
   - **菜单**:默认动作是登入/登出——未登录首项「登录 Musefold 账号」深链设置账户卡;已登录 = 名称/积分头 + 「账户与额度」+ 「登出」(AlertDialog 确认)。
   - **「更多连接」子菜单**(仅桌面 `hasLocalAiProviders`):官方账号(`MusefoldMark`)/中转站(Waypoints)/豆包(`DoubaoMark`)三行,**点击即切换活跃连接**(`aiProviders.setActive`,左下角显示与 Composer 预选跟随,toast 反馈);当前通道行显示勾选。官方账号行的切换落点是显式 `musefold-cloud` 行，主进程重验当前账号/服务/执行记录；旧 `managedBy='account'` 仅保留历史展示，不能作为身份凭证(未连接时进入设置完成账号云连接);中转站/豆包未配置时深链设置连接卡;尾行「连接设置」深链同卡。testid `account-menu-more/-official/-relay/-doubao/-connections`。
   - **齿轮钮**:直达设置,承 e2e `nav-settings` 契约。
   - 深链机制:`ScreenIntent` 除 `settings-account` / `settings-connections` 外支持 `{ kind:'settings-section'; section; highlight? }`(highlight 为可选 testid,短暂 `data-settings-highlight` + `scrollIntoView`)。旧两种意图仍作别名。

### 2.3 顶栏

- **Web ≥ md**:仅侧栏收起时在主区左上显示展开钮;不设常驻顶栏(承桌面口径,最大化内容区)。
- **Web < md(移动)**:常驻顶栏 = 抽屉触发钮 + 当前域图标/标题 + 搜索钮 + 额度 readout(Sparkles 图标 + 数字,`tabular-nums`)。抽屉使用 `Sheet` 左滑,宽 `min(320px,max(220px,100vw - 28px))`;打开时主工作面与底栏 `inert`,焦点圈闭,Escape/导航/新设计/会话打开均关闭,关闭后焦点归还触发前元素。
- **Electron**:系统标题栏区域为拖拽区(`drag-region`);Windows/Linux 渲染自绘窗口控制钮。主区不再叠加产品顶栏。Electron Win/Linux 自绘控件落在主区右上 32px 窄带(`AppShell.windowControls`),只放最小化/最大化⇄还原/关闭,不恢复 44px 产品顶栏(D5)。mac 用原生红绿灯。系统拖拽区除侧栏外,含内容顶 12px 带与设置全出血 32px 条(宿主 CSS `app-region`,features 只挂 `data-*`)。设置屏 `main` 的 32px 让位**仅当**存在 `[data-window-controls-band]`(Win/Linux);mac 交通灯已在侧栏品牌行让位,主区不再退 32px。B3-T3 已在有三钮时给主区预留 32×138 安全区(`data-window-controls-safe` + 宿主 CSS `padding-top: 32px`);mac/Web 无控件带、零新增 padding。**Windows 验证项**:布局已预留;darwin Electron E2E 控件带 count=0 时跳过几何;Windows 真机像素重叠仍未目测。

### 2.4 全局反馈设施(壳级 Provider)

| 设施 | 组件 | 约定 |
|---|---|---|
| Toast | `sonner`(ui 包 `<Toaster>`) | 右上(桌面)/顶部(移动);成功 2.5s 自动关,错误需手动关 |
| Tooltip | `TooltipProvider`(delay 300ms) | 已交付:`AppShell` 唯一 `delayDuration={300}`,屏内不再包 Provider |
| 确认对话框 | `AlertDialog` | 所有破坏性动作(删除/清空)必须走它,主按钮 destructive 色 |
| 对话框/抽屉 | `Dialog` / `Sheet` | 移动端表单优先 Sheet(底部滑出),桌面 Dialog 居中 |
| 花钱确认卡 | `AutomationConfirmCard`(`features/automation`,经 `features/shell` 导出) | 主进程闸门在预算不足或成本未知时广播确认请求,HTTP 请求就地挂起。形态是非阻塞浮层(桌面右下 / <sm 顶部铺满)而非 Dialog——不夺焦、不拦断用户当前动作。倒计时由契约 `AUTOMATION_CONFIRMATION_TIMEOUT_MS`(120s)从收卡时刻推导,到点即视为拒绝并撤卡;`resolved` 广播同样撤卡;多条排队只显首条 + 「还有 n 个等待确认」。挂载点与 `Toaster` 同级,仅 desktop-shell;`hasLocalAutomation=false` 渲染 null |

### 2.5 壳交付状态(M4b 收尾记录,2026-08-28)

- [x] 会话列表迁入壳侧栏「对话」区:`SessionListPanel` + `NewSessionAction`(features/workbench),双宿主经 `action`/`sessions` 插槽注入;活动会话为 zustand 共享 store(`useActiveSession`)。
- [x] 侧栏品牌行(`MusefoldMark` 承旧几何,朱点走 `--primary`)+「功能」分节标签 + 收起/展开(收起态主区左上展开钮)。
- [x] 「新设计」钮含 kbd 提示(⌘N / Ctrl+N)与全局快捷键绑定(组件内,双宿主自动获得;浏览器保留键位时尽力而为)。
- [x] 桌面 macOS 红绿灯 inset(`brandInset` prop,收起态展开钮同步让位);侧栏为窗口拖拽区(桌面宿主 CSS 作用域)。
- [x] 移动顶栏:品牌标记 + 当前域标题 + 搜索钮(跳提示词库)+ 额度 readout(`MobileQuotaReadout`,宿主经 `mobileExtra` 插槽注入;未登录不占位)。
- [x] 会话置顶:偏好通道承接(`AppPreferences.pinnedSessionIds`,D6 同机制);置顶组排前、行首 Pin 标记、离场自动清偏好。
- [x] 会话行运行/未读状态点:契约会话实体补派生字段 `latestJobStatus`/`latestJobFinishedAt`(default null 兼容);running 动画点(queued/running/cancelling)、unread 实心点(本次运行期内完成且未查看,`useActiveSession.seenAt` 内存追踪);列表有活动生成时 5s 短轮询驱动翻终态。
- [x] 布局语法收口(2026-08-29,承 ZCode/Codex/Cursor 参照):设置移出导航轨(入口=footer 齿轮)、「新设计」改轨道行样式、「功能」分节标签取消、会话行尾相对时间戳;底部账号区升级身份菜单(官方黑白标触发钮、登入/登出默认动作、「更多连接」切换子菜单、ScreenIntent 设置深链),形态见 §2.2-5。
- [x] U01 壳几何收口(2026-08-29):侧栏默认 248px、220–360px/32vw 夹取,指针拖拽 + 键盘 ±16/Home/End + 双击复位,沿用 `musefold:sidebar-width`;桌面工作面四边 4px inset + 12px 圆角 + 阴影;`<768px` 使用同源模态抽屉,无 761–767px 不可达区。
- [x] Win/Linux `WindowControls`(B2-T6,D5 窄带,不进 gateway)
- [x] 内容顶 12px + 设置 32px drag-region(B2-T6;设置让位仅 Win/Linux)
- [x] TooltipProvider 300ms 壳级唯一(B2-T6)
- [x] AutomationConfirmCard(B2-T2,与 Toaster 同级)
- [x] 会话列表重启逃生门(B2-T3)
- [x] Win/Linux 控件带避让(B3-T3:`data-window-controls-safe` + 宿主 `main { padding-top: 32px }` 仅当有 `[data-window-controls-band]`)
- Windows 验证项:布局已预留 32×138;darwin E2E 无三钮则跳过几何;Windows 真机像素重叠仍未目测
- B3 统一验证(2026-09-06,darwin,未 commit):`pnpm run check` turbo 35/35;根 vitest 202 文件 / 1566 例;features 39 文件 / 507 例;Web E2E 142 passed / 4 skipped / 0 failed(未重生快照);Electron E2E 69 passed / 1 skipped / 0 failed。Windows 真机目测未验。

### 2.6 首启引导层(U01-onboarding,2026-09-06 ✅,`packages/features/src/onboarding`)

- **挂载**:双宿主在 `PlatformProvider` 内、壳容器之后各挂一行 `<OnboardingFlow onOpenScreen>`(与 `Toaster` 同级);gate 未放行时返回 `null` 不占 DOM。切屏一律回调宿主既有导航,引导层不自建路由。
- **gate 判定**(`useOnboardingGate`):哨兵 `AppPreferences.onboardingCompletedAt` 非 null → 不弹;无哨兵且账号未登录、无可用本地 Provider(桌面)、豆包未登录(桌面)→ 弹;无哨兵但已具备任一生图通道 → 不弹并**静默补哨兵**(存量用户不回放);偏好读取失败 fail-closed(不弹也不写)。流程中途拿到通道不撤走已放行的引导。宿主差异只经 capability(`hasLocalAiProviders` / `hasDoubaoWebLogin`)。
- **首帧决策(2026-09 走查 P2 修复)**:完成哨兵镜像到 `localStorage`(`musefold.onboarding-completed-at`,完成/静默补写/读到哨兵时同步),已完成用户首帧即短路 gate,不等查询。镜像无法判定且前置查询未 settle 时渲染 `OnboardingBootShield` 全屏遮罩(品牌标 + 呼吸点,拦截点击)——避免冷启动先露可操作工作台、引导层 ~5s 后迟到挂载抢走点击落点;偏好读取失败(fail-closed)与镜像已完成都不经过遮罩。
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
- 会话列表不在本屏(住壳侧栏,§2.2);md+ 时间线头顶补当前会话标题(`workbench-session-title`,超 16 个 Unicode 字截断,完整名走 `title`)+ 活动任务摘要(`workbench-task-summary`:排队中 > 生成中 > 方案运行中 > 取消中);空态不抢问候语。桌面可在工作区右侧展开 304px `PromptReferenceDock`;移动端在本屏顶部放会话选择器(§3.4),引用选择器改为底部 Dialog。

### 3.2 Composer 规格

| 控件 | 形态 | 契约字段 | 约定 |
|---|---|---|---|
| 提示词输入 | 多行 textarea,自动增高(76–180px) | `prompt` | Enter 或 ⌘/Ctrl+Enter 发送 / Shift+Enter 换行;IME 组合期(含 keyCode 229)不截获;占位语分支承旧:空会话「描述你想生成的图片…」/有回合「描述下一步调整…」;≥90% 限长时工具条尾部显示 `字数/上限` 计数 |
| 比例选择 | 形状预览触发钮(mono 值 + 几何色板)+ 368px 网格菜单 | `aspectRatio` | 目录承旧 v2.1 全集 11 档(1:1/2:3/3:4/3:2/4:3/4:5/5:4/9:16/16:9/21:9/auto 殿后);3 列卡片含形状预览 + 勾选,打开即聚焦当前项,方向键 ±1 环绕 + Home/End;**自定义比例已恢复(承旧 RatioPicker,D7 作废)**:网格下单一分隔带自定义行(W:H 整数输入 1–99,比例限 1:4–4:1,Enter/「应用」提交,非法非空值 `role=alert`「比例需在 1:4 与 4:1 之间」且弹层不关);自定义当前态 trigger/预览按实际 `W:H` 呈现,标题右侧显示「`W:H` / 自定义」,不回落 auto;数据流只传规范 `W:H`(domain 旧 `custom:W:H` 前缀不进 v2.5) |
| 生成设置 | 值摘要触发钮(显示当前质量档,反向词非空追加「· 反向词」,张数 >1 追加「· N 张」)+ 304px 弹层 | `quality`、`negative`、`count` | 质量档 radio 组承旧命名:自动/标准/高清/超清(枚举值 auto/low/medium/high 不变);反向提示词 textarea 收进弹层(不常驻);张数见下(§9-D3 已解锁) |
| Provider 选择 | 下拉(桌面显示本地连接;云端固定「Musefold 云生图」) | `providerId` | 无可用连接时禁用发送并给引导文案 |
| 「+」菜单 | 触发钮 + 菜单 | — | 「添加图片」+「提示词 / 从库中引用」;选择提示词时先完成菜单退出再打开素材面板,不得叠两层浮层;设计方案/Skill/历史来源项随各域后续卡恢复 |
| 发送/停止 | 36px 圆形主按钮(承旧),状态互斥 | — | 正文与 Prompt 引用均为空或无 Provider 时禁用;纯引用可显式发送;hover 上浮/按压下沉微动效;运行中变「停止生成」(Square 图标,Esc 亦可停止),取消中 spinner 禁用 |

**张数**:设置弹层内「张数」radio 组,目录 1/2/4,testid `composer-count-{1,2,4}`;值摘要触发钮在 >1 时追加「· N 张」。张数不进持久草稿契约,按「用户显式覆盖 → 偏好 `defaultCount`」复原,并按 `capabilities.maxGenerationCount` 夹档;`maxGenerationCount === 1` 时整组不渲染。

testid 约定:`composer-prompt`、`composer-prompt-count`、`composer-submit`、`composer-cancel`、`composer-attach`、`workbench-context-ref-prompt`、`workbench-context-tray`、`prompt-reference-card`、`composer-ratio`、`composer-ratio-grid`、`composer-ratio-{w}x{h}`、`composer-ratio-custom-w/-h/-apply/-error`(自定义比例行)、`composer-settings`、`composer-quality`(radio 组,选项 `composer-quality-{id}`)、`composer-count`(radio 组,选项 `composer-count-{1,2,4}`)、`composer-negative`、`composer-provider`、`composer-no-provider`(无连接引导行,含「前往设置」)。

参考图异步生命周期（2026-09-14）：移除、清空、会话离场或页面卸载使本页待上传操作失效；文件读取及请求排队后再次核对，失效图片不再开始上传。旧操作的迟到错误不覆盖新页面，当前操作失败仍保留原toast出口。账号变化期间的待上传/迟到回包不进入新账号Composer；预览地址同步释放，不依赖卸载后的React状态更新。已上传图片的临时引用经统一gateway释放；视图、在途普通/方案提交和兑换恢复分别保留，提交前异步建会话也不能提前回收图片。原输入/幂等键随兑换恢复保留，替换未消费的恢复或切换账号时归还其引用；释放不触发生图。界面移除不等于立即物理删除，持久引用、队列重试与云端有效期继续保护，完整GC见生命周期§18.1及测试续篇§5.97。

#### 账号模型与云端价格（2026-09-20，接线与联合验收中）

账号云通道的普通生成与方案试跑/正式图像运行在Composer工具条上方使用共享`AccountModelSelector`；连接切换仍在侧栏，不修改连接行默认模型。可见“账号模型”标签关联Select，键盘可选、关闭归还焦点，移动控件至少44px；价格/失败说明就地呈现，允许换行，不借tooltip隐藏必要信息。模型区真实高度经ResizeObserver加入时间线底部留白，并与软键盘inset叠加。

- 目录来自当前账号的`account.getModelCatalog`，读取失败隐藏旧价；加载、空目录、模型消失、价格不可用都有说明和刷新入口，不能用本地价格或静默换模型继续发送。
- 云端已按账号倍率投影的quota只做积分单位换算，不再重复乘倍率；按次价标“积分/计费次”，用量价分别标输入/输出每百万token费率，不推测张数总价、不把未知结算当零。只有云端明确0才显示0。
- 模型选择是本设备UI偏好，仅保存model标识，以服务issuer/内部principal/付款issuer和owner隔离；价格、凭据、执行授权不持久化。存储不可用保留本次选择并说明无法保存；登出/换号立即隐藏旧目录、迟到结果不进入新账号。
- 新的普通生成与方案图像运行先重新读取目录。价格或执行身份变化时保留输入并要求再次明确发送；展示、请求model与expectedBinding.model一致，主进程/API仍独立重验。方案提交在建会话之前复核，防止双击重复登记；读取期间取消或换号不再建会话、提交方案或复用旧身份。已受理重放、历史重试不读取当前选择去改写原冻结任务。
- 方案创建/修改使用既有独立文本授权，不读取图像模型目录；试跑/正式运行沿共享提交映射将所选模型传至两宿主权威计划与实际发送。PC/移动实际API/PG/Worker试跑和正式运行、Electron账号普通生成与正式方案的模型/价格基础联合路径已验，最终同源全量与外部发布条件仍待，不能据局部专项关闭父任务。旧宿主缺可选目录方法时保留原默认协议，不展示可切换模型或伪造云价。

### 3.3 会话列表(壳侧栏「对话」区)——`SessionListPanel`

行 = 状态点 + 标题(单行截断)+ hover 常驻操作组;承旧 `WorkbenchSessionList` 语义:

| 交互 | 触发 | 行为 |
|---|---|---|
| 打开 | 点击行 | 切到工作台并载入会话;清未读 |
| 重命名 | 行内操作钮 / 右键菜单 | 行内变输入框,Enter 提交、Esc 取消;`maxLength` 120 |
| 置顶/取消置顶 | 操作钮 / 右键 | 置顶组排前;本地偏好存储 |
| 归档 | 右键菜单 | 移出列表;设置「数据」卡内的归档列表可刷新、恢复或软删 |
| 删除 | 右键菜单 → AlertDialog 确认 | 软删,可从回收站恢复(回收站入口:设置-数据,M4d) |
| 状态指示 | 行首点 | `running` 动画点(该会话有进行中生成)/`unread` 实心点/`idle` 无 |

状态矩阵:loading = 3 行 skeleton;error = 一句错误 + 「重试」;读取失败码 `WORKBENCH_SESSION_RESTART_REQUIRED` 特判标题「需要重启应用」+「立即重启」(`useRelaunchApp`);Web 无 `system` 域降级为说明 + 重试;空 = 「还没有对话。点「新设计」开始,发送后会立即出现在这里。」(承旧文案)。行高接 `--density-nav-y`。

右键菜单为桌面增强入口,**不得是任何动作的唯一入口**(§8-I2):所有动作都有行内钮或对话框路径。

### 3.4 移动端形态

- 屏顶会话选择器(`session-picker`):当前会话名 + 下拉(会话列表复用同一数据 hook);旁置「新建」钮(`session-create-mobile`)。
- 时间线与 Composer 同桌面。Composer 贴底:`<md` 读 `visualViewport` 把悬浮轨道(`composer-dock`)和空态内联包装(`composer-empty-inset`)抬出软键盘,公式 `max(0, innerHeight - height - offsetTop)`;时间线滚动容器底部留白 = 172px(md+ 220px) **加上同一 inset**,最后一回合可滚出抬起的 Composer(§9-D27);md+ / 无 `visualViewport` inset=0,桌面几何不变,不另做动画。
- Prompt 引用选择器使用焦点圈闭的底部 Dialog(`82dvh`,含安全区),面板内部独立滚动;背景主区与常驻底栏均 inert/遮罩,不得压住列表内容。打开时聚焦搜索;Esc/关闭钮收起并把焦点归还 `composer-attach`。桌面对应 304px 非模态内联 Dock,Esc 同样收起和归还焦点。

### 3.5 时间线回合(承旧 `WorkbenchGenerationTurn` 装配)

每回合 = 用户消息(右对齐气泡,含提交参数摘要)+ 助手帧(品牌头像 + 内容):

| job 状态 | 助手帧内容 |
|---|---|
| `queued` | 骨架格(按比例占位)+ 「排队中」;多张时 `job-placeholder-grid[data-count]` 按 `request.count` × aspectRatio 同成图排布占位 |
| `running` | 同上骨架 + Spinner + 「生成中」;Composer 侧提供停止 |
| `succeeded` | 结果网格 1 张单列 / 2 张两列 / 4 张 2×2(`job-asset-grid[data-count]`,成图落位不跳版,多图 60ms 错相 reveal);点击开灯箱 + 动作行:复制提示词、删除(成功记录不调用仅接收失败/取消的 retry；复用输入用编辑/复制) |
| `failed` | 错误卡:归一标题 + 引导动作(`KeyGuidanceAction`);额度不足「去兑换」深链设置账号分区,兑换成功后按记下的 job `retry`(新幂等键);可重试码才给重试 + 删除 |
| `cancelled` | 灰化卡「已取消」+ 资格允许时重试 + 删除；账号云未知费用给原任务核对 |
| `pending_approval` / `rejected`(云) | 只读审批卡(`job-approval-card` / `job-approval-rejected`,文案承 API 语义),无批准/驳回按钮;桌面不出现该状态 |

- 用户消息 meta 行(`job-meta`):比例 · 质量 · 张数(>1 时) · 「来自 #xx 微调」(`job-meta-parent`,父回合在本会话时才出,只读 `scrollIntoView`);纯引用任务不渲染空气泡也不渲染 meta。
- 逐图动作:图格 hover/focus 渐显 `job-asset-save`(保存该图)/ `job-asset-save-prompt`(以该图为首图存为提示词);回合级「全部保存」(`job-save-all`,顺序调 `saveAsset`,用户取消即止,toast 汇总「已保存 N / M 张」)。多选子集选择模式属 P3,不做。
- Lightbox(`job-lightbox`):多图左右翻(`lightbox-prev` / `lightbox-next` + ←/→ 方向键 + `lightbox-counter`「2 / 4」)+ 保存(`lightbox-save-asset`)+ 复制提示词 + 复制图片(`lightbox-copy-asset`,`canRevealLocalFile` 门控,Web 不渲染);Esc 关闭并把焦点还给触发图格。灯箱指针存 `{回合 id, 图序}`,轮询刷新不定格旧快照。
- B27 重试交互：工作台/历史列表/详情共用进行中状态；同账号同原任务在本次交互结束前只登记一次，提交中按钮 disabled + aria-busy；结束后新的显式点击使用新意图。失败显示「重试未完成」及原因；账号云可进入连接页核对原任务。已知费用的失败/取消才给账号云重试，未知费用保留核对入口，purge不提供重试。该UI准入不能替代主进程/API的费用与幂等校验。
- 删除回合走 AlertDialog;删除后时间线即时移除(乐观更新)。
- Prompt 引用随用户消息显示不可变快照卡(`job-prompt-reference`):标题、整条/片段徽标、可展开正文均取生成时快照,不回查当前 Prompt。纯引用任务不渲染空用户气泡;复制/编辑优先使用原始 `userPrompt`,不得把宿主合成后的 provider prompt 当作用户输入。源 Prompt 后续编辑/删除不改写旧回合。
- 新回合出现或状态推进时自动贴底滚动;用户手动上滚后暂停自动贴底(阈值 80px,回底恢复)。
- 时间线空态(有会话无回合):居中品牌空态(§3.1)。
- 时间线 loading:居中 Spinner;error:错误卡 + 重试。

### 3.6 数据与轮询

- 会话与历史走 TanStack Query(`queryKeys.workbench/generation`);工作台活动任务/下载待确认及外部方案运行期间每3秒读取时间线，侧栏有活动任务时每5秒读取列表，终态停止轮询。共享方案事件每5秒合并一次会话/生成查询刷新，账号余额与方案资产只在运行结束刷新，不对每条进度事件发起四组请求。
- 提交:乐观插入 queued 回合 → 后台轮询;失败回滚并 toast。
- Web读取遇429时保留原等待、任务ID与事件游标，同一Gateway的GET共用冷却；尊重服务端Retry-After/契约提示，缺省按30/60/120秒最多重试三次，等待窗口不超过5分钟。停止/退出等显式写入不被冷却排队，任何写入均不自动重放；401/403等权限失败立即交回原错误态。超出有界恢复后保留输入及原任务核对入口，不能将读取失败说成生成未发生。市场搜索仍显式重试，不自动续发搜索。此为09-21限流修复的交互约束，实际收费整轮验收另记。


**B21 桌面账号云图像**：设置中的显式连接完成后，普通文字 G 可使用账号额度生成 1／2／4 张；发送即本次交互授权，不额外插入 Automation 费用确认卡。当前云连接在发送前拒绝参考图、Prompt 引用/关联、微调输入；BYOK 既有能力保留。取消先落持久意图，未终态显示 cancelling；停止不保证零费用，迟到的真实成功仍展示结果与已发生费用。网络或下载不确定时保留原任务，查询/恢复不重新 POST 生图；原费用、云结果和本机素材分别核对。

---

## 4. 提示词库(M4a 已交付;2026-09-06 B1-T1 完整性收口,记录为基准)

### 4.1 布局

顶部工具行(搜索框 + 文件夹/排序筛选 + 「新建提示词」主钮)→ Tabs(库 / 回收站;「库」内再以标签/文件夹筛选,不再有独立「收藏」页签)→ 行式列表(承旧 v2.0 `PromptListRow` 信息架构)。

**详情(2026-09-06)**:md+ 为「列表 + 右侧详情 Inspector(384px,`w-96`)」双栏,详情开启时列表转单列(容器 `max-w-none`);<768px 详情装 `Sheet`,与生成历史 §5.1 同构。`PromptDetailInspector` = 头部(48px 封面 + 标题 + 置顶/评分)+ 正文(可复制,复制后图标转 Check)+ 「相关作品」面板(`PromptRelatedWorks`:该提示词产出的回合缩略,点击经 `history-select` 意图跳历史屏选中,宿主未注入 `onOpenHistory` 时退成只读画廊)+ 元数据(使用次数 / 创建 / 更新时间)。主动作「使用」(回填 Composer 并切工作台);更多菜单只含编辑 / 复制正文 / 置顶 / 移入回收站,「分享」属暂缓域(§0.2)。

### 4.2 列表行(`PromptListRow`)

封面缩略(44px;`coverImageUrl` 有图显图 + hover `scale-[1.06]`,无封面 FileText 占位;`PromptCover` 单源)+ 主体(置顶针 + 标题 + 评分星 / 摘要行 / 元信息行:使用次数 + 更新相对时间 + 标签 Badge ≤4 个 + 溢出计数)+ **操作组**(使用/复制/编辑/置顶/移入回收站;回收站行只留「恢复」「永久删除」)。

- 操作组:<md 触屏常显、行内占位;md+ **浮层覆盖行尾**(`absolute` + 左向渐隐遮罩 `from-card`,零占位不挤标题——2026-09 走查 P1 修复,双列 346px 行宽下标题曾被挤剩 3~4 字),桌面 hover/键盘聚焦渐显。侧栏会话行同款浮层(`from-sidebar-accent`)。
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

分页:列表尾部滚动哨兵(`IntersectionObserver` 提前一屏取下一页;无 IO 的环境退化为「加载更多」钮)。「全部」/回收站 >150 行走 `useVirtualizer`(features `use-virtual-rows.tsx`,置顶组常驻不虚拟化;md+ 屏内滚动,`<md` window 视口)。内容宽 ≥760px 且详情关闭时「全部」/回收站 2 列(列距 28px / 行缝 4px,`prompt-grid[data-columns]`);虚拟化按行成对,不拆行模型;详情开启或视口收窄回单列。

### 4.5 遗留差值(随 M4d 抛光收口)

- [x] 标签管理器(TaxonomyManager)移动端切 Sheet(`<md` Sheet / `md+` Popover,共用 `taxonomy-panel`)。

分类删除交互（B74）：沿用同一表单和 AlertDialog，明确保留提示词与子文件夹、只删除分类及解除直接关联；取消/Escape 返回原触发器，请求期间阻止重复提交和关闭，失败 toast 并保留输入/原目标供重试。快速关闭重开时外层同时保护内层确认状态，避免一次 Escape 关闭整个面板；成功后的查询刷新不阻塞确认框关闭。实际跨端与完整回归状态见[测试续篇§5.73.1](./V25-MIGRATION-TESTING-CONTINUED.md)，不以局部交互通过代替全迁移验收。
- [x] 回收站内永久删除:契约 `prompts.purge`(仅已软删行合法),行动作「永久删除」+ AlertDialog 红主钮;桌面直删 SQLite(FTS 同步清理),云端硬删 PG 并广播 delete 同步事件。移入回收站维持不确认(可恢复,承旧)。
- [x] 2026-09-06(B1-T1):封面缩略、详情 Inspector/Sheet、行点击开详情、清除筛选/新建 CTA、清空回收站、⌘S、更新时间、复制 Check、`prompt-highlight` 接收端(存为提示词 → 跳库高亮)、⌘K / `/` 聚焦搜索。
- [x] 2026-09-06(B2-T4):「全部」/回收站 >150 行虚拟化(置顶常驻,滚动哨兵兼容,`data-density` 变化 `measure()`)。
- [x] 2026-09-06(B4-T1):「相关作品」下推 `generation.list({ promptId, status:'succeeded', limit:100 })`;客户端只滤有成图。
- [x] 2026-09-07(B5-T2/T3):双列自适应(≥760px,详情关闭;`data-columns`);Taxonomy 移动端 Sheet。

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
分页:滚动哨兵 + >150 虚拟化(虚拟项=线程组,深链 `scrollToIndex`)
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
- 操作组(hover 常驻,同 §4.2 模式):重试(仅错误码目录允许,成功/拒绝/过期不给;普通取消可重试，账号云须费用已知且未purge；进行中状态与错误反馈同 §3.5)、删除(回收站),运行中行为「取消」。
- 微调线程:`parentRunId` 归组缩进展示(只读,发起微调暂缓 §0.2);父记录不在结果集的孤儿子回合标注来源已删除。
- 列表状态矩阵:loading skeleton ×6 / 空「还没有生成记录,去工作台开始第一张图」+CTA / 筛选空「没有匹配的记录」+清除 / error+重试。
- 分页:滚动哨兵(`history-load-sentinel`,IO 提前一屏取下一页,无 IO 退化为按钮);>150 虚拟化(虚拟项=线程组,深链 `scrollToIndex`,哨兵仍在列表末尾)。

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
- **深链**:`settings-account` / `settings-connections` 意图落到对应分区并短暂点亮面板(ring);另支持通用 `{ kind:'settings-section'; section; highlight? }`(highlight 为可选 testid,短暂 `data-settings-highlight` + `scrollIntoView`)。宿主无目标分区(如 Web 无连接分区)兜底账号分区。

### 6.2 分区注册表(`packages/features/src/settings/sections.tsx`,唯一目录)

分区由 `SETTINGS_SECTIONS` 声明:分组 / 标题 / 描述 / 图标 / 搜索关键词 / capability 门(`isAvailable`,宿主不具备即整个分区不注册,D2 无死入口)/ 深链意图(`intents`)/ `render`。分组顺序 `SETTINGS_GROUPS`:通用 → 访问 → 应用。

| 分组 | 分区 id | 内容 | capability 门 | 状态 |
|---|---|---|---|---|
| 通用 | `appearance` | 外观卡:主题 / 动效三档 / 界面密度两档(带图标 `ToggleGroup`)+ 语言 Select;`ThemeSync` / `MotionSync` / `DensitySync` 宿主同处挂载;system 档 hint 挂载后读 `matchMedia` 动态显示当前解析值;偏好读取失败给「重试」钮。**生成参数卡**(`GenerationDefaultsCard`):默认比例(Composer 同一目录 + `auto`)/ 默认质量(自动/标准/高清/超清)/ 默认张数(`defaultCount`,仅 `maxGenerationCount > 1` 时渲染);写入 `AppPreferences.defaultAspectRatio/defaultQuality/defaultCount`,新会话/空草稿继承,用户显式改过的草稿字段不被覆盖 | 恒真 | ✅ B2-T4 密度消费已接入;默认张数随 D3 解锁 |
| 访问 | `account` | 登录(账密表单)/身份积分卡/兑换/退出；受限身份恢复、原设备核对、独立空间(§7.1) | 恒真 | ✅ B12 账号恢复 |
| 访问 | `sync` | 云同步开关(登录 ≠ 同步)/状态/立即同步；旧本机库查看与明确复制(§7.3) | `hasCloudSyncControls` | ✅ B12 本机库恢复 |
| 访问 | `connections` | 生图连接卡 + Agent 文本连接卡(§7.2)+ 豆包免费试用卡(§0.2) | 三能力任一 | ✅ |
| 应用 | `data` | 回收站入口(提示词/生成历史)+ 会话回收站(恢复/永久删除/清空及分页，B76验收中)+ 已归档对话列表(刷新/恢复/软删 + 游标「加载更多」)+ **本机数据面**(`DataStorageCard`):数据库备份(立即备份 / 列表 / 逐份恢复 → 确认覆盖并重启 `system.relaunch`)、存储位置(白名单 id,`displayPath` 是本域唯一路径出参;复制 / 打开)、诊断日志(按需读取,200KB 截断)、危险区(确认短语「清空全部数据」;清空前自动 `pre-reset` 快照并回显文件名) | 分区门:宿主接线 `onOpenScreen`;本机数据面:`hasLocalDataManagement` | ✅ B4-T2 归档游标 |
| 应用 | `open` | **开放能力**:本地控制面(监听开关 / `http://127.0.0.1:{port}` / 掩码令牌(主进程复制 + 轮换)/ 月度预算)+ 最近调用 + 接入向导 + **已连接应用**(`ConnectedAppsCard`:授权列表 + 撤销 AlertDialog;未登录/自定义服务器门控)。分区门 `hasLocalAutomation \|\| hasCloudMcpControls`;Web 只渲染已连接应用 | `hasLocalAutomation \|\| hasCloudMcpControls` | ✅ B2-T2 本地三卡;✅ B3-T1 Cloud MCP |
| 应用 | `usage` | **使用统计**(`UsageCard` + `UsageCharts`):四指标(生成次数 / 成功率 / 成图数 / 消耗积分,`tabular-nums`,null →「—」)+ 范围 ToggleGroup(7/30/90 天,默认 30)+ 刷新 + 可折叠渠道明细 + 趋势/渠道/模型/成功率图(`--chart-*` SVG,`skipMotion()` 降级终态,sr-only 表;空「该时段没有生成记录」)。四态:skeleton / error+重试 / 空「这段时间还没有生成记录」/ ready。契约 `usage.summary` 含 `byDay`/`byModel`,双端必选。不做图表视觉快照。 | 恒真 | ✅ B2-T5 四指标;✅ B3-T2 图表 |
| 应用 | `about` | `AboutCard`:品牌面板 + 版本行(桌面:版本 / 库结构版本 / 平台;Web:无 `buildInfo` 显示「Web 版」;有则 `Web 版 · {version}`(commit 取前 7 位)。`PlatformProvider.buildInfo` + `useBuildInfo()`,由 Web 宿主 `NEXT_PUBLIC_*` 注入)+ 复制版本信息 / 反馈信息 + 查看文档(桌面 `system.openProductDocs`,随包本地文档;Web 无 system 域不渲染该行)+ 第三方声明 Dialog(`settings/third-party-notices.ts`,形状由 `thirdPartyNoticeSchema` 约束)+ 快捷键表(`shell/shortcuts.ts` `PRODUCT_SHORTCUTS` 单源)。更新检查体系仍属暂缓域(§0.2) | 恒真(双端) | ✅ |

数据面:桌面新 `system` 域(契约 `packages/contracts/src/system.ts`,`V25_METHODS_BY_DOMAIN.system` 11 方法:`getAppInfo · listBackups · createBackup · restoreBackup · listStorageLocations · openStorageLocation · readDiagnosticLog · clearAllData · openExternal · openProductDocs · relaunch`),出参除 `displayPath` 外 path-free,错误 message 经 `pathFreeMessage()` 过滤。`SystemGateway` 为可选(`gateway.system?`),Web 网关不实现。桌面 `automation` 域 9 方法(secret-free:`getStatus · setEnabled · rotateToken · copyToken · setMonthlyBudget · listRequestLog · listSpendAudit · resolveConfirmation · getIntegrationGuide`);确认事件走 preload `onAutomationEvent`,不进 `musefold:invoke`。`usage.summary` 双端必选(含 `byDay`/`byModel`)。`cloudMcp.listAuthorizations` / `revokeAuthorization` 双端必选(`hasCloudMcpControls`;撤销=删 consent + token.revoked,MCP handler 再查 consent,无行即 401;不把 JWT 改成「只标 revoked」)。

B16 恢复失败出口：普通损坏/不兼容备份在修改当前库之前拒绝，保留确认框供重新选择或重试；`RESTORE_FAILED` / `DATABASE_RESTART_REQUIRED` 则关闭确认框、禁用当前卡的备份/恢复提交，并显示显式「重启应用」按钮，不自动重启。普通自动备份保留最近 10 份，恢复前 `recovery-safety-*` 安全副本单独保留；卡片说明必须表达这一差别。成功仍沿既有 `needsRestart → system.relaunch`。

### 6.3 控件约定

Cloud MCP 首次授权使用共享 `OAuthAuthorizationScreen`，Web 薄宿主挂载 `/login` 与 `/consent`，不挂工作台侧栏和首启引导。先经服务端核对 provider 签名请求，再展示应用名/标识/网站来源、当前账号和实际申请的只读权限；注明申请方自报名称、禁止生图/扣费/写入，提供同等级可达的拒绝与允许按钮。普通登录、两步认证和满额清理复用 `AuthForm`，登录请求不混入 OAuth 参数；继续只去服务端从有效请求生成的授权地址，不接受任意 `returnTo`。未核对、刷新中、提交中、失效或身份变化不得确认；不确定提交不自动重放，显式重试只重新读取审核信息。确认引用绑定请求、客户端元数据、账号与会话，5分钟过期；页面关闭不隐式同意。回调仅来自 provider 校验结果，宿主拒绝脚本/文件 URL，页面 `no-referrer` / `noindex`。后续在设置「已连接应用」撤销；首登、同意/拒绝、强制重登、实际独立客户端换码和撤销须浏览器专项验收。

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

### 6.4 会话回收站（B76实施基准，完整验收待S05）

设置「数据」卡在提示词/历史回收站与已归档对话旁增加共享 `SessionTrashPanel`，沿用折叠行、语义token、Button、Skeleton与AlertDialog；不新增宿主页面。`data`分区复用矩阵增加此面板及独立workbench trash分页hook，两个宿主只提供同一gateway。

- 展开按`deletedOnly`查询，包含已归档的已删除会话；游标加载更多，已加载数在有后页时带“+”，不能冒充总数。加载、空态、首屏错误/刷新重试、后页失败保留已有行并重试分别呈现。
- 恢复调用专用restore接口，仅清除删除标记；原已归档会话回到“已归档对话”，普通会话回到侧栏。反馈说明实际位置，不自动打开会话或覆盖当前输入。
- 永久删除单行和清空全部均先AlertDialog。说明不可恢复、会话草稿会删除、生成历史/图片/费用保留；清空明确包含尚未加载的会话。成功以服务端实际条数反馈，0条不宣称删掉一条。
- 提交中禁止重复、取消和Esc关闭；失败保留目标与确认框并提供重试，刷新列表核对竞争后的状态。成功刷新普通/归档/回收站及生成关联缓存；不得自动重发生成。永久清理不做推测性的乐观删除，避免未知结果被当作成功。
- 行动作在触屏常显，窄屏允许分行，移动触区至少44px；图标有可读标签。取消返回原按钮焦点，成功行消失时返回回收站标题按钮。
- 侧栏删除失败保留确认框、当前会话与输入；成功后离开已删除会话并选中剩余列表首项，没有剩余会话时进入空白新设计。删除最后一条亦清除旧Composer正文/引用/方案状态，不把旧草稿写给新会话。归档成功后才切换，失败不提前导航。其他页面已删除当前会话时须核对并隔离旧草稿，不能把分页未出现当作删除证据。

草稿并发补充（B76，2026-09-13隔离复现后实施）：自动保存基于本页实际装载或本页成功保存的草稿版本；后台刷新仅在草稿内容未变化时可推进元信息版本，不能把另一写者的草稿版本授予本页旧输入。保存失败后保留输入、停止该会话队列自动续写并显示“核对草稿”。读取最新记录后以共享AlertDialog并列展示最新草稿和本页草稿，提供取消、“载入最新草稿”和“保留本页并保存”；后者只提交已展示的固定版本，再次冲突保留输入和对话框，须重新核对，不自动覆盖。载入最新会同时清除旧参考图/方案内存态。防抖和已排队保存绑定输入产生时的草稿载入状态，重新载入后旧写入不得借用新版本；迟到成功/失败回包不得重置新载入草稿的保存依据。切换会话使旧核对结果失效；上述动作不生成、不重试生图、不改变费用。

---

## 7. 账号与 AI 连接(M4d ✅)

### 7.1 账号面板(`AccountPanel`,设置页「账号」卡)

- **登录方式(纠正旧稿)**:双端同一账密表单(用户名/密码,登录↔注册切换)。凭据事实源是自托管 New API 网关,云端 `apps/api` 经 Better Auth `sign-in/new-api` 委托校验,本服务不存密码;Web 得同站 cookie,桌面得 bearer token(主进程 safeStorage 落盘)。旧稿「桌面 OAuth 回跳 / Web 登录页面」作废——没有第三方 IdP,独立登录页与浏览器回跳是多余间接层。
- 未登录:账号卡内联表单(用户名/密码/提交);登录失败错误红字在表单内(按 I4 表单口径,不用 error 卡)。登出后预填上次用户名(`useRememberedUsername`,进程内 zustand + Web `sessionStorage` 扛刷新,密码/token 不写,**不进 `AppPreferences`**),密码清空并聚焦。登录/兑换错误走 `account/error-messages.ts` 错误码文案表。
- 已登录:身份行(首字母头像 + 用户名 + 积分 readout + 可生图/余额不足 Badge)+ 兑换码行(输入框+兑换钮,成功 toast + 余额即时刷新)+ 退出登录(AlertDialog 确认)。
- **服务公告（09-21补迁，局部评审 ship，最终联合验收待完成）**：既有账号分区的 Operate 局部扩展，正常已登录账号在“登录设备”下挂共享 `AccountNoticesPanel`；账号/设备/公告卡按24px间距纵向排列，沿用中性语义表面、系统字体与 `Card` / `Button`，不新增视觉体系或图片资产。标题与“全部已读”可换行，正文仅显示纯文本、保留段内换行，长连续文本可折行；有有效发布时间才显示日期，移动按钮触区至少44px。公告经 `account.getNotices` 独立读取，不加入登录/额度读取链，不签发额外会话或产生模型/兑换调用；加载骨架、失败说明与“重新读取公告”独立呈现，空公告或再次进入时已无未读则隐藏。未读态常驻“全部已读”，卡底提供“刷新公告”；刷新中禁重复操作，刷新失败隐藏旧内容。全部已读仅保存点击时展示的内容ID，不标记后来公告；成功保留本次反馈并将焦点移到公告标题，存储失败保留未读内容及重试入口。新记录仅存本设备，按API服务 `apiIssuer`、公告发行服务 `issuer` 与账号主体隔离；兼容旧版全设备内容ID及原始文本首尾空白参与计算的旧ID别名，桌面从白名单旧origin迁入偏好，Web读取原键，只迁移已读标记。登出、换号或认证epoch变化即时隐藏旧结果，迟到读取不得进入新账号；来源变化拒绝沿用旧公告。局部组件、真实API、PC/移动和新PID Electron专项已有证据；完整回归及证据边界见 [账号对照§3](./ui-parity/07-settings-01-account.md#3-已登录态对照)，不据本卡关闭整页parity或迁移。
- **兑换后恢复生成（B29）**：到账立即更新余额并提示兑换成功；若此前选择“去兑换”恢复原任务，在兑换行下单独显示“恢复中 / 已提交 / 未恢复或生成失败”。已返回失败子任务不能继续显示恢复中；取消结果明确说明兑换到账不受影响。非进行中状态提供“查看原任务”（无任务 ID 时查看生成历史），定位已返回子任务或原失败任务。兑换失败保留待恢复意图；生成失败不改写兑换成功结果，不自动再次兑换。同一账号同一原任务正在进行的手动/兑换重试共享一个请求；create 恢复沿用原输入和幂等键。换号后不显示旧结果、不更新新账号余额；兑换等待期间新选的恢复意图不被旧响应消费。状态只属于当前界面会话，不承诺跨页面或重启保留，持久恢复仍由原任务网关负责。
- **桌面额度错误**：保留旧 `ACCOUNT/QUOTA` 和契约 `ACCOUNT_QUOTA_INSUFFICIENT` 的官方兑换引导；自备连接的通用 `NO_BALANCE` 不转换为官方账号额度错误，避免引导向错误的账户充值。
- **受限身份恢复(B12)**:已有会话但来源/历史归属尚未核实者，账号卡显示原因、恢复申请与截止时间；按契约提供「重试」「在原设备验证」和经 AlertDialog 明确选择的独立空间。正常账号可输入另一设备的申请，先查看候选 issuer/账号，再确认验证；恢复设备不能自己充当原设备。独立空间不领取旧云历史。过期给重新登录指引，失败保留可重试状态；恢复期间不放行生图/兑换/云业务或 MCP 授权。
- **恢复上下文**:切账号/切服务/同账号重登都使旧确认失效；展示身份与提交核对值来自同次响应。服务器执行 binding 只在主进程/服务端消费，账号界面不展示或存储 bearer/key；可信备份的运维工具不加入用户设置页，也不变成代批入口。
- 积分显示:`quota ÷ ACCOUNT_QUOTA_PER_POINT`(50000),最多一位小数(`formatPoints`)。
- 登录/退出后全量 invalidate/reset 查询缓存:登录前失败的会话/数据查询自动重取,退出不残留上个会话数据。
- 已连接应用列表(MCP 授权撤销):**已交付**(B3-T1)。落点在设置 `open` 分区 `ConnectedAppsCard`,不在账号卡内再列一份。`cloudMcp.listAuthorizations` / `revokeAuthorization`;撤销删 consent 并标记 token.revoked,MCP handler 再查 consent → 401。未登录/自定义服务器(`CLOUD_MCP_CUSTOM_SERVER`)门控文案替代整卡。
- 壳侧栏底部 `AccountFooter`:官方黑白标触发钮 + 向上身份菜单(登入/登出为默认动作,桌面含「更多连接」切换子菜单),形态详见 §2.2-5;「账户与额度」「登录」深链本分区(滚动 + 高亮)。

### 7.1A 登录设备与满额登录（2026-09-20实现并部署上游；本轮增量回归另记）

本节为用户新增要求的实施基准；组件与双Gateway已落地，上游账号扩展已部署并通过协议实网验证，详情见[登录会话方案](./V25-LOGIN-SESSIONS.md)。这不等于Musefold公共站点已切换，09-21最终增量回归另见[真实验收记录](./V25-REAL-ACCEPTANCE-2026-09-21.md)。不会把登录设备与侧栏“对话”或B12历史身份恢复混为一谈。

- 落点：现有设置`account`分区，身份/额度卡下新增“登录设备”卡；未登录隐藏普通设备列表。共享`LoginSessionsPanel`与`LoginCapacityDialog`已实现，双宿主只注入Gateway能力，不建新宿主页面。沿现有Graphite/Ember、系统字体、Card/Button/Badge/Skeleton/AlertDialog与图标单一出口。近期验证过期时在释放确认窗内重输密码/两步验证码，提交即清空；重试保持原operationId和所选设备。
- 列表：当前设备置顶，再按最近使用排序；显示客户端/系统、当前设备标记、登录时间、最近使用或“未知”、失效时间、掩码IP。设备名称只作识别提示，不代表可信硬件指纹。总数/上限须服务端提供，分页不将已加载数冒充总数。
- 操作：常驻“退出此设备”、刷新；支持选择多项后“释放所选”，默认全部不选。批量释放排除当前设备，当前设备单独走现有退出确认。确认框列出固定选择与数量，说明这些设备需要重新登录，作品、提示词及费用记录不会删除；“退出其他全部设备”也必须显式确认，不能作为满额登录默认动作。
- 满额登录：通过完整认证后才显示“登录设备数量已达上限，请选择要退出的设备”，复用同一列表。桌面Dialog、移动底部Sheet，共享内容与焦点圈闭；底部“取消”与“释放所选并登录”常驻可达。未选择足够设备时主按钮禁用；取消/Escape不撤销任何旧会话。原登录密码提交后清空，不在倒计时状态保留。
- 状态：首次加载skeleton；空态提示暂无其他设备；查询错误隐藏旧列表并给重试；后页失败保留前页；提交中禁重复操作，结果未知先查询原operationId；成功后按实际释放条数反馈并刷新；部分待确认不报全部成功。容量挑战到期显示“验证已过期，请重新登录”，不自动提交。账号/服务/认证epoch变化清空旧列表及选择，迟到响应不进入新账号。
- 释放不做推测性乐观移除；被其他设备退出后清理该登录的查询缓存、暂停需要认证的操作，显示重新登录入口，本机数据与未同步队列保留。远端退出失败但本机已退出时如实显示“远端释放待联网确认”。
- 触屏行可分行、按钮触区至少44px；动作不依赖hover，标签关联复选框，状态不只用颜色。成功用`role=status`，表单错误就地可读；取消焦点返回触发器，行移除后回列表标题。建议testid：`account-login-sessions`、`account-login-session-row-*`、`account-login-session-select-*`、`account-login-sessions-confirm`、`account-login-capacity-expired`。

### 7.2 AI 连接管理(`AiConnectionsPanel`,桌面专属,`hasLocalAiProviders` 开关)

- 列表行:行首 6px 状态点(缺 Key=`--warning` / 近测通过=`--success` / 未测=`--muted-foreground`/40%)+ 名称 + 「默认」Badge(活动连接)+ 副行(模型 · Base URL · 密钥尾号/未配置)+ 常驻操作(设为默认/测试/编辑/删除)。列表 `ORDER BY is_active DESC`,`generation.listProviders` 同序,Composer 未显式选择时预选 `providers[0]` = 默认连接。
- 新建/编辑 Dialog:名称、Base URL、模型(可输可选 `Combobox` + 「拉取模型列表」,`*.listModels`;草稿态凭 `{ baseUrl, apiKey }` 亦可拉取,Key 只在本次 IPC 往返里由主进程拼 Authorization,不落盘不入日志)、API Key(密文输入,只写不回显;编辑留空=不动)。未保存改动关闭需确认(`use-discard-guard`);新建 Dialog 内可草稿测试(不落库);无 Key 时拉模型/测试前置提示并聚焦密钥框。空态与 Dialog 顶部显示接入预设 chips(`connection-presets.ts`,承 v2.1 `AI_CONNECTION_PRESETS`)。类型不设 select:v2.5 新建一律 openai-compatible,存量异型数据兼容展示。
- 「测试连接」钮 ✅:行内 Plug 图标钮;主进程 `aiProviders.test` 真发探测(GET `{baseUrl}/models` 带 bearer,8s 超时),结果 `role="status"` 行内展示(成功「连接正常 · NNNms」绿字 tabular / 失败可读引导红字),不产生生成费用。删除同时清钥匙链(单测断言)。
- Key 只经主进程 safeStorage(keychain),SQLite 只存 has_key/key_suffix 展示位;渲染层不落任何密钥(红线承 v2.1)。
- 删除:AlertDialog(密钥一并删除,历史保留);删除默认连接时最近更新的一条自动接管默认。
- 数据面与工作台 Composer 的 Provider 下拉同源(SQLite providers 表),增删改后两处同时失效刷新。
- **Agent 连接卡**（`AgentConnectionsPanel`，2026-09-03，`hasAgentConnections` 开关，桌面专属）：与生图连接卡并列于同一「连接」区，共用 `ConnectionsPanel` 泛化面板（列表行 / 新建·编辑 Dialog / 设为默认 / 测试 / 删除），文案与 testid 前缀独立（`settings-agent-connections-card`、`agent-connection-*`）。数据面 `gateway.agentConnections`（6 方法）接主进程 `AiConnectionStore`——与设计方案 Agent（Analyst / Compiler / Reviser）和 Skill runtime 同一事实源，v2.1 已配置的文本连接直接出现；「默认」即 Agent 实际使用的连接。账号托管连接显示「账号托管」Badge，编辑/删除禁用。Key 同样只经主进程 keychain，渲染层只见 hasKey/keySuffix。2026-09-06(B1-T3)两卡同享模型拉取 combobox / 脏表单守卫 / 设为默认 / 状态点 / 预设 / 草稿测试,`aiProviders` 与 `agentConnections` 现各 7 方法(含 `listModels`)。仍未覆盖:Agent/生图 key 失效后的可解释引导(S01)。会话列表「需要重启应用」逃生门已由 B2-T3 接 `useRelaunchApp()`(§2.2 / §3.3)。

#### 账号云图像连接卡（B21，桌面专属接缝）

设置「连接」先显示 `AccountCloudConnectionCard`，再列用户自备连接；Web 宿主不提供本机启用域，因此不显示此卡。卡片复用现有 Card/Button/AlertDialog，不增加独立宿主页面。

- 检查连接：只读取当前身份、云执行 binding 与本机记录，不启用同步、不生成、不创建执行身份。
- 连接确认：展示被冻结的账号名称与服务，提交主进程一次性、120 秒有效 reviewRef。换号/身份变化/过期/其他在途工作拒绝并提示重新检查；密钥不进入卡片或 providers 表。
- 已连接：展示当前默认或「设为默认」；此连接无 API Key，不能进入通用 Key 编辑器。主进程验证固定 type/issuer/model 和当前 principal 后才使用。
- 仅核对：匹配安全备份提供显式恢复确认；不匹配记录解释恢复需求，不自动创建 namespace 或清零旧费用。
- 原云任务（B22）：只针对当前账号/服务，每页 20 条稳定游标，包含终态记录；「加载更早的任务」追加并去重，失败可刷新列表。云状态、费用是否已知、本机素材可用性分别展示。核对只查询原任务和下载其素材；仅可取消任务显示「停止原任务」，停止允许重试原取消请求，不自动重新创建生图请求。
- 本机旧托管记录（B22）：独立只读诊断，每页 20 条，未登录也可查看时间、种类、阻塞原因和记录 ID；明确未绑定当前云账号，不展示旧 payer/Prompt，不提供清锚、清零或重新发送操作。
- 成功但缺素材（B22）：工作台/历史显示原任务说明；成功回执结束执行状态，下载尚未完成或本机文件丢失时可「核对原任务」。原文件恢复沿用已有资产记录。云端已清理且费用已知时仅解释结果不可用；费用未知仍可核对，未知不当作零。已有完整本机素材不因云 purge 被标为缺失。

### 7.3 云同步卡(`CloudSyncPanel`,桌面专属,`hasCloudSyncControls` 开关;M4e ✅)

- **登录 ≠ 首次同步授权**:新账号命名空间保持 `unset`，须先明确建立空库或复制本机库，再单独开启同步；登录不自动接管旧库。退出/换号停止原账号传输，但保留该账号的同步同意、设备和待同步队列；返回原账号时 `paused` 仍暂停，已明确开启的 `enabled` 在身份和本机空间有效时恢复。会话失效显示 `auth_blocked` 并保留队列，重新登录恢复后继续原任务，不把 A 的内容发送给 B。生产行为由 B67 真实 Electron/Better Auth/PG 三场景验证，完整发布验收另计。
- 未登录:开关禁用 + 副行「登录账号后可开启」。
- **本机旧库恢复(B12)**:未登录/受限账号也可只读列出和预览旧容器；提示词每页 20 条，文件夹/标签元信息有界并说明截断。已验证账号仅在其全新命名空间选择空库或明确复制，目标已有数据时不可覆盖/合并；只复制提示词、文件夹、标签、使用记录及本机封面引用，不复制生成历史/图片/设计方案、旧 outbox 或同步同意。源 revision 变化、账号变化或重登后旧确认拒绝；复制成功后仍须单独同意首次同步。
- 关闭态(已登录):开关可用 + 副行「开启后提示词、文件夹与标签将同步到云端」。
- 开启态:副行「用户名 · 上次同步时间」;状态区 = 状态 Badge(已是最新/同步中/有冲突/出错)+ 待推送计数 + 冲突计数 + 「立即同步」钮(同步中禁用+Spinner);错误时红字详情。
- 开启即全量同步一轮(bootstrap→pull→push);此后写路径防抖 2s 触发 + 60s 兜底轮 + 启动恢复。
- 关闭只停调度,本地数据与账号记录不动(重开免重新 bootstrap)。
- 同步动作成功后失效提示词缓存(pull 可能带回远端变更)。
- **状态与 Electron E2E**:同步同意明确分为 `unset`、`enabled`、`paused`;Electron sync E2E 已验证 `unset`/`enabled`/`paused`/`conflict` 四态。`unset` 或 `paused` 时 transport 为 0，不发生同步传输。首次显式开启顺序固定为 `bootstrap → pull → push`;暂停期间本地 mutation 与 usage 继续累计，恢复后可继续同步。冲突必须逐条处理，逐条提供 `local`、`remote`、`duplicate` 解决动作，全部处理后状态回到 `idle`。登出再登录不丢失本地账本、待同步 mutation、usage 累计或冲突记录，且不会为新会话静默开启同步。
- **安全与视觉证据**:secret plaintext scan 通过;API key/bearer token 不出现在渲染层、SQLite、日志或导出文件。`sync-unset`、`sync-enabled`、`sync-paused`、`sync-conflict` 四张视觉截图已人工检查。

分类永久删除的冲突例外（B75）：云端 Folder/Tag 已删除时禁用「保留本地」，就地说明「此分类已在云端永久删除，无法恢复。保留云端会移除本机分类，提示词内容会保留。」本地数据层须在改动 outbox 或快照前拒绝恢复，IPC 返回 `VALIDATION_FAILED`；用户仍可明确采用云端删除。正常分类编辑冲突可保留本地；提示词软删除仍可恢复、提示词冲突仍可另存副本。云同步控制卡继续仅由具备该能力的桌面宿主展示。

---

## 8. 交互与反馈统一约定

- **I1 加载**:首屏结构化 skeleton(行/卡同形);局部刷新用 Spinner;按钮内联 loading = Spinner 替换图标 + 禁用。
- **I2 动作可达性**:任何动作不得只藏在浮层(下拉/右键)里;主路径 = 常驻钮(hover 渐显视为常驻),浮层是补充。移动端(无 hover)操作组常显。
- **I3 破坏性动作**:不可恢复的(永久删除/清空/退出登录)必须 AlertDialog;可恢复的(移入回收站/归档)直接执行 + toast(带撤销时限)。
- **I4 错误**:查询错误就地错误卡(标题+消息+重试钮);变更错误 toast(保留用户输入);表单校验错误字段下红字。
- **I5 空态**:图标 + 一句引导 + 主 CTA(能创建的场景必须给 CTA);筛选空态给「清除筛选」。
- **I6 乐观更新**:列表内 CRUD 一律乐观 + 失败回滚;跨屏影响(如生成完成)靠 query invalidation。
- **I7 快捷键(桌面/Web 物理键盘)**:⌘N 新设计(切屏后聚焦 Composer,`workbench-focus-composer` 意图)、⌘K 搜索提示词(全局:切到提示词库并聚焦搜索框,`shell/AppShell` 接线)、⌘, 打开设置(全局,`shell/AppShell` 接线)、`/` 聚焦搜索框(提示词库非输入态)、⌘S 保存提示词(编辑器有未保存修改时)、Enter 发送、Shift+Enter 换行、Esc 关浮层/取消行内编辑。全部登记在 `packages/features/src/shell/shortcuts.ts` `PRODUCT_SHORTCUTS`(单源;关于卡快捷键表与 `shortcuts.test.ts` 接线镜像都读它)。
- **I8 testid**:`<域>-<对象>-<动作>` 蛇形连字;列表行 `<域>-row-<id>`;E2E 只允许用 testid/role 定位。
- **I9 可访问性**:图标钮必须 `aria-label`;活动导航 `aria-current`;浮层焦点圈闭 + Esc 关闭 + 焦点归还触发器。

### 8A. 设计方案(P01 迁移中，Desktop 入口已开)

> **状态**：`doing`（P01，2026-09-10 B61阶段核对）。Desktop 与 Web 的 `hasDesignSchemes` 当前均为 true；两宿主入口、详情与确定性管理已挂载。Desktop 主进程权威 `prepareRun`、run/cancel/event、Agent create/modify/checkUpdate、GitHub 来源确认和参考图运行已接通；B9 已接云上传资产；B10 固定方案 prepare/run/cancel 与 Web Composer 已通过本机统一验收。B11 已接 GitHub 市场搜索与分页，并通过本机统一验收；B34–B49 已提供云端来源/异步 Agent 与专用包后端；B50 将导入预览与确认接入共享页面，B51接入正式包共享下载与Web宿主交付，B52/B53接入导入和导出记录与刷新恢复。B57 接入云端创建的文本授权、逐来源确认与原任务恢复，B58已验证实际API/PG创建合流；B59已接云端修改的独立文本授权、固定版本依据与原任务恢复，局部评审通过，完整E2E已通过390P / 7S（7项适用性/外部条件跳过见测试手册§5.53）。B60 已接独立免费检查更新、逐变化来源确认、二次文本授权与原任务恢复，最终专项浏览器 18P / 0S / 0F、局部评审 ship；B60 完整 E2E 已通过408P / 7S、0F / 0 flaky（1625.283s）；7项适用性/外部条件跳过见测试手册§5.54，B59 的 390P / 7S 仅保留为历史。B61已验证三形态真实generation worker／新版本试运行→封面→转正／升级，并完成桌面实际BYOK试跑、新PID重启与另一Web账号包往返；B61原J0–J5已按当前完整门禁验收（455P/7S，源码与实际归档扫描通过），完整迁移仍待B62/F5-X剩余包兼容、平台与生命周期、生产和管理员环境，旧同步兼容面尚未全部替换。后续执行见 [迁移路线图](./V25-MIGRATION-ROADMAP.md)和 [G-CLOUD 任务卡](./V25-MIGRATION-GOALS.md)。
>
> **Desktop 当前行为**：`runInputSupport=text-and-images`；主进程按 exact revision、formal/trial、来源绑定和 Provider 事实构建计划，执行前再次复核；参考图以受管上传暂存 id 按槽位顺序解析，缺必需输入/超量/无槽位时保留全部输入并解释。运行中提交钮切停止（Esc 同义），取消复用 executionId；成功后正文/槽位/引用复位、附件保留，blocked/failed 在 Composer 就地解释，取消为中性反馈；运行落活动工作台会话与方案双账本。
>
> **Web B10 运行接线**：复用共享 Composer 的运行接缝，服务端准备 exact revision 的固定四步计划，再按同一 executionId 运行并等待持久终态；停止经服务端取消仲裁。文字、图片暂存 ID、提示词引用与当前会话随行，计划及凭据由服务端掌握。张数选择 1/2/4 同时随双宿主方案运行提交，不静默降为一张。创建、修改、市场、专用包各自保持能力边界；本段描述当前接线，完整三形态后端闭环仍由 G-CLOUD-06 验收。

> **B11 市场发现接线**：明确搜索后展示公开候选、许可证和风险；缓存页显示原始获取时间，多页取最早缓存日期。下一页沿原搜索参数请求并去重，失败保留已有候选，可就地重试；迟到的旧响应不覆盖新轮。未接安装能力时保留可读原因与禁用动作。服务端只做发现，安装/Agent 仍归 G-CLOUD-02；实际验证见[市场验证记录](./V25-MARKET-VALIDATION.md)。
>
> **Agent 与来源确认**：创建/修改经主进程 Compiler/Reviser，使用本机 Agent 文本连接；无可用连接返回结构化错误。GitHub 来源解析为固定 ref/commit、许可证和文件清单后逐个显示 `SourceInstallConfirmDialog`，用户确认引入或取消，决定经 `confirmInstall` 回传；仅读取规则、提示词和参考图片，不执行仓库脚本。执行进度在 Composer 展示，修改/更新产生待验证 working draft，正式 current revision 保持可用。
>
> **B57 云端创建授权与任务恢复**：沿用 Graphite / Ember 语义表面、紧凑系统字体、细分隔线与共享按钮；≥768px 使用 `Dialog`，移动使用底部 `Sheet`（左右 16px 留白、主体独立滚动、底部说明与操作保留可见，按钮触区至少 44px），关闭归还入口焦点。创建入口及市场候选只落工作台意图，用户提交后先明确核对模型 offer，再展示模型、GitHub 来源数 + 1 次调用上限、每次输出上限与费用未知说明，点击“同意费用未知并创建”才提交。每个来源另展示固定 ref/commit、文件数、许可证和只读范围，明确确认绑定原父 `executionId` 与该来源 `confirmationId`，不执行仓库脚本。关闭/Esc/卸载只结束本页等待；“取消此任务”须独立 `AlertDialog`，说明影响其他页面且不能撤回已发生的调用。“方案任务”仅分页展示本人任务元信息，选中后经原任务 `get/events` 恢复；丢回包先核对原任务，不自动重建或调用模型，显式重试沿原授权请求。账号 epoch 变化或账号核对失败隐藏旧授权、来源与结果并阻止继续操作；只有服务端 `completed` 草稿结果才能反馈创建成功、清空 Composer 并提供“查看草稿”，试运行生图另行发起。当时云端修改/更新授权入口尚未接通（现分别见 B59/B60）；本段只记录 B57 已建交互，4 项双视口协议浏览器测试已通过，B58另有14项PC/移动真实服务创建用例，完整结果见测试手册§5.52；真实创建已合流，后续图像试运行产品链仍待联合验收。
>
> **B59 云端修改授权与版本依据**（上述 B57“修改入口尚未接通”为当时历史状态）：这是既有 Graphite / Ember 的 Operate 局部扩展，沿用 `SchemeAgentDialog` 的桌面 Dialog / 移动底部 Sheet、共享正文与按钮，不新增视觉体系。工作台挂载方案时从同一次详情读取冻结 `expectedVersion` 与 revision；存在 working draft 时选择其 exact revision，否则使用 current。提交转换为 canonical `modify` 输入的 `baseRevisionId`、`expectedVersion` 与修改描述，沿 `gateway.designSchemes.agent` 的实际异步执行接缝提交，不在发送时换成最新版本。授权前完整显示修改描述和固定依据说明；用户先核对文本模型 offer，再明确点击“同意费用未知并修改”，本次最多 1 次文本模型调用，输出上限取该 offer，来源同意与费用授权独立，图像试跑另行发起。
>
> **B59 生命周期与结果**：关闭/Esc/卸载只结束本页等待，未完成时保留工作台修改描述；不会因关闭取消服务器任务或宣告成功。丢失 202 回包后按原 `executionId` 查询/事件恢复；仅显式“按原授权重试同一请求”重放原请求，不自动重建或追加模型调用。“取消此任务”另经 `AlertDialog` 明确确认，说明跨页面影响和已发生费用。提交前版本冲突禁止自动替换依据，提示关闭后从详情重新选版本，原描述保留；换号、撤权或账号核对失败隐藏旧授权、会话与结果并阻止操作。只有服务端 `completed` 结果才结束工作台成功等待、清空输入并显示“已保存待验证新版本，原正式版未替换”；旧正式版继续可用，新 working draft 不沿用旧版试跑资格，须完成其自身成功试运行后才可转正。
>
> **B59 局部证据与后续**：PC/移动真实服务修改用例 12 passed / 0 skipped、组件 83 passed、实际 API 28 passed、`check` 36/36；设计 detector 为 `[]`。四张既有截图（双视口授权框与待验证版本详情）及相关代码的 [finish review](../../tests/v25/.results/b59/finish-review.md) disposition 为 `ship`，只覆盖本次扩展；完整 E2E 已通过390P / 7S（适用边界见测试手册§5.53），不能据此标记全包完成。失败/取消截图、交互式焦点/动效复核及计算对比度不在该评审证据内。当时下一步为独立免费 `check-update` 与二次文本授权 UI（现已由 B60 接入）；本段 B59 证据不覆盖后续批次，真实新版本试运行→转正链、生产、打包与管理员场景仍待分别验收。
>
> **B60 免费更新检查与独立编译授权**：延续 Graphite / Ember 的 Operate 局部扩展。详情“检查更新”从同一次读取冻结 `schemeId`、`baseRevisionId` 与 `expectedVersion`；“开始免费检查”发送 canonical `check-update`，不获取文本模型 offer、不携带文本授权，也不调用文本模型。无来源 `no-source` 与无变化 `up-to-date` 明确结束且没有付费入口。有变化时逐来源展示仓库、固定 ref/commit、文件/图片数量、许可证与只读范围；“确认引入此来源”绑定原 `executionId` 和当前 `confirmationId`，仅同意采用该变化来源，不授予编译费用。全部确认进入 `authorization-required` 后，用户另点“核对更新模型与费用”，offer 绑定当时的 `session.version`；展示模型、变化来源数 + 1 次调用上限、每次输出上限和费用未知说明，明确点“同意费用未知并编译更新”才提交独立 `authorizeUpdate`。会话版本变化后旧 offer 不能授权，必须重新核对。
>
> **B60 恢复、版本与结果**：免费 start 与付费授权分别冻结原请求；丢回包先经原任务 `get/events` 核对，显式“重试原免费检查请求”与“按原授权重试更新编译”各自重放对应原请求，不重新创建任务、换版本或追加授权。恢复读取仅在首次可信状态或更高版本到达时清除遗留的丢回包错误；旧版本不覆盖现态，同版本内容分歧拒绝。固定方案版本已变化时拒绝提交，提示从详情重新选择。关闭/Esc/卸载只停止本页观察；取消仍经独立 `AlertDialog`，解释跨页面影响和已发生调用不可撤回。换号、撤权或账号核对失败隐藏旧来源、授权、任务与结果并禁止继续操作。结果按实际状态措辞：草稿显示“已保存为待验证草稿”；仅已有正式版的结果显示“已保存待验证新版本，原正式版未替换”。新版本没有继承试运行或转正资格，图像试跑须另行发起。
>
> **B60 视觉复用与证据**：≥768px 仍为共享 `Dialog`，移动为底部 `Sheet`（最大 90dvh、左右 16px、主体独立滚动、底部生命周期说明/关闭/取消操作保留、移动按钮至少 44px），沿用系统字体、语义表面、细分隔线与 Ember 主动作，不新增身份或成品美术。[六截图与代码 finish review](../../tests/v25/.results/b60/finish-review.md) 已完整核对 persistence / fidelity / ceiling / material_fixes / keep，disposition 为局部 `ship`；截图位于 `.impeccable/review/b60/{desktop,mobile}-{source,authorization,result}.png`，来源/授权为内容裁剪，结果为既有详情视口，不能据裁剪宣称完整滚动、焦点、动效或计算对比度已验。B60 实际 Agent 草稿含两仓库图片，变化来源更新、未变化来源及其图片保留，tiny synthetic PNG 是仓库夹具，不是新交付美术；未完成成功图像试跑，也未用 SQL 补造资格。`check-frozen-final` 36/36、features 716；最终专项 `browser-recovery-final` 18P / 0S / 0F（302.578s），实际 `api-final` 45P（同后端，最后 UI 恢复错误修复前）；detector 一次 `[]`。完整 E2E 已通过408P / 7S、0F / 0 flaky（1625.283s）；B59 历史 390P / 7S 不计入 B60；结果见测试手册 §5.54，后续 D4-J 见任务 §5.7.5。该局部交付不代表 P01、全迁移、打包/平台/生命周期、生产或管理员验收完成。
>
> **证据边界**：09-03 已有回环 PNG Provider 下 Desktop 成功与取消的 Electron 记录，证明双账本及正式运行零方案资产提交；B4/B7 有桌面专用包往返与草稿操作记录。Web 已有双视口入口/管理/降级证据，完整云端方案及生产/全平台证据仍待验收。历史测试计数与本轮未复跑的限制统一见 [测试手册](./V25-MIGRATION-TESTING.md)。

- **入口与导航**:侧栏主导航(§2.2)已注册设计方案项(随 `hasDesignSchemes` capability);Composer「+」菜单的「寻找设计方案」与附件「查看详情」已通(详情深链 = `scheme-detail` screen intent / Web `?scheme=` 查询参数);历史来源项随本域恢复(§9-D2)。`/design-schemes` Web 路由与 Desktop 视图挂载即 P01-7。
- **屏幕结构**(共享 features 已有,承旧版布局):顶部控制台(scope tabs「我的方案/发现」+ 搜索 + 刷新 + 新建)→ 分节列表(正式/草稿两区,行 = 56px 封面 + 名称/保真度徽标 + 摘要/来源 + 主动作 + hover 删除)→ 右栏 Inspector(lg+ aside,窄屏 Sheet,参照历史 Inspector 模式);详情为整屏视图(文档分节 + 试运行相册);市场安装确认 = AlertDialog。
- **状态矩阵**(承 ui-parity/06 §5.1,当前唯一验收基准,不另发明状态):我的方案/发现/Inspector/详情/试运行相册各覆盖 loading/error/empty/ready;生命周期另覆盖 approval/pending、blocked、cancelled、failed、conflict/version mismatch。
- **版本变更刷新（09-21实网修复）**：选封面、初次转正、新版转正和文档/名称变更的提交状态持续到权威详情刷新结束；期间详情显示“正在确认方案最新版本，请稍候。”与可读busy状态，禁用依赖版本的菜单、修改、使用/试跑、转正、封面及保存操作，返回仍可用。current读取决定working selector，其失败不能被缓存working详情遮蔽；失败进入原读取错误/重试出口，重试只读取，不重复原写入或生图。已经打开的Agent授权仍冻结原依据，不能为避免冲突自动换成最新版本。PC/移动延迟读取的真实服务专项已验，完整最终回归另记。
- **交互约定**:遵守 §8 I1–I9(常驻动作组、破坏性动作 AlertDialog、就地错误 + 重试、空态给 CTA、testid `<域>-<对象>-<动作>`);组件只用 `packages/ui` 原语、Lucide 出口与语义 token。
- **差异登记**:见 §9(D2 入口恢复、D28 市场分页与缓存恢复)。通用分享/导入与 Skill runtime 会话仍按 §0.2 暂缓。

#### 已移除方案与永久删除（2026-09-19，联合验收中）

方案中心工具区增加常驻“已移除”入口，复用 Graphite / Ember 语义 token、系统字体和现有列表/按钮；≥768px Dialog，移动底部 Sheet，列表独立滚动、底部关闭按钮可达。此入口只管理已软删方案，不引入恢复或批量删除语义。普通方案列表与发现流程不变。

- 列表使用服务端 `deletedOnly`、查询词及严格游标，每页20条；已加载数在还有后页时带“+”，不冒充总数。首次加载、空态、搜索无结果/清除筛选、首屏错误/重试及后页错误保留前页分别呈现。刷新失败隐藏失效列表，防止把旧数据当作当前查询成功。
- 行操作“永久删除”先经 AlertDialog，展示所选方案名称与同次读取的版本。说明方案/版本/专用来源不可恢复，生成历史、图片、运行及费用记录保留；共享或仍受任务保护的文件不删除，无引用文件可稍后清理，不把提交成功说成物理删除完成。
- 请求期间禁止重复提交和关闭。失败保留原目标、原版本与确认框，显式重试不自动换用刷新后的版本；永久删除不作推测性乐观移除，成功或未知结果均刷新列表核对。取消/Escape只关闭内层确认并归还原行焦点；成功后焦点回到列表搜索框，关闭整个列表回到工具区入口。
- 账号 epoch 变化立即隐藏旧列表与确认内容，旧结果不反馈给新账号；关闭重开后重新查询。两宿主使用同一共享组件及 gateway，不在 features 判断 Electron 或访问本机路径。移动行可分行、操作触区至少44px。

---

**B55图片接线（本机适用门禁通过）**：Web宿主将opaque图片ID解析成同源受登录保护的content地址，列表/Inspector/详情封面及相册消费同一接缝。共享方案图片使用既有FadeImage，加载保持占位、失败使用不透明占位覆盖后层图标，并显示网络/登录核对说明和明确重试；行缩略/后层装饰图只给失败占位，保留原行按钮，不嵌套按钮。切换图片清除旧加载/错误状态；灯箱关闭将焦点归还原图片按钮，原按钮已移除时回到相册区域；空态不再限定“本机”，供两宿主共用。重试只读取同一图片，不触发生成或新包导入。灯箱与当前资产集合关联，移除资产后不继续展示旧引用。实际不同图片解码/像素/hash、焦点与身份拒绝/失败恢复通过，完整check/E2E结果见[测试手册§5.49](./V25-MIGRATION-TESTING.md)。完整方案链和未验环境继续开放。

### 8B. 云端方案包导入（B50）

共享 `SchemePackageImportDialog` 只在 gateway 提供 `packageImport` 时接管导入入口；其他宿主仍走已有 `onImportScheme`。文件最大256MiB，先核对实际大小/完整hash，服务端预览显示名称、摘要、来源/图片/文件数量与旧预览说明；不展开包内文件路径，不把来源预览当运行权限。格式不匹配、取消/过期需关闭后重新选择，不自动切格式或替换文件。

状态为读取校验、上传核对、预览、提交、失败；读取/上传使用不定进度，不显示虚假的传输百分比。B52起，关闭/Esc/页面卸载只中止本地等待，保留服务器记录，迟到begin不再自动取消；“取消此上传”经AlertDialog明确确认后才调用取消，先核对是否已经导入或仍在导入。未完成暂存仍受服务器TTL约束，界面不承诺已物理删除。最终导入提交期间关闭/重复确认禁用，避免把未知提交误报取消。网络错误保留原意图，重试查询同一stage，再按原import输入核对不可变回执；不会自动另建副本。换号/撤权后阻止继续确认和旧结果导航。B52已接导入记录：新建导入时可明确查看当前账号的分页记录，核对后展示原预览/执行状态；未上传需重选原文件并比对完整hash/大小/格式，已完成只查看原回执，已删除草稿不重建。记录查询错误隐藏旧内容并提供刷新，账号核对失败隐藏列表/预览。B53已接下节导出刷新恢复；真实身份与三方向真包交换仍属于F5后续联合验收。

成功反馈为“导入记录已确认”，随后回到我的方案并读取该草稿详情；历史回执的实体若后来被删除，详情按现有错误/返回路径处理，不能把历史回执当作新实体。Esc/关闭将焦点还给“新建”；导入后按详情导航处理。

---

### 8C. 云端正式方案包导出与恢复（B51/B53）

详情“导出分享包”在宿主提供packageExport时打开共享Dialog（≥768px）或底部Sheet；其他宿主使用原生导出。打开锁定当前正式版本，准备归档与下载保存分成两个明确动作；working draft不能替换本次选择。只展示阶段和文件大小，不显示虚假百分比或内部版本ID。

阶段为准备、ready、下载/核对/保存、失败和完成；ready只表示服务器归档可读。可用保存选择器时成功关闭文件后显示“方案包已保存”；普通浏览器交接显示“已交给浏览器下载，请在下载列表中核对是否完成”。选择器取消留在ready，失败可按原包重试，提醒先核对既有下载；已完成不再提供重复保存。B53起关闭仅中止本地等待并保留原记录，迟到结果不反馈；换号/账号核对失败禁用动作并隐藏旧包信息。Esc/关闭归还“更多方案操作”按钮焦点。详情入口本批不再经过旧Web export-package 501路径。截图复核另修复窄屏详情标题及待验证版本说明受同行动作挤压：<768px 动作组移至各自独立第二行，标题/摘要可断行；桌面结构不变（D39）。

---

B53恢复交互：方案中心工具区提供“导出记录”，导出框可查看本人记录；只读恢复原归档后明确下载，不能自动打包或根据ready冒报已保存。关闭页面仅中止本地IO并保留记录，宿主交付后亦保留到有效期；明确“取消此导出”经AlertDialog确认后调用原取消服务，说明影响其他页面且不能撤回已有文件。状态增加核对/取消中、过期/授权变化/版本依据变化与失败重查；账号核对失败隐藏旧内容。已交付后隐藏恢复刷新控制，保留交付结果；移动工具区允许搜索与动作分行，避免挤压。完整批次验收及局限见测试手册§5.47。

## 9. 与旧版差异登记表(有意变化,已批准)

| # | 差异 | 旧版 | 新版 | 理由 |
|---|---|---|---|---|
| D1 | 列表行动作形态 | 部分屏用下拉菜单收纳 | 常驻操作组(hover 渐显) | 触屏可达性 + E2E 稳定性(M4a 教训);信息架构不变 |
| D2 | 设计方案/Skill/豆包入口 | Composer「+」菜单与侧栏入口 | 设计方案随 P01 恢复；Skill runtime 入口继续暂缓；豆包保留账号/连接区可达薄入口 | 用户已将设计方案纳入本轮迁移；Skill 与豆包专属 renderer 仍按 §0.2 冻结/暂缓，禁止死入口 |
| D3 | 单次生成张数 | 桌面可选 1/2/4 | 双端 1/2/4,`maxGenerationCount` 现均为 4;契约 `generationCountSchema`;桌面 core `n` → provider 逐张落盘 → `generated_assets` position;云端 worker 透传 `n`;计费在上游按张扣,`apps/api` 无本地 `estimateCost`。宿主上限 1 时张数组与「默认张数」不渲染 | B2-T1 解锁;成本闸改由 capability 夹档,不再锁死 literal(1) |
| D4 | 反向提示词位置 | 设置弹层内 | 同旧(弹层内) | M4b 首版曾常驻,按本规范收回弹层 |
| D5 | 顶栏(Web 大屏) | 常驻 ProductTopbar | 取消常驻,仅侧栏收起时给展开钮 | 与桌面口径统一,最大化内容区;额度 readout 移侧栏账号区 |
| D6 | 会话未读/置顶存储 | localStorage 偏好 | 同机制承接(platform 偏好接口) | 跨端同步待后续版本 |
| D7 | 自定义比例传输形态 | RatioPicker 支持,domain 内部用 `custom:W:H` 前缀 | UI 已恢复(§3.2 自定义行);v2.5 数据流只传 canonical `W:H`(每边 1–99 无前导零,比例限 1:4–4:1),`custom:` 前缀不落草稿/请求 | 契约与 UI 共用相同比例边界;是否自定义由「值不在预设目录」推导,无需前缀通道,同一比例不会产生多个幂等指纹 |
| D8 | 桌宠/朱点 | 常驻 | 冻结不迁 | 用户指示(2026-08-28) |
| D9 | 登录形态 | 独立登录屏(桌面)/登录页(Web 设想) | 设置页账号卡内联账密表单,双端同一份 | 凭据委托 New API(账密),无第三方 IdP;内联表单少一跳,四端一致 |
| D10 | 设置布局 | 分组导航工作区 | 已按 §6.1 目标形态交付(分组导航 + 分区面板,现 8 分区;2026-09-03 切换,此前单列卡片流退役;B2 增 `open` / `usage`) | 分区达阈值后与旧版形态一致,不再是差异;保留行号供历史引用 |
| D11 | AI 连接类型选择 | 新建时可选类型 | 固定 openai-compatible | v2.5 唯一受支持协议;豆包网页等随各自域后续排卡 |
| D12 | Web↔API 部署形态 | 分域(CORS) | 同源(宿主反代 /api/*) | 会话 cookie 同站直用,免 CORS/第三方 cookie 一整类问题;API 刻意不开 CORS |
| D13 | 工作台空态快捷建议 | 三行逐字横滚动画 + 英文水印背景(大段自定义 CSS) | **已撤销**(2026-08-29):水印 / 横滚 / mark 96px 按旧值恢复,减少动效双通道降级为静态三行(ui globals.css token 化) | 用户要求承旧;差异不再存在,行保留供历史引用 |
| D14 | Prompt 引用传输与快照 | renderer 可携带展示文本/标题参与后续编排 | renderer 只传 `promptId/scope/expectedVersion/range`;Web 服务端或 Desktop 主进程按 owner/workspace 解析,生成账本存不可变 title/text/version 快照 | 客户端文本不是权威数据;阻断越权/伪造,同时保证源编辑或删除后历史不漂移;功能结果与入口不变 |
| D15 | compact 抽屉账号区 | 点击账号区即关闭抽屉 | 点击账号区保持抽屉,完成身份/连接菜单动作后由动作自身导航或关闭 | 当前账号菜单以抽屉内触发器为锚,提前卸载会使登录/切换入口不可操作;导航、新设计和会话仍按旧语义自动关闭 |
| D16 | macOS brandInset 几何 | 展开/收起顶栏使用不同 inset,原生全屏回落 12px | v2.5 统一由单一 `brandInset` prop 承载:非全屏 78px、原生全屏 12px,非 macOS 0px | 保留交通灯让位和全屏回落结果,减少共享 AppShell 的平台分支;窗口状态走只读宿主信号,不进入业务数据通道 |
| D17 | 归档删除语义 | 旧版归档列表删除为永久删除 | 归档列表仍沿 `removeSession` 软删;B76独立会话回收站确认后purge/清空,恢复保持原归档位置,生成/资产/费用保留 | 把可恢复删除和永久清理分为明确动作;状态与验收见§6.4 |
| D18 | 界面密度消费范围 | 密度 token 即时作用于全部列表行/导航 | 设置页/导航/设置行/提示词行/历史行已消费 `--density-*`;`ui/card` 舒适态保持 shadcn `px-6`/`py-6`(token 舒适值 0.75rem 对不上),紧凑走 `--density-card-padding`。`SessionListPanel` 已接 `--density-nav-y`(B2-T3)。紧凑态用数值断言,不另加视觉基线 | B2-T4 消费点收口;舒适 card 与 token 数值不对齐是有意保持 shadcn 默认 |
| D19 | 「清空全部数据」边界 | 清七类业务表 + `prompts_fts` | 增清 `workbench_sessions` / `workbench_drafts`(十表 + fts) | v2.5 单账本下 runs 的 `workbench_session_id` 是 set null,只清 runs 会在工作台留下一串无轮次空对话;Provider / 密钥 / 图片文件仍不在边界内 |
| D20 | 第三方许可清单数据源 | 桌面 renderer 内静态表(桌面 only) | `packages/features/src/settings/third-party-notices.ts`(双端同一份),形状由 contracts `thirdPartyNoticeSchema` 约束 | 纯静态许可数据,双端都需可达;走 IPC 只多一跳,合规要求 Web 也能看到 |
| D21 | AI 连接编辑形态 | master-detail(左列表右表单) | 列表 + Dialog(新建/编辑),行首状态点 + 常驻操作 | 与提示词/历史屏的「列表 + 浮层」语法统一;信息与动作集合不变,D11 类型固定同时保留 |
| D22 | 历史「相关作品」过滤位置 | — (旧版无此面板) | `generation.list({ promptId, status:'succeeded', limit:100 })` 服务端按 `r.prompt_id` 过滤;客户端只留有成图的回合 | B4-T1 收口;`limit` 缺省 20 防 SQLite `LIMIT NaN`;历史超过一页仍可能漏,完整跨页由生成域后续卡 |
| D23 | 开放能力·令牌行 | 旧版有「显示明文」切换 | v2.5 **不做**(密钥不进渲染层,主进程写剪贴板) | 密钥红线:bearer 不进 DOM / 快照 / 日志;`automation.copyToken` 只在主进程 `clipboard.writeText` |
| D24 | 开放能力·最近调用 | 旧版一条花钱审计 20 条相对时间 | v2.5 拆「请求日志 + 花钱记录」各 50 条、绝对 `MM/DD HH:mm` | 控制面不是审计终端;绝对时间更易核对;条数上限见契约 `AUTOMATION_LOG_LIMIT` |
| D25 | 额度不足恢复 | 错误卡纯文案「去兑换」 | 可点「去兑换」深链账号分区；retry 新意图用新 key、同一未结束意图共享，replay create 保留原 key；到账与续发结果分开、可返回任务；Web `canGenerate===false` 预检；终态刷额度；桌面只为官方额度码提供兑换引导 | B6 基础、B29 反馈/并发/换号及桌面错误映射；不做 approve/reject API，完整费用合流仍属 U03-spend |
| D26 | 提示词编辑器打开快照 | 每次 `open`/对象引用变化都重置表单 | 同一次打开(`prompt.id` 或 `new`)只快照一次;Strict remount 与列表 refetch 不覆盖已输入;创建/保存失败 toast 且保留表单 | B7 活体登录暴露 Next Strict Mode 竞态;dirty guard 语义不变 |
| D27 | 时间线软键盘留白 | 固定 `pb-[172px] md:pb-[220px]` | `<md` inset>0 时 `paddingBottom = 172 + inset`(`data-keyboard-inset`);inset=0 / md+ 仍走 Tailwind 172/220 | B8-T3:Composer 抬起后最后一回合可滚出遮挡;桌面几何不变 |
| D28 | 市场分页与缓存反馈 | 一次查询展示候选，缓存获取时间和下一页恢复不完整 | B11 共享发现屏显式加载下一页并去重，失败保留前页；缓存页显示原 fetchedAt，多页取最早时间；未接安装时说明原因 | 消费已有 cursor 合同，保留明确搜索动作，补错误恢复与缓存来源可核对性；Web/移动专项18项及完整双端E2E通过 |
| D29 | 账号与旧库恢复 | 旧账号映射/本机 owner 不能独立证明历史归属 | B12 共享受限恢复、原设备核对、明确独立空间；旧本机库可预览并明确复制到新命名空间，首次同步另同意，确认绑定当前会话 | 已验证与未验证身份都有可操作路径；不把登录或本机复制当作领取旧云数据的权限；01:46 真实 Web/Electron 验证通过，详见开发记录 |
| D30 | 移动会话操作可达性 | 部分行操作依赖 coarse pointer/hover 显示，窄屏触发器仅 24px | `<md` 操作组常显、更多菜单触区 44×44；沿用单源菜单和删除 AlertDialog，取消不发删除，删除当前/最后一项按既有会话语义回退 | 补齐移动抽屉中的稳定入口；不再按视口跳过会话删除测试。单元专项58项、实际PC/移动浏览器4项通过；09-08接续全量E2E242 passed/7 skipped、零失败/不稳定，报告与源码清单见开发记录 |
| D31 | 备份恢复失败与保留策略 | 失败统一提示数据未替换，确认框可重复提交；安全副本参与普通清理 | 进入恢复隔离后的失败要求明确重启，关闭确认框并禁用重复提交；修改前的无效备份仍可重试；恢复安全副本单独保留 | B16 防止旧回调惰性打开替换库，错误不承诺无法证明的数据状态，并保留可恢复依据 |
| D32 | B27 重试入口与进行中交互 | 工作台成功/过期也有重试钮，快速点击各自产生新意图，历史/工作台反馈不一致 | 四端共用失败/取消资格，账号云费用未知或purge仅核对；同一进行中交互共享禁用状态并显示失败原因，完成后新点击仍新授权 | 对齐当前两端服务真实合同，避免无效入口与用户快速重复点击造成重复授权；不改冻结面和底层费用规则 |
| D33 | 旧账号连接失败 | 保留旧 Key 时本地路径可能继续发送，历史错误缺少身份引导 | 未绑定账号连接在发送前失败，历史显示“账号连接需要核对”，提供检查连接入口，不显示同一连接重试动作 | B30 公共准入与真实 Electron 详情深链已验；允许用户另行选择自备连接或完成可信账号连接，不自动代换付款身份 |
| D34 | 默认连接删除与账号云管理 | 删除自备默认可能自动激活旧云连接；本地管理的云保护与界面不一致 | 删除后仅由其他非账号本地连接接管，无合适候选显示无默认；云编辑、激活和验证遵循同一主进程保护 | B31 真实 IPC/本地 HTTP 正反例已验；用户重新选择并核对云连接，不由删除操作隐式选择付款身份 |
| D35 | 旧模型缺失的历史重试 | 原 unknown 模型仍会被接受生成，或拒绝后等待不存在的新记录 | 本地 retry 即时显示原模型无法核对及连接设置/工作台新意图说明，结束提交状态；原历史不改写、不自动重放 | B32 真实历史→连接设置→工作台已验；独立可信云任务仍沿原冻结请求与授权核对 |
| D36 | 云端方案包导入 | Web 入口未提供文件预览确认 | B50 可选 packageImport 接缝：新建→导入分享包→选择文件与格式→上传/预览→明确确认→草稿详情；≥768px Dialog、窄屏底部 Sheet，共享内容和焦点圈闭；Desktop 继续原生 prepare/import | 服务端持久上传与精确确认成为产品入口；格式 2 默认，旧格式 1 显式选择；导入不授予试跑/封面资格 |
| D37 | 确认弹窗快速重开 | AlertDialog 的遮罩与内容各自创建同层 portal，退出时差可让重开的遮罩排到内容之后并遮挡按钮 | 遮罩与确认内容同组挂载，内容位于其遮罩内；遮罩负责整组淡入淡出并与内容共用 --dur-base，内容保留缩放；焦点、Esc/取消与明确确认不变 | B50 全量移动回归发现、独立浏览器复现及调整退出时差的PC/移动红绿测试；不以强制点击、删除用例或提高z-index掩盖 |
| D38 | 云方案包导出交付 | 原生单次保存；Web旧同步导出接口不可用 | B51共享准备/下载页面，经可选宿主接缝交付；浏览器download-started与写入close后的delivered分开，原生流程沿用 | 避免把服务器ready或下载点击冒充文件已保存；保留精确版本、失败重试、取消/换号与焦点恢复 |
| D39 | 移动方案详情标题/版本说明与动作 | 标题/待验证说明与多个固定宽度动作始终同行，窄屏文字被压成逐字竖排 | <768px 标题及待验证说明各自首行、对应操作组独占第二行并可换行，长连续标题/摘要允许断行；桌面维持原横排 | B51实际截图发现标题仅20px宽；增加真实浏览器标题宽高及横向溢出断言，不靠截图替换掩盖 |
| D40 | 方案包页面关闭与恢复 | B50关闭/Esc/卸载即尽力取消暂存，重开丢失本地意图 | B52关闭只中止本地等待，服务器记录可分页核对；明确取消经确认执行；完成回执只读，未上传要求原文件重选 | 区分生命周期卸载和用户取消，避免刷新或第二页面关闭误取消原请求；保持账号隔离与原写入口授权，Desktop原生流程不改 |
| D41 | 云方案包导出恢复 | 仅同次对话框保留意图，关闭或交付后尽力取消 | 本人分页原归档记录、显式资格核对及下载；关闭/交付不取消，明确取消有独立确认 | 支持丢回包、刷新/新页与多页面共用；ready不证明本地已保存，过期/撤权/版本变化仍由服务端拒绝 |
| D42 | 方案图片加载与灯箱恢复 | Web没有地址接线，读取失败只有空白；灯箱退出未归还焦点 | 受保护同源图片读取，共享加载/错误/明确重试；换源重置状态，关闭灯箱归还触发器或相册，失去资产后关闭预览 | B55补齐可达图片与可读失败反馈；不改变生成、费用或包状态，实际像素/身份/焦点回归证明适用范围 |

| D43 | 云端方案创建授权与原任务恢复 | Web只具备后端异步接缝，共享创建与恢复页面缺席 | B57工作台明确核对文本模型和本次调用上限；逐源确认原execution/confirmationId；本人任务分页、原get/events恢复；关闭保留执行，取消独立确认 | 来源同意与费用授权分开；completed才报草稿成功；账号变化/错误隐藏旧内容；B58实际服务创建已验，修改/更新与图像试跑全链仍由G-CLOUD联合验收 |
| D44 | 已移除方案清理入口 | 方案软删后没有可发现的永久清理入口 | 独立分页“已移除”列表，逐方案固定版本确认；历史/费用与受保护文件保留，成功后刷新而非推测删除 | 接通已存在的永久删除语义；明确不可逆范围，区分逻辑删除与物理清理，避免误删仍在使用的资产 |
| D45 | 账号模式模型与价格 | 账号云图像使用固定默认模型 | 普通生成及方案试跑/正式运行共享账号模型Select和云端单价，按账号隔离设备偏好；发送前复核变化并保持冻结模型 | 2026-09-20用户新增要求；三端基础联合路径已验，方案创建/修改仍独立文本授权，最终同源全量仍待，不修改历史费用 |
| D46 | 登录设备与满额恢复（已实现，上游扩展已部署） | 满额仅报错，Musefold没有设备管理面 | 设置账号卡显示脱敏设备；满额完整认证后显式选择释放并登录；过期自动回收、正常退出同步释放 | 2026-09-20用户新增；不静默踢活跃设备、不泄漏token；规范§7.1A，本机三形态/真实镜像验证及上游账号扩展生产部署通过，详见V25-LOGIN-SESSIONS§10；不是Musefold公共站点整体上线，09-21增量验收另记 |

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
| `design-schemes`(P01 迁移中,§8A) | `SchemesScreen` `SchemeControlDeck` `SchemeInspector` `SchemeDetailView` + hooks | 两宿主代码挂载；Desktop 入口开启(`hasDesignSchemes=true`)且 Workbench 运行缝 `onRun/onCancelRun`（含参考图）与 Agent 缝 `onCreate/onModify`（含 GitHub 安装确认）已接通；Desktop `.musefold.design` 导入导出 E2E 已于 2026-09-06 B4-T5 验收,B7-T3 补草稿重命名/删除(`electron.design-schemes.spec.ts` 4/4,`MUSEFOLD_E2E` 对话框旁路);Web 入口开启，B10 固定 prepare/run/cancel 与 Composer 已通过本机统一验收；B11 市场发现/分页已通过本机统一验收；B50 云端导入页面消费持久上传/确认/原子回执；B51正式包共享准备/下载与Web宿主交付已接，B52/B53服务器导入/导出记录与恢复已接；B57云端创建文本授权、逐来源确认与本人原任务恢复已接，B58实际服务创建合流已验；B59云端修改授权与固定版本已接；B60独立免费检查、变化来源确认、二次文本授权及原任务恢复已接；B61原三形态真实新版本试跑/封面/升级、包跨端与J5故障范围已验，F5-X系统交付及其他迁移条件仍待，旧同步兼容接口未全替换 |
| `settings` | `SettingsScreen` + 分区注册表 `sections.tsx` + 分区卡(`AppearanceCard` `GenerationDefaultsCard` `DataStorageCard` `AboutCard` …)+ `DensitySync` + system hooks | 两宿主(本机数据面 `hasLocalDataManagement`) |
| `account`(M4d/M4e) | `AccountPanel` `ConnectionsPanel`(泛化)→ `AiConnectionsPanel` / `AgentConnectionsPanel` `CloudSyncPanel` `AccountFooter` + hooks + `connection-presets` / `connection-status` | 两宿主(连接/同步面桌面 only,能力开关控制) |
| `onboarding`(U01,§2.6) | `OnboardingFlow` + `useOnboardingGate` / `useCompleteOnboarding` | 两宿主各一行挂载 |

宿主差异一律经 `MusefoldGateway` 能力开关(`PlatformCapabilities`)表达,禁止在 features 内写 `isElectron` 分支。

**B59 复用与证据补记（历史）**：B57/B58 时的“云端修改待接”由本批接通； `WorkbenchScreen` 经 `useCloudSchemeCreate` 的 `onModify` 接入共享 `SchemeAgentDialog` / `useSchemeAgent`，`agent-presentation` 转换 canonical 修改输入，`integration-store` 保存同次读取的版本依据。能力由可选 `designSchemes.agent` 提供，桌面本机 Agent 接缝保持既有路径；桌面宽度 Dialog 与移动 Sheet 共用内容。局部真实服务双视口 12 passed / 0 skipped、组件 83 passed、实际 API 28 passed、`check` 36/36、detector `[]`；[四截图与代码评审](../../tests/v25/.results/b59/finish-review.md) 为局部 `ship`。完整 E2E 已通过390P / 7S（适用边界见测试手册§5.53），当时更新检查/二次授权尚待 B60，真实新版本试跑转正与生产/打包/管理员覆盖不能计为完成。

**B60 复用与当时边界（历史）**：`SchemeDetailView` 从详情冻结免费检查意图，`agent-presentation` 承载 canonical `check-update` 与状态文案，`useSchemeAgent` 分别保存免费 start 和独立 `authorizeUpdate` 请求；共享 `SchemeAgentDialog` 复用来源确认、文本 offer、原任务列表/恢复与按实际草稿状态的结果入口。四端共享组件不新增宿主分支，云端能力仍由可选 `designSchemes.agent` 表达，Desktop 本机检查更新路径保持既有接缝。局部证据为最终专项浏览器 18P / 0S / 0F、实际 API 45P、`check` 36/36（features 716）、一次 detector `[]` 与[六截图完整评审 ship](../../tests/v25/.results/b60/finish-review.md)；B60 完整 E2E 已通过408P / 7S、0F / 0 flaky（1625.283s），B59 390P / 7S 仅作历史。实际草稿/仓库图片更新不授予成功试跑、封面或正式资格；D4-J 真实 generation worker／trial／cover／formalize／promote／package、全迁移及平台/生命周期/生产/管理员验收继续开放（测试手册 §5.54、任务 §5.7.5）。

### 10.3 旧代码处置

各域垂直切换完成时,同域旧实现(`apps/desktop/src/features/<域>`、`packages/product-ui/<域>`、`apps/web/src` 对应视图)与旧测试同卡删除;`packages/legacy-ui` 于 M5c 整体退役。

---

<!-- B61:START -->
**B61生命周期补充（进行中）**：`SchemeDetailView`的Agent观察窗口在新working revision的加载、读取失败及成功视图之间保持同一execution/key；加载详情不清空原任务完成态，也不重新发起免费检查或费用授权。共享Dialog/Sheet视觉与宿主边界沿用，未新增视觉基线。三形态真实试跑、选新封面与包往返PC/移动6P；生命周期1P。历史正向全量414P/7S对应1554项快照，之后故障专项对应1556项；最新跨宿主修复与测试对应1559项，结果与适用回归见测试手册§5.55最新增量。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。 具体证据见[测试手册§5.55](./V25-MIGRATION-TESTING.md)。
<!-- B61:J4 START -->
**B61跨端行为补充**：B61跨宿主增量：纯描述、GitHub、历史素材三类真实新Agent结果均通过 Web→Desktop→Mobile Web（3P，83.409秒）；桌面以实际BYOK试跑获得本版资格，选新封面正式化，经新PID重启再导出，由另一Web账号导入为无资格新草稿。修复桌面导出按扩展名覆盖已接纳文本MIME的问题，完整分享单测21P、check36/36；本轮留存13份真实ZIP（最终专项6份）及源码扫描零命中/错误。 本次没有新增视觉设计或更新基线；相册测试等待实际资产总数可见，主动作/新封面/正式化沿用既有组件。J4-b三形态内容往返正向已验，系统picker取消仍由F5-X.H补验；J5详情读取故障、撤权/版本竞争、实际异常进程与资产清理组合，F5-X其余及原E/平台包/生产回滚仍待。B61、迁移整包和管理员前置保持开放。
<!-- B61:J4 END -->
<!-- B61:AUTHORITY-READ START -->
**B61读取错误态验收补充**：事件或任务状态GET失败后保留本次Composer输入；实际后台仅完成原请求，随后详情GET503显示既有`runtime-scheme-detail-error`及“重试”，恢复后只读原方案。双视口新增4场景通过（包含于本轮12P）；没有改产品组件或视觉基线，不声称字段在reload后仍持久化。当前仅测试及fixture变化，1561项源码摘要0cde8ba7…；J5实际浏览器撤权/跨owner/版本与promote组合、材料型交叉故障、实际bin异常重启/自然租约/stale epoch及对象/数据库清理仍待。F5-X、原E、平台/生产与管理员前置不随本片关闭。
<!-- B61:AUTHORITY-READ END -->
<!-- B61:END -->

## 11. 验收口径

每个 M4 卡交付时对照本文件逐屏核对:

1. 布局与 §2–§7 规格一致;差异要么修掉、要么补进 §9 登记。
2. 状态矩阵全覆盖(loading/empty/error/ready 至少四态有 UI,不允许白屏或悬空 Spinner)。
3. Playwright E2E 覆盖主路径 + 视觉快照(web-desktop / web-mobile / electron 三形态)。
4. `pnpm run check` 全绿;组件无硬编码色值(抽查)。
5. Electron sync E2E 覆盖 `unset`/`enabled`/`paused`/`conflict`、`unset`/`paused` zero transport、首次同步顺序、暂停期间 mutation/usage 累计、逐条 `local`/`remote`/`duplicate` 冲突解决、登出再登录保留语义。
6. secret plaintext scan 通过;四张同步视觉截图已人工检查。

<!-- B62:LEGACY START -->
**旧方案包的桌面详情（B62，本项已验）**：合法v1来源和图片经共用内容映射获得本机新ID；来源正文完整保留，旧来源图片与预览进入引用/示例资产，详情可读取，不继承封面或成功试跑资格。无法核实的旧commit保留在私有溯源，canonical字段为null；旧scan中的任意身份/试跑声明不能成为可信事实。此处修复数据映射，沿用原列表/详情/图片组件及导入反馈；36个三端导入场景已验；同源码受影响回归163P/2S/0F/0flaky（完整Electron153P/2S、PC/移动Web各5P），两项真实凭据skip保留到发布验收。仅关闭F5-X.C，容量/自然期限/系统picker等仍待；详见测试手册§5.56。
<!-- B62:LEGACY END -->
