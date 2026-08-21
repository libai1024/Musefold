/**
 * Composer「引用提示词」选择器 —— 与设计方案选择器（SchemePickerPopover）同构：
 * 顶部搜索 + 封面行（相关作品作封面）+ 底部跳提示词库。
 * 选中后由调用方把正文/参数填入草稿，并在 Composer 上方挂来源芯片。
 */
import { useEffect, useMemo, useState } from 'react';
import { FileText, Search, X } from '../../../components/ui/icons';
import type { DesktopLibraryPrompt } from '@musefold/desktop-contracts/library-documents';
import { desktopGateway } from '../../../runtime';
import { toImageSrc } from '../../../lib/media';
import { useAppStore } from '../../../stores/app';

export function PromptPickerPopover({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (prompt: DesktopLibraryPrompt) => void;
}) {
  const [query, setQuery] = useState('');
  const [prompts, setPrompts] = useState<DesktopLibraryPrompt[]>([]);
  const [loading, setLoading] = useState(true);

  // 独立拉取一次快照，不借用提示词库页的 store（避免污染其搜索/筛选状态）。
  useEffect(() => {
    let cancelled = false;
    desktopGateway
      .listLibraryPrompts({ sort: 'updated' })
      .then((rows) => {
        if (!cancelled) setPrompts(rows);
      })
      .catch(() => {
        if (!cancelled) setPrompts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matched = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return prompts;
    return prompts.filter((prompt) =>
      `${prompt.title} ${prompt.content}`.toLowerCase().includes(keyword),
    );
  }, [prompts, query]);

  return (
    <div
      className="absolute inset-x-0 bottom-[calc(100%+10px)] z-50 overflow-hidden rounded-xl border border-border-default bg-popover shadow-pop animate-scale-fade-in"
      role="dialog"
      aria-label="引用提示词"
      data-testid="prompt-picker"
    >
      <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-3">
        <Search className="h-3.5 w-3.5 text-tertiary" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索提示词"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-primary outline-none placeholder:text-quaternary"
          data-testid="prompt-picker-search"
        />
        <button type="button" onClick={onClose} className="icon-action h-7 w-7" aria-label="关闭提示词选择">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[276px] overflow-y-auto p-1.5">
        {matched.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => onPick(prompt)}
            className="grid min-h-[60px] w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 text-left hover:bg-hover"
            data-testid={`prompt-picker-item-${prompt.id}`}
            data-prompt-picker-item
          >
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset">
              {prompt.coverImagePath ? (
                <img src={toImageSrc(prompt.coverImagePath)} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <FileText className="h-4 w-4 text-secondary" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-medium text-primary">{prompt.title}</span>
              <span className="mt-0.5 block truncate text-[9.5px] text-tertiary">{prompt.content}</span>
            </span>
            <span className="text-[10px] text-secondary">引用</span>
          </button>
        ))}
        {!loading && matched.length === 0 && (
          <p className="px-3 py-8 text-center text-[10.5px] text-tertiary" data-testid="prompt-picker-empty">
            {prompts.length === 0 ? '提示词库还是空的' : '没有匹配的提示词'}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          useAppStore.getState().setView('library');
          onClose();
        }}
        className="flex min-h-10 w-full items-center gap-2 border-t border-border-subtle px-3 text-[10.5px] text-secondary hover:bg-hover hover:text-primary"
        data-testid="prompt-picker-open-library"
      >
        <FileText className="h-3.5 w-3.5" />
        打开提示词库
      </button>
    </div>
  );
}
