# 16 · 引导 · 设置 · 数据 —— Deep Dive

> **v0.2.1 当前契约补充（2026-08-09）**：本文早期的 Fragment/Template/Composition 导出示例只描述 v0.1 历史实现，不再是运行时契约。主数据导出使用 `promptforge-export` schema v2，包含 `prompts/folders/tags/smartSets/providers`，可选包含带引用快照的 `history`；提示词与历史中的 `recipeId` 是指向独立配方数据库的软关联。v0.2.1 配方数据库通过设置页专用 Recipe Data 面板导出/导入，`promptforge-recipe-db` v2 包含配方、素材、作品、Skill Source/Snapshot/File、Skill ImportSession 和 AI Assist 审查事实。文本 AI Connection 配置、安全存储中的 API Key 和 Base URL 不进入 JSON 快照；SQLite 整库备份只保存 AI Assist 审计，不保存 Key。

> **大功能定位**：**首启激活漏斗 + 全局配置中枢 + 数据主权与安全底座**。它不产内容，但决定「新用户能不能在 10 分钟内跑通第一次生图」（北极星激活指标，见 [01-vision-and-ia](01-vision-and-ia.md) §8），以及「用户的资产能不能被安全地备份、迁移、且密钥永不泄漏」。
> 本文遵循 [10-library-deep-dive](10-library-deep-dive.md) 的统一结构（需求→现状→小功能→UI/UX→任务卡→依赖→验收）。
> 引用：`docs/02`（schema/备份/导出模式）、`docs/05` §4（密钥安全）/§8（成本单价）、`docs/06`（外观/原生窗口/a11y）、`docs/07` §3.8（system:* 契约）、`docs/12` §2（现状缺口）。

> **任务卡状态回写**：2026-08-04 · 基于源码实读 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞
> **设置视觉去重（2026-08-06）**：设置页头不再重复罗列全部分区；生成默认值中的比例配置移除“图形摘要 + 下拉弹层 + 常驻网格”三重表达，收口为一行当前值摘要和一套可直接点击的比例预览网格，探索/制作参数同步语义不变。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为**刚装好的新用户**，我要被一步步领着「填一个服务商 → 粘贴 Key → 点校验 → 出第一张图」，不用去读文档、不用猜哪里配置。
- 作为**换机 / 重装的老用户**，我要能**一键导出全部资产**（提示词/标签/文件夹/片段/模板/组合），到新机器**一键导入**，且冲突时能选「合并 / 覆盖 / 跳过」。
- 作为**注重隐私的用户**，我要确认**导出文件里绝不含明文 API Key**，只保留服务商元数据；密钥始终留在系统密钥库。
- 作为**长期用户**，我要看到**自动备份列表**（schema 升级时生成），并能「立即手动备份」和「从某个备份恢复」。
- 作为**对动效敏感 / 高信息密度偏好**的用户，我要能开「减少动效」、切「紧凑密度」，而不是被迫接受默认。
- 作为**成本敏感用户**，我要给每个服务商配单价（每张图 / 每千 token），让历史成本看板算得准（见 [13-history](13-history-deep-dive.md)）。
- 作为**要清库重来**的用户，我要有「清空全部数据」的危险区，但必须双重确认、且先提醒我导出。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| Raycast / Linear：首启 3-4 步向导，每步单一焦点 | **分步向导 + 进度点 + 可跳过** | 我们把「首次成功生图」作为向导终点，不止于配置 |
| Obsidian：库=文件夹，导入导出即拷目录 | 本地优先、数据可携 | 我们是 SQLite，需结构化 JSON 导出 + 可选图片包 |
| VS Code：settings.json 可导出同步 | 配置可迁移 | 我们区分「资产数据」与「应用偏好」，导出聚焦资产 |
| 1Password：密钥永不明文导出 | **导出严格排除密钥** | 只导 Provider 元数据（name/baseUrl/model），Key 需在新机重填 |
| 系统偏好：跟随系统外观 + 减少动效 | 尊重系统无障碍设置 | 已跟随系统主题，补 reduced-motion / 密度 |

**结论**：本模块 = **「激活向导的领路感」×「本地数据的可携性」×「密钥安全的零妥协」**。引导解决「进得来」，导入导出解决「搬得走」，安全硬化解决「不出事」。

---

## 2. 现状对照（设计 vs 实现）

> 依据 `docs/12` §2、§8，及代码：`src/features/settings/*`、`electron/main/ipc/system.ts`、`electron/system/{paths,migrations,logger}.ts`、`electron/security/keychain.ts`、`electron/main/media-protocol.ts`、`src/index.html`。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增

| 小功能 | 设计要求 | 现状 | 结论 |
|--------|----------|------|------|
| 设置分区骨架 | 双栏偏好面板 + 分区导航 | ✅ `SettingsView` + `SectionShell`/`SettingRow`，5 区可切 | 达标 |
| 外观 · 主题 | system/light/dark 跟随系统 | ✅ `AppearanceSection` + `stores/app.ts`（themeSource 持久化 + syncSystemTheme） | 达标 |
| 外观 · 减少动效 | 尊重 prefers-reduced-motion | ✅ system/on/off 三态，可显式覆盖系统设置并持久化 | 达标 |
| 外观 · 密度 | 紧凑 / 舒适 | ✅ Settings、Library、History、Composer 主要列表与虚拟行统一接入 | 达标 |
| 生成默认值 | size/quality/n/默认Provider/background | ✅ `GenerationSection` 以 `useAppStore.defaultProviderId` + `useGenerationWorkbenchStore` 为主；`generation/store` 只负责 Provider 配置 | 达标（TASK-SET-06） |
| 成本单价配置 | 每 Provider 每图 / 每千 token | ✅ `ProviderDialog` 计费单价 + `settings:pricing:*` + electron-store `pricing.{id}` | 达标 |
| 服务商设置入口 | 列表 + 新建 + 测试 | ✅ `ProvidersSection`（含测试全部），详见 [12-generation](12-generation-deep-dive.md) | 达标（详情外链） |
| 数据 · 路径展示 | db/图片/备份路径 + 打开 | ✅ `DataSection` + `system:getPaths`/`openInFolder` | 达标 |
| 数据 · 版本 | app + db schema | ✅ `system:getVersion`（app + user_version） | 达标 |
| 诊断日志 | 脱敏日志尾部 + 打开目录 | ✅ `logger.ts`（redact sk-/Bearer/api-key）+ `log:tail`/`log:openDir` | 达标 |
| **数据 · 导出** | JSON 仅DB / DB+图片包 | ✅ versioned JSON / ZIP+图片，排除密钥并有 Data UI | 达标 |
| **数据 · 导入** | JSON merge / replace | ✅ merge/replace/skip、事务回滚、导入前备份与 UI | 达标 |
| 备份 · 自动 | schema 升级前备份 | ✅ `VACUUM INTO` 一致性快照；设置页统一列出升级前/导入前备份 | 达标 |
| 备份 · 手动 + 恢复 | 立即备份 / 从备份恢复 | ✅ 手动快照、列表、损坏/穿越校验、恢复前保全、重启闭环 | 达标 |
| **首启引导** | 欢迎→配 Provider→校验→首图→seed | ✅ 4 步状态机、可跳过、Provider 校验和首图入口已接入 | 达标 |
| seed 文件夹/内容 | 首装示例文件夹 + prompt | ✅ 默认模板/示例内容已随迁移 seed | 达标 |
| **CSP** | dev 宽松 / prod 严格 + 允许 media: | ✅ 主进程注入响应头；prod renderer 仅 self；dev 精确放行 Vite/HMR；`media:` 可显示 | 达标 |
| 密钥安全 | safeStorage、明文不入 DB/IPC/日志 | ✅ `keychain.ts`（encrypt→electron-store）、`provider:list` 只回 hasKey+suffix、日志 redact | 达标（导出须承接此红线） |
| 危险区 · 清空数据 | 双重确认清库 | ✅ 短语门禁 + 清空前一致性备份 + 单事务清库；Provider/密钥/图片保留 | 达标 |
| 关于 | 版本 + 快捷键 + 安全说明 | ✅ 产品版本/DB schema、文档、反馈模板、MIT 与第三方声明齐全 | 达标 |

