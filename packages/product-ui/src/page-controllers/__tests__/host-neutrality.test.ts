import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function collectSource(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__") return [];
        return [collectSource(path)];
      }
      if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        return [readFileSync(path, "utf8")];
      }
      return [];
    })
    .join("\n");
}

describe("product-ui host neutrality", () => {
  it("does not import host platform modules from page-controllers", () => {
    const source = collectSource(join(root, "page-controllers"));
    expect(source).not.toMatch(/window\.api/);
    expect(source).not.toMatch(/cloud-client/);
    expect(source).not.toMatch(/from ['"]electron['"]/);
    expect(source).not.toMatch(/desktop-contracts/);
    expect(source).not.toMatch(/from ['"][^'"]*stores\/toast['"]/);
  });
});
