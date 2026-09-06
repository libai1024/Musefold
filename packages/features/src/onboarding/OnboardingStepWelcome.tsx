'use client';

import { MusefoldMark } from '@musefold/ui/components/brand-mark';
import { Button } from '@musefold/ui/components/button';
import { ArrowRight } from '@musefold/ui/icons';
import { cn } from '@musefold/ui/lib/utils';
import { skipMotion } from '@musefold/ui/lib/motion';
import { useEffect, useState } from 'react';
import { OnboardingActions } from './onboarding-ui';

/** 承 v2.1 品牌文案(THEATER-01「显形」主题):标语两行 + 一句副文。 */
const HEADLINE = ['让灵感', '成为图像。'] as const;

/**
 * welcome 步:品牌面板(标记 + 产品名 + slogan)。
 * 入场 reveal 经 `skipMotion()` 闸门 —— 命中减少动效时直接置终态,不做任何帧工作。
 */
export function OnboardingStepWelcome({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  const [revealed, setRevealed] = useState(() => skipMotion());

  useEffect(() => {
    if (revealed) return;
    const frame = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(frame);
  }, [revealed]);

  // 行间 60ms 错相由内联 delay 承担(Tailwind 编译不了动态类名);终态后清掉 delay。
  const revealClass = cn(
    'transition-[opacity,transform] duration-(--dur-med) ease-out',
    revealed ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
  );
  const revealDelay = (order: number) =>
    revealed ? undefined : { transitionDelay: `${order * 60}ms` };

  return (
    <section className="flex flex-col gap-6" data-testid="onboarding-step-welcome">
      <div className="flex flex-col gap-5">
        <div className={cn('flex items-center gap-2.5', revealClass)}>
          <MusefoldMark className="size-8 shrink-0 text-foreground" aria-hidden />
          <p className="font-semibold text-foreground text-sm">
            Musefold <span className="ml-1 font-normal text-muted-foreground">未像</span>
          </p>
        </div>
        <h2 className="font-semibold text-3xl text-foreground leading-tight tracking-tight">
          {HEADLINE.map((line, index) => (
            <span key={line} className="block overflow-hidden">
              <span
                className={cn('block', index === 1 && 'text-primary', revealClass)}
                style={revealDelay(index + 1)}
              >
                {line}
              </span>
            </span>
          ))}
        </h2>
        <p
          // ch 按西文字宽算,CJK 下 36ch 只够 18 字会把「几步就好」拦腰断行,放到 52ch。
          className={cn('max-w-[52ch] text-muted-foreground text-sm leading-6', revealClass)}
          style={revealDelay(3)}
        >
          保存一个方向,制作一张图。先连接一个生图通道,几步就好。
        </p>
      </div>

      <OnboardingActions onSkip={onSkip}>
        <Button onClick={onStart} data-testid="onboarding-next">
          开始设置
          <ArrowRight className="size-3.5" />
        </Button>
      </OnboardingActions>
    </section>
  );
}
