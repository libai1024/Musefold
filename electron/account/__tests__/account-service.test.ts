// V05-ACC-03 单测：登录编排回滚、幂等令牌供给、静默续期单飞、回收彻底性、
// 定价同步门控、凭据序列化红线（NFR-SEC-03）。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ACCOUNT_SERVER_FALLBACK_URL,
  DEFAULT_ACCOUNT_SERVER_URL,
} from '@shared/constants';
import type { NewApiClient } from '../api-client';
import { RelayApiError } from '../api-client';
import { AccountService, type ManagedProvisioner } from '../account-service';
import { AccountStore, REFRESH_TOKEN_KEYCHAIN_ID, type AccountStoreBackend, type AccountStoreShape } from '../account-store';
import { AccountError } from '../errors';
import type { AiSecretKeychain } from '../../security/ai-keychain';

// ---------- 内存 fakes ----------

function memoryBackend(): AccountStoreBackend & { dump(): AccountStoreShape } {
  const state: AccountStoreShape = { serverUrl: DEFAULT_ACCOUNT_SERVER_URL, session: null };
  return {
    get: (key) => state[key] as never,
    set: (key, value) => {
      (state as unknown as Record<string, unknown>)[key] = value;
    },
    dump: () => state,
  };
}

function memoryKeychain(): AiSecretKeychain & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    save: (id, key) => void map.set(id, key),
    load: (id) => map.get(id) ?? null,
    delete: (id) => void map.delete(id),
    has: (id) => map.has(id),
    suffix: (id) => map.get(id)?.slice(-4) ?? null,
    dump: () => Object.fromEntries(map),
  };
}

function fakeProvisioner(): ManagedProvisioner & {
  upsertCalls: unknown[];
  removeCalls: unknown[];
  priceCalls: Array<{ providerId: string; pricePoints: number }>;
  failNextUpsert?: Error;
} {
  const self = {
    upsertCalls: [] as unknown[],
    removeCalls: [] as unknown[],
    priceCalls: [] as Array<{ providerId: string; pricePoints: number }>,
    failNextUpsert: undefined as Error | undefined,
    upsert(input: unknown) {
      if (self.failNextUpsert) {
        const error = self.failNextUpsert;
        self.failNextUpsert = undefined;
        throw error;
      }
      self.upsertCalls.push(input);
      return { providerId: 'prov-1', connectionId: 'conn-1' };
    },
    remove(targets: unknown) {
      self.removeCalls.push(targets);
    },
    applyImagePrice(providerId: string, pricePoints: number) {
      self.priceCalls.push({ providerId, pricePoints });
    },
  };
  return self;
}

let nowMs = 1_786_600_000_000;
const nowSec = () => Math.floor(nowMs / 1000);

function fakeClient(overrides: Partial<NewApiClient> = {}): NewApiClient {
  const user = { id: 4, username: 'wang', quota: 1_000_000, group: 'default' };
  return {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => ({
      jwt: 'jwt-1',
      jwtExpiresAt: nowSec() + 1800,
      refreshToken: 'refresh-1',
      user,
    })),
    refresh: vi.fn(async () => ({
      jwt: 'jwt-2',
      jwtExpiresAt: nowSec() + 1800,
      refreshToken: 'refresh-2',
      user,
    })),
    getSelf: vi.fn(async () => ({ ...user, quota: 900_000 })),
    listUserModels: vi.fn(async () => ['musefold-agent', 'musefold-image-pro']),
    createToken: vi.fn(async () => undefined),
    listTokens: vi.fn(async () => [{ id: 9, name: 'musefold-test-abcd', status: 1, keyMasked: 'tP1**' }]),
    fetchTokenKey: vi.fn(async () => 'sk-DEVICEKEY1234'),
    redeem: vi.fn(async () => ({ quotaAdded: 500_000 })),
    getPricing: vi.fn(async () => ({
      version: 'v-a',
      groupRatio: { default: 1 },
      models: [
        { modelName: 'musefold-agent', quotaType: 0 as const, modelRatio: 2.5, completionRatio: 8, modelPrice: 0, enableGroups: ['default'] },
        { modelName: 'musefold-image-pro', quotaType: 1 as const, modelRatio: 0, completionRatio: 0, modelPrice: 0.04, enableGroups: ['default'] },
      ],
    })),
    getNotices: vi.fn(async () => [{ id: 'n-1', content: '公告', publishedAt: null }]),
    ...overrides,
  };
}

