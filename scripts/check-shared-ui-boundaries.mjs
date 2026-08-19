#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const canonicalTokens = resolve(root, "packages/ui/src/tokens.css");
const sourceRoots = [
  resolve(root, "src"),
  resolve(root, "apps/web/src"),
  resolve(root, "packages/product-ui/src"),
];
const tokenNames = [
  "--bg-window",
  "--bg-sidebar",
  "--bg-elevated",
  "--fg-primary",
  "--fg-secondary",
  "--border-default",
  "--accent",
  "--accent-ring",
  "--radius-md",
  "--control-md",
  "--density-page-padding",
  "--shadow-pop",
  "--dur-fast",
  "--ease-out",
];

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    const extension = extname(file);
    if (![".ts", ".tsx", ".css"].includes(extension)) continue;
    const source = readFileSync(file, "utf8");
    const displayPath = relative(root, file);
    if (extension !== ".css" && /from\s+["']lucide-react["']/.test(source)) {
      violations.push(
        `${displayPath}: import icons from @musefold/ui/icons instead of lucide-react`,
      );
    }
    if (extension === ".css") {
      for (const token of tokenNames) {
        if (new RegExp(`${escapeRegExp(token)}\\s*:`).test(source)) {
          violations.push(
            `${displayPath}: ${token} must only be defined in packages/ui/src/tokens.css`,
          );
        }
      }
    }
  }
}

const tokenSource = readFileSync(canonicalTokens, "utf8");
for (const token of tokenNames) {
  if (!new RegExp(`${escapeRegExp(token)}\\s*:`).test(tokenSource)) {
    violations.push(`packages/ui/src/tokens.css: missing ${token}`);
  }
}

for (const entry of ["src/main.tsx", "apps/web/src/main.tsx"]) {
  const source = readFileSync(resolve(root, entry), "utf8");
  if (!source.includes("@musefold/ui/tokens.css")) {
    violations.push(`${entry}: missing @musefold/ui/tokens.css import`);
  }
  if (!source.includes("@musefold/ui/primitives.css")) {
    violations.push(`${entry}: missing @musefold/ui/primitives.css import`);
  }
}

for (const entry of [
  "src/components/layout/AppShell.tsx",
  "apps/web/src/App.tsx",
]) {
  const source = readFileSync(resolve(root, entry), "utf8");
  if (!source.includes("<ProductSidebarLayout")) {
    violations.push(
      `${entry}: the complete sidebar rail must use ProductSidebarLayout`,
    );
  }
}

for (const entry of [
  "src/features/generation/workbench/GenerationWorkbench.tsx",
  "apps/web/src/views/GenerateView.tsx",
]) {
  const source = readFileSync(resolve(root, entry), "utf8");
  if (!source.includes("<WorkbenchComposerFrame")) {
    violations.push(
      `${entry}: the complete generation composer must use WorkbenchComposerFrame`,
    );
  }
}

const webStyles = readFileSync(
  resolve(root, "apps/web/src/styles.css"),
  "utf8",
);
if (/(^|\n)\.sidebar\s*\{/.test(webStyles)) {
  violations.push(
    "apps/web/src/styles.css: do not reintroduce a host-owned sidebar rail",
  );
}

if (violations.length > 0) {
  console.error("Shared UI boundary check failed:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log("Shared UI boundary check passed.");

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
