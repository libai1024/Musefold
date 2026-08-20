import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MUSEFOLD_SKILL_MANIFEST_URL,
  MUSEFOLD_SKILL_URL,
  MUSEFOLD_SKILL_VERSION,
} from '@musefold/domain/constants';
import { validateMusefoldSkill } from '../integration-skill';

const skill = validateMusefoldSkill(
  readFileSync('website/Musefold/skills/musefold/SKILL.md', 'utf8'),
);
const compatibility = readFileSync(
  'website/Musefold/skills/musefold/references/compatibility.md',
  'utf8',
);

describe('公开 Musefold Agent Skill', () => {
  it('uses a stable public URL and valid frontmatter', () => {
    expect(MUSEFOLD_SKILL_VERSION).toBe('v0.4.0');
    expect(MUSEFOLD_SKILL_URL).toBe(
      'https://raw.githubusercontent.com/libai1024/Musefold-Skills/v0.4.0/skills/musefold/SKILL.md',
    );
    expect(MUSEFOLD_SKILL_MANIFEST_URL).toContain('/main/manifest.json');
    expect(skill.startsWith('---\nname: musefold\n')).toBe(true);
    expect(skill).toContain('description: >-');
  });

  it('documents direct generation, reference images, and GitHub visual Skills', () => {
    expect(skill).toContain('musefold status --json');
    expect(skill).toContain('musefold generate -p');
    expect(skill).toContain('--ref "<local image path>"');
    expect(skill).toContain('musefold skill run');
    expect(skill).toContain('run_github_skill');
    expect(skill).toContain('no local reference-image path');
    expect(skill).toContain('references/compatibility.md');
    expect(skill).toContain('musefold-skill-version: v0.4.0');
  });

  it('keeps credentials native and spend actions explicit', () => {
    expect(skill).toContain('Credentials stay inside its native UI');
    expect(skill).toContain('explicitly request generation');
    expect(skill).toContain('do not retry a failed');
    expect(skill).not.toMatch(/mf_at_|sk-[A-Za-z0-9]{8}/);
  });

  it('degrades by detected capability for older Apps', () => {
    expect(skill).toContain('only Musefold tools that are actually present');
    expect(skill).toContain('legacy bare `cost` without `costUnit` has an unknown unit');
    expect(compatibility).toContain('Missing fields remain unknown');
    expect(compatibility).toContain('Do not automatically retry a spend call');
    expect(compatibility).toContain('Ask the user to configure it in the App UI');
  });
});
