import { serve } from '@hono/node-server';
import { createDatabase } from '@musefold/db';
import { createNewApiClient } from '@musefold/new-api-client';
import { createApp } from './app.js';
import { createAuth } from './auth/index.js';
import { loadEnv } from './env.js';
import { AccountService } from './modules/account/service.js';
import { S3AssetUrlSigner } from './modules/generation/s3-signer.js';
import { GenerationService } from './modules/generation/service.js';
import { SkillService } from './modules/mcp/skills.js';
import { PromptService } from './modules/prompts/service.js';
import { RateLimiter } from './modules/rate-limit/service.js';
import { SyncService } from './modules/sync/service.js';
import { WorkbenchService } from './modules/workbench/service.js';

const env = loadEnv();
const { db } = createDatabase(env.DATABASE_URL);

const newApi = createNewApiClient(env.NEW_API_BASE_URL);
const account = new AccountService({
  db,
  newApi,
  encryptionKey: env.CREDENTIAL_ENCRYPTION_KEY,
});
const auth = createAuth({
  env,
  db,
  newApi,
  hooks: {
    onSessionEstablished: (input) => account.persistSessionCredentials(input),
  },
});

const prompts = new PromptService(db);
const sync = new SyncService(db, prompts);
const workbench = new WorkbenchService(db);
const generation = new GenerationService(db, new S3AssetUrlSigner(env));
const skills = new SkillService(db);
const rateLimiter = new RateLimiter(db, env.BETTER_AUTH_SECRET);

const app = createApp({
  env,
  db,
  auth,
  rateLimiter,
  services: { account, prompts, sync, workbench, generation, skills },
});

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`[api] listening on http://0.0.0.0:${info.port}`);
});
