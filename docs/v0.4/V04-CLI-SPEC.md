# V04 · CLI 规格（musefold）

> **状态**：设计规格（待评审）
> **定位**：`musefold` 是控制面的**薄客户端**（不开 DB、不碰密钥文件），同时承载两个特殊子命令：`musefold serve`（headless 所有者）与 `musefold mcp`（MCP 服务器壳）。
> **设计准则**：遵循 clig.dev 共识（见 V04-RESEARCH §5）——人类优先、`--json` 机器可读、stdout 只放数据、显式退出码、密钥不进 argv。

---

## 1. 全局约定

### 1.1 全局参数

| 参数 | 说明 |
|---|---|
| `--json` | stdout 输出稳定 JSON；流式命令输出 NDJSON（一行一事件） |
| `--quiet, -q` | 仅结果与错误 |
| `--yes, -y` | 跳过交互确认（花钱动作仍受 `--max-cost`/预算约束） |
| `--max-cost <cents>` | 本次命令花费上限（分）；超出即拒绝（exit 5） |
| `--endpoint <url>` / `--token <t>` | 显式控制面（默认走发现链：env → 发现文件） |
| `--autostart` | 连接失败时尝试拉起桌面 App（macOS `open -gja Musefold`），最多等 10s |
| `--no-color` | 关闭色彩（非 TTY 与 `NO_COLOR` 环境变量自动生效） |

### 1.2 退出码

`0` 成功 · `1` 一般错误 · `2` 参数错误 · `3` 无法连接 Musefold · `4` 用户拒绝/未确认 · `5` 超预算 · `6` Provider 失败 · `130` Ctrl-C（已发 cancel）

### 1.3 输出契约

- 人类模式：紧凑表格/键值；进度条走 **stderr**。
- `--json` 模式：stdout 仅 JSON。单次命令输出单个对象；长任务输出 NDJSON 事件流，最后一行是 `{"type":"result",…}`。
- 错误（两种模式统一）：stderr 人话 + `--json` 时 stdout 末行 `{"type":"error","code":"…","message":"…"}`。

### 1.4 配置优先级

`flags` > `MUSEFOLD_*` 环境变量 > `~/.config/musefold/cli.json`（可存默认 provider、默认输出目录、默认 `--json`）> 发现文件。

---

## 2. 命令树

```
musefold
├── status                        # 连接诊断：所有者/版本/能力/预算余额
├── generate                      # 生图（文生图/垫图/精修/配方直出）
├── cancel <jobId>
├── prompt   list|get|search|add|rm
├── recipe   list|show|compile|run
├── scheme   list|show|compile|run
├── skill    run <github-url>
├── material list
├── history  list|show|open
├── provider list|models|add|set-key|rm|validate|use
├── backup   now|list|restore <id>
├── export [--out <path>] / import <path>
├── serve                         # headless 守护（拥有 DB；与桌面 App 互斥）
└── mcp                           # 启动 MCP stdio 服务器（见 V04-MCP-SERVER-SPEC）
```

---

## 3. 关键命令规格

### 3.1 `musefold generate`

```bash
musefold generate -p "a minimal zine poster, autumn coffee festival" \
  [--provider tvt] [--model gpt-image-2] [--ratio 3:4] [-n 2] \
  [--ref ./a.png --ref ./b.png] [--ref-history <historyId>] \
  [--negative "text, watermark"] [--quality high] \
  [--recipe <recipeId> --var key=value ...] \
  [--stdin-prompt] [-o ./out/] [--no-wait] [--json] [-y] [--max-cost 50]
```

