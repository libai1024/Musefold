import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Server, UserRound } from '../../../components/ui/icons';
import { ModelBrandIcon, matchModelBrand } from '../../../components/ui/brand-icons';
import { useAppStore } from '../../../stores/app';
import type { AccountImageSource, AiAccessMode } from '../../../lib/ai-access';
import { displayModelName } from '../../../lib/model-catalog';

gsap.registerPlugin(useGSAP);

type TransitionPhase = 'testing' | 'passed' | 'failed';

export interface AccessModeTransitionState {
  from: AiAccessMode;
  to: AiAccessMode;
  stationName: string | null;
  stationModel: string | null;
}

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

function ModeMark({ mode, stationName, stationModel, detail }: {
  mode: AiAccessMode;
  stationName: string | null;
  stationModel: string | null;
  detail?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-primary">
        {mode === 'account'
          ? <UserRound className="h-5 w-5" />
          : stationModel && matchModelBrand(stationModel) !== 'generic'
            ? <ModelBrandIcon model={stationModel} className="h-5 w-5" />
            : <Server className="h-5 w-5" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-primary">
          {mode === 'account' ? '账号模式' : '中转站模式'}
        </span>
        <span className="mt-0.5 block max-w-[230px] truncate text-[10px] text-secondary">
          {detail ?? (mode === 'account'
            ? '使用豆包或 Musefold 官方账号'
            : `${stationName || '自备中转站'} · ${displayModelName(stationModel) || '模型未配置'}`)}
        </span>
      </span>
    </div>
  );
}

export function AccessModeTransition({ state, onSwap, onComplete }: {
  state: AccessModeTransitionState;
  onSwap: () => Promise<void>;
  onComplete: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);
  const ruleRef = useRef<HTMLDivElement>(null);
  const swapPromiseRef = useRef<Promise<void> | null>(null);
  const reducedMotion = useAppStore((store) => store.reducedMotion);
  const [phase, setPhase] = useState<TransitionPhase>('testing');

  useGSAP(() => {
    const root = rootRef.current;
    const surface = surfaceRef.current;
    const content = contentRef.current;
    const from = fromRef.current;
    const to = toRef.current;
    const rule = ruleRef.current;
    if (!root || !surface || !content || !from || !to || !rule) return;

    let disposed = false;
    let enterTimeline: gsap.core.Timeline | null = null;
    let exitTimeline: gsap.core.Timeline | null = null;
    const finish = () => {
      if (!disposed) onComplete();
    };
    const verify = () => {
      swapPromiseRef.current ??= onSwap()
        .then(() => {
          if (!disposed) setPhase('passed');
        })
        .catch(() => {
          if (!disposed) setPhase('failed');
        });
      return swapPromiseRef.current;
    };
    const waitForVerificationAndExit = async (animated: boolean) => {
      await verify();
      if (disposed) return;
      if (!animated) {
        finish();
        return;
      }
      exitTimeline = gsap.timeline({ onComplete: finish });
      exitTimeline
        .to(content, { autoAlpha: 0, y: -4, duration: 0.3, ease: 'power2.in' })
        .to(surface, { scaleY: 0, transformOrigin: '50% 0%', duration: 0.7, ease: 'power3.inOut' });
    };

    if (reducedMotionEnabled(reducedMotion)) {
      void waitForVerificationAndExit(false);
    } else {
      void verify();
      gsap.set(content, { autoAlpha: 0 });
      gsap.set(to, { autoAlpha: 0, x: 12 });
      gsap.set(rule, { scaleX: 0, transformOrigin: '0% 50%' });
      // 保留现有的模式切换节奏：进入 4 秒、退出 1 秒。
      enterTimeline = gsap.timeline({
        defaults: { ease: 'power3.out' },
        onComplete: () => void waitForVerificationAndExit(true),
      });
      enterTimeline
        .to(surface, { scaleY: 1, duration: 0.8, ease: 'power3.inOut' }, 0)
        .to(content, { autoAlpha: 1, duration: 0.3 }, 0.8)
        .to(rule, { scaleX: 1, duration: 3.2, ease: 'power1.inOut' }, 0.8)
        .to(from, { autoAlpha: 0, x: -12, duration: 2.4, ease: 'power1.inOut' }, 1.1)
        .to(to, { autoAlpha: 1, x: 0, duration: 2.6, ease: 'power1.inOut' }, 1.25);
    }

    return () => {
      disposed = true;
      enterTimeline?.kill();
      exitTimeline?.kill();
    };
  }, { scope: rootRef, dependencies: [reducedMotion] });

  const targetDetail = phase === 'testing'
    ? (state.to === 'account' ? '正在验证目标账号' : '正在测试生图与 Agent 中转站')
    : phase === 'passed'
      ? '联通性测试通过'
      : '验证失败，保持原模式';

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 z-[220]"
      role="status"
      aria-live="polite"
      aria-label={`${targetDetail}，目标${state.to === 'account' ? '账号模式' : '中转站模式'}`}
      data-testid="ai-access-transition"
    >
      <div ref={surfaceRef} className="absolute inset-0 origin-bottom scale-y-0 bg-sidebar will-change-transform" />
      <div ref={contentRef} className="invisible absolute inset-0 flex items-center justify-center will-change-[transform,opacity]">
        <div className="w-[290px] max-w-[calc(100vw-48px)]">
          <div className="relative h-11">
            <div ref={fromRef} className="absolute inset-0 flex items-center will-change-[transform,opacity]">
              <ModeMark mode={state.from} stationName={state.stationName} stationModel={state.stationModel} />
            </div>
            <div ref={toRef} className="absolute inset-0 flex items-center will-change-[transform,opacity]">
              <ModeMark mode={state.to} stationName={state.stationName} stationModel={state.stationModel} detail={targetDetail} />
            </div>
          </div>
          <div className="mt-3 h-px overflow-hidden bg-border-default">
            <div ref={ruleRef} className="h-full w-full origin-left scale-x-0 bg-primary will-change-transform" />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
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
        <span className="mt-0.5 block truncate text-[10.5px] text-tertiary">{identity.detail}</span>
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
        <p className="mb-3 text-[10px] font-medium text-tertiary">{status}</p>
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
