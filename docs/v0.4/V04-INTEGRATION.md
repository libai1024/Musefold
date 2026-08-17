# v0.4 · 接入指南（Agent 与脚本）

> 面向用户的接入文档（V04-DOC-01）。前提：Musefold 桌面应用 ≥ 0.4.0 正在运行
> （或 `musefold serve` 守护），设置 → 自动化 处于开启状态（默认开启）。

## 0. 安装版如何部署 CLI

CLI 是 App 内置产物的用户级 shim，不复制运行时、不依赖系统 Node.js，也不接触账号或 Provider 凭据。

| 场景 | 自动安装时机 | 目标 | 权限与后续动作 |
| --- | --- | --- | --- |
| macOS DMG | App 已放入 `/Applications` 或 `~/Applications` 后首次启动；升级首启会幂等修复 | `~/.local/bin/musefold`；zsh 写 `~/.zprofile`，bash 写其实际登录 profile，fish 写 `~/.config/fish/conf.d/musefold.fish` 的可逆标记块 | 不需要管理员权限；已打开终端/Agent 要重启 |
| macOS 从 DMG、Downloads 或其他临时位置直接运行 | 自动安装延后，避免 shim 指向卸载后消失的卷或临时路径 | 用户在移动 App 后重启，或在设置 → 自动化点“修复安装” | 不弹系统授权；自定义 shell 可能需手动把 `~/.local/bin` 加入 PATH |
| Windows NSIS | 安装器 `customInstall` 阶段；首启/升级再次校验修复 | `%USERPROFILE%\.musefold\bin\musefold.cmd` + HKCU 用户 PATH | 默认按用户安装，不需要管理员权限；广播环境变化，但已打开终端/Agent 仍要重启 |
| Windows portable/unpacked | 首次启动 App | 同上 | 企业策略禁止修改 HKCU 时，设置页会显示失败并保留手动修复入口 |

Apple Silicon 与 Intel Mac 共用同一 shim 逻辑；shim 调用当前 App 自带的对应架构 Electron，不下载另一份二进制。选择用户级目录而不是 `/usr/local/bin`，是为了避免首次使用弹管理员密码、避免系统级 PATH 污染，并让安装/修复/移除都由同一用户完成。

macOS DMG 的拖拽复制阶段不能执行 postinstall；如强制在“安装时”写 `/usr/local/bin`，必须改用带系统安装脚本的 PKG 并请求管理员授权。本项目不采用该方案。删除 macOS App 前应先在设置 → 自动化点“移除”，否则只会残留一个无效的小型 shim 和无害的 `~/.local/bin` PATH 项。

## 1. 一分钟接入 MCP

> npm 包发布后可用 `npx -y musefold mcp`；仓库内开发用
> `node <repo>/packages/mcp/dist/musefold-mcp.mjs`（先 `node scripts/build-cli.mjs`）。

### Claude Code

```bash
claude mcp add musefold -- npx -y musefold mcp
```

或项目级 `.mcp.json`：

```json
{ "mcpServers": { "musefold": {
    "type": "stdio", "command": "npx", "args": ["-y", "musefold", "mcp"] } } }
```

### Codex（CLI / IDE 共享）

```toml
# ~/.codex/config.toml —— 注意蛇形键名 mcp_servers
[mcp_servers.musefold]
command = "npx"
args = ["-y", "musefold", "mcp"]
startup_timeout_sec = 20
tool_timeout_sec = 300          # 生图必须调大；后台提交用 wait:false + wait_for_generation 一次等待
```

### Cursor

```json
// .cursor/mcp.json（项目）或 ~/.cursor/mcp.json（全局）
{ "mcpServers": { "musefold": {
    "command": "npx", "args": ["-y", "musefold", "mcp"] } } }
```

团队/CI 只读接入：`args: ["-y", "musefold", "mcp", "--readonly", "--toolsets", "library,recipes,history"]`
（目录中根本不存在写/花钱工具，而非运行时拒绝。）

## 2. 花钱动作如何被管控

1. 所有生图/方案/Skill 运行由**控制面服务端强制**管控（工具注解只是提示）。
2. 默认预算 ¥0：每次花钱动作都会在 Musefold 桌面应用弹出**确认卡**（右下角）+ 系统通知，
   120 秒未确认自动拒绝。
3. 在 设置 → 自动化 配置月度预算后，预算内的调用自动放行，按**实际成本**冲销，跨月清零。
4. CLI 的 `-y`（交互同意）等价你本人在终端确认；MCP 工具面不存在该字段。

## 3. CLI 速查

```bash
musefold status                                   # 三态发现：App / 守护 / 无
musefold prompt search "赛博街景" --json | jq      # 库检索（stdout 只有 JSON）
musefold recipe compile <id> --var title=发布会 \
  | musefold generate --stdin-prompt -y -o ./out/  # 场景 C：编译 → 管道 → 出图
musefold scheme run <id> --input topic=中秋 -y     # 正式方案直出
musefold skill run https://github.com/<owner>/<skill> -p "秋日咖啡节" -y
musefold serve --headless                          # 无 GUI 拥有数据库（与桌面 App 互斥）
```

退出码：`0` 成功 · `2` 参数 · `3` 连不上 · `4` 用户拒绝/需 --yes · `5` 超预算 · `6` Provider 失败 · `130` Ctrl-C。

## 4. CI 无人值守（场景 C）

```bash
# 密钥经环境变量注入（不落盘）；ID 中非字母数字折叠为下划线大写
export MUSEFOLD_PROVIDER_KEY_01ABCD...=sk-xxxx
musefold serve --data-dir "$RUNNER_TEMP/musefold" &
musefold recipe compile brand-cover --var title="v0.4 Release" \
  | musefold generate --stdin-prompt -y --max-cost 50 --json
```

注意：无人值守下确认一律拒绝（T9）——必须 `-y` 且建议 `--max-cost`；
方案/Skill 运行需要桌面 App（headless v0.4 覆盖只读 + 生图闭环）。

## 5. 直接调 HTTP（第三方脚本）

端口与 token 在 `userData/automation.json`（0600，仅本机可读）：

```bash
TOKEN=$(jq -r .token ~/Library/Application\ Support/Musefold/automation.json)
PORT=$(jq -r .port  ~/Library/Application\ Support/Musefold/automation.json)
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/health" | jq
```

红线：任何响应不含明文 API Key；带 `Origin` 头的请求一律 403；仅监听 127.0.0.1。
