// electron/account/account-service.ts
// 账号编排（V05-ACC-03）：登录/注册、JWT 静默续期（单飞）、设备令牌幂等供给、
// 双栈托管写入与回收、余额/定价/公告刷新。唯一的副作用协调者。
//
// 凭据红线：密码只存在于本文件各方法的参数作用域；JWT 仅内存；
// refresh 凭据经 keychain（REFRESH_TOKEN_KEYCHAIN_ID）；sk- 由 provisioner 写入两栈 keychain。

import {
  ACCOUNT_DEFAULT_IMAGE_MODEL,
  ACCOUNT_DEFAULT_TEXT_MODEL,
  DEFAULT_ACCOUNT_SERVER_FALLBACK_URL,
  DEFAULT_ACCOUNT_SERVER_URL,
  DEFAULT_ACCOUNT_SERVER_URLS,
} from "@musefold/domain/constants";
import {
  ACCOUNT_QUOTA_PER_POINT,
  ACCOUNT_QUOTA_PER_USD,
} from "@musefold/contracts/billing.js";
import type { AccountRedeemResult, AccountStatus } from "@shared/types/account";
import type { NewApiClient, RelayAuthSession } from "./api-client";
import {
  createNewApiClient,
  normalizeAccountServerUrl,
  RelayApiError,
} from "./api-client";
import { AccountStore, REFRESH_TOKEN_KEYCHAIN_ID } from "./account-store";
import { AccountError, toAccountError } from "./errors";
import type { AiSecretKeychain } from "../security/ai-keychain";

/** 双栈托管写入/回收端口（真实现见 managed-provisioner.ts；测试注入内存版） */
export interface ManagedProvisioner {
  upsert(input: {
    serverUrl: string;
    textModel: string;
    imageModel: string;
    skKey: string;
    existing: { providerId: string | null; connectionId: string | null };
  }): { providerId: string; connectionId: string };
  remove(targets: {
    providerId: string | null;
    connectionId: string | null;
  }): void;
  /** 托管生图 Provider 单价写入（点/张，FR-GW-09/FR-COST）；Provider 不存在时静默忽略 */
  applyImagePrice(providerId: string, pricePoints: number): void;
}

export interface AccountServiceOptions {
  store?: AccountStore;
  secrets?: AiSecretKeychain;
  provisioner: ManagedProvisioner;
  clientFactory?: (serverUrl: string) => NewApiClient;
  deviceName?: () => string;
  now?: () => number;
  /** account:changed 广播钩子（IPC 层注入） */
  onChanged?: (status: AccountStatus) => void;
}

/** JWT 余量少于该值即续期，避免边界竞态 */
const JWT_SLACK_SECONDS = 60;

function isRetryableRelayError(error: unknown): error is RelayApiError {
  return (
    error instanceof RelayApiError &&
    (error.code === "ACCOUNT/NETWORK" ||
      (error.code === "ACCOUNT/SERVER" &&
        (error.httpStatus == null || error.httpStatus >= 500)))
  );
}

function defaultDeviceName(): string {
  const platform =
    process.platform === "darwin"
      ? "mac"
      : process.platform === "win32"
        ? "win"
        : "linux";
  const rand = Math.random().toString(16).slice(2, 6);
  return `musefold-${platform}-${rand}`;
}

export class AccountService {
  private readonly store: AccountStore;
  private readonly secrets: AiSecretKeychain | undefined;
  private readonly provisioner: ManagedProvisioner;
  private readonly clientFactory: (serverUrl: string) => NewApiClient;
  private readonly deviceName: () => string;
  private readonly now: () => number;
  private readonly onChanged?: (status: AccountStatus) => void;

  private client: NewApiClient;
  /** 当前成功请求所用的入口；配置仍以域名为主，不会被故障切换永久覆盖。 */
  private activeServerUrl: string;
  /** JWT 仅内存（V05-ARCHITECTURE §4） */
  private jwt: { value: string; expiresAt: number } | null = null;
  private refreshInflight: Promise<string> | null = null;

  constructor(options: AccountServiceOptions) {
    this.store = options.store ?? new AccountStore();
    this.secrets = options.secrets;
    this.provisioner = options.provisioner;
    this.clientFactory =
      options.clientFactory ?? ((url) => createNewApiClient(url));
    this.deviceName = options.deviceName ?? defaultDeviceName;
    this.now = options.now ?? Date.now;
    this.onChanged = options.onChanged;
    this.activeServerUrl = this.store.serverUrl;
    this.client = this.clientFactory(this.activeServerUrl);
  }

