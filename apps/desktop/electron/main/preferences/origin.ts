import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createLogger } from '../../system/logger';
import { APP_ORIGIN } from '../app-protocol';
import { getBuiltinRendererRoot } from '../renderer-bundle';
import { LEGACY_PREFERENCE_KEYS, LEGACY_PREFERENCE_MAX_BYTES } from './legacy';
import { migrateLegacyPreferences } from './storage';

const logger = createLogger('v25-preferences-migration');
const timeoutMs = 8_000;

// No raw storage enumeration, IPC channel or new renderer API. Unknown keys and
// credentials never leave their old origin. Old keys are deliberately not deleted.
const readScript = `(() => {
  const result = {};
  for (const key of ${JSON.stringify(LEGACY_PREFERENCE_KEYS)}) {
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (new TextEncoder().encode(value).byteLength > ${LEGACY_PREFERENCE_MAX_BYTES}) {
      throw new Error('Legacy preference exceeds migration limit');
    }
    result[key] = value;
  }
  return result;
})()`;

export async function readLegacyPreferenceOrigin(origin: 'app' | 'file'): Promise<unknown> {
  let window: BrowserWindow | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    window = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      focusable: false,
      skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const page = window;
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    page.webContents.on('will-navigate', (event) => event.preventDefault());
    const url =
      origin === 'app'
        ? `${APP_ORIGIN}/storage-export.html`
        : pathToFileURL(join(getBuiltinRendererRoot(), 'storage-export.html')).href;
    return await Promise.race([
      (async () => {
        await page.loadURL(url);
        return page.webContents.executeJavaScript(readScript);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Legacy preference read timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    // window-all-closed must remain suppressed through the hidden window destroy.
    if (window && !window.isDestroyed()) window.destroy();
  }
}

export async function prepareLegacyPreferencesMigration(): Promise<void> {
  // Production has a stable app:// origin. Do not import data from a dev-server origin.
  if (process.env.ELECTRON_RENDERER_URL) return;
  try {
    await migrateLegacyPreferences({
      destination: join(app.getPath('userData'), 'v25-preferences.json'),
      readOrigin: readLegacyPreferenceOrigin,
    });
  } catch {
    // Preserve all original bytes and retry on next startup. Never log storage values.
    logger.warn('旧版偏好迁移未完成，保留原数据并在下次启动重试');
  }
}
