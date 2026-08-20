import { describe, expect, it } from 'vitest';
import packageInfo from '../../../package.json';
import { APP_VERSION } from '../app-version';

describe('application version', () => {
  it('uses Musefold package metadata instead of the Electron runtime version', () => {
    expect(APP_VERSION).toBe(packageInfo.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
