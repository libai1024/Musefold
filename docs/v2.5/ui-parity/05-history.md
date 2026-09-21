# 05 历史记录(生成历史) — 旧版 vs v2.5 对照

> **用途**:后续 UI/UX 交互任务的基石依据。
> **旧版源码**:`apps/desktop/src/pages/HistoryPage.tsx` + `apps/desktop/src/features/history/*`(`HistoryList` 255 行、`HistoryDetail` 560 行、`HistoryFilterBar` 347 行、`HistoryCleanupMenu` 162 行、`HistoryDiskUsage` 56 行、`HistoryLineagePanel` 121 行)+ `packages/product-ui/src/history/*`(8 文件)。
> **新版源码**:`packages/features/src/history/{HistoryScreen,HistoryRow,HistoryFilterBar,HistoryInspector,HistoryLightbox,HistoryMaintenanceBar,error,format,hooks}.tsx`;桌面维护域桥 `apps/desktop/electron/main/ipc-v25/history-domain.ts`。

---

## 1. 结论与迁移状态

历史屏是四屏中迁移完成度最高的一屏:布局(列表 + 右栏检视)、微调线程缩进、筛选维度(搜索/状态/模型/时间)、失败重试、回收站(恢复 + 永久删除,且永久删除带资产清理,是**超过旧版**的能力)、「查看会话」跳转都已就位,状态矩阵与空态 CTA 也符合 I5。2026-09-06(B1-T2)收口余下全部 P2/P3:行元信息(成本 · 用时,tabular)、检视完整参数区(含种子)、时间筛选自定义区间、批量清理三项、桌面磁盘用量 readout、桌面文件操作(在文件夹中显示 / 复制图片)、检视谱系区(来自 / 派生 n 条 + 孤儿降级)、错误码 → 建议动作目录、lg+ 检视滑入。**2026-09-06(B2-T4)**:大列表 >150 行虚拟化已落地(虚拟项 = 线程组,哨兵兼容,深链 `scrollToIndex`)。

## 2. 布局对照

| 区块 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 整体 | 列表(960px 中轴)\| 右栏检视 320px,可折叠(`history-inspector-toggle` 顶栏钮) | 列表 \| 右栏 384px(lg+ 常驻 aside,选中即现;窄屏右侧 Sheet) | 结构一致;新版宽 64px 且不可手动折叠——选中即开、关闭钮收起,交互更直接,**维持新版口径** |
| 页头 | 顶栏标题 + 动作组(筛选开关/磁盘用量/清理菜单/检视开关) | 页内 h1 + 「全部/回收站」tabs;回收站 tab 下多一行维护工具行(磁盘用量 + 清理菜单) | 一致(清理/磁盘 2026-09-06 收口,入口收进回收站,不干扰「全部」视图基线) |
| 筛选栏 | **折叠面板**(`filtersOpen` 开关,活动筛选计数 badge + ChevronDown 旋转) | 常驻单行(搜索/状态/模型/时间/清除) | 有意差异可接受:新版常驻减少一跳;活动筛选提示由「清除筛选」钮承担;**筛选计数 badge 不再必要** |
| 列表行 | 缩略图 + 提示词主行 + 元信息行(模型/成本/用时/错误/时间);微调行缩进 + ↳「微调 n」标签 | ✅ 同构(2026-09-06):threadJobs 缩进 + 「微调 n」标签 + 根行「+n 微调」;元信息 状态/模型/成本/用时/错误标题/时间,成本与用时 tabular 且只在成功行给 | 收口(契约补 `durationMs`/`seed`) |
| 回收站 | 无独立视图(删除即软删,恢复走数据库) | tab + 恢复/永久删除 + 确认 | **新版超集**,保留 |

## 3. 交互对照

