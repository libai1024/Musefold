import { describe, expect, it } from "vitest";
import { FixtureWebGateway } from "../fixture-runtime";

describe("fixture generation history lifecycle", () => {
  it("retries, soft-deletes, filters, and restores generation jobs", async () => {
    const gateway = new FixtureWebGateway();
    const created = await gateway.createGeneration(
      {
        prompt: "雨后的安静建筑",
        size: "1024x1024",
        quality: "medium",
        count: 1,
      },
      "create-generation-0001",
    );

    const retry = await gateway.retryGeneration(
      created.id,
      "retry-generation-0001",
    );
    expect(retry.parentRunId).toBe(created.id);
    expect(retry.status).toBe("queued");

    const deleted = await gateway.deleteGeneration(created.id);
    expect(deleted.deletedAt).not.toBeNull();
    await expect(
      gateway.listGenerationHistory({ limit: 20 }),
    ).resolves.not.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: created.id }),
      ]),
    });

    const includingDeleted = await gateway.listGenerationHistory({
      limit: 20,
      includeDeleted: true,
    });
    expect(includingDeleted.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: created.id,
          deletedAt: deleted.deletedAt,
        }),
      ]),
    );

    const restored = await gateway.restoreGeneration(created.id);
    expect(restored.deletedAt).toBeNull();
    await expect(
      gateway.listGenerationHistory({ limit: 20 }),
    ).resolves.toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ id: created.id }),
      ]),
    });
  });

  it("keeps runs scoped to their workbench session for restoration", async () => {
    const gateway = new FixtureWebGateway();
    const firstSession = await gateway.createWorkbenchSession({
      title: "第一份设计",
      draft: { prompt: "第一份设计" },
    });
    const secondSession = await gateway.createWorkbenchSession({
      title: "第二份设计",
      draft: { prompt: "第二份设计" },
    });
    const firstJob = await gateway.createGeneration(
      {
        prompt: "第一份设计",
        sessionId: firstSession.id,
        size: "1024x1024",
        quality: "medium",
        count: 1,
      },
      "create-session-generation-0001",
    );
    await gateway.createGeneration(
      {
        prompt: "第二份设计",
        sessionId: secondSession.id,
        size: "1024x1024",
        quality: "medium",
        count: 1,
      },
      "create-session-generation-0002",
    );

    await expect(
      gateway.getWorkbenchSession(firstSession.id),
    ).resolves.toMatchObject({
      id: firstSession.id,
      draft: { prompt: "第一份设计" },
    });
    await expect(
      gateway.listGenerationHistory({
        limit: 20,
        sessionId: firstSession.id,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: firstJob.id })],
    });
  });

  it("returns the latest workbench snapshot on a version conflict", async () => {
    const gateway = new FixtureWebGateway();
    const created = await gateway.createWorkbenchSession({
      title: "跨设备草稿",
      draft: { prompt: "初始内容" },
    });
    const latest = await gateway.updateWorkbenchSession(created.id, {
      expectedVersion: created.version,
      draft: { ...created.draft, prompt: "另一设备的内容" },
    });

    await expect(
      gateway.updateWorkbenchSession(created.id, {
        expectedVersion: created.version,
        draft: { ...created.draft, prompt: "本机内容" },
      }),
    ).rejects.toMatchObject({
      code: "WORKBENCH_VERSION_CONFLICT",
      details: { current: latest },
    });
  });

  it("excludes archived sessions from the active conversation list", async () => {
    const gateway = new FixtureWebGateway();
    const created = await gateway.createWorkbenchSession({
      title: "待归档设计",
      draft: { prompt: "待归档设计" },
    });
    const archived = await gateway.updateWorkbenchSession(created.id, {
      expectedVersion: created.version,
      archived: true,
    });

    await expect(
      gateway.listWorkbenchSessions({ limit: 20 }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      gateway.listWorkbenchSessions({ limit: 20, includeArchived: true }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({
          id: archived.id,
          archivedAt: expect.any(String),
        }),
      ],
    });
  });
});
