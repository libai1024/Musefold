# 已归档聊天页 + 侧栏身份切换器 review

> 本报告仅基于代码分析。当前会话的 Read 工具无法渲染图像(模型不支持图像输入),视觉分析 MCP 仅支持远程 URL 且对本地 file:// 报错、远程调用限流,两张截图均无法直接读取。为弥补,截图场景已用捕获脚本 `tests/e2e/test_98_settings_review_shots.py`(L44-113)交叉还原:两图均为 1440x900、深色、comfortable 密度。像素级结论(实际留白、遮挡、对齐偏差)待人工补验。

## 截图观察

按捕获脚本还原的场景(非直接读图):

**08-archived-dark**(L91-92):设置视图 `archived` 分区。全新 E2E 环境、无归档数据,呈现的是空态:分区头「已归档聊天 / 管理暂时收起的聊天。」+ 右侧「刷新」outline 按钮;卡片「归档记录 / 恢复暂时收起的聊天,或删除不再需要的记录」;卡体空态 = `Archive` 5px dim 图标 + 一行 13px「还没有已归档聊天」(`min-h-40` 居中,`ArchivedChatsSection.tsx:136-140`)。结构上空态表达是克制的:无插画、无 CTA 按钮堆砌,符合 Codex「空状态不刷存在感」原则;机制说明由卡片描述承担,空态本身不重复。

**09-switcher-dropdown-dark**(L106-112):generate 视图,脚本将 `activeProviderId` 指到新建的「视觉检查中转站」(gpt-image-1),即 relay 模式;点击 `provider-quick-switch` 后下拉向上弹出。代码可证实的呈现(L360-495):

- 触发器:方角 28px 图标位(品牌图标或 `Server` 兜底)+ 就绪小圆点;标题「自定义中转站」(不点名站点),副行 gpt-image-1 的展示名;`ChevronDown` 旋转 180° 朝上。
- 菜单头部块:「自定义中转站」+ 模型名(与触发器同信息)。
- 分组一「生图账号」:官方行(`ModelBrandIcon musefold-agent` 头像,「Musefold 官方账号 / 未登录 · 点击去登录」)+ 豆包行(首字「豆」头像,「豆包账号 / 未登录 · 点击去登录」),均无 active 标记——relay 模式下正确。
- 分组二「生图中转站」:「视觉检查中转站」行,active 呈现 = `accent-soft` 背景 + `Check`(overlays-v2.css:173-175)。
- 底部固定区(不随分组滚动):「管理生图中转站」「管理 Agent 中转站」「账号设置」。

改造结构(常驻标题中性化、分组标签、双管理入口、深链)从代码层面全部到位;截图像素呈现待人工核验。

## 代码问题(file:line)

### A. ArchivedChatsSection.tsx

1. **`:53-54` 错误来源串台且可能陈旧**:`error = mutationError ?? queryError`,`sessionsError` 是 workbench 全局 store 字段。删除/恢复失败后即使 `refetch` 成功且列表为空,空态分支仍会被旧 `mutationError` 抢占(`:119`);其它入口写入的同名错误也会渲染到归档页。错误隔离不足。
2. **`:185-196` 删除按钮 28px**:`size="iconSm"` = `--control-sm` = 28px(tokens.css:44),低于 DESIGN.md「桌面图标控件 ≥32px」。
3. **`:37-44` 时间缺年份**:`MM/dd HH:mm`,跨年归档项无法分辨年份。
4. **`:157` 点击行 = 打开但不恢复**:`openSession`(store-session-actions.ts:218-261)不触碰 archive 标记。打开的会话仍处归档态;若聊天侧栏过滤归档项,「打开了一个不在列表里的聊天」语义易混淆(需产品确认是否有意)。
5. **`:178/:189` deleting 冻结全表**:删除确认飞行中,所有行的恢复/删除按钮一并禁用——「行内隔离」名不副实(实际是整页冻结;对话框遮罩期间影响有限,属一致性小疵)。

### B. SidebarAccessSwitcher.tsx

6. **`:380-409 / :417-448` 当前项无 a11y 语义**:「当前生图身份」只有 `data-active` 背景 + `Check` 视觉,`DropdownMenuItem` 是 `role=menuitem`,无 `aria-checked`/`menuitemradio`,屏幕阅读器无法感知哪项是当前项(对照 Codex 模型选择器条目带 `is_current` 语义)。
7. **`:473-486` 双管理入口图标无区分**:「管理生图中转站」与「管理 Agent 中转站」都用 `Settings2`,扫读时只靠文字。
8. **`:143-174 / :208-222` 跨模式切换后果不可见**:account→relay 会连带把 Agent 通道切到最近自备连接并验证(`:149-161`);relay→account 则整体退出中转站模式。两个方向的菜单项文案都不说明后果,违背 Codex 审批文案「完整动词短语 + 说清后果」精神。且两方向验证强度不对称(relay 向有验证失败不切换,account 向无),UI 上不可见。
9. **`:247-266` 死字段**:`identityAccounts` 的 `available: true` 从未被消费。
10. **文件 565 行,距 600 红线 35 行**:file-size-ratchet baseline 只减不增,任何后续增量(如菜单内再加 Agent 连接列表)即破线。
11. **`:374/:401/:436` `text-[11.5px]` 非体系刻度**:DESIGN.md 标签 12-14px、meta 11px(`--text-meta: 11px`),11.5 是夹缝值。
12. **`:546-551` 桌宠开关用 `Power` 图标**:Power 语义是电源/退出;且该项同时承担状态(当前是否显示)与动作(切换)两种表达,只有动作侧。
13. **`:282` relay 模式无 busy 表达**:`aria-busy` 仅 account 模式;`pendingProviderId` 验证期间触发器不禁用、可再次展开菜单(项虽已禁用)。
14. **分组标签无 a11y 关联**:`DropdownMenuLabel` 是纯视觉 div,「生图账号」「生图中转站」分组与 menuitem 间无 `role=group`/`aria-label` 关系——涉及共享包 `@musefold/ui`。

