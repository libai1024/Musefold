import { X } from "../../../components/ui/icons";
import { toImageSrc } from "../../../lib/media";
import type { RefinementContext } from "./types";

export function RefinementTargetReference({
  context,
  onClear,
  onPreview,
}: {
  context: RefinementContext;
  onClear: () => void;
  onPreview: (path: string) => void;
}) {
  const target = context.images[0] ?? {
    source: "history" as const,
    path: context.imagePath,
    historyId: context.historyId,
    name: "图 1",
  };
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border-default bg-popover p-1.5 pl-1.5 shadow-sm"
      data-testid="workbench-refinement-context"
      data-position="above-composer"
    >
      <button
        type="button"
        onClick={() => onPreview(target.path)}
        className="relative shrink-0 cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        title="查看微调目标"
        aria-label="查看微调目标"
        data-testid="refinement-context-image-preview"
      >
        <img
          src={toImageSrc(target.path)}
          alt="微调目标"
          className="h-11 w-11 rounded-md object-contain"
        />
        <span className="absolute bottom-0.5 left-0.5 rounded bg-black/65 px-1 py-0.5 text-[7.5px] leading-none text-white">
          图 1
        </span>
      </button>
      <span
        className="text-[11px] font-medium text-primary"
        data-testid="refinement-target-label"
      >
        微调目标
      </span>
      <button
        type="button"
        onClick={onClear}
        title="退出微调"
        aria-label="退出微调"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        data-testid="refinement-context-clear"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
