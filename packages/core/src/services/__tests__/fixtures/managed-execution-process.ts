import Database from 'better-sqlite3';
import { ManagedExecutionRepository } from '../../../db/repositories/managed-execution';
import { AutomationSpendRepository } from '../../../db/repositories/automation-spend';
import { EncryptedManagedAnchorFile } from '../../managed-execution-anchor-file';
import {
  ManagedExecutionGuard,
  type ManagedExecutionAnchorPort,
} from '../../managed-execution-guard';
import { fixtureCipher } from './managed-anchor-cipher';

const [databasePath, anchorPath, action, providerUrl] = process.argv.slice(2);
const db = new Database(databasePath);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
const repository = new ManagedExecutionRepository(db);
const spend = new AutomationSpendRepository(db);
const file = new EncryptedManagedAnchorFile(anchorPath, fixtureCipher);
const pause = async () => {
  process.send?.({
    type: 'paused',
    result: { pid: process.pid, revision: repository.checkpoint()?.revision },
  });
  await new Promise<void>((resolve) => process.once('message', () => resolve()));
};
const port: ManagedExecutionAnchorPort = {
  scope: file.scope,
  read: () => file.read(),
  async write(value) {
    if (!value.pending && action === 'db-committed') await pause();
    await file.write(value);
    if (
      (value.pending && action === 'pending-durable') ||
      (!value.pending && action === 'anchor-committed')
    )
      await pause();
  },
};
const guard = new ManagedExecutionGuard(repository, port);
process.send?.({ type: 'ready' });
await new Promise<void>((resolve) => process.once('message', () => resolve()));
try {
  if (action === 'inspect') {
    const before = await guard.status();
    const repaired = await guard.recoverCommittedOperation();
    const after = await guard.status();
    let rejected = false;
    if (after.mode === 'query_only') {
      try {
        await guard.mutate('budget', {}, () => spend.setBudgetLimit(99, 3));
      } catch {
        rejected = true;
      }
    }
    process.send?.({
      type: 'result',
      result: {
        pid: process.pid,
        before,
        repaired,
        after,
        rejected,
        limit: spend.budget(3).monthlyLimitPoints,
      },
    });
  } else {
    await guard.mutate('budget', { limit: 4 }, () => spend.setBudgetLimit(4, 2));
    // Synthetic caller demonstrates the return boundary; it is not the desktop submission port.
    const response = await fetch(providerUrl, { method: 'POST', body: '{}' });
    await response.text();
    process.send?.({ type: 'result', result: { pid: process.pid } });
  }
} catch (error) {
  process.send?.({ type: 'error', result: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  db.close();
  process.disconnect?.();
}
