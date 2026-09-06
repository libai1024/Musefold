'use client';

import { Button } from '@musefold/ui/components/button';
import { Label } from '@musefold/ui/components/label';
import { Textarea } from '@musefold/ui/components/textarea';
import { ArrowRight } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { ONBOARDING_EXAMPLE_PROMPTS } from './onboarding-store';
import { OnboardingActions, OnboardingStepBody } from './onboarding-ui';

/**
 * first-image 步:挑一条示例提示词或自己写,点「去生成」把提示词经工作台草稿通道
 * (`useActiveSession.pendingDraft`)送进工作台并切屏。
 *
 * 红线:这里**不发起真实生图**——只送草稿,发送与否由用户在工作台决定(无授权不花钱)。
 */
export function OnboardingStepFirstImage({
  prompt,
  onPromptChange,
  onSendToWorkbench,
  onBack,
  onSkip,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSendToWorkbench: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const trimmed = prompt.trim();

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-first-image">
      <OnboardingStepBody
        title="写下第一个方向"
        description="挑一条示例或自己写。点「去生成」会把它送进工作台,由你按下发送。"
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" data-testid="onboarding-example-prompts">
            {ONBOARDING_EXAMPLE_PROMPTS.map((example, index) => (
              <button
                key={example}
                type="button"
                aria-pressed={prompt === example}
                onClick={() => onPromptChange(example)}
                data-testid={`onboarding-example-${index}`}
                className={cn(
                  'max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  prompt === example
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {example}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="onboarding-prompt">提示词</Label>
            <Textarea
              id="onboarding-prompt"
              data-testid="onboarding-prompt"
              rows={3}
              placeholder="描述你想生成的图片…"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value)}
            />
          </div>
        </div>
      </OnboardingStepBody>
      <OnboardingActions onBack={onBack} onSkip={onSkip}>
        <Button
          disabled={trimmed.length === 0}
          onClick={onSendToWorkbench}
          data-testid="onboarding-next"
        >
          去生成
          <ArrowRight className="size-3.5" />
        </Button>
      </OnboardingActions>
    </section>
  );
}
