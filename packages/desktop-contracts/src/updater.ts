/**
 * Renderer-safe update state. Keep this contract free of electron-updater
 * objects so no update metadata or platform-specific classes cross IPC.
 */
import type { Channel } from '@musefold/update-protocol';

export type { Channel };

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

/** Narrow IPC payload for the desktop update channel. No feed URL or paths. */
export interface UpdateChannelInfo {
  channel: Channel;
  lockedByEnv: boolean;
}

export type UpdateChannelResult =
  | { ok: true; channel: Channel; lockedByEnv: boolean }
  | { ok: false; channel: Channel; lockedByEnv: boolean; message: string };

/** 最近一次内容层检查的脱敏快照。不含路径、URL、公钥或英文 message。 */
export interface ContentLayerCheckSnapshot {
  status: string;
  reason?: string;
  at: number;
}

/**
 * 设置页可读的内容层状态。窄接口：只暴露版本号、来源与脱敏检查结果，
 * 不暴露本地路径、签名细节或内部对象。
 */
export interface ContentLayerState {
  /** 本次运行实际服务的来源：内置 or 已应用 bundle */
  activeSource: 'builtin' | 'bundle';
  /** activeSource='bundle' 时对应的版本号；反查失败则为 null */
  activeBundleVersion: string | null;
  /** 已安装、下次启动生效 */
  pendingVersion: string | null;
  knownGoodVersion: string | null;
  /** 最近一次检查：无则 null。不持久化。 */
  lastCheck: ContentLayerCheckSnapshot | null;
}
