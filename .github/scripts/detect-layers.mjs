#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../..');
const configPath = join(scriptDir, '..', 'layer-paths.yml');
const PRODUCT_LAYERS = ['content', 'service', 'shell'];
const ALL_GROUPS = ['infra', ...PRODUCT_LAYERS, 'desktop', 'docs'];
const ZERO_SHA = /^0+$/;

function lines(value) {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizePath(file) {
  return file.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Restricted YAML subset: full-line comments, `key:` maps, `- item` lists,
 * and optionally quoted scalars. Anything else throws.
 */
function parseRestrictedYaml(text, source = 'yaml') {
  /** @type {Record<string, string[]>} */
  const result = {};
  let currentKey = null;
  const rawLines = text.split(/\n/);
  for (let index = 0; index < rawLines.length; index++) {
    const line = rawLines[index].replace(/\r$/, '');
    const lineNo = index + 1;
    const where = `${source}:${lineNo}`;
    if (line.includes('\t')) {
      throw new Error(`${where}: tabs are not allowed`);
    }
    if (line.trim() === '') continue;
    if (line.trimStart().startsWith('#')) continue;

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      if (Object.hasOwn(result, currentKey)) {
        throw new Error(`${where}: duplicate key "${currentKey}"`);
      }
      result[currentKey] = [];
      continue;
    }

    const itemMatch = line.match(/^ {2}- (.+)$/);
    if (itemMatch) {
      if (!currentKey) {
        throw new Error(`${where}: list item without a key`);
      }
      result[currentKey].push(parseRestrictedScalar(itemMatch[1], where));
      continue;
    }

    throw new Error(`${where}: unsupported YAML syntax: ${JSON.stringify(line)}`);
  }
  return result;
}

function parseRestrictedScalar(raw, where) {
  const value = raw.trimEnd();
  if (value !== value.trimStart()) {
    throw new Error(`${where}: unexpected leading whitespace in list item`);
  }
  if (value.startsWith('"')) {
    if (value.length < 2 || !value.endsWith('"')) {
      throw new Error(`${where}: unterminated double quote`);
    }
    const inner = value.slice(1, -1);
    if (inner.includes('\\') || inner.includes('"')) {
      throw new Error(`${where}: escapes inside double quotes are not allowed`);
    }
    return inner;
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'")) {
      throw new Error(`${where}: unterminated single quote`);
    }
    const inner = value.slice(1, -1);
    if (inner.includes("'")) {
      throw new Error(`${where}: escapes inside single quotes are not allowed`);
    }
    return inner;
  }
  if (/[#:{}[\]&!|>@`]/.test(value)) {
    throw new Error(`${where}: unsupported unquoted scalar: ${JSON.stringify(value)}`);
  }
  return value;
}

function patternKind(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error(`Invalid layer path pattern: ${JSON.stringify(pattern)}`);
  }
  if (pattern.includes('\\')) {
    throw new Error(`Layer path pattern must use POSIX slashes: ${pattern}`);
  }
  if (pattern.endsWith('/**')) {
    const dir = pattern.slice(0, -3);
    if (!dir || dir.includes('*')) {
      throw new Error(`Illegal directory prefix pattern: ${pattern}`);
    }
    return 'dir';
  }
  if (pattern.startsWith('*.') && !pattern.includes('/')) {
    const ext = pattern.slice(1);
    if (ext.length < 2 || ext.includes('*')) {
      throw new Error(`Illegal extension pattern: ${pattern}`);
    }
    return 'ext';
  }
  if (pattern.includes('*')) {
    throw new Error(
      `Illegal pattern "${pattern}". Only directory prefixes (src/**) and extension/exact files (*.md, electron-builder.yml) are allowed.`,
    );
  }
  return 'exact';
}

function matchesPattern(file, pattern) {
  const kind = patternKind(pattern);
  if (kind === 'dir') {
    const dir = pattern.slice(0, -3);
    return file === dir || file.startsWith(`${dir}/`);
  }
  if (kind === 'ext') {
    const suffix = pattern.slice(1);
    const base = file.split('/').pop() ?? file;
    return base.endsWith(suffix) && base.length > suffix.length;
  }
  return file === pattern;
}

