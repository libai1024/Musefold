'use client';

import type {
  GenerationQuality,
  GenerationReferenceImage,
  ProviderOption,
  WorkbenchDraft,
} from '@musefold/contracts';
import { Button } from '@musefold/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@musefold/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@musefold/ui/components/dropdown-menu';
import { Label } from '@musefold/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@musefold/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@musefold/ui/components/select';
import { Spinner } from '@musefold/ui/components/spinner';
import { Textarea } from '@musefold/ui/components/textarea';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ImagePlus,
  Plus,
  SlidersHorizontal,
  Square,
  X,
} from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import {
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
} from 'react';

/**
 * 比例目录承旧 v2.1 domain RATIO_OPTIONS 全集(11 档,auto 殿后);
 * 自定义比例仍暂缓(V25-UI-SPEC §9-D7)。detail 只对 auto 有意义:
 * v2.5 统一发 size:'auto',预设不再承诺具体像素档。
 */
const RATIO_CATALOG = [
  { id: '1:1', label: '方图' },
  { id: '2:3', label: '竖版' },
  { id: '3:4', label: '竖图' },
  { id: '3:2', label: '横版' },
  { id: '4:3', label: '横图' },
  { id: '4:5', label: '商品竖图' },
  { id: '5:4', label: '商品横图' },
  { id: '9:16', label: '手机竖屏' },
  { id: '16:9', label: '宽屏' },
  { id: '21:9', label: '超宽屏' },
  { id: 'auto', label: '自动', detail: '由模型决定' },
] as const;

type RatioCatalogEntry = (typeof RATIO_CATALOG)[number];
export type ComposerRatio = RatioCatalogEntry['id'];

const RATIO_IDS = RATIO_CATALOG.map((option) => option.id) as readonly string[];

/** 契约限长(contracts createGenerationInputSchema.prompt);≥90% 时显示计数。 */
const PROMPT_MAX = 12_000;
const PROMPT_COUNTER_THRESHOLD = PROMPT_MAX * 0.9;

/** 质量档文案承旧 v2.1 WORKBENCH_QUALITY_OPTIONS(枚举值不变,只还原命名)。 */
const QUALITY_OPTIONS: readonly { id: GenerationQuality; label: string; hint: string }[] = [
  { id: 'auto', label: '自动', hint: '模型默认' },
  { id: 'low', label: '标准', hint: '更快' },
  { id: 'medium', label: '高清', hint: '平衡' },
  { id: 'high', label: '超清', hint: '细节优先' },
];

function qualityLabel(quality: GenerationQuality): string {
  return QUALITY_OPTIONS.find((option) => option.id === quality)?.label ?? quality;
}

export interface ComposerValue {
  prompt: string;
  negative: string;
  aspectRatio: ComposerRatio;
  quality: GenerationQuality;
  providerId: string | null;
}

/** 参考图接受的文件类型(输入过滤;最终由宿主嗅探魔数把关)。 */
export const REFERENCE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const REFERENCE_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** 草稿参考图行:上传前后 key 稳定,previewUrl 是屏幕层负责回收的 objectURL。 */
export interface ComposerReference {
  key: string;
  status: 'uploading' | 'ready';
  name: string;
  previewUrl: string;
  image?: GenerationReferenceImage;
}

/** 从 DataTransfer/FileList 过滤出可作参考图的文件(拖拽/粘贴/选择三路共用)。 */
export function filterReferenceFiles(files: Iterable<File>): File[] {
  return [...files].filter((file) => REFERENCE_IMAGE_MIMES.has(file.type));
}

export function toComposerRatio(value: string | undefined): ComposerRatio {
  return RATIO_IDS.includes(value ?? '') ? (value as ComposerRatio) : 'auto';
}

export function draftToComposerValue(draft: WorkbenchDraft): ComposerValue {
  return {
    prompt: draft.prompt,
    negative: draft.negative,
    aspectRatio: toComposerRatio(draft.params.aspectRatio),
    quality: draft.params.quality ?? 'auto',
    providerId: null,
  };
}

export function composerValueToDraft(value: ComposerValue): WorkbenchDraft {
  return {
    prompt: value.prompt,
    negative: value.negative,
    params: {
      ...(value.aspectRatio !== 'auto' ? { aspectRatio: value.aspectRatio } : {}),
      ...(value.quality !== 'auto' ? { quality: value.quality } : {}),
    },
    promptReferenceIds: [],
  };
}

/** 占位语分支承旧 workbenchComposerPlaceholder:空会话引导生成,有回合引导迭代。 */
function composerPlaceholder(hasTurns: boolean): string {
  return hasTurns ? '描述下一步调整…' : '描述你想生成的图片…';
}

