# 05 历史记录(生成历史) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/pages/HistoryPage.tsx` + `apps/desktop/src/features/history/*`(`HistoryList` 255 行、`HistoryDetail` 560 行、`HistoryFilterBar` 347 行、`HistoryCleanupMenu` 162 行、`HistoryDiskUsage` 56 行、`HistoryLineagePanel` 121 行)+ `packages/product-ui/src/history/*`(8 文件)。
> **新版源码**:`packages/features/src/history/{HistoryScreen,HistoryRow,HistoryFilterBar,HistoryInspector,format,hooks}.tsx`。

---

## 1. 结论与迁移状态

历史屏是四屏中迁移完成度最高的一屏:布局(列表 + 右栏检视)、微调线程缩进、筛选维度(搜索/状态/模型/时间)、失败重试、回收站(恢复 + 永久删除,且永久删除带资产清理,是**超过旧版**的能力)、「查看会话」跳转都已就位,状态矩阵与空态 CTA 也符合 I5。缺口集中在**图片消费链**(Lightbox 放大翻图、保存/复制图片、打开文件夹)、**存为提示词**闭环、**批量清理**(清 30 天前/清失败/磁盘用量)三组,外加行元信息(成本/用时)与大列表虚拟化两项细节。

## 2. 布局对照

| 区块 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 整体 | 列表(960px 中轴)\| 右栏检视 320px,可折叠(`history-inspector-toggle` 顶栏钮) | 列表 \| 右栏 384px(lg+ 常驻 aside,选中即现;窄屏右侧 Sheet) | 结构一致;新版宽 64px 且不可手动折叠——选中即开、关闭钮收起,交互更直接,**维持新版口径** |
| 页头 | 顶栏标题 + 动作组(筛选开关/磁盘用量/清理菜单/检视开关) | 页内 h1 + 「全部/回收站」tabs | 新版清爽;清理/磁盘随 §6 |
| 筛选栏 | **折叠面板**(`filtersOpen` 开关,活动筛选计数 badge + ChevronDown 旋转) | 常驻单行(搜索/状态/模型/时间/清除) | 有意差异可接受:新版常驻减少一跳;活动筛选提示由「清除筛选」钮承担;**筛选计数 badge 不再必要** |
| 列表行 | 缩略图 + 提示词主行 + 元信息行(模型/成本/用时/错误/时间);微调行缩进 + ↳「微调 n」标签 | 同构(threadJobs 缩进);元信息:模型/状态/时间 | **成本与用时缺失,P2**(桌面本地记录有,云契约需补字段) |
| 回收站 | 无独立视图(删除即软删,恢复走数据库) | tab + 恢复/永久删除 + 确认 | **新版超集**,保留 |

## 3. 交互对照

