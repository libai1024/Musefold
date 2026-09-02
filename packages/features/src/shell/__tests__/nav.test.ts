import { describe, expect, it } from 'vitest';
import { getShellNavItems, SHELL_NAV_ITEMS } from '../nav';

const ids = (items: ReturnType<typeof getShellNavItems>) => items.map((item) => item.id);

describe('shell navigation catalog', () => {
  it('keeps unavailable optional domains out of the default catalog', () => {
    expect(ids(SHELL_NAV_ITEMS)).toEqual(['workbench', 'prompts', 'history', 'settings']);
  });

  it('adds Design Schemes in the v2.1 order only when the host capability is enabled', () => {
    expect(ids(getShellNavItems({ hasDesignSchemes: true }))).toEqual([
      'workbench',
      'prompts',
      'design-schemes',
      'history',
      'settings',
    ]);
  });

  it('uses the full v2.1 navigation labels', () => {
    expect(
      getShellNavItems({ hasDesignSchemes: true }).map((item) => [item.id, item.label]),
    ).toEqual([
      ['workbench', '工作台'],
      ['prompts', '提示词库'],
      ['design-schemes', '设计方案'],
      ['history', '生成历史'],
      ['settings', '设置'],
    ]);
  });
});