  /** 官方域名异常时切换到裸 IP；自定义服务器永不自动切换。 */
  private async withFailover<T>(
    operation: (client: NewApiClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await operation(this.client);
    } catch (error) {
      if (
        this.activeServerUrl !== DEFAULT_ACCOUNT_SERVER_URL ||
        !isRetryableRelayError(error)
      ) {
        throw error;
      }

      this.activeServerUrl = DEFAULT_ACCOUNT_SERVER_FALLBACK_URL;
      this.client = this.clientFactory(this.activeServerUrl);
      try {
        return await operation(this.client);
      } catch (fallbackError) {
        // 两个入口都失败时，下次操作仍从域名开始，避免把短暂故障固化成 IP。
        this.activeServerUrl = DEFAULT_ACCOUNT_SERVER_URL;
        this.client = this.clientFactory(this.activeServerUrl);
        throw fallbackError;
      }
    }
  }

  private requireSecrets(): AiSecretKeychain {
    if (!this.secrets)
      throw new AccountError("ACCOUNT/SERVER", "密钥存储不可用");
    return this.secrets;
  }

  // ---------- 状态 ----------

  status(): AccountStatus {
    const session = this.store.session;
    const quota = session?.quotaCache ?? null;
    const price = session?.imagePricePoints ?? null;
    return {
      loggedIn: Boolean(session),
      username: session?.username ?? null,
      serverUrl: this.activeServerUrl,
      isDefaultServer: DEFAULT_ACCOUNT_SERVER_URLS.includes(
        this.activeServerUrl as (typeof DEFAULT_ACCOUNT_SERVER_URLS)[number],
      ),
      quota,
      estImagesRemaining:
        quota && price && price > 0
          ? Math.max(
              0,
              Math.floor(quota.value / ACCOUNT_QUOTA_PER_POINT / price),
            )
          : null,
      deviceTokenSuffix: session?.deviceTokenSuffix ?? null,
      health: session?.health ?? "unknown",
      notices: session?.notices ?? [],
    };
  }

  cloudIdentity(): {
    ownerId: string;
    username: string;
    cloudBaseUrl: string;
  } | null {
    const session = this.store.session;
    if (
      !session ||
      !DEFAULT_ACCOUNT_SERVER_URLS.includes(
        this.activeServerUrl as (typeof DEFAULT_ACCOUNT_SERVER_URLS)[number],
      )
    )
      return null;
    return {
      ownerId: String(session.userId),
      username: session.username,
      cloudBaseUrl: `${DEFAULT_ACCOUNT_SERVER_URL}/api/musefold/v1`,
    };
  }

  async managementAccessToken(): Promise<string> {
    if (!this.store.session) throw new AccountError("ACCOUNT/AUTH", "尚未登录");
    return this.ensureJwt();
  }

  private broadcast(): AccountStatus {
    const status = this.status();
    this.onChanged?.(status);
    return status;
  }

  // ---------- 注册 / 登录（§5.1 编排 + NFR-REL-02 回滚） ----------

  async register(input: {
    username: string;
    password: string;
  }): Promise<AccountStatus> {
    try {
      await this.withFailover((client) => client.register(input));
    } catch (error) {
      throw toAccountError(error, "auth");
    }
    return this.login(input);
  }