| 交互 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 选中行 → 检视 | select + 检视自动展开 | 同 | 一致 |
| 微调线程 | `flattenHistoryThreads`:根按时间倒序,微调按正序缩进挂根下;孤儿微调标「微调(来源记录已删除)」;根行显「+n 微调」计数 | ✅ 已对齐(2026-09-06):`threadJobs` 返回 ThreadedJob(depth/refinementIndex/childCount/threadSize/orphan),线程按「线程内最新活动」倒序浮顶、线程内根在前微调正序,孤儿降级为根并标注,根行给「+n 微调」;父子成环时断环保证每条只出一次 | 收口 |
| 搜索 | 本地过滤(提示词/反向词/模型/providerId/错误信息),即时 | 300ms 防抖 + 服务端 `q` | 等价偏优 |
| 状态筛选 | 全部/成功/失败/进行中(下拉) | 同维度 Select | 一致 |
| 时间筛选 | 预设 + **自定义日期区间**(`history-filter-custom-range`) | ✅ 预设(今天/7d/30d/全部)+ 「自定义」两个 `Input type="date"`(2026-09-06) | 收口:契约 `from`/`to` 取本地日首尾(含首含尾),只填一头也生效;API 与 IPC 都进 SQL 条件 |
| 失败重试 | 行内 + 检视内;`historyErrorPresentation` 判定 canRetry,重试中行内 spinner + 「重试中…」 | ✅ 行内 + 检视内,按错误码目录判定(2026-09-06):`canRetryGeneration` —— 进行中/成功/拒绝/过期不给重试,已取消一律可重试,失败按 `history/error.ts` 的 canRetry(如密钥失效、额度不足、上游结果未知不给) | 收口(顺带修掉成功行出现重试钮的旧缺陷) |
| 删除 | 行内删除(软删) | 移入回收站 + 恢复 + 永久删除(AlertDialog) | 新版超集 |
| Lightbox | 页级 `ImageLightbox`:成功记录集合内**左右键/按钮翻图**,选中态跟随翻页,复制图片、提示词展示 | ✅ 已收口(2026-08-29 + 2026-09-06):`HistoryLightbox`(行缩略/检视图点击开启,成功集合按列表序左右翻:按钮 + 方向键,选中行跟随,计数 n/N tabular,内含复制提示词 + 保存图片 + 桌面「复制图片」/「在文件夹中显示」) | 收口 |
| 存为提示词 | 检视内 Dialog:标题输入(留空取提示词前 20 字)+ 预览 + 确认;成功后可跳库 | ✅ 已收口(2026-08-29):检视 `history-inspector-save-prompt` → 共用 `SavePromptDialog`(prompts/),成功 toast「查看」跳库高亮 | 收口 |
| 文件操作(桌面) | 打开文件夹 / 复制图片 / 删除图片文件(独立确认 Dialog,保留记录只删文件) | ✅ 检视与 Lightbox 都有「在文件夹中显示」/「复制图片」(2026-09-06),`capabilities.canRevealLocalFile` 门控,Web 不渲染 | 收口:可选网关方法 `generation.revealAsset` / `copyAssetToClipboard`,渲染层只送资产 id,受管根校验在主进程;「删除图片文件」不迁(已并入永久删除语义,资产不再与记录分开删) |
| 保存图片 | 检视内下载到本地 | ✅ 已收口(2026-08-29):检视 `history-inspector-save-asset` → `generation.saveAsset`(桌面系统保存对话框 / Web 浏览器下载);Lightbox 内入口同链路 | 收口 |
| 查看会话 | 无(旧版历史与会话弱关联) | 检视「查看会话」跳工作台 | **新版新增**,保留 |
| 谱系面板 | `HistoryLineagePanel`:检视内展示微调链上下游可点跳 | ✅ 检视「微调链」区(2026-09-06):「来自」父记录行 + 「派生 n 条」子记录列表,均可点跳选中;孤儿链路给「微调(来源记录已删除)」 | 收口(只读展示,不含发起微调 —— §0.2 暂缓面不变) |
| 批量清理 | 顶栏「清理」菜单:清 30 天前 / 清失败与取消 / 清空全部,各带确认 Dialog(文案明确「图片文件仍保留」) | ✅ 回收站 tab 工具行「清理」DropdownMenu 三项 + AlertDialog(2026-09-06) | 收口:新网关方法 `generation.cleanup({ scope })` 六层走线;前两项软删入回收站(文案沿旧「图片文件仍保留」,与新资产语义相符),`empty-trash` 复用 purge 语义(桌面删磁盘文件 / 云端入对象清理队列);成功 toast 报条数并整域 invalidate |
| 磁盘用量 | `HistoryDiskUsage`:HardDrive 图标 + formatBytes readout + 刷新,随列表长度自动重取 | ✅ 回收站工具行 HardDrive + formatBytes + 文件数 + 刷新钮(2026-09-06),随列表长度自动重取 | 收口:可选网关方法 `generation.getStorageUsage()`(桌面复用 `system/disk-usage.ts`,只回聚合数字不外露路径);Web 不实现,`canRevealLocalFile` 门控 |

