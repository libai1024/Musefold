import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const script = resolve(repoRoot, 'scripts/derive-min-shell-version.mjs');

function run(args: string[]): string {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

describe('derive-min-shell-version', () => {
  it('self-test passes', () => {
    const stdout = run(['--self-test']);
    expect(stdout).toContain('derive-min-shell-version self-test: all passed');
  });

  it('derives minShellVersion from renderer source', () => {
    const parsed: unknown = JSON.parse(run([]).trim());
    expect(parsed).toEqual({
      minShellVersion: '0.5.0',
      floor: '0.5.0',
      usedMethods: expect.any(Number),
    });
    const payload = parsed as { usedMethods: number };
    expect(payload.usedMethods).toBeGreaterThan(0);
  });
});
