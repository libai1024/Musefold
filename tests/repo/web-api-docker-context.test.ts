import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dockerfile = readFileSync('infra/v1.1/Dockerfile', 'utf8');
const dockerignore = readFileSync('.dockerignore', 'utf8');

describe('Web API Docker build context', () => {
  it('copies the shared TypeScript base configuration used by web workspaces', () => {
    expect(dockerfile).toContain('COPY tooling ./tooling');
  });

  it('does not reference the retired shared directory', () => {
    expect(dockerfile).not.toMatch(/^COPY shared(?:\s|$)/m);
  });

  it('installs Web, API, and Worker workspaces and excludes the Desktop App graph', () => {
    expect(dockerfile).not.toContain('COPY apps ./apps');
    expect(dockerfile).toContain('COPY apps/web ./apps/web');
    expect(dockerfile).toContain('COPY apps/web-api ./apps/web-api');
    expect(dockerfile).toContain('COPY apps/generation-worker ./apps/generation-worker');
    expect(dockerfile).toContain('--workspace @musefold/web');
    expect(dockerfile).toContain('--workspace @musefold/web-api');
    expect(dockerfile).toContain('--workspace @musefold/generation-worker');
    expect(dockerfile).toContain('--include-workspace-root=false');
    expect(dockerignore).toMatch(/^apps\/desktop$/m);
    expect(dockerignore).not.toMatch(/^apps\/generation-worker$/m);
  });
});