interface Harness {
  service: AccountService;
  client: NewApiClient;
  backend: ReturnType<typeof memoryBackend>;
  keychain: ReturnType<typeof memoryKeychain>;
  provisioner: ReturnType<typeof fakeProvisioner>;
  changed: unknown[];
}

function makeHarness(clientOverrides: Partial<NewApiClient> = {}): Harness {
  const backend = memoryBackend();
  const keychain = memoryKeychain();
  const provisioner = fakeProvisioner();
  const client = fakeClient(clientOverrides);
  const changed: unknown[] = [];
  const service = new AccountService({
    store: new AccountStore(backend),
    secrets: keychain,
    provisioner,
    clientFactory: () => client,
    deviceName: () => 'musefold-test-abcd',
    now: () => nowMs,
    onChanged: (status) => changed.push(status),
  });
  return { service, client, backend, keychain, provisioner, changed };
}

beforeEach(() => {
  nowMs = 1_786_600_000_000;
});

// ---------- 登录编排 ----------

describe('login 编排（§5.1）', () => {
  it('成功路径：refresh 入 keychain、双栈供给、会话与后 4 位落库、广播', async () => {
    const h = makeHarness();
    const status = await h.service.login({ username: 'wang', password: 'pw-secret' });

    expect(h.keychain.load(REFRESH_TOKEN_KEYCHAIN_ID)).toBe('refresh-1');
    expect(h.provisioner.upsertCalls[0]).toMatchObject({
      serverUrl: DEFAULT_ACCOUNT_SERVER_URL,
      textModel: 'musefold-agent',
      imageModel: 'musefold-image-pro',
      skKey: 'sk-DEVICEKEY1234',
    });
    expect(status).toMatchObject({
      loggedIn: true,
      username: 'wang',
      deviceTokenSuffix: '1234',
      health: 'ok',
    });
    // 定价同步（version 门控首轮）：0.04 元 = 0.4 积分/张
    expect(h.provisioner.priceCalls).toEqual([{ providerId: 'prov-1', pricePoints: 0.4 }]);
    // 1000000 quota = 20 积分，约可生成 50 张
    expect(status.estImagesRemaining).toBe(50);
    expect(h.changed.length).toBeGreaterThan(0);
  });

  it('新设备：createToken → listTokens 按名定位 → fetchTokenKey', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    expect(h.client.createToken).toHaveBeenCalledWith('jwt-1', { name: 'musefold-test-abcd' });
    expect(h.client.fetchTokenKey).toHaveBeenCalledWith('jwt-1', 9);
  });

  it('重登复用设备令牌：fetchTokenKey(existingId) 成功则不再创建', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    (h.client.createToken as ReturnType<typeof vi.fn>).mockClear();

    await h.service.login({ username: 'wang', password: 'pw' });
    expect(h.client.createToken).not.toHaveBeenCalled();
    expect(h.client.fetchTokenKey).toHaveBeenLastCalledWith('jwt-1', 9);
  });

  it('令牌在网页端被删：取回失败 → 自动新建（自愈）', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });

    const fetchKey = h.client.fetchTokenKey as ReturnType<typeof vi.fn>;
    fetchKey.mockRejectedValueOnce(new RelayApiError('ACCOUNT/SERVER', '令牌不存在', 404));
    await h.service.login({ username: 'wang', password: 'pw' });
    expect(h.client.createToken).toHaveBeenCalledTimes(2);
  });

  it('编排中途失败 → 全量回滚：keychain 清空、session 置空、错误带阶段', async () => {
    const h = makeHarness();
    h.provisioner.failNextUpsert = new Error('db locked');

    const error = await h.service.login({ username: 'wang', password: 'pw' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AccountError);
    expect((error as AccountError).stage).toBeTruthy();
    expect(h.keychain.load(REFRESH_TOKEN_KEYCHAIN_ID)).toBeNull();
    expect(h.backend.dump().session).toBeNull();
    expect(h.service.status().loggedIn).toBe(false);
  });

  it('凭据错误：直接 ACCOUNT/CREDENTIALS，不触碰 keychain', async () => {
    const h = makeHarness({
      login: vi.fn(async () => {
        throw new RelayApiError('ACCOUNT/CREDENTIALS', '用户名或密码错误');
      }),
    });
    const error = await h.service.login({ username: 'x', password: 'y' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AccountError).code).toBe('ACCOUNT/CREDENTIALS');
    expect(h.keychain.dump()).toEqual({});
  });

  it('register 成功后自动登录（US-01）', async () => {
    const h = makeHarness();
    const status = await h.service.register({ username: 'wang', password: 'pw' });
    expect(h.client.register).toHaveBeenCalled();
    expect(status.loggedIn).toBe(true);
  });
});