function loadLayerPaths() {
  const raw = readFileSync(configPath, 'utf8');
  const parsed = parseRestrictedYaml(raw, configPath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid ${configPath}: expected a mapping of layer → patterns`);
  }
  /** @type {Record<string, string[]>} */
  const groups = {};
  for (const name of ALL_GROUPS) {
    const patterns = parsed[name];
    if (!Array.isArray(patterns) || patterns.length === 0) {
      throw new Error(`layer-paths.yml missing non-empty "${name}" pattern list`);
    }
    for (const pattern of patterns) patternKind(pattern);
    groups[name] = patterns;
  }
  return groups;
}

function groupsForFile(file, groups) {
  const normalized = normalizePath(file);
  /** @type {string[]} */
  const hit = [];
  for (const name of ALL_GROUPS) {
    if (groups[name].some((pattern) => matchesPattern(normalized, pattern))) {
      hit.push(name);
    }
  }
  return hit;
}

function allProductTrue(extra = {}) {
  return {
    content: true,
    service: true,
    shell: true,
    desktop: true,
    docs_only: false,
    ...extra,
  };
}

function classifyFiles(files, groups = loadLayerPaths()) {
  const normalized = files.map(normalizePath).filter(Boolean);
  if (normalized.length === 0) {
    return {
      content: false,
      service: false,
      shell: false,
      desktop: false,
      docs_only: false,
      unmatched: [],
      fail_open: false,
    };
  }

  /** @type {string[]} */
  const unmatched = [];
  let infra = false;
  const hits = { content: false, service: false, shell: false, desktop: false, docs: false };

  for (const file of normalized) {
    const matched = groupsForFile(file, groups);
    if (matched.length === 0) {
      unmatched.push(file);
      continue;
    }
    if (matched.includes('infra')) infra = true;
    for (const name of ['content', 'service', 'shell', 'desktop', 'docs']) {
      if (matched.includes(name)) hits[name] = true;
    }
  }

  if (unmatched.length > 0) {
    return {
      ...allProductTrue({ unmatched, fail_open: true, reason: 'unmapped-path' }),
    };
  }
  if (infra) {
    return { ...allProductTrue({ unmatched: [], fail_open: false, reason: 'infra' }) };
  }

  const docs_only = hits.docs && !hits.content && !hits.service && !hits.shell;
  return {
    content: hits.content,
    service: hits.service,
    shell: hits.shell,
    desktop: hits.desktop,
    docs_only,
    unmatched: [],
    fail_open: false,
  };
}

function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  try {
    return JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
}

function gitDiff(args) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return lines(output);
  } catch {
    return null;
  }
}

function filesFromCli(argv) {
  if (argv.includes('--files-from')) {
    const index = argv.indexOf('--files-from');
    const source = argv[index + 1];
    if (!source) throw new Error('--files-from requires a path or -');
    const text = source === '-' ? readFileSync(0, 'utf8') : readFileSync(source, 'utf8');
    return lines(text);
  }
  if (process.env.LAYER_CHANGED_FILES) return lines(process.env.LAYER_CHANGED_FILES);
  return undefined;
}

function resolveChangedFiles(argv = process.argv.slice(2), env = process.env) {
  const fromCli = filesFromCli(argv);
  if (fromCli) return { files: fromCli, reason: 'cli' };

  const eventName = env.GITHUB_EVENT_NAME || '';
  if (eventName === 'workflow_dispatch') {
    return { files: null, reason: 'workflow_dispatch' };
  }

  const event = readEventPayload();
  if (event === null) return { files: null, reason: 'event-json' };

  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const base = env.BASE_SHA || event.pull_request?.base?.sha;
    const head = env.HEAD_SHA || event.pull_request?.head?.sha || env.GITHUB_SHA;
    if (!base || !head) return { files: null, reason: 'missing-pr-sha' };
    const files = gitDiff([`${base}...${head}`]);
    if (files == null) return { files: null, reason: 'git-diff' };
    return { files, reason: 'pull_request' };
  }

  if (eventName === 'push') {
    const before = event.before || env.BEFORE_SHA;
    const after = event.after || env.AFTER_SHA || env.GITHUB_SHA;
    if (!before || !after || ZERO_SHA.test(before)) {
      return { files: null, reason: 'push-before' };
    }
    const files = gitDiff([before, after]);
    if (files == null) return { files: null, reason: 'git-diff' };
    return { files, reason: 'push' };
  }

  return { files: null, reason: eventName || 'unknown-event' };
}

function outputsFromResolution(resolved, groups = loadLayerPaths()) {
  if (resolved.files == null) {
    return allProductTrue({ unmatched: [], fail_open: true, reason: resolved.reason });
  }
  return classifyFiles(resolved.files, groups);
}

function writeGithubOutput(result) {
  const target = process.env.GITHUB_OUTPUT;
  const rows = [
    `content=${result.content}`,
    `service=${result.service}`,
    `shell=${result.shell}`,
    `desktop=${result.desktop}`,
    `docs_only=${result.docs_only}`,
  ];
  const text = `${rows.join('\n')}\n`;
  if (target) appendFileSync(target, text);
  process.stdout.write(text);
  if (result.fail_open) {
    process.stderr.write(`detect-layers: fail-open (${result.reason || 'unknown'})\n`);
  }
}

function assertEqual(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${name}\n  expected ${e}\n  actual   ${a}`);
  }
  process.stdout.write(`ok  ${name}\n`);
}

function pick(result) {
  return {
    content: result.content,
    service: result.service,
    shell: result.shell,
    desktop: result.desktop,
    docs_only: result.docs_only,
    fail_open: Boolean(result.fail_open),
  };
}

