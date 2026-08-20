import { DEFAULT_CHANNEL, type Channel } from '@musefold/update-protocol';
import type {
  UpdateDisabledReason,
  UpdateMetadata,
  UpdateProgress,
  UpdateStatus,
} from '@shared/types/updater';

export const UPDATE_FEED_BASE_URL = 'https://zhaozhaoyue.top/Musefold/updates/';
export const DEFAULT_UPDATE_CHANNEL: Channel = DEFAULT_CHANNEL;

export function resolveUpdateFeedUrl(channel: Channel): string {
  return `${UPDATE_FEED_BASE_URL}${channel}/`;
}

export function allowsPrereleaseForChannel(channel: Channel): boolean {
  return channel !== 'stable';
}

export type UpdaterEventMap = {
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfoLike) => void;
  'update-not-available': (info: UpdateInfoLike) => void;
  'download-progress': (progress: ProgressInfoLike) => void;
  'update-downloaded': (info: UpdateInfoLike) => void;
  error: (error: Error, message?: string) => void;
};

export interface UpdateInfoLike {
  version?: string;
  releaseDate?: string;
}

export interface ProgressInfoLike {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdaterAdapter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  setFeedURL(url: string): void;
  on<EventName extends keyof UpdaterEventMap>(event: EventName, listener: UpdaterEventMap[EventName]): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterServiceOptions {
  adapter: UpdaterAdapter;
  currentVersion: string;
  enabled: boolean;
  disabledReason?: UpdateDisabledReason;
  channel?: Channel;
  feedUrl?: string;
  onStateChanged?: (status: UpdateStatus) => void;
  beforeInstall?: () => Promise<void> | void;
}

/**
 * Small, renderer-safe state machine around electron-updater.
 * The adapter boundary keeps update behavior testable without starting Electron.
 */
export class UpdaterService {
  private readonly adapter: UpdaterAdapter;
  private readonly currentVersion: string;
  private readonly onStateChanged?: (status: UpdateStatus) => void;
  private readonly beforeInstall?: () => Promise<void> | void;
  private state: UpdateStatus;
  private checkPromise: Promise<UpdateStatus> | null = null;
  private downloadPromise: Promise<UpdateStatus> | null = null;
  private updateMetadata: UpdateMetadata | null = null;
  private installRequested = false;
  private epoch = 0;

  constructor(options: UpdaterServiceOptions) {
    this.adapter = options.adapter;
    this.currentVersion = options.currentVersion;
    this.onStateChanged = options.onStateChanged;
    this.beforeInstall = options.beforeInstall;
    this.state = options.enabled
      ? { state: 'idle', currentVersion: options.currentVersion }
      : {
          state: 'disabled',
          currentVersion: options.currentVersion,
          reason: options.disabledReason ?? 'disabled-by-environment',
        };

    if (!options.enabled) return;

    const channel = options.channel ?? DEFAULT_CHANNEL;
    this.adapter.autoDownload = false;
    this.adapter.autoInstallOnAppQuit = false;
    this.applyChannel(channel, options.feedUrl);
    this.bindAdapterEvents();
  }

  /**
   * Switch the electron-updater feed at runtime. Resets to idle so the next
   * check talks to the new channel. Does not use electron-updater's `channel`
   * field — feed URL is `updates/<channel>/`.
   */
  setChannel(channel: Channel): void {
    if (this.state.state === 'disabled') return;
    this.epoch += 1;
    this.checkPromise = null;
    this.downloadPromise = null;
    this.updateMetadata = null;
    this.installRequested = false;
    this.applyChannel(channel);
    this.transition({ state: 'idle', currentVersion: this.currentVersion });
  }

  getState(): UpdateStatus {
    return this.state;
  }

  async check(): Promise<UpdateStatus> {
    if (this.state.state === 'disabled') return this.state;
    if (this.checkPromise) return this.checkPromise;
    if (this.state.state === 'downloading' || this.state.state === 'downloaded' || this.state.state === 'installing') {
      return this.state;
    }

    this.transition({ state: 'checking', currentVersion: this.currentVersion });
    const epoch = this.epoch;
    this.checkPromise = this.adapter.checkForUpdates()
      .then((result) => {
        if (epoch !== this.epoch) return this.state;
        // electron-updater normally emits update-not-available/update-available.
        // The fallback also keeps simple adapters deterministic in tests.
        if (this.state.state === 'checking') {
          const candidate = asUpdateInfo(result);
          if (candidate?.isUpdateAvailable && candidate.updateInfo) {
            this.setAvailable(candidate.updateInfo);
          } else {
            this.transition({ state: 'not-available', currentVersion: this.currentVersion });
          }
        }
        return this.state;
      })
      .catch((error: unknown) => {
        if (epoch !== this.epoch) return this.state;
        this.setError(error);
        return this.state;
      })
      .finally(() => {
        if (epoch === this.epoch) this.checkPromise = null;
      });
    return this.checkPromise;
  }

