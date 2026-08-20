// 素笺卡（v0.3.3 朱点规范 §5）—— 双击朱点滑出的一枚方形纸笺：
// 与 Musefold「翻页」标记同构（方形 + 右下角翻起的页角），朱丝栏顶线起首、
// 极淡朱丝横格铺底。手打一笔 + 剪贴板「拾得」预填块 + ⌘V 贴一张图，
// Enter 收入笺匣，Esc 散去。确认制：拾得块看过才收，主动权在人；空笺 Enter 只摇头不落库。
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { X } from '../ui/icons';
import { hatchMotionAllowed } from '../../stores/emberHatch';
import { createSlip, type CapturedSelection } from './emberSlips';
import { toImageSrc } from '../../lib/media';
import api from '../../lib/ipc';
import { cn } from '../../lib/utils';

interface SlipImage {
  path: string;
  name: string;
}

// 笺头小印：Musefold「Unfolded Frame」标记的静态迷你版（石墨 L 背板 + 翻折页角 + 朱点）。
// 几何与品牌 logo 同源，让素笺卡自带「未像」letterhead，呼应它整体的方形折角轮廓。
function SlipMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M 6 0 H 94 A 6 6 0 0 1 100 6 V 12.4 H 21 Q 17 12.4 17 16.4 V 100 H 6 A 6 6 0 0 1 0 94 V 6 A 6 6 0 0 1 6 0 Z"
      />
      <path
        fill="currentColor"
        d="M 100 54 L 53.2 100 L 50.6 100 L 50.6 98.6 L 52.0 98.1 C 52.41 97.49 53.39 96.41 54.46 94.46 C 55.53 92.51 56.93 89.43 58.42 86.42 C 59.91 83.41 61.71 79.71 63.4 76.4 C 65.09 73.09 67.16 69.16 68.56 66.56 C 69.96 63.96 70.74 62.24 71.8 60.8 C 72.86 59.36 73.75 58.75 74.92 57.92 C 76.09 57.09 77.34 56.34 78.82 55.82 C 80.3 55.3 81.47 54.97 83.8 54.8 C 86.13 54.63 90.51 54.95 92.8 54.8 C 95.09 54.65 96.75 54.05 97.54 53.9 L 98.6 53.8 Z"
      />
      <circle cx="84.2" cy="27.2" r="6.8" fill="var(--accent)" />
    </svg>
  );
}

