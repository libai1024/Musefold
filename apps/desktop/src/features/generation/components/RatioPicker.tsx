import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from '../../../components/ui/icons';
import {
  parseCustomRatioId,
  RATIO_OPTIONS,
  resolveRatioOptionById,
  type RatioOption,
} from '@musefold/domain/constants';
import { cn } from '../../../lib/utils';

function ratioShape(option: RatioOption, maxSize = 32, minSize = 10): { width: number; height: number } {
  const [width, height] = option.ratio.split(':').map(Number);
  const ratio = width > 0 && height > 0 ? width / height : 1;
  if (ratio >= 1) return { width: maxSize, height: Math.max(minSize, Math.round(maxSize / ratio)) };
  return { width: Math.max(minSize, Math.round(maxSize * ratio)), height: maxSize };
}

export function resolveRatioOption(value: string): RatioOption {
  return resolveRatioOptionById(value);
}

/** 展示用 id：自定义选项显示 `W:H` 而不是内部的 `custom:W:H` */
function ratioDisplayId(option: RatioOption): string {
  return option.id.startsWith('custom:') ? option.ratio : option.id;
}

function formatRatioSize(size: RatioOption['size']) {
  return size === 'auto' ? 'auto' : size.replace('x', '×');
}

function ratioGridClass(columns: 'two' | 'three') {
  return columns === 'three' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2';
}

function ratioTone(option: RatioOption): string {
  if (option.id === 'auto') return option.hint ?? '由模型决定';
  return `${option.ratio} · ${formatRatioSize(option.size)}`;
}

export function RatioPreview({
  option,
  className,
  size = 'md',
  testId,
}: {
  option: RatioOption;
  className?: string;
  size?: 'sm' | 'md' | 'card' | 'lg' | 'xl';
  testId?: string;
}) {
  const dimensions = {
    sm: { max: 26, min: 9 },
    md: { max: 32, min: 10 },
    card: { max: 46, min: 14 },
    lg: { max: 40, min: 13 },
    xl: { max: 66, min: 18 },
  }[size];
  const shape = ratioShape(
    option,
    dimensions.max,
    dimensions.min,
  );
  const auto = option.id === 'auto';
  return (
    <span
      aria-hidden="true"
      data-ratio={option.id}
      data-testid={testId}
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-xs border-[1.5px] border-current/80 bg-inset',
        auto && 'border-dashed',
        className,
      )}
      style={{ width: shape.width, height: shape.height }}
    >
      {auto ? (
        <span className="h-1 w-1 rounded-full bg-current/70" />
      ) : null}
    </span>
  );
}

export function RatioSelectionPreview({
  option,
  label = '当前比例',
  className,
  testIdPrefix,
  compact = false,
}: {
  option: RatioOption;
  label?: string;
  className?: string;
  testIdPrefix?: string;
  compact?: boolean;
}) {
  const sizeText = formatRatioSize(option.size);
  return (
    <div
      className={cn(
        'grid min-w-0 items-center rounded-md',
        compact
          ? 'grid-cols-[48px_minmax(0,1fr)] gap-2 bg-inset/25 px-2 py-1.5'
          : 'grid-cols-[94px_minmax(0,1fr)] gap-3 border border-border-subtle bg-inset/35 p-2.5',
        className,
      )}
      data-testid={testIdPrefix ? `${testIdPrefix}` : undefined}
      data-ratio={option.id}
      data-ratio-size={formatRatioSize(option.size)}
    >
      <span className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-inset/70',
        compact ? 'h-10 w-12' : 'h-[72px] w-[94px]',
      )}>
        <RatioPreview
          option={option}
          size={compact ? 'md' : 'xl'}
          className="text-accent/90"
          testId={testIdPrefix ? `${testIdPrefix}-preview` : undefined}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-meta font-medium text-tertiary">{label}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-primary">{ratioDisplayId(option)}</span>
          <span className="truncate text-[11px] text-secondary">{option.label}</span>
        </span>
        <span className="mt-1 block truncate font-mono text-meta text-quaternary">
          {option.id === 'auto' ? option.hint ?? '由模型决定' : sizeText}
        </span>
      </span>
    </div>
  );
}

