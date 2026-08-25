import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { closeDb, initDb } from '../index';

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
});
