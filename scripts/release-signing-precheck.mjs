#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const strict = args.has('--strict');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: npm run release:signing:precheck -- [--strict] [--json]

Checks macOS Developer ID signing and notarization readiness without printing
credential values and without modifying release artifacts. Missing certificates
or Apple credentials are reported as manual/pending by default; use --strict on
the signing machine before public release.`);
  process.exit(0);
}

const checks = [];
let developerIdIdentityFound = false;
let appBundleExists = false;
let dmgExists = false;

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

async function fileSummary(path) {
  const stat = await lstat(safePath(path));
  if (!stat.isFile()) return `${path} (not a file)`;
  const content = await readFile(safePath(path));
  const hash = createHash('sha256').update(content).digest('hex');
  return `${path} (${stat.size.toLocaleString('en-US')} bytes, sha256 ${hash})`;
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

function firstLines(value, count = 3) {
  return `${value || ''}`
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, count)
    .join(' ');
}

function presentEnv(names) {
  return names.filter((name) => typeof process.env[name] === 'string' && process.env[name].trim().length > 0);
}

function missingEnv(names) {
  const present = new Set(presentEnv(names));
  return names.filter((name) => !present.has(name));
}

async function checkProjectConfig() {
  const pkg = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
  const builder = await readFile(safePath('electron-builder.yml'), 'utf8');
  const issues = [];
  if (!/^appId:\s*com\.musefold\.app\s*$/m.test(builder)) issues.push('appId must remain com.musefold.app');
  if (!/^productName:\s*Musefold\s*$/m.test(builder)) issues.push('productName must be Musefold');
  if (!/^\s+hardenedRuntime:\s*true\s*$/m.test(builder)) issues.push('mac.hardenedRuntime must be true');
  if (!/^\s+category:\s*public\.app-category\.productivity\s*$/m.test(builder)) issues.push('mac category missing');
  if (!pkg.scripts?.['package:mac']?.includes('run-builder.mjs --mac')) issues.push('package:mac must use run-builder');

  if (issues.length === 0) {
    record('macOS signing build configuration', 'pass', 'appId, hardened runtime, category, and package:mac script are present');
  } else {
    record('macOS signing build configuration', 'fail', issues.join('; '));
  }
}

function checkHostTools() {
  if (process.platform !== 'darwin') {
    record('macOS signing host tools', 'manual', `current platform is ${process.platform}; run on a macOS signing host`);
    return;
  }

  const checksToRun = [
    ['codesign', ['codesign']],
    ['security', ['security']],
    ['spctl', ['spctl']],
    ['hdiutil', ['hdiutil']],
    ['xcrun notarytool', ['xcrun', '-f', 'notarytool']],
    ['xcrun stapler', ['xcrun', '-f', 'stapler']],
  ];
  const missing = [];
  for (const [label, commandArgs] of checksToRun) {
    const result = commandArgs[0] === 'xcrun'
      ? run('xcrun', commandArgs.slice(1))
      : run('/usr/bin/which', commandArgs);
    if (result.status !== 0) missing.push(label);
  }

  if (missing.length === 0) {
    record('macOS signing host tools', 'pass', 'codesign, security, spctl, hdiutil, notarytool, and stapler are available');
  } else {
    record('macOS signing host tools', 'manual', `install or select Xcode command line tools; missing: ${missing.join(', ')}`);
  }
}

async function checkReleaseArtifacts() {
  const pkg = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
  const appPath = 'release/mac-arm64/Musefold.app';
  const dmgPath = `release/Musefold-${pkg.version}-arm64.dmg`;
  const zipPath = `release/Musefold-${pkg.version}-arm64-mac.zip`;
  appBundleExists = await exists(appPath);
  dmgExists = await exists(dmgPath);
  const zipExists = await exists(zipPath);

  const missing = [];
  if (!appBundleExists) missing.push(appPath);
  if (!dmgExists) missing.push(dmgPath);
  if (!zipExists) missing.push(zipPath);

  if (missing.length > 0) {
    record('macOS release artifacts for signing', 'manual', `build with npm run package:mac first; missing: ${missing.join(', ')}`);
    return;
  }

  record('macOS release artifacts for signing', 'pass', [
    appPath,
    await fileSummary(dmgPath),
    await fileSummary(zipPath),
  ].join('; '));
}

function checkDeveloperIdIdentity() {
  if (process.platform !== 'darwin') {
    record('Developer ID Application identity', 'manual', 'identity lookup requires macOS keychain');
    return;
  }

  const result = run('security', ['find-identity', '-v', '-p', 'codesigning']);
  if (result.status !== 0) {
    record('Developer ID Application identity', 'manual', firstLine(result.stderr || result.stdout) || 'security find-identity failed');
    return;
  }

  const identities = `${result.stdout || ''}`
    .split('\n')
    .filter((line) => /Developer ID Application:/.test(line) && /[A-Fa-f0-9]{40}/.test(line));
  developerIdIdentityFound = identities.length > 0;
  if (developerIdIdentityFound) {
    record('Developer ID Application identity', 'pass', `${identities.length} usable Developer ID Application identity found`);
  } else {
    record('Developer ID Application identity', 'manual', 'no Developer ID Application identity found in the current keychain');
  }
}

function checkSigningEnvironment() {
  const signingSelectors = ['CSC_LINK', 'CSC_NAME'];
  const apiKeyAuth = ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'];
  const appleIdAuth = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'];
  const signingSelectorPresent = presentEnv(signingSelectors);
  const apiKeyPresent = presentEnv(apiKeyAuth);
  const appleIdPresent = presentEnv(appleIdAuth);

  if (signingSelectorPresent.length > 0) {
    record('Code signing identity selection', 'pass', `${signingSelectorPresent.join(', ')} is set (values hidden)`);
  } else if (developerIdIdentityFound) {
    record('Code signing identity selection', 'pass', 'keychain Developer ID identity can be used; set CSC_NAME in CI for deterministic selection');
  } else {
    record('Code signing identity selection', 'manual', 'set CSC_LINK or CSC_NAME, or import a Developer ID Application certificate into the signing keychain');
  }

  if (apiKeyPresent.length === apiKeyAuth.length) {
    record('Apple notarization credentials', 'pass', `${apiKeyAuth.join(', ')} are set (values hidden)`);
  } else if (appleIdPresent.length === appleIdAuth.length) {
    record('Apple notarization credentials', 'pass', `${appleIdAuth.join(', ')} are set (values hidden)`);
  } else {
    const missingApi = missingEnv(apiKeyAuth);
    const missingAppleId = missingEnv(appleIdAuth);
    record(
      'Apple notarization credentials',
      'manual',
      `set either ${apiKeyAuth.join('+')} (missing ${missingApi.join(', ') || 'none'}) or ${appleIdAuth.join('+')} (missing ${missingAppleId.join(', ') || 'none'})`
    );
  }
}

async function checkCurrentSignatureState() {
  const pkg = JSON.parse(await readFile(safePath('package.json'), 'utf8'));
  const appPath = 'release/mac-arm64/Musefold.app';
  const dmgPath = `release/Musefold-${pkg.version}-arm64.dmg`;

  if (process.platform !== 'darwin') {
    record('Current app bundle code signature', 'manual', 'codesign verification requires macOS');
    record('Gatekeeper assessment', 'manual', 'spctl assessment requires macOS');
    record('Notarization ticket staple validation', 'manual', 'xcrun stapler validation requires macOS');
    return;
  }

  if (!appBundleExists) {
    record('Current app bundle code signature', 'manual', 'app bundle missing; build package before verifying signature');
  } else {
    const result = run('codesign', ['--verify', '--deep', '--strict', safePath(appPath)]);
    if (result.status === 0) {
      record('Current app bundle code signature', 'pass', 'codesign --verify --deep --strict passed');
      const spctl = run('spctl', ['--assess', '--type', 'execute', '--verbose=4', safePath(appPath)]);
      if (spctl.status === 0) {
        record('Gatekeeper assessment', 'pass', firstLine(spctl.stderr || spctl.stdout) || 'spctl assessment passed');
      } else {
        record('Gatekeeper assessment', 'manual', firstLine(spctl.stderr || spctl.stdout) || 'spctl assessment pending until notarization is accepted');
      }
    } else {
      record('Current app bundle code signature', 'manual', firstLine(result.stderr || result.stdout) || 'app bundle is not signed yet');
      record('Gatekeeper assessment', 'manual', 'skipped until codesign verification passes');
    }
  }

  if (!dmgExists) {
    record('Notarization ticket staple validation', 'manual', 'DMG missing; build package before stapler validation');
  } else {
    const result = run('xcrun', ['stapler', 'validate', safePath(dmgPath)]);
    if (result.status === 0) {
      record('Notarization ticket staple validation', 'pass', firstLine(result.stdout || result.stderr) || 'stapler validate passed');
    } else {
      record('Notarization ticket staple validation', 'manual', firstLines(result.stderr || result.stdout) || 'notarization ticket is not stapled yet');
    }
  }
}

function addRunbook() {
  record(
    'Signing runbook',
    'pass',
    'On the signing host: set CSC_NAME/CSC_LINK and Apple notarization env, run npm run package:mac -- -c.mac.notarize=true, then verify codesign, spctl, and xcrun stapler validate.'
  );
}

async function main() {
  await checkProjectConfig();
  checkHostTools();
  await checkReleaseArtifacts();
  checkDeveloperIdIdentity();
  checkSigningEnvironment();
  await checkCurrentSignatureState();
  addRunbook();

  const failed = checks.filter((check) => check.status === 'fail');
  const pending = checks.filter((check) => check.status === 'manual');
  const ok = failed.length === 0 && (!strict || pending.length === 0);

  if (json) {
    console.log(JSON.stringify({ checks, strict, ok }, null, 2));
  } else {
    console.log('macOS Developer ID signing precheck:');
    for (const check of checks) {
      const mark = check.status === 'pass' ? '[pass]' : check.status === 'fail' ? '[fail]' : '[manual]';
      console.log(`${mark} ${check.name}${check.details ? ` - ${check.details}` : ''}`);
    }
    if (!strict && pending.length > 0) {
      console.log('\nUse --strict on the signing machine before public release.');
    }
  }

  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