function selfTest() {
  const groups = loadLayerPaths();

  assertEqual(
    'pure docs',
    pick(classifyFiles(['docs/v1.2.1/README.md', 'README.md', 'CONTRIBUTING.md'], groups)),
    {
      content: false,
      service: false,
      shell: false,
      desktop: false,
      docs_only: true,
      fail_open: false,
    },
  );
  assertEqual(
    'apps/web only → desktop=false (skip desktop E2E)',
    pick(classifyFiles(['apps/web/src/App.tsx'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: false,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'desktop renderer → content+desktop',
    pick(classifyFiles(['apps/desktop/src/pages/LibraryPage.tsx'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'desktop main process → shell+desktop',
    pick(classifyFiles(['apps/desktop/electron/main/window.ts'], groups)),
    {
      content: false,
      service: false,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/desktop-contracts → content+shell+desktop',
    pick(classifyFiles(['packages/desktop-contracts/src/ipc.ts'], groups)),
    {
      content: true,
      service: false,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'apps/web-api only → desktop=false',
    pick(classifyFiles(['apps/web-api/src/app.ts'], groups)),
    {
      content: false,
      service: true,
      shell: false,
      desktop: false,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/ui only → desktop=true',
    pick(classifyFiles(['packages/ui/src/primitives.tsx'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'root package.json (infra → all layers including desktop)',
    pick(classifyFiles(['package.json'], groups)),
    {
      content: true,
      service: true,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'tooling/** is infra → all layers including desktop',
    pick(classifyFiles(['tooling/dependency-cruiser.cjs'], groups)),
    {
      content: true,
      service: true,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'mixed docs + renderer',
    pick(classifyFiles(['docs/v1.2.1/V121-DELIVERY-PLAN.md', 'apps/desktop/src/pages/LibraryPage.tsx'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/contracts hits content, service, and desktop',
    pick(classifyFiles(['packages/contracts/src/index.ts'], groups)),
    {
      content: true,
      service: true,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/update-protocol hits content and shell',
    pick(classifyFiles(['packages/update-protocol/src/index.ts'], groups)),
    {
      content: true,
      service: false,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/core → shell+desktop (renderer does not import core)',
    pick(classifyFiles(['packages/core/src/index.ts'], groups)),
    {
      content: false,
      service: false,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'packages/domain → service+content+desktop',
    pick(classifyFiles(['packages/domain/src/index.ts'], groups)),
    {
      content: true,
      service: true,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'desktop tsconfig.node.json → shell+desktop (not infra)',
    pick(classifyFiles(['apps/desktop/tsconfig.node.json'], groups)),
    {
      content: false,
      service: false,
      shell: true,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'desktop tsconfig.web.json → content+desktop (not infra)',
    pick(classifyFiles(['apps/desktop/tsconfig.web.json'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: true,
      docs_only: false,
      fail_open: false,
    },
  );
  assertEqual(
    'unmapped path fail-open → desktop=true',
    pick(classifyFiles(['scripts/release-preflight.mjs'], groups)),
    { content: true, service: true, shell: true, desktop: true, docs_only: false, fail_open: true },
  );
  assertEqual('empty change list is not docs_only', pick(classifyFiles([], groups)), {
    content: false,
    service: false,
    shell: false,
    desktop: false,
    docs_only: false,
    fail_open: false,
  });
  assertEqual(
    'workflow_dispatch fail-open → desktop=true',
    pick(outputsFromResolution({ files: null, reason: 'workflow_dispatch' }, groups)),
    { content: true, service: true, shell: true, desktop: true, docs_only: false, fail_open: true },
  );
  assertEqual(
    'push before=0 / diff failure fail-open → desktop=true',
    pick(outputsFromResolution({ files: null, reason: 'push-before' }, groups)),
    { content: true, service: true, shell: true, desktop: true, docs_only: false, fail_open: true },
  );
  assertEqual(
    'web markdown is content, not docs_only, not desktop',
    pick(classifyFiles(['apps/web/README.md'], groups)),
    {
      content: true,
      service: false,
      shell: false,
      desktop: false,
      docs_only: false,
      fail_open: false,
    },
  );

  try {
    patternKind('tsconfig*');
    throw new Error('expected tsconfig* to be rejected');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Illegal pattern')) throw error;
    process.stdout.write('ok  reject illegal wildcard pattern\n');
  }

  try {
    parseRestrictedYaml('foo: [bar]\n', 'fixture');
    throw new Error('expected flow sequence to be rejected');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('unsupported YAML syntax'))
      throw error;
    process.stdout.write('ok  reject unsupported YAML syntax\n');
  }

  process.stdout.write('detect-layers self-test: all passed\n');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const groups = loadLayerPaths();
  const resolved = resolveChangedFiles(argv);
  const result = outputsFromResolution(resolved, groups);
  writeGithubOutput(result);
}

export { parseRestrictedYaml };

const invokedAsScript = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main();
}
