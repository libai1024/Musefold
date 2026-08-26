# 13 · 历史与成本 History & Cost —— Deep Dive

> **大功能定位**：主路径的**终点与账本**——「结果与成本账本」。每次生图（成功/失败/取消）在此沉淀，并作为资产**反哺回主路径**（回填 Composer / 另存 Prompt / 再次制作）。
> 引用：`docs/05-image-generation.md` §5（错误重试）·§6（历史字段与 UI）·§8（成本看板）、`docs/02` §2.4（history schema）、`docs/07` §3.6/§3.7/§3.8（image/history/system IPC）、`docs/product/01` §5.1（History→反哺流转）·§6.2（右栏检视）。
> 现状锚点：`docs/12` §1.5、§Phase C。图例见 [README §6](README.md)。

> **任务卡状态回写**：2026-08-04 · 基于源码实读 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

> **当前入口约定（2026-08-06）**：历史详情的主动作统一为“再次制作”，进入 Workbench 制作模式并回填提示词/参数，用户确认后手动生成；“探索相似”进入探索模式，沿用比例/来源但使用探索默认数量。仅失败记录的错误恢复按钮继续调用 `image.retry`。模式与父级关系写入 `history.params` 可选元数据，旧记录仍兼容。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为高频创作者，我要**按时间倒序回看每一次出图**，缩略图 + 提示词摘要一眼扫到上周那张满意的图。
- 作为提示词玩家，我看到一条历史，想**原样再生一张**（同参重跑），或**微调后再生**（改尺寸/质量再出）。
- 我出了张好图，想把当时那句 prompt **另存进库**长期管理，或**回填进 Composer** 继续深化造词。
- 生图失败了，我要**看懂为什么失败**（鉴权？余额？内容策略？）以及能不能**重试**，重试时要有「正在重试」的明确反馈。
- 作为中转站 API 用户，我要一个**成本账本**：这个月一共花了多少、哪个 Provider 最贵、按天/周/月怎么分布。
- 我要**打开图片所在文件夹**、复制文件路径，或在磁盘吃紧时**删掉源文件**释放空间。
- 我要**清理历史**：删单条、按时间清旧、一键清掉所有失败/取消的噪声记录。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| MJ / Krea：网页版生成流水，缩略图网格 + 参数回看 | 时间流 + 缩略图 + 参数回放 | 我们做**本地账本**，离线可查，不依赖云 |
| Draw Things / ComfyUI：本地历史 + 「send to」重跑 | **一键回填参数再生** | 进一步做**回填 Composer / 另存 Prompt** 的资产提升 |
| 云生图平台：用量/账单页 | **成本累计 + 按维度统计** | 云平台按真实账单；我们**本地估算**（用户可配单价），不联网对账 |
| 通用相册：大图灯箱 + 打开文件夹 | 灯箱 + 系统集成 | 图片是文件系统一等公民，走 `media://` 渲染、`shell` 打开 |

**结论**：History = **「生图流水的可回看性」×「本地账本的成本可控性」×「资产的反哺提升」**。它不是死日志，而是主路径闭环的**回流阀**——每条记录都能一键变回「可再生产的资产」。

---

## 2. 现状对照（设计 vs 实现）

> 依据 `docs/12` §1.5、§Phase C，并对照代码 `src/features/history/*`、`electron/main/ipc/history.ts`、`electron/main/ipc/images.ts`。图例：✅达标 🟡半成品 🔴未实现 🆕新增

