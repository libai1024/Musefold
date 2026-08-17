# v0.4 · Agent Surface：MCP 服务 + CLI

> **状态**：设计文档（完整初稿，待产品评审后进入实现）
> **日期**：2026-08-12
> **前置**：v0.3.x 已实现基线（Musefold 品牌、多图输入/精修、Skills 运行时、设计方案域、朱点体系）
> **本目录是 v0.4 的事实来源**：实现应以本目录文档为准；与旧文档冲突时，遵循 `docs/README.md` 的权威顺序（源码 > 版本文档 > 决策 > 历史交接）。

---

## 1. 一句话目标

**把 Musefold 的核心能力（提示词库、生图、配方/方案编译、Skill 运行、历史账本）以 MCP 服务与 CLI 的形式开放给外部 Agent（Claude Code、Codex、Cursor 等）与脚本使用，同时不破坏 v0.3 的本地优先与密钥安全边界。**

v0.4 之后，用户可以在 Claude Code / Codex 里说「用 Musefold 的『极简海报』方案生成一张 16:9 的封面图」，Agent 通过 MCP 工具调用完成编译提示词 → 调 Provider 生图 → 落库历史 → 返回本地文件路径的完整闭环；也可以在终端 / CI 脚本里用 `musefold generate` 完成同样的事。

---

## 2. 背景与动机

1. **Agent 正在成为创作入口**。Claude Code、Codex CLI、Cursor 都已内建 MCP 客户端，第三方能力接入的事实标准是 MCP（stdio 本地进程 / Streamable HTTP 远程）。Musefold 若只有 GUI，就被排除在这条工作流之外。
2. **本 App 的核心资产天然适合被 Agent 消费**：结构化提示词库（可检索）、配方/方案（可参数化编译）、BYOK Provider（可代为生图）、历史账本（可追溯成本与产物路径）。
3. **现有架构已经完成了 80% 的准备**：所有能力都收敛在主进程 typed IPC 之后（`window.api` 24 个域、约 140 个操作），领域逻辑（配方渲染、方案编译、Skill 扫描）大多是纯 TS（`shared/`），数据是本地 SQLite ——缺的只是「Electron 之外的入口」。
4. **v0.3 系列文档反复强调的安全红线在 v0.4 依然成立**：密钥只在主进程、不执行第三方脚本、不静默联网。v0.4 的开放是「受控开放」：只读能力自由用，花钱/写库能力需确认或预授权。

---

## 3. 范围

### 3.1 In Scope（v0.4 交付）

| 编号 | 交付物 | 说明 |
|---|---|---|
| S1 | `@musefold/core` 共享核心包 | 从 `electron/` 抽出可移植领域层（端口-适配器），Electron 主进程与 headless 进程共用 |
| S2 | 本地控制面（Automation API v1） | 桌面 App 主进程内的 loopback HTTP+SSE 服务，token 鉴权，是 CLI/MCP 的默认后端 |
| S3 | `musefold` CLI | npm 包 + `npx` 可用；覆盖生图、库、配方/方案、Skill、历史、Provider 管理 |
| S4 | `musefold-mcp` MCP 服务器 | stdio 传输（MCP 2026-07-28），18 个策展工具（7 组，可裁剪）+ resources + prompts；`musefold mcp` 亦可启动 |
| S5 | headless 守护模式 | `musefold serve`：桌面 App 未运行时以无 GUI 方式拥有数据库（互斥锁），供 CI/服务器场景 |
| S6 | 接入文档与配置样例 | Claude Code（`.mcp.json`）、Codex（`config.toml`）、Cursor（`.cursor/mcp.json`）一键接入 |

### 3.2 Out of Scope（明确不做）

- ❌ 远程多用户服务 / 云端托管 MCP（Streamable HTTP + OAuth 留作 v0.5+ 评估；v0.4 仅 loopback）
- ❌ 通过 MCP/CLI 读取或导出明文 API Key（任何形态）
- ❌ 在 MCP 工具中执行第三方 Skill 的脚本 / shell（延续 v3.1、v0.3.2 红线）
- ❌ 渲染进程 UI 重构（v0.4 对 UI 的唯一影响：设置页新增「自动化」面板 + 朱点忙碌态接入外部任务）
- ❌ 移动端 / 浏览器扩展

---

