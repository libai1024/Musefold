import { ArrowRight } from '../../components/ui/icons';
import { Button } from '../../components/ui/button';
import { MusefoldLogoAnimated } from '../../components/brand/MusefoldLogoAnimated';
import { useOnboardingStore } from './store';

export function StepWelcome() {
  const goStart = useOnboardingStore((s) => s.goStart);
  const skip = useOnboardingStore((s) => s.skip);

  return (
    <section className="flex flex-col items-center text-center" data-testid="onboarding-step-1">
      {/* 放大的品牌标记：缓慢入场 + 待机呼吸 */}
      <MusefoldLogoAnimated
        tempo="calm"
        idle
        className="h-[min(190px,26vh)] w-[min(190px,26vh)]"
      />

      {/* 文案与操作错峰浮现，节奏跟随标记的入场 */}
      <div className="animate-slide-up-fade mt-11" style={{ animationDelay: '0.5s' }}>
        <h1 className="text-[30px] font-semibold leading-none tracking-tight text-primary sm:text-[34px]">
          Musefold
        </h1>
        <p className="mt-3 pl-[0.55em] text-[12px] font-medium tracking-[0.55em] text-tertiary">未像</p>
      </div>

      <p
        className="animate-slide-up-fade mt-7 max-w-[460px] text-[15px] leading-7 text-secondary"
        style={{ animationDelay: '0.72s' }}
      >
        让灵感成为图像。保存一个方向，制作一张图。
      </p>

      <div
        className="animate-slide-up-fade mt-10 flex flex-col items-center gap-3 sm:flex-row-reverse"
        style={{ animationDelay: '0.94s' }}
      >
        <Button size="lg" className="rounded-full px-5" onClick={goStart} data-testid="onboarding-start">
          开始设置
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="lg" className="rounded-full px-5" onClick={skip} data-testid="onboarding-skip">
          先进入 Musefold
        </Button>
      </div>

      <p
        className="animate-slide-up-fade mt-12 text-[11px] tracking-[0.02em] text-tertiary"
        style={{ animationDelay: '1.16s' }}
      >
        收集灵感 · 展开想法 · 继续编辑
      </p>
    </section>
  );
}
