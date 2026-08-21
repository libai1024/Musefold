#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvidencePath = 'release/release-gate-evidence.json';
const args = process.argv.slice(2);
const argSet = new Set(args);
const json = argSet.has('--json');
const strict = argSet.has('--strict');
const help = argSet.has('--help') || argSet.has('-h');

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const runUrl = optionValue('--run-url');
const evidencePath = optionValue('--file') ?? defaultEvidencePath;

if (help) {
  console.log(`Usage: npm run release:ci:evidence -- [--run-url URL] [--file path] [--strict] [--json]

Validates the GitHub Actions remote green gate. With --run-url it reads the
workflow run and jobs from the GitHub REST API and prints an evidence JSON
block. Without --run-url it validates the existing githubActionsRemoteGreen
block from the evidence file, or reports the gate as manual/pending.

Set GITHUB_TOKEN or GH_TOKEN for private repos or higher rate limits. Token
values are never printed.`);
  process.exit(0);
}

const requiredJobs = [
  { key: 'sourceChecks', label: 'Source checks', matchers: [/^source checks$/, /source.*checks?/] },
  { key: 'electronE2E', label: 'Electron E2E', matchers: [/^linux electron e2e$/, /^electron e2e$/, /electron.*e2e/] },
  { key: 'macosPackageSmoke', label: 'macOS package smoke', matchers: [/^macos package smoke$/, /macos.*package.*smoke/] },
  {
    key: 'windowsPackageAndRuntimeSmoke',
    label: 'Windows package and runtime smoke',
    matchers: [/^windows package and runtime smoke$/, /windows.*package.*runtime.*smoke/],
  },
];

const checks = [];

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

function parseRunUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Missing GitHub Actions run URL');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid run URL: ${value}`);
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error(`Run URL must be an https://github.com/.../actions/runs/... URL: ${value}`);
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 5 || parts[2] !== 'actions' || parts[3] !== 'runs' || !/^\d+$/.test(parts[4])) {
    throw new Error(`Run URL must look like https://github.com/OWNER/REPO/actions/runs/RUN_ID: ${value}`);
  }
  return {
    owner: parts[0],
    repo: parts[1],
    runId: parts[4],
    canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}/actions/runs/${parts[4]}`,
  };
}

function normalizeJobName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findRequiredJob(jobs, definition) {
  return jobs.find((job) => {
    const normalized = normalizeJobName(job.name);
    return definition.matchers.some((matcher) => matcher.test(normalized));
  });
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

function validateEvidenceGate(evidence) {
  const gate = evidence?.githubActionsRemoteGreen;
  if (gate === undefined) {
    record('GitHub Actions remote CI evidence', 'manual', `missing ${evidencePath}:githubActionsRemoteGreen`);
    return null;
  }

  const issues = [];
  try {
    parseRunUrl(gate.runUrl);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  if (Number.isNaN(Date.parse(gate.checkedAt))) issues.push('checkedAt invalid');
  if (gate.conclusion !== 'success') issues.push('conclusion must be success');

  const jobs = gate.jobs ?? {};
  for (const job of requiredJobs) {
    if (jobs[job.key] !== true) issues.push(`jobs.${job.key} must be true`);
  }

  if (issues.length === 0) {
    record('GitHub Actions remote CI evidence', 'pass', `${evidencePath}:githubActionsRemoteGreen is complete`);
    return gate;
  }
  record('GitHub Actions remote CI evidence', 'fail', issues.join('; '));
  return gate;
}

async function githubRequest(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Musefold-release-ci-evidence',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`https://api.github.com${path}`, { headers });
  const text = await response.text();
  let body = null;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 240) };
    }
  }
  if (!response.ok) {
    const message = body?.message ? `: ${body.message}` : '';
    throw new Error(`GitHub API request failed (${response.status} ${response.statusText})${message}`);
  }
  return body;
}

async function readWorkflowJobs(owner, repo, runId) {
  const jobs = [];
  let page = 1;
  for (;;) {
    const payload = await githubRequest(`/repos/${owner}/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`);
    jobs.push(...(payload?.jobs ?? []));
    const total = typeof payload?.total_count === 'number' ? payload.total_count : jobs.length;
    if (jobs.length >= total || (payload?.jobs ?? []).length === 0) break;
    page += 1;
  }
  return jobs;
}

function buildEvidenceSnippet(run, jobChecks, fallbackUrl) {
  return {
    githubActionsRemoteGreen: {
      runUrl: run.html_url ?? fallbackUrl,
      checkedAt: new Date().toISOString(),
      conclusion: run.conclusion,
      jobs: Object.fromEntries(jobChecks.map((item) => [item.key, item.pass])),
    },
  };
}

async function validateRemoteRun(value) {
  const parsed = parseRunUrl(value);
  const run = await githubRequest(`/repos/${parsed.owner}/${parsed.repo}/actions/runs/${parsed.runId}`);
  const jobs = await readWorkflowJobs(parsed.owner, parsed.repo, parsed.runId);

  const runOk = run?.status === 'completed' && run?.conclusion === 'success';
  record(
    'GitHub Actions workflow run completed successfully',
    runOk ? 'pass' : 'fail',
    `${run?.html_url ?? parsed.canonicalUrl} status=${run?.status ?? 'unknown'} conclusion=${run?.conclusion ?? 'unknown'}`,
  );

  const jobChecks = requiredJobs.map((definition) => {
    const job = findRequiredJob(jobs, definition);
    const pass = job?.status === 'completed' && job?.conclusion === 'success';
    if (!job) {
      record(definition.label, 'fail', 'required job not found in workflow run');
      return { ...definition, pass: false, job: null };
    }
    record(
      definition.label,
      pass ? 'pass' : 'fail',
      `${job.html_url ?? job.name} status=${job.status ?? 'unknown'} conclusion=${job.conclusion ?? 'unknown'}`,
    );
    return { ...definition, pass, job };
  });

  return {
    parsed,
    run,
    jobs,
    evidenceSnippet: buildEvidenceSnippet(run, jobChecks, parsed.canonicalUrl),
  };
}

async function main() {
  let remote = null;
  let existingGate = null;
  if (runUrl) {
    remote = await validateRemoteRun(runUrl);
  } else {
    const evidence = await readEvidence();
    existingGate = validateEvidenceGate(evidence);
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({
      evidencePath,
      checks,
      existingGate,
      remote: remote
        ? {
            runUrl: remote.run.html_url ?? remote.parsed.canonicalUrl,
            runStatus: remote.run.status,
            runConclusion: remote.run.conclusion,
            jobCount: remote.jobs.length,
            evidenceSnippet: remote.evidenceSnippet,
          }
        : null,
      strict,
      ok,
    }, null, 2));
  } else {
    console.log('GitHub Actions remote CI evidence:');
    for (const check of checks) {
      const mark = check.status === 'pass' ? '[pass]' : check.status === 'fail' ? '[fail]' : '[manual]';
      console.log(`${mark} ${check.name}${check.details ? ` - ${check.details}` : ''}`);
    }
    if (remote) {
      console.log('\nEvidence JSON seed:');
      console.log(JSON.stringify(remote.evidenceSnippet, null, 2));
    } else if (pending.length > 0) {
      console.log('\nFetch and validate a remote run with: npm run release:ci:evidence -- --run-url https://github.com/OWNER/REPO/actions/runs/RUN_ID');
      console.log('Then copy githubActionsRemoteGreen into release/release-gate-evidence.json and run npm run release:evidence -- --strict.');
    }
    if (!strict && pending.length > 0) {
      console.log('\nUse --strict before public release to require this evidence block.');
    }
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
