import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protocolMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  handle: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => `/tmp/musefold-mock/${name}`,
  },
  protocol: {
    registerSchemesAsPrivileged: protocolMocks.registerSchemesAsPrivileged,
    handle: protocolMocks.handle,
  },
}));

import { registerMediaScheme } from './media-protocol';
import {
  APP_HOST,
  APP_MAIN_ENTRY,
  APP_ORIGIN,
  APP_PET_ENTRY,
  APP_SCHEME,
  E2E_SEARCH,
  buildAppEntryUrl,
  handleAppRequest,
  isAppOriginUrl,
  registerAppProtocolHandler,
  registerAppScheme,
  resolveMainWindowLoadUrl,
  resolvePetWindowLoadUrl,
} from './app-protocol';
import { APP_SCHEME_PRIVILEGES } from './privileged-schemes';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeTree(root: string, files: Record<string, string | Buffer>): void {
  for (const [relative, content] of Object.entries(files)) {
    const abs = join(root, relative);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

function completeBundle(files: Record<string, string | Buffer> = {}): string {
  const root = tempDir('musefold-app-protocol-');
  writeTree(root, {
    'index.html': '<html>index-root</html>',
    'pet.html': '<html>pet-root</html>',
    ...files,
  });
  return root;
}

async function request(pathAndQuery: string, root: string): Promise<Response> {
  return handleAppRequest(`${APP_ORIGIN}${pathAndQuery}`, { root });
}

beforeEach(() => {
  protocolMocks.registerSchemesAsPrivileged.mockClear();
  protocolMocks.handle.mockClear();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('app:// entry URL construction', () => {
  it('builds both renderer entries on the same frozen origin', () => {
    const main = buildAppEntryUrl(APP_MAIN_ENTRY);
    const pet = buildAppEntryUrl(APP_PET_ENTRY);
    expect(main).toBe(`${APP_ORIGIN}/index.html`);
    expect(pet).toBe(`${APP_ORIGIN}/pet.html`);
    const mainUrl = new URL(main);
    const petUrl = new URL(pet);
    // Node 对非特殊 scheme 的 origin 是 "null"；同源用 protocol + host 判定。
    expect(mainUrl.protocol).toBe(`${APP_SCHEME}:`);
    expect(petUrl.protocol).toBe(`${APP_SCHEME}:`);
    expect(mainUrl.host).toBe(APP_HOST);
    expect(petUrl.host).toBe(APP_HOST);
    expect(`${mainUrl.protocol}//${mainUrl.host}`).toBe(APP_ORIGIN);
    expect(`${petUrl.protocol}//${petUrl.host}`).toBe(APP_ORIGIN);
  });

  it('appends the E2E search string only on the main entry when requested', () => {
    expect(buildAppEntryUrl(APP_MAIN_ENTRY, { e2e: true })).toBe(
      `${APP_ORIGIN}/index.html?${E2E_SEARCH}`,
    );
    expect(buildAppEntryUrl(APP_MAIN_ENTRY, { e2e: false })).toBe(`${APP_ORIGIN}/index.html`);
    expect(buildAppEntryUrl(APP_PET_ENTRY, { e2e: true })).toBe(
      `${APP_ORIGIN}/pet.html?${E2E_SEARCH}`,
    );
    expect(new URL(buildAppEntryUrl(APP_MAIN_ENTRY, { e2e: true })).search).toBe(`?${E2E_SEARCH}`);
  });

  it('treats only the frozen origin as in-app navigation', () => {
    expect(isAppOriginUrl(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(isAppOriginUrl(`${APP_ORIGIN}/index.html?${E2E_SEARCH}`)).toBe(true);
    expect(isAppOriginUrl(`${APP_ORIGIN}/pet.html`)).toBe(true);
    expect(isAppOriginUrl('file:///tmp/out/renderer/index.html')).toBe(false);
    expect(isAppOriginUrl('app://other/index.html')).toBe(false);
    expect(isAppOriginUrl('https://example.com/')).toBe(false);
  });
});

describe('window load URL branch selection', () => {
  it('keeps the Electron renderer URL branch character-identical in development', () => {
    expect(resolveMainWindowLoadUrl('http://localhost:5173', false)).toBe('http://localhost:5173');
    expect(resolveMainWindowLoadUrl('http://localhost:5173', true)).toBe(
      'http://localhost:5173?musefold_e2e=1',
    );
    expect(resolveMainWindowLoadUrl('http://localhost:5173/?foo=1', true)).toBe(
      'http://localhost:5173/?foo=1&musefold_e2e=1',
    );
    expect(resolvePetWindowLoadUrl('http://localhost:5173/')).toBe(
      'http://localhost:5173/pet.html',
    );
    expect(resolvePetWindowLoadUrl('http://localhost:5173')).toBe(
      'http://localhost:5173/pet.html',
    );
  });

  it('loads production windows from app:// without a second bundle-root lookup', () => {
    expect(resolveMainWindowLoadUrl(undefined, false)).toBe(`${APP_ORIGIN}/index.html`);
    expect(resolveMainWindowLoadUrl(undefined, true)).toBe(
      `${APP_ORIGIN}/index.html?${E2E_SEARCH}`,
    );
    expect(resolvePetWindowLoadUrl(undefined)).toBe(`${APP_ORIGIN}/pet.html`);
    expect(resolveMainWindowLoadUrl('', false)).toBe(`${APP_ORIGIN}/index.html`);
    const mainProd = new URL(resolveMainWindowLoadUrl(undefined, true));
    const petProd = new URL(resolvePetWindowLoadUrl(undefined));
    expect(`${mainProd.protocol}//${mainProd.host}`).toBe(APP_ORIGIN);
    expect(`${petProd.protocol}//${petProd.host}`).toBe(APP_ORIGIN);
  });

  it('keeps both window modules on the shared URL helper instead of origin literals', async () => {
    const { readFileSync } = await import('node:fs');
    const mainWindow = readFileSync('electron/main/window.ts', 'utf8');
    const petWindow = readFileSync('electron/main/pet/window.ts', 'utf8');
    expect(mainWindow).toContain('resolveMainWindowLoadUrl');
    expect(petWindow).toContain('resolvePetWindowLoadUrl');
    expect(mainWindow).toContain('isAppOriginUrl');
    expect(petWindow).toContain('isAppOriginUrl');
    expect(mainWindow).not.toContain('app://musefold');
    expect(petWindow).not.toContain('app://musefold');
    expect(mainWindow).not.toContain("loadFile(join(appRoot, 'out/renderer/index.html')");
    expect(petWindow).not.toContain("loadFile(join(appRoot, 'out/renderer/pet.html')");
  });
});

describe('app:// privileged scheme registration', () => {
  it('declares media and app schemes together exactly once', () => {
    registerMediaScheme();
    registerAppScheme();
    registerAppScheme();

    expect(protocolMocks.registerSchemesAsPrivileged).toHaveBeenCalledTimes(1);
    const schemes = protocolMocks.registerSchemesAsPrivileged.mock.calls[0]?.[0] as Array<{
      scheme: string;
      privileges: Record<string, boolean | undefined>;
    }>;
    expect(schemes.map((entry) => entry.scheme)).toEqual(['media', APP_SCHEME]);
    const appPrivileges = APP_SCHEME_PRIVILEGES.privileges;
    expect(appPrivileges).toMatchObject({
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    });
    expect(appPrivileges?.bypassCSP).toBeUndefined();
    expect(appPrivileges?.allowServiceWorkers).toBeUndefined();
  });

  it('registers a thin protocol.handle wrapper that freezes the bundle root', () => {
    const root = completeBundle();
    registerAppProtocolHandler(root);
    expect(protocolMocks.handle).toHaveBeenCalledTimes(1);
    expect(protocolMocks.handle.mock.calls[0]?.[0]).toBe(APP_SCHEME);
    expect(protocolMocks.handle.mock.calls[0]?.[1]).toEqual(expect.any(Function));
  });
});

describe('handleAppRequest', () => {
  it(`rejects hosts other than ${APP_HOST}`, async () => {
    const root = completeBundle();
    for (const url of [
      'app://other/index.html',
      'app://musefold.evil/index.html',
      'app://musefold:80/index.html',
      'app://Musefold/index.html',
      'app:///index.html',
    ]) {
      const response = await handleAppRequest(url, { root });
      expect(response.status, url).toBe(403);
    }
  });

  it('rejects path traversal, encoded traversal, and absolute path forms', async () => {
    const root = completeBundle();
    const outside = tempDir('musefold-app-protocol-outside-');
    writeTree(outside, { 'secret.txt': 'OUTSIDE' });

    const urls = [
      `${APP_ORIGIN}/../${outside}/secret.txt`,
      `${APP_ORIGIN}/%2e%2e%2fsecret.txt`,
      `${APP_ORIGIN}/%2e%2e/%2e%2e/secret.txt`,
      `${APP_ORIGIN}/%2Fetc%2Fpasswd`,
      `${APP_ORIGIN}//etc/passwd`,
    ];

    for (const url of urls) {
      const response = await handleAppRequest(url, { root });
      expect(response.status, url).toBe(403);
      expect(await response.text(), url).not.toContain('OUTSIDE');
    }
  });

  it('rejects a symlink that escapes the bundle root', async () => {
    const root = completeBundle();
    const outside = tempDir('musefold-app-protocol-symlink-');
    writeTree(outside, { 'secret.js': 'export const leak = 1;\n' });
    symlinkSync(join(outside, 'secret.js'), join(root, 'escape.js'));

    const response = await request('/escape.js', root);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('leak');
  });

  it('serves pet.html from the same frozen bundle root as index.html', async () => {
    const root = completeBundle();
    const index = await request('/index.html', root);
    const pet = await request('/pet.html', root);
    expect(index.status).toBe(200);
    expect(pet.status).toBe(200);
    expect(await index.text()).toBe('<html>index-root</html>');
    expect(await pet.text()).toBe('<html>pet-root</html>');
  });

  it('ignores query string and hash when locating files', async () => {
    const root = completeBundle();
    const withQuery = await request('/index.html?musefold_e2e=1', root);
    const withHash = await request('/index.html#main', root);
    const withBoth = await request('/index.html?musefold_e2e=1#main', root);

    for (const response of [withQuery, withHash, withBoth]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('<html>index-root</html>');
    }
  });

  it('maps directory URLs to index.html and 404s misses without HTML fallback', async () => {
    const root = completeBundle({
      'nested/index.html': '<html>nested</html>',
    });

    const rootDir = await request('/', root);
    expect(rootDir.status).toBe(200);
    expect(await rootDir.text()).toBe('<html>index-root</html>');

    const nestedDir = await request('/nested/', root);
    expect(nestedDir.status).toBe(200);
    expect(await nestedDir.text()).toBe('<html>nested</html>');

    const missing = await request('/missing.js', root);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('Content-Type')).not.toMatch(/html/i);
    const missingBody = await missing.text();
    expect(missingBody).not.toMatch(/<html/i);
    expect(missingBody).not.toContain('index-root');

    const missingDir = await request('/no-such-dir/', root);
    expect(missingDir.status).toBe(404);
    expect(await missingDir.text()).not.toMatch(/<html/i);
  });

  it('serves critical MIME types and a no-store cache policy', async () => {
    const root = completeBundle({
      'app.js': 'export const n = 1;\n',
      'app.mjs': 'export const n = 2;\n',
      'app.css': 'body { color: black; }\n',
      'app.wasm': Buffer.from([0x00, 0x61, 0x73, 0x6d]),
    });

    const cases: Array<[string, string]> = [
      ['/index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'text/javascript; charset=utf-8'],
      ['/app.mjs', 'text/javascript; charset=utf-8'],
      ['/app.css', 'text/css; charset=utf-8'],
      ['/app.wasm', 'application/wasm'],
    ];

    for (const [path, mime] of cases) {
      const response = await request(path, root);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('Content-Type'), path).toBe(mime);
      expect(response.headers.get('Cache-Control'), path).toBe('no-store');
    }
  });
});