export function EmberSlipCard({
  open,
  onClose,
  onSaved,
  prefill,
  onDirtyChange,
}: {
  open: boolean;
  onClose: () => void;
  /** 落库成功后由朱点执行「吃了一张纸」的下沉反馈 */
  onSaved: () => void;
  /** 拾选转素笺（双击取消拾选时）：选区内容作为拾得块预填，此时不读剪贴板 */
  prefill?: CapturedSelection | null;
  /** 内容态回报：有内容时宿主（朱点）需抑制双击关卡等误触路径（v0.3.3 §5 修订） */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [clipText, setClipText] = useState('');
  const [image, setImage] = useState<SlipImage | null>(null);
  const [saving, setSaving] = useState(false);
  const [shaking, setShaking] = useState(false);

  // 有内容的笺不能被外点误关（v0.3.3 §5 修订）：仅空笺允许点卡外散去
  const hasContent = Boolean(text.trim() || clipText || image);
  const hasContentRef = useRef(hasContent);
  hasContentRef.current = hasContent;
  useEffect(() => {
    onDirtyChange?.(open && hasContent);
  }, [open, hasContent, onDirtyChange]);

  // 打开时：清空上一次内容、预填（选区优先，否则静默读剪贴板做「拾得」）、聚焦输入行
  useEffect(() => {
    if (!open) return;
    setText('');
    setImage(null);
    setSaving(false);
    let alive = true;
    if (prefill) {
      setClipText(prefill.text);
      setImage(prefill.imagePath ? { path: prefill.imagePath, name: '选区图片' } : null);
    } else {
      navigator.clipboard
        ?.readText()
        .then((value) => {
          if (alive) setClipText(value.trim().slice(0, 2000));
        })
        .catch(() => {
          if (alive) setClipText('');
        });
    }
    const focus = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      alive = false;
      cancelAnimationFrame(focus);
    };
  }, [open, prefill]);

  // Esc 永远可散去；点卡外只在「空笺」时散去（有内容必须 Esc 或笺头 ×，防误失）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (cardRef.current?.contains(target)) return;
      if ((target as Element | null)?.closest?.('[data-testid="ember-mark"]')) return;
      if (hasContentRef.current) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const pasteImage = async (file: File) => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await api.image.stageLocal({ bytes, name: file.name || 'slip-image.png', mimeType: file.type });
      if (result.ok && result.images[0]) {
        setImage({ path: result.images[0].path, name: result.images[0].name ?? 'clipboard-image' });
      }
    } catch {
      /* 贴图失败静默：素笺不打断当前对话 */
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const file = Array.from(event.clipboardData.files).find((item) => item.type.startsWith('image/'));
    if (file) {
      event.preventDefault();
      void pasteImage(file);
    }
  };

  const save = async () => {
    if (saving) return;
    const typed = text.trim();
    const content = [typed, clipText].filter(Boolean).join('\n\n');
    if (!content && !image) {
      // 空笺：摇头，不落库
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      return;
    }
    setSaving(true);
    const created = await createSlip({ text: content, imagePath: image?.path });
    setSaving(false);
    if (!created) return; // 失败时 store 已弹 toast，卡保持原样可重试
    const card = cardRef.current;
    if (card && hatchMotionAllowed()) {
      // 纸的动效：以右上角为轴轻轻一折、斜滑入朱点后方，不缩成粒子
      gsap.to(card, {
        x: 40,
        y: -52,
        scale: 0.24,
        rotation: 7,
        opacity: 0,
        transformOrigin: '100% 0%',
        duration: 0.36,
        ease: 'power2.in',
        onComplete: () => {
          onSaved();
          onClose();
        },
      });
    } else {
      onSaved();
      onClose();
    }
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label="记一笔"
      data-testid="ember-slip-card"
      onPaste={handlePaste}
      className={cn(
        'slip-paper absolute right-0 top-[calc(100%+10px)] z-40 flex h-[288px] w-[288px] flex-col p-3.5 animate-scale-fade-in',
        shaking && 'animate-slip-shake',
      )}
    >
      {/* 笺头：未像小印 + 「素笺」题名，右侧字数（有字才现）+ 手动关闭 × */}
      <div className="flex shrink-0 items-center justify-between">
        <span className="flex items-center gap-1.5 text-tertiary">
          <SlipMark className="h-[13px] w-[13px]" />
          <span className="text-[10.5px] font-medium tracking-[0.16em]">素笺</span>
        </span>
        <span className="flex items-center gap-1.5">
          {text.length > 0 && (
            <span className="font-mono text-[9.5px] tabular-nums text-quaternary">{text.length}</span>
          )}
          <button
            type="button"
            aria-label="关闭素笺"
            data-testid="ember-slip-close"
            onClick={onClose}
            className="no-drag -mr-1 rounded p-0.5 text-tertiary transition-colors hover:bg-hover hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      </div>

      {/* 落笔处：朱丝横格铺底，占满笺面主体 */}
      <textarea
        ref={inputRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // 中文输入法组字期间的 Enter 不提交；Shift+Enter 换行
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }}
        placeholder="记一笔…"
        maxLength={2000}
        data-testid="ember-slip-input"
        className="slip-textarea mt-2.5 min-h-0 w-full flex-1 resize-none bg-transparent text-[13px] text-primary outline-none placeholder:text-quaternary"
      />

      {clipText && (
        <div
          data-testid="ember-slip-clip"
          className="mt-2 flex shrink-0 items-start gap-1.5 rounded-md border border-border-subtle bg-inset/60 px-2 py-1.5"
        >
          <span className="shrink-0 pt-px text-[9.5px] font-medium tracking-wide text-quaternary">拾得</span>
          <span className="min-w-0 flex-1 truncate text-[11px] leading-[18px] text-secondary" title={clipText}>
            {clipText}
          </span>
          <button
            type="button"
            aria-label="不要这段拾得"
            onClick={() => setClipText('')}
            className="no-drag -mr-0.5 shrink-0 rounded p-0.5 text-tertiary transition-colors hover:bg-hover hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {image && (
        <div className="mt-2 flex shrink-0 items-center gap-2" data-testid="ember-slip-image">
          <img src={toImageSrc(image.path)} alt="" className="h-9 w-9 rounded-md border border-border-subtle object-cover" />
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-tertiary">{image.name}</span>
          <button
            type="button"
            aria-label="移除图片"
            onClick={() => setImage(null)}
            className="no-drag shrink-0 rounded p-0.5 text-tertiary transition-colors hover:bg-hover hover:text-primary"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 页脚提示：留出右下角折角的空当（pr-9） */}
      <p className="mt-2.5 shrink-0 pr-9 text-[9.5px] leading-relaxed text-quaternary">
        {!image && '⌘V 可贴一张图 · '}Enter 收入笺匣 · Esc / × 散去
      </p>

      {/* 右下角翻起的页角：素笺卡的「未像」签名 */}
      <span aria-hidden="true" className="slip-fold" />
    </div>
  );
}
