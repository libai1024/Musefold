import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Reject a green Vitest invocation that skipped the real hour or left stale/incomplete evidence. */
export function verifyPackageLifetime(directory) {
  const root = realpathSync(directory);
  const report = json(resolve(root, 'vitest.json'));
  assert.equal(report.success, true, 'Vitest did not succeed');
  assert.equal(report.numFailedTests, 0, 'Lifetime tests failed');
  assert.equal(report.numPendingTests, 0, 'Lifetime tests were skipped or left pending');
  assert.equal(report.numTodoTests, 0, 'Lifetime tests contain TODOs');
  assert.equal(report.numTotalTests, 2, 'Expected the complete lifetime test collection');
  const assertions = report.testResults.flatMap((file) => file.assertionResults);
  assert.equal(assertions.length, 2, 'Expected the complete two-test lifetime suite');
  for (const title of [
    'preflights actual in-flight locks, release and archive integrity before expiry',
    'naturally expires original one-hour stages and exports while preserving receipts and adopted assets',
  ]) {
    const matching = assertions.filter((test) => test.title === title);
    assert.equal(matching.length, 1, `Missing unique lifetime test: ${title}`);
    assert.equal(matching[0].status, 'passed', `Lifetime test did not pass: ${title}`);
  }
  const evidenceRoot = resolve(root, 'evidence');
  const runs = readdirSync(evidenceRoot, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );
  assert.equal(runs.length, 2, 'Expected fresh preflight and natural evidence only');
  const records = runs.map((run) => {
    const path = realpathSync(resolve(evidenceRoot, run.name));
    assert.equal(dirname(path), realpathSync(evidenceRoot), 'Evidence escaped its directory');
    return { path, value: json(resolve(path, 'result.json')) };
  });
  const natural = records.filter(({ value }) => value.label === 'natural');
  const preflight = records.filter(({ value }) => value.label === 'preflight');
  assert.equal(natural.length, 1, 'Missing natural deadline record');
  assert.equal(preflight.length, 1, 'Missing preflight record');
  assert.equal(natural[0].value.provesNaturalExpiry, true, 'Natural expiry was not verified');
  assert.equal(natural[0].value.phase, 'natural-expiry-passed', 'Natural run is incomplete');
  const started = Date.parse(natural[0].value.startedAt);
  const finished = Date.parse(natural[0].value.finishedAt);
  const checked = Date.parse(natural[0].value.checkedAt);
  assert.ok(
    Number.isFinite(report.startTime) && started >= report.startTime,
    'Stale natural evidence from an earlier invocation',
  );
  const deadlines = natural[0].value.deadlines;
  assert.ok(Array.isArray(deadlines) && deadlines.length > 0, 'Missing original deadlines');
  for (const deadline of deadlines) {
    assert.ok(
      Number.isSafeInteger(deadline) && deadline >= started + 3_600_000,
      'Deadline did not preserve a real hour',
    );
    assert.ok(checked >= deadline && finished >= checked, 'Verification preceded natural expiry');
  }
  const targets = [];
  for (const { path, value } of records) {
    assert.equal(value.status, 'passed', 'An evidence run did not pass');
    assert.deepEqual(value.workerExit, { code: 0, signal: null }, 'Worker did not close cleanly');
    const archives = readdirSync(path).filter((name) => name.endsWith('.musefold.design'));
    assert.deepEqual(archives.sort(), ['entries-at.musefold.design', 'export.musefold.design']);
    for (const [name, expected] of [
      ['entries-at.musefold.design', value.item.sha256],
      ['export.musefold.design', value.exported.packageHash],
    ]) {
      const artifact = realpathSync(resolve(path, name));
      assert.equal(dirname(artifact), path, 'Archive escaped its evidence directory');
      assert.equal(hash(artifact), expected, 'Archive differs from actual test bytes');
      targets.push({
        id: `${value.label}-${name}`,
        kind: 'zip',
        path: artifact,
        detectUserPaths: true,
      });
    }
  }
  return {
    ok: true,
    naturalDeadline: new Date(Math.max(...deadlines)).toISOString(),
    finishedAt: natural[0].value.finishedAt,
    targets,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.ok(process.argv[2], 'Usage: verify-package-lifetime.mjs <report-directory>');
    const directory = resolve(process.argv[2]);
    const result = verifyPackageLifetime(directory);
    writeFileSync(resolve(directory, 'verified.json'), `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(
      resolve(directory, 'scan-plan.json'),
      `${JSON.stringify({ targets: result.targets }, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify({ ok: true, archives: result.targets.length })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
