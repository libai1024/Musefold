import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ulid } from 'ulid';
import {
  apiErrorResponseSchema,
  syncMutationSchema,
  syncBootstrapPageSchema,
  syncDeviceSchema,
  syncPullResultSchema,
  syncPushResultSchema,
  syncUsagePushResultSchema,
  type SyncConflictResolution,
  type SyncPushRequest,
} from '@musefold/contracts';
import { configureCoreRuntime } from '../../../runtime';
import { closeDb, getDb } from '../../../db';
import { promptsRepo } from '../../../db/repositories/prompts';
import { ensureAccountWorkspace } from '../../../db/workspaces';
import { DesktopSyncEngine, type DesktopSyncTransport } from '../../engine';
import { DesktopSyncRepository } from '../../repository';

/** Test control protocol only. Business payloads/results retain their production types. */
export type ClientSetup = {
  directory: string;
  ownerId: string;
  deviceId: string;
  baseUrl: string;
  cookie: string;
};
export type ClientCommand =
  | { action: 'init'; setup: ClientSetup }
  | { action: 'sync' | 'snapshot' | 'close' | 'taxonomy' }
  | { action: 'fault'; offline?: boolean; dropNextPush?: boolean }
  | { action: 'create'; input: Parameters<typeof promptsRepo.create>[0] }
  | { action: 'update'; id: string; patch: Parameters<typeof promptsRepo.update>[1] }
  | { action: 'resolve'; id: string; resolution: SyncConflictResolution }
  | { action: 'push'; input: SyncPushRequest };

let setup: ClientSetup;
let repository: DesktopSyncRepository;
let engine: DesktopSyncEngine;
let workspace: string;
let offline = false;
let dropNextPush = false;
const trace: Array<{ method: string; path: string; status: number; mutations?: string[] }> = [];

