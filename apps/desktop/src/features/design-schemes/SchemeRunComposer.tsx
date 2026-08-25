/**
 * 真实方案附件（v0.3.2 运行切片）的 Composer 展示：
 * 方案芯片（试运行态带 Ember 状态点）+ 附件浮层 + 具名图片槽位 + 文本变量字段
 * + 方案选择器（UI 规范 §6/§7）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, ImagePlus, Loader2, Plus, Search, X } from '../../components/ui/icons';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { toast } from '../../stores/toast';
import { useAppStore } from '../../stores/app';
import type { DesignSchemeSummary } from '@musefold/desktop-contracts/design-scheme';
import { useGenerationWorkbenchStore } from '@renderer/runtime/workbench-access';
import type { GenerationSource } from '@musefold/desktop-contracts/generation-source';
import { useSchemeRunStore } from './run-store';

type SchemeDraftSource = Extract<GenerationSource, { kind: 'scheme' }>;

const FIDELITY_LABEL: Record<string, string> = {
  verified: '已验证',
  faithful: '完整还原',
  adapted: '有取舍',
  unsupported: '暂不支持',
};

/** 方案附件浮层（UI 规范 §6.1）：摘要、来源、输入要求、查看详情、更换和移除。 */
function SchemeAttachmentPopover({
  source,
  onClose,
  onSwap,
  onClear,
}: {
  source: SchemeDraftSource;
  onClose: () => void;
  onSwap: () => void;
  onClear: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[300px] rounded-lg border border-border-default bg-popover p-3.5 shadow-pop animate-scale-fade-in"
      role="dialog"
      aria-label="方案附件详情"
      data-testid="scheme-attachment-popover"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-background"><Blocks className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-primary">{source.label}</p>
          <p className="mt-0.5 text-meta text-tertiary">
            {source.sourceLabel} · {FIDELITY_LABEL[source.fidelity] ?? source.fidelity}
            {source.mode === 'trial' ? ' · 试运行' : source.mode === 'modify' ? ' · 修改中' : ''}
          </p>
        </div>
      </div>
      {source.summary && <p className="mt-2.5 text-meta leading-5 text-secondary">{source.summary}</p>}
      {source.inputs.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2.5">
          <p className="text-meta font-medium text-secondary">需要提供</p>
          <ul className="mt-1.5 space-y-1">
            {source.inputs.map((slot) => (
              <li key={slot.id} className="flex items-center gap-2 text-meta text-primary">
                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', slot.required ? 'bg-accent' : 'bg-border-default')} aria-hidden />
                <span className="min-w-0 truncate">{slot.label}</span>
                <span className="ml-auto shrink-0 text-meta text-tertiary">
                  {slot.kind === 'image' || slot.kind === 'image-set' ? '图片' : '文本'}{slot.required ? ' · 必需' : ' · 可选'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
        <button
          type="button"
          onClick={() => {
            onClose();
            useAppStore.getState().requestSchemeCenter({ detailId: source.schemeId });
          }}
          className="min-h-7 rounded-md px-2 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
          data-testid="scheme-attachment-detail"
        >
          查看详情
        </button>
        <button
          type="button"
          onClick={() => { onClose(); onSwap(); }}
          className="min-h-7 rounded-md px-2 text-meta font-medium text-secondary hover:bg-hover hover:text-primary"
          data-testid="scheme-attachment-swap"
        >
          更换
        </button>
        <button
          type="button"
          onClick={() => { onClose(); onClear(); }}
          className="ml-auto min-h-7 rounded-md px-2 text-meta font-medium text-danger hover:bg-danger/10"
          data-testid="scheme-attachment-remove"
        >
          移除
        </button>
      </div>
    </div>
  );
}

export function SchemeRunAttachment({
  source,
  imageCount,
  onClear,
  onPickImage,
  onSwap,
}: {
  source: SchemeDraftSource;
  imageCount: number;
  onClear: () => void;
  onPickImage: () => void;
  /** 打开方案选择器更换主方案（§6.1）。 */
  onSwap: () => void;
}) {
  const trial = source.mode === 'trial';
  const modify = source.mode === 'modify';
  const [popoverOpen, setPopoverOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 修改模式不显示运行输入（规范 §8.3）。
  const imageSlots = modify ? [] : source.inputs.filter((slot) => slot.kind === 'image' || slot.kind === 'image-set');
  let assignedImages = 0;

  useEffect(() => {
    if (!popoverOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setPopoverOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [popoverOpen]);

  return (
    <div data-testid="scheme-run-attachment" data-mode={source.mode}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative" ref={rootRef}>
          <div
            className={cn(
              'flex h-12 min-w-[240px] max-w-full items-center gap-2.5 rounded-lg border bg-popover px-2.5',
              trial || modify ? 'border-accent/35' : 'border-border-default',
            )}
            data-testid="scheme-run-chip"
          >
            <button
              type="button"
              onClick={() => setPopoverOpen((value) => !value)}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              aria-haspopup="dialog"
              aria-expanded={popoverOpen}
              title="查看方案附件详情"
              data-testid="scheme-run-chip-body"
            >
              <span className={cn(
                'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                trial || modify ? 'bg-accent-soft text-accent' : 'bg-primary text-background',
              )}>
                <Blocks className="h-3.5 w-3.5" />
                {trial && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block max-w-[220px] truncate text-meta font-medium text-primary">
                  {trial ? `试运行 · ${source.label}` : modify ? `修改方案 · ${source.label}` : source.label}
                </span>
                <span className="mt-0.5 block max-w-[220px] truncate text-meta text-tertiary">
                  {source.sourceLabel} · {FIDELITY_LABEL[source.fidelity] ?? source.fidelity}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={onClear}
              className="icon-action h-7 w-7 shrink-0"
              aria-label="移除方案"
              title="移除方案"
              data-testid="scheme-run-chip-remove"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {popoverOpen && (
            <SchemeAttachmentPopover
              source={source}
              onClose={() => setPopoverOpen(false)}
              onSwap={onSwap}
              onClear={onClear}
            />
          )}
        </div>
        {imageSlots.map((slot) => {
          const need = Math.max(1, slot.minItems ?? 1);
          const filled = imageCount >= assignedImages + (slot.required ? need : 1);
          if (slot.required) assignedImages += need;
          return (
            <button
              key={slot.id}
              type="button"
              onClick={onPickImage}
              className={cn(
                'flex h-12 min-w-[94px] shrink-0 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-meta font-medium',
                filled
                  ? 'border-border-default bg-inset/55 text-secondary'
                  : slot.required
                    ? 'border-dashed border-accent/45 bg-accent-soft text-accent'
                    : 'border-dashed border-border-default text-tertiary',
              )}
              data-testid={`scheme-run-image-slot-${slot.id}`}
              data-filled={filled}
              title={slot.description ?? slot.label}
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {slot.label}{slot.required ? ' · 必需' : ''}
            </button>
          );
        })}
      </div>
      <p className="mt-1 px-1 text-meta text-tertiary" data-testid="scheme-run-mode-hint">
        {modify
          ? '描述要修改的内容，Agent 会更新方案；修改后需要重新试运行验证。'
          : trial ? '本次输入只用于验证方案，不会修改方案本身。' : '方案决定稳定的视觉方向，本次输入只影响这一次生成。'}
      </p>
    </div>
  );
}

/**
 * 方案声明的文本输入（@变量）；值存在工作台 store，提交时随运行请求发往主进程。
 * 必填变量自动出现；可选变量默认隐藏，通过 + 添加（UI 规范 §7.1）。
 */
export function SchemeRunVariableFields() {
  const source = useGenerationWorkbenchStore((state) => state.draftSource);
  const values = useGenerationWorkbenchStore((state) => state.schemeInputValues);
  const setValue = useGenerationWorkbenchStore((state) => state.setSchemeInputValue);
  /** 用户显式添加的可选变量 id；换方案（revision）时重置。 */
  const [added, setAdded] = useState<string[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addRootRef = useRef<HTMLDivElement>(null);
  const revisionId = source.kind === 'scheme' ? source.revisionId : null;

  useEffect(() => {
    setAdded([]);
    setAddMenuOpen(false);
  }, [revisionId]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!addRootRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [addMenuOpen]);

  if (source.kind !== 'scheme' || source.mode === 'modify') return null;
  const textSlots = source.inputs.filter((slot) => slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice');
  if (textSlots.length === 0) return null;

  const visibleSlots = textSlots.filter((slot) => slot.required || added.includes(slot.id) || Boolean(values[slot.id]?.trim()));
  const hiddenOptional = textSlots.filter((slot) => !visibleSlots.includes(slot));

  const removeOptional = (slotId: string) => {
    setValue(slotId, '');
    setAdded((prev) => prev.filter((id) => id !== slotId));
  };

  return (
    <div className="mb-1.5 border-b border-border-subtle px-1 pb-2" data-testid="scheme-run-variable-fields">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {visibleSlots.map((slot) => (
          <label
            key={slot.id}
            className="flex min-h-8 min-w-0 items-center gap-2 rounded-md bg-inset/55 px-2.5 focus-within:ring-1 focus-within:ring-accent/35"
          >
            <span className="shrink-0 text-meta font-medium text-accent">@{slot.label}</span>
            <input
              value={values[slot.id] ?? ''}
              onChange={(event) => setValue(slot.id, event.target.value)}
              placeholder={slot.description ?? (slot.required ? '必填' : '可选')}
              className="min-w-0 flex-1 bg-transparent text-meta text-primary outline-none placeholder:text-quaternary"
              autoFocus={!slot.required && added.includes(slot.id)}
              data-testid={`scheme-run-variable-${slot.id}`}
            />
            {slot.required && !values[slot.id]?.trim() && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="必需" aria-label="必填项未填写" />
            )}
            {!slot.required && (
              <button
                type="button"
                onClick={() => removeOptional(slot.id)}
                className="icon-action h-5 w-5 shrink-0"
                aria-label={`移除${slot.label}`}
                title="移除这个可选变量"
                data-testid={`scheme-run-variable-remove-${slot.id}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </label>
        ))}
      </div>
      {hiddenOptional.length > 0 && (
        <div className="relative mt-1.5" ref={addRootRef}>
          <button
            type="button"
            onClick={() => setAddMenuOpen((value) => !value)}
            className="inline-flex min-h-7 items-center gap-1 rounded-md border border-dashed border-border-default px-2 text-meta font-medium text-tertiary hover:border-border-default hover:bg-hover hover:text-primary"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            data-testid="scheme-run-add-variable"
          >
            <Plus className="h-3 w-3" />变量
          </button>
          {addMenuOpen && (
            <div className="absolute bottom-[calc(100%+6px)] left-0 z-40 w-[220px] rounded-lg border border-border-default bg-popover p-1.5 shadow-pop animate-scale-fade-in" role="menu" aria-label="添加可选变量" data-testid="scheme-run-add-variable-menu">
              {hiddenOptional.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { setAdded((prev) => [...prev, slot.id]); setAddMenuOpen(false); }}
                  className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-hover"
                  data-testid={`scheme-run-add-variable-${slot.id}`}
                >
                  <span className="text-meta font-medium text-accent">@{slot.label}</span>
                  {slot.description && <span className="min-w-0 truncate text-meta text-tertiary">{slot.description}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 方案选择器（UI 规范 §6.2）：锚定 Composer 上方的小面板。
 * 只显示本地正式方案；「最近使用」最多四项；草稿不出现在这里。
 */
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
    return () => { alive = false; };
  }, []);

  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => (schemes ?? []).filter((scheme) => !normalized
    || [scheme.name, scheme.summary, scheme.sourceLabel].join(' ').toLowerCase().includes(normalized)), [schemes, normalized]);
  // 最近使用：只在未搜索时分区展示，最多四项（§6.2）。
  const recent = useMemo(() => (normalized ? [] : filtered
    .filter((scheme) => scheme.lastRunAt !== null)
    .sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0))
    .slice(0, 4)), [filtered, normalized]);
  const rest = useMemo(() => filtered
    .filter((scheme) => !recent.some((item) => item.id === scheme.id))
    .sort((a, b) => b.updatedAt - a.updatedAt), [filtered, recent]);
  const flat = useMemo(() => [...recent, ...rest], [recent, rest]);

  useEffect(() => setActiveIndex(0), [normalized, schemes]);

  const pick = async (scheme: DesignSchemeSummary) => {
    const current = useGenerationWorkbenchStore.getState().draftSource;
    const previous = current.kind === 'scheme' && current.schemeId !== scheme.id ? current : null;
    onClose();
    const attached = await attach(scheme, 'formal');
    // 替换另一个方案时给出可撤销提示（§6.1）。
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
              // 选择器只处理运行附件；修改附件不会出现在这里，兜底回落正式使用。
              if (prevSummary) void attach(prevSummary, previous.mode === 'modify' ? 'formal' : previous.mode);
            });
          },
        },
      });
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
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
          {scheme.coverImagePath
            ? <img src={toImageSrc(scheme.coverImagePath)} alt="" className="h-full w-full object-contain" />
            : <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-background"><Blocks className="h-3.5 w-3.5" /></span>}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium text-primary">{scheme.name}</span>
          <span className="mt-0.5 block truncate text-meta text-tertiary">{scheme.summary || scheme.sourceLabel}</span>
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
        <button type="button" onClick={onClose} className="icon-action h-7 w-7" aria-label="关闭方案选择"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-1.5">
        {!schemes && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-meta text-tertiary"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在读取方案…</div>
        )}
        {error && <p className="px-3 py-6 text-center text-meta text-danger">{error}</p>}
        {schemes && flat.length === 0 && (
          <div className="px-3 py-8 text-center">
            <p className="text-meta text-tertiary">{normalized ? '没有匹配的正式方案' : '还没有正式方案；草稿完成试运行并设为正式后会出现在这里。'}</p>
            <button
              type="button"
              onClick={() => { onClose(); useAppStore.getState().requestSchemeCenter({ surface: 'discover' }); }}
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
            {(recent.length > 0 || !normalized) && <p className="px-2 pb-1 pt-1.5 text-meta font-medium text-tertiary">我的方案</p>}
            {rest.map(renderRow)}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={() => { onClose(); useAppStore.getState().requestSchemeCenter({ surface: 'mine' }); }}
        className="flex min-h-10 w-full items-center gap-2 border-t border-border-subtle px-3 text-meta text-secondary hover:bg-hover hover:text-primary"
        data-testid="scheme-run-picker-browse"
      >
        <Blocks className="h-3.5 w-3.5" />浏览全部方案
      </button>
    </div>
  );
}
