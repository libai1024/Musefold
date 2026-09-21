#!/usr/bin/env node
/** Pure, non-publishing v2.5 release planner. Runtime approval is intentionally separate. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
const image = z
  .string()
  .regex(/^(?:sha256:[a-f0-9]{64}|[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64})$/)
  .refine((value) => !/v11|v1\.1/i.test(value));
const images = z.strictObject({ api: image, worker: image, web: image });
const envFile = z.string().regex(/^[a-z][a-z0-9-]*\.env$/);
const source = z.strictObject({ commit, treeSha256: digest, dirty: z.boolean() });
const releaseSchema = z.strictObject({
  formatVersion: z.literal(1),
  environment: z.enum(['staging', 'production']),
  project: z.string().regex(/^musefold-v25-(?:staging|production)(?:-[a-z0-9-]+)?$/),
  publicBaseUrl: z.string().url(),
  webPort: z.number().int().min(1024).max(65535),
  source,
  images,
  envFiles: z.strictObject({
    api: envFile,
    worker: envFile,
    schemeAgent: envFile,
    migration: envFile,
  }),
  previous: z.strictObject({ source, images }).optional(),
});

export function validateV25Release(input) {
  const result = releaseSchema.safeParse(input);
  if (!result.success) throw new Error('V25_RELEASE_INVALID');
  const release = result.data;
  const base = new URL(release.publicBaseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.pathname !== '/' && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\/?$/.test(base.pathname)) ||
    !['http:', 'https:'].includes(base.protocol)
  )
    throw new Error('V25_PUBLIC_ORIGIN_INVALID');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if (base.protocol !== 'https:' && (release.environment !== 'staging' || !loopback)) {
    throw new Error('V25_TLS_REQUIRED');
  }
  if (!release.project.startsWith(`musefold-v25-${release.environment}`)) {
    throw new Error('V25_PROJECT_ENVIRONMENT_MISMATCH');
  }
  if (new Set(Object.values(release.envFiles)).size !== 4) {
    throw new Error('V25_SEPARATE_CREDENTIAL_FILES_REQUIRED');
  }
  if (
    release.environment === 'production' &&
    ([release.source, release.previous?.source].some((value) => value?.dirty) ||
      [...Object.values(release.images), ...Object.values(release.previous?.images ?? {})].some(
        (value) => !value.includes('@sha256:'),
      ))
  ) {
    throw new Error('V25_PRODUCTION_REQUIRES_CLEAN_PUBLISHED_IMAGES');
  }
  return { ...release, publicBaseUrl: `${base.origin}${base.pathname.replace(/\/+$/, '')}` };
}

function runtime(imageRef, file, environment) {
  return {
    image: imageRef,
    pull_policy: 'never',
    env_file: [file],
    environment: { NODE_ENV: 'production', ...environment },
    init: true,
    restart: 'unless-stopped',
    read_only: true,
    tmpfs: ['/tmp:rw,noexec,nosuid,size=128m,mode=1777'],
    cap_drop: ['ALL'],
    security_opt: ['no-new-privileges:true'],
    stop_grace_period: '60s',
    logging: { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '5' } },
  };
}

function liveness(port, path) {
  return {
    test: [
      'CMD',
      'node',
      '-e',
      `fetch('http://127.0.0.1:${port}${path}',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`,
    ],
    interval: '15s',
    timeout: '5s',
    retries: 4,
    start_period: '30s',
  };
}

export function composeForV25Release(input) {
  const release = validateV25Release(input);
  const common = { PUBLIC_BASE_URL: release.publicBaseUrl };
  const basePath = new URL(release.publicBaseUrl).pathname.replace(/\/+$/, '');
  return {
    name: release.project,
    services: {
      migrate: {
        ...runtime(release.images.api, release.envFiles.migration, {
          MIGRATION_RELEASE: release.source.commit,
        }),
        command: ['./node_modules/.bin/tsx', 'src/migrate-bin.ts'],
        restart: 'no',
        profiles: ['maintenance'],
      },
      api: {
        ...runtime(release.images.api, release.envFiles.api, { ...common, PORT: '8787' }),
        healthcheck: liveness(8787, `${basePath}/healthz`),
      },
      'scheme-agent': {
        ...runtime(release.images.api, release.envFiles.schemeAgent, common),
        command: ['./node_modules/.bin/tsx', 'src/agent-worker-bin.ts'],
      },
      worker: runtime(release.images.worker, release.envFiles.worker, common),
      web: {
        ...runtime(release.images.web, undefined, { PORT: '3000', HOSTNAME: '0.0.0.0' }),
        env_file: [],
        ports: [`127.0.0.1:${release.webPort}:3000`],
        tmpfs: [
          '/tmp:rw,noexec,nosuid,size=128m,mode=1777',
          '/app/apps/web-next/.next/cache:rw,noexec,nosuid,size=128m,mode=1777',
        ],
        healthcheck: liveness(3000, `${basePath}/`),
      },
    },
  };
}

export function createV25DeploymentPlan(input) {
  const release = validateV25Release(input);
  const command = (file, args) => ({
    command: 'docker',
    args: ['compose', '--project-name', release.project, '--file', file, ...args],
  });
  const services = ['api', 'scheme-agent', 'worker', 'web'];
  return {
    formatVersion: 1,
    status: 'plan-only',
    publicationAuthorized: false,
    release,
    compose: composeForV25Release(release),
    steps: [
      { id: 'validate-compose', ...command('release.compose.json', ['config', '--quiet']) },
      // No migration at API/worker service startup; privileged credentials reach this one-off only.
      {
        id: 'migrate-once',
        ...command('release.compose.json', ['run', '--rm', '--no-deps', 'migrate']),
      },
      {
        id: 'apply-runtime-grants',
        kind: 'required-reviewed-gate',
        verified: false,
        sourceFile: 'infra/v2.5/runtime-grants.sql',
        requiredRole: 'dedicated-migration-owner',
        instruction:
          'Apply the source-bound grants after both migrations and before runtime rollout; verify DDL denial and queue admission. Do not skip this gate.',
      },
      {
        id: 'roll-runtime',
        ...command('release.compose.json', [
          'up',
          '--detach',
          '--no-build',
          '--pull',
          'never',
          ...services,
        ]),
      },
    ],
    requiredBeforeExecution: [
      'Verify every image digest, source identity, architecture and test/security evidence.',
      'Provision database roles and bucket; runtime roles must not own DDL or migration credentials.',
      'Verify database/object backups and schema compatibility with the previous release.',
      'Verify TLS reverse proxy and Web build upstream http://api:8787 with same-origin OAuth.',
      'Obtain explicit approval for this target and these immutable artifacts.',
    ],
    readiness: {
      verified: false,
      livenessIsNotReadiness: true,
      required: [
        'application-and-graphile-schema',
        'runtime-database-permissions',
        'object-put-get-delete',
        'generation-worker-ack',
        'scheme-agent-worker-ack',
        'same-origin-auth',
      ],
    },
    rollback: release.previous
      ? {
          scope: 'application-only-after-schema-compatibility-verification',
          automaticDatabaseDown: false,
          compose: composeForV25Release({ ...release, ...release.previous, previous: undefined }),
          steps: [
            command('release.compose.json', ['stop', ...services]),
            command('previous.compose.json', [
              'up',
              '--detach',
              '--no-build',
              '--pull',
              'never',
              ...services,
            ]),
          ],
          requiredAfter: [
            'readiness',
            'login-prompt-sync',
            'generation-cancel',
            'object-preservation',
          ],
        }
      : { scope: 'first-install', automaticDatabaseDown: false, backupRestoreVerified: false },
  };
}

export function main(argv) {
  if (argv.length !== 2 || argv[0] !== '--manifest') throw new Error('V25_PLAN_USAGE');
  return createV25DeploymentPlan(JSON.parse(readFileSync(resolve(argv[1]), 'utf8')));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)), null, 2)}\n`);
  } catch {
    process.stderr.write(
      'v2.5 plan rejected; supply a valid --manifest file. No deployment performed.\n',
    );
    process.exitCode = 1;
  }
}
