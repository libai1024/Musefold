import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Electron main workspace bundling', () => {
  it('bundles cloud sync workspace packages instead of loading TypeScript at runtime', () => {
    const config = readFileSync(
      new URL('../../../electron.vite.config.ts', import.meta.url),
      'utf8',
    );

    expect(config).toMatch(
      /externalizeDeps:\s*\{\s*exclude:\s*\[\s*'@musefold\/cloud-client',\s*'@musefold\/contracts',\s*'@musefold\/desktop-contracts',\s*'@musefold\/domain',\s*'@musefold\/update-protocol',\s*'@musefold\/core',\s*'@musefold\/automation-server',?\s*\]/s,
    );
    expect(config).toMatch(
      /'@musefold\/cloud-client':\s*resolve\([\s\S]*?'packages\/cloud-client\/src'/,
    );
    expect(config).toMatch(/'@musefold\/contracts':\s*resolve\([^)]*'packages\/contracts\/src'/);
    expect(config).toMatch(
      /'@musefold\/desktop-contracts':\s*desktopContractsSrc/,
    );
    expect(config).toMatch(/'@musefold\/domain':\s*domainSrc/);
    expect(config).toMatch(
      /'@musefold\/update-protocol':\s*resolve\([\s\S]*?'packages\/update-protocol\/src'/,
    );
    expect(config).toMatch(/'@musefold\/core':\s*resolve\([\s\S]*?'packages\/core\/src'/);
    expect(config).toMatch(
      /'@musefold\/automation-server':\s*resolve\([\s\S]*?'packages\/automation-server\/src'/,
    );
  });
});
