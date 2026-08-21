// zustand persist 存储适配：JSON 主 key + 一次性读旧手写 key。
// 放在 lib 而不是 stores/，好让 store-persist-only 规则只锁 store 文件。
// 每次读写都现取 global localStorage，避免 createJSONStorage 在模块加载时把
// jsdom / 测试 stub 之前的对象闭包进去。

import type { PersistStorage, StorageValue } from 'zustand/middleware';

function currentLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function createMigratingJSONStorage<S>(options: {
  readLegacy: () => S | null;
  clearLegacy?: () => void;
}): PersistStorage<S, unknown> {
  return {
    getItem: (name) => {
      const storage = currentLocalStorage();
      if (storage) {
        const raw = storage.getItem(name);
        if (raw != null) {
          try {
            return JSON.parse(raw) as StorageValue<S>;
          } catch {
            return null;
          }
        }
      }
      return wrapLegacy(options.readLegacy());
    },
    setItem: (name, value) => {
      currentLocalStorage()?.setItem(name, JSON.stringify(value));
      options.clearLegacy?.();
    },
    removeItem: (name) => {
      currentLocalStorage()?.removeItem(name);
    },
  };
}

function wrapLegacy<S>(legacy: S | null): StorageValue<S> | null {
  if (legacy == null) return null;
  return { state: legacy, version: 0 };
}

export function persistStateOf<S>(raw: string | null): S | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { state?: S };
    return parsed.state ?? null;
  } catch {
    return null;
  }
}
