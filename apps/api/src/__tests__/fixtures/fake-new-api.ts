import { randomUUID } from 'node:crypto';
import type {
  NewApiClient,
  RelayApiToken,
  RelayAuthSession,
  RelayUser,
} from '@musefold/new-api-client';

export const RELAY_USER: RelayUser = {
  id: 42,
  username: 'tester',
  quota: 2_000_000,
  group: 'default',
};

/** 假 New API:凭据校验/余额/兑换全部走内存实现。 */
export function createFakeNewApi(options: { imageModels?: string[] } = {}): NewApiClient {
  const tokens = new Map<number, RelayApiToken[]>();
  const sessions = new Map<string, RelayUser>();
  const refreshes = new Map<string, RelayUser>();
  function issue(owner: RelayUser): RelayAuthSession {
    const jwt = randomUUID();
    const refreshToken = randomUUID();
    sessions.set(jwt, owner);
    refreshes.set(refreshToken, owner);
    return { jwt, refreshToken, jwtExpiresAt: Math.floor(Date.now() / 1000) + 3600, user: owner };
  }
  function ownerOf(jwt: string): RelayUser {
    const owner = sessions.get(jwt);
    if (!owner) throw Object.assign(new Error('Session expired'), { code: 'auth' });
    return owner;
  }
  let quota = RELAY_USER.quota;
  return {
    async register() {},
    async login({ username, password }) {
      if (password !== 'correct-password') {
        throw Object.assign(new Error('用户名或密码错误'), { code: 'credentials' });
      }
      // JWTs, token IDs and keys remain scoped to their authenticating upstream owner.
      const id =
        username === RELAY_USER.username || username === 'tester@musefold.app'
          ? RELAY_USER.id
          : 10_000 + [...username].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      return issue({ ...RELAY_USER, id, username: id === RELAY_USER.id ? 'tester' : username });
    },
    async refresh(token) {
      const owner = refreshes.get(token);
      if (!owner) throw Object.assign(new Error('Session expired'), { code: 'auth' });
      refreshes.delete(token);
      return issue(owner);
    },
    async getSelf(jwt) {
      return { ...ownerOf(jwt), quota };
    },
    async listUserModels(jwt) {
      ownerOf(jwt);
      return options.imageModels ?? ['musefold-image-pro'];
    },
    async createToken(jwt, input) {
      const owner = ownerOf(jwt).id;
      const owned = tokens.get(owner) ?? [];
      owned.push({ id: owned.length + 1, name: input.name, status: 1, keyMasked: 'sk-***' });
      tokens.set(owner, owned);
    },
    async listTokens(jwt) {
      return [...(tokens.get(ownerOf(jwt).id) ?? [])];
    },
    async fetchTokenKey(jwt, tokenId) {
      const owner = ownerOf(jwt).id;
      if (!tokens.get(owner)?.some((token) => token.id === tokenId))
        throw Object.assign(new Error('Unavailable token'), { code: 'server', httpStatus: 404 });
      return `sk-full-${owner}-${tokenId}`;
    },
    async redeem(_jwt, code) {
      if (code !== 'GOOD-CODE') {
        throw Object.assign(new Error('兑换码无效'), { code: 'redeem' });
      }
      quota += 500_000;
      return { quotaAdded: 500_000 };
    },
    async getPricing(jwt) {
      if (options.imageModels) ownerOf(jwt ?? '');
      return {
        version: 'v1',
        groupRatio: { default: 3 },
        models: (options.imageModels ?? []).map((modelName, index) => ({
          modelName,
          quotaType: 1,
          modelPrice: 0.04 * (index + 1),
          modelRatio: null,
          completionRatio: null,
          billingMode: null,
          enableGroups: ['default'],
          supportedEndpointTypes: ['image-generation'],
        })),
      };
    },
    async getNotices() {
      return [];
    },
  };
}
