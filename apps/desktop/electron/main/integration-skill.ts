/** Canonical Skill content lives at website/Musefold/skills/musefold/SKILL.md. */
export function validateMusefoldSkill(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith("---\nname: musefold\n")) {
    throw new Error("Musefold Skill frontmatter 无效");
  }
  for (const required of [
    "musefold status --json",
    "musefold generate",
    "musefold skill run",
    "run_github_skill",
  ]) {
    if (!normalized.includes(required))
      throw new Error(`Musefold Skill 缺少必要契约：${required}`);
  }
  if (!/<!--\s*musefold-skill-version:\s*v\d+\.\d+\.\d+/.test(normalized)) {
    throw new Error('Musefold Skill 缺少版本标记');
  }
  if (!normalized.includes('references/compatibility.md')) {
    throw new Error('Musefold Skill 缺少向下兼容入口');
  }
  return normalized;
}
