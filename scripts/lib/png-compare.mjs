// v1.4 WEB-01：PNG 解码与像素对比纯函数。
// 逻辑与 scripts/compare-shared-ui-visuals.mjs 内联实现一致（自写解码器，零依赖）。
// 门禁脚本本体在实现期不动（协议 D9）；REL-02 收口时统一改为 import 本模块。

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export function comparePng(leftPath, rightPath) {
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

export function decodePng(buffer) {
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
