import { createHash } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import type { AccountSummary, DesktopSyncStatus, PromptDocument } from '@musefold/contracts';
import type { DesktopSyncAccount } from '../../packages/core/src/sync/repository';
import type { BridgeEnvelope } from '../../apps/desktop/electron/main/ipc-v25/envelope';
import { designSchemeDbPath, desktopDbPath } from './electron-helpers';
import type { DesktopSyncProcess } from './desktop-sync-process';

export async function invoke<T>(page: Page, method: string, payload?: unknown): Promise<T> {
  const result = await page.evaluate(
    async ({ method, payload }) => {
      return (
        window as unknown as {
          musefoldV25: {
            invoke(method: string, payload?: unknown): Promise<BridgeEnvelope<unknown>>;
          };
        }
      ).musefoldV25.invoke(method, payload);
    },
    { method, payload },
  );
  if (!result.ok) throw new Error(`IPC ${method}: ${result.code}`);
  return result.data as T;
}
export async function settings(page: Page, section: 'account' | 'sync') {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId(`settings-nav-${section}`).click();
}
export async function login(page: Page, username: 'b67-alice' | 'b67-bob') {
  await settings(page, 'account');
  if (await page.getByTestId('account-logout').isVisible()) {
    await page.getByTestId('account-logout').click();
    await page.getByTestId('account-logout-confirm').click();
  }
  await page.getByTestId('account-username').fill(username);
  await page.getByTestId('account-password').fill('fixture-password');
  await page.getByTestId('account-auth-submit').click();
  await expect(page.getByTestId('account-signed-in')).toBeVisible();
  const status = await invoke<AccountSummary>(page, 'account.getStatus');
  expect(status.username).toBe(username);
  if (!status.identity) throw new Error('Verified account identity missing');
  return createHash('sha256')
    .update(JSON.stringify(['principal', status.identity.apiIssuer, status.identity.principalId]))
    .digest('hex');
}
export async function emptyWorkspace(page: Page) {
  await settings(page, 'sync');
  await page.getByRole('button', { name: '建立空的提示词库', exact: true }).click();
  await page.getByRole('button', { name: '确认并在本机保存' }).click();
  await expect(page.getByTestId('sync-consent-enable')).toBeVisible();
}
export async function enable(page: Page) {
  await page.getByTestId('sync-consent-enable').click();
  await expect(page.getByTestId('sync-phase')).toHaveText('已是最新', { timeout: 15000 });
}
export async function sync(page: Page) {
  await invoke<DesktopSyncStatus>(page, 'sync.syncNow');
  await expect
    .poll(async () => (await invoke<DesktopSyncStatus>(page, 'sync.getStatus')).phase)
    .toBe('idle');
}
type AccountFacts = Pick<
  DesktopSyncAccount,
  'ownerId' | 'deviceId' | 'consent' | 'cursor' | 'bootstrapCompletedAt'
> & { active: number };
type PromptFacts = Pick<PromptDocument, 'id' | 'title' | 'content'> & { workspaceId: string };
export function localFacts(directory: string) {
  const db = new Database(desktopDbPath(directory), { readonly: true });
  try {
    return {
      accounts: db
        .prepare(
          `SELECT owner_id AS ownerId,device_id AS deviceId,consent_state AS consent,cursor,bootstrap_completed_at AS bootstrapCompletedAt,active FROM cloud_sync_accounts ORDER BY owner_id`,
        )
        .all() as AccountFacts[],
      prompts: db
        .prepare(
          'SELECT workspace_id AS workspaceId,id,title,content FROM prompts ORDER BY workspace_id,id',
        )
        .all() as PromptFacts[],
      outbox: db
        .prepare(
          'SELECT owner_id AS ownerId,mutation_id AS mutationId,entity_id AS entityId,payload_json AS payload FROM cloud_sync_outbox ORDER BY owner_id,mutation_id',
        )
        .all() as Array<{ ownerId: string; mutationId: string; entityId: string; payload: string }>,
      workspaces: db
        .prepare('SELECT id,owner_id AS ownerId,kind FROM local_workspaces ORDER BY id')
        .all() as Array<{ id: string; ownerId: string | null; kind: string }>,
      integrity: db.pragma('integrity_check', { simple: true }),
      foreignKeys: db.pragma('foreign_key_check'),
    };
  } finally {
    db.close();
  }
}
/** Logical full-table hash avoids treating SQLite page/WAL bookkeeping as a business mutation. */
export function schemeFacts(directory: string) {
  const db = new Database(designSchemeDbPath(directory), { readonly: true });
  try {
    const tables = [
      'source_packages',
      'source_snapshots',
      'design_schemes',
      'design_scheme_revisions',
      'design_scheme_source_bindings',
      'design_scheme_runs',
      'design_scheme_assets',
    ];
    const rows = Object.fromEntries(
      tables.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    );
    return {
      digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      counts: Object.fromEntries(
        Object.entries(rows).map(([name, values]) => [name, values.length]),
      ),
      integrity: db.pragma('integrity_check', { simple: true }),
    };
  } finally {
    db.close();
  }
}
export async function assertIsolatedCloud(service: DesktopSyncProcess) {
  const facts = await service.snapshot();
  expect(facts.counts).toEqual({ schemes: 0, generations: 0 });
  expect(facts.unknownUpstreamRequests).toBe(0);
  expect(facts.apiOutputSafe).toBe(true);
  return facts;
}
