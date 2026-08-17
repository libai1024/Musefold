/**
 * Renderer-safe update state. Keep this contract free of electron-updater
 * objects so no update metadata or platform-specific classes cross IPC.
 */
export type UpdateState =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export type UpdateDisabledReason = 'development' | 'unsupported-platform' | 'disabled-by-environment';

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateMetadata {
  version: string;
  releaseDate?: string;
}

export type UpdateStatus =
  | {
      state: 'disabled';
      currentVersion: string;
      reason: UpdateDisabledReason;
    }
  | {
      state: 'idle' | 'checking' | 'not-available';
      currentVersion: string;
    }
  | ({ state: 'available' | 'downloaded' | 'installing' } & UpdateMetadata & {
      currentVersion: string;
    })
  | ({ state: 'downloading'; currentVersion: string; progress: UpdateProgress } & UpdateMetadata)
  | {
      state: 'error';
      currentVersion: string;
      message: string;
    };