**一句话**：**Settings 十张任务卡已全部达标**；下一步是正式打包与跨平台冒烟，不再以设置页功能缺口阻塞发布。

---

## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | 导出引擎：`system:export` JSON（仅DB / DB+图片包 zip） | P0 | [TASK-SET-01](#task-set-01) |
| 2 | 导入引擎：`system:import` JSON（merge / replace / skip） | P0 | [TASK-SET-02](#task-set-02) |
| 3 | Data 分区导入导出 UI（模式选择对话框 + 进度 + 结果） | P0 | [TASK-SET-03](#task-set-03) |
| 4 | 首启引导流（欢迎→配 Provider→校验→首图→seed） | P1 | [TASK-SET-04](#task-set-04) |
| 5 | 备份：设置页可见 + 立即备份 + 从备份恢复 | P1 | [TASK-SET-05](#task-set-05) |
| 6 | 生成默认值补齐（默认 Provider + background + 成本单价） | P1 | [TASK-SET-06](#task-set-06) |
| 7 | 外观补齐：减少动效开关 + 界面密度 | P1 | [TASK-SET-07](#task-set-07) |
| 8 | CSP + 权限硬化（session 头 + prod 严格 + media: 白名单） | P1 | [TASK-SET-08](#task-set-08) |
| 9 | 危险区：清空全部数据（双重确认 + 强制先导出提醒） | P2 | [TASK-SET-09](#task-set-09) |
| 10 | 关于分区补齐（版本 + 许可证 + 支持入口） | P2 | [TASK-SET-10](#task-set-10) |

> **P0 主战场**：TASK-SET-01/02/03（导入导出闭环）——`docs/12` §8 A5 直接派工项，缺它无法备份迁移。
> **P1 激活关键**：TASK-SET-04（首启引导）——直接服务北极星「<10 分钟激活」。

---

## 4. UI/UX 设计

### 4.1 首启引导流（OnboardingFlow）—— 目标：安装到首图 < 10 分钟

全屏覆盖层（非模态可跳过），4 步 + 完成态。顶部进度点，每步单一焦点。数据门控：`localStorage['promptforge:onboarded']` 未置位 且 `provider:list` 为空时触发。

```
步骤 1/4 · 欢迎
┌──────────────────────────────────────────────────────────┐
│                         🔥                                │
│                   欢迎来到 PromptForge                     │
│         锻造你的生图提示词 · 本地优先 · 自带 Key           │
│                                                          │
│   ①─────②─────③─────④    ← 进度点（当前 ① 高亮）        │
│                                                          │
│   本地存储 · 密钥系统级加密 · 不上传任何数据              │
│                                    [跳过引导]  [开始 →]   │
└──────────────────────────────────────────────────────────┘

步骤 2/4 · 连接一个服务商（一键预设）
┌──────────────────────────────────────────────────────────┐
│  选一个生图服务商，粘贴你的 API Key 即可开始。            │
│  ┌────────────────────────┐ ┌────────────────────────┐   │
│  │ ● TvT AI 中转站  推荐  │ │ ○ 悟空云 · 生图组       │   │
│  │  OpenAI 兼容 · 快      │ │  异步出图 · 生图组分组  │   │
│  │  gpt-image-2           │ │  image_gptImage2        │   │
│  └────────────────────────┘ └────────────────────────┘   │
│                                          [获取 Key ↗]     │
│  API Key  [ sk-·································· ] 👁       │
│  base_url [ https://ai.tvt.wiki/v1        ]（预设已填）   │
│                                                          │
│  ①─────②─────③─────④          [← 上一步]  [校验并继续 →]│
└──────────────────────────────────────────────────────────┘

步骤 3/4 · 校验连接
┌──────────────────────────────────────────────────────────┐
│                  ⟳ 正在校验连接…                          │
│      provider:validate → base_url + 密钥 可达性           │
│  ── 成功 ──────────────────────────────────────────────  │
│  ✓ 连接正常，服务商已就绪                                 │
│  ── 失败（分类提示）──────────────────────────────────── │
│  ✕ 鉴权失败（401）：请检查 Key 是否正确/是否过期  [重填]  │
│  ✕ 速率限制（429）：稍后重试                       [重试]  │
│  ✕ 余额不足：请前往服务商充值                     [跳过]  │
│  ①─────②─────③─────④          [← 上一步]  [继续 →]       │
└──────────────────────────────────────────────────────────┘

步骤 4/4 · 出第一张图（激活时刻）
┌──────────────────────────────────────────────────────────┐
│  试着生成第一张图 —— 我们已为你填好一个示例提示词。       │
│  提示词 [ a cozy cabin in snowy forest, cinematic ]       │
│  比例 [方图▾]  质量 [高清▾]                                │
│                                        [⚡ 生成第一张图]   │
│  ── 生成中 ──  ⟳ 出图中（约 10–30s）…            [取消]   │
│  ── 成功 ──   [🖼 预览图]  🎉 你的第一张图！               │
│  ①─────②─────③─────④                    [完成，进入库 →] │
└──────────────────────────────────────────────────────────┘

完成态：置位 onboarded → seed 文件夹/示例 prompt 就绪（LIB-15）→ 跳转 Library
```

### 4.2 设置页整体布局（SettingsView，现状 + 新增分区）

```
┌─ 设置 ─────────────────────────────────────────────────────────┐
│ PageHeader: ⚙ 设置 · 服务商 · 生成 · 外观 · 数据                 │
├──────────────┬─────────────────────────────────────────────────┤
│ 分区导航(168) │  内容区（max-w-2xl 居中，滚动）                  │
│ ● 服务商      │  ┌ SectionShell: 标题 + 描述 + 右侧动作 ┐        │
│ ○ 生成默认值  │  │ SettingRow: 标签/说明 ───────  [控件] │        │
│ ○ 外观        │  │ SettingRow: ...                        │        │
│ ○ 数据与存储  │  └────────────────────────────────────────┘      │
│ ○ 关于        │                                                  │
└──────────────┴─────────────────────────────────────────────────┘
   现有 5 区保持；「数据与存储」内新增 导入/导出/备份 区块；
   「生成默认值」新增 默认Provider/背景/单价；「外观」新增 减少动效/密度。
```

### 4.3 数据与存储分区（DataSection 扩展，含导出/导入/备份/危险区）

```
┌ 数据与存储 ────────────────────────────────────────────────────┐
│ 图片输出   ~/Pictures/PromptForge          [打开]              │
│ 应用数据   …/Application Support/PromptForge [打开]            │
│ 备份目录   …/PromptForge/backups            [打开]            │
│ ─────────────────────────────────────────────────────────────│
│ 📦 导出与导入                                                  │
│   把全部资产导出为一份文件，换机时一键导入。                   │
│   ⚠ 导出不含 API 密钥（仅服务商元数据），新机需重填 Key。      │
│                                   [↓ 导出数据]  [↑ 导入数据]   │
│ ─────────────────────────────────────────────────────────────│
│ 🗄 备份（自动 + 手动）                                         │
│   数据库升级前自动备份；也可随时手动备份。                     │
│   ● db-2026-08-03T10-22-01.db   2.4 MB  自动(升级)  [恢复]     │
│   ● db-2026-07-30T09-08-11.db   2.1 MB  手动        [恢复]     │
│                                              [立即备份一次]   │
│ ─────────────────────────────────────────────────────────────│
│ 诊断日志  记录生图与连接过程，已脱敏不含 Key   [查看] [打开]   │
│ ─────────────────────────────────────────────────────────────│
│ 应用版本 0.1.0                          数据库 schema v1       │
│ ─────────────────────────────────────────────────────────────│
│ ⛔ 危险区                                                      │
│   清空全部数据（提示词/标签/文件夹/片段/模板/组合/历史）。     │
│   不可恢复。建议先导出。            [清空全部数据…]（红色）    │
└────────────────────────────────────────────────────────────────┘
```

### 4.4 导出对话框（模式选择）

```
┌ 导出数据 ────────────────────────────────── ✕ ┐
│ 选择导出内容                                    │
│  ◉ 仅数据（JSON）                               │
│     提示词/标签/文件夹/片段/模板/组合           │
│     体积小，秒级完成。不含图片文件。            │
│  ○ 数据 + 图片包（.zip）                        │
│     附带预览图与生成图，体积可能达 GB 级。      │
│ ───────────────────────────────────────────── │
│ 🔒 导出内容不包含任何 API 密钥；服务商仅保留    │
│    名称 / base_url / model 等元数据。           │
│ ───────────────────────────────────────────── │
│ 预计包含：312 提示词 · 48 标签 · 6 文件夹 …     │
│                          [取消]   [选择位置并导出]│
└─────────────────────────────────────────────────┘
```

### 4.5 导入对话框（冲突策略）

```
┌ 导入数据 ────────────────────────────────── ✕ ┐
│ 已选择：promptforge-export-2026-08-03.json      │
│ 版本 schema_version=1 · 由 PromptForge 0.1.0 导出│
│ 含：312 提示词 · 48 标签 · 6 文件夹 · 45 片段 … │
│ ───────────────────────────────────────────── │
│ 遇到 id 冲突时：                                │
│  ◉ 合并（保留双方，冲突项按 updated_at 取新）   │
│  ○ 替换（先清空同类数据，再全量导入）⚠         │
│  ○ 跳过（仅导入本地不存在的 id）                │
│ ───────────────────────────────────────────── │
│ ☑ 导入前自动备份当前数据库（推荐）              │
│ ⚠ 「替换」不可逆，将删除现有同类数据。          │
│                          [取消]   [开始导入]     │
│ ── 导入中 ── ⟳ 已导入 128 / 312 …               │
│ ── 完成 ──  ✓ 导入 312 · 跳过 6 · 失败 0        │
└─────────────────────────────────────────────────┘
```

### 4.6 危险区二次确认（清空全部数据）

```
┌ 清空全部数据？ ──────────────────────────── ✕ ┐
│ 这会永久删除本机所有提示词、标签、文件夹、     │
│ 片段、模板、组合与历史记录。图片文件与 API     │
│ 密钥不受影响。此操作不可恢复。                 │
│                                               │
│ 建议先导出。 [先去导出]                        │
│ 请输入  清空数据  以确认：                     │
│ [________________]                             │
│                        [取消]  [永久清空](禁用直至匹配)│
└─────────────────────────────────────────────────┘
```

### 4.7 导出 JSON 格式（versioned envelope）

字段名与 `shared/types/models.ts` 对齐（camelCase）。**顶层 `schemaVersion` 用于前向兼容**；导入端按此版本决定迁移策略。

```jsonc
{
  "format": "promptforge-export",
  "schemaVersion": 1,              // 导出格式版本（≠ DB user_version）
  "dbUserVersion": 1,              // 导出时的 DB 迁移版本，供导入端判定兼容
  "appVersion": "0.1.0",
  "exportedAt": 1722680000000,
  "mode": "db-only",               // "db-only" | "db-with-images"
  "counts": { "prompts": 312, "tags": 48, "folders": 6, "fragments": 45,
              "templates": 3, "compositions": 12 },

  "data": {
    // 提示词：含 tagIds（而非内联 Tag[]），folderId 关系随文件夹一并导入
    "prompts": [{
      "id": "01J...", "title": "电影感人像", "description": null,
      "content": "cinematic portrait...", "contentNegative": null,
      "folderId": "01J...", "modelId": "flux",
      "params": { "schemaVersion": 1, "size": "1024x1024", "quality": "high" },
      "previewImagePath": "previews/01J....png",   // 相对路径；db-with-images 时打进 zip
      "rating": 4, "isPinned": true, "pinOrder": 0,
      "usageCount": 12, "lastUsedAt": 1722600000000,
      "source": "manual", "sourceUrl": null, "compositionId": null,
      "tagIds": ["01J...", "01J..."],
      "createdAt": 1710000000000, "updatedAt": 1722600000000
      // 注意：deletedAt 默认不导出（可选 includeDeleted）
    }],
    "folders":  [{ "id": "01J...", "name": "常用", "parentId": null, "sortOrder": 0, "createdAt": 1710000000000 }],
    "tags":     [{ "id": "01J...", "name": "二次元", "tagGroup": "风格", "color": "#0071e3", "createdAt": 1710000000000 }],
    "fragments":[{ "id": "01J...", "type": "lighting", "content": "cinematic lighting",
                   "weight": 1.0, "weightable": true, "tags": ["dramatic"],
                   "category": "lighting/dramatic", "compatibleModels": ["flux"],
                   "source": "user", "createdAt": 1710000000000, "updatedAt": 1710000000000 }],
    "templates":[{ "id": "01J...", "name": "电影感人像", "body": "{{subject}}, {{style}}",
                   "negativeBody": null, "slots": [/* Slot[] */], "params": null,
                   "target": "flux", "createdAt": 1710000000000, "updatedAt": 1710000000000 }],
    "compositions":[{ "id": "01J...", "templateId": "01J...", "slotFills": { /* Record<string,SlotFill> */ },
                   "renderedPositive": "...", "renderedNegative": null, "params": null,
                   "seed": 12345, "previewImage": null,
                   "createdAt": 1710000000000, "updatedAt": 1710000000000 }],

    // Provider：仅元数据。安全红线：无 apiKey，无密文，仅供参考/手动重建。
    "providers":[{ "id": "01J...", "name": "TvT AI 中转站", "type": "openai-compatible",
                   "baseUrl": "https://ai.tvt.wiki/v1", "model": "gpt-image-2",
                   "isActive": true }]                  // 无 hasKey/keySuffix/明文
  }
}
```

**🔒 安全红线（导出层，必须逐条落实，见 TASK-SET-01 验收）**：

- **绝不导出明文 API Key**，也**不导出 safeStorage 密文**（密文与本机绑定，迁移无意义且是泄漏面）。
- providers 段**剔除 `hasKey`/`keySuffix`**（避免暗示密钥存在与末位），仅留 `name/type/baseUrl/model/isActive`。
- 导出前用 `redact()` 同源逻辑对**自由文本字段兜底扫描**（`content`/`description`/`sourceUrl` 若含 `sk-`/`Bearer` 形态则打码并计数告警）。
- **history 默认不导出**（含 prompt/负面快照与成本，非资产本体、可能含隐私）；如需，另设显式 `includeHistory` 开关，且同样 redact。
- `db-with-images` 的 zip 内只打包 `previews/` 与命中引用的图片文件，不打包 `data.db`、`providers`（electron-store 密钥文件）、`logs/`。

### 4.8 关键交互与状态

| 场景 | 行为 |
|------|------|
| 首启触发 | onboarded 未置位 **且** provider 列表空 → 覆盖层；老用户/已配置不打扰 |
| 引导「跳过」 | 置位 onboarded，直达 Library；服务商空态仍有「一键预设」补救入口 |
| 校验成功 | 步骤 3 通过；服务商设为 active |
| 校验失败 | 按 401/429/余额分类文案 + 对应动作（重填/重试/跳过），不阻断「跳过引导」 |
| 首图成功 | 记为激活；完成态置位 onboarded，确保 seed（LIB-15）就绪后进库 |
| 导出「仅DB」 | 生成 JSON，弹系统保存框，写盘后 toast「已导出到 …」+ [打开所在文件夹] |
| 导出「DB+图片」 | 流式打包 zip（大库有进度条），完成同上 |
| 导入选文件 | 先解析校验 `format`/`schemaVersion`，展示统计与冲突策略，不立即写库 |
| 导入 replace | 高亮 ⚠ 不可逆；强制勾选「导入前自动备份」默认开 |
| 导入完成 | toast「导入 N · 跳过 M · 失败 K」；刷新各 store（library/composer 等） |
| 备份「恢复」 | 二次确认 → 关闭 DB 连接 → 覆盖 data.db → 提示重启应用生效 |
| 清空数据 | 需输入「清空数据」字样匹配才启用按钮；先提供「先去导出」 |
| **空态** | 无备份：「暂无备份，升级或手动备份后出现」；无可导出数据：导出按钮禁用 + tooltip |
| **加载态** | 导入导出进度条 + 计数；备份列表骨架 |
| **错误态** | 导出/导入失败 inline 错误条（含 IpcError.code 文案）+ 重试；文件损坏「无法解析，请确认是 PromptForge 导出文件」 |

---

## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。IPC 契约引用 `docs/07` §3.8，🆕 处给出完整签名。

### <a id="task-set-01"></a>[TASK-SET-01] 导出引擎 `system:export`（JSON + 图片包）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Settings
- **依赖**：无（各 repository `list` 已存在）
- **预估**：L

**目标**：把当前 `throw 'Not implemented'` 的 `system:export` 实现为「versioned JSON 导出」，支持「仅DB」与「DB+图片包 zip」两种模式，产出 §4.7 的信封格式，且**绝不含明文密钥或密文**。

**涉及文件**：
- `electron/main/ipc/system.ts`（修改：实现 `SYSTEM_EXPORT` handler，替换 TODO）
- `electron/system/export.ts`（新建：`buildExportPayload()` 聚合各 repo + `redact` 兜底 + zip 打包）
- `electron/db/repositories/*.ts`（复用 list；如需「含软删」再加 `listAll`）
- `shared/types/ipc.ts`（修改：见下 IPC 契约，扩展 export 形态 + `ExportEnvelope` 类型）
- `src/lib/ipc.ts`（透传，无需改，走 `window.api.system.export`）

**IPC 契约**（`docs/07` §3.8 扩展 🆕，与现有 `export(format, promptIds?)` 兼容并增强）：
- 通道 `system:export`，请求 `{ mode: 'db-only' | 'db-with-images'; includeHistory?: boolean; includeDeleted?: boolean; targetPath?: string }`，响应 `{ path: string; counts: Record<string, number>; redactedFields?: number }`
- `ExportEnvelope` 类型置于 `shared/types/ipc.ts`（字段见 §4.7），供导入端复用。

**交互与 UI/UX**：见 §4.4。UI 侧在 TASK-SET-03，本卡只交付主进程能力 + 类型。

**🔒 安全要求**（验收硬门）：
- providers 段仅 `{ id?, name, type, baseUrl, model, isActive }`，**移除 hasKey/keySuffix**，不含 apiKey/密文。
- 不读取 `keychain`/electron-store 密钥文件；zip 不含 `data.db`、`providers`（store）、`logs/`。
- 自由文本字段过 `redact()` 兜底，命中计入 `redactedFields`。

**验收标准**：
- [x] `mode:'db-only'` 产出 JSON，顶层含 `format/schemaVersion/dbUserVersion/appVersion/exportedAt/mode/counts/data`
- [x] `data` 六类（prompts/folders/tags/fragments/templates/compositions）齐全，prompts 用 `tagIds` 引用
- [x] providers 段无 `apiKey`、无密文、无 `hasKey`/`keySuffix`（grep 断言）
- [x] `mode:'db-with-images'` 产出 zip，含 JSON + 被引用的 `previews/` 图片，不含 db/密钥/日志
- [x] history 默认不出现在导出；仅 `includeHistory:true` 时出现且已 redact
- [x] 空库导出得到合法空信封（counts 全 0），不报错

**测试场景**：
1. 正常：312 条库「仅DB」导出 → 重新解析 counts 与实际一致。
2. 边界：0 条库导出 → 合法空信封；含软删项默认不导出。
3. 异常：某 prompt 的 `content` 混入 `sk-abcd1234...` → 导出后该处被打码，`redactedFields≥1`。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] 单测 / E2E：对导出产物断言「无 `apiKey`/`sk-` 残留」「providers 无 hasKey」
- [x] 主进程真实 Electron export 已由 `tests/e2e/test_05_settings.py` 覆盖

---

### <a id="task-set-02"></a>[TASK-SET-02] 导入引擎 `system:import`（merge / replace / skip）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Settings
- **依赖**：[TASK-SET-01]（复用 `ExportEnvelope` 类型与格式）
- **预估**：L

**目标**：实现 `system:import`，解析 §4.7 信封，按冲突策略（merge / replace / skip）事务化写库，导入前可自动备份，返回逐类统计。

**涉及文件**：
- `electron/main/ipc/system.ts`（修改：实现 `SYSTEM_IMPORT` handler，替换 TODO）
- `electron/system/import.ts`（新建：校验 → 依赖序插入（folders→tags→prompts→prompt_tags→fragments→templates→compositions）→ 冲突处理 → 事务）
- `electron/system/backup.ts`（新建/共享：`backupNow()`，供导入前备份，与 TASK-SET-05 共用）
- `shared/types/ipc.ts`（修改：import 请求/响应类型）

**IPC 契约**（`docs/07` §3.8 扩展 🆕）：
- 通道 `system:import`，请求 `{ path: string; strategy: 'merge' | 'replace' | 'skip'; autoBackup?: boolean }`，响应 `{ imported: number; skipped: number; failed: number; byType: Record<string, {imported:number;skipped:number}> }`

**交互与 UI/UX**：见 §4.5。UI 在 TASK-SET-03；本卡交付主进程能力。

**冲突策略语义**：
- `merge`：按 id upsert，冲突项比较 `updatedAt`，导入方更新则覆盖，否则保留本地。
- `replace`：先清空同类表（在事务内），再全量插入；**强制 autoBackup**。
- `skip`：仅插入本地不存在的 id，已存在一律跳过。
- 关系完整性：`folderId`/`tagIds`/`templateId`/`compositionId` 指向缺失目标时置空或跳过该关系（不整条失败），失败计数 +1 并记日志。

**验收标准**：
- [x] 三种策略语义正确，全程单事务，失败整体回滚
- [x] 校验 `format==='promptforge-export'`；`schemaVersion` 高于本端时拒绝并提示升级
- [x] `replace` 前必做备份（无论 autoBackup 入参），备份路径写日志
- [x] 导入后 FTS 索引与 prompts 同步（触发器或重建）
- [x] `providers` 段仅重建元数据，**不写任何密钥**，导入后各 Provider `hasKey=false`
- [x] 返回 `byType` 逐类统计准确

**测试场景**：
1. 正常：空库 merge 导入 312 条 → 全部 imported；再次同文件 merge → 全 skip（updatedAt 相同）。
2. 边界：导入文件缺 `folders`，prompt 的 folderId 悬空 → folderId 置空、prompt 仍导入。
3. 异常：`schemaVersion=99` → 拒绝并提示；损坏 JSON → `INVALID_PARAMS` 且不动库。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] E2E：三策略 + 悬空关系 + 版本拒绝 + 导入后 provider `hasKey=false`
- [x] 导入后 list/FTS 查询可读出数据

---

### <a id="task-set-03"></a>[TASK-SET-03] Data 分区 导入导出 UI

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Settings
- **依赖**：[TASK-SET-01]、[TASK-SET-02]
- **预估**：M

**目标**：在 `DataSection` 增「导出与导入」区块，接入导出模式对话框（§4.4）与导入冲突对话框（§4.5），含进度、结果 toast、密钥排除提示。

**涉及文件**：
- `src/features/settings/sections/DataSection.tsx`（修改：新增导出/导入区块 + 打开对话框）
- `src/features/settings/components/ExportDialog.tsx`（新建）
- `src/features/settings/components/ImportDialog.tsx`（新建）
- `src/lib/ipc.ts`（透传新签名，随 TASK-SET-01/02 的类型自动可用）

**IPC 契约**：消费 `system:export` / `system:import`（TASK-SET-01/02）。文件选择用系统对话框（主进程 `dialog.showSaveDialog`/`showOpenDialog`，可经 export/import handler 内部完成，UI 只传 `targetPath?`/`path`）。

**交互与 UI/UX**：见 §4.4、§4.5、§4.8。导出前展示 counts 预览；导入前展示解析统计与策略；replace 高亮不可逆并默认勾选自动备份。密钥排除提示常驻可见。

**验收标准**：
- [x] 导出对话框可选「仅DB / DB+图片包」，导出后 toast + [打开所在文件夹]
- [x] 导入对话框选文件后先解析展示统计，再选策略，最后执行
- [x] 导入完成刷新受影响 store（library/composer 列表即时反映）
- [x] 大库导出/导入显示进度或忙碌态，不冻结 UI
- [x] 密钥排除说明在导出对话框常驻可见
- [x] `api.system` 缺失（浏览器预览）时优雅降级（按钮禁用，不崩），遵循 `DataSection` 既有防御

**测试场景**：
1. 正常：导出仅DB → 换目录导入 merge → 列表数据出现。
2. 边界：导入一个空信封 → 结果「导入 0」，不报错。
3. 异常：选中非导出文件 → 「无法解析」错误条，不写库。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Electron E2E 验证导出/导入两对话框的打开、预览、执行与降级无崩溃

---

### <a id="task-set-04"></a>[TASK-SET-04] 首启引导流（欢迎→配 Provider→校验→首图→seed）

- **状态**：✅ 已完成（2026-08-04：引导流已挂载；16 个 store 单测和 5 个 Electron E2E 通过，含跳过、错误重填、首图和密钥安全场景）
- **优先级**：P1
- **所属大功能**：Settings（跨 Generation / Library）
- **依赖**：无（复用 provider validate / image generate / seed）
- **预估**：L
- **关联**：[12-generation](12-generation-deep-dive.md)（预设/校验/生图）、[10-library](10-library-deep-dive.md) LIB-15（seed 文件夹/示例）

**目标**：干净安装首次启动时，用 4 步全屏向导领用户完成「选预设 → 粘 Key → 校验 → 出第一张图」，达成北极星「安装到首图 < 10 分钟」（`docs/01` §8）。完成后置位标记、确保 seed 就绪、跳转 Library。

**涉及文件**：
- `src/features/onboarding/OnboardingFlow.tsx`（新建：4 步状态机 + 进度点 + 跳过）
- `src/features/onboarding/store.ts`（新建：step、onboarded 持久化 `localStorage['promptforge:onboarded']`）
- `src/App.tsx` 或 `src/components/layout/AppShell.tsx`（修改：门控挂载 OnboardingFlow）
- 复用 `useGenerationStore`（`createProvider`/`saveKey`/`validate`/`setActive`/`generate`）、`PROVIDER_PRESETS`（`shared/constants.ts`）

**IPC 契约**（复用现有，无新增）：`provider:create`/`saveKey`/`validate`/`setActive`（§3.5）、`image:generate`（§3.6）。

**交互与 UI/UX**：见 §4.1、§4.8。触发条件 = onboarded 未置位 **且** `provider:list` 为空。任何步骤可「跳过引导」（置位标记，直达 Library）。校验失败按 401/429/余额分类文案。首图成功即视为激活。

**安全**：Key 输入框默认掩码，可点 👁 显隐；提交即经 `provider:saveKey`（safeStorage 加密），**不写 localStorage、不落日志**。

**验收标准**：
- [x] 首次干净启动出现引导；已配置 Provider 或已 onboarded 不再出现
- [x] 步骤 2 选 TvT 预设自动填 baseUrl/model，仅需粘 Key
- [x] 步骤 3 调 `provider:validate`，成功进下一步并 setActive；失败分类提示且可重填/重试
- [x] 步骤 4 用示例提示词 `image:generate` 出图成功 → 展示预览图
- [x] 「跳过引导」任意步可用，置位 onboarded 后不再打扰
- [x] 完成后 seed 文件夹/示例 prompt 就绪（依赖 LIB-15），跳转 Library
- [x] Key 不出现在 localStorage / 日志（测试已自动核查）

**测试场景**：
1. 正常：全新装 → 4 步跑通 → 首图成功 → 进库看到 seed。
2. 边界：步骤 2 后点「跳过」→ 直达 Library，服务商空态仍有一键预设补救。
3. 异常：Key 错误 → 步骤 3 显示 401 文案 + [重填]；重填正确后继续。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] Electron E2E 验证 4 步流转 + 跳过路径（mock Provider 与密钥安全路径）

---

### <a id="task-set-05"></a>[TASK-SET-05] 备份可见化 + 手动备份 + 恢复

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P1
- **所属大功能**：Settings
- **依赖**：无（`migrations.ts` 已在升级前备份）
- **预估**：M

**目标**：把 `backups/` 目录下的自动备份在 Data 分区列出（时间/体积/来源），提供「立即备份一次」与「从某备份恢复」，让备份从「黑箱」变可操作。

**实现摘要**：
- `createBackup()` 继续使用 SQLite `VACUUM INTO` 生成不依赖 WAL 的一致性单文件快照；数据库升级前备份也从 `copyFileSync` 改为同一策略。
- `listBackups()` 统一列出 `backup-*.db` 与 `db-*.db`，按真实修改时间倒序并标识手动/自动；目录不存在时自动创建。
- `restoreBackup()` 只接受备份目录内的普通 `.db` 文件，执行路径穿越、符号链接、`quick_check`、PromptForge 表、schema 版本校验；替换前自动保存 `pre-restore` 快照。
- 恢复采用同目录 staging + rename；若进程在替换窗口中断，下次启动由 `initDb()` 自动救回 `data.db.restore-previous`。
- 设置页新增应用内备份面板与确认弹窗：立即备份后实时入列；恢复成功后锁定结果态并要求立即重启。

**涉及文件**：
- `electron/system/backup.ts`、`electron/system/migrations.ts`、`electron/db/index.ts`
- `electron/main/ipc/system.ts`、`electron/preload/index.ts`、`shared/types/ipc.ts`
- `src/features/settings/components/BackupPanel.tsx`、`src/features/settings/sections/DataSection.tsx`
- `preview/bridge-plugin.mjs`（浏览器预览内存桩）
- `tests/e2e/test_05_settings.py`

**IPC 契约**（🆕）：
- `system:listBackups` 请求 `{}` → `{ file: string; path: string; size: number; createdAt: number; kind: 'auto'|'manual' }[]`
- `system:backupNow` 请求 `{}` → `{ path: string }`（`VACUUM INTO backups/backup-{ts}-manual.db`）
- `system:restoreBackup` 请求 `{ file: string }` → `{ ok: true; needsRestart: true; safetyBackupPath: string }`
- `system:relaunch` 请求 `{}` → `{ ok: true }`（恢复结果态的“立即重启”）

**交互与 UI/UX**：见 §4.3。恢复为高风险操作：二次确认 + 明示「将覆盖当前数据、需重启」；建议先备份当前。列表按时间倒序。

**验收标准**：
- [x] 列出 `backups/` 下所有普通 `.db`，含体积与时间，auto/manual 标识
- [x] 「立即备份」生成新文件并即时出现在列表
- [x] 「恢复」二次确认 → 覆盖 data.db → 提示立即重启
- [x] `restoreBackup` 拒绝目录穿越、符号链接、损坏库和高版本库
- [x] 无备份时空态提示

**测试场景**：
1. 正常：手动备份 2 次 → 列表 2 条 → 恢复其一 → 重启后数据回到该备份点。
2. 边界：备份目录不存在 → 自动创建、空态展示。
3. 异常：传入 `../data.db` 越权路径 → 被拒 `FORBIDDEN`。

**质量门禁（实际执行，2026-08-04）**：
- [x] `npm run check`：typecheck + 23 个 Vitest 文件 / 190 项 + 生产 build 全通过
- [x] 设置模块 E2E：37 passed（新增 4 项覆盖恢复真值、元数据、自动备份、穿越/损坏拒绝、UI 确认）
- [x] 视觉验收：数据设置页与恢复确认态截图检查，修正来源徽标换行
- [x] 完整无 API Electron E2E：190 passed / 6 skipped / 0 failed（500.65 秒）

---

### <a id="task-set-06"></a>[TASK-SET-06] 生成默认值补齐（默认 Provider + 背景 + 成本单价）

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P1
- **所属大功能**：Settings
- **依赖**：TASK-SET-08
- **预估**：M
- **关联**：[13-history](13-history-deep-dive.md)（成本看板消费单价）、[12-generation](12-generation-deep-dive.md)

**目标**：`GenerationSection` 在现有 size/quality/n 基础上补：默认服务商选择、背景（auto/transparent/opaque）、**每 Provider 成本单价配置**（每张图 / 每千 token），为历史成本看板提供算价依据（`docs/05` §8）。

**实现摘要**：
- `GenerationSection` 以 `useAppStore.defaultProviderId` + `useGenerationWorkbenchStore` 为主源；探索/制作默认比例、质量、数量、背景直接写 Workbench 偏好。
- Workbench 提交/重试的 Provider 解析统一使用 `useAppStore.defaultProviderId` 兜底；旧 `studio/store` 与 `generation/store` 旧生成 API 已删除，不再作为迁移镜像或测试入口。
- `DEFAULT_REFINE_PARAMS` 新增 `background: 'auto'`。
- `GenerationSection.tsx` 新增默认服务商下拉（`useGenerationStore.providers`，选中时联动 `setActive`）与背景 Chips；比例/质量/张数/背景通过 `applyDefaults()` 单向同步到 `generation.workbench`，默认 Provider 由 `useAppStore` 记录。
- 成本单价（`settings:pricing:get/set/delete` + electron-store `pricing.{providerId}` + `ProviderDialog` 计费 UI + OpenAI compatible Provider 按单价写 `history.cost`）为本卡前置工作，已在此前的 HIS-13 交付并验证，本卡未重做。

**涉及文件**：
- `src/features/settings/sections/GenerationSection.tsx`（修改：新增默认 Provider 下拉 + background Chips + `applyDefaults` 单一数据源同步）
- `src/features/generation/components/ProviderDialog.tsx`（HIS-13 已完成：每 Provider 计费单价）
- `src/features/generation/params.ts`（修改：`DEFAULT_REFINE_PARAMS.background = 'auto'`）
- `electron/main/ipc/settings.ts` / `electron/settings/pricing.ts` / `shared/pricing.ts`（HIS-13 已完成：`settings:pricing:*` + electron-store `pricing.{providerId}`）
- `src/features/generation/__tests__/params.test.ts`（修改：默认参数断言含 `background: 'auto'`）
- `tests/e2e/test_04_generate.py`（新增/更新：`test_generation_defaults_provider_and_background`、`test_workbench_retry_falls_back_to_default_provider`）

**IPC 契约**：成本单价 `settings:pricing:get/set/delete`（HIS-13 已新增）；默认 Provider/background 无新增 IPC，纯前端 store + localStorage。

**交互与 UI/UX**：默认 Provider 用下拉（来自 `useGenerationStore.providers`）。单价按 Provider 分组，输入校验非负数值。background 用 Chips（复用现有 `Chips` 组件）。

**验收标准**：
- [x] 可设默认服务商，生图未显式指定时采用它（快速生成、精修生成、单张重试三条路径均已兜底）
- [x] background 三档可选并写入默认参数
- [x] 每 Provider 可配 per-image / per-1k-token 单价（分），持久化
- [x] 单价变更后，新生成历史按新单价写入 cost；成本看板（13）可消费新记录
- [x] 与创作台参数单一数据源一致（改这里创作台同步，精修面板后续修改不被覆盖）

**测试场景**：
1. 正常：设默认 Provider + 透明背景 → 快速生成成功后历史 `provider_id`/`params.background` 与请求体一致。
2. 边界：`activeProviderId` 为空但已设 `defaultProviderId` → 单张重试仍沿用默认服务商成功出图，不误报 `NO_PROVIDER`。
3. 异常：单价输入负数/非数字 → 校验拦截（HIS-13 已验证）。

**质量门禁（实际执行，2026-08-04）**：
- [x] `npm run typecheck` 通过
- [x] 定向 Vitest：`params.test.ts` + `pricing.test.ts` + `format.test.ts` 3 files / 23 tests 通过
- [x] `npm run build` 通过（仅已知 `"use client"` 打包警告，退出码 0）
- [x] 目标 E2E：`test_04_generate.py::test_generation_defaults_provider_and_background` 1 passed；补测 `test_studio_retry_falls_back_to_default_provider` 1 passed
- [x] 模块 E2E：`test_04_generate.py` 24 passed / 1 skipped（较 HIS-13 基线 22 passed / 1 skipped 净增 2）
- [x] `npm run check`：typecheck 通过 + Vitest 19 files / 172 tests 通过 + build 通过
- [x] 全量 E2E：`pytest tests/e2e -q` **184 passed / 7 skipped**

---

### <a id="task-set-07"></a>[TASK-SET-07] 外观补齐：减少动效开关 + 界面密度

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P1
- **所属大功能**：Settings
- **依赖**：无
- **预估**：S

**目标**：`AppearanceSection` 在主题之外补：① 减少动效（system/on/off，system 时尊重 `prefers-reduced-motion`）；② 界面密度（紧凑/舒适）。

**实现摘要**：
- `useAppStore` 新增 `reducedMotion` / `density` 及持久化 setter，脏值分别回退 `system` / `comfortable`。
- 根元素挂 `data-motion`、`.reduce-motion` 与 `data-density`；system 仅在媒体查询命中时减动效，off 可显式覆盖系统 reduce。
- 密度变量接入 Settings、Library PromptCard/虚拟行、History 行/缩略图和 Composer Fragment 行；虚拟列表估算高度同步切换。
- Appearance 使用应用内 SegmentedControl，三态动效和两态密度即时生效。

**涉及文件**：
- `src/features/settings/sections/AppearanceSection.tsx`（修改：两个 SettingRow）
- `src/stores/app.ts`（修改：`reducedMotion: 'system'|'on'|'off'`、`density: 'comfortable'|'compact'`，持久化）
- `src/styles/motion.css`（修改：由 `.reduce-motion` 根 class 强制关闭过渡，补充现有 `@media`）
- 根元素（`AppShell`/`main.tsx`）：按状态挂 `data-density` / `.reduce-motion` class

**IPC 契约**：无（纯渲染层偏好）。

**交互与 UI/UX**：SegmentedControl（复用现有）。密度切换即时影响列表行高/内边距（通过 `data-density` + Tailwind 变量）。

**验收标准**：
- [x] 减少动效 = on 时全局过渡/动画关闭；= system 时随系统设置；off 显式保留动效
- [x] 密度切换即时改变 Settings、Library、History、Composer 主要列表/卡片
- [x] 两项偏好持久化，刷新/重启保持，脏值安全回退
- [x] 不破坏现有主题跟随系统逻辑

**测试场景**：
1. 正常：开减少动效 → 主题切换/列表进出无过渡动画。
2. 边界：system + 系统开了减少动效 → 生效；系统关 → 恢复动画。
3. 异常：localStorage 脏值 → 回退默认（system / comfortable）。

**质量门禁（实际执行，2026-08-04）**：
- [x] `npm run check`：typecheck + 24 个 Vitest 文件 / 192 项 + 生产 build 全通过
- [x] 偏好单测 2 项；设置模块 E2E 39 passed（含 system/on/off、持久化和虚拟列表无重叠）
- [x] Appearance 与紧凑 Library 截图视觉验收通过
- [x] 完整无 API Electron E2E：192 passed / 6 skipped / 0 failed（502.65 秒）

---

### <a id="task-set-08"></a>[TASK-SET-08] CSP + 权限硬化（主进程头 + prod 严格 + media: 白名单）

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P1（安全）
- **所属大功能**：Settings（安全底座）
- **依赖**：无
- **预估**：M

**目标**：把 CSP 从「仅 `index.html` meta」升级为「主进程 `session.onHeadersReceived` 注入响应头」，dev 放行 localhost/HMR（ws + Vite），prod 严格（`script-src 'self'`，去 `unsafe-inline`），**务必放行 `media:` 以免生成图裂图**（见 memory: media:// 协议）。

**涉及文件**：
- `electron/main/csp.ts`（按 renderer URL 组装可单测的 dev/prod CSP）
- `electron/main/window.ts`（响应头注入、窗口/导航隔离和 BrowserWindow 安全选项）
- `electron/main/index.ts`（权限请求与检查 handler 默认拒绝）
- `electron/main/media-protocol.ts`（`media:` secure/standard 注册与路径校验）
- `electron/main/__tests__/csp.test.ts`、`tests/e2e/test_04_generate.py`（自动化验收）

**CSP 实际策略**：
- 公共：`default-src 'self'`; `img-src 'self' data: blob: media:`; `object-src/base-uri/form-action/frame-ancestors 'none'`
- dev：只为当前 Vite renderer origin 增加 http/ws，并允许 HMR 所需的 `unsafe-eval`
- prod：`script-src 'self'`; `connect-src 'self'`; `style-src 'self' 'unsafe-inline'`；无 localhost/ws/任意 https
- **`media:` 必须在 `img-src`**（生成图经 media:// 加载，否则裂图）
- Provider 网络请求在主进程执行，所以用户配置的 https `base_url` 不需要进入 renderer `connect-src`

**权限最小化**：
- 复查 `contextIsolation:true`/`nodeIntegration:false`/`sandbox:true`（`docs/06` §2、`docs/05` §4.2）保持。
- `session` 拒绝无谓权限请求（`setPermissionRequestHandler` 默认拒绝 camera/geolocation 等）。
- 阻止渲染进程 `window.open` / 导航到外链（`setWindowOpenHandler` → shell.openExternal 白名单）。

**验收标准**：
- [x] 主进程注入 CSP 响应头，自动化可读取并验证
- [x] prod 构建下 `script-src` 不含 `unsafe-inline`/`unsafe-eval`，页面正常运行
- [x] 生成图（media://）不被 CSP 拦
- [x] 生图请求在主进程执行，不受 renderer `connect-src` 影响
- [x] 未授权权限请求被默认拒绝；外链走系统浏览器
- [x] 正常路径无意外 CSP 违规

**测试场景**：
1. 正常：dev 启动无 CSP 报错，HMR 生效；生图出图显示正常。
2. 边界：prod 包启动，media:// 图片、https 生图均正常。
3. 异常：注入一段内联 `<script>`（prod）→ 被 CSP 阻止（验证策略生效）。

**质量门禁**：
- [x] `npm run check` 通过（23 个 Vitest 文件、190 项，含生产 build）
- [x] CSP 单测 3 项、Electron 安全 E2E 5 项、完整无 API E2E 192 passed / 6 skipped

---

### <a id="task-set-09"></a>[TASK-SET-09] 危险区：清空全部数据（双重确认）

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P2
- **所属大功能**：Settings
- **依赖**：[TASK-SET-01]（先导出引导）、[TASK-SET-05]（自动备份）
- **预估**：S

**目标**：Data 分区底部危险区，提供「清空全部数据」（提示词/标签/文件夹/片段/模板/组合/历史），双重确认（输入短语匹配）+ 强制先备份，图片文件与密钥不受影响。

**实现摘要**：
- `resetBusinessData()` 先创建 `pre-reset` 一致性快照，再在单事务内按外键逆序清空七类业务表与 `prompts_fts`。
- Provider 配置、safeStorage 密钥、计费设置及磁盘图片明确留在 reset 边界外；生成任务进行中时主进程拒绝清空。
- Data 页底部新增危险区与应用内对话框；错误短语不可提交，提供“先导出”，正确提交后显示备份路径。
- 清空完成后同步归零 Library/Composer/History/Workbench 内存态与 Fragment 收藏偏好，避免残留旧选中或会话结果。

**涉及文件**：
- `src/features/settings/sections/DataSection.tsx`（修改：危险区 + 确认对话框）
- `electron/main/ipc/system.ts`（修改：注册 `system:resetData`）
- `electron/system/reset.ts`（新建：事务清空数据表 + 重置 FTS，先 `backupNow()`）
- `shared/types/ipc.ts`（修改：`system:resetData` 类型）

**IPC 契约**（🆕）：`system:resetData` 请求 `{ confirm: 'RESET' }` → `{ ok: true; backupPath: string }`（执行前必备份，返回备份路径）。

**交互与 UI/UX**：见 §4.6。按钮红色；对话框需输入「清空数据」匹配才启用；提供「先去导出」。执行后清空 store 并回到空态（可触发 seed 重建或空态引导）。

**安全**：只清业务数据表，**不动 electron-store 密钥、不动图片目录**；执行前强制备份（可恢复）。

**验收标准**：
- [x] 需输入匹配短语才启用「永久清空」
- [x] 执行前自动备份，返回并提示备份路径
- [x] 清空后七类业务数据为空、FTS 同步清空、历史清空
- [x] Provider/密钥/计费设置与图片文件不受影响
- [x] 提供「先导出」入口；活动生成任务会阻止清空

**测试场景**：
1. 正常：输入短语 → 清空 → 库空 + 备份已生成。
2. 边界：短语不匹配 → 按钮禁用。
3. 异常：清空中断（模拟）→ 事务回滚，数据不半清。

**质量门禁（实际执行，2026-08-04）**：
- [x] `npm run check`：typecheck + 24 个 Vitest 文件 / 192 项 + 生产 build 全通过
- [x] 设置模块 E2E 41 passed；新增 2 项覆盖事务备份、独立库读取、FTS、Provider/key/image 保留、短语门禁与 store 归零
- [x] 危险区与确认弹窗截图视觉验收通过
- [x] 完整无 API Electron E2E：194 passed / 6 skipped / 0 failed（506.02 秒）

---

### <a id="task-set-10"></a>[TASK-SET-10] 关于分区补齐（版本 + 许可证 + 支持入口）

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P2
- **所属大功能**：Settings
- **依赖**：无
- **预估**：S

**目标**：`AboutSection` 在现有品牌/快捷键/安全说明基础上，补 app 版本 + db schema 版本、开源许可证/第三方声明、产品文档与问题反馈入口。仓库没有配置可信的 PromptForge 官网或反馈站，故不伪造公网地址：产品文档作为随包资源由系统打开，反馈入口复制版本/平台/复现模板；Provider 公网链接继续由系统浏览器打开并受精确域名白名单约束。

**涉及文件**：
- `src/features/settings/sections/AboutSection.tsx`、`third-party-notices.ts`（版本、复制反馈、许可弹窗、文档入口）
- `electron/system/{about,app-version}.ts`、`electron/main/ipc/system.ts`（固定资源 ID 与正确产品版本）
- `electron/main/external-links.ts`、`window.ts`（Provider 外链 HTTPS + 精确 host 白名单）
- `shared/types/ipc.ts`、`electron/preload/index.ts`、`preview/bridge-plugin.mjs`（`system:openAboutResource` 契约）
- `electron-builder.yml`、`LICENSE`（随包产品文档与 MIT 许可）

**IPC 契约**：复用 `system:getVersion`（§3.8），新增 `system:openAboutResource(resource: 'product-docs')`。渲染层不传文件路径；未知 ID 由主进程拒绝。

**交互与 UI/UX**：版本块可点击复制；“产品文档”由系统打开随包 Markdown；“问题反馈”复制带版本/平台的复现模板；许可在应用内弹窗滚动查看。未配置的产品公网入口不展示假链接。

**验收标准**：
- [x] 显示正确的 PromptForge package 版本 + db schema 版本，开发态不误用 Electron runtime 版本
- [x] 提供随包产品文档与反馈信息模板；Provider 公网链接经系统浏览器和精确域名白名单打开
- [x] 提供 MIT 与第三方运行时依赖许可证声明入口
- [x] 保留现有安全说明（密钥系统级加密）
- [x] 未知资源 ID、非 HTTPS、相似域名、带凭据 URL 均被拒绝

**测试场景**：
1. 正常：版本正确显示并可复制；许可弹窗包含主要运行时依赖；反馈模板包含版本与平台。
2. 边界：版本 IPC 失败 → 版本降级为「—」，不崩；随包文档在 dev/packaged 路径分别解析。
3. 异常：未知资源 ID 或外链域名不在白名单 → 不打开（防路径穿越/钓鱼）。

**质量门禁（实际执行，2026-08-04）**：
- [x] `npm run check`：typecheck + 29 个 Vitest 文件 / 207 项 + 生产 build 全通过
- [x] 外链/随包资源/产品版本单测 5 项通过
- [x] 设置模块 E2E 43 passed；新增 2 项覆盖真实版本、复制内容、许可弹窗和非法资源 ID
- [x] About 主视图与许可弹窗真实 Electron 截图视觉验收通过
- [x] 完整无 API Electron E2E：215 passed / 6 skipped / 0 failed（Electron 43.2.0，550.51 秒）
- [x] macOS ARM64 打包版冒烟：1 passed，覆盖 DB v5/100 条 Fragment、Fragment 左栏与用户片段 CRUD/内置只读、Composer 参数快照/制作台继承、safeStorage、模拟生图、media://、History、导出/重置/导入恢复与随包文档

---

## 6. 依赖关系图

```
SET-01(导出引擎) ─┬─→ SET-02(导入引擎) ─┬─→ SET-03(导入导出 UI)
                  │                     └─→ SET-09(清空数据·先导出)
                  └─────────────────────────→ SET-03
SET-02 ──共用 backup.ts──→ SET-05(备份可见/手动/恢复) ─→ SET-09(清空前自动备份)

SET-04(首启引导) ──关联→ 12-generation(预设/校验/生图) · 10-library LIB-15(seed)
SET-06(生成默认值/单价) ──关联→ 13-history(成本看板)
SET-07(减少动效/密度) 独立（关联 06 §8 a11y）
SET-08(CSP/权限硬化) 独立（关联 media:// 协议，勿拦生成图）
SET-10(关于补齐) 依赖 SET-08 的外链白名单与打包资源配置
```

**认领建议**：先 SET-01 → SET-02 → SET-03 打通 P0 导入导出闭环；并行推进 SET-04 首启引导（P1 激活）；SET-05/08 属安全与数据主权底座，尽早做；SET-06/07/09/10 收尾打磨。

---

## 7. 大功能验收（对照 docs/12 §2 缺口 + docs/01 §8 北极星 + 本设计扩展）

- [x] **导出**：`system:export` 产出 versioned JSON（仅DB / DB+图片包），格式含 `schemaVersion`（SET-01）
- [x] **导出安全**：导出物无明文 Key、无密文、providers 无 hasKey/keySuffix、自由文本 redact（SET-01）
- [x] **导入**：`system:import` 支持 merge/replace/skip，事务化、可回滚、导入后 provider `hasKey=false`（SET-02）
- [x] **导入导出 UI**：Data 分区可视化操作，含进度与结果，密钥排除提示常驻（SET-03）
- [x] **首启激活**：干净安装经 4 步向导在 <10 分钟出第一张图，可跳过（SET-04）
- [x] **seed 就绪**：完成引导后有 seed 文件夹/示例 prompt（依赖 LIB-15）
- [x] **备份**：自动备份在设置页可见，可手动备份与恢复，恢复防目录穿越/损坏库并保全当前库（SET-05）
- [x] **生成默认值**：默认 Provider + background + 每 Provider 成本单价接入历史看板（SET-06，2026-08-04 完成）
- [x] **外观**：主题跟随系统 + 减少动效三态 + 舒适/紧凑密度（SET-07）
- [x] **CSP**：主进程注入响应头，prod renderer 严格收口，media:// 正常；Provider https 请求留在主进程（SET-08）
- [x] **危险区**：清空数据双重确认 + 强制先备份，不动 Provider/密钥/计费设置/图片（SET-09）
- [x] **关于**：app + db schema 版本、许可证、随包文档/反馈入口与外链白名单（SET-10）
- [x] **安全总红线**：全流程中明文 API Key 永不入 DB / 不过 IPC 返回 / 不进日志 / 不进导出文件（贯穿 SET-01/02/04）
