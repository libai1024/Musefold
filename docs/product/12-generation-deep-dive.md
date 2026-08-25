# 12 · 生图与 Provider —— Deep Dive

> **大功能定位**：核心生产力主路径的**生产引擎**。把「库/画布里的提示词」变成「盘上的图 + 历史 + 成本」。用户 10 分钟激活闭环的最后一环：配 Key → 生图 → 存词。
> **本文遵循 [10-library-deep-dive.md](10-library-deep-dive.md) 的格式范例**（需求→现状→小功能→UI/UX→任务卡→依赖→验收）。
> 引用：`docs/05-image-generation.md`（工程规格）、`docs/07`（IPC 契约 §3.5/§3.6）、`docs/02`（providers 表 §2.5）、`docs/01`（安全边界/密钥生命周期）、`docs/10`（悟空生图组）、`docs/11`（TvT 网关）。心智锚点：[01-vision-and-ia.md](01-vision-and-ia.md) §5.3 / §6.1（Generate 顶层工作区，吸收 Studio/Chat）。

> **任务卡状态回写**：2026-08-04 · 基于源码实读 · 图例 ✅已完成 / 🚧进行中 / 📋未开始 / ⏸️阻塞

> **当前实现覆盖（本轮回写）**：Generate 已由统一 `GenerationWorkbench` 承载，不再以“快速=Studio、精修=GeneratePanel”作为业务模型；当前模式名称为「探索 / 制作」。旧 TASK-GEN-05/06 的历史描述保留用于追溯，实际 UI、交互和测试以 [18-generation-workbench-redesign.md](18-generation-workbench-redesign.md) 为准。旧 Chat/Studio 页面组件、`studio/store` 和 `generation/store` 中的旧生成状态/API 已删除，Library/History/Composer 正式入口直接使用 Workbench；`generation/store` 现在只保留 Provider 配置边界。图片产物链路已补齐：主进程统一任务/历史 ID，Provider 使用该 ID 落盘，结果卡与 History Lightbox 均经 `media://` 展示并提供系统图片操作。

---

## 1. 用户需求与竞品参照

### 1.1 用户故事

- 作为中转站用户，我要**粘贴一次 Key 就能出图**，不想读文档拼 base_url；配好后 App 记住它、下次直接用。
- 作为高频创作者，我在库里选中一条 prompt，点「⚡生成图像」就进**精修面板**，调好尺寸/质量点一下就出图，不用复制到别处。
- 作为谨慎用户，我要确信我的 **Key 不会明文落库、不会被日志泄露**，删掉 Provider 时密钥一起清干净。
- 作为等得着急的人，出图慢（悟空异步可能 30s+）时我要能**看到进度并随时取消**，取消后不留半成品、历史里有记录。
- 作为踩坑的人，Key 过期（401）/ 限流（429）/ 余额不足时，我要**明确知道是哪种错、下一步去哪**，而不是一句「生成失败」。
- 作为多后端用户，我同时配了 TvT（同步）和悟空生图组（异步），切 Provider 时 App **自动用对的调用方式和参数面**。

### 1.2 竞品参照与取舍

| 竞品做法 | 借鉴 | 取舍 |
|----------|------|------|
| MJ/Krea/Recraft：云端托管、开箱即出图 | 出图即得的顺滑感 | 我们**用户自带 Key 直调**，不做托管、不内置域名（合规 + 买断） |
| Draw Things/Fooocus：本地推理 + 详尽参数 | 参数可控 | 我们只暴露 gpt-image 系必要参数，克制不堆砌 |
| OneAPI/NewAPI 面板：多渠道管理 | 多 Provider + 测试连通 | 我们做**桌面原生 + 密钥系统级加密**，不做 Web 面板 |
| 各家「生成中转 SDK」：只给同步 images API | —— | 我们**工厂 + 注册表**兼容同步(OpenAI 兼容) 与异步(悟空 submit/poll) 两类形态 |

**结论**：生图引擎 = **「Provider 无关的直调层」× 「桌面级密钥安全」× 「同步/异步双形态兼容」**。差异化不在"能出图"，而在**配得快（预设一键）、切得顺（target 感知）、看得清（错误分类 + 成本账本）、退得干净（取消 + 失败入史）**。

### 1.3 中转站/API 接入参照 → Provider 预设映射

> 两个实测接入参考（`docs/10` 悟空、`docs/11` TvT）如何落到 `PROVIDER_PRESETS`（`shared/constants.ts`）与 `ProviderType`（`shared/types/enums.ts`）。二者是当前仅有的两个预设。

| 参考文档 | 站点/网关 | 调用形态 | 生图入口 | `model` 字段语义 | 尺寸语义 | 结果形态 | 预设（名称/id） | ProviderType |
|---|---|---|---|---|---|---|---|---|
| `docs/11` | TvT `ai.tvt.wiki` | **同步** OpenAI 兼容 | `POST /v1/images/generations` | 模型名 `gpt-image-2`（响应可能回显 `gpt-image-2-codex`） | 像素档 `size`（`1024x1024`…） | `b64_json`（PNG，直接落盘） | 「TvT AI 中转站」`tvt`（**默认/推荐**） | `openai-compatible` |
| `docs/10` | 悟空 `wkapi.vip` | **异步** 创作台生图组 | `submit` → `poll` → 下载 `url` | `product_id`（`image_gptImage2`…） | 比例 `size`（`"1:1"`/`"16:9"`） | 公网 `url`（下载后落盘） | 「悟空云 · 生图组」`wukong`（可选） | `wukong-studio` |

**接入关键差异（供 Provider/错误分类逻辑消费）**：

- **鉴权 header**：两家均 `Authorization: Bearer <KEY>`（悟空 poll **必须**带同一把 Key）。
- **错误分类锚点**：TvT `INVALID_API_KEY`/`API_KEY_REQUIRED` → `AUTH`；悟空 `No available channel ... under group 生图组` → `WRONG_GROUP`（分组错误，非普通鉴权），`402` → `NO_BALANCE`。
- **成功判定**：TvT 看 HTTP 200 + `data[0].b64_json`；悟空看 `status∈{succeeded…}` **且** 有 `url/result[0]`，**忽略 `message`**（成功任务也可能带"任务失败"文案，`docs/10` §7.3）。
- **超时**：TvT 生图 ≥120s；悟空 poll 间隔 2–3s、超时 120–180s。
- **成本**：TvT 按 size/quality 粗估（`estimateCost`）；悟空 `submit` 即预扣、读 `billing.yuan`（更准）。

---

## 2. 现状对照（设计 vs 实现）

