import { spawnSync } from 'node:child_process';
import type { ManagedFilesystem } from '@musefold/managed-fs';
import { filesystem } from './managed-fs-fixture';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DesignSchemePackageStaging } from '../package-staging';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'musefold-staging-boundary-'));
  roots.push(root);
  const managed = join(root, 'staging');
  const original = join(root, 'original.musefold.design');
  writeFileSync(original, 'original-package');
  const service = new DesignSchemePackageStaging({
    filesystem,
    rootDir: managed,
    inspectPackage: async () => ({ formatVersion: 2 }),
  });
  return { root, managed, original, service };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('preserves originals behind an initial staging-root symlink during owner cleanup', () => {
  const { root, managed } = fixture();
  const outside = join(root, 'originals', '11');
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'original.txt'), 'preserve');
  symlinkSync(join(root, 'originals'), managed, 'dir');
  const service = new DesignSchemePackageStaging({ filesystem, rootDir: managed });
  service.cleanupOwner(11);
  expect(existsSync(join(outside, 'original.txt'))).toBe(true);
});

it.each(['root', 'owner', 'stage'] as const)(
  'rejects a replaced %s symlink without reading or deleting its target',
  async (level) => {
    const { root, managed, original, service } = fixture();
    const staged = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
    const parts =
      level === 'root' ? [] : level === 'owner' ? ['11'] : ['11', staged.stagedPackageId];
    const swapped = join(managed, ...parts);
    renameSync(swapped, join(root, 'detached'));
    const external = join(root, 'external');
    const suffix =
      level === 'root'
        ? ['11', staged.stagedPackageId]
        : level === 'owner'
          ? [staged.stagedPackageId]
          : [];
    mkdirSync(join(external, ...suffix), { recursive: true });
    const victim = join(external, ...suffix, 'package.musefold.design');
    writeFileSync(victim, 'original-package');
    symlinkSync(external, swapped, 'dir');
    const consume = vi.fn(async () => 'should-not-import');
    await expect(service.consume(11, staged, consume)).rejects.toThrow();
    service.cleanupOwner(11);
    service.cleanupAll();
    expect(consume).not.toHaveBeenCalled();
    expect(existsSync(victim)).toBe(true);
    expect(readFileSync(original, 'utf8')).toBe('original-package');
  },
);

it('rejects replacement with an ordinary directory even when package bytes match', async () => {
  const { root, managed, original, service } = fixture();
  const staged = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  const stage = join(managed, '11', staged.stagedPackageId);
  renameSync(stage, join(root, 'detached'));
  mkdirSync(stage);
  const replacement = join(stage, 'package.musefold.design');
  writeFileSync(replacement, 'original-package');
  const consume = vi.fn(async () => 'wrong-directory');
  await expect(service.consume(11, staged, consume)).rejects.toThrow();
  service.cleanupAll();
  expect(consume).not.toHaveBeenCalled();
  expect(existsSync(replacement)).toBe(true);
});

it('does not delete a live consuming file when an owner is cleaned and starts another import', async () => {
  const { managed, original, service } = fixture();
  const staged = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const flight = service.consume(11, staged, async (path) => {
    started();
    await waiting;
    return readFileSync(path, 'utf8');
  });
  await entered;
  service.cleanupOwner(11);
  const next = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  release();
  await expect(flight).resolves.toBe('original-package');
  expect(existsSync(join(managed, '11', next.stagedPackageId))).toBe(true);
  service.cleanupAll();
});

it('cannot publish a stage after its owner was cleaned during package inspection', async () => {
  const { root, managed, original } = fixture();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const service = new DesignSchemePackageStaging({
    filesystem,
    rootDir: managed,
    inspectPackage: async () => {
      started();
      await waiting;
      return { formatVersion: 2 };
    },
  });
  const stage = service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  await entered;
  service.cleanupOwner(11);
  release();
  await expect(stage).rejects.toThrow();
  expect(existsSync(join(managed, '11'))).toBe(false);
  expect(readFileSync(join(root, 'original.musefold.design'), 'utf8')).toBe('original-package');
});

