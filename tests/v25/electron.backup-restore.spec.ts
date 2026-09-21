import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { launchV25App, v25ShellPage, desktopDbPath } from './electron-helpers';

function invoke(page: Page, method: string, payload?: unknown) {
  return page.evaluate(
    async ({ method, payload }) => {
      const host = window as unknown as {
        musefoldV25: {
          invoke(
            method: string,
            payload?: unknown,
          ): Promise<{ ok: boolean; data?: unknown; code?: string }>;
        };
      };
      return host.musefoldV25.invoke(method, payload);
    },
    { method, payload },
  );
}

async function seedManagedAnchor(app: ElectronApplication, userData: string) {
  const checkpoint = {
    lineageId: randomUUID(),
    namespace: randomUUID(),
    revision: 0,
    headHash: 'c'.repeat(64),
    lastOperationId: randomUUID(),
  };
  const db = new Database(desktopDbPath(userData));
  try {
    db.prepare(
      'INSERT INTO managed_execution_checkpoint(id,lineage_id,namespace,revision,head_hash,last_operation_id) VALUES(1,?,?,?,?,?)',
    ).run(
      checkpoint.lineageId,
      checkpoint.namespace,
      checkpoint.revision,
      checkpoint.headHash,
      checkpoint.lastOperationId,
    );
  } finally {
    db.close();
  }
  // Fixture initialization only. The real restore path consumes this through the production
  // safeStorage adapter; no enable-only test endpoint is added to the application.
  const anchor = { version: 1, committed: checkpoint, pending: null, mode: 'active', reason: null };
  const encoded = await app.evaluate(({ safeStorage }, plaintext) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Real safeStorage is required');
    return safeStorage.encryptString(plaintext).toString('base64');
  }, JSON.stringify(anchor));
  const bytes = Buffer.from(encoded, 'base64');
  expect(bytes.toString()).not.toContain(checkpoint.namespace);
  writeFileSync(join(userData, 'managed-execution.anchor'), bytes, { mode: 0o600 });
  return checkpoint;
}

