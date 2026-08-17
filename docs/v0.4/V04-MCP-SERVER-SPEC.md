# V04 · MCP 服务器规格（musefold-mcp）

> **状态**：设计规格（待评审）
> **协议**：MCP 2026-07-28（经官方 TypeScript SDK 实现，自动兼容旧版握手客户端）
> **传输**：stdio（v0.4 唯一传输）；日志一律 stderr
> **定位**：`musefold-mcp` 是**无状态薄适配器**——把策展工具面翻译成对本地控制面（Automation API v1）的 HTTP 调用，自身不开数据库、不存密钥、不留任务状态。

---

## 1. 启动与配置

### 1.1 启动方式（等价二选一）

```bash
npx -y musefold mcp          # CLI 包内置子命令（推荐写进客户端配置）
npx -y @musefold/mcp         # 独立薄壳包（bin: musefold-mcp）
```

### 1.2 环境变量与启动参数

| 项 | 说明 | 默认 |
|---|---|---|
| `MUSEFOLD_ENDPOINT` / `MUSEFOLD_TOKEN` | 显式指定控制面；否则走发现文件（V04-ARCHITECTURE §3.2） | 自动发现 |
| `--readonly` | 只注册 🟢 只读工具（generate/run/save 全部隐藏） | off |
| `--toolsets <csv>` | 裁剪工具组：`library,generation,recipes,schemes,skills,history,materials` | 全开 |
| `--no-wait` | 长任务工具默认改为「提交即返回 jobId」 | wait 模式 |

### 1.3 连接不到 Musefold 时（降级目录）

MCP 客户端不喜欢启动即崩溃的服务器：此时仅注册 `musefold_status` 一个工具，调用返回引导文案（「请启动 Musefold App 或运行 `musefold serve`」）。控制面恢复后进程重启即可（客户端负责子进程生命周期）。

---

## 2. 工具目录（18 个，7 组）

> 命名：动词开头 snake_case；全部提供 `title`（中文）+ `description`（英文为主，模型可读）+ Zod `inputSchema`/`outputSchema` + 注解。所有花钱工具（🔴）由**控制面服务端强制**确认/预算（注解只是 UI 提示，见 V04-SECURITY §3）。

### 2.0 总览

| 组 | 工具 | 级别 | 注解要点 |
|---|---|---|---|
| core | `musefold_status` | 🟢 | readOnly |
| library | `search_prompts` / `get_prompt` / `save_prompt` | 🟢🟢🟡 | save: 非破坏、幂等 false |
| generation | `list_providers` / `generate_image` / `get_generation` / `cancel_generation` | 🟢🔴🟢🟡 | generate: openWorld |
| recipes | `list_recipes` / `get_recipe` / `compile_recipe` | 🟢 | compile 纯函数 |
| schemes | `list_schemes` / `get_scheme` / `compile_scheme_prompt` / `run_scheme` | 🟢🟢🟢🔴 | 仅正式方案可见 |
| skills | `run_github_skill` | 🔴 | openWorld（GitHub + Provider） |
| history | `list_history` | 🟢 | |
| materials | `search_materials` | 🟢 | |

### 2.1 core

**`musefold_status`** — 连接诊断，永远注册。

```ts
input:  {}
output: { connected: boolean, owner: 'desktop-app'|'headless-daemon'|null,
          appVersion?: string, apiVersion?: string,
          capabilities?: { generation: boolean, schemes: boolean, skills: boolean },
          guidance?: string }   // 未连接时的人话引导
annotations: { readOnlyHint: true }
```

### 2.2 library

**`search_prompts`** — FTS 检索提示词库（含素笺）。

```ts
input:  { query?: string, folderId?: string, tagIds?: string[],
          source?: 'manual'|'slip'|'any', pinnedOnly?: boolean, limit?: number /* ≤50, 默认 20 */ }
output: { prompts: Array<{ id, title, body, tags: string[], folderId,
                           source, pinned, usageCount, updatedAt }>, total: number }
annotations: { readOnlyHint: true }
```

**`get_prompt`** — 按 id 取完整提示词。`input: { id: string }`；`readOnlyHint: true`。

**`save_prompt`** — Agent 产出的优质提示词回流资产库。

```ts
input:  { title: string, body: string, tagNames?: string[], folderId?: string,
          note?: string /* 记录来源，如 "via Claude Code 2026-08-12" */ }
output: { id: string, created: true }
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
```

### 2.3 generation

**`list_providers`** — 已配置的图像 Provider 与可用模型。**响应中不存在任何密钥字段**；`hasKey:false` 的 Provider 标 `available:false`。

```ts
input:  { includeModels?: boolean /* true 时可能触发 Provider /models 网络请求 */ }
output: { providers: Array<{ id, name, type, model, isActive, available: boolean,
                             models?: Array<{ id, name }> }> }
annotations: { readOnlyHint: true, openWorldHint: true /* includeModels 时外联 */ }
```

