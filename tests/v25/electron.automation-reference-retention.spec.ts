import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { aiProviderSchema } from '@musefold/contracts';
import { type ElectronApplication, expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { desktopDbPath, launchV25App, v25ShellPage } from './electron-helpers';
import { localInvoke } from './local-execution-fixture';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('actual Automation reference survives output purge, service disable and a new Electron PID', async () => {
  test.setTimeout(90000);
  let sends = 0;
  const bodies: Buffer[] = [];
  const provider = createServer(async (request, response) => {
    const parts: Buffer[] = [];
    for await (const part of request) parts.push(Buffer.from(part));
    if (request.method !== 'POST' || request.url !== '/v1/images/edits') {
      response.writeHead(404).end();
      return;
    }
    sends++;
    bodies.push(Buffer.concat(parts));
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  const address = provider.address();
  if (!address || typeof address === 'string') throw new Error('Missing owned server');
  let app: ElectronApplication | undefined;
  let root = '';
  const facts = () => {
    const db = new Database(desktopDbPath(root), { readonly: true });
    try {
      return {
        requests: db.prepare('SELECT * FROM automation_spend_requests ORDER BY id').all(),
        runs: db.prepare('SELECT id FROM generation_runs').all(),
        assets: db.prepare('SELECT media_path FROM generated_assets').all() as Array<{
          media_path: string;
        }>,
        queue: db.prepare('SELECT path,last_error FROM local_asset_cleanup').all(),
      };
    } finally {
      db.close();
    }
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const discovery = JSON.parse(readFileSync(join(root, 'automation.json'), 'utf8')) as {
      port: number;
      token: string;
    };
    return fetch(`http://127.0.0.1:${discovery.port}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${discovery.token}`, ...init.headers },
      signal: AbortSignal.timeout(15000),
    });
  };
  try {
    ({ app, userDataDir: root } = await launchV25App('musefold-owned-automation-reference-'));
    let page = await v25ShellPage(app);
    const connection = aiProviderSchema.parse(
      await localInvoke(page, 'aiProviders.create', {
        name: 'Owned reference',
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        model: 'fixture-image',
        apiKey: 'synthetic-owned-key',
        activate: true,
      }),
    );
    await expect.poll(() => existsSync(join(root, 'automation.json'))).toBe(true);
    const uploaded = await call('/v1/uploads', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: png,
    });
    expect(uploaded.status).toBe(201);
    const { image } = (await uploaded.json()) as { image: { path: string } };
    expect(readFileSync(image.path)).toEqual(png);
    const input = {
      prompt: 'Owned reference',
      providerId: connection.id,
      referenceImagePaths: [image.path],
      consent: 'interactive',
    };
    const submitted = await call('/v1/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'owned-reference-retention',
      },
      body: JSON.stringify(input),
    });
    expect(submitted.status).toBe(202);
    const job = (await submitted.json()) as { jobId: string };
    await expect
      .poll(async () => {
        const response = await call(`/v1/generations/${job.jobId}`);
        expect(response.ok).toBe(true);
        return ((await response.json()) as { status: string }).status;
      })
      .toBe('success');
    expect(sends).toBe(1);
    expect(bodies[0]?.includes(png)).toBe(true);
    const before = facts();
    expect(before.requests).toHaveLength(1);
    expect(before.assets).toHaveLength(1);
    await localInvoke(page, 'generation.remove', job.jobId);
    await localInvoke(page, 'generation.purge', job.jobId);
    expect(facts().runs).toEqual([]);
    expect(facts().assets).toEqual([]);
    expect(existsSync(before.assets[0]!.media_path)).toBe(false);
    await localInvoke(page, 'automation.setEnabled', { enabled: false });
    expect(existsSync(image.path)).toBe(true);
    expect(readFileSync(image.path)).toEqual(png);
    expect(facts().requests).toEqual(before.requests);
    expect(facts().queue).toEqual([
      expect.objectContaining({ path: realpathSync(image.path), last_error: 'referenced' }),
    ]);
    await localInvoke(page, 'automation.setEnabled', { enabled: true });
    const pid = app.process().pid;
    await app.close();
    app = undefined;
    ({ app } = await launchV25App('musefold-owned-automation-reference-', {
      reuseUserDataDir: root,
    }));
    expect(app.process().pid).not.toBe(pid);
    page = await v25ShellPage(app);
    expect(readFileSync(image.path)).toEqual(png);
    expect(facts().requests).toEqual(before.requests);
    const replay = await call('/v1/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'owned-reference-retention',
      },
      body: JSON.stringify(input),
    });
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as { jobId: string }).jobId).toBe(job.jobId);
    expect(sends).toBe(1);
    await test.info().attach('owned-reference-retention', {
      contentType: 'application/json',
      body: JSON.stringify({
        pid,
        newPid: app.process().pid,
        referenceSha256: createHash('sha256').update(readFileSync(image.path)).digest('hex'),
        sends,
        retainedRequests: facts().requests.length,
        purgedOutputs: before.assets.length,
      }),
    });
  } finally {
    await app?.close();
    provider.closeAllConnections();
    await new Promise<void>((done) => provider.close(() => done()));
    if (root) rmSync(root, { recursive: true, force: true });
  }
});
