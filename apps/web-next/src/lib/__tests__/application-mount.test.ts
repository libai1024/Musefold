import { afterEach, expect, it, vi } from 'vitest';
import { schemeAssetContentUrl } from '../scheme-asset-url';
import { createWorkbenchHref, writeWorkbenchSessionUrl } from '../workbench-session-url';

afterEach(() => vi.unstubAllEnvs());

it('keeps images and history navigation inside the application mount', () => {
  vi.stubEnv('NEXT_PUBLIC_APP_BASE_PATH', '/Musefold/v25');
  expect(schemeAssetContentUrl('asset-123')).toBe(
    '/Musefold/v25/api/v1/design-schemes/assets/asset-123/content',
  );
  expect(
    createWorkbenchHref('session-a', 'https://shared.test/Musefold/v25/workbench?tab=x#here'),
  ).toBe('/Musefold/v25/workbench?tab=x&session=session-a#here');
  window.history.replaceState(null, '', '/Musefold/v25/workbench');
  writeWorkbenchSessionUrl('session-b');
  expect(window.location.pathname).toBe('/Musefold/v25/workbench');
  expect(window.location.search).toBe('?session=session-b');
  window.history.replaceState(null, '', '/AnotherApp/workbench');
  writeWorkbenchSessionUrl('session-c');
  expect(window.location.pathname).toBe('/AnotherApp/workbench');
});