  async login(input: {
    username: string;
    password: string;
  }): Promise<AccountStatus> {
    const secrets = this.requireSecrets();
    const previousSession = this.store.session;

    // 1 认证
    let auth: RelayAuthSession;
    try {
      auth = await this.withFailover((client) => client.login(input));
    } catch (error) {
      throw toAccountError(error, "auth");
    }

    let refreshSaved = false;
    let provisioned: { providerId: string; connectionId: string } | null = null;
    try {
      // 2 管理凭据入库（JWT 仅内存）
      secrets.save(REFRESH_TOKEN_KEYCHAIN_ID, auth.refreshToken);
      refreshSaved = true;
      this.jwt = { value: auth.jwt, expiresAt: auth.jwtExpiresAt };

      // 3/4 设备令牌幂等供给（FR-ACC-07）
      const deviceTokenName =
        previousSession?.deviceTokenName ?? this.deviceName();
      const token = await this.ensureDeviceToken(
        auth.jwt,
        previousSession?.deviceTokenId ?? null,
        deviceTokenName,
      );

      // 5 双栈托管写入（幂等 upsert）
      provisioned = this.provisioner.upsert({
        serverUrl: this.activeServerUrl,
        textModel: ACCOUNT_DEFAULT_TEXT_MODEL,
        imageModel: ACCOUNT_DEFAULT_IMAGE_MODEL,
        skKey: token.key,
        existing: {
          providerId: previousSession?.managedProviderId ?? null,
          connectionId: previousSession?.managedConnectionId ?? null,
        },
      });

      // 6 会话落库 + 广播
      this.store.session = {
        username: auth.user.username,
        userId: auth.user.id,
        group: auth.user.group,
        deviceTokenId: token.id,
        deviceTokenName,
        deviceTokenSuffix: token.key.slice(-4),
        managedProviderId: provisioned.providerId,
        managedConnectionId: provisioned.connectionId,
        quotaCache: { value: auth.user.quota, at: this.now() },
        health: "ok",
        pricingVersion: previousSession?.pricingVersion ?? null,
        imagePricePoints: previousSession?.imagePricePoints ?? null,
        imagePriceUnit: 'point',
        notices: previousSession?.notices ?? [],
      };

      // 定价与公告：增强信息，失败不阻塞登录
      await this.syncPricingAndNotices().catch(() => undefined);
      return this.broadcast();
    } catch (error) {
      // 回滚（NFR-REL-02）：逆序清理，回到干净未登录态
      if (provisioned) {
        try {
          this.provisioner.remove(provisioned);
        } catch {
          /* 回滚尽力而为 */
        }
      }
      if (refreshSaved) {
        try {
          secrets.delete(REFRESH_TOKEN_KEYCHAIN_ID);
        } catch {
          /* 同上 */
        }
      }
      this.jwt = null;
      this.store.session = null;
      this.broadcast();
      const stage = provisioned
        ? "provision"
        : refreshSaved
          ? "provision"
          : "token";
      throw toAccountError(
        error,
        error instanceof AccountError && error.stage ? error.stage : stage,
      );
    }
  }

  private async ensureDeviceToken(
    jwt: string,
    existingId: number | null,
    deviceTokenName: string,
  ): Promise<{ id: number; key: string }> {
    try {
      if (existingId != null) {
        try {
          const key = await this.withFailover((client) =>
            client.fetchTokenKey(jwt, existingId),
          );
          return { id: existingId, key };
        } catch (error) {
          if (
            error instanceof RelayApiError &&
            (error.code === "ACCOUNT/AUTH" || error.code === "ACCOUNT/NETWORK")
          ) {
            throw error; // 凭据/网络问题不该走"重建令牌"
          }
          /* 令牌已被删除等 → 走新建 */
        }
      }
      await this.withFailover((client) =>
        client.createToken(jwt, { name: deviceTokenName }),
      );
      const tokens = await this.withFailover((client) =>
        client.listTokens(jwt),
      );
      const created = tokens
        .filter((t) => t.name === deviceTokenName)
        .sort((a, b) => b.id - a.id)[0];
      if (!created)
        throw new RelayApiError("ACCOUNT/SERVER", "设备令牌创建后未找到");
      const key = await this.withFailover((client) =>
        client.fetchTokenKey(jwt, created.id),
      );
      return { id: created.id, key };
    } catch (error) {
      throw toAccountError(error, "token");
    }
  }

  // ---------- 静默续期（§5.2，单飞） ----------

  private async ensureJwt(): Promise<string> {
    const nowSeconds = Math.floor(this.now() / 1000);
    if (this.jwt && this.jwt.expiresAt - nowSeconds > JWT_SLACK_SECONDS)
      return this.jwt.value;
    if (this.refreshInflight) return this.refreshInflight;

    const secrets = this.requireSecrets();
    const refreshToken = secrets.load(REFRESH_TOKEN_KEYCHAIN_ID);
    if (!refreshToken) {
      throw new AccountError("ACCOUNT/AUTH", "尚未登录");
    }

    this.refreshInflight = (async () => {
      try {
        const session = await this.withFailover((client) =>
          client.refresh(refreshToken),
        );
        // 响应必轮换 refresh 值：立即回存（V05-ARCHITECTURE §2.1）
        secrets.save(REFRESH_TOKEN_KEYCHAIN_ID, session.refreshToken);
        this.jwt = { value: session.jwt, expiresAt: session.jwtExpiresAt };
        return session.jwt;
      } catch (error) {
        if (error instanceof RelayApiError && error.code === "ACCOUNT/AUTH") {
          this.store.patchSession({ health: "token-invalid" });
          this.broadcast();
        } else if (
          error instanceof RelayApiError &&
          error.code === "ACCOUNT/NETWORK"
        ) {
          this.store.patchSession({ health: "unreachable" });
          this.broadcast();
        }
        throw toAccountError(error);
      } finally {
        this.refreshInflight = null;
      }
    })();
    return this.refreshInflight;
  }

