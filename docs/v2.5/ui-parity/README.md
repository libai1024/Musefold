# UI Parity 系列 — 逐屏对照文件(UI/UX 交互任务基石)

> **性质**:v2.5 渲染层与旧版(`v2.5-baseline`)的**逐界面**对照,覆盖组件、布局、交互、动效、UIUX 五个维度,每屏落出带优先级的任务清单。这一组文件是后续 UI/UX 交互任务的**基石依据**:排卡从这里取任务,验收对照这里的旧版基准。
> **原则**(2026-08-29 用户确认):核心目标是让新版 UI 与旧版基本一致,交互体验可以做得更好;**代码量少不等于体验好**。最终用户要获得基本一致的 UI、动效、交互体验。
> **两级任务**(2026-08-29 增补):P 系列 = 对旧版的回退(差距),按体验影响分级;C 系列 = 超越旧版的增益,「可以做得更好」的落点,工艺语汇统一见 [00-codex-craft.md](./00-codex-craft.md)(参照 OpenAI Codex 桌面 App 的质感与交互纪律)。C 不与 P 抢排期,同屏 P0 未收口时不单独排 C 卡。
> **与其他文档的关系**:V25-UI-SPEC 仍是规范(改规范先过 §9 登记);本系列是差距审计与任务依据;整体量化对比见 [V25-OLD-NEW-DIFF.md](../V25-OLD-NEW-DIFF.md)。屏内差距收口后,对应篇降级为历史存档。

## 目录

| 篇 | 界面 | 迁移状态一句话 |
|---|---|---|
| [00-codex-craft.md](./00-codex-craft.md) | (跨屏)Codex 级质感基线 | C 系列增益的公共语汇:七条工艺法则、动效 token、交互六态、组件解剖 |
| [01-shell.md](./01-shell.md) | 主界面(壳/顶栏/主视图) | 骨架已迁;ErrorBoundary/动效闸门/侧栏拖拽区已收口;浮岛工作面、拖宽缺 |
| [02-sidebar.md](./02-sidebar.md) | 侧边栏(导航/会话/账号区) | 五段结构齐;日期分组/右键菜单/标记未读已收口;账号区双菜单缺 |
| [03-workbench.md](./03-workbench.md) | 新设计(工作台) | 主干齐;参考图、空态动效、结果卡动作(存为提示词/保存图片)已收口 |
| [04-prompt-library.md](./04-prompt-library.md) | 提示词库 | 列表齐且有恢复能力;「使用」动作已收口;详情/封面缺 |
| [05-history.md](./05-history.md) | 历史记录 | 完成度最高;存为提示词/保存图片/Lightbox 已收口;批量清理缺 |
| [06-design-schemes.md](./06-design-schemes.md) | 设计方案 | P01 迁移中:共享层与双端确定性 CRUD 已接入,入口未开;全量存档 + 迁移蓝图 |
| [07-settings-00-nav.md](./07-settings-00-nav.md) | 设置壳(分组导航) | 卡片流(D10);≥6 分区时切分组导航 |
| [07-settings-01-account.md](./07-settings-01-account.md) | 设置 · 账号 | 最完整;确认密码、同步冲突 UI 缺 |
| [07-settings-02-relay.md](./07-settings-02-relay.md) | 设置 · 中转站(AI 连接) | 生图通道主干齐;拉模型、dirty 守卫缺;Agent 通道暂缓 |
| [07-settings-03-preferences.md](./07-settings-03-preferences.md) | 设置 · 偏好 | 主题齐;动效三态已收口;密度、生成默认值缺 |
| [07-settings-04-open.md](./07-settings-04-open.md) | 设置 · 开放能力 | 0%;automation 控制面无 UI,安全边界风险 |
| [07-settings-05-usage.md](./07-settings-05-usage.md) | 设置 · 使用统计 | 0%;数据在积累,无可视化 |
| [07-settings-06-data.md](./07-settings-06-data.md) | 设置 · 数据存储 | 回收站入口新增;备份/路径/日志/危险区缺 |
| [07-settings-07-about.md](./07-settings-07-about.md) | 设置 · 关于 App | 0%;热更新暂缓,版本/支持/快捷键表待迁 |
| [07-settings-08-archived.md](./07-settings-08-archived.md) | 设置 · 已归档聊天 | 共享设置面板与 Web/Electron 三端闭环已落地;SQLite retention 已直接验证 |

## 跨屏 P0 汇总(状态截至 2026-08-29)

