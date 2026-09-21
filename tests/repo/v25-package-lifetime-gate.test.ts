import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, expect, it } from 'vitest';
import { verifyPackageLifetime } from '../../scripts/verify-package-lifetime.mjs';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'package-lifetime-gate-'));
  roots.push(root);
  const start = Date.parse('2026-01-01T00:00:00.000Z');
  const report = {
    success: true,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    numTotalTests: 2,
    startTime: start,
    testResults: [
      {
        assertionResults: [
          {
            title: 'preflights actual in-flight locks, release and archive integrity before expiry',
            status: 'passed',
          },
          {
            title:
              'naturally expires original one-hour stages and exports while preserving receipts and adopted assets',
            status: 'passed',
          },
        ],
      },
    ],
  };
  // Verifier fixtures test report/hash admission only; the separate scanner validates ZIP contents.
  const bytes = Buffer.from('UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==', 'base64');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const records = {} as Record<
    'preflight' | 'natural',
    { path: string; value: Record<string, unknown> }
  >;
  for (const label of ['preflight', 'natural'] as const) {
    const path = join(root, 'evidence', `package-lifetime-${label}-fixture`);
    mkdirSync(path, { recursive: true });
    const value = {
      label,
      status: 'passed',
      phase: label === 'natural' ? 'natural-expiry-passed' : 'preflight-passed',
      provesNaturalExpiry: label === 'natural',
      startedAt: new Date(start + 1000).toISOString(),
      finishedAt: new Date(start + 3_602_000).toISOString(),
      checkedAt: new Date(start + 3_602_000).toISOString(),
      deadlines: [start + 3_601_000],
      workerExit: { code: 0, signal: null },
      item: { sha256: hash },
      exported: { packageHash: hash },
    };
    for (const name of ['entries-at.musefold.design', 'export.musefold.design'])
      writeFileSync(join(path, name), bytes);
    records[label] = { path, value };
  }
  const save = () => {
    writeFileSync(join(root, 'vitest.json'), JSON.stringify(report));
    for (const { path, value } of Object.values(records))
      writeFileSync(join(path, 'result.json'), JSON.stringify(value));
  };
  save();
  return { root, report, records, save };
}

it('requires both passing cases, natural deadline evidence and matching actual files', () => {
  const { root } = fixture();
  expect(verifyPackageLifetime(root)).toMatchObject({ ok: true, targets: expect.any(Array) });
  expect(verifyPackageLifetime(root).targets).toHaveLength(4);
});

it('rejects a successful invocation that skipped the real one-hour case', () => {
  const run = fixture();
  run.report.numPendingTests = 1;
  run.report.testResults[0].assertionResults[1].status = 'pending';
  run.save();
  expect(() => verifyPackageLifetime(run.root)).toThrow('skipped');
});

it.each(['missing-test', 'incomplete', 'shortened', 'stale', 'modified-file', 'unclean-worker'])(
  'rejects %s evidence',
  (mode) => {
    const run = fixture();
    const natural = run.records.natural;
    if (mode === 'missing-test') run.report.testResults[0].assertionResults.pop();
    if (mode === 'incomplete') natural.value.phase = 'waiting-for-original-deadline';
    if (mode === 'shortened') natural.value.deadlines = [run.report.startTime + 60_000];
    if (mode === 'stale') run.report.startTime += 3_700_000;
    if (mode === 'modified-file')
      writeFileSync(join(natural.path, 'export.musefold.design'), 'changed');
    if (mode === 'unclean-worker') natural.value.workerExit = { code: null, signal: 'SIGKILL' };
    run.save();
    expect(() => verifyPackageLifetime(run.root)).toThrow();
  },
);

it('Main and Release require the dedicated long job with evidence verification and archive scanning', () => {
  for (const name of ['main', 'release']) {
    const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
    expect(workflow.jobs['package-lifetime']).toEqual({
      uses: './.github/workflows/package-lifetime.yml',
    });
  }
  const workflow = parse(readFileSync('.github/workflows/package-lifetime.yml', 'utf8'));
  const job = workflow.jobs['natural-expiry'];
  expect(job['timeout-minutes']).toBeGreaterThanOrEqual(75);
  expect(job.env).toMatchObject({ RUN_DATABASE_TESTS: 'true', RUN_PACKAGE_LIFETIME_TESTS: 'true' });
  const commands = job.steps.filter((step: { run?: string }) => step.run);
  expect(commands[1].run).toContain('package-lifetime.integration.test.ts');
  expect(commands[1].run).toContain('--reporter=json');
  expect(commands[2].run).toContain('scripts/verify-package-lifetime.mjs');
  expect(commands[3].run).toContain('scripts/security/scan.mjs plan');
  for (const step of commands) {
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).not.toBe(true);
  }
  expect(job.steps.at(-1)).toMatchObject({
    if: 'always()',
    with: { 'if-no-files-found': 'error' },
  });
});
