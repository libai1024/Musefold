# 05 · 图像生成规格

> Provider 抽象、密钥安全、gpt-image-2 调用、错误重试、生成历史。

---

## 1. Provider 配置

用户自配中转站或官方 API，App 保持 provider 无关。

### 1.1 配置字段（`providers` 表 + electron-store 密钥）
| 字段 | 说明 |
|---|---|
| name | 用户起的名字（如"我的 OneAPI"） |
| type | `openai` \| `openai-compatible` |
| base_url | 如 `https://api.openai.com/v1` 或中转站 `https://api.xxx.com/v1` |
| model | 默认 model 字符串，如 `gpt-image-2` |
| api_key | 用 safeStorage 加密存于 electron-store，**不入 DB** |

### 1.2 设计原则
- **不内置任何中转站域名**，用户自选后端，规避合规风险
- 支持自定义 model 字符串（部分中转站会改写模型名）
- 多 Provider 配置，其中一个 `is_active=1` 为默认

---

## 2. ImageProvider 抽象

```ts
// shared/types/providers.ts
export interface ImageProvider {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;
  listModels(): ModelInfo[];
  generateImage(req: GenerateImageRequest): Promise<GenerateImageResult>;
  validateConnection(): Promise<ValidationResult>;
}
```

### 2.1 OpenAICompatibleProvider（最常用）
- 用 OpenAI SDK，`baseURL` 可配
- 覆盖：中转站、Azure、OneAPI、NewAPI、官方 OpenAI
- `generateImage` 调 `POST {base_url}/v1/images/generations`

### 2.2 未来扩展（不在 MVP）
- `StabilityAIProvider`、`MidjourneyProvider`（异步任务）、`ComfyUIProvider`（本地）
- 用工厂模式 + 注册表，新增 provider 不改核心

---

## 3. gpt-image-2 调用

### 3.1 请求
```
POST {base_url}/v1/images/generations

{
  "model": "gpt-image-2",         // 用户可自定义字符串
  "prompt": "...",
  "n": 1,
  "size": "1024x1024",            // 1024x1024 / 1536x1024 / 1024x1536 / 2048x2048 / auto
  "quality": "high",              // low / medium / high / auto
  "background": "auto",           // auto(默认) / transparent / opaque（新增）
  "moderation": "auto"            // auto / low（新增）
}
```

### 3.2 返回
- `data[0].b64_json`：base64 图片，解码写盘到 `~/Pictures/PromptForge/{ulid}.png`
- 不再返回 URL（gpt-image 系直接 base64）

### 3.3 模型抽象层原则
- App 不硬编码 `gpt-image-2`，`model` 是用户可配字符串
- OpenAI 若发布 `gpt-image-3`，用户改配置即可，App 零改动
- 新增参数（`stream`/`partial_images` 等）按需暴露到 UI，不破坏现有调用

---

## 4. 密钥安全存储

### 4.1 safeStorage 异步 API（2026 官方推荐）

```ts
// electron/security/keychain.ts
import { safeStorage } from 'electron';
import Store from 'electron-store';

const store = new Store({ name: 'providers' });

export async function saveApiKey(providerId: string, apiKey: string) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统不支持 safeStorage，请使用主密码方案');
  }
  const encrypted = await safeStorage.encryptStringAsync(apiKey);
  store.set(`keys.${providerId}`, encrypted.toString('base64'));
}

export async function loadApiKey(providerId: string): Promise<string | null> {
  const b64 = store.get(`keys.${providerId}`);
  if (!b64) return null;
  const buf = Buffer.from(b64 as string, 'base64');
  return safeStorage.decryptStringAsync(buf);
}
```

### 4.2 安全红线
- 永不打包 API key 到代码/构建产物
- `contextIsolation: true` + `nodeIntegration: false`
- 不在日志打印 key（封装 OpenAI client 拦截器脱敏请求头）
- 渲染进程不持有明文 key：查询 Provider 配置只返回 `hasKey` + `keySuffix`（末 4 位）
- 明文 key 只在主进程 Provider 实例内存中短暂存在，请求后释放

### 4.3 Windows：密文只在主密钥落盘之后才写

Chromium 在 Windows 上把 DPAPI 包裹的 safeStorage 主密钥写进 userData 的
`Local State`（pref 名 `os_crypt.encrypted_key`）。`os_crypt_win.cc` 只调用
`PrefService::SetString`，不调用 `CommitPendingWrite`，因此这次写入要等
`JsonPrefStore` 的 10 秒提交定时器。定时器到期前强制退出（崩溃、断电、任务
管理器结束进程），重启后 Chromium 找不到密钥就会另生成一把，此前写下的密文
全部作废，界面表现为「未配置密钥」。

