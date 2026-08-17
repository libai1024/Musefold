# 09 · 开发路线图

> MVP 两段式 + 子代理任务拆分 + 验收标准。每个任务独立可认领，标注依赖。

---

## MVP 第一段：管理 + 生图 + 历史闭环（2-3 周）

### 任务 1：项目骨架 + 窗口 + 路由 ✅（本计划已交付）
- electron-vite + React + TS + Tailwind v4 配置就绪
- 主窗口：mac hiddenInset+vibrancy / win hidden+overlay+mica
- 三页（Library/Composer/History）可切换占位
- `shared/types/` 契约完整定义
- DB 连接 + schema + 首个迁移
- `npm run dev` 可启动毛玻璃窗口
- **依赖**：无
- **验收**：见计划文件 §5

### 任务 2：DB schema + 迁移 + 连接
- 完善 `electron/db/schema.ts` 全部 DDL（02 doc §2）
- `migrations/0001_initial.ts` 实现建表 + FTS5 + 触发器
- `system/migrations.ts` 调度 + 启动备份
- 预设标签 seed（首次安装写入 5 个标签组）
- **依赖**：任务 1
- **验收**：首启生成 data.db，user_version=1，侧栏 5 个标签组可见

### 任务 3：prompts repository + IPC + Library 列表/编辑
- `repositories/prompts.ts`：CRUD + 搜索 + 软删除 + 收藏 + usage
- `ipc/prompts.ts`：注册全部 `db:prompts:*` handler
- `preload` 暴露 `window.api.prompt.*`
- `features/library/`：PromptList + PromptCard + PromptEditor + SearchBar
- **依赖**：任务 2
- **验收**：03 doc §7 全部通过

### 任务 4：folders + tags + 侧栏
- `repositories/folders.ts` + `tags.ts`
- `ipc/folders.ts` + `tags.ts`
- FolderTree（react-arborist，≤2 层）
- TagCloud（按组分组，多选 AND）
- **依赖**：任务 2
- **验收**：新建/重排/删除文件夹；标签多选筛选生效

### 任务 5：FTS5 搜索 + @node-rs/jieba 集成
- FTS5 触发器同步 prompts → prompts_fts
- 150ms 防抖即时搜索
- 中文写入时预分词（@node-rs/jieba），分词结果写入 tags_index 列
- **依赖**：任务 3
- **验收**：中英文搜索都命中，<50ms

### 任务 6：Provider 配置 UI + safeStorage
- `security/keychain.ts`：safeStorage 异步 API 完整实现
- `ipc/providers.ts`：配置 CRUD + saveKey + hasKey（不返回明文）
- `features/generation/` Provider 配置对话框
- **依赖**：任务 2
- **验收**：05 doc §9 密钥安全部分通过

### 任务 7：OpenAICompatibleProvider + gpt-image-2 调用
- `providers/openai-compatible.ts`：OpenAI SDK + 可配 baseURL
- `providers/retry.ts`：指数退避 + AbortController
- `ipc/images.ts`：generate / cancel / retry
- b64_json 解码写盘到 `~/Pictures/PromptForge/`
- **依赖**：任务 6
- **验收**：05 doc §9 生图调用部分通过

### 任务 8：生成历史 UI
- `ipc/history.ts` + `repositories/history.ts`（如需）
- `features/history/`：HistoryList + 详情 + 重试
- 成本计算（可配单价）
- **依赖**：任务 7
- **验收**：历史列表按时间倒序，失败任务可重试

---

## MVP 第二段：组合系统（2-3 周）

### 任务 9：插值引擎（纯逻辑，可独立单测）
- `composer/engine/parser.ts`：parse → AST
- `composer/engine/renderer.ts`：render(ast, slotFills, target)
- `composer/engine/serializer.ts`：serializeWeight 按 target 分发
- `composer/engine/tokenizer.ts`：gpt-tokenizer 计数
- **依赖**：任务 1（shared/types）
- **验收**：04 doc §9 引擎单测部分通过（不依赖 UI）

### 任务 10：Fragment + Template + Composition 三表 + repository + IPC
- 三表 schema（02 doc §2.3）已有，补迁移
- 三套 repository + IPC handler
- **依赖**：任务 2、9
- **验收**：三表 CRUD 通过

### 任务 11：三栏画布 UI + @dnd-kit 拖拽
- `features/composer/components/`：FragmentLibrary + CompositionCanvas + PreviewPanel
- @dnd-kit 拖拽：库 → slot，替换/追加
- 权重滑块 0.1-1.9
- 实时预览（调 engine.render）
- **依赖**：任务 9、10
- **验收**：04 doc §9 UI 部分通过

### 任务 12：实时预览 + Token 计数
- PreviewPanel 调 renderer + tokenizer
- Token 进度条（0-75 绿 / 75-150 黄 / >150 红）
- 参数面板（size/quality/n/background，按 target 显隐）
- **依赖**：任务 11
- **验收**：Token 计数实时更新，颜色阈值正确

### 任务 13：内置 Fragment 库 seed
- `resources/builtin/fragments.json`：30+ 光照、20+ 构图、50+ 风格、3 个负面预设
- 首次安装导入
- **依赖**：任务 10
- **验收**：Fragment 库左栏显示内置片段

### 任务 14："另存为 Prompt" 打通
- `ipc/prompts.ts` 补 `createFromComposition`
- Composer 右栏"另存为 Prompt"按钮
- 跳转 LibraryPage 高亮新条目
- **依赖**：任务 3、11
- **验收**：另存后 Library 出现新条目，source=composition，composition_id 正确

---

## 任务依赖图

```
第一段：
1(骨架)─┬─→2(DB)─┬─→3(prompts)─→5(FTS)
        │        ├─→4(folders/tags)
        │        └─→6(provider)─→7(生图)─→8(历史)
        └─→3(shared/types)

第二段：
1─→9(引擎)─┬─→10(三表)─→11(画布)─→12(预览)
           │           └─→13(内置库)
           └─→14(另存)←3+11
```

---

## 优先级与并行

- 第一段任务 3、4、5、6 可在任务 2 完成后并行
- 第二段任务 9 可在任务 1 完成后立即启动（纯逻辑无依赖）
- 任务 13（内置库数据）可与 11 并行

---

## 发布前打磨（任务 15，可选）

- 导入/导出 JSON
- 分享卡片 + deeplink（V1 无后端 P2P）
- 成本看板
- macOS + Windows 双平台打包签名
- 应用商店上架准备
