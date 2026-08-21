import { useState } from "react";
import { FileText, History, X } from "../../../components/ui/icons";
import { WorkbenchPromptReferenceCard } from "@musefold/product-ui";
import { WorkbenchPromptFullTextCard } from "@musefold/product-ui";
import type { GenerationSource } from "./types";

// 来源芯片（提示词/历史引用）：Codex 式附件芯片，表达在 Composer 上方的上下文区；提示词来源悬停可看全文。
export function SourceChip({
  source,
  onClear,
  previewText,
}: {
  source: GenerationSource;
  onClear: () => void;
  previewText?: string;
}) {
  const fromPrompt = source.kind === "prompt";
  const Icon = fromPrompt ? FileText : History;
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  if (fromPrompt) {
    return (
      <WorkbenchPromptReferenceCard
        title={source.label ?? "提示词"}
        text={previewText ?? source.content}
        subtitle={
          (previewText ?? source.content)
            ? "引用提示词 · 悬停查看全文"
            : "来自提示词库"
        }
        onClear={onClear}
      />
    );
  }
  return (
    <div
      className="flex h-12 min-w-[200px] max-w-[300px] shrink-0 items-center gap-2.5 rounded-lg border border-border-default bg-popover px-2.5 shadow-sm"
      data-testid="refine-source"
      data-workbench-testid="workbench-source"
      data-source-kind={source.kind}
      onMouseEnter={
        previewText
          ? (event) => setAnchor(event.currentTarget.getBoundingClientRect())
          : undefined
      }
      onMouseLeave={previewText ? () => setAnchor(null) : undefined}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-background">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[10.5px] font-medium text-primary"
          title={source.label ?? ""}
        >
          {source.label ?? (fromPrompt ? "提示词" : "历史记录")}
        </span>
        <span className="mt-0.5 block truncate text-[9.5px] text-tertiary">
          {fromPrompt
            ? previewText
              ? "引用提示词 · 悬停查看全文"
              : "来自提示词库"
            : "来自生成历史"}
        </span>
      </span>
      <button
        type="button"
        onClick={onClear}
        title="移除来源"
        aria-label="移除来源"
        className="icon-action h-7 w-7 shrink-0"
        data-testid="refine-source-clear"
        data-workbench-testid="workbench-source-clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {anchor && previewText && (
        <WorkbenchPromptFullTextCard
          title={source.label ?? "提示词"}
          text={previewText}
          anchor={anchor}
        />
      )}
    </div>
  );
}
