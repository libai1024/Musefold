import { describe, expect, it } from "vitest";
import { summarizeWorkbenchTask } from "../workbench-display";

describe("summarizeWorkbenchTask", () => {
  it("returns no summary for a new conversation", () => {
    expect(summarizeWorkbenchTask([])).toBeNull();
  });

  it("prioritizes active generation over the completed image count", () => {
    expect(
      summarizeWorkbenchTask([
        {
          status: "running",
          source: { kind: "manual" },
          results: [
            { id: "result-1", jobId: "job-1", status: "success" },
            { id: "result-2", jobId: "job-1", status: "pending" },
          ],
        },
      ]),
    ).toEqual({ activityLabel: "1 张 · 生成中", sourceLabel: "自由创作" });
  });

  it("summarizes completed images and the latest source", () => {
    expect(
      summarizeWorkbenchTask([
        {
          status: "success",
          source: { kind: "manual" },
          results: [
            { id: "result-1", jobId: "job-1", status: "success" },
          ],
        },
        {
          status: "success",
          source: { kind: "history", id: "history-1", label: "上一结果" },
          results: [
            { id: "result-2", jobId: "job-2", status: "success" },
          ],
        },
      ]),
    ).toEqual({ activityLabel: "2 张图", sourceLabel: "历史复用" });
  });
});
