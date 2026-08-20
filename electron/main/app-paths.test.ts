import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const appState = vi.hoisted(() => ({
  isPackaged: false,
  appPath: '/packaged/Musefold.app/Contents/Resources/app.asar',
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged;
    },
    getAppPath: () => appState.appPath,
  },
}));

import {
  resetAppRootCacheForTests,
  resolveAppRoot,
  resolveResourcePath,
  type AppPathEnvironment,
  type AppRootProbe,
} from './app-paths';

afterEach(() => {
  resetAppRootCacheForTests();
  appState.isPackaged = false;
  appState.appPath = '/packaged/Musefold.app/Contents/Resources/app.asar';
});

function env(partial: Partial<AppPathEnvironment> & Pick<AppPathEnvironment, 'packaged' | 'appPath' | 'cwd'>): AppPathEnvironment {
  return partial;
}

function probeFor(root: string): AppRootProbe {
  return (dir) => dir === root;
}

describe('resolveAppRoot', () => {
  it('returns appPath immediately when packaged', () => {
    const appPath = resolve('/packaged/app.asar');
    const probe = vi.fn(() => true);

    expect(
      resolveAppRoot(
        env({
          packaged: true,
          appPath,
          cwd: resolve('/workspace'),
          resourcesPath: resolve('/packaged/Resources'),
        }),
        probe,
      ),
    ).toBe(appPath);
    expect(probe).not.toHaveBeenCalled();
  });

  it('walks up two levels from out/main to the app root when unpackaged', () => {
    const repoRoot = resolve('/repo');
    const appPath = join(repoRoot, 'out', 'main');

    expect(
      resolveAppRoot(
        env({
          packaged: false,
          appPath,
          cwd: resolve('/elsewhere'),
        }),
        probeFor(repoRoot),
      ),
    ).toBe(repoRoot);
  });

  it('falls back to cwd when unpackaged appPath does not contain the app root', () => {
    const cwd = resolve('/workspace');

    expect(
      resolveAppRoot(
        env({
          packaged: false,
          appPath: join(resolve('/tmp/unrelated'), 'out', 'main'),
          cwd,
        }),
        probeFor(cwd),
      ),
    ).toBe(cwd);
  });

  it('falls back to appPath without throwing when neither walk nor cwd matches', () => {
    const appPath = join(resolve('/tmp/unrelated'), 'out', 'main');

    expect(
      resolveAppRoot(
        env({
          packaged: false,
          appPath,
          cwd: resolve('/elsewhere'),
        }),
        () => false,
      ),
    ).toBe(appPath);
  });
});

describe('resolveResourcePath', () => {
  it('joins extraResources directly when packaged', () => {
    const resourcesPath = resolve('/packaged/Resources');
    const packaged = env({
      packaged: true,
      appPath: resolve('/packaged/app.asar'),
      cwd: resolve('/workspace'),
      resourcesPath,
    });

    expect(resolveResourcePath(['pet', 'cat'], packaged, () => {
      throw new Error('packaged resource paths must not probe the filesystem');
    })).toBe(join(resourcesPath, 'pet', 'cat'));
    expect(resolveResourcePath(['icon.png'], packaged)).toBe(join(resourcesPath, 'icon.png'));
  });

  it('joins <appRoot>/resources when unpackaged', () => {
    const repoRoot = resolve('/repo');
    const unpackaged = env({
      packaged: false,
      appPath: join(repoRoot, 'out', 'main'),
      cwd: resolve('/elsewhere'),
      resourcesPath: resolve('/packaged/Resources'),
    });
    const probe = probeFor(repoRoot);

    expect(resolveResourcePath(['pet', 'cat'], unpackaged, probe)).toBe(
      join(repoRoot, 'resources', 'pet', 'cat'),
    );
    expect(resolveResourcePath(['icon.png'], unpackaged, probe)).toBe(
      join(repoRoot, 'resources', 'icon.png'),
    );
  });
});
