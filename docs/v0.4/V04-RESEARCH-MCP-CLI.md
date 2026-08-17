# V04 · 调研：MCP 与 CLI 的成熟做法

> **状态**：调研结论（2026-08-12 完成，来源为官方规范/文档与一手工程资料）
> **用途**：为 V04-ARCHITECTURE / V04-MCP-SERVER-SPEC / V04-CLI-SPEC 的每一个关键决策提供外部依据。

---

## 1. MCP 协议现状（必须按 2026-07-28 版设计）

来源：[MCP 官方规范 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic)、[官方发布博客](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[Cloudflare：The next generation of MCP](https://blog.cloudflare.com/mcp-v2/)。

### 1.1 关键变化（相对 2025 系列版本）

| 变化 | 内容 | 对 Musefold 的影响 |
|---|---|---|
| **完全无状态** | 废除 `initialize`/`initialized` 握手与 `Mcp-Session-Id`；每个请求在 `_meta.io.modelcontextprotocol/*` 里自带协议版本、客户端身份与能力 | 服务器不得依赖会话内存；生图任务状态要落在**服务端账本**（historyId/jobId），不能挂在连接上 |
| **`server/discover`** | 客户端可选的能力探测 RPC，兼容旧版握手客户端的探测路径 | 用官方 SDK 即自动兼容新旧客户端 |
| **MRTR** | `elicitation`、`sampling`、`roots` 改为 Multi Round-Trip Requests，不再要求常开双向流 | 生图确认用 elicitation 在 stdio 上可靠可用 |
| **缓存提示** | `tools/list` 等响应带 `ttlMs`/`cacheScope`，目录确定性排序 | 工具目录要稳定排序、少变动，利于客户端缓存 |
| **HTTP 头路由** | Streamable HTTP 必须带 `Mcp-Method`/`Mcp-Name` 头 | v0.4 只做 stdio，不受影响；为 v0.5 远程化预留 |

### 1.2 传输选择

规范定义两种标准传输（[transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)）：

1. **stdio**（[规范](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)）：客户端把服务器拉起为子进程，stdin/stdout 上一行一条 JSON-RPC。规范明确：**stdio 服务器 SHOULD NOT 使用 HTTP 授权框架，而应从环境中获取凭证**——这正是 v0.4 的鉴权路径（`MUSEFOLD_TOKEN` 环境变量 / 自动发现文件）。
2. **Streamable HTTP**：单端点 POST，响应为 JSON 或请求级 SSE；配套 OAuth 授权框架。适合远程多用户，**v0.4 不做**（本地单用户没有收益，只有复杂度）。

另外规范鼓励：基于可靠字节流的自定义传输（Unix socket / TCP）**SHOULD 复用 stdio 帧格式**——若未来控制面想从 HTTP 换 Unix socket，帧格式有官方背书。

### 1.3 服务器三原语 + 安全注解

- **Tools**（模型可调用）/ **Resources**（客户端可读的数据，URI 定位）/ **Prompts**（用户可选的提示词模板）。Musefold 三者都有天然对应物：工具=操作；资源=提示词/生成图；prompts=配方模板。
- 工具注解（[TS SDK server 文档](https://github.com/modelcontextprotocol/typescript-sdk/blob/HEAD/docs/server.md)）：`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`。**注解只是给客户端的提示，不改变执行语义**——安全控制必须同时在服务端实现（我们的确认/预算机制），不能只靠注解。
- 结构化输出：`outputSchema` + `structuredContent`（客户端可编程消费）；文件类产物用 **`ResourceLink`** 返回（不内联大二进制，客户端按需读取）——生成 PNG 的正确返回方式。
- **Elicitation**：工具执行中可 `elicitInput()` 向用户征询表单/确认/URL 跳转；规范明确**敏感信息不得走表单 elicitation**（密钥仍然只能本地录入）。
- 图标（`icons`，支持 data URI）可以给服务器与工具挂 Musefold 品牌标识。

---

## 2. 官方 TypeScript SDK

来源：[TS SDK server 指南](https://ts.sdk.modelcontextprotocol.io/documents/server.html)、[typescript-sdk/docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/HEAD/docs/server.md)。

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'musefold', version: '0.4.0' });

server.registerTool('compile_recipe', {
  title: '编译配方',
  description: 'Compile a Musefold recipe with variables into the final image prompt.',
  inputSchema: { recipeId: z.string(), variables: z.record(z.string()).optional() },
  outputSchema: { prompt: z.string(), warnings: z.array(z.string()) },
  annotations: { readOnlyHint: true },
}, async ({ recipeId, variables }) => {
  const output = await client.compileRecipe(recipeId, variables);
  return { content: [{ type: 'text', text: output.prompt }], structuredContent: output };
});

await server.connect(new StdioServerTransport());
```

工程要点（多个来源一致强调）：

1. **stdout 只属于协议**，所有日志必须走 stderr——否则客户端 JSON-RPC 解析直接断连。
2. Zod schema 即模型可见的 JSON Schema；`describe()` 写给模型看的参数说明。
3. 2026-07-28 对应 SDK v2（包名整合为 `@modelcontextprotocol/server` 等）；v1 的 `@modelcontextprotocol/sdk` 仍被广泛使用且 API 形态一致。**建议**：实现时锁定当时最新稳定 SDK，靠 SDK 的 `server/discover` 探测逻辑同时服务新旧客户端，不自己写协议层。
4. 工具动态增删（`disable()`/`enable()`）会自动发 `listChanged` 通知——可用于「未配置 Provider 时隐藏 generate_image」这类状态化目录。

---

## 3. 三个目标客户端的接入方式（实测口径）

### 3.1 Claude Code

来源：[官方 MCP 文档](https://code.claude.com/docs/en/mcp.md)、[quickstart](https://code.claude.com/docs/en/mcp-quickstart)。

```bash
# 一条命令（-- 之后原样传给服务器进程）
claude mcp add musefold -- npx -y musefold mcp
```

项目级共享用仓库根的 `.mcp.json`（`--scope project`；`local`/`user` 存 `~/.claude.json`）：

```json
{
  "mcpServers": {
    "musefold": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "musefold", "mcp"],
      "env": { "MUSEFOLD_TOKEN": "${MUSEFOLD_TOKEN}" }
    }
  }
}
```

要点：有 `command` 时 `type` 默认 stdio；`env` 支持 `${VAR}`/`${VAR:-default}` 展开（密钥不进版本库）；会话内 `/mcp` 查看连接状态。

### 3.2 Codex（CLI / IDE 扩展 / 桌面共享同一配置）

来源：[developers.openai.com/codex/mcp](https://developers.openai.com/codex/mcp)。**TOML 不是 JSON，键名是蛇形 `mcp_servers`**（写成 `mcpServers`/`mcp.servers` 会被静默忽略——高频翻车点）：

```toml
# ~/.codex/config.toml（或受信任项目的 .codex/config.toml）
[mcp_servers.musefold]
command = "npx"
args = ["-y", "musefold", "mcp"]
startup_timeout_sec = 20      # 默认 10s，首次 npx 下载可能超时
tool_timeout_sec = 300        # 生图可能超过默认 60s，必须调大
[mcp_servers.musefold.env]
MUSEFOLD_TOKEN = "..."
```

也支持 `codex mcp add musefold -- npx -y musefold mcp`；`enabled_tools`/`disabled_tools` 可做工具级白名单。**`tool_timeout_sec` 默认 60s 对生图不够**——这是我们必须写进接入文档的坑。

### 3.3 Cursor

项目 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json`，JSON 形态与 Claude Code 的 `mcpServers` 一致（`command`/`args`/`env`）。

