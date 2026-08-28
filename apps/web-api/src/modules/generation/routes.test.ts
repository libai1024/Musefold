import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationRoutes } from "./routes.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("generation history query boundary", () => {
  it("parses and forwards supported history filters", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const service = {
      history: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const sessions = { get: vi.fn().mockResolvedValue({ ownerId: 42 }) };
    await app.register(generationRoutes, {
      service: service as never,
      sessions: sessions as never,
      cookieName: "musefold_session",
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/musefold/v1/generations?status=failed&providerModel=pro&search=建筑&from=2026-08-01T00%3A00%3A00.000Z",
      headers: { authorization: "Bearer opaque-session" },
    });
    expect(response.statusCode).toBe(200);
    expect(service.history).toHaveBeenCalledWith(42, expect.objectContaining({
      status: "failed",
      providerModel: "pro",
      search: "建筑",
      from: "2026-08-01T00:00:00.000Z",
    }));
  });
});

describe("generation SSE boundary", () => {
  it("resumes from the newest cursor and emits durable events", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const service = {
      events: vi.fn().mockResolvedValue([
        {
          seq: 11,
          type: "generation.succeeded",
          payload: { assetCount: 1 },
          createdAt: "2026-08-19T08:00:00.000Z",
        },
      ]),
      get: vi.fn().mockResolvedValue({ status: "succeeded" }),
    };
    const sessions = {
      get: vi.fn().mockResolvedValue({
        ownerId: 42,
        username: "musefold",
        csrfToken: "csrf-token",
      }),
    };
    await app.register(generationRoutes, {
      service: service as never,
      sessions: sessions as never,
      cookieName: "musefold_session",
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/musefold/v1/generations/run-1/events?after=3",
      headers: {
        authorization: "Bearer opaque-session",
        "last-event-id": "10",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).toContain("id: 11\n");
    expect(response.body).toContain("event: generation.succeeded\n");
    expect(response.body).toContain('data: {"assetCount":1}\n\n');
    expect(service.events).toHaveBeenCalledWith(42, "run-1", 10);
  });
});
