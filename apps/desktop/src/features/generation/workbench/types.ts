import type {
  GenerateImageResult,
  ImageProviderResponseSummary,
  LocalImageReference,
  PromptReference,
} from "@musefold/desktop-contracts/providers";
import type { RefineParams } from "../../../lib/generation-params";
import type {
  GenerationSource,
  SchemeCreationDraftCard,
} from "@musefold/desktop-contracts/generation-source";

export type { GenerationSource, SchemeCreationDraftCard };

export type GenerationTurnStatus =
  "pending" | "running" | "partial" | "success" | "failed" | "cancelled";

export interface GenerationResultItem {
  id: string;
  jobId: string;
  historyId?: string;
  assetId?: string;
  status: "pending" | "success" | "failed" | "cancelled";
  imagePath?: string;
  cost?: number;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  retrying?: boolean;
  retryAttempt?: number;
  retryMax?: number;
  retryDelayMs?: number;
}

export interface GenerationTurn {
  id: string;
  /** 实际发送给 Provider 的完整提示词（含引用块）。 */
  prompt: string;
  /** 用户在输入框中编辑的正文，不包含引用块。 */
  userPrompt: string;
  references: PromptReference[];
  negativePrompt: string;
  source: GenerationSource;
  providerId: string | null;
  params: RefineParams;
  status: GenerationTurnStatus;
  results: GenerationResultItem[];
  /** 网页 Provider 的原始回复摘要；与本轮图片一起展示和恢复。 */
  providerResponse?: ImageProviderResponseSummary;
  /** 这一轮实际发送的有序参考图，用于图 1 / 图 2 指代、消息展示与编辑恢复。 */
  referenceImages: LocalImageReference[];
  parentHistoryId?: string;
  createdAt: number;
  completedAt?: number;
}

export interface WorkbenchDraft {
  prompt: string;
  negativePrompt: string;
  source: GenerationSource;
  references: PromptReference[];
}

export interface RefinementContext {
  turnId: string;
  resultId: string;
  historyId: string;
  assetId?: string;
  imagePath: string;
  label: string;
  images: LocalImageReference[];
}

export type WorkbenchResult = GenerateImageResult;
