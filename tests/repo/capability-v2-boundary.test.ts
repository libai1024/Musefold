import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../../tooling/aliases.mjs';

function source(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

describe('capability v2 host boundary', () => {
  const domain = source('packages/domain/src/capabilities.ts');
  const productNavigation = source('packages/product-ui/src/navigation/product-nav.tsx');
  const desktopAdapter = source('apps/desktop/src/runtime/capabilities.ts');
  const webAdapter = source('apps/web/src/runtime/capabilities.ts');
  const webApp = source('apps/web/src/App.tsx');

  it('keeps the manifest pure and platform-neutral', () => {
    expect(domain).toContain('productFeatures');
    expect(domain).toContain('hostFeatures');
    expect(domain).toContain('availability');
    expect(domain).not.toMatch(/\bwindow\b|\bnavigator\b|\belectron\b|window\.api/);
  });

  it('keeps host adapters out of product-ui', () => {
    expect(productNavigation).not.toMatch(/runtime\/capabilities|window\.api|navigator\.onLine/);
    expect(desktopAdapter).toContain("createCapabilityManifest({ surface: 'desktop'");
    expect(webAdapter).toContain("createCapabilityManifest({ surface: 'web'");
  });

  it('derives Web availability from account and online runtime state', () => {
    expect(webApp).toContain('signedIn: Boolean(account) && !authRequired');
    expect(webApp).toContain('navigator.onLine');
    expect(webApp).toContain("window.addEventListener('offline'");
    expect(webApp).toContain('webCapabilitiesFromManifest');
    expect(webApp).not.toContain("getProductCapabilities('web')");
  });
});
