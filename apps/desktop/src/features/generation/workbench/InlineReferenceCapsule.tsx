import { useState } from "react";
import { FileText, X } from "../../../components/ui/icons";
import { WorkbenchPromptFullTextCard } from "@musefold/product-ui";
import type { GenerationTurn } from "./types";

export function InlineReferenceCapsule({
  reference,
  onRemove,
}: {
  reference: GenerationTurn["references"][number];
  onRemove: () => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <span
      className="inline-flex h-[21px] max-w-[176px] items-center gap-1 rounded-md border border-border-subtle bg-inset pl-1.5 pr-0.5 text-[11px] font-medium leading-none text-primary"
      data-testid="workbench-reference-chip"
      data-reference-scope={reference.scope}
      onMouseEnter={(event) =>
        setAnchor(event.currentTarget.getBoundingClientRect())
      }
      onMouseLeave={() => setAnchor(null)}
      onFocusCapture={(event) =>
        setAnchor(event.currentTarget.getBoundingClientRect())
      }
      onBlurCapture={() => setAnchor(null)}
    >
      <FileText className="h-3 w-3 shrink-0 text-secondary" />
      <span className="min-w-0 truncate">{reference.title}</span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] transition-colors hover:bg-hover"
        aria-label={`移除引用：${reference.title}`}
        title="移除引用（Backspace）"
        data-testid="workbench-reference-remove"
      >
        <X className="h-2.5 w-2.5" />
      </button>
      {anchor && (
        <WorkbenchPromptFullTextCard
          title={reference.title}
          text={reference.text}
          scope={reference.scope}
          anchor={anchor}
        />
      )}
    </span>
  );
}