**红线核查(通过)**:两文件均 ≤600 行(224/565);无 emoji;图标全部经 `components/ui/icons` → `@musefold/ui/icons` 出口,无直接 lucide-react import;深链 `setSection('providers'|'ai')` 与 settings store 的 legacy key 翻译(store.ts:78-81,自动落到 relay 分区 + `relayTab`)对接成立,`relay-model-manage`/`relay-model-manage-ai` 双 testid 就位。

## 改进建议

**P0**:无(未发现必须立即修的崩坏项)。

**P1**

1. **当前项语义化** — `SidebarAccessSwitcher.tsx:380-448`:账号行与中转站行加 `role="menuitemradio"` + `aria-checked={active}`(确认 `@musefold/ui` DropdownMenuItem 透传任意 props;若不透传则加 sr-only「当前」文本)。Codex 对照:条目带 `is_current` 打勾语义。
2. **跨模式切换后果前置** — `SidebarAccessSwitcher.tsx:143-174/208-222`:relay 模式下账号行 detail 追加「切换后将退出中转站模式」;中转站行在 account 模式下首次选择前 toast/副行注明「Agent 通道将一并切换」。Codex 对照:审批选项完整动词短语 + 后果说明。
3. **拆文件防红线** — `SidebarAccessSwitcher.tsx`(565 行):把 L360-495 身份菜单内容抽 `IdentityMenuBody`、L498-563 应用菜单抽 `SidebarSettingsMenu` 子组件(各 <200 行),主文件回到编排层。后续 ratchet 只减不增,现在拆成本最低。
4. **A 页错误状态隔离** — `ArchivedChatsSection.tsx:53-54`:`mutationError` 仅在对应 mutation catch 中一次性展示(toast 已有),列表错误分支只认 `queryError`;或 `restore/confirmDelete` finally 里清 `sessionsError`。

**P2**

5. **管理入口差异化图标** — `SidebarAccessSwitcher.tsx:473-486`:生图用 `Image`(或 `Palette`)、Agent 用 `Bot`,从 `@musefold/ui` icons 出口取,不直接 import lucide-react。
6. **删除按钮升 32px** — `ArchivedChatsSection.tsx:186`:改 `size="icon"`(`--control-md` = 32px);行高约 57px 容纳无压力。若其它密集行同改,涉及共享包 token 层协调,标注「涉及共享包」。
7. **时间格式跨年补年份** — `ArchivedChatsSection.tsx:37-44`:非当年项加 `year` 字段或改 `YYYY/MM/dd`。
8. **字号归刻度** — `SidebarAccessSwitcher.tsx:374/401/436`:`text-[11.5px]` 统一到 12px(标签)或 11px meta,消掉夹缝值。
9. **桌宠开关图标** — `SidebarAccessSwitcher.tsx:546-551`:`Power` 换 `Eye`/`EyeOff` 或 `PawPrint` 类状态化图标。
10. **清理死字段** — `SidebarAccessSwitcher.tsx:251/259`:删 `available`。
11. **relay 验证期 busy** — `SidebarAccessSwitcher.tsx:282/275`:验证期间触发器 `aria-busy` + 禁止再次展开(或展开时项禁用已在,至少补 aria)。
12. **分组 a11y** — 涉及共享包 `@musefold/ui`:DropdownMenu 支持分组容器 `role="group" + aria-label`,`DropdownMenuLabel` 关联;菜单项较多时收益明显。
13. **归档行点击语义** — `ArchivedChatsSection.tsx:157`:与产品确认「打开但不恢复」是否有意;若无意,点击行改为也执行 `archiveSession(id, false)` 或行点击仅展开详情不进工作台。

## 保持不动

- **空态表达**(A):单行文案 + 5px dim 图标,机制说明由卡片描述承担,不加插画/CTA——符合「空状态不刷存在感」。
- **删除确认对话框**(A):标题问句 + 后果范围(「生成的图片仍保留在生成历史中」)+ 危险色完整动词按钮「删除聊天」+ 飞行中不可关闭(`:205/:214-215`)——正是 Codex 审批黄金模式的桌面化,不要改成行内两段式点击(易误触)。
- **行密度**(A):`setting-item` 12/16 padding、图标位 + 两行文本(13/11px),与全部设置分区一致。
- **常驻标题中性化**(B):「自定义中转站」不点名站点、副行只显模型名——「常驻单行摘要、详情按需调出」的 Codex 哲学,这次改得对。
- **向上弹出几何**(B):`side="top" align="start" sideOffset=6`、ChevronDown 开时旋转朝上、`onCloseAutoFocus` 回焦触发器。
- **验证期菜单行为**(B):保持打开、全部中转站项禁用、pending 行 `Loader2`——失败留在原地可见,优于「关菜单 + 失败 toast 空降」。
- **空中转站占位行**(B):`relay-model-configure` 双行说明「自备生图与 Agent 模型网关」——「能看到的就能执行」。
- **restartRequired 态**(A):「需要重启应用 + 原因 + 立即重启」——置灰并解释而非隐藏。
- **菜单头部上下文块**(B):与触发器信息重复但提供「当前是谁」锚点,292px 宽度下成本可接受。
