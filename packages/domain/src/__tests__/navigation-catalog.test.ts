import { describe, expect, it } from 'vitest';
import { createCapabilityManifest, getProductCapabilities } from '../capabilities';
import {
  PRODUCT_COMMAND_CATALOG,
  PRODUCT_NAV_CATALOG,
  PRODUCT_SHORTCUTS,
  matchProductModifierShortcut,
  productCommandCapabilityMap,
  productSidebarCapabilityMap,
  productViewTitle,
  shortcutDisplayKeys,
  visibleProductCommands,
  visibleProductNav,
} from '../navigation-catalog';

describe('product navigation catalog', () => {
  it('keeps host sidebar ids and order stable for current capability flags', () => {
    expect(
      visibleProductNav('desktop', getProductCapabilities('desktop')).map((item) => item.sidebarId),
    ).toEqual(['library', 'design-schemes', 'history']);
    const web = visibleProductNav('web', getProductCapabilities('web'));
    expect(web.map((item) => item.sidebarId)).toEqual(['prompts', 'history']);
    expect(web.map((item) => item.semanticId)).toEqual(['library', 'history']);
    expect(web.find((item) => item.sidebarId === 'settings')).toBeUndefined();
    expect(PRODUCT_NAV_CATALOG.map((item) => item.id)).toEqual([
      'library',
      'design-schemes',
      'history',
    ]);
  });

  it('hides desktop-only nav when the matching capability is off', () => {
    const closed = {
      ...getProductCapabilities('desktop'),
      designSchemes: false,
      localPrompts: false,
    };
    expect(visibleProductNav('desktop', closed).map((item) => item.sidebarId)).toEqual(['history']);
  });

  it('filters a v2 manifest by current rollout and signed-out availability', () => {
    expect(
      visibleProductNav('web', createCapabilityManifest({ surface: 'web' })).map(
        (item) => item.sidebarId,
      ),
    ).toEqual(['prompts', 'history']);
    expect(
      visibleProductNav(
        'web',
        createCapabilityManifest({
          surface: 'web',
          signedIn: false,
          online: false,
        }),
      ).map((item) => item.sidebarId),
    ).toEqual([]);
    expect(
      visibleProductNav(
        'web',
        createCapabilityManifest({
          surface: 'web',
          disabledFeatures: ['mcpConnections'],
        }),
      ).map((item) => item.sidebarId),
    ).toEqual(['prompts', 'history']);
    expect(
      visibleProductCommands(
        'desktop',
        createCapabilityManifest({
          surface: 'desktop',
          disabledFeatures: ['designSchemes', 'byokProviders', 'agent'],
        }),
      ).map((item) => item.id),
    ).toEqual([
      'act-new-conversation',
      'nav-library',
      'nav-history',
      'nav-settings',
      'act-theme',
      'act-sidebar',
    ]);
  });

  it('derives the desktop capability maps used by host entry gates', () => {
    expect(productSidebarCapabilityMap('desktop')).toEqual({
      library: 'localPrompts',
      'design-schemes': 'designSchemes',
      history: 'generationHistory',
    });
    expect(productCommandCapabilityMap('desktop')).toEqual({
      'nav-library': 'localPrompts',
      'nav-design-schemes': 'designSchemes',
      'nav-history': 'generationHistory',
      'act-import-skill': 'designSchemes',
      'act-providers': 'byokProviders',
      'act-ai-connections': 'agent',
    });
  });
});

