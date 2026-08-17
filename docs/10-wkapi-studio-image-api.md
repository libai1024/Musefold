# 10 · 悟空 API 创作台生图开发文档

> 面向 PromptForge / 第三方客户端接入 **悟空 API（wkapi.vip）「生图组」** 的开发说明。  
> 内容基于官方文档 [`/wkapi-docs.html`](https://wkapi.vip/wkapi-docs.html) 与 2026-08 实测验证。

---

## 1. 结论先看

| 问题 | 答案 |
|---|---|
| 能否用这个中转站生图？ | **能** |
| 是否走 OpenAI `images/generations`？ | **否** |
| 正确入口 | `https://wkapi.vip/api/v1/studio` |
| Key 分组 | 必须选 **「生图组」** |
| 调用模式 | **异步**：`submit` → `poll` → 下载 `url` |
| GPT-Image-2 的 product_id | `image_gptImage2` |

### 1.1 最常见失败原因

1. 把 Base URL 填成 `https://wkapi.vip/v1`，再调 `/images/generations`
2. Key 分组不是「生图组」（例如 `gpt-codex`）
3. 把 `product_id` 当成 OpenAI `model` 去调 chat/images
4. 轮询 `/poll` 时没带 `Authorization`

官方原话等价于：

> 画图走【创作台-生图组】；不要用 `/v1/chat/completions` 或 `/v1/images/generations`。

---

## 2. 服务信息

| 项 | 值 |
|---|---|
| 站点 | 悟空 API |
| 主站 | `https://wkapi.vip` |
| 备用站 | `https://wkapi.club`（账号/额度互通） |
| 对话类 API | `https://wkapi.vip/v1` |
| **生图/视频 API** | **`https://wkapi.vip/api/v1/studio`** |
| 官方接入说明 | `https://wkapi.vip/wkapi-docs.html` |
| 系统能力开关 | `enable_drawing=true`（站点支持绘图） |

> 主备域名底层互通。开发时优先主站；主站异常可切备用站，路径保持一致。

---

## 3. 鉴权与分组

### 3.1 Header

```http
Authorization: Bearer sk-xxxxxxxx
Content-Type: application/json
```

### 3.2 Key 要求

在控制台 **API 密钥** 中创建 Key，并满足：

| 配置项 | 要求 |
|---|---|
| 状态 | 已启用 |
| 分组 | **生图组** |
| 模型限制 | 可无限制（或包含创作台产品） |
| IP 限制 | 按需；本地开发可先无限制 |

「生图组」说明：

- 用途：AI 创作台生图 / 生视频
- 计费：按张（图）/ 按秒（视频）扣控制台余额
- 与 `gpt-codex`、`Gemini`、`claude-max` 等对话分组 **不是同一类 Key**

### 3.3 安全

- Key 只放本地安全存储（PromptForge：`safeStorage` / electron-store）
- 不入库明文、不写日志、不进 git
- 聊天里泄露过的 Key 应轮换

---

## 4. 接口一览

Base：`https://wkapi.vip/api/v1/studio`

| 方法 | 路径 | 鉴权 | 作用 |
|---|---|---|---|
| `GET` | `/catalog` | 可匿名 | 拉取产品目录、参数控件、上传限制 |
| `POST` | `/submit` | **需要** 生图组 Token | 提交生图/视频任务 |
| `GET` | `/poll?task_id=...` | **需要** 生图组 Token | 查询任务状态与结果 URL |

调用链：

```text
GET /catalog
   → 选择 product_id + 组装 payload
POST /submit
   → 拿到 task_id（通常已预扣费）
GET /poll?task_id=...
   → status=succeeded 后取 url/result
下载 url
   → 保存本地文件 / 写入生成历史
```

---

## 5. 获取产品目录

### 5.1 请求

```bash
curl -sS "https://wkapi.vip/api/v1/studio/catalog"
```

### 5.2 响应结构（节选）

```json
{
  "provider": "悟空API",
  "main": {
    "image": [
      {
        "id": "image_gptImage2",
        "name": "GPT-Image-2",
        "zone": "main",
        "category": "image",
        "price": "0.15 元/张",
        "desc": "OpenAI GPT 官方生图，支持参考图与多种输出比例",
        "controls": [
          {
            "key": "size",
            "label": "输出比例",
            "type": "select",
            "options": [{ "v": "1:1", "l": "1:1" }],
            "default": "1:1"
          }
        ],
        "uploads": [
          {
            "param": "urls",
            "label": "参考图",
            "kind": "image",
            "max": 6,
            "format": "array"
          }
        ]
      }
    ]
  },
  "toolbox": {},
  "zones": [],
  "studio_limits": {},
  "configured": true,
  "billing": {}
}
```

### 5.3 客户端用法建议

- 启动或进入生图页时缓存 `/catalog`
- UI 下拉框的模型列表用 `main.image[].id/name/price`
- 参数表单按 `controls[]` 动态渲染（不要写死）
- 参考图字段名读 `uploads[].param`（常见为 `urls`）

---

## 6. 提交生图任务

### 6.1 请求

```http
POST /api/v1/studio/submit
Authorization: Bearer sk-xxx
Content-Type: application/json
```

```json
{
  "product_id": "image_gptImage2",
  "wait": false,
  "payload": {
    "prompt": "a simple red apple on a white table, studio lighting",
    "size": "1:1"
  }
}
```

### 6.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `product_id` | string | 是 | 产品 ID，如 `image_gptImage2` |
| `wait` | boolean | 否 | 建议 `false`：立即返回 `task_id`，由客户端轮询 |
| `payload` | object | 是 | 业务参数 |
| `payload.prompt` | string | 是 | 提示词 |
| `payload.*` | any | 否 | 其余 key 必须与 `/catalog` 中该产品的 `controls[].key` / `uploads[].param` 一致 |

### 6.3 成功响应（实测）

```json
{
  "task_id": "image_a6d7fb62-59c7-4fc8-8b9d-5790ba3d2b92",
  "billing": {
    "quota": 75000,
    "yuan": 0.15,
    "unit": "张",
    "charged": true,
    "request_id": "5c7afca145f04cabaaef2435"
  }
}
```

| 字段 | 说明 |
|---|---|
| `task_id` | 后续轮询唯一 ID |
| `billing.yuan` | 本次扣费（元） |
| `billing.unit` | 计费单位，生图多为 `张` |
| `billing.charged` | 是否已扣费 |
| `billing.request_id` | 账单/排查 ID |

> 实测：`submit` 成功时通常已经 `charged=true`。客户端应把 `task_id`、扣费信息写入生成历史，即使后续下载失败也能对账。

---

## 7. 轮询任务结果

### 7.1 请求

```bash
curl -sS \
  "https://wkapi.vip/api/v1/studio/poll?task_id=image_a6d7fb62-59c7-4fc8-8b9d-5790ba3d2b92" \
  -H "Authorization: Bearer sk-xxx"
```

### 7.2 成功响应（实测）

```json
{
  "status": "succeeded",
  "url": "https://scapi.net/172ee68fe76045abbe271a0a4a398967.png",
  "result": [
    "https://scapi.net/172ee68fe76045abbe271a0a4a398967.png"
  ],
  "message": "任务失败，请稍后重试"
}
```

### 7.3 状态判定（重要）

**不要只看 `message`。**

实测中成功任务也可能带：

```text
message: "任务失败，请稍后重试"
```

但同时：

- `status = "succeeded"`
- `url` / `result[0]` 可下载
- 文件为有效 PNG/JPEG

#### 推荐判定逻辑

```ts
function isStudioSuccess(poll: {
  status?: string
  url?: string
  result?: string[]
}) {
  const status = (poll.status || '').toLowerCase()
  const url = poll.url || poll.result?.[0]
  if (url && ['succeeded', 'success', 'completed', 'done'].includes(status)) {
    return true
  }
  // 兜底：有可下载 url 也视为成功
  if (url && status && !['failed', 'error'].includes(status)) {
    return true
  }
  return false
}
```

#### 进行中

常见：无最终 `url`，或 status 为排队/处理中（以实现返回为准）。  
建议：

- 间隔 **2–3s** 轮询
- 超时 **120–180s**（生图）
- 超时后标记失败，保留 `task_id` 便于用户到控制台核对

#### 失败

- `status` 明确为 `failed` / `error`
- 或长时间无 `url`
- HTTP 401/403/402/5xx

### 7.4 下载成品

```bash
curl -L "https://scapi.net/xxxx.png" -o output.png
```

- 结果通常是 **公网 URL**，不是 OpenAI 的 `b64_json`
- 客户端下载后应落到本地目录（PromptForge 规划：`~/Pictures/PromptForge/`）
- 历史记录保存：`prompt`、`product_id`、`task_id`、`image_path`、`cost`、`duration`

---

## 8. 生图产品规格

> 下表来自官方文档 + `/catalog` 实测。上线后以 `/catalog` 为准。

### 8.1 图片产品

| product_id | 名称 | 价格 | 关键参数 | 参考图 |
|---|---|---|---|---|
| `image_nanoBanana2Lite` | NanoBanana 2 Lite | 0.12 元/张 | `size=1K`，`aspectRatio` | `urls[]`，最多 6 |
| `image_nanoBanana2` | NanoBanana 2 | 0.15 元/张 | `size=1K/2K/4K`，`aspectRatio` | `urls[]`，最多 14 |
| `image_nanoBanana_pro` | NanoBanana Pro | 0.45 元/张 | `size=1K/2K/4K`，`aspectRatio` | `urls[]`，最多 6 |
| `image_nanoBanana` | NanoBanana | 0.15 元/张 | `imageSize`（注意不是 size），`aspectRatio` | `urls[]`，最多 6 |
| `image_gptImage2` | GPT-Image-2 | 0.15 元/张 | `size`=输出比例（如 `1:1`） | `urls[]`，最多 6 |
| `image_Wan27` | Wan 2.7 图片 | 约 0.2 元/张 | `size` 分辨率、`negative_prompt`、`seed` 等 | `urls`（文档称可逗号分隔） |

### 8.2 GPT-Image-2 参数细节

`product_id`: `image_gptImage2`

| payload 字段 | 含义 | 示例 |
|---|---|---|
| `prompt` | 提示词 | `"red apple, studio lighting"` |
| `size` | **输出比例**（不是 1024x1024） | `"1:1"` / `"16:9"` / `"2:3"` … |
| `urls` | 参考图 URL 数组 | `["https://.../ref.png"]` |

`size` 可选（catalog）：

```text
1:1, 3:2, 2:3, 16:9, 9:16, 4:3, 3:4,
21:9, 9:21, 1:3, 3:1, 2:1, 1:2
```

默认：`1:1`

### 8.3 NanoBanana 系列注意点

- 多数版本清晰度参数名是 `size`（`1K/2K/4K`）
- Classic `image_nanoBanana` 清晰度参数名是 **`imageSize`**
- 比例参数名是 `aspectRatio`
- 不要把 NanoBanana 的 `size=1K` 套到 GPT-Image-2 上（GPT-Image-2 的 `size` 是比例）

### 8.4 视频产品（同 API，本文件不展开实现）

同样走 `/submit` + `/poll`，`product_id` 形如：

- `video_Wan27`
- `video_grok_imagine`
- `video_google_omni`
- `video_seedance`
- `video_omni`
- `video_vidu`
- `video_Sora2`（文档标注可能维护中）

视频按秒计费，参数见 `/catalog`。

---

## 9. 完整示例

### 9.1 cURL：GPT-Image-2

```bash
KEY="sk-替换为生图组Key"
BASE="https://wkapi.vip/api/v1/studio"

# 1) 提交
SUBMIT=$(curl -sS -X POST "$BASE/submit" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "image_gptImage2",
    "wait": false,
    "payload": {
      "prompt": "白底电商主图，一只红苹果居中，柔和棚拍光",
      "size": "1:1"
    }
  }')

echo "$SUBMIT"
TASK_ID=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])' <<<"$SUBMIT")

# 2) 轮询
while true; do
  POLL=$(curl -sS "$BASE/poll?task_id=$TASK_ID" -H "Authorization: Bearer $KEY")
  echo "$POLL"
  URL=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("url") or (d.get("result") or [""])[0] or "")' <<<"$POLL")
  STATUS=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("status",""))' <<<"$POLL")
  if [[ -n "$URL" && "$STATUS" == "succeeded" ]]; then
    curl -L "$URL" -o gpt-image-2-result.png
    echo "saved gpt-image-2-result.png"
    break
  fi
  if [[ "$STATUS" == "failed" || "$STATUS" == "error" ]]; then
    echo "failed"; exit 1
  fi
  sleep 3
done
```

### 9.2 cURL：NanoBanana 2 Lite

```bash
curl -sS -X POST "https://wkapi.vip/api/v1/studio/submit" \
  -H "Authorization: Bearer sk-xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "image_nanoBanana2Lite",
    "wait": false,
    "payload": {
      "prompt": "cute cartoon red apple sticker, simple white background",
      "size": "1K",
      "aspectRatio": "1:1"
    }
  }'
```

### 9.3 TypeScript 最小封装

```ts
export type StudioSubmitRequest = {
  productId: string
  prompt: string
  payload?: Record<string, unknown>
  wait?: boolean
}

export type StudioSubmitResult = {
  taskId: string
  billing?: {
    yuan?: number
    unit?: string
    charged?: boolean
    requestId?: string
  }
  raw: unknown
}

export type StudioPollResult = {
  status: string
  url?: string
  result?: string[]
  message?: string
  raw: unknown
}

export class WukongStudioClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://wkapi.vip/api/v1/studio',
  ) {}

  private headers(json = false): HeadersInit {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  async catalog(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/catalog`)
    if (!res.ok) throw new Error(`catalog failed: ${res.status}`)
    return res.json()
  }

  async submit(req: StudioSubmitRequest): Promise<StudioSubmitResult> {
    const res = await fetch(`${this.baseUrl}/submit`, {
      method: 'POST',
      headers: this.headers(true),
      body: JSON.stringify({
        product_id: req.productId,
        wait: req.wait ?? false,
        payload: {
          prompt: req.prompt,
          ...(req.payload ?? {}),
        },
      }),
    })
    const raw = await res.json()
    if (!res.ok) {
      throw new Error(`submit failed: ${res.status} ${JSON.stringify(raw)}`)
    }
    return {
      taskId: raw.task_id,
      billing: raw.billing
        ? {
            yuan: raw.billing.yuan,
            unit: raw.billing.unit,
            charged: raw.billing.charged,
            requestId: raw.billing.request_id,
          }
        : undefined,
      raw,
    }
  }

  async poll(taskId: string): Promise<StudioPollResult> {
    const url = `${this.baseUrl}/poll?task_id=${encodeURIComponent(taskId)}`
    const res = await fetch(url, { headers: this.headers() })
    const raw = await res.json()
    if (!res.ok) {
      throw new Error(`poll failed: ${res.status} ${JSON.stringify(raw)}`)
    }
    return {
      status: String(raw.status ?? ''),
      url: raw.url,
      result: raw.result,
      message: raw.message,
      raw,
    }
  }

  async generateAndWait(
    req: StudioSubmitRequest,
    opts?: { intervalMs?: number; timeoutMs?: number },
  ): Promise<{ taskId: string; imageUrl: string; billing?: StudioSubmitResult['billing'] }> {
    const intervalMs = opts?.intervalMs ?? 3000
    const timeoutMs = opts?.timeoutMs ?? 180_000
    const submitted = await this.submit(req)
    const started = Date.now()

    while (Date.now() - started < timeoutMs) {
      const polled = await this.poll(submitted.taskId)
      const imageUrl = polled.url || polled.result?.[0]
      const status = polled.status.toLowerCase()

      if (imageUrl && ['succeeded', 'success', 'completed', 'done'].includes(status)) {
        return { taskId: submitted.taskId, imageUrl, billing: submitted.billing }
      }
      if (['failed', 'error'].includes(status)) {
        throw new Error(`studio task failed: ${polled.message ?? status}`)
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }

    throw new Error(`studio task timeout: ${submitted.taskId}`)
  }
}
```

### 9.4 实测记录（2026-08-03）

| 项目 | 结果 |
|---|---|
| Key 分组 | 生图组 |
| `POST /v1/images/generations` + 任意 model | **失败**（`No available channel ... under group 生图组`） |
| `POST /api/v1/studio/submit` + `image_gptImage2` | **成功**，扣费 0.15 元 |
| poll GPT-Image-2 | `status=succeeded`，下载到 1254×1254 PNG |
| `image_nanoBanana2Lite` | **成功**，扣费 0.12 元，1024×1024 JPEG |
| 本地样例 | `test_wkapi_gptImage2.png` / `test_wkapi_nanoBanana2Lite.jpg` |

历史 API 输出图已从源码仓库移除；接口行为以本页文字契约、Provider 单测和真实环境冒烟为准。

---

## 10. 错误处理

| 场景 | 典型表现 | 处理建议 |
|---|---|---|
| 走错 OpenAI images 路径 | `model_not_found` / no channel under 生图组 | 改用 `/api/v1/studio` |
| Key 分组错误 | 401 / 无权限 / 无渠道 | 换「生图组」Key |
| `/poll` 不带 Token | 401 | 轮询必须带同一把 Key |
| 余额不足 | 文档提示 401/余额类错误 | 引导充值，停止重试 |
| 上游繁忙 | 长时间 processing / failed | 有限重试 + 明确错误提示 |
| `message` 含“失败”但有 url | 实测成功图仍可能出现 | **以 status + url 为准** |
| 网络超时 | curl/fetch timeout | 指数退避；保留 task_id 可继续 poll |

### 10.1 不要做的事

```text
❌ POST https://wkapi.vip/v1/images/generations
❌ POST https://wkapi.vip/v1/chat/completions  (用生图组 Key 画图)
❌ model: "gpt-image-2"                        (应使用 product_id)
❌ Base URL 只配 /v1 就当万能生图入口
```

### 10.2 正确对照

```text
✅ Token 分组 = 生图组
✅ Base     = https://wkapi.vip/api/v1/studio
✅ 模型标识 = product_id（如 image_gptImage2）
✅ 结果获取 = poll 后下载 url
```

---

## 11. 参考图上传

若产品支持参考图（`uploads`）：

1. 先把本地图片变成 **可公网访问 URL**
2. 再把 URL 放进 payload（通常 `urls: string[]`）

官方提到的上传入口（创作台/测试页）：

```text
POST /api/v1/ai/test-page/upload-image
POST /api/v1/ai/test-page/upload-video
POST /api/v1/ai/test-page/upload-audio
```

> 具体字段以站点当前实现为准。PromptForge 若做图生图，可：
>
> 1. 先上传拿 URL  
> 2. 再 `submit` 时带 `urls`

---

## 12. 与 PromptForge 的集成建议

现有 `OpenAICompatibleProvider` 假设：

```text
client.images.generate(...)  → b64_json → 写盘
```

悟空生图组 **不兼容** 该假设，建议新增独立 Provider：

### 12.1 建议类型

```ts
type ProviderType = 'openai' | 'openai-compatible' | 'wukong-studio'
// 或更通用：
type ProviderType = 'openai' | 'openai-compatible' | 'async-studio'
```

### 12.2 配置字段建议

| 字段 | 示例 | 说明 |
|---|---|---|
| `name` | `悟空生图组` | 展示名 |
| `type` | `wukong-studio` | Provider 类型 |
| `base_url` | `https://wkapi.vip/api/v1/studio` | Studio Base |
| `product_id` | `image_gptImage2` | 默认产品 |
| `api_key` | `sk-...` | 生图组 Key（安全存储） |

