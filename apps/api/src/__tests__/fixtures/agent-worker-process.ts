import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase } from '@musefold/db';
import { loadEnv } from '../../env.js';
import { S3DesignSchemeAssetStorage } from '../../modules/design-scheme-assets/storage.js';
import { GithubDesignSchemeSourceReader } from '../../modules/design-schemes/github-source-reader.js';
import { DesignSchemeSourcePreparationService } from '../../modules/design-schemes/source-preparation.js';
import { DesignSchemeAgentService } from '../../modules/design-scheme-agent/service.js';
import { startDesignSchemeAgentWorker } from '../../modules/design-scheme-agent/worker.js';

const database = createDatabase(process.env.DATABASE_URL ?? '');
const storage = new S3DesignSchemeAssetStorage(loadEnv(process.env));
const reader = new GithubDesignSchemeSourceReader({
  fetchImpl: (input, init) => {
    const url = new URL(String(input));
    const target = new URL(process.env.SOURCE_GITHUB_FIXTURE_URL ?? '');
    if (
      target.hostname !== '127.0.0.1' ||
      !['api.github.com', 'codeload.github.com'].includes(url.hostname)
    )
      throw new Error('Unexpected fixture URL');
    target.pathname = `/${url.hostname === 'codeload.github.com' ? 'archive' : 'api'}${url.pathname}`;
    return fetch(target, init);
  },
});
const service = new DesignSchemeAgentService(
  database.db,
  new DesignSchemeSourcePreparationService(database.db, storage, reader),
);
const runner = await startDesignSchemeAgentWorker(database.pool, service);
try {
  for (let i = 0; i < 200; i++) {
    const session = await service.get('agent-owner', process.argv[2]);
    if (!['queued', 'preparing'].includes(session.status)) {
      process.stdout.write(`AGENT_RESULT=${JSON.stringify({ pid: process.pid, session })}\n`);
      break;
    }
    if (i === 199) throw new Error('Agent process fixture timed out');
    await delay(50);
  }
} finally {
  await runner.stop();
  storage.destroy();
  await database.pool.end();
}