Chromium 没有暴露强制落盘的接口，所以 `electron/security/os-crypt-durability.ts`
把因果反过来：**主密钥在盘上之后才允许写密文**。`saveApiKey` 与
`ElectronAiSecretKeychain.save` 在加密前调用 `ensureOsCryptKeyPersisted()`，
它轮询 `Local State` 直到 `os_crypt.encrypted_key` 出现（预算 20s，Chromium 的
定时器是 10s）。

- 等待是同步的。渲染进程独立于主进程，主进程短暂阻塞不会冻结界面；而
  `saveApiKey` 的调用方（IPC、automation `LocalAdminOps`、账号编排）全是同步
  接口，改异步要穿透三条链路。代价只落在「装机后头 10 秒内保存密钥」，一台机器
  一生至多遇到一次；此后 `Local State` 已在盘上，探测是一次 `readFileSync`。
- 超时（20s）后放行并打日志：挡住保存比丢一次密钥更糟。
- macOS 不受影响（密钥在系统钥匙串，独立于 userData）。Linux 走
  `setUsePlainTextEncryption` 亦不受影响，故该等待只在 `win32` 生效。
- 密文在但解不开时 `loadApiKey` 仍返回 `null`（界面显示「未配置」），但会打一行
  warn，便于把「没配过」和「主密钥换了」区分开。
- 回归用例：`tests/e2e/test_28_uj04_crash_recovery.py::test_uj04_hard_kill_leaves_no_running_state`
  （强杀后重开，已存密钥必须仍可解密）。Windows E2E 不再降级为明文存储。

---

## 5. 错误处理与重试

| 错误类别 | 是否重试 | 用户提示 |
|---|---|---|
| 429 速率限制 | 是（指数退避，尊重 `Retry-After`） | 后台静默重试 |
| 500/502/503 | 是 | 后台静默重试 |
| 网络错误 | 是 | 后台静默重试 |
| 400 content_policy | 否 | 提示修改提示词 |
| 401/403 鉴权 | 否 | 引导更新 key |
| 余额不足 | 否 | 提示充值 |

### 5.1 指数退避
- base 1s，翻倍上限 30s，加 0-1s 随机抖动，最多 3 次
- 尊重 429 响应的 `Retry-After` 头

### 5.2 取消
- 用 `AbortController`，UI 提供取消按钮
- 取消后状态存 `cancelled`，历史可查

### 5.3 中转站错误容错
- 中转站错误体格式不一，`JSON.parse` 失败回退原始文本
- 尽量提取可读错误信息

### 5.4 失败任务也存历史
- 失败/取消的生图也写入 `history` 表，`status` 标记
- 支持查看原因并"重试"（用原参数重新发起）

---

## 6. 生成历史

每次生图（成功/失败/取消）写入 `history` 表：

| 字段 | 说明 |
|---|---|
| prompt_id / composition_id | 来源（可空） |
| provider_id / model | 用了哪个 Provider 和模型 |
| prompt_text / negative_text | 当时用的提示词（快照，防止后续编辑丢失） |
| params | size/quality/n/background 等 |
| status | success / failed / cancelled |
| error_code / error_message | 失败时 |
| image_path | 成功时本地路径 |
| cost | 估算成本（分），基于 usage token + 可配单价 |
| duration_ms | 耗时 |
| created_at | 时间戳 |

**History UI**（`src/pages/HistoryPage.tsx`）：
- 列表按时间倒序，缩略图 + 提示词摘要 + 状态 + 成本
- 点击查看详情：完整提示词 + 参数 + 错误信息（失败时）
- "重试"按钮：用原参数重新生图
- "另存为 Prompt"：把这次生图的 prompt_text 存入库

---

## 7. 多模型 target 感知（差异化壁垒）

同一份 Composition 可对不同模型输出不同语法（见 [04-composition-engine.md](04-composition-engine.md) §3 权重序列化）：

| target | 权重语法 |
|---|---|
| a1111/comfyui | `(word:1.5)` |
| midjourney | `word::15` |
| flux/sd3 | 纯自然语言（very/subtle） |
| openai (gpt-image) | 自然语言，无权重 |

生图时：根据选中 Provider 的类型，自动选对应 target 渲染 Composition。用户无需手动切语法。

---

## 8. 成本看板（V1）

- 基于 history 的 cost 累计
- 可配置每个 Provider 的单价（每千 token / 每张图）
- 按日/周/月统计

---

## 9. 验收标准

- [ ] Provider 配置：保存后 `hasKey=true`，明文不入 DB
- [ ] 密钥安全：渲染进程查询只返回 `hasKey` + `keySuffix`，明文永不离开主进程
- [ ] gpt-image-2 调用成功：b64 解码写盘到 `~/Pictures/PromptForge/`，文件可打开
- [ ] 429/5xx 重试：指数退避，最多 3 次，UI 显示"重试中"
- [ ] 401 鉴权失败：明确提示更新 key，不重试
- [ ] 取消：AbortController 生效，history 记 `cancelled`
- [ ] 失败任务存历史：可查看错误并重试
- [ ] 生成历史列表：按时间倒序，缩略图正确