| 小功能 | 设计要求 | 现状（代码证据） | 结论 |
|--------|----------|------------------|------|
| history 写入（成功/失败/取消） | 三态都落库 | ✅ `images.ts` 成功/失败/取消均 INSERT | 达标 |
| 列表按时间倒序 + 虚拟化 | `@tanstack/react-virtual` | ✅ `HistoryList.tsx` 已用（estimateSize 72） | 达标 |
| 缩略图（`media://`） | 主进程协议渲染 | ✅ `Thumb` 用 `toImageSrc`，broken 兜底 | 达标 |
| 状态徽标（成功/失败/**取消**） | 三态区分 | 🟡 `ok = status==='success'`，**cancelled 被当作 failed 渲染红叉** | **修复** |
| 成本/耗时展示 | 单条 cost/duration | ✅ `formatCost`(¥)、`formatDuration` | 达标（单条） |
| 失败重试 | 同参重跑 | ✅ 失败文案/可重试策略/「重试中」态已接 `image.retry` | 达标 |
| 删除单条 | `db:history:delete` | ✅ store `remove` | 达标 |
| 状态/时间/Provider 筛选 | 多维筛选 | ✅ FilterBar + `list({status,from,to,providerId})` DB AND | 达标 |
| **详情面板**（大图/全参/错误/打开文件夹/复制路径） | 右栏检视 | ✅ `HistoryDetail` 右栏检视（大图/全参/错误/来源/打开文件夹/复制路径） | 达标 |
| **大图灯箱** | 全屏预览 + 缩放 + 上下张 | ✅ 复用 `ImageLightbox`，History 顶层按当前筛选结果翻页，支持 `media://`、broken 兜底、缩放工具条 | 达标 |
| **回填 Composer** | 历史→画布 | 🔴 无 | 🆕 P1 |
| **另存为 Prompt** | 历史 prompt_text 入库 | ✅ `HistoryDetail` 另存弹窗 + `historyRecordToPromptInput` 映射，沿用 `db:prompts:create`，toast 可跳 Library | 达标 |
| **再次制作 / 失败重试** | 回填制作 / 同参恢复 | ✅ 详情主动作进入 Workbench 制作并回填 prompt/negative/params；失败态独立接 `image.retry` | 达标 |
| 清理历史 | 按时间清 / 清失败取消 | ✅ 顶栏清理菜单 + 二次确认；`clear({before,statuses})` 支持按时间/状态组合，返回 deleted 数 | 达标 |
| 图片文件管理 | 删源文件 + 磁盘占用 | ✅ `delete({deleteFile})` 可删源文件；`system:diskUsage` 统计图片输出目录并在顶栏展示 | 达标 |
| **使用统计**（累计/趋势/渠道/模型/账号积分） | V2 数据视图 | ✅ 已移至设置 / 使用统计；History 只保留单条成本元数据 | 达标（V2） |
| 打开所在文件夹 | reveal in folder | ✅ `system:openInFolder` 对文件用 `shell.showItemInFolder`，目录用 `openPath`；缺失路径返回可读错误 | 达标 |
| 空态文案 | 对齐融合双入口 | 🟡 现写「在创作台生成图像后…」（Studio 心智，与 Chat/Generate 不一致） | **修复** |

**一句话**：**History 聚焦结果回看、复用与文件管理；跨记录聚合由设置 / 使用统计承载。**

---

## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | 列表精修：三态徽标修复 + 空态文案对齐 + store 类型化 | P1 | [TASK-HIS-01](#task-his-01) |
| 2 | 筛选栏（状态 + 日期范围 + Provider） | P1 | [TASK-HIS-02](#task-his-02) |
| 3 | 右侧检视详情面板（大图/全提示词/全参数/错误/元数据） | P1 | [TASK-HIS-03](#task-his-03) |
| 4 | 大图灯箱（lightbox，缩放/上下张/键盘） | P1 | [TASK-HIS-04](#task-his-04) |
| 5 | 系统集成：打开所在文件夹 + 复制路径 | P1 | [TASK-HIS-05](#task-his-05) |
| 6 | 回填 Composer（历史→画布深化）🆕 | P1 | [TASK-HIS-06](#task-his-06) |
| 7 | 另存为 Prompt（历史 prompt_text 入库）🆕 | P1 | [TASK-HIS-07](#task-his-07) |
| 8 | 再次制作（回填 Workbench）+ 失败重试 | P1 | [TASK-HIS-08](#task-his-08) |
| 9 | 失败重试 UX（错误码文案表 + 「重试中」进度态） | P1 | [TASK-HIS-09](#task-his-09) |
| 10 | 删除与清理（单条 / 按时间清 / 清失败+取消） | P1 | [TASK-HIS-10](#task-his-10) |
| 11 | 图片文件管理（删源文件 + 磁盘占用感知） | P2 | [TASK-HIS-11](#task-his-11) |
| 12 | 成本聚合查询 `db:history:stats` 🆕 | P2 | [TASK-HIS-12](#task-his-12) |
| 13 | 单价配置（每 Provider·每图/每千 token） | P2 | [TASK-HIS-13](#task-his-13) |
| 14 | 成本看板 UI（累计 + 按日周月 + 按 Provider + 图表） | P2 | [TASK-HIS-14](#task-his-14) |

---

## 4. UI/UX 设计

### 4.1 页面布局（HistoryPage）—— 三栏，右栏为记录详情检视

> 沿用 `docs/product/01` §6.2 全局三栏骨架：History 主区为流水列表，右栏显示选中记录详情（可折叠）。顶栏含筛选栏 + 「成本看板」入口。

```
┌─ 主区 ─────────────────────────────────────────┬─ 检视(320,可折叠) ─┐
│ ┌ 顶栏 ───────────────────────────────────────┐ │ ┌────────────────┐ │
│ │ 🕘 生成历史 (128)         [📊 成本看板] [清理▾]│ │ │  [ 大 图 预 览 ] │ │
│ │ [状态: 全部▾][近30天▾][Provider▾]  已筛选 3 项⌫│ │ │   点击→灯箱 ⤢   │ │
│ └─────────────────────────────────────────────┘ │ │ ────────────── │ │
│ ┌ 流水（时间倒序，虚拟化） ────────────────────┐ │ │ ✅ gpt-image-2  │ │
│ │ ┌─────────────────────────────────────────┐ │ │ │ 2026-08-03 14:2 │ │
│ │ │[缩] ✅ gpt-image-2      08-03 14:22  🕘  │ │ │ │ ────────────── │ │
│ │ │     cinematic portrait, soft natural...  │ │ │ │ 提示词          │ │
│ │ │     ¥0.32 · 4.2s          [↻][⋯][🗑]     │ │ │ │ cinematic port… │ │
│ │ ├─────────────────────────────────────────┤ │ │ │ 负面 · 参数      │ │
│ │ │[缩] ✅ ...                                │ │ │ │ 1024² · high ·1 │ │
│ │ ├─────────────────────────────────────────┤ │ │ │ ────────────── │ │
│ │ │[✕] 🔴 gpt-image-2  余额不足   08-03 12:0 │ │ │ │ [再次制作]      │ │
│ │ │     a serene lake at dawn...   [重试中…] │ │ │ │ [探索相似]      │ │
│ │ ├─────────────────────────────────────────┤ │ │ │ [回填 Composer] │ │
│ │ │[⊘] ⏹ gpt-image-2  已取消    08-03 11:4  │ │ │ │ [另存为 Prompt] │ │
│ │ └─────────────────────────────────────────┘ │ │ │ [📂 文件夹][📋] │ │
│ └─────────────────────────────────────────────┘ │ └────────────────┘ │
└──────────────────────────────────────────────────┴────────────────────┘
```

### 4.2 HistoryRow（列表项，三态）

```
┌────────────────────────────────────────────────────┐
│ [缩略图]  ✅ gpt-image-2                08-03 14:22 🕘 │  ← 状态图标 + model + 时间
│  48x48    cinematic portrait, soft natural light...  │  ← prompt 摘要(1 行截断)
│           ¥0.32 · 4.2s               [↻][⋯][🗑]      │  ← 成本·耗时 + hover 动作
└────────────────────────────────────────────────────┘
状态图标：✅success=绿 CheckCircle2 / 🔴failed=红 XCircle / ⏹cancelled=灰 Ban(Slash)
失败行：成本/耗时位显示 error_message 摘要（红）；hover 显 [重试]
hover：背景微亮 bg-elevated；显示 [重试(仅失败)][更多⋯][删除]
```

### 4.3 详情检视面板（HistoryDetail，右栏）

```
┌ 记录详情 ─────────────────────── ✕ 折叠 ┐
│ ┌────────────────────────────────────┐ │
│ │        [ 大 图 缩 略 ]   ⤢ 点击放大  │ │  ← media:// 渲染；失败/取消无图→占位
│ └────────────────────────────────────┘ │
│ ✅ 成功 · gpt-image-2 · 我的 OneAPI      │  ← 状态 + model + provider name
│ 2026-08-03 14:22:07   ¥0.32 · 4.2s      │
│ ────────────────────────────────────── │
│ 提示词                          [📋 复制] │
│ ┌────────────────────────────────────┐ │
│ │ cinematic portrait, soft natural…   │ │  ← 完整正文，等宽，可滚动
│ └────────────────────────────────────┘ │
│ 负面提示词                              │
│ ┌────────────────────────────────────┐ │
│ │ blurry, lowres…                     │ │
│ └────────────────────────────────────┘ │
│ 参数：1024×1024 · high · n=1 · auto     │  ← size/quality/n/background/moderation
│ 来源：库「电影感人像」↗ / 组合 ↗ / —    │  ← prompt_id/composition_id 反查(可空)
│ ─────────── 失败时额外 ─────────────── │
│ ⚠ AUTH_FAILED · 密钥无效或已过期        │  ← error_code + 中文文案(见 §4.5)
│ ────────────────────────────────────── │
│ [🪄再次制作] [✦探索相似] [🧩回填Composer]│  ← 反哺主路径动作
│ [💾另存为Prompt] [📂打开文件夹] [📋路径] │
│ [🗑删除记录]  ·  [🗑️删除记录+源文件]     │
└──────────────────────────────────────────┘
```

### 4.4 使用统计边界（V2）

```
History：记录检索 → 单条详情 → 再次制作 / 文件管理
Settings / Usage：累计摘要 → 活动热力图 → 渠道趋势 → 模型与渠道分布
```

History 顶栏不再显示累计成本入口。单条详情可以继续显示本次生成的渠道、模型、耗时与积分；统计页只把账号托管渠道的成功记录汇总为积分，豆包体验和用户自建 Provider 只统计用量与成功率。

### 4.5 错误码 → 用户文案表（失败重试 UX，对齐 docs/05 §5）

| error_code | 中文文案 | 是否可重试 | 建议动作 |
|---|---|---|---|
| `AUTH_FAILED` (401/403) | 密钥无效或已过期 | 否 | [去更新 Key ↗]（设置） |
| `INSUFFICIENT_BALANCE` | 账户余额不足 | 否 | 提示充值，不显重试 |
| `CONTENT_POLICY` (400) | 提示词触发内容策略 | 否 | [再次制作] 改词 |
| `RATE_LIMITED` (429) | 请求过于频繁 | 是（已自动退避） | 稍后 [重试] |
| `SERVER_ERROR` (5xx) | 服务端错误 | 是 | [重试] |
| `NETWORK_ERROR` | 网络连接失败 | 是 | 检查网络后 [重试] |
| `CANCELLED` | 已取消 | 是（手动重发） | [再次制作] |
| `UNKNOWN` | 生成失败（原始信息保留） | 是 | 展开看 details |

### 4.6 关键交互与状态表

| 场景 | 行为 |
|------|------|
| 列表加载 | 首次 `load({limit:200})`；虚拟化滚动；滚到底追加下一页（offset 分页）🆕 |
| 单击行 | 右栏检视显示该记录详情（不弹窗）；行高亮选中 |
| 缩略图/大图点击 | 打开灯箱（§4.3 ⤢），Esc 关闭，←/→ 切上下张 |
| 状态筛选 | 全部/成功/失败/取消，切换即 `list({status})` |
| 日期范围 | 近 7 天 / 近 30 天 / 本月 / 自定义 → `list({from,to})` 🆕 |
| Provider 筛选 | 下拉选某 Provider → `list({providerId})` 🆕 |
| 再次制作 | 打开 Workbench「制作」模式并预填 prompt/negative/Provider/params；不自动请求，用户确认后再生 |
| 失败重试 | 仅错误态恢复按钮同参调 `image:retry(id)`；行进入「重试中…」状态，完成后刷新 |
| 回填 Composer | 以该记录 prompt_text 为初始 body 打开 Composer（依赖 Composer 支持，未就绪灰显 + tooltip）🆕 |
| 另存为 Prompt | 弹轻确认（可填标题）→ `db:prompts:create`（source=`import`，写 sourceUrl 反查）→ toast「已存入库 ↗」🆕 |
| 打开文件夹 | `system:openInFolder`（修正为 reveal）；无 image_path 时禁用 |
| 复制路径 | 写剪贴板 + toast |
| 删除单条 | 乐观移除 + toast；默认只删 DB 行（保留源文件） |
| 删除+源文件 | 二次确认「同时删除磁盘上的图片文件？不可恢复」→ 删行 + `fs.unlink` 🆕 |
| 清理菜单 | 「清除 30 天前」/「清除全部失败与取消」/「清空全部」（后二者二次确认）🆕 |
| **空态** | 无记录：图标 +「还没有生成记录」+ 引导「去 **Generate** 或 **Chat** 试试」（对齐融合双入口，替换现「在创作台生成」） |
| **加载态** | 列表骨架屏（3-5 行占位） |
| **错误态** | 现有：整页错误 + [重试]（DB 未就绪时兜底），保留 |
| 成本看板入口 | 顶栏 [📊 成本看板] → 抽屉/独立视图（§4.4） |

---

## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。IPC 契约引用 `docs/07`；新增契约标 🆕 并给完整签名。

### <a id="task-his-01"></a>[TASK-HIS-01] 列表精修：三态徽标 + 空态文案 + store 类型化

- **状态**：✅ 已完成（2026-08-04：三态徽标 success/failed/cancelled + 空态文案 + store 类型化）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：无
- **预估**：S

**目标**：修掉现状 3 处小瑕疵——cancelled 被当 failed 渲染、空态文案 Studio 心智、store 里 `as unknown as` 强转——让列表三态正确、文案对齐融合双入口。

**涉及文件**：
- `src/features/history/components/HistoryList.tsx`（修改：`ok` 二值 → 三态 `status` 分支，取消态用灰色 `Ban`/`Slash` 图标 + 「已取消」；空态 hint 改文案）
- `src/features/history/store.ts`（修改：`load` 的 `q` 类型改为 `{ status?: HistoryStatus; from?; to?; providerId?; limit?; offset? }`，去掉 `as unknown as`）

**IPC 契约**：沿用 `db:history:list`（docs/07 §3.7），本卡不改后端。

**交互与 UI/UX**：见 §4.2 三态图标定义、§4.6 空态。空态文案：标题「还没有生成记录」，hint「去 Generate 或 Chat 试试，生成的图像会出现在这里」。

**验收标准**：
- [x] success/failed/cancelled 三态图标与颜色各不相同（绿✓/红✗/灰⏹）
- [x] cancelled 记录不再显示为红色失败样式
- [x] 空态文案不含「创作台/组合器」，改为「去 Generate 或 Chat 试试」
- [x] store `load` 参数类型化（无 `as unknown as`），`npm run typecheck` 通过

**测试场景**：
1. 正常：库里有三态各若干 → 列表图标/颜色正确。
2. 边界：全是 cancelled 时不出现任何红色误报。
3. 异常：空库 → 显示对齐后的空态文案。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test`（含 `history/status.test.ts`）

---

### <a id="task-his-02"></a>[TASK-HIS-02] 筛选栏（状态 + 日期范围 + Provider）🆕

- **状态**：✅ 已完成（2026-08-04：FilterBar + DB AND 筛选 status/from/to/providerId）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-01
- **预估**：M

**目标**：主区顶部 FilterBar：状态（全部/成功/失败/取消）、日期范围（近 7 天/30 天/本月/自定义）、Provider（下拉全部已配置），多条件 AND，一键清空。

**涉及文件**：
- `src/features/history/components/HistoryFilterBar.tsx`（新建）
- `src/features/history/store.ts`（补 `filters` 状态 + `setFilters`）
- `electron/main/ipc/history.ts`（修改：`HISTORY_LIST` 扩展 `from`/`to`/`providerId` 条件拼 WHERE）

**IPC 契约**（🆕 扩展 `db:history:list`，向后兼容）：
```ts
// 请求扩展
{ status?: HistoryStatus; providerId?: string; from?: number; to?: number; limit?: number; offset?: number }
// 响应不变：HistoryRecord[]
```

**交互与 UI/UX**：见 §4.1 顶栏、§4.6 筛选行为。活跃筛选显示「已筛选 N 项 ⌫」chip；日期倒置自动纠正。

**验收标准**：
- [x] 三维筛选可组合，结果为 AND 交集且走 DB 查询（非前端过滤）
- [x] Provider 下拉来自 `provider:list`，含「全部」
- [x] 「清空」重置全部条件回默认（全部/近 30 天/全部 Provider）
- [x] 活跃筛选显示 chip + 计数

**测试场景**：
1. 正常：筛「失败 + 近 7 天 + OneAPI」→ 结果符合。
2. 边界：无匹配 → 空态（区分于「无历史」，提示「没有匹配，清除筛选」）。
3. 异常：自定义时间段起 > 止 → 自动交换。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 109/109（filters + buildHistoryListSql）


---

### <a id="task-his-03"></a>[TASK-HIS-03] 右侧检视详情面板

- **状态**：✅ 已完成（2026-08-04：HistoryDetail 右栏 + 行选中高亮 + 可折叠检视；动作按钮灰显待 HIS-05～08）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-01
- **预估**：M

**目标**：单击列表行 → 右栏显示该记录详情（大图/完整正文/负面/全参数/Provider+model/时间/成本耗时；失败时错误码+文案；来源反查）。**这是 P1「历史详情弱」的核心补齐**（docs/12 §Phase C 1）。

**涉及文件**：
- `src/features/history/components/HistoryDetail.tsx`（新建）
- `src/features/history/store.ts`（补 `selectedId` + `select(id)`）
- `src/pages/HistoryPage.tsx` / `src/components/layout/AppShell.tsx`（右栏挂载，参照 docs/01 §6.2）
- `src/features/history/components/HistoryList.tsx`（行点击 → select；选中高亮）
- `src/features/history/format.ts`（参数摘要 / 来源文案）

**IPC 契约**：沿用 `db:history:get`（docs/07 §3.7，handler 已存在）。来源反查用 `db:prompts:get` / `db:compositions:list` 拿标题（可空时显「—」）。

**交互与 UI/UX**：见 §4.3。大图走 `media://`（`toImageSrc`，见 memory「media:// protocol images」），失败/取消无图显占位。检视栏可折叠，折叠态列表占满（对齐 docs/01 §6.2）。动作按钮见 §4.3 底部（其功能在 HIS-05/06/07/08 落地，本卡先占位/灰显）。

**验收标准**：
- [x] 单击行 → 右栏详情，行高亮，不弹窗
- [x] 成功记录显示大图（media://）、完整正文/负面/参数
- [x] 失败记录显示 error_code + §4.5 中文文案 + details 可展开
- [x] 来源（prompt/composition）可反查显示标题，无来源显「—」
- [x] 检视栏可折叠

**测试场景**：
1. 正常：选成功记录 → 大图 + 全参数正确。
2. 边界：无 image_path（失败/取消）→ 占位不报错。
3. 异常：来源 prompt 已被删（外键 SET NULL）→ 来源显「—」不崩。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] 单测 `formatParamsSummary` / `formatSourceLabel` 覆盖；全量 vitest 通过
- [x] Electron E2E 验证成功/失败两类记录详情、media:// 大图、错误文案与动作入口

---

### <a id="task-his-04"></a>[TASK-HIS-04] 大图灯箱（Lightbox）

- **状态**：✅ 已完成（2026-08-04：History 详情大图/列表缩略图接入共享 ImageLightbox，支持缩放、Esc/遮罩关闭、左右键按当前筛选结果翻页、缺失图片兜底）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-03
- **预估**：S

**目标**：点击详情大图/列表缩略图 → 全屏灯箱查看，支持 Esc 关闭、←/→ 切上/下一条（在当前筛选结果内）、点背景关闭。复用 Chat 现有 `ImageLightbox`。

**涉及文件**：
- `src/features/chat/components/ImageLightbox.tsx`（复用/抽为通用 `src/components/ui/image-lightbox.tsx`）
- `src/pages/HistoryPage.tsx`（统一维护 lightbox 当前记录与上下张）
- `src/features/history/components/HistoryList.tsx`（缩略图打开灯箱）
- `src/features/history/components/HistoryDetail.tsx`（接灯箱开关）
- `tests/e2e/test_06_history.py`（扩展：media:// 渲染、缩放、翻页、缺失图、单图边界）

**IPC 契约**：无（纯前端，图片走 `media://`）。

**交互与 UI/UX**：Esc 关闭、←/→ 在结果集内切换、点遮罩关闭；工具条可放大/缩小/重置（键盘 `+`/`-`/`0`）；无图记录不触发。

**验收标准**：
- [x] 点大图/缩略图 → 灯箱全屏，图片 `media://` 正确渲染
- [x] Esc / 点遮罩关闭
- [x] ←/→ 在当前筛选结果内切上下张（仅含图记录）
- [x] 支持缩放/重置，单图边界左右键无副作用
- [x] 复用而非重造灯箱组件

**测试场景**：
1. 正常：打开→缩放→翻页→关闭。
2. 边界：结果只有 1 张时 ←/→ 无副作用。
3. 异常：图片文件缺失 → 灯箱内占位不崩。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm run check` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 6/6 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 157 passed / 6 skipped

---

### <a id="task-his-05"></a>[TASK-HIS-05] 系统集成：打开所在文件夹 + 复制路径

- **状态**：✅ 已完成（2026-08-04：History 详情按钮接线 + 复制路径 toast + 缺失路径错误提示 + system reveal 语义校准）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-03
- **预估**：S

**目标**：详情面板「📂 打开文件夹」在系统文件管理器中**定位到该图片**（而非打开图片本身），「📋 复制路径」把绝对路径写剪贴板。

**涉及文件**：
- `electron/main/ipc/system.ts`（文件 `shell.showItemInFolder(path)`；目录 `shell.openPath(path)`；缺失路径 reject）
- `src/features/history/components/HistoryDetail.tsx`（接「打开文件夹」「复制路径」两个按钮）

**IPC 契约**：沿用 `system:openInFolder`（docs/07 §3.8）；复制路径纯前端 `navigator.clipboard`。

> **注意**：现状 `shell.openPath` 会直接打开图片（默认看图器），语义应为「在文件夹中显示」。改动影响所有调用方（Chat/Studio 的「打开文件夹」若共用需一并核对）。

**验收标准**：
- [x] 「打开文件夹」在 Finder/资源管理器中高亮定位到该 png（不是打开图片）
- [x] 无 image_path（失败/取消）时按钮禁用
- [x] 「复制路径」写入剪贴板 + toast
- [x] 文件已被移动/删除时给出可读提示，不崩

**测试场景**：
1. 正常：成功记录 → 定位到 `~/Pictures/PromptForge/{ulid}.png`。
2. 边界：失败记录按钮禁用。
3. 异常：路径不存在 → toast「路径不存在或已被移动」。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Electron e2e 验证文件动作与缺失路径错误（`tests/e2e/test_06_history.py`）；`npm run check` 通过

---

### <a id="task-his-06"></a>[TASK-HIS-06] 回填 Composer（历史→画布深化）🆕

- **状态**：✅ 已完成（2026-08-04：History 详情按钮接入跨视图 Composer 意图；临时模板支持正向+负面槽，跳转后聚焦正文，不修改历史记录）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-03
- **预估**：M
- **关联**：[11-composer](11-composer-deep-dive.md)、[01-vision-and-ia](01-vision-and-ia.md) §5.1（History→回填 Composer）

**目标**：详情「🧩 回填 Composer」→ 以该记录 `prompt_text`（及 negative）为初始 body 打开 Composer 深化造词，形成「结果反哺资产」闭环。

**涉及文件**：
- `src/features/history/components/HistoryDetail.tsx`（动作按钮）
- `src/stores/app.ts`（扩展 `pendingComposerBody` / `requestComposerBody` 携带 negative）
- `src/pages/ComposerPage.tsx`（消费跨视图意图并注入 Composer）
- `src/features/composer/store.ts`（`openWithBody(body,{negative})` 临时双槽模板）
- `src/features/composer/components/CompositionCanvas.tsx`（回填后聚焦 `content` 槽）
- `src/features/library/components/PromptDetail.tsx`（既有 Library→Composer 通道同步传负面词）
- `tests/e2e/test_06_history.py`（新增 History→Composer 正/负面回填链路）
- `tests/e2e/test_03b_composer_audit.py`（新增 `openWithBody` 负面槽审计）

**IPC 契约**：无（前端状态传递；不落库，符合 docs/00 决策 #2「资产单向提升」——回填是编辑起点，用户在 Composer 内决定是否另存）。

**交互与 UI/UX**：见 §4.6。回填后切到 Composer、挂临时模板并聚焦正文槽；负面词作为独立可编辑槽位进入右栏负面预览。

**验收标准**：
- [x] 点击 → 切到 Composer，body 预填该记录 prompt_text
- [x] 有 negative 时一并回填负面
- [x] 回填后聚焦 Composer 正文槽，可直接继续编辑
- [x] 回填为「新起点」，不修改原历史记录

**测试场景**：
1. 正常：从一条历史回填 → Composer body 一致。
2. 边界：prompt_text 超长 → 正常载入不截断。
3. 边界：带 negative → Composer 负面槽与预览一致。
4. 异常：Composer 尚未加载模板列表 → 临时模板仍可先行注入，加载完成不覆盖。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 124/124 通过
- [x] `npm run check` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py tests/e2e/test_03b_composer_audit.py::test_open_with_body_can_backfill_negative_text tests/e2e/test_03b_composer_audit.py::test_pending_composer_body_not_reinjected_after_view_toggle_preserves_edits -q` 9/9 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 159 passed / 6 skipped

---

### <a id="task-his-07"></a>[TASK-HIS-07] 另存为 Prompt（历史 prompt_text 入库）🆕

- **状态**：✅ 已完成（2026-08-04：History 详情另存弹窗 + prompt 映射 helper + toast 跳 Library + 重复保存/失败兜底）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-03
- **预估**：S
- **关联**：[10-library](10-library-deep-dive.md)、[01-vision-and-ia](01-vision-and-ia.md) §5.1（History→另存 Prompt）

**目标**：详情「💾 另存为 Prompt」→ 把该记录的 `prompt_text`/`negative_text`/`params` 存入提示词库，可填标题，存后可跳库中查看。

**涉及文件**：
- `src/features/history/components/HistoryDetail.tsx`（另存动作 + 轻量标题输入）
- `src/features/history/save-prompt.ts`（新增：`HistoryRecord` → `NewPrompt` 映射与标题兜底）
- `src/features/history/__tests__/save-prompt.test.ts`（新增：映射单测）
- `tests/e2e/test_06_history.py`（扩展：真实入库、跳 Library、重复保存、IPC reject）
- 复用 `db:prompts:create`（`NewPrompt`）

**IPC 契约**：沿用 `db:prompts:create`（docs/07 §3.1）。映射：
```ts
{
  title: 用户填 || prompt_text 前 20 字,
  content: record.promptText,
  contentNegative: record.negativeText ?? undefined,
  params: record.params ?? undefined,
  source: 'import',          // 来自历史（enums PromptSource：manual|import|shared|composition）
  sourceUrl: `history://${record.id}`,  // 反查来源标记
}
```

**交互与 UI/UX**：见 §4.6。存后 toast「已存入库 ↗」，点 ↗ 跳 Library 并选中新条目。

**验收标准**：
- [x] 另存后库中出现新 prompt，content = 历史 prompt_text
- [x] 负面/参数一并带入
- [x] source 标为 `import`，sourceUrl 记录来源历史 id
- [x] toast 提供跳转 Library 的入口
- [x] 重复另存同一条不报错（允许多份）

**测试场景**：
1. 正常：另存 → Library 出现且字段正确。
2. 边界：标题留空 → 用 prompt_text 前 20 字兜底。
3. 异常：create IPC reject → 错误 toast，不误报成功。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 124/124 通过（含 `save-prompt.test.ts`）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 4/4 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 155 passed / 6 skipped

---

### <a id="task-his-08"></a>[TASK-HIS-08] 再次制作（回填 Workbench）+ 失败重试

- **状态**：✅ 已完成（2026-08-06：详情主动作改为「再次制作」，只回填 Workbench 制作模式，不再自动请求；失败记录保留独立的错误恢复重试）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-03
- **预估**：M
- **关联**：[12-generation](12-generation-deep-dive.md)（Generate 精修模式）

**目标**：把历史详情主路径改为可控的「再次制作」：将 prompt/negative/Provider/params 带入 Workbench 制作输入框，由用户修改并确认；错误态仍提供独立的同参重试。

**涉及文件**：
- `src/features/history/components/HistoryDetail.tsx`（再次制作 / 探索相似 / 错误重试动作）
- `src/features/history/store.ts`（`retry(id, {force})` 支持同参再生成）
- `src/features/history/refine.ts`（history params → Generate 精修参数映射）
- `src/features/generation/components/GeneratePanel.tsx`（质量选项补齐 `auto`）

**IPC 契约**：
- 再次制作：无新 IPC（前端把历史参数灌进 Workbench 制作，用户触发统一 `image:generate`）。
- 失败重试：沿用 `image:retry` `{ historyId }`（handler 已存在，按 history 行重建 req）。

**交互与 UI/UX**：见 §4.6。再次制作 → 进入制作模式并聚焦可编辑输入框，Toast 明确“确认后手动制作”；失败重试 → 触发「重试中」态（见 HIS-09），完成后刷新并插入新记录。

**验收标准**：
- [x] 再次制作跳 Workbench 制作，prompt/negative/ratio/quality/n 全部预填
- [x] 再次制作不自动发起请求，用户可修改提示词后手动生成
- [x] 失败记录仍可用错误态重试按原参跑，成功后新记录出现在列表顶部
- [x] 预填后可修改再生，原历史记录不变
- [x] 无 provider 或 provider 已删时给出引导（去设置），不静默失败

**测试场景**：
1. 正常：成功记录再次制作 → 跳制作并回填，API 请求数保持 0。
2. 边界：失败记录再次制作 → 参数预填正确、可改；错误态重试仍可用。
3. 异常：原 provider 已删除 → 进入制作并提示重选 Provider。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test -- --run src/features/history/__tests__/refine.test.ts src/features/history/__tests__/store.test.ts src/features/generation/__tests__/params.test.ts` 通过（19/19）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 通过（10/10）
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 通过（162 passed / 6 skipped）

---

### <a id="task-his-09"></a>[TASK-HIS-09] 失败重试 UX（错误码文案 + 「重试中」进度态）

- **状态**：✅ 已完成（2026-08-04：统一错误文案 + 可重试策略 + 列表/详情「重试中」态 + 防重复触发）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-01
- **预估**：M

**目标**：失败记录显示**人话错误文案**（§4.5 映射表，替代裸 error_code），可重试项显 [重试]、不可重试项显对应引导；重试发起后行/详情进入明确「重试中…」进度态（docs/12 §Phase C 5、docs/05 §5）。

**涉及文件**：
- `shared/errors.ts`（扩展旧错误码 alias，复用统一 `errorGuidance`）
- `src/features/history/error.ts`（新增：`historyErrorPresentation(code,message)`，收敛文案/可重试/建议动作）
- `src/features/history/components/HistoryList.tsx` / `HistoryDetail.tsx`（用映射渲染 + 重试中态）
- `src/features/history/store.ts`（补 `retryingIds: Set<string>` + `retry(id)` 包裹 in-flight 状态）

**IPC 契约**：沿用 `image:retry`（docs/07 §3.6）。

**交互与 UI/UX**：见 §4.5 表 + §4.6。重试中：按钮转 spinner + 「重试中…」，禁用重复点击；完成刷新列表；对齐 docs/05 §5「UI 显示重试中」验收。

**验收标准**：
- [x] 失败行/详情显示中文文案而非裸 code（覆盖 §4.5 全部 code）
- [x] 不可重试类（AUTH/余额/内容策略）不显「重试」，显对应引导动作
- [x] 点重试 → 该记录进入「重试中…」态，禁重复点击
- [x] 重试完成后列表刷新（新记录入列或原态更新）
- [x] 未知 code 回退显示原始 message（不吞信息）

**测试场景**：
1. 正常：429 记录 → 显「请求过于频繁」+ [重试] → 重试中 → 完成。
2. 边界：AUTH_FAILED → 无重试，显「去更新 Key」。
3. 异常：重试再次失败 → 更新为新失败态，文案正确。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 通过（含 `history/error.test.ts`、`history/store.test.ts`、`shared/errors.test.ts`）
- [x] Electron e2e 验证文案 + 重试中态（`tests/e2e/test_06_history.py`）

---

### <a id="task-his-10"></a>[TASK-HIS-10] 删除与清理（单条 / 按时间 / 清失败+取消）

- **状态**：✅ 已完成（2026-08-04：顶栏清理菜单 + 二次确认；`db:history:clear` 支持 `before/statuses`，清 30 天前、清失败+取消、清空全部均刷新列表）
- **优先级**：P1
- **所属大功能**：History
- **依赖**：TASK-HIS-01
- **预估**：S

**目标**：补齐清理能力——单条删除（已有）、按时间清（清 30 天前，已有 `before`）、**清除全部失败与取消**（新增按状态清），破坏性操作二次确认。

**涉及文件**：
- `src/features/history/components/`（顶栏「清理▾」菜单）
- `src/features/history/store.ts`（`clear` 扩展 + `clearByStatus`）
- `electron/main/ipc/history.ts`（`HISTORY_CLEAR` 扩展 `statuses?`）

**IPC 契约**（🆕 扩展 `db:history:clear`，向后兼容）：
```ts
// 请求
{ before?: number; statuses?: HistoryStatus[] }  // 二者可组合；空=清全部
// 响应
{ ok: true; deleted: number }
```

**交互与 UI/UX**：见 §4.6 清理菜单。「清空全部」「清失败+取消」需二次确认；清理后列表即时刷新。

**验收标准**：
- [x] 「清除 30 天前」只删早于阈值的记录
- [x] 「清除全部失败与取消」只删 failed+cancelled，保留 success
- [x] 「清空全部」二次确认后清空
- [x] 破坏性项均二次确认，成功后列表刷新

**测试场景**：
1. 正常：混合库清失败+取消 → 只剩 success。
2. 边界：无匹配可清 → 菜单项禁用或提示「无可清理」。
3. 异常：清理中 IPC reject → 错误提示，列表不错乱。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test -- --run electron/main/ipc/__tests__/history-list-sql.test.ts src/features/history/__tests__/store.test.ts` 通过（11/11）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 通过（12/12）
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 通过（164 passed / 6 skipped）
- [x] Electron E2E 验证三种清理、无匹配兜底与失败不破坏列表

---

### <a id="task-his-11"></a>[TASK-HIS-11] 图片文件管理（删源文件 + 磁盘占用感知）

- **状态**：✅ 已完成（2026-08-04：`delete({deleteFile})` 支持删除输出目录源文件；缺失幂等，非输出目录文件保留并提示；`system:diskUsage` 统计图片数/字节并在 History 顶栏展示）
- **优先级**：P2
- **所属大功能**：History
- **依赖**：TASK-HIS-10
- **预估**：M

**目标**：删除记录时可选**同时删磁盘图片**（现状 `delete` 只删 DB 行、留孤儿文件）；提供生成图目录的磁盘占用概览。

**涉及文件**：
- `electron/main/ipc/history.ts`（修改：`HISTORY_DELETE` 支持 `deleteFile` 参数，删行后尝试 `fs.unlink(image_path)`）
- `electron/main/ipc/system.ts` / `electron/system/disk-usage.ts`（🆕 `system:diskUsage` 统计 `~/Pictures/PromptForge/` 占用）
- `src/features/history/components/HistoryDetail.tsx`（「删除记录+源文件」按钮 + 二次确认）
- `src/features/history/components/HistoryDiskUsage.tsx`（图片输出目录占用概览）

**IPC 契约**（🆕）：
```ts
'db:history:delete'  { id: string; deleteFile?: boolean } → { ok: true; deleted: number; fileDeleted?: boolean; fileMissing?: boolean; fileError?: string }  // 扩展现有
'system:diskUsage'   {} → { imagesBytes: number; imagesCount: number; dir: string }  // 新增
```

**交互与 UI/UX**：默认删除只删行（可恢复性：图仍在盘）；「删除+源文件」二次确认「不可恢复」。看板/设置页展示磁盘占用（关联 [16-onboarding-settings-data](16-onboarding-settings-data-deep-dive.md)）。

**验收标准**：
- [x] 默认删除保留磁盘文件；「删除+源文件」真正 unlink
- [x] 删除+源文件有「不可恢复」二次确认
- [x] 文件缺失时 unlink 不报错（幂等）
- [x] 磁盘占用统计准确（字节 + 张数）

**测试场景**：
1. 正常：删除+源文件 → DB 行与 png 都消失。
2. 边界：文件已手动删除 → 删记录不崩。
3. 异常：无权限删文件 → 提示但 DB 行仍删除（或回滚，明确策略）。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test -- --run electron/system/__tests__/disk-usage.test.ts src/features/history/__tests__/store.test.ts electron/main/ipc/__tests__/history-list-sql.test.ts` 通过（15/15）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 通过（13/13，真实 Electron 验证 unlink）
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 通过（165 passed / 6 skipped）

---

### <a id="task-his-12"></a>[TASK-HIS-12] 成本聚合查询 `db:history:stats` 🆕

- **状态**：✅ 已完成（2026-08-04：`db:history:stats` 聚合 total/buckets/byProvider，只统计 success，cost=null 计 0，按本地时区 day/week/month 分桶）
- **优先级**：P2 · V1 差异化关联
- **所属大功能**：History
- **依赖**：TASK-HIS-02
- **预估**：M
- **关联**：[15-differentiators](15-differentiators-deep-dive.md)（成本可控是买断定价的配套价值）

**目标**：新增服务端聚合查询，从 history 累计成本 + 按维度分组（按日/周/月、按 Provider），供成本看板消费。**只统计 `success`**（失败/取消不计费）。

**涉及文件**：
- `electron/main/ipc/history.ts`（🆕 `HISTORY_STATS` handler，SQL 聚合）
- `shared/types/ipc.ts`（补通道常量 + `window.api.history.stats` 签名）
- `shared/types/models.ts`（补 `HistoryStats` 类型）

**IPC 契约**（🆕 新增 `db:history:stats`）：
```ts
// 请求
{ from?: number; to?: number; groupBy: 'day' | 'week' | 'month'; providerId?: string }
// 响应
interface HistoryStats {
  totalCost: number;        // 分，仅 success
  totalCount: number;       // 成功张数
  avgCost: number;          // 分/张
  buckets: { key: string; cost: number; count: number }[];     // 按 groupBy
  byProvider: { providerId: string; name: string; cost: number; count: number }[];
}
```
SQL 要点：`WHERE status='success'` + 时间区间；分组用 `strftime` 对 `created_at`（注意 created_at 为毫秒 ms，需 `/1000` 转秒再 `strftime`）。

**验收标准**：
- [x] 只累计 success 的 cost（failed/cancelled 不计入）
- [x] 按 day/week/month 分桶正确（本地时区）
- [x] 按 Provider 分组带 name（join providers 或前端映射）
- [x] cost 为 null 的成功记录按 0 计（不 NaN）
- [x] 几千条量级查询 < 50ms（SQL 单次聚合，无前端拉全量）

**测试场景**：
1. 正常：跨月数据按月分桶合计 = 总额。
2. 边界：全 cost=null → totalCost=0，不 NaN。
3. 异常：无 success 记录 → 返回零值结构（非 null）。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test -- --run electron/main/ipc/__tests__/history-list-sql.test.ts` 通过（9/9）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q` 通过（14/14）
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 通过（166 passed, 6 skipped）

---

### <a id="task-his-13"></a>[TASK-HIS-13] 单价配置（每 Provider · 每图/每千 token）

- **状态**：✅ 已完成（2026-08-04：Provider 编辑弹窗接「计费单价」；`settings:pricing:*` 存 electron-store `pricing.{providerId}`；OpenAI 兼容生图按 per-image / per-1k-token 写 `history.cost`，未配或 token usage 缺失记 null）
- **优先级**：P2
- **所属大功能**：History
- **依赖**：无
- **预估**：M
- **关联**：[16-onboarding-settings-data](16-onboarding-settings-data-deep-dive.md)（**单价配置落在设置页**）、[12-generation](12-generation-deep-dive.md)（生图时按单价写 cost）

**目标**：让用户为每个 Provider 配单价（每张图 或 每千 token），生图时用它估算 `history.cost`。**成本看板的口径来源**。

**单价配置存放位置（决策）**：
- 存于 **electron-store**（非 DB），键 `pricing.{providerId}`，与密钥同机制不同命名空间（keychain 用 `keys.*`，见 `electron/security/keychain.ts` 已用 electron-store）。理由：属用户偏好/可导出配置，不是核心资产数据；避免为纯配置加 DB 迁移。
- **配置入口在设置页**（Provider 编辑区扩展一栏「计费单价」），归 [16-onboarding-settings-data](16-onboarding-settings-data-deep-dive.md) 落地；本卡负责 IPC + 估算接入。

**涉及文件**：
- `electron/main/ipc/settings.ts`（🆕 `settings:pricing:*` 读写 IPC）
- `electron/settings/pricing.ts` / `shared/pricing.ts`（🆕 electron-store `pricing.{providerId}` + 单价校验/估算）
- `electron/providers/openai-compatible.ts`（修改：生图后按单价 × n（或 usage token）算 `cost`；无配置返回 null 口径）
- `src/features/generation/components/ProviderDialog.tsx`（Provider 编辑区新增「计费单价」控件）
- `src/features/history/components/HistoryList.tsx` / `HistoryDetail.tsx`（cost=null 成功记录提示「未配单价」）

**IPC 契约**（🆕 新增 `settings:pricing:*`）：
```ts
'settings:pricing:get'  { providerId: string } → { mode: 'per-image' | 'per-1k-token'; unitCents: number } | null
'settings:pricing:set'  { providerId: string; mode; unitCents } → { ok: true; pricing }
'settings:pricing:delete' providerId → { ok: true }  // 清除该 Provider 单价
```

**验收标准**：
- [x] 每 Provider 可设「每图」或「每千 token」单价（分）
- [x] 生图成功后 history.cost 按单价估算写入
- [x] 单价存 electron-store（`pricing.{id}`），不入 DB
- [x] 未配单价的 Provider cost 记 null（看板按 0，且提示「未配单价」）

**测试场景**：
1. 正常：设每图 ¥0.32 → 生 1 张 cost=32 分。
2. 边界：每千 token 模式 + usage 缺失 → cost=null 不崩。
3. 异常：单价填负数/非数 → 校验拦截。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test -- --run shared/__tests__/pricing.test.ts src/features/history/__tests__/format.test.ts` 通过（11/11）
- [x] `npm run build` 通过
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_04_generate.py::test_provider_pricing_ui_and_history_cost -q` 通过（1/1）
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_04_generate.py -q` 通过（22 passed, 1 skipped）
- [x] `.venv-test/bin/python -m pytest tests/e2e -q` 通过（167 passed, 6 skipped）

---

### <a id="task-his-14"></a>[TASK-HIS-14] 成本看板 UI（已被 V2 使用统计替代）

- **状态**：↪ V1 已完成；V2 已迁移到设置 / 使用统计，History 入口与 `CostDashboard.tsx` 已删除
- **优先级**：P2 · V1 差异化
- **所属大功能**：History
- **依赖**：TASK-HIS-12, TASK-HIS-13
- **预估**：M

**V2 目标**：由固定设置导航进入“使用统计”，展示累计生成、成功率、活跃天数、账号积分、53 周热力图、多渠道趋势、模型分布和渠道明细。

**涉及文件**：
- `src/features/settings/components/UsageStatisticsSection.tsx`
- `src/features/settings/UsageStatisticsCharts.tsx`
- `src/pages/HistoryPage.tsx`（不再含累计成本入口）
- `tests/e2e/test_06_history.py`、`test_39_usage_statistics_v2_desktop.py`

**IPC 契约**：消费 `db:history:stats`（TASK-HIS-12）。

**交互与 UI/UX**：见 `docs/v2.0/ui-design/06-settings-and-integrations.md` §28。

**验收标准**：
- [x] 五项摘要、53 周热力图、趋势、模型和渠道明细与 stats 一致
- [x] 近 7/30/90 日与累计切换重新聚合
- [x] 账号、豆包和各自建 Provider 分渠道展示
- [x] 仅账号成功记录汇总积分，非账号渠道固定显示“不计积分”
- [x] 趋势、模型和渠道均覆盖空态

**测试场景**：
1. 正常：三个渠道、多个模型 → 摘要与趋势正确。
2. 边界：自建 Provider 存在 cost → 仍不计入账号积分。
3. 异常：无成功记录 → 分区空态保持稳定几何。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm run check` 通过（30 个 Vitest 文件 / 216 测试 + build）
- [x] `.venv-test/bin/python -m pytest tests/e2e/test_06_history.py -q --basetemp /tmp/promptforge-his14-history` 通过（16 passed）

---

## 6. 依赖关系图

```
HIS-01(列表精修/store) ─┬─→ HIS-02(筛选栏) ──────────→ HIS-12(成本聚合 stats)
                        ├─→ HIS-03(详情面板) ─┬─→ HIS-04(灯箱)
                        │                     ├─→ HIS-05(打开文件夹/复制路径)
                        │                     ├─→ HIS-06(回填 Composer) ──关联→ 11-composer
                        │                     ├─→ HIS-07(另存为 Prompt) ──关联→ 10-library
                        │                     └─→ HIS-08(再次制作/失败重试) ─关联→ 12-generation
                        ├─→ HIS-09(失败重试 UX)
                        └─→ HIS-10(删除与清理) ─→ HIS-11(图片文件管理)

HIS-13(单价配置) ──关联→ 16-onboarding-settings-data / 12-generation
HIS-12(stats) + HIS-13(单价) ─→ HIS-14(成本看板 UI) ──关联→ 15-differentiators

批次建议：
  P1 先做  HIS-01 → 02/03 → 04/05/06/07/08/09 → 10   （结果专业化闭环）
  P2 后做  HIS-11 · HIS-13 → HIS-12 → HIS-14           （文件管理 + 成本账本）
```

## 7. 大功能验收（对照 docs/05 §9 + docs/12 §Phase C + 本设计扩展）

**P1 · 结果专业化闭环**
- [x] 列表三态（成功/失败/取消）图标颜色正确，取消不再误报为失败（HIS-01）
- [x] 空态文案对齐融合双入口「去 Generate 或 Chat 试试」（HIS-01）
- [x] 筛选栏：状态 + 日期范围 + Provider 组合筛选（HIS-02）
- [x] 右栏详情：大图 + 完整提示词 + 全参数 + 错误信息 + 来源反查（HIS-03）
- [x] 大图灯箱可缩放/翻页（HIS-04）
- [x] 打开所在文件夹（reveal）+ 复制路径（HIS-05）
- [x] 回填 Composer：历史→画布深化（HIS-06）
- [x] 另存为 Prompt：历史→库（HIS-07）
- [x] 再次制作（回填 Workbench）+ 失败重试（HIS-08）
- [x] 失败重试：中文错误文案 + 「重试中」进度态（HIS-09）
- [x] 删除单条 / 按时间清 / 清失败+取消（HIS-10）

**P2 · 文件管理 + 成本账本（差异化关联）**
- [x] 删源文件选项 + 磁盘占用感知（HIS-11）
- [x] 成本聚合查询 `db:history:stats`，仅计 success（HIS-12）
- [x] 每 Provider 单价配置（electron-store，入口在设置页）（HIS-13）
- [x] 成本看板：累计/张数/均价 + 按日周月 + 按 Provider + 口径说明（HIS-14）

**契约与安全**
- [x] 图片显示统一走 `media://`（非 file://，见 memory「media:// protocol images」）
- [x] 新增/扩展 IPC（`db:history:list` 扩展、`db:history:clear` 扩展、`db:history:stats` 🆕、`db:history:delete` 扩展、`system:diskUsage` 🆕、`settings:pricing:*` 🆕）均在 `shared/types/ipc.ts` 代码化并做入参校验
- [x] 成本口径明确标注「本地估算，非真实账单」，不做任何联网对账
