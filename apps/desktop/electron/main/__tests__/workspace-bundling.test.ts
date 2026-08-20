import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLED_WORKSPACE_PACKAGES = [
  '@musefold/cloud-client',
  '@musefold/contracts',
  '@musefold/desktop-contracts',
  '@musefold/domain',
  '@musefold/update-protocol',
  '@musefold/core',
  '@musefold/automation-server',
] as const;

describe('Electron main workspace bundling', () => {
  it('bundles cloud sync workspace packages instead of loading TypeScript at runtime', () => {
    const config = readFileSync(
      new URL('../../../electron.vite.config.ts', import.meta.url),
      'utf8',
    );

    expect(config).toMatch(/from ['"]\.\.\/\.\.\/tooling\/aliases\.mjs['"]/);
    expect(config).toMatch(/pickAliases\s*\(/);
    expect(config).toMatch(
      /externalizeDeps:\s*\{\s*exclude:\s*\[\s*'@musefold\/cloud-client',\s*'@musefold\/contracts',\s*'@musefold\/desktop-contracts',\s*'@musefold\/domain',\s*'@musefold\/update-protocol',\s*'@musefold\/core',\s*'@musefold\/automation-server',?\s*\]/s,
    );

    for (const name of BUNDLED_WORKSPACE_PACKAGES) {
      expect(config).toContain(`'${name}'`);
    }
  });

  it('将 desktop-contracts 打进沙箱 preload，而不是运行时 require 包名', () => {
    const config = readFileSync(
      new URL('../../../electron.vite.config.ts', import.meta.url),
      'utf8',
    );
    const preload = config.split('preload:')[1]?.split('renderer:')[0] ?? '';
    expect(preload).toMatch(
      /externalizeDeps:\s*\{\s*exclude:\s*\[[^\]]*@musefold\/desktop-contracts/,
    );
    expect(preload).toMatch(/@musefold\/domain/);
  });
});
