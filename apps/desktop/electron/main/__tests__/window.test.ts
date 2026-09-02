import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const mocks = vi.hoisted(() => {
  class MockBrowserWindow {
    destroyed = false;
    maximized = false;
    fullscreen = false;
    private readonly listeners = new Map<string, (...args: unknown[]) => void>();
    readonly webContents = {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      session: {
        webRequest: {
          onHeadersReceived: vi.fn(),
        },
      },
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    readonly loadURL = vi.fn();
    readonly show = vi.fn();
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly isMaximized = vi.fn(() => this.maximized);
    readonly isFullScreen = vi.fn(() => this.fullscreen);
    readonly on = vi.fn(
      (event: string, listener: (...args: unknown[]) => void): MockBrowserWindow => {
        this.listeners.set(event, listener);
        return this;
      },
    );

    emit(event: string, ...args: unknown[]): void {
      this.listeners.get(event)?.(...args);
    }
  }

  return {
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
    },
    MockBrowserWindow,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.MockBrowserWindow,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
}));

vi.mock('../app-paths', () => ({
  resolveAppRoot: vi.fn(() => '/tmp/musefold'),
  resolveResourcePath: vi.fn(() => '/tmp/musefold/icon.png'),
}));

vi.mock('../app-protocol', () => ({
  isAppOriginUrl: vi.fn(() => true),
  resolveMainWindowLoadUrl: vi.fn(() => 'app://musefold/v25/shell.html'),
}));

vi.mock('../csp', () => ({
  buildContentSecurityPolicy: vi.fn(() => "default-src 'self'"),
}));

vi.mock('../external-links', () => ({
  isAllowedExternalUrl: vi.fn(() => false),
}));

vi.mock('../diagnostics', () => ({
  reportMainDiagnostic: vi.fn(),
  showNativeDiagnostic: vi.fn(),
}));

import {
  createWindow,
  getMainWindow,
  registerWindowHandlers,
  safeSendWindowEvent,
} from '../window';

interface WindowStub {
  isDestroyed: ReturnType<typeof vi.fn>;
  webContents: {
    isDestroyed: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
}

function makeWindow(): WindowStub {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
  };
}

function createTestWindow() {
  return createWindow() as unknown as InstanceType<typeof mocks.MockBrowserWindow>;
}

describe('main window event delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    const win = getMainWindow() as unknown as InstanceType<typeof mocks.MockBrowserWindow> | null;
    win?.emit('closed');
  });

  it('sends the fullscreen event channel and payload while the window is alive', () => {
    const win = makeWindow();

    expect(
      safeSendWindowEvent(win as unknown as BrowserWindow, 'window:fullscreenChanged', true),
    ).toBe(true);
    expect(win.webContents.send).toHaveBeenCalledWith('window:fullscreenChanged', true);
  });

  it('skips a destroyed window or webContents without sending', () => {
    const destroyedWindow = makeWindow();
    destroyedWindow.isDestroyed.mockReturnValue(true);
    expect(
      safeSendWindowEvent(
        destroyedWindow as unknown as BrowserWindow,
        'window:fullscreenChanged',
        false,
      ),
    ).toBe(false);
    expect(destroyedWindow.webContents.send).not.toHaveBeenCalled();

    const destroyedContents = makeWindow();
    destroyedContents.webContents.isDestroyed.mockReturnValue(true);
    expect(
      safeSendWindowEvent(
        destroyedContents as unknown as BrowserWindow,
        'window:fullscreenChanged',
        false,
      ),
    ).toBe(false);
    expect(destroyedContents.webContents.send).not.toHaveBeenCalled();
  });

  it('swallows a send failure caused by destruction after the guard', () => {
    const win = makeWindow();
    win.webContents.send.mockImplementation(() => {
      throw new Error('webContents destroyed during send');
    });

    expect(
      safeSendWindowEvent(win as unknown as BrowserWindow, 'window:fullscreenChanged', true),
    ).toBe(false);
  });

  it('uses the safe sender for maximize state broadcasts', () => {
    const win = createTestWindow();
    win.maximized = true;

    win.emit('maximize');

    expect(win.webContents.send).toHaveBeenCalledWith('window:maximizeChanged', true);

    win.webContents.send.mockClear();
    win.destroyed = true;
    win.emit('unmaximize');

    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe('window maximize query handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerWindowHandlers();
  });

  afterEach(() => {
    const win = getMainWindow() as unknown as InstanceType<typeof mocks.MockBrowserWindow> | null;
    win?.emit('closed');
  });

  it('returns the real maximized state for a live window', () => {
    const win = createTestWindow();
    win.maximized = true;
    const handler = mocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'window:isMaximized',
    )?.[1] as (() => boolean) | undefined;

    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
  });

  it('returns false when the maximized window is destroyed or throws', () => {
    const win = createTestWindow();
    const handler = mocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'window:isMaximized',
    )?.[1] as (() => boolean) | undefined;

    expect(handler).toBeDefined();

    win.destroyed = true;
    expect(handler?.()).toBe(false);

    win.destroyed = false;
    win.isMaximized.mockImplementation(() => {
      throw new Error('window destroyed during maximized query');
    });
    expect(handler?.()).toBe(false);
  });
});

describe('window fullscreen query handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerWindowHandlers();
  });

  afterEach(() => {
    const win = getMainWindow() as unknown as InstanceType<typeof mocks.MockBrowserWindow> | null;
    win?.emit('closed');
  });

  it('registers a dedicated read-only fullscreen handler', () => {
    const handler = mocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'window:isFullscreen',
    )?.[1] as (() => boolean) | undefined;

    expect(handler).toBeDefined();
    expect(handler?.()).toBe(false);
  });

  it('returns the real fullscreen state for a live window', () => {
    const win = createTestWindow();
    win.fullscreen = true;
    const handler = mocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'window:isFullscreen',
    )?.[1] as (() => boolean) | undefined;

    expect(handler).toBeDefined();
    expect(handler?.()).toBe(true);
  });

  it('returns false when the fullscreen window is destroyed or throws', () => {
    const win = createTestWindow();
    const handler = mocks.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'window:isFullscreen',
    )?.[1] as (() => boolean) | undefined;

    expect(handler).toBeDefined();

    win.destroyed = true;
    expect(handler?.()).toBe(false);

    win.destroyed = false;
    win.isFullScreen.mockImplementation(() => {
      throw new Error('window destroyed during fullscreen query');
    });
    expect(handler?.()).toBe(false);
  });
});
