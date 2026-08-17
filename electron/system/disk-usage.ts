// 图片输出目录占用统计（TASK-HIS-11）

import { mkdir, readdir, stat } from 'fs/promises';
import { extname, join } from 'path';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

export interface ImageDiskUsage {
  imagesBytes: number;
  imagesCount: number;
  dir: string;
}

export async function collectImageDiskUsage(dir: string): Promise<ImageDiskUsage> {
  await mkdir(dir, { recursive: true });

  let imagesBytes = 0;
  let imagesCount = 0;

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile() || !IMAGE_EXTS.has(extname(entry.name).toLowerCase())) continue;
      const info = await stat(path);
      imagesCount += 1;
      imagesBytes += info.size;
    }
  }

  await walk(dir);
  return { imagesBytes, imagesCount, dir };
}
