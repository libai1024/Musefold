'use client';

import { Button } from '@musefold/ui/components/button';
import { Spinner } from '@musefold/ui/components/spinner';
import { ArrowRight, RefreshCw } from '@musefold/ui/icons';
import { queryKeys, useGateway } from '@musefold/platform';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { formatPoints } from '../account/hooks';
import type { OnboardingTrack } from './onboarding-store';
import {
  errorMessage,
  OnboardingActions,
  OnboardingCheckLine,
  OnboardingStepBody,
} from './onboarding-ui';

interface ChannelCheck {
  label: string;
  ok: boolean;
  detail: string;
}

const TRACK_LABEL: Record<OnboardingTrack, string> = {
  account: 'Musefold 账号',
  byok: '自备 API 连接',
  doubao: '豆包免费试用',
};

/**
 * validate 步:确认所选通道真的能用。
 *
 * 判定直接打 gateway 对应域(账号 `getStatus` / Provider `test` / 豆包 `getStatus`),
 * 三轨在同一个 mutation 里分叉,避免为可选域做条件 hook 调用。
 * 失败留在本步:可「返回」修正、可「重新确认」、也可跳过整个引导。
 */
export function OnboardingStepValidate({
  track,
  providerId,
  onValidated,
  onBack,
  onSkip,
}: {
  track: OnboardingTrack | null;
  providerId: string | null;
  onValidated: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const gateway = useGateway();
  const queryClient = useQueryClient();

  const check = useMutation({
    mutationFn: async (): Promise<ChannelCheck> => {
      if (track === 'byok') {
        if (!gateway.aiProviders || !providerId) {
          throw new Error('还没有可确认的本地连接,请返回上一步重新保存。');
        }
        const result = await gateway.aiProviders.test({ id: providerId });
        return {
          label: TRACK_LABEL.byok,
          ok: result.ok,
          detail: result.ok
            ? `${result.message}${result.latencyMs === null ? '' : ` · ${result.latencyMs}ms`}`
            : result.message,
        };
      }
      if (track === 'doubao') {
        if (!gateway.doubao) throw new Error('当前环境不提供豆包登录,请返回选择其他方式。');
        const status = await gateway.doubao.getStatus();
        return {
          label: TRACK_LABEL.doubao,
          ok: status.loggedIn,
          detail: status.loggedIn
            ? `已登录,今日剩余 ${status.usage.remaining}/${status.usage.limit} 次`
            : (status.errorMessage ?? '豆包尚未登录,请返回上一步重新扫码。'),
        };
      }
      const account = await gateway.account.getStatus();
      return {
        label: TRACK_LABEL.account,
        ok: account.canGenerate,
        detail: account.canGenerate
          ? `已登录 ${account.username} · ${formatPoints(account.quota)} 积分`
          : `已登录 ${account.username},但余额不足(${formatPoints(account.quota)} 积分),可在设置中兑换后再生图。`,
      };
    },
    onSuccess: () => {
      // 通道确认会改变工作台可用连接与账号状态的可见性,一并失效。
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation.providers() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account.status() });
    },
  });

  // 进入本步自动确认一次(承 v2.1:connect 成功即 validate),StrictMode 双跑只发一次。
  const autoRan = useRef(false);
  const run = check.mutate;
  useEffect(() => {
    if (autoRan.current) return;
    autoRan.current = true;
    run();
  }, [run]);

  const result = check.data ?? null;
  const failure = check.isError ? errorMessage(check.error) : null;
  const passed = result?.ok === true;

  return (
    <section className="flex flex-col gap-5" data-testid="onboarding-step-validate">
      <OnboardingStepBody title="确认连接" description="先确认这个通道能正常响应,再去做第一张图。">
        <div className="flex min-h-24 flex-col gap-3">
          {check.isPending ? (
            <p
              className="flex items-center gap-2 text-muted-foreground text-sm"
              data-testid="onboarding-validating"
              role="status"
            >
              <Spinner className="size-3.5" />
              正在确认{track ? TRACK_LABEL[track] : '连接'}…
            </p>
          ) : failure ? (
            <OnboardingCheckLine
              label={track ? TRACK_LABEL[track] : '连接'}
              ok={false}
              detail={failure}
              testId="onboarding-validate-result"
            />
          ) : result ? (
            <OnboardingCheckLine
              label={result.label}
              ok={result.ok}
              detail={result.detail}
              testId="onboarding-validate-result"
            />
          ) : null}
        </div>
      </OnboardingStepBody>
      <OnboardingActions onBack={onBack} onSkip={onSkip}>
        {passed ? (
          <Button onClick={onValidated} data-testid="onboarding-next">
            继续
            <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="outline"
            disabled={check.isPending}
            onClick={() => check.mutate()}
            data-testid="onboarding-retry"
          >
            {check.isPending ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            重新确认
          </Button>
        )}
      </OnboardingActions>
    </section>
  );
}
