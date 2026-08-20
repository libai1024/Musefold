import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from '../csp';

describe('main-process CSP', () => {
  it('uses a strict production policy while allowing generated media images', () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("img-src 'self' media: data: blob:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('connect-src \'self\' https:');
    // Production renderer must not reach the network. Do not pre-emptively
    // open http(s) or wildcards for the app:// origin switch.
    expect(csp).not.toMatch(/connect-src[^;]*(https?:|\*)/);
  });

  it('allows the exact Vite origin and websocket only in development', () => {
    const csp = buildContentSecurityPolicy('http://localhost:5173/path');
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173");
    expect(csp).toContain('ws://localhost:5173');
    expect(csp).toContain('ws://localhost:*');
    expect(csp).toContain("img-src 'self' media: data: blob:");
  });

  it('blocks plugins, forms, base rewriting and embedding in every environment', () => {
    for (const csp of [buildContentSecurityPolicy(), buildContentSecurityPolicy('http://127.0.0.1:5173')]) {
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    }
  });
});
