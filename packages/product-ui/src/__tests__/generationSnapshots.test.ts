import { describe, expect, it } from "vitest";
import {
  activeWorkbenchGenerationSnapshots,
  isWorkbenchGenerationActive,
  latestWorkbenchGenerationSnapshot,
  sortWorkbenchGenerationSnapshots,
  upsertWorkbenchGenerationSnapshot,
  workbenchGenerationResultStatus,
  workbenchGenerationStatusLabel,
} from "../workbench/generationSnapshots";

describe("shared generation snapshots", () => {
  const older = {
    id: "generation-a",
    createdAt: "2026-08-19T08:00:00.000Z",
    progress: 10,
  };
  const newer = {
    id: "generation-b",
    createdAt: "2026-08-19T08:01:00.000Z",
    progress: 20,
  };

  it("orders snapshots without mutating either host collection", () => {
    const input = [newer, older];
    const sorted = sortWorkbenchGenerationSnapshots(input);

    expect(sorted.map((item) => item.id)).toEqual([
      "generation-a",
      "generation-b",
    ]);
    expect(input.map((item) => item.id)).toEqual([
      "generation-b",
      "generation-a",
    ]);
    expect(latestWorkbenchGenerationSnapshot(input)).toBe(newer);
  });

  it("replaces one snapshot and keeps deterministic timeline order", () => {
    const replacement = { ...older, progress: 80 };
    const snapshots = upsertWorkbenchGenerationSnapshot(
      [newer, older],
      replacement,
    );

    expect(snapshots).toEqual([replacement, newer]);
  });

  it("normalizes Desktop and Cloud status semantics", () => {
    expect(isWorkbenchGenerationActive("pending_approval")).toBe(true);
    expect(isWorkbenchGenerationActive("running")).toBe(true);
    expect(isWorkbenchGenerationActive("rejected")).toBe(false);
    expect(workbenchGenerationResultStatus("succeeded")).toBe("success");
    expect(workbenchGenerationResultStatus("cancelled")).toBe("cancelled");
    expect(workbenchGenerationResultStatus("expired")).toBe("failed");
    expect(workbenchGenerationStatusLabel("cancelling")).toBe("取消中");
    expect(workbenchGenerationStatusLabel("partial")).toBe("部分完成");
  });

  it("keeps only active snapshots in the background recovery set", () => {
    expect(
      activeWorkbenchGenerationSnapshots([
        { ...older, status: "running" },
        { ...newer, status: "succeeded" },
      ]).map((item) => item.id),
    ).toEqual(["generation-a"]);
  });
});
