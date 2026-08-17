# TvT AI API Gateway 开发文档

> 站点： [https://ai.tvt.wiki/](https://ai.tvt.wiki/)  
> 控制台： [https://ai.tvt.wiki/login/](https://ai.tvt.wiki/login/)  
> 文档基于实际联调结果整理（测试时间：2026-08-03；余额/用量接口复测：2026-08-06）  
> 网关形态：OpenAI 兼容 API 中转（Sub2API 系 AI API Gateway）

---

## 1. 快速开始

### 1.1 基本信息

| 项目 | 值 |
|------|----|
| Base URL | `https://ai.tvt.wiki/v1` |
| 鉴权方式 | `Authorization: Bearer <API_KEY>` 或 `x-api-key: <API_KEY>` |
| 协议兼容 | OpenAI Chat Completions / Responses / Images；部分 Anthropic Messages |
| 健康检查 | `GET https://ai.tvt.wiki/health` → `{"status":"ok"}` |
| CORS | 已开启（`Access-Control-Allow-Origin: *`） |

### 1.2 获取 API Key

1. 打开控制台登录页：`https://ai.tvt.wiki/login/`
2. 使用已授权账号登录（当前站点注册默认关闭，需邀请码/管理员开通）
3. 在 **API Keys** 页面创建密钥
4. 将密钥仅保存在本地环境变量或私密配置中，**不要提交到 Git**

推荐环境变量：

```bash
export TVT_API_BASE="https://ai.tvt.wiki/v1"
export TVT_API_KEY="sk-xxxxxxxx"
```

### 1.3 最小可运行示例（curl）

```bash
curl "https://ai.tvt.wiki/v1/chat/completions" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [{"role": "user", "content": "你好"}],
    "max_tokens": 100
  }'
```

---

## 2. 鉴权

### 2.1 支持的请求头

| Header | 是否可用 | 说明 |
|--------|----------|------|
| `Authorization: Bearer <KEY>` | ✅ 推荐 | OpenAI 标准写法 |
| `x-api-key: <KEY>` | ✅ | Anthropic 风格 |
| `X-API-Key: <KEY>` | ✅ | 同上，大小写不敏感 |
| `Authorization: <KEY>`（无 Bearer） | ❌ | 返回 `API_KEY_REQUIRED` |

### 2.2 错误示例

无效 Key：

```json
{"code":"INVALID_API_KEY","message":"Invalid API key"}
```

缺少 Key：

```json
{"code":"API_KEY_REQUIRED","message":"API key is required in Authorization header as Bearer token"}
```

---

## 3. 可用模型

> 以 `GET /v1/models` 实时返回为准。以下为 2026-08-03 实测列表。

### 3.1 文本 / 对话模型

| Model ID | 类型 | 说明 |
|----------|------|------|
| `gpt-5.4-mini` | Chat / Responses | 轻量快速，联调首选 |
| `gpt-5.4` | Chat / Responses | 标准能力 |
| `gpt-5.4-openai-compact` | Chat / Responses | Compact 变体 |
| `gpt-5.5` | Chat / Responses | 更强推理/生成 |
| `gpt-5.5-openai-compact` | Chat / Responses | Compact 变体 |
| `gpt-5.6` | Chat / Responses | 新一代主模型 |
| `gpt-5.6-luna` | Chat / Responses | 变体 |
| `gpt-5.6-sol` | Chat / Responses | 变体 |
| `gpt-5.6-terra` | Chat / Responses | 变体 |
| `gpt-5.3-codex-spark` | Chat / Responses | Codex 系编码模型 |
| `codex-auto-review` | Chat / Responses | 代码审查向 |

### 3.2 生图模型

| Model ID | 端点 | 说明 |
|----------|------|------|
| `gpt-image-2` | `/v1/images/generations` | 可用，实测成功 |
| ~~`image-2`~~ | - | ❌ 不可用，会报 “requires an image model” |

说明：

- 请求时请使用 **`gpt-image-2`**
- 响应里 `model` 字段可能回显为上游实际名，例如 `gpt-image-2-codex`
- **不要**把 `gpt-image-2` 发到 Chat Completions，会报：

```json
{"error":{"message":"This model is not supported on the Chat Completions endpoint","type":"invalid_request_error"}}
```

### 3.3 查询模型列表

```bash
curl "https://ai.tvt.wiki/v1/models" \
  -H "Authorization: Bearer $TVT_API_KEY"
```

响应结构：

```json
{
  "object": "list",
  "data": [
    {
      "id": "gpt-5.4-mini",
      "type": "model",
      "display_name": "gpt-5.4-mini",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## 4. Chat Completions（对话）

### 4.1 接口

```
POST https://ai.tvt.wiki/v1/chat/completions
Content-Type: application/json
Authorization: Bearer <API_KEY>
```

### 4.2 请求参数（常用）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 如 `gpt-5.4-mini` |
| `messages` | array | ✅ | OpenAI 消息数组 |
| `max_tokens` | number | 否 | 可用 |
| `max_completion_tokens` | number | 否 | 也可用 |
| `stream` | boolean | 否 | `true` 开启 SSE 流式 |
| `temperature` | number | 否 | 采样温度 |

### 4.3 非流式示例

```bash
curl "https://ai.tvt.wiki/v1/chat/completions" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-mini",
    "messages": [
      {"role": "system", "content": "你是简洁助手"},
      {"role": "user", "content": "用一句话介绍 TypeScript"}
    ],
    "max_tokens": 200
  }'
```

成功响应（节选）：

```json
{
  "id": "resp_...",
  "object": "chat.completion",
  "created": 1785732600,
  "model": "gpt-5.4-mini",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "..."},
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 20,
    "completion_tokens": 30,
    "total_tokens": 50
  }
}
```

### 4.4 流式示例

```bash
curl "https://ai.tvt.wiki/v1/chat/completions" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "gpt-5.4-mini",
    "stream": true,
    "messages": [{"role": "user", "content": "数到 3"}],
    "max_tokens": 50
  }'