export function RatioOptionGrid({
  value,
  onChange,
  testIdPrefix,
  className,
  itemClassName,
  columns = 'three',
  label = '图片比例',
  autoFocusSelected = false,
  onEscape,
  variant = 'cards',
}: {
  value: string;
  onChange: (value: string) => void;
  testIdPrefix?: string;
  className?: string;
  itemClassName?: string;
  columns?: 'two' | 'three';
  label?: string;
  autoFocusSelected?: boolean;
  onEscape?: () => void;
  variant?: 'cards' | 'rows' | 'compact-cards';
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, RATIO_OPTIONS.findIndex((option) => option.id === value));

  useEffect(() => {
    if (!autoFocusSelected) return;
    optionRefs.current[selectedIndex]?.focus();
  }, [autoFocusSelected, selectedIndex]);

  const focusOption = (index: number) => {
    const nextIndex = (index + RATIO_OPTIONS.length) % RATIO_OPTIONS.length;
    optionRefs.current[nextIndex]?.focus();
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(RATIO_OPTIONS.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onEscape?.();
    }
  };

  return (
    <div
      role="listbox"
      aria-label={label}
      className={cn('grid gap-1.5', ratioGridClass(columns), className)}
    >
      {RATIO_OPTIONS.map((option, index) => {
        const active = option.id === value;
        return (
          <RatioCard
            key={option.id}
            option={option}
            active={active}
            onSelect={onChange}
            testId={testIdPrefix ? `${testIdPrefix}-${option.id}` : undefined}
            previewTestId={testIdPrefix ? `${testIdPrefix}-${option.id}-preview` : undefined}
            buttonRef={(element) => { optionRefs.current[index] = element; }}
            tabIndex={active ? 0 : -1}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
            className={itemClassName}
            variant={variant}
          />
        );
      })}
    </div>
  );
}

