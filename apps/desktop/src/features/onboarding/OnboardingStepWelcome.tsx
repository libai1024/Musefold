import { ArrowRight } from '../../components/ui/icons';
import { Button } from '../../components/ui/button';
import { MusefoldLogoAnimated } from '../../components/brand/MusefoldLogoAnimated';
import { useOnboardingStore } from './store';
import { useTheaterReveal } from './useTheaterReveal';
import onboardingArtwork from './floating-library-onboarding.webp';

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
      className="grid min-h-full w-full grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] gap-4 px-4 pb-4"
      data-testid="onboarding-step-1"
      data-theater-theme="reveal"
    >
      <div className="min-w-0 self-center px-8 py-8">
        <div className="flex items-center gap-3 overflow-hidden">
          <MusefoldLogoAnimated className="h-11 w-11 shrink-0" />
          <p className="font-theater text-[14px] font-semibold text-primary">
            Musefold <span className="ml-1 text-secondary">未像</span>
          </p>
        </div>
        <h1
          className="mt-10 font-theater text-[36px] font-extrabold leading-[1.16] tracking-normal text-primary outline-none"
          tabIndex={-1}
          data-onboarding-step-heading
        >
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
        <p className="mt-5 max-w-[26rem] overflow-hidden text-[14px] leading-7 text-secondary">
          <span data-theater-line className="block">
            保存一个方向，制作一张图。
          </span>
        </p>
        <div
          data-theater-cta
          className="mt-9 flex flex-wrap items-center gap-3"
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
            variant="outline"
            size="lg"
            className="rounded-md px-5"
            onClick={skip}
            data-testid="onboarding-skip"
          >
            先进入 Musefold
          </Button>
        </div>
      </div>

      <figure
        data-theater-mark
        className="aspect-square min-h-0 self-center overflow-hidden rounded-[var(--radius-dialog)] bg-inset"
      >
        <img
          className="mf-onboarding-welcome-image"
          src={onboardingArtwork}
          alt="漂浮在云层中的圆形图书馆，Musefold 生成作品示例"
        />
      </figure>
    </section>
  );
}
