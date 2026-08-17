import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MUSEFOLD_SKILL_URL, MUSEFOLD_SKILL_VERSION } from '@shared/constants';
import { validateMusefoldSkill } from '../integration-skill';

const skill = validateMusefoldSkill(
  readFileSync('website/Musefold/skills/musefold/SKILL.md', 'utf8'),
);

describe('公开 Musefold Agent Skill', () => {
  it('uses a stable public URL and valid frontmatter', () => {
    expect(MUSEFOLD_SKILL_VERSION).toBe('v0.3.0');
    expect(MUSEFOLD_SKILL_URL).toBe(
      'https://raw.githubusercontent.com/libai1024/Musefold-Skills/v0.3.0/skills/musefold/SKILL.md',
    );
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
  });

  it('keeps credentials native and spend actions explicit', () => {
    expect(skill).toContain('Credentials stay inside its native UI');
    expect(skill).toContain('explicitly request generation');
    expect(skill).toContain('do not retry a failed');
    expect(skill).not.toMatch(/mf_at_|sk-[A-Za-z0-9]{8}/);
  });
});
