import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const BUNDLED_WORKSPACE_PACKAGES = [
  '@musefold/cloud-client',
  '@musefold/contracts',
  '@musefold/desktop-contracts',
  '@musefold/desktop-db',
  '@musefold/domain',
  '@musefold/update-protocol',
  '@musefold/core',
  '@musefold/automation-server',
  '@musefold/new-api-client',
] as const;

// 纯 JS 运行时依赖也进 bundle(M5-b):electron-builder 的 pnpm 收集器会
// 剥掉嵌套传递依赖(如 lazystream → readable-stream@2),bundle 免疫。
const BUNDLED_RUNTIME_DEPS = ['archiver', 'archiver-utils', 'yauzl'] as const;

describe('Electron main workspace bundling', () => {
  it('bundles cloud sync workspace packages instead of loading TypeScript at runtime', () => {
    const config = readFileSync(
      new URL('../../../electron.vite.config.ts', import.meta.url),
      'utf8',
    );

    expect(config).toMatch(/from ['"]\.\.\/\.\.\/tooling\/aliases\.mjs['"]/);
    expect(config).toMatch(/pickAliases\s*\(/);
    expect(config).toMatch(
      /externalizeDeps:\s*\{\s*exclude:\s*\[\s*'@musefold\/cloud-client',\s*'@musefold\/contracts',\s*'@musefold\/desktop-contracts',\s*'@musefold\/desktop-db',\s*'@musefold\/domain',\s*'@musefold\/update-protocol',\s*'@musefold\/core',\s*'@musefold\/automation-server',\s*'@musefold\/new-api-client',/s,
    );

    for (const name of [...BUNDLED_WORKSPACE_PACKAGES, ...BUNDLED_RUNTIME_DEPS]) {
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
