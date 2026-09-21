#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanArtifacts } from './artifact-scan.mjs';

export async function runScan(argv) {
  const mode = argv[0];
  const options = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (
      !['--plan', '--report', '--repo-root', '--exceptions'].includes(argv[i]) ||
      !argv[i + 1] ||
      argv[i + 1].startsWith('--') ||
      options[argv[i]]
    )
      throw new Error('INVALID_ARGUMENTS');
    options[argv[i]] = argv[i + 1];
  }
  if (
    !['source', 'plan'].includes(mode) ||
    !options['--report'] ||
    (mode === 'plan' && !options['--plan'])
  )
    throw new Error('INVALID_ARGUMENTS');
  const directory = mkdtempSync(join(tmpdir(), 'musefold-source-scan-'));
  let plan;
  try {
    if (mode === 'source') {
      const root = resolve(
        options['--repo-root'] || fileURLToPath(new URL('../..', import.meta.url)),
      );
      const files = execFileSync(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      )
        .split('\0')
        .filter(Boolean);
      for (const file of new Set(files)) {
        // Explicit source/config roots; userData, ignored secrets, build output and unrelated
        // personal drafts are never discovered by this mode. Artifacts use explicit plans.
        if (
          !/^(?:apps\/|packages\/|scripts\/|tests\/|tooling\/|infra\/|\.github\/|[^/]+\.(?:[cm]?[jt]sx?|json|ya?ml|toml)$|\.(?:npmrc|dockerignore|gitignore)$)/.test(
            file,
          )
        )
          continue;
        if (!existsSync(join(root, file))) continue;
        if (lstatSync(join(root, file)).isSymbolicLink()) {
          const resolved = relative(realpathSync(root), realpathSync(join(root, file)));
          if (isAbsolute(resolved) || resolved === '..' || resolved.startsWith(`..${sep}`))
            throw new Error('EXTERNAL_SYMLINK');
        }
        const dest = join(directory, file);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(join(root, file), dest);
      }
      plan = { targets: [{ id: 'source', kind: 'tree', path: directory }] };
    } else {
      plan = JSON.parse(readFileSync(options['--plan'], 'utf8'));
    }
    if (options['--exceptions'])
      plan.exceptions = JSON.parse(readFileSync(options['--exceptions'], 'utf8'));
    const result = await scanArtifacts(plan);
    const reportPath = resolve(options['--report']);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runScan(process.argv.slice(2))
    .then((report) => {
      process.stdout.write(
        `${JSON.stringify({ ok: report.ok, targets: report.targets.length, findings: report.findings.length, errors: report.errors.length, ruleset: report.ruleset })}\n`,
      );
      process.exitCode = report.ok ? 0 : 1;
    })
    .catch(() => {
      // Parser/IO exceptions can contain canaries, absolute directories, or archive names.
      process.stderr.write('SCAN_CONFIGURATION_FAILED\n');
      process.exitCode = 2;
    });
}
