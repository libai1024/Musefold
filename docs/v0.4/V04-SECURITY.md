# V04 · 安全模型

> **状态**：设计规格（待评审）
> **原则**：v0.4 的开放是**受控开放**。默认姿态 = 只读自由、写入受限、花钱必须经人（或人预先授权的预算）。所有控制在**服务端（控制面）强制**，客户端注解与文案只是提示。

---

## 1. 保护对象与信任边界

| 资产 | 等级 | 说明 |
|---|---|---|
| Provider / AI 连接明文 Key | ★★★ | 泄露 = 直接资金损失 |
| 用户资金（生图调用） | ★★★ | 每次生图都花真钱 |
| 本地创作数据（3×SQLite + 图片） | ★★☆ | 隐私 + 资产 |
| 控制面 token | ★★☆ | 等于「操作 Musefold 的钥匙」（但≠密钥：拿到 token 也读不到 Key） |

信任边界划分：

```
可信：所有者进程（App 主进程 / headless 守护）+ 用户本人的交互确认
半可信：持有 token 的本机进程（CLI、musefold-mcp、用户脚本）—— 可调 API，受策略闸门约束
不可信：MCP 客户端会话中的模型输出（可能被提示注入操纵）、第三方 Skill 仓库内容、其他本机进程
```

---

## 2. 威胁清单与对策

| # | 威胁 | 对策 |
|---|---|---|
| T1 | 提示注入驱使 Agent 疯狂生图烧钱 | 服务端策略闸门：逐次确认（elicitation/系统通知）或**月度预算硬上限**；单次请求 `n≤4`；速率限制（默认 10 req/min 生图类）；朱点忙碌态全局可见 |
| T2 | 恶意本机进程读取发现文件冒充客户端 | 发现文件 `0600`；token 只授予「能做 API 允许的事」——**没有任何 API 能读出 Key**；设置页一键轮换 token + 审计列表回查 |
| T3 | 通过 `referenceImagePaths` 读任意文件（路径穿越/symlink） | 路径白名单（§5）：canonicalize 后必须落在受管目录内；CLI 的任意路径先经 `/v1/uploads` 显式转存 |
| T4 | MCP 工具被用来外传敏感数据 | 工具面无「读任意文件」「发任意 HTTP」能力；外联仅 Provider 与 GitHub 只读，目标域名由所有者进程决定 |
| T5 | 第三方 Skill 仓库投毒（恶意脚本/超大文件） | 延续 v3.1 红线：**永不执行仓库脚本**；固定 commit；体积/数量预算（32 MiB 归档、64 MiB 解包等）；仅读文本与图片 |
| T6 | 浏览器页面探测 loopback 端口（DNS rebinding 类） | 仅 127.0.0.1 绑定；请求带 `Origin` 头一律 403；Bearer token 必需；无 CORS |
| T7 | 密钥经日志/错误信息泄露 | 沿用主进程脱敏日志；错误信封 `details` 白名单字段；`--json` 输出结构固定不透传原始响应体 |
| T8 | headless 环境密钥落盘明文 | §4 分级方案；明确拒绝「配置文件写明文 key」路径 |
| T9 | CI 无人值守静默花钱 | 非 TTY 默认拒绝（exit 4）；必须显式 `--yes` **且**受 `--max-cost`/预算约束 |
| T10 | 工具描述漂移误导模型（rug-pull 观感） | 工具名/描述/schema 进入契约冻结（D10「只加不改」）；变更走版本发布说明 |

---

## 3. 花钱动作管控（细化 D7）

1. **估算**：控制面用单价配置（`settings.pricing`）× 张数 × 尺寸档得出 `estimatedCents`；无单价配置时按「未知成本」处理 = 必须确认。
2. **三条放行路径**（按序判定）：
   - a. 交互确认：App 确认卡（App 在跑）或 MCP elicitation（客户端支持）→ 用户看到 Provider/模型/张数/预估费用；
   - b. 预算命中：设置页「自动化预算」（月度上限 + 剩余额度），`estimatedCents ≤ 剩余` 时自动放行并记账；
   - c. CLI `--yes` + `--max-cost`：视为一次性预算授权。
3. **事后**：实际成本回写账本与审计（预算按**实际**成本冲销，估算只用于闸门）；连续 3 次失败自动熔断该调用方 10 分钟（防重试风暴）。
4. **审计**：`automation_audit` 表（所有者进程内）记录：时间、调用方（cli/mcp/http + 客户端名）、工具/端点、**完整提示词与参数**（产品拍板 2026-08-13：追溯完整性优先；审计数据仅存本机所有者进程 SQLite，不进任何导出/分享/日志文本）、估算/实际成本、放行路径、结果。设置页可视化最近 50 条（列表视图默认显示截断摘要，点开看全文）。