/** 比例形状预览(承旧 ratioShape):26px 基准边,auto 为虚线方框 + 中心点。 */
function ratioShape(ratioId: string): { width: number; height: number } {
  const [width, height] = ratioId.split(':').map(Number);
  const ratio = width > 0 && height > 0 ? width / height : 1;
  if (ratio >= 1) return { width: 26, height: Math.max(9, Math.round(26 / ratio)) };
  return { width: Math.max(9, Math.round(26 * ratio)), height: 26 };
}

function RatioPreview({ option, className }: { option: RatioCatalogEntry; className?: string }) {
  const auto = option.id === 'auto';
  const shape = ratioShape(auto ? '1:1' : option.id);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[3px] border-[1.5px] border-current text-primary',
        auto && 'border-dashed',
        className,
      )}
      style={{ width: shape.width, height: shape.height }}
    >
      {auto ? <span className="size-1 rounded-full bg-current" /> : null}
    </span>
  );
}

/** 工具条触发钮共用几何(承旧 mf-workbench-ratio/generation-trigger:32px 高、11px 字号)。 */
const TOOLBAR_TRIGGER_CLASS =
  'flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] text-muted-foreground transition-colors duration-(--dur-fast) ease-out hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45 data-[state=open]:border-border data-[state=open]:bg-accent data-[state=open]:text-foreground';

export interface ComposerProps {
  value: ComposerValue;
  providers: readonly ProviderOption[];
  submitting: boolean;
  disabled?: boolean;
  /**
   * 布局形态(V25-UI-SPEC §3.1):docked 悬浮贴底(默认,由屏幕层绝对定位);
   * inline 用于空态内联,首次发送后由屏幕切回 docked。
   */
  variant?: 'docked' | 'inline';
  /** 会话有回合时占位语切「描述下一步调整…」(承旧 placeholder 分支)。 */
  hasTurns?: boolean;
  /** 会话存在进行中任务:提交钮变「停止生成」(§3.2 状态互斥,承旧提交钮语义)。 */
  running?: boolean;
  /** 取消请求已发出、等待终态:停止钮转 spinner 并禁用。 */
  cancelling?: boolean;
  /** Provider 目录已加载且为空:发送禁用 + 引导去设置(§3.2 无连接态)。 */
  noProvider?: boolean;
  /** 草稿参考图(ui-parity 03 §7 P0):三路入图(选择/拖拽/粘贴)落这里,提交时随请求携带。 */
  references?: readonly ComposerReference[];
  /** 提示词 textarea 引用:回填路径(编辑消息/建议点击)聚焦置尾用(03 §6 焦点管理)。 */
  promptRef?: Ref<HTMLTextAreaElement>;
  onChange(value: ComposerValue): void;
  onSubmit(): void;
  onCancel?(): void;
  /** 三路入图汇聚点:文件已按 png/jpg/webp 过滤,上传与限数由屏幕层处理。 */
  onAddImages?(files: File[]): void;
  onRemoveReference?(key: string): void;
  /** 无连接引导「前往设置」的切屏回调(宿主注入)。 */
  onOpenSettings?(): void;
}

/**
 * 生成输入区(V25-UI-SPEC §3.2,几何与交互承旧 v2.1 WorkbenchComposer):
 * 728px 居中悬浮卡片(浮起阴影 + 轻透底 + 毛玻璃),提示词区上、工具条下(细分缝);
 * 工具条 = 「+」/ 比例(形状预览 + 网格菜单)/ 设置(值摘要触发)/ Provider / 36px 圆形发送钮。
 * 运行中边框转品牌色 30%,拖拽入图时点亮 accent 虚线罩。
 */