it('scans a bounded batch, drains old stages and keeps current previews regardless of age', async () => {
  const { managed, original, service } = fixture();
  const live = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  for (let index = 0; index < 43; index += 1) {
    const path = join(managed, '99', `stage_${index.toString(16).padStart(32, '0')}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'package.musefold.design'), 'orphan');
  }
  const batches = [service.collectOrphans()];
  expect(batches[0]?.scanned).toBe(20);
  expect(batches[0]?.deleted).toBeLessThan(20);
  for (let pass = 0; pass < 5; pass += 1) batches.push(service.collectOrphans());
  expect(batches.reduce((sum, batch) => sum + batch.deleted, 0)).toBe(43);
  expect(batches.reduce((sum, batch) => sum + batch.failed, 0)).toBe(0);
  expect(existsSync(join(managed, '99'))).toBe(false);
  vi.spyOn(Date, 'now').mockReturnValue(9_000_000_000_000);
  try {
    expect(service.collectOrphans().failed).toBe(0);
    await expect(
      service.consume(11, live, async (path) => readFileSync(path, 'utf8')),
    ).resolves.toBe('original-package');
  } finally {
    vi.restoreAllMocks();
  }
});

it('keeps failed cleanup discoverable across service restarts and reports pending work', () => {
  const { managed } = fixture();
  const path = join(managed, '11', `stage_${'a'.repeat(32)}`);
  mkdirSync(path, { recursive: true });
  const foreign = join(path, 'preserve-original.txt');
  writeFileSync(foreign, 'preserve');
  const first = new DesignSchemePackageStaging({ filesystem, rootDir: managed });
  expect(first.collectOrphans()).toMatchObject({ deleted: 0, failed: 1, pending: 1 });
  expect(readFileSync(foreign, 'utf8')).toBe('preserve');
  const restarted = new DesignSchemePackageStaging({ filesystem, rootDir: managed });
  expect(restarted.collectOrphans()).toMatchObject({ deleted: 0, failed: 1, pending: 1 });
  // Operator removes only the unexpected owned test file; retry still checks the boundary.
  rmSync(foreign);
  expect(restarted.collectOrphans()).toMatchObject({ deleted: 1, failed: 0, pending: 0 });
  expect(existsSync(path)).toBe(false);
});

it('unlinks internal package symlinks without following them and leaves unknown directory names alone', () => {
  const { managed, original, service } = fixture();
  const path = join(managed, '11', `stage_${'b'.repeat(32)}`);
  mkdirSync(path, { recursive: true });
  symlinkSync(original, join(path, 'package.musefold.design'));
  const unknown = join(managed, 'user-photos');
  mkdirSync(unknown);
  writeFileSync(join(unknown, 'original.txt'), 'preserve');
  expect(service.collectOrphans()).toMatchObject({ deleted: 1, failed: 0 });
  expect(readFileSync(original, 'utf8')).toBe('original-package');
  expect(readFileSync(join(unknown, 'original.txt'), 'utf8')).toBe('preserve');
});

it('bounds deletion within a single oversized orphan directory and retries the remainder', () => {
  const { managed, service } = fixture();
  const path = join(managed, '11', `stage_${'c'.repeat(32)}`);
  mkdirSync(path, { recursive: true });
  for (let index = 0; index < 40; index += 1) {
    const id = `${index.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
    writeFileSync(join(path, `verify-${id}.musefold.design`), 'orphan');
  }
  expect(service.collectOrphans()).toMatchObject({ deleted: 0, failed: 1, pending: 1 });
  expect(existsSync(path)).toBe(true);
  expect(service.collectOrphans()).toMatchObject({ deleted: 1, failed: 0, pending: 0 });
});

it('rejects a symlink below the explicitly trusted userData parent', async () => {
  const { root, original } = fixture();
  mkdirSync(join(root, 'outside'));
  symlinkSync(join(root, 'outside'), join(root, 'linked'), 'dir');
  const service = new DesignSchemePackageStaging({
    filesystem,
    rootDir: join(root, 'linked', 'packages'),
    trustedParentDir: root,
  });
  await expect(
    service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] }),
  ).rejects.toThrow();
  expect(service.collectOrphans().failed).toBe(1);
  expect(existsSync(join(root, 'outside', 'packages'))).toBe(false);
});

