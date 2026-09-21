import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// C3-C 行①：当前主进程（桌面壳与 headless serve）的单实例 / owner / initDb 顺序的
// 源码级静态断言。动态行为（双写者拒绝、接管）由 serve-upgrade-boundary.test.ts、
// singleton-lock.test.ts、headless-takeover.test.ts 覆盖；本文件钉住顺序不回退。

const applicationSource = readFileSync(
  fileURLToPath(new URL('../application.ts', import.meta.url)),
  'utf8',
);

const serveRuntimeSource = readFileSync(
  fileURLToPath(new URL('../../../../../packages/cli/src/serve-runtime.ts', import.meta.url)),
  'utf8',
);

function indexOf(source: string, statement: string, label: string): number {
  const index = source.indexOf(statement);
  expect(index, `missing statement (${label}): ${statement}`).toBeGreaterThan(-1);
  return index;
}

function appIndex(statement: string): number {
  return indexOf(applicationSource, statement, 'application.ts');
}

function serveIndex(statement: string): number {
  return indexOf(serveRuntimeSource, statement, 'serve-runtime.ts');
}

describe('C3-C upgrade boundary: startup and shutdown ordering', () => {
  it('desktop acquires singleton, owner lock, and core before opening the database', () => {
    const staleLock = appIndex("clearStaleSingletonLock(app.getPath('userData'));");
    const singleton = appIndex('const hasSingleInstanceLock = app.requestSingleInstanceLock();');
    const owner = appIndex(
      "await acquireDesktopOwnerLockWithHeadlessTakeover(app.getPath('userData'))",
    );
    const core = appIndex('initMusefoldCore();');
    const db = appIndex('initDb();');

    expect(staleLock).toBeLessThan(singleton);
    expect(singleton).toBeLessThan(owner);
    expect(owner).toBeLessThan(core);
    expect(core).toBeLessThan(db);
  });

  it('desktop releases the owner lock only after both databases are closed', () => {
    const designSchemeDb = appIndex("settleShutdownStep('design-scheme database'");
    const primaryDb = appIndex("settleShutdownStep('primary database'");
    const ownerLock = appIndex("settleShutdownStep('desktop owner lock'");

    expect(designSchemeDb).toBeLessThan(primaryDb);
    expect(primaryDb).toBeLessThan(ownerLock);
  });

  it('headless serve acquires the owner lock before initDb and releases it after closing both databases', () => {
    const filesystem = serveIndex('const filesystem = loadServeFilesystem();');
    const lock = serveIndex("const lock = acquireOwnerLock(dataDir, 'headless-daemon');");
    const db = serveIndex('initDb();');

    expect(filesystem).toBeLessThan(lock);
    expect(lock).toBeLessThan(db);

    const stop = serveRuntimeSource.slice(serveIndex('stop: () => {'));
    const closePrimary = stop.indexOf('closeDb();');
    const closeDesignScheme = stop.indexOf('closeDesignSchemeDb();');
    const release = stop.indexOf('lock.release?.();');
    expect(closePrimary, 'serve stop must close the primary database').toBeGreaterThan(-1);
    expect(closeDesignScheme, 'serve stop must close the design-scheme database').toBeGreaterThan(
      -1,
    );
    expect(release, 'serve stop must release the owner lock').toBeGreaterThan(-1);
    expect(closePrimary).toBeLessThan(closeDesignScheme);
    expect(closeDesignScheme).toBeLessThan(release);
  });
});
