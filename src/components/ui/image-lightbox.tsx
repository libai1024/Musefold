// src/components/ui/image-lightbox.tsx
// 图像放大预览 —— 全屏暗遮罩 + 居中原图 + ESC/点击关闭；可选左右翻页
import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Download,
  FolderOpen,
  ImageOff,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from './icons';
import { toImageSrc } from '../../lib/media';
import api from '../../lib/ipc';
import { toast } from '../../stores/toast';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

interface Props {
  path: string | null;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  prompt?: string | null;
}

export function ImageLightbox({
  path,
  onClose,
  onPrevious,
  onNext,
  hasPrevious = false,
  hasNext = false,
  prompt,
}: Props) {
  const [broken, setBroken] = useState(false);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    setBroken(false);
    setScale(1);
  }, [path]);

  const zoomBy = (delta: number) => {
    setScale((v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((v + delta).toFixed(2)))));
  };

  const saveImage = async () => {
    if (!path) return;
    try {
      const result = await api.system.saveImage(path);
      if ('cancelled' in result) return;
      toast.success('图片已另存');
    } catch (error) {
      toast.error('另存失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const openFolder = async () => {
    if (!path) return;
    try {
      await api.system.openInFolder(path);
      toast.success('已在文件夹中定位图片');
    } catch (error) {
      toast.error('打开文件夹失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const copyImage = async () => {
    if (!path) return;
    try {
      await api.system.copyImage(path);
      toast.success('已复制图片');
    } catch (error) {
      toast.error('复制图片失败', error instanceof Error ? error.message : '图片可能已被移动或删除。');
    }
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('已复制提示词');
    } catch {
      toast.error('复制失败', '剪贴板不可用');
    }
  };

  useEffect(() => {
    if (!path) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrevious) {
        e.preventDefault();
        onPrevious?.();
      }
      if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        onNext?.();
      }
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoomBy(SCALE_STEP);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomBy(-SCALE_STEP);
      }
      if (e.key === '0') {
        e.preventDefault();
        setScale(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasNext, hasPrevious, onNext, onPrevious, path]);

  return (
    <Dialog.Root open={Boolean(path)} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/85 animate-overlay-in" />
        <Dialog.Content
          className="fixed inset-0 z-[111] flex items-center justify-center p-10 focus:outline-none"
          onClick={onClose}
          aria-label="图像预览"
          data-testid="image-lightbox"
        >
          <Dialog.Title className="sr-only">图像预览</Dialog.Title>
          <Dialog.Description className="sr-only">点击任意处或按 ESC 关闭</Dialog.Description>
          {path && !broken && (
            <img
              src={toImageSrc(path)}
              alt="预览"
              onClick={(e) => e.stopPropagation()}
              onError={() => setBroken(true)}
              data-testid="image-lightbox-image"
              data-scale={scale}
              style={{ transform: `scale(${scale})` }}
              className="max-h-full max-w-full animate-scale-fade-in rounded-xl border border-white/10 object-contain shadow-pop transition-transform duration-[var(--dur-fast)] ease-out"
            />
          )}
          {path && broken && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex animate-scale-fade-in flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/75 px-10 py-12 text-center"
            >
              <ImageOff className="h-8 w-8 text-white/60" />
              <p className="text-sm font-medium text-white/85">图片无法加载</p>
              <p className="text-xs text-white/55">文件可能已被移动或删除。</p>
            </div>
          )}
          {path && (onPrevious || onNext) && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasPrevious) onPrevious?.();
                }}
                aria-disabled={!hasPrevious}
                aria-label="上一张"
                data-testid="image-lightbox-prev"
                className="absolute left-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white/85 transition-colors hover:bg-black/90 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-35"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (hasNext) onNext?.();
                }}
                aria-disabled={!hasNext}
                aria-label="下一张"
                data-testid="image-lightbox-next"
                className="absolute right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white/85 transition-colors hover:bg-black/90 hover:text-white aria-disabled:cursor-not-allowed aria-disabled:opacity-35"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
          {path && (
            <div
              className="absolute bottom-5 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 rounded-lg border border-white/15 bg-black/80 p-1 text-white/85 shadow-pop"
              onClick={(e) => e.stopPropagation()}
              data-testid="image-lightbox-toolbar"
            >
              <LightboxAction icon={Download} label="另存图片" testId="image-lightbox-save" onClick={() => void saveImage()} />
              <LightboxAction icon={FolderOpen} label="打开所在文件夹" testId="image-lightbox-folder" onClick={() => void openFolder()} />
              <LightboxAction icon={Copy} label="复制图片" testId="image-lightbox-copy-image" onClick={() => void copyImage()} />
              {prompt && (
                <LightboxAction icon={ClipboardCopy} label="复制提示词" testId="image-lightbox-copy-prompt" onClick={() => void copyPrompt()} />
              )}
              {!broken && <span className="mx-0.5 h-5 w-px bg-white/15" aria-hidden="true" />}
              {!broken && (
                <>
              <button
                type="button"
                onClick={() => zoomBy(-SCALE_STEP)}
                disabled={scale <= MIN_SCALE}
                aria-label="缩小"
                data-testid="image-lightbox-zoom-out"
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setScale(1)}
                aria-label="重置缩放"
                data-testid="image-lightbox-zoom-reset"
                className="flex h-8 min-w-12 items-center justify-center gap-1 rounded-full px-2 font-mono text-[11px] tabular-nums transition-colors hover:bg-white/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {Math.round(scale * 100)}%
              </button>
              <button
                type="button"
                onClick={() => zoomBy(SCALE_STEP)}
                disabled={scale >= MAX_SCALE}
                aria-label="放大"
                data-testid="image-lightbox-zoom-in"
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
                </>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            data-testid="image-lightbox-close"
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/75 text-white/85 transition-colors hover:bg-black/90 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function LightboxAction({
  icon: Icon,
  label,
  testId,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/10 hover:text-white"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
