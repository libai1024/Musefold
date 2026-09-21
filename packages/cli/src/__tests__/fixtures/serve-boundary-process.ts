import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startHeadlessServe } from '../../serve-runtime';

// C3-C 历史升级边界 fixture（路线图 §6.21）：真实 serve 子进程（真实 PID、
// 真实 owner.lock/发现文件、真实 SQLite、回环 Provider），不 mock 生命周期。
const [dataDir, providerPort, mode] = process.argv.slice(2);
const providerBase = `http://127.0.0.1:${providerPort}/v1`;

function storeBudget(): unknown {
  try {
    const store = JSON.parse(
      readFileSync(join(dataDir, 'musefold-providers-v0.3.0.json'), 'utf8'),
    ) as { automation?: { budget?: unknown } };
    return store.automation?.budget ?? null;
  } catch {
    return null;
  }
}

async function startServe() {
  return startHeadlessServe({
    dataDir,
    port: 0,
    log: (line) => process.stderr.write(`${line}\n`),
  });
}

try {
  if (mode === 'serve') {
    const handle = await startServe();
    const { getDb } = await import('@musefold/core/db');
    getDb()
      .prepare(
        `INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,created_at,updated_at)
        VALUES('boundary','synthetic','openai-compatible',?,'fixture-model',1,1,1,1)`,
      )
      .run(providerBase);
    process.send?.({ type: 'ready', port: handle.port, token: handle.token });
    const instruction = await new Promise<{ type: string }>((resolve) =>
      process.once('message', resolve),
    );
    if (instruction.type === 'generate') {
      const response = await fetch(`http://127.0.0.1:${handle.port}/v1/generations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${handle.token}`,
          'content-type': 'application/json',
          'idempotency-key': 'c3c-upgrade-boundary',
        },
        body: JSON.stringify({
          providerId: 'boundary',
          prompt: 'synthetic boundary prompt',
          consent: 'interactive',
          n: 1,
        }),
      });
      const body = (await response.json()) as { jobId?: string; error?: unknown };
      process.send?.({
        type: 'submitted',
        status: response.status,
        jobId: body.jobId ?? null,
      });
      // 挂起等待父进程裁决：正常停止或 SIGKILL 都由父进程决定。
      await new Promise<void>(() => {});
    } else {
      await handle.stop();
      process.exit(0);
    }
  } else if (mode === 'restart') {
    const handle = await startServe();
    const { getDb } = await import('@musefold/core/db');
    const db = getDb();
    process.send?.({
      type: 'reported',
      port: handle.port,
      runs: db
        .prepare('SELECT id,status,error_code,actual_cost FROM generation_runs ORDER BY id')
        .all(),
      spendRequests: db.prepare('SELECT COUNT(*) AS n FROM automation_spend_requests').get(),
      budget: storeBudget(),
      discoveryPid: JSON.parse(readFileSync(join(dataDir, 'automation.json'), 'utf8')) as {
        pid: number;
      },
    });
    await new Promise<void>(() => {});
  } else {
    throw new Error(`Unknown mode: ${mode}`);
  }
} catch (error) {
  process.send?.({
    type: 'error',
    result: error instanceof Error ? `${error.message}` : String(error),
  });
  process.exitCode = 1;
}