async function request(path: string, body?: unknown): Promise<unknown> {
  if (offline)
    throw Object.assign(new Error('Synthetic network disconnected'), { code: 'OFFLINE' });
  const response = await fetch(`${setup.baseUrl}/api/v1/sync/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', cookie: setup.cookie },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  const value = await response.json();
  trace.push({
    method: body ? 'POST' : 'GET',
    path,
    status: response.status,
    ...(path === 'push'
      ? { mutations: (body as SyncPushRequest).mutations.map((m) => m.mutationId) }
      : {}),
  });
  if (!response.ok) {
    // Never propagate HTTP bodies/headers or credentials into parent logs.
    const parsed = apiErrorResponseSchema.safeParse(value);
    const code = parsed.success ? parsed.data.error.code : 'HTTP_ERROR';
    throw Object.assign(new Error(`Sync HTTP ${response.status}: ${code}`), { code });
  }
  if (path === 'push' && dropNextPush) {
    dropNextPush = false;
    // The real response has been fully received: its database commit is certain.
    // Suppress delivery to the production engine, as a lost response would.
    throw Object.assign(new Error('Synthetic response lost after server commit'), {
      code: 'RESPONSE_LOST',
    });
  }
  return value;
}

function query(value: object): string {
  return new URLSearchParams(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
}

const transport: DesktopSyncTransport = {
  registerDevice: async (input) => syncDeviceSchema.parse(await request('devices', input)),
  bootstrap: async (input) =>
    syncBootstrapPageSchema.parse(await request(`bootstrap?${query(input)}`)),
  pull: async (input) => syncPullResultSchema.parse(await request(`pull?${query(input)}`)),
  push: async (input) => syncPushResultSchema.parse(await request('push', input)),
  pushUsage: async (input) => syncUsagePushResultSchema.parse(await request('usage', input)),
};

function snapshot() {
  return {
    pid: process.pid,
    account: repository.getActiveAccount(),
    summary: repository.getSummary(),
    prompts: promptsRepo.list({}, workspace),
    ready: repository.listReadyMutations(setup.ownerId, workspace),
    outbox: (
      getDb()
        .prepare(
          'SELECT * FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ? ORDER BY created_at,mutation_id',
        )
        .all(setup.ownerId, workspace) as Record<string, unknown>[]
    ).map((row) =>
      syncMutationSchema.parse({
        mutationId: row.mutation_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        baseVersion: row.base_version,
        payload: JSON.parse(String(row.payload_json)),
      }),
    ),
    attempts: getDb()
      .prepare(
        'SELECT mutation_id,attempt_count,next_attempt_at FROM cloud_sync_outbox WHERE owner_id = ? AND workspace_id = ? ORDER BY mutation_id',
      )
      .all(setup.ownerId, workspace),
    conflicts: repository.listConflicts(setup.ownerId, workspace),
    trace: [...trace],
    integrity: getDb().pragma('integrity_check', { simple: true }),
    foreignKeys: getDb().pragma('foreign_key_check'),
  };
}
export type ClientSnapshot = ReturnType<typeof snapshot>;

async function handle(command: ClientCommand): Promise<unknown> {
  switch (command.action) {
    case 'init': {
      setup = command.setup;
      mkdirSync(setup.directory, { recursive: true });
      const paths = {
        userData: setup.directory,
        db: join(setup.directory, 'client.sqlite'),
        backups: join(setup.directory, 'backups'),
        previews: join(setup.directory, 'previews'),
        pictures: join(setup.directory, 'pictures'),
        logs: join(setup.directory, 'logs'),
      };
      const noop = () => {};
      configureCoreRuntime({
        getPaths: () => paths,
        loadApiKey: () => null,
        estimateProviderCost: () => null,
        createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
      });
      const db = getDb();
      workspace = ensureAccountWorkspace(db, setup.ownerId);
      repository = new DesktopSyncRepository(db);
      repository.activateAccount({
        ownerId: setup.ownerId,
        username: 'tester',
        deviceId: setup.deviceId,
        deviceName: 'Isolated sync fixture',
        platform: 'macos',
        clientVersion: 'test',
      });
      repository.setEnabled(setup.ownerId, true);
      engine = new DesktopSyncEngine(repository, transport, { bootstrapLimit: 1, pullLimit: 1 });
      return snapshot();
    }
    case 'sync':
      await engine.run();
      return snapshot();
    case 'snapshot':
      return snapshot();
    case 'create':
      return promptsRepo.create(command.input, workspace);
    case 'update':
      return promptsRepo.update(command.id, command.patch, workspace);
    case 'fault':
      offline = command.offline ?? offline;
      dropNextPush = command.dropNextPush ?? dropNextPush;
      return null;
    case 'push':
      return transport.push(command.input);
    case 'resolve':
      repository.resolveConflict(setup.ownerId, workspace, command.id, command.resolution);
      return snapshot();
    case 'taxonomy': {
      // Catalog CRUD is host-owned; seed local catalog rows only, then enqueue
      // through the production repository. Prompt edits use production CRUD.
      const db = getDb();
      const folder = ulid();
      const tag = ulid();
      db.transaction(() => {
        db.prepare('INSERT INTO folders (workspace_id,id,name,created_at) VALUES (?,?,?,?)').run(
          workspace,
          folder,
          `离线素材 ${folder}`,
          Date.now(),
        );
        db.prepare('INSERT INTO tags (workspace_id,id,name,created_at) VALUES (?,?,?,?)').run(
          workspace,
          tag,
          `同步标签 ${tag}`,
          Date.now(),
        );
        repository.enqueue(setup.ownerId, workspace, 'folder', folder, 'create');
        repository.enqueue(setup.ownerId, workspace, 'tag', tag, 'create');
      })();
      return { folder, tag };
    }
    case 'close':
      closeDb();
      return null;
  }
}

if (process.env.MUSEFOLD_TWO_DEVICE_FIXTURE !== '1' || !process.send) {
  throw new Error('Two-device fixture requires an isolated IPC test process');
}
let queue = Promise.resolve();
process.on('message', (message: { sequence: number; command: ClientCommand }) => {
  queue = queue.then(async () => {
    try {
      const result = await handle(message.command);
      process.send?.({ sequence: message.sequence, result }, () => {
        if (message.command.action === 'close') process.disconnect();
      });
    } catch (error) {
      process.send?.({
        sequence: message.sequence,
        error: error instanceof Error ? error.message : 'Fixture failure',
        code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      });
    }
  });
});
process.on('disconnect', () => {
  closeDb();
});
