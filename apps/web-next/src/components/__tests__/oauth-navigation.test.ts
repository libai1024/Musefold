import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigateOAuth } from '../oauth-page';

afterEach(() => vi.unstubAllGlobals());
describe('OAuth host navigation', () => {
  it.each([
    '/api/auth/oauth2/authorize?state=synthetic',
    'https://reader.example/callback?code=synthetic',
    'http://127.0.0.1:12345/callback',
    'com.example.reader:/callback',
  ])('opens supported provider response %s', (url) => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://musefold.example', assign } });
    navigateOAuth(url);
    expect(assign).toHaveBeenCalledWith(new URL(url, 'https://musefold.example').href);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/test',
    'vbscript:test',
    'about:blank',
    'blob:https://reader.example/test',
  ])('rejects executable or local response %s', (url) => {
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://musefold.example', assign } });
    expect(() => navigateOAuth(url)).toThrow('无法打开授权回调');
    expect(assign).not.toHaveBeenCalled();
  });
});