describe('product command catalog', () => {
  it('lists desktop command ids in the palette order and keeps Skill/BYOK as desktop extras', () => {
    expect(
      visibleProductCommands('desktop', getProductCapabilities('desktop')).map((item) => item.id),
    ).toEqual([
      'act-new-conversation',
      'act-import-skill',
      'nav-library',
      'nav-design-schemes',
      'nav-history',
      'nav-settings',
      'act-providers',
      'act-ai-connections',
      'act-theme',
      'act-sidebar',
    ]);
    expect(PRODUCT_COMMAND_CATALOG.find((item) => item.id === 'nav-design-schemes')?.navigate).toBe(
      'design-schemes',
    );
    expect(
      PRODUCT_COMMAND_CATALOG.find((item) => item.id === 'act-providers')?.settingsSection,
    ).toBe('providers');
    expect(
      PRODUCT_COMMAND_CATALOG.find((item) => item.id === 'act-ai-connections')?.settingsSection,
    ).toBe('ai');
  });

  it('exposes the Web palette set without desktop-only commands or shortcuts claims', () => {
    expect(
      visibleProductCommands('web', getProductCapabilities('web')).map((item) => item.id),
    ).toEqual(['act-new-design', 'nav-library', 'nav-history', 'nav-settings']);
    const webNewDesign = PRODUCT_COMMAND_CATALOG.find((item) => item.id === 'act-new-design');
    expect(webNewDesign?.hosts).toEqual(['web']);
    // Web 不占用 ⌘N（浏览器保留新窗口），hint 不得声明快捷键。
    expect(webNewDesign?.hint).not.toContain('⌘');
    // 未登录只压掉带能力闸门的命令；新设计/设置与桌面同例不挂闸门。
    expect(
      visibleProductCommands(
        'web',
        createCapabilityManifest({ surface: 'web', signedIn: false }),
      ).map((item) => item.id),
    ).toEqual(['act-new-design', 'nav-settings']);
  });

  it('hides the Web library command behind cloudPrompts but keeps ungated commands visible', () => {
    const gated = {
      ...getProductCapabilities('web'),
      cloudPrompts: false,
    };
    expect(visibleProductCommands('web', gated).map((item) => item.id)).toEqual([
      'act-new-design',
      'nav-history',
      'nav-settings',
    ]);
  });

  it('omits gated commands when flags are off and leaves ungated actions visible', () => {
    const closed = {
      ...getProductCapabilities('desktop'),
      designSchemes: false,
      byokProviders: false,
      agent: false,
    };
    expect(visibleProductCommands('desktop', closed).map((item) => item.id)).toEqual([
      'act-new-conversation',
      'nav-library',
      'nav-history',
      'nav-settings',
      'act-theme',
      'act-sidebar',
    ]);
  });

  it('derives per-host command capability maps without cross-host leakage', () => {
    expect(productCommandCapabilityMap('web')).toEqual({
      'nav-library': 'cloudPrompts',
      'nav-history': 'generationHistory',
    });
  });
});

describe('product shortcuts', () => {
  it('renders the about-page key rows and matches ⌘K / ⌘N without Shift or Alt', () => {
    expect(PRODUCT_SHORTCUTS.map((item) => item.label)).toEqual([
      '命令面板',
      '新建',
      '搜索',
      '发送（生成）',
      '换行',
    ]);
    expect(shortcutDisplayKeys(PRODUCT_SHORTCUTS[0], '⌘')).toEqual(['⌘', 'K']);
    expect(shortcutDisplayKeys(PRODUCT_SHORTCUTS[4], '⌘')).toEqual(['Shift', 'Enter']);
    expect(
      matchProductModifierShortcut({
        key: 'k',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('command-palette');
    expect(
      matchProductModifierShortcut({
        key: 'n',
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      }),
    ).toBe('new-design');
    expect(
      matchProductModifierShortcut({
        key: 'k',
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false,
      }),
    ).toBeNull();
    expect(
      matchProductModifierShortcut({
        key: 'f',
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it('keeps host view titles unchanged', () => {
    expect(productViewTitle('prompts')).toBe('提示词库');
    expect(productViewTitle('generate')).toBe('新设计');
    expect(productViewTitle('connections')).toBe('已连接应用');
    expect(productViewTitle('web-settings')).toBe('设置');
  });
});
