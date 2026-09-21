import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPortAvailable, prepareStandaloneWeb } from '../../scripts/start-v25-web.mjs';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'v25-standalone-'));
  roots.push(root);
  const web = join(root, 'apps/web-next');
  const runtime = join(web, '.next/standalone/apps/web-next');
  const write = (file: string, body: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  };
  write(join(web, '.next/BUILD_ID'), 'build-a');
  write(join(runtime, '.next/BUILD_ID'), 'build-a');
  write(join(runtime, 'server.js'), 'export {};');
  write(join(web, '.next/static/chunks/app.js'), 'current chunk');
  return { root, web, runtime, write };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('v2.5 standalone Web preparation', () => {
  it('serves matching production chunks/public and removes obsolete copied assets', () => {
    const { root, web, runtime, write } = fixture();
    write(join(web, 'public/icon.svg'), '<svg/>');
    write(join(runtime, '.next/static/obsolete.js'), 'obsolete');
    expect(prepareStandaloneWeb(root)).toBe(join(runtime, 'server.js'));
    expect(readFileSync(join(runtime, '.next/static/chunks/app.js'), 'utf8')).toBe('current chunk');
    expect(readFileSync(join(runtime, 'public/icon.svg'), 'utf8')).toBe('<svg/>');
    expect(existsSync(join(runtime, '.next/static/obsolete.js'))).toBe(false);
    rmSync(join(web, 'public'), { recursive: true });
    prepareStandaloneWeb(root);
    expect(existsSync(join(runtime, 'public'))).toBe(false);
  });

  it('fails without a production build rather than starting a development server', () => {
    const { root, runtime } = fixture();
    rmSync(join(runtime, 'server.js'));
    expect(() => prepareStandaloneWeb(root)).toThrow('Missing standalone production build');
  });

  it('refuses to mix stale server output with new client chunks', () => {
    const { root, runtime, write } = fixture();
    write(join(runtime, '.next/BUILD_ID'), 'build-old');
    expect(() => prepareStandaloneWeb(root)).toThrow('Standalone build is stale');
  });

  it('lets a free port through', async () => {
    // Port 0 binds an ephemeral port, so the probe always succeeds.
    await expect(assertPortAvailable(0)).resolves.toBeUndefined();
  });

  it('names the owning process instead of sharing the fixed E2E port', async () => {
    const blocker = createServer();
    const boundByTest = await new Promise<boolean>((settled) => {
      // 外部进程已占住 3399 时同样必须拒绝;此时 blocker 归他人,不能关。
      blocker.once('error', () => settled(false));
      blocker.listen(3399, '127.0.0.1', () => settled(true));
    });
    try {
      await expect(assertPortAvailable(3399)).rejects.toThrow(/Port 3399[\s\S]*pid \d+/);
    } finally {
      if (boundByTest) await new Promise<void>((settled) => blocker.close(() => settled()));
    }
  });
});
