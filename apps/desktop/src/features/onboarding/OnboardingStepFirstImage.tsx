import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, Check, Loader2, Sparkles } from '../../components/ui/icons';
import { RATIO_OPTIONS } from '@musefold/domain/constants';
import type { ImageQuality } from '@musefold/desktop-contracts/enums';
import { EXAMPLE_PROMPT, useOnboardingStore } from './store';
import { Button } from '../../components/ui/button';
import { toImageSrc } from '../../lib/media';
import { cn } from '../../lib/utils';
import { OptionGroup, StepIntro } from './onboarding-ui';

const QUALITY_OPTIONS: { id: ImageQuality; label: string }[] = [
  { id: 'low', label: '标清' },
  { id: 'medium', label: '高清' },
  { id: 'high', label: '超清' },
];

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

  return (
    <section className="mx-auto flex w-full max-w-[620px] flex-col" data-testid="onboarding-step-4">
      <StepIntro title="让第一个方向显形">
        我们已经准备好一条示例提示词。选择画幅，看看它会变成什么。
      </StepIntro>

      <p className="mt-9 border-l border-border-strong pl-4 font-mono text-[12px] leading-6 text-secondary">
        {EXAMPLE_PROMPT}
      </p>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <OptionGroup label="画幅">
          {RATIO_OPTIONS.filter((r) => r.id !== 'auto').slice(0, 5).map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRatioId(r.id)}
              aria-pressed={ratioId === r.id}
              data-testid={`onboarding-ratio-${r.id}`}
              className={cn(
                'no-drag rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                ratioId === r.id
                  ? 'border-primary bg-primary text-background'
                  : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
              )}
            >
              {r.label}
            </button>
          ))}
        </OptionGroup>

        {track !== 'doubao' && <OptionGroup label="质量">
          {QUALITY_OPTIONS.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setQuality(q.id)}
              aria-pressed={quality === q.id}
              data-testid={`onboarding-quality-${q.id}`}
              className={cn(
                'no-drag rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]',
                quality === q.id
                  ? 'border-primary bg-primary text-background'
                  : 'border-border-default bg-elevated text-secondary hover:border-border-strong hover:text-primary',
              )}
            >
              {q.label}
            </button>
          ))}
        </OptionGroup>}
      </div>

      {!generatedImagePath && (
        <Button
          className="mt-10 self-start rounded-full px-5"
          size="lg"
          onClick={() => void generateFirstImage()}
          disabled={generating}
          data-testid="onboarding-generate"
        >
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating
            ? track === 'doubao' ? '豆包正在生成（最长约 3 分钟）…' : '正在显形（约 10-30 秒）…'
            : '生成第一张图'}
        </Button>
      )}

      {generateError && !generating && (
        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-danger" data-testid="onboarding-generate-error">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {generateError.message}
        </p>
      )}

      {generatedImagePath && !broken && (
        <div className="mt-8 flex flex-col items-start gap-3" data-testid="onboarding-result">
          <img
            src={toImageSrc(generatedImagePath)}
            alt="你的第一张图"
            onError={() => setBroken(true)}
            className="max-h-[300px] max-w-full rounded-xl border border-border-default object-contain"
            data-testid="onboarding-result-image"
          />
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-success">
            <Check className="h-4 w-4" />
            第一张图已加入生成历史
          </p>
        </div>
      )}

      <div className="mt-10 flex justify-end">
        <Button className="rounded-full px-4" onClick={finish} disabled={!generatedImagePath} data-testid="onboarding-finish">
          完成，进入创作
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}
