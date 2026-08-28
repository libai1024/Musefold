import { describe, expect, it } from 'vitest';
import { DESKTOP_CAPABILITIES, WEB_CAPABILITIES } from '../capabilities';
import { queryKeys } from '../query-keys';

describe('platform capabilities', () => {
  it('desktop and web hosts expose distinct capability sets', () => {
    expect(DESKTOP_CAPABILITIES.host).toBe('desktop');
    expect(DESKTOP_CAPABILITIES.canRevealLocalFile).toBe(true);
    expect(DESKTOP_CAPABILITIES.hasCloudSyncControls).toBe(true);
    expect(WEB_CAPABILITIES.host).toBe('web');
    expect(WEB_CAPABILITIES.canRevealLocalFile).toBe(false);
    expect(WEB_CAPABILITIES.hasLocalAutomation).toBe(false);
  });
});

describe('query keys', () => {
  it('produces stable hierarchical keys', () => {
    expect(queryKeys.settings.preferences()).toEqual(['settings', 'preferences']);
    expect(queryKeys.prompts.detail('p1')).toEqual(['prompts', 'detail', 'p1']);
    expect(queryKeys.generation.list({})).toEqual(['generation', 'list', {}]);
  });

  it('list keys embed the query object for cache partitioning', () => {
    const key = queryKeys.prompts.list({ q: 'cat' });
    expect(key[2]).toEqual({ q: 'cat' });
  });
});
