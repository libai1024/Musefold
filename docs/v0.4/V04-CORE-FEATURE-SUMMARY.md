# V04 · 核心功能盘点与暴露矩阵

> **状态**：事实盘点（基于 2026-08-12 的源码与 v0.3.x 文档交叉核对）
> **用途**：回答两个问题——① 本 App 的核心功能到底是什么；② 哪些功能、以何种形态、在 v0.4 暴露给 MCP/CLI。
> **核对基准**：`electron/preload/index.ts`（`window.api`）、`shared/types/ipc.ts`、`electron/main/ipc/*`、三个 SQLite schema。

---

## 1. 产品定位（一句话）

**Musefold（未像）= 本地优先的「视觉灵感 → 提示词资产 → AI 生图 → 历史账本」桌面工作台**，BYOK（用户自带 Provider Key），数据全部落在本机 SQLite + 图片目录。

核心生产闭环：

```
灵感捕获（朱点/素笺） → 提示词库（笺） → 配方/方案（参数化） → 生图（Provider） → 历史/成本 → 反哺库
```

---

## 2. 六大能力域

### 2.1 提示词库（Library / 笺匣）

| 项 | 内容 |
|---|---|
| 能力 | 提示词 CRUD、软删/回收站、置顶与排序、批量操作、文件夹（≤2 级）、标签组、FTS5 全文检索（中文预分词）、智能集合（保存的查询）、搜索历史、素笺（`source='slip'` 快速记录，誊清转正式） |
| IPC 域 | `prompt`（19 ops）、`folder`、`tag`、`smartSet`、`searchHistory` |
| 数据 | 库 DB：`prompts`、`folders`、`tags`、`prompt_tags`、`smart_sets`、`search_history`、`prompts_fts` |
| 关键实现 | `electron/main/ipc/prompts.ts` → `electron/db/repositories/*` |

### 2.2 生图与 Provider（Generate）

| 项 | 内容 |
|---|---|
| 能力 | 多 Provider 管理（OpenAI 兼容 / TvT / 悟空 Studio）、模型列举、密钥安全存储（safeStorage）、连通性验证、单价配置与成本估算；生图主链路：文生图 + **multipart 本地图直传编辑**（v0.3 决策，不依赖图床）、多参考图（≤16 张、有序编号 图1/图2…）、精修（从单/多历史结果继续）、取消/重试、进度事件 |
| IPC 域 | `provider`（9 ops）、`image`（pickLocal / stageLocal / generate / cancel / retry / onProgress）、`settings.pricing` |
| 数据 | `providers` 表（**无明文 key**，只有 has_key + 尾 4 位）；key 在 `musefold-providers-v0.3.0` electron-store（safeStorage 加密）；产物 PNG 写 `~/Pictures/Musefold/v0.3.0/{jobId}.png` |
| 关键实现 | `electron/main/ipc/images.ts`（`generate()` 是全 App 生图唯一汇聚点）、`electron/providers/{openai-compatible,wukong-studio}.ts`、`electron/security/keychain.ts` |

### 2.3 配方域（Recipe，v0.2.1 遗产，仍在运行）

| 项 | 内容 |
|---|---|
| 能力 | 配方目录（收藏/归档/复制/回收站）、创作草稿（空白/由提示词/由想法/由已有配方/YAML 导入导出）、不可变修订版发布、变量与素材填充（use session）、**编译**（blocks + `{{var}}` + materials → 最终提示词，含 source ranges）、交接 Workbench、提交生图、精修分支、AI 辅助起草（`recipeAi.draft`，BYOK 文本模型） |
| IPC 域 | `recipeCatalog`、`recipeAuthoring`、`recipeUse`、`generation`、`recipeAi`、`material`、`workbenchSession`、`recipeData` |
| 数据 | 配方 DB（`musefold-recipe-data-v0.3.0.db`）：`recipes`、`recipe_revisions`、`recipe_variables`、`materials`、`generation_runs`、`generated_assets`、`workbench_sessions` 等 |
| 关键实现 | **纯逻辑**在 `shared/recipe-domain/renderer.ts`（`renderRecipeComposition`）等；Electron 侧只是持久化与对话框 |