  async download(): Promise<UpdateStatus> {
    if (this.state.state === 'disabled') return this.state;
    if (this.state.state === 'downloaded' || this.state.state === 'installing') return this.state;
    if (this.state.state !== 'available' && this.state.state !== 'error') return this.state;
    if (this.downloadPromise) return this.downloadPromise;

    const metadata = this.updateMetadata;
    if (!metadata) return this.state;
    this.transition({
      state: 'downloading',
      currentVersion: this.currentVersion,
      ...metadata,
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
    });
    const epoch = this.epoch;
    this.downloadPromise = this.adapter.downloadUpdate()
      .then(() => this.state)
      .catch((error: unknown) => {
        if (epoch !== this.epoch) return this.state;
        this.setError(error);
        return this.state;
      })
      .finally(() => {
        if (epoch === this.epoch) this.downloadPromise = null;
      });
    return this.downloadPromise;
  }

  async install(): Promise<UpdateStatus> {
    if (this.state.state !== 'downloaded' || this.installRequested) return this.state;
    this.installRequested = true;
    this.transition({ state: 'installing', currentVersion: this.currentVersion, ...this.metadataOrFallback() });
    try {
      await this.beforeInstall?.();
      this.adapter.quitAndInstall(false, true);
    } catch (error: unknown) {
      this.installRequested = false;
      this.setError(error);
    }
    return this.state;
  }

  private applyChannel(channel: Channel, feedUrl?: string): void {
    this.adapter.allowPrerelease = allowsPrereleaseForChannel(channel);
    this.adapter.setFeedURL(feedUrl ?? resolveUpdateFeedUrl(channel));
  }

  private bindAdapterEvents(): void {
    this.adapter.on('checking-for-update', () => {
      if (this.state.state === 'idle' && !this.checkPromise) return;
      if (this.state.state !== 'checking') {
        this.transition({ state: 'checking', currentVersion: this.currentVersion });
      }
    });
    this.adapter.on('update-available', (info) => {
      if (this.state.state === 'idle' && !this.checkPromise) return;
      this.setAvailable(info);
    });
    this.adapter.on('update-not-available', () => {
      if (this.state.state === 'idle' && !this.checkPromise) return;
      this.transition({ state: 'not-available', currentVersion: this.currentVersion });
    });
    this.adapter.on('download-progress', (progress) => {
      if (this.state.state !== 'downloading') return;
      const metadata = this.metadataOrFallback();
      this.transition({
        state: 'downloading',
        currentVersion: this.currentVersion,
        ...metadata,
        progress: normalizeProgress(progress),
      });
    });
    this.adapter.on('update-downloaded', (info) => {
      if (this.state.state === 'idle' && !this.downloadPromise) return;
      this.updateMetadata = normalizeMetadata(info, this.updateMetadata?.version ?? this.currentVersion);
      this.transition({
        state: 'downloaded',
        currentVersion: this.currentVersion,
        ...this.updateMetadata,
      });
    });
    this.adapter.on('error', (error, message) => {
      if (this.state.state === 'idle' && !this.checkPromise && !this.downloadPromise) return;
      this.setError(message || error);
    });
  }

  private setAvailable(info: UpdateInfoLike): void {
    this.updateMetadata = normalizeMetadata(info, this.currentVersion);
    this.transition({
      state: 'available',
      currentVersion: this.currentVersion,
      ...this.updateMetadata,
    });
  }

  private metadataOrFallback(): UpdateMetadata {
    return this.updateMetadata ?? { version: this.currentVersion };
  }

  private setError(error: unknown): void {
    const raw = error instanceof Error ? error.message : String(error);
    const message = sanitizeErrorMessage(raw) || '更新服务暂时不可用';
    this.transition({ state: 'error', currentVersion: this.currentVersion, message });
  }

  private transition(next: UpdateStatus): void {
    this.state = next;
    this.onStateChanged?.(next);
  }
}

function sanitizeErrorMessage(value: string): string {
  return value
    .replace(/https?:\/\/[^\s)]+/gi, '[更新服务器]')
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp|var)\/)[^\s)]+/g, '[本地路径]')
    .trim()
    .slice(0, 300);
}

function normalizeMetadata(info: UpdateInfoLike, fallbackVersion: string): UpdateMetadata {
  return {
    version: typeof info.version === 'string' && info.version.trim() ? info.version : fallbackVersion,
    ...(typeof info.releaseDate === 'string' && info.releaseDate ? { releaseDate: info.releaseDate } : {}),
  };
}

function normalizeProgress(progress: ProgressInfoLike): UpdateProgress {
  return {
    percent: clampNumber(progress.percent),
    transferred: clampNumber(progress.transferred),
    total: clampNumber(progress.total),
    bytesPerSecond: clampNumber(progress.bytesPerSecond),
  };
}

function clampNumber(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function asUpdateInfo(value: unknown): { isUpdateAvailable: boolean; updateInfo?: UpdateInfoLike } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { isUpdateAvailable?: unknown; updateInfo?: unknown };
  if (typeof candidate.isUpdateAvailable !== 'boolean') return null;
  if (!candidate.updateInfo || typeof candidate.updateInfo !== 'object') {
    return { isUpdateAvailable: candidate.isUpdateAvailable };
  }
  return { isUpdateAvailable: candidate.isUpdateAvailable, updateInfo: candidate.updateInfo as UpdateInfoLike };
}
