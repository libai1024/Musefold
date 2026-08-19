import type { NewApiClient } from "@musefold/new-api-client";
import { describe, expect, it, vi } from "vitest";
import { AccountService } from "../service.js";
import type { AccountCredentialStorePort } from "../credential-store.js";
import type { SessionStorePort, StoredSession } from "../session-store.js";

function fixture() {
  let stored: StoredSession | null = null;
  const sessions: SessionStorePort = {
    async create(input) {
      stored = {
        rawId: "opaque-session",
        ownerId: input.ownerId,
        username: input.username,
        csrfToken: "csrf-token-000000000000000000000000",
        credentials: input.credentials,
        accessExpiresAt: input.accessExpiresAt,
        lastSeenAt: new Date(),
      };
      return stored;
    },
    async get(rawId) {
      return rawId === stored?.rawId ? stored : null;
    },
    async replaceCredentials(_rawId, credentials, accessExpiresAt) {
      if (stored) stored = { ...stored, credentials, accessExpiresAt };
    },
    async revoke() {
      stored = null;
    },
  };
  const client: NewApiClient = {
    register: vi.fn(async () => undefined),
    login: vi.fn(async () => ({
      jwt: "jwt",
      refreshToken: "refresh",
      jwtExpiresAt: Math.floor(Date.now() / 1_000) + 1_800,
      user: { id: 7, username: "musefold", quota: 9_000, group: "default" },
    })),
    refresh: vi.fn(async () => {
      throw new Error("not expected");
    }),
    getSelf: vi.fn(async () => ({
      id: 7,
      username: "musefold",
      quota: 9_000,
      group: "default",
    })),
    createToken: vi.fn(async () => undefined),
    listTokens: vi.fn(async () => [
      { id: 91, name: "Musefold Cloud v1.1", status: 1, keyMasked: "sk-***" },
    ]),
    fetchTokenKey: vi.fn(async () => "sk-test"),
    redeem: vi.fn(async () => ({ quotaAdded: 1_000 })),
  };
  const credentials: AccountCredentialStorePort = {
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ apiKey: "sk-test" })),
  };
  return {
    service: new AccountService(client, sessions, credentials),
    client,
    credentials,
  };
}

describe("account application service", () => {
  it("keeps relay credentials behind an opaque session id", async () => {
    const { service, credentials } = fixture();
    const result = await service.login({
      username: "musefold",
      password: "secret",
    });
    expect(result).toMatchObject({
      rawSessionId: "opaque-session",
      account: { id: "7", quota: 9_000, canGenerate: true },
    });
    expect(result).not.toHaveProperty("jwt");
    expect(result).not.toHaveProperty("refreshToken");
    expect(credentials.put).toHaveBeenCalledWith(7, { apiKey: "sk-test" }, 91);
  });

  it("uses the authenticated session for redemption and revokes it on logout", async () => {
    const { service, client } = fixture();
    await service.login({ username: "musefold", password: "secret" });
    await expect(
      service.redeem("opaque-session", "code"),
    ).resolves.toMatchObject({ creditedQuota: 1_000 });
    expect(client.redeem).toHaveBeenCalledWith("jwt", "code");
    await service.logout("opaque-session");
    await expect(service.getSession("opaque-session")).rejects.toMatchObject({
      code: "AUTH_SESSION_EXPIRED",
    });
  });

  it("exchanges a validated relay access token for an opaque desktop session", async () => {
    const { service, client, credentials } = fixture();
    const result = await service.openDesktopSession("relay-management-jwt");

    expect(client.getSelf).toHaveBeenCalledWith("relay-management-jwt");
    expect(result).toMatchObject({
      rawSessionId: "opaque-session",
      account: { id: "7", username: "musefold" },
    });
    expect(result).not.toHaveProperty("credentials");
    expect(credentials.put).toHaveBeenCalledWith(7, { apiKey: "sk-test" }, 91);
  });

  it("reauthenticates sensitive policy changes without rotating the session", async () => {
    const { service, client, credentials } = fixture();

    await expect(
      service.reauthenticate(7, "musefold", "current-password"),
    ).resolves.toBeUndefined();

    expect(client.login).toHaveBeenCalledWith({
      username: "musefold",
      password: "current-password",
    });
    expect(credentials.put).not.toHaveBeenCalled();
  });

  it("rejects a relay identity mismatch during reauthentication", async () => {
    const { service, client } = fixture();
    vi.mocked(client.login).mockResolvedValueOnce({
      jwt: "other-jwt",
      refreshToken: "other-refresh",
      jwtExpiresAt: Math.floor(Date.now() / 1_000) + 1_800,
      user: { id: 8, username: "other", quota: 9_000, group: "default" },
    });

    await expect(
      service.reauthenticate(7, "musefold", "current-password"),
    ).rejects.toMatchObject({
      code: "AUTH_CREDENTIALS_INVALID",
      statusCode: 401,
    });
  });
});
