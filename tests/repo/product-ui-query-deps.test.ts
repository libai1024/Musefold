import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productUi = JSON.parse(
  readFileSync("packages/product-ui/package.json", "utf8"),
) as { dependencies?: Record<string, string> };
const desktop = JSON.parse(
  readFileSync("apps/desktop/package.json", "utf8"),
) as { dependencies?: Record<string, string> };
const web = JSON.parse(
  readFileSync("apps/web/package.json", "utf8"),
) as { dependencies?: Record<string, string> };

describe("V13-STATE-01 Query 管线依赖面", () => {
  it("product-ui 只新增 @tanstack/react-query 一个外部运行时依赖", () => {
    const deps = Object.keys(productUi.dependencies ?? {}).sort();
    expect(deps).toEqual(["@musefold/ui", "@tanstack/react-query", "react"]);
  });

  it("双宿主都声明同一查询库以便装配 QueryClientProvider", () => {
    expect(desktop.dependencies).toHaveProperty("@tanstack/react-query");
    expect(web.dependencies).toHaveProperty("@tanstack/react-query");
  });
});
