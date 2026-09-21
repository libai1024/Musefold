import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, stat, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication } from '@playwright/test';

const exec = promisify(execFile);
type Entity = { 'dev-entry': string; 'mount-point'?: string };

/** Real bounded filesystem, mounted only over a new empty directory in owned test userData. */
export async function capacityDiskImage(mount: string) {
  const scratch = await mkdtemp(join(tmpdir(), 'musefold-capacity-volume-'));
  const image = join(scratch, 'capacity.dmg');
  const plist = join(scratch, 'image.plist');
  let device: string | undefined;
  let closed = false;
  async function parsePlist(raw: string) {
    await writeFile(plist, raw);
    return JSON.parse((await exec('plutil', ['-convert', 'json', '-o', '-', plist])).stdout);
  }
  async function ownedImage() {
    const info = await parsePlist((await exec('hdiutil', ['info', '-plist'])).stdout);
    const canonical = await realpath(image);
    for (const entry of info.images) {
      if ((await realpath(entry['image-path']).catch(() => '')) === canonical) return entry;
    }
    return undefined;
  }
  async function close() {
    if (closed) return;
    const mounted = await ownedImage();
    if (mounted) {
      device ??= (mounted['system-entities'] as Entity[]).find((entity) =>
        /^\/dev\/disk\d+$/.test(entity['dev-entry']),
      )?.['dev-entry'];
      if (!device) throw new Error('Cannot identify owned capacity image for detach');
      await exec('hdiutil', ['detach', device], { timeout: 30000 });
      if (await ownedImage()) throw new Error('Capacity image is still mounted');
    }
    closed = true;
    await rm(scratch, { recursive: true, force: true });
  }
  try {
    // mkdir is exclusive: never hide an existing import directory or its files.
    await mkdir(mount);
    await exec(
      'hdiutil',
      [
        'create',
        '-size',
        '128m',
        '-fs',
        'HFS+',
        '-volname',
        'MusefoldCapacityTest',
        '-type',
        'UDIF',
        image,
      ],
      { timeout: 60000 },
    );
    const attached = await parsePlist(
      (
        await exec(
          'hdiutil',
          ['attach', '-nobrowse', '-noautoopen', '-mountpoint', mount, '-plist', image],
          { timeout: 60000 },
        )
      ).stdout,
    );
    const entities = attached['system-entities'] as Entity[];
    device = entities.find((entity) => /^\/dev\/disk\d+$/.test(entity['dev-entry']))?.['dev-entry'];
    const mounted = entities.find((entity) => entity['mount-point']);
    if (
      !device ||
      !mounted?.['mount-point'] ||
      (await realpath(mounted['mount-point'])) !== (await realpath(mount))
    )
      throw new Error('Capacity image mounted at an unexpected location');
    return { device, mount: mounted['mount-point'], filesystem: 'HFS+', close };
  } catch (error) {
    // Attach may have succeeded before parsing/validation failed. Rediscover only this exact image.
    try {
      await stat(image);
    } catch {
      await rm(scratch, { recursive: true, force: true });
      throw error;
    }
    await close();
    throw error;
  }
}

/** Observe real OS writes/errors; never inject a failure, modify bytes or change the return value. */
export async function observeCapacityWrites(
  app: ElectronApplication,
  mount: string,
  marker: string,
) {
  await app.evaluate(
    (_electron, { mount, marker }) => {
      const fs = process.getBuiltinModule('fs');
      const modules = process.getBuiltinModule('module');
      const path = process.getBuiltinModule('path');
      const original = fs.writeFileSync;
      const root = fs.realpathSync(mount);
      const events: Array<Record<string, unknown>> = [];
      fs.writeFileSync = (file, bytes, options) => {
        let target: string;
        try {
          target = path.join(
            fs.realpathSync(path.dirname(String(file))),
            path.basename(String(file)),
          );
        } catch {
          return original(file, bytes, options);
        }
        if (!target.startsWith(`${root}/`)) return original(file, bytes, options);
        const event: Record<string, unknown> = {
          path: path.relative(root, target),
          pid: process.pid,
          at: new Date().toISOString(),
          requestedBytes: typeof bytes === 'string' ? Buffer.byteLength(bytes) : bytes.byteLength,
        };
        try {
          original(file, bytes, options);
          event.status = 'written';
        } catch (error) {
          event.status = 'failed';
          event.error = (error as NodeJS.ErrnoException).code;
          throw error;
        } finally {
          event.actualFileBytes = fs.existsSync(file) ? fs.statSync(file).size : 0;
          const stat = fs.statfsSync(root);
          event.availableBytes = stat.bavail * stat.bsize;
          events.push(event);
          original(marker, JSON.stringify(events), { mode: 0o600 });
        }
      };
      modules.syncBuiltinESMExports();
    },
    { mount, marker },
  );
}