## 4. 文档索引

| 文档 | 内容 | 读者 |
|---|---|---|
| [V04-CORE-FEATURE-SUMMARY.md](V04-CORE-FEATURE-SUMMARY.md) | 本 App 核心功能盘点：六大能力域、现有 IPC 面、可移植性评估、v0.4 暴露矩阵 | 全员，先读 |
| [V04-RESEARCH-MCP-CLI.md](V04-RESEARCH-MCP-CLI.md) | 互联网成熟做法调研：MCP 2026-07-28 规范、TS SDK、Claude Code/Codex/Cursor 接入方式、同类产品（Ollama/1Password/GitHub MCP/Playwright MCP）模式、CLI 设计准则 | 架构、实现 |
| [V04-ARCHITECTURE.md](V04-ARCHITECTURE.md) | 总体架构：core 抽取、单写者进程模型、本地控制面 Automation API v1 契约、并发与生命周期 | 架构、实现 |
| [V04-MCP-SERVER-SPEC.md](V04-MCP-SERVER-SPEC.md) | MCP 服务器规格：工具目录（含 schema 与注解）、resources、prompts、错误映射、三家客户端接入配置 | 实现、QA |
| [V04-CLI-SPEC.md](V04-CLI-SPEC.md) | CLI 规格：命令树、全局约定（`--json`、退出码、流式进度）、示例、打包分发 | 实现、QA |
| [V04-SECURITY.md](V04-SECURITY.md) | 安全模型：威胁清单、token 鉴权、密钥边界、花钱确认（elicitation/预算）、路径白名单 | 全员 |
| [V04-DELIVERY-PLAN.md](V04-DELIVERY-PLAN.md) | 实施计划：四个阶段、任务卡、验收标准、测试策略（MCP Inspector / e2e）、风险与开放问题 | 全员 |

---

## 5. 核心决策（D1–D10）

> 以下为本设计的骨架决策。标注「✅ 建议锁定」的是技术上基本无争议项；标注「🔶 待评审」的需要产品拍板。

| # | 决策 | 结论 | 理由摘要 |
|---|---|---|---|
| D1 | 代码组织 | ✅ 抽取 `@musefold/core`（`packages/core`），端口-适配器模式，禁止 `import 'electron'` | 领域层大多已是纯 TS；一份逻辑三个入口（App/CLI/MCP），避免双实现漂移 |
| D2 | 进程模型 | ✅ **单写者**：桌面 App 运行时是唯一 DB 所有者；CLI/MCP 默认作为其客户端，经本地控制面调用 | better-sqlite3 多进程并发写会 `SQLITE_BUSY`；经 App 调用还能让 UI（历史/朱点）实时反映外部任务 |
| D3 | 控制面传输 | ✅ loopback HTTP `127.0.0.1:<动态端口>` + SSE 事件流；端口与 token 写入 `userData/automation.json`（0600） | 跨平台一致（Windows named pipe 差异大）；HTTP 便于未来平滑升级为远程 Streamable HTTP |
| D4 | MCP 传输 | ✅ v0.4 只做 **stdio**（`musefold mcp`），凭证走环境变量/发现文件，符合规范「stdio SHOULD 从环境取凭证」 | 三大客户端对 stdio 支持最成熟；不引入 OAuth 复杂度 |
| D5 | MCP 工具面 | ✅ 策展 20 个基础工具、7 组；桌面宿主按 capability 追加 4 个零凭据安全配置工具（非 1:1 镜像 IPC），带 `readOnlyHint`/`destructiveHint` 等注解 | 工具目录进模型上下文，小而清晰的目录命中率与安全性都更高 |
| D6 | 密钥边界 | ✅ 延续 v0.3：明文 Key 永不出主进程/Core；MCP 无任何 Key 读写工具；CLI 仅本地交互式 `provider set-key`（写 OS keychain / safeStorage） | 与 v0.3 红线一致；MCP 客户端上下文不可信 |
| D7 | 花钱动作管控 | ✅ 已拍板（2026-08-13）：生图默认需确认，**预算默认 0**；MCP 走 elicitation 确认（客户端不支持时要求预授权）；CLI 走 `--yes` 或预算上限 `--max-cost` | 生图消耗真金白银；默认安全，可配置放开（`autoApprove` 白名单） |
| D8 | headless 所有权 | ✅ `musefold serve` 与桌面 App 通过 `userData` 锁文件互斥；CLI/MCP 自动发现「App → 守护 → 报错引导」 | 保证任何时刻只有一个写者；CI 无 GUI 场景可用 |
| D9 | 对外命名 | ✅ 已拍板（2026-08-13）：npm 包 `musefold`（CLI，bin: `musefold`）+ `@musefold/mcp`（bin: `musefold-mcp`，薄壳）；工具名前缀 `musefold_*` 不加，用短名（`generate_image` 等），服务器名 `musefold`。两个包名已核验未被占用（2026-08-13） | `npx -y musefold mcp` 一条命令可接入；MCP 客户端已按 server 命名空间隔离工具 |
| D10 | 版本策略 | ✅ Automation API 独立版本号 `v1`（URL 前缀 `/v1/`），与 App 版本解耦；MCP 工具 schema 变更遵循「只加不改」 | 外部 Agent 配置写死在用户机器上，兼容性承诺必须显式 |

