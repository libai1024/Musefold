import { Button, StatusBadge } from "@musefold/ui";
import { CornerDownRight, History, ImageOff, LoaderCircle } from "@musefold/ui/icons";
import { useEffect, useState, type ReactNode } from "react";
import type { GenerationHistoryItemViewModel } from "../models";

export interface GenerationHistoryRowProps {
  item: GenerationHistoryItemViewModel;
  actions?: ReactNode;
  onOpen?: () => void;
  onOpenImage?: () => void;
}

export function GenerationHistoryRow({
  item,
  actions,
  onOpen,
  onOpenImage,
}: GenerationHistoryRowProps) {
  const depth = Math.min(Math.max(item.depth ?? 0, 0), 4);
  const [imageBroken, setImageBroken] = useState(false);

  useEffect(() => setImageBroken(false), [item.imageUrl]);

  return (
    <div
      className="mf-history-thread-row"
      style={{ paddingInlineStart: `${depth * 26}px` }}
    >
      {depth > 0 && (
        <span
          className="mf-history-thread-connector"
          aria-hidden="true"
          data-testid="history-thread-connector"
        >
          <CornerDownRight />
        </span>
      )}
      <article
        className="mf-history-row"
        data-selected={item.selected ? "true" : "false"}
        data-tone={item.statusTone ?? "neutral"}
        data-status={item.statusKey}
        data-depth={depth}
        data-thread-root={item.threadRootId}
        role="listitem"
        data-testid="history-row"
      >
        <Button
          unstyled
          type="button"
          className="mf-history-thumb"
          onClick={onOpenImage}
          disabled={!onOpenImage}
          aria-label={onOpenImage ? "放大预览" : undefined}
          title={onOpenImage ? "放大预览" : undefined}
          data-testid="history-thumb-open"
        >
          {item.imageUrl && !imageBroken ? (
            <img
              src={item.imageUrl}
              alt=""
              loading="lazy"
              onError={() => setImageBroken(true)}
            />
          ) : item.imageUrl ? (
            <ImageOff aria-hidden="true" />
          ) : (
            <History aria-hidden="true" />
          )}
        </Button>
        <Button
          unstyled
          type="button"
          className="mf-history-main"
          onClick={onOpen}
          disabled={!onOpen}
        >
          <strong>
            {item.refinementLabel && (
              <span
                className="mf-history-refinement-tag"
                title={item.refinementTitle}
                data-testid="history-refinement-tag"
              >
                {item.refinementLabel}
              </span>
            )}
            <span>{item.prompt || "（无提示词）"}</span>
          </strong>
          <span>
            <StatusBadge
              className="mf-status-label"
              tone={item.statusTone ?? "neutral"}
              data-testid={
                item.isRetrying ? "history-retrying" : "history-status-label"
              }
              icon={
                item.isRetrying ? (
                  <LoaderCircle className="mf-spin" aria-hidden="true" />
                ) : undefined
              }
            >
              {item.statusLabel}
            </StatusBadge>
            {item.metadata.map((value) => (
              <span key={value} className="mf-history-meta-item">
                {value}
              </span>
            ))}
            {Boolean(item.refinementCount) && (
              <span
                className="mf-history-meta-item"
                data-testid="history-thread-count"
              >
                {item.refinementCount} 次微调
              </span>
            )}
          </span>
        </Button>
        {actions && <div className="mf-row-actions">{actions}</div>}
      </article>
    </div>
  );
}
