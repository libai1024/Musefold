import type { GenerationGateway, PromptGateway, WorkbenchGateway } from "@musefold/domain";
import type { WorkbenchSessionListItemViewModel } from "../models";

export type GeneratePageSession = Awaited<
  ReturnType<WorkbenchGateway["getWorkbenchSession"]>
>;
export type GeneratePageJob = Awaited<ReturnType<GenerationGateway["createGeneration"]>>;
export type GeneratePagePrompt = Awaited<ReturnType<PromptGateway["getPrompt"]>>;
export type GeneratePageDraft = GeneratePageSession["draft"];

export const GENERATE_PAGE_RATIOS = ["1:1", "16:9", "9:16"] as const;
export type GeneratePageRatio = (typeof GENERATE_PAGE_RATIOS)[number];

export type GeneratePageQuality = "low" | "medium" | "high" | "auto";
export type GeneratePageSize = "auto" | "1024x1024" | "1536x1024" | "1024x1536";

export const GENERATE_PAGE_RATIO_SIZES: Record<GeneratePageRatio, GeneratePageSize> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
};

export const DEFAULT_GENERATE_JOB_PAGE_LIMIT = 100;
export const GENERATE_PAGE_HISTORY_RESTORE_LIMIT = 20;

export interface WorkbenchDraftInput {
  prompt: string;
  selectedPromptId: string | null;
  size: GeneratePageSize;
  aspectRatio: string;
  quality: GeneratePageQuality;
}

export interface GeneratePagePromptRef {
  id: string;
  title: string;
  content: string;
}

export function buildWorkbenchDraft({
  prompt,
  selectedPromptId,
  size,
  aspectRatio,
  quality,
}: WorkbenchDraftInput): GeneratePageDraft {
  return {
    prompt,
    negative: "",
    params: { size, aspectRatio, quality },
    promptReferenceIds: selectedPromptId ? [selectedPromptId] : [],
  };
}

export function areWorkbenchDraftsEqual(
  left: GeneratePageDraft,
  right: GeneratePageDraft,
): boolean {
  return (
    left.prompt === right.prompt &&
    left.negative === right.negative &&
    left.params.size === right.params.size &&
    left.params.aspectRatio === right.params.aspectRatio &&
    left.params.quality === right.params.quality &&
    left.promptReferenceIds.length === right.promptReferenceIds.length &&
    left.promptReferenceIds.every(
      (referenceId, index) => referenceId === right.promptReferenceIds[index],
    )
  );
}

export function generatePageRatio(value: string | undefined): GeneratePageRatio {
  return GENERATE_PAGE_RATIOS.includes(value as GeneratePageRatio)
    ? (value as GeneratePageRatio)
    : "1:1";
}

export function workbenchRatio(session: GeneratePageSession): GeneratePageRatio {
  return generatePageRatio(session.draft.params.aspectRatio);
}

export async function collectGatewayPages<TItem>(
  loadPage: (
    cursor?: string,
  ) => Promise<{ items: readonly TItem[]; nextCursor?: string | null }>,
): Promise<TItem[]> {
  const items: TItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await loadPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

export function generatePageSessionItems(
  sessions: readonly GeneratePageSession[],
  selectedId: string | null,
  runningIds: ReadonlySet<string>,
): WorkbenchSessionListItemViewModel[] {
  return sessions.map((item) => ({
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    selected: item.id === selectedId,
    status: runningIds.has(item.id) ? "running" : "idle",
  }));
}
