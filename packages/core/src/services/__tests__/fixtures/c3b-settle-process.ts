import Database from 'better-sqlite3';
import { takeoverDesktopDatabase } from '@musefold/desktop-db';
import { registerManagedGenerationSchema } from '@musefold/desktop-contracts/managed-generation';
import {
  generationExecutionReceiptSchema,
  type GenerationExecutionReceipt,
} from '@musefold/contracts';
import { AutomationSpendRepository } from '../../../db/repositories/automation-spend';
import { ManagedExecutionRepository } from '../../../db/repositories/managed-execution';
import { EncryptedManagedAnchorFile } from '../../managed-execution-anchor-file';
import { ManagedExecutionGuard } from '../../managed-execution-guard';
import { ManagedGenerationLedger } from '../../managed-generation-ledger';
import { fixtureCipher } from './managed-anchor-cipher';

// C3-B 真实边界 fixture（路线图 §6.21）：真实 SQLite 文件 + 回环 HTTP + 真实子进程。
// 只做测试运输：不注入凭据、不调真实 Provider、不绕过持久包装。
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

function contextOf(command: ReturnType<typeof registerManagedGenerationSchema.parse>) {
  return {
    apiIssuer: command.binding.apiIssuer,
    principalId: command.binding.principalId,
    authEpoch: command.authEpoch,
  };
}

async function fetchReceipt(key: string): Promise<Response> {
  return fetch(`${baseUrl}/generations/receipts/by-key?key=${encodeURIComponent(key)}`, {
    redirect: 'error',
  });
}

const pause = async (detail: unknown) => {
  process.send?.({ type: 'paused', result: detail });
  await new Promise<void>((resolve) => process.once('message', () => resolve()));
};

try {
  const command =
    mode === 'foreign'
      ? registerManagedGenerationSchema.parse((raw as { command: unknown }).command)
      : registerManagedGenerationSchema.parse(raw);
  const context = contextOf(command);
  if (mode === 'submit-pause') {
    const { record } = await ledger.register(command);
    const submission = await ledger.claimSubmission(
      record.requestId,
      context,
      command.binding,
      'local-run',
      command.now,
    );
    const response = await fetch(`${baseUrl}/generations`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'idempotency-key': submission.remoteKey },
      body: JSON.stringify({ ...submission.frozenRequest, expectedBinding: submission.binding }),
    });
    if (response.status !== 201) throw new Error(`Unexpected fixture POST: ${response.status}`);
    const lookup = await fetchReceipt(submission.remoteKey);
    if (lookup.status !== 200) throw new Error(`Unexpected fixture GET: ${lookup.status}`);
    const receipt = generationExecutionReceiptSchema.parse(await lookup.json());
    // 结算落库前的真实边界：HTTP 已完成、applyReceipt 尚未提交。
    await pause({
      pid: process.pid,
      requestId: record.requestId,
      remoteKey: submission.remoteKey,
      receipt,
    });
    // 暂停期间的新预留：unknown 锁死自动预算，第二个请求必须逐次确认。
    const second = {
      ...command,
      callerKey: `second-${command.callerKey}`,
      executionId: `second-${command.executionId}`,
    };
    const reserved = await ledger.register(second);
    // 重复完成回调以并发送达（服务端重发形态）：同一回执只允许一次入账。
    const [firstApplied, duplicate] = await Promise.all([
      ledger.applyReceipt(record.requestId, context, receipt, command.now + 1),
      ledger.applyReceipt(record.requestId, context, receipt, command.now + 2),
    ]);
    process.send?.({
      type: 'result',
      result: {
        pid: process.pid,
        remoteKey: submission.remoteKey,
        firstApplied,
        duplicate,
        secondState: spend.get(reserved.record.requestId)?.state,
        request: spend.get(record.requestId),
        budget: spend.budget(command.now),
      },
    });
  } else if (mode === 'recover') {
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
        'local-retry',
        command.now,
      );
    } catch {
      sendRefused = true;
    }
    const response = await fetchReceipt(record.remoteKey);
    let applied = false;
    if (response.ok)
      applied = await ledger.applyReceipt(
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
        applied,
        request: spend.get(request.id),
        budget: spend.budget(command.now),
      },
    });
  } else if (mode === 'foreign') {
    const payload = raw as {
      command: unknown;
      receipt: GenerationExecutionReceipt;
      principalId: string;
    };
    const target = registerManagedGenerationSchema.parse(payload.command);
    const request = spend.findByKey(target.callerKey);
    if (!request) throw new Error('Missing fixture request');
    const foreign = { ...contextOf(target), principalId: payload.principalId };
    let code = '';
    try {
      await ledger.applyReceipt(request.id, foreign, payload.receipt, target.now);
    } catch (error) {
      code = String((error as { code?: string }).code ?? '');
    }
    process.send?.({
      type: 'result',
      result: {
        pid: process.pid,
        code,
        request: spend.get(request.id),
        budget: spend.budget(target.now),
      },
    });
  } else {
    throw new Error(`Unknown fixture mode: ${mode}`);
  }
} catch (error) {
  process.send?.({
    type: 'error',
    result: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  db.close();
  process.disconnect?.();
}
