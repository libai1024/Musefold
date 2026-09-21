import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { captureDatabaseAccess, closeDb, initDb } from '../index';

let root: string | null = null;

afterEach(() => {
  closeDb();
  if (root) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe('database initialization', () => {
  it('returns the existing connection when initialized twice', () => {
    root = mkdtempSync(join(tmpdir(), 'musefold-db-init-'));
    configureTestCoreRuntime(root);

    const first = initDb();
    const second = initDb();

    expect(second).toBe(first);
    expect(first.open).toBe(true);
  });

  it('invalidates an asynchronous operation token when the database connection changes', () => {
    root = mkdtempSync(join(tmpdir(), 'musefold-db-epoch-'));
    configureTestCoreRuntime(root);
    initDb();
    const assertCurrent = captureDatabaseAccess();
    assertCurrent();
    closeDb();
    initDb();
    expect(() => assertCurrent()).toThrow('数据库生命周期已变化');
    expect(() => captureDatabaseAccess()()).not.toThrow();
  });
});
