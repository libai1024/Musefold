import { describe, expect, it, vi } from 'vitest';
import { discoverOrStartEndpoint } from '../autostart';
import { candidateDataDirs } from '../discover';

const endpoint = {
  endpoint: 'http://127.0.0.1:60158',
  token: 'test-token',
  source: 'C:\\Users\\test\\AppData\\Roaming\\Musefold\\automation.json',
  owner: 'desktop-app' as const,
};

describe('desktop control-plane autostart', () => {
  it('prefers the actual 0.5 Windows userData directory', () => {
    const dirs = candidateDataDirs({ APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, 'win32');
    expect(dirs.map((dir) => dir.split(/[\\/]/).at(-1))).toEqual(['musefold-app', 'Musefold', 'musefold']);
  });

  it('returns an existing endpoint without launching the app', async () => {
    const discover = vi.fn().mockResolvedValue(endpoint);
    const launch = vi.fn().mockResolvedValue(true);
    await expect(discoverOrStartEndpoint({ autostart: true, discover, launch })).resolves.toEqual(endpoint);
    expect(launch).not.toHaveBeenCalled();
  });

  it('launches the packaged app and waits for desktop discovery', async () => {
    const discover = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(endpoint);
    const launch = vi.fn().mockResolvedValue(true);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(discoverOrStartEndpoint({
      env: { MUSEFOLD_APP_EXECUTABLE: 'C:\\Program Files\\Musefold\\Musefold.exe' },
      autostart: true,
      timeoutMs: 500,
      pollIntervalMs: 100,
      discover,
      launch,
      sleep,
    })).resolves.toEqual(endpoint);
    expect(launch).toHaveBeenCalledWith('C:\\Program Files\\Musefold\\Musefold.exe', expect.any(Object));
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not launch when autostart is disabled', async () => {
    const discover = vi.fn().mockResolvedValue(null);
    const launch = vi.fn().mockResolvedValue(true);
    await expect(discoverOrStartEndpoint({ autostart: false, discover, launch })).resolves.toBeNull();
    expect(launch).not.toHaveBeenCalled();
  });
});
