// 桌面更新通道：持久化在主 electron-store 的 update.channel 命名空间。
// 解析优先级：MUSEFOLD_UPDATE_CHANNEL > 持久化设置 > 默认 stable。
// 非法值回落 stable，不抛异常。

import Store from 'electron-store';
import { CHANNELS, DEFAULT_CHANNEL, type Channel } from '@musefold/update-protocol';
import { STORE_NAME } from '@shared/constants';

export const UPDATE_CHANNEL_ENV = 'MUSEFOLD_UPDATE_CHANNEL';
export const DEFAULT_UPDATE_CHANNEL: Channel = DEFAULT_CHANNEL;

const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

interface UpdateChannelSettingsShape {
  update: {
    channel: Channel;
  };
}

const store = new Store<UpdateChannelSettingsShape>({
  name: STORE_NAME,
  defaults: {
    update: { channel: DEFAULT_UPDATE_CHANNEL },
  },
});

export function isUpdateChannel(value: unknown): value is Channel {
  return typeof value === 'string' && CHANNEL_SET.has(value);
}

export function isUpdateChannelLockedByEnv(): boolean {
  const envValue = process.env[UPDATE_CHANNEL_ENV];
  return typeof envValue === 'string' && envValue.length > 0;
}

export function getUpdateChannel(): Channel {
  const envValue = process.env[UPDATE_CHANNEL_ENV];
  if (typeof envValue === 'string' && envValue.length > 0) {
    return isUpdateChannel(envValue) ? envValue : DEFAULT_UPDATE_CHANNEL;
  }
  return readStoredChannel();
}

export function setUpdateChannel(channel: Channel): Channel {
  if (!isUpdateChannel(channel)) return getUpdateChannel();
  store.set('update.channel', channel);
  return channel;
}

function readStoredChannel(): Channel {
  const stored = store.get('update.channel', DEFAULT_UPDATE_CHANNEL);
  if (isUpdateChannel(stored)) return stored;
  store.set('update.channel', DEFAULT_UPDATE_CHANNEL);
  return DEFAULT_UPDATE_CHANNEL;
}
