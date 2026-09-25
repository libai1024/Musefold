import { describe, expect, it } from 'vitest';
import {
  appUpdatePreferencesPatchSchema,
  appUpdateSnapshotSchema,
  appUpdateStatusSchema,
} from '../app-update';

/** UpdaterService 会产生的代表性状态(含 legacy 面同形样例)。 */
const STATUS_SAMPLES = [
  { state: 'disabled', currentVersion: '2.5.0', reason: 'development' },
  { state: 'disabled', currentVersion: '2.5.0', reason: 'unsupported-platform' },
  { state: 'disabled', currentVersion: '2.5.0', reason: 'disabled-by-environment' },
  { state: 'idle', currentVersion: '2.5.0' },
  { state: 'checking', currentVersion: '2.5.0' },
  { state: 'not-available', currentVersion: '2.5.0' },
  { state: 'available', currentVersion: '2.5.0', version: '2.6.0' },
  {
    state: 'available',
    currentVersion: '2.5.0',
    version: '2.6.0',
    releaseDate: '2026-09-24T03:25:53.122Z',
  },
  {
    state: 'downloading',
    currentVersion: '2.5.0',
    version: '2.6.0',
    progress: { percent: 42.5, transferred: 425, total: 1000, bytesPerSecond: 100 },
  },
  { state: 'downloaded', currentVersion: '2.5.0', version: '2.6.0' },
  { state: 'installing', currentVersion: '2.5.0', version: '2.6.0' },
  { state: 'error', currentVersion: '2.5.0', message: '更新服务暂时不可用' },
];

describe('appUpdate contracts', () => {
  it('accepts every UpdaterService state shape', () => {
    for (const sample of STATUS_SAMPLES) {
      expect(appUpdateStatusSchema.parse(sample)).toEqual(sample);
    }
  });

  it('rejects drifted shapes (missing version / bad reason / leaked fields)', () => {
    expect(
      appUpdateStatusSchema.safeParse({ state: 'available', currentVersion: '2.5.0' }).success,
    ).toBe(false);
    expect(
      appUpdateStatusSchema.safeParse({
        state: 'disabled',
        currentVersion: '2.5.0',
        reason: 'nope',
      }).success,
    ).toBe(false);
    expect(
      appUpdateStatusSchema.safeParse({
        state: 'downloading',
        currentVersion: '2.5.0',
        version: '2.6.0',
        progress: { percent: -1, transferred: 0, total: 0, bytesPerSecond: 0 },
      }).success,
    ).toBe(false);
  });

  it('snapshot pairs status with preferences; patch stays partial', () => {
    const snapshot = appUpdateSnapshotSchema.parse({
      status: STATUS_SAMPLES[6],
      preferences: { autoCheckOnStartup: true, autoDownload: true },
    });
    expect(snapshot.preferences).toEqual({ autoCheckOnStartup: true, autoDownload: true });

    expect(appUpdatePreferencesPatchSchema.parse({})).toEqual({});
    expect(appUpdatePreferencesPatchSchema.parse({ autoDownload: false })).toEqual({
      autoDownload: false,
    });
    expect(appUpdatePreferencesPatchSchema.safeParse({ autoDownload: 'yes' }).success).toBe(false);
  });
});
