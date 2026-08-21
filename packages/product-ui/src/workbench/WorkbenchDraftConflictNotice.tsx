import { Button } from "@musefold/ui";

export interface WorkbenchDraftConflictNoticeProps {
  onUseRemote: () => void;
  onKeepLocal: () => void;
  title?: string;
  description?: string;
  useRemoteLabel?: string;
  keepLocalLabel?: string;
  className?: string;
  testId?: string;
}

/**
 * Draft conflict prompt for the composer. Hosts supply the resolution
 * callbacks; the controller decides when a conflict exists.
 */
export function WorkbenchDraftConflictNotice({
  onUseRemote,
  onKeepLocal,
  title = "云端草稿已更新",
  description = "请选择保留的版本",
  useRemoteLabel = "使用云端",
  keepLocalLabel = "保留本机",
  className,
  testId = "workbench-draft-conflict",
}: WorkbenchDraftConflictNoticeProps) {
  return (
    <div
      className={["composer-conflict", className].filter(Boolean).join(" ")}
      role="alert"
      data-testid={testId}
    >
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="composer-conflict-actions">
        <Button variant="secondary" onClick={onUseRemote}>
          {useRemoteLabel}
        </Button>
        <Button variant="primary" onClick={onKeepLocal}>
          {keepLocalLabel}
        </Button>
      </div>
    </div>
  );
}
