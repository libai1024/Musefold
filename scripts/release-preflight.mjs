#!/usr/bin/env node
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: npm run release:preflight -- [--json]

Runs fast local release-readiness checks that do not require real APIs,
Windows hardware, hosted CI, or signing certificates. Manual gates are
reported separately and remain required before public release.`);
  process.exit(0);
}

const checks = [];

function relPath(absPath) {
  return relative(repoRoot, absPath).replaceAll('\\', '/');
}

function safePath(path) {
  const absPath = resolve(repoRoot, path);
  const normalized = relative(repoRoot, absPath);
  if (!normalized || normalized.startsWith('..') || isAbsolute(normalized)) {
    throw new Error(`Unsafe path outside repo root: ${path}`);
  }
  return absPath;
}

async function readText(path) {
  return readFile(safePath(path), 'utf8');
}

function pass(name, details = '') {
  checks.push({ name, status: 'pass', details });
}

function fail(name, details = '') {
  checks.push({ name, status: 'fail', details });
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

async function collectFiles(baseRel, extensions) {
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
      if (entry.name === 'node_modules' || entry.name === '.venv-test') continue;
      const absChild = resolve(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absChild);
      } else if (entry.isFile() && extensions.has(extname(entry.name))) {
        output.push(absChild);
      }
    }
  }

  await walk(baseAbs);
  return output;
}

async function checkNoNativeSelect() {
  const files = await collectFiles('apps/desktop/src', new Set(['.ts', '.tsx', '.js', '.jsx']));
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (/<\s*select(?:\s|>)/.test(text)) hits.push(relPath(file));
  }
  if (hits.length === 0) {
    pass('No native select elements in renderer source', 'custom app select/menu controls only');
  } else {
    fail('No native select elements in renderer source', hits.join(', '));
  }
}

async function checkLegacyGenerationState() {
  const files = [
    ...(await collectFiles('apps/desktop/src', new Set(['.ts', '.tsx']))),
    ...(await collectFiles('apps/desktop/electron', new Set(['.ts', '.tsx', '.js', '.cjs']))),
    ...(await collectFiles('packages', new Set(['.ts', '.tsx']))),
    ...(await collectFiles('tests', new Set(['.ts', '.tsx', '.py', '.json']))),
  ];
  const patterns = [
    /\buseStudioStore\b/,
    /features\/studio/,
    /\bstores\.studio\b/,
    /\blegacyStudio\b/,
    /\brequestRefine\b/,
    /\bgenerateRefine\b/,
  ];
  const hits = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (patterns.some((pattern) => pattern.test(text))) hits.push(relPath(file));
  }
  if (hits.length === 0) {
    pass('Legacy Studio/generation APIs are absent', 'Workbench owns draft, turns, cancel, retry, and submit');
  } else {
    fail('Legacy Studio/generation APIs are absent', hits.join(', '));
  }
}

async function checkRatioOptions() {
  const constants = await readText('packages/domain/src/constants.ts');
  const picker = await readText('apps/desktop/src/features/generation/components/RatioPicker.tsx');
  const required = ['1:1', '2:3', '3:4', '3:2', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto'];
  const missing = required.filter((id) => !constants.includes(`id: '${id}'`));
  if (missing.length === 0 && picker.includes('RatioSelectionPreview') && picker.includes('RatioOptionGrid')) {
    pass('Ratio picker keeps visual previews and legacy ratios', required.join(', '));
  } else {
    fail('Ratio picker keeps visual previews and legacy ratios', `missing/options: ${missing.join(', ') || 'none'}`);
  }
}

async function checkRoadmap() {
  const roadmap = await readText('docs/product/90-roadmap-and-task-index.md');
  const taskRows = [...roadmap.matchAll(/^\| (TASK-[A-Z]+-\d+) \| ([^|]+) \|/gm)];
  const incomplete = taskRows
    .filter((row) => !row[2].includes('✅'))
    .map((row) => `${row[1]}=${row[2].trim()}`);
  if (taskRows.length === 85 && incomplete.length === 0) {
    pass('Product roadmap task index is fully closed', '85 TASK rows, all ✅');
  } else {
    fail('Product roadmap task index is fully closed', `${taskRows.length} rows; incomplete: ${incomplete.join(', ') || 'none'}`);
  }

  const requiredExternalGatePhrases = [
    'Windows 目标平台运行',
    'Developer ID 签名/公证',
    '真实生图',
    '远端首跑',
  ];
  const missing = requiredExternalGatePhrases.filter((phrase) => !roadmap.includes(phrase));
  if (missing.length === 0) {
    pass('Roadmap keeps external release gates explicit', requiredExternalGatePhrases.join(', '));
  } else {
    fail('Roadmap keeps external release gates explicit', `missing: ${missing.join(', ')}`);
  }
}

async function checkDocsAndWorkflow() {
  const pkg = JSON.parse(await readText('package.json'));
  const readme = await readText('docs/product/README.md');
  const sourceWorkflow = await readText('.github/workflows/ci.yml');
  const desktopWorkflow = await readText('.github/workflows/desktop-ci.yml');
  const packageWorkflow = await readText('.github/workflows/package-smoke.yml');
  const deployWorkflow = await readText('.github/workflows/deploy.yml');
  const workflow = `${sourceWorkflow}\n${desktopWorkflow}\n${packageWorkflow}\n${deployWorkflow}`;

  const scriptExpectations = [
    ['hooks:install', 'node scripts/install-git-hooks.mjs'],
    ['skill:check', 'node scripts/check-skill-update.mjs'],
    ['skill:check:ci', 'node scripts/check-skill-update.mjs --ci'],
    ['package', 'node scripts/run-builder.mjs'],
    ['package:mac', 'node scripts/run-builder.mjs --mac'],
    ['package:win', 'node scripts/run-builder.mjs --win'],
    ['release:preflight', 'node scripts/release-preflight.mjs'],
    ['release:status', 'node scripts/release-gate-status.mjs'],
    ['release:evidence', 'node scripts/release-gate-evidence.mjs'],
    ['release:ci:evidence', 'node scripts/release-ci-evidence.mjs'],
    ['release:windows:hosted', 'node scripts/release-windows-hosted-evidence.mjs'],
    ['release:macos:signing', 'node scripts/release-macos-signing-evidence.mjs'],
    ['release:signing:precheck', 'node scripts/release-signing-precheck.mjs'],
    ['release:windows:target', 'node scripts/release-windows-target-checklist.mjs'],
    ['clean:artifacts', 'node scripts/clean-artifacts.mjs'],
    ['deploy:prod', 'node scripts/deploy/run.mjs'],
    ['deploy:rollback', 'node scripts/deploy/rollback.mjs'],
    ['deploy:desktop', 'node scripts/deploy/publish-desktop.mjs'],
  ];
  const missingScripts = scriptExpectations
    .filter(([name, needle]) => !pkg.scripts?.[name]?.includes(needle))
    .map(([name]) => name);
  const wrapper = await readText('scripts/run-builder.mjs');
  const evidenceScript = await readText('scripts/release-gate-evidence.mjs');
  const evidenceTemplate = await readText('docs/release-gate-evidence.template.json');
  const ciEvidence = await readText('scripts/release-ci-evidence.mjs');
  const windowsHostedEvidence = await readText('scripts/release-windows-hosted-evidence.mjs');
  const macosSigningEvidence = await readText('scripts/release-macos-signing-evidence.mjs');
  const signingPrecheck = await readText('scripts/release-signing-precheck.mjs');
  const windowsTargetChecklist = await readText('scripts/release-windows-target-checklist.mjs');
  const evidenceReady =
    evidenceScript.includes('githubActionsRemoteGreen') &&
    evidenceScript.includes('upstreamRealImageGeneration') &&
    evidenceTemplate.includes('"macosDeveloperIdNotarization"');
  const ciEvidenceReady =
    ciEvidence.includes('githubActionsRemoteGreen') &&
    ciEvidence.includes('/actions/runs/${runId}/jobs') &&
    ciEvidence.includes('GITHUB_TOKEN') &&
    ciEvidence.includes('windowsPackageAndRuntimeSmoke');
  const windowsHostedReady =
    windowsHostedEvidence.includes('windowsHostedRuntimeSmoke') &&
    windowsHostedEvidence.includes('windows_runtime_smoke.py') &&
    windowsHostedEvidence.includes('--runtime-smoke-passed') &&
    windowsHostedEvidence.includes('installerSha256');
  const macosSigningReady =
    macosSigningEvidence.includes('macosDeveloperIdNotarization') &&
    macosSigningEvidence.includes('codesign --verify') &&
    macosSigningEvidence.includes('stapler validate') &&
    macosSigningEvidence.includes('notarizationAccepted');
  const signingPrecheckReady =
    signingPrecheck.includes('Developer ID Application') &&
    signingPrecheck.includes('APPLE_API_KEY') &&
    signingPrecheck.includes('stapler validate');
  const windowsTargetReady =
    windowsTargetChecklist.includes('windowsArm64TargetRuntime') &&
    windowsTargetChecklist.includes('PE_MACHINE_ARM64') &&
    windowsTargetChecklist.includes('musefold://');
  if (missingScripts.length === 0 && wrapper.includes('restored apps/desktop/package.json after electron-builder metadata pruning') && evidenceReady && ciEvidenceReady && windowsHostedReady && macosSigningReady && signingPrecheckReady && windowsTargetReady) {
    pass('Package scripts protect the development manifest during packaging', 'run-builder restores apps/desktop/package.json after electron-builder');
  } else {
    const details = [`missing/unsafe scripts: ${missingScripts.join(', ') || 'none'}`];
    if (!evidenceReady) details.push('release gate evidence script/template missing');
    if (!ciEvidenceReady) details.push('CI remote evidence helper missing');
    if (!windowsHostedReady) details.push('Windows hosted runtime evidence helper missing');
    if (!macosSigningReady) details.push('macOS signing evidence helper missing');
    if (!signingPrecheckReady) details.push('release signing precheck missing');
    if (!windowsTargetReady) details.push('Windows ARM64 target checklist missing');
    fail('Package scripts protect the development manifest during packaging', details.join('; '));
  }

  const docsNeedles = [
    '85 张任务卡 → ✅ 85 · 🚧 0 · 📋 0',
    '旧 Chat/Studio 页面组件与 `studio/store` 已清理',
    'Windows 目标平台运行',
    'Developer ID 签名/公证',
    '签名环境预检',
    'Windows hosted runner 证据脚本',
    'macOS 签名公证证据脚本',
    'Windows ARM64 目标机验收清单',
    'CI 远端绿灯证据脚本',
    '真实 TvT API 单图验收',
  ];
  const docsMissing = docsNeedles.filter((needle) => !readme.includes(needle));
  if (docsMissing.length === 0) {
    pass('Product README summarizes desktop state without overclaiming', 'local complete, external gates still named');
  } else {
    fail('Product README summarizes desktop state without overclaiming', docsMissing.join(', '));
  }

  const workflowNeedles = [
    'fetch-depth: 0',
    'npm run skill:check:ci',
    'npx turbo run typecheck test build lint check:boundaries check:ui-boundaries',
    'npm run clean:artifacts',
    'npm run release:preflight',
    'xvfb-run -a --server-args="-screen 0 1920x1080x24 -ac +extension GLX +render -noreset"',
    'python -m pytest "$PYTEST_TARGET"',
    'name: Desktop CI',
    'Windows Electron E2E',
    'Linux Electron E2E',
    'runs-on: windows-latest',
    // Platform tiers: Linux blocks on the full suite, Windows skips the tests
    // that need an interactive desktop it does not have.
    'blocking: true',
    'markers: not gui',
    'publish-installers',
    'scripts/deploy/publish-desktop.mjs',
    'version=latest',
    'node scripts/run-builder.mjs --mac --arm64 --dir',
    'node scripts/sign-macos-adhoc.mjs',
    'hdiutil verify',
    'npm run package:win -- --arm64',
    'windows_runtime_smoke.py',
    'npm run release:windows:hosted',
    'windows-hosted-runtime-evidence',
    'actions/upload-artifact@v4',
    'npm run release:macos:signing',
    'macosDeveloperIdNotarization',
    'MUSEFOLD_TVT_KEY: ""',
    'musefold-prod',
    'scripts/deploy/run.mjs',
    'workflow_run',
  ];
  const workflowMissing = workflowNeedles.filter((needle) => !workflow.includes(needle));
  const duplicatedPathBlock = /(^|\n)[ \t]+path:\s*\|\s*\r?\n[ \t]+path:\s*\|/.test(workflow);
  if (workflowMissing.length === 0 && !duplicatedPathBlock) {
    pass('CI workflow covers source, E2E, package, Windows host runtime smoke, and production deploy', '.github/workflows/ci.yml + desktop-ci.yml + package-smoke.yml + deploy.yml');
  } else {
    const details = [];
    if (workflowMissing.length > 0) details.push(`missing: ${workflowMissing.join(', ')}`);
    if (duplicatedPathBlock) details.push('malformed duplicate path: | block');
    fail('CI workflow covers source, E2E, package, Windows host runtime smoke, and production deploy', details.join('; '));
  }
}

function releaseVersionFamily(version) {
  const match = String(version).match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+)?)(?:\.\d+)?$/);
  return match?.[1] ?? String(version);
}

async function checkV14ReleaseVersionSync() {
  const pkg = JSON.parse(await readText('apps/desktop/package.json'));
  const websiteHtml = await readText('website/Musefold/index.html');
  const jsonLdMatch = websiteHtml.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  let websiteVersion;
  try {
    websiteVersion = JSON.parse(jsonLdMatch?.[1] ?? '{}').softwareVersion ?? '';
  } catch {
    fail('v1.4 release versions stay synchronized', 'website JSON-LD is not valid JSON');
    return;
  }

  const catalogPaths = ['website/Musefold/downloads/catalog.json', 'services/musefold-downloads/catalog.json'];
  const catalogs = await Promise.all(catalogPaths.map(async (path) => ({ path, value: JSON.parse(await readText(path)) })));
  const appVersion = String(pkg.version);
  const expectedFamily = releaseVersionFamily(appVersion);
  const formalRelease = !appVersion.includes('-');
  const expectedVersion = formalRelease ? appVersion : expectedFamily;
  const versions = [websiteVersion, ...catalogs.map(({ value }) => String(value.currentVersion))];
  const versionMismatch = versions.filter((version) => version !== expectedVersion);
  const latestPathMismatch = catalogs.flatMap(({ path, value }) =>
    (Array.isArray(value.downloads) ? value.downloads : [])
      .filter((entry) => entry?.version === 'latest')
      .filter((entry) => !String(entry.path).includes(`/downloads/${value.currentVersion}/`))
      .map((entry) => `${path}: ${entry.path}`),
  );

  if (versionMismatch.length === 0 && latestPathMismatch.length === 0) {
    pass(
      'v1.4 release versions stay synchronized',
      `${formalRelease ? 'formal' : 'development'} release version ${expectedVersion}; website JSON-LD and both catalogs agree`,
    );
  } else {
    const details = [];
    if (versionMismatch.length > 0) details.push(`versions: ${versions.join(', ')}`);
    if (latestPathMismatch.length > 0) details.push(`latest paths: ${latestPathMismatch.join(', ')}`);
    fail('v1.4 release versions stay synchronized', details.join('; '));
  }
}

async function checkNoLikelyLiveKeys() {
  const files = [
    ...(await collectFiles('apps/desktop/src', new Set(['.ts', '.tsx', '.js', '.jsx']))),
    ...(await collectFiles('apps/desktop/electron', new Set(['.ts', '.tsx', '.js', '.cjs']))),
    ...(await collectFiles('packages', new Set(['.ts', '.tsx']))),
    ...(await collectFiles('tests', new Set(['.ts', '.tsx', '.py']))),
    ...(await collectFiles('docs', new Set(['.md', '.json']))),
  ];
  const hits = [];
  const likelyLiveKey = /sk-[a-f0-9]{40,}/gi;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if (likelyLiveKey.test(text)) hits.push(relPath(file));
    likelyLiveKey.lastIndex = 0;
  }
  if (hits.length === 0) {
    pass('No likely live API keys in source, tests, or docs', 'allows short fake test keys only');
  } else {
    fail('No likely live API keys in source, tests, or docs', hits.join(', '));
  }
}

async function checkGeneratedArtifactsClean() {
  const staticArtifacts = [
    '.electron-driver',
    '.pytest_cache',
    'test-results',
    'tsconfig.node.tsbuildinfo',
    'tsconfig.web.tsbuildinfo',
  ];
  const found = [];
  for (const artifact of staticArtifacts) {
    if (await exists(artifact)) found.push(artifact);
  }

  async function walkForPycache(baseRel) {
    const baseAbs = safePath(baseRel);
    async function walk(absDir) {
      let entries;
      try {
        entries = await readdir(absDir, { withFileTypes: true });
      } catch (error) {
        if (error && error.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === '.venv-test') continue;
        const absChild = resolve(absDir, entry.name);
        if (entry.name === '__pycache__') {
          found.push(relPath(absChild));
        } else {
          await walk(absChild);
        }
      }
    }
    await walk(baseAbs);
  }

  await walkForPycache('tests');
  if (found.length === 0) {
    pass('Generated test/cache artifacts are clean', 'release/ and out/ are intentionally not removed here');
  } else {
    fail('Generated test/cache artifacts are clean', `run npm run clean:artifacts; found: ${found.join(', ')}`);
  }
}

async function main() {
  await checkNoNativeSelect();
  await checkLegacyGenerationState();
  await checkRatioOptions();
  await checkRoadmap();
  await checkDocsAndWorkflow();
  await checkV14ReleaseVersionSync();
  await checkNoLikelyLiveKeys();
  await checkGeneratedArtifactsClean();

  const manualGates = [
    'GitHub Actions remote CI first green run',
    'Windows hosted runner x64 installed-app runtime smoke',
    'Windows ARM64 target-device install/runtime smoke',
    'Developer ID signing and macOS notarization',
  ];

  const failed = checks.filter((check) => check.status === 'fail');
  const warned = checks.filter((check) => check.status === 'warn');
  if (json) {
    console.log(JSON.stringify({ checks, manualGates, ok: failed.length === 0 }, null, 2));
  } else {
    for (const check of checks) {
      const mark = check.status === 'pass' ? '✓' : check.status === 'warn' ? '!' : '✗';
      console.log(`${mark} ${check.name}${check.details ? ` — ${check.details}` : ''}`);
    }
    if (warned.length > 0) console.log(`Warnings: ${warned.length}`);
    console.log('\nManual gates still required before public release:');
    for (const gate of manualGates) console.log(`- ${gate}`);
  }

  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
