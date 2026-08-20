import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveAboutResourcePath } from '../about';

const environment = {
  packaged: false,
  appPath: join(process.cwd(), 'out', 'main'),
  resourcesPath: '/Applications/Musefold.app/Contents/Resources',
};

describe('about resources', () => {
  it('resolves development and packaged documentation paths', () => {
    expect(resolveAboutResourcePath('product-docs', environment))
      .toBe(join(process.cwd(), 'docs', 'product', 'README.md'));
    expect(resolveAboutResourcePath('product-docs', { ...environment, packaged: true }))
      .toBe(join(environment.resourcesPath, 'product-docs', 'README.md'));
  });

  it('rejects unknown resource ids instead of treating them as paths', () => {
    expect(() => resolveAboutResourcePath('../package.json' as 'product-docs', environment))
      .toThrow('ABOUT_RESOURCE_FORBIDDEN');
  });
});