// ---------- 静默续期 ----------

describe('ensureJwt 静默续期（§5.2）', () => {
  it('JWT 过期后管理操作触发 refresh，且轮换值立即回存', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });

    nowMs += 1800_000; // JWT 过期
    await h.service.refreshQuota();
    expect(h.client.refresh).toHaveBeenCalledWith('refresh-1');
    expect(h.keychain.load(REFRESH_TOKEN_KEYCHAIN_ID)).toBe('refresh-2');
  });

  it('并发管理操作只触发一次 refresh（单飞）', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });

    nowMs += 1800_000;
    await Promise.all([h.service.refreshQuota(), h.service.refreshQuota()]);
    expect(h.client.refresh).toHaveBeenCalledTimes(1);
  });

  it('refresh 失效 → health=token-invalid，session 保留，抛 ACCOUNT/AUTH', async () => {
    const h = makeHarness({
      refresh: vi.fn(async () => {
        throw new RelayApiError('ACCOUNT/AUTH', 'Unauthorized', 401);
      }),
    });
    await h.service.login({ username: 'wang', password: 'pw' });

    nowMs += 1800_000;
    const error = await h.service.refreshQuota().then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as AccountError).code).toBe('ACCOUNT/AUTH');
    const status = h.service.status();
    expect(status.loggedIn).toBe(true);
    expect(status.health).toBe('token-invalid');
  });

  it('服务器不可达 → health=unreachable，余额缓存保留', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    (h.client.refresh as ReturnType<typeof vi.fn>).mockRejectedValue(
      new RelayApiError('ACCOUNT/NETWORK', '无法连接账号服务器'),
    );

    nowMs += 1800_000;
    await expect(h.service.refreshQuota()).rejects.toMatchObject({ code: 'ACCOUNT/NETWORK' });
    const status = h.service.status();
    expect(status.health).toBe('unreachable');
    expect(status.quota?.value).toBe(1_000_000);
  });
});

// ---------- 余额 / 定价 ----------

describe('refreshQuota 与定价门控（FR-GW-09）', () => {
  it('刷新余额并重算可生成张数；pricing_version 未变则不重复应用', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    expect(h.provisioner.priceCalls).toHaveLength(1);

    const status = await h.service.refreshQuota();
    expect(status.quota?.value).toBe(900_000);
    expect(status.estImagesRemaining).toBe(45); // 900000 quota = 18 积分；18 ÷ 0.4
    expect(h.provisioner.priceCalls).toHaveLength(1); // version 未变，跳过
  });

  it('version 变化 → 重新应用单价（含分组倍率）', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });

    (h.client.getPricing as ReturnType<typeof vi.fn>).mockResolvedValue({
      version: 'v-b',
      groupRatio: { default: 2 },
      models: [
        { modelName: 'musefold-image-pro', quotaType: 1, modelRatio: 0, completionRatio: 0, modelPrice: 0.05, enableGroups: ['default'] },
      ],
    });
    await h.service.refreshQuota();
    expect(h.provisioner.priceCalls[1]).toEqual({ providerId: 'prov-1', pricePoints: 1 });
  });

  it('公告随刷新更新到状态', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    const status = await h.service.refreshQuota();
    expect(status.notices).toEqual([{ id: 'n-1', content: '公告', publishedAt: null }]);
  });
});