```

流式 chunk 示例：

```text
data: {"id":"resp_...","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"resp_...","object":"chat.completion.chunk","choices":[{"delta":{"content":"1"},"finish_reason":null}]}

data: [DONE]
```

### 4.5 Python（OpenAI SDK）

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-xxxxxxxx",
    base_url="https://ai.tvt.wiki/v1",
)

resp = client.chat.completions.create(
    model="gpt-5.4-mini",
    messages=[{"role": "user", "content": "你好"}],
    max_tokens=100,
)
print(resp.choices[0].message.content)
```

### 4.6 Node.js（OpenAI SDK）

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.TVT_API_KEY,
  baseURL: "https://ai.tvt.wiki/v1",
});

const resp = await client.chat.completions.create({
  model: "gpt-5.4-mini",
  messages: [{ role: "user", content: "你好" }],
  max_tokens: 100,
});

console.log(resp.choices[0]?.message?.content);
```

---

## 5. Responses API

### 5.1 接口

```
POST https://ai.tvt.wiki/v1/responses
```

适用于新版 OpenAI Responses 协议，也常用于 Codex 系工作流。

### 5.2 示例

```bash
curl "https://ai.tvt.wiki/v1/responses" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-mini",
    "input": "只回复：pong"
  }'
```

### 5.3 流式

```bash
curl "https://ai.tvt.wiki/v1/responses" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -N \
  -d '{
    "model": "gpt-5.4-mini",
    "input": "你好",
    "stream": true
  }'
