/**
 * 连接接入预设:从 v2.1 `PROVIDER_PRESETS` / `AI_CONNECTION_PRESETS` 取真实服务,
 * 不编造不存在的网关。豆包网页走独立卡,不进 openai-compatible 预设。
 */

export interface ConnectionPreset {
  id: string;
  name: string;
  baseUrl: string;
  hint: string;
  recommended?: boolean;
}

/** 生图连接:旧 `PROVIDER_PRESETS` 里仅 TvT 为 openai-compatible,+ 自定义。 */
export const IMAGE_CONNECTION_PRESETS: readonly ConnectionPreset[] = [
  {
    id: 'tvt',
    name: 'TvT AI 中转站',
    baseUrl: 'https://ai.tvt.wiki/v1',
    hint: '默认服务商 · OpenAI 兼容中转,生图用 gpt-image-2',
    recommended: true,
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: 'https://example.com/v1',
    hint: '任意 OpenAI-compatible 生图接口',
  },
];

/** Agent 文本连接:沿 v2.1 `AI_CONNECTION_PRESETS`。 */
export const AGENT_CONNECTION_PRESETS: readonly ConnectionPreset[] = [
  {
    id: 'tvt',
    name: 'TvT AI 中转站',
    baseUrl: 'https://ai.tvt.wiki/v1',
    hint: '推荐 · 与图片生成可共用同一个 TvT Key',
    recommended: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    hint: 'DeepSeek OpenAI-compatible API',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    hint: 'Moonshot AI OpenAI-compatible API',
  },
  {
    id: 'glm',
    name: 'GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    hint: '智谱 OpenAI-compatible API',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/v1',
    hint: 'MiniMax OpenAI-compatible API',
  },
  {
    id: 'litellm',
    name: 'LiteLLM',
    baseUrl: 'http://localhost:4000/v1',
    hint: '连接用户或团队自行部署的 LiteLLM 网关',
  },
  {
    id: 'new-api',
    name: 'New API',
    baseUrl: 'http://localhost:3000/v1',
    hint: '连接用户或团队自行部署的 New API 网关',
  },
  {
    id: 'custom',
    name: '自定义兼容接口',
    baseUrl: 'https://example.com/v1',
    hint: '任意 OpenAI-compatible Chat Completions 接口',
  },
];
