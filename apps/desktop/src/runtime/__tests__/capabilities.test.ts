import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getProductCapabilities } from '@musefold/domain';
import {
  COMMAND_ACTION_CAPABILITY,
  SETTINGS_SECTION_CAPABILITY,
  SIDEBAR_NAV_CAPABILITY,
  capabilities,
  isCapabilityEntryVisible,
} from '../capabilities';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('desktop capability entry mapping', () => {
  it('locks sidebar / settings / command-palette keys to capability flags', () => {
    expect(SIDEBAR_NAV_CAPABILITY).toEqual({
      library: 'localPrompts',
      'design-schemes': 'designSchemes',
      history: 'generationHistory',
    });
    expect(SETTINGS_SECTION_CAPABILITY).toEqual({
      connections: 'cloudMcpConnections',
      providers: 'byokProviders',
      ai: 'agent',
      automation: 'automation',
    });
    expect(COMMAND_ACTION_CAPABILITY).toEqual({
      'nav-library': 'localPrompts',
      'nav-design-schemes': 'designSchemes',
      'nav-history': 'generationHistory',
      'act-import-skill': 'designSchemes',
      'act-providers': 'byokProviders',
      'act-ai-connections': 'agent',
    });
  });

  it('reads the desktop host once and keeps mapped entries visible under current flags', () => {
    expect(capabilities).toBe(getProductCapabilities('desktop'));
    for (const [id, flag] of Object.entries(SIDEBAR_NAV_CAPABILITY)) {
      expect(isCapabilityEntryVisible(SIDEBAR_NAV_CAPABILITY, id)).toBe(capabilities[flag]);
      expect(capabilities[flag]).toBe(true);
    }
    for (const [key, flag] of Object.entries(SETTINGS_SECTION_CAPABILITY)) {
      expect(isCapabilityEntryVisible(SETTINGS_SECTION_CAPABILITY, key)).toBe(capabilities[flag]);
      expect(capabilities[flag]).toBe(true);
    }
    for (const [id, flag] of Object.entries(COMMAND_ACTION_CAPABILITY)) {
      expect(isCapabilityEntryVisible(COMMAND_ACTION_CAPABILITY, id)).toBe(capabilities[flag]);
      expect(capabilities[flag]).toBe(true);
    }
    expect(isCapabilityEntryVisible(SETTINGS_SECTION_CAPABILITY, 'account')).toBe(true);
    expect(isCapabilityEntryVisible(SETTINGS_SECTION_CAPABILITY, 'about')).toBe(true);
    expect(isCapabilityEntryVisible(COMMAND_ACTION_CAPABILITY, 'act-new-conversation')).toBe(true);
  });

  it('wires only the three entry surfaces through the shared desktop capabilities module', () => {
    const sidebar = source('apps/desktop/src/components/layout/Sidebar.tsx');
    const settingsView = source('apps/desktop/src/features/settings/components/SettingsView.tsx');
    const commandPalette = source('apps/desktop/src/components/command/CommandPalette.tsx');

    expect(sidebar).toContain('from "../../runtime/capabilities"');
    expect(sidebar).toContain('buildSidebarNavItems');
    expect(sidebar).toContain('capabilities');
    expect(sidebar).not.toContain("getProductCapabilities(");

    expect(settingsView).toContain("from '../../../runtime/capabilities'");
    expect(settingsView).toContain('SETTINGS_SECTION_CAPABILITY');
    expect(settingsView).toContain('isCapabilityEntryVisible');
    expect(settingsView).toContain("key: 'connections', label: '已连接应用'");
    expect(settingsView).not.toContain("getProductCapabilities(");

    expect(commandPalette).toContain("from '../../runtime/capabilities'");
    expect(commandPalette).toContain('visibleProductCommands');
    expect(commandPalette).toContain("from '@musefold/domain'");
    expect(commandPalette).toContain('runCommand');
    expect(commandPalette).toContain("go('generate')");
    expect(commandPalette).not.toContain("getProductCapabilities(");
  });
});