```

流事件以 SSE 返回，例如：

```text
event: response.created
data: {"type":"response.created","response":{...}}
```

---

## 6. 图片生成（gpt-image-2）

### 6.1 接口

```
POST https://ai.tvt.wiki/v1/images/generations
Content-Type: application/json
Authorization: Bearer <API_KEY>
```

### 6.2 请求参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | ✅ | 固定用 `gpt-image-2` |
| `prompt` | string | ✅ | 生图提示词 |
| `n` | number | 否 | 生成数量，默认 1 |
| `size` | string | 否 | 如 `1024x1024`（实际输出可能被规范化） |
| `quality` | string | 否 | 如 `low` / `auto` 等 |

### 6.3 成功示例

```bash
curl "https://ai.tvt.wiki/v1/images/generations" \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "A simple red apple on a white background, product photo",
    "size": "1024x1024",
    "n": 1
  }'
```

响应（节选）：

```json
{
  "created": 1785732260,
  "background": "auto",
  "output_format": "png",
  "quality": "auto",
  "size": "1254x1254",
  "model": "gpt-image-2-codex",
  "data": [
    {
      "b64_json": "<base64-png>",
      "revised_prompt": "A simple product photo of a single red apple..."
    }
  ],
  "usage": {
    "input_tokens": 36,
    "output_tokens": 229,
    "total_tokens": 265
  }
}
```

### 6.4 实测结论

| 项目 | 结果 |
|------|------|
| 模型名 | 必须 `gpt-image-2` |
| 返回格式 | 默认 `b64_json`（PNG） |
| 常见耗时 | 约 10–30 秒 |
| 输出尺寸 | 请求 `1024x1024` 时，实测可能返回 `1254x1254` |
| `image-2` 别名 | ❌ 不可用 |
| Chat 端点调用生图模型 | ❌ 不可用 |

### 6.5 保存图片（Python）

```python
import base64
import json
from pathlib import Path
import urllib.request

req = urllib.request.Request(
    "https://ai.tvt.wiki/v1/images/generations",
    data=json.dumps({
        "model": "gpt-image-2",
        "prompt": "a minimal blue logo, flat vector",
        "size": "1024x1024",
        "n": 1,
    }).encode(),
    headers={
        "Authorization": "Bearer sk-xxxxxxxx",
        "Content-Type": "application/json",
    },
    method="POST",
)

with urllib.request.urlopen(req, timeout=180) as resp:
    payload = json.loads(resp.read().decode())

img_bytes = base64.b64decode(payload["data"][0]["b64_json"])
Path("output.png").write_bytes(img_bytes)
print("saved output.png", len(img_bytes), "bytes")
```

### 6.6 OpenAI SDK 生图

```python
from openai import OpenAI
import base64
from pathlib import Path

client = OpenAI(
    api_key="sk-xxxxxxxx",
    base_url="https://ai.tvt.wiki/v1",
)

result = client.images.generate(
    model="gpt-image-2",
    prompt="a cozy reading nook, soft light, illustration",
    size="1024x1024",
)

b64 = result.data[0].b64_json
Path("reading_nook.png").write_bytes(base64.b64decode(b64))
```

### 6.7 图片编辑（存在但参数更严）

```
POST /v1/images/edits
```

空请求会返回类似：

```json
{"error":{"message":"images[].image_url is required","type":"invalid_request_error"}}
```

说明该站支持 edits 能力，至少需要提供 `images[].image_url`（具体字段以联调为准）。

---

## 7. 余额与用量查询

> 2026-08-06 实测可用。该中转站查询余额/额度不走 OpenAI 官方 billing 路径，而是走站点自己的用量接口。

### 7.1 接口

```
GET https://ai.tvt.wiki/v1/usage
Authorization: Bearer <API_KEY>
```

也支持：

```
x-api-key: <API_KEY>
```

### 7.2 Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `timezone` | string | 否 | 建议传 `Asia/Shanghai`，用于今日/日期统计 |
| `days` | number | 否 | 查询最近 N 天用量 |
| `start_date` | string | 否 | 开始日期，格式通常为 `YYYY-MM-DD` |
| `end_date` | string | 否 | 结束日期，格式通常为 `YYYY-MM-DD` |

最小查询：

```bash
curl -sS "https://ai.tvt.wiki/v1/usage?timezone=Asia%2FShanghai" \
  -H "Authorization: Bearer $TVT_API_KEY"