| 要点 | 行为 |
|---|---|
| 提示词来源 | `-p` / `--stdin-prompt`（管道） / `--recipe`（服务端先编译，`--var` 填变量），三选一 |
| 确认 | TTY：显示 Provider/模型/张数/**预估成本** → y/N；非 TTY 且无 `-y`：直接 exit 4（CI 不允许静默花钱） |
| 参考图 | `--ref` 本地路径由 CLI 调 `/v1/uploads` 转为受管路径（等价 App 内 `stageLocal`），规避白名单问题；≤16 张 |
| 进度 | stderr 进度条；`--json` 时 NDJSON：`{"type":"progress","phase":"generating","percent":42}` |
| 产物 | 默认留在 `~/Pictures/Musefold/...` 并打印路径；`-o` 目录时**复制**过去（账本仍指向受管路径） |
| 输出（`--json` 末行） | `{"type":"result","jobId":"…","historyId":"…","status":"success","assets":[{"path":"…"}],"costCents":18,"durationMs":21034}` |
| `--no-wait` | 受理即返回 jobId；供外部任务系统自行接管，普通交互应省略该参数并让 CLI 通过事件流等待完成 |
| Ctrl-C | 先发 `DELETE /v1/generations/:jobId` 再退出（exit 130） |

### 3.2 `musefold prompt`

```bash
musefold prompt search "cyberpunk 街景" --tag 风格 --limit 10
musefold prompt get <id> [--json]           # 正文输出到 stdout，可直接管道
musefold prompt add --title "秋日咖啡节海报" --body-file ./p.txt --tag 海报
echo "..." | musefold prompt add --title t --stdin
musefold prompt rm <id> --force             # 软删进回收站；无 --force 仅预览
```

### 3.3 `musefold recipe` / `musefold scheme`

```bash
musefold recipe compile <recipeId> --var title="v0.4 Release" [--json]
  # stdout = 最终提示词（纯文本），warnings 走 stderr —— 可直接管给 generate --stdin-prompt
musefold recipe run <recipeId> --var k=v [generate 的全部生图参数]
musefold scheme list [--json]                # 仅正式方案
musefold scheme compile <schemeId> --input k=v [--priority scheme_first]
musefold scheme run <schemeId> --input k=v --slot cover=./ref.png [-y]
```

### 3.4 `musefold skill run`

```bash
musefold skill run https://github.com/LiamGvchi/gc-minimal-zine-poster \
  -p "秋日咖啡节主题" [--ref ./logo.png] [-y]
# 事件流打印 Agent 轨迹（读了哪些文件、发起几次生图）；不执行仓库脚本
```

### 3.5 `musefold provider`

```bash
musefold provider list [--json]              # 永不显示 key；显示 hasKey/尾4位/单价
musefold provider add --name tvt --type openai-compatible --base-url https://… --model gpt-image-2
musefold provider set-key tvt                # 交互式隐藏输入；或 --stdin / --from-env TVT_KEY
musefold provider validate tvt               # 连通性测试
musefold provider use tvt                    # 设为激活
```

**安全规则**：`set-key` 拒绝 argv 明文（检测到直接报错并提示三种安全方式）。密钥写入走控制面「本地专属端点」——仅当调用方与所有者同机同用户时受理（V04-SECURITY §4.3）。

### 3.6 `musefold serve`（headless 所有者）

```bash
musefold serve [--headless] [--port 0] [--data-dir <path>]
```

- 获取 `owner.lock` 失败 ⇒ 提示已有所有者并退出（exit 3）。
- 成功后：初始化 core（headless SecretsPort）→ 起控制面 → 写发现文件 → 前台运行（`Ctrl-C` 优雅退出：等在跑任务完成或 30s 超时取消）。
- 日志 NDJSON 到 stderr + `logsDir`；`--data-dir` 仅用于测试/多实例，默认严格复用桌面 App 的 `userData` 路径。

### 3.7 `musefold status`

```bash
$ musefold status
Musefold  已连接（desktop-app · v0.4.0 · api v1）
数据      3 库就绪 · 提示词 412 · 配方 23 · 正式方案 6
Provider  tvt (激活, key ✓) · wukong (key ✓)
预算      本月自动化预算 ¥20.00，已用 ¥3.42
```

---

## 4. 与 MCP 的关系

`musefold mcp` 与 CLI 共享 `@musefold/client`（发现 + typed fetch + SSE），因此**两者行为一致**：同样的发现链、同样的错误码、同样的策略闸门。CLI 是人对控制面说话，MCP 是模型对控制面说话。

---

## 5. 打包与分发

| 项 | 决定 |
|---|---|
| 包 | `musefold`（bin: `musefold`）+ `@musefold/mcp`（bin: `musefold-mcp`，依赖并转发到同一实现） |
| Node 要求 | `engines.node >= 20`（与 Electron 内置一致，better-sqlite3 不进 CLI 依赖树——CLI 是纯 HTTP 客户端） |
| 构建 | tsup/esbuild 单文件 ESM + shebang；冷启动目标 < 300ms |
| 版本 | 与 App 松耦合：CLI 主副版本跟随 Automation API（v1 ⇒ CLI 1.x）；`musefold status` 显示双端版本并提示不匹配 |
| 后续 | P4 后评估 Node SEA 单文件二进制 + Homebrew tap（`brew install musefold`） |

> 注意：`serve` 需要 core（含 better-sqlite3 原生模块）。方案：`musefold serve` 检测到未安装 `@musefold/core-runtime` 时提示 `npm i -g @musefold/core-runtime`（可选依赖，避免纯客户端用户被迫编译原生模块）。🔶 此项打包细节 P4 定稿。

---

## 6. 验收清单（P3/P4 出口）

- [ ] 场景 B/C（README §6）终端实测通过
- [ ] `--json` 输出经 `jq` 全链路管道测试；NDJSON 事件 schema 固定
- [ ] 非 TTY + 无 `-y` 的花钱命令一律 exit 4，零网络调用
- [ ] `set-key` argv 明文防护生效；`ps` 抓不到任何密钥
- [ ] App 运行中/关闭/守护三态下发现链正确；`--autostart` 可用
- [ ] Ctrl-C 取消：控制面任务确实终止且历史记 `cancelled`
- [ ] `npx -y musefold status` 在干净机器（无全局安装）可用
