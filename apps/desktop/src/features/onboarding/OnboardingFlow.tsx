// src/features/onboarding/OnboardingFlow.tsx
// Musefold 首次使用引导：保留 Shell 轮廓的 Theater surface，状态机仍由 store 负责。
// 品牌依据：docs/v0.3/MUSEFOLD-BRAND-PLAN.md §4、§5、§8。

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef } from 'react';
import { LockKeyhole } from '../../components/ui/icons';
import { useOnboardingStore } from './store';
import { useGenerationStore } from '@renderer/runtime/generation-access';
import { cn } from '../../lib/utils';
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
  const skip = useOnboardingStore((s) => s.skip);
  const fullBleed = step === 1 || step === 4;
  const imageRevealed = step === 4 && Boolean(generatedImagePath);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const selector = step === 1
      ? '[data-testid="onboarding-start"]'
      : '[data-onboarding-step-heading]';
    const focusTarget = () => {
      document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    };
    const theaterStep = document.querySelector<HTMLElement>(
      '[data-testid="onboarding-flow"] [data-theater-theme]',
    );

    if (theaterStep && theaterStep.dataset.theaterIdle !== 'true') {
      theaterStep.addEventListener('animationend', focusTarget, { once: true });
      return () => theaterStep.removeEventListener('animationend', focusTarget);
    }

    const frame = requestAnimationFrame(focusTarget);
    return () => cancelAnimationFrame(frame);
  }, [step, visible]);

  if (!visible) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) skip();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className="mf-onboarding-overlay animate-overlay-in"
          data-testid="onboarding-scrim"
        />
        <Dialog.Content
          ref={contentRef}
          className="mf-onboarding-positioner text-primary"
          data-testid="onboarding-flow"
          data-ui-register="theater"
          data-step={step}
        >
          <Dialog.Title className="sr-only">Musefold 首次设置</Dialog.Title>
          <Dialog.Description className="sr-only">
            连接图像服务并完成第一张作品
          </Dialog.Description>
          <section
            className="mf-onboarding-surface"
            data-testid="onboarding-surface"
          >
            <OnboardingHeader step={step} receded={imageRevealed} onClose={skip} />

            <main
              className={cn(
                'mf-onboarding-main min-h-0 flex-1',
                fullBleed ? 'overflow-hidden' : 'overflow-y-auto',
              )}
            >
              <div
                key={step}
                className={cn(
                  'mx-auto flex w-full flex-col',
                  fullBleed
                    ? 'h-full min-h-0 justify-stretch'
                    : 'mf-onboarding-operate animate-fade-in min-h-full max-w-[760px] justify-center px-10 py-10',
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
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
