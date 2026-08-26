import { describe, expect, it, vi } from "vitest";
import { createMusefoldCloudClient, MusefoldCloudError } from "../index.js";

const session = {
  account: {
    id: "42",
    username: "libai",
    displayName: null,
    quota: 100,
    quotaUnit: "点",
    canGenerate: true,
  },
  csrfToken: "csrf-token-0000000000000000000000000001",
};

const generationJob = {
  id: "6f1ce4dc-5703-4bd8-9e65-c06c4f14feab",
  sessionId: null,
  parentRunId: null,
  promptId: null,
  actorType: "web",
  approvalStatus: "not_required",
  status: "failed",
  progress: 100,
  request: {
    prompt: "雨后的安静建筑",
    size: "1024x1024",
    quality: "medium",
    count: 1,
  },
  providerModel: "musefold-image-pro",
  costPoints: 1000,
  assets: [],
  error: { code: "GENERATION_UPSTREAM_UNKNOWN", message: "上游生成失败" },
  createdAt: "2026-08-18T08:00:00.000Z",
  startedAt: "2026-08-18T08:00:01.000Z",
  finishedAt: "2026-08-18T08:00:02.000Z",
  deletedAt: null,
};

const workbenchSession = {
  id: "6f1ce4dc-5703-4bd8-9e65-c06c4f14fead",
  title: "雨后的安静建筑",
  draft: {
    prompt: "雨后的安静建筑",
    negative: "",
    params: { aspectRatio: "16:9", quality: "medium", size: "auto" },
    promptReferenceIds: [],
  },
  version: 2,
  createdAt: "2026-08-18T08:00:00.000Z",
  updatedAt: "2026-08-18T08:01:00.000Z",
  archivedAt: null,
  deletedAt: null,
};