## 4. 检视面板(Inspector)对照

| 区块 | 旧版 `HistoryDetail` | 新版 `HistoryInspector` | 判定 |
|---|---|---|---|
| 空态 | 「选择一条记录查看详情」 | 不渲染(未选中即无面板) | 等价 |
| 图片 | 大图 + 点击开 Lightbox | ✅ 大图点击开 Lightbox(`history-inspector-image-open`,2026-08-29) | 收口 |
| 提示词 | 正文 + 复制钮;反向词块 + 复制 | 同(`history-inspector-prompt` + 复制/复制反向) | 一致 |
| 参数区 | 模型/尺寸/比例/质量/种子/成本/用时/创建时间 | ✅ 模型/尺寸/比例/质量/种子/成本/用时/创建时间(2026-09-06) | 收口:契约补 `durationMs`(int\|null,缺省=宿主未上报)与 `seed`(int\|str\|null);值未知一律不渲染该行,不伪造 0 |
| 动作区 | 重试/存为提示词/保存图片/打开文件夹/复制图片/删除文件/删除记录 | 取消/重试/存为提示词/保存图片/查看会话/移入回收站(+回收站态恢复) | 余下差值(文件操作组)见 §3 各行 |
| 错误区 | 错误标题 + 建议动作文案(`history-detail-error-action`) | ✅ 归一标题 + 说明 + 「建议:xxx」(`history-detail-error-action`)+ 原始码/上游文案诊断行(2026-09-06) | 收口:`features/src/history/error.ts` 承旧错误目录,契约 `apiErrorCodeSchema` 为主键,旧宿主自由码(AUTH/NO_KEY/PROVIDER_REJECTED/DOUBAO_DAILY_LIMIT…)经别名表归一,归一不到用原始 message 当标题 |

## 5. 动效对照

| 动效点 | 旧版 | 新版 | 判定 |
|---|---|---|---|
| 检视开合 | 宽度过渡 + `slide-in-right`(220ms `--ease-smooth`) | ✅ lg+ aside 8px 右移淡入(2026-09-06,`animate-in slide-in-from-right-2 fade-in`,时长/曲线对齐 `--dur-med`/`--ease-smooth`);Sheet 自带滑入不动 | 收口:reduce-motion 由 globals.css 压制规则直达终态 |
| Lightbox 开合 | `overlay-in` + `scale-fade-in`;翻图瞬时 | ✅ 已收口(2026-08-29,按 05-C1 规格):遮罩 background/90 + blur,图片 `mf-lightbox-settle` 0.98→1(`--dur-base` + `--ease-out`),翻图 key 重挂重播,相邻资产预取;reduce 由压制规则直达终态 | 收口 |
| 行选中 | 中性背景直切(刻意不动画) | 同 | 一致 |
| 重试中 | 行内 spinner + 文案切换 | Spinner | 一致 |
| 列表加载 | 空态 spinner 文案 | 6 条 Skeleton | 新版偏优(I1) |

## 6. 性能对照

旧列表用 `@tanstack/react-virtual`(行高 86/88 估算,overscan 5)支撑全量本地记录。2026-09-06 补滚动哨兵(`history-load-sentinel`,IntersectionObserver 提前一屏取下一页,不支持的环境退化到手动按钮)。**2026-09-06(B2-T4)**:`packages/features` 已声明 `@tanstack/react-virtual` ^3.14.9;>150 行(或 >150 线程组)用 `useVirtualizer`,虚拟项 = 线程(父 + 微调子回合成组,缩进/拐角线保持),`estimateSize` 86/88 × 成员数,`measureElement` 动态,密度切换 `measure()`,深链 `scrollToIndex` + `scrollIntoView`;md+ 屏内滚动,`<md` 页面滚动走 window 视口。05-C4 筛选淡切仍待复核。