| # | 任务 | 出处 | 状态 |
|---|---|---|---|
| 1 | **减少动效接线 + 三态化**(`MotionSync` + ui 压制规则 + 契约升 `system/on/off`) | 07-03 / 01 | ✅ 已收口:契约 `motionLevelSchema` 三态(布尔迁移)+ `MotionSync` + globals.css 双通道压制 + `skipMotion()` + Spinner 豁免。**全系列动效任务的闸门已开** |
| 2 | **全局 ErrorBoundary**(features 组件 + web-next `error.tsx` + 桌面壳包根) | 01 | ✅ 已收口:`ShellErrorBoundary`/`ShellErrorFallback` + web-next `error.tsx`/`global-error.tsx` + 桌面壳挂载 |
| 3 | **提示词行「使用」动作**(送工作台草稿 + 切屏 + usageCount) | 04 | ✅ 已收口:行尾「使用」+ `pendingDraft` 通道 + toast「已送入制作」 |
| 4 | **参考图输入链**(文件/拖拽/粘贴 + 缩略条 + 双端上传) | 03 | ✅ 已收口(2026-08-29):契约 `referenceImages`/上传入参 + 三路入图 chip 条 + 云(S3 multipart)/桌面(media:// 本地暂存)双实现 + worker `/images/edits` + 全链测试与 E2E 拖拽覆盖 |
| 5 | **桌面 drag-region 治理** | 01 | ◐ 部分收口:侧栏拖拽区已接(v25 宿主 CSS);内容区顶带与设置页拖拽条随桌面装壳组补足(降 P1,窗口已可经侧栏拖动) |

## P1 按主题分组(排卡建议)

- ~~**Codex 增益基建组(C1,先行)**~~ ✅ 已收口(2026-08-29):C-1 动效 token / C-2 Kbd + 快捷键单源 / C-3 Button press / C-4 tabular-nums / C-5 FadeImage + 圆角两档;C-6 滚动条随桌面装壳组。清单见 [00-codex-craft.md](./00-codex-craft.md) §6。
- ~~**动效恢复组**~~ ✅ 已收口(2026-08-29):空态水印/横滚/Ember/mark 96px + 结果 reveal + 气泡入场 + 会话点呼吸 → 03 §5、02 §6。
- ~~**会话体验组**~~ ✅ 已收口(2026-08-29):日期分组、右键菜单 + 标记未读(02 §7 三项)、「回到最新」pill、消息复制/编辑 + 聚焦置尾(03 §4/§6)。
- ~~**结果消费组**~~ ✅ 已收口(2026-08-29):存为提示词链路(工作台与历史共用 `SavePromptDialog` + toast 跳库高亮)、保存/下载图片(`generation.saveAsset` 双端:桌面系统对话框 / Web 浏览器下载)、历史 Lightbox(翻图 + 键盘 + 05-C1 工艺)→ 03 §7、05 §7;复制图片(桌面 clipboard)随 05 P2 文件操作组。
- **库完整性组**:封面缩略(契约)、详情 Inspector(含相关作品)、编辑器脏表单守卫(与 AI 连接 Dialog 共用方案) → 04 §8、07-02 §6。
- **桌面装壳组**:侧栏拖宽、浮岛工作面、Win/Linux 窗口控件(含 drag-region 收尾:内容顶带 + 设置页)、⌘K、开放能力卡(automation 控制面 + 确认卡)、数据库备份卡 → 01 §7、07-04 §6、07-06 §6。
- **账号数据组**:注册确认密码、云同步冲突处理、拉取模型列表、归档列表 → 07-01 §7、07-02 §6、07-08 §6。

## 维护约定

1. 每完成一项任务,回对应篇把该行从任务表移到「已收口」备注(或直接删行),并在 V25-UI-SPEC 相应章节销账;规格性变化(如三态动效)同步进 SPEC。
2. 新发现的差距**先登记进对应篇**再动手,与 SPEC §9 的差异登记互补:有意保留的差异去 §9,待修的差距留在这里。
3. 暂缓域挂点(Skill/豆包/热更新/笺匣,及仍暂缓的通用分享/导入)在各篇末尾登记,禁止顺手实现或删除(CLAUDE.md 红线);设计方案已转入 P01 迁移,进度按 [V25-MIGRATION-CARDS](../V25-MIGRATION-CARDS.md) P01 记账,入口开启前同样禁止死入口。
4. C 系列(增益)与 P 系列同口径销账:跨屏 C 任务登记在 00 §6,屏内 C 任务登记在各篇「Codex 增益」节;改变旧版行为的 C 任务(如侧栏宽度过渡)落地前必须过 SPEC §9 差异登记。
