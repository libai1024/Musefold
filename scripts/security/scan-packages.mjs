#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanArtifacts } from './artifact-scan.mjs';
import { RULESET_VERSION } from './content-scan.mjs';
import { extractVerifiedInstaller } from './installer-extraction.mjs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
function execute(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error('ARTIFACT_EXTRACTION_FAILED');
}

export async function scanPackages({ repoRoot, platform = process.platform, arch = process.arch }) {
  if (
    platform !== process.platform ||
    arch !== process.arch ||
    !['darwin', 'win32'].includes(platform)
  )
    throw new Error('UNSUPPORTED_SCAN_PLATFORM');
  const version = JSON.parse(
    readFileSync(join(repoRoot, 'apps/desktop/package.json'), 'utf8'),
  ).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('INVALID_ARTIFACT_VERSION');
  const directory = mkdtempSync(join(tmpdir(), 'musefold-installer-scan-'));
  const artifacts = [];
  const targets = [];
  const declaredExclusions = [];
  let mounted = false;
  const mount = join(directory, 'mounted');
  try {
    if (platform === 'darwin') {
      if (!['arm64', 'x64'].includes(arch)) throw new Error('UNSUPPORTED_SCAN_PLATFORM');
      const app = join(repoRoot, `release/${arch === 'arm64' ? 'mac-arm64' : 'mac'}/Musefold.app`);
      const dmg = join(repoRoot, `release/Musefold-${version}-${arch}.dmg`);
      const zip = join(repoRoot, `release/Musefold-${version}-${arch}-mac.zip`);
      for (const file of [app, dmg, zip])
        if (!existsSync(file)) throw new Error('MISSING_ARTIFACT');
      const bundlePaths = [
        'Contents/Resources/app.asar',
        'Contents/Resources/integration/musefold-cli.mjs',
        'Contents/Resources/integration/musefold-mcp.mjs',
      ];
      const expectedFiles = await Promise.all(
        bundlePaths.map(async (entry) => ({ entry, sha256: await sha256(join(app, entry)) })),
      );
      mkdirSync(mount);
      execute('hdiutil', ['verify', dmg]);
      execute('hdiutil', [
        'attach',
        '-readonly',
        '-nobrowse',
        '-noautoopen',
        '-mountpoint',
        mount,
        dmg,
      ]);
      mounted = true;
      for (const [index, name] of readdirSync(mount).sort().entries()) {
        const path = join(mount, name);
        const stat = lstatSync(path);
        if (
          name === 'Applications' &&
          stat.isSymbolicLink() &&
          readlinkSync(path) === '/Applications'
        ) {
          declaredExclusions.push({
            artifact: 'mac-dmg',
            entry: 'Applications',
            reason:
              'Installer shortcut to the OS Applications directory; no packaged bytes at this link.',
          });
          continue;
        }
        targets.push({
          id: `mac-dmg-entry-${index}`,
          kind: stat.isDirectory() ? 'tree' : 'file',
          path,
          expectedFiles: name === 'Musefold.app' ? expectedFiles : [],
        });
      }
      if (!existsSync(join(mount, 'Musefold.app/Contents/Resources/app.asar')))
        throw new Error('MISSING_ARTIFACT');
      artifacts.push(
        { id: 'mac-dmg', sha256: await sha256(dmg) },
        { id: 'mac-zip', sha256: await sha256(zip) },
      );
      targets.push(
        { id: 'mac-app', kind: 'tree', path: app, expectedFiles },
        {
          id: 'mac-zip',
          kind: 'zip',
          path: zip,
          expectedFiles: expectedFiles.map((entry) => ({
            ...entry,
            entry: `.!/Musefold.app/${entry.entry}`,
          })),
        },
      );
    } else {
      if (!['arm64', 'x64', 'ia32'].includes(arch)) throw new Error('UNSUPPORTED_SCAN_PLATFORM');
      const extractionBudget = { entries: 0, bytes: 0 };
      const unpacked = join(
        repoRoot,
        `release/${arch === 'arm64' ? 'win-arm64-unpacked' : 'win-unpacked'}`,
      );
      // Match the current builder filename rather than selecting the first installer from a
      // previous version. The NSIS target is a compressed installer and must be extracted.
      const installer = join(repoRoot, 'release', `Musefold-${version}-${arch}-Setup.exe`);
      if (!existsSync(installer) || !existsSync(join(unpacked, 'Musefold.exe')))
        throw new Error('MISSING_ARTIFACT');
      const expectedFiles = await Promise.all(
        [
          'resources/app.asar',
          `resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-${arch}.node`,
          `resources/integration/node_modules/better-sqlite3/prebuilds/win32-${arch}.node`,
          'resources/integration/musefold-cli.mjs',
          'resources/integration/musefold-mcp.mjs',
        ].map(async (entry) => ({ entry, sha256: await sha256(join(unpacked, entry)) })),
      );
      const extracted = join(directory, 'installer');
      extractVerifiedInstaller(installer, extracted, { budget: extractionBudget });
      // NSIS often nests the application in app-<arch>.7z. Expand it into its own directory;
      // leave all other entries in scope and reject any remaining compressed container.
      const nested = readdirSync(extracted, { recursive: true }).filter(
        (name) => typeof name === 'string' && name.toLowerCase().endsWith('.7z'),
      );
      for (const [index, name] of nested.entries()) {
        const compressed = join(extracted, name);
        const expanded = join(directory, `payload-${index}`);
        artifacts.push({ id: `windows-payload-${index}`, sha256: await sha256(compressed) });
        extractVerifiedInstaller(compressed, expanded, { budget: extractionBudget });
        rmSync(compressed);
        targets.push({
          id: `windows-payload-${index}`,
          kind: 'tree',
          path: expanded,
          expectedFiles,
        });
      }
      if (nested.length === 0 && !existsSync(join(extracted, 'resources/app.asar')))
        throw new Error('MISSING_ARTIFACT');
      artifacts.push({ id: 'windows-installer', sha256: await sha256(installer) });
      targets.push(
        { id: 'windows-unpacked', kind: 'tree', path: unpacked, expectedFiles },
        {
          id: 'windows-installer',
          kind: 'tree',
          path: extracted,
          expectedFiles: nested.length === 0 ? expectedFiles : [],
        },
      );
    }
    const report = await scanArtifacts({
      targets,
      canaries: [{ id: 'build-user-path', value: homedir() }],
    });
    return { ...report, platform, arch, version, artifacts, declaredExclusions };
  } finally {
    if (mounted) execute('hdiutil', ['detach', mount]);
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function runPackageScan(
  argv,
  { repoRoot = fileURLToPath(new URL('../..', import.meta.url)), scan = scanPackages } = {},
) {
  const reportPath = resolve(
    repoRoot,
    argv[0] && !argv[0].startsWith('-') ? argv[0] : 'tests/v25/.results/package/security.json',
  );
  let result;
  try {
    if (argv.length !== 1 || !argv[0] || argv[0].startsWith('-'))
      throw new Error('EXPECTED_REPORT_PATH');
    result = await scan({ repoRoot });
  } catch (error) {
    const allowed =
      /^(?:EXPECTED_REPORT_PATH|UNSUPPORTED_SCAN_PLATFORM|INVALID_ARTIFACT_VERSION|MISSING_ARTIFACT|ARTIFACT_EXTRACTION_FAILED|INVALID_EXTRACTION_LIMIT|INVALID_INSTALLER_PATH|INVALID_INSTALLER_LIST|INSTALLER_LIST_LIMIT|INSTALLER_ENTRY_LIMIT|INSTALLER_TOTAL_LIMIT|INSTALLER_LINK_REJECTED|ENCRYPTED_INSTALLER|INSTALLER_COMMAND_FAILED|INVALID_INSTALLER_SOURCE|INSTALLER_DESTINATION_EXISTS|INSTALLER_CONTENT_CHANGED)$/;
    result = {
      ok: false,
      fatal: true,
      ruleset: RULESET_VERSION,
      startedAt: new Date().toISOString(),
      targets: [],
      findings: [],
      accepted: [],
      artifacts: [],
      declaredExclusions: [],
      errors: [{ code: allowed.test(error?.message) ? error.message : 'PACKAGE_SCAN_FAILED' }],
    };
  }
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runPackageScan(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(
        `${JSON.stringify({ ok: result.ok, artifacts: result.artifacts.length, targets: result.targets.length, findings: result.findings.length, errors: result.errors.length })}\n`,
      );
      process.exitCode = result.ok ? 0 : result.fatal ? 2 : 1;
    })
    .catch(() => {
      process.stderr.write('PACKAGE_REPORT_WRITE_FAILED\n');
      process.exitCode = 2;
    });
}
