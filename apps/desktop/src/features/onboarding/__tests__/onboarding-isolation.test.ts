import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const onboardingDir = join(dir, '..');

describe('onboarding feature isolation', () => {
  it('keeps generation and account imports in onboardingCrossFeature', () => {
    const files = readdirSync(onboardingDir).filter(
      (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
    );
    for (const file of files) {
      if (file === 'onboardingCrossFeature.ts' || file === 'store.ts') continue;
      const source = readFileSync(join(onboardingDir, file), 'utf8');
      expect(source, `${file} must not import generation directly`).not.toContain('../generation/');
      expect(source, `${file} must not import account directly`).not.toContain('../account/');
    }
  });
});
