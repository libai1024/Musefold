// src/features/history/components/HistoryLineagePanel.tsx
// 微调链面板 —— 在检视栏里展示当前记录所属的整条迭代线程（原图 → 微调 1 → …），
// 点任意节点切换检视对象；当前节点中性高亮，Codex 式单色表达。

import { useEffect, useMemo, useState } from 'react';
import { CornerDownRight, ImageOff } from '../../../components/ui/icons';
import type { DesktopGenerationEntry } from '@musefold/desktop-contracts/history-documents';
import { historyThreadOf, type HistoryThreadItem } from '@musefold/domain/history-lineage';
import { historyStatusMeta } from '@musefold/domain/history-status';
import { useHistoryStore } from '../store';
import { useHistoryListQuery } from '../use-history-queries';
import { formatTime } from '../../../lib/format';
import { toImageSrc } from '../../../lib/media';
import { cn } from '../../../lib/utils';

export function HistoryLineagePanel({ record }: { record: DesktopGenerationEntry }) {
  const { records } = useHistoryListQuery();
  const select = useHistoryStore((s) => s.select);
  const thread = useMemo(() => historyThreadOf(records, record.id), [records, record.id]);

  const orphan = thread.length > 0 && thread[0].orphan && thread[0].record.id === record.id;
  // 只有一步且来源健在 → 没有链可讲，不占空间
  if (thread.length <= 1 && !orphan) return null;

  return (
    <section data-testid="history-lineage-panel">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <div className="text-meta font-semibold uppercase tracking-wider text-quaternary">微调链</div>
        <span className="font-mono text-meta tabular-nums text-quaternary">{thread.length} 步</span>
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle">
        {orphan && (
          <p
            className="border-b border-border-subtle bg-inset/60 px-2 py-1.5 text-meta leading-snug text-tertiary"
            data-testid="history-lineage-missing-parent"
          >
            这是一次微调，但来源记录已删除或不在当前筛选结果里。
          </p>
        )}
        {thread.map((item) => (
          <LineageNode
            key={item.record.id}
            item={item}
            current={item.record.id === record.id}
            onSelect={() => select(item.record.id)}
          />
        ))}
      </div>
    </section>
  );
}

function LineageNode({
  item,
  current,
  onSelect,
}: {
  item: HistoryThreadItem<DesktopGenerationEntry>;
  current: boolean;
  onSelect: () => void;
}) {
  const r = item.record;
  const meta = historyStatusMeta(r.status);
  const label =
    item.depth === 0 ? (item.orphan ? '微调（来源缺失）' : '原图') : `微调 ${item.refinementIndex}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={current}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors',
        current ? 'bg-inset' : 'hover:bg-hover',
      )}
      style={{ paddingLeft: `${8 + Math.min(item.depth, 4) * 14}px` }}
      data-testid="history-lineage-node"
      data-history-id={r.id}
      data-current={current ? 'true' : 'false'}
      aria-current={current ? 'true' : undefined}
      title={r.request.prompt}
    >
      {item.depth > 0 && (
        <CornerDownRight className="h-3 w-3 shrink-0 text-quaternary" strokeWidth={1.8} aria-hidden="true" />
      )}
      <NodeThumb path={r.status === 'succeeded' ? r.imagePath : null} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-[11px] leading-4', current ? 'font-semibold text-primary' : 'font-medium text-secondary')}>
            {label}
          </span>
          {meta.status !== 'succeeded' && (
            <span className={cn('shrink-0 text-meta', meta.colorClass)}>{meta.label}</span>
          )}
          {current && (
            <span className="shrink-0 rounded-full border border-border-strong px-1.5 py-px font-mono text-[8.5px] leading-[12px] text-secondary">
              当前
            </span>
          )}
        </span>
        <span className="mt-px block truncate font-mono text-meta leading-3.5 text-quaternary">
          {formatTime(r.createdAtMs)}
        </span>
      </span>
    </button>
  );
}

function NodeThumb({ path }: { path: string | null }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [path]);
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-border-subtle bg-inset">
      {path && !broken ? (
        <img src={toImageSrc(path)} alt="" onError={() => setBroken(true)} className="h-full w-full object-cover" />
      ) : (
        <ImageOff className="h-3 w-3 text-quaternary" />
      )}
    </span>
  );
}
