import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';
import { closeDb, getDb, initDb } from '../../db';
import { createWorkbenchRepositories } from '../../db/repositories/workbench';
import { generate } from '../generation';

const directory = mkdtempSync(join(tmpdir(), 'musefold-legacy-owner-'));
let server: Server;
let calls = 0;
let keyReads = 0;
const bodies: Array<Record<string, unknown>> = [];
configureTestCoreRuntime(directory, {
  loadApiKey: () => {
    keyReads++;
    return 'synthetic-retained-key';
  },
});
beforeAll(async () => {
  initDb();
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    calls++;
    response
      .writeHead(402, { 'content-type': 'application/json' })
      .end(JSON.stringify({ error: { message: 'insufficient quota' } }));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const insert =
    getDb().prepare(`INSERT INTO providers(id,name,type,base_url,model,has_key,is_active,managed_by,created_at,updated_at)
    VALUES(?,?,'openai-compatible',?,'fixture-image',1,0,?,1,1)`);
  insert.run('legacy-account', 'Legacy account', `http://127.0.0.1:${address.port}/v1`, 'account');
  insert.run('byok', 'BYOK', `http://127.0.0.1:${address.port}/v1`, null);
});
afterAll(async () => {
  closeDb();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(directory, { recursive: true, force: true });
});
describe('common generation admission for legacy account keys', () => {
  it.each(['unknown', 'UNKNOWN', ' unknown '])(
    'rejects a local retry with missing model %j without key reads, HTTP or rewriting the original',
    async (model) => {
      const id = `missing-model-${model}`;
      const db = getDb();
      db.prepare(`INSERT INTO generation_runs
      (id,run_kind,provider_id,model,base_prompt,final_prompt,params_json,prompt_snapshot_json,status,actual_cost,created_at)
      VALUES (?,'free_generation','byok',?,'original','original',?,'{}','cancelled',3,1)`).run(
        id,
        model,
        JSON.stringify({ schemaVersion: 1, size: 'auto', quality: 'auto', n: 1 }),
      );
      const original = db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(id);
      const before = { calls, keyReads };
      const result = await generate(
        {
          jobId: `${id}-retry`,
          providerId: 'byok',
          model: 'caller-guessed-model',
          n: 1,
          prompt: 'changed',
          size: 'auto',
          quality: 'auto',
        },
        undefined,
        { retryOfRunId: id },
      );
      expect(result).toMatchObject({
        status: 'failed',
        error: { code: 'GENERATION_RETRY_MODEL_MISSING' },
      });
      expect({ calls, keyReads }).toEqual(before);
      expect(db.prepare('SELECT * FROM generation_runs WHERE id = ?').get(id)).toEqual(original);
      expect(createWorkbenchRepositories().runs.get(result.historyId)).toBeNull();
    },
  );

  it('leaves independently authorized remote retry transport responsible for its frozen request', async () => {
    let transported = 0;
    const before = { calls, keyReads };
    const result = await generate(
      {
        jobId: 'remote-evidence-retry',
        providerId: 'byok',
        model: 'trusted-remote-model',
        n: 1,
        prompt: 'remote input',
        size: 'auto',
        quality: 'auto',
      },
      undefined,
      {
        retryOfRunId: 'missing-model-unknown',
        transport: {
          providerId: 'byok',
          retryOfRunId: 'missing-model-unknown',
          assertCurrent() {},
          async generate() {
            transported++;
            return { historyId: 'remote-evidence-retry', status: 'cancelled' };
          },
        },
      },
    );
    expect(result.status).toBe('cancelled');
    expect(transported).toBe(1);
    expect({ calls, keyReads }).toEqual(before);
    expect(createWorkbenchRepositories().runs.get('missing-model-unknown')?.model).toBe('unknown');
  });
  it('rejects direct and retry callers before retained credentials can reach HTTP, even if the caller selects BYOK for a legacy parent', async () => {
    const before = calls;
    const parent = await generate({
      jobId: 'legacy-parent',
      providerId: 'legacy-account',
      prompt: 'frozen original',
      n: 1,
      size: 'auto',
      quality: 'auto',
    });
    expect(parent).toMatchObject({ status: 'failed', error: { code: 'PAYMENT_IDENTITY_UNBOUND' } });
    const child = await generate(
      {
        jobId: 'legacy-child',
        providerId: 'byok',
        prompt: 'changed caller prompt',
        n: 2,
        size: 'auto',
        quality: 'auto',
      },
      undefined,
      { retryOfRunId: parent.historyId },
    );
    expect(child).toMatchObject({ status: 'failed', error: { code: 'PAYMENT_IDENTITY_UNBOUND' } });
    expect(calls).toBe(before);
    for (const id of ['legacy-parent', 'legacy-child']) {
      const run = createWorkbenchRepositories().runs.get(id);
      expect(run).toMatchObject({
        status: 'failed',
        providerId: 'legacy-account',
        errorCode: 'PAYMENT_IDENTITY_UNBOUND',
      });
      expect(run?.startedAt).toBeNull();
      expect(
        getDb().prepare('SELECT COUNT(*) AS n FROM generated_assets WHERE run_id = ?').get(id),
      ).toEqual({ n: 0 });
    }
  });
  it('keeps independent BYOK dispatch and upstream error classification', async () => {
    const before = calls;
    const result = await generate({
      jobId: 'byok-attempt',
      providerId: 'byok',
      prompt: 'independent input',
      n: 1,
      size: 'auto',
      quality: 'auto',
    });
    expect(calls).toBe(before + 1);
    expect(result).toMatchObject({ status: 'failed', error: { code: 'NO_BALANCE' } });
  });
  it('freezes the resolved default model and replays it after connection edits', async () => {
    const original = await generate({
      jobId: 'byok-model-parent',
      providerId: 'byok',
      prompt: 'frozen model input',
      n: 2,
      size: '1024x1024',
      quality: 'high',
    });
    expect(original.status).toBe('failed');
    const originalBody = bodies.at(-1);
    expect(originalBody).toMatchObject({ model: 'fixture-image', n: 2 });
    expect(createWorkbenchRepositories().runs.get(original.historyId)?.model).toBe('fixture-image');
    getDb().prepare('UPDATE providers SET model = ? WHERE id = ?').run('changed-model', 'byok');
    try {
      const retried = await generate(
        {
          jobId: 'byok-model-child',
          providerId: 'legacy-account',
          model: 'caller-model',
          prompt: 'changed prompt',
          n: 1,
          size: 'auto',
          quality: 'auto',
        },
        undefined,
        { retryOfRunId: original.historyId },
      );
      expect(retried).toMatchObject({ status: 'failed', error: { code: 'NO_BALANCE' } });
      expect(bodies.at(-1)).toEqual(originalBody);
      expect(createWorkbenchRepositories().runs.get(retried.historyId)).toMatchObject({
        providerId: 'byok',
        model: 'fixture-image',
        parentRunId: original.historyId,
      });
    } finally {
      getDb().prepare('UPDATE providers SET model = ? WHERE id = ?').run('fixture-image', 'byok');
    }
  });
});
