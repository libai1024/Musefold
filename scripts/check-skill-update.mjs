#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const SOURCE_PREFIXES = [
  'apps/',
  'electron/',
  'packages/',
  'preview/',
  'resources/',
  'scripts/',
  'shared/',
  'src/',
  'website/Musefold/',
];
const SOURCE_FILES = new Set([
  'electron-builder.yml',
  'electron.vite.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.js',
  'tailwind.config.ts',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'vite.preview.config.ts',
  'vitest.config.ts',
]);
const BUNDLED_SKILL_PREFIX = 'website/Musefold/skills/musefold/';
const BUNDLED_SKILL_FILE = `${BUNDLED_SKILL_PREFIX}SKILL.md`;
const VERSION_FILE = 'shared/constants.ts';
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.silent ? 'pipe' : 'inherit'],
  }).trim();
}

function lines(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function isAppSourcePath(path) {
  const normalized = path.replaceAll('\\', '/');
  return SOURCE_FILES.has(normalized) || SOURCE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function parseSkillImpact(message) {
  const trailerMatches = message
    .split(/\r?\n/)
    .map((line) => line.match(/^Skill-Impact:\s*(.+?)\s*$/)?.[1] ?? null)
    .filter(Boolean);
  if (trailerMatches.length !== 1) {
    throw new Error(`源码提交必须且只能包含一个 Skill-Impact trailer，当前为 ${trailerMatches.length} 个`);
  }
  const footer = message.trimEnd().split(/\r?\n\s*\r?\n/).at(-1) ?? '';
  if (!footer.split(/\r?\n/).some((line) => /^Skill-Impact:/.test(line))) {
    throw new Error('Skill-Impact 必须位于提交消息最后一个 trailer 段落');
  }

  const value = trailerMatches[0];
  const none = value.match(/^none\s+-\s+(.+)$/);
  if (none) {
    const reason = none[1].trim();
    if (reason.length < 8) throw new Error('Skill-Impact: none 必须提供至少 8 个字符的具体理由');
    return { kind: 'none', reason };
  }

  const updated = value.match(/^updated\s+-\s+(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
  if (updated) return { kind: 'updated', version: updated[1] };
  throw new Error('Skill-Impact 格式无效；使用 "none - <理由>" 或 "updated - vX.Y.Z"');
}

function parseVersion(value) {
  const match = value.match(VERSION_PATTERN);
  if (!match) throw new Error(`无效 Skill 版本：${value}`);
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.numbers.length; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) return a.numbers[index] > b.numbers[index] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease == null) return 1;
  if (b.prerelease == null) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en');
}

function extractSkillVersion(skill) {
  return skill.match(/<!--\s*musefold-skill-version:\s*(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*-->/)?.[1] ?? null;
}

function extractAppSkillVersion(constants) {
  return constants.match(/MUSEFOLD_SKILL_VERSION\s*=\s*['"](v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)['"]/)?.[1] ?? null;
}

function commitParents(commit) {
  return lines(git(['rev-list', '--parents', '-n', '1', commit], { silent: true }));
}

function parentOf(commit) {
  const fields = commitParents(commit)[0]?.split(/\s+/) ?? [];
  return fields[1] ?? null;
}

function isMergeCommit(commit) {
  const fields = commitParents(commit)[0]?.split(/\s+/) ?? [];
  return fields.length > 2;
}

function changedPathsForCommit(commit) {
  const parent = parentOf(commit);
  if (!parent) return lines(git(['show', '--pretty=', '--name-only', commit], { silent: true }));
  return lines(git(['diff', '--name-only', '--diff-filter=ACMRD', parent, commit], { silent: true }));
}

function readPathAt(ref, path) {
  return git(['show', `${ref}:${path}`], { silent: true });
}

function validateUpdatedDecision({ label, paths, ref, parentRef, version }) {
  const errors = [];
  if (!paths.includes(VERSION_FILE)) errors.push(`${VERSION_FILE} 未随 Skill 版本更新`);
  if (!paths.some((path) => path.startsWith(BUNDLED_SKILL_PREFIX))) {
    errors.push(`${BUNDLED_SKILL_PREFIX} 未包含在本次提交`);
  }

  let skillVersion = null;
  let appVersion = null;
  try {
    skillVersion = extractSkillVersion(readPathAt(ref, BUNDLED_SKILL_FILE));
  } catch {
    errors.push(`无法读取 ${BUNDLED_SKILL_FILE}`);
  }
  try {
    appVersion = extractAppSkillVersion(readPathAt(ref, VERSION_FILE));
  } catch {
    errors.push(`无法读取 ${VERSION_FILE}`);
  }
  if (skillVersion !== version) errors.push(`SKILL.md 版本标记为 ${skillVersion ?? '缺失'}，trailer 为 ${version}`);
  if (appVersion !== version) errors.push(`MUSEFOLD_SKILL_VERSION 为 ${appVersion ?? '缺失'}，trailer 为 ${version}`);

  if (parentRef) {
    try {
      const previous = extractAppSkillVersion(readPathAt(parentRef, VERSION_FILE));
      if (!previous) errors.push('无法解析父提交中的 MUSEFOLD_SKILL_VERSION');
      else if (compareVersions(version, previous) <= 0) errors.push(`Skill 版本必须提升：父提交 ${previous}，当前 ${version}`);
    } catch {
      errors.push('无法读取父提交中的 Skill 版本');
    }
  }

  if (errors.length > 0) throw new Error(`${label} 声明 Skill 已更新，但校验失败：\n- ${errors.join('\n- ')}`);
}

function validateDecision({ label, paths, message, ref, parentRef }) {
  const sourcePaths = paths.filter(isAppSourcePath);
  if (sourcePaths.length === 0) {
    console.log(`[skill-impact] ${label}: 无 App 源码变更，跳过`);
    return;
  }

  const impact = parseSkillImpact(message);
  const bundledSkillChanged = paths.some((path) => path.startsWith(BUNDLED_SKILL_PREFIX)) || paths.includes(VERSION_FILE);
  if (impact.kind === 'none') {
    if (bundledSkillChanged) {
      throw new Error(`${label} 修改了内置 Skill 或版本常量，不能声明 Skill-Impact: none`);
    }
    console.log(`[skill-impact] ${label}: 已确认无需更新 Skill（${impact.reason}）`);
    return;
  }

  validateUpdatedDecision({ label, paths, ref, parentRef, version: impact.version });
  console.log(`[skill-impact] ${label}: 已验证 Skill 更新 ${impact.version}`);
}

function messageFromFile(path) {
  if (!path) throw new Error('--staged 必须同时传入 --commit-message <path>');
  return readFileSync(path, 'utf8');
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
}

function validateStaged(args) {
  const paths = lines(git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD'], { silent: true }));
  const message = messageFromFile(argumentValue(args, '--commit-message'));
  validateDecision({ label: 'staged commit', paths, message, ref: '', parentRef: 'HEAD' });
}

function validateCommit(commit) {
  if (isMergeCommit(commit)) {
    console.log(`[skill-impact] ${commit}: merge commit 由其非合并提交负责校验`);
    return;
  }
  validateDecision({
    label: commit,
    paths: changedPathsForCommit(commit),
    message: git(['show', '-s', '--format=%B', commit], { silent: true }),
    ref: commit,
    parentRef: parentOf(commit),
  });
}

function ciRange() {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const base = event.pull_request?.base?.sha ?? event.before ?? null;
    if (typeof base === 'string' && !/^0+$/.test(base)) return `${base}..HEAD`;
  } catch {
    // workflow_dispatch and local CI simulation fall back to HEAD.
  }
  return null;
}

function validateRange(range) {
  const commits = lines(git(['rev-list', '--reverse', range], { silent: true }));
  if (commits.length === 0) throw new Error(`提交范围为空：${range}`);
  for (const commit of commits) validateCommit(commit);
}

function printHelp() {
  console.log(`Usage:
  node scripts/check-skill-update.mjs --staged --commit-message <path>
  node scripts/check-skill-update.mjs --commit <sha>
  node scripts/check-skill-update.mjs --range <base..head>
  node scripts/check-skill-update.mjs --ci`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (args.includes('--staged')) validateStaged(args);
  else if (args.includes('--ci')) {
    const range = ciRange();
    if (range) validateRange(range);
    else validateCommit('HEAD');
  } else if (args.includes('--range')) validateRange(argumentValue(args, '--range'));
  else validateCommit(argumentValue(args, '--commit') ?? 'HEAD');
}

try {
  main();
} catch (error) {
  console.error(`[skill-impact] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  console.error('提交前必须审查 Skill 影响。详见 CONTRIBUTING.md 和 Musefold-Skills/SKILL-UPDATE-SPEC.md。');
  process.exitCode = 1;
}
