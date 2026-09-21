import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '../../db';
import { closeDesignSchemeDb, getDesignSchemeDb } from '../../db/design-scheme';
import { configureTestCoreRuntime, testCorePaths } from '../../testing';
import { purgeLocalDesignScheme, drainDesignSchemeAssetCleanup } from '../design-scheme-purge';
import { retainDesignSchemeOperation } from '../design-scheme-lifetime';
import { retainLocalAssetWrite } from '../local-asset-write-leases';
import { sweepDesignSchemeImportOrphans } from '../design-scheme-import-gc';

const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
let filesystem: ManagedFilesystem;
let root: string;
const now = Date.UTC(2026, 8, 19);
const importedRoot = `dsch_${'a'.repeat(32)}`;

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'musefold-scheme-purge-'));
  filesystem = Object.fromEntries(
    Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
  ) as unknown as ManagedFilesystem;
  configureTestCoreRuntime(root, { managedFilesystem: () => filesystem });
  fs.mkdirSync(testCorePaths(root).pictures, { recursive: true });
  fs.mkdirSync(testCorePaths(root).previews, { recursive: true });
  scheme('one');
});
afterEach(() => {
  vi.restoreAllMocks();
  closeDesignSchemeDb();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
function scheme(id: string) {
  const db = getDesignSchemeDb();
  db.prepare(`INSERT INTO design_schemes
    (id,name,status,source_presentation,current_revision_id,fidelity,created_at,updated_at,deleted_at,version)
    VALUES (?,?,'draft','musefold-created',?,'adapted',10,20,20,2)`).run(id, id, `revision-${id}`);
  db.prepare(`INSERT INTO design_scheme_revisions
    (revision_id,scheme_id,schema_version,document_json,created_by,created_at)
    VALUES (?,?,1,'{}','user',10)`).run(`revision-${id}`, id);
}
function file(name: string, bytes = name) {
  const path = join(root, 'design-scheme-imports', importedRoot, name);
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, bytes);
  return path;
}
function asset(id: string, path: string, schemeId = 'one') {
  getDesignSchemeDb()
    .prepare(`INSERT INTO design_scheme_assets(id,revision_id,store_key,role,origin,created_at)
    VALUES (?,?,?,'example','local-run',10)`)
    .run(id, `revision-${schemeId}`, path);
}
function run(status = 'completed', assetId = 'retained') {
  getDesignSchemeDb()
    .prepare(`INSERT INTO design_scheme_runs
    (run_id,revision_id,mode,status,policy_json,provider_json,created_at,completed_at)
    VALUES ('run','revision-one','trial',?,'{"cost":42}','{"model":"original"}',10,20)`)
    .run(status);
  getDesignSchemeDb()
    .prepare(`INSERT INTO design_scheme_run_steps(run_id,step_id,status,output_json)
    VALUES ('run','image','completed',?)`)
    .run(JSON.stringify({ assetId, historyId: 'history' }));
  getDesignSchemeDb().exec(`INSERT INTO design_scheme_evaluations
    (evaluation_id,run_id,passed,metrics_json,evidence_json,created_at)
    VALUES ('evaluation','run',1,'{"score":9}','["history"]',20)`);
}
function source(snapshotId: string, path: string, packageId = 'source-package') {
  const db = getDesignSchemeDb();
  db.prepare(
    `INSERT OR IGNORE INTO source_packages(id,kind,created_at) VALUES (?,'history',10)`,
  ).run(packageId);
  db.prepare(
    `INSERT INTO source_snapshots(id,package_id,ref,scan_json,created_at) VALUES (?,?,'ref','{}',10)`,
  ).run(snapshotId, packageId);
  db.prepare(`INSERT INTO source_files(snapshot_id,path,kind,content_hash,size_bytes,store_key)
    VALUES (?,'source.png','image','hash',1,?)`).run(snapshotId, path);
}
function bind(snapshotId: string, schemeId = 'one') {
  getDesignSchemeDb()
    .prepare(`INSERT INTO design_scheme_source_bindings VALUES (?,?,'reference')`)
    .run(`revision-${schemeId}`, snapshotId);
}
const purge = (schemeId = 'one', expectedVersion = 2) =>
  purgeLocalDesignScheme({ schemeId, expectedVersion }, { now });
const drain = (time = now) => drainDesignSchemeAssetCleanup({ now: time });
const queue = () =>
  getDesignSchemeDb().prepare('SELECT * FROM design_scheme_asset_cleanup ORDER BY path').all();
function frozenRequest(
  action: 'generate_image' | 'run_scheme',
  input: unknown,
  state = 'terminal',
) {
  getDb().exec(`INSERT OR IGNORE INTO automation_spend_policies VALUES ('local',100,1,10,10)`);
  getDb()
    .prepare(`INSERT INTO automation_spend_requests
    (id,scope_id,input_hash,action,caller,frozen_input_json,bindings_json,execution_id,max_image_calls,max_text_calls,state,budget_month,reservation_state,created_at)
    VALUES (?,'local','hash',?,'test',?,'[]',?,1,0,?,'2026-09','released',10)`)
    .run(action, action, JSON.stringify(input), action, state);
}

describe('transactional desktop scheme purge and actual native file deletion', () => {
  it('rejects live/stale/missing schemes, active persisted runs and in-flight operation holds', () => {
    expect(() => purge('missing')).toThrow('设计方案不存在');
    expect(() => purge('one', 1)).toThrow(/版本/);
    getDesignSchemeDb().exec("UPDATE design_schemes SET deleted_at=NULL WHERE id='one'");
    expect(() => purge()).toThrow(/已移除/);
    getDesignSchemeDb().exec("UPDATE design_schemes SET deleted_at=20 WHERE id='one'");
    const release = retainDesignSchemeOperation(getDesignSchemeDb(), 'one');
    expect(() => purge()).toThrow(/任务/);
    release();
    release();
    run('executing');
    expect(() => purge()).toThrow(/任务/);
    expect(queue()).toEqual([]);
    expect(
      getDesignSchemeDb().prepare('SELECT * FROM design_scheme_purge_identities').all(),
    ).toEqual([]);
  });

  it('blocks an unsettled durable R/S request, leaving its payer and frozen input untouched', () => {
    frozenRequest('run_scheme', { frozenRun: { source: { schemeId: 'one' } } }, 'running');
    const before = getDb().prepare('SELECT * FROM automation_spend_requests').all();
    expect(() => purge()).toThrow(/未结算/);
    expect(getDb().prepare('SELECT * FROM automation_spend_requests').all()).toEqual(before);
    getDb().exec(
      "UPDATE automation_spend_requests SET state='terminal',reservation_state='unknown'",
    );
    expect(() => purge()).toThrow(/未结算/);
    getDb().exec("UPDATE automation_spend_requests SET reservation_state='released'");
    expect(purge().purged).toBe(true);
  });

  it('removes the library graph but preserves legacy result bytes, shared assets, receipts and user exports', () => {
    const owned = file('owned.png'),
      retained = file('result.png'),
      shared = file('shared.png');
    asset('owned', owned);
    asset('retained', retained);
    asset('shared-one', shared);
    scheme('two');
    asset('shared-two', shared, 'two');
    run();
    const db = getDesignSchemeDb();
    const steps = db.prepare('SELECT * FROM design_scheme_run_steps').all();
    const evaluations = db.prepare('SELECT * FROM design_scheme_evaluations').all();
    const exported = join(root, 'user-chosen.musefold.design');
    fs.writeFileSync(exported, 'keep export');
    db.prepare('INSERT INTO share_packages VALUES (?,?,?,?,?)').run(
      'export',
      'one',
      '{}',
      exported,
      10,
    );
    const result = purge();
    expect(result).toEqual({ schemeId: 'one', purged: true, retiredKeys: 1, deferredKeys: 2 });
    expect(db.prepare("SELECT id FROM design_schemes WHERE id='one'").get()).toBeUndefined();
    expect(
      db.prepare("SELECT revision_id FROM design_scheme_revisions WHERE scheme_id='one'").all(),
    ).toEqual([]);
    expect(db.prepare('SELECT * FROM design_scheme_run_steps').all()).toEqual(steps);
    expect(db.prepare('SELECT * FROM design_scheme_evaluations').all()).toEqual(evaluations);
    expect(
      db
        .prepare(
          'SELECT revision_id,origin_scheme_id,origin_revision_id,policy_json FROM design_scheme_runs',
        )
        .get(),
    ).toEqual({
      revision_id: null,
      origin_scheme_id: 'one',
      origin_revision_id: 'revision-one',
      policy_json: '{"cost":42}',
    });
    expect(sweepDesignSchemeImportOrphans({ now }).reclaimed).toBe(0);
    expect(drain()).toMatchObject({ examined: 3, deleted: 1, protected: 2, failed: 0 });
    expect(fs.existsSync(owned)).toBe(false);
    expect(fs.readFileSync(retained, 'utf8')).toBe('result.png');
    expect(fs.readFileSync(shared, 'utf8')).toBe('shared.png');
    expect(fs.readFileSync(exported, 'utf8')).toBe('keep export');
    expect(purge()).toEqual(result);
    expect(() => purge('one', 3)).toThrow(/版本/);
    expect(() => asset('retained', shared, 'two')).toThrow('DESIGN_SCHEME_ASSET_RETAINED');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['generate_image', 'run_scheme'] as const)(
    'retains the original %s frozen references independently of the deleted scheme',
    (action) => {
      const path = file('frozen.png');
      asset('frozen', path);
      frozenRequest(
        action,
        action === 'generate_image'
          ? { references: [{ path }] }
          : { frozenRun: { params: { referenceImages: [{ path }] } } },
      );
      const before = getDb().prepare('SELECT * FROM automation_spend_requests').all();
      expect(purge()).toMatchObject({ retiredKeys: 0, deferredKeys: 1 });
      expect(drain()).toMatchObject({ protected: 1, deleted: 0 });
      expect(getDb().prepare('SELECT * FROM automation_spend_requests').all()).toEqual(before);
      expect(fs.readFileSync(path, 'utf8')).toBe('frozen.png');
    },
  );

  it('retains a result referenced by a run on a different revision or surviving scheme', () => {
    const path = file('cross-revision.png');
    asset('retained', path);
    run();
    scheme('two');
    const db = getDesignSchemeDb();
    db.exec("UPDATE design_scheme_runs SET revision_id='revision-two' WHERE run_id='run'");
    expect(purge()).toMatchObject({ retiredKeys: 0, deferredKeys: 1 });
    expect(drain()).toMatchObject({ protected: 1, deleted: 0 });
    expect(db.prepare('SELECT revision_id FROM design_scheme_runs').get()).toEqual({
      revision_id: 'revision-two',
    });
    expect(db.prepare('SELECT asset_id,run_id FROM design_scheme_retained_assets').all()).toEqual([
      { asset_id: 'retained', run_id: 'run' },
    ]);
    purge('two');
    expect(drain(now + 60_000)).toMatchObject({ protected: 1, deleted: 0 });
    expect(fs.readFileSync(path, 'utf8')).toBe('cross-revision.png');
  });

  it('only removes unbound source snapshots and removes their package after its last snapshot', () => {
    const exclusive = file('source-exclusive.png'),
      shared = file('source-shared.png');
    source('exclusive', exclusive);
    bind('exclusive');
    source('shared', shared);
    bind('shared');
    scheme('two');
    bind('shared', 'two');
    const db = getDesignSchemeDb();
    const sharedBefore = db.prepare("SELECT * FROM source_snapshots WHERE id='shared'").get();
    expect(purge()).toMatchObject({ retiredKeys: 1, deferredKeys: 0 });
    expect(drain()).toMatchObject({ deleted: 1, failed: 0 });
    expect(fs.existsSync(exclusive)).toBe(false);
    expect(fs.existsSync(shared)).toBe(true);
    expect(db.prepare('SELECT * FROM source_snapshots').all()).toEqual([sharedBefore]);
    expect(db.prepare('SELECT id FROM source_packages').all()).toEqual([{ id: 'source-package' }]);
    expect(purge('two')).toMatchObject({ retiredKeys: 1, deferredKeys: 0 });
    drain();
    expect(db.prepare('SELECT * FROM source_snapshots').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM source_packages').all()).toEqual([]);
    expect(fs.existsSync(shared)).toBe(false);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('deduplicates source and asset aliases and never deletes user-owned originals', () => {
    const path = file('dedup.png');
    asset('dedup', path);
    source('dedup', fs.realpathSync(path));
    bind('dedup');
    const external = join(root, 'user-original.png');
    fs.writeFileSync(external, 'original');
    source('external', external);
    bind('external');
    expect(purge()).toMatchObject({ retiredKeys: 2, deferredKeys: 0 });
    expect(queue()).toHaveLength(2);
    expect(drain()).toMatchObject({ deleted: 1, examined: 1 });
    expect(queue()).toEqual([
      expect.objectContaining({ path: external, state: 'blocked', last_error: 'unsafe_path' }),
    ]);
    expect(fs.readFileSync(external, 'utf8')).toBe('original');
  });

  it('drains a bounded batch and continues the remainder after reopening the databases', () => {
    for (let index = 0; index < 205; index++) asset(`batch-${index}`, file(`batch-${index}.png`));
    expect(purge()).toMatchObject({ retiredKeys: 205, deferredKeys: 0 });
    expect(drain()).toMatchObject({ examined: 100, deleted: 100 });
    closeDesignSchemeDb();
    closeDb();
    expect(drain()).toMatchObject({ examined: 100, deleted: 100 });
    expect(drain()).toMatchObject({ examined: 5, deleted: 5 });
    expect(queue()).toEqual([]);
    expect(fs.readdirSync(join(root, 'design-scheme-imports', importedRoot))).toEqual([]);
  });

  it('retains generated history and exact cost rows, regardless of history soft deletion', () => {
    const path = file('history.png');
    asset('history', path);
    getDb()
      .prepare(`INSERT INTO generation_runs
      (id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,actual_cost,created_at,deleted_at)
      VALUES ('history','free_generation','owned','owned','prompt','prompt','{}','{}','success',42,10,20)`)
      .run();
    getDb()
      .prepare(`INSERT INTO generated_assets(id,run_id,position,status,media_path,created_at)
      VALUES ('history-asset','history',0,'available',?,10)`)
      .run(path);
    const before = getDb().prepare('SELECT * FROM generation_runs').all();
    expect(purge()).toMatchObject({ retiredKeys: 0, deferredKeys: 1 });
    expect(drain().protected).toBe(1);
    expect(getDb().prepare('SELECT * FROM generation_runs').all()).toEqual(before);
    expect(fs.existsSync(path)).toBe(true);
  });

  it('rolls back all graph changes, identities and source removal when durable enqueue fails', () => {
    const path = file('atomic.png');
    asset('atomic', path);
    run('completed', 'atomic');
    source('atomic', file('atomic-source.png'));
    bind('atomic');
    const db = getDesignSchemeDb();
    const before = db.prepare('SELECT * FROM design_scheme_runs').all();
    const sourcesBefore = db.prepare('SELECT * FROM source_files').all();
    db.exec(
      "CREATE TRIGGER fail_scheme_outbox BEFORE INSERT ON design_scheme_asset_cleanup BEGIN SELECT RAISE(ABORT,'outbox failure'); END",
    );
    expect(() => purge()).toThrow('outbox failure');
    expect(db.prepare("SELECT id FROM design_schemes WHERE id='one'").get()).toEqual({ id: 'one' });
    expect(db.prepare('SELECT * FROM design_scheme_runs').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM design_scheme_purge_identities').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM design_scheme_retained_assets').all()).toEqual([]);
    expect(db.prepare('SELECT * FROM source_files').all()).toEqual(sourcesBefore);
    expect(queue()).toEqual([]);
    expect(fs.existsSync(path)).toBe(true);
  });

  it('preserves intent on native failure and retries after both databases reopen', () => {
    const path = file('retry.png');
    asset('retry', path);
    purge();
    vi.spyOn(filesystem, 'unlinkFile').mockImplementationOnce(() => {
      throw new Error('private path must not be logged');
    });
    expect(drain()).toMatchObject({ failed: 1, deleted: 0 });
    expect(JSON.stringify(queue())).not.toContain('private path');
    closeDesignSchemeDb();
    closeDb();
    expect(drain(now + 59_999).examined).toBe(0);
    expect(drain(now + 60_000)).toMatchObject({ deleted: 1, failed: 0 });
    expect(queue()).toEqual([]);
    expect(fs.existsSync(path)).toBe(false);
  });

  it('retains live upload ownership and the import directory until the final reference is released', () => {
    const path = file('held.png');
    asset('held', path);
    const release = retainLocalAssetWrite(getDb(), fs.realpathSync(path));
    try {
      expect(purge()).toMatchObject({ retiredKeys: 0, deferredKeys: 1 });
      expect(drain().protected).toBe(1);
      expect(sweepDesignSchemeImportOrphans({ now }).reclaimed).toBe(0);
      expect(fs.readFileSync(path, 'utf8')).toBe('held.png');
    } finally {
      release();
    }
    expect(drain(now + 60_000).deleted).toBe(1);
    expect(sweepDesignSchemeImportOrphans({ now: now + 60_000 }).reclaimed).toBe(1);
  });

  it('blocks replaced files and symlinked originals without deleting new bytes', () => {
    const path = file('replace.png');
    asset('replace', path);
    purge();
    fs.renameSync(path, `${path}.original`);
    fs.writeFileSync(path, 'replacement');
    expect(drain()).toMatchObject({ blocked: 1, deleted: 0 });
    expect(fs.readFileSync(path, 'utf8')).toBe('replacement');
    expect(fs.readFileSync(`${path}.original`, 'utf8')).toBe('replace.png');
    scheme('link');
    const original = join(root, 'original.png');
    fs.writeFileSync(original, 'external original');
    const link = join(dirname(path), 'link.png');
    fs.symlinkSync(original, link);
    asset('link', link, 'link');
    purge('link');
    drain(now + 60_000);
    expect(fs.readFileSync(original, 'utf8')).toBe('external original');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });
});
