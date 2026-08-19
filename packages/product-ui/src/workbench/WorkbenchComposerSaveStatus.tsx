import { Check, LoaderCircle } from "@musefold/ui/icons";
import type { WorkbenchDraftSaveStatus } from "./useWorkbenchDraftSyncController";

export interface WorkbenchComposerSaveStatusProps {
  status: WorkbenchDraftSaveStatus;
  savingLabel?: string;
  savedLabel?: string;
  testId?: string;
}

/** Shared, compact status indicator for optimistic workbench draft saves. */
export function WorkbenchComposerSaveStatus({
  status,
  savingLabel = "保存中",
  savedLabel = "已同步",
  testId = "draft-save-status",
}: WorkbenchComposerSaveStatusProps) {
  if (status !== "saving" && status !== "saved") return null;
  const saving = status === "saving";
  return (
    <span
      className="mf-workbench-save-status"
      data-testid={testId}
      data-status={status}
      aria-live="polite"
    >
      {saving ? (
        <LoaderCircle className="mf-spin" aria-hidden="true" />
      ) : (
        <Check aria-hidden="true" />
      )}
      <span>{saving ? savingLabel : savedLabel}</span>
    </span>
  );
}

