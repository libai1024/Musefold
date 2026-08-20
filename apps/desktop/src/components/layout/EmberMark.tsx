// 朱点（Ember Mark）—— v0.3.3 全局品牌构件（docs/v0.3.3/V03.3-EMBER-MARK-UI-SPEC.md）。
// 坐在内容视口右上角的「引首印」位置：与品牌 logo 的灵感种子点同色同材质（印泥质感）。
//
// 状态语义：
// - 空闲：安静的朱点。
// - 生图 / Agent 运行中：柔和光晕边缘做墨洇呼吸（CSS 动画，减少动效时退化为静态柔光）。
// - 引首落印（首启仪式）：飞行段隐藏本体，落地段执行钤印按压 + 墨晕 + 「引首一点朱」小字。
// 交互（触感反馈，功能位按规范分期接入）：
// - 按下缩压、松开回弹 + 单圈墨晕；双击果冻挤压 + 双圈墨晕。
// - GSAP 编排，遵循与品牌 logo 相同的减少动效门控。
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useAppStore } from '../../stores/app';
import { useEmberHatchStore } from '../../stores/emberHatch';
import { useGenerationWorkbenchStore } from '../../features/generation/workbench/store';
import { useSkillRuntimeStore } from '../../features/generation/workbench/skill-runtime-store';
import { useSchemeRunStore } from '../../features/design-schemes/run-store';
import { useExternalTasksStore } from '../../stores/externalTasks';
import { EmberSlipCard } from './EmberSlipCard';
import {
  capturePageSelection,
  createSlip,
  recallSlip,
  type CapturedSelection,
} from './emberSlips';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { cn } from '../../lib/utils';

gsap.registerPlugin(useGSAP);