it('canonicalizes the trusted parent alias once and rejects root escape', async () => {
  const { root, original } = fixture();
  const physical = join(root, 'physical');
  const alias = join(root, 'alias');
  mkdirSync(physical);
  symlinkSync(physical, alias, 'dir');
  const service = new DesignSchemePackageStaging({
    filesystem,
    rootDir: join(alias, 'packages'),
    trustedParentDir: alias,
    inspectPackage: async () => ({ formatVersion: 2 }),
  });
  const staged = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  await expect(
    service.consume(11, staged, async (path) => readFileSync(path, 'utf8')),
  ).resolves.toBe('original-package');
  const escaped = new DesignSchemePackageStaging({
    filesystem,
    rootDir: join(alias, '..', 'escape'),
    trustedParentDir: alias,
  });
  await expect(
    escaped.stagePickedPackage(11, original, { acceptedFormatVersions: [2] }),
  ).rejects.toThrow();
  expect(existsSync(join(root, 'escape'))).toBe(false);
});

it('shutdown waits for an admitted consumer file to be read before cleaning its stage', async () => {
  const { managed, original, service } = fixture();
  const staged = await service.stagePickedPackage(11, original, { acceptedFormatVersions: [2] });
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const flight = service.consume(11, staged, async (path) => {
    started();
    await waiting;
    return readFileSync(path, 'utf8');
  });
  await entered;
  service.cleanupAll();
  expect(existsSync(join(managed, '11', staged.stagedPackageId))).toBe(true);
  await expect(
    service.stagePickedPackage(12, original, { acceptedFormatVersions: [2] }),
  ).rejects.toThrow('已关闭');
  release();
  await expect(flight).resolves.toBe('original-package');
  expect(existsSync(managed)).toBe(false);
});

for (const level of ['root', 'owner', 'stage'] as const) {
  it.each(['unlinkFile', 'openFile:create', 'openFile:read', 'openReader'] as const)(
    `native %s stays anchored after an independent process replaces ${level} at the syscall boundary`,
    async (operation) => {
      const { root, managed, original } = fixture();
      const members = Object.fromEntries(
        Object.getOwnPropertyNames(filesystem).map((name) => [name, Reflect.get(filesystem, name)]),
      );
      const guarded = members as unknown as ManagedFilesystem;
      let replaceNow: (() => void) | undefined;
      const [method, mode] = operation.split(':');
      const native = Reflect.get(filesystem, method);
      Reflect.set(members, method, (...args: unknown[]) => {
        if (replaceNow && (!mode || args[2] === mode)) {
          const replace = replaceNow;
          replaceNow = undefined;
          replace();
        }
        return Reflect.apply(native, filesystem, args);
      });
      const service = new DesignSchemePackageStaging({
        rootDir: managed,
        filesystem: guarded,
        inspectPackage: async () => ({ formatVersion: 2 }),
      });
      const staged = await service.stagePickedPackage(11, original, {
        acceptedFormatVersions: [2],
      });
      const parts =
        level === 'root' ? [] : level === 'owner' ? ['11'] : ['11', staged.stagedPackageId];
      const suffix =
        level === 'root'
          ? ['11', staged.stagedPackageId]
          : level === 'owner'
            ? [staged.stagedPackageId]
            : [];
      const path = join(managed, ...parts);
      const detached = join(root, 'detached');
      const external = join(root, 'owned-originals');
      const originalDirectory = join(external, ...suffix);
      mkdirSync(originalDirectory, { recursive: true });
      writeFileSync(join(originalDirectory, 'package.musefold.design'), 'external-original');
      let substituted = false;
      replaceNow = () => {
        const child = spawnSync(
          process.execPath,
          [
            '-e',
            "const fs=require('node:fs');fs.renameSync(process.argv[1],process.argv[2]);fs.symlinkSync(process.argv[3],process.argv[1],'junction');",
            path,
            detached,
            external,
          ],
          { encoding: 'utf8' },
        );
        expect(child.status, child.stderr).toBe(0);
        substituted = true;
      };
      const consume = vi.fn(async () => 'should-not-read-substituted-path');
      if (operation.startsWith('openFile'))
        await expect(service.consume(11, staged, consume)).rejects.toThrow();
      else service.cleanupOwner(11);
      service.cleanupAll();
      expect(substituted).toBe(true);
      expect(readFileSync(join(originalDirectory, 'package.musefold.design'), 'utf8')).toBe(
        'external-original',
      );
      expect(readFileSync(original, 'utf8')).toBe('original-package');
      expect(readdirSync(originalDirectory)).toEqual(['package.musefold.design']);
      expect(consume).not.toHaveBeenCalled();
      if (operation === 'unlinkFile')
        expect(existsSync(join(detached, ...suffix, 'package.musefold.design'))).toBe(false);
    },
  );
}
