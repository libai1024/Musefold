# 10 · 提示词库 Library —— Deep Dive

> **大功能定位**：核心生产力主路径的**起点与归宿**。落地页。最高频动作：找 / 改 / 生成 / 沉淀。
> **本文是全文档集的格式范例**——其余 deep-dive 遵循相同结构（需求→小功能→UI/UX→任务卡）。
> 引用：`docs/03-prompt-library.md`（工程规格）、`docs/02`（schema）、`docs/07`（IPC 契约）。

> **任务卡状态回写**：2026-08-04 · 基于源码实读 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

> **当前入口约定（2026-08-04）**：Library 的“生成图像”统一调用 Workbench `openDraft({ mode: 'produce' })`，进入制作模式并保留 Prompt 来源；不得新增直接挂载旧 GeneratePanel 的入口。

> **最新实现契约（2026-08-06）**：Library 默认列表优先，网格仅作为可选视图；提示词条目使用实色、细边框、低装饰样式，不使用玻璃、渐变、强阴影或选中态左侧强调条。右侧检视栏固定约 320px，提供「详情 / 作品」分栏；「查看作品」会直接选中条目并打开作品分栏。作品来自 `history.prompt_id`、`history_prompt_references` 或提示词稳定的 `history://` 保存来源，成功图片默认展示，可切换失败/取消记录。作品缩略图复用 `ImageLightbox`，失效路径进入错误态而不是破坏布局。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为高频创作者，我要**在一处集中存放所有提示词**，随手能找到上次那条「电影感人像」。
- 作为提示词玩家，我要给一条 prompt 打**多个维度标签**（二次元 + 头像 + Flux），而不是塞进唯一文件夹。
- 作为中转站用户，我要**收藏几条常用配方置顶**，一键复制正文去生图。
- 作为长期用户，我误删了一条，要能**撤销/回收站恢复**。
- 我要**边搜边筛**（搜「赛博」+ 筛「壁纸」标签 + 筛「Flux」模型），结果实时收敛。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| PromptBox：变量模板 + 文件夹 | 双轨组织 | 我们更进一步做完整组合引擎（Composer） |
| AIPRM：话题/语气选择器筛选 | 多维筛选心智 | 用标签组 + 筛选栏实现 |
| Eagle/Pixcall（素材管理）：网格 + 侧栏检视 + 拖拽归类 | **网格/列表双视图 + 右侧检视 + 拖拽** | 提示词以文本为主，卡片需展示正文预览 |
| Notion：数据库多视图 | 排序/筛选组合 | 克制，不做全功能数据库 |

**结论**：Library = **「素材管理器的组织力」× 「提示词的文本特性」**。组织用双轨制（文件夹管位置 + 标签管维度 + 收藏管常用），呈现用卡片列表（正文预览 + 标签 + 缩略图），检视用右栏。

---

## 2. 现状对照（设计 vs 实现）

> 依据 `docs/12` §1.3、§2、§3。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增

| 小功能 | 设计要求 | 现状 | 结论 |
|--------|----------|------|------|
| prompts CRUD 后端 | repository + IPC | ✅ 齐全 | 达标 |
| FTS5 中文搜索 | JS 侧汉字/词分词 | 🟡 写入与查询端同源 | 已收口 |
| 列表虚拟化 | @tanstack/react-virtual | ✅ 已用 | 达标 |
| 收藏 pin | is_pinned + pin_order | 🟡 IPC 有，UI 弱 | 补 UI |
| 文件夹管理 | CRUD + 拖拽归类 | 🔴 FolderTree 只读筛选，无新建/重命名/删除/拖拽 | **P0 缺口** |
| Prompt 删除 | 软删 + 回收站 | 🔴 store 无 delete 封装 | **P0 缺口** |
| 编辑完整字段 | negative/rating/tags 全保存 | 🟡 部分 | 补齐 |
| store actions | update/delete/togglePin | 🔴 缺 | **P0 缺口** |
| 右侧检视详情 | 选中项详情/预览/编辑入口 | 🟡 待确认 | 补齐 |
| 多条件筛选栏 | 模型/文件夹/收藏/时间/评分/次数 | 🔴 FilterBar 未见 | 🆕 |
| 拖拽归类 | 卡片拖到文件夹 | 🔴 | 🆕 |
| 批量操作 | 多选批量打标签/移动/删除 | 🔴 | 🆕 |

**一句话**：**后端接近达标，前端管理闭环严重缺失（文件夹/删除/拖拽/筛选栏）。这是 P0 主战场。**

---

## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | 提示词 CRUD 闭环（新建/编辑/软删/复制） | P0 | [TASK-LIB-01](#task-lib-01) |
| 2 | store 完整 actions（update/delete/togglePin/copy） | P0 | [TASK-LIB-02](#task-lib-02) |
| 3 | 文件夹管理（新建/重命名/删除/重排，≤2 层） | P0 | [TASK-LIB-03](#task-lib-03) |
| 4 | 收藏置顶区（pin 区 + 拖拽重排） | P1 | [TASK-LIB-04](#task-lib-04) |
| 5 | 即时搜索 + 中文分词查询端验证 | P0 | [TASK-LIB-05](#task-lib-05) |
| 6 | 标签云筛选（按组分组 + 多选 AND） | P1 | [TASK-LIB-06](#task-lib-06) |
| 7 | 多条件筛选栏（模型/文件夹/收藏/评分/时间/次数） | P1 | [TASK-LIB-07](#task-lib-07) |
| 8 | 排序（updated/created/title/rating/usage） | P1 | [TASK-LIB-08](#task-lib-08) |
| 9 | 右侧检视详情面板（详情/预览/编辑/生成入口） | P0 | [TASK-LIB-09](#task-lib-09) |
| 10 | 拖拽归类（卡片→文件夹） | P1 | [TASK-LIB-10](#task-lib-10) |
| 11 | 标签管理（增删标签/组、分配到 prompt） | P1 | [TASK-LIB-11](#task-lib-11) |
| 12 | 回收站（软删列表 + 恢复 + 彻底删除） | P1 | [TASK-LIB-12](#task-lib-12) |
| 13 | 批量操作（多选 + 批量标签/移动/删除） | P2 | [TASK-LIB-13](#task-lib-13) |
| 14 | 列表/网格双视图 + 卡片密度 | P2 | [TASK-LIB-14](#task-lib-14) |
| 15 | seed 文件夹 + 首启空态引导 | P1 | [TASK-LIB-15](#task-lib-15) |

---

## 4. UI/UX 设计

### 4.1 页面布局（LibraryPage）

```
┌─ Sidebar(240) ─┬─ 主区 ───────────────────────────┬─ 检视(320,可折叠) ─┐
│ ┌───────────┐  │ ┌ 顶栏 ────────────────────────┐ │ ┌───────────────┐  │
│ │ 📁 文件夹  │  │ │ [🔍 搜索…]  [排序▾] [＋新建]  │ │ │  选中 Prompt   │  │
│ │  ├ 全部     │  │ │ [筛选栏: 模型▾ 收藏◯ 评分▾ ⌫] │ │ │  标题          │  │
│ │  ├ 二次元   │  │ └──────────────────────────────┘ │ │  正文预览      │  │
│ │  │  └ 日系  │  │ ┌ 📌 置顶区 ───────────────────┐ │ │  ─────────    │  │
│ │  └ 写实     │  │ │ [card] [card] [card]         │ │ │  负面          │  │
│ │            │  │ ├──────────────────────────────┤ │ │  标签 · 模型   │  │
│ │ 🏷 标签云  │  │ │ 普通列表（虚拟化）             │ │ │  评分 ★★★★☆   │  │
│ │  风格: ...  │  │ │ [card ────────────────────]  │ │ │  ─────────    │  │
│ │  场景: ...  │  │ │ [card ────────────────────]  │ │ │ [编辑][复制]   │  │
│ │  模型: ...  │  │ │ [card ────────────────────]  │ │ │ [⚡生成图像]   │  │
│ └───────────┘  │ └──────────────────────────────┘ │ └───────────────┘  │
└────────────────┴───────────────────────────────────┴────────────────────┘
```

### 4.2 PromptCard（列表项）

```
┌────────────────────────────────────────────────────────────┐
│ 电影感人像                         ☆  ⋮                    │  ← 标题/收藏/更多
│ cinematic portrait, soft natural light, ...                  │  ← 正文预览，最多两行
│ Flux · 人像 · #日系 · ★★★★☆ · 用过 12 次 · 2026-08-06     │  ← 单行元信息
└────────────────────────────────────────────────────────────┘
   hover/focus: 显示 [复制][查看作品][更多] 图标操作
```

- 列表是默认视图；舒适密度最小高度约 104px、间距 6px，紧凑密度最小高度约 88px、间距 4px。
- 正文直接呈现为自然文本预览，不再套“代码块式”灰色内嵌框；描述字段主要放在右侧详情栏。
- 普通条目使用 `bg-elevated` 或同等实色背景、细边框和中等圆角；悬停只提升背景/边框对比度，选中使用浅色背景与 accent 边框，不增加左侧竖条。
- 网格是作品浏览模式：内容区宽度至少 520px 时固定两列，低于该阈值降为一列；不随超宽窗口继续增加列数。
- 每张网格卡优先显示最多 4 张已关联成功作品：1 张为单幅、2 张左右并排、3 张主图加两张副图、4 张为 2×2 拼贴。每张缩略图都是键盘可操作按钮，点击直接打开 Lightbox 并可左右切换；右下角显示完整作品数量，点击数量进入该提示词的作品分栏。
- 没有关联作品时才回退到提示词封面，并标注「提示词封面」；封面也不存在时显示平面正文预览。封面路径本身不构成作品关联。

### 4.3 关键交互与状态

| 场景 | 行为 |
|------|------|
| 搜索输入 | 150ms 防抖 → FTS5 → 列表更新；搜索词高亮命中 |
| 标签点击 | 多选 AND，与搜索/筛选叠加；再点取消 |
| 卡片单击 | 右侧检视显示详情（不进编辑） |
| 查看作品 | 选中卡片、展开检视栏并切换到「作品」分栏；无作品也保留该空态分栏 |
| 作品分栏 | 默认查询成功记录；切换「查看全部生成记录」后追加失败/取消状态行 |
| 作品关联 | 覆盖直接来源、引用快照、由作品保存和明确的历史血缘；不做提示词文本模糊匹配 |
| 卡片双击 / 编辑 | 打开 PromptEditor（对话框/抽屉） |
| 星标点击 | togglePin，卡片动效移入/出置顶区 |
| 复制正文 | 写剪贴板 + `usage_count++` + toast「已复制」 |
| 拖卡到文件夹 | 更新 folder_id，源文件夹/目标计数刷新 |
| 右键卡片 | 菜单：编辑/复制/移动到/打标签/收藏/删除 |
| 删除 | 确认 → 软删 → toast「已删除，撤销」（5s 内可撤销） |
| **空态** | 无 prompt：图标 + 「还没有提示词」+ [新建] + [去 Chat 试试]；搜索无果：「没有匹配，试试清除筛选」 |
| **加载态** | 列表骨架屏（3-5 条占位） |
| **错误态** | 顶部 inline 错误条 + 重试按钮 |

### 4.4 PromptEditor（新建/编辑表单）

```
┌ 编辑提示词 ──────────────────────── ✕ ┐
│ 标题*        [_______________________] │  ← 必填，zod 校验
│ 正文*        [                       ] │  ← 必填，多行，等宽字体
│              [                       ] │
│ 负面提示词   [                       ] │  ← 可选（target 感知显隐）
│ 描述         [_______________________] │
│ 文件夹       [选择…▾]   模型 [选择…▾]  │
│ 标签         [#二次元 ✕][#头像 ✕][＋]  │  ← 标签选择器
│ 评分         ★★★★☆                    │
│ ───────────────────────────────────── │
│                    [取消]  [保存 ⌘S]   │
└────────────────────────────────────────┘
```

- 校验：title + content 必填，失败时字段下红字提示，保存按钮禁用。
- 未保存关闭：脏检查 → 「放弃更改？」确认。
- 编辑保存后更新 `updated_at`，列表即时刷新并保持选中。

---

---

## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。

### <a id="task-lib-01"></a>[TASK-LIB-01] 提示词 CRUD 闭环

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Library
- **依赖**：无（后端 repository/IPC 已存在，本卡补前端闭环）
- **预估**：L

**目标**：用户能在 Library 完成新建 / 编辑 / 软删 / 复制正文全流程，操作后列表即时同步。

**涉及文件**：
- `src/features/library/components/PromptEditor.tsx`（修改：补齐 negative/rating/tags/folder/model 全字段保存 + zod 校验 + 脏检查）
- `src/features/library/components/PromptCard.tsx`（修改：菜单接删除/复制/编辑）
- `src/features/library/store.ts`（依赖 TASK-LIB-02 的 actions）
- `src/pages/LibraryPage.tsx`（修改：新建按钮 + 编辑器挂载）

**IPC 契约**（已存在，见 docs/07 §3.1）：`db:prompts:create/update/delete/incrementUsage`。

**交互与 UI/UX**：见 §4.4。校验失败字段红字；删除走软删 + 5s 撤销 toast；复制正文 `usage_count++`。

**验收标准**：
- [x] 新建：title+content 必填校验生效，保存后列表顶部即时出现新条目
- [x] 编辑：预填所有字段，保存后 `updated_at` 更新、列表刷新、保持选中
- [x] 软删：`deleted_at` 置值，列表即时移除，toast 提供 5s 内「撤销」
- [x] 复制正文：写入剪贴板，`usage_count++`，toast 反馈
- [x] 未保存关闭编辑器弹出脏检查确认

**测试场景**：
1. 正常：新建一条含标签+负面+评分的 prompt → 列表出现 → 编辑改标题 → 刷新正确。
2. 边界：标题留空 → 保存禁用 + 红字；超长正文（>5000 字）不崩、正常保存。
3. 异常：IPC reject（模拟 DB 错误）→ 顶部错误条 + 不清空表单。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Electron E2E 验证新建/编辑/删除/复制四条路径

---

### <a id="task-lib-02"></a>[TASK-LIB-02] Library store 完整 actions

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Library
- **依赖**：无
- **预估**：M

**目标**：`library/store.ts` 提供业务组件所需的全部 action，统一走 `window.api.prompt.*`，成功后本地状态同步（immer 更新，不整表重拉）。

**涉及文件**：
- `src/features/library/store.ts`（修改/补齐）

**需提供的 actions**（zustand + immer）：
- `fetchList(query)` · `create(newPrompt)` · `update(id, patch)` · `remove(id)`（软删）· `togglePin(id, pinned)` · `reorderPins(ids)` · `copyContent(id)`（incrementUsage + 剪贴板）· `setSearchQuery` · `toggleTag(id)` · `setFilters(patch)` · `setSort(sort)` · `select(id)`
- 状态：`prompts`、`loading`、`error`、`searchQuery`、`selectedTagIds`、`selectedFolderId`、`filters`、`sort`、`selectedId`

**验收标准**：
- [x] 每个 action 调用对应 IPC，失败时 set `error` 且不破坏现有列表
- [x] create/update/remove/togglePin 后本地状态即时反映，无需手动 refetch
- [x] 乐观更新失败时回滚（至少 remove/togglePin）
- [x] 搜索/标签/筛选/排序变更触发防抖 fetch（150ms）

**测试场景**：
1. 正常：连续 create 3 条，列表长度正确、顺序符合 sort。
2. 边界：快速连点 togglePin，不出现状态错乱。
3. 异常：remove IPC reject → 列表回滚 + error 提示。

**质量门禁**：
- [x] `npm run typecheck` 通过

---

### <a id="task-lib-03"></a>[TASK-LIB-03] 文件夹管理（≤2 层）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Library
- **依赖**：无（IPC `db:folders:*` 已存在）
- **预估**：L

**目标**：FolderTree 从「只读筛选」升级为可管理：新建 / 重命名 / 删除 / 重排，强制第 2 层不能再建子级。

**涉及文件**：
- `src/features/library/components/FolderTree.tsx`（修改：react-arborist 增删改 + 右键菜单）
- `src/features/library/store.ts`（补 folder actions）

**IPC 契约**（docs/07 §3.2）：`db:folders:list/create/update/delete/reorder`。删除时子 prompt 的 `folder_id` 置空（DB `ON DELETE SET NULL`）。

**交互**：
- 侧栏顶「＋ 新建文件夹」；节点右键：重命名/删除/新建子文件夹（仅 1 层可见此项）。
- 第 2 层节点右键**不含**「新建子文件夹」（应用层约束）。
- 删除确认文案：「删除文件夹？其中的提示词不会被删除，会移到『全部』。」
- 拖拽重排 sort_order；节点显示计数徽标。

**验收标准**：
- [x] 新建/重命名/删除/重排均生效并持久化
- [x] 无法在第 2 层创建第 3 层（UI 层拦截）
- [x] 删除文件夹后其内 prompt 的 folder_id 变 null，仍在「全部」可见
- [x] 文件夹计数徽标准确（该文件夹下未删除 prompt 数）

**测试场景**：
1. 正常：建「二次元」→ 建子「日系」→ 拖 3 条进去 → 计数=3。
2. 边界：选中「日系」右键，无「新建子文件夹」项。
3. 异常：删除含 20 条的文件夹 → prompt 全部保留、folder_id 清空。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Electron E2E 验证增删改与深度限制；重排链路由 `reorderFolders` IPC/store 覆盖

---

### <a id="task-lib-04"></a>[TASK-LIB-04] 收藏置顶区

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Library
- **依赖**：TASK-LIB-02
- **预估**：M

**目标**：`is_pinned=1` 的 prompt 集中显示在列表顶部「置顶区」，可拖拽重排 `pin_order`，与普通列表视觉分隔。

**涉及文件**：
- `src/features/library/components/PromptList.tsx`（修改：拆置顶区 + 普通区）
- `src/features/library/store.ts`（togglePin/reorderPins）

**IPC**：`db:prompts:togglePin`、`db:prompts:reorderPins`。

**验收标准**：
- [x] 点星标 → 卡片移入置顶区顶部
- [x] 置顶区内拖拽重排持久化 `pin_order`
- [x] 取消收藏 → 回到普通列表原排序位置
- [x] 置顶区与普通区有清晰视觉分隔（标题「置顶」+ 分割线）

**测试场景**：
1. 正常：收藏 3 条 → 置顶区 3 条 → 拖动重排 → 刷新后顺序保持。
2. 边界：0 条收藏时置顶区隐藏（不显示空标题）。
3. 异常：reorder IPC 失败 → 顺序回滚。

**质量门禁**：`npm run typecheck` + preview。

---

### <a id="task-lib-05"></a>[TASK-LIB-05] 即时搜索 + 中文分词查询端验证

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Library
- **依赖**：无
- **预估**：M

**目标**：搜索框 150ms 防抖即时搜，覆盖标题/描述/正文/标签名；**验证并修复中文查询端分词**（写入与查询端需同源处理，否则「赛博朋克」搜不中）。

**涉及文件**：
- `src/features/library/components/SearchBar.tsx`、`hooks/useDebounce.ts`
- `electron/db/fts.ts`、`electron/db/repositories/prompts.ts`（查询端：对用户输入同样按 JS 侧分词后构造 MATCH 查询）

**IPC**：`db:prompts:list` 带 `search`。

**验收标准**：
- [x] 输入 150ms 后出结果，命中项标题/正文高亮
- [x] **中文分词对称**：写入「赛博朋克城市」后，搜「赛博」「朋克」「城市」均命中
- [x] 英文搜索命中（大小写不敏感）
- [x] 搜索 <50ms（几百条量级）
- [x] 特殊字符（FTS5 保留符 `"` `*` `(`）不导致查询报错（做转义/清洗）

**测试场景**：
1. 正常：中英混合库，中文词、英文词分别命中。
2. 边界：空搜索返回全部；单字符搜索有结果。
3. 异常：输入 `"unbalanced` 引号 → 不崩、回退安全查询。

**质量门禁**：`npm run typecheck` + 若可加 fts 查询单测则加。

---

### <a id="task-lib-06"></a>[TASK-LIB-06] 标签云筛选

- **状态**：✅ 已完成
- **优先级**：P1 · **依赖**：TASK-LIB-02 · **预估**：M · **所属**：Library

**目标**：侧栏标签云按「标签组」分组展示，多选 AND，与搜索/筛选叠加。

**涉及文件**：`src/features/library/components/TagCloud.tsx`、`store.ts`（toggleTag）。
**IPC**：`db:tags:list`；`db:prompts:list` 带 `tagIds`。

**验收标准**：
- [x] 标签按 5 组（风格/场景/模型/主体/画质）分组渲染
- [x] 多选为 AND 交集（选「二次元」+「头像」= 同时含两者）
- [x] 选中标签高亮，再点取消；与搜索词叠加生效
- [x] 每标签显示引用计数

**测试场景**：正常（两标签交集）；边界（选了标签但无交集 → 空态）；异常（标签被删后筛选自动移除）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-07"></a>[TASK-LIB-07] 多条件筛选栏 🆕

- **状态**：✅ 已完成
- **优先级**：P1 · **依赖**：TASK-LIB-02 · **预估**：M · **所属**：Library

**目标**：主区顶部 FilterBar，支持模型（单选）/收藏状态（开关）/评分（≥N★）/创建时间段/使用次数（≥N）多条件组合，与搜索+标签叠加，一键清空。

**涉及文件**：`src/features/library/components/FilterBar.tsx`（新建）、`store.ts`（filters）、`repositories/prompts.ts`（list 支持 filters）。
**IPC**：扩展 `db:prompts:list` 的 `filters` 字段（docs/07 §3.1 已预留 `filters?`）。

**验收标准**：
- [x] 6 个维度筛选可组合，结果为 AND 交集
- [x] 「清空筛选」重置全部条件（含搜索与标签）
- [x] 筛选生效时显示「已筛选 N 项」+ 活跃筛选 chip
- [x] 筛选条件与列表状态一致（本地 store 保持；刷新后按当前默认查询重载）

**测试场景**：正常（模型+收藏+评分三条件）；边界（无匹配空态）；异常（时间段倒置自动纠正）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-08"></a>[TASK-LIB-08] 排序

- **状态**：✅ 已完成 · **优先级**：P1 · **依赖**：TASK-LIB-02 · **预估**：S · **所属**：Library

**目标**：排序下拉：更新时间(默认)/创建时间/标题/评分/使用次数，升降序切换。

**涉及文件**：`src/pages/LibraryPage.tsx` 顶栏、`store.ts`、`repositories/prompts.ts`。

**验收标准**：
- [x] 5 种排序切换正确，置顶区始终在最上（不受排序影响其位置，仅普通区排序）
- [x] 升/降序可切换
- [x] 排序偏好在会话内保持

**测试场景**：正常（各排序核对顺序）；边界（同值稳定排序）；异常（评分全 0 时按次级键排序）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-09"></a>[TASK-LIB-09] 右侧检视详情面板

- **状态**：✅ 已完成 · **优先级**：P0 · **依赖**：TASK-LIB-02 · **预估**：M · **所属**：Library

**目标**：选中 prompt 时右栏显示「详情 / 作品」两栏。详情保留标题、正文、负面、标签、模型、评分、预览图和元数据，并提供 [编辑][复制正文][⚡生成图像][在画布打开🆕]；作品栏快速回看直接基于该提示词或引用该提示词产生的历史图片——**这是主路径「Library→Generate→History」的关键连接点**。

**涉及文件**：`src/features/library/components/`（新建 PromptDetail.tsx 或复用检视栏）、`src/components/layout/AppShell.tsx`（右栏挂载）。
**关联**：[12-generation](12-generation-deep-dive.md)（生成入口）、[11-composer](11-composer-deep-dive.md)（在画布打开）。

**验收标准**：
- [x] 单击卡片 → 右栏详情（不进编辑态）
- [x] 「生成图像」→ 用该 prompt 打开 Generate 制作模式并预填正文/负面/参数
- [x] 「复制正文」usage_count++ + toast
- [x] 「在画布打开」→ 进 Composer 以此 prompt 为初始 body
- [x] 检视栏可折叠，折叠态列表占满
- [x] 详情/作品分栏可切换，作品数量显示成功记录总数
- [x] 「查看作品」图标操作直接打开作品分栏；成功、失败、取消状态和图片失效均有稳定空态/错误态
- [x] 缩略图复用 `ImageLightbox`，支持原有保存、复制路径、打开目录、缩放和前后切换能力

**测试场景**：正常（选中→生成→回到 Library 保持选中）；边界（无预览图时占位）；异常（生成入口在未配 Provider 时引导去设置）。
**质量门禁**：typecheck + preview。

**实现回写（2026-08-06）**：新增 `PromptWorksPanel.tsx`、`history.related` IPC 和 `history_prompt_references` 关系表。作品查询使用直接来源或 `EXISTS` 引用关系，默认 `status='success'`，详情栏切换到作品时按 prompt id 分页查询；失败/取消记录仅在“查看全部”时展示为紧凑状态行。

**关联稳定性补充（2026-08-06）**：作品面板现在会展示关联原因：`直接制作`、`引用整条`、`引用选段`、`由作品保存`。Workbench 和 History 的「存为提示词」会显式调用 `db:history:linkPrompt`，把本次成功回合关联到新提示词，并将第一张成功图片保存为稳定的 `history://<historyId>` 来源；不再依赖图片路径或提示词文本推断。旧数据通过 migration `0010_backfill_saved_prompt_history` 做一次严格回填：仅接受成功、有图片、未归属其他提示词、正向正文完全一致、负向正文规范化后一致，并且在生成后 10 分钟内保存的手动提示词；不满足条件的记录不会被“猜测关联”。

当主进程尚未升级到 DB v10 或没有 `history.related` handler 时，前端不再显示误导性的「0 条生成记录」或原始 Electron 错误，而是隐藏错误并显示「作品索引暂时不可用」；兼容回退只查询 `history.prompt_id` 的直接来源，并明确提示重启应用建立完整索引。新安装和升级后的 DB 版本为 10。

#### 关联判定表

| 场景 | 是否关联 | 稳定证据 |
|------|----------|----------|
| 从 Library 某条提示词进入制作后提交 | 是 | 请求携带 `promptId`，主进程写入 `history.prompt_id` |
| 制作模式引用整条或选段 | 是 | 主进程写入 `history_prompt_references`，保存 prompt id、标题、正文和 scope 快照 |
| Workbench/History 将已有回合存为提示词 | 是 | `history.linkPrompt` 显式回写该回合所有已落库历史；封面只取第一张成功图，并保存 `history://<historyId>` 来源 |
| History 原记录重试 | 是 | 重试请求复制原 `prompt_id` 和引用快照 |
| History「再次制作」、回合「继续探索 / 采用此方向制作」 | 是，有明确原 prompt 时 | `GenerationSource` 同时保留 parent history id 与 prompt id 血缘，新请求继续写入该 `prompt_id` |
| 手工输入与某条提示词文字相同 | 否 | 没有稳定来源 ID，禁止文本猜测 |
| 只给提示词设置封面/预览图 | 否 | `preview_image_path` 仅是展示资源，不是历史关系 |
| 从 Composer 进入但没有原 prompt id | 否 | 只保留 composition 来源，不擅自归属到某条提示词 |
| 旧记录不满足 migration 0010 的精确窗口 | 否 | 无法证明来源，宁可保持未关联 |

提示词软删除不删除历史和引用快照；提示词彻底删除后引用表中的 `prompt_id` 置空但标题/正文快照仍保留。由于原提示词已不存在，这些快照不会再出现在某个活动提示词的作品相册中，但历史详情和导出仍可还原当时引用内容。

---

### <a id="task-lib-10"></a>[TASK-LIB-10] 拖拽归类

- **状态**：✅ 已完成 · **优先级**：P1 · **依赖**：TASK-LIB-03 · **预估**：M · **所属**：Library

**目标**：卡片拖到侧栏文件夹 → 更新 folder_id；拖拽视觉反馈（拖起半透明、目标高亮）。

**涉及文件**：`PromptList.tsx`、`FolderTree.tsx`、`@dnd-kit` 集成、`store.ts`。

**验收标准**：
- [x] 拖卡片到文件夹节点 → folder_id 更新，两侧计数刷新
- [x] 拖拽中源半透明、目标文件夹高亮 accent 边框
- [x] 拖到「未归档」= 清空 folder_id
- [x] 批量移动通过批量工具条完成，多选拖拽不作为 V1 强制入口

**测试场景**：正常（单卡拖入）；边界（拖到当前所在文件夹无变化）；异常（拖放到非法目标不触发）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-11"></a>[TASK-LIB-11] 标签管理

- **状态**：✅ 已完成 · **优先级**：P1 · **依赖**：TASK-LIB-02 · **预估**：M · **所属**：Library

**目标**：新增/重命名/删除标签与标签组、给 prompt 分配标签（编辑器内 + 卡片右键快捷打标签）。

**涉及文件**：`TagCloud.tsx`、`PromptEditor.tsx`（标签选择器）、`store.ts`。
**IPC**：`db:tags:create/update/delete/assignToPrompt`。

**验收标准**：
- [x] 编辑器内可搜索/新建标签并即时分配
- [x] 删除标签 → 从所有 prompt 解绑（DB CASCADE），筛选中移除
- [x] 新建标签可选所属组与颜色
- [x] 标签色在卡片/云中一致渲染

**测试场景**：正常（新建并打标签）；边界（重名标签提示已存在）；异常（删除正在筛选的标签自动清筛选）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-12"></a>[TASK-LIB-12] 回收站

- **状态**：✅ 已完成 · **优先级**：P1 · **依赖**：TASK-LIB-01 · **预估**：M · **所属**：Library

**目标**：软删的 prompt 进「回收站」视图，可恢复或彻底删除（含清理预览图）。

**涉及文件**：`src/features/library/components/`（回收站视图/入口）、`repositories/prompts.ts`（list deleted / restore / purge）。
**IPC**（🆕 扩展）：
- `db:prompts:listDeleted` → `Prompt[]`
- `db:prompts:restore` `{id}` → `Prompt`
- `db:prompts:purge` `{id}` → `{ok:true}`（硬删 + 删预览图文件）

**验收标准**：
- [x] 软删条目出现在回收站，主列表不显示
- [x] 恢复 → 回到原文件夹/主列表
- [x] 彻底删除 → DB 行移除、FTS 同步清除、预览图文件删除
- [x] 回收站支持「清空回收站」批量彻底删除（二次确认）

**测试场景**：正常（删→恢复）；边界（原文件夹已删则恢复到「全部」）；异常（彻底删除时预览图缺失不报错）。
**质量门禁**：typecheck + preview。

---

### <a id="task-lib-13"></a>[TASK-LIB-13] 批量操作

- **状态**：✅ 已完成 · **优先级**：P2 · **依赖**：TASK-LIB-02, TASK-LIB-10 · **预估**：M · **所属**：Library

**目标**：列表多选（Cmd/Shift 点选、全选），批量打标签/移动文件夹/删除/收藏。

**涉及文件**：`src/features/library/components/PromptList.tsx`（选择态）、`src/features/library/store.ts`（selectedIds + 批量 actions）、`src/features/library/components/BatchActionBar.tsx`（批量工具条）、`electron/main/ipc/prompts.ts` / `electron/preload/index.ts` / `electron/db/repositories/prompts.ts`（批量 IPC 与事务）。

**验收标准**：
- [x] Cmd 点选加选、Shift 范围选、Cmd+A 全选
- [x] 选中后浮出批量工具条（N 项已选 · 打标签/移动/删除/收藏）
- [x] 批量操作事务化，部分失败有明确反馈
- [x] Esc 清空选择

**测试场景**：正常（选 5 条批量打标签）；边界（跨置顶/普通区多选）；异常（批量删除含已删项去重）。

**实现摘要**：
- `PromptList` 维护独立的批量选择态，支持 `⌘/Ctrl` 多选、`Shift` 连选、`⌘/Ctrl+A` 全选与 `Esc` 清空；批量勾选与右侧单条检视互不冲突。
- `BatchActionBar` 复用项目自绘 `Dialog` / `DropdownMenu` / `TagPicker`，批量标签是追加语义，移动/收藏/删除均作用于全部选中项。
- 数据层新增批量 IPC 与 repository 事务，缺失 ID 仅计入跳过，数据库异常整批回滚。

**质量门禁**（实际执行）：
- `npm run typecheck`：通过
- `npm run check`：通过（Vitest 30 文件 / 216 项；build 通过）
- `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e/test_02_library.py -q`：29 passed

---

### <a id="task-lib-14"></a>[TASK-LIB-14] 列表/网格双视图

- **状态**：✅ 已完成 · **优先级**：P2 · **依赖**：TASK-LIB-01 · **预估**：M · **所属**：Library

**目标**：列表视图（正文预览为主）/ 网格视图（预览图为主，适合有图的库），可切换 + 卡片密度（紧凑/舒适）。

**涉及文件**：`src/stores/app.ts`（持久化 view mode）、`src/pages/LibraryPage.tsx`（顶栏切换）、`src/features/library/components/PromptList.tsx`（列表/网格虚拟化）、`src/features/library/components/PromptCard.tsx`（list/grid 变体）。

**验收标准**：
- [x] 视图切换保留选中项与滚动位置
- [x] 网格视图虚拟化，千条不卡
- [x] 无预览图的卡片在网格中显示文本占位卡
- [x] 视图偏好持久化

**测试场景**：正常（切换视图）；边界（混合有图/无图）；异常（超大图不撑破布局）。
**质量门禁**：typecheck + preview。

**实现摘要**：
- `useAppStore` 新增 `libraryViewMode` 与 `setLibraryViewMode`，使用 `promptforge:library-view-mode` 持久化。
- `LibraryPage` 顶栏在标题右侧加入自绘分段切换器，避免 native select 的系统风格。
- `PromptList` 保持单一滚动容器；列表模式沿用原虚拟化，网格模式改为按行虚拟化，并在切换时保留滚动位置与选中态。
- `PromptCard` 新增 `grid` 变体：有图时显示 `previewImagePath`，无图时显示文本占位预览；列表模式保持原正文预览心智。

**质量门禁**（实际执行）：
- `npm run check`：Vitest 30 文件 / 216 项通过；build 通过
- `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e/test_02_library.py -q`：27 passed

---

### <a id="task-lib-15"></a>[TASK-LIB-15] seed 文件夹 + 首启空态引导

- **状态**：✅ 已完成 · **优先级**：P1 · **依赖**：无 · **预估**：S · **所属**：Library
- **关联**：[16-onboarding](16-onboarding-settings-data-deep-dive.md)

**目标**：首次安装 seed 2-3 个示例文件夹（如「常用」「灵感」）+ 若干示例 prompt，避免冷启动空白；空态给明确引导。

**涉及文件**：`electron/db/migrations/0004_seed_prompts.ts`（新增，随 `0001_initial.ts` / `0003_seed_templates.ts` 一起在 `electron/system/migrations.ts` 注册为 `user_version = 4`）、`src/features/library/components/PromptList.tsx`（空态三按钮）、`src/pages/LibraryPage.tsx`（透传 `onNew`）。

**实现摘要**：
- seed 文件夹 + 5 组预设标签在此卡之前已由 `0001_initial.ts` / `0003_seed_templates.ts` 落地，本卡补齐剩余两项。
- `0004_seed_prompts.ts` 只在 `prompts` 表为空时插入 3 条示例 prompt（人像/场景/设计素材各一，`source: 'manual'`，`description` 标注「示例提示词 · 可随时编辑或删除」）；未新增 `PromptSource` 枚举值，因为现有 UI 不展示 `source` 字段，靠描述文案标注可删除即可。迁移期间 `getDb()` 单例尚未赋值，因此和 0002/0003 一样直接对传入的 `db` 做原始 SQL + `tokenizeForFts` 直写 FTS，不经过 repo 层，避免递归触发 `initDb()`。
- 空库时 `PromptList` 的 `empty-no-prompts` 空态新增三个动作按钮：「新建」复用现有 `onNew`；「去生成」实际落地为 `setGenerateTab('quick')` + `setView('generate')`（Chat 路由已废弃，`ChatView` 等是孤立死代码，Generate 页「快速」tab 是其架构等价物，按钮文案改为「去生成」而非「去 Chat」）；「导入」因 `ImportDialog` 开关是 `DataSection` 局部状态、无全局触发入口，故导航到 `setSection('data')` + `setView('settings')`，用户在设置页自行点「导入」。

**验收标准**：
- [x] 干净安装后侧栏有 seed 文件夹 + 5 组预设标签（docs/03 §1.2）— 沿用 `0001_initial.ts` / `0003_seed_templates.ts`，`test_seed_folders_created` 覆盖
- [x] 有 2-3 条示例 prompt（标注可删除）— `0004_seed_prompts.ts` seed 3 条，`test_seed_prompts_created` / `test_seed_prompts_idempotent_across_reload` 覆盖
- [x] 完全空库时主区显示引导空态（新建 / 去生成 / 导入）— `test_empty_state_after_deleting_all_prompts` / `test_empty_state_new_opens_editor` / `test_empty_state_go_generate_switches_view` / `test_empty_state_import_switches_to_settings_data` 覆盖

**测试场景**：正常（首启看到 seed）；边界（用户删光后空态正确，三按钮均可用且分别落到编辑器/生成快速 tab/设置数据分区）；异常（seed 幂等，reload 不重复插入）。

**质量门禁**（实际执行）：
- `npm run check`（typecheck + Vitest 147 passed + build）：exit 0
- `.venv-test/bin/python -m pytest tests/e2e/test_01_data_layer.py tests/e2e/test_02_library.py -q`：43 passed
- `.venv-test/bin/python -m pytest tests/e2e -q`（全量，因触碰 DB 迁移）：175 passed, 6 skipped（跳过项为默认跳过的 live provider 测试）

**回归修复**：新增 seed prompt 后，`test_sort_direction` / `test_filter_bar_clear` 原先假设库内恰好 0 条已存在 prompt，已改为按标题过滤 / 先清空 seed 再断言；`test_create_prompt_full_fields` 的 `star-4` testid 在列表卡片与编辑器表单间非唯一，已改为 `'[role="dialog"] [data-testid="star-4"]'` 限定弹窗内点击。

---

## 6. 依赖关系图

```
LIB-02(store) ─┬─→ LIB-01(CRUD) ─→ LIB-12(回收站)
               ├─→ LIB-04(置顶) 
               ├─→ LIB-06(标签云) ─→ LIB-11(标签管理)
               ├─→ LIB-07(筛选栏)
               ├─→ LIB-08(排序)
               ├─→ LIB-09(检视/生成入口) ──关联→ 12-generation / 11-composer
               └─→ LIB-13(批量)
LIB-03(文件夹) ─→ LIB-10(拖拽归类) ─→ LIB-13
LIB-05(搜索) 独立
LIB-15(seed) 独立
LIB-14(双视图) 独立
```

## 7. 大功能验收（对照 docs/03 §7 + 本设计扩展）

- [x] 首启有 seed 文件夹 + 预设标签（LIB-15）
- [x] CRUD 闭环：建/改/软删/复制即时同步（LIB-01/02）
- [x] 搜索中英文都命中、150ms 防抖（LIB-05）
- [x] 标签多选 AND（LIB-06）
- [x] 收藏置顶区可拖拽重排（LIB-04）
- [x] 文件夹增删改 + 拖拽归类（LIB-03/10）
- [x] 多条件筛选 + 排序（LIB-07/08）
- [x] 右栏详情 + 「生成图像」连接主路径（LIB-09）
- [x] 回收站可恢复（LIB-12）
