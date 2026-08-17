import { createWriteStream, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readZipAgentSkillRuntimeBundle,
  readZipAgentSkillSource,
  validateZipEntryFileType,
} from '../zip-reader';

const roots: string[] = [];
const skillMarkdown = `---
name: zipped-skill
description: A safely scanned ZIP Skill.
license: MIT
---

# Zipped Skill

Use a clear composition.
`;

async function createArchive(
  entries: ReadonlyArray<{ name: string; content: string | Buffer }>,
  symlinks: ReadonlyArray<{ name: string; target: string }> = [],
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'musefold-skill-zip-'));
  roots.push(root);
  const targetPath = join(root, 'skill.zip');
  const output = createWriteStream(targetPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  const completed = new Promise<void>((resolve, reject) => {
    output.once('close', resolve);
    output.once('error', reject);
    archive.once('error', reject);
  });
  archive.pipe(output);
  for (const entry of entries) archive.append(entry.content, { name: entry.name });
  for (const symlink of symlinks) archive.symlink(symlink.name, symlink.target);
  await archive.finalize();
  await completed;
  return targetPath;
}

function replaceArchivePath(targetPath: string, from: string, to: string): void {
  const source = Buffer.from(from);
  const replacement = Buffer.from(to);
  if (source.byteLength !== replacement.byteLength) throw new Error('fixture paths must have equal length');
  const archive = readFileSync(targetPath);
  let replacements = 0;
  let offset = 0;
  while ((offset = archive.indexOf(source, offset)) >= 0) {
    replacement.copy(archive, offset);
    offset += replacement.byteLength;
    replacements += 1;
  }
  if (replacements < 2) throw new Error(`fixture path was not present in local and central headers: ${from}`);
  writeFileSync(targetPath, archive);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ZIP Agent Skill reader', () => {
  it('returns safe in-memory bytes for a one-run Skill attachment', async () => {
    const targetPath = await createArchive([
      { name: 'skill/SKILL.md', content: skillMarkdown },
      { name: 'skill/references/style.txt', content: 'Use generous whitespace.' },
      { name: 'skill/scripts/run.sh', content: 'echo unsafe' },
    ]);

    const result = await readZipAgentSkillRuntimeBundle(targetPath);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.scan.name).toBe('zipped-skill');
    expect(result.data.files.map((file) => file.relativePath)).toEqual([
      'SKILL.md',
      'references/style.txt',
      'scripts/run.sh',
    ]);
    expect(new TextDecoder().decode(result.data.files[1].bytes)).toBe('Use generous whitespace.');
    expect(result.data.scan.files.find((file) => file.relativePath === 'scripts/run.sh')?.executionPolicy).toBe('never');
  });

  it('reads a standard ZIP through memory only and strips one packaging root', async () => {
    const targetPath = await createArchive([
      { name: 'zipped-skill/SKILL.md', content: skillMarkdown },
      { name: 'zipped-skill/references/layout/rules.md', content: 'Use four clear layers.' },
      { name: 'zipped-skill/assets/example.png', content: Buffer.from([0, 1, 2, 3]) },
      { name: 'zipped-skill/scripts/validate.py', content: 'print("validate")' },
      { name: 'zipped-skill/LICENSE.txt', content: 'Apache License fixture' },
    ]);

    const result = await readZipAgentSkillSource(targetPath);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      name: 'zipped-skill',
      description: 'A safely scanned ZIP Skill.',
      licenseText: 'Apache License fixture',
    });
    expect(result.data.files.map((file) => [file.relativePath, file.fileKind])).toEqual([
      ['assets/example.png', 'asset'],
      ['LICENSE.txt', 'license'],
      ['references/layout/rules.md', 'reference'],
      ['scripts/validate.py', 'script'],
      ['SKILL.md', 'skill_md'],
    ]);
    expect(result.data.files.every((file) => file.executionPolicy === 'never')).toBe(true);
  });

  it('reads only the requested Skill directory from a repository archive', async () => {
    const targetPath = await createArchive([
      { name: 'repo-main/README.md', content: 'Repository readme' },
      { name: 'repo-main/skills/poster/SKILL.md', content: skillMarkdown },
      { name: 'repo-main/skills/poster/references/layout.md', content: 'Use a sparse layout.' },
      { name: 'repo-main/skills/other/SKILL.md', content: skillMarkdown.replace('zipped-skill', 'other-skill') },
    ]);

    const result = await readZipAgentSkillSource(targetPath, { skillPath: 'skills/poster' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files.map((file) => file.relativePath)).toEqual([
      'references/layout.md',
      'SKILL.md',
    ]);
    expect(result.data.files.some((file) => file.textContent?.includes('Repository readme'))).toBe(false);
  });

  it('auto-selects a unique nested Skill when repository metadata sits beside it', async () => {
    const targetPath = await createArchive([
      { name: 'repo-main/README.md', content: 'Repository readme' },
      { name: 'repo-main/NOTICE.md', content: 'Repository notice' },
      { name: 'repo-main/ian-xiaohei-illustrations/SKILL.md', content: skillMarkdown },
      { name: 'repo-main/ian-xiaohei-illustrations/references/style.md', content: 'Keep the illustration sparse.' },
    ]);

    const result = await readZipAgentSkillSource(targetPath);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files.map((file) => file.relativePath)).toEqual([
      'references/style.md',
      'SKILL.md',
    ]);
    expect(result.data.files.some((file) => file.textContent?.includes('Repository readme'))).toBe(false);
  });

  it.each([
    ['parent traversal', '../outside.md'],
    ['absolute path', '/a/outside.md'],
    ['Windows absolute path', 'C:/outside.md'],
  ] as const)('rejects %s entries before reading content', async (_label, maliciousPath) => {
    const targetPath = await createArchive([
      { name: 'SKILL.md', content: skillMarkdown },
      { name: 'aa/outside.md', content: 'must stay outside' },
    ]);
    replaceArchivePath(targetPath, 'aa/outside.md', maliciousPath);

    const result = await readZipAgentSkillSource(targetPath);
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE', recoveryAction: 'select-source' } });
  });

  it('rejects symlink and Unix device entries', async () => {
    const targetPath = await createArchive(
      [{ name: 'SKILL.md', content: skillMarkdown }],
      [{ name: 'references/outside.md', target: '../../outside.md' }],
    );
    const symlink = await readZipAgentSkillSource(targetPath);
    expect(symlink).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });

    const device = validateZipEntryFileType({
      fileName: 'device-entry',
      versionMadeBy: 3 << 8,
      externalFileAttributes: (0o020666 << 16) >>> 0,
    });
    expect(device).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });
  });

  it('rejects duplicate canonical file paths', async () => {
    const targetPath = await createArchive([
      { name: 'SKILL.md', content: skillMarkdown },
      { name: 'references/rules.md', content: 'First copy' },
      { name: 'references/rules.md', content: 'Second copy' },
    ]);

    const result = await readZipAgentSkillSource(targetPath);
    expect(result).toMatchObject({ ok: false, error: { code: 'DUPLICATE_KEY' } });
  });

  it('rejects a high-ratio zip bomb before opening its stream', async () => {
    const targetPath = await createArchive([
      { name: 'SKILL.md', content: skillMarkdown },
      { name: 'assets/bomb.bin', content: Buffer.alloc(2 * 1024 * 1024) },
    ]);

    const result = await readZipAgentSkillSource(targetPath);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RANGE', recoveryAction: 'select-source' },
    });
    if (!result.ok) expect(result.error.message).toContain('压缩比');
  });

  it('rejects oversized and overpopulated archives', async () => {
    const oversized = await createArchive([
      { name: 'SKILL.md', content: skillMarkdown },
      { name: 'assets/large.bin', content: randomBytes(16 * 1024 * 1024 + 1) },
    ]);
    const oversizedResult = await readZipAgentSkillSource(oversized);
    expect(oversizedResult).toMatchObject({ ok: false, error: { code: 'INVALID_RANGE' } });

    const entries: Array<{ name: string; content: string | Buffer }> = [
      { name: 'SKILL.md', content: skillMarkdown },
    ];
    for (let index = 0; index < 500; index += 1) {
      entries.push({ name: `assets/item-${String(index).padStart(3, '0')}.bin`, content: Buffer.from([index % 255]) });
    }
    const overpopulated = await createArchive(entries);
    const overpopulatedResult = await readZipAgentSkillSource(overpopulated);
    expect(overpopulatedResult).toMatchObject({ ok: false, error: { code: 'TOO_MANY_ITEMS' } });
  });
});
