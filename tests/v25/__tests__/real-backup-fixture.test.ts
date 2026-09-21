import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  copyLegacyMedia,
  createRealBackupFixture,
  snapshotBackup,
  validateBackupSource,
  validateMediaSource,
  verifyOriginalRows,
} from '../real-backup-fixture';

let root: string;
let backup: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'musefold-backup-gate-unit-'));
  const backups = join(root, 'musefold-backups-v0.3.0');
  mkdirSync(backups);
  backup = join(backups, 'db-2026-09-19T10-51-32-115Z.db');
  const db = new Database(backup);
  db.exec(`CREATE TABLE prompts(id TEXT,title TEXT);
    CREATE TABLE generation_runs(id TEXT,status TEXT,actual_cost REAL);
    CREATE TABLE generated_assets(id TEXT,media_path TEXT);
    CREATE TABLE workbench_sessions(id TEXT,title TEXT);
    INSERT INTO prompts VALUES ('p','private fixture text');
    INSERT INTO generation_runs VALUES ('r','success',12.34);`);
  db.close();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('explicit real-backup gate safety', () => {
  it('detects broken FTS hits even when the original prompt rows are intact', () => {
    const db = new Database(backup);
    try {
      db.exec(`CREATE VIRTUAL TABLE prompts_fts USING fts5(title,tags_index);
        INSERT INTO prompts_fts(rowid,title,tags_index) VALUES(1,'private fixture text','private fixture text');`);
      const before = snapshotBackup(db);
      expect(before.searches).toHaveLength(3);
      verifyOriginalRows(db, before);
      db.exec('DELETE FROM prompts_fts');
      expect(() => verifyOriginalRows(db, before)).toThrow('Original FTS search hits changed');
    } finally {
      db.close();
    }
  });
  it('rejects active databases, symlinks and SQLite sidecars', () => {
    expect(validateBackupSource(backup)).toBe(realpathSync(backup));
    const active = join(root, 'musefold-data-v0.3.0.db');
    copyFileSync(backup, active);
    expect(() => validateBackupSource(active)).toThrow('dated application backup');
    const link = join(root, 'musefold-backups-v0.3.0', 'db-2026-09-18T10-51-32-115Z.db');
    symlinkSync(backup, link);
    expect(() => validateBackupSource(link)).toThrow('non-symlink');
    writeFileSync(`${backup}-wal`, 'not a frozen backup');
    expect(() => validateBackupSource(backup)).toThrow('sidecars');
  });

  it('fails on lost/changed original rows without reporting private field values', () => {
    const db = new Database(backup);
    try {
      const before = snapshotBackup(db);
      db.exec(
        "ALTER TABLE prompts ADD COLUMN version INTEGER DEFAULT 1; INSERT INTO prompts(id,title) VALUES('new','new content')",
      );
      expect(
        verifyOriginalRows(db, before).find((table) => table.table === 'prompts'),
      ).toMatchObject({ originalRows: 1, afterRows: 2, preserved: true });
      db.exec('UPDATE generation_runs SET actual_cost=0');
      expect(() => verifyOriginalRows(db, before)).toThrow('Original generation_runs row/column');
      db.exec("UPDATE generation_runs SET actual_cost=12.34; DELETE FROM prompts WHERE id='p'");
      try {
        verifyOriginalRows(db, before);
        throw new Error('expected rejection');
      } catch (error) {
        expect(String(error)).toContain('Original prompts row/column');
        expect(String(error)).not.toContain('private fixture text');
      }
    } finally {
      db.close();
    }
  });

  it('does not start paid recovery and leaves the original backup unchanged', () => {
    const original = readFileSync(backup);
    const fixture = createRealBackupFixture(backup);
    try {
      fixture.assertSourceUnchanged();
      expect(readFileSync(backup)).toEqual(original);
    } finally {
      fixture.remove();
    }
    const db = new Database(backup);
    db.exec("UPDATE generation_runs SET status='running'");
    db.close();
    expect(() => createRealBackupFixture(backup)).toThrow('in-flight generation');
  });

  it('rejects unapproved/symlinked media and copies bytes while changing only asset paths', () => {
    const images = join(root, 'authorized-images');
    mkdirSync(images);
    const image = join(images, 'original.png');
    writeFileSync(image, Buffer.from([1, 2, 3, 4]));
    const outside = join(root, 'unapproved.png');
    writeFileSync(outside, 'private');
    expect(() => validateMediaSource(outside, [images])).toThrow('authorized image roots');
    const link = join(images, 'link.png');
    symlinkSync(outside, link);
    expect(() => validateMediaSource(link, [images])).toThrow('non-symlink');
    const db = new Database(backup);
    db.prepare('INSERT INTO generated_assets VALUES (?,?)').run('a', image);
    db.close();
    const fixture = createRealBackupFixture(backup);
    try {
      const copied = copyLegacyMedia(fixture.dbPath, fixture.root, [images]);
      expect(copied.summary).toMatchObject({ assets: 1, uniqueFiles: 1, bytes: 4 });
      const first = copied.images[0];
      if (!first) throw new Error('Expected copied fixture image');
      expect(readFileSync(first.copied)).toEqual(readFileSync(image));
      copied.assertSourcesUnchanged();
      fixture.assertSourceUnchanged();
      const migrated = new Database(fixture.dbPath);
      try {
        expect(migrated.prepare('SELECT actual_cost FROM generation_runs').get()).toEqual({
          actual_cost: 12.34,
        });
        expect(migrated.prepare('SELECT media_path FROM generated_assets').get()).toEqual({
          media_path: first.copied,
        });
      } finally {
        migrated.close();
      }
    } finally {
      fixture.remove();
    }
  });
});
