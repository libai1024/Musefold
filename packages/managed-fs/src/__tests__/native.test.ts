import { spawnSync } from 'node:child_process';
import {
  closeSync,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { type DirectoryHandle, loadManagedFilesystem } from '../index';

const native = loadManagedFilesystem(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../build/Release/managed_fs.node'),
);
let root: string;
let base: DirectoryHandle;
const handles: DirectoryHandle[] = [];
function own(handle: DirectoryHandle) {
  handles.push(handle);
  return handle;
}
function write(directory: DirectoryHandle, name: string, content = 'owned') {
  const fd = native.openFile(directory, name, 'create');
  try {
    writeFileSync(fd, content);
  } finally {
    closeSync(fd);
  }
}
function read(directory: DirectoryHandle, name: string) {
  const fd = native.openFile(directory, name, 'read');
  try {
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
function replace(directory: string, detached: string, target: string) {
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
      directory,
      detached,
      target,
    ],
    { encoding: 'utf8' },
  );
  expect(child.status, child.stderr).toBe(0);
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-native-fs-'));
  const stat = lstatSync(root, { bigint: true });
  base = own(native.openRoot(root, `${stat.dev}:${stat.ino}`));
});
afterEach(() => {
  for (const handle of handles.splice(0)) native.close(handle);
  rmSync(root, { recursive: true, force: true });
});

it.each(['', '.', '..', 'a/b', 'a\\b', 'a:b', 'x\0hidden', 'x.', 'x ', null, [], 3])(
  'rejects invalid relative names %j without creating files',
  (name) => {
    expect(() => Reflect.apply(native.openChild, undefined, [base, name, true])).toThrow();
  },
);
it('rejects wrong root identity, forged handles, extra arguments and invalid modes', () => {
  expect(() => native.openRoot(root, '0:0')).toThrow();
  expect(() => Reflect.apply(native.identity, undefined, [{}])).toThrow();
  expect(() => Reflect.apply(native.identity, undefined, [base, 'extra'])).toThrow();
  expect(() => Reflect.apply(native.openFile, undefined, [base, 'original', 'truncate'])).toThrow();
});
it('opens the same directory identity, creates exclusively, and refuses nonempty removal', () => {
  const stage = own(native.openChild(base, 'stage', true));
  const duplicate = own(native.openChild(base, 'stage', false));
  expect(native.identity(stage)).toBe(native.identity(duplicate));
  write(stage, 'original');
  expect(() => write(stage, 'original', 'replacement')).toThrow();
  expect(read(stage, 'original')).toBe('owned');
  expect(() => native.removeDirectory(base, 'stage')).toThrow();
});
it('does not follow file links and safely unlinks the link itself', () => {
  const stage = own(native.openChild(base, 'stage', true));
  writeFileSync(join(root, 'original'), 'original');
  symlinkSync(join(root, 'original'), join(root, 'stage', 'linked'));
  expect(() => native.openFile(stage, 'linked', 'read')).toThrow();
  expect(() => native.fileIdentity(stage, 'linked')).toThrow();
  native.unlinkFile(stage, 'linked');
  expect(readFileSync(join(root, 'original'), 'utf8')).toBe('original');
  symlinkSync(root, join(root, 'stage', 'directory-link'), 'junction');
  expect(() => native.openChild(stage, 'directory-link', false)).toThrow();
});
it.skipIf(process.platform === 'win32')('rejects a FIFO without blocking the process', () => {
  const fifo = spawnSync('mkfifo', [join(root, 'pipe')]);
  expect(fifo.status).toBe(0);
  expect(() => native.openFile(base, 'pipe', 'read')).toThrow();
  expect(() => native.fileIdentity(base, 'pipe')).toThrow();
});
it('reads exact regular file identity and rejects directories, missing names and forged handles', () => {
  write(base, 'owned');
  const stat = lstatSync(join(root, 'owned'), { bigint: true });
  expect(native.fileIdentity(base, 'owned')).toBe(`${stat.dev}:${stat.ino}`);
  own(native.openChild(base, 'folder', true));
  expect(() => native.fileIdentity(base, 'folder')).toThrow();
  expect(() => native.fileIdentity(base, 'absent')).toThrow();
  expect(() => Reflect.apply(native.fileIdentity, undefined, [{}, 'owned'])).toThrow();
  for (const name of ['', '..', 'a/b', 'a\\b', 'x\0hidden', null]) {
    expect(() => Reflect.apply(native.fileIdentity, undefined, [base, name])).toThrow();
  }
});
it.skipIf(process.platform === 'win32')(
  'can identify and delete an owned file without content read permission',
  () => {
    write(base, 'unreadable');
    chmodSync(join(root, 'unreadable'), 0);
    const stat = lstatSync(join(root, 'unreadable'), { bigint: true });
    expect(native.fileIdentity(base, 'unreadable')).toBe(`${stat.dev}:${stat.ino}`);
    native.unlinkFile(base, 'unreadable');
    expect(existsSync(join(root, 'unreadable'))).toBe(false);
  },
);
it('pins read, create, unlink and iteration despite independent process replacement', () => {
  const stage = own(native.openChild(base, 'stage', true));
  write(stage, 'original', 'owned');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'original'), 'external');
  const reader = native.openReader(stage);
  try {
    replace(join(root, 'stage'), join(root, 'detached'), outside);
    expect(read(stage, 'original')).toBe('owned');
    write(stage, 'created');
    expect(existsSync(join(outside, 'created'))).toBe(false);
    const entries = native.readReader(reader, 100);
    expect(entries.map((entry) => entry.name)).toContain('original');
    native.unlinkFile(stage, 'original');
    native.unlinkFile(stage, 'created');
    expect(existsSync(join(root, 'detached', 'original'))).toBe(false);
    expect(readFileSync(join(outside, 'original'), 'utf8')).toBe('external');
    expect(() => native.removeDirectory(base, 'stage')).toThrow();
    native.removeDirectory(base, 'detached');
  } finally {
    native.closeReader(reader);
  }
});
it('uses independent bounded directory cursors and does not lose buffered entries', () => {
  for (let index = 0; index < 43; index += 1) write(base, `entry-${index}`);
  const first = native.openReader(base);
  const second = native.openReader(base);
  try {
    const seen = native.readReader(first, 20);
    expect(seen).toHaveLength(20);
    expect(native.readReader(second, 20)).toEqual(seen);
    seen.push(...native.readReader(first, 20), ...native.readReader(first, 20));
    expect(new Set(seen.map((entry) => entry.name)).size).toBe(43);
    expect(native.readReader(first, 20)).toHaveLength(0);
    for (const value of [0, 101, 1.5, Number.NaN, Infinity, '20']) {
      expect(() => Reflect.apply(native.readReader, undefined, [first, value])).toThrow();
    }
    expect(() => Reflect.apply(native.openFile, undefined, [first, 'bad', 'create'])).toThrow();
    expect(() => Reflect.apply(native.readReader, undefined, [base, 1])).toThrow();
  } finally {
    native.closeReader(first);
    native.closeReader(second);
  }
});
it('closes directory and reader handles idempotently and rejects later reuse', () => {
  const stage = own(native.openChild(base, 'stage', true));
  const reader = native.openReader(stage);
  native.close(stage);
  native.close(stage);
  expect(() => native.identity(stage)).toThrow();
  expect(() => native.fileIdentity(stage, 'bad')).toThrow();
  expect(() => native.openFile(stage, 'bad', 'create')).toThrow();
  expect(native.readReader(reader, 1)).toEqual([]);
  native.closeReader(reader);
  native.closeReader(reader);
  expect(() => native.readReader(reader, 1)).toThrow();
});
