#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvidencePath = 'release/release-gate-evidence.json';
const templatePath = 'docs/release-gate-evidence.template.json';

const args = process.argv.slice(2);
const json = args.includes('--json');
const strict = args.includes('--strict');
const help = args.includes('--help') || args.includes('-h');

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const evidencePath = optionValue('--file') ?? defaultEvidencePath;

if (help) {
  console.log(`Usage: npm run release:evidence -- [--file path] [--strict] [--json]

Validates manually collected release gate evidence. Missing gates are reported
as manual/pending by default; provided but malformed evidence fails the command.
Use --strict when every external gate must be present before a public release.
Use npm run release:ci:evidence -- --run-url <Actions run URL> to generate the
githubActionsRemoteGreen block from the remote workflow run.
Use npm run release:windows:hosted on the Windows CI runner after runtime
smoke to generate the windowsHostedRuntimeSmoke block.
Use npm run release:macos:signing -- --emit-evidence on the macOS signing
host after signing/notarization to generate the macosDeveloperIdNotarization block.

Template: ${templatePath}`);
  process.exit(0);
}

const gates = [
  {
    key: 'githubActionsRemoteGreen',
    name: 'GitHub Actions remote CI first green run',
    fields: [
      ['runUrl', 'url'],
      ['checkedAt', 'date'],
      ['conclusion', 'success'],
      ['jobs.sourceChecks', 'true'],
      ['jobs.electronE2E', 'true'],
      ['jobs.macosPackageSmoke', 'true'],
      ['jobs.windowsPackageAndRuntimeSmoke', 'true'],
    ],
  },
  {
    key: 'windowsHostedRuntimeSmoke',
    name: 'Windows hosted runner x64 installed-app runtime smoke',
    fields: [
      ['runUrl', 'url'],
      ['checkedAt', 'date'],
      ['os', 'string'],
      ['architecture', 'string'],
      ['installerSha256', 'sha256'],
      ['testCommand', 'string'],
      ['result.installedAppLaunch', 'true'],
      ['result.fakeGeneration', 'true'],
      ['result.mediaPreview', 'true'],
      ['result.historyRecord', 'true'],
      ['result.exportImport', 'true'],
      ['result.deeplinkImport', 'true'],
    ],
  },
  {
    key: 'windowsArm64TargetRuntime',
    name: 'Windows ARM64 target-device runtime smoke',
    fields: [
      ['checkedAt', 'date'],
      ['device', 'string'],
      ['windowsVersion', 'string'],
      ['installerSha256', 'sha256'],
      ['appExeSha256', 'sha256'],
      ['checklist.install', 'true'],
      ['checklist.launch', 'true'],
      ['checklist.fakeGeneration', 'true'],
      ['checklist.mediaPreview', 'true'],
      ['checklist.historyRecord', 'true'],
      ['checklist.exportImport', 'true'],
      ['checklist.deeplinkImport', 'true'],
    ],
  },
  {
    key: 'macosDeveloperIdNotarization',
    name: 'Developer ID signing and macOS notarization',
    fields: [
      ['checkedAt', 'date'],
      ['teamId', 'string'],
      ['bundleId', 'string'],
      ['artifacts.dmgSha256', 'sha256'],
      ['artifacts.zipSha256', 'sha256'],
      ['checks.codesignVerify', 'true'],
      ['checks.spctlAssess', 'true'],
      ['checks.notarizationAccepted', 'true'],
      ['checks.stapleValidate', 'true'],
    ],
  },
  {
    key: 'upstreamRealImageGeneration',
    name: 'Upstream real image generation success',
    fields: [
      ['checkedAt', 'date'],
      ['providerBaseUrl', 'url'],
      ['model', 'string'],
      ['testCommand', 'string'],
      ['result.testsPassed', 'numberGt0'],
      ['result.generatedImageOnDisk', 'true'],
      ['result.imageByteSize', 'numberGt0'],
      ['result.imageSha256', 'sha256'],
      ['result.mediaPreviewVisible', 'true'],
      ['result.historySuccessRecord', 'true'],
    ],
  },
];

function safePath(path) {
  const absPath = resolve(repoRoot, path);
  const normalized = relative(repoRoot, absPath);
  if (!normalized || normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new Error(`Unsafe path outside repo root: ${path}`);
  }
  return absPath;
}

