import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("desktop host boundary", () => {
  it("assembles the shared QueryClient at the window root", () => {
    expect(mainSource).toMatch(/createMusefoldQueryClient/);
    expect(mainSource).toMatch(/QueryClientProvider/);
  });
});
