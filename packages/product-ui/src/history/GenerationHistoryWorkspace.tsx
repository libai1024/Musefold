import { ArrowLeft } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import type { ReactNode } from "react";

export interface GenerationHistoryWorkspaceProps {
  list: ReactNode;
  detail?: ReactNode;
  detailOpen: boolean;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
  testId?: string;
}

/** Shared wide-screen list/inspector layout with a single-page mobile state. */
export function GenerationHistoryWorkspace({
  list,
  detail,
  detailOpen,
  onBack,
  backLabel = "生成历史",
  className,
  testId = "history-workspace",
}: GenerationHistoryWorkspaceProps) {
  return (
    <div
      className={`mf-history-workspace${className ? ` ${className}` : ""}`}
      data-detail-open={detailOpen ? "true" : "false"}
      data-testid={testId}
    >
      <main className="mf-history-workspace-list">{list}</main>
      <aside
        className="mf-history-workspace-inspector"
        aria-hidden={!detailOpen}
        data-testid="history-inspector"
      >
        {detailOpen ? (
          <>
            {onBack ? (
              <Button
                variant="ghost"
                className="mf-history-workspace-back"
                onClick={onBack}
                data-testid="history-detail-back"
                icon={<ArrowLeft aria-hidden="true" />}
              >
                {backLabel}
              </Button>
            ) : null}
            <div className="mf-history-workspace-detail">{detail}</div>
          </>
        ) : null}
      </aside>
    </div>
  );
}

export interface GenerationHistoryInspectorPanelProps {
  content: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
  error?: ReactNode;
  className?: string;
  testId?: string;
  historyId?: string;
  status?: string;
}

/** Shared inspector scroll/action geometry; hosts inject platform actions. */
export function GenerationHistoryInspectorPanel({
  content,
  actions,
  notice,
  error,
  className,
  testId = "history-detail",
  historyId,
  status,
}: GenerationHistoryInspectorPanelProps) {
  return (
    <section
      className={`mf-history-inspector-panel${className ? ` ${className}` : ""}`}
      data-testid={testId}
      data-history-id={historyId}
      data-status={status}
    >
      {notice ? <div className="mf-history-inspector-notice">{notice}</div> : null}
      {error ? <div className="mf-history-inspector-error">{error}</div> : null}
      <div className="mf-history-inspector-scroll">{content}</div>
      {actions ? (
        <div className="mf-history-inspector-action-bar">{actions}</div>
      ) : null}
    </section>
  );
}
