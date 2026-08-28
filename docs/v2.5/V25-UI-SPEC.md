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
| 设置 | 卡片流(分组导航后置) | M4d ✅ | 已交付,§6 记录基准 |
| 账号 / AI 连接 | 账号面板 / 连接管理 / 余额兑换 | M4d ✅ | 已交付,§7 记录基准 |

### 0.2 暂不迁移(保留旧实现或冻结,不进新渲染层)

| 项 | 处置 | 说明 |
|---|---|---|
| **桌宠(pet)** | 冻结,不迁移不确认 | 独立 renderer 入口按 D1 保留在旧栈,v2.5 渲染层不出现 |
| **EmberMark 朱点(右上角橙色小点)** | 冻结,不迁移不确认 | 外部任务活动指示,待后续版本重新设计 |
| 设计方案域(design-schemes) | 暂缓 | M4 未排卡;侧栏导航不出现该入口,Composer 相关菜单项不迁 |
| 豆包网页模式(doubao-web) | 主进程语义保留,渲染层暂缓 | Composer 的豆包专属文案/限制提示随该域后续排卡 |
| Skill runtime 会话 / GitHub Skill 导入 | 暂缓 | Composer「+」菜单相关项不迁 |
| 命令面板(⌘K) | 暂缓,壳预留入口 | 顶栏搜索按钮先跳提示词库搜索,后续接命令面板 |
| 微调(refinement)链 | 暂缓至 M4c 后评估 | 历史屏先展示 parentRunId 线索,不提供发起微调入口 |
| 归档会话浏览 | 暂缓 | 会话「归档」动作保留,归档列表入口在设置(§6)占位 |

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
│ │功能导航   │ │ │                                  │ │
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
| Web < md(移动) | 无侧栏 | **底部标签栏**(工作台/库/历史/设置) | 工作台屏顶部会话选择器(§3.4) |

### 2.2 侧栏构成(自上而下,承旧 `ProductSidebar`)

1. **品牌行**:Musefold 标记 + 字标;右侧「收起侧栏」图标钮(`sidebar-collapse`)。macOS 未全屏时头部左侧让位红绿灯(inset 86px,宿主注入)。
2. **新设计按钮**:图标 SquarePen + 「新设计」 + kbd `⌘N`;点击 = 建新会话并切到工作台(`sidebar-new-design`)。
3. **「功能」分节标签 + 主导航**:工作台(生成)、提示词库、生成历史。活动项 `aria-current="page"` + 强调底色;每项可带 count 角标。testid `nav-<id>`。
4. **「对话」分节 + 会话列表**(滚动区,详见 §3.3)。
5. **底部账号/设置区**:头像 + 名称 + 额度/状态一行;点击开菜单(账号设置/退出登录/设置入口)。桌面另有访问模式切换器(本地/云端)语义,M4d 收口。

### 2.3 顶栏

- **Web ≥ md**:仅侧栏收起时在主区左上显示展开钮;不设常驻顶栏(承桌面口径,最大化内容区)。
- **Web < md(移动)**:常驻顶栏 = 当前域图标+标题(工作台显示会话名+会话菜单)+ 搜索钮 + 额度 readout(Sparkles 图标 + 数字,`tabular-nums`)。
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
- [x] 侧栏品牌行 + 收起/展开(收起态主区左上展开钮)。
- [x] 桌面 macOS 红绿灯 inset(`brandInset` prop,收起态展开钮同步让位);侧栏为窗口拖拽区(桌面宿主 CSS 作用域)。
- [ ] 移动顶栏的搜索钮与额度 readout:依赖账号域,随 M4d 补齐(当前移动顶栏仅品牌)。
- [ ] 会话行运行/未读状态点、置顶:待契约补 `latestStatus` 与偏好通道,随 M4e 收口(§3.3)。

---

## 3. 工作台(生成)——`packages/features/src/workbench`

