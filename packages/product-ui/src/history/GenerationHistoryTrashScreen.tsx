import { ArrowLeft, History, RotateCcw } from "@musefold/ui/icons";
import { Button } from "@musefold/ui";
import type { GenerationHistoryDetailViewModel } from "../models";

export interface GenerationHistoryTrashScreenProps {
  items: GenerationHistoryDetailViewModel[];
  loading?: boolean;
  busyId?: string | null;
  error?: string | null;
  onBack: () => void;
  onOpen?: (item: GenerationHistoryDetailViewModel) => void;
  onRestore: (item: GenerationHistoryDetailViewModel) => void;
}

export function GenerationHistoryTrashScreen({
  items,
  loading = false,
  busyId = null,
  error,
  onBack,
  onOpen,
  onRestore,
}: GenerationHistoryTrashScreenProps) {
  return (
    <section className="mf-history-trash" data-testid="history-trash">
      <header>
        <Button variant="ghost" className="mf-detail-back" onClick={onBack} icon={<ArrowLeft aria-hidden="true" />}>
          生成历史
        </Button>
        <div>
          <h1>回收站</h1>
          <span>{items.length}</span>
        </div>
      </header>
      {error ? <p className="mf-inline-error">{error}</p> : null}
      <div className="mf-trash-list" role="list">
        {items.map((item) => (
          <article key={item.id} role="listitem" data-testid="history-trash-row">
            <Button unstyled type="button" className="mf-trash-main" onClick={() => onOpen?.(item)} disabled={!onOpen}>
              <strong>{item.prompt || "（无提示词）"}</strong>
              <span>{item.statusLabel} · 删除于 {item.deletedAtLabel ?? "未知时间"}</span>
            </Button>
            <Button
              variant="secondary"
              className="mf-secondary-button"
              disabled={Boolean(busyId)}
              onClick={() => onRestore(item)}
              data-testid="history-trash-restore"
              icon={<RotateCcw aria-hidden="true" />}
            >
              {busyId === item.id ? "恢复中..." : "恢复"}
            </Button>
          </article>
        ))}
        {items.length === 0 ? (
          <div className="mf-empty-row">
            <History aria-hidden="true" />
            {loading ? "正在载入..." : "回收站为空"}
          </div>
        ) : null}
      </div>
    </section>
  );
}
