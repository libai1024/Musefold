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

`generate` 必须提供 `--prompt` 或 `--stdin-prompt`。非 TTY 若没有 `--yes` 会在费用请求前退出。`--max-cost` 是以积分计的硬上限；`--no-wait` 只返回 jobId。

安装版 CLI 会尝试自动启动桌面 App。`serve` 是独立 headless Provider 模式，不读取桌面账号或安全凭证。

### 安装与升级

- macOS DMG 没有安装脚本。正式 App 位于 `/Applications` 或 `~/Applications` 时，首启自动写 `~/.local/bin/musefold`，并在当前 zsh/bash/fish 的启动文件中维护可逆 PATH 标记块；不请求管理员权限。直接从挂载卷或临时目录运行时跳过自动安装，避免留下失效路径。
- Windows NSIS 在 `customInstall` 中写 `%USERPROFILE%\.musefold\bin\musefold.cmd`、更新 HKCU PATH 并广播 `WM_SETTINGCHANGE`；首启逻辑负责 portable/unpacked、升级和损坏场景的幂等修复。默认用户级安装不要求管理员权限。
- 已运行的终端、IDE 和 Agent 不会自动继承新 PATH，必须重启。设置 → 自动化的按钮用于显式修复或移除；macOS 自定义 shell 需要用户手动把 `~/.local/bin` 加入 PATH。
- shim 只保存 App 可执行文件和内置 CLI 路径，不保存 Automation token、账号密码或 Provider key。

## MCP

MCP 是 Automation API 的无状态薄适配器，不开数据库、不存密钥。当前工具分组：

- `library`: `search_prompts`、`get_prompt`、`save_prompt`
- `generation`: Provider、generate/wait/get/cancel
- `schemes`: list/get/compile/run
- `skills`: `run_github_skill`
- `history`: `list_history`
- setup: get status、select provider、open account/provider setup

MCP 完整模式共 16 个工具。readonly/toolset/no-wait 参数可继续裁剪。stdout 只用于 stdio 协议，日志只写 stderr。

`GET /v1/health` 同时返回 `appVersion`、`apiVersion` 和细粒度 `capabilities`。当前能力字段包括 `generation`、`schemes`、`skills`、`setup`、`generationWait`、`referenceImages`、`historyReferences`、`pointCosts` 和 `githubSkillReferenceImages`。字段是向后兼容的可选声明：Agent 必须以实际 MCP 工具目录/输入 schema 为第一依据；旧 App 缺字段时按“未知”处理，不能默认支持。

## 官方 Agent Skill 的安装与更新

此处的 `Musefold 自动化 Skill` 是安装到 Codex、Claude Code、Cursor 的控制说明，不是工作台里运行的第三方 GitHub 视觉 Skill。

- App 内置一个固定版本的完整 Skill 目录，当前为 `v0.4.0`；离线时仍可安装。
- `Musefold-Skills/main/manifest.json` 只用于发现最新版。清单内每个文件 URL 必须指向与 `version` 相同的不可变 Git tag，不能直接下载 `main` 内容。
- 清单声明 `minimumAppVersion`、文件相对路径和 SHA-256。App 限制 GitHub host、仓库、tag、路径穿越、文件数、单文件大小和下载超时。
- 安装先在目标 `skills` 目录的 staging 中写入并校验全部文件，再把旧目录移动到 Agent 配置根目录下的 `musefold-skill-backups`（位于 Skill 扫描目录之外），随后原子换入新目录；失败时恢复旧目录。禁止在 `skills` 下保留含 `SKILL.md` 的备份，避免同名 Skill 被重复发现。
- `.musefold-install.json` 记录版本、来源、安装时间和文件哈希。旧安装没有 sidecar 时，回退读取 `SKILL.md` 的 HTML 版本标记；两者都没有则显示“旧版/版本未知”。
- 设置 → 自动化提供检查、安装/更新/重新安装和自动更新开关。自动更新默认关闭；开启后只更新已经安装 Musefold Skill 的 Agent 目标，不会向未使用的客户端静默安装。
- 启动时异步检查，不阻断窗口创建。网络或清单失败时保留已安装版本，并允许用户安装 App 内置版本。

新版 Skill 对旧 App 采用能力探测而非硬编码版本矩阵：先看 MCP 工具目录，再看 health capabilities；CLI 回退先执行 `status --json` 与 `help`。缺少 setup、参考图、异步等待、设计方案或 GitHub Skill 能力时，降级到 App UI。旧响应只有裸 `cost` 且没有 `costUnit` 时，单位视为未知，禁止猜测或换算。

完整更新契约见 `Musefold-Skills/SKILL-UPDATE-SPEC.md`。发布顺序必须是：更新 Skill 目录、兼容说明和 App 内置副本 → 计算 SHA-256 并更新 manifest → 提交并创建对应 annotated tag → **先推送并验证 tag** → 再推送 `main` 上的 manifest → 最后提交、验证并发布 App。若先把 manifest 推到 `main` 而 tag 尚不存在，客户端会发现版本但下载失败。

任何包含 App 源码的 Git 提交都必须执行 Skill 影响审查，并在提交消息记录唯一的 `Skill-Impact: none - <具体理由>` 或 `Skill-Impact: updated - vX.Y.Z` trailer。`.githooks/commit-msg` 在本地校验 staged 变更，GitHub Actions 对 push/PR 提交范围复核；声明 `updated` 时还会强制核对内置 `SKILL.md` 版本标记、`MUSEFOLD_SKILL_VERSION` 和版本提升。完整提交规则见根目录 `CONTRIBUTING.md`。

## 花费与审计

- 生图、Skill 和设计方案 run 是 spend 操作。
- 用户明确请求只授权当次操作。
- 互动确认、积分月预算和以积分计的 `--max-cost` 共同约束支出。
- Automation/MCP 使用 `points`、`estimatedPoints`、`actualPoints`、`costPoints`、`declaredBudgetPoints` 和 `remainingBudgetPoints`，不得按分解释或二次换算。
- 审计事实写入 DB 和 NDJSON 日志，不记录密钥。
