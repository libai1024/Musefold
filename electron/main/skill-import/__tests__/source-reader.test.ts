import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readLocalAgentSkillSource,
  SKILL_MAX_TEXT_FILE_BYTES,
  SKILL_MAX_TEXT_FILES,
} from '../source-reader';

const roots: string[] = [];
const skillMarkdown = `---
name: local-safe-skill
description: A local Skill used for filesystem safety tests.
---

# Local safe Skill
`;

function skillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-local-skill-safety-'));
  roots.push(root);
  writeFileSync(join(root, 'SKILL.md'), skillMarkdown);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('local Agent Skill filesystem limits', () => {
  it.runIf(process.platform !== 'win32')('rejects symlinks without following them outside the selected root', async () => {
    const root = skillRoot();
    const outsideRoot = mkdtempSync(join(tmpdir(), 'musefold-local-skill-outside-'));
    roots.push(outsideRoot);
    writeFileSync(join(outsideRoot, 'private.txt'), 'must not be read');
    mkdirSync(join(root, 'references'));
    symlinkSync(join(outsideRoot, 'private.txt'), join(root, 'references', 'linked.txt'));

    const result = await readLocalAgentSkillSource({ sourceKind: 'local_folder', absolutePath: root });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE', recoveryAction: 'select-source' } });
    if (!result.ok) {
      expect(result.error.message).toContain('符号链接');
      expect(JSON.stringify(result.error)).not.toContain(outsideRoot);
    }
  });

  it('rejects a text file above the per-file limit before loading it into a snapshot', async () => {
    const root = skillRoot();
    mkdirSync(join(root, 'references'));
    writeFileSync(join(root, 'references', 'too-large.md'), Buffer.alloc(SKILL_MAX_TEXT_FILE_BYTES + 1, 65));

    const result = await readLocalAgentSkillSource({ sourceKind: 'local_folder', absolutePath: root });
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_RANGE' } });
    if (!result.ok) expect(result.error.message).toContain('文本文件过大');
  });

  it('rejects more than the allowed number of text files', async () => {
    const root = skillRoot();
    mkdirSync(join(root, 'references'));
    for (let index = 0; index < SKILL_MAX_TEXT_FILES; index += 1) {
      writeFileSync(join(root, 'references', `rule-${String(index).padStart(3, '0')}.md`), `Rule ${index}`);
    }

    const result = await readLocalAgentSkillSource({ sourceKind: 'local_folder', absolutePath: root });
    expect(result).toMatchObject({ ok: false, error: { code: 'TOO_MANY_ITEMS' } });
    if (!result.ok) expect(result.error.message).toContain('文本文件数量');
  });
});
