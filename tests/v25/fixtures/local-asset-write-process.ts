import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { loadManagedFilesystem, type ManagedFilesystem } from '@musefold/managed-fs';
import { closeDb, getDb } from '../../../packages/core/src/db';
import { closeDesignSchemeDb } from '../../../packages/core/src/db/design-scheme';
import { configureTestCoreRuntime, testCorePaths } from '../../../packages/core/src/testing';
import { generate } from '../../../packages/core/src/services/generation';
import { drainLocalAssetCleanup } from '../../../packages/core/src/services/local-asset-cleanup';

// A separately compiled consumer of unchanged production services. Only native call
// boundaries are observed; SIGSTOP/SIGKILL and subsequent recovery use real processes.
const [mode, root, url, checkpoint] = process.argv.slice(2);
const native = loadManagedFilesystem(resolve('packages/managed-fs/build/Release/managed_fs.node'));
const filesystem = Object.fromEntries(
  Object.getOwnPropertyNames(native).map((name) => [name, Reflect.get(native, name)]),
) as unknown as ManagedFilesystem;
configureTestCoreRuntime(root, {
  managedFilesystem: () => filesystem,
  loadApiKey: () => 'synthetic-crash-key',
});
const file = join(testCorePaths(root).pictures, 'owned-crash.png');
function stop(stage: string) {
  const row = getDb().prepare('SELECT device,inode,state FROM local_asset_cleanup').get();
  fs.writeFileSync(
    join(root, 'checkpoint.json'),
    JSON.stringify({
      pid: process.pid,
      stage,
      row,
      exists: fs.existsSync(file),
      bytes: fs.existsSync(file) ? fs.statSync(file).size : null,
    }),
  );
  process.kill(process.pid, 'SIGSTOP');
  throw new Error('A stopped fixture must be killed, never resumed');
}
async function main() {
  if (mode === 'recover') {
    const db = getDb();
    const before = db.prepare('SELECT * FROM local_asset_cleanup').all();
    const due = (
      db.prepare('SELECT MAX(next_attempt_at) AS n FROM local_asset_cleanup').get() as { n: number }
    ).n;
    const counts = drainLocalAssetCleanup(Math.max(Date.now(), due));
    console.log(
      JSON.stringify({
        pid: process.pid,
        before,
        counts,
        after: db.prepare('SELECT device,inode,state,last_error FROM local_asset_cleanup').all(),
        exists: fs.existsSync(file),
        bytes: fs.existsSync(file) ? fs.statSync(file).size : null,
        assets: db.prepare('SELECT COUNT(*) AS n FROM generated_assets').get(),
        run: db.prepare("SELECT status FROM generation_runs WHERE id='owned-crash'").get(),
      }),
    );
    return;
  }
  assert.equal(mode, 'write');
  filesystem.openFile = (directory, name, access) => {
    if (access === 'create' && checkpoint === 'reserved') stop('reserved');
    const fd = native.openFile(directory, name, access);
    if (access === 'create' && checkpoint === 'empty') stop('empty');
    return fd;
  };
  filesystem.openRoot = (path, identity) => {
    // The writer reopens its root only after payload write + fsync, before publication.
    if (checkpoint === 'payload' && fs.existsSync(file) && fs.statSync(file).size > 0)
      stop('payload');
    return native.openRoot(path, identity);
  };
  getDb()
    .prepare(`INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at)
    VALUES ('owned','Owned','openai-compatible',?,'gpt-image-1',1,1,1,1)`)
    .run(url);
  await generate({
    jobId: 'owned-crash',
    providerId: 'owned',
    prompt: 'Owned fixture',
    size: '1024x1024',
    quality: 'medium',
    n: 1,
  });
  throw new Error('Generation returned without reaching its crash checkpoint');
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    closeDesignSchemeDb();
    closeDb();
  });
