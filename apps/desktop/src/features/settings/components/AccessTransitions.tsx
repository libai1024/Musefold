import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { UserRound } from '../../../components/ui/icons';
import { ModelBrandIcon } from '../../../components/ui/brand-icons';
import { useAppStore } from '../../../stores/app';
import type { AccountImageSource } from '../../../lib/ai-access';

gsap.registerPlugin(useGSAP);

type TransitionPhase = 'testing' | 'passed' | 'failed';

export interface AccountIdentity {
  source: AccountImageSource;
  name: string;
  detail: string;
  avatarDataUrl?: string | null;
}

export interface AccountIdentityTransitionState {
  from: AccountIdentity;
  to: AccountIdentity;
}

function reducedMotionEnabled(preference: ReturnType<typeof useAppStore.getState>['reducedMotion']): boolean {
  return preference === 'on'
    || (preference === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function IdentityMark({ identity }: { identity: AccountIdentity }) {
  const initial = identity.name.trim().charAt(0).toUpperCase();
  return (
    <div className="flex w-[250px] max-w-[calc(100vw-64px)] items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-default bg-elevated text-[12px] font-semibold text-primary">
        {identity.avatarDataUrl
          ? <img src={identity.avatarDataUrl} alt="" className="h-full w-full object-cover" />
          : identity.source === 'official'
            ? <ModelBrandIcon model="musefold-agent" className="h-5 w-5" />
            : initial || <UserRound className="h-4 w-4" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-primary">{identity.name}</span>
        <span className="mt-0.5 block truncate text-meta text-tertiary">{identity.detail}</span>
      </span>
    </div>
  );
}

export function AccountIdentityTransition({ state, onSwap, onComplete }: {
  state: AccountIdentityTransitionState;
  onSwap: () => Promise<void>;
  onComplete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const swapPromiseRef = useRef<Promise<void> | null>(null);
  const reducedMotion = useAppStore((store) => store.reducedMotion);
  const [phase, setPhase] = useState<TransitionPhase>('testing');

  useGSAP(() => {
    const shell = shellRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    const dot = dotRef.current;
    if (!shell || !from || !to || !dot) return;

    let disposed = false;
    let timeline: gsap.core.Timeline | null = null;
    swapPromiseRef.current ??= onSwap()
      .then(() => {
        if (!disposed) setPhase('passed');
      })
      .catch(() => {
        if (!disposed) setPhase('failed');
      });
    const swap = swapPromiseRef.current;
    const finish = async () => {
      await swap;
      if (disposed) return;
      if (reducedMotionEnabled(reducedMotion)) {
        onComplete();
        return;
      }
      gsap.to(shell, { autoAlpha: 0, y: -4, duration: 0.18, ease: 'power2.in', onComplete });
    };

    if (reducedMotionEnabled(reducedMotion)) {
      void finish();
    } else {
      gsap.set(shell, { autoAlpha: 0, y: 6 });
      gsap.set(to, { autoAlpha: 0, x: 20 });
      gsap.set(dot, { xPercent: -50 });
      timeline = gsap.timeline({ onComplete: () => void finish() });
      timeline
        .to(shell, { autoAlpha: 1, y: 0, duration: 0.16, ease: 'power2.out' })
        .to(dot, { x: 212, duration: 0.62, ease: 'power2.inOut' }, 0.12)
        .to(from, { autoAlpha: 0, x: -20, duration: 0.42, ease: 'power2.inOut' }, 0.18)
        .to(to, { autoAlpha: 1, x: 0, duration: 0.42, ease: 'power2.out' }, 0.34)
        .to({}, { duration: 0.16 });
    }

    return () => {
      disposed = true;
      timeline?.kill();
    };
  }, { scope: rootRef, dependencies: [reducedMotion] });

  const status = phase === 'testing' ? '正在交接生图账号' : phase === 'passed' ? '账号已切换' : '切换失败，保留原账号';

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[215] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={status}
      data-testid="account-identity-transition"
    >
      <div ref={shellRef} className="w-[280px] max-w-[calc(100vw-40px)]">
        <p className="mb-3 text-meta font-medium text-tertiary">{status}</p>
        <div className="relative h-11 overflow-hidden">
          <div ref={fromRef} className="absolute inset-0 will-change-[transform,opacity]"><IdentityMark identity={state.from} /></div>
          <div ref={toRef} className="absolute inset-0 will-change-[transform,opacity]"><IdentityMark identity={state.to} /></div>
        </div>
        <div className="relative mt-4 h-px bg-border-default">
          <span ref={dotRef} className="absolute -top-[3px] left-0 h-[7px] w-[7px] rounded-full bg-accent will-change-transform" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
