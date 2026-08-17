export type AiConnectionRouteKind = 'direct' | 'gateway';
export type AiConnectionProtocol = 'openai-compatible';
export type AiStructuredOutputMode = 'json-schema' | 'json-object' | 'json-text';
export type AiModelDiscoveryStatus = 'unknown' | 'available' | 'manual';
export type AiConnectionPresetId =
  | 'tvt'
  | 'deepseek'
  | 'kimi'
  | 'glm'
  | 'minimax'
  | 'litellm'
  | 'new-api'
  | 'custom'
  /** 账号托管连接（v0.5，不出现在预设选择列表，由 account-service 创建） */
  | 'account';

export interface AiConnectionCapabilities {
  modelDiscovery: AiModelDiscoveryStatus;
  supportedStructuredOutputModes: AiStructuredOutputMode[];
  preferredStructuredOutputMode: AiStructuredOutputMode;
  cancellation: true;
  streaming: false;
  lastValidatedAt: number | null;
}

/** 可安全传给渲染进程的连接外壳；永远不包含明文或密文密钥。 */
export interface AiConnectionProfile {
  id: string;
  name: string;
  routeKind: AiConnectionRouteKind;
  protocol: AiConnectionProtocol;
  presetId: AiConnectionPresetId;
  baseUrl: string;
  model: string;
  capabilities: AiConnectionCapabilities;
  hasKey: boolean;
  keySuffix: string | null;
  isActive: boolean;
  /** 账号托管标记（FR-GW-02/03）：'account' 的记录 baseUrl/Key 只读、不可单删、登出回收 */
  managedBy: 'account' | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateAiConnectionInput {
  name: string;
  routeKind: AiConnectionRouteKind;
  protocol?: AiConnectionProtocol;
  presetId?: AiConnectionPresetId;
  baseUrl: string;
  model: string;
  isActive?: boolean;
}

export type UpdateAiConnectionInput = Partial<Omit<CreateAiConnectionInput, 'protocol'>>;

export interface AiConnectionPreset {
  id: AiConnectionPresetId;
  name: string;
  routeKind: AiConnectionRouteKind;
  baseUrl: string;
  model: string;
  hint: string;
  /** 推荐预设（对话框角标 + 空态首位） */
  recommended?: boolean;
}

export interface AiTextModelInfo {
  id: string;
  name: string;
  ownedBy?: string;
}

export interface AiConnectionValidationResult {
  ok: boolean;
  message: string;
  models: AiTextModelInfo[];
  capabilities: AiConnectionCapabilities;
}

export interface AiTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiSkillSourceFile {
  fileId: string;
  relativePath: string;
  contentHash: string;
  text: string;
}

export interface AiSkillImageReference {
  index: number;
  name: string;
  origin: 'user' | 'skill';
  role: 'content-source' | 'style-reference';
}
