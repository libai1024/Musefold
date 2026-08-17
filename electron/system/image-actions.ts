import { copyFile, stat } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';

const IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
]);

export interface ImageFileInfo {
  path: string;
  name: string;
  extension: string;
}

export async function inspectImageFile(sourcePath: string): Promise<ImageFileInfo> {
  if (typeof sourcePath !== 'string' || !sourcePath.trim()) {
    throw new Error('图片路径不能为空');
  }

  const path = resolve(sourcePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error('图片不存在或已被移动');

  const extension = extname(path).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('不支持的图片格式');

  return { path, name: basename(path), extension };
}

export async function saveImageFile(sourcePath: string, targetPath: string): Promise<string> {
  const source = await inspectImageFile(sourcePath);
  if (typeof targetPath !== 'string' || !targetPath.trim()) throw new Error('保存路径不能为空');

  const target = resolve(targetPath);
  if (target === source.path) return target;
  await copyFile(source.path, target);
  return target;
}

async function availableImagePath(directory: string, name: string, reserved: Set<string>): Promise<string> {
  const extension = extname(name);
  const stem = basename(name, extension);
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = join(directory, index === 1 ? name : `${stem} (${index})${extension}`);
    if (reserved.has(candidate)) continue;
    const exists = await stat(candidate).then(() => true).catch(() => false);
    if (!exists) {
      reserved.add(candidate);
      return candidate;
    }
  }
  throw new Error(`无法为 ${name} 创建不重复的文件名`);
}

export async function saveImageFiles(sourcePaths: string[], targetDirectory: string): Promise<string[]> {
  if (!Array.isArray(sourcePaths) || sourcePaths.length === 0) throw new Error('请选择至少一张图片');
  if (typeof targetDirectory !== 'string' || !targetDirectory.trim()) throw new Error('保存目录不能为空');

  const directory = resolve(targetDirectory);
  const directoryInfo = await stat(directory).catch(() => null);
  if (!directoryInfo?.isDirectory()) throw new Error('保存目录不存在');

  const sources = await Promise.all(sourcePaths.map((sourcePath) => inspectImageFile(sourcePath)));
  const reserved = new Set<string>();
  const targets: string[] = [];
  for (const source of sources) {
    const target = await availableImagePath(directory, source.name, reserved);
    await copyFile(source.path, target);
    targets.push(target);
  }
  return targets;
}
