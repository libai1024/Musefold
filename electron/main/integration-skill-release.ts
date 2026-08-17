import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SKILL_INSTALL_METADATA_FILE = '.musefold-install.json';
export const SKILL_VERSION_MARKER = /<!--\s*musefold-skill-version:\s*(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*-->/;

export interface MusefoldSkillReleaseFile {
  path: string;
  url: string;
  sha256: string;
}

export interface MusefoldSkillReleaseManifest {
  schemaVersion: 1;
  name: 'musefold';
  version: string;
  releasedAt: string;
  minimumAppVersion: string;
  files: MusefoldSkillReleaseFile[];
}

export interface MusefoldSkillInstallMetadata {
  schemaVersion: 1;
  name: 'musefold';
  version: string;
  source: 'bundled' | 'github-release';
  manifestUrl: string | null;
  installedAt: string;
  files: Array<{ path: string; sha256: string }>;
}

export function sha256Text(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function extractMusefoldSkillVersion(content: string): string | null {
  return content.match(SKILL_VERSION_MARKER)?.[1] ?? null;
}

export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string) => {
    const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) throw new Error(`无效版本号：${value}`);
    return {
      numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
      prerelease: match[4] ?? null,
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.numbers.length; index += 1) {
    const difference = a.numbers[index]! - b.numbers[index]!;
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease == null) return 1;
  if (b.prerelease == null) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en');
}

function isSafeReleasePath(value: string): boolean {
  return value.length > 0
    && value.length <= 240
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/).includes('..')
    && !value.includes('\\');
}

function isReleaseFileUrl(value: string, version: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && parsed.hostname === 'raw.githubusercontent.com'
      && parsed.pathname.startsWith(`/libai1024/Musefold-Skills/${version}/skills/musefold/`);
  } catch {
    return false;
  }
}

export function validateSkillReleaseManifest(value: unknown): MusefoldSkillReleaseManifest {
  if (!value || typeof value !== 'object') throw new Error('Skill 发布清单不是对象');
  const candidate = value as Partial<MusefoldSkillReleaseManifest>;
  if (candidate.schemaVersion !== 1 || candidate.name !== 'musefold') {
    throw new Error('Skill 发布清单版本或名称无效');
  }
  if (typeof candidate.version !== 'string') throw new Error('Skill 发布清单缺少版本号');
  compareReleaseVersions(candidate.version, candidate.version);
  if (typeof candidate.minimumAppVersion !== 'string') throw new Error('Skill 发布清单缺少最低 App 版本');
  compareReleaseVersions(candidate.minimumAppVersion, candidate.minimumAppVersion);
  if (typeof candidate.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(candidate.releasedAt)) {
    throw new Error('Skill 发布时间无效');
  }
  if (!Array.isArray(candidate.files) || candidate.files.length === 0 || candidate.files.length > 32) {
    throw new Error('Skill 发布文件列表无效');
  }
  const seen = new Set<string>();
  for (const file of candidate.files) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !isSafeReleasePath(file.path)) {
      throw new Error('Skill 发布文件路径无效');
    }
    if (seen.has(file.path)) throw new Error(`Skill 发布文件重复：${file.path}`);
    seen.add(file.path);
    if (typeof file.url !== 'string' || !isReleaseFileUrl(file.url, candidate.version)) {
      throw new Error(`Skill 发布文件 URL 无效：${file.path}`);
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Skill 发布文件 SHA-256 无效：${file.path}`);
    }
  }
  if (!seen.has('SKILL.md')) throw new Error('Skill 发布清单缺少 SKILL.md');
  return candidate as MusefoldSkillReleaseManifest;
}

export function createSkillInstallMetadata(
  manifest: MusefoldSkillReleaseManifest,
  source: MusefoldSkillInstallMetadata['source'],
  manifestUrl: string | null,
  installedAt = new Date().toISOString(),
): MusefoldSkillInstallMetadata {
  return {
    schemaVersion: 1,
    name: 'musefold',
    version: manifest.version,
    source,
    manifestUrl,
    installedAt,
    files: manifest.files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
}

export function replaceMusefoldSkillDirectory(
  dir: string,
  files: Map<string, string>,
  manifest: MusefoldSkillReleaseManifest,
  source: MusefoldSkillInstallMetadata['source'],
  manifestUrl: string | null,
): string | null {
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true });
  const nonce = `${Date.now()}-${process.pid}`;
  const stage = join(parent, `.musefold-stage-${nonce}`);
  const backup = join(parent, `musefold.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
  let movedExisting = false;
  try {
    mkdirSync(stage, { recursive: false });
    for (const [relativePath, content] of files) {
      const target = join(stage, relativePath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, { encoding: 'utf8', mode: 0o600 });
    }
    writeFileSync(
      join(stage, SKILL_INSTALL_METADATA_FILE),
      `${JSON.stringify(createSkillInstallMetadata(manifest, source, manifestUrl), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    if (existsSync(dir)) {
      renameSync(dir, backup);
      movedExisting = true;
    }
    renameSync(stage, dir);
    return movedExisting ? backup : null;
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    if (movedExisting && !existsSync(dir) && existsSync(backup)) renameSync(backup, dir);
    throw error;
  }
}