### 12.3 主进程流程

```text
generateImage(req)
  → Studio.submit(product_id, payload)
  → 写 history: pending + task_id + cost
  → loop poll(task_id)
  → download url
  → 写 ~/Pictures/PromptForge/<id>.png
  → history: success + image_path
```

### 12.4 UI 差异点

- 模型选择：显示 catalog 产品名/价格，不显示 OpenAI model 字符串
- 尺寸：GPT-Image-2 用比例；Banana 用 1K/2K/4K + aspectRatio
- 进度：必须有轮询进度/可取消
- 成本：优先展示 `billing.yuan`

### 12.5 兼容策略

| 用户目标 | 应用配置 |
|---|---|
| 官方 OpenAI / 常规 OneAPI 生图 | `openai-compatible` + `/v1` |
| 悟空「生图组」 | `wukong-studio` + `/api/v1/studio` |
| 悟空对话/Codex | 另一把非生图组 Key + `/v1`（本文件不覆盖） |

---

## 13. 快速自检清单

- [ ] Key 在控制台显示分组为 **生图组** 且已启用
- [ ] 账户有余额
- [ ] `GET /api/v1/studio/catalog` 能返回 image 产品
- [ ] `POST /api/v1/studio/submit` 返回 `task_id`
- [ ] `GET /api/v1/studio/poll` 带 Authorization
- [ ] 以 `status=succeeded` + `url` 判定成功
- [ ] 可下载 url 得到有效图片文件
- [ ] 没有误用 `/v1/images/generations`

