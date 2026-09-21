import { appPreferencesSchema, defaultAppPreferences } from '@musefold/contracts';
import { randomUUID } from 'node:crypto';
import { link, lstat, open, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { legacyPreferencesPatch } from './legacy';

export async function migrateLegacyPreferences(options: {
  destination: string;
  readOrigin: (origin: 'app' | 'file') => Promise<unknown>;
  now?: () => Date;
}): Promise<'existing' | 'migrated'> {
  try {
    await lstat(options.destination);
    // Existing v2.5 choices, including a damaged file, must never be overwritten.
    return 'existing';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const at = (options.now ?? (() => new Date()))().toISOString();
  const read = async (origin: 'app' | 'file') => {
    const snapshot = await options.readOrigin(origin);
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('Legacy preference snapshot unavailable');
    }
    return legacyPreferencesPatch(snapshot, at);
  };
  const file = await read('file');
  const app = await read('app');
  const next = appPreferencesSchema.parse({ ...defaultAppPreferences, ...file, ...app });
  const temporary = join(dirname(options.destination), `.v25-preferences-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(next, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // Atomic publication without overwriting a concurrently-created v2.5 file.
      await link(temporary, options.destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return 'existing';
      throw error;
    }
    return 'migrated';
  } finally {
    await unlink(temporary);
  }
}