// ---------- 兑换 ----------

describe('redeem（FR-ACC-05）', () => {
  it('成功：返回到账点数并刷新余额', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    const result = await h.service.redeem('CODE');
    expect(result.quotaAdded).toBe(500_000);
    expect(result.status.quota?.value).toBe(900_000);
  });

  it('空码本地拦截 → REDEEM_INVALID；未登录 → AUTH', async () => {
    const h = makeHarness();
    await expect(h.service.redeem('x')).rejects.toMatchObject({ code: 'ACCOUNT/AUTH' });
    await h.service.login({ username: 'wang', password: 'pw' });
    await expect(h.service.redeem('   ')).rejects.toMatchObject({ code: 'ACCOUNT/REDEEM_INVALID' });
  });
});

// ---------- 登出 ----------

describe('logout（§5.3 回收彻底性）', () => {
  it('删除托管目标与 refresh 凭据，session 置空；provisioner 失败不阻塞', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });

    h.provisioner.remove = () => {
      throw new Error('db locked');
    };
    const status = await h.service.logout();
    expect(status.loggedIn).toBe(false);
    expect(h.keychain.dump()).toEqual({});
    expect(h.backend.dump().session).toBeNull();
  });
});

// ---------- 服务器地址 ----------

describe('setServerUrl（FR-ACC-08）', () => {
  it('已登录拒绝；未登录归一化保存', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw' });
    await expect(h.service.setServerUrl('https://x.test')).rejects.toMatchObject({
      code: 'ACCOUNT/MANAGED_READONLY',
    });

    await h.service.logout();
    const status = await h.service.setServerUrl('https://x.test/');
    expect(status.serverUrl).toBe('https://x.test');
    expect(status.isDefaultServer).toBe(false);
  });
});

describe('官方入口故障切换', () => {
  it('主域名网络失败时切到 IP，并让托管连接使用实际入口', async () => {
    const backend = memoryBackend();
    const keychain = memoryKeychain();
    const provisioner = fakeProvisioner();
    const primary = fakeClient({
      login: vi.fn(async () => {
        throw new RelayApiError('ACCOUNT/NETWORK', '无法连接账号服务器');
      }),
    });
    const fallback = fakeClient();
    const clients = new Map([
      [DEFAULT_ACCOUNT_SERVER_URL, primary],
      [DEFAULT_ACCOUNT_SERVER_FALLBACK_URL, fallback],
    ]);
    const service = new AccountService({
      store: new AccountStore(backend),
      secrets: keychain,
      provisioner,
      clientFactory: (url) => clients.get(url) ?? primary,
      deviceName: () => 'musefold-test-abcd',
      now: () => nowMs,
    });

    const status = await service.login({ username: 'wang', password: 'pw' });
    expect(status.serverUrl).toBe(DEFAULT_ACCOUNT_SERVER_FALLBACK_URL);
    expect(status.isDefaultServer).toBe(true);
    expect(provisioner.upsertCalls[0]).toMatchObject({ serverUrl: DEFAULT_ACCOUNT_SERVER_FALLBACK_URL });
    expect(backend.dump().serverUrl).toBe(DEFAULT_ACCOUNT_SERVER_URL);
  });
});

// ---------- 凭据红线 ----------

describe('凭据序列化红线（NFR-SEC-03）', () => {
  it('密码/JWT 不出现在 store 与状态序列化中；refresh 只在 keychain', async () => {
    const h = makeHarness();
    await h.service.login({ username: 'wang', password: 'pw-secret-!!' });

    const storeDump = JSON.stringify(h.backend.dump());
    const statusDump = JSON.stringify(h.service.status());
    for (const dump of [storeDump, statusDump]) {
      expect(dump).not.toContain('pw-secret-!!');
      expect(dump).not.toContain('jwt-1');
      expect(dump).not.toContain('refresh-1');
      expect(dump).not.toContain('sk-DEVICEKEY1234');
    }
    expect(statusDump).toContain('1234'); // 仅后 4 位后缀
  });
});
