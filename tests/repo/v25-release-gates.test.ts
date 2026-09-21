import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { expect, it } from 'vitest';

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  'continue-on-error'?: boolean;
};
type Job = { needs?: string[] | string; steps: Step[]; 'continue-on-error'?: boolean };
const workflow = (name: string) =>
  parse(readFileSync(resolve(`.github/workflows/${name}.yml`), 'utf8')) as {
    jobs: Record<string, Job>;
  };

it.each(['pr', 'main', 'release'])(
  '%s runs source scanning as a required check and uploads its report',
  (name) => {
    const job = workflow(name).jobs.verify;
    expect(job['continue-on-error']).not.toBe(true);
    const scan = job.steps.find((step) => step.run?.includes('scripts/security/scan.mjs source'));
    expect(scan).toBeDefined();
    expect(scan?.if).toBeUndefined();
    expect(scan?.['continue-on-error']).not.toBe(true);
    const upload = job.steps.find((step) => step.with?.name === 'source-security-results');
    expect(upload).toMatchObject({
      if: 'always()',
      with: {
        'include-hidden-files': true,
        'if-no-files-found': 'error',
        path: 'tests/v25/.results/security/source.json',
      },
    });
  },
);

it('both publishing paths transitively require source, database, runtime and package scans', () => {
  const { jobs } = workflow('release');
  const dependencies = (name: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(name)) return visited;
    visited.add(name);
    const needs = jobs[name].needs ?? [];
    for (const parent of typeof needs === 'string' ? [needs] : needs) dependencies(parent, visited);
    return visited;
  };
  for (const publisher of ['publish-site', 'github-release']) {
    expect([...dependencies(publisher)]).toEqual(
      expect.arrayContaining([
        'verify',
        'database-integration',
        'package-lifetime',
        'e2e',
        'server-images',
        'mac-package',
        'win-package',
      ]),
    );
  }
  for (const id of ['mac-package', 'win-package']) {
    const job = jobs[id];
    expect(job['continue-on-error']).not.toBe(true);
    const smoke = job.steps.findIndex((step) => step.run?.includes('playwright.package.config.ts'));
    const scan = job.steps.findIndex((step) =>
      step.run?.includes('scripts/security/scan-packages.mjs'),
    );
    expect(smoke).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(smoke);
    expect(job.steps[scan].if).toBeUndefined();
    expect(job.steps[scan]['continue-on-error']).not.toBe(true);
    const upload = job.steps.find((step) => step.with?.path === 'tests/v25/.results/package/');
    expect(upload).toMatchObject({
      if: 'always()',
      with: { 'include-hidden-files': true, 'if-no-files-found': 'error' },
    });
  }
});

it.each(['pr', 'main', 'release'])(
  '%s requires the two-process real database sync suite',
  (name) => {
    const job = workflow(name).jobs['database-integration'];
    expect(job['continue-on-error']).not.toBe(true);
    const step = job.steps.find((step) => step.run?.includes('v25-sync-two-devices.test.ts'));
    expect(step).toBeDefined();
    expect(step?.if).toBeUndefined();
    expect(step?.['continue-on-error']).not.toBe(true);
    expect(step?.env).toMatchObject({
      RUN_DATABASE_TESTS: '1',
      TWO_DEVICE_RESULTS_DIR: 'apps/api/test-results/two-device-sync',
    });
    expect(step?.run).toContain('--reporter=junit');
    expect(step?.run).toContain('--outputFile=apps/api/test-results/two-device-sync.xml');
    expect(
      job.steps.some((s) => s.if === 'always()' && s.with?.path === 'apps/*/test-results/'),
    ).toBe(true);
    const upload = job.steps.find((s) => s.with?.path === 'apps/*/test-results/');
    expect(upload?.if).toBe('always()');
    expect(upload?.with).toMatchObject({ 'if-no-files-found': 'error' });
  },
);

