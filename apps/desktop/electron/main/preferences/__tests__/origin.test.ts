import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  load: vi.fn(),
  execute: vi.fn(),
  destroy: vi.fn(),
  create: vi.fn(),
  open: vi.fn(),
  on: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => mocks.userData },
  BrowserWindow: class {
    constructor(options: unknown) {
      mocks.create(options);
    }
    loadURL = mocks.load;
    destroy = mocks.destroy;
    isDestroyed = () => false;
    webContents = {
      executeJavaScript: mocks.execute,
      setWindowOpenHandler: mocks.open,
      on: mocks.on,
    };
  },
}));
vi.mock('../../../system/logger', () => ({ createLogger: () => ({ warn: mocks.warn }) }));
vi.mock('../../app-protocol', () => ({ APP_ORIGIN: 'app://musefold' }));
vi.mock('../../renderer-bundle', () => ({ getBuiltinRendererRoot: () => '/synthetic/builtin' }));

import { prepareLegacyPreferencesMigration, readLegacyPreferenceOrigin } from '../origin';

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('ELECTRON_RENDERER_URL', '');
  mocks.userData = await mkdtemp(join(tmpdir(), 'musefold-preferences-origin-'));
  mocks.load.mockResolvedValue(undefined);
  mocks.execute.mockResolvedValue({});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await rm(mocks.userData, { recursive: true, force: true });
});

describe('desktop preference origin reader', () => {
  it('reads only allowlisted keys in a hidden sandbox with no preload and destroys both origin windows', async () => {
    await prepareLegacyPreferencesMigration();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith({
      show: false,
      width: 320,
      height: 240,
      focusable: false,
      skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    expect(mocks.load.mock.calls.map((call) => call[0])).toEqual([
      'file:///synthetic/builtin/storage-export.html',
      'app://musefold/storage-export.html',
    ]);
    const script = mocks.execute.mock.calls[0][0] as string;
    expect(script).toContain('musefold:app-preferences');
    expect(script).toContain('localStorage.getItem(key)');
    expect(script).not.toMatch(/localStorage\.(key|removeItem|setItem|clear)\(/);
    expect(mocks.open.mock.calls[0][0]()).toEqual({ action: 'deny' });
    const event = { preventDefault: vi.fn() };
    mocks.on.mock.calls[0][1](event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledTimes(2);
  });
  it('does not open an origin for development or an existing v2.5 file', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173');
    await prepareLegacyPreferencesMigration();
    expect(mocks.create).not.toHaveBeenCalled();
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    await writeFile(join(mocks.userData, 'v25-preferences.json'), '{}');
    await prepareLegacyPreferencesMigration();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('keeps data untouched, closes the hidden window and logs no raw failure details', async () => {
    mocks.load.mockRejectedValue(new Error('synthetic-private-storage-value'));
    await prepareLegacyPreferencesMigration();
    expect(await readdir(mocks.userData)).toEqual([]);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledWith('旧版偏好迁移未完成，保留原数据并在下次启动重试');
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('synthetic-private-storage-value');
  });
  it('bounds an unresponsive origin and destroys its window', async () => {
    vi.useFakeTimers();
    mocks.load.mockReturnValue(new Promise(() => {}));
    const pending = expect(readLegacyPreferenceOrigin('app')).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8000);
    await pending;
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