**共同结论**：三家都以「stdio 子进程 + 环境变量传凭证」为最低公分母 → v0.4 只要发布一个 `npx -y musefold mcp` 可拉起的包，就同时覆盖三家。

---

## 4. 同类产品的架构模式（谁已经把「桌面 App 能力开放给外部进程」做成熟了）

| 产品 | 模式 | 借鉴点 |
|---|---|---|
| **Ollama** | 常驻守护（`ollama serve`，默认 `127.0.0.1:11434` REST）+ 薄 CLI + 各语言 SDK；桌面 App 与 CLI 共用同一守护 | 「**单一所有者进程 + 本地 HTTP + 薄客户端**」被大规模验证；我们的控制面即此模式（区别：所有者优先是 GUI 主进程） |
| **Docker** | `dockerd` 守护 + `docker` CLI 走 unix socket / named pipe | 同上；同时证明「CLI 完全不碰数据文件」是正确姿势 |
| **1Password CLI (`op`)** | CLI 与桌面 App 集成：App 持有保险库与生物识别解锁，CLI 每次敏感操作向 App 请求授权 | **密钥永远在 App 一侧**、外部进程只拿结果不拿密钥；对应我们「MCP/CLI 永不读 Key，生图在主进程内部取 Key」 |
| **Obsidian Local REST API** | 桌面 App 内起 loopback HTTPS + API Key，社区自动化生态全部长在上面 | GUI App 内嵌 loopback 服务 + token 的先例；token 放本地配置文件而非环境共享 |
| **GitHub MCP Server** | 官方 MCP 服务器，工具按 **toolset 分组开关**（`--toolsets repos,issues`），提供只读模式开关 | 工具面「分组 + 可裁剪 + 只读模式」；我们用 `--readonly` 与分组对应 |
| **Playwright MCP** | stdio 本地服务器；返回**结构化快照而非截图**以省 token | 输出面向模型设计：`structuredContent` 精炼、二进制走 ResourceLink，不往上下文里塞 base64 |
| **Filesystem MCP（官方参考实现）** | 启动参数声明**路径白名单**，一切操作限定其内 | 参考图路径白名单（只允许受管上传目录 + 显式 `--allow-dir`）照此办理 |

