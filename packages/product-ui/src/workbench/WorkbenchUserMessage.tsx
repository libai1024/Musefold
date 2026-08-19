import type { ReactNode } from "react";

export interface WorkbenchUserMessageProps {
  prompt: ReactNode;
  promptTestId?: string;
  meta?: ReactNode;
  attachments?: ReactNode;
  prefix?: ReactNode;
  negative?: string | null;
  actions?: ReactNode;
  className?: string;
}

/** Shared user-turn presentation. Attachments and actions are capability slots. */
export function WorkbenchUserMessage({
  prompt,
  promptTestId = "generation-prompt",
  meta,
  attachments,
  prefix,
  negative,
  actions,
  className,
}: WorkbenchUserMessageProps) {
  return (
    <div
      className={["mf-workbench-user-message", className]
        .filter(Boolean)
        .join(" ")}
    >
      {attachments}
      <div className="mf-workbench-user-bubble">
        {meta ? <div className="mf-workbench-user-meta">{meta}</div> : null}
        {prefix}
        <p className="mf-workbench-user-prompt" data-testid={promptTestId}>
          {prompt}
        </p>
        {negative ? (
          <p className="mf-workbench-user-negative">排除：{negative}</p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="mf-workbench-user-actions"
          data-testid="generation-user-message-actions"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}
