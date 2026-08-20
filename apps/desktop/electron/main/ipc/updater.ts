import { resolve } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@musefold/desktop-contracts/ipc';
import type {
  ContentLayerCheckSnapshot,
  ContentLayerState,
  UpdateChannelResult,
} from '@musefold/desktop-contracts/updater';
import { getUpdaterService } from '../../update';
import { confirmContentBundleStartup } from '../../update/content-bundle-runtime';
import {
  getBundleDir,
  getKnownGoodVersion,
  getPendingVersion,
  getPreviousGoodVersion,
} from '../../update/content-bundle-store';
import {
  getLastContentUpdateCheck,
  resolveContentUpdateSchedulePlan,
  runContentUpdateCheckOnce,
} from '../../update/content-updater';
import { peekRendererRootResolution } from '../renderer-bundle';
import {
  getUpdateChannel,
  isUpdateChannel,
  isUpdateChannelLockedByEnv,
  setUpdateChannel,
} from '../../settings/update-channel';

const EMPTY_CONTENT_LAYER_STATE: ContentLayerState = {
  activeSource: 'builtin',
  activeBundleVersion: null,
  pendingVersion: null,
  knownGoodVersion: null,
  lastCheck: null,
};

/**
 * 手动检查防重入：进行中的第二次 invoke 等待同一 promise，不并行开第二次检查。
 * 调度器仍按自己的定时器调用 runContentUpdateCheckOnce，互不抢占（避免改变已交付调度行为）。
 */
let contentCheckInFlight: Promise<ContentLayerCheckSnapshot> | null = null;

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IPC.UPDATER_GET_STATE, () => getUpdaterService().getState());
  ipcMain.handle(IPC.UPDATER_CHECK, () => getUpdaterService().check());
  ipcMain.handle(IPC.UPDATER_DOWNLOAD, () => getUpdaterService().download());
  ipcMain.handle(IPC.UPDATER_INSTALL, () => getUpdaterService().install());
  ipcMain.handle(IPC.UPDATER_GET_CHANNEL, () => ({
    channel: getUpdateChannel(),
    lockedByEnv: isUpdateChannelLockedByEnv(),
  }));
  ipcMain.handle(IPC.UPDATER_GET_CONTENT_STATE, (event) => {
    if (!isTrustedUpdaterSender(event)) return EMPTY_CONTENT_LAYER_STATE;
    return buildContentLayerState();
  });
  ipcMain.handle(IPC.UPDATER_CHECK_CONTENT_NOW, (event) => {
    if (!isTrustedUpdaterSender(event)) {
      return { status: 'trust_anchor_missing', at: Date.now() } satisfies ContentLayerCheckSnapshot;
    }
    return checkContentNowSerialized();
  });
  ipcMain.handle(IPC.UPDATER_SET_CHANNEL, (_event, raw: unknown): UpdateChannelResult => {
    const lockedByEnv = isUpdateChannelLockedByEnv();
    const current = getUpdateChannel();
    if (lockedByEnv) {
      return {
        ok: false,
        channel: current,
        lockedByEnv: true,
        message: '更新通道已由环境变量锁定，无法在设置中修改',
      };
    }
    if (!isUpdateChannel(raw)) {
      return {
        ok: false,
        channel: current,
        lockedByEnv: false,
        message: '不支持的更新通道',
      };
    }
    try {
      setUpdateChannel(raw);
      getUpdaterService().setChannel(raw);
      void getUpdaterService().check();
      return { ok: true, channel: raw, lockedByEnv: false };
    } catch (error: unknown) {
      return {
        ok: false,
        channel: getUpdateChannel(),
        lockedByEnv: false,
        message: sanitizeChannelError(error),
      };
    }
  });
  ipcMain.on(IPC.UPDATER_CONTENT_READY, (event) => {
    if (!isTrustedUpdaterSender(event)) return;
    confirmContentBundleStartup(peekRendererRootResolution());
  });
}

/** 仅供测试：丢掉手动检查的 in-flight 句柄，避免串例。 */
export function resetContentCheckInFlightForTests(): void {
  contentCheckInFlight = null;
}

function checkContentNowSerialized(): Promise<ContentLayerCheckSnapshot> {
  if (contentCheckInFlight) return contentCheckInFlight;
  contentCheckInFlight = (async () => {
    // 与调度器同一套 checkDeps：未打包时才能吃到 E2E 注入的测试公钥 / feed。
    const plan = resolveContentUpdateSchedulePlan();
    await runContentUpdateCheckOnce(plan.checkDeps);
    return getLastContentUpdateCheck() ?? { status: 'manifest_unreachable', at: Date.now() };
  })().finally(() => {
    contentCheckInFlight = null;
  });
  return contentCheckInFlight;
}

function buildContentLayerState(): ContentLayerState {
  const pendingVersion = getPendingVersion();
  const knownGoodVersion = getKnownGoodVersion();
  const previousGoodVersion = getPreviousGoodVersion();
  const { activeSource, activeBundleVersion } = resolveActiveContentLayer(
    peekRendererRootResolution(),
    pendingVersion,
    knownGoodVersion,
    previousGoodVersion,
  );
  return {
    activeSource,
    activeBundleVersion,
    pendingVersion,
    knownGoodVersion,
    lastCheck: getLastContentUpdateCheck(),
  };
}

function resolveActiveContentLayer(
  resolution: { root: string; source: 'builtin' | 'bundle' } | undefined,
  pendingVersion: string | null,
  knownGoodVersion: string | null,
  previousGoodVersion: string | null,
): Pick<ContentLayerState, 'activeSource' | 'activeBundleVersion'> {
  // 尚未冻结或正在服务内置包：不把磁盘指针当成「当前内容层」。
  if (!resolution || resolution.source !== 'bundle') {
    return { activeSource: 'builtin', activeBundleVersion: null };
  }
  const root = resolve(resolution.root);
  for (const version of [pendingVersion, knownGoodVersion, previousGoodVersion]) {
    if (!version) continue;
    let dir: string;
    try {
      dir = resolve(getBundleDir(version));
    } catch {
      continue;
    }
    if (dir === root) {
      return { activeSource: 'bundle', activeBundleVersion: version };
    }
  }
  return { activeSource: 'bundle', activeBundleVersion: null };
}

function isTrustedUpdaterSender(event: {
  sender?: Electron.WebContents | null;
  senderFrame?: Electron.WebFrameMain | null;
}): boolean {
  const sender = event.sender;
  if (!sender || sender.isDestroyed()) return false;
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return false;
  // 只接受我们自己窗口的主 frame，避免子 frame 冒充信标或触发检查。
  if (event.senderFrame != null && sender.mainFrame != null && event.senderFrame !== sender.mainFrame) {
    return false;
  }
  return true;
}

function sanitizeChannelError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/[^\s)]+/gi, '[更新服务器]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var)\/)[^\s)]+/g, '[本地路径]')
    .trim()
    .slice(0, 300) || '无法切换更新通道';
}
