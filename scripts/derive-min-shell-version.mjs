#!/usr/bin/env node
/**
 * 根据 renderer 源码实际引用的 window.api 方法面，推导 manifest.minShellVersion。
 *
 * 为什么扫源码而不是构建产物：构建只会 tree-shake 掉引用、绝不会新增引用，因此源码
 * 推导只可能偏高（更保守的 minShellVersion）。方向安全——宁可少数旧外壳拿不到更新，
 * 绝不让使用了新外壳能力的 renderer 落到旧外壳上白屏。minShellVersion 是这条防线。
 *
 * 协议原文依据「IPC 通道集合」，但 renderer 不引用通道常量（通道名只出现在 preload）。
 * renderer 真正依赖的是 preload 暴露的 window.api.<group>.<method>。登记表按方法面
 * 建立，是对协议条款的语义等价实现。
 *
 * 扫描范围：apps/desktop/src/**\/*.{ts,tsx}，排除 *.test.*。
 * 不扫 apps/desktop/src/preview/：electron.vite.config.ts 的 renderer 入口是
 * apps/desktop/src/index.html、apps/desktop/src/pet.html、
 * apps/desktop/src/storage-export.html；index.html 只加载 bootstrap-error.ts 与
 * main.tsx。apps/desktop/src/preview/install-bridge.ts 仅由 vite.preview.config.ts 经
 * preview/bridge-plugin.mjs 注入，属于浏览器 UI 走查，不进 Electron renderer 产物。
 *
 * 同形误伤：group 不在登记表中的 `api.<g>.<m>` 忽略（大概率是无关同名变量）；
 * group 在、method 不在才硬错误——编译器已保证登记表覆盖 Api 类型，走到这一步
 * 说明源码里有动态拼写或漂移，必须人工看。不要自行扩登记表以外的处理。
 *
 * 访问链停在登记表的嵌套对象上（如 `const w = window.api?.window`）时，把该对象
 * 下全部叶子方法计入——后续经别名调用的方法正则看不见，漏计会让 minShellVersion
 * 偏低，方向不安全。多计只会使门槛偏高。
 *
 * 登记表读取：动态 import('@musefold/desktop-contracts/api-method-versions.ts')。
 * 该文件只有可擦除的 type 语法 + 纯数据对象；Node 24+（与仓库 CI / bundle:manifest 一致）
 * 默认类型剥离。按包名解析（v1.2.1 已预留），不再依赖 shared/ 文件路径。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const FLOOR = '0.5.0';
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_ROOT = join(REPO_ROOT, 'apps/desktop/src');
const PREVIEW_PREFIX = 'preview/';

/**
 * 匹配 `api.<g>.<m>` / `window.api.<g>.<m>`，含可选链与跨行空白。
 * 例：api.prompt.list()、window.api?.updater?.checkContentNow?.()、
 *     api.settings.pricing.get()、api.automation.budget.get()。
 *
 * 前缀约束：`api` 前不能是标识符或点（避免 myapi / foo.api），但允许 `window.` /
 * `window?.` 作为唯一合法前缀。
 */
const API_ACCESS_RE =
  /(?:(?<![\w$.])window\s*\??\.\s*|(?<![\w$.]))api(?![\w$])((?:\s*\??\.\s*[A-Za-z_$][\w$]*)+)/g;
const MEMBER_RE = /\s*\??\.\s*([A-Za-z_$][\w$]*)/g;

