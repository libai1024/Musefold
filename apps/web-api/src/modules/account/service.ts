import type {
  AccountSession,
  LoginRequest,
  RedeemResult,
  RegisterRequest,
} from "@musefold/contracts";
import type { NewApiClient, RelayUser } from "@musefold/new-api-client";
import { AppError } from "../../errors.js";
import type { AccountCredentialStorePort } from "./credential-store.js";
import type { SessionStorePort, StoredSession } from "./session-store.js";

const CLOUD_TOKEN_NAME = "Musefold Cloud v1.1";

export class AccountService {
  constructor(
    private readonly client: NewApiClient,
    private readonly sessions: SessionStorePort,
    private readonly credentials: AccountCredentialStorePort,
  ) {}

  async register(
    input: RegisterRequest,
  ): Promise<AccountSession & { rawSessionId: string }> {
    try {
      await this.client.register({
        username: input.username,
        password: input.password,
      });
      return await this.login(input);
    } catch (error) {
      throw this.mapRelayError(error);
    }
  }

  async login(
    input: LoginRequest,
  ): Promise<AccountSession & { rawSessionId: string }> {
    try {
      const auth = await this.client.login(input);
      const credential = await this.ensureGenerationCredential(auth.jwt);
      await this.credentials.put(
        auth.user.id,
        { apiKey: credential.key },
        credential.id,
      );
      const session = await this.sessions.create({
        ownerId: auth.user.id,
        username: auth.user.username,
        credentials: { accessToken: auth.jwt, refreshToken: auth.refreshToken },
        accessExpiresAt: new Date(auth.jwtExpiresAt * 1_000),
      });
      return this.toResponse(session, auth.user);
    } catch (error) {
      throw this.mapRelayError(error);
    }
  }

  async openDesktopSession(
    accessToken: string,
  ): Promise<AccountSession & { rawSessionId: string }> {
    try {
      const user = await this.client.getSelf(accessToken);
      const credential = await this.ensureGenerationCredential(accessToken);
      await this.credentials.put(
        user.id,
        { apiKey: credential.key },
        credential.id,
      );
      const session = await this.sessions.create({
        ownerId: user.id,
        username: user.username,
        credentials: { accessToken, refreshToken: "" },
        accessExpiresAt: accessTokenExpiry(accessToken),
      });
      return this.toResponse(session, user);
    } catch (error) {
      throw this.mapRelayError(error);
    }
  }

  async getSession(
    rawSessionId: string,
  ): Promise<AccountSession & { rawSessionId: string }> {
    const session = await this.sessions.get(rawSessionId);
    if (!session)
      throw new AppError(
        "AUTH_SESSION_EXPIRED",
        "登录状态已失效，请重新登录",
        401,
      );
    const refreshed = await this.refreshIfNeeded(session);
    try {
      const user = await this.client.getSelf(refreshed.credentials.accessToken);
      return this.toResponse(refreshed, user);
    } catch (error) {
      if (this.isAuthError(error)) {
        await this.sessions.revoke(rawSessionId);
        throw new AppError(
          "AUTH_SESSION_EXPIRED",
          "登录状态已失效，请重新登录",
          401,
        );
      }
      throw this.mapRelayError(error);
    }
  }