function getPath(value, path) {
  return path.split('.').reduce((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return current[part];
  }, value);
}

function checkType(value, type) {
  if (type === 'string') return typeof value === 'string' && value.trim().length > 0;
  if (type === 'url') return typeof value === 'string' && /^https:\/\/[^\s]+$/i.test(value);
  if (type === 'date') return typeof value === 'string' && !Number.isNaN(Date.parse(value));
  if (type === 'success') return value === 'success';
  if (type === 'true') return value === true;
  if (type === 'numberGt0') return typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (type === 'sha256') return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
  return false;
}

function findSecretIssues(value, path = '$', issues = []) {
  if (typeof value === 'string') {
    if (/sk-[A-Za-z0-9_-]{20,}/.test(value)) issues.push(`${path}: likely API key`);
    return issues;
  }
  if (!value || typeof value !== 'object') return issues;
  for (const [key, child] of Object.entries(value)) {
    if (/api[_-]?key|authorization|password|secret|token/i.test(key)) {
      const emptyPlaceholder = typeof child === 'string' && /^\s*(|redacted|placeholder|<.*>)\s*$/i.test(child);
      if (child !== undefined && child !== null && child !== '' && !emptyPlaceholder) {
        issues.push(`${path}.${key}: secret-like field name`);
      }
    }
    findSecretIssues(child, `${path}.${key}`, issues);
  }
  return issues;
}

function findPlaceholderIssues(value, path = '$', issues = []) {
  if (typeof value === 'string') {
    const obviousPlaceholders = [
      'OWNER',
      'REPO',
      'RUN_ID',
      'JOB_ID',
      'ABCDE12345',
      'Windows ARM64 device model',
      'Windows 11 ARM64 build',
    ];
    if (obviousPlaceholders.some((placeholder) => value.includes(placeholder))) {
      issues.push(`${path}: placeholder value`);
    }
    if (/^0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef$/i.test(value)) {
      issues.push(`${path}: placeholder sha256`);
    }
    return issues;
  }
  if (!value || typeof value !== 'object') return issues;
  for (const [key, child] of Object.entries(value)) {
    findPlaceholderIssues(child, `${path}.${key}`, issues);
  }
  return issues;
}

function validateGate(definition, evidence) {
  const gate = evidence?.[definition.key];
  if (gate === undefined) {
    return { key: definition.key, name: definition.name, status: 'manual', details: 'missing evidence' };
  }
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    return { key: definition.key, name: definition.name, status: 'fail', details: 'gate evidence must be an object' };
  }

  const missing = [];
  for (const [field, type] of definition.fields) {
    const value = getPath(gate, field);
    if (!checkType(value, type)) missing.push(`${field}:${type}`);
  }
  if (missing.length > 0) {
    return { key: definition.key, name: definition.name, status: 'fail', details: `missing/invalid ${missing.join(', ')}` };
  }
  return { key: definition.key, name: definition.name, status: 'pass', details: 'complete evidence supplied' };
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

async function main() {
  const evidence = await readEvidence();
  const checks = evidence
    ? gates.map((gate) => validateGate(gate, evidence))
    : gates.map((gate) => ({ key: gate.key, name: gate.name, status: 'manual', details: 'evidence file missing' }));
  const secretIssues = evidence ? findSecretIssues(evidence) : [];
  for (const issue of secretIssues) {
    checks.push({ key: 'secrets', name: 'Evidence contains no API keys or secret fields', status: 'fail', details: issue });
  }
  const placeholderIssues = evidence ? findPlaceholderIssues(evidence) : [];
  for (const issue of placeholderIssues) {
    checks.push({ key: 'placeholders', name: 'Evidence placeholders have been replaced', status: 'fail', details: issue });
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({ evidencePath, templatePath, checks, ok, strict }, null, 2));
  } else {
    console.log(`Release gate evidence: ${evidencePath}`);
    if (!evidence) console.log(`Evidence file not found. Start from ${templatePath}.`);
    for (const check of checks) {
      const mark = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○';
      console.log(`${mark} ${check.name}${check.details ? ` — ${check.details}` : ''}`);
    }
    if (!strict && pending.length > 0) {
      console.log('\nUse --strict before public release to require every external gate.');
    }
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