describe("Musefold Cloud client", () => {
  it("exchanges the relay token once and uses only the opaque desktop session afterwards", async () => {
    const desktopSession = {
      ...session,
      sessionToken: "desktop-session-token-00000000000000000001",
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(desktopSession))
      .mockResolvedValueOnce(
        Response.json(
          {
            deviceId: "6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa",
            name: "Musefold test",
            platform: "macos",
            clientVersion: "1.1.0",
            revoked: false,
            lastPullCursor: "0",
          },
          { status: 201 },
        ),
      );
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await client.openDesktopSession("relay-management-token");
    await client.registerDevice({
      deviceId: "6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa",
      name: "Musefold test",
      platform: "macos",
      clientVersion: "1.1.0",
    });

    const exchangeHeaders = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    const syncHeaders = new Headers(fetchImpl.mock.calls[1]?.[1]?.headers);
    expect(exchangeHeaders.get("Authorization")).toBe(
      "Bearer relay-management-token",
    );
    expect(syncHeaders.get("Authorization")).toBe(
      `Bearer ${desktopSession.sessionToken}`,
    );
    expect(syncHeaders.get("X-Musefold-CSRF")).toBe(session.csrfToken);
    expect(JSON.stringify(fetchImpl.mock.calls[1])).not.toContain(
      "relay-management-token",
    );
  });

  it("keeps CSRF state in memory and attaches it to mutations", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await expect(client.getSession()).resolves.toEqual(session);
    await expect(client.logout()).resolves.toBeUndefined();

    expect(fetchImpl.mock.calls[1]?.[0]).toBe("/api/musefold/v1/auth/logout");
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("X-Musefold-CSRF"),
    ).toBe(session.csrfToken);
    expect(fetchImpl.mock.calls[1]?.[1]?.credentials).toBe("include");
  });

  it("sends only username and password when registering", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json(session));
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await client.register({
      username: "libai",
      password: "secret-password",
      displayName: "not persisted",
    } as Parameters<typeof client.register>[0]);

    expect(fetchImpl.mock.calls[0]?.[0]).toBe("/api/musefold/v1/auth/register");
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual({
      username: "libai",
      password: "secret-password",
    });
  });

  it("binds desktop pull requests to the registered device when provided", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ changes: [], nextCursor: "12", hasMore: false }),
    );
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });
    const deviceId = "6f1ce4dc-5703-4bd8-9e65-c06c4f14feaa";

    await client.pull({ cursor: "7", limit: 20, deviceId });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `/api/musefold/v1/sync/pull?cursor=7&limit=20&deviceId=${deviceId}`,
    );
  });

  it("refuses a mutation before the session CSRF token is loaded", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });
    await expect(
      client.createPrompt({
        title: "测试",
        description: null,
        content: "测试提示词",
        negative: null,
        folderId: null,
        tagIds: [],
        modelId: null,
        params: null,
        rating: 0,
        isPinned: false,
        source: "manual",
        sourceUrl: null,
      }),
    ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps the canonical API error envelope", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "AUTH_REQUIRED",
            message: "请先登录",
            requestId: "request-1",
            retryable: false,
            details: {},
          },
        },
        { status: 401 },
      ),
    );
    const client = createMusefoldCloudClient(
      "https://cloud.example/api/musefold/v1",
      { fetchImpl },
    );
    const result = client.getSession();
    await expect(result).rejects.toBeInstanceOf(MusefoldCloudError);
    await expect(result).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      status: 401,
      requestId: "request-1",
    });
  });

  it("exposes retry, soft-delete, and restore generation mutations", async () => {
    const retried = {
      ...generationJob,
      id: "6f1ce4dc-5703-4bd8-9e65-c06c4f14feac",
      parentRunId: generationJob.id,
      status: "queued",
      progress: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    const deleted = { ...generationJob, deletedAt: "2026-08-18T09:00:00.000Z" };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(retried, { status: 202 }))
      .mockResolvedValueOnce(Response.json(deleted))
      .mockResolvedValueOnce(Response.json(generationJob));
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await client.getSession();
    await expect(
      client.retryGeneration(generationJob.id, "retry-key-0001"),
    ).resolves.toMatchObject({
      id: retried.id,
      parentRunId: generationJob.id,
    });
    await expect(
      client.deleteGeneration(generationJob.id),
    ).resolves.toMatchObject({
      deletedAt: deleted.deletedAt,
    });
    await expect(
      client.restoreGeneration(generationJob.id),
    ).resolves.toMatchObject({
      deletedAt: null,
    });

    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      `/api/musefold/v1/generations/${generationJob.id}/retry`,
    );
    expect(
      new Headers(fetchImpl.mock.calls[1]?.[1]?.headers).get("Idempotency-Key"),
    ).toBe("retry-key-0001");
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("DELETE");
    expect(fetchImpl.mock.calls[3]?.[0]).toBe(
      `/api/musefold/v1/generations/${generationJob.id}/restore`,
    );
  });

  it("soft-deletes a workbench session with its expected version", async () => {
    const deleted = { ...workbenchSession, deletedAt: "2026-08-18T09:00:00.000Z", version: 3 };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(session))
      .mockResolvedValueOnce(Response.json(deleted));
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await client.getSession();
    await expect(
      client.deleteWorkbenchSession(workbenchSession.id, workbenchSession.version),
    ).resolves.toMatchObject({ deletedAt: deleted.deletedAt });

    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      `/api/musefold/v1/workbench/sessions/${workbenchSession.id}`,
    );
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body))).toEqual({
      expectedVersion: workbenchSession.version,
    });
  });

  it("parses chunked generation SSE and resumes after the supplied cursor", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "id: 11\nevent: generation.running\ndata: {\"progress\":",
      "42}\n\n: keep-alive\n\nid: 12\nevent: generation.succeeded\ndata: {\"status\":\"succeeded\"}\n\n",
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });
    const events: Array<{ seq: number; type: string; payload: Record<string, unknown> }> = [];

    await client.streamGenerationEvents(
      generationJob.id,
      10,
      (event) => {
        events.push(event);
      },
    );

    expect(events).toEqual([
      { seq: 11, type: "generation.running", payload: { progress: 42 } },
      {
        seq: 12,
        type: "generation.succeeded",
        payload: { status: "succeeded" },
      },
    ]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `/api/musefold/v1/generations/${generationJob.id}/events?after=10`,
    );
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("Accept"),
    ).toBe("text/event-stream");
    expect(
      new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get("Last-Event-ID"),
    ).toBe("10");
  });

  it("loads an individual workbench session for refresh recovery", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(workbenchSession));
    const client = createMusefoldCloudClient("/api/musefold/v1", { fetchImpl });

    await expect(
      client.getWorkbenchSession(workbenchSession.id),
    ).resolves.toEqual(workbenchSession);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `/api/musefold/v1/workbench/sessions/${workbenchSession.id}`,
    );
  });
});
