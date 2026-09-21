import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createV25DeploymentPlan, validateV25Release } from '../v25-plan.mjs';

const ref = (name: string, char = 'a') =>
  `registry.example.test/musefold/${name}@sha256:${char.repeat(64)}`;
function fixture() {
  return {
    formatVersion: 1,
    environment: 'staging',
    project: 'musefold-v25-staging-fixture',
    publicBaseUrl: 'https://staging.example.test',
    webPort: 3317,
    source: { commit: 'a'.repeat(40), treeSha256: 'b'.repeat(64), dirty: true },
    images: { api: ref('api'), worker: ref('worker'), web: ref('web') },
    envFiles: {
      api: 'api.env',
      worker: 'worker.env',
      schemeAgent: 'scheme-agent.env',
      migration: 'migration.env',
    },
  };
}

describe('v2.5 immutable release plan', () => {
  it('plans one privileged migration and separate runtime services without deploying', () => {
    const plan = createV25DeploymentPlan(fixture());
    expect(plan.publicationAuthorized).toBe(false);
    expect(plan.status).toBe('plan-only');
    expect(plan.readiness).toMatchObject({ verified: false, livenessIsNotReadiness: true });
    expect(plan.steps.filter((step: { id: string }) => step.id === 'migrate-once')).toHaveLength(1);
    expect(plan.steps.map((step: { id: string }) => step.id)).toEqual([
      'validate-compose',
      'migrate-once',
      'apply-runtime-grants',
      'roll-runtime',
    ]);
    expect(plan.steps[2]).toMatchObject({
      kind: 'required-reviewed-gate',
      verified: false,
      sourceFile: 'infra/v2.5/runtime-grants.sql',
      requiredRole: 'dedicated-migration-owner',
    });
    expect(plan.compose.services.migrate.command).toEqual([
      './node_modules/.bin/tsx',
      'src/migrate-bin.ts',
    ]);
    expect(plan.compose.services.migrate.env_file).toEqual(['migration.env']);
    expect(plan.compose.services.api.env_file).toEqual(['api.env']);
    expect(plan.compose.services.worker.env_file).toEqual(['worker.env']);
    expect(plan.compose.services['scheme-agent'].env_file).toEqual(['scheme-agent.env']);
    expect(plan.compose.services.web.env_file).toEqual([]);
    expect(plan.compose.services.web.ports).toEqual(['127.0.0.1:3317:3000']);
    expect(JSON.stringify({ compose: plan.compose, steps: plan.steps })).not.toMatch(
      /v11|v1\.1|web\/dist|web-api|generation-worker|drizzle-kit|down/,
    );
  });

  it.each(['musefold/api:latest', 'musefold/api:v2.5', 'sha256:abc', ref('musefold-v11')])(
    'rejects mutable or old image %s',
    (image) => {
      const input = fixture();
      input.images.api = image;
      expect(() => createV25DeploymentPlan(input)).toThrow('V25_RELEASE_INVALID');
    },
  );

  it.each(['../migration.env', '/private/migration.env', 'api.env\nsecret=x'])(
    'rejects env path %s',
    (file) => {
      const input = fixture();
      input.envFiles.migration = file;
      expect(() => createV25DeploymentPlan(input)).toThrow('V25_RELEASE_INVALID');
    },
  );

  it('rejects shared credential files, old projects and unknown secret fields', () => {
    const input = fixture();
    input.envFiles.migration = 'api.env';
    expect(() => createV25DeploymentPlan(input)).toThrow('V25_SEPARATE_CREDENTIAL_FILES_REQUIRED');
    expect(() => createV25DeploymentPlan({ ...fixture(), project: 'musefold' })).toThrow(
      'V25_RELEASE_INVALID',
    );
    expect(() => createV25DeploymentPlan({ ...fixture(), password: 'secret-canary' })).toThrow(
      /^V25_RELEASE_INVALID$/,
    );
  });

  it('requires TLS except for isolated loopback staging and rejects URL credentials', () => {
    expect(() =>
      validateV25Release({ ...fixture(), publicBaseUrl: 'http://staging.example.test' }),
    ).toThrow('V25_TLS_REQUIRED');
    expect(
      validateV25Release({ ...fixture(), publicBaseUrl: 'http://127.0.0.1:3317' }).publicBaseUrl,
    ).toBe('http://127.0.0.1:3317');
    expect(() =>
      validateV25Release({ ...fixture(), publicBaseUrl: 'https://user:private@example.test' }),
    ).toThrow('V25_PUBLIC_ORIGIN_INVALID');
  });

  it('requires clean source and published digests in production', () => {
    const input = { ...fixture(), environment: 'production', project: 'musefold-v25-production' };
    expect(() => createV25DeploymentPlan(input)).toThrow(
      'V25_PRODUCTION_REQUIRES_CLEAN_PUBLISHED_IMAGES',
    );
    input.source.dirty = false;
    expect(createV25DeploymentPlan(input).publicationAuthorized).toBe(false);
    input.images.worker = `sha256:${'b'.repeat(64)}`;
    expect(() => createV25DeploymentPlan(input)).toThrow(
      'V25_PRODUCTION_REQUIRES_CLEAN_PUBLISHED_IMAGES',
    );
  });

  it('rolls back only exact previous application artifacts without DDL down or volume deletion', () => {
    const input = fixture();
    const previous = {
      source: { ...input.source, commit: 'c'.repeat(40) },
      images: { api: ref('api', 'c'), worker: ref('worker', 'c'), web: ref('web', 'c') },
    };
    const plan = createV25DeploymentPlan({ ...input, previous });
    expect(plan.rollback.compose.services.api.image).toBe(previous.images.api);
    expect(plan.rollback.compose.services.worker.image).toBe(previous.images.worker);
    expect(plan.rollback.compose.services.web.image).toBe(previous.images.web);
    expect(plan.rollback.automaticDatabaseDown).toBe(false);
    expect(plan.rollback.steps).toHaveLength(2);
    expect(plan.rollback.steps.flatMap((step: { args: string[] }) => step.args)).not.toContain(
      'migrate',
    );
    expect(plan.rollback.steps.flatMap((step: { args: string[] }) => step.args)).not.toContain(
      'down',
    );
  });

  it('the CLI only reads its manifest; --execute fails without modifying files or echoing secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'musefold-v25-plan-'));
    const path = join(dir, 'release.json');
    writeFileSync(path, JSON.stringify(fixture()));
    const entry = new URL('../v25-plan.mjs', import.meta.url);
    const result = spawnSync(process.execPath, [entry.pathname, '--manifest', path], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe('plan-only');
    expect(readdirSync(dir)).toEqual(['release.json']);
    const forbidden = spawnSync(
      process.execPath,
      [entry.pathname, '--manifest', path, '--execute'],
      { encoding: 'utf8' },
    );
    expect(forbidden.status).toBe(1);
    writeFileSync(path, JSON.stringify({ password: 'never-echo-canary' }));
    const invalid = spawnSync(process.execPath, [entry.pathname, '--manifest', path], {
      encoding: 'utf8',
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout + invalid.stderr).not.toContain('never-echo-canary');
  });

  it.skipIf(process.env.RUN_DEPLOY_COMPOSE_TESTS !== 'true')(
    'generated production topology passes actual Docker Compose validation',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'musefold-v25-compose-'));
      const input = fixture();
      for (const file of Object.values(input.envFiles))
        writeFileSync(join(dir, file), '# isolated syntax validation\n');
      const path = join(dir, 'release.compose.json');
      writeFileSync(path, JSON.stringify(createV25DeploymentPlan(input).compose));
      const result = spawnSync('docker', ['compose', '--file', path, 'config', '--quiet'], {
        encoding: 'utf8',
        timeout: 30000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(path, 'utf8')).services.migrate.profiles).toEqual([
        'maintenance',
      ]);
    },
  );
});
