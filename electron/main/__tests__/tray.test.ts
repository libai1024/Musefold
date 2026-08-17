import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const trayInstances: FakeTray[] = [];
  const buildFromTemplate = vi.fn((template: unknown) => template);
  const icon = { resize: vi.fn(() => 'resized-icon') };

  class FakeTray {
    destroyed = false;
    listeners = new Map<string, () => void>();

    constructor(public readonly image: unknown) {
      trayInstances.push(this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    setToolTip(): void {}

    setContextMenu(): void {}

    on(event: string, listener: () => void): void {
      this.listeners.set(event, listener);
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  return {
    app: {
      isPackaged: false,
      getAppPath: vi.fn(() => '/workspace'),
      quit: vi.fn(),
    },
    Menu: { buildFromTemplate },
    nativeImage: { createFromPath: vi.fn(() => icon) },
    FakeTray,
    trayInstances,
    buildFromTemplate,
    icon,
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
  Menu: mocks.Menu,
  nativeImage: mocks.nativeImage,
  Tray: mocks.FakeTray,
}));

import { createAppTray, destroyAppTray } from '../tray';

afterEach(() => {
  destroyAppTray();
  vi.clearAllMocks();
  mocks.trayInstances.length = 0;
});

describe('application tray', () => {
  it('creates one tray with open and quit actions', () => {
    const openMainWindow = vi.fn();
    const tray = createAppTray(openMainWindow);
    const fakeTray = mocks.trayInstances[0];
    const template = mocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{ click?: () => void }>;
    const iconSize = process.platform === 'darwin' ? 18 : 20;

    expect(fakeTray?.image).toBe('resized-icon');
    expect(mocks.nativeImage.createFromPath).toHaveBeenCalledWith('/workspace/resources/icon.png');
    expect(mocks.icon.resize).toHaveBeenCalledWith({ width: iconSize, height: iconSize, quality: 'best' });
    expect(template[0]?.click).toBeTypeOf('function');
    expect(template[2]?.click).toBeTypeOf('function');

    template[0]?.click?.();
    fakeTray?.listeners.get('click')?.();
    template[2]?.click?.();

    expect(openMainWindow).toHaveBeenCalledTimes(2);
    expect(mocks.app.quit).toHaveBeenCalledTimes(1);
  });

  it('reuses and destroys the tray instance', () => {
    const openMainWindow = vi.fn();
    const first = createAppTray(openMainWindow);
    const second = createAppTray(openMainWindow);

    expect(second).toBe(first);
    expect(mocks.trayInstances).toHaveLength(1);

    destroyAppTray();
    expect(mocks.trayInstances[0]?.isDestroyed()).toBe(true);
  });
});
