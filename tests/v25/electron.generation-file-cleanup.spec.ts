import {
  chmodSync,
  existsSync,
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
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke as invoke } from './local-execution-fixture';

for (const cleanup of ['single', 'empty-trash'] as const) {
  test(`actual Electron ${cleanup} protects original/shared files and resumes a failed disk delete on startup`, async () => {
    test.skip(
      process.platform === 'win32',
      'This fault fixture requires POSIX directory write permissions; Windows needs its native ACL fixture.',
    );
    test.setTimeout(120000);
    let app: ElectronApplication | undefined;
    let root = '';
    let locked = '';
    const outside = mkdtempSync(join(tmpdir(), 'musefold-owned-original-'));
    try {
      const launched = await launchV25App('musefold-owned-file-cleanup-');
      app = launched.app;
      root = launched.userDataDir;
      await v25ShellPage(app);
      await app.close();
      app = undefined;
      const pictures = join(root, 'Pictures');
      locked = join(pictures, 'locked-owned-directory');
      mkdirSync(locked, { recursive: true });
      const pending = join(locked, 'pending.png');
      const shared = join(pictures, 'shared.png');
      const original = join(outside, 'original.png');
      const alias = join(pictures, 'outside-alias');
      for (const path of [pending, shared, original]) writeFileSync(path, 'owned original bytes');
      symlinkSync(outside, alias, 'junction');
      const seed = new Database(desktopDbPath(root));
      try {
        for (const [id, path, deleted] of [
          ['pending', pending, 1],
          ['shared-trash', shared, 1],
          ['shared-kept', shared, null],
          ['outside', original, 1],
          ['alias', join(alias, 'original.png'), 1],
        ] as const) {
          seed
            .prepare(`INSERT INTO generation_runs(id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,created_at,deleted_at)
            VALUES (?,'free_generation','owned','owned','Owned','Owned','{}','{}','success',?,?)`)
            .run(id, Date.now(), deleted);
          seed
            .prepare(
              "INSERT INTO generated_assets(id,run_id,position,status,media_path,created_at) VALUES (?,?,0,'available',?,?)",
            )
            .run(`asset-${id}`, id, path, Date.now());
        }
      } finally {
        seed.close();
      }
      chmodSync(locked, 0o555);
      app = (await launchV25App('musefold-owned-file-cleanup-', { reuseUserDataDir: root })).app;
      let page = await v25ShellPage(app);
      if (cleanup === 'single') {
        for (const id of ['pending', 'shared-trash', 'outside', 'alias'])
          await invoke(page, 'generation.purge', id);
      } else {
        expect(await invoke(page, 'generation.cleanup', { scope: 'empty-trash' })).toEqual({
          affected: 4,
        });
      }
      const read = new Database(desktopDbPath(root), { readonly: true });
      let before: unknown[];
      try {
        before = read
          .prepare(
            'SELECT path,state,attempt_count,last_error FROM local_asset_cleanup ORDER BY path',
          )
          .all();
        expect(before).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: realpathSync(pending),
              state: 'pending',
              attempt_count: 1,
              last_error: 'file_delete_failed',
            }),
            expect.objectContaining({
              path: realpathSync(shared),
              state: 'pending',
              last_error: 'referenced',
            }),
            expect.objectContaining({ state: 'blocked', last_error: 'unsafe_path' }),
          ]),
        );
        expect(read.prepare('SELECT id FROM generation_runs').all()).toEqual([
          { id: 'shared-kept' },
        ]);
      } finally {
        read.close();
      }
      expect(readFileSync(original, 'utf8')).toBe('owned original bytes');
      expect(readFileSync(shared, 'utf8')).toBe('owned original bytes');
      expect(existsSync(pending)).toBe(true);
      const oldPid = app.process().pid;
      await app.close();
      app = undefined;
      chmodSync(locked, 0o755);
      // Make the existing durable retry due; do not claim natural waiting of the backoff interval.
      const clock = new Database(desktopDbPath(root));
      try {
        clock
          .prepare("UPDATE local_asset_cleanup SET next_attempt_at=0 WHERE state='pending'")
          .run();
      } finally {
        clock.close();
      }
      app = (await launchV25App('musefold-owned-file-cleanup-', { reuseUserDataDir: root })).app;
      page = await v25ShellPage(app);
      expect(app.process().pid).not.toBe(oldPid);
      expect(existsSync(pending)).toBe(false);
      expect(readFileSync(original, 'utf8')).toBe('owned original bytes');
      expect(readFileSync(shared, 'utf8')).toBe('owned original bytes');
      const after = new Database(desktopDbPath(root), { readonly: true });
      try {
        expect(
          after
            .prepare('SELECT 1 FROM local_asset_cleanup WHERE path=?')
            .get(join(realpathSync(locked), 'pending.png')),
        ).toBeUndefined();
        expect(after.prepare('SELECT id FROM generated_assets').all()).toEqual([
          { id: 'asset-shared-kept' },
        ]);
      } finally {
        after.close();
      }
      expect(await invoke(page, 'generation.cleanup', { scope: 'empty-trash' })).toEqual({
        affected: 0,
      });
      await test.info().attach('owned-cleanup-counts', {
        body: JSON.stringify({
          cleanup,
          initialRuns: 5,
          purgedRuns: 4,
          retainedRuns: 1,
          failedDeleteRecovered: 1,
          sharedFilesPreserved: 1,
          outsideOriginalPreserved: true,
          newPid: app.process().pid,
          oldPid,
        }),
        contentType: 'application/json',
      });
    } finally {
      if (locked && existsSync(locked)) chmodSync(locked, 0o755);
      await app?.close();
      if (root) rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
}
