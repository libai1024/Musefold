import { describe, expect, it } from 'vitest';
import config from '../../../next.config';

describe('production Web same-origin API routing', () => {
  it('forwards both MCP execution and OAuth discovery to the API host', async () => {
    const rewrites = await config.rewrites?.();
    expect(Array.isArray(rewrites)).toBe(true);
    if (!Array.isArray(rewrites)) throw new Error('Expected same-origin rewrite rules');
    const api = rewrites.find((rule) => rule.source === '/api/:path*');
    expect(api).toBeDefined();
    const upstream = api?.destination.replace(/\/api\/:path\*$/, '');
    expect(rewrites).toEqual(
      expect.arrayContaining([
        { source: '/mcp/:path*', destination: `${upstream}/mcp/:path*` },
        { source: '/.well-known/:path*', destination: `${upstream}/.well-known/:path*` },
      ]),
    );
    expect(config.output).toBe('standalone');
  });
});