| 交互 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 选中行 → 检视 | select + 检视自动展开 | 同 | 一致 |
| 微调线程 | `flattenHistoryThreads`:根按时间倒序,微调按正序缩进挂根下;孤儿微调标「微调(来源记录已删除)」;根行显「+n 微调」计数 | `threadJobs` 缩进 + parentRunId 线索 | 主干一致;**孤儿标注与根行微调计数待核对**(P3,对齐旧展示语义) |
| 搜索 | 本地过滤(提示词/反向词/模型/providerId/错误信息),即时 | 300ms 防抖 + 服务端 `q` | 等价偏优 |
| 状态筛选 | 全部/成功/失败/进行中(下拉) | 同维度 Select | 一致 |
| 时间筛选 | 预设 + **自定义日期区间**(`history-filter-custom-range`) | 预设(7d/30d/all) | **自定义区间缺失,P2** |
| 失败重试 | 行内 + 检视内;`historyErrorPresentation` 判定 canRetry,重试中行内 spinner + 「重试中…」 | 行内 + 检视内(active 态取消、终态重试) | 一致;错误可重试判定粒度(错误码分类)待随错误目录迁移 |
| 删除 | 行内删除(软删) | 移入回收站 + 恢复 + 永久删除(AlertDialog) | 新版超集 |
| Lightbox | 页级 `ImageLightbox`:成功记录集合内**左右键/按钮翻图**,选中态跟随翻页,复制图片、提示词展示 | ✅ 已收口(2026-08-29):`HistoryLightbox`(行缩略/检视图点击开启,成功集合按列表序左右翻:按钮 + 方向键,选中行跟随,计数 n/N tabular,内含复制提示词 + 保存图片) | 收口;复制图片(桌面 clipboard)随 P2 文件操作组 |
| 存为提示词 | 检视内 Dialog:标题输入(留空取提示词前 20 字)+ 预览 + 确认;成功后可跳库 | ✅ 已收口(2026-08-29):检视 `history-inspector-save-prompt` → 共用 `SavePromptDialog`(prompts/),成功 toast「查看」跳库高亮 | 收口 |
| 文件操作(桌面) | 打开文件夹 / 复制图片 / 删除图片文件(独立确认 Dialog,保留记录只删文件) | 无 | **P2**:能力开关(`hasLocalFileAccess`)门控,Web 不出现;「删除图片文件」可并入永久删除语义评估 |
| 保存图片 | 检视内下载到本地 | ✅ 已收口(2026-08-29):检视 `history-inspector-save-asset` → `generation.saveAsset`(桌面系统保存对话框 / Web 浏览器下载);Lightbox 内入口随 Lightbox 任务补 | 收口(检视);Lightbox 入口随 P1 |
| 查看会话 | 无(旧版历史与会话弱关联) | 检视「查看会话」跳工作台 | **新版新增**,保留 |
| 谱系面板 | `HistoryLineagePanel`:检视内展示微调链上下游可点跳 | parentRunId 文本线索 | **P2**:检视内补「来自 / 派生」跳转行(§0.2 微调链暂缓,但只读谱系展示不依赖发起微调) |
| 批量清理 | 顶栏「清理」菜单:清 30 天前 / 清失败与取消 / 清空全部,各带确认 Dialog(文案明确「图片文件仍保留」) | 无 | **P2**:入口移到回收站 tab 工具行或设置数据卡 |
| 磁盘用量 | `HistoryDiskUsage`:HardDrive 图标 + formatBytes readout + 刷新,随列表长度自动重取 | 无 | **P2**(桌面 only,能力开关) |

## 4. 检视面板(Inspector)对照

| 区块 | 旧版 `HistoryDetail` | 新版 `HistoryInspector` | 判定 |
|---|---|---|---|
| 空态 | 「选择一条记录查看详情」 | 不渲染(未选中即无面板) | 等价 |
| 图片 | 大图 + 点击开 Lightbox | ✅ 大图点击开 Lightbox(`history-inspector-image-open`,2026-08-29) | 收口 |
| 提示词 | 正文 + 复制钮;反向词块 + 复制 | 同(`history-inspector-prompt` + 复制/复制反向) | 一致 |
| 参数区 | 模型/尺寸/比例/质量/种子/成本/用时/创建时间 | 模型 + ParamRow 若干 | **字段核对,P2**:云契约缺成本/用时/种子的补齐进契约任务 |
| 动作区 | 重试/存为提示词/保存图片/打开文件夹/复制图片/删除文件/删除记录 | 取消/重试/存为提示词/保存图片/查看会话/移入回收站(+回收站态恢复) | 余下差值(文件操作组)见 §3 各行 |
| 错误区 | 错误标题 + 建议动作文案(`history-detail-error-action`) | 错误消息卡 | **P3**:错误建议动作(如「检查密钥」)随错误目录迁移 |

