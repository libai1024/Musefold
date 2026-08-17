import { describe, expect, it } from 'vitest';
import {
  classifyAgentSkillFile,
  parseAgentSkillMarkdown,
  scanAgentSkillFiles,
  type AgentSkillFileInput,
} from '../skill-scanner';

function sourceFile(relativePath: string, textContent: string | null): AgentSkillFileInput {
  return {
    relativePath,
    contentHash: `sha256:${relativePath.replace(/[^a-z0-9]/gi, '') || 'file'}`,
    sizeBytes: textContent === null ? 32 : new TextEncoder().encode(textContent).byteLength,
    textContent,
  };
}

const standardSkill = `---
name: scientific-diagram
description: Create clear scientific architecture diagrams.
license: Apache-2.0
metadata:
  author: Example Lab
compatibility: Requires no external runtime.
---

# Scientific diagrams

Keep labels readable and arrange modules in clear layers.
`;

describe('Agent Skill safe-subset scanner', () => {
  it('reads a standard Skill, body, references, assets, scripts and license without execution authority', () => {
    const result = scanAgentSkillFiles([
      sourceFile('SKILL.md', standardSkill),
      sourceFile('references/architecture.md', '# Architecture\nUse four layers.'),
      sourceFile('assets/example.png', null),
      sourceFile('scripts/validate.py', 'print("validate")'),
      sourceFile('LICENSE.txt', 'Apache License 2.0\nFull license text'),
      sourceFile('agents/openai.yaml', 'interface:\n  display_name: Diagram'),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      name: 'scientific-diagram',
      description: 'Create clear scientific architecture diagrams.',
      licenseText: 'Apache License 2.0\nFull license text',
    });
    expect(result.data.body).toContain('Keep labels readable');
    expect(result.data.files.map((file) => [file.relativePath, file.fileKind])).toEqual([
      ['agents/openai.yaml', 'other'],
      ['assets/example.png', 'asset'],
      ['LICENSE.txt', 'license'],
      ['references/architecture.md', 'reference'],
      ['scripts/validate.py', 'script'],
      ['SKILL.md', 'skill_md'],
    ]);
    expect(result.data.files.find((file) => file.fileKind === 'script')).toMatchObject({
      textContent: 'print("validate")',
      executionPolicy: 'never',
    });
    expect(result.data.files.find((file) => file.fileKind === 'asset')?.textContent).toBeNull();
    expect(result.data.metadata).toMatchObject({
      format: 'agent-skills-safe-subset',
      safety: {
        metadataAuthority: 'none',
        scriptsExecutable: false,
        executionPolicy: 'never',
      },
    });
  });

  it('requires a root SKILL.md and does not treat nested SKILL.md as the package manifest', () => {
    const missing = scanAgentSkillFiles([
      sourceFile('nested/SKILL.md', standardSkill),
      sourceFile('references/readme.md', 'reference'),
    ]);

    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'MISSING_REFERENCE', fieldPath: 'files.SKILL.md' },
    });
    expect(classifyAgentSkillFile('nested/SKILL.md')).toBe('other');
  });

  it('rejects malformed frontmatter and missing required name or description', () => {
    const malformed = parseAgentSkillMarkdown(`---\nname: [broken\ndescription: test\n---\nbody`);
    expect(malformed).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });

    const missingName = parseAgentSkillMarkdown(`---\ndescription: Useful Skill\n---\nbody`);
    expect(missingName).toMatchObject({
      ok: false,
      error: { code: 'REQUIRED', fieldPath: 'SKILL.md.frontmatter.name' },
    });

    const missingDescription = parseAgentSkillMarkdown(`---\nname: useful-skill\n---\nbody`);
    expect(missingDescription).toMatchObject({
      ok: false,
      error: { code: 'REQUIRED', fieldPath: 'SKILL.md.frontmatter.description' },
    });
  });

  it('classifies nested reference, asset and script directories consistently', () => {
    const result = scanAgentSkillFiles([
      sourceFile('SKILL.md', standardSkill),
      sourceFile('references/layout/layers.md', 'Nested reference'),
      sourceFile('assets/examples/dark/preview.webp', null),
      sourceFile('scripts/checks/validate.sh', '#!/bin/sh\nexit 0'),
      sourceFile('tools/helper.py', 'print("helper")'),
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files.find((file) => file.relativePath === 'references/layout/layers.md')?.fileKind).toBe('reference');
    expect(result.data.files.find((file) => file.relativePath === 'assets/examples/dark/preview.webp')?.fileKind).toBe('asset');
    expect(result.data.files.find((file) => file.relativePath === 'scripts/checks/validate.sh')?.fileKind).toBe('script');
    expect(result.data.files.find((file) => file.relativePath === 'tools/helper.py')?.fileKind).toBe('script');
  });

  it('retains unknown frontmatter as inert declarations and never grants tools or permissions', () => {
    const markdown = `---
name: declared-capabilities
description: Unknown fields remain inspectable but inert.
allowed-tools:
  - shell
permissions:
  network: true
metadata:
  category: diagram
---
Body
`;
    const result = scanAgentSkillFiles([sourceFile('SKILL.md', markdown)]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.metadata).toMatchObject({
      declaredFrontmatter: {
        'allowed-tools': ['shell'],
        permissions: { network: true },
        metadata: { category: 'diagram' },
      },
      unknownFrontmatterFields: ['allowed-tools', 'metadata', 'permissions'],
      safety: { metadataAuthority: 'none', scriptsExecutable: false },
    });
    expect(result.data.files.every((file) => file.executionPolicy === 'never')).toBe(true);
    expect(result.data.metadata).not.toHaveProperty('permissions');
  });

  it('rejects aliases, duplicate paths and unsafe relative paths', () => {
    const alias = parseAgentSkillMarkdown(`---
name: alias-skill
description: &description Unsafe alias
metadata:
  copied: *description
---
Body
`);
    expect(alias).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });

    const duplicate = scanAgentSkillFiles([
      sourceFile('SKILL.md', standardSkill),
      sourceFile('SKILL.md', standardSkill),
    ]);
    expect(duplicate).toMatchObject({ ok: false, error: { code: 'DUPLICATE_KEY' } });

    const traversal = scanAgentSkillFiles([
      sourceFile('SKILL.md', standardSkill),
      sourceFile('../outside.md', 'outside'),
    ]);
    expect(traversal).toMatchObject({ ok: false, error: { code: 'INVALID_TYPE' } });
  });
});
