# 03 · 提示词库规格

> MVP 第一段核心。落地页 = 提示词库。最高频动作：找 / 改 / 生成。

---

## 1. 组织方式：双轨制 + 收藏置顶

```
文件夹(Folders)         —— 1-2 层弱层级，管"存放位置"
标签(Tags)              —— 扁平，按"标签组"分组，管"是什么"
收藏/置顶(Pinned)       —— 顶部固定区，一等公民
```

**为什么不纯标签或纯文件夹**：
- 纯标签：新用户"分类焦虑"，冷启动差；"收藏夹"用标签模拟很别扭
- 纯文件夹：一条提示词同时属于"二次元"和"日系"和"头像"，强放唯一文件夹丢信息
- 双轨制：文件夹管位置，标签管维度，收藏管常用

### 1.1 文件夹约束
- 最多 2 层（应用层约束，DB 层 `parent_id` 自引用，但 UI 限制第 2 层不能再建子文件夹）
- 拖拽可移动提示词到文件夹、文件夹可重排
- 删除文件夹：子提示词的 `folder_id` 置空（`ON DELETE SET NULL`），不连带删除

### 1.2 预设标签维度（首次安装 seed，全部可改可删）
| 标签组 | 预设值示例 |
|---|---|
| 风格 | 二次元、写实、油画、水彩、3D 渲染、赛博朋克 |
| 场景 | 头像、壁纸、海报、UI 配图、概念图 |
| 模型 | Midjourney v6、SDXL、Flux、DALL-E 3、gpt-image |
| 主体 | 人物、风景、物品、抽象 |
| 画质 | 高清、稳定出图、易崩坏 |

### 1.3 收藏置顶
- `is_pinned = 1` 的提示词出现在列表顶部固定区
- `pin_order` 控制固定区内排序（可拖拽重排）
- 固定区与普通列表视觉上有分隔

---

## 2. 搜索设计

### 2.1 即时搜索
- 输入即搜，**150ms 防抖**
- 范围覆盖：标题 / 描述 / 正文 / 标签名
- 底层：SQLite FTS5（`prompts_fts` 虚拟表）
- 结果按相关度排序，FTS5 `bm25()` 函数

### 2.2 标签筛选
- 侧栏标签云，按"标签组"分组展示
- 多选 AND 语义（同时含"二次元"和"头像"）
- 点击标签筛选，再点取消

### 2.3 多条件组合筛选
| 维度 | 控件 |
|---|---|
| 模型 | 下拉单选 |
| 文件夹 | 树形单选 |
| 收藏状态 | 开关 |
| 创建时间 | 时间段选择 |
| 评分 | ≥ N 星 |
| 使用次数 | ≥ N |

### 2.4 搜索历史与智能集合（V1）
- 搜索历史：最近 10 条，点击回放
- 智能集合：保存常用筛选条件，一键打开（MVP 可后置）

---

## 3. 提示词元数据字段

见 [02-data-model.md](02-data-model.md) `prompts` 表。关键字段速查：

| 字段 | 类型 | 必填 | 用途 |
|---|---|---|---|
| id | TEXT (ULID) | 是 | 主键，时间序便于排序 |
| title | TEXT | 是 | 用户起的名字（强制命名便于复用） |
| description | TEXT | 否 | 用法说明、注意事项 |
| content | TEXT | 是 | 提示词正文 |
| content_negative | TEXT | 否 | 负面提示词（SD 系） |
| folder_id | TEXT | 否 | 所属文件夹 |
| tags | 关系表 | 否 | 多对多 |
| model_id | TEXT | 否 | 适配模型（高频筛选） |
| params | JSON | 否 | 生成参数包，带 `schema_version` 前向兼容 |
| preview_image_path | TEXT | 否 | 本地预览图相对路径 |
| rating | INTEGER 0-5 | 否 | 用户评分 |
| is_pinned / pin_order | INTEGER | 是 | 收藏与排序 |
| usage_count | INTEGER | 是 | 被复制/导出次数 |
| last_used_at | INTEGER | 否 | 最近使用时间 |
| source | TEXT | 否 | manual / import / shared / composition |
| source_url | TEXT | 否 | 从外站收藏的原 URL |
| created_at / updated_at | INTEGER | 是 | |
| deleted_at | INTEGER | 否 | 软删除，便于撤销 |

---

## 4. 组件清单

| 组件 | 路径 | 职责 |
|---|---|---|
| LibraryPage | `src/pages/LibraryPage.tsx` | 落地页骨架，组合以下子组件 |
| SearchBar | `src/features/library/components/SearchBar.tsx` | 顶栏即时搜索 + 防抖 |
| FolderTree | `src/features/library/components/FolderTree.tsx` | 侧栏文件夹树（react-arborist） |
| TagCloud | `src/features/library/components/TagCloud.tsx` | 侧栏标签云，按组分组，多选 AND |
| PromptList | `src/features/library/components/PromptList.tsx` | 主区列表（虚拟化 @tanstack/react-virtual） |
| PromptCard | `src/features/library/components/PromptCard.tsx` | 单条卡片：标题+正文预览+标签+预览图 |
| PromptEditor | `src/features/library/components/PromptEditor.tsx` | 编辑对话框/抽屉：所有字段表单 |
| FilterBar | `src/features/library/components/FilterBar.tsx` | 多条件筛选控件 |

---

## 5. 交互规格

### 5.1 CRUD
- **新建**：顶栏"新建"按钮 → PromptEditor 空表单 → 保存（标题+content 必填校验，zod）
- **编辑**：卡片点击/双击 → PromptEditor 预填 → 保存更新 `updated_at`
- **删除**：卡片右键/菜单 → 确认 → 软删除（`deleted_at`），可从"回收站"恢复（V1）
- **复制**：卡片"复制正文"按钮 → 剪贴板，`usage_count++`，`last_used_at` 更新

### 5.2 收藏
- 卡片星标按钮 → 切换 `is_pinned`
- 新置顶的追加到固定区末尾，`pin_order` 自增

### 5.3 搜索与筛选
- 搜索框输入 → 150ms 防抖 → FTS5 查询 → 列表更新
- 标签云点击 → 多选 AND 筛选 → 与搜索叠加生效
- 清空按钮重置所有筛选

### 5.4 排序
- 默认：`updated_at DESC`
- 可选：创建时间 / 标题 / 评分 / 使用次数

### 5.5 拖拽
- 提示词卡片拖到侧栏文件夹 → 更新 `folder_id`
- 固定区内拖拽重排 `pin_order`

---

## 6. 状态管理

- `src/features/library/store.ts`：zustand store
  - `prompts: Prompt[]`、`loading: boolean`、`error: string | null`
  - `searchQuery`、`selectedTagIds: string[]`、`selectedFolderId`、`filters`
  - actions: `fetchList`、`create`、`update`、`remove`、`togglePin`、`setSearchQuery`、`toggleTag`
- 所有数据操作通过 `window.api.prompt.*`（IPC）调主进程 repository

---

## 7. 验收标准

- [ ] 首次启动侧栏显示 seed 文件夹和预设标签
- [ ] 新建提示词：标题+content 必填校验生效，保存后列表即时更新
- [ ] 搜索：输入 150ms 后出结果，中英文都命中
- [ ] 标签多选 AND：同时选两个标签，结果为交集
- [ ] 收藏：点击星标，卡片移到固定区顶部
- [ ] 删除：软删除，列表即时移除
- [ ] 排序：4 种排序模式切换正确
- [ ] 拖拽到文件夹：`folder_id` 更新，侧栏文件夹计数更新