export function EmberMark() {
  const isGenerating = useGenerationWorkbenchStore((s) => s.isGenerating);
  const hasRunningSession = useGenerationWorkbenchStore((s) =>
    s.sessions.some((session) => session.latestStatus === 'running'),
  );
  const skillBusy = useSkillRuntimeStore((s) => s.status === 'detecting' || s.status === 'executing');
  const schemeBusy = useSchemeRunStore((s) => s.running);
  // 外部 Agent（控制面）发起的任务同样点亮呼吸态（SET-02）
  const externalBusy = useExternalTasksStore((s) => s.running);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const hatchPhase = useEmberHatchStore((s) => s.phase);
  const busy = isGenerating || hasRunningSession || skillBusy || schemeBusy || externalBusy;

  const rootRef = useRef<HTMLButtonElement>(null);
  const coreRef = useRef<HTMLSpanElement>(null);
  const ringARef = useRef<HTMLSpanElement>(null);
  const ringBRef = useRef<HTMLSpanElement>(null);
  const [captionVisible, setCaptionVisible] = useState(false);
  const [slipOpen, setSlipOpen] = useState(false);
  const [slipPrefill, setSlipPrefill] = useState<CapturedSelection | null>(null);
  // 素笺是否已有内容：有内容时双击不关卡（v0.3.3 §5 修订，防误失）
  const slipDirtyRef = useRef(false);
  // 批注（§6）：拾选/拾遗的确认 + 撤销通道。slipId 为空时是纯提示（如「剪贴板无物」）。
  const [annotation, setAnnotation] = useState<{ slipId: string | null; label: string } | null>(null);
  const annotationTimersRef = useRef<number[]>([]);
  const pendingCaptureRef = useRef<{ selection: CapturedSelection; timer: number } | null>(null);

  // 素笺收下后朱点微微一沉：书页吃了一张纸的重量
  const sinkAfterSlip = () => {
    const core = coreRef.current;
    if (!core) return;
    gsap
      .timeline({ defaults: { transformOrigin: '50% 50%' } })
      .to(core, { scale: 0.86, y: 1, duration: 0.14, ease: 'power2.in' })
      .to(core, { scale: 1, y: 0, duration: 0.4, ease: 'back.out(2)' });
  };

  const clearAnnotationTimers = () => {
    for (const timer of annotationTimersRef.current) clearTimeout(timer);
    annotationTimersRef.current = [];
  };

  const showAnnotation = (slipId: string | null, label: string, lingerMs = 2200) => {
    clearAnnotationTimers();
    setAnnotation({ slipId, label });
    annotationTimersRef.current.push(window.setTimeout(() => setAnnotation(null), lingerMs));
  };

  const cancelPendingCapture = (): CapturedSelection | null => {
    const pending = pendingCaptureRef.current;
    if (!pending) return null;
    clearTimeout(pending.timer);
    pendingCaptureRef.current = null;
    return pending.selection;
  };

  useEffect(() => () => {
    clearAnnotationTimers();
    cancelPendingCapture();
  }, []);

  const commitCapture = async (selection: CapturedSelection) => {
    const created = await createSlip({ text: selection.text, imagePath: selection.imagePath });
    if (!created) return;
    sinkAfterSlip();
    const preview = selection.text
      ? `“${selection.text.slice(0, 10)}${selection.text.length > 10 ? '…' : ''}”`
      : '一张图';
    showAnnotation(created.id, `拾得 · ${preview} 已入匣`);
  };

  // 拾选（§4）：有选区的单击 300ms 后入库——给双击留一个取消窗口（§3 冲突消解）
  const handleClick = () => {
    if (slipOpen) return;
    const selection = capturePageSelection();
    if (!selection) return;
    cancelPendingCapture();
    const timer = window.setTimeout(() => {
      pendingCaptureRef.current = null;
      void commitCapture(selection);
    }, 300);
    pendingCaptureRef.current = { selection, timer };
  };

  // 拾遗（§6）：Alt+双击即抓剪贴板；文字优先，无文字时尝试图片
  const gleanClipboard = async () => {
    // 渲染进程没有 clipboard-read 权限（application.ts 只放行 sanitized-write），
    // navigator.clipboard 在真实应用里必定抛错；一律走主进程的窄 IPC。
    let text = '';
    try {
      text = (await api.system.readClipboardText()).trim();
    } catch {
      // 剪贴板文本不可读：按无文字处理。
    }
    let imagePath: string | null = null;
    if (!text) {
      try {
        const bytes = await api.system.readClipboardImage();
        if (bytes && bytes.length > 0) {
          const staged = await api.image.stageLocal({
            bytes: new Uint8Array(bytes),
            name: 'clipboard-image.png',
            mimeType: 'image/png',
          });
          if (staged.ok && staged.images[0]) imagePath = staged.images[0].path;
        }
      } catch {
        /* 剪贴板图片不可读：按无物处理 */
      }
    }
    if (!text && !imagePath) {
      showAnnotation(null, '剪贴板无物', 1600);
      return;
    }
    const created = await createSlip({ text, imagePath });
    if (!created) return;
    sinkAfterSlip();
    const preview = text ? `“${text.slice(0, 10)}${text.length > 10 ? '…' : ''}”` : '一张图';
    showAnnotation(created.id, `拾得 · ${preview} 已入匣`);
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    const cancelled = cancelPendingCapture();
    if (event.altKey) {
      void gleanClipboard();
      return;
    }
    if (cancelled) {
      // 拾选转素笺：双击取消即时入库，选区变成卡上的拾得预填
      setSlipPrefill(cancelled);
      setSlipOpen(true);
      return;
    }
    if (slipOpen) {
      // 已有内容的笺只能 Esc 或 × 关闭；空笺允许双击收起
      if (!slipDirtyRef.current) setSlipOpen(false);
      return;
    }
    setSlipPrefill(null);
    setSlipOpen(true);
  };

  // 批注即撤销：停留期内点它一下，笺抽回
  const handleRecall = async () => {
    if (!annotation?.slipId) return;
    const id = annotation.slipId;
    clearAnnotationTimers();
    const ok = await recallSlip(id);
    setAnnotation(ok ? { slipId: null, label: '已抽回' } : null);
    if (ok) annotationTimersRef.current.push(window.setTimeout(() => setAnnotation(null), 900));
  };

  // 引首落印的落地段：钤印按压 + 墨晕，随后小字浮现再散去（v0.3.3 §7）。
  useEffect(() => {
    if (hatchPhase !== 'landing') return;
    const core = coreRef.current;
    const ring = ringARef.current;
    if (core) {
      gsap
        .timeline({ defaults: { transformOrigin: '50% 50%' } })
        .fromTo(core, { scale: 1.35 }, { scale: 0.88, duration: 0.12, ease: 'power2.in' })
        .to(core, { scale: 1, duration: 0.5, ease: 'back.out(2.2)' });
    }
    if (ring) {
      gsap.fromTo(
        ring,
        { scale: 0.6, opacity: 0.55 },
        { scale: 2.9, opacity: 0, duration: 0.7, ease: 'power2.out' },
      );
    }
    setCaptionVisible(true);
    const hide = setTimeout(() => setCaptionVisible(false), 2400);
    const done = setTimeout(() => useEmberHatchStore.getState().reset(), 2900);
    return () => {
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [hatchPhase]);

  useGSAP((_context, contextSafe) => {
    const root = rootRef.current;
    if (!root || !contextSafe) return;

    const bindMotion = () => {
      const core = coreRef.current;

      const emitRing = (ring: HTMLSpanElement | null, scale: number, duration: number, delay = 0) => {
        if (!ring) return;
        gsap.killTweensOf(ring);
        gsap.fromTo(
          ring,
          { scale: 0.5, opacity: 0.55 },
          { scale, opacity: 0, duration, delay, ease: 'power2.out', overwrite: 'auto' },
        );
      };

      const onPointerDown = contextSafe(() => {
        // 立即缩压：可触碰感的第一拍
        gsap.to(core, { scale: 0.72, duration: 0.09, ease: 'power2.out', overwrite: 'auto' });
      });

      const onClick = contextSafe(() => {
        // 松开回弹（带一点过冲）+ 单圈墨晕
        gsap.to(core, { scale: 1, scaleX: 1, scaleY: 1, duration: 0.4, ease: 'back.out(3.2)', overwrite: 'auto' });
        emitRing(ringARef.current, 2.6, 0.55);
      });

      const onDoubleClick = contextSafe(() => {
        // 果冻挤压 + 双圈墨晕：与单击明显不同的第二种触感
        gsap.killTweensOf(core);
        gsap
          .timeline({ defaults: { transformOrigin: '50% 50%' } })
          .to(core, { scaleX: 1.4, scaleY: 0.62, duration: 0.11, ease: 'power2.out' })
          .to(core, { scaleX: 0.68, scaleY: 1.34, duration: 0.13, ease: 'power2.inOut' })
          .to(core, { scaleX: 1, scaleY: 1, scale: 1, duration: 0.62, ease: 'elastic.out(1, 0.34)' });
        emitRing(ringARef.current, 3.1, 0.6);
        emitRing(ringBRef.current, 2.2, 0.5, 0.09);
      });

      const onPointerCancel = contextSafe(() => {
        gsap.to(core, { scale: 1, duration: 0.25, ease: 'power2.out', overwrite: 'auto' });
      });

      root.addEventListener('pointerdown', onPointerDown);
      root.addEventListener('click', onClick);
      root.addEventListener('dblclick', onDoubleClick);
      root.addEventListener('pointerleave', onPointerCancel);
      root.addEventListener('pointercancel', onPointerCancel);
      return () => {
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('click', onClick);
        root.removeEventListener('dblclick', onDoubleClick);
        root.removeEventListener('pointerleave', onPointerCancel);
        root.removeEventListener('pointercancel', onPointerCancel);
        gsap.killTweensOf([coreRef.current, ringARef.current, ringBRef.current]);
      };
    };

    // 与 MusefoldLogoAnimated 相同的减少动效门控：显式关闭时直接绑定，
    // 跟随系统时交给 matchMedia，显式开启减少动效则完全不绑交互动画。
    const media = gsap.matchMedia();
    let cleanup: (() => void) | undefined;
    if (reducedMotion === 'off') cleanup = bindMotion();
    else if (reducedMotion !== 'on') media.add('(prefers-reduced-motion: no-preference)', bindMotion);

    return () => {
      cleanup?.();
      media.revert();
    };
  }, { scope: rootRef, dependencies: [reducedMotion] });

  return (
    <div className={cn('absolute right-5 top-5 z-30', hatchPhase === 'flying' && 'opacity-0')}>
    <button
      ref={rootRef}
      type="button"
      aria-label={busy ? 'Musefold 正在生成' : 'Musefold 待命'}
      title={busy ? '正在生成 / Agent 运行中' : 'Musefold · 双击记一笔'}
      data-testid="ember-mark"
      data-state={busy ? 'busy' : 'idle'}
      // 功能路径（拾选/素笺/拾遗）不走减少动效门控的 GSAP 绑定；
      // pointerdown 阻止默认行为：点击朱点不清除页面选区（拾选的前提，§4）
      onPointerDown={(event) => event.preventDefault()}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className="no-drag group relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
    >
      {/* 呼吸光晕：模糊的柔和边缘，仅运行中出现；减少动效时动画被全局规则冻结成静态光晕 */}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute h-4 w-4 rounded-full bg-accent blur-[6px] transition-opacity duration-[var(--dur-med)]',
          busy ? 'animate-ember-breathe' : 'opacity-0',
        )}
      />
      {/* 交互墨晕 ×2（GSAP 一次性触发） */}
      <span ref={ringARef} aria-hidden="true" className="pointer-events-none absolute h-4 w-4 rounded-full border border-accent opacity-0" />
      <span ref={ringBRef} aria-hidden="true" className="pointer-events-none absolute h-4 w-4 rounded-full border-[1.5px] border-accent opacity-0" />
      {/* 朱点核心：与 logo 灵感种子点同源（var(--accent)），印泥落纸的哑光质感；
          transform 由 GSAP 独占，悬停反馈走 .ember-seal 的 filter/阴影 */}
      <span
        ref={coreRef}
        aria-hidden="true"
        className="ember-seal pointer-events-none relative h-[15px] w-[15px] rounded-full"
      />
      {/* 引首落印小字：一次性浮现即散（v0.3.3 定稿文案） */}
      {hatchPhase !== 'idle' && (
        <span
          aria-hidden="true"
          data-testid="ember-hatch-caption"
          className={cn(
            'pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap text-[11px] tracking-[0.08em] text-secondary transition-opacity duration-500',
            captionVisible ? 'opacity-100' : 'opacity-0',
          )}
        >
          引首一点朱
        </span>
      )}
    </button>
    {/* 批注（§6）：拾选/拾遗的确认即撤销——停留期内点一下抽回那枚笺 */}
    {annotation && (
      <button
        type="button"
        data-testid="ember-annotation"
        aria-live="polite"
        disabled={!annotation.slipId}
        onClick={handleRecall}
        title={annotation.slipId ? '点击抽回这枚笺' : undefined}
        className={cn(
          'no-drag absolute right-full top-1/2 mr-1 -translate-y-1/2 whitespace-nowrap rounded-full border border-border-subtle bg-elevated px-2.5 py-1 text-[10.5px] text-secondary shadow-sm animate-fade-in',
          annotation.slipId
            ? 'cursor-pointer transition-colors hover:border-border-default hover:text-primary'
            : 'cursor-default',
        )}
      >
        {annotation.label}
      </button>
    )}
    <EmberSlipCard
      open={slipOpen}
      onClose={() => setSlipOpen(false)}
      onSaved={sinkAfterSlip}
      prefill={slipPrefill}
      onDirtyChange={(dirty) => { slipDirtyRef.current = dirty; }}
    />
    </div>
  );
}