  async redeem(rawSessionId: string, code: string): Promise<RedeemResult> {
    const session = await this.requireSession(rawSessionId);
    try {
      const result = await this.client.redeem(
        session.credentials.accessToken,
        code,
      );
      const user = await this.client.getSelf(session.credentials.accessToken);
      return {
        account: this.toAccount(user),
        creditedQuota: result.quotaAdded,
      };
    } catch (error) {
      if (this.isAuthError(error)) {
        await this.sessions.revoke(rawSessionId);
        throw new AppError(
          "AUTH_SESSION_EXPIRED",
          "登录状态已失效，请重新登录",
          401,
        );
      }
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "redeem"
      ) {
        throw new AppError(
          "ACCOUNT_REDEEM_INVALID",
          "兑换失败，请检查兑换码后重试",
          400,
        );
      }
      throw this.mapRelayError(error);
    }
  }

  async logout(rawSessionId: string): Promise<void> {
    await this.sessions.revoke(rawSessionId);
  }

  async reauthenticate(
    ownerId: number,
    username: string,
    password: string,
  ): Promise<void> {
    try {
      const auth = await this.client.login({ username, password });
      if (auth.user.id !== ownerId || auth.user.username !== username) {
        throw new AppError(
          "AUTH_CREDENTIALS_INVALID",
          "账号验证失败，请重新输入密码",
          401,
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      const mapped = this.mapRelayError(error);
      if (mapped.code === "AUTH_CREDENTIALS_INVALID") {
        throw new AppError(
          "AUTH_CREDENTIALS_INVALID",
          "账号验证失败，请重新输入密码",
          401,
        );
      }
      throw mapped;
    }
  }

  private async requireSession(rawSessionId: string): Promise<StoredSession> {
    const session = await this.sessions.get(rawSessionId);
    if (!session)
      throw new AppError(
        "AUTH_SESSION_EXPIRED",
        "登录状态已失效，请重新登录",
        401,
      );
    return this.refreshIfNeeded(session);
  }

  private async refreshIfNeeded(
    session: StoredSession,
  ): Promise<StoredSession> {
    if (session.accessExpiresAt.getTime() - Date.now() > 60_000) return session;
    try {
      const refreshed = await this.client.refresh(
        session.credentials.refreshToken,
      );
      const credentials = {
        accessToken: refreshed.jwt,
        refreshToken: refreshed.refreshToken,
      };
      const accessExpiresAt = new Date(refreshed.jwtExpiresAt * 1_000);
      await this.sessions.replaceCredentials(
        session.rawId,
        credentials,
        accessExpiresAt,
      );
      return { ...session, credentials, accessExpiresAt };
    } catch (error) {
      throw this.mapRelayError(error);
    }
  }

  private async ensureGenerationCredential(
    jwt: string,
  ): Promise<{ id: number; key: string }> {
    let tokens = await this.client.listTokens(jwt);
    let token = tokens
      .filter(
        (candidate) =>
          candidate.name === CLOUD_TOKEN_NAME && candidate.status === 1,
      )
      .sort((a, b) => b.id - a.id)[0];
    if (!token) {
      await this.client.createToken(jwt, { name: CLOUD_TOKEN_NAME });
      tokens = await this.client.listTokens(jwt);
      token = tokens
        .filter((candidate) => candidate.name === CLOUD_TOKEN_NAME)
        .sort((a, b) => b.id - a.id)[0];
    }
    if (!token)
      throw new AppError("INTERNAL_ERROR", "无法供给账号生图凭据", 502, true);
    return {
      id: token.id,
      key: await this.client.fetchTokenKey(jwt, token.id),
    };
  }

  private toResponse(
    session: StoredSession,
    user: RelayUser,
  ): AccountSession & { rawSessionId: string } {
    return {
      rawSessionId: session.rawId,
      csrfToken: session.csrfToken,
      account: this.toAccount(user),
    };
  }

  private toAccount(user: RelayUser): AccountSession["account"] {
    return {
      id: String(user.id),
      username: user.username,
      displayName: null,
      quota: Math.floor(user.quota),
      quotaUnit: "点",
      canGenerate: user.quota > 0,
    };
  }

  private isAuthError(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "auth",
    );
  }

  private mapRelayError(error: unknown): AppError {
    const code =
      error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "credentials")
      return new AppError(
        "AUTH_CREDENTIALS_INVALID",
        "用户名或密码不正确",
        401,
      );
    if (code === "conflict")
      return new AppError("VALIDATION_FAILED", "账号无法注册", 409);
    if (code === "auth")
      return new AppError(
        "AUTH_SESSION_EXPIRED",
        "登录状态已失效，请重新登录",
        401,
      );
    if (code === "network")
      return new AppError("INTERNAL_ERROR", "账号服务暂时不可用", 503, true);
    return new AppError("INTERNAL_ERROR", "账号服务暂时不可用", 502, true);
  }
}

function accessTokenExpiry(accessToken: string): Date {
  try {
    const payload = JSON.parse(
      Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString(
        "utf8",
      ),
    ) as { exp?: unknown };
    if (typeof payload.exp === "number" && Number.isFinite(payload.exp))
      return new Date(payload.exp * 1_000);
  } catch {
    // getSelf already authenticated opaque or non-JWT tokens; use a short metadata expiry.
  }
  return new Date(Date.now() + 15 * 60_000);
}
