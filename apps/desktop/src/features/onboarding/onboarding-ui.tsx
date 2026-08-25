import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2 } from '../../components/ui/icons';
import { MusefoldLogoAnimated } from '../../components/brand/MusefoldLogoAnimated';
import { cn } from '../../lib/utils';
import type { OnboardingStep } from './store';

export function OnboardingHeader({
  step,
  receded = false,
}: {
  step: OnboardingStep;
  receded?: boolean;
}) {
  return (
    <header
      className={cn(
        'flex h-14 shrink-0 items-center justify-between px-5 sm:px-8',
        step === 1 || receded ? 'border-b border-transparent' : 'border-b border-border-subtle',
      )}
    >
      <div className="flex min-w-0 items-center">
        {step === 1 ? (
          <span className="sr-only">首次设置</span>
        ) : (
          <div className={cn('flex items-center gap-2.5', receded && 'opacity-70')}>
            <MusefoldLogoAnimated className="h-7 w-7" />
            <span className="text-[13px] font-semibold tracking-tight text-primary">Musefold</span>
          </div>
        )}
      </div>
      {step === 1 || receded ? null : <ProgressDots step={step} />}
    </header>
  );
}

export function ProgressDots({ step }: { step: OnboardingStep }) {
  return (
    <div
      className="flex items-center gap-3"
      aria-label={`首次设置，第 ${step} 步，共 4 步`}
      data-testid="onboarding-progress"
    >
      <div className="flex items-center gap-1.5" aria-hidden="true">
        {([1, 2, 3, 4] as const).map((n) => (
          <span
            key={n}
            className={cn(
              'h-1 w-5 rounded-full transition-colors duration-[var(--dur-base)]',
              n <= step ? 'bg-primary' : 'bg-border-default',
            )}
          />
        ))}
      </div>
      <span className="sr-only">{`第 ${step} 步，共 4 步`}</span>
    </div>
  );
}

export function StepIntro({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-normal text-primary">{title}</h2>
      <p className="mt-2 max-w-[520px] text-[13px] leading-6 text-secondary">{children}</p>
    </div>
  );
}

export function OnboardingActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-12 flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
      {children}
    </div>
  );
}

export function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="mr-1 text-[11px] text-tertiary">{label}</legend>
      {children}
    </fieldset>
  );
}

export function ValidationLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-3.5 text-left">
      {ok
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        : <AlertCircle className="h-4 w-4 shrink-0 text-danger" />}
      <span className="min-w-0 flex-1 text-[12px] font-medium text-primary">{label}</span>
      <span className={cn('max-w-[58%] break-words text-right text-meta leading-relaxed', ok ? 'text-tertiary' : 'text-danger')} title={detail}>
        {detail}
      </span>
    </div>
  );
}
