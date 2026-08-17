#!/usr/bin/env node
import { createHash } from 'node:crypto';
import os from 'node:os';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname as pathDirname, dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvidencePath = 'release/release-gate-evidence.json';
const args = process.argv.slice(2);
const argSet = new Set(args);
const json = argSet.has('--json');
const strict = argSet.has('--strict');
const runtimeSmokePassed = argSet.has('--runtime-smoke-passed');
const help = argSet.has('--help') || argSet.has('-h');

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const evidencePath = optionValue('--file') ?? defaultEvidencePath;
const runUrlArg = optionValue('--run-url');
const installerPathArg = optionValue('--installer');
const outPath = optionValue('--out');

if (help) {
  console.log(`Usage: npm run release:windows:hosted -- [--file path] [--strict] [--json]
       npm run release:windows:hosted -- --runtime-smoke-passed [--run-url URL] [--installer path] [--out path] [--json]

Validates or generates the Windows hosted runner x64 runtime-smoke evidence.
Run the generation form on a Windows x64 hosted runner immediately after:
  python -m pytest tests/package/windows_runtime_smoke.py -q

When --runtime-smoke-passed is present, the script computes the current NSIS
installer hash, records the GitHub Actions run URL from env or --run-url, and
can write a windowsHostedRuntimeSmoke evidence block with --out.`);
  process.exit(0);
}

const checks = [];
const testCommand = 'python -m pytest tests/package/windows_runtime_smoke.py -q';

function safePath(path) {
  const absPath = resolve(repoRoot, path);
  const normalized = relative(repoRoot, absPath);
  if (!normalized || normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new Error(`Unsafe path outside repo root: ${path}`);
  }
  return absPath;
}

function record(name, status, details = '') {
  checks.push({ name, status, details });
}

async function exists(path) {
  try {
    await lstat(safePath(path));
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readText(path) {
  return readFile(safePath(path), 'utf8');
}

async function sha256(path) {
  const content = await readFile(safePath(path));
  return createHash('sha256').update(content).digest('hex');
}

async function fileSummary(path) {
  const stat = await lstat(safePath(path));
  if (!stat.isFile()) throw new Error(`${path} is not a file`);
  return {
    path,
    bytes: stat.size,
    sha256: await sha256(path),
  };
}

async function defaultInstallerPath() {
  const pkg = JSON.parse(await readText('package.json'));
  return `release/Musefold Setup ${pkg.version}.exe`;
}

function githubRunUrlFromEnv() {
  const repo = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  if (!repo || !runId) return null;
  return `${server}/${repo}/actions/runs/${runId}`;
}

function parseGitHubActionsUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('missing runUrl');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`invalid runUrl: ${value}`);
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`runUrl must be an https://github.com Actions URL: ${value}`);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const validRun = parts.length >= 5 && parts[2] === 'actions' && parts[3] === 'runs' && /^\d+$/.test(parts[4]);
  const jobSegmentPresent = parts.length >= 6;
  const validJob = validRun && parts.length >= 7 && parts[5] === 'job' && /^\d+$/.test(parts[6]);
  if (!validRun || (jobSegmentPresent && !validJob)) {
    throw new Error(`runUrl must look like https://github.com/OWNER/REPO/actions/runs/RUN_ID[/job/JOB_ID]: ${value}`);
  }
  return true;
}

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

