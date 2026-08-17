import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const section = readFileSync('src/features/settings/sections/AutomationSection.tsx', 'utf8');

describe('automation settings UI contract', () => {
  it('renders an unambiguous, theme-aware local control-plane switch', () => {
    expect(section).toContain('aria-label="启用本地控制面"');
    expect(section).toContain("status?.enabled ? 'border-accent bg-accent'");
    expect(section).toContain('absolute left-0.5 top-0.5');
    expect(section).not.toContain('--accent-solid');
  });

  it('shows the public Skill URL instead of installing a local copy', () => {
    expect(section).toContain('Musefold 自动化 Skill');
    expect(section).toContain('integration!.snippets.skillUrl');
    expect(section).toContain('复制网址');
    expect(section).not.toContain("runIntegration('install-skill-all')");
  });

  it('auto-detects and clearly displays CLI/PATH state', () => {
    expect(section).toContain('api.automation.integrationInfo()');
    expect(section).toContain("? '未安装'");
    expect(section).toContain("? '已安装（PATH 未生效）'");
    expect(section).toContain('已自动安装');
    expect(section).toContain('正式版会为当前用户自动安装，无需管理员权限');
  });

  it('explains native credential handoff and completion notifications', () => {
    expect(section).toContain('唤起原生账号或中转站表单');
    expect(section).toContain('凭据始终只在 Musefold 内输入');
    expect(section).toContain('等待生图完成通知');
  });
});
