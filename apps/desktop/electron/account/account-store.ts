// electron/account/account-store.ts
// 账号非敏感状态（electron-store）。敏感值红线（V05-ARCHITECTURE §4）：
// refresh 凭据在 keychain（account:refresh-token）、JWT 仅内存、sk- 在两栈各自 keychain——都不进本 store。

import Store from 'electron-store';
import {
  DEFAULT_ACCOUNT_SERVER_FALLBACK_URL,
  DEFAULT_ACCOUNT_SERVER_URL,
} from '@musefold/domain/constants';
import type { AccountHealth, AccountNotice } from '@shared/types/account';
import { accountQuotaToPoints } from '@musefold/core/pricing';

export const ACCOUNT_STORE_NAME = 'musefold-account-v0.5.0';
/** keychain 条目 id（复用 ElectronAiSecretKeychain 的加密存储） */
export const REFRESH_TOKEN_KEYCHAIN_ID = 'account:refresh-token';

export interface AccountSessionState {
  username: string;
  userId: number;
  group: string;
  deviceTokenId: number | null;
  deviceTokenName: string;
  deviceTokenSuffix: string | null;
  managedProviderId: string | null;
  managedConnectionId: string | null;
  quotaCache: { value: number; at: number } | null;
  health: AccountHealth;
  /** 定价同步指纹与生图单价（点/张）——estImagesRemaining 的分母（FR-COST-01） */
  pricingVersion: string | null;
  imagePricePoints: number | null;
  /** 缺失表示 v0.5 旧数据：imagePricePoints 实际保存账号原始配额。 */
  imagePriceUnit?: 'point';
  notices: AccountNotice[];
}

export interface AccountStoreShape {
  serverUrl: string;
  session: AccountSessionState | null;
}

export interface AccountStoreBackend {
  get<K extends keyof AccountStoreShape>(key: K): AccountStoreShape[K];
  set<K extends keyof AccountStoreShape>(key: K, value: AccountStoreShape[K]): void;
}

export class AccountStore {
  private readonly backend: AccountStoreBackend;

  constructor(backend?: AccountStoreBackend) {
    this.backend =
      backend ??
      (new Store<AccountStoreShape>({
        name: ACCOUNT_STORE_NAME,
        defaults: { serverUrl: DEFAULT_ACCOUNT_SERVER_URL, session: null },
      }) as unknown as AccountStoreBackend);
  }

  get serverUrl(): string {
    const stored = this.backend.get('serverUrl');
    if (!stored) return DEFAULT_ACCOUNT_SERVER_URL;
    // 旧版本把官方裸 IP 作为默认地址保存；迁移到域名，IP 只保留为运行时故障切换。
    if (stored === DEFAULT_ACCOUNT_SERVER_FALLBACK_URL) {
      this.backend.set('serverUrl', DEFAULT_ACCOUNT_SERVER_URL);
      return DEFAULT_ACCOUNT_SERVER_URL;
    }
    return stored;
  }

  set serverUrl(value: string) {
    this.backend.set('serverUrl', value);
  }

  get session(): AccountSessionState | null {
    const session = this.backend.get('session') ?? null;
    if (session?.imagePricePoints != null && session.imagePriceUnit !== 'point') {
      const migrated = {
        ...session,
        imagePricePoints: accountQuotaToPoints(session.imagePricePoints),
        imagePriceUnit: 'point' as const,
      };
      this.backend.set('session', migrated);
      return migrated;
    }
    return session;
  }

  set session(value: AccountSessionState | null) {
    this.backend.set('session', value);
  }

  patchSession(patch: Partial<AccountSessionState>): AccountSessionState | null {
    const current = this.session;
    if (!current) return null;
    const next = { ...current, ...patch };
    this.session = next;
    return next;
  }
}