### 2.4 设计方案域（Design Scheme，v0.3.2 新核）

| 项 | 内容 |
|---|---|
| 能力 | 方案（UI 名）= Skill（运行时名）：来源快照（GitHub 固定 commit / 历史 / 简报）→ Agent 分析编译 → 草稿 → 本地试运行 → 转正（封面+确认）→ Composer 调用（`scheme_first / user_first / agent_mediated` 三种主导模式）；市场搜索（用户显式发起）；`.musefold.design` 离线分享包导入导出；修改工作草稿、上游更新检查 |
| IPC 域 | `designScheme`（19 ops + `onEvent` 事件流） |
| 数据 | 方案 DB（`musefold-design-scheme-v0.3.2.db`）：`design_schemes`、`design_scheme_revisions`、`source_snapshots`、`design_scheme_runs` 等 12 张表；来源文件落 `userData/design-scheme-sources/` |
| 关键实现 | **纯逻辑**：`shared/design-scheme/prompt-compiler.ts`；编排：`electron/main/design-scheme/orchestrator.ts`（确定性 FSM + 角色 Agent） |

### 2.5 Skill 导入与运行时（v3.1 → v0.3.2）

| 项 | 内容 |
|---|---|
| 能力 | 导入：GitHub 公开仓库（固定 commit、预算限制）/ 本地文件夹 / ZIP（防 zip-slip）→ 扫描分类 → AI 提取候选配方 → 提交草稿；运行时：`prepareGithub`（30min TTL 内存快照）→ `execute`（优先 Agent 模式：文本模型 + `list_skill_files`/`read_skill_file`/`generate_image` 三工具循环；降级 file-fallback 直接拼接生图）→ 事件流 |
| IPC 域 | `skillImport`（14 ops）、`skillRuntime`（prepare/execute/cancel/release/onEvent） |
| 安全红线 | **从不执行 Skill 内脚本**（`.sh/.py/.js`）；仅读文本与图片素材 |
| 关键实现 | `electron/main/skill-import/{github-reader,zip-reader,source-reader}.ts`（纯 Node）、`electron/main/ipc/skill-runtime.ts`、`shared/recipe-domain/skill-scanner.ts`（纯） |

### 2.6 历史与系统（History / System）

| 项 | 内容 |
|---|---|
| 能力 | 历史列表/详情/删除/清理、成本统计（按日/Provider）、磁盘占用、关联提示词/配方反查、运行分支树；分享卡片 PNG + `promptforge://` deeplink 导入；备份/恢复/导出导入（库 JSON 或 zip+图片，**不含密钥与原始 DB**）；日志 tail |
| IPC 域 | `history`（10 ops）、`share`、`system`（16 ops）、`log` |
| 数据 | 库 DB `history` + 配方 DB `generation_runs/generated_assets` 双写 |

---

## 3. 现有程序化表面（`window.api`）总账

> 这是 v0.4 的「原料清单」：24 个域、约 140 个操作，全部已收敛在主进程 typed IPC 之后。

| 域 | 操作数 | v0.4 相关性 |
|---|---|---|
| `prompt` / `folder` / `tag` / `smartSet` / `searchHistory` | 19+5+5+4+3 | ★★★ 核心暴露 |
| `provider` / `settings.pricing` | 9+3 | ★★☆ 只读暴露 + 本地 CLI 管理 |
| `image` | 6 | ★★★ 核心暴露（generate/cancel/进度） |
| `recipeCatalog` / `recipeAuthoring` / `recipeUse` / `generation` | 7+11+5+4 | ★★☆ 编译+运行暴露，创作不暴露 |
| `material` | 7 | ★★☆ 检索暴露 |
| `aiConnection` / `recipeAi` | 11+2 | ★☆☆ 只读列举；draft 不暴露 |
| `skillImport` / `skillRuntime` | 14+5 | ★★☆ 运行暴露（GitHub），导入向导不暴露 |
| `designScheme` | 19+事件 | ★★★ 列举/编译/运行暴露，创作流不暴露 |
| `workbenchSession` / `history` | 6+10 | ★★★ 历史只读暴露 |
| `share` / `system` / `recipeData` / `log` | 6+16+6+2 | ★☆☆ 仅 CLI 部分暴露（备份/导出） |
| `window` / `diagnostics` | — | 不暴露（纯 UI） |

