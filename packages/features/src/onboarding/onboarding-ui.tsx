'use client';

import { Button } from '@musefold/ui/components/button';
import { ArrowLeft, CheckCircle2, CircleAlert } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import type { ReactNode } from 'react';
import { ONBOARDING_STEPS, type OnboardingStep } from './onboarding-store';

const STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: '欢迎',
  connect: '连接服务',
  validate: '确认连接',
  'first-image': '第一张图',
};

/**
 * 步骤指示(承 v2.1 ProgressDots,升级为可读列表):
 * 当前步 `aria-current="step"`,整组一句 sr-only 说明「第 n 步,共 4 步」。
 */
export function OnboardingProgress({ step }: { step: OnboardingStep }) {
  const index = ONBOARDING_STEPS.indexOf(step);
  return (
    <ol className="flex items-center gap-1.5" data-testid="onboarding-progress">
      {ONBOARDING_STEPS.map((id, position) => (
        <li
          key={id}
          aria-current={id === step ? 'step' : undefined}
          data-testid={`onboarding-progress-${id}`}
          className={cn(
            'h-1 w-5 rounded-full transition-colors duration-(--dur-base)',
            position <= index ? 'bg-primary' : 'bg-border',
          )}
        >
          <span className="sr-only">{STEP_LABELS[id]}</span>
        </li>
      ))}
      <li className="sr-only">{`第 ${index + 1} 步,共 ${ONBOARDING_STEPS.length} 步`}</li>
    </ol>
  );
}

/** 步内容框架:标题(承接对话框可访问名)+ 说明 + 内容。 */
export function OnboardingStepBody({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-semibold text-foreground text-lg leading-tight">{title}</h2>
        {description ? (
          <p className="text-muted-foreground text-sm leading-6">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * 步底部动作条(承 v2.1 OnboardingActions):左侧「返回」,右侧「跳过引导」+ 该步主动作。
 * 「跳过引导」在每一步都可达(I2:主路径不藏浮层)。
 */
export function OnboardingActions({
  onBack,
  onSkip,
  children,
}: {
  /** 省略即无返回(welcome 步)。 */
  onBack?: () => void;
  onSkip: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 border-t pt-4">
      {onBack ? (
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="onboarding-back">
          <ArrowLeft className="size-3.5" />
          返回
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={onSkip}
          data-testid="onboarding-skip"
        >
          跳过引导
        </Button>
        {children}
      </div>
    </div>
  );
}

/** 单行判定结果(承 v2.1 ValidationLine):成功/失败图标 + 名称 + 人话细节。 */
export function OnboardingCheckLine({
  label,
  ok,
  detail,
  testId,
}: {
  label: string;
  ok: boolean;
  detail: string;
  testId?: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-md border bg-card px-3 py-3"
      data-testid={testId}
      role="status"
    >
      {ok ? (
        <CheckCircle2 className="mt-px size-4 shrink-0 text-primary" aria-hidden />
      ) : (
        <CircleAlert className="mt-px size-4 shrink-0 text-destructive" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground text-sm">{label}</p>
        <p
          className={cn(
            'mt-0.5 text-xs leading-5',
            ok ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {detail}
        </p>
      </div>
    </div>
  );
}

/** 轨道选择行(承 v2.1 edge-to-edge 行式选择器):图标 + 名称/徽标 + 一句说明。 */
export function OnboardingTrackRow({
  icon,
  title,
  badge,
  description,
  onSelect,
  testId,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  description: string;
  onSelect: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={testId}
      className="flex w-full items-center gap-3 rounded-md border bg-card px-3 py-3 text-left transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium text-foreground text-sm">
          {title}
          {badge}
        </span>
        <span className="mt-0.5 block text-muted-foreground text-xs leading-5">{description}</span>
      </span>
    </button>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败,请重试';
}
