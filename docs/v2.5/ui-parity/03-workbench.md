# 03 新设计(工作台 / 生成屏) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/features/generation/workbench/*`(47 文件)+ `packages/product-ui/src/workbench/*`(49 文件),核心:`GenerationWorkbench` / `WorkbenchComposerView`(500 行) / `WorkbenchComposerChrome`(246 行) / `WorkbenchTimeline` / `GenerationTurnView`(541 行) / `GenerationResultCard` / `WorkbenchEmptyState`。
> **新版源码**:`packages/features/src/workbench/{WorkbenchScreen,Composer,GenerationTimeline,hooks,session-store}.tsx`。
> 会话列表在 [02-sidebar.md](./02-sidebar.md);设计方案/Skill/豆包域为登记暂缓面(V25-UI-SPEC §0.2),本文标注挂点但不排任务。

---

## 1. 结论与迁移状态

会话式生成主干、参考图、Prompt 引用、结果保存、空态品牌语法与时间线工程细节已迁;契约化和状态矩阵比旧版更严整(cancelling 中间态、失败错误卡、`isComposing` 保护、host-owned Prompt 解析与不可变快照)。当前主要缺口转为:**生成数量/多图消费**、**用户消息参数摘要**、**历史/方案/Skill/微调上下文**、**复制图片与多图 Lightbox**、**审批/费用与额度恢复完整矩阵**。

## 2. 布局对照

| 区块 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 整体 | 时间线(内容 760px 中轴)+ 贴底 Composer;右侧可展开素材库 Dock(304px) | ✅ 已收口(2026-08-29):时间线内容列 728px 中轴 + **悬浮贴底 Composer**(728px 卡绝对定位、轨道透明、浮起阴影 + 轻透底毛玻璃,时间线以底部留白 172/220px 从卡后滚过,承旧 floating 布局)+ Prompt 引用 **304px 右侧 Dock**;移动为焦点圈闭的 82dvh 底部 Dialog | 收口 |
| 空态 | `WorkbenchEmptyState`:水印背景 + 品牌锁定区(mark 96px + tagline)+ 三条横滚建议 + 内联 Composer,整体 `clamp(72px,16vh,140px)` 顶距 | ✅ 已收口(2026-08-29):水印/mark 96px(移动 72px)/横滚建议/`clamp` 顶距全承旧;内联 Composer 20px 品牌焦点外框(移动 16px);矮视口(≤560px 高)建议让位、顶距收紧(承旧 11 §10.3)。同日增强:**时段问候语标题**(`workbench-empty-greeting`,四档,挂载后计算防水合错位,矮视口隐藏;承 ZCode/Cursor 空态语法),E2E 用 `clock.setFixedTime` 钉档 | 收口 |
| 用户消息 | 左侧头像区无,右对齐气泡 + 气泡上方附件区(Codex 式)+ meta 行(参数摘要/微调来源链) | 右对齐 `rounded-2xl rounded-br-sm bg-primary` 气泡;Prompt 引用以生成时不可变卡展示;纯引用任务不渲染空气泡 | 气泡形与引用语义一致;**meta 行(比例/质量参数摘要)缺失,P2** |
| 助手回合 | 头像(Musefold PNG 头像/豆包蓝底图标)+ header(名称 + 状态文案)+ preface(Skill/方案对话)+ 结果网格 + 回合动作条 | `size-6` 圆底 MusefoldMark + 状态 Badge + 模型名 + 结果格 + hover 动作行 | 结构对位;头像从品牌 PNG 降为线形 mark(P3 可接受);preface 属暂缓域挂点 |
| 结果网格 | `WorkbenchResultGrid`:按张数/比例排布,骨架带比例占位 | 1 张单列 / 多张 2 列,骨架按 aspectRatio 占位 | 一致(单次 1 张下等价,D3) |
| 移动端 | 无对位形态 | 屏顶会话 Select + 新建钮 | 新增,保留 |

## 3. Composer 对照(逐控件)

