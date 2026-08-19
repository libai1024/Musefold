import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsDirectory = join(appRoot, "dist", "assets");
const files = (await readdir(assetsDirectory)).filter((file) =>
  file.endsWith(".js"),
);
const javascript = (
  await Promise.all(
    files.map((file) => readFile(join(assetsDirectory, file), "utf8")),
  )
).join("\n");

const forbiddenMarkers = [
  "fixture-account",
  "__musefold-fixture/skill-ref-pause-map.jpeg",
  "FixtureWebGateway",
];
const leaked = forbiddenMarkers.filter((marker) => javascript.includes(marker));

if (leaked.length > 0) {
  throw new Error(
    `Production Web bundle contains fixture markers: ${leaked.join(", ")}`,
  );
}

console.log(`Production boundary check passed (${files.length} JavaScript asset${files.length === 1 ? "" : "s"}).`);