/** 去掉注释后再扫，避免 `// window.api.prompt|folder|tag.*` 这类说明文字触发整组展开或未知 method 硬错误。 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"])\/\/[^\n]*/gm, (full, prefix) => prefix + ' '.repeat(full.length - prefix.length));
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseSemver(value) {
  const match = String(value).match(SEMVER_RE);
  if (!match) throw new Error(`无效 semver：${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]
      ? match[4].split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : null,
  };
}

function comparePrereleaseId(left, right) {
  const leftNum = typeof left === 'number';
  const rightNum = typeof right === 'number';
  if (leftNum && rightNum) return left === right ? 0 : left > right ? 1 : -1;
  // SemVer：纯数字标识符的优先级低于非数字
  if (leftNum) return -1;
  if (rightNum) return 1;
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/** 含预发布规则：0.5.0-dev.3 < 0.5.0。不依赖 semver 包，脚本独立可运行。 */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  const len = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < len; i += 1) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const cmp = comparePrereleaseId(a.prerelease[i], b.prerelease[i]);
    if (cmp !== 0) return cmp;
  }
  return 0;
}

export function maxSemver(versions, floor = FLOOR) {
  let max = floor;
  for (const version of versions) {
    if (compareSemver(version, max) > 0) max = version;
  }
  return max;
}

export function extractApiMemberChains(source) {
  const chains = [];
  const accessRe = new RegExp(API_ACCESS_RE.source, 'g');
  let match = accessRe.exec(source);
  while (match) {
    const members = [];
    const memberRe = new RegExp(MEMBER_RE.source, 'g');
    let member = memberRe.exec(match[1]);
    while (member) {
      members.push(member[1]);
      member = memberRe.exec(match[1]);
    }
    if (members.length > 0) chains.push(members);
    match = accessRe.exec(source);
  }
  return chains;
}

function collectLeaves(node, prefix) {
  /** @type {Array<{ path: string, version: string }>} */
  const leaves = [];
  if (typeof node === 'string') {
    if (prefix) leaves.push({ path: prefix, version: node });
    return leaves;
  }
  if (node === null || typeof node !== 'object') return leaves;
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') leaves.push({ path, version: value });
    else leaves.push(...collectLeaves(value, path));
  }
  return leaves;
}

/**
 * @returns {{ kind: 'hit', path: string, version: string }
 *   | { kind: 'ignore' }
 *   | { kind: 'incomplete', leaves: Array<{ path: string, version: string }> }
 *   | { kind: 'error', path: string }}
 */
export function resolveAccess(members, registry) {
  if (members.length === 0) return { kind: 'ignore' };
  if (!Object.hasOwn(registry, members[0])) return { kind: 'ignore' };

  let node = registry;
  const path = [];
  for (const member of members) {
    if (typeof node === 'string') {
      return { kind: 'hit', path: path.join('.'), version: node };
    }
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, member)) {
      return { kind: 'error', path: [...path, member].join('.') };
    }
    path.push(member);
    node = node[member];
  }
  if (typeof node === 'string') return { kind: 'hit', path: path.join('.'), version: node };
  return { kind: 'incomplete', leaves: collectLeaves(node, path.join('.')) };
}

export function collectUsedMethods(source, registry) {
  /** @type {Map<string, string>} */
  const used = new Map();
  /** @type {string[]} */
  const errors = [];
  for (const members of extractApiMemberChains(stripComments(source))) {
    const result = resolveAccess(members, registry);
    if (result.kind === 'hit') used.set(result.path, result.version);
    else if (result.kind === 'incomplete') {
      for (const leaf of result.leaves) used.set(leaf.path, leaf.version);
    } else if (result.kind === 'error') errors.push(result.path);
  }
  return { used, errors };
}

export function deriveFromSource(source, registry, floor = FLOOR) {
  const { used, errors } = collectUsedMethods(source, registry);
  if (errors.length > 0) {
    const unique = [...new Set(errors)];
    throw new Error(`源码引用了登记表中不存在的方法：${unique.join(', ')}`);
  }
  return {
    minShellVersion: maxSemver([...used.values()], floor),
    floor,
    usedMethods: used.size,
    used,
  };
}

function isRendererSourceFile(name) {
  return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && !name.endsWith('.d.ts');
}

export function listRendererSources(srcRoot = SRC_ROOT) {
  /** @type {string[]} */
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!isRendererSourceFile(entry.name)) continue;
      const rel = relative(srcRoot, full).split('\\').join('/');
      if (rel === 'preview' || rel.startsWith(PREVIEW_PREFIX)) continue;
      files.push(full);
    }
  }
  walk(srcRoot);
  return files.sort();
}

export async function loadRegistry() {
  const mod = await import('@musefold/desktop-contracts/api-method-versions.ts');
  const registry = mod.API_METHOD_INTRODUCED_IN;
  if (registry === null || typeof registry !== 'object') {
    throw new Error('登记表 API_METHOD_INTRODUCED_IN 缺失或不是对象');
  }
  return registry;
}

export function deriveFromFiles(files, registry, floor = FLOOR) {
  /** @type {Map<string, string>} */
  const used = new Map();
  /** @type {Array<{ file: string, method: string }>} */
  const errors = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const result = collectUsedMethods(source, registry);
    for (const [path, version] of result.used) used.set(path, version);
    for (const method of result.errors) {
      errors.push({ file, method });
    }
  }
  if (errors.length > 0) {
    const lines = errors.map((item) => {
      const rel = relative(REPO_ROOT, item.file).split('\\').join('/');
      return `  ${rel}: ${item.method}`;
    });
    throw new Error(`源码引用了登记表中不存在的方法：\n${lines.join('\n')}`);
  }
  return {
    minShellVersion: maxSemver([...used.values()], floor),
    floor,
    usedMethods: used.size,
  };
}

function assertEqual(name, actual, expected) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(`${name}\n  expected ${expectedText}\n  actual   ${actualText}`);
  }
  process.stdout.write(`ok  ${name}\n`);
}

function assertThrows(name, fn, needle) {
  let thrown = null;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  if (thrown === null) throw new Error(`${name}: 期望抛出错误`);
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  if (!message.includes(needle)) {
    throw new Error(`${name}: 错误信息不含「${needle}」\n  actual ${message}`);
  }
  process.stdout.write(`ok  ${name}\n`);
}

const FIXTURE_REGISTRY = {
  prompt: { list: '0.5.0', get: '0.6.0' },
  updater: { checkContentNow: '0.5.0', notifyContentReady: '0.5.0' },
  pet: { ready: '0.5.0' },
  settings: { pricing: { get: '0.5.0', set: '0.7.0' } },
  legacy: { ping: '0.4.0' },
};

async function selfTest() {
  const ordinary = deriveFromSource('const x = api.prompt.list();', FIXTURE_REGISTRY);
  assertEqual('普通调用 api.prompt.list()', [ordinary.minShellVersion, ordinary.usedMethods], [
    '0.5.0',
    1,
  ]);

  const optional = deriveFromSource(
    'api?.updater?.checkContentNow?.();',
    FIXTURE_REGISTRY,
  );
  assertEqual('可选链 api?.updater?.checkContentNow?.()', [
    optional.minShellVersion,
    [...optional.used.keys()],
  ], ['0.5.0', ['updater.checkContentNow']]);

  const prefixed = deriveFromSource('window.api.pet.ready();', FIXTURE_REGISTRY);
  assertEqual('window.api 前缀', [...prefixed.used.keys()], ['pet.ready']);

  const windowOptional = deriveFromSource(
    'window.api?.updater?.notifyContentReady?.();',
    FIXTURE_REGISTRY,
  );
  assertEqual('window.api 可选链', [...windowOptional.used.keys()], ['updater.notifyContentReady']);

  const unrelated = deriveFromSource(
    'const api = { fetch: { json: () => 1 } }; api.fetch.json();',
    FIXTURE_REGISTRY,
  );
  assertEqual('无关同名 api 变量（group 不在登记表）忽略', unrelated.usedMethods, 0);

  const commented = deriveFromSource(
    '// api.prompt.notARealMethod();\n/* api.prompt.list() */\nconst n = 1;',
    FIXTURE_REGISTRY,
  );
  assertEqual('注释中的 api 访问不计入、也不报未知 method', commented.usedMethods, 0);

  const aliasedGroup = deriveFromSource('const w = window.api?.window;', {
    window: { minimize: '0.5.0', close: '0.6.0' },
  });
  assertEqual(
    '停在 group 对象上时计入该组全部叶子（别名调用的保守回退）',
    [aliasedGroup.minShellVersion, [...aliasedGroup.used.keys()].sort()],
    ['0.6.0', ['window.close', 'window.minimize']],
  );

  assertThrows(
    '未知 method 报错',
    () => deriveFromSource('api.prompt.notARealMethod();', FIXTURE_REGISTRY),
    'prompt.notARealMethod',
  );

  const floorOnly = deriveFromSource('const api = { fetch: { json: () => 1 } }; api.fetch.json();', FIXTURE_REGISTRY);
  assertEqual('零引用时 floor 兜底', floorOnly.minShellVersion, '0.5.0');

  const belowFloor = deriveFromSource('api.legacy.ping();', FIXTURE_REGISTRY);
  assertEqual('引用版本低于 floor 时仍取 floor', belowFloor.minShellVersion, '0.5.0');

  const nestedMax = deriveFromSource(
    'api.prompt.list(); api.settings.pricing.set();',
    FIXTURE_REGISTRY,
  );
  assertEqual('max 取被引用方法引入版本的最大者', nestedMax.minShellVersion, '0.7.0');

  assertEqual('预发布 0.5.0-dev.3 < 0.5.0', compareSemver('0.5.0-dev.3', '0.5.0'), -1);
  assertEqual('预发布 0.5.0 > 0.5.0-dev.3', compareSemver('0.5.0', '0.5.0-dev.3'), 1);
  assertEqual('预发布标识符按数值比较 0.5.0-dev.3 < 0.5.0-dev.10', compareSemver('0.5.0-dev.3', '0.5.0-dev.10'), -1);

  const registry = await loadRegistry();
  if (typeof registry.prompt?.list !== 'string') {
    throw new Error('真实登记表未能加载 prompt.list');
  }
  process.stdout.write('ok  动态 import 真实登记表\n');
  process.stdout.write('derive-min-shell-version self-test: all passed\n');
}

function printHelp() {
  console.log(`Usage:
  node scripts/derive-min-shell-version.mjs
  node scripts/derive-min-shell-version.mjs --self-test`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  if (args.includes('--self-test')) {
    await selfTest();
    return;
  }

  const registry = await loadRegistry();
  const result = deriveFromFiles(listRendererSources(), registry);
  process.stdout.write(
    `${JSON.stringify({
      minShellVersion: result.minShellVersion,
      floor: result.floor,
      usedMethods: result.usedMethods,
    })}\n`,
  );
}

const invokedAsScript = resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      `[derive-min-shell] FAIL: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