| 控件 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 「+」菜单 | `WorkbenchContextMenu` 分区菜单:添加图片(主项)/引用提示词/设计方案/GitHub Skill/生成设计方案/从历史创建/寻找方案 | ✅ 已收口:`composer-attach` 菜单含「添加图片」+「提示词 / 从库中引用」;切 Prompt 面板时等待菜单退出完成,不叠两层浮层 | Prompt 引用收口;方案/Skill/历史项随各域挂点 |
| 图片入口 | 三路:文件选择(`workbench-image-input`,png/jpg/webp multiple)、拖拽(depth 计数 + `workbench-image-drop-overlay`「松开以添加图片」虚线罩)、粘贴(clipboard items 过滤 image/*) | ✅ 已收口:三路入图(`composer-file-input`/拖拽 depth 计数 + `composer-drop-overlay` 虚线 accent 罩「松开以添加参考图」/粘贴过滤),E2E 覆盖拖拽 | 收口 |
| 附件预览条 | `WorkbenchComposerContextTray`:草稿图缩略(可删/可预览)、提示词引用卡(整条/片段)、历史来源 chip、方案 chip、微调目标引用卡 | ✅ 已收口:草稿图 24px chip 条 + Prompt 引用卡(当前标题/整条或片段/预览/stale/unavailable 可移除);同 Prompt 多片段查询按 id 去重但保持选择顺序 | Prompt 引用收口;历史/方案/微调 chip 随各域 |
| 提示词输入 | 自增高 textarea(rows 1,max-h 180px),`maxLength 12000`,placeholder 按 8 种上下文切换 | ✅ 已收口(2026-08-29):自增高 76–180px(field-sizing,承旧几何),`maxLength 12000`;placeholder 双上下文分支承旧(空会话「描述你想生成的图片…」/有回合「描述下一步调整…」) | 收口;引用/方案等其余上下文 placeholder 随域回归 |
| Enter 语义 | Enter 或 ⌘/Ctrl+Enter 发送,Shift+Enter 换行,`isComposing`+`keyCode 229` 双保护 | ✅ 已收口(2026-08-29):Enter 或 ⌘/Ctrl+Enter 发送,`isComposing`+`keyCode 229` 双保护,单测覆盖 | 收口 |
| 行首 Backspace | 光标在 0 位按 Backspace 依次弹出引用胶囊/指令芯片(Codex 式) | ✅ 已收口:空输入时先弹最后一张 ready 参考图,再从后向前弹 Prompt 引用卡 | 等价;后续上下文类型继续扩展确定序 |
| 指令建议浮层 | `/` 指令 hints:listbox + 方向键循环 + Enter/Tab 选中 + Esc 关闭,`animate-scale-fade-in` | 无 | 暂缓域(设计方案指令),挂点登记 |
| 比例 | `WorkbenchRatioPicker`:预设 + **自定义比例输入**(547 行) | ✅ 已收口(2026-08-29):承旧全集 11 档(auto 殿后)+ 形状预览触发钮(26px 基准色板 + mono 值)+ 368px 三列网格菜单(预览卡/勾选/打开聚焦当前项/方向键 ±1 环绕 + Home/End)+ **自定义比例行已恢复**(网格下单一分隔带:W/H 数字输入清洗留 2 位、Enter/「应用」、非法 `role=alert`「比例需在 1:4 与 4:1 之间」弹层不关、自定义当前态 trigger/预览/标题按实际 `W:H` 呈现);testid `composer-ratio-custom-w/-h/-apply/-error` | 收口;数据流只传规范 `W:H`(旧 `custom:` 前缀不迁,见 §9-D7) |
| 设置弹层 | 质量 + **张数(1/2/4)** + 反向词;豆包托管态显示说明文案 | ✅ 已收口(2026-08-29):值摘要触发钮(当前质量档 + 反向词提示,承旧 generation-trigger)+ 304px 弹层(标题行 + 关闭钮 + 质量 radio 组承旧命名 自动/标准/高清/超清 + 反向词) | 收口;张数 D3 锁 1、豆包托管文案随域 |
| 字数计数 | ≥90% 上限显示 `n/12000` 等宽计数 | 同(阈值同为 90%) | 一致 |
| 超限提示 | 合成提示词(正文+引用)超限时红字,三种上下文文案 | Host 解析每条引用最多 4000 UTF-16 code units、最终合成最多 8000;split surrogate pair、越界、版本漂移均结构化拒绝 | 功能等价并强化信任边界 |
| Provider | 无行内选择(设置页配置,提交时用默认) | 行内 Select(不可用项禁用) | 新版更优,保留 |
| 无 Key 警示 | `refine-no-key` 黄条:「xx 还没有配置密钥」 | `composer-no-provider`:无连接引导去设置 | 对位(密钥态桌面属连接管理,见 07-relay) |
| 发送/停止钮 | `WorkbenchComposerSubmitButton`:idle=ArrowUp 圆钮(label 按 6 种意图切换),running=Square 停止,取消中=spinner;disabled 时 title「请先连接服务商」 | ✅ 已收口(2026-08-29):36px 圆钮承旧(hover 上浮/按压下沉 `--ease-spring`),停止态深色底,title 意图化(生成图像(Enter)/请先连接服务商/停止生成(Esc));**Esc 窗口级停止生成已接**(Radix 浮层关闭让位),单测覆盖 | 收口;多域意图 label 随域回归 |
| 工作模式 tab | 「图像 / 设计方案」role=tablist,锁定态显示「微调/方案运行/Skill」状态签 | 无 | 暂缓域挂点 |

## 4. 时间线与回合交互对照

| 交互 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 自动贴底 | `useWorkbenchTimelineController`:followKey 变化贴底,离底暂停 | 同语义(80px 阈值,rAF 贴底) | 一致 |
| 回到最新钮 | 离底且有回合时,底部悬浮 pill「回到最新」(sticky bottom-4 居中) | ✅ 已收口(2026-08-29):离底(>80px)出 pill(absolute bottom-3 居中,`timeline-back-to-latest`),点击平滑回底(`skipMotion()` 时直切) | 收口 |
| 用户消息激活 | 点击气泡(排除按钮/链接)或 Enter/Space 激活 → 显示「复制/编辑」动作;点空白或 Esc 关闭 | ✅ 已收口(2026-08-29):hover/focus 渐显动作组;复制/编辑只用 raw `userPrompt`,纯引用复制回落不可变引用正文,绝不暴露 host-composed provider prompt | 收口 |
| 微调来源链 | meta 行「微调自上一结果」钮 → `scrollIntoView` 平滑滚到父回合 | 无(微调链暂缓) | 挂点登记;历史屏先展示 parentRunId 线索(§0.2) |
| 取消 | 停止钮(Composer)+ 回合内取消 | 状态行「取消」钮 + Composer 停止钮 | 一致偏优 |
| 重试 | 结果卡失败态重试 + 回合重试 | 终态动作行 RotateCcw(succeeded/failed/cancelled/expired 可重试) | 一致 |
| 删除回合 | 无(旧版回合不可删,删除走历史屏) | Trash2 → AlertDialog(说明移入历史回收站) | 新增,保留 |
| 结果放大 | `ImageLightbox`:左右键翻图、复制图片、提示词展示 | Dialog 预览 + 复制提示词 | **P2**:单回合多图时无翻图;「复制图片」缺(见下) |
| 结果卡动作 | 下载保存(`system.saveImages`)、**存为提示词**(建库条目+关联历史+toast 带「查看」跳转)、复制图片、继续微调、查看历史 | ✅ 已收口(2026-08-29):存为提示词(`job-save-prompt` → 共用 `SavePromptDialog`,toast「查看」跳库高亮)+ 保存图片(`job-save-asset`/lightbox `lightbox-save-asset` → `generation.saveAsset`:桌面主进程解 media:// 路径 + 系统保存对话框,Web fetch→blob→a[download] 跨域降级新窗口) | 复制图片(桌面 clipboard)P2;微调/查看历史随域 |
| 多选批量 | ≥2 张成功图:「选择图片」进选择模式 → 计数 +「保存所选」/「取消」,选中释放有 180ms 离场动画 | 不适用(单张) | 随多张恢复(D3 解锁时) |
| 生成中骨架 | 比例占位 + `pulse-soft` 脉冲 | 比例占位 + Skeleton shimmer | 等价 |
| 错误呈现 | 结果卡内错误 + 重试 | `job-error` 红卡 + 动作行重试 | 一致 |

## 5. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 空态水印 | "Musefold" ZCOOL XiaoWei `clamp(88px,17vw,128px)`,逐字母 6s 透明度呼吸(0.04↔0.07),`--i * 0.28s` 错相,hover 单字母升到 0.9 主色 | ✅ 已恢复(2026-08-29):`WorkbenchEmptyState` + ui globals.css `mf-workbench-empty-watermark-*`,字体子集落 `packages/ui/fonts/`(@font-face 在 globals.css,双端自打包) | 收口 |
| 空态 Ember 呼吸 | mark 朱点 circle 与水印同周期 6s 呼吸(opacity 0.62↔1) | ✅ 已恢复(同上,mark 96px 与顶距节奏一并复原) | 收口 |
| 建议横滚 | 三行无缝 marquee(序列 ×8 translateX(-50%)),速度 38s/55s/47s 负延迟错相,两侧 16% mask 渐隐,hover 暂停 + 行文字升主色;reduced-motion 降级为静态三行居中 | ✅ 已恢复(2026-08-29):速度/负延迟/遮罩承旧值;减少动效双通道显式布局降级(静态单份居中、关遮罩) | 收口 |
| 结果就位 | `useResultTheaterReveal`:图片「无→有」瞬间 scale/opacity 落定(≤800ms `--dur-theater-enter`),静态挂载与减动效直接 idle | ✅ 已恢复(2026-08-29):按 03-C6 规格 —— scale 0.97→1 + opacity 640ms `--ease-smooth`(屏内作用域类 `mf-workbench-result-reveal`,不进全局 token);仅「生成中→成图」回合播一次,多图 60ms 错相;历史初载不播 | 收口 |
| 气泡入场 | `bubble-in`:8px 上移 + 0.98 scale 淡入(180ms ease-out) | ✅ 已恢复(2026-08-29):`mf-workbench-bubble-in`(`--dur-base` + `--ease-out`),回合 article 入场 | 收口 |
| 选择释放 | 180ms 离场缩放 | 不适用 | 随多选恢复 |
| 生成中头像点 | 状态点 `status-breathe`/`ember-breathe` 呼吸 | Badge 内 Spinner 旋转 | 等价语义,可保留新形态;若恢复呼吸与侧栏共用 keyframes |
| 减弱动效 | 双通道全覆盖 | ✅ 已收口(2026-08-29,见 01 §5) | 闸门已开:本屏 P1/P2 动效组(空态/reveal/气泡)解锁,JS 编排动效启动前查 `skipMotion()` |

## 6. UI/UX 细节

- **焦点管理**:✅ 已收口(2026-08-29):`WorkbenchScreen.focusPromptEnd`(rAF 聚焦 + 光标置尾)统一走 Composer `promptRef`,建议点击与编辑消息两条回填路径均已接;后续新增回填路径(历史来源确认等)复用同函数。
- **可达性**:旧 lightbox、选择模式、消息激活全部可键盘;新版动作行 `md:opacity-0 group-hover:opacity-100` 有 `group-focus-within` 兜底,合格。新增动效须带 `aria-hidden` 与 reduce 降级。
- **文案**:状态标签(排队中/生成中/已完成/失败/取消中/已取消)与旧 `workbenchGenerationStatusLabel` 口径一致;新增 pending_approval/rejected/expired 三态是云端契约扩展,文案已定。
- **testid**:旧 `refine-*`/`workbench-*` 双轨 → 新 `composer-*`/`job-*`/`timeline`,E2E 已切新;恢复旧能力时用新命名法(如 `composer-attach-input`、`job-save-prompt`)。

## 7. 差距 → 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P0~~ | ~~参考图输入链~~ ✅ 已收口(见 §3 表):三路入图 + chip 条 + 双端上传,E2E 覆盖拖拽 | — |
| ~~P1~~ | ~~Composer 形态复原~~ ✅ 已收口(2026-08-29,见 §2/§3 表):悬浮贴底几何(728px 卡 + 透明轨道 + 浮起阴影/毛玻璃)、11 档比例目录 + 形状预览网格菜单、质量档承旧命名、值摘要设置触发钮、36px 圆形发送钮微动效、⌘Enter/keyCode 229/Esc 停止、placeholder 双分支;视觉基线(web×2 视口 + electron)已重录 | — |
| ~~P1~~ | ~~结果卡动作组:下载、存为提示词~~ ✅ 已收口(2026-08-29,见 §4 表):契约 `saveAssetInputSchema/saveAssetResultSchema` + `GenerationGateway.saveAsset` 双端实现,双端单测 + 域桥测试(防目录穿越/取消返回 cancelled)覆盖;复制图片(桌面 clipboard)仍挂 P2 | — |
| ~~P1~~ | ~~空态动效恢复~~ ✅ 已收口(2026-08-29,见 §5 表):水印/横滚/Ember/mark 96px 全部承旧值恢复,reduce 双通道降级为静态形态,视觉基线已更新 | — |
| ~~P1~~ | ~~「回到最新」悬浮 pill + 用户消息「复制/编辑」动作~~ ✅ 已收口(2026-08-29,见 §4 表 + §6 焦点管理):单测覆盖离底显隐/回填聚焦置尾/生成中禁用 | — |
| ~~P2~~ | ~~结果就位 reveal + 气泡入场~~ ✅ 已收口(2026-08-29,见 §5 表):按 03-C6 屏内作用域实现(不进全局 token,00 §3 裁决);reduce 下经压制规则直接就位 | — |
| ~~P1~~ | ~~Prompt 引用六层闭环~~ ✅ 已收口(2026-08-29):最多 6 条整条/选中片段意图;owner/workspace host 解析;UTF-16/surrogate/version/长度边界;Composer 托盘;304px Dock/82dvh 移动 Dialog;不可变时间线快照;Web desktop/mobile + 真 Electron/SQLite + 真 PG 证据 | — |
| P2 | Lightbox 增强:单回合多图左右翻、键盘方向键;用户消息 meta 参数摘要行 | — |
| P3 | ~~⌘/Ctrl+Enter 发送别名~~(✅ 2026-08-29 显式接入,含 keyCode 229 守卫);~~建议点击后聚焦~~(✅ 随 §6 焦点管理收口);~~「+」菜单骨架~~(✅ 随参考图 P0 落地,`composer-attach` 菜单暂只「添加图片」) | — |

> 尚未迁挂点(防丢):工作模式 tab、指令建议浮层、历史来源 chip、方案/Skill preface 对话、微调目标引用、通用素材 Dock、豆包托管文案。Prompt 引用卡与提示词选择 Dock 已收口,不再属于暂缓域。

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

工作台是与 Codex 同构度最高的一屏(Composer 舞台 + 时间线),也是「剧场时刻预算」的持有者:结果就位 reveal 是全产品唯一允许 >260ms 的动效(00 法则 5),其余一切增益都做「快而静」。

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 03-C1 | C1 | ✅ 时间线→Composer 渐隐过渡(2026-08-29) | 时间线底缘 `h-24` 同色 gradient(`from-background`→透明,`pointer-events-none`,压在滚动内容上、垫在悬浮 Composer 下),内容滚过悬浮卡后不硬切(Codex 同法);静态遮罩,不受动效闸门影响 |
| 03-C2 | C1 | 附件 chip 解剖(挂靠 §7 参考图 P0) | chip 高 24px pill、缩略 16px、名称单行截断、删除钮 hover/focus 显、`--dur-base` 弹出/离场;行首 Backspace 逐个弹出承旧 Codex 式(§3);拖拽罩样式承旧(inset-1 虚线 accent) |
| 03-C3 | C1 | 输入框高度回落过渡 | 发送后 textarea 自增高回落 rows 2 时,高度过渡 `--dur-fast`(现为跳变);reduce 下直切 |
| 03-C4 | C1 | 发送钮三态 crossfade + press | ArrowUp/Square/Spinner 形态切换 `--dur-instant` crossfade;press 下沉(00 C-3);发送钮是本屏唯一 filled Ember(00 法则 1),不再新增 filled 主色元素 |
| 03-C5 | C2 | 状态文案 crossfade(挂靠 §7 气泡入场 P2) | 「排队中→生成中→已完成」Badge 文字切换 `--dur-instant` 淡切,避免瞬跳;耗时/字数计数 tabular(00 C-4) |
| 03-C6 | C2 | ✅ 已收口(2026-08-29,随 §7 P2):scale 0.97→1 + opacity 640ms `--ease-smooth`,屏内作用域;一次生成只 reveal 一次(`sawActive` ref 判定,历史初载不播),多图 60ms 错相 | — |
