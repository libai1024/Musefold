# 04 · 生图与 Provider

## 1. 唯一生成路径

所有入口最终调用 `packages/core/src/services/generation.ts` 的 `MusefoldCore.generation.generate()`：

```text
请求
  → 规范化 jobId/historyId、n、ratio、quality、negative/background
  → 校验 workbench/run/skill/design-scheme/refinement 上下文
  → 参考图授权与最多 16 张限制
  → 写 generation run（如适用）
  → ProviderRegistry 选择实现
  → Provider 生成/下载/保存图片
  → 主库 history + references 事务写入
  → generation run / asset ledger / workbench session 更新
  → EventHub 发送进度和终态
```

请求失败、Provider 拒绝、取消和应用重启都保留可查询的终态。`jobId` 和 `historyId` 可由调用方传入，Core 会规范化并在冲突时拒绝。

## 2. 请求参数与数量

Renderer 的 `src/features/generation/params.ts` 把 UI 比例转换为 Provider 所需的 `size` 和 `aspectRatio`。支持 `1:1`、`2:3`、`3:4`、`3:2`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`21:9`、`auto` 以及 `custom:W:H`；最大宽高比 4:1。OpenAI-compatible 会再按方向映射 OpenAI size。

普通 Core 请求允许按入口约定的 `n`；工作台每个 `n` 都拆成独立 job/history。Automation 和 MCP 的 schema 上限是 4。Doubao 网页 Provider 强制每个请求 1 张，Renderer 也会将其 `n` 归一为 1。

## 3. 参考图安全模型

`packages/core/src/providers/local-image.ts` 对本地上传执行：

- 最大 20 MiB；
- PNG/JPEG/WebP magic header 校验；
- 复制到 `previews/uploads/<ULID>`，而不是信任用户输入路径；
- 历史图片必须存在于 history 且路径/状态匹配；
- 最多 16 张参考图。

Automation 主机进一步以 `realpath` 校验路径根，只允许受控 uploads、previews、Pictures 目录。Core 会在生成前授权 refs，不能用任意绝对路径读取文件。

精修有两种行为：Doubao 只发送“精修指令文本”并保留已上传参考图上下文；其他 Provider 组合原始 prompt、精修指令和图片提示。重试使用历史中的原始请求快照；如果历史不存在，Renderer 允许回退为一次普通 generate。

## 4. Provider Registry

`packages/core/src/providers/registry.ts` 当前注册：

| type | 实现 | 关键行为 |
| --- | --- | --- |
| `openai`、`openai-compatible` | `OpenAICompatibleProvider` | OpenAI SDK；`/models`；文本生图和 `/images/edits` 参考图；原始 b64 写 PNG。 |
| `doubao-web` | `DoubaoWebProvider` | 委托 Electron 注入的网页自动化 runtime；不读 API key；模型固定为 `seedream-4.5`。 |

Core 对外只返回不含 secret 的 `ProviderConfig`，包括 `managedBy`。UI 不允许编辑 account-managed Provider。

### OpenAI-compatible

读取 runtime 的 key，OpenAI SDK `maxRetries=0`，由自身重试逻辑控制。生成调用 `client.images.generate`，携带 model/prompt/n/size/quality/background/moderation；有参考图时使用 multipart `/images/edits` 并附 Authorization。b64 内容写入 `getPaths().pictures/{jobId}.png`，再读取真实像素尺寸并返回 mismatch 警告。

错误会归一化为 `AUTH`、`NO_BALANCE`、`MODEL_NOT_FOUND`、`BAD_REQUEST`、`RATE_LIMIT`、`SERVER`、`NETWORK`。支持 Retry-After 和指数退避。

### Doubao 网页版

`electron/doubao-web/browser-service.ts` 使用持久分区 `persist:musefold-doubao-web-v1`，BrowserWindow 1120x820、sandbox/contextIsolation、无 Node integration、无 preload、禁止非 HTTPS 导航和新窗口。登录/验证通过 DOM 观察，不导出 cookie。

提交前上传多张参考图到页面的 file input，记录基线图片 URL；填充 contenteditable 和发送按钮后，以 900ms 轮询 DOM，过滤用户上传图，等待 partial 稳定 6s，最多收集预期 4 张。数据 URL/blob/CDN 下载前做签名和大小校验，最大图片 50 MiB，写入 `Pictures/Musefold/v0.3.0`。网页 Provider 返回成本 0，但本地每日限额仍会计数。

额度由 `electron/doubao-web/usage-limit.ts` 控制：日期使用本地日期；作用域为已识别账号名的 `doubao-web-image:<normalized accountName>`，每日上限 10；旧全局行只向首次识别账号迁移一次并清理旧行。预留成功后即使后续失败也计入额度。

## 5. 重试、取消与终态

`packages/core/src/providers/retry.ts` 最多 3 次，基础等待 1s、最大 30s，处理 429/500/502/503 和网络错误，带 jitter、Retry-After 和 AbortSignal。Generation service 为每个 job 维护 AbortController；`cancelGeneration(jobId)` 会通知 Provider，并将历史/运行账本写成 cancelled（具体 Provider 若已提交远端任务，远端是否同步取消取实现）。

Provider 错误映射：

| Provider code | Core managed code |
| --- | --- |
| `NO_BALANCE` | `ACCOUNT/QUOTA` |
| `AUTH` | `ACCOUNT/AUTH` |
| `MODEL_NOT_FOUND` | `ACCOUNT/MODEL_NOT_FOUND` |
| 其他 | 保留可序列化 Provider 错误与重试信息 |

返回结果可能包含 `images[]`、首图 `imagePath`、实际尺寸、成本、成本单位、warnings。所有终态先写账本，再向 EventHub/Automation/SSE 发布。

## 6. 计费语义

所有 Provider、历史、Automation、CLI 和 MCP 成本统一为用户可见积分，`costUnit` 固定为 `point`。`1 积分 = ¥0.1 = 50,000` 账号原始配额；人民币金额和原始配额只能在 Provider/旧数据边界换算，不进入预算判断。

账号托管 Provider 从服务器同步单价并通过内部 cache 估算，成功记录服务器提供的积分成本；托管价格未知时，自动化仍需要确认。非托管 Provider 不读取本地 pricing，成功记录的 `history.cost` 为 `NULL`，预算门按不计费放行。Doubao 成本固定为 0，并继续纳入云端 quota、budget 和审计体系。

## 7. Provider 预设

`packages/domain/src/constants.ts` 提供 Doubao 网页 `https://www.doubao.com/chat/create-image` 和 TvT OpenAI-compatible `https://ai.tvt.wiki/v1` / `gpt-image-2`。这些是预设，不代表服务可用、价格稳定或密钥已配置。

### 源码证据

- `packages/core/src/services/generation.ts`
- `packages/core/src/providers/{registry,openai-compatible,doubao-web,local-image,retry}.ts`
- `electron/doubao-web/{browser-service,usage-limit}.ts`
- `src/features/generation/{params.ts,workbench/store.ts}`
- `packages/domain/src/constants.ts`
