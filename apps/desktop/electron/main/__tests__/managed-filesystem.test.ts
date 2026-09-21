import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ packaged: false, load: vi.fn() }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return host.packaged;
    },
  },
}));
vi.mock('@musefold/managed-fs', () => ({ loadManagedFilesystem: host.load }));
vi.mock('../app-paths', () => ({ resolveAppRoot: () => '/owned/application' }));

beforeEach(() => {
  vi.resetModules();
  host.load.mockReset();
});

it.each([false, true])(
  'loads and caches the trusted native resource (packaged=%s)',
  async (packaged) => {
    host.packaged = packaged;
    const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/owned/resources',
    });
    try {
      const binding = Object.freeze({ owned: true });
      host.load.mockReturnValue(binding);
      const { getManagedFilesystem } = await import('../managed-filesystem');
      expect(getManagedFilesystem()).toBe(binding);
      expect(getManagedFilesystem()).toBe(binding);
      expect(host.load).toHaveBeenCalledExactlyOnceWith(
        packaged
          ? join('/owned/resources', 'native', 'managed_fs.node')
          : join('/owned/application', 'packages/managed-fs/build/Release/managed_fs.node'),
      );
    } finally {
      if (resources) Object.defineProperty(process, 'resourcesPath', resources);
      else Reflect.deleteProperty(process, 'resourcesPath');
    }
  },
);

it('propagates a failed native load and retries the same trusted development resource', async () => {
  host.packaged = false;
  const binding = Object.freeze({ owned: true });
  host.load
    .mockImplementationOnce(() => {
      throw new Error('unavailable');
    })
    .mockReturnValue(binding);
  const { getManagedFilesystem } = await import('../managed-filesystem');
  expect(() => getManagedFilesystem()).toThrow('unavailable');
  expect(getManagedFilesystem()).toBe(binding);
  expect(host.load.mock.calls).toEqual([
    [join('/owned/application', 'packages/managed-fs/build/Release/managed_fs.node')],
    [join('/owned/application', 'packages/managed-fs/build/Release/managed_fs.node')],
  ]);
});