---

## 4. 密钥架构（SecretsPort 双实现）

### 4.1 Electron 实现（现状，不变）

`safeStorage.encryptString` → electron-store（`musefold-providers-v0.3.0` / `musefold-ai-connections-v0.3.0`）。

### 4.2 headless 实现（`musefold serve`，按优先级降级）

| 优先级 | 方案 | 说明 |
|---|---|---|
| 1 | OS 凭据库（macOS Keychain / Windows Credential Manager / libsecret） | 经 keytar 等价库；与 App 的 safeStorage 存储**并存**（两套存储、同一 SecretsPort 接口），首次 headless 启动提供 `musefold provider set-key` 引导 |
| 2 | 环境变量注入 | `MUSEFOLD_PROVIDER_KEY_<PROVIDERID>=sk-…`（CI 推荐：密钥由 CI secret 管理，进程内存态，不落盘） |
| 3 | 加密文件 + 主密钥 | `MUSEFOLD_MASTER_KEY` 环境变量派生 AES-256-GCM 加密 `secrets.enc`；无主密钥则该 Provider 标记 `available:false` |

**明确拒绝**：明文 key 写任何配置文件；`--api-key` 之类 argv 参数（`ps` 可见）。

### 4.3 `set-key` 的「本地专属」通道

写密钥的端点仅在满足全部条件时受理：① 请求携带有效 token；② 控制面确认请求源为 loopback；③ 一次性质询——控制面在 `dataDir` 写临时随机文件，要求调用方回读其内容（证明与所有者同用户同机、拥有同等文件权限，token 泄露亦无法跨用户写 Key）。MCP 工具面**不存在**该能力。

---

## 5. 参考图路径白名单

允许集合（canonicalize + `realpath` 后前缀匹配）：

1. `userData/musefold-previews-v0.3.0/uploads/`（受管暂存——CLI/HTTP 客户端经 `POST /v1/uploads` 显式转存进来）；
2. `~/Pictures/Musefold/**`（历史产物，支持精修）；
3. 用户在设置页显式添加的目录（如素材库文件夹），默认空。

拒绝：白名单外路径、解析后越界的 symlink、非 PNG/JPG/WebP、>20 MiB、总数 >16（沿用 v0.3 决策）。错误码 `PATH_NOT_ALLOWED`。

---

## 6. 控制面加固清单

- [ ] 仅绑定 `127.0.0.1`（IPv4 + IPv6 loopback），永不 `0.0.0.0`
- [ ] Bearer token：32 字节 CSPRNG，base64url；常量时间比较；设置页轮换（旧 token 立即失效并广播 SSE `token.rotated`）
- [ ] 带 `Origin` 头的请求一律 403（非浏览器 API）
- [ ] 请求体上限 2 MiB（上传端点单独 25 MiB）；JSON 深度限制
- [ ] 速率限制：全局 60 req/min，生图类 10 req/min，超限 429
- [ ] 发现文件与 token 文件权限 `0600`；启动时校验，不符则重建
- [ ] 审计记录完整提示词仅落所有者进程 SQLite（Q5 拍板）；**文本日志（logsDir）仍只写截断摘要**；任何审计/日志绝不含密钥材料
- [ ] `automation.enabled=false` 时：不监听、不写发现文件（功能完全可关）

---

## 7. MCP 侧安全要点

1. **注解诚实**：`readOnlyHint` 只标真正无副作用的工具；`generate_image` 等绝不标 readOnly（部分客户端会对 readOnly 跳过人工审批）。
2. **elicitation 不收敏感信息**：确认卡只展示费用与参数，永远不请求输入 key（规范红线）。
3. `--readonly` 模式供团队共享配置：目录中根本不存在写/花钱工具（而非运行时拒绝）。
4. 降级目录（App 未运行）只含 `musefold_status`，避免模型对不可用工具反复重试。
5. 工具描述内不嵌入可被注入利用的指令模板；描述只说明能力与参数。

---

## 8. 红线清单（v0.4 恒真式）

1. 明文 Key 永不出所有者进程；MCP/HTTP/CLI 任何响应不含 key 字段（连 `key_suffix` 也仅出现在本地 CLI `provider list`）。
2. 永不执行第三方 Skill/仓库脚本（`.sh/.py/.js`）；无 `shell.exec` 类工具。
3. 未经确认或预算授权，不发生任何产生费用的 Provider 调用。
4. 控制面永不监听非 loopback 地址（远程化是 v0.5 的独立安全评审）。
5. 桌面 App 与 headless 守护永不同时持有 DB 写权。
