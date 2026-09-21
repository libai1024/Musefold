import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateLegacyPreferences } from '../storage';

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'musefold-preferences-migration-'));
  directories.push(directory);
  return { directory, destination: join(directory, 'v25-preferences.json') };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe('one-time desktop legacy preferences migration', () => {
  it('uses the app origin over the file origin per recognized field, persists and preserves original snapshots', async () => {
    const { directory, destination } = await fixture();
    const snapshots = {
      file: { 'musefold:theme': 'dark', 'musefold:density': 'compact' },
      app: { 'musefold:theme': 'light', 'musefold:onboarded': '1' },
    };
    const original = JSON.stringify(snapshots);
    expect(
      await migrateLegacyPreferences({
        destination,
        readOrigin: async (origin) => snapshots[origin],
        now: () => new Date('2026-09-21T02:00:00.000Z'),
      }),
    ).toBe('migrated');
    expect(JSON.parse(await readFile(destination, 'utf8'))).toMatchObject({
      theme: 'light',
      density: 'compact',
      onboardingCompletedAt: '2026-09-21T02:00:00.000Z',
    });
    expect(JSON.stringify(snapshots)).toBe(original);
    expect(await readdir(directory)).toEqual(['v25-preferences.json']);
    expect(
      await migrateLegacyPreferences({
        destination,
        readOrigin: async () => {
          throw new Error('must not reread');
        },
      }),
    ).toBe('existing');
  });
  it.each(['{"theme":"dark","language":"en-US"}', '{damaged'])(
    'never overwrites an existing v2.5 file: %s',
    async (content) => {
      const { destination } = await fixture();
      await writeFile(destination, content);
      expect(
        await migrateLegacyPreferences({
          destination,
          readOrigin: async () => {
            throw new Error('must not read');
          },
        }),
      ).toBe('existing');
      expect(await readFile(destination, 'utf8')).toBe(content);
    },
  );
  it.each(['app', 'file'])(
    'leaves no partial destination when %s origin fails and succeeds on a later retry',
    async (failed) => {
      const { directory, destination } = await fixture();
      await expect(
        migrateLegacyPreferences({
          destination,
          readOrigin: async (origin) => {
            if (origin === failed) throw new Error('origin unavailable');
            return { 'musefold:theme': 'dark' };
          },
        }),
      ).rejects.toThrow('origin unavailable');
      expect(await readdir(directory)).toEqual([]);
      await migrateLegacyPreferences({
        destination,
        readOrigin: async () => ({ 'musefold:theme': 'dark' }),
      });
      expect(JSON.parse(await readFile(destination, 'utf8')).theme).toBe('dark');
    },
  );
  it('does not replace an intervening current preference write', async () => {
    const { directory, destination } = await fixture();
    expect(
      await migrateLegacyPreferences({
        destination,
        readOrigin: async (origin) => {
          if (origin === 'app')
            await writeFile(destination, '{"theme":"light","language":"en-US"}');
          return { 'musefold:theme': 'dark' };
        },
      }),
    ).toBe('existing');
    expect(JSON.parse(await readFile(destination, 'utf8')).theme).toBe('light');
    expect(await readdir(directory)).toEqual(['v25-preferences.json']);
  });
  it('persists a one-time marker via valid default preferences for a new user', async () => {
    const { destination } = await fixture();
    await migrateLegacyPreferences({ destination, readOrigin: async () => ({}) });
    expect(JSON.parse(await readFile(destination, 'utf8'))).toMatchObject({
      theme: 'system',
      defaultCount: 1,
      onboardingCompletedAt: null,
    });
    expect(
      await migrateLegacyPreferences({
        destination,
        readOrigin: async () => {
          throw new Error('must not open windows on subsequent starts');
        },
      }),
    ).toBe('existing');
  });
  it('keeps an explicit app-origin onboarding reset over an older file-origin completion', async () => {
    const { destination } = await fixture();
    await migrateLegacyPreferences({
      destination,
      readOrigin: async (origin) =>
        origin === 'app'
          ? { 'musefold:onboarding': JSON.stringify({ state: { onboarded: false }, version: 1 }) }
          : { 'musefold:onboarded': '1' },
    });
    expect(JSON.parse(await readFile(destination, 'utf8')).onboardingCompletedAt).toBeNull();
  });
  it('does not treat an unavailable snapshot as an empty successful migration', async () => {
    const { directory, destination } = await fixture();
    await expect(
      migrateLegacyPreferences({ destination, readOrigin: async () => null }),
    ).rejects.toThrow('snapshot unavailable');
    expect(await readdir(directory)).toEqual([]);
  });
});