**`generate_image`** — 核心工具：文生图 / 垫图编辑 / 配方直出，走控制面策略闸门（确认或预算，V04-ARCHITECTURE §5.4）。

```ts
input: {
  prompt?: string,                        // 与 recipeId 二选一，至少其一
  recipeId?: string, variables?: Record<string,string>,   // 配方直出：服务端先 compile
  providerId?: string,                    // 缺省 = 激活 Provider
  model?: string,
  aspectRatio?: '1:1'|'3:4'|'4:3'|'16:9'|'9:16',
  n?: number,                             // 1–4，默认 1
  quality?: 'auto'|'high'|'medium'|'low',
  referenceImagePaths?: string[],         // ≤16，须命中路径白名单（V04-SECURITY §5）
  referenceHistoryIds?: string[],         // 从历史结果垫图（精修）
  negative?: string,
  wait?: boolean                          // 默认 true：阻塞至完成并推 MCP 进度通知
}
output: {
  jobId: string, status: 'success'|'failed'|'cancelled'|'running',
  historyId?: string, costCents?: number, durationMs?: number,
  assets?: Array<{ path: string /* 本地绝对路径 */, uri: string /* file:// */ }>,
  error?: { code: string, message: string }
}
content: 文本摘要 + 每个产物一个 ResourceLink { type:'resource_link', uri:'file://…png', mimeType:'image/png' }
annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
```

执行语义：

1. `wait:true`（默认）：内部订阅 SSE，向客户端发 MCP progress 通知（SDK 能力），完成后一次性返回。工具描述中注明「可能需要 1–3 分钟，请把客户端工具超时调到 300s」。
2. `wait:false`：控制面受理后立刻返回 `{ jobId, status:'running' }`；模型随后只调用一次 `wait_for_generation`，由 SSE 等待终态并转发进度。`get_generation` 仅用于读取即时快照，不作为正常轮询路径。
3. 需要确认且客户端支持 elicitation：发起确认（展示 Provider/模型/张数/预估成本）；不支持 ⇒ 返回 `isError:true` + `structuredContent.error.code='CONFIRMATION_REQUIRED'` + 引导（在 App 设置页配置自动化预算）。

**`get_generation`** — 按 `jobId` 或 `historyId` 查任务/历史详情（参数、状态、成本、产物路径）。`readOnlyHint: true`。

**`cancel_generation`** — `input: { jobId: string }`；幂等；`readOnlyHint: false, idempotentHint: true`。

### 2.4 recipes

**`list_recipes`** — `input: { query?: string, includeArchived?: boolean, limit?: number }`；返回目录卡（id、名称、简介、变量数、修订版号）。`readOnlyHint: true`。

**`get_recipe`** — 完整定义：blocks 结构、变量（名称/类型/默认值/选项）、素材引用。Agent 用它决定怎么填变量。`readOnlyHint: true`。

**`compile_recipe`** — **纯函数、零成本**，v0.4 最鼓励模型使用的工具。

```ts
input:  { recipeId: string, variables?: Record<string,string>, revision?: number }
output: { prompt: string, warnings: string[],           // 未填变量、越界选项等
          sourceRanges?: Array<{ start, end, origin }> }
annotations: { readOnlyHint: true, idempotentHint: true }
```

### 2.5 schemes（设计方案）

> 延续 v0.3.2 决策：**草稿方案对外不可见不可调**；只有「正式」方案进入 `list_schemes`。

**`list_schemes`** — 正式方案目录（id、名称、fidelity、封面路径、输入槽位摘要）。`readOnlyHint: true`。

**`get_scheme`** — 方案详情：输入槽位（文本变量 + 命名图槽）、优先模式、来源绑定（repo@commit）。`readOnlyHint: true`。

**`compile_scheme_prompt`** — 编译预览（不生图不花钱）：`input: { schemeId, inputs?, priorityMode? }` → `{ prompt, imageSlots, warnings }`。`readOnlyHint: true`。

**`run_scheme`** — 运行方案生图（走策略闸门；事件对应 `scheme.run.*` SSE）。

```ts
input:  { schemeId: string, inputs?: Record<string,string>,
          imageSlotPaths?: Record<string,string>,      // 槽位名 → 白名单内路径
          priorityMode?: 'scheme_first'|'user_first'|'agent_mediated',
          wait?: boolean }
output: { runId, status, assets?: [{ path, uri }], costCents?, stepSummaries?: string[] }
annotations: { readOnlyHint: false, openWorldHint: true }
```

### 2.6 skills

**`run_github_skill`** — 拉取公开 GitHub Skill（固定 commit、预算限制、**不执行任何脚本**）并按其视觉规则生成图像；等价于 App 内 `skillRuntime.prepareGithub + execute` 的一次性聚合。

