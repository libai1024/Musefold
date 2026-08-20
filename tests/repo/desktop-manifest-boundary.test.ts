import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;
const desktop = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')) as {
  name?: unknown;
  version?: unknown;
  main?: unknown;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};
const builder = readFileSync('apps/desktop/electron-builder.yml', 'utf8');

describe('Desktop App manifest boundary', () => {
  it('keeps the repository root as a development-only workspace manifest', () => {
    expect(workspace.name).toBe('@musefold/workspace');
    expect(workspace).not.toHaveProperty('version');
    expect(workspace).not.toHaveProperty('main');
    expect(workspace).not.toHaveProperty('dependencies');
    expect(workspace).toHaveProperty('devDependencies.electron-builder');
  });

  it('owns runtime metadata and dependencies below apps/desktop', () => {
    expect(desktop.name).toBe('musefold-app');
    expect(desktop.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(desktop.main).toBe('./out/main/index.js');
    expect(desktop.scripts?.postinstall).toBe('electron-builder install-app-deps');
    expect(desktop.dependencies).toHaveProperty('better-sqlite3');
    expect(desktop.dependencies).toHaveProperty('electron-store');
  });

  it('preserves the packaged asar entry while the development entry stays app-relative', () => {
    expect(builder).toMatch(/^extraMetadata:\n\s+main: \.\/apps\/desktop\/out\/main\/index\.js$/m);
    expect(builder).toMatch(/^\s+output: \.\.\/\.\.\/release$/m);
  });
});
