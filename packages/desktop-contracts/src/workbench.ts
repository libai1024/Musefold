import type { ImageBackground, ImageQuality, ImageSize, ModerationLevel } from './enums';
import type { ImageProviderResponseSummary, LocalImageReference } from './providers';

export type GenerationRunKind = 'free_generation' | 'refinement' | 'retry';
export type GenerationRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';
export type GeneratedAssetStatus = 'available' | 'missing' | 'deleted' | 'failed';
export type WorkbenchConversationKind = 'chat' | 'prompt';

export interface GenerationParamsSnapshot {
  schemaVersion: 1;
  size?: ImageSize;
  aspectRatio?: string;
  quality?: ImageQuality;
  n?: number;
  background?: ImageBackground;
  moderation?: ModerationLevel;
  referenceImages?: LocalImageReference[];
  [key: string]: unknown;
}

export interface PromptSnapshot {
  schemaVersion: 1;
  userPrompt: string;
  basePrompt: string;
  refinementInstruction: string | null;
  finalPrompt: string;
  negativePrompt: string | null;
}

export interface GenerationRun {
  id: string;
  runKind: GenerationRunKind;
  workbenchSessionId: string | null;
  workbenchTurnId: string | null;
  turnIndex: number | null;
  resultIndex: number | null;
  parentRunId: string | null;
  retryOfRunId: string | null;
  sourceAssetId: string | null;
  providerId: string;
  model: string;
  userPrompt: string;
  basePrompt: string;
  refinementInstruction: string | null;
  finalPrompt: string;
  negativePrompt: string | null;
  params: GenerationParamsSnapshot;
  promptSnapshot: PromptSnapshot;
  status: GenerationRunStatus;
  errorCode: string | null;
  errorMessage: string | null;
  requestId: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  durationMs: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  deletedAt: number | null;
}

export interface GeneratedAsset {
  id: string;
  runId: string;
  position: number;
  status: GeneratedAssetStatus;
  mediaPath: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  checksum: string | null;
  createdAt: number;
}

export interface WorkbenchSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
}

export interface EnsureWorkbenchSessionCommand {
  id: string;
  title: string;
  createdAt?: number;
}

export interface WorkbenchSessionSummary extends WorkbenchSession {
  turnCount: number;
  runCount: number;
  latestAssetPath: string | null;
  conversationKind: WorkbenchConversationKind;
  latestStatus: GenerationRunStatus | null;
}

export interface WorkbenchSessionRun {
  run: GenerationRun;
  assets: GeneratedAsset[];
  providerResponse?: ImageProviderResponseSummary;
  promptReferences: Array<{
    promptId: string;
    title: string;
    text: string;
    scope: 'full' | 'excerpt';
  }>;
}

export interface WorkbenchSessionDocument {
  session: WorkbenchSession;
  runs: WorkbenchSessionRun[];
}

export interface WorkbenchSessionListQuery {
  archived?: boolean;
  limit?: number;
  offset?: number;
}

export interface WorkbenchSessionListResult {
  items: WorkbenchSessionSummary[];
  total: number;
  limit: number;
  offset: number;
}
