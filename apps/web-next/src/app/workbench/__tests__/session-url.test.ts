import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkbenchHref,
  isAuthorizedWorkbenchSession,
  readWorkbenchSessionUrl,
  resolveWorkbenchSession,
  writeWorkbenchSessionUrl,
} from '../../../lib/workbench-session-url';

const sessions = [{ id: 'session-1' }, { id: 'session-2' }];

describe('Workbench session URL adapter', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/workbench?view=compact#composer');
  });

  it('reads the session parameter and validates authorized ids', () => {
    expect(readWorkbenchSessionUrl('?view=compact&session=session-2')).toEqual({
      hasParameter: true,
      sessionId: 'session-2',
    });
    expect(readWorkbenchSessionUrl('?session=%20')).toEqual({
      hasParameter: true,
      sessionId: null,
    });
    expect(isAuthorizedWorkbenchSession('session-2', sessions)).toBe(true);
    expect(isAuthorizedWorkbenchSession('other-user-session', sessions)).toBe(false);
  });

  it('resolves a valid target or newest-session fallback', () => {
    expect(
      resolveWorkbenchSession({ hasParameter: true, sessionId: 'session-2' }, sessions),
    ).toEqual({
      kind: 'session',
      sessionId: 'session-2',
    });
    expect(resolveWorkbenchSession({ hasParameter: false, sessionId: null }, sessions)).toEqual({
      kind: 'fallback',
      sessionId: 'session-1',
    });
    expect(resolveWorkbenchSession({ hasParameter: true, sessionId: 'stale' }, [])).toEqual({
      kind: 'fallback',
      sessionId: null,
    });
  });

  it('preserves unrelated query parameters and hash when entering Workbench', () => {
    expect(
      createWorkbenchHref('session-2', 'https://musefold.test/history?filter=failed#row'),
    ).toBe('/workbench?filter=failed&session=session-2#row');
    expect(
      createWorkbenchHref(null, 'https://musefold.test/prompts?tag=ink&session=stale#editor'),
    ).toBe('/workbench?tag=ink#editor');
  });

  it('pushes or replaces only the session pointer on Workbench', () => {
    const pushState = vi.spyOn(window.history, 'pushState');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    writeWorkbenchSessionUrl('session-1', 'push');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/workbench?view=compact&session=session-1#composer',
    );
    expect(pushState).toHaveBeenCalledTimes(1);

    writeWorkbenchSessionUrl(null, 'replace');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/workbench?view=compact#composer',
    );
    expect(replaceState).toHaveBeenCalledTimes(1);

    writeWorkbenchSessionUrl(null, 'replace');
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });
});
