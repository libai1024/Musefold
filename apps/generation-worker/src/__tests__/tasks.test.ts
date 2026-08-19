import { describe, expect, it, vi } from "vitest";
import {
  decideLeaseRecovery,
  transitionMcpSpendReservation,
} from "../tasks.js";

describe("generation lease recovery", () => {
  const now = Date.parse("2026-08-19T00:00:00.000Z");

  it("marks an expired sent request as unknown instead of retrying it", () => {
    expect(
      decideLeaseRecovery(
        {
          status: "running",
          upstream_request_sent: true,
          lease_expires_at: "2026-08-18T23:59:00.000Z",
        },
        now,
      ),
    ).toBe("mark_unknown");
  });

  it("allows an expired lease before upstream dispatch to continue", () => {
    expect(
      decideLeaseRecovery(
        {
          status: "running",
          upstream_request_sent: false,
          lease_expires_at: "2026-08-18T23:59:00.000Z",
        },
        now,
      ),
    ).toBe("continue");
  });

  it("does not touch a live lease", () => {
    expect(
      decideLeaseRecovery(
        {
          status: "running",
          upstream_request_sent: true,
          lease_expires_at: "2026-08-19T00:01:00.000Z",
        },
        now,
      ),
    ).toBe("skip");
  });
});

describe("Cloud MCP spend reservation lifecycle", () => {
  it("settles a successful generation at the reserved estimate", async () => {
    const query = vi.fn().mockResolvedValue({});

    await transitionMcpSpendReservation(
      { query } as never,
      42,
      "run-success",
      "settled",
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain(
      "actual_points = estimated_points",
    );
    expect(query.mock.calls[0]?.[1]).toEqual(["run-success", 42]);
  });

  it("releases an unspent reservation after a definitive failure", async () => {
    const query = vi.fn().mockResolvedValue({});

    await transitionMcpSpendReservation(
      { query } as never,
      42,
      "run-rejected",
      "released",
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("status = 'released'");
    expect(query.mock.calls[0]?.[1]).toEqual(["run-rejected", 42]);
  });

  it("preserves a reservation when the upstream charge is uncertain", async () => {
    const query = vi.fn();

    await transitionMcpSpendReservation(
      { query } as never,
      42,
      "run-unknown",
      "preserved",
    );

    expect(query).not.toHaveBeenCalled();
  });
});
