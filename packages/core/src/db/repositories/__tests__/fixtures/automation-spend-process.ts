import Database from 'better-sqlite3';
import { AutomationSpendRepository } from '../../automation-spend';
import type {
  AutomationPayerBinding,
  RegisterAutomationSpend,
} from '@musefold/desktop-contracts/automation-spend';

const [databasePath, action, payloadJson] = process.argv.slice(2);
const payload = JSON.parse(payloadJson) as {
  command?: RegisterAutomationSpend;
  callId?: string;
  binding?: AutomationPayerBinding;
  providerUrl?: string;
  now: number;
};
const db = new Database(databasePath);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
const repository = new AutomationSpendRepository(db);
process.send?.({ type: 'ready' });
await new Promise<void>((resolve) => process.once('message', () => resolve()));

try {
  if (action === 'register') {
    if (!payload.command) throw new Error('Missing fixture command');
    process.send?.({ type: 'result', result: repository.register(payload.command) });
  } else {
    if (!payload.callId || !payload.binding) throw new Error('Missing fixture call');
    const claim = repository.claimCall(
      payload.callId,
      payload.binding,
      `fixture-process-${process.pid}`,
      payload.now,
    );
    if (action === 'claim') process.send?.({ type: 'result', result: claim });
    else {
      if (!claim) throw new Error('Fixture did not acquire the dispatch claim');
      if (action === 'sent-before-result') {
        if (!payload.providerUrl) throw new Error('Missing loopback fixture URL');
        await fetch(payload.providerUrl, {
          method: 'POST',
          body: JSON.stringify({ inputHash: claim.inputHash }),
        });
      }
      process.send?.({ type: 'marked', result: claim });
      // The test kills this real process at the chosen crash point.
      await new Promise<void>((resolve) => process.once('message', () => resolve()));
    }
  }
} catch (error) {
  process.send?.({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  db.close();
  process.disconnect?.();
}