## 7. 差距 → 任务清单

| 优先级 | 任务 | 验收要点 |
|---|---|---|
| ~~P1~~ | ~~Lightbox:检视图/行缩略点击放大;成功集合内左右翻;内含复制提示词 + 保存图片~~ ✅ 已收口(2026-08-29,见 §3/§5 表):翻图选中行跟随、Esc 关闭归焦(Radix 原生)、05-C1 工艺全项;(桌面)复制图片随 P2 文件操作组 | — |
| ~~P1~~ | ~~存为提示词 + 保存图片(检视动作)~~ ✅ 已收口(2026-08-29,见 §3 表):与 03 §7 共用 `SavePromptDialog` mutation;保存图片走 `generation.saveAsset` 双端实现 | — |
| ~~P2~~ | ~~行/检视元信息补成本与用时~~ ✅ 已收口(2026-09-06):契约补 `durationMs`/`seed`;桌面桥 `duration_ms` 列优先、缺列退 finished-started 差值,种子取 `params_json.seed`;云端由 started/finished 差值算,种子上游未回报保持 null | 成功行显示「x 积分 · ys」(tabular) |
| ~~P2~~ | ~~时间筛选自定义区间;批量清理;磁盘用量 readout~~ ✅ 已收口(2026-09-06,见 §3 三行) | 清理文案沿旧(「图片文件仍保留」经新资产语义复核成立:前两项只软删记录) |
| ~~P2~~ | ~~检视谱系区:「来自」「派生 n 条」可点跳选中~~ ✅ 已收口(2026-09-06) | 孤儿链路降级文案 |
| ~~P2~~ | ~~桌面文件操作组(打开文件夹/复制图片)~~ ✅ 已收口(2026-09-06),门控用现有 `capabilities.canRevealLocalFile`(无 `hasLocalFileAccess` 这个 flag) | Web 不渲染 |
| ~~P3~~ | ~~lg+ 检视 slide-in 入场;错误建议动作文案;孤儿微调标注与根行「+n 微调」计数~~ ✅ 已收口(2026-09-06) | — |
| ~~P2(余)~~ | ~~大列表虚拟化(>150 行)~~ ✅ 2026-09-06 B2-T4 | 虚拟项=线程组;哨兵仍在列表末尾;深链 `scrollToIndex` |

## 8. Codex 增益(C 系列,语汇见 [00-codex-craft.md](./00-codex-craft.md))

| 编号 | 级 | 增益 | 规格 |
|---|---|---|---|
| 05-C1 | C1 | ~~Lightbox 工艺规格(挂靠 §7 Lightbox P1)~~ ✅ 已收口(2026-08-29) | 背景 `--background`/90% + backdrop-blur;图片 scale 0.98→1 落定(`--dur-base` + `--ease-out`,keyframes `mf-lightbox-settle`);方向键翻页时预取相邻资产(翻图无白闪);计数「n / N」tabular;关闭 Esc + 焦点归还(I9) |
| 05-C2 | C1 | ~~缩略与数字排版~~ ✅ 已收口(2026-09-06) | 行缩略 `--radius-md` + 载入淡入;成本「x 积分」/耗时「ys」/延迟一律 tabular(元信息行与检视参数区都走 `tabular-nums`) |
| 05-C3 | C1 | ~~检视滑入用 token~~ ✅ 已收口(2026-09-06) | lg+ aside 出现 8px 右移淡入(`--dur-med` + `--ease-smooth` 口径);Sheet 自带动画不动;reduce 直切 |
| 05-C4 | C2 | 筛选变更结果过渡 | 筛选/搜索命中集变化时列表 80ms 淡切(避免行瞬间重排的跳动感);虚拟化(§6 P2)落地时复核实现方式 |