## 5. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 检视开合 | 宽度过渡 + `slide-in-right`(220ms `--ease-smooth`) | lg+ 直接挂载;Sheet 自带滑入 | **P3**:lg+ aside 出现建议补 slide-in(过 reduce 闸门) |
| Lightbox 开合 | `overlay-in` + `scale-fade-in`;翻图瞬时 | ✅ 已收口(2026-08-29,按 05-C1 规格):遮罩 background/90 + blur,图片 `mf-lightbox-settle` 0.98→1(`--dur-base` + `--ease-out`),翻图 key 重挂重播,相邻资产预取;reduce 由压制规则直达终态 | 收口 |
| 行选中 | 中性背景直切(刻意不动画) | 同 | 一致 |
| 重试中 | 行内 spinner + 文案切换 | Spinner | 一致 |
| 列表加载 | 空态 spinner 文案 | 6 条 Skeleton | 新版偏优(I1) |

## 6. 性能对照

旧列表用 `@tanstack/react-virtual`(行高 86/88 估算,overscan 5)支撑全量本地记录;新版无限查询分页 + 「加载更多」。同 04 §6 判定:分页保首屏,但连续加载后 DOM 无界,**P2 在 ~150 行阈值引入虚拟化**;桌面 SQLite 直读场景(全量返回)优先级更高。

## 7. 差距 → 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P1~~ | ~~Lightbox:检视图/行缩略点击放大;成功集合内左右翻;内含复制提示词 + 保存图片~~ ✅ 已收口(2026-08-29,见 §3/§5 表):翻图选中行跟随、Esc 关闭归焦(Radix 原生)、05-C1 工艺全项;(桌面)复制图片随 P2 文件操作组 | — |
| ~~P1~~ | ~~存为提示词 + 保存图片(检视动作)~~ ✅ 已收口(2026-08-29,见 §3 表):与 03 §7 共用 `SavePromptDialog` mutation;保存图片走 `generation.saveAsset` 双端实现 | — |
| P2 | 行/检视元信息补成本与用时(契约补 `costPoints`/`durationMs`,桌面桥已有源数据) | 成功行显示「x 积分 · ys」 |
| P2 | 时间筛选自定义区间;批量清理(清 30 天前/清失败与取消/清空回收站,各带确认);磁盘用量 readout(桌面能力开关) | 清理文案沿旧(「图片文件仍保留」口径按新资产语义重审) |
| P2 | 检视谱系区:「来自」「派生 n 条」可点跳选中 | 孤儿链路降级文案 |
| P2 | 桌面文件操作组(打开文件夹/复制图片),`hasLocalFileAccess` 门控 | Web 不渲染 |
| P3 | lg+ 检视 slide-in 入场(工艺规格见 §8 05-C3);错误建议动作文案;孤儿微调标注与根行「+n 微调」计数对齐旧语义 | — |

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 05-C1 | C1 | ~~Lightbox 工艺规格(挂靠 §7 Lightbox P1)~~ ✅ 已收口(2026-08-29) | 背景 `--background`/90% + backdrop-blur;图片 scale 0.98→1 落定(`--dur-base` + `--ease-out`,keyframes `mf-lightbox-settle`);方向键翻页时预取相邻资产(翻图无白闪);计数「n / N」tabular;关闭 Esc + 焦点归还(I9) |
| 05-C2 | C1 | 缩略与数字排版(挂靠 00 C-4/C-5) | 行缩略 `--radius-md` + 载入淡入;成本「x 积分」/耗时「ys」/延迟一律 tabular(随 §7 成本字段 P2 同卡) |
| 05-C3 | C1 | 检视滑入用 token(吸收 §7 P3 slide-in) | lg+ aside 出现 8px 右移淡入 `--dur-med` + `--ease-smooth`;Sheet 自带动画不动;reduce 直切 |
| 05-C4 | C2 | 筛选变更结果过渡 | 筛选/搜索命中集变化时列表 80ms 淡切(避免行瞬间重排的跳动感);虚拟化(§6 P2)落地时复核实现方式 |
