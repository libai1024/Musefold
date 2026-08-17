/** Canonical Skill content lives at website/Musefold/skills/musefold/SKILL.md. */
export function validateMusefoldSkill(content: string): string {
  if (!content.startsWith('---\nname: musefold\n')) {
    throw new Error('Musefold Skill frontmatter 无效');
  }
  for (const required of ['musefold status --json', 'musefold generate', 'musefold skill run', 'run_github_skill']) {
    if (!content.includes(required)) throw new Error(`Musefold Skill 缺少必要契约：${required}`);
  }
  return content;
}
