import { FileText, X } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import { createPortal } from "react-dom";
import { useState, type CSSProperties } from "react";

export interface WorkbenchPromptReferenceCardProps {
  title: string;
  text?: string | null;
  subtitle?: string;
  onClear: () => void;
  testId?: string;
  workbenchTestId?: string;
  className?: string;
}

/** Shared prompt-source card used by the Desktop and Web composers. */
export function WorkbenchPromptReferenceCard({
  title,
  text,
  subtitle = "引用提示词 · 悬停查看全文",
  onClear,
  testId = "refine-source",
  workbenchTestId = "workbench-source",
  className,
}: WorkbenchPromptReferenceCardProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const previewVisible = Boolean(text);

  const showPreview = (element: HTMLElement) => {
    if (previewVisible) setAnchor(element.getBoundingClientRect());
  };

  return (
    <div
      className={["mf-workbench-prompt-reference-card", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      data-workbench-testid={workbenchTestId}
      data-source-kind="prompt"
      onMouseEnter={(event) => showPreview(event.currentTarget)}
      onMouseLeave={() => setAnchor(null)}
      onFocusCapture={(event) => showPreview(event.currentTarget)}
      onBlurCapture={() => setAnchor(null)}
    >
      <span className="mf-workbench-prompt-reference-icon" aria-hidden="true">
        <FileText />
      </span>
      <span className="mf-workbench-prompt-reference-copy">
        <span className="mf-workbench-prompt-reference-title" title={title}>
          {title}
        </span>
        <span className="mf-workbench-prompt-reference-subtitle">
          {subtitle}
        </span>
      </span>
      <Button
        unstyled
        type="button"
        onClick={onClear}
        title="移除来源"
        aria-label={`移除来源：${title}`}
        className="mf-workbench-prompt-reference-clear"
        data-testid={`${testId}-clear`}
        data-workbench-testid={`${workbenchTestId}-clear`}
      >
        <X aria-hidden="true" />
      </Button>
      {anchor && text && typeof document !== "undefined"
        ? createPortal(
            <div
              className="mf-workbench-prompt-reference-preview"
              style={previewPosition(anchor)}
              role="tooltip"
              data-testid="prompt-reference-preview"
            >
              <span className="mf-workbench-prompt-reference-preview-title">
                {title}
              </span>
              <span className="mf-workbench-prompt-reference-preview-text">
                {text}
              </span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function previewPosition(anchor: DOMRect): CSSProperties {
  const width = Math.min(320, Math.max(0, window.innerWidth - 16));
  return {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
    bottom: window.innerHeight - anchor.top + 8,
    width,
  };
}