async function readAnchor(app: ElectronApplication, userData: string) {
  const encoded = readFileSync(join(userData, 'managed-execution.anchor')).toString('base64');
  return app.evaluate(
    ({ safeStorage }, value) =>
      JSON.parse(safeStorage.decryptString(Buffer.from(value, 'base64'))) as {
        mode: string;
        reason: string | null;
      },
    encoded,
  );
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('正式 IPC 恢复保护独立密文锚、安全备份与旧进程访问，真实重启后不自动启用', async ({}, testInfo) => {
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-managed-restore-e2e-');
    app = first.app;
    userData = first.userDataDir;
    const page = await v25ShellPage(app);
    const backup = await invoke(page, 'system.createBackup');
    expect(backup.ok).toBe(true);
    const source = (backup.data as { backup: { file: string } }).backup.file;
    const checkpoint = await seedManagedAnchor(app, userData);
    const created = await invoke(page, 'workbench.createSession', { title: '恢复前当前内容' });
    expect(created.ok).toBe(true);
    const oldPid = app.process().pid;
    const result = await invoke(page, 'system.restoreBackup', { file: source });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ needsRestart: true });
    const safetyFile = (result.data as { safetyBackupFile: string }).safetyBackupFile;
    expect(safetyFile).toMatch(/^recovery-safety-/);
    expect(await readAnchor(app, userData)).toMatchObject({
      mode: 'query_only',
      reason: 'restore_pending',
      committed: checkpoint,
    });
    expect((await invoke(page, 'workbench.createSession', { title: '旧回调不得写入' })).ok).toBe(
      false,
    );
    const backups = await invoke(page, 'system.listBackups');
    expect(backups.ok).toBe(true);
    expect(JSON.stringify(backups)).toContain(safetyFile);
    expect(JSON.stringify(result)).not.toContain(userData);
    await app.close();
    app = undefined;

    const next = await launchV25App('unused-', { reuseUserDataDir: userData });
    app = next.app;
    await v25ShellPage(app);
    expect(app.process().pid).not.toBe(oldPid);
    expect(await readAnchor(app, userData)).toMatchObject({
      mode: 'query_only',
      reason: 'restore_pending',
      committed: checkpoint,
    });
    const db = new Database(desktopDbPath(userData), { readonly: true });
    try {
      expect(db.prepare('SELECT * FROM managed_execution_checkpoint').all()).toEqual([]);
      expect(
        db
          .prepare('SELECT title FROM workbench_sessions WHERE title IN (?,?)')
          .all('恢复前当前内容', '旧回调不得写入'),
      ).toEqual([]);
    } finally {
      db.close();
    }
    const backupDir = readdirSync(userData).find((name) => name.startsWith('musefold-backups-'));
    expect(backupDir).toBeTruthy();
    const safety = new Database(join(userData, backupDir ?? '', safetyFile), { readonly: true });
    try {
      expect(safety.prepare('SELECT namespace FROM managed_execution_checkpoint').get()).toEqual({
        namespace: checkpoint.namespace,
      });
      expect(
        safety.prepare('SELECT title FROM workbench_sessions WHERE title=?').get('恢复前当前内容'),
      ).toBeTruthy();
    } finally {
      safety.close();
    }
    await testInfo.attach('restore-evidence.json', {
      body: JSON.stringify(
        {
          oldPid,
          newPid: app.process().pid,
          safetyFile,
          anchor: 'restore_pending',
          checkpoint: 'absent after old backup restore',
          boundary:
            'Real Electron safeStorage/IPC/DB/restart. Synthetic initialized checkpoint; no managed generation or paid request.',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('损坏锚阻止正式恢复，错误不承诺数据未变且不泄漏路径', async ({}) => {
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-managed-corrupt-e2e-');
    app = first.app;
    userData = first.userDataDir;
    const page = await v25ShellPage(app);
    const backup = await invoke(page, 'system.createBackup');
    const file = (backup.data as { backup: { file: string } }).backup.file;
    await seedManagedAnchor(app, userData);
    writeFileSync(join(userData, 'managed-execution.anchor'), 'fixture broken ciphertext');
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('settings-nav-data').click();
    await page.getByTestId('settings-backup-toggle').click();
    await page.getByTestId(`settings-backup-restore-${file}`).click();
    await page.getByTestId('settings-backup-restore-confirm').click();
    await expect(page.getByTestId('settings-backup-restore-error')).toContainText(
      '恢复未完成,请重启应用并核对备份',
    );
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByTestId('settings-backup-restart')).toBeEnabled();
    await expect(page.getByTestId('settings-backup-create')).toBeDisabled();
    await expect(page.getByTestId(`settings-backup-restore-${file}`)).toBeDisabled();
    expect(await page.getByTestId('settings-backup-restore-error').innerText()).not.toContain(
      userData,
    );
    expect((await invoke(page, 'workbench.createSession', { title: '不得继续' })).ok).toBe(false);
    expect(readFileSync(join(userData, 'managed-execution.anchor'), 'utf8')).toBe(
      'fixture broken ciphertext',
    );
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    const next = await launchV25App('unused-', { reuseUserDataDir: userData });
    app = next.app;
    await v25ShellPage(app);
    expect(app.process().pid).not.toBe(oldPid);
    expect(readFileSync(join(userData, 'managed-execution.anchor'), 'utf8')).toBe(
      'fixture broken ciphertext',
    );
    const db = new Database(desktopDbPath(userData), { readonly: true });
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM managed_execution_checkpoint').get()).toEqual({
        n: 1,
      });
    } finally {
      db.close();
    }
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});

// biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured fixture argument.
test('托管预算正式 IPC 同步更新 SQLite 与系统密文锚，重启后不重复推进', async ({}, testInfo) => {
  let app: ElectronApplication | undefined;
  let userData = '';
  try {
    const first = await launchV25App('musefold-managed-budget-e2e-');
    app = first.app;
    userData = first.userDataDir;
    let page = await v25ShellPage(app);
    // Import existing policy before the explicit synthetic enable fixture; no test-only IPC.
    expect((await invoke(page, 'automation.getStatus')).ok).toBe(true);
    const initial = await seedManagedAnchor(app, userData);
    const updated = await invoke(page, 'automation.setMonthlyBudget', { points: 25 });
    expect(updated).toMatchObject({ ok: true, data: { monthlyBudgetPoints: 25 } });
    function readState() {
      const db = new Database(desktopDbPath(userData), { readonly: true });
      try {
        return {
          checkpoint: db
            .prepare(`SELECT lineage_id AS lineageId, namespace, revision,
            head_hash AS headHash, last_operation_id AS lastOperationId FROM managed_execution_checkpoint WHERE id=1`)
            .get(),
          policy: db
            .prepare('SELECT monthly_limit_points AS points FROM automation_spend_policies')
            .get(),
        };
      } finally {
        db.close();
      }
    }
    const committed = readState();
    expect(committed.policy).toEqual({ points: 25 });
    expect(committed.checkpoint).toMatchObject({
      lineageId: initial.lineageId,
      namespace: initial.namespace,
      revision: 1,
    });
    expect(await readAnchor(app, userData)).toMatchObject({
      mode: 'active',
      pending: null,
      committed: committed.checkpoint,
    });
    expect(readFileSync(join(userData, 'managed-execution.anchor')).toString()).not.toContain(
      initial.namespace,
    );
    const oldPid = app.process().pid;
    await app.close();
    app = undefined;
    const next = await launchV25App('unused-', { reuseUserDataDir: userData });
    app = next.app;
    page = await v25ShellPage(app);
    expect(app.process().pid).not.toBe(oldPid);
    expect((await invoke(page, 'automation.setMonthlyBudget', { points: 25 })).ok).toBe(true);
    expect(readState()).toEqual(committed);
    expect((await invoke(page, 'automation.setMonthlyBudget', { points: 0 })).ok).toBe(true);
    expect(readState().checkpoint).toMatchObject({ revision: 2, namespace: initial.namespace });
    expect(readState().policy).toEqual({ points: 0 });
    expect(await readAnchor(app, userData)).toMatchObject({
      mode: 'active',
      pending: null,
      committed: readState().checkpoint,
    });
    await testInfo.attach('managed-budget-evidence.json', {
      body: JSON.stringify({
        oldPid,
        newPid: app.process().pid,
        checkpointRevisions: [0, 1, 1, 2],
        boundary:
          'Real Electron IPC/SQLite/safeStorage/restart; synthetic initial checkpoint; no paid generation or user enable UI.',
      }),
      contentType: 'application/json',
    });
  } finally {
    await app?.close();
    if (userData) rmSync(userData, { recursive: true, force: true });
  }
});
