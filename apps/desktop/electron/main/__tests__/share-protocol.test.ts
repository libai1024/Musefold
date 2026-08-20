import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { buildShareDeeplink, type SharePayload } from '@musefold/desktop-contracts/share';

const mocks = vi.hoisted(() => ({
  appOn: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  getMainWindow: vi.fn(),
  send: vi.fn(),
  restore: vi.fn(),
  focus: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    on: mocks.appOn,
    setAsDefaultProtocolClient: mocks.setAsDefaultProtocolClient,
  },
  BrowserWindow: class BrowserWindow {},
}));

vi.mock('../window', () => ({
  getMainWindow: mocks.getMainWindow,
}));

import {
  consumeQueuedShareImports,
  handleShareUrl,
  registerShareProtocolListeners,
} from '../share-protocol';

function makeWindow(loading = false) {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: mocks.restore,
    focus: mocks.focus,
    webContents: {
      isDestroyed: () => false,
      isLoading: () => loading,
      send: mocks.send,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeQueuedShareImports();
  mocks.getMainWindow.mockReturnValue(null);
});

afterEach(() => {
  consumeQueuedShareImports();
  vi.useRealTimers();
});

describe('share protocol queueing', () => {
  it('registers the deeplink listener once', () => {
    registerShareProtocolListeners();
    registerShareProtocolListeners();

    expect(mocks.appOn).toHaveBeenCalledTimes(1);
    expect(mocks.appOn).toHaveBeenCalledWith('open-url', expect.any(Function));
  });

  it('keeps delivered payloads available for renderer consumption', () => {
    mocks.getMainWindow.mockReturnValue(makeWindow());

    const payload: SharePayload = {
      title: 'Shared prompt',
      content: 'A calm desk prompt',
    };
    const deeplink = buildShareDeeplink(payload);

    handleShareUrl(deeplink);

    expect(mocks.send).toHaveBeenCalledWith(
      IPC.SHARE_INCOMING,
      expect.objectContaining({
        title: 'Shared prompt',
        content: 'A calm desk prompt',
      }),
    );

    const pending = consumeQueuedShareImports();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      title: 'Shared prompt',
      content: 'A calm desk prompt',
    });
    expect(consumeQueuedShareImports()).toEqual([]);
  });

  it('retains queued payloads until the renderer drains them', () => {
    vi.useFakeTimers();
    mocks.getMainWindow.mockReturnValue(null);

    const payload: SharePayload = {
      title: 'Queued prompt',
      content: 'Wait until the dialog mounts',
    };
    const deeplink = buildShareDeeplink(payload);

    handleShareUrl(deeplink);
    expect(mocks.send).not.toHaveBeenCalled();

    const pending = consumeQueuedShareImports();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      title: 'Queued prompt',
      content: 'Wait until the dialog mounts',
    });

    vi.runOnlyPendingTimers();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
