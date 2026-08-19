export interface PromptListItemViewModel {
  id: string;
  title: string;
  content: string;
  description?: string | null;
  imageUrl?: string | null;
  usageCount: number;
  updatedAtLabel?: string | null;
  tags?: string[];
  isPinned: boolean;
}

export interface PromptDetailViewModel extends PromptListItemViewModel {
  negative?: string | null;
  sourceLabel: string;
  createdAtLabel: string;
  deletedAtLabel?: string | null;
}

export interface PromptEditorDraft {
  title: string;
  description: string;
  content: string;
  negative: string;
  isPinned: boolean;
}

export type GenerationStatusTone =
  "neutral" | "progress" | "success" | "warning" | "danger";

export interface GenerationHistoryItemViewModel {
  id: string;
  prompt: string;
  imageUrl?: string | null;
  statusLabel: string;
  statusKey?: string;
  statusTone?: GenerationStatusTone;
  metadata: string[];
  selected?: boolean;
  depth?: number;
  threadRootId?: string;
  isRetrying?: boolean;
  refinementLabel?: string;
  refinementTitle?: string;
  refinementCount?: number;
}

export interface GenerationHistoryDetailErrorViewModel {
  code?: string | null;
  title: string;
  hint?: string | null;
  details?: string | null;
}

export interface GenerationHistoryDetailViewModel {
  id: string;
  prompt: string;
  negative?: string | null;
  imageUrl?: string | null;
  imageUnavailableLabel?: string;
  statusKey: string;
  statusLabel: string;
  statusTone: GenerationStatusTone;
  modelLabel: string;
  metadata: string[];
  paramsLabel: string;
  sourceLabel: string;
  deletedAtLabel?: string | null;
  error?: GenerationHistoryDetailErrorViewModel | null;
}

export type GenerationResultSurfaceStatus =
  "pending" | "success" | "cancelled" | "failed";

export type WorkbenchSessionListStatus = "idle" | "running" | "unread";

export interface WorkbenchSessionListItemViewModel {
  id: string;
  title: string;
  updatedAt: string;
  kind?: string;
  selected?: boolean;
  pinned?: boolean;
  status?: WorkbenchSessionListStatus;
}