```

`x-api-key` 写法：

```bash
curl -sS "https://ai.tvt.wiki/v1/usage?timezone=Asia%2FShanghai" \
  -H "x-api-key: $TVT_API_KEY"
```

### 7.3 响应结构（quota_limited 模式）

实测当前 Key 返回 `mode: "quota_limited"`，可直接读取 `quota` 与顶层 `remaining` 字段：

```json
{
  "isValid": true,
  "mode": "quota_limited",
  "status": "active",
  "unit": "USD",
  "remaining": 100,
  "quota": {
    "limit": 100,
    "used": 0,
    "remaining": 100,
    "unit": "USD"
  },
  "usage": {
    "today": {
      "actual_cost": 1.3266
    },
    "total": {
      "actual_cost": 7.076803755,
      "requests": 60,
      "total_tokens": 67056
    }
  },
  "daily_usage": [],
  "model_stats": []
}
```

字段说明：

| 字段 | 说明 |
|------|------|
| `status` | Key 状态，如 `active` |
| `mode` | 计费/额度模式，当前实测为 `quota_limited` |
| `unit` | 计费单位，当前实测为 `USD` |
| `remaining` | 顶层剩余额度，通常等价于 `quota.remaining` |
| `quota.limit` | 当前 Key 的额度上限 |
| `quota.used` | 当前 Key 已使用额度 |
| `quota.remaining` | 当前 Key 剩余额度 |
| `usage.today.actual_cost` | 今日实际成本 |
| `usage.total.actual_cost` | 累计实际成本 |
| `usage.total.requests` | 累计请求数 |
| `usage.total.total_tokens` | 累计 token 数 |
| `daily_usage` | 按日用量明细 |
| `model_stats` | 按模型统计的请求、token、成本明细 |

### 7.4 Python 读取余额

```python
import os
import requests

resp = requests.get(
    "https://ai.tvt.wiki/v1/usage",
    headers={"Authorization": f"Bearer {os.environ['TVT_API_KEY']}"},
    params={"timezone": "Asia/Shanghai"},
    timeout=30,
)
resp.raise_for_status()

data = resp.json()
quota = data.get("quota") or {}
usage = data.get("usage") or {}

balance = {
    "status": data.get("status"),
    "mode": data.get("mode"),
    "unit": data.get("unit") or quota.get("unit"),
    "remaining": data.get("remaining", quota.get("remaining")),
    "quota_limit": quota.get("limit"),
    "quota_used": quota.get("used"),
    "today_actual_cost": (usage.get("today") or {}).get("actual_cost"),
    "total_actual_cost": (usage.get("total") or {}).get("actual_cost"),
    "total_requests": (usage.get("total") or {}).get("requests"),
    "total_tokens": (usage.get("total") or {}).get("total_tokens"),
}

print(balance)
```

### 7.5 TypeScript 封装建议

```ts
export interface TvtUsageSummary {
  status?: string;
  mode?: string;
  unit?: string;
  remaining?: number;
  quotaLimit?: number;
  quotaUsed?: number;
  todayActualCost?: number;
  totalActualCost?: number;
  totalRequests?: number;
  totalTokens?: number;
}