> 依据代码实读（`electron/providers/*`、`electron/main/ipc/{images,providers}.ts`、`electron/security/keychain.ts`、`src/features/generation/*`）。图例：✅达标 🟡半成品 🔴未实现/死代码 🆕新增
| 小功能 | 设计要求 | 现状 | 结论 |
|--------|----------|------|------|
| providers 表 + CRUD IPC | `provider:list/create/update/delete` | ✅ `ipc/providers.ts` 齐全 | 达标 |
| Provider 预设一键接入 | 填好 baseUrl/model，仅粘 Key | ✅ 对话框预设 + 空态一键卡（Generate/Studio/Settings） | 达标 |
| 设为默认 / 多 Provider | `is_active` 单选 | ✅ `provider:setActive` 事务切换 | 达标 |
| 密钥 safeStorage 加密存储 | 明文不入 DB/IPC/日志 | 🟡 `keychain.ts` 用**同步** `encryptString`（`docs/05` §4.1 推荐 async），逻辑达标；需硬化验证 | 验证+硬化 |
| `hasKey`+`suffix` 查询 | 渲染进程只拿末 4 位 | ✅ `provider:hasKey` 只回 `{hasKey, suffix}` | 达标 |
| 测试连接 | `validateConnection` | ✅ 回传 `code` + `ValidationResultBanner` 按码给「更新密钥/去充值/查看说明/重试」 | 达标 |
| gpt-image-2 同步调用 | b64 落盘 `~/Pictures/PromptForge/` | ✅ `openai-compatible.ts` 跑通，写 `{historyId}.png` | 达标 |
| 悟空异步调用 | submit→poll→下载 | ✅ `wukong-studio.ts` 跑通（`docs/10` 实测） | 达标 |
| 失败/取消也写历史 | `status` 标记 + 可查 | ✅ `ipc/images.ts` catch 分支写 `failed`/`cancelled` | 达标 |
| 指数退避重试 | base 1s ×2 cap 30s jitter max3 + Retry-After | ✅ OpenAI/Wukong 统一接入；支持网络错误与 Retry-After；Workbench 显示第 n/3 次 | 达标 |
| **取消（AbortController）** | IPC→provider→SDK 单一 signal + 取消按钮 + history cancelled | ✅ Workbench 使用 `jobId`、`image:cancel` 和统一状态收尾；失败/取消均落 History | 达标 |
| **统一 Generate Workbench** | 探索/制作模式、时间线、Composer 和结果组 | ✅ `GeneratePage` 挂载 `GenerationWorkbench`；旧 Studio/Chat 页面与 `studio/store` 已删除 | 达标 |
| Generate 顶层工作区 | 顶部居中模式切换 + 当前会话历史 | ✅ 当前正式模式为「探索 / 制作」，支持上翻、回到最新和新会话 | 达标 |
| target 感知渲染 | 按 Provider 类型选 target 输出语法 | ✅ Composer 保存 Composition 渲染快照；Workbench 按 Provider 重渲染，手改后解除同步 | 达标 |
| 成本估算 | 每图/每 token 可配单价 → 成本看板 | ✅ 每 Provider 可配 per-image/per-1k-token；OpenAI-compatible 按单价写 `history.cost`，悟空读真实 `billing.yuan`；未配单价明确记 null 并提示「未配单价」 | 达标（GEN-13 / HIS-13） |
| CSP / 权限加固 | CSP 头 + 权限最小化 | ✅ 主进程按 dev/prod 注入 CSP；生产 renderer 仅可连接 self；权限默认拒绝；外链隔离；`media:` 白名单保留 | 达标 |
| media:// 图片展示 | 自定义协议渲染本地图 | ✅ `media-protocol.ts` + `toImageSrc`（防穿越 + MIME + 缓存） | 达标 |

**一句话**：**后端引擎、统一 Workbench、Provider 自动重试、Composition target 自动选择、图片产物管理、成本估算及 CSP/权限硬化已接通**；当前正式入口迁移和旧生成状态收口已完成，剩余是发布包、真实服务和目标平台验收。

---

## 3. 小功能拆解

