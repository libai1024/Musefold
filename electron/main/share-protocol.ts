import { app, BrowserWindow } from 'electron';
import { IPC } from '@shared/types/ipc';
import { SHARE_PROTOCOL, parseShareDeeplink, type SharePayload } from '@shared/share';
import { getMainWindow } from './window';

interface PendingShareImport {
  payload: SharePayload;
  delivered: boolean;
}

let listenersRegistered = false;
let flushScheduled = false;
const pendingPayloads: PendingShareImport[] = [];

export function registerShareProtocolListeners(): void {
  if (listenersRegistered) return;
  listenersRegistered = true;

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleShareUrl(url);
  });
}

export function registerShareProtocolClient(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SHARE_PROTOCOL, process.execPath, [process.argv[1]]);
      return;
    }
    app.setAsDefaultProtocolClient(SHARE_PROTOCOL);
  } catch {
    // Protocol registration can fail in unsigned/dev contexts. Parsing and
    // in-app IPC remain available, so startup should not be blocked.
  }
}

export function handleShareArgv(argv: string[]): void {
  const url = argv.find((arg) => /^musefold:\/\//i.test(arg) || /^musefold:import/i.test(arg));
  if (url) handleShareUrl(url);
}

export function handleShareUrl(url: string): void {
  let payload: SharePayload;
  try {
    payload = parseShareDeeplink(url);
  } catch {
    return;
  }

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  dispatchOrQueue(payload);
}

export function consumeQueuedShareImports(): SharePayload[] {
  const payloads = pendingPayloads.map((item) => item.payload);
  pendingPayloads.length = 0;
  return payloads;
}

export function flushQueuedShareImports(delayMs = 500): void {
  if (!pendingPayloads.some((item) => !item.delivered) || flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    const win = getMainWindow();
    if (!isWindowReady(win)) {
      flushQueuedShareImports(500);
      return;
    }
    for (const pending of pendingPayloads) {
      if (!pending.delivered) {
        win.webContents.send(IPC.SHARE_INCOMING, pending.payload);
        pending.delivered = true;
      }
    }
  }, delayMs);
}

function dispatchOrQueue(payload: SharePayload): void {
  const entry: PendingShareImport = { payload, delivered: false };
  pendingPayloads.push(entry);
  const win = getMainWindow();
  if (!isWindowReady(win)) {
    flushQueuedShareImports();
    return;
  }
  win.webContents.send(IPC.SHARE_INCOMING, payload);
  entry.delivered = true;
}

function isWindowReady(win: BrowserWindow | null): win is BrowserWindow {
  return Boolean(
    win &&
      !win.isDestroyed() &&
      !win.webContents.isDestroyed() &&
      !win.webContents.isLoading(),
  );
}