export function Composer({
  value,
  providers,
  submitting,
  disabled = false,
  variant = 'docked',
  hasTurns = false,
  running = false,
  cancelling = false,
  noProvider = false,
  references = [],
  promptRef,
  onChange,
  onSubmit,
  onCancel,
  onAddImages,
  onRemoveReference,
  onOpenSettings,
}: ComposerProps) {
  const [ratioOpen, setRatioOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 拖拽深度计数:子元素间的 enter/leave 会成对出现,归零才算真正离开。
  const [dragDepth, setDragDepth] = useState(0);
  const [previewReference, setPreviewReference] = useState<ComposerReference | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ratioOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const uploadingReferences = references.some((reference) => reference.status === 'uploading');
  const canSubmit =
    !disabled &&
    !submitting &&
    !running &&
    !noProvider &&
    !uploadingReferences &&
    value.prompt.trim().length > 0;
  const promptLength = value.prompt.length;
  const canAddImages = Boolean(onAddImages) && !disabled;
  const selectedRatio =
    RATIO_CATALOG.find((option) => option.id === value.aspectRatio) ??
    RATIO_CATALOG[RATIO_CATALOG.length - 1];
  const selectedRatioIndex = RATIO_CATALOG.findIndex((option) => option.id === selectedRatio.id);
  const negativeActive = value.negative.trim().length > 0;

  // Esc 停止生成(承旧窗口级快捷键):Radix 浮层关闭会 preventDefault,已让位。
  useEffect(() => {
    if (!running || cancelling || !onCancel) return;
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      onCancel?.();
    }
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [running, cancelling, onCancel]);

  function hasFileDrag(event: DragEvent): boolean {
    return [...event.dataTransfer.types].includes('Files');
  }

  function handleDrop(event: DragEvent) {
    if (!canAddImages || !hasFileDrag(event)) return;
    event.preventDefault();
    setDragDepth(0);
    const files = filterReferenceFiles(event.dataTransfer.files);
    if (files.length > 0) onAddImages?.(files);
  }

  /** 比例网格键盘巡航(承旧):左右/上下 ±1 环绕,Home/End 到端点。 */
  function handleRatioOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const count = RATIO_CATALOG.length;
    const focusOption = (next: number) => {
      ratioOptionRefs.current[(next + count) % count]?.focus();
    };
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
      focusOption(count - 1);
    }
  }

  return (
    <div
      className={cn('w-full', variant === 'docked' && 'pointer-events-none')}
      data-testid="composer"
      data-variant={variant}
    >
      <div
        className={cn(
          'pointer-events-auto relative mx-auto flex w-full max-w-[728px] flex-col border bg-card/90 shadow-composer backdrop-blur-xl',
          'transition-[border-color,background-color,box-shadow] duration-(--dur-fast) ease-out',
          variant === 'inline'
            ? 'rounded-2xl px-3.5 pt-3 pb-2.5 md:rounded-[20px] dark:border-border/60'
            : 'rounded-xl px-3 pt-2.5 pb-2',
          running && 'border-primary/30',
          dragDepth > 0 && 'border-primary bg-popover/95 shadow-pop',
        )}
        onDragEnter={(event) => {
          if (!canAddImages || !hasFileDrag(event)) return;
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragOver={(event) => {
          if (!canAddImages || !hasFileDrag(event)) return;
          event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!canAddImages || !hasFileDrag(event)) return;
          setDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDrop={handleDrop}
      >
        {dragDepth > 0 && (
          <div
            className={cn(
              'pointer-events-none absolute inset-1 z-10 flex items-center justify-center border border-primary/55 border-dashed bg-popover/90',
              variant === 'inline' ? 'rounded-[18px]' : 'rounded-[10px]',
            )}
            data-testid="composer-drop-overlay"
          >
            <p className="font-medium text-primary text-xs">松开以添加参考图</p>
          </div>
        )}

        {references.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5" data-testid="composer-references">
            {references.map((reference) => (
              <span
                key={reference.key}
                className="group/chip flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/60 py-0 pr-1 pl-1 text-xs"
                data-testid="composer-reference"
                data-status={reference.status}
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5"
                  onClick={() => setPreviewReference(reference)}
                  aria-label={`预览参考图 ${reference.name}`}
                >
                  <img
                    src={reference.previewUrl}
                    alt=""
                    className="size-4 shrink-0 rounded-sm object-cover"
                  />
                  <span className="max-w-32 truncate text-muted-foreground">{reference.name}</span>
                </button>
                {reference.status === 'uploading' ? (
                  <Spinner className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <button
                    type="button"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground group-hover/chip:opacity-100"
                    onClick={() => onRemoveReference?.(reference.key)}
                    aria-label={`移除参考图 ${reference.name}`}
                    data-testid="composer-reference-remove"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <Textarea
          ref={promptRef}
          value={value.prompt}
          placeholder={composerPlaceholder(hasTurns)}
          rows={3}
          maxLength={PROMPT_MAX}
          data-testid="composer-prompt"
          className="max-h-[180px] min-h-[76px] resize-none border-0 bg-transparent px-1.5 pt-1.5 pb-0.5 text-[16px] leading-[1.55] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0 md:text-[13px] dark:bg-transparent"
          onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          onKeyDown={(event) => {
            // IME 组合期(含 keyCode 229 兜底)不截获 Enter,避免吞候选确认。
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey || !event.shiftKey)) {
              event.preventDefault();
              if (canSubmit) onSubmit();
              return;
            }
            // 输入为空时 Backspace 弹出最后一张参考图(chip 解剖,ui-parity 03-C2)。
            if (event.key === 'Backspace' && value.prompt.length === 0 && references.length > 0) {
              const last = references[references.length - 1];
              if (last && last.status === 'ready') {
                event.preventDefault();
                onRemoveReference?.(last.key);
              }
            }
          }}
          onPaste={(event) => {
            if (!canAddImages) return;
            const files = filterReferenceFiles(
              [...event.clipboardData.items]
                .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
                .filter((file): file is File => file !== null),
            );
            if (files.length > 0) {
              event.preventDefault();
              onAddImages?.(files);
            }
          }}
        />

        {noProvider && (
          <p
            className="flex items-center gap-1 px-1.5 pt-1 text-muted-foreground text-xs"
            data-testid="composer-no-provider"
          >
            尚未配置可用的 AI 连接,
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={onOpenSettings}
              disabled={!onOpenSettings}
            >
              前往设置添加
            </button>
          </p>
        )}

        <div className="mt-1 flex min-h-10 flex-wrap items-center gap-1 border-border/55 border-t pt-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept={REFERENCE_IMAGE_ACCEPT}
            multiple
            className="hidden"
            data-testid="composer-file-input"
            onChange={(event) => {
              const files = filterReferenceFiles(event.target.files ?? []);
              if (files.length > 0) onAddImages?.(files);
              event.target.value = '';
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-[7px] text-muted-foreground"
                disabled={!canAddImages}
                title="添加内容"
                aria-label="添加内容"
                data-testid="composer-attach"
              >
                <Plus className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => fileInputRef.current?.click()}
                data-testid="composer-attach-image"
              >
                <ImagePlus className="size-4" /> 添加图片
                <span className="ml-auto pl-3 text-[11px] text-muted-foreground">可拖入或粘贴</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover open={ratioOpen} onOpenChange={setRatioOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(TOOLBAR_TRIGGER_CLASS, 'min-w-[90px] border-border/55 bg-card/50')}
                title="图片比例"
                aria-label={`图片比例:${selectedRatio.id} ${selectedRatio.label}`}
                data-testid="composer-ratio"
              >
                <RatioPreview option={selectedRatio} />
                <span className="min-w-0 truncate font-medium font-mono">{selectedRatio.id}</span>
                <ChevronDown
                  className="ml-auto size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-[368px] max-w-[calc(100vw-24px)] p-2"
              onOpenAutoFocus={(event) => {
                // 承旧:打开即聚焦当前选中项,方向键从当前值继续巡航。
                event.preventDefault();
                requestAnimationFrame(() => {
                  ratioOptionRefs.current[selectedRatioIndex]?.focus();
                });
              }}
            >
              <div className="flex h-7 items-center justify-between gap-3 px-1.5">
                <strong className="font-semibold text-[11px] text-foreground">图片比例</strong>
                <span className="truncate font-mono text-[11px] text-muted-foreground/80">
                  {'detail' in selectedRatio ? selectedRatio.detail : selectedRatio.label}
                </span>
              </div>
              <div
                className="mt-1 grid grid-cols-3 gap-1.5"
                role="listbox"
                aria-label="图片比例"
                data-testid="composer-ratio-grid"
              >
                {RATIO_CATALOG.map((option, index) => {
                  const active = option.id === selectedRatio.id;
                  return (
                    <button
                      key={option.id}
                      ref={(element) => {
                        ratioOptionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={active}
                      aria-label={`${option.id},${option.label}`}
                      tabIndex={active ? 0 : -1}
                      data-testid={`composer-ratio-${option.id.replace(':', 'x')}`}
                      className={cn(
                        'relative flex h-[84px] min-w-0 flex-col items-center justify-between rounded-lg border border-border/55 p-2 font-mono text-[11px] text-muted-foreground transition-colors duration-(--dur-fast) ease-out',
                        'hover:border-border hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/45',
                        active && 'border-primary/55 bg-accent text-foreground',
                      )}
                      onClick={() => {
                        onChange({ ...value, aspectRatio: option.id });
                        setRatioOpen(false);
                      }}
                      onKeyDown={(event) => handleRatioOptionKeyDown(event, index)}
                    >
                      <RatioPreview option={option} className="mt-1" />
                      <span>{option.id}</span>
                      <small className="max-w-full truncate font-mono text-[11px] text-muted-foreground">
                        {option.label}
                      </small>
                      {active && (
                        <Check className="absolute top-1.5 right-1.5 size-3 text-primary" />
                      )}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(TOOLBAR_TRIGGER_CLASS, 'max-w-32 border-transparent')}
                title="生成设置"
                aria-label="生成设置"
                data-testid="composer-settings"
              >
                <SlidersHorizontal
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 truncate">
                  {qualityLabel(value.quality)}
                  {negativeActive ? ' · 反向词' : ''}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              sideOffset={8}
              className="w-[304px] max-w-[calc(100vw-24px)] p-2"
            >
              <div className="flex h-7 items-center justify-between px-1.5">
                <strong className="font-semibold text-[11px] text-foreground">生成设置</strong>
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-accent hover:text-foreground"
                  aria-label="关闭生成设置"
                  onClick={() => setSettingsOpen(false)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div className="px-1 pt-1.5">
                <p className="mb-1 text-[11px] text-muted-foreground">质量</p>
                <div
                  className="grid grid-cols-4 gap-1 rounded-[7px] bg-muted p-1"
                  role="radiogroup"
                  aria-label="质量"
                  data-testid="composer-quality"
                >
                  {QUALITY_OPTIONS.map((option) => {
                    const active = option.id === value.quality;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={option.hint}
                        data-testid={`composer-quality-${option.id}`}
                        className={cn(
                          'h-8 min-w-0 rounded-md text-[11px] text-muted-foreground transition-colors duration-(--dur-fast) ease-out hover:bg-card hover:text-primary',
                          active && 'bg-card text-primary shadow-sm',
                        )}
                        onClick={() => onChange({ ...value, quality: option.id })}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-1 px-1 pt-2 pb-1">
                <Label className="text-[11px] text-muted-foreground" htmlFor="composer-negative">
                  反向提示词
                </Label>
                <Textarea
                  id="composer-negative"
                  value={value.negative}
                  placeholder="不希望出现的元素…"
                  rows={2}
                  data-testid="composer-negative"
                  className="max-h-24 min-h-14 border-border/55 bg-card text-[16px] leading-normal md:text-xs"
                  onChange={(event) => onChange({ ...value, negative: event.target.value })}
                />
              </div>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex items-center gap-1.5 pl-1">
            {promptLength >= PROMPT_COUNTER_THRESHOLD && (
              <span
                className="font-mono text-[11px] text-muted-foreground tabular-nums"
                data-testid="composer-prompt-count"
              >
                {promptLength}/{PROMPT_MAX}
              </span>
            )}

            {providers.length > 0 && (
              <Select
                value={value.providerId ?? providers[0]?.id}
                onValueChange={(next) => onChange({ ...value, providerId: next })}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-auto max-w-40 gap-1 rounded-lg border-border/55 text-[11px] text-muted-foreground shadow-none hover:text-foreground"
                  data-testid="composer-provider"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem
                      key={provider.id}
                      value={provider.id}
                      disabled={!provider.available}
                    >
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {running ? (
              <Button
                size="icon"
                className="size-9 rounded-full bg-foreground text-background shadow-sm transition-[transform,background-color,opacity] duration-(--dur-fast) ease-(--ease-spring) hover:-translate-y-px hover:bg-foreground/90 active:translate-y-px active:scale-[0.96]"
                disabled={cancelling || !onCancel}
                onClick={onCancel}
                aria-label={cancelling ? '正在取消' : '停止生成'}
                title={cancelling ? '正在取消' : '停止生成(Esc)'}
                data-testid="composer-cancel"
              >
                {cancelling ? (
                  <Spinner className="size-4" />
                ) : (
                  <Square className="size-3.5 fill-current" />
                )}
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-9 rounded-full shadow-sm transition-[transform,background-color,opacity] duration-(--dur-fast) ease-(--ease-spring) hover:-translate-y-px active:translate-y-px active:scale-[0.96]"
                disabled={!canSubmit}
                onClick={onSubmit}
                aria-label="生成图像"
                title={noProvider ? '请先连接服务商' : '生成图像(Enter)'}
                data-testid="composer-submit"
              >
                {submitting ? <Spinner className="size-4" /> : <ArrowUp className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={previewReference !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewReference(null);
        }}
      >
        <DialogContent
          className="max-w-[min(92vw,40rem)] p-2 sm:p-3"
          aria-describedby={undefined}
          data-testid="composer-reference-preview"
        >
          <DialogTitle className="sr-only">参考图预览</DialogTitle>
          {previewReference && (
            <>
              <img
                src={previewReference.previewUrl}
                alt={previewReference.name}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
              <p className="truncate px-1 pb-1 text-muted-foreground text-xs">
                {previewReference.name}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
