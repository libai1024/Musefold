import { describe, expect, it } from "vitest";
import {
  DEFAULT_HISTORY_PAGE_LIST_KEY,
  DEFAULT_LIBRARY_PAGE_LIST_KEY,
  DEFAULT_WORKBENCH_SESSION_LIST_KEY,
  asPagedItems,
  dropListCache,
  itemsFromQueryData,
  libraryPageListKey,
  replaceListCache,
  upsertListCache,
  upsertPagedItem,
} from "../paged-items";

describe("page-controller list cache helpers", () => {
  it("keeps the web history/library list keys stable (no Date.now bounds)", () => {
    expect(DEFAULT_HISTORY_PAGE_LIST_KEY).toEqual({ limit: 20 });
    expect(DEFAULT_WORKBENCH_SESSION_LIST_KEY).toEqual({ limit: 20 });
    expect(DEFAULT_LIBRARY_PAGE_LIST_KEY).toEqual({
      limit: 20,
      sort: "updated-desc",
    });
    expect(libraryPageListKey("")).toEqual({
      limit: 20,
      sort: "updated-desc",
    });
    expect(libraryPageListKey("  夜色  ")).toEqual({
      limit: 20,
      sort: "updated-desc",
      q: "夜色",
    });
  });

  it("reads both gateway pages and desktop extras arrays", () => {
    expect(itemsFromQueryData(undefined)).toEqual([]);
    expect(itemsFromQueryData([{ id: "a" }])).toEqual([{ id: "a" }]);
    expect(
      itemsFromQueryData({ items: [{ id: "b" }], nextCursor: "c" }),
    ).toEqual([{ id: "b" }]);
    expect(asPagedItems({ items: [{ id: "b" }], nextCursor: "c" }).nextCursor).toBe(
      "c",
    );
  });

  it("upserts without duplicating ids and preserves cache shape", () => {
    const page = upsertPagedItem(
      { items: [{ id: "a" }, { id: "b" }], nextCursor: "n" },
      { id: "b" },
    );
    expect(page).toEqual({
      items: [{ id: "b" }, { id: "a" }],
      nextCursor: "n",
    });
    expect(upsertListCache([{ id: "a" }], { id: "a", name: "x" })).toEqual([
      { id: "a", name: "x" },
    ]);
    expect(
      upsertListCache({ items: [{ id: "a" }], nextCursor: null }, { id: "b" }),
    ).toEqual({
      items: [{ id: "b" }, { id: "a" }],
      nextCursor: null,
    });
  });

  it("drops by id without changing the other cache shape", () => {
    expect(dropListCache([{ id: "a" }, { id: "b" }], "a")).toEqual([{ id: "b" }]);
    expect(
      dropListCache({ items: [{ id: "a" }, { id: "b" }], nextCursor: "z" }, "b"),
    ).toEqual({
      items: [{ id: "a" }],
      nextCursor: "z",
    });
  });

  it("replaces list contents without changing the cache shape", () => {
    expect(replaceListCache([{ id: "a" }], [{ id: "b" }])).toEqual([{ id: "b" }]);
    expect(
      replaceListCache({ items: [{ id: "a" }], nextCursor: "n" }, [{ id: "c" }]),
    ).toEqual({
      items: [{ id: "c" }],
      nextCursor: "n",
    });
  });
});
