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