it.each(['main', 'release'])('%s stamps the web image with the current build identity', (name) => {
  const build = workflow(name).jobs['server-images'].steps.find((step) =>
    step.run?.includes('apps/web-next/Dockerfile'),
  );
  expect(build).toBeDefined();
  expect(build?.if).toBeUndefined();
  expect(build?.['continue-on-error']).not.toBe(true);
  for (const buildArg of [
    '--build-arg NEXT_PUBLIC_GIT_COMMIT=',
    '--build-arg NEXT_PUBLIC_APP_VERSION=',
    '--build-arg NEXT_PUBLIC_BUILT_AT=',
  ]) {
    expect(build?.run).toContain(buildArg);
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: 断言 workflow 里的字面量表达式
  expect(build?.run).toContain('${{ github.sha }}');
  expect(build?.run).toContain("require('./apps/desktop/package.json').version");
});

it('the web image Dockerfile declares the built-at identity next to commit and version', () => {
  const dockerfile = readFileSync(resolve('apps/web-next/Dockerfile'), 'utf8');
  for (const declared of [
    'ARG NEXT_PUBLIC_GIT_COMMIT',
    'ARG NEXT_PUBLIC_APP_VERSION',
    'ARG NEXT_PUBLIC_BUILT_AT',
    'NEXT_PUBLIC_BUILT_AT=$NEXT_PUBLIC_BUILT_AT',
  ]) {
    expect(dockerfile).toContain(declared);
  }
});

it.each(['main', 'release'])('%s records a build manifest for every verified build', (name) => {
  const steps = workflow(name).jobs.verify.steps;
  const webBuild = steps.findIndex((step) => step.run === 'pnpm run build:web');
  const generate = steps.findIndex((step) =>
    step.run?.includes('scripts/build/v25-build-manifest.mjs'),
  );
  expect(webBuild).toBeGreaterThan(-1);
  expect(generate).toBeGreaterThan(webBuild);
  expect(steps[generate].if).toBe('always()');
  const upload = steps.find((step) => step.with?.name === 'build-manifest');
  expect(upload).toMatchObject({
    if: 'always()',
    with: {
      path: 'tests/v25/.results/build-manifest.json',
      'if-no-files-found': 'error',
    },
  });
});

it('package lifetime evidence uploads even when the observation fails', () => {
  const upload = workflow('package-lifetime').jobs['natural-expiry'].steps.find(
    (step) => step.with?.name === 'package-lifetime-results',
  );
  expect(upload).toMatchObject({
    if: 'always()',
    with: {
      path: 'apps/api/test-results/package-lifetime/',
      'if-no-files-found': 'error',
    },
  });
});

it.each([
  ['mac-package', 'mac-installers', 'mac-build-manifest', 'mac-dmg', 'mac-zip', 'mac-update-feed'],
  ['win-package', 'win-installers', 'win-build-manifest', 'windows-nsis', 'windows-update-feed'],
])(
  '%s binds required installers and verification reports before publication',
  (id, name, manifestName, ...artifacts) => {
    const { steps } = workflow('release').jobs[id];
    const scan = steps.findIndex((step) =>
      step.run?.includes('scripts/security/scan-packages.mjs'),
    );
    const manifest = steps.findIndex((step) =>
      step.run?.includes('scripts/build/v25-build-manifest.mjs'),
    );
    const upload = steps.findIndex((step) => step.with?.name === name);
    expect(manifest).toBeGreaterThan(scan);
    expect(upload).toBeGreaterThan(manifest);
    expect(steps[manifest].if).toBeUndefined();
    expect(steps[manifest]['continue-on-error']).not.toBe(true);
    for (const artifact of [...artifacts, 'package-tests', 'package-security']) {
      expect(steps[manifest].run).toContain(`--artifact "${artifact}=`);
    }
    const manifestPath = `tests/v25/.results/package/${manifestName}.json`;
    expect(steps[manifest].run).toContain(`--out ${manifestPath}`);
    expect(steps.find((step) => step.with?.name === manifestName)).toMatchObject({
      with: { path: manifestPath, 'if-no-files-found': 'error' },
    });
    // A different root in this upload would silently nest release/ in the archive.
    expect(steps[upload].with?.path).not.toContain('tests/');
    const release = workflow('release').jobs['github-release'].steps;
    expect(
      release.some(
        (step) => step.uses?.includes('download-artifact') && step.with?.name === manifestName,
      ),
    ).toBe(true);
    expect(release.find((step) => step.uses?.includes('action-gh-release'))?.with?.files).toContain(
      'artifacts/*-build-manifest.json',
    );
  },
);

it('the standalone web runner refuses a port owned by another process', () => {
  const runner = readFileSync(resolve('scripts/start-v25-web.mjs'), 'utf8');
  expect(runner).toContain('assertPortAvailable');
  expect(runner).toContain('WEB_E2E_PORT = 3399');
  expect(runner).toContain("'lsof'");
  expect(runner).toContain("'command='");
  expect(runner).toContain('EADDRINUSE');
});