### 3.1 屏幕布局

```text
┌───────────────────────────────────────────┐
│ 时间线(滚动区,居中列 max-w-3xl)              │
│  [回合 1] 用户气泡(右对齐)                   │
│           助手帧(头像+结果网格+动作行)         │
│  [回合 2] …                                │
│  ▼ 自动贴底                                 │
├───────────────────────────────────────────┤
│ Composer(貼底,同宽居中)                     │
│ ┌─────────────────────────────────────┐   │
│ │ 提示词多行输入(自动增高,Enter 发送)      │   │
│ │ [＋] [比例▾] [设置⚙▾]      [发送/停止] │   │
│ └─────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

- **空态(无回合)**:品牌锁定区(标记+一句欢迎语)+ 内联 Composer 居中(承旧 v2.0 §11 形态);首次发送后 Composer 落底。
- 会话列表不在本屏(住壳侧栏,§2.2);移动端在本屏顶部放会话选择器(§3.4)。

### 3.2 Composer 规格

| 控件 | 形态 | 契约字段 | 约定 |
|---|---|---|---|
| 提示词输入 | 多行 textarea,自动增高(max 8 行) | `prompt` | Enter 发送 / Shift+Enter 换行;≥90% 限长时右下角显示 `字数/上限` 计数 |
| 比例选择 | 紧凑触发钮 + Popover 选项组 | `aspectRatio` | 选项:自动、1:1、4:3、3:4、16:9、9:16;承旧 RatioPicker 交互,自定义比例暂缓 |
| 生成设置 | 齿轮触发钮 + Popover | `quality`、`negative` | 质量:自动/低/中/高;反向提示词 textarea 收进弹层(不常驻);数量锁 1(§9-D3) |
| Provider 选择 | 下拉(桌面显示本地连接;云端固定「Musefold 云生图」) | `providerId` | 无可用连接时禁用发送并给引导文案 |
| 「+」菜单 | 触发钮 + 菜单 | — | v2.5 首版仅「参考图(上传)」占位禁用;设计方案/Skill/历史来源项不迁(§0.2) |
| 发送/停止 | 主按钮,状态互斥 | — | 空提示词或无 Provider 时禁用;运行中变「停止生成」(Square 图标),取消中 spinner+「正在取消」 |

testid 约定:`composer-prompt`、`composer-submit`、`composer-cancel`、`composer-ratio`、`composer-settings`、`composer-provider`。

### 3.3 会话列表(壳侧栏「对话」区)——`SessionListPanel`

行 = 状态点 + 标题(单行截断)+ hover 常驻操作组;承旧 `WorkbenchSessionList` 语义:

| 交互 | 触发 | 行为 |
|---|---|---|
| 打开 | 点击行 | 切到工作台并载入会话;清未读 |
| 重命名 | 行内操作钮 / 右键菜单 | 行内变输入框,Enter 提交、Esc 取消 |
| 置顶/取消置顶 | 操作钮 / 右键 | 置顶组排前;本地偏好存储 |
| 归档 | 右键菜单 | 移出列表(归档列表入口暂缓,§0.2) |
| 删除 | 右键菜单 → AlertDialog 确认 | 软删,可从回收站恢复(回收站入口:设置-数据,M4d) |
| 状态指示 | 行首点 | `running` 动画点(该会话有进行中生成)/`unread` 实心点/`idle` 无 |

状态矩阵:loading = 3 行 skeleton;error = 一句错误 + 「重试」;空 = 「还没有对话。点「新设计」开始,发送后会立即出现在这里。」(承旧文案)。

右键菜单为桌面增强入口,**不得是任何动作的唯一入口**(§8-I2):所有动作都有行内钮或对话框路径。

### 3.4 移动端形态

- 屏顶会话选择器(`session-picker`):当前会话名 + 下拉(会话列表复用同一数据 hook);旁置「新建」钮(`session-create-mobile`)。
- 时间线与 Composer 同桌面,Composer 贴底并处理软键盘 inset。

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
- 新回合出现或状态推进时自动贴底滚动;用户手动上滚后暂停自动贴底(阈值 80px,回底恢复)。
- 时间线空态(有会话无回合):居中品牌空态(§3.1)。
- 时间线 loading:居中 Spinner;error:错误卡 + 重试。

### 3.6 数据与轮询

- 会话与历史走 TanStack Query(`queryKeys.workbench/generation`);运行中 job 以 2s 间隔轮询单 job 至终态(M4e IPC 事件流接入后替换为推送)。
- 提交:乐观插入 queued 回合 → 后台轮询;失败回滚并 toast。

---

## 4. 提示词库(M4a 已交付,记录为基准)

### 4.1 布局

顶部工具行(搜索框 + 标签筛选 + 「新建提示词」主钮)→ Tabs(全部 / 收藏 / 回收站)→ 行式列表(承旧 v2.0 `PromptListRow` 信息架构)。

### 4.2 列表行(`PromptListRow`)

缩略图(FileText 占位)+ 主体(置顶针 + 标题 + 评分星 / 摘要行 / 元信息行:使用次数 + 标签 Badge ≤4 个 + 溢出计数)+ **常驻操作组**(复制/编辑/置顶/移入回收站;回收站行只留「恢复」)。

- 操作组:桌面 hover/键盘聚焦渐显(`md:opacity-0 group-hover:opacity-100`),触屏常显。
- 点击行主体 = 编辑(回收站行 = 恢复)。
- **不使用下拉菜单藏动作**(§8-I2,E2E 稳定性教训)。

### 4.3 编辑器(`PromptEditorDialog`)

Dialog(桌面)承载:标题、内容 textarea、描述、标签多选(内联创建)、评分、置顶开关;保存/取消。校验错误就地红字。

### 4.4 状态矩阵

| 状态 | UI |
|---|---|
| loading | 列表区 skeleton 行 ×5 |
| 空(全部) | 空态卡:图标 + 「还没有提示词」 + 「新建提示词」CTA |
| 空(搜索/筛选) | 「没有匹配的提示词」+ 清除筛选 |
| 空(回收站) | 「回收站是空的」 |
| error | 错误卡 + 重试 |

### 4.5 遗留差值(随 M4d 抛光收口)

- [ ] 标签管理器(TaxonomyManager)移动端切 Sheet。
- [ ] 回收站内永久删除(需契约补 purge 方法,AlertDialog 确认);移入回收站维持不确认(可恢复,承旧)。

---

## 5. 生成历史(M4c,未动工)

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

详情:点击行 → 右侧 Inspector 抽屉(桌面 ≥lg 内嵌面板,<lg 及移动 Sheet):大图预览 + 完整提示词/反向词(可复制)+ 参数表(模型/比例/质量/耗时/成本)+ 动作(重试、删除、跳到所属会话)。

### 5.2 筛选栏(承旧 `HistoryFilterBar`)

- 搜索:提示词/模型/错误信息,300ms 防抖,可清空。
- 状态 select:全部/排队/生成中/成功/失败/已取消。
- 模型 select:从结果集聚合的动态选项。
- 时间预设:今天/7 天/30 天(默认)/全部。
- 「清除筛选」仅在有活动筛选时出现,带活动计数 Badge。
- 契约映射:`GenerationHistoryQuery`(search/status/providerModel/from/to/cursor)。

### 5.3 行与状态

- 行左缩略图:成功 = 首资产图(lazy);失败/无图 = ImageOff/History 图标;运行中 = Spinner。
- StatusBadge 色调:成功绿/失败红/取消灰/运行中主色。
- 操作组(hover 常驻,同 §4.2 模式):重试、删除(回收站),运行中行为「取消」。
- 微调线程:`parentRunId` 归组缩进展示(只读,发起微调暂缓 §0.2)。
- 列表状态矩阵:loading skeleton ×6 / 空「还没有生成记录,去工作台开始第一张图」+CTA / 筛选空「没有匹配的记录」+清除 / error+重试。

### 5.4 回收站

Tabs 或筛选切换进回收站视图:行只留「恢复」与「永久删除」(AlertDialog,红主钮);永久删除桌面本地含磁盘资产清理(M4e 收口)。

---

## 6. 设置(M4d 交付账号/连接分区;分组导航随分区增多再上)

### 6.1 布局

- **当前形态(M4e 交付)**:单列卡片流(max-w-2xl 居中),自上而下:外观 → 账号 → 云同步(桌面 only)→ AI 连接(桌面 only)。
- **目标形态(分区 ≥5 时切换,挂 M5b)**:左分组导航(220px)+ 右分区面板;移动一级列表 → 二级面板。承旧 `SettingsWorkspace` 的规格保留于此,实施时回读。

### 6.2 分组与分区(承旧目录,裁剪暂缓域)

| 分组 | 分区 | 内容 | 批次 |
|---|---|---|---|
| 访问 | 账号 | 登录(账密表单)/身份积分卡/兑换/退出(§7.1) | M4d ✅ |
| 访问 | 云同步 | 开关(登录 ≠ 同步)/状态/立即同步(§7.3,桌面 only) | M4e ✅ |
| 访问 | AI 连接 | 本地 Provider 列表 + 新建/编辑/删除/设默认(§7.2) | M4d ✅ |
| 通用 | 偏好 | 主题(浅/深/跟随系统)、语言占位、减少动效 | 已交付(M3 打样)|
| 应用 | 数据 | 导出/导入、回收站入口、清理缓存 | 后续卡(M4e 未含 UI) |
| 应用 | 关于 | 版本号、更新检查、开源许可 | M5b |
| 应用 | 归档会话 | 占位「即将推出」 | 暂缓 |

### 6.3 控件约定

- 每分区 = 标题 + 描述 + 控件卡(`Card`);行式控件:左标签+描述,右控件(Switch/Select/Button)。
- 危险区(清数据等)红边卡 + AlertDialog。
- 所有写偏好即时生效 + 乐观更新,失败回滚 + toast。

---

## 7. 账号与 AI 连接(M4d ✅)

### 7.1 账号面板(`AccountPanel`,设置页「账号」卡)

- **登录方式(纠正旧稿)**:双端同一账密表单(用户名/密码,登录↔注册切换)。凭据事实源是自托管 New API 网关,云端 `apps/api` 经 Better Auth `sign-in/new-api` 委托校验,本服务不存密码;Web 得同站 cookie,桌面得 bearer token(主进程 safeStorage 落盘)。旧稿「桌面 OAuth 回跳 / Web 登录页面」作废——没有第三方 IdP,独立登录页与浏览器回跳是多余间接层。
- 未登录:账号卡内联表单(用户名/密码/提交);登录失败错误红字在表单内(按 I4 表单口径,不用 error 卡)。
- 已登录:身份行(首字母头像 + 用户名 + 积分 readout + 可生图/余额不足 Badge)+ 兑换码行(输入框+兑换钮,成功 toast + 余额即时刷新)+ 退出登录(AlertDialog 确认)。
- 积分显示:`quota ÷ ACCOUNT_QUOTA_PER_POINT`(50000),最多一位小数(`formatPoints`)。
- 登录/退出后全量 invalidate/reset 查询缓存:登录前失败的会话/数据查询自动重取,退出不残留上个会话数据。
- 已连接应用列表(MCP 授权撤销):**推迟**——云端尚无连接列表端点,随云 MCP 管理卡交付。
- 壳侧栏底部 `AccountFooter`:未登录=登录入口行;已登录=头像/名称/积分;点击进设置账号分区。

### 7.2 AI 连接管理(`AiConnectionsPanel`,桌面专属,`hasLocalAiProviders` 开关)

- 列表行:名称 + 「默认」Badge(活动连接)+ 副行(模型 · Base URL · 密钥尾号/未配置)+ 常驻操作(设为默认/编辑/删除)。
- 新建/编辑 Dialog:名称、Base URL、模型、API Key(密文输入,只写不回显;编辑留空=不动)。类型不设 select:v2.5 新建一律 openai-compatible,存量异型数据兼容展示。
- 「测试连接」钮:**推迟**——需主进程真发探测请求,随生成域集成打磨排卡。
- Key 只经主进程 safeStorage(keychain),SQLite 只存 has_key/key_suffix 展示位;渲染层不落任何密钥(红线承 v2.1)。
- 删除:AlertDialog(密钥一并删除,历史保留);删除默认连接时最近更新的一条自动接管默认。
- 数据面与工作台 Composer 的 Provider 下拉同源(SQLite providers 表),增删改后两处同时失效刷新。

### 7.3 云同步卡(`CloudSyncPanel`,桌面专属,`hasCloudSyncControls` 开关;M4e ✅)

- **登录 ≠ 同步**:开关由用户显式打开;登录/登出/换账号自动关闭开关,须重新打开(不静默替新账号同步)。
- 未登录:开关禁用 + 副行「登录账号后可开启」。
- 关闭态(已登录):开关可用 + 副行「开启后提示词、文件夹与标签将同步到云端」。
- 开启态:副行「用户名 · 上次同步时间」;状态区 = 状态 Badge(已是最新/同步中/有冲突/出错)+ 待推送计数 + 冲突计数 + 「立即同步」钮(同步中禁用+Spinner);错误时红字详情。
- 开启即全量同步一轮(bootstrap→pull→push);此后写路径防抖 2s 触发 + 60s 兜底轮 + 启动恢复。
- 关闭只停调度,本地数据与账号记录不动(重开免重新 bootstrap)。
- 同步动作成功后失效提示词缓存(pull 可能带回远端变更)。
- 冲突处理 UI(逐条 local/remote/duplicate):**推迟**——主进程 repository 能力已备,随后续卡交付;当前冲突仅计数呈现。

---

## 8. 交互与反馈统一约定

- **I1 加载**:首屏结构化 skeleton(行/卡同形);局部刷新用 Spinner;按钮内联 loading = Spinner 替换图标 + 禁用。
- **I2 动作可达性**:任何动作不得只藏在浮层(下拉/右键)里;主路径 = 常驻钮(hover 渐显视为常驻),浮层是补充。移动端(无 hover)操作组常显。
- **I3 破坏性动作**:不可恢复的(永久删除/清空/退出登录)必须 AlertDialog;可恢复的(移入回收站/归档)直接执行 + toast(带撤销时限)。
- **I4 错误**:查询错误就地错误卡(标题+消息+重试钮);变更错误 toast(保留用户输入);表单校验错误字段下红字。
- **I5 空态**:图标 + 一句引导 + 主 CTA(能创建的场景必须给 CTA);筛选空态给「清除筛选」。
- **I6 乐观更新**:列表内 CRUD 一律乐观 + 失败回滚;跨屏影响(如生成完成)靠 query invalidation。
- **I7 快捷键(桌面/Web 物理键盘)**:⌘N 新设计、⌘K 搜索(暂缓期跳库搜索)、Enter 发送、Shift+Enter 换行、Esc 关浮层/取消行内编辑。
- **I8 testid**:`<域>-<对象>-<动作>` 蛇形连字;列表行 `<域>-row-<id>`;E2E 只允许用 testid/role 定位。
- **I9 可访问性**:图标钮必须 `aria-label`;活动导航 `aria-current`;浮层焦点圈闭 + Esc 关闭 + 焦点归还触发器。

---

## 9. 与旧版差异登记表(有意变化,已批准)

| # | 差异 | 旧版 | 新版 | 理由 |
|---|---|---|---|---|
| D1 | 列表行动作形态 | 部分屏用下拉菜单收纳 | 常驻操作组(hover 渐显) | 触屏可达性 + E2E 稳定性(M4a 教训);信息架构不变 |
| D2 | 设计方案/Skill/豆包入口 | Composer「+」菜单与侧栏入口 | 本轮不出现 | 域暂缓(§0.2),避免死入口 |
| D3 | 单次生成张数 | 桌面可选 1/2/4 | 锁 1 张 | 契约 `count: literal(1)`(云端成本闸);多张随后续契约版本恢复 |
| D4 | 反向提示词位置 | 设置弹层内 | 同旧(弹层内) | M4b 首版曾常驻,按本规范收回弹层 |
| D5 | 顶栏(Web 大屏) | 常驻 ProductTopbar | 取消常驻,仅侧栏收起时给展开钮 | 与桌面口径统一,最大化内容区;额度 readout 移侧栏账号区 |
| D6 | 会话未读/置顶存储 | localStorage 偏好 | 同机制承接(platform 偏好接口) | 跨端同步待后续版本 |
| D7 | 自定义比例输入 | RatioPicker 支持 | 暂缓,固定预设 | 契约 `aspectRatio` 正则先收窄;需求回访后放开 |
| D8 | 桌宠/朱点 | 常驻 | 冻结不迁 | 用户指示(2026-08-28) |
| D9 | 登录形态 | 独立登录屏(桌面)/登录页(Web 设想) | 设置页账号卡内联账密表单,双端同一份 | 凭据委托 New API(账密),无第三方 IdP;内联表单少一跳,四端一致 |
| D10 | 设置布局 | 分组导航工作区 | 暂为单列卡片流 | 已交付分区仅 3-4 个,导航反增导航成本;分区 ≥5 时按 §6.1 目标形态切换 |
| D11 | AI 连接类型选择 | 新建时可选类型 | 固定 openai-compatible | v2.5 唯一受支持协议;豆包网页等随各自域后续排卡 |
| D12 | Web↔API 部署形态 | 分域(CORS) | 同源(宿主反代 /api/*) | 会话 cookie 同站直用,免 CORS/第三方 cookie 一整类问题;API 刻意不开 CORS |

---

## 10. 组件复用矩阵

### 10.1 `packages/ui`(shadcn 原语,全端共用)

`button` `input` `textarea` `select` `dialog` `alert-dialog` `sheet` `dropdown-menu` `popover` `tooltip` `badge` `tabs` `card` `switch` `skeleton` `spinner` `scroll-area` `separator` `sonner(toaster)` + `icons`(lucide 唯一入口)。

新增原语必须经 shadcn CLI 装入 ui 包,禁止在 features/宿主内新建平行原语。

### 10.2 `packages/features`(屏幕与产品块,四端同一份)

| 模块 | 导出 | 消费方 |
|---|---|---|
| `app-shell` | `AppShell` `SidebarNav` `SessionListPanel` `MobileTabBar` | 两宿主 |
| `prompts` | `PromptLibraryScreen` `PromptListRow` `PromptEditorDialog` `TaxonomyManager` + hooks | 两宿主 |
| `workbench` | `WorkbenchScreen` `GenerationTimeline` `Composer` `SessionPicker` + hooks | 两宿主 |
| `history`(M4c) | `HistoryScreen` `HistoryFilterBar` `HistoryRow` `HistoryInspector` + hooks | 两宿主 |
| `settings` | `SettingsScreen` + 分区组件 | 两宿主 |
| `account`(M4d/M4e) | `AccountPanel` `AiConnectionsPanel` `CloudSyncPanel` `AccountFooter` + hooks | 两宿主(连接/同步面桌面 only,能力开关控制) |

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