**反模式（调研中反复出现的教训）**：
- 把内部 API 1:1 全量镜像成 MCP 工具 → 工具目录淹没模型上下文，误调率高。GitHub MCP 曾因工具过多被诟病，后来引入 toolset 开关。
- stdio 服务器往 stdout 打日志 → 客户端断连（最常见的集成故障）。
- 密钥走 argv（`ps aux` 可见）或 MCP 表单 elicitation（规范明令禁止）。
- 两个进程直接打开同一 SQLite 写 → 偶发 `SQLITE_BUSY`/损坏，Ollama/Docker 从不这么做。

---

## 5. CLI 设计准则（[clig.dev](https://clig.dev/) 共识 + 12-Factor CLI）

| 准则 | 落地到 `musefold` CLI |
|---|---|
| 人类优先，机器可选 | 默认表格/彩色输出；`--json` 输出稳定 JSON（对象或 NDJSON 流）；检测到非 TTY 时自动关色彩、尊重 `NO_COLOR` |
| stdout=数据，stderr=日志 | 进度条/提示走 stderr；`--json` 时 stdout 只有 JSON，可安全 `| jq` |
| 显式退出码 | `0` 成功；`1` 一般错误；`2` 参数错误；`3` 无法连接 Musefold（App/守护均未运行）；`4` 用户拒绝确认；`5` 超预算；`6` Provider 失败 |
| 非交互友好 | 一切确认支持 `--yes`；CI 检测（无 TTY）时默认拒绝花钱动作除非 `--yes`/`--max-cost` |
| 密钥不进 argv | `provider set-key` 交互式隐藏输入或读 stdin/env，argv 出现明文直接报错 |
| 配置优先级 | flags > 环境变量（`MUSEFOLD_*`）> 用户配置文件 > 自动发现 |
| 可组合 | `--stdin-prompt`、路径输出到 stdout，支持管道串联（场景 C） |
| 框架 | `commander`（成熟、零重依赖、TS 类型好）；表格用轻量实现，不引 heavy TUI |
| 分发 | npm 包 `musefold`（bin: `musefold`），`npx -y musefold` 免安装；后续可选 Node SEA 单文件二进制（P4 之后评估） |

---

## 6. 采纳清单（调研 → 决策映射）

| 调研结论 | 采纳为 |
|---|---|
| stdio 是三客户端最低公分母；凭证走环境 | D4（v0.4 仅 stdio）+ `MUSEFOLD_TOKEN` 发现链 |
| 无状态协议、任务状态不能挂连接 | 生图任务以 `jobId/historyId` 落账本，`get_generation` 可随时查询 |
| Ollama/Docker/1Password 的单所有者 + 薄客户端 | D2 单写者 + D3 loopback 控制面 |
| GitHub MCP 的 toolset / 只读开关 | D5 策展工具面 + `--readonly` 启动开关 |
| Playwright MCP 的省 token 输出 | structuredContent 精炼 + ResourceLink 返回 PNG |
| Filesystem MCP 的路径白名单 | 参考图路径白名单（V04-SECURITY §5） |
| 注解不可作为唯一安全机制 | 服务端确认/预算强制（D7），注解仅作 UI 提示 |
| Codex `tool_timeout_sec` 默认 60s | 接入文档强制写 300s；长任务同时提供轮询式 `get_generation` |
