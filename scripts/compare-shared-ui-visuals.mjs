import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "artifacts/v1.1/shared-ui-visuals");
const webOutput = join(output, "web");
const desktopOutput = join(output, "desktop");
rmSync(output, { recursive: true, force: true });
mkdirSync(webOutput, { recursive: true });
mkdirSync(desktopOutput, { recursive: true });

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(
  "npm",
  [
    "run",
    "test:e2e",
    "--workspace",
    "@musefold/web",
    "--",
    "--grep",
    "canonical Desktop/Web surfaces|generation result failure",
  ],
  { MUSEFOLD_VISUAL_OUTPUT_DIR: webOutput },
);

const pytest = existsSync(join(root, ".venv-test/bin/pytest"))
  ? join(root, ".venv-test/bin/pytest")
  : "pytest";
run(pytest, ["tests/e2e/test_11_visual_qa.py", "-q"], {
  MUSEFOLD_VISUAL_OUTPUT_DIR: desktopOutput,
});

const surfaces = [
  {
    id: "product-sidebar",
    file: "shared-product-sidebar-1440x900.png",
    maxMeanError: 0.14,
    maxChangedPixels: 0.16,
  },
  {
    id: "workbench",
    file: "shared-workbench-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.08,
  },
  {
    id: "workbench-composer",
    file: "shared-workbench-composer-1440x900.png",
    maxMeanError: 0.08,
    maxChangedPixels: 0.1,
  },
  {
    id: "workbench-composer-mobile",
    file: "shared-workbench-composer-390x844.png",
    maxMeanError: 0.1,
    maxChangedPixels: 0.14,
  },
  {
    id: "workbench-result",
    file: "shared-workbench-result-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "workbench-result-failed",
    file: "shared-workbench-result-failed-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "workbench-result-cancelled",
    file: "shared-workbench-result-cancelled-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "workbench-result-cancelled-mobile",
    file: "shared-workbench-result-cancelled-390x844.png",
    maxMeanError: 0.14,
    maxChangedPixels: 0.18,
  },
  {
    id: "library-list",
    file: "shared-library-list-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.12,
  },
  {
    id: "prompt-detail",
    file: "shared-prompt-detail-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.12,
  },
  {
    id: "prompt-reference-card",
    file: "shared-prompt-reference-card-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "prompt-reference-preview",
    file: "shared-prompt-reference-preview-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "history-detail-compact",
    file: "shared-history-detail-compact.png",
    maxMeanError: 0.14,
    maxChangedPixels: 0.16,
  },
  {
    id: "history-workspace",
    file: "shared-history-workspace-1440x900.png",
    maxMeanError: 0.08,
    maxChangedPixels: 0.12,
  },
  {
    id: "account-summary",
    file: "shared-account-summary-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
  {
    id: "connected-apps",
    file: "shared-connected-apps-1440x900.png",
    maxMeanError: 0.12,
    maxChangedPixels: 0.14,
  },
];

let failed = false;
for (const surface of surfaces) {
  const webPng = join(webOutput, surface.file);
  const desktopPng = join(desktopOutput, surface.file);
  if (!existsSync(webPng) || !existsSync(desktopPng)) {
    console.error(
      `Missing shared UI screenshot for ${surface.id}: ${webPng} / ${desktopPng}`,
    );
    failed = true;
    continue;
  }
  const comparison = comparePng(webPng, desktopPng);
  const result = { id: surface.id, webPng, desktopPng, ...comparison };
  console.log(JSON.stringify(result, null, 2));
  if (
    comparison.meanError > surface.maxMeanError ||
    comparison.changedPixelRatio > surface.maxChangedPixels
  ) {
    console.error(
      `${surface.id} visual contract failed: meanError <= ${surface.maxMeanError}, changedPixelRatio <= ${surface.maxChangedPixels}`,
    );
    failed = true;
  }
}
if (failed) process.exit(1);
console.log("Shared UI visual contract passed.");

function comparePng(leftPath, rightPath) {
  const left = decodePng(readFileSync(leftPath));
  const right = decodePng(readFileSync(rightPath));
  const width = Math.min(left.width, right.width);
  const height = Math.min(left.height, right.height);
  const leftOffset = Math.floor((left.width - width) / 2);
  const rightOffset = Math.floor((right.width - width) / 2);
  let total = 0;
  let changed = 0;
  const pixels = width * height;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const leftIndex = (row * left.width + leftOffset + column) * 4;
      const rightIndex = (row * right.width + rightOffset + column) * 4;
      const delta =
        (Math.abs(left.data[leftIndex] - right.data[rightIndex]) +
          Math.abs(left.data[leftIndex + 1] - right.data[rightIndex + 1]) +
          Math.abs(left.data[leftIndex + 2] - right.data[rightIndex + 2])) /
        (255 * 3);
      total += delta;
      if (delta > 0.08) changed += 1;
    }
  }
  return {
    leftWidth: left.width,
    leftHeight: left.height,
    rightWidth: right.width,
    rightHeight: right.height,
    comparedWidth: width,
    comparedHeight: height,
    meanError: total / pixels,
    changedPixelRatio: changed / pixels,
  };
}

function decodePng(buffer) {
  if (buffer.toString("ascii", 1, 4) !== "PNG") throw new Error("Invalid PNG");
  let width;
  let height;
  let bitDepth;
  let colorType;
  const compressed = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      bitDepth = payload[8];
      colorType = payload[9];
    } else if (type === "IDAT") compressed.push(payload);
    offset += length + 12;
    if (type === "IEND") break;
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) {
    throw new Error(
      `Expected 8-bit RGB/RGBA PNG, got bitDepth=${bitDepth}, colorType=${colorType}`,
    );
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(compressed));
  const filtered = Buffer.alloc(height * stride);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source++];
    const rowStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const current = raw[source++];
      const left =
        column >= channels ? filtered[rowStart + column - channels] : 0;
      const above = row > 0 ? filtered[rowStart - stride + column] : 0;
      const upperLeft =
        row > 0 && column >= channels
          ? filtered[rowStart - stride + column - channels]
          : 0;
      filtered[rowStart + column] = unfilter(
        filter,
        current,
        left,
        above,
        upperLeft,
      );
    }
  }
  const data = Buffer.alloc(height * width * 4);
  for (let index = 0, sourceIndex = 0; index < data.length; index += 4) {
    data[index] = filtered[sourceIndex++];
    data[index + 1] = filtered[sourceIndex++];
    data[index + 2] = filtered[sourceIndex++];
    data[index + 3] = channels === 4 ? filtered[sourceIndex++] : 255;
  }
  return { width, height, data };
}

function unfilter(filter, value, left, above, upperLeft) {
  if (filter === 0) return value;
  if (filter === 1) return (value + left) & 255;
  if (filter === 2) return (value + above) & 255;
  if (filter === 3) return (value + Math.floor((left + above) / 2)) & 255;
  if (filter === 4) return (value + paeth(left, above, upperLeft)) & 255;
  throw new Error(`Unsupported PNG filter ${filter}`);
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
    return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}
