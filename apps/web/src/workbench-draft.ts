import type {
  GenerationQuality,
  GenerationSize,
  WorkbenchDraft,
} from "@musefold/contracts";

export interface WorkbenchDraftInput {
  prompt: string;
  selectedPromptId: string | null;
  size: GenerationSize;
  aspectRatio: string;
  quality: GenerationQuality;
}

export function buildWorkbenchDraft({
  prompt,
  selectedPromptId,
  size,
  aspectRatio,
  quality,
}: WorkbenchDraftInput): WorkbenchDraft {
  return {
    prompt,
    negative: "",
    params: { size, aspectRatio, quality },
    promptReferenceIds: selectedPromptId ? [selectedPromptId] : [],
  };
}

export function areWorkbenchDraftsEqual(
  left: WorkbenchDraft,
  right: WorkbenchDraft,
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
