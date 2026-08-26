import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Blocks, Loader2, Search, X } from '../../components/ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/toast';
import { useAppStore } from '../../stores/app';
import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';
import { useGenerationWorkbenchStore } from '@renderer/runtime/workbench-access';
import { useSchemeRunStore } from './run-store';

/** 方案选择器（UI 规范 §6.2）：锚定 Composer 上方的小面板。 */
export function SchemeRunPickerPopover({ onClose }: { onClose: () => void }) {
  const [schemes, setSchemes] = useState<DesignSchemeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const attach = useSchemeRunStore((state) => state.attach);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await api.designScheme.list();
        if (!alive) return;
        if (result.ok) setSchemes(result.data.filter((scheme) => scheme.status === 'formal'));
        else setError(result.error.message);
      } catch {
        if (alive) setSchemes([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (schemes ?? []).filter(
        (scheme) =>
          !normalized ||
          [scheme.name, scheme.summary, scheme.sourceLabel]
            .join(' ')
            .toLowerCase()
            .includes(normalized),
      ),
    [schemes, normalized],
  );
  const recent = useMemo(
    () =>
      normalized
        ? []
        : filtered
            .filter((scheme) => scheme.lastRunAt !== null)
            .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
            .slice(0, 4),
    [filtered, normalized],
  );
  const rest = useMemo(
    () =>
      filtered
        .filter((scheme) => !recent.some((item) => item.id === scheme.id))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [filtered, recent],
  );
  const flat = useMemo(() => [...recent, ...rest], [recent, rest]);

  useEffect(() => setActiveIndex(0), [normalized, schemes]);

  const pick = async (scheme: DesignSchemeSummary) => {
    const current = useGenerationWorkbenchStore.getState().draftSource;
    const previous = current.kind === 'scheme' && current.schemeId !== scheme.id ? current : null;
    onClose();
    const attached = await attach(scheme, 'formal');
    if (attached && previous) {
      toast.show({
        title: `已替换为「${scheme.name}」`,
        description: `原方案「${previous.label}」已移除。`,
        action: {
          label: '撤销',
          onClick: () => {
            void api.designScheme.list().then((result) => {
              if (!result.ok) return;
              const prevSummary = result.data.find((item) => item.id === previous.schemeId);
              if (prevSummary)
                void attach(prevSummary, previous.mode === 'modify' ? 'formal' : previous.mode);
            });
          },
        },
      });
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && flat[activeIndex]) {
      event.preventDefault();
      void pick(flat[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const renderRow = (scheme: DesignSchemeSummary) => {
    const index = flat.indexOf(scheme);
    return (
      <button
        key={scheme.id}
        type="button"
        onClick={() => void pick(scheme)}
        onMouseEnter={() => setActiveIndex(index)}
        className={cn(
          'grid min-h-[56px] w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 text-left',
          index === activeIndex ? 'bg-hover' : 'hover:bg-hover',
        )}
        data-testid={`scheme-run-picker-${scheme.id}`}
        data-active={index === activeIndex || undefined}
      >
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-inset">
          {scheme.coverImagePath ? (
            <img
              src={toImageSrc(scheme.coverImagePath)}
              alt=""
              className="h-full w-full object-contain"
            />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-background">
              <Blocks className="h-3.5 w-3.5" />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium text-primary">{scheme.name}</span>
          <span className="mt-0.5 block truncate text-meta text-tertiary">
            {scheme.summary || scheme.sourceLabel}
          </span>
        </span>
        <span className="text-meta text-secondary">使用</span>
      </button>
    );
  };

  return (
    <div
      className="absolute inset-x-0 bottom-[calc(100%+10px)] z-50 overflow-hidden rounded-xl border border-border-default bg-popover shadow-pop animate-scale-fade-in"
      role="dialog"
      aria-label="选择设计方案"
      data-testid="scheme-run-picker"
      onKeyDown={onKeyDown}
    >
      <div className="flex h-11 items-center gap-2 border-b border-border-subtle px-3">
        <Search className="h-3.5 w-3.5 text-tertiary" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索我的方案"
          className="min-w-0 flex-1 bg-transparent text-[11px] text-primary outline-none placeholder:text-quaternary"
          data-testid="scheme-run-picker-search"
        />
        <button
          type="button"
          onClick={onClose}
          className="icon-action h-7 w-7"
          aria-label="关闭方案选择"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-1.5">
        {!schemes && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-meta text-tertiary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在读取方案…
          </div>
        )}
        {error && <p className="px-3 py-6 text-center text-meta text-danger">{error}</p>}
        {schemes && flat.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-meta text-tertiary">
              {normalized
                ? '没有匹配的正式方案'
                : '还没有正式方案；草稿完成试运行并设为正式后会出现在这里。'}
            </p>
            <button
              type="button"
              onClick={() => {
                onClose();
                useAppStore.getState().requestSchemeCenter({ surface: 'discover' });
              }}
              className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md border border-border-default px-3 text-meta font-medium text-primary hover:bg-hover"
              data-testid="scheme-run-picker-discover"
            >
              前往发现
            </button>
          </div>
        )}
        {recent.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-1.5 text-meta font-medium text-tertiary">最近使用</p>
            {recent.map(renderRow)}
          </>
        )}
        {rest.length > 0 && (
          <>
            {(recent.length > 0 || !normalized) && (
              <p className="px-2 pb-1 pt-1.5 text-meta font-medium text-tertiary">我的方案</p>
            )}
            {rest.map(renderRow)}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          onClose();
          useAppStore.getState().requestSchemeCenter({ surface: 'mine' });
        }}
        className="flex min-h-10 w-full items-center gap-2 border-t border-border-subtle px-3 text-meta text-secondary hover:bg-hover hover:text-primary"
        data-testid="scheme-run-picker-browse"
      >
        <Blocks className="h-3.5 w-3.5" />
        浏览全部方案
      </button>
    </div>
  );
}
