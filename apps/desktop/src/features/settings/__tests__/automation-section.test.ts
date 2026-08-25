import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const section = readFileSync('apps/desktop/src/features/settings/components/AutomationSection.tsx', 'utf8');

describe('automation settings UI contract', () => {
  it('renders an unambiguous, theme-aware local control-plane switch', () => {
    // v1.4.1：开关统一走共享 SettingsSwitch 原语（role=switch + 主题 token 由原语保证）
    expect(section).toContain('<SettingsSwitch');
    expect(section).toContain("label={status?.enabled ? '关闭本地控制面' : '启用本地控制面'}");
    expect(section).not.toContain('--accent-solid');
  });

  it('shows versioned Skill install and update controls', () => {
    expect(section).toContain('Musefold 自动化 Skill');
    expect(section).toContain('integration!.snippets.skillUrl');
    expect(section).toContain("runIntegration('install-skill-all')");
    expect(section).toContain("runIntegration('check-skill-update')");
    expect(section).toContain('integration-skill-auto-update');
    expect(section).toContain('SHA-256');
    expect(section).toContain('旧版 App 缺少新接口时会降级');
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
    expect(section).toContain('凭据始终只在 Musefold');
    expect(section).toContain('等待生图完成通知');
  });
});
