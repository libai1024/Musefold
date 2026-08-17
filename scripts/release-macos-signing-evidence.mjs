#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname as pathDirname, dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultEvidencePath = 'release/release-gate-evidence.json';
const args = process.argv.slice(2);
const argSet = new Set(args);
const json = argSet.has('--json');
const strict = argSet.has('--strict');
const emitEvidence = argSet.has('--emit-evidence');
const help = argSet.has('--help') || argSet.has('-h');

function optionValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const evidencePath = optionValue('--file') ?? defaultEvidencePath;
const outPath = optionValue('--out');

if (help) {
  console.log(`Usage: npm run release:macos:signing -- [--file path] [--strict] [--json]
       npm run release:macos:signing -- --emit-evidence [--out path] [--json]

Validates or generates the macOS Developer ID signing and notarization evidence.
Run --emit-evidence on the macOS signing host after packaging, signing,
notarizing, and stapling the DMG. The script verifies codesign, spctl, stapler,
computes current artifact hashes, and can write the macosDeveloperIdNotarization
evidence block with --out.`);
  process.exit(0);
}

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

function run(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
}

function firstLine(value) {
  return `${value || ''}`.trim().split('\n').map((line) => line.trim()).find(Boolean) || '';
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

async function artifactPaths() {
  const pkg = JSON.parse(await readText('package.json'));
  return {
    version: pkg.version,
    app: 'release/mac-arm64/Musefold.app',
    dmg: `release/Musefold-${pkg.version}-arm64.dmg`,
    zip: `release/Musefold-${pkg.version}-arm64-mac.zip`,
  };
}

async function bundleIdFromConfig() {
  const builder = await readText('electron-builder.yml');
  const match = builder.match(/^appId:\s*([^\s#]+)\s*$/m);
  return match?.[1] ?? 'com.musefold.app';
}

function parseCodesignDetails(output) {
  const text = `${output || ''}`;
  return {
    teamId: text.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? '',
    identifier: text.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? '',
    authority: [...text.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim()),
  };
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

async function validateExistingEvidence(evidence) {
  const gate = evidence?.macosDeveloperIdNotarization;
  if (gate === undefined) {
    record('macOS signing/notarization evidence', 'manual', `missing ${evidencePath}:macosDeveloperIdNotarization`);
    return null;
  }

  const issues = [];
  if (Number.isNaN(Date.parse(gate.checkedAt))) issues.push('checkedAt invalid');
  if (typeof gate.teamId !== 'string' || !/^[A-Z0-9]{10}$/.test(gate.teamId)) issues.push('teamId must be a 10-character Apple Team ID');
  const expectedBundleId = await bundleIdFromConfig();
  if (gate.bundleId !== expectedBundleId) issues.push(`bundleId must be ${expectedBundleId}`);
  if (!isSha(gate.artifacts?.dmgSha256)) issues.push('artifacts.dmgSha256 invalid');
  if (!isSha(gate.artifacts?.zipSha256)) issues.push('artifacts.zipSha256 invalid');

  const paths = await artifactPaths();
  if (await exists(paths.dmg)) {
    const current = await sha256(paths.dmg);
    if (gate.artifacts?.dmgSha256 !== current) issues.push('artifacts.dmgSha256 does not match current DMG');
  }
  if (await exists(paths.zip)) {
    const current = await sha256(paths.zip);
    if (gate.artifacts?.zipSha256 !== current) issues.push('artifacts.zipSha256 does not match current ZIP');
  }

  const gateChecks = gate.checks ?? {};
  for (const key of ['codesignVerify', 'spctlAssess', 'notarizationAccepted', 'stapleValidate']) {
    if (gateChecks[key] !== true) issues.push(`checks.${key} must be true`);
  }

  if (issues.length === 0) {
    record('macOS signing/notarization evidence', 'pass', `${evidencePath}:macosDeveloperIdNotarization is complete`);
  } else {
    record('macOS signing/notarization evidence', 'fail', issues.join('; '));
  }
  return gate;
}

async function collectCurrentEvidence() {
  if (process.platform !== 'darwin') {
    record('macOS signing evidence host', 'fail', `must run on macOS signing host; current platform=${process.platform}`);
    return null;
  }
  record('macOS signing evidence host', 'pass', 'darwin');

  const paths = await artifactPaths();
  const missing = [];
  for (const path of [paths.app, paths.dmg, paths.zip]) {
    if (!(await exists(path))) missing.push(path);
  }
  if (missing.length > 0) {
    record('macOS signed release artifacts', 'fail', `missing: ${missing.join(', ')}`);
    return null;
  }

  const dmg = await fileSummary(paths.dmg);
  const zip = await fileSummary(paths.zip);
  record('macOS signed release artifact hashes', 'pass', `${dmg.path} sha256 ${dmg.sha256}; ${zip.path} sha256 ${zip.sha256}`);

  const codesignVerify = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', safePath(paths.app)]);
  const codesignPassed = codesignVerify.status === 0;
  if (codesignPassed) {
    record('codesign verification', 'pass', 'codesign --verify --deep --strict --verbose=2 passed');
  } else {
    record('codesign verification', 'fail', firstLine(codesignVerify.stderr || codesignVerify.stdout) || 'codesign verification failed');
  }

  const details = run('codesign', ['-dv', '--verbose=4', safePath(paths.app)]);
  const parsed = parseCodesignDetails(details.stderr || details.stdout);
  const expectedBundleId = await bundleIdFromConfig();
  if (details.status === 0 && parsed.teamId && parsed.identifier === expectedBundleId && parsed.authority.some((authority) => authority.startsWith('Developer ID Application:'))) {
    record('Developer ID signature identity', 'pass', `bundleId=${parsed.identifier}, teamId=${parsed.teamId}`);
  } else {
    const reasons = [];
    if (details.status !== 0) reasons.push(firstLine(details.stderr || details.stdout) || 'codesign details unavailable');
    if (!parsed.teamId) reasons.push('TeamIdentifier missing');
    if (parsed.identifier !== expectedBundleId) reasons.push(`Identifier=${parsed.identifier || '<missing>'}, expected ${expectedBundleId}`);
    if (!parsed.authority.some((authority) => authority.startsWith('Developer ID Application:'))) reasons.push('Developer ID Application authority missing');
    record('Developer ID signature identity', 'fail', reasons.join('; '));
  }

  const spctl = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', safePath(paths.app)]);
  const spctlPassed = spctl.status === 0;
  if (spctlPassed) {
    record('Gatekeeper assessment', 'pass', firstLine(spctl.stderr || spctl.stdout) || 'spctl assessment passed');
  } else {
    record('Gatekeeper assessment', 'fail', firstLine(spctl.stderr || spctl.stdout) || 'spctl assessment failed');
  }

  const staple = run('xcrun', ['stapler', 'validate', safePath(paths.dmg)]);
  const staplePassed = staple.status === 0;
  if (staplePassed) {
    record('notarization staple validation', 'pass', firstLine(staple.stdout || staple.stderr) || 'xcrun stapler validate passed');
  } else {
    record('notarization staple validation', 'fail', firstLine(staple.stderr || staple.stdout) || 'xcrun stapler validate failed');
  }

  if (!codesignPassed || !parsed.teamId || parsed.identifier !== expectedBundleId || !spctlPassed || !staplePassed) return null;

  return {
    macosDeveloperIdNotarization: {
      checkedAt: new Date().toISOString(),
      teamId: parsed.teamId,
      bundleId: expectedBundleId,
      artifacts: {
        dmgSha256: dmg.sha256,
        zipSha256: zip.sha256,
      },
      checks: {
        codesignVerify: true,
        spctlAssess: true,
        notarizationAccepted: true,
        stapleValidate: true,
      },
    },
  };
}

async function writeSnippet(snippet) {
  if (!outPath || !snippet) return;
  const absPath = safePath(outPath);
  await mkdir(pathDirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(snippet, null, 2)}\n`, 'utf8');
  record('macOS signing/notarization evidence file', 'pass', outPath);
}

async function main() {
  let evidenceSnippet = null;
  let existingGate = null;
  if (emitEvidence) {
    evidenceSnippet = await collectCurrentEvidence();
    await writeSnippet(evidenceSnippet);
  } else {
    const evidence = await readEvidence();
    existingGate = await validateExistingEvidence(evidence);
  }

  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({ evidencePath, checks, existingGate, evidenceSnippet, strict, ok }, null, 2));
  } else {
    console.log('macOS Developer ID signing/notarization evidence:');
    for (const check of checks) {
      const mark = check.status === 'pass' ? '[pass]' : check.status === 'fail' ? '[fail]' : '[manual]';
      console.log(`${mark} ${check.name}${check.details ? ` - ${check.details}` : ''}`);
    }
    if (evidenceSnippet) {
      console.log('\nEvidence JSON seed:');
      console.log(JSON.stringify(evidenceSnippet, null, 2));
    } else if (pending.length > 0) {
      console.log('\nGenerate this evidence on the signing host after signing/notarization:');
      console.log('npm run release:macos:signing -- --emit-evidence --out release/macos-signing-evidence.json');
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
