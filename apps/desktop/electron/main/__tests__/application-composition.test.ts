import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const applicationSource = readFileSync(
  fileURLToPath(new URL('../application.ts', import.meta.url)),
  'utf8',
);

function statementIndex(statement: string): number {
  const index = applicationSource.indexOf(statement);
  expect(index, `missing application composition statement: ${statement}`).toBeGreaterThan(-1);
  return index;
}

describe('desktop application composition', () => {
  it('registers data and host channels before creating the main window', () => {
    const createWindow = statementIndex('  createMainWindow();');
    expect(statementIndex('  registerV25GatewayBridge();')).toBeLessThan(createWindow);
    expect(statementIndex('  registerDesignSchemePackageHostActions();')).toBeLessThan(
      createWindow,
    );
    expect(statementIndex('  registerWindowHandlers();')).toBeLessThan(createWindow);
  });

  it('closes admission, drains asynchronous work, and closes both databases in order', () => {
    const shutdown = applicationSource.slice(
      statementIndex('async function shutdownApplication()'),
    );
    const closeAdmission = shutdown.indexOf('closeApplicationAdmission();');
    const drain = shutdown.indexOf('drainDesignSchemeExecutions()');
    const waitRequests = shutdown.indexOf('waitForApplicationRequests()');
    const cleanupStaging = shutdown.indexOf("settleShutdownStep('design-scheme package staging'");
    const closeDesignScheme = shutdown.indexOf("settleShutdownStep('design-scheme database'");
    const closePrimary = shutdown.indexOf("settleShutdownStep('primary database'");
    const firstAwait = shutdown.indexOf('await ');

    expect(closeAdmission).toBeGreaterThan(-1);
    expect(closeAdmission).toBeLessThan(firstAwait);
    expect(drain).toBeGreaterThan(-1);
    expect(waitRequests).toBeGreaterThan(-1);
    expect(cleanupStaging).toBeGreaterThan(Math.max(drain, waitRequests));
    expect(closeDesignScheme).toBeGreaterThan(cleanupStaging);
    expect(closeDesignScheme).toBeLessThan(closePrimary);
    expect(shutdown).toContain('settleShutdownStep');
  });
});
