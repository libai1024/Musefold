import { describe, expect, it } from "vitest";
import {
  MUSEFOLD_QUERY_GC_TIME_MS,
  MUSEFOLD_QUERY_RETRY,
  MUSEFOLD_QUERY_STALE_TIME_MS,
  createMusefoldQueryClient,
  musefoldQueryKeys,
} from "../query-client";

describe("createMusefoldQueryClient", () => {
  it("returns an isolated client with the shared conservative defaults", () => {
    const first = createMusefoldQueryClient();
    const second = createMusefoldQueryClient();
    const queries = first.getDefaultOptions().queries;
    const mutations = first.getDefaultOptions().mutations;

    expect(first).not.toBe(second);
    expect(queries?.staleTime).toBe(MUSEFOLD_QUERY_STALE_TIME_MS);
    expect(queries?.gcTime).toBe(MUSEFOLD_QUERY_GC_TIME_MS);
    expect(queries?.retry).toBe(MUSEFOLD_QUERY_RETRY);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.refetchOnReconnect).toBe(false);
    expect(mutations?.retry).toBe(0);
  });

  it("keeps domain query-key prefixes stable for later invalidation", () => {
    expect(musefoldQueryKeys.history.all).toEqual(["history"]);
    expect(musefoldQueryKeys.library.all).toEqual(["library"]);
    expect(musefoldQueryKeys.account.all).toEqual(["account"]);
  });
});