---

## 4. 数据与密钥地形图

```
userData/
├── musefold-data-v0.3.0.db              # 库：prompts/folders/tags/history/providers(无key)/FTS
├── musefold-recipe-data-v0.3.0.db       # 配方域：recipes/materials/runs/assets/workbench
├── musefold-design-scheme-v0.3.2.db     # 方案域：schemes/revisions/snapshots/runs
├── musefold-providers-v0.3.0.json       # electron-store：safeStorage 加密后的图像 Provider key + 单价
├── musefold-ai-connections-v0.3.0.json  # 同上：文本 AI 连接 key
├── musefold-previews-v0.3.0/uploads/    # 参考图暂存（受管路径）
├── design-scheme-sources/{snapshotId}/  # 方案来源快照
├── musefold-backups-v0.3.0/             # 备份
└── musefold-logs-v0.3.0/                # 日志

~/Pictures/Musefold/v0.3.0/{jobId}.png   # 生成产物（用户可见）
```

关键事实（决定 v0.4 架构）：

1. **三个 DB 都是 better-sqlite3 同步访问**，WAL 模式。多进程同时写 = `SQLITE_BUSY` 风险 → v0.4 必须保持**单写者**（见 V04-ARCHITECTURE §3）。
2. **密钥只经 `safeStorage` 加解密、只在主进程内存中短暂出现**（`BaseProvider.getApiKey()`）。headless 模式需要等价适配器（OS keychain / 加密文件 + 主密码 / 环境变量）。
3. `userData` 路径已支持注入（E2E 用 `MUSEFOLD_E2E_USER_DATA_DIR` 覆盖），core 抽取时把它升级为正式的 `dataDir` 端口。

---

## 5. 可移植性评估（core 抽取的依据）

| 域 | 评级 | 说明 |
|---|---|---|
| 提示词/文件夹/标签/智能集合 CRUD | **PURE** | repos 只依赖 better-sqlite3，脱掉 IPC 壳即可 |
| 配方渲染 / YAML / 校验 / diff | **PURE** | `shared/recipe-domain/*` 已零 Electron 依赖 |
| 方案提示词编译 | **PURE** | `shared/design-scheme/prompt-compiler.ts` |
| Skill 扫描 / ZIP / GitHub 读取 | **PURE** | 纯 Node fs/fetch/yauzl |
| 历史 / workbench 会话 | **PURE** | 双 DB 写，逻辑可移植 |
| 生图 Provider（HTTP + 写盘） | **HYBRID** | 逻辑可移植；需注入「密钥后端 + 路径」两个端口（今天用 `safeStorage`/`app.getPath`） |
| 文本 AI 连接 / recipeAi | **HYBRID** | OpenAI 兼容客户端可移植；密钥存取同上 |
| 方案编排 / Skill 运行时 | **HYBRID** | 核心是 fetch + 文本模型 + `generate()`；事件推送需从 `ipcRenderer` 换成 SSE/回调端口 |
| 备份 / 导出导入 | **HYBRID** | zip/JSON 逻辑可移植；对话框改为路径参数 |
| `image.pickLocal`、各类 dialog、deeplink 注册、`window.*` | **ELECTRON-BOUND** | CLI 场景直接以路径参数替代，不进 core |
| `safeStorage` 密钥 | **ELECTRON-BOUND（今天）** | v0.4 定义 `SecretsPort`，Electron 实现 = safeStorage；headless 实现见 V04-SECURITY §4 |

