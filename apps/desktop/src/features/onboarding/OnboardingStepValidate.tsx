import { ArrowLeft, ArrowRight, Loader2 } from '../../components/ui/icons';
import {
  PROVIDER_PRESETS,
} from '@musefold/domain/constants';
import { formatPoints } from '@musefold/domain';
import { Button } from '../../components/ui/button';
import { useOnboardingStore } from './store';
import { ValidationResultBanner } from './onboardingCrossFeature';
import { OnboardingActions, StepIntro, ValidationLine } from './onboarding-ui';

export function StepValidate() {
  const validating = useOnboardingStore((s) => s.validating);
  const validation = useOnboardingStore((s) => s.validation);
  const textValidation = useOnboardingStore((s) => s.textValidation);
  const textConnectionId = useOnboardingStore((s) => s.textConnectionId);
  const track = useOnboardingStore((s) => s.track);
  const alsoConfigureText = useOnboardingStore((s) => s.alsoConfigureText);
  const presetId = useOnboardingStore((s) => s.presetId);
  const accountQuota = useOnboardingStore((s) => s.accountQuota);
  const goBack = useOnboardingStore((s) => s.goBack);
  const skip = useOnboardingStore((s) => s.skip);
  const retryValidate = useOnboardingStore((s) => s.retryValidate);
  const providerId = useOnboardingStore((s) => s.providerId);

  const continueToImage = () => useOnboardingStore.setState({ step: 4 });
  const updateKey = () => useOnboardingStore.setState({ step: 2 });
  const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
  const requiresText = track === 'account'
    || Boolean(track === 'byok' && alsoConfigureText && preset?.type === 'openai-compatible');
  const allOk = Boolean(validation?.ok && (!requiresText || textValidation?.ok));

  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col" data-testid="onboarding-step-3">
      <StepIntro title="确认连接">
        先确认服务可以正常响应，再开始制作第一张图。
      </StepIntro>

      <div className="mt-10 min-h-[156px]">
        {validating && (
          <div className="flex min-h-[156px] flex-col items-center justify-center gap-3 text-center" data-testid="onboarding-validating">
            <Loader2 className="h-6 w-6 animate-spin text-secondary" />
            <p className="text-[13px] text-secondary">
              {track === 'doubao' ? '正在确认豆包网页会话…' : '正在确认 Agent 与生图模型…'}
            </p>
          </div>
        )}

        {!validating && (validation || textValidation) && (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {(textConnectionId || textValidation) && (
              <ValidationLine
                label="Agent 模型"
                ok={textValidation?.ok ?? false}
                detail={textValidation?.message ?? '尚未确认'}
              />
            )}
            <ValidationLine
              label="图像生成"
              ok={validation?.ok ?? false}
              detail={validation?.message ?? '尚未确认'}
            />
            {accountQuota != null && (
              <ValidationLine
                label="账号余额"
                ok={accountQuota > 0}
                detail={accountQuota > 0 ? `${formatPoints(accountQuota)} 积分` : '0 积分，可稍后兑换'}
              />
            )}
          </div>
        )}

        {!validating && validation && !validation.ok && (
          <div className="mt-4 w-full" data-testid="onboarding-validation-error">
            <ValidationResultBanner
              result={{ ok: false, code: validation.code, message: validation.message, modelCount: validation.models?.length }}
              onAction={(action) => {
                if (action.kind === 'update_key') updateKey();
                else if (action.kind === 'retry') void retryValidate();
              }}
            />
          </div>
        )}
      </div>

      <OnboardingActions>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={goBack} data-testid="onboarding-back">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          上一步
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={skip} data-testid="onboarding-skip">暂时跳过</Button>
          {allOk ? (
            <Button className="rounded-full px-4" onClick={continueToImage} data-testid="onboarding-continue">
              继续
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          ) : (
            !validating && providerId && (
              <Button variant="outline" className="rounded-full px-4" onClick={() => void retryValidate()} data-testid="onboarding-retry">
                重新确认
              </Button>
            )
          )}
        </div>
      </OnboardingActions>
    </section>
  );
}