| # | 小功能 | 优先级 | 任务卡 |
|---|--------|--------|--------|
| 1 | Provider CRUD 闭环 + 预设一键接入 + 首启空态引导 | P0 | [TASK-GEN-01](#task-gen-01) |
| 2 | 密钥安全（safeStorage 存取 + hasKey/suffix + 删除清理 + 硬化） | P0 | [TASK-GEN-02](#task-gen-02) |
| 3 | 测试连接 + 错误分类引导（401/403/429/余额/分组/网络） | P1 | [TASK-GEN-03](#task-gen-03) |
| 4 | gpt-image-2 生成调用形式化（model 可配 + 全参数） | P0 | [TASK-GEN-04](#task-gen-04) |
| 5 | Generate 统一 Workbench + 「探索/制作」模式 | P0 | [TASK-GEN-05](#task-gen-05) |
| 6 | 统一时间线与 Library/Composer/History 跨入口回填 | P0 | [TASK-GEN-06](#task-gen-06) |
| 7 | **修复取消**：单一 AbortController IPC→provider→SDK + 取消按钮 + history cancelled | P0 | [TASK-GEN-07](#task-gen-07) |
| 8 | 重试：指数退避 + Retry-After + 「重试中」UI | P1 | [TASK-GEN-08](#task-gen-08) |
| 9 | 多 Provider 注册表 + 工厂（可扩展；悟空为第二 Provider 范例） | P1 | [TASK-GEN-09](#task-gen-09) |
| 10 | target 自动选择（按 Provider 类型渲染 Composition） | P1 | [TASK-GEN-10](#task-gen-10) |
| 11 | 失败/取消入历史 + 从历史重试 | P0 | [TASK-GEN-11](#task-gen-11) |
| 12 | 图片产物管理（落盘 + media:// 展示 + 打开目录 + 复制路径） | P1 | [TASK-GEN-12](#task-gen-12) |
| 13 | 成本估算（每图/每 token 可配单价）→ 喂 13 成本看板 | P1 | [TASK-GEN-13](#task-gen-13) |
| 14 | CSP + 权限加固 | P1 | [TASK-GEN-14](#task-gen-14) |

---
## 4. UI/UX 设计

### 4.1 Generate 工作区（GeneratePage，🆕 顶层）

> 当前实现：Generate 是独立顶层导航，内含「探索」（ChatGPT 式、多图发散）/「制作」（参数收敛、单图定稿）两种模式。旧“快速/精修”只作为历史术语保留。

```
┌─ TitleBar ─────────────────────────────────────────────────────────┐
├─ Sidebar ─┬─ Generate 主区 ──────────────────────────────────────────┤
│ 创作      │ ┌ 顶栏 ────────────────────────────────────────────────┐ │
│  ⚡ 生成   │ │ ⚡ 生成   [ 快速 | 精修 ]        Provider [TvT ▾ ●] │ │
│ 工作区    │ └──────────────────────────────────────────────────────┘ │
│  📚 库    │ ┌ 精修 tab ────────────────┬─ 结果区 ───────────────────┐ │
│  🧩 画布  │ │ 来源: 电影感人像(库)  ✕   │  [▣ 生成中… 43%  ✕取消]    │ │
│  🕘 历史  │ │ 提示词 [────────────────] │  ┌────────┐ ┌────────┐     │ │
│ ─────    │ │        [────────────────] │  │ 成品图 │ │ 成品图 │     │ │
│ ⚙️ 设置   │ │ 负面   [────────────────] │  │ media://│ │ media://│     │ │
│          │ │ 比例[方图▾] 质量[高清▾]   │  └────────┘ └────────┘     │ │
│          │ │ 张数[×2▾]  背景[auto▾]    │  [🔁重试] [📂目录] [⧉路径] │ │
│          │ │ 预估成本 ≈ ¥0.30          │  历史缩略条 ▸▸▸             │ │
│          │ │ [⚡生成图像 ⌘↵]           │                            │ │
│          │ └──────────────────────────┴────────────────────────────┘ │
└──────────┴──────────────────────────────────────────────────────────┘
```

- **模式切换**：「探索」= 低门槛、多图比较；「制作」= 参数完整、单图收敛。二者共享 Workbench 时间线、Provider 和 `image:generate`，并分别保存模式偏好。
- **Provider 选择器**在顶栏常驻：下拉列出所有 Provider（含 `hasKey` 状态点），可就地 `openProviderDialog()` 新建/编辑。
- **精修入口**：Library 详情「⚡生成图像」/ Composer「生成」→ `setView('generate')` + 切「精修」+ 预填 `prompt/negative/params/promptId/compositionId`。

### 4.2 ProviderDialog（服务商配置对话框）

```
┌ 新建服务商 ─────────────────────────────────── ✕ ┐
│ 接入预设                                          │
│ ┌────────────────┐ ┌────────────────┐            │  ← 预设卡（点选填充）
│ │ TvT AI 中转站   │ │ 悟空云 · 生图组 │            │
│ │        [推荐]   │ │                 │            │
│ └────────────────┘ └────────────────┘            │
│ 💡 默认服务商 · OpenAI 兼容中转，出图快(10–30s)    │  ← activePreset.hint
│ 名称     [我的中转站________________]              │
│ Base URL [https://ai.tvt.wiki/v1___]              │
│ 模型/产品ID [gpt-image-2___________]              │  ← 悟空时标签变「产品 ID」
│ API Key  [••••••••••••••••••]  [👁]               │
│   🔒 密钥经系统级加密(Keychain/DPAPI)保存，        │  ← 安全说明常驻
│      仅主进程可解密，永不暴露给渲染进程或日志       │
│   ✓ 密钥已加密保存（····a1b2）                     │  ← 已存时
│ ┌──────────────────────────────────────────────┐ │
│ │ ✓ 连接成功，模型 gpt-image-2 可用（共 42 个）  │ │  ← 测试结果条
│ └──────────────────────────────────────────────┘ │
│                      [取消] [⚡测试连接] [保存]     │
└────────────────────────────────────────────────────┘
```

- **测试连接会先落库**（拿 `createdId`），避免「保存」时重复建条目（现 `ProviderDialog` 已如此，保留）。
- 悟空预设：`modelLabel='产品 ID'` + `modelHint`（image_gptImage2）。

### 4.3 关键交互与状态（生成过程）

| 场景 | 行为 |
|------|------|
| 无 Provider | 精修/快速面板空态：「尚未配置服务商」+ [添加第一个服务商]（开 `ProviderDialog`，首个自动 `isActive`） |
| 有 Provider 无 Key | 生成按钮禁用 + 提示「该服务商缺少密钥，去配置」；Provider 下拉项标 `(未配置 Key)` |
| 点生成 | 渲染端生成 `jobId` → `isGenerating=true` → 按钮变「生成中…」+ 出现 **[✕取消]** |
| 生成中（同步 TvT） | 按钮转圈；无细粒度进度（同步阻塞），显示「生成中…」+ 可取消 |
| 生成中（异步悟空） | 显示轮询态「排队/处理中…」；可取消（`api.image.cancel(jobId)`） |
| **重试中** | 命中 429/5xx：显示「限流，重试中（第 n/3 次）…」（TASK-GEN-08） |
| 点取消 | `api.image.cancel(jobId)` → 主进程 `controller.abort()` → provider 中止 SDK/fetch → history 记 `cancelled` → UI 回到 idle + toast「已取消」 |
| 成功 | 结果卡显示 `media://` 图；写 history(success)；刷新历史 store；显示成本/耗时 |
| 失败（可重试类） | 静默退避重试；耗尽后错误条 + [重试] |
| 失败（鉴权 401/403） | 错误条「密钥无效/已过期」+ [更新密钥]（开 `ProviderDialog` 到该 Provider） |
| 失败（余额不足） | 错误条「余额不足」+ [去充值]（`keyUrl`） |
| 失败（分组错误 悟空） | 错误条「Key 需属于『生图组』分组」+ 说明链接 |
| 图加载失败 | `<img onError>` → 美观兜底卡「图片无法加载/文件可能已被移动」（现 `GeneratePanel` 已有） |

### 4.4 GenerateResultCard（结果卡）

```
┌───────────────────────────────┐
│ [ media:// 生成图 ]           │
│                               │
├───────────────────────────────┤
│ 1024×1024 · 高清 · 4.2s        │  ← 参数 + 耗时
│ ≈ ¥0.40                        │  ← 成本（悟空用 billing.yuan）
│ [🔁重试] [📂打开目录] [⧉复制路径] │  ← 动作
│ [💾另存为 Prompt] [🕘 看历史]   │  ← 提升/账本入口
└───────────────────────────────┘
```

---
## 5. 任务卡（Task Cards）

> 规范见 [README §3](README.md)。Opus 按依赖顺序认领；完成后回写「状态」并勾选验收。所属大功能统一为 **Generation**。

### <a id="task-gen-01"></a>[TASK-GEN-01] Provider CRUD 闭环 + 预设一键接入 + 首启空态引导

- **状态**：✅ 已完成（2026-08-04：CRUD/预设/首个 isActive + ProviderEmptyGuide 双 tab/设置空态一键接入）
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：无（后端 `provider:*` 已存在）
- **预估**：M

**目标**：新用户能从"零 Provider"经预设一键填好接入信息、粘贴 Key、保存并设为默认，全程不查文档；已有用户能增删改。

**涉及文件**：
- `src/features/generation/components/ProviderDialog.tsx`（已具备，微调：首个自动 `isActive` 已在，补首启引导联动）
- `src/features/settings/sections/ProvidersSection.tsx`（已具备列表/空态；确认「添加第一个服务商」入口）
- `src/features/generation/store.ts`（`createProvider/updateProvider/deleteProvider/setActive` 已具备）
- `shared/constants.ts`（`PROVIDER_PRESETS`：TvT 默认推荐 + 悟空生图组）

**IPC 契约**（docs/07 §3.5，已存在）：`provider:list/create/update/delete/setActive`。

**交互与 UI/UX**：见 §4.2。预设卡点选填充 `type/name/baseUrl/model`；`activePreset.hint/modelLabel/modelHint/keyUrl` 随预设变化；首个 Provider 保存自动设默认。

**验收标准**：
- [x] 空态显示「还没有服务商」+ [添加第一个服务商]，点击开 `ProviderDialog`（含预设一键卡）
- [x] 选 TvT 预设 → 名称/baseUrl/model 自动填好，仅需粘 Key
- [x] 选悟空预设 → 模型字段标签变「产品 ID」，`model=image_gptImage2`
- [x] 保存首个 Provider 自动 `isActive`，侧栏底部状态卡显示其名 + 绿点
- [x] 编辑改名/base_url/model 持久化；删除后从列表消失且其密钥被清（见 TASK-GEN-02）

**测试场景**：
1. 正常：预设 TvT → 粘 Key → 保存 → 列表出现 + 设为默认。
2. 边界：连续建 2 个 Provider，`is_active` 始终单选（切换互斥）。
3. 异常：base_url 留空 → 保存禁用；`create` IPC reject → 不清空表单 + 错误提示。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 95/95（含 `presets.test.ts`）

---

### <a id="task-gen-02"></a>[TASK-GEN-02] 密钥安全（safeStorage 存取 + hasKey/suffix + 删除清理 + 硬化）

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：无
- **预估**：S

**目标**：API Key 只经系统级加密存于 electron-store，明文**永不入 DB、永不过 IPC 返回、永不进日志**；删除 Provider 连带清密钥。对齐 `docs/05` §4.2 安全红线与 `docs/01` §3。

> **安全红线（不可妥协，`docs/01` §3 / `docs/05` §4.2）**：
> - 明文 key 只在主进程 Provider 实例内存中短暂存在，请求后释放；`provider:list`/`get` 永不含 `apiKey`。
> - 渲染进程要密钥信息只调 `provider:hasKey`，仅拿 `{hasKey, suffix(末4位)}`。
> - **网络暴露安全提示**：Key 仅 OS 级加密（Keychain/DPAPI），本 App 不引入任何服务端代理、不上传 Key、不建任何无鉴权的本地网络端点承载密钥。若未来加任何监听端口，必须显式带访问控制——**不得静默创建无鉴权通道**。

**涉及文件**：
- `electron/security/keychain.ts`（现用同步 `encryptString`；确认可用性，或按 `docs/05` §4.1 迁移到 `encryptStringAsync`）
- `electron/main/ipc/providers.ts`（`saveKey/hasKey`，delete 时 `deleteApiKey` 已在）
- `electron/system/logger.ts`（审计：确认 key 相关操作不落明文）

**IPC 契约**（docs/07 §3.5，已存在）：`provider:saveKey`、`provider:hasKey`。

**验收标准**：
- [x] `provider:list` / `provider:create` / `update` 响应体中**无** `apiKey` 字段（类型层 `ProviderConfig` 已无，运行时也确认）
- [x] 保存 Key 后 `hasKey=true` + `keySuffix` 为末 4 位；DB `providers` 表无明文列
- [x] `saveApiKey` 前检查 `isEncryptionAvailable()`，不支持时明确报错不静默降级
- [x] 删除 Provider → `deleteApiKey` 清除 electron-store 对应键
- [x] 全链路日志（`logger`）grep 不到完整 Key（只允许 suffix）

**测试场景**：
1. 正常：存 Key → `hasKey`/suffix 正确 → 重启 App 仍可解密生图。
2. 边界：Key 长度 < 4 → suffix 返回 null 不报错。
3. 异常：`safeStorage` 不可用（模拟）→ `saveKey` reject 明确错误，UI 提示。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] 手工审计 + E2E：搜索日志/DB/IPC 响应无明文 key

---
### <a id="task-gen-03"></a>[TASK-GEN-03] 测试连接 + 错误分类引导

- **状态**：✅ 已完成（2026-08-04：`ValidationResult.code` + `errorGuidance` 动作条；Dialog/设置页接线；91 单测）
- **优先级**：P1
- **所属大功能**：Generation
- **依赖**：TASK-GEN-01
- **预估**：M

**目标**：测试连接把归一化错误码翻成用户看得懂的中文 + **可执行的下一步**（更新 Key / 换生图组 / 去充值 / 重试），而不只是一句失败。

**涉及文件**：
- `electron/providers/openai-compatible.ts`（`normalizeError` 已产 AUTH/RATE_LIMIT/SERVER/NO_BALANCE/BAD_REQUEST）
- `electron/providers/wukong-studio.ts`（`normalizeStudioError` 已产 WRONG_GROUP/NO_BALANCE 等）
- `src/features/generation/components/ProviderDialog.tsx`（结果条按 code 给引导按钮）
- `src/features/settings/sections/ProvidersSection.tsx`（`testProvider` 结果展示，已具备基础；卡片级「测试全部」批量入口已随 v2 设置整合移除）

**IPC 契约**（docs/07 §3.5）：`provider:validate` → `ValidationResult { ok, message, code?, models? }`。

**错误分类 → 引导**（对齐 `docs/05` §5、`docs/11` §8、`docs/10` §10）：

| code | 触发 | 用户提示 | 下一步 |
|---|---|---|---|
| `AUTH` | 401/403 / INVALID_API_KEY | 密钥无效或已过期 | [更新密钥] |
| `WRONG_GROUP` | 悟空「非生图组」 | Key 需属于「生图组」分组 | 查看说明(keyUrl) |
| `RATE_LIMIT` | 429 | 请求过于频繁 | 稍后重试 |
| `NO_BALANCE` | 余额/配额不足 / 402 | 余额不足 | [去充值](keyUrl) |
| `SERVER`/网络 | 5xx / 超时 | 服务暂不可用 | [重试] |
| `BAD_REQUEST` | 400 | 参数或模型名有误 | 检查模型/参数 |

**验收标准**：
- [x] 测试连接成功显示模型可用性（openai 探测 `/models`；悟空探测 catalog + poll 鉴权）
- [x] 4 类关键错误（AUTH/WRONG_GROUP/NO_BALANCE/SERVER）各有对应中文 + 引导动作
- [x] AUTH 错误的 [更新密钥] 直接打开该 Provider 的 `ProviderDialog`（列表）/ 聚焦密钥框（对话框内）
- [x] 无密钥的 Provider 测试直接 `skipped`（不发必然失败的请求，现 `testProvider` 已如此）

**测试场景**：
1. 正常：有效 Key → ok + 模型数。
2. 边界：中转站禁用 `/models` → 降级「已配置，将在生图时验证」。
3. 异常：错 Key → AUTH + [更新密钥]；悟空非生图组 → WRONG_GROUP 引导。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] `npm test` 91/91（含 `shared/__tests__/errors.test.ts`）

---

### <a id="task-gen-04"></a>[TASK-GEN-04] gpt-image-2 生成调用形式化

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：TASK-GEN-01, TASK-GEN-02
- **预估**：S（后端已跑通，本卡形式化 + 参数对齐）

**目标**：生图调用把 `model` 当**用户可配字符串**（不硬编码 gpt-image-2），完整透传 size/quality/n/background/moderation；OpenAI 若出新模型改配置即可，App 零改动（`docs/05` §3.3）。

**涉及文件**：
- `electron/providers/openai-compatible.ts`（`generateImage` 已透传 model/size/quality/background/moderation；确认 n 透传）
- `electron/main/ipc/images.ts`（`generate` 写 history + params 快照，已具备）
- `shared/types/providers.ts`（`GenerateImageRequest` 已含全字段）

**IPC 契约**（docs/07 §3.6，已存在）：`image:generate` → `GenerateImageResult`。

**验收标准**：
- [x] `model` 取 `req.model ?? provider.model`，可为任意字符串（不校验白名单）
- [x] size/quality/n 透传；background/moderation 仅在提供时附加（避免旧中转站报错）
- [x] 成功：`data[0].b64_json` 解码写 `~/Pictures/PromptForge/{historyId}.png`，文件可打开（本机 OpenAI-compatible fake Provider 验证）
- [x] 响应无图像数据 → 明确报错「响应中没有图像数据」
- [x] params 快照写入 history（size/quality/n/background/moderation）

**测试场景**：
1. 正常：TvT + gpt-image-2 + 1024x1024 → 出图落盘 + history(success)。
2. 边界：`model` 改成 `gpt-image-2-codex` 仍工作（不硬编码）。
3. 异常：中转站不认 `background` → 不附加该字段时成功。

**质量门禁**：`npm run typecheck` + 本机 OpenAI-compatible fake Provider 出图链路已通过；2026-08-06 真实 TvT 单图、落盘、`media://`、History、成本与 duration 已通过 live E2E，见 [18-generation-workbench-redesign](18-generation-workbench-redesign.md) §17.3。

---
### <a id="task-gen-05"></a>[TASK-GEN-05] Generate 统一创作台 + 「探索/制作」模式

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04
- **预估**：L

**目标**：由一个 ChatGPT 风格 Workbench 承载探索和制作，统一时间线、Composer、Provider、取消/重试和 History；旧 Studio/Chat 页面与独立 Studio 状态源已清理。

**涉及文件**：
- `src/stores/app.ts`（`ViewKey` 加 `'generate'`；默认落地保持既有决策）
- `src/pages/GeneratePage.tsx`（统一挂载 `GenerationWorkbench`）
- `src/components/layout/Sidebar.tsx`（导航加「⚡ 生成」项，图标 `Wand2`/`Zap`）
- `src/features/generation/workbench/*`（正式会话、时间线、Composer 和结果组）

**IPC 契约**：无新增（复用 `image:generate`）。

**交互与 UI/UX**：见 §4.1。tab 状态在会话内保持；从库/画布进入自动切「精修」；两 tab 共享 `useGenerationStore` 与生成默认值。

**验收标准**：
- [x] 侧栏出现「生成」，点击进 GeneratePage
- [x] 「探索」模式渲染对话式时间线能力（即输即生 + 批量），功能不回退
- [x] 「制作」模式渲染参数化输入区且**被真实挂载**（旧 `GeneratePanel` 仅作迁移兼容层）
- [x] 两模式切换保留当前草稿；共用同一激活 Provider
- [x] Studio 不再作为割裂顶层（`docs/01` §5.3 归并）

**测试场景**：
1. 正常：进 Generate → 精修 tab 输入 prompt → 生成出图。
2. 边界：快速/精修间切换，prompt 各自保留不串。
3. 异常：无 Provider 时两 tab 都显示空态引导。

**质量门禁**：`npm run typecheck` + Workbench E2E 验证双模式切换、无 Provider 空态与生成链路。

---

### <a id="task-gen-06"></a>[TASK-GEN-06] 统一时间线与跨入口回填

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：TASK-GEN-05
- **预估**：M

**目标**：精修 tab 能被 Library 详情「⚡生成图像」和 Composer「生成」喂入——预填 `prompt/negative/params` 与来源 id（`promptId`/`compositionId`），参数面板完整可调。**这是主路径「Library/Composer→Generate」的落点**（对接 [TASK-LIB-09](10-library-deep-dive.md#task-lib-09)）。

**涉及文件**：
- `src/features/generation/components/GeneratePanel.tsx`（`initialPrompt/initialNegative/promptId` 已有 props；补 `compositionId` + 参数预填 + 来源 chip）
- `src/features/generation/store.ts`（补「待生成载荷」入口：设 view=generate + 切精修 + 预填）
- `src/pages/LibraryPage.tsx` / `ComposerPage.tsx`（生成入口调该 store action）

**IPC 契约**：无新增；生图带 `promptId`/`compositionId` 写历史来源。

**交互与 UI/UX**：见 §4.1。来源显示为可清除的 chip「来源: 电影感人像(库) ✕」；`params` 优先用 prompt 自带（`docs/settings` 说明：库参数覆盖默认值）。

**验收标准**：
- [x] 库详情「生成图像」→ 进 Generate 制作 + 预填正文/负面/参数 + `promptId`
- [x] Composer「生成」→ 预填渲染结果 + `compositionId`
- [x] 生成成功后 history 记录带正确来源 id
- [x] 清除来源 chip 不清空已填文本（仅解绑来源）
- [x] 参数面板：比例/质量/张数/背景/审核可调，默认取生成默认值

**测试场景**：
1. 正常：库选一条 → 生成 → history 来源=该 prompt。
2. 边界：prompt 自带 params 时覆盖默认比例。
3. 异常：来源 prompt 已删 → 仍可用快照文本生成（来源 id 置空）。

**质量门禁**：`npm run typecheck` + Library/Composer/Workbench E2E 覆盖库→生成、画布→生成、来源解绑与 History 来源快照。

---

### <a id="task-gen-07"></a>[TASK-GEN-07] 修复取消：单一 AbortController IPC→provider→SDK + 取消按钮 + history cancelled

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04
- **预估**：M

**目标**：让"取消"在**精修面板**真正可用——渲染端生成 `jobId` 并透传，出现取消按钮，点它经 `image:cancel` 中止在途 SDK/fetch 调用，历史记 `cancelled`。

> **现状诊断（实读代码）**：后端**已具备**单一 AbortController 链路——`ipc/images.ts` 为每个 `jobId` 建 `controller`、存 `abortControllers` map、把 `controller.signal` 透传给 `provider.generateImage(req, signal)`；`openai-compatible.ts`/`wukong-studio.ts` 都把该 signal 并入内部 controller 再传给 `client.images.generate({signal})`/`fetch`。**Studio 路径已用对**（`studio/store.ts` 生成 `jobId`、记 `activeJobId`、`cancel()` 调 `api.image.cancel`）。**真正的 gap 在精修侧**：`generation/store.ts` 的 `generate()` 不生成/不传 `jobId`、无 `cancel` action；`GeneratePanel` 无取消按钮。本卡把 Studio 已验证的模式补到精修链路。

**涉及文件**：
- `src/features/generation/store.ts`（`generate` 生成 `jobId`、记 `activeJobId`；新增 `cancel()` 调 `api.image.cancel(jobId)`；`isGenerating`/取消态）
- `src/features/generation/components/GeneratePanel.tsx`（生成中显示 [✕取消]，绑 `cancel()`；`Esc` 取消，见 `docs/01` §6.3）
- `electron/main/ipc/images.ts`（**已具备**，仅验证 map 清理与 cancelled 写史）
- `electron/providers/{openai-compatible,wukong-studio}.ts`（**已具备** signal 并入）

**IPC 契约**（docs/07 §3.6，已存在）：`image:generate`（带 `jobId`）、`image:cancel { jobId }`。

**验收标准**：
- [x] 制作生成时渲染端生成 `jobId` 并随 `image:generate` 传入
- [x] 生成中出现取消按钮；`Esc` 亦可取消
- [x] 点取消 → `image:cancel(jobId)` → 主进程 `controller.abort()` → SDK/fetch 中止
- [x] 取消后 history 记 `status='cancelled'`（非 failed），错误码 `CANCELLED`
- [x] 取消后 UI 回 idle + toast「已取消」，`abortControllers` map 清理无泄漏
- [x] 悟空异步：取消在 submit/poll/下载任一阶段都能中止（代码路径统一监听 signal）

**测试场景**：
1. 正常：TvT 生成中点取消 → 立即回 idle + history cancelled。
2. 边界：出图返回瞬间点取消 → 不产生半成品文件 / 或已成功则正常入史（竞态可接受，不崩）。
3. 异常：取消一个已结束的 jobId → `image:cancel` 幂等返回 ok，不报错。

**质量门禁**：
- [x] `npm run typecheck` 通过
- [x] E2E 验证 OpenAI-compatible 取消 + history `cancelled`；悟空异步链路在 provider 层共享同一 AbortController/signal 设计

---
### <a id="task-gen-08"></a>[TASK-GEN-08] 重试：指数退避 + Retry-After + 「重试中」UI

- **状态**：✅ 已完成（2026-08-04；OpenAI/Wukong/IPC/Workbench 全链路验收）
- **优先级**：P1
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04, TASK-GEN-07
- **预估**：M

**目标**：429/5xx/网络错误自动指数退避重试（base 1s ×2 cap 30s + 0-1s 抖动 max 3，尊重 `Retry-After`），并把「重试中（第 n/3 次）」透出到 UI（`docs/05` §5/§5.1、§9）。

**涉及文件**：
- `electron/providers/retry.ts`（统一 429/5xx/网络错误、Retry-After、指数退避、抖动、取消和进度回调）
- `electron/providers/openai-compatible.ts`（关闭 SDK 隐式重试，避免绕过统一进度；在重试器内归一化错误）
- `electron/providers/wukong-studio.ts`（submit/poll 分别接入统一重试）
- `electron/main/ipc/images.ts` + `shared/types/{ipc,providers}.ts` + `electron/preload/index.ts`（`image:progress` 主→渲染事件）
- `src/features/generation/workbench/store.ts`、`types.ts`、`GenerationWorkbench.tsx`（按 jobId 映射并显示重试次数）

**IPC 契约**：已新增 `image:progress`（主→渲染 push，`{ jobId, phase:'retrying', attempt, maxRetries, delayMs, status? }`），preload 暴露 `image.onProgress()` 并返回取消订阅函数。

**验收标准**：
- [x] 429 命中 → 尊重 `Retry-After` 头延迟；无该头则指数退避
- [x] 5xx/网络错误重试；400/401/余额不足**不重试**（对齐 `docs/05` §5 表）
- [x] 最多 3 次，耗尽后按最终错误分类展示
- [x] UI 显示「重试中（第 n/3 次）」
- [x] 悟空 submit/poll 的瞬时 5xx 也走退避

**测试场景**：
1. 正常：模拟 429+Retry-After:2 → 2s 后重试成功。
2. 边界：连续 3 次 5xx → 第 4 次放弃并报 SERVER。
3. 异常：401 → 立即失败不重试。

**质量门禁**：`retry.test.ts` 覆盖 Retry-After、5xx 四次请求、401 早退和网络恢复；`wukong-studio.test.ts` 覆盖 submit/poll 503 恢复与 401 早退；工作台 E2E 覆盖可见重试状态和最终成功。

---

### <a id="task-gen-09"></a>[TASK-GEN-09] 多 Provider 注册表 + 工厂（可扩展）

- **状态**：✅ 已完成
- **优先级**：P1
- **所属大功能**：Generation
- **依赖**：无
- **预估**：S（已实现，本卡形式化 + 加测）

**目标**：新增 Provider 类型不改核心——工厂 + 注册表（`docs/05` §2.2）。悟空生图组即第二 Provider 的活样例（异步形态）。

**涉及文件**：
- `electron/providers/registry.ts`（`createProvider` + `registry` Map，已实现：openai/openai-compatible→OpenAICompatibleProvider，wukong-studio→WukongStudioProvider）
- `electron/providers/base.ts`（`BaseProvider` 抽象，已实现）
- `shared/types/enums.ts`（`ProviderType` 已含 `wukong-studio`）

**IPC 契约**：无。

**验收标准**：
- [x] `createProvider(type, ...)` 按 type 返回对应实例，未知 type 明确抛错
- [x] 新增一个假想 type 只需注册一个 factory，不动 `ipc/images.ts`/`providers.ts`
- [x] `openai` 与 `openai-compatible` 共用 `OpenAICompatibleProvider`
- [x] 悟空作为异步形态样例：同一 `ImageProvider` 接口下 submit/poll/下载

**测试场景**：
1. 正常：三种 type 各建实例成功。
2. 边界：注册新 factory 后即可用。
3. 异常：未知 type → `Unknown provider type` 抛错。

**质量门禁**：`npm run typecheck` + registry 单测（三类型解析 + 未知抛错）。

---

### <a id="task-gen-10"></a>[TASK-GEN-10] target 自动选择（按 Provider 类型渲染 Composition）

- **状态**：✅ 已完成（2026-08-04；Composition 快照、Provider 映射、切换同步和 History 关联已验收）
- **优先级**：P1（差异化，关联 [15](15-differentiators-deep-dive.md)）
- **所属大功能**：Generation
- **依赖**：TASK-GEN-06
- **预估**：M

**目标**：从 Composer/带组合来源生图时，**按选中 Provider 的类型自动选对应 `PromptTarget`** 渲染 Composition——openai→自然语言无权重、a1111/comfyui→`(word:1.5)`、midjourney→`word::15`、flux/sd3→自然语言。用户无需手动切语法（`docs/05` §7，护城河 `docs/01` §4.1）。

**涉及文件**：
- `src/features/generation/target.ts`（Provider type → PromptTarget 映射、Composition 快照创建与重渲染）
- `src/features/composer/engine/*`（复用现有 parser/renderer/negative target 序列化）
- `src/features/composer/components/PreviewPanel.tsx`（送入制作前保存 Composition 和渲染快照）
- `src/features/generation/workbench/{types.ts,store.ts,GenerationWorkbench.tsx}`（Provider 切换/提交前重渲染；手改后解除自动同步）

**Provider type → target 映射**：

| Provider type | 默认 target | 权重语法 |
|---|---|---|
| `openai` / `openai-compatible`(gpt-image) | `openai` | 自然语言，无权重 |
| `wukong-studio`(gpt-image) | `openai` | 自然语言 |
| （未来 a1111/comfyui） | `a1111` | `(word:1.5)` |
| （未来 midjourney） | `midjourney` | `word::15` |

**验收标准**：
- [x] 从 Composition 来源生图时，target 按激活 Provider 类型自动选
- [x] 切换 Provider 类型 → Workbench prompt 按新 target 重渲染
- [x] gpt-image 系不输出权重括号（自然语言）
- [x] 纯文本 prompt（非 Composition 来源）不受影响；用户手改 Composition 正文后也不再自动覆盖

**测试场景**：
1. 正常：同一 Composition，openai Provider 输出自然语言。
2. 边界：无组合来源的手写 prompt 原样透传。
3. 异常：未知 target 回退 `generic`。

**质量门禁**：`target.test.ts` 覆盖当前 Provider、未来 target、未知回退及 OpenAI/A1111/Midjourney 语法；Workbench store 测试覆盖切换和手改解绑；Electron E2E 验证 A1111 预览→OpenAI 自然语言、真实 composition_id、Provider 请求和 History 快照一致。

---
### <a id="task-gen-11"></a>[TASK-GEN-11] 失败/取消入历史 + 从历史重试

- **状态**：✅ 已完成
- **优先级**：P0
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04, TASK-GEN-07
- **预估**：S（后端已具备，本卡验证 + 补从历史重试入口）

**目标**：成功/失败/取消的每次生图都写 `history`（带 status + 错误码 + 参数快照），失败/取消项可「用原参数重试」（`docs/05` §5.4/§6）。关联 [13-history](13-history-deep-dive.md)。

**涉及文件**：
- `electron/main/ipc/images.ts`（`generate` 成功/失败/取消三分支写 history，已具备；`image:retry` 用原 history 行重建 req，已具备）
- `src/features/history/*` + `GeneratePanel.tsx`（失败结果卡 [重试] → `api.image.retry(historyId)`）

**IPC 契约**（docs/07 §3.6/§3.7）：`image:retry { historyId }`、`db:history:list/get`。

**验收标准**：
- [x] 成功 → history(success, image_path, cost, duration)
- [x] 失败 → history(failed, error_code, error_message, params 快照)
- [x] 取消 → history(cancelled)（非 failed）
- [x] prompt_text/negative_text 为**快照**（后续编辑源 prompt 不影响历史）
- [x] 从历史「重试」用原参数重新发起，产生新 history 行

**测试场景**：
1. 正常：成功一张 → 历史可见缩略 + 成本。
2. 边界：改了源 prompt 后看旧历史仍是当时快照。
3. 异常：重试一条 failed → 新行；源 prompt 已删仍可重试（快照）。

**质量门禁**：`npm run typecheck` + Generate/History E2E 覆盖成功、失败、取消、快照和重试新行。

---

### <a id="task-gen-12"></a>[TASK-GEN-12] 图片产物管理（落盘 + media:// + 打开目录 + 复制路径）

- **状态**：✅ 已完成（2026-08-05：统一 Workbench/History 图片产物链路与系统图片操作已通过无真实 API 回归）
- **优先级**：P1
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04
- **预估**：S

**目标**：生成图统一落 `~/Pictures/PromptForge/`，经 **media:// 协议**渲染（非 file://，Chromium 会拒 http 源加载 file://，见 memory + `media-protocol.ts`），结果卡提供打开目录 / 复制路径。

**涉及文件**：
- `electron/main/media-protocol.ts`（自定义协议，已实现：防穿越 + MIME + 缓存）
- `src/lib/media.ts`（`toImageSrc` 已实现：file://→media://）
- `electron/main/ipc/system.ts`（`system:openInFolder`，docs/07 §3.8）
- `src/features/generation/workbench/GenerationWorkbench.tsx`、`src/features/generation/components/GenerateResultCard.tsx`（结果卡动作）
- `src/features/chat/components/ImageLightbox.tsx`、`src/pages/HistoryPage.tsx`（History/Workbench 共用 Lightbox）
- `electron/system/image-actions.ts`（图片文件校验与系统另存）

**IPC 契约**（docs/07 §3.8）：`system:openInFolder { path }`；复制路径走渲染进程剪贴板。

**验收标准**：
- [x] 生成图经 `toImageSrc()` → `media://local/?p=...` 正常显示（dev + prod 一致）
- [x] 图片落盘 `~/Pictures/PromptForge/{historyId}.png`；任务、历史、返回值和文件名使用同一 ID
- [x] [打开目录] 调 `system:openInFolder` 在文件管理器定位
- [x] [复制路径] 写剪贴板 + toast
- [x] 文件缺失 → `<img onError>` 美观兜底（结果卡与 Lightbox 均覆盖）
- [x] media:// 仅允许读白名单根目录（防目录穿越）

**测试场景**：
1. 正常：生成 → 显示 → 打开目录定位到文件。
2. 边界：路径含中文/空格 → encodeURIComponent 正常。
3. 异常：手动删图后重看 → 兜底卡，不崩。

**质量门禁**：
- [x] `npm run typecheck`、`npm run check` 通过
- [x] `tests/e2e/test_04_generate.py` + `tests/e2e/test_08_generation_workbench.py`：33 passed
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：218 passed，6 skipped

---

### <a id="task-gen-13"></a>[TASK-GEN-13] 成本估算（可配单价）→ 喂成本看板

- **状态**：✅ 已完成（2026-08-05：HIS-13/SET-06 已交付每 Provider 单价、OpenAI-compatible 写 `history.cost`、悟空真实 billing、未配单价记 null 的明确口径）
- **优先级**：P1（关联 [13-history](13-history-deep-dive.md) 成本看板）
- **所属大功能**：Generation
- **依赖**：TASK-GEN-04
- **预估**：M

**目标**：每次生图估算成本（分）写入 history.cost，供 13 的成本看板累计；单价**可按 Provider 配置**（每图 / 每千 token），悟空优先用真实 `billing.yuan`（`docs/05` §8、`docs/10` §6.3）。

**完成记录**：本卡代码实际已由 HIS-13 / SET-06 交付。`shared/pricing.ts` 提供单价校验和 per-image / per-1k-token 估算；`electron/settings/pricing.ts` 以 `pricing.{providerId}` 存 electron-store；`ProviderDialog` 暴露计费单价 UI；`openai-compatible` 生成成功后读取 Provider 单价并写入 result/history cost；`wukong-studio` 保留真实 `billing.yuan × 100`。产品口径调整为「未配单价不猜价」：cost 记 `null`，History 单条和聚合看板按 0 统计并提示「未配单价」，避免用 size/quality 默认系数误导用户。

**涉及文件**：
- `electron/providers/openai-compatible.ts`（已改：读 Provider 单价配置；per-image 直接按张数，per-1k-token 需 usage）
- `electron/providers/wukong-studio.ts`（已读 `billing.yuan`→分，保留）
- `electron/main/ipc/settings.ts` / `electron/settings/pricing.ts`（已新增：`settings:pricing:*`，存 electron-store `pricing.{providerId}`）
- 关联 `db:history` cost 字段

**IPC 契约**：已采用 `settings:pricing:get/set/delete`，不扩展 `provider:update`，避免把偏好配置写进 providers 表。

**验收标准**：
- [x] gpt-image 系按可配单价估算；未配单价不猜价，记 `null` 并在 History 显示「未配单价」
- [x] 悟空用 `billing.yuan × 100` 作为准确成本（分）
- [x] cost 写入 history，可被 13 看板按日/周/月累计
- [x] 单价可在设置中按 Provider 配置

**测试场景**：
1. 正常：生成一张 → history.cost 合理。
2. 边界：未配单价 → cost=null，History 显示「未配单价」，聚合按 0 统计。
3. 异常：每千 token 单价但 Provider 未返回 usage → cost=null，不崩溃。

**质量门禁**：
- [x] `npm run check`：30 个 Vitest 文件 / 216 项通过，包含 `shared/__tests__/pricing.test.ts` 和成本格式单测
- [x] `tests/e2e/test_04_generate.py::test_provider_pricing_ui_and_history_cost` 已覆盖 UI 校验、非法 IPC、per-image 写 cost、per-token 缺 usage 记 null、未配置单价记 null
- [x] `env -u PF_TVT_KEY .venv-test/bin/python -m pytest tests/e2e -q`：历史基线 224 passed，6 skipped（584.91 秒）；当前全量回归 251 passed，6 skipped，0 failed（636.19 秒）

---

### <a id="task-gen-14"></a>[TASK-GEN-14] CSP + 权限加固

- **状态**：✅ 已完成（2026-08-04）
- **优先级**：P1（工程）
- **所属大功能**：Generation
- **依赖**：TASK-GEN-12
- **预估**：M

**目标**：补齐内容安全策略与权限最小化，收敛渲染进程能力面（`docs/05` §4.2 红线延伸）。

> **安全说明**：本 App 不创建任何网络监听端点；CSP 目标是限制渲染进程只能连必要来源、加载 `media://`/`self` 资源。**不得为方便而放开 `webSecurity` 或加无鉴权本地端点。**

**涉及文件**：
- `electron/main/csp.ts`（纯函数组装 dev/prod CSP，便于单测）
- `electron/main/window.ts`（注入 CSP；保持 `contextIsolation/sandbox/nodeIntegration:false`；拦截新窗口和外部导航）
- `electron/main/index.ts`（权限检查与请求均默认拒绝，仅允许受控 `clipboard-sanitized-write`）
- `electron/main/media-protocol.ts`（`media:` 以 `secure`/`standard` 特权协议注册，并校验可访问根目录）
- `electron/main/__tests__/csp.test.ts`、`tests/e2e/test_04_generate.py`（策略单测与 Electron 安全 E2E）

**CSP 实现**（生产）：`default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: blob: media:`。Provider 请求由主进程经 IPC 发起，不受 renderer CSP 限制，因此无需向任意 `https:` 放开渲染进程；dev 仅增加当前 Vite/HMR 的精确 http/ws origin。

**验收标准**：
- [x] 生产环境响应带 CSP 头，`media:` 图片正常加载
- [x] 无关权限请求（相机/麦克风/地理位置/通知）默认拒绝
- [x] `webSecurity` 保持开启（不为加载本地图而关闭，使用 `media://`）
- [x] 外部导航/新窗口被拦截，http(s) 外链交给系统浏览器
- [x] dev 下 HMR/Vite 不被 CSP 破坏（dev 精确放行，prod 收紧）

**测试场景**：
1. 正常：prod 构建生成图正常显示（media: 未被 CSP 拦）。
2. 边界：自配中转站由主进程 Provider 请求，不扩大 renderer `connect-src`。
3. 异常：页面内 `<script>` 注入被 CSP 拦截；相机权限被拒。

**质量门禁**：`npm run check` 通过（23 个 Vitest 文件、190 项）；CSP 单测 3 项通过；Electron 安全 E2E 5 项通过；完整无真实 API E2E 186 passed / 6 skipped / 0 failed。

---
## 6. 依赖关系图

```
GEN-01(Provider CRUD+预设+引导) ─┬─→ GEN-02(密钥安全)
                                 ├─→ GEN-03(测试连接+错误分类)
                                 └─→ GEN-04(gpt-image-2 调用) ─┬─→ GEN-05(Generate 工作区/双 tab·修死代码)
                                                                │        └─→ GEN-06(精修·库/画布喂入) ─→ GEN-10(target 自动选择)
                                                                ├─→ GEN-07(★修复取消·AbortController+按钮+cancelled)
                                                                │        └─→ GEN-08(重试+重试中 UI)
                                                                ├─→ GEN-11(失败/取消入史+从史重试)
                                                                ├─→ GEN-12(图片产物 media://) ─→ GEN-14(CSP 加固)
                                                                └─→ GEN-13(成本估算) ──关联→ 13-history 成本看板
GEN-09(注册表+工厂) 独立（已实现，形式化+加测）
GEN-10 ──关联→ 15-differentiators（多 target 序列化护城河）
GEN-06 ──关联→ 10-library §TASK-LIB-09（生成入口）· 11-composer（生成）
```

**建议认领顺序（P0 优先打通激活闭环）**：GEN-01 → GEN-02 → GEN-04 → GEN-05 → GEN-06 / GEN-07 → GEN-11，之后 GEN-03/08/09/10/12/13/14。

---

## 7. 大功能验收（对照 docs/05 §9 + 本设计扩展）

- [x] Provider 配置：保存后 `hasKey=true`，明文不入 DB（GEN-01/02）
- [x] 密钥安全：渲染进程查询只返回 `hasKey`+`keySuffix`，明文永不离开主进程、不进日志（GEN-02）
- [x] 预设一键接入：TvT/悟空生图组预设填好，仅需粘 Key（GEN-01）
- [x] gpt-image-2 调用成功：b64 解码写盘，文件可打开（本机 fake Provider；2026-08-06 真实 TvT 单图验收 4 passed）
- [x] 悟空异步生图：submit→poll→下载落盘，以 status+url 判定成功（provider 单测）
- [x] 429/5xx 重试：指数退避最多 3 次，UI 显示「重试中」（GEN-08）
- [x] 401 鉴权失败：明确提示更新 Key，不重试（GEN-03/08）
- [x] 余额不足/分组错误：明确引导（充值 / 换生图组），不重试（GEN-03）
- [x] **取消：AbortController 生效（IPC→provider→SDK 单一 signal），制作有取消按钮，history 记 cancelled（GEN-07）**
- [x] **Generate 顶层工作区落地，探索/制作模式共用 Workbench 时间线（GEN-05）**
- [x] 库/画布/历史→创作台回填正文/参数/来源 id（GEN-06）
- [x] 失败/取消任务存历史：可查看错误码并重试（GEN-11）
- [x] 生成图经 media:// 显示、可打开目录/复制路径（GEN-12）
- [x] target 感知：按 Provider 类型自动选渲染语法（GEN-10）
- [x] 成本估算写入 history，喂 13 成本看板（GEN-13）
- [x] CSP + 权限最小化，未静默创建无鉴权网络端点（GEN-14）