**结论**：约 80% 的核心逻辑可以进入 `@musefold/core`；Electron 专属的只剩对话框、窗口、deeplink 注册与 safeStorage 实现。

---

## 6. v0.4 暴露矩阵（哪个能力、什么形态、什么管控）

> 分级：🟢 只读（自由调用） / 🟡 写库（低危写入，默认允许，可关） / 🔴 花钱或外联（默认需确认/预算） / ⚫ 不暴露。

| 能力 | MCP 工具 | CLI 命令 | 级别 | 备注 |
|---|---|---|---|---|
| 检索/读取提示词 | `search_prompts` / `get_prompt` | `musefold prompt list/get/search` | 🟢 | FTS + 过滤 |
| 保存提示词（含素笺） | `save_prompt` | `musefold prompt add` | 🟡 | Agent 产出的好 prompt 回流资产库 |
| 列 Provider/模型 | `list_providers` | `musefold provider list/models` | 🟢 | 永不含 key |
| **生图（文生图/垫图编辑/精修）** | `generate_image` | `musefold generate` | 🔴 | 确认或预算；返回本地路径 + 成本 |
| 取消生图 | `cancel_generation` | `Ctrl-C` / `musefold cancel <jobId>` | 🟡 | |
| 列配方 / 读配方 | `list_recipes` / `get_recipe` | `musefold recipe list/show` | 🟢 | |
| **编译配方 → 最终提示词** | `compile_recipe` | `musefold recipe compile` | 🟢 | 纯函数，0 成本，Agent 最常用 |
| 配方直出图 | （复用 `generate_image` 的 `recipeId` 参数） | `musefold recipe run` | 🔴 | 写 `generation_runs` 账本 |
| 列方案 / 读方案（含输入槽位） | `list_schemes` / `get_scheme` | `musefold scheme list/show` | 🟢 | 仅「正式」方案对 MCP 可见（草稿不可调用，延续 v0.3.2 决策） |
| 编译方案提示词（预览） | `compile_scheme_prompt` | `musefold scheme compile` | 🟢 | |
| **运行方案生图** | `run_scheme` | `musefold scheme run` | 🔴 | 事件流进度；产物入方案 runs |
| **运行 GitHub Skill** | `run_github_skill` | `musefold skill run <url>` | 🔴 | 固定 commit、不执行脚本；需文本 AI 连接 |
| 历史列表/详情 | `list_history` / `get_generation` | `musefold history list/show` | 🟢 | 含成本、参数、产物路径 |
| 检索素材 | `search_materials` | `musefold material list` | 🟢 | |
| 保存/恢复备份 | ⚫ | `musefold backup now/list/restore` | 🟡 | 仅 CLI |
| 导出/导入库 | ⚫ | `musefold export` / `import` | 🟡 | 仅 CLI |
| Provider 增删改/**设 Key** | ⚫ | `musefold provider add/set-key`（交互式，不接受 argv 明文） | 🟡 | 仅本地 CLI；MCP 永不暴露 |
| 配方/方案创作向导、AI 起草 | ⚫ | ⚫ | ⚫ | 创作留在 GUI；Agent 只消费 |
| 删除提示词/历史/方案 | ⚫（v0.4 不给 MCP） | `musefold prompt rm` 等（`--force` 才执行） | 🟡 | MCP 侧破坏性动作整体延后到 v0.5 评估 |

**工具面设计原则**（详见 V04-MCP-SERVER-SPEC）：

1. **小目录**：~15 个工具全部进模型上下文也不超预算；名称动词开头、snake_case。
2. **读写分离 + 注解**：所有 🟢 工具 `readOnlyHint: true`；🔴 工具 `openWorldHint: true`（外联 Provider）且默认走确认。
3. **产物用 ResourceLink**：生成的 PNG 以 `file://` ResourceLink 返回，客户端可直接读取展示。
4. **成本透明**：任何花钱工具的结构化输出必含 `costCents` 与 `historyId`，可追溯。
