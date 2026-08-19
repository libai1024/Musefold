import { Button, IconButton } from "@musefold/ui";
import { LoaderCircle, Trash2 } from "@musefold/ui/icons";
import type { ReactNode } from "react";
import type { GenerationHistoryItemViewModel } from "../models";
import { GenerationHistoryRow } from "./GenerationHistoryRow";
import { ProductPageHeader } from "../navigation/ProductPageHeader";

export interface GenerationHistoryScreenProps {
  items: GenerationHistoryItemViewModel[];
  count?: number;
  refreshing?: boolean;
  onRefresh: () => void;
  onOpenTrash?: () => void;
  onOpen?: (item: GenerationHistoryItemViewModel) => void;
  headerAction?: ReactNode;
  toolbar?: ReactNode;
  body?: ReactNode;
  className?: string;
}

export function GenerationHistoryScreen({
  items,
  count,
  refreshing = false,
  onRefresh,
  onOpenTrash,
  onOpen,
  headerAction,
  toolbar,
  body,
  className,
}: GenerationHistoryScreenProps) {
  return (
    <section
      className={[
        "mf-product-page mf-history-screen",
        className,
      ].filter(Boolean).join(" ")}
      data-testid="history-page"
    >
      <ProductPageHeader
        title="生成历史"
        count={count ?? items.length}
        actions={
          <>
          {headerAction}
          {onOpenTrash ? (
            <IconButton
              className="mf-icon-button"
              onClick={onOpenTrash}
              label="回收站"
            >
              <Trash2 aria-hidden="true" />
            </IconButton>
          ) : null}
          <IconButton
            className="mf-icon-button"
            onClick={onRefresh}
            disabled={refreshing}
            label="刷新历史"
          >
            <LoaderCircle
              className={refreshing ? "mf-spin" : undefined}
              aria-hidden="true"
            />
          </IconButton>
          </>
        }
      />
      {toolbar}
      {body ?? <div className="mf-history-list" role="list">
          {items.map((item) => (
            <GenerationHistoryRow
              key={item.id}
              item={item}
              actions={
                <Button
                  variant="ghost"
                  className="mf-text-action"
                  onClick={() => onOpen?.(item)}
                >
                  打开
                </Button>
              }
              onOpen={onOpen ? () => onOpen(item) : undefined}
            />
          ))}
          {items.length === 0 && (
            <div className="mf-empty-row">还没有生成记录</div>
          )}
        </div>}
    </section>
  );
}
