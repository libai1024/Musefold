# 06 · Automation、CLI 与 MCP

## 本地控制面

`packages/automation-server` 是嵌入桌面 App 的 loopback HTTP 服务。连接信息写入用户数据目录的 discovery 文件，令牌可轮换。宿主由 `electron/main/automation.ts` 注入 Core、账号/Provider 设置、确认、预算、审计和路径白名单。

当前 API 范围：

- 状态、配置就绪性和 Provider 选择。
- 提示词库搜索、读取和保存。
- 生图估价、提交、进度、取消和结果。
- 历史列表和详情。
- 正式设计方案列表、编译和运行。
- 公开 GitHub Skill 运行。

## CLI

```text
status
generate
cancel
prompt list|search|get|add|rm
history list|show
scheme list|show|compile|run
skill run <github-url>
account status|login|register
provider list|models|setup|add|set-key|rm|validate|use
backup now|list|restore
export|import
serve
```

`generate` 必须提供 `--prompt` 或 `--stdin-prompt`。非 TTY 若没有 `--yes` 会在费用请求前退出。`--max-cost` 是硬上限；`--no-wait` 只返回 jobId。

安装版 CLI 会尝试自动启动桌面 App。`serve` 是独立 headless Provider 模式，不读取桌面账号或安全凭证。

## MCP

MCP 是 Automation API 的无状态薄适配器，不开数据库、不存密钥。当前工具分组：

- `library`: `search_prompts`、`get_prompt`、`save_prompt`
- `generation`: Provider、generate/wait/get/cancel
- `schemes`: list/get/compile/run
- `skills`: `run_github_skill`
- `history`: `list_history`
- setup: get status、select provider、open account/provider setup

MCP 完整模式共 16 个工具。readonly/toolset/no-wait 参数可继续裁剪。stdout 只用于 stdio 协议，日志只写 stderr。

## 花费与审计

- 生图、Skill 和设计方案 run 是 spend 操作。
- 用户明确请求只授权当次操作。
- 互动确认、月预算和 `--max-cost` 共同约束支出。
- 审计事实写入 DB 和 NDJSON 日志，不记录密钥。
