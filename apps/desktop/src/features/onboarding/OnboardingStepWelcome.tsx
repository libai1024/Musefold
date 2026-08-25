import { ArrowRight } from '../../components/ui/icons';
import { Button } from '../../components/ui/button';
import { MusefoldLogoAnimated } from '../../components/brand/MusefoldLogoAnimated';
import { useOnboardingStore } from './store';
import { useTheaterReveal } from './useTheaterReveal';

/**
 * THEATER-01 欢迎步。签名动效主题锁定为「显形」：标题行从裁切中升起，
 * 标记从折角一侧展开。折页是显形的几何，不是第二套隐喻。
 */
export function StepWelcome() {
  const goStart = useOnboardingStore((s) => s.goStart);
  const skip = useOnboardingStore((s) => s.skip);
  const { rootRef } = useTheaterReveal();

  return (
    <section
      ref={rootRef}
      className="grid min-h-full w-full grid-cols-1 items-center gap-10 px-6 py-10 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] sm:gap-8 sm:px-10 sm:py-8 lg:px-16"
      data-testid="onboarding-step-1"
      data-theater-theme="reveal"
    >
      <div className="min-w-0 max-w-[34rem] justify-self-start sm:self-center">
        <p className="overflow-hidden font-theater text-[13px] font-semibold text-tertiary">
          <span data-theater-line className="block">
            Musefold
            <span className="mx-2 text-accent" aria-hidden="true">
              /
            </span>
            未像
          </span>
        </p>
        <h1 className="mt-5 font-theater text-[clamp(40px,6.4vw,72px)] font-extrabold leading-[1.12] tracking-normal text-primary">
          <span className="block overflow-hidden">
            <span data-theater-line className="block">
              让灵感
            </span>
          </span>
          <span className="block overflow-hidden">
            <span data-theater-line className="block text-accent">
              成为图像。
            </span>
          </span>
        </h1>
        <p className="mt-6 max-w-[26rem] overflow-hidden text-[15px] leading-7 text-secondary">
          <span data-theater-line className="block">
            保存一个方向，制作一张图。
          </span>
        </p>
        <div
          data-theater-cta
          className="mt-10 flex flex-wrap items-center gap-3"
        >
          <Button
            size="lg"
            className="rounded-md px-5"
            onClick={goStart}
            data-testid="onboarding-start"
          >
            开始设置
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="lg"
            className="rounded-md px-5"
            onClick={skip}
            data-testid="onboarding-skip"
          >
            先进入 Musefold
          </Button>
        </div>
      </div>

      <div
        data-theater-mark
        className="flex min-w-0 justify-center sm:justify-end sm:self-end sm:pb-4"
        style={{ perspective: '1400px' }}
      >
        <MusefoldLogoAnimated
          tempo="calm"
          className="h-[min(280px,42vh)] w-[min(280px,42vh)] origin-top-right"
        />
      </div>
    </section>
  );
}
