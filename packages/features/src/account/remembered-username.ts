import { create } from 'zustand';

/**
 * 上次登录用户名(ui-parity 07-01 P2)。
 * 旧版 `useAccountStore.lastUsername` 是进程内 zustand、不进偏好、不进 localStorage;
 * v2.5 同机制:features 内 zustand。另用 sessionStorage 扛住 Web 同页刷新
 * (旧桌面渲染进程不卸载,内存即可;Web 刷新会丢 zustand)。
 * 密码 / token 绝不写入。
 */
const SESSION_KEY = 'musefold:last-username';

function readSessionUsername(): string | null {
  try {
    const value = sessionStorage.getItem(SESSION_KEY);
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

function writeSessionUsername(username: string | null): void {
  try {
    if (username) sessionStorage.setItem(SESSION_KEY, username);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // sessionStorage 不可用(隐私模式 / SSR)时只留内存态。
  }
}

interface RememberedUsernameState {
  lastUsername: string | null;
  remember(username: string | null | undefined): void;
}

export const useRememberedUsername = create<RememberedUsernameState>((set) => ({
  lastUsername: readSessionUsername(),
  remember: (username) => {
    const next = username?.trim() ? username.trim() : null;
    writeSessionUsername(next);
    set({ lastUsername: next });
  },
}));