async function readEvidence() {
  try {
    const text = await readFile(safePath(evidencePath), 'utf8');
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateHostedEvidence(evidence) {
  const gate = evidence?.windowsHostedRuntimeSmoke;
  if (gate === undefined) {
    record('Windows hosted runtime evidence', 'manual', `missing ${evidencePath}:windowsHostedRuntimeSmoke`);
    return null;
  }

  const issues = [];
  try {
    parseGitHubActionsUrl(gate.runUrl);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (Number.isNaN(Date.parse(gate.checkedAt))) issues.push('checkedAt invalid');
  if (typeof gate.os !== 'string' || !/windows/i.test(gate.os)) issues.push('os must name Windows');
  if (typeof gate.architecture !== 'string' || !/^(x64|amd64)$/i.test(gate.architecture.trim())) issues.push('architecture must be x64');
  if (!isSha(gate.installerSha256)) issues.push('installerSha256 invalid');
  if (typeof gate.testCommand !== 'string' || !gate.testCommand.includes('windows_runtime_smoke.py')) issues.push('testCommand must include windows_runtime_smoke.py');
  const result = gate.result ?? {};
  for (const key of ['installedAppLaunch', 'fakeGeneration', 'mediaPreview', 'historyRecord', 'exportImport', 'deeplinkImport']) {
    if (result[key] !== true) issues.push(`result.${key} must be true`);
  }

  if (issues.length === 0) {
    record('Windows hosted runtime evidence', 'pass', `${evidencePath}:windowsHostedRuntimeSmoke is complete`);
  } else {
    record('Windows hosted runtime evidence', 'fail', issues.join('; '));
  }
  return gate;
}

async function generateEvidenceSnippet() {
  if (process.platform !== 'win32') {
    record('Windows hosted evidence generation host', 'fail', `must run on Windows after runtime smoke; current platform=${process.platform}`);
    return null;
  }
  record('Windows hosted evidence generation host', 'pass', `platform=${process.platform}`);

  const architecture = os.arch();
  if (architecture !== 'x64') {
    record('Windows hosted runner architecture', 'fail', `expected x64, got ${architecture}`);
  } else {
    record('Windows hosted runner architecture', 'pass', architecture);
  }

  if (!runtimeSmokePassed) {
    record('Windows installed-package runtime smoke', 'fail', 'missing --runtime-smoke-passed');
  } else {
    record('Windows installed-package runtime smoke', 'pass', testCommand);
  }

  const installerPath = installerPathArg ?? await defaultInstallerPath();
  let installer = null;
  if (await exists(installerPath)) {
    installer = await fileSummary(installerPath);
    record('Windows hosted x64 installer hash', 'pass', `${installer.path} (${installer.bytes.toLocaleString('en-US')} bytes, sha256 ${installer.sha256})`);
  } else {
    record('Windows hosted x64 installer hash', 'fail', `${installerPath} missing; run npm run package:win -- --x64 first`);
  }

  const runUrl = runUrlArg ?? githubRunUrlFromEnv();
  if (!runUrl) {
    record('GitHub Actions run URL', 'fail', 'missing --run-url or GITHUB_REPOSITORY/GITHUB_RUN_ID');
  } else {
    try {
      parseGitHubActionsUrl(runUrl);
      record('GitHub Actions run URL', 'pass', runUrl);
    } catch (error) {
      record('GitHub Actions run URL', 'fail', error instanceof Error ? error.message : String(error));
    }
  }

  if (!installer || !runUrl) return null;
  return {
    windowsHostedRuntimeSmoke: {
      runUrl,
      checkedAt: new Date().toISOString(),
      os: `Windows ${os.release()}`,
      architecture,
      installerSha256: installer.sha256,
      testCommand,
      result: {
        installedAppLaunch: true,
        fakeGeneration: true,
        mediaPreview: true,
        historyRecord: true,
        exportImport: true,
        deeplinkImport: true,
      },
    },
  };
}

async function writeSnippet(snippet) {
  if (!outPath || !snippet) return;
  const absPath = safePath(outPath);
  await mkdir(pathDirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(snippet, null, 2)}\n`, 'utf8');
  record('Windows hosted runtime evidence file', 'pass', outPath);
}

async function main() {
  let evidenceSnippet = null;
  let existingGate = null;
  if (runtimeSmokePassed) {
    evidenceSnippet = await generateEvidenceSnippet();
    await writeSnippet(evidenceSnippet);
  } else {
    const evidence = await readEvidence();
    existingGate = validateHostedEvidence(evidence);
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({ evidencePath, checks, existingGate, evidenceSnippet, strict, ok }, null, 2));
  } else {
    console.log('Windows hosted runner runtime smoke evidence:');
    for (const check of checks) {
      const mark = check.status === 'pass' ? '[pass]' : check.status === 'fail' ? '[fail]' : '[manual]';
      console.log(`${mark} ${check.name}${check.details ? ` - ${check.details}` : ''}`);
    }
    if (evidenceSnippet) {
      console.log('\nEvidence JSON seed:');
      console.log(JSON.stringify(evidenceSnippet, null, 2));
    } else if (pending.length > 0) {
      console.log('\nGenerate this evidence on the Windows CI runner after runtime smoke:');
      console.log('npm run release:windows:hosted -- --runtime-smoke-passed --out release/windows-hosted-runtime-evidence.json');
    }
    if (!strict && pending.length > 0) {
      console.log('\nUse --strict before public release to require this evidence block.');
    }
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