export async function fetchTvtUsage(
  apiKey: string,
  baseUrl = "https://ai.tvt.wiki/v1",
): Promise<TvtUsageSummary> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/usage`);
  url.searchParams.set("timezone", "Asia/Shanghai");

  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`TvT usage query failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const quota = data.quota ?? {};
  const usage = data.usage ?? {};

  return {
    status: data.status,
    mode: data.mode,
    unit: data.unit ?? quota.unit,
    remaining: data.remaining ?? quota.remaining,
    quotaLimit: quota.limit,
    quotaUsed: quota.used,
    todayActualCost: usage.today?.actual_cost,
    totalActualCost: usage.total?.actual_cost,
    totalRequests: usage.total?.requests,
    totalTokens: usage.total?.total_tokens,
  };
}
```

### 7.6 开发注意事项

1. 余额接口路径是 `/v1/usage`，不是 `/v1/dashboard/billing/*`
2. `GET /v1/dashboard/billing/credit_grants`、`/v1/dashboard/billing/usage` 等 OpenAI 官方 billing 风格接口在该站实测返回 `404`
3. 当前 Key 是 `quota_limited` 模式；如果未来出现钱包/订阅模式，优先兼容 `balance`、`subscription` 等字段
4. UI 展示建议同时显示：Key 状态、剩余额度、今日消耗、累计消耗、累计请求数
5. 余额接口不要从前端公开环境直接调用，生产环境建议通过本地主进程或后端代理，避免 Key 泄漏

---

## 8. 其他协议兼容情况

### 8.1 Anthropic Messages

```
POST /v1/messages
x-api-key: <API_KEY>
anthropic-version: 2023-06-01
```

实测可用（在当前 Key 下，用 `gpt-5.4-mini` 可返回 Anthropic 风格 message）。

```bash
curl "https://ai.tvt.wiki/v1/messages" \
  -H "x-api-key: $TVT_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.4-mini",
    "max_tokens": 64,
    "messages": [{"role": "user", "content": "hi"}]
  }'
```

### 8.2 Gemini 风格

`/v1beta/models` 等 Gemini 路径存在，但若 Key 所属平台分组不是 gemini，会返回：

```json
{"error":{"code":400,"message":"API key group platform is not gemini","status":"INVALID_ARGUMENT"}}
```

当前测试 Key 更适合走 **OpenAI 兼容路径**。

### 8.3 Embeddings

```
POST /v1/embeddings
```

实测可能返回：

```json
{"error":{"message":"Service temporarily unavailable","type":"api_error"}}
```

即：路径存在，但当前可用性不稳定/未开通。

---

## 9. 错误码与排查

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| `INVALID_API_KEY` | Key 错误/失效 | 检查控制台 Key |
| `API_KEY_REQUIRED` | 未带 Bearer 或不支持的 Header | 改用 `Authorization: Bearer ...` |
| `requires an image model` | 生图模型名写错（如 `image-2`） | 改为 `gpt-image-2` |
| `not supported on the Chat Completions endpoint` | 把生图模型打到对话接口 | 改走 `/v1/images/generations` |
| `Service temporarily unavailable` | 上游或通道临时不可用 | 换模型/稍后重试 |
| 超时 | 生图较慢 | 客户端 timeout 建议 ≥ 120s |
| 401/403 | 权限或风控 | 检查账号状态与配额 |

通用建议：

1. 先打 `GET /v1/models` 确认鉴权和模型列表  
2. 文本联调用 `gpt-5.4-mini`  
3. 生图联调用 `gpt-image-2`  
4. 超时时间对话 ≥ 60s，生图 ≥ 120s  

---

## 10. 接入配置模板

### 10.1 通用配置

```json
{
  "provider": "tvt-ai-gateway",
  "baseUrl": "https://ai.tvt.wiki/v1",
  "apiKey": "sk-xxxxxxxx",
  "chatModel": "gpt-5.4-mini",
  "imageModel": "gpt-image-2",
  "usageEndpoint": "/usage",
  "timeoutMs": {
    "chat": 60000,
    "image": 180000
  }
}
```

### 10.2 PromptForge / 业务侧建议

| 能力 | Endpoint | Model |
|------|----------|-------|
| 提示词优化 / 对话 | `/chat/completions` | `gpt-5.4-mini` 或 `gpt-5.5` |
| 代码/Agent | `/responses` 或 `/chat/completions` | `gpt-5.3-codex-spark` |
| 文生图 | `/images/generations` | `gpt-image-2` |
| 余额/用量 | `/usage` | 不需要模型 |

### 10.3 Axios 封装示例

```ts
import axios from "axios";

const tvt = axios.create({
  baseURL: "https://ai.tvt.wiki/v1",
  timeout: 180000,
  headers: {
    Authorization: `Bearer ${process.env.TVT_API_KEY}`,
    "Content-Type": "application/json",
  },
});

export async function chat(content: string, model = "gpt-5.4-mini") {
  const { data } = await tvt.post("/chat/completions", {
    model,
    messages: [{ role: "user", content }],
    max_tokens: 1000,
  });
  return data.choices[0].message.content as string;
}

export async function generateImage(prompt: string) {
  const { data } = await tvt.post("/images/generations", {
    model: "gpt-image-2",
    prompt,
    size: "1024x1024",
    n: 1,
  });
  return data.data[0].b64_json as string;
}

export async function getUsage() {
  const { data } = await tvt.get("/usage", {
    params: { timezone: "Asia/Shanghai" },
  });
  const quota = data.quota ?? {};
  const usage = data.usage ?? {};

  return {
    status: data.status,
    mode: data.mode,
    unit: data.unit ?? quota.unit,
    remaining: data.remaining ?? quota.remaining,
    quotaLimit: quota.limit,
    quotaUsed: quota.used,
    todayActualCost: usage.today?.actual_cost,
    totalActualCost: usage.total?.actual_cost,
    totalRequests: usage.total?.requests,
    totalTokens: usage.total?.total_tokens,
  };
}
```

---

## 11. 安全与合规

1. **不要**把 API Key 写进前端公开仓库或客户端明文包  
2. 生产环境建议由后端代理转发，避免 Key 泄漏  
3. 遵守站点使用政策与上游模型服务条款  
4. 站点声明偏内部技术研究/联调用途，注意账号授权范围  
5. 对用户输入做基础安全过滤，避免滥用与违规内容  

---

## 12. 联调检查清单

- [ ] `GET /health` 返回 ok  
- [ ] `GET /v1/models` 能列出模型  
- [ ] `GET /v1/usage` 能返回余额/用量  
- [ ] `POST /v1/chat/completions` 非流式成功  
- [ ] `POST /v1/chat/completions` 流式成功  
- [ ] `POST /v1/responses` 成功  
- [ ] `POST /v1/images/generations` + `gpt-image-2` 成功并解码 PNG  
- [ ] 错误 Key 能正确返回 401/错误码  
- [ ] 客户端超时足够覆盖生图  

---

## 13. 附录：实测命令速查

```bash
# 健康检查
curl -s https://ai.tvt.wiki/health

# 模型列表
curl -s https://ai.tvt.wiki/v1/models \
  -H "Authorization: Bearer $TVT_API_KEY"

# 余额 / 用量
curl -s "https://ai.tvt.wiki/v1/usage?timezone=Asia%2FShanghai" \
  -H "Authorization: Bearer $TVT_API_KEY"

# 对话
curl -s https://ai.tvt.wiki/v1/chat/completions \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.4-mini","messages":[{"role":"user","content":"ping"}],"max_tokens":20}'

# 生图
curl -s https://ai.tvt.wiki/v1/images/generations \
  -H "Authorization: Bearer $TVT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-image-2","prompt":"a red apple","size":"1024x1024"}'
```

---

## 14. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08-06 | 补充余额/用量查询：`GET /v1/usage`、响应字段、Python/TypeScript 封装 |
| 2026-08-03 | 初版：基于 ai.tvt.wiki 实测整理 Chat / Responses / Images / 鉴权 / 模型列表 |

> 备注：中转站模型与通道可能动态调整，集成时请以 `GET /v1/models` 和实际响应为准。