---

## 14. 附录：和错误路径的对比

### 14.1 错误示范（会失败）

```bash
curl -X POST "https://wkapi.vip/v1/images/generations" \
  -H "Authorization: Bearer sk-生图组Key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "red apple",
    "size": "1024x1024"
  }'
```

典型错误：

```json
{
  "error": {
    "code": "model_not_found",
    "message": "No available channel for model gpt-image-2 under group 生图组 (distributor)",
    "type": "new_api_error"
  }
}
```

### 14.2 正确示范（已跑通）

```bash
curl -X POST "https://wkapi.vip/api/v1/studio/submit" \
  -H "Authorization: Bearer sk-生图组Key" \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": "image_gptImage2",
    "wait": false,
    "payload": {
      "prompt": "red apple",
      "size": "1:1"
    }
  }'
```

---

## 15. 文档维护

| 项 | 说明 |
|---|---|
| 权威来源 | 站点公告、`/wkapi-docs.html`、`GET /catalog` |
| 本文件定位 | PromptForge 接入备忘 + 联调手册 |
| 更新策略 | product_id / 参数以 `/catalog` 动态发现，避免写死后过期 |
| 相关文档 | [`05-image-generation.md`](./05-image-generation.md)（通用 Provider 规格） |

---

**一句话记住：**

> 悟空生图组 = `生图组 Key` + `/api/v1/studio` + `product_id` + 异步轮询下载 URL。  
> 不是 OpenAI `images/generations`。
