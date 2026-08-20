/**
 * 「从历史内容创建」的真实来源选择层（UI 规范 §10）：
 * 由用户勾选具体历史作品与是否携带提示词，绝不默认读取整段历史；
 * 确认后把可见、可编辑的提取说明写进 Composer 正文，来源作为指令附件提交。
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, History, Loader2, X } from '../../components/ui/icons';
import { desktopGateway } from '../../runtime';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import type { HistoryRecord } from '@musefold/desktop-contracts/models';
import type { DesignSchemeHistorySourceItem } from '@musefold/desktop-contracts/design-scheme';

/** 默认提取说明（UI 规范 §10.2）：保留视觉方向，排除具体主体。 */
export const HISTORY_EXTRACTION_NOTE = [
  '从这些内容创建一个可复用方案。',
  '',
  '保留视觉风格、构图方式、色彩与材质方向；',
  '不保留具体人物、品牌名称和原始文案。',
].join('\n');

/** 快捷建议：点击后只更新可见说明文字，不在后台增加规则。 */
const EXTRACTION_SUGGESTIONS = [
  '保留人物特征',
  '保留文案结构',
  '保留品牌元素',
  '保留生成参数',
  '只参考其中一张图',
];

export interface HistorySourceSelection {
  items: DesignSchemeHistorySourceItem[];
  /** 进入 Composer 正文的可编辑提取说明。 */
  note: string;
}

export function HistorySourcePicker({
  onCancel,
  onConfirm,
  initialSelectedIds,
}: {
  onCancel: () => void;
  onConfirm: (selection: HistorySourceSelection) => void;
  /** 重新调整范围时带入已选中的历史 id。 */
  initialSelectedIds?: string[];
}) {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelectedIds ?? []));
  const [includePrompts, setIncludePrompts] = useState(true);
  const [note, setNote] = useState(HISTORY_EXTRACTION_NOTE);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await desktopGateway.listHistory({ status: 'success', limit: 60 });
        if (cancelled) return;
        setRecords(list.filter((record) => Boolean(record.imagePath)));
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取历史记录失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selected.has(record.id)),
    [records, selected],
  );

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const appendSuggestion = (suggestion: string) => {
    setNote((current) => {
      const line = `补充：${suggestion}。`;
      if (current.includes(line)) return current.replace(`\n${line}`, '').replace(line, '').trimEnd();
      return `${current.trimEnd()}\n${line}`;
    });
  };

  const confirm = () => {
    const items: DesignSchemeHistorySourceItem[] = selectedRecords.map((record) => ({
      historyId: record.id,
      imagePath: record.imagePath as string,
      ...(includePrompts && record.promptText.trim() ? { promptText: record.promptText.trim() } : {}),
    }));
    onConfirm({ items, note });
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/35 p-4 animate-overlay-in" data-testid="history-source-picker">
      <div className="flex max-h-[min(640px,90dvh)] w-full max-w-[560px] flex-col rounded-lg border border-border-default bg-popover shadow-pop animate-dialog-in" role="dialog" aria-modal="true" aria-labelledby="history-source-title">
        <div className="flex items-start gap-3 border-b border-border-subtle px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-inset text-secondary"><History className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2 id="history-source-title" className="text-[14px] font-semibold text-primary">选择历史来源</h2>
            <p className="mt-1 text-[10.5px] text-tertiary">只提取你选中的作品；范围之后仍可重新调整。</p>
          </div>
          <button type="button" onClick={onCancel} className="icon-action" aria-label="关闭" title="关闭"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-[11px] text-tertiary"><Loader2 className="h-4 w-4 animate-spin" />正在读取历史作品…</div>
          ) : error ? (
            <div className="rounded-md border border-danger/25 bg-danger/5 px-3 py-2 text-[10.5px] text-danger">{error}</div>
          ) : records.length === 0 ? (
            <p className="py-14 text-center text-[11px] text-tertiary">还没有生成成功的历史作品；先在工作台生成图片，再从这里创建方案。</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 max-[560px]:grid-cols-3">
                {records.map((record) => {
                  const active = selected.has(record.id);
                  const order = active ? [...selected].indexOf(record.id) + 1 : 0;
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => toggle(record.id)}
                      className={cn(
                        'group relative aspect-square overflow-hidden rounded-md border bg-inset transition-colors',
                        active ? 'border-accent ring-1 ring-accent/45' : 'border-border-subtle hover:border-border-default',
                      )}
                      aria-pressed={active}
                      title={record.promptText.slice(0, 120)}
                      data-testid={`history-pick-${record.id}`}
                    >
                      <img src={toImageSrc(record.imagePath as string)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      <span className={cn(
                        'absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-semibold',
                        active ? 'border-accent bg-accent text-[color:var(--on-accent)]' : 'border-white/60 bg-black/30 text-transparent group-hover:text-white/70',
                      )}>
                        {active ? order : <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>

              <label className="mt-4 flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md border border-border-subtle px-3 text-[11px] text-primary hover:bg-hover">
                <input
                  type="checkbox"
                  checked={includePrompts}
                  onChange={(event) => setIncludePrompts(event.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                  data-testid="history-include-prompts"
                />
                包含这些作品的生成提示词
                <span className="ml-auto text-[10px] text-tertiary">帮助提取固定规则</span>
              </label>

              <div className="mt-4 border-t border-border-subtle pt-4">
                <p className="text-[10.5px] font-medium text-secondary">提取说明（进入 Composer 后仍可修改）</p>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  className="mt-2 w-full resize-none rounded-md border border-border-subtle bg-inset px-2.5 py-2 text-[11px] leading-5 text-primary outline-none focus:border-accent/50"
                  data-testid="history-extraction-note"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {EXTRACTION_SUGGESTIONS.map((suggestion) => {
                    const active = note.includes(`补充：${suggestion}。`);
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => appendSuggestion(suggestion)}
                        className={cn(
                          'min-h-7 rounded-md border px-2 text-[10px] transition-colors',
                          active ? 'border-accent/35 bg-accent-soft text-accent' : 'border-border-subtle text-tertiary hover:bg-hover',
                        )}
                        data-testid={`history-suggestion-${suggestion}`}
                      >
                        {suggestion}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
          <span className="text-[10px] text-tertiary" data-testid="history-selected-count">已选择 {selected.size} 张作品</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCancel} className="action-button">取消</button>
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={confirm}
              className="action-button bg-primary text-background hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="history-source-confirm"
            >
              进入 Composer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
