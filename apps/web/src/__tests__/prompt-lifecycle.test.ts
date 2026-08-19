import { describe, expect, it } from "vitest";
import { FixtureWebGateway } from "../fixture-runtime";

describe("fixture prompt lifecycle", () => {
  it("matches cloud optimistic locking, soft delete, and restore semantics", async () => {
    const gateway = new FixtureWebGateway();
    const original = await gateway.getPrompt("prompt-night-architecture");
    const updated = await gateway.updatePrompt(original.id, {
      expectedVersion: original.version,
      title: "夜色建筑摄影（已编辑）",
    });

    expect(updated.version).toBe(original.version + 1);
    await expect(
      gateway.updatePrompt(original.id, {
        expectedVersion: original.version,
        title: "过期修改",
      }),
    ).rejects.toMatchObject({ code: "PROMPT_VERSION_CONFLICT" });

    const deleted = await gateway.deletePrompt(updated.id, updated.version);
    expect(deleted.deletedAt).not.toBeNull();
    await expect(gateway.listPrompts({ limit: 100 })).resolves.not.toMatchObject(
      { items: expect.arrayContaining([expect.objectContaining({ id: updated.id })]) },
    );
    const withDeleted = await gateway.listPrompts({
      limit: 100,
      includeDeleted: true,
    });
    expect(withDeleted.items).toContainEqual(
      expect.objectContaining({ id: updated.id, deletedAt: deleted.deletedAt }),
    );

    const restored = await gateway.restorePrompt(deleted.id, deleted.version);
    expect(restored).toMatchObject({
      id: updated.id,
      version: deleted.version + 1,
      deletedAt: null,
    });
  });
});
