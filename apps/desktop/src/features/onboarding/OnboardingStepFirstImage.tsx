import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Loader2, Sparkles } from '../../components/ui/icons';
import { RATIO_OPTIONS } from '@musefold/domain/constants';
import type { ImageQuality } from '@musefold/desktop-contracts/enums';
import { EXAMPLE_PROMPT, useOnboardingStore } from './store';
import { Button } from '../../components/ui/button';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { OptionGroup } from './onboarding-ui';
import { useFirstImageReveal } from './useTheaterReveal';

const QUALITY_OPTIONS: { id: ImageQuality; label: string }[] = [
  { id: 'low', label: '标清' },
  { id: 'medium', label: '高清' },
  { id: 'high', label: '超清' },
];

function ratioToCss(ratio: string): { css: string; w: number; h: number } {
  const [width, height] = ratio.split(':');
  const w = Number(width);
  const h = Number(height);
  if (!w || !h) return { css: '1 / 1', w: 1, h: 1 };
  return { css: `${w} / ${h}`, w, h };
}

export function StepFirstImage() {
  const track = useOnboardingStore((s) => s.track);
  const ratioId = useOnboardingStore((s) => s.ratioId);
  const quality = useOnboardingStore((s) => s.quality);
  const generating = useOnboardingStore((s) => s.generating);
  const generateError = useOnboardingStore((s) => s.generateError);
  const generatedImagePath = useOnboardingStore((s) => s.generatedImagePath);
  const setRatioId = useOnboardingStore((s) => s.setRatioId);
  const setQuality = useOnboardingStore((s) => s.setQuality);
  const generateFirstImage = useOnboardingStore((s) => s.generateFirstImage);
  const finish = useOnboardingStore((s) => s.finish);
  const [broken, setBroken] = useState(false);

  useEffect(() => setBroken(false), [generatedImagePath]);

  const ratio = RATIO_OPTIONS.find((item) => item.id === ratioId) ?? RATIO_OPTIONS[0];
  const { css: aspectCss } = ratioToCss(ratio.ratio);
  const imageReady = Boolean(generatedImagePath && !broken);
  const { rootRef } = useFirstImageReveal({ imageReady, generating });

  return (
    <section
      ref={rootRef}
      className="flex h-full min-h-0 w-full flex-col px-6 pb-5 sm:px-10"
      data-testid="onboarding-step-4"
      data-theater-theme="reveal"
    >
      {!imageReady && (
        <div className="shrink-0 pt-2 sm:pt-4">
          <h2
            className="font-theater text-[30px] font-extrabold leading-[1.15] text-primary outline-none"
            tabIndex={-1}
            data-onboarding-step-heading
          >
            让第一个方向<span className="text-accent">显形</span>
          </h2>
          <p className="mt-2 max-w-[36rem] text-[15px] leading-7 text-secondary">
            我们已经准备好一条示例提示词。选择画幅，看看它会变成什么。
          </p>
        </div>
      )}

      <div className="relative mt-5 min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
        <div
          data-theater-stage
          className="relative h-full max-h-full w-auto max-w-full overflow-hidden rounded-[var(--radius-media)] border border-border-subtle bg-inset"
          style={{ aspectRatio: aspectCss }}
          data-testid={imageReady ? 'onboarding-result' : undefined}
        >
          {imageReady ? (
            <>
              <img
                data-theater-image
                src={generatedImagePath ? toImageSrc(generatedImagePath) : ''}
                alt="你的第一张图"
                onError={() => setBroken(true)}
                className="h-full w-full object-contain"
                data-testid="onboarding-result-image"
              />
              <span
                data-theater-stamp
                className="pointer-events-none absolute right-[7%] top-[9%] h-3.5 w-3.5 rounded-full bg-accent"
                aria-hidden="true"
              />
            </>
          ) : generating ? (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-tertiary"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              <span className="text-meta">
                {track === 'doubao' ? '豆包正在生成（最长约 3 分钟）' : '正在显形'}
              </span>
            </div>
          ) : generateError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-danger">
              <AlertCircle className="h-5 w-5" aria-hidden="true" />
              <p className="max-w-[36ch] text-meta leading-relaxed" data-testid="onboarding-generate-error">
                {generateError.message}
              </p>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-meta text-quaternary">
              画布等待显形
            </div>
          )}
        </div>
        </div>
      </div>

      {!imageReady && (
        <div className="mt-5 shrink-0">
          <p className="max-w-[40rem] text-[13px] leading-6 text-secondary">{EXAMPLE_PROMPT}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
            <OptionGroup label="画幅">
              {RATIO_OPTIONS.filter((item) => item.id !== 'auto').slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRatioId(item.id)}
                  aria-pressed={ratioId === item.id}
                  data-testid={`onboarding-ratio-${item.id}`}
                  className={cn(
                    'no-drag rounded-md border px-2.5 py-1 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                    ratioId === item.id
                      ? 'border-primary bg-primary text-background'
                      : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </OptionGroup>
            {track !== 'doubao' && (
              <OptionGroup label="质量">
                {QUALITY_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setQuality(item.id)}
                    aria-pressed={quality === item.id}
                    data-testid={`onboarding-quality-${item.id}`}
                    className={cn(
                      'no-drag rounded-md border px-2.5 py-1 text-meta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                      quality === item.id
                        ? 'border-primary bg-primary text-background'
                        : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </OptionGroup>
            )}
          </div>
          <Button
            className="mt-5 rounded-md px-5"
            size="lg"
            onClick={() => void generateFirstImage()}
            disabled={generating}
            data-testid="onboarding-generate"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            )}
            {generating ? '正在显形' : '生成第一张图'}
          </Button>
        </div>
      )}

      {imageReady && (
        <div className="mt-4 flex shrink-0 items-center justify-between gap-3">
          <p className="text-[13px] font-medium text-secondary">第一张图已加入生成历史</p>
          <Button className="rounded-md px-4" onClick={finish} data-testid="onboarding-finish">
            完成，进入创作
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