```ts
input:  { url: string /* 公开 GitHub Skill 地址 */, prompt: string,
          referenceImagePaths?: string[], wait?: boolean }
output: { runtimeId, status, assets?: [{ path, uri }], costCents?,
          trace?: Array<{ tool: 'list_skill_files'|'read_skill_file'|'generate_image', summary: string }> }
annotations: { readOnlyHint: false, openWorldHint: true }
前置：需要已配置文本 AI 连接（Agent 模式）；否则自动降级 file-fallback 并在输出注明。
```

### 2.7 history / materials

**`list_history`** — `input: { limit?, status?, providerId?, since? }` → 摘要行（historyId、缩略参数、成本、产物路径）。`readOnlyHint: true`。

**`search_materials`** — `input: { query?, category?, limit? }` → 素材片段（标题、内容、标签）。`readOnlyHint: true`。

---

## 3. Resources（资源）

| URI 模板 | 内容 | mimeType |
|---|---|---|
| `musefold://prompt/{id}` | 提示词正文 + 元数据 | `text/markdown` |
| `musefold://recipe/{id}` | 配方 YAML（现 `exportRecipeYaml` 复用） | `application/yaml` |
| `musefold://asset/{historyId}/{index}` | 生成产物（读文件流） | `image/png` |

- `resources/list` 返回置顶提示词 + 最近 10 条成功生成的产物（`ttlMs: 30_000`）。
- 生成类工具的 `content` 里始终带 `resource_link`，客户端可按需 `resources/read`，**不把 base64 塞进上下文**（Playwright MCP 的省 token 教训）。

## 4. Prompts（提示词模板）

| 名称 | 参数 | 展开为 |
|---|---|---|
| `use-recipe` | `recipeId`（completable：目录联想） | 「请调用 compile_recipe 预览，与我确认变量后再 generate_image」的引导模板 |
| `refine-last` | — | 取最近一次成功生成，引导模型用 `referenceHistoryIds` 精修 |

---

## 5. 错误映射

控制面错误信封 → `CallToolResult`：`isError: true`，`content` 放人话，`structuredContent.error = { code, message, retriable }`。

| code | 场景 | retriable |
|---|---|---|
| `NOT_CONNECTED` | 控制面不可达 | ✔（启动 App 后） |
| `CONFIRMATION_REQUIRED` | 需确认但客户端不支持 elicitation 且无预算 | ✔（配置预算后） |
| `CONFIRMATION_TIMEOUT` / `CONFIRMATION_DENIED` | 用户未确认 / 拒绝 | ✖ |
| `BUDGET_EXCEEDED` | 超自动化预算 | ✖（需用户调整） |
| `PROVIDER_AUTH_FAILED` / `RATE_LIMITED` / `PROVIDER_ERROR` | Provider 侧 | 视情况 |
| `PATH_NOT_ALLOWED` | 参考图路径不在白名单 | ✖ |
| `NOT_FOUND` / `INVALID_PARAMS` | 常规 | ✖ |
| `IMAGE_EDIT_UNSUPPORTED` | Provider 不支持多图编辑（v0.3 决策沿用） | ✖ |

---

## 6. 客户端接入配置（随发布文档分发）

### Claude Code

```bash
claude mcp add musefold -- npx -y musefold mcp
```

或项目级 `.mcp.json`：

```json
{ "mcpServers": { "musefold": {
    "type": "stdio", "command": "npx", "args": ["-y", "musefold", "mcp"] } } }
```

### Codex（CLI / IDE / 桌面共享）

```toml
# ~/.codex/config.toml —— 注意蛇形键名 mcp_servers
[mcp_servers.musefold]
command = "npx"
args = ["-y", "musefold", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 300          # 生图必须调大（默认 60s 不够）
```

### Cursor

```json
// .cursor/mcp.json（项目）或 ~/.cursor/mcp.json（全局）
{ "mcpServers": { "musefold": {
    "command": "npx", "args": ["-y", "musefold", "mcp"] } } }
```

> 团队/CI 只读接入示例：`args: ["-y", "musefold", "mcp", "--readonly", "--toolsets", "library,recipes,history"]`。

---

## 7. 验收清单（P2/P3 出口）

- [ ] MCP Inspector：headless `tools/list` 20 个工具、桌面宿主 24 个工具 schema 校验通过；目录排序稳定
- [ ] stdout 零日志污染（专项测试：注入 debug 日志断言仍可完成握手/调用）
- [ ] Claude Code：场景 A 全链路（含 elicitation 确认）实测通过
- [ ] Codex：`tool_timeout_sec=300` 下 `generate_image wait:true` 成功；后台模式下 `wait:false + wait_for_generation` 一次等待成功
- [ ] Cursor：只读模式目录正确裁剪
- [ ] 断开 App → 降级目录只剩 `musefold_status`；重启 App → 客户端重连后目录恢复
- [ ] `--readonly` 下不存在任何 🔴/🟡 工具（用 Inspector 断言）
