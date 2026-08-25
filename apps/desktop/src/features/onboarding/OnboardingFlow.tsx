// src/features/onboarding/OnboardingFlow.tsx
// Musefold 首次使用引导：无卡片全屏工作面，状态机仍由 onboarding store 负责。
// 品牌依据：docs/v0.3/MUSEFOLD-BRAND-PLAN.md §4、§5、§8。

import { LockKeyhole } from '../../components/ui/icons';
import { useOnboardingStore } from './store';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { cn } from '../../lib/utils';
import { usePlatform, useWindowFullscreen } from '../../lib/usePlatform';
import { OnboardingHeader } from './onboarding-ui';
import { StepWelcome } from './OnboardingStepWelcome';
import { StepConnect } from './OnboardingStepConnect';
import { StepValidate } from './OnboardingStepValidate';
import { StepFirstImage } from './OnboardingStepFirstImage';

export function OnboardingFlow() {
  const visible = useOnboardingStore((s) => s.isVisible());
  // isVisible() 内部读取 generation store；必须在本组件订阅，否则那边变化不会重渲染。
  useGenerationStore((s) => s.providersLoaded);
  useGenerationStore((s) => s.providers.length);
  const step = useOnboardingStore((s) => s.step);
  const generatedImagePath = useOnboardingStore((s) => s.generatedImagePath);
  const { isMac } = usePlatform();
  const isFullscreen = useWindowFullscreen();
  const needsMacTitlebarInset = isMac && !isFullscreen;
  const fullBleed = step === 1 || step === 4;
  const imageRevealed = step === 4 && Boolean(generatedImagePath);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-background text-primary"
      data-testid="onboarding-flow"
      data-ui-register="theater"
      data-step={step}
    >
      <div className={cn('flex h-full min-h-0 flex-col', needsMacTitlebarInset && 'pt-[52px]')}>
        <OnboardingHeader step={step} receded={imageRevealed} />

        <main className={cn('min-h-0 flex-1', fullBleed ? 'overflow-hidden' : 'overflow-y-auto')}>
          <div
            key={step}
            className={cn(
              'mx-auto flex w-full flex-col',
              fullBleed
                ? 'h-full min-h-0 justify-stretch'
                : 'animate-fade-in min-h-full max-w-[760px] justify-center px-6 py-10 sm:px-10 sm:py-14',
            )}
          >
            {step === 1 && <StepWelcome />}
            {step === 2 && <StepConnect />}
            {step === 3 && <StepValidate />}
            {step === 4 && <StepFirstImage />}
          </div>
        </main>

        {!fullBleed || step === 1 ? (
        <footer
          className={cn(
            'flex shrink-0 justify-center px-6 py-3',
            step === 1 ? '' : 'border-t border-border-subtle',
          )}
        >
          <p className="flex items-center gap-1.5 text-meta text-tertiary">
            <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
            本地优先 · 登录会话与密钥只保存在本机
          </p>
        </footer>
        ) : null}
      </div>
    </div>
  );
}
