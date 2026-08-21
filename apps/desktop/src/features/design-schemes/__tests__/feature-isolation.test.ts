import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const schemesDir = join(dir, '..');

describe('design-schemes feature isolation', () => {
  it('does not import generation/workbench directly', () => {
    const files = readdirSync(schemesDir).filter(
      (name) => name.endsWith('.ts') || name.endsWith('.tsx'),
    );
    for (const file of files) {
      const source = readFileSync(join(schemesDir, file), 'utf8');
      expect(source, `${file} must not import generation/workbench`).not.toContain('generation/workbench');
      expect(source, `${file} must not import generation/params`).not.toContain('generation/params');
    }
  });
});
