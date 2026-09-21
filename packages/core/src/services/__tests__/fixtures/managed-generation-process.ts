import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { registerManagedGenerationSchema } from '@musefold/desktop-contracts/managed-generation';
import { generationExecutionReceiptSchema } from '@musefold/contracts';
import { AutomationSpendRepository } from '../../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../../db/repositories/managed-execution';
import { EncryptedManagedAnchorFile } from '../../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../../managed-execution-guard';
import { ManagedGenerationLedger } from '../../managed-generation-ledger';
import { fixtureCipher } from './managed-anchor-cipher';

// Test transport only. No real credentials, no provider calls, and no production enable entry.
const [dbPath, anchorPath, baseUrl, mode] = process.argv.slice(2);
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
const spend = new AutomationSpendRepository(db);
const guard = new ManagedExecutionGuard(
  new ManagedExecutionRepository(db),
  new EncryptedManagedAnchorFile(anchorPath, fixtureCipher),
);
const ledger = new ManagedGenerationLedger(db, guard, () => {});
process.send?.({ type: 'ready' });
const raw = await new Promise((resolve) => process.once('message', resolve));
try {
  const command = registerManagedGenerationSchema.parse(raw);
  if (mode === 'api') {
    takeoverDesktopDatabase(db);
    spend.initializeBudget(
      { monthlyLimitPoints: 10, usedPoints: 0, month: '2026-09' },
      command.now,
    );
    await guard.enable();
  }
  const context = {
    apiIssuer: command.binding.apiIssuer,
    principalId: command.binding.principalId,
    authEpoch: command.authEpoch,
  };
  const pause = async () => {
    process.send?.({ type: 'paused', result: { pid: process.pid } });
    await new Promise<void>((resolve) => process.once('message', () => resolve()));
  };
  if (mode === 'recover') {
    await guard.recoverCommittedOperation();
    const request = spend.findByKey(command.callerKey);
    if (!request) throw new Error('Missing fixture request');
    const record = ledger.forQuery(request.id, context);
    let sendRefused = false;
    try {
      await ledger.claimSubmission(
        request.id,
        context,
        command.binding,
        'local-result',
        command.now,
      );
    } catch {
      sendRefused = true;
    }
    const response = await fetch(
      `${baseUrl}/generations/receipts/by-key?key=${encodeURIComponent(record.remoteKey)}`,
      { redirect: 'error' },
    );
    if (response.ok)
      await ledger.applyReceipt(
        request.id,
        context,
        generationExecutionReceiptSchema.parse(await response.json()),
        command.now,
      );
    else if (response.status !== 404) throw new Error(`Unexpected fixture GET: ${response.status}`);
    process.send?.({
      type: 'result',
      result: {
        pid: process.pid,
        key: record.remoteKey,
        status: response.status,
        sendRefused,
        record: ledger.forQuery(request.id, context),
        budget: spend.budget(command.now),
      },
    });
  } else {
    const { record } = await ledger.register(command);
    if (mode === 'registered') await pause();
    const submission = await ledger.claimSubmission(
      record.requestId,
      context,
      command.binding,
      'local-result',
      command.now,
    );
    if (mode === 'claimed') await pause();
    const response = await fetch(`${baseUrl}/generations`, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': submission.remoteKey,
      },
      body: JSON.stringify({ ...submission.frozenRequest, expectedBinding: submission.binding }),
    });
    if (response.status !== 201) throw new Error(`Unexpected fixture POST: ${response.status}`);
    await pause();
  }
} catch (error) {
  process.send?.({ type: 'error', result: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  db.close();
  process.disconnect?.();
}
