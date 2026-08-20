#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
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

const evidencePath = optionValue('--file') ?? defaultEvidencePath;
const outPath = optionValue('--out');

if (help) {
  console.log(`Usage: npm run release:windows:target -- [--file path] [--strict] [--json]
       npm run release:windows:target -- --out path [--json]

Prints the Windows ARM64 target-device runtime checklist with current artifact
hashes, verifies the local ARM64 package shape, and optionally validates the
target-device evidence block. With --out it also writes a seed JSON file for
release/release-gate-evidence.json. It does not install or run Windows binaries
from macOS.`);
  process.exit(0);
}

const PE_MACHINE_I386 = 0x014c;
const PE_MACHINE_ARM64 = 0xaa64;
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

async function peMachine(path) {
  const data = await readFile(safePath(path));
  if (data.length < 0x40 || data.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${path} missing DOS MZ header`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 6 >= data.length || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    throw new Error(`${path} missing PE header`);
  }
  return data.readUInt16LE(peOffset + 4);
}

async function collectMarkdown(baseRel) {
  const baseAbs = safePath(baseRel);
  const output = [];
  async function walk(absDir) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const absChild = join(absDir, entry.name);
      if (entry.isDirectory()) await walk(absChild);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        output.push(relative(baseAbs, absChild).replaceAll('\\', '/'));
      }
    }
  }
  await walk(baseAbs);
  return output.sort();
}

async function checkPackagedDocsSync() {
  const sourceBase = 'docs/product';
  const packageBase = 'release/win-arm64-unpacked/resources/product-docs';
  if (!(await exists(packageBase))) {
    record('Windows ARM64 product docs are bundled', 'fail', `${packageBase} missing`);
    return;
  }

  const sourceFiles = await collectMarkdown(sourceBase);
  const packagedFiles = await collectMarkdown(packageBase);
  const issues = [];
  for (const file of sourceFiles) {
    if (!packagedFiles.includes(file)) {
      issues.push(`missing ${file}`);
      continue;
    }
    const source = await readText(join(sourceBase, file));
    const packaged = await readText(join(packageBase, file));
    if (source !== packaged) issues.push(`${file} differs`);
  }
  for (const file of packagedFiles) {
    if (!sourceFiles.includes(file)) issues.push(`extra ${file}`);
  }

  if (issues.length === 0) {
    record('Windows ARM64 product docs are bundled', 'pass', `${sourceFiles.length} markdown files match docs/product`);
  } else {
    record('Windows ARM64 product docs are bundled', 'fail', issues.join('; '));
  }
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

function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function validateTargetEvidence(evidence, artifacts) {
  const gate = evidence?.windowsArm64TargetRuntime;
  if (gate === undefined) {
    record('Windows ARM64 target-device evidence', 'manual', `missing ${evidencePath}:windowsArm64TargetRuntime`);
    return;
  }
  const issues = [];
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    issues.push('gate must be an object');
  } else {
    if (Number.isNaN(Date.parse(gate.checkedAt))) issues.push('checkedAt invalid');
    if (typeof gate.device !== 'string' || gate.device.trim().length < 3 || gate.device.includes('device model')) issues.push('device missing/placeholder');
    if (typeof gate.windowsVersion !== 'string' || gate.windowsVersion.trim().length < 3 || gate.windowsVersion.includes('build')) issues.push('windowsVersion missing/placeholder');
    if (!isSha(gate.installerSha256)) issues.push('installerSha256 invalid');
    if (!isSha(gate.appExeSha256)) issues.push('appExeSha256 invalid');
    if (gate.installerSha256 !== artifacts.installer.sha256) issues.push('installerSha256 does not match current artifact');
    if (gate.appExeSha256 !== artifacts.appExe.sha256) issues.push('appExeSha256 does not match current artifact');

    const checklist = gate.checklist ?? {};
    for (const key of ['install', 'launch', 'fakeGeneration', 'mediaPreview', 'historyRecord', 'exportImport', 'deeplinkImport']) {
      if (checklist[key] !== true) issues.push(`checklist.${key} must be true`);
    }
  }

  if (issues.length === 0) {
    record('Windows ARM64 target-device evidence', 'pass', `${evidencePath}:windowsArm64TargetRuntime matches current artifact hashes`);
  } else {
    record('Windows ARM64 target-device evidence', 'fail', issues.join('; '));
  }
}

async function collectArtifacts() {
  const pkg = JSON.parse(await readText('package.json'));
  const installerPath = `release/Musefold Setup ${pkg.version}.exe`;
  const appExePath = 'release/win-arm64-unpacked/Musefold.exe';
  const artifacts = {
    installer: null,
    appExe: null,
    version: pkg.version,
  };

  const missing = [];
  if (!(await exists(installerPath))) missing.push(installerPath);
  if (!(await exists(appExePath))) missing.push(appExePath);
  if (missing.length > 0) {
    record('Windows ARM64 release artifacts exist', 'fail', `missing: ${missing.join(', ')}`);
    return artifacts;
  }

  artifacts.installer = await fileSummary(installerPath);
  artifacts.appExe = await fileSummary(appExePath);
  record('Windows ARM64 release artifacts exist', 'pass', `${installerPath}; ${appExePath}`);

  const installerMachine = await peMachine(installerPath);
  const appMachine = await peMachine(appExePath);
  if (installerMachine === PE_MACHINE_I386 && appMachine === PE_MACHINE_ARM64) {
    record('Windows PE architecture markers', 'pass', 'NSIS installer i386 stub and Musefold.exe ARM64');
  } else {
    record('Windows PE architecture markers', 'fail', `installer=0x${installerMachine.toString(16)}, app=0x${appMachine.toString(16)}`);
  }
  return artifacts;
}

function buildChecklist(artifacts) {
  const installerName = artifacts.installer?.path.split('/').pop() ?? `Musefold Setup ${artifacts.version}.exe`;
  return [
    `Copy ${installerName} to a real Windows on ARM64 device.`,
    `Verify installer hash in PowerShell: Get-FileHash '.\\${installerName}' -Algorithm SHA256`,
    'Install the package and launch Musefold from the Start menu or install directory.',
    'Create an OpenAI-compatible mock Provider against a local test server or run the packaged runtime smoke on the ARM64 device; generate one fake PNG.',
    'Confirm the generated image renders through media:// and the success row appears in History.',
    'Export a DB-only backup, reset/clear data, import the backup, and confirm the prompt/history data returns.',
    'Open a musefold:// deeplink and confirm the import dialog appears; confirm only after reviewing, then verify the shared prompt is written.',
    'Record device model, Windows version, both artifact hashes, command/log evidence, and all checklist booleans in release/release-gate-evidence.json.',
  ];
}

function buildEvidenceSnippet(artifacts) {
  return {
    windowsArm64TargetRuntime: {
      checkedAt: new Date().toISOString(),
      device: '<Windows ARM64 device model>',
      windowsVersion: '<Windows 11 ARM64 build>',
      installerSha256: artifacts.installer?.sha256 ?? '<installer sha256>',
      appExeSha256: artifacts.appExe?.sha256 ?? '<Musefold.exe sha256>',
      checklist: {
        install: false,
        launch: false,
        fakeGeneration: false,
        mediaPreview: false,
        historyRecord: false,
        exportImport: false,
        deeplinkImport: false,
      },
    },
  };
}

async function writeSnippet(snippet) {
  if (!outPath || !snippet) return;
  const absPath = safePath(outPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, `${JSON.stringify(snippet, null, 2)}\n`, 'utf8');
  record('Windows ARM64 target-device evidence file', 'pass', outPath);
}

async function main() {
  const artifacts = await collectArtifacts();
  await checkPackagedDocsSync();
  const evidence = await readEvidence();
  if (artifacts.installer && artifacts.appExe) validateTargetEvidence(evidence, artifacts);
  else record('Windows ARM64 target-device evidence', 'manual', 'skipped until artifacts exist');

  const checklist = buildChecklist(artifacts);
  const evidenceSnippet = buildEvidenceSnippet(artifacts);
  await writeSnippet(evidenceSnippet);
  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({ artifacts, checks, checklist, evidenceSnippet, evidencePath, strict, ok }, null, 2));
  } else {
    console.log('Windows ARM64 target-device release checklist:');
    for (const check of checks) {
      const mark = check.status === 'pass' ? '[pass]' : check.status === 'fail' ? '[fail]' : '[manual]';
      console.log(`${mark} ${check.name}${check.details ? ` - ${check.details}` : ''}`);
    }
    console.log('\nArtifact hashes:');
    if (artifacts.installer) console.log(`- ${artifacts.installer.path}: ${artifacts.installer.sha256} (${artifacts.installer.bytes.toLocaleString('en-US')} bytes)`);
    if (artifacts.appExe) console.log(`- ${artifacts.appExe.path}: ${artifacts.appExe.sha256} (${artifacts.appExe.bytes.toLocaleString('en-US')} bytes)`);
    console.log('\nTarget-device checklist:');
    checklist.forEach((item, index) => console.log(`${index + 1}. ${item}`));
    console.log('\nEvidence JSON seed:');
    console.log(JSON.stringify(evidenceSnippet, null, 2));
    if (!strict && pending.length > 0) {
      console.log('\nUse --strict after recording the target-device evidence.');
    }
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