  // ---------- 余额 / 定价 / 公告 ----------

  async refreshQuota(): Promise<AccountStatus> {
    if (!this.store.session) throw new AccountError("ACCOUNT/AUTH", "尚未登录");
    const jwt = await this.ensureJwt();
    try {
      const user = await this.withFailover((client) => client.getSelf(jwt));
      this.store.patchSession({
        quotaCache: { value: user.quota, at: this.now() },
        group: user.group,
        health: "ok",
      });
    } catch (error) {
      const mapped = toAccountError(error);
      this.store.patchSession({
        health:
          mapped.code === "ACCOUNT/AUTH"
            ? "token-invalid"
            : mapped.code === "ACCOUNT/NETWORK"
              ? "unreachable"
              : "ok",
      });
      this.broadcast();
      throw mapped;
    }
    await this.syncPricingAndNotices().catch(() => undefined);
    return this.broadcast();
  }

  /** 定价（pricing_version 门控）与公告同步：均为增强信息，调用方决定是否吞错 */
  private async syncPricingAndNotices(): Promise<void> {
    const session = this.store.session;
    if (!session) return;

    const pricing = await this.withFailover((client) => client.getPricing());
    if (pricing.version && pricing.version !== session.pricingVersion) {
      const image = pricing.models.find(
        (m) =>
          m.modelName === ACCOUNT_DEFAULT_IMAGE_MODEL &&
          m.quotaType === 1 &&
          m.modelPrice > 0,
      );
      if (image && session.managedProviderId) {
        const groupRatio =
          pricing.groupRatio[session.group] ?? pricing.groupRatio.default ?? 1;
        const pricePoints =
          image.modelPrice *
          (ACCOUNT_QUOTA_PER_USD / ACCOUNT_QUOTA_PER_POINT) *
          (groupRatio || 1);
        this.provisioner.applyImagePrice(
          session.managedProviderId,
          pricePoints,
        );
        this.store.patchSession({
          pricingVersion: pricing.version,
          imagePricePoints: pricePoints,
          imagePriceUnit: "point",
        });
      } else {
        this.store.patchSession({ pricingVersion: pricing.version });
      }
    }

    const notices = await this.withFailover((client) => client.getNotices());
    this.store.patchSession({ notices });
  }

  // ---------- 兑换 ----------

  async redeem(code: string): Promise<AccountRedeemResult> {
    if (!this.store.session) throw new AccountError("ACCOUNT/AUTH", "尚未登录");
    const trimmed = code.trim();
    if (!trimmed)
      throw new AccountError(
        "ACCOUNT/REDEEM_INVALID",
        "兑换失败，请检查兑换码后重试",
      );
    const jwt = await this.ensureJwt();
    let quotaAdded: number;
    try {
      ({ quotaAdded } = await this.withFailover((client) =>
        client.redeem(jwt, trimmed),
      ));
    } catch (error) {
      throw toAccountError(error);
    }
    // 管理面余额即时到账；刷新失败不影响兑换结果（/v1 侧缓存延迟由 UI 文案容忍）
    const status = await this.refreshQuota().catch(() => this.broadcast());
    return { quotaAdded, status };
  }

  // ---------- 登出（§5.3：本地操作，服务器不可达也成功） ----------

  async logout(): Promise<AccountStatus> {
    const session = this.store.session;
    if (session) {
      try {
        this.provisioner.remove({
          providerId: session.managedProviderId,
          connectionId: session.managedConnectionId,
        });
      } catch {
        /* 回收尽力而为：残留由下次登录的 upsert 纠正 */
      }
    }
    try {
      this.requireSecrets().delete(REFRESH_TOKEN_KEYCHAIN_ID);
    } catch {
      /* 同上 */
    }
    this.jwt = null;
    this.store.session = null;
    this.activeServerUrl = this.store.serverUrl;
    this.client = this.clientFactory(this.activeServerUrl);
    return this.broadcast();
  }

  // ---------- 服务器地址（FR-ACC-08） ----------

  async setServerUrl(url: string): Promise<AccountStatus> {
    if (this.store.session) {
      throw new AccountError(
        "ACCOUNT/MANAGED_READONLY",
        "更换服务器前请先退出登录",
      );
    }
    let normalized: string;
    try {
      normalized = normalizeAccountServerUrl(url);
    } catch (error) {
      throw toAccountError(error);
    }
    this.store.serverUrl = normalized;
    this.activeServerUrl = normalized;
    this.client = this.clientFactory(normalized);
    return this.broadcast();
  }
}