function RatioCard({
  option,
  active,
  onSelect,
  className,
  previewTestId,
  testId,
  buttonRef,
  tabIndex,
  onKeyDown,
  variant = 'cards',
}: {
  option: RatioOption;
  active: boolean;
  onSelect: (value: string) => void;
  className?: string;
  previewTestId?: string;
  testId?: string;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  tabIndex?: number;
  onKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  variant?: 'cards' | 'rows' | 'compact-cards';
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-label={`${option.id}，${option.label}，${ratioTone(option)}`}
      data-active={active ? 'true' : 'false'}
      data-testid={testId}
      data-ratio-id={option.id}
      data-ratio-size={formatRatioSize(option.size)}
      ref={buttonRef}
      tabIndex={tabIndex}
      onClick={() => onSelect(option.id)}
      onKeyDown={onKeyDown}
      className={cn(
        'no-drag relative min-w-0 overflow-hidden rounded-md border text-left transition-[border-color,background-color] duration-[var(--dur-fast)] ease-out hover:border-border-default hover:bg-hover focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25',
        variant === 'rows'
          ? 'flex h-11 items-center gap-2 px-2'
          : variant === 'compact-cards'
            ? 'flex h-[84px] flex-col items-center justify-between px-1.5 py-1.5 text-center'
            : 'flex h-[108px] flex-col items-center justify-between px-2 py-2 text-center',
        active
          ? 'border-accent/40 bg-accent-soft/70 text-accent'
          : 'border-transparent bg-transparent text-secondary',
        className,
      )}
      title={`${option.id} ${option.label} ${ratioTone(option)}`}
    >
      <span className={cn(
        'pointer-events-none flex items-center justify-center overflow-hidden rounded-md bg-inset/70',
        variant === 'rows' ? 'h-8 w-10 shrink-0' : variant === 'compact-cards' ? 'h-11 w-full' : 'h-14 w-full',
        active && 'bg-elevated/70',
      )}>
        <RatioPreview
          option={option}
          size={variant === 'rows' ? 'md' : variant === 'compact-cards' ? 'md' : 'card'}
          className={active ? 'text-accent' : 'text-tertiary'}
          testId={previewTestId}
        />
      </span>
      <span className={cn(
        'pointer-events-none min-w-0',
        variant === 'rows'
          ? 'flex flex-1 items-baseline gap-1.5'
          : variant === 'compact-cards'
            ? 'grid min-h-[28px] w-full grid-rows-[14px_14px] place-items-center'
            : 'grid min-h-[30px] w-full grid-rows-[14px_14px_12px] place-items-center',
      )}>
        <span className={cn('block text-[12px] font-semibold leading-[14px] tabular-nums text-primary', variant !== 'rows' && 'w-full text-center')}>
          {option.id}
        </span>
        <span className={cn('block truncate whitespace-nowrap text-meta font-medium leading-[14px]', variant !== 'rows' && 'w-full text-center', active ? 'text-secondary' : 'text-quaternary')}>
          {option.label}
        </span>
        <span className={cn('truncate font-mono text-meta leading-[12px] text-quaternary', variant === 'cards' ? 'block w-full text-center' : 'sr-only')}>
          {option.id === 'auto' ? '模型决定' : formatRatioSize(option.size)}
        </span>
      </span>
      {active && (
        <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[color:var(--on-accent)]">
          <Check className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}

export function RatioPicker({
  value,
  onChange,
  testIdPrefix,
  className,
  side = 'top',
  align = 'start',
  menuColumns = 'three',
  variant = 'default',
}: {
  value: string;
  onChange: (value: string) => void;
  testIdPrefix?: string;
  className?: string;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  menuColumns?: 'two' | 'three';
  variant?: 'default' | 'compact';
}) {
  const [open, setOpen] = useState(false);
  const pickerId = useId().replace(/:/g, '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = resolveRatioOption(value);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openMenu = () => {
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (option: RatioOption) => {
    onChange(option.id);
    close(true);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? pickerId : undefined}
        aria-label={`图片比例：${selected.id} ${selected.label}`}
        data-value={selected.id}
        data-testid={testIdPrefix ? `${testIdPrefix}-trigger` : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (!open) openMenu();
          }
        }}
        className={cn(
          'no-drag flex items-center rounded-lg border text-left text-xs text-primary transition-[border-color,background-color,box-shadow] hover:border-border-default hover:bg-hover focus-visible:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 data-[open=true]:border-accent/50 data-[open=true]:bg-accent-soft',
          variant === 'compact'
            ? 'h-8 w-full min-w-0 gap-1.5 border-border-subtle bg-elevated px-2 shadow-none'
            : 'h-10 min-w-[160px] w-full gap-2 border-border-subtle bg-elevated px-2.5 sm:w-auto',
        )}
        data-open={open ? 'true' : 'false'}
      >
        {variant === 'compact' ? (
          <>
            <RatioPreview option={selected} size="sm" className="shrink-0 text-accent" testId={testIdPrefix ? `${testIdPrefix}-selected-preview` : undefined} />
            <span className="min-w-0 truncate font-mono text-[11px] font-medium tabular-nums">{ratioDisplayId(selected)}</span>
          </>
        ) : (
          <>
            <span className="relative flex h-7 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xs border border-border-subtle bg-inset/70">
              <RatioPreview option={selected} size="sm" className="text-accent" testId={testIdPrefix ? `${testIdPrefix}-selected-preview` : undefined} />
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block text-meta font-medium text-tertiary">图片比例</span>
              <span className="block truncate font-semibold">{ratioDisplayId(selected)} · {selected.label}</span>
            </span>
            <span className="font-mono text-meta text-tertiary max-[440px]:hidden">
              {formatRatioSize(selected.size)}
            </span>
          </>
        )}
        <ChevronDown className={cn('ml-auto h-3 w-3 shrink-0 text-tertiary transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          id={pickerId}
          role="dialog"
          aria-label="图片比例"
          className={cn(
            'absolute z-50 rounded-lg border border-border-subtle bg-popover p-2 shadow-pop animate-scale-fade-in',
            variant === 'compact'
              ? 'w-[min(368px,calc(100vw-24px))]'
              : 'w-[min(320px,calc(100vw-24px))]',
            'max-h-[470px] overflow-y-auto',
            variant === 'compact'
              ? 'left-0 max-[640px]:fixed max-[640px]:bottom-[68px] max-[640px]:left-1/2 max-[640px]:right-auto max-[640px]:-translate-x-1/2'
              : align === 'end' ? 'right-0' : 'left-0 max-[640px]:left-auto max-[640px]:right-0',
            side === 'top' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]',
          )}
          data-testid={testIdPrefix ? `${testIdPrefix}-menu` : undefined}
        >
          <div className="mb-2 flex h-7 items-center justify-between gap-2 px-1">
            <span className="text-[11px] font-semibold text-primary">图片比例</span>
            <span className="pt-0.5 font-mono text-meta text-quaternary">{ratioTone(selected)}</span>
          </div>
          {variant !== 'compact' && (
            <RatioSelectionPreview
              option={selected}
              label="当前选择"
              className="mb-2"
              testIdPrefix={testIdPrefix ? `${testIdPrefix}-menu-summary` : undefined}
            />
          )}
          <RatioOptionGrid
            value={selected.id}
            onChange={(next) => choose(resolveRatioOption(next))}
            testIdPrefix={testIdPrefix}
            columns={variant === 'compact' ? 'three' : menuColumns}
            autoFocusSelected
            onEscape={() => close(true)}
            variant={variant === 'compact' ? 'compact-cards' : 'cards'}
          />
          <CustomRatioRow
            selected={selected}
            testIdPrefix={testIdPrefix}
            onApply={(id) => choose(resolveRatioOption(id))}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 自定义比例行（v0.3.x）：W:H 两个整数输入，限制 1:4 ~ 4:1。
 * 设置「默认比例」与 Composer 画幅共用本弹层，改一处两边生效。
 */
function CustomRatioRow({
  selected,
  testIdPrefix,
  onApply,
}: {
  selected: RatioOption;
  testIdPrefix?: string;
  onApply: (id: string) => void;
}) {
  const parsed = parseCustomRatioId(selected.id);
  const isCustom = parsed !== null;
  const [w, setW] = useState(parsed ? String(parsed.w) : '');
  const [h, setH] = useState(parsed ? String(parsed.h) : '');
  const [touched, setTouched] = useState(false);
  const candidate = w.trim() && h.trim() ? `custom:${w.trim()}:${h.trim()}` : '';
  const valid = candidate !== '' && parseCustomRatioId(candidate) !== null;

  const apply = () => {
    setTouched(true);
    if (valid) onApply(candidate);
  };

  const inputClass =
    'no-drag h-7 w-11 rounded-md border border-border-subtle bg-elevated text-center font-mono text-[11px] tabular-nums text-primary outline-none transition-colors placeholder:text-quaternary hover:border-border-default focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25';

  return (
    <div className="mt-2 border-t border-border-subtle pt-2">
      <div className="flex items-center gap-1.5 px-1">
        <span className={cn('flex-1 text-meta font-medium', isCustom ? 'text-primary' : 'text-tertiary')}>
          自定义
          {isCustom && <Check className="ml-1 inline h-3 w-3 text-primary" aria-hidden="true" />}
        </span>
        <input
          value={w}
          onChange={(event) => setW(event.target.value.replace(/\D/g, '').slice(0, 2))}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
          placeholder="16"
          inputMode="numeric"
          aria-label="自定义比例宽"
          data-testid={testIdPrefix ? `${testIdPrefix}-custom-w` : undefined}
          className={inputClass}
        />
        <span className="text-[11px] text-tertiary">:</span>
        <input
          value={h}
          onChange={(event) => setH(event.target.value.replace(/\D/g, '').slice(0, 2))}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }}
          placeholder="10"
          inputMode="numeric"
          aria-label="自定义比例高"
          data-testid={testIdPrefix ? `${testIdPrefix}-custom-h` : undefined}
          className={inputClass}
        />
        <button
          type="button"
          onClick={apply}
          disabled={!candidate}
          data-testid={testIdPrefix ? `${testIdPrefix}-custom-apply` : undefined}
          className={cn(
            'no-drag rounded-sm border px-2.5 py-1 text-meta font-medium transition-colors disabled:pointer-events-none disabled:opacity-45',
            valid
              ? 'border-transparent bg-primary text-background hover:opacity-85'
              : 'border-border-subtle bg-transparent text-secondary hover:border-border-default hover:text-primary',
          )}
        >
          应用
        </button>
      </div>
      {touched && candidate !== '' && !valid && (
        <p
          role="alert"
          className="mt-1 px-1 text-meta text-danger"
          data-testid={testIdPrefix ? `${testIdPrefix}-custom-error` : undefined}
        >
          比例需在 1:4 与 4:1 之间（两端为 1–99 的整数）
        </p>
      )}
      <p className="mt-1 px-1 text-meta leading-relaxed text-quaternary">
        OpenAI 档位就近取 1024/1536 像素档
      </p>
    </div>
  );
}
