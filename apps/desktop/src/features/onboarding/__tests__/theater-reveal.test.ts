import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { clearTheaterIdle, markTheaterIdle, theaterReducedMotion } from '../useTheaterReveal';

describe('theaterReducedMotion', () => {
  it('treats an explicit on preference as reduced', () => {
    expect(theaterReducedMotion('on')).toBe(true);
    expect(theaterReducedMotion('off')).toBe(false);
  });
});

describe('markTheaterIdle', () => {
  it('sets the idle hook once and emits animationend', () => {
    const dispatchEvent = vi.fn();
    const node = {
      dataset: {} as DOMStringMap,
      dispatchEvent,
    } as unknown as HTMLElement;

    markTheaterIdle(node);
    markTheaterIdle(node);

    expect(node.dataset.theaterIdle).toBe('true');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: 'animationend' });
  });

  it('can clear the idle hook', () => {
    const node = { dataset: { theaterIdle: 'true' } as DOMStringMap } as unknown as HTMLElement;
    clearTheaterIdle(node);
    expect(node.dataset.theaterIdle).toBeUndefined();
  });
});

describe('first image prompt policy', () => {
  it('fills the example prompt and only generates on click', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../OnboardingStepFirstImage.tsx'),
      'utf8',
    );
    expect(source).toContain('EXAMPLE_PROMPT');
    expect(source).toContain('onClick={() => void generateFirstImage()}');
    expect(source).not.toMatch(/useEffect\(\(\)\s*=>\s*\{[^}]*generateFirstImage/);
    expect(source).toContain('<Sparkles');
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

describe('onboarding 2.0 surface', () => {
  it('keeps the app shell visible behind a modal theater surface', () => {
    const base = join(dirname(fileURLToPath(import.meta.url)), '..');
    const flow = readFileSync(join(base, 'OnboardingFlow.tsx'), 'utf8');
    const welcome = readFileSync(join(base, 'OnboardingStepWelcome.tsx'), 'utf8');
    const ui = readFileSync(join(base, 'onboarding-ui.tsx'), 'utf8');
    const overlays = readFileSync(join(base, '../../styles/overlays-v2.css'), 'utf8');

    expect(flow).toContain('mf-onboarding-overlay');
    expect(flow).toContain('mf-onboarding-surface');
    expect(flow).toContain('<Dialog.Content');
    expect(flow).toContain('<Dialog.Title');
    expect(ui).toContain('data-onboarding-step-heading');
    expect(flow).not.toContain('bg-background text-primary');
    expect(welcome).toContain("./floating-library-onboarding.webp");
    expect(welcome).toContain('mf-onboarding-welcome-image');
    expect(overlays).toContain('width: min(1080px, calc(100vw - 48px))');
    expect(overlays).toContain('height: min(720px, calc(100vh - 48px))');
    expect(overlays).toContain('border-radius: var(--radius-theater)');
    expect(overlays).toContain('background: var(--scrim-onboarding)');
  });

  it('keeps operate controls on the 8px control radius', () => {
    const base = join(dirname(fileURLToPath(import.meta.url)), '..');
    const connect = readFileSync(join(base, 'OnboardingStepConnect.tsx'), 'utf8');
    const validate = readFileSync(join(base, 'OnboardingStepValidate.tsx'), 'utf8');
    const overlays = readFileSync(join(base, '../../styles/overlays-v2.css'), 'utf8');

    expect(connect).not.toMatch(/<Button[^>]*rounded-full/);
    expect(validate).not.toMatch(/<Button[^>]*rounded-full/);
    expect(overlays).toContain('border-radius: var(--radius-control)');
    expect(connect).toContain('mf-onboarding-qr-stage');
  });
});