---

## 6. 目标体验（North Star 场景）

### 场景 A：Claude Code 里生成设计方案图

```text
用户（在 Claude Code）：用 Musefold 的「gc-minimal-zine-poster」方案，
                      主题改成「秋日咖啡节」，出一张 3:4 海报。

Claude Code → MCP:
  1. list_schemes()                    → 找到方案 + 输入槽位
  2. compile_scheme_prompt(...)        → 预览最终提示词（0 成本，只读）
  3. generate_image({schemeId, inputs, aspectRatio:'3:4'})
       └─ Musefold 弹确认（或命中预授权预算）→ 调 Provider → 写盘写历史
  4. 返回 ResourceLink: file 路径 + historyId + 成本（分）
```

### 场景 B：终端一条命令出图

```bash
musefold generate -p "a minimal zine poster, autumn coffee festival" \
  --ratio 3:4 -n 2 --max-cost 50 --json -o ./out/
```

### 场景 C：CI 里批量回归品牌图（无 GUI）

```bash
musefold serve --headless &         # 拥有 DB 的守护进程（与桌面 App 互斥）
musefold recipe compile brand-cover --var title="v0.4 Release" | \
  musefold generate --stdin-prompt --provider tvt --yes
```

---

## 7. 里程碑总览

| 阶段 | 内容 | 出口标准 |
|---|---|---|
| **P1 基座**（~2 周） | core 抽取 + 控制面 v1（只读域）+ CLI 骨架（`status`/`prompt`/`history`） | Electron 全量回归绿；`musefold prompt list --json` 可用 |
| **P2 生图闭环**（~2 周） | `generate_image` 全链路（确认/预算/进度 SSE）+ MCP 服务器（只读工具 + 生图） | Claude Code & Codex 实测跑通场景 A |
| **P3 高阶能力**（~2 周） | 配方/方案编译与运行、Skill 运行（GitHub）、素笺写入 | 场景 B/C 跑通；MCP Inspector 全绿 |
| **P4 发布**（~1 周） | headless 守护完善、npm 发布、接入文档、设置页「自动化」面板 | `npx -y musefold mcp` 三客户端一键接入 |

详见 [V04-DELIVERY-PLAN.md](V04-DELIVERY-PLAN.md)。

---

## 8. 术语表

| 术语 | 含义 |
|---|---|
| **MCP** | Model Context Protocol，Agent ↔ 工具的开放协议；当前版本 2026-07-28（无状态） |
| **stdio 传输** | MCP 客户端以子进程方式拉起服务器，stdin/stdout 上跑换行分隔的 JSON-RPC |
| **控制面 / Automation API** | 桌面 App 主进程内的 loopback HTTP+SSE 服务，CLI/MCP 的默认后端（v1） |
| **单写者** | 任一时刻只有一个进程打开并写入三个 SQLite 库（App 或 headless 守护） |
| **策展工具面** | 面向 Agent 精选、聚合、加注解后的工具集合，区别于内部 IPC 的全量镜像 |
| **elicitation** | MCP 服务器在工具执行中向客户端征询用户输入/确认的机制（2026-07-28 经 MRTR 实现） |
| **预授权 / 预算** | 用户在 App 设置或 CLI 参数中预先允许的花费额度，命中则跳过逐次确认 |
