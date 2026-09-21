import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { isManagedUploadPath } from '../local-image';

let root: string;
let configured: string;
let actual: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'musefold-upload-alias-')));
  const parent = join(root, 'system-parent');
  mkdirSync(parent);
  symlinkSync(parent, join(root, 'system-alias'), 'junction');
  configured = join(root, 'system-alias', 'app');
  actual = join(parent, 'app');
  configureTestCoreRuntime(configured);
  mkdirSync(join(testCorePaths(actual).previews, 'uploads'), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it('accepts the configured upload path and its canonical OS-parent alias', () => {
  const declared = join(testCorePaths(configured).previews, 'uploads', 'reference.png');
  writeFileSync(declared, 'synthetic image bytes');
  expect(isManagedUploadPath(declared)).toBe(true);
  expect(isManagedUploadPath(realpathSync(declared))).toBe(true);
});

it('does not authorize adjacent directories or a link escaping the uploads root', () => {
  const outside = join(root, 'outside.png');
  writeFileSync(outside, 'not an upload');
  const escaped = join(testCorePaths(configured).previews, 'uploads', 'escaped.png');
  symlinkSync(outside, escaped);
  expect(isManagedUploadPath(realpathSync(escaped))).toBe(false);
  expect(
    isManagedUploadPath(join(testCorePaths(actual).previews, 'uploads-other', 'image.png')),
  ).toBe(false);
});

it('does not follow a replacement app-owned root when authorizing a canonical target', () => {
  const outside = join(root, 'other-app');
  mkdirSync(join(testCorePaths(outside).previews, 'uploads'), { recursive: true });
  rmSync(actual, { recursive: true });
  symlinkSync(outside, actual, 'junction');
  const escaped = join(testCorePaths(configured).previews, 'uploads', 'reference.png');
  writeFileSync(escaped, 'not an upload owned by this app');
  expect(isManagedUploadPath(realpathSync(escaped))).toBe(false);
});

it('does not follow a replacement uploads directory when authorizing a canonical target', () => {
  const outside = join(root, 'other-uploads');
  mkdirSync(outside);
  const uploads = join(testCorePaths(actual).previews, 'uploads');
  rmSync(uploads, { recursive: true });
  symlinkSync(outside, uploads, 'junction');
  const escaped = join(uploads, 'reference.png');
  writeFileSync(escaped, 'not an upload');
  expect(isManagedUploadPath(realpathSync(escaped))).toBe(false);
});
