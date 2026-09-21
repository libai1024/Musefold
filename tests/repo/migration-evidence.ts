import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { assertEvidenceSourceCommit } from './evidence-source-identity';

export const EVIDENCE_MANIFEST_PATH = 'docs/v2.5/V25-EVIDENCE-MANIFEST.json';
export const MIGRATION_CARDS_PATH = 'docs/v2.5/V25-MIGRATION-CARDS.md';
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const EVIDENCE_LEVELS = [
  'source',
  'unit',
  'mock-e2e',
  'runtime-e2e',
  'artifact',
  'external',
  'blocked',
] as const;

export const EVIDENCE_RESULTS = ['pass', 'fail', 'skip', 'blocked', 'unregistered'] as const;

export const CARD_STATUSES = [
  'todo',
  'doing',
  'partial',
  'verify',
  'blocked',
  'done',
  'frozen',
] as const;

type CardStatus = (typeof CARD_STATUSES)[number];

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$/;
const CARD_ID_TOKEN_PATTERN = new RegExp(`^(${CARD_ID_PATTERN.source.slice(1, -1)})(?:\\s|$)`);
const MIGRATION_CARD_TOKEN_PATTERN =
  /^(?:B|D|U|S|P|X|Q|V)[0-9]{2}(?:-[A-Za-z0-9]+)*(?:\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)?$/;
const CLAIM_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/;
const CARD_STATUS_PATTERN = new RegExp(`^(${CARD_STATUSES.join('|')})(?:$|[\\s;,.])`);

function markdownCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return [];
  return trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isMarkdownSeparator(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

type EvidenceLedgerTable = 'current-batch' | 'p01-subcards';

const EVIDENCE_LEDGER_TABLES: Readonly<
  Record<EvidenceLedgerTable, { label: string; columns: number }>
> = {
  'current-batch': { label: '当前批次表', columns: 9 },
  'p01-subcards': { label: 'P01 子卡表', columns: 9 },
};

function ledgerTableKind(cells: readonly string[]): EvidenceLedgerTable | null {
  if (cells[0] !== '卡' && cells[0] !== '子卡') return null;
  if (cells.some((cell) => cell.includes('总状态'))) return 'current-batch';
  if (cells.some((cell) => cell.includes('当前状态'))) return 'p01-subcards';
  return null;
}

/** Keep the manifest-facing ledger tables fail-closed on malformed Markdown rows. */
export function assertMigrationLedgerTables(source: string): void {
  let active: { kind: EvidenceLedgerTable; separatorSeen: boolean } | null = null;

  for (const [lineNumber, line] of source.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (active && !active.separatorSeen) {
        throw new Error(`${EVIDENCE_LEDGER_TABLES[active.kind].label}缺少列分隔符`);
      }
      active = null;
      continue;
    }

    if (!active) {
      const cells = markdownCells(line);
      const kind = ledgerTableKind(cells);
      if (!kind) continue;
      const table = EVIDENCE_LEDGER_TABLES[kind];
      if (cells.length !== table.columns) {
        throw new Error(
          `${table.label}第 ${lineNumber + 1} 行列数错误: 期望 ${table.columns},实际 ${cells.length}`,
        );
      }
      active = { kind, separatorSeen: false };
      continue;
    }

    const table = EVIDENCE_LEDGER_TABLES[active.kind];
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
      throw new Error(`${table.label}第 ${lineNumber + 1} 行不是合法表格行`);
    }
    const cells = markdownCells(line);
    if (cells.length !== table.columns) {
      throw new Error(
        `${table.label}第 ${lineNumber + 1} 行列数错误: 期望 ${table.columns},实际 ${cells.length}`,
      );
    }

    if (!active.separatorSeen) {
      if (!isMarkdownSeparator(cells)) {
        throw new Error(`${table.label}第 ${lineNumber + 1} 行必须是列分隔符`);
      }
      active.separatorSeen = true;
      continue;
    }

    if (isMarkdownSeparator(cells)) {
      throw new Error(`${table.label}第 ${lineNumber + 1} 行重复出现列分隔符`);
    }
  }

  if (active && !active.separatorSeen) {
    throw new Error(`${EVIDENCE_LEDGER_TABLES[active.kind].label}缺少列分隔符`);
  }
}

function cardIdFromCell(cell: string): string | null {
  const normalized = cell.replaceAll('`', '').trim();
  const id = normalized.match(CARD_ID_TOKEN_PATTERN)?.[1] ?? null;
  return id && MIGRATION_CARD_TOKEN_PATTERN.test(id) ? id : null;
}

function cardStatusFromCell(cell: string): CardStatus | null {
  const normalized = cell.replaceAll('`', '').trim();
  return (normalized.match(CARD_STATUS_PATTERN)?.[1] as CardStatus | undefined) ?? null;
}

function cardStatusFromSection(section: string): CardStatus | null {
  return (
    (section.match(
      /^\s*-\s+\*\*状态\*\*[:：]\s*`?(todo|doing|partial|verify|blocked|done|frozen)/m,
    )?.[1] as CardStatus | undefined) ?? null
  );
}

export function documentedMigrationCardRegistry(repoRoot: string): ReadonlyMap<string, CardStatus> {
  const source = readFileSync(resolve(repoRoot, MIGRATION_CARDS_PATH), 'utf8');
  const registry = new Map<string, CardStatus>();
  const headings = [...source.matchAll(/^###\s+([^\s`]+)(?:\s|$).*$/gm)];

  for (const [index, heading] of headings.entries()) {
    const id = heading[1];
    if (!MIGRATION_CARD_TOKEN_PATTERN.test(id)) continue;
    const start = heading.index ?? 0;
    const end = headings[index + 1]?.index ?? source.length;
    const status = cardStatusFromSection(source.slice(start, end));
    if (status) registry.set(id, status);
  }

  let tableHeader: string[] | null = null;
  let statusIndex = -1;
  let platformStatusIndexes: number[] = [];
  for (const line of source.split('\n')) {
    const cells = markdownCells(line);
    if (cells.length === 0) {
      tableHeader = null;
      statusIndex = -1;
      platformStatusIndexes = [];
      continue;
    }
    if (isMarkdownSeparator(cells)) continue;

    const nextStatusIndex = cells.findIndex(
      (cell) => cell.includes('总状态') || cell.includes('当前状态'),
    );
    if (nextStatusIndex >= 0 && (cells[0] === '卡' || cells[0] === '子卡')) {
      tableHeader = cells;
      statusIndex = nextStatusIndex;
      platformStatusIndexes = cells.reduce<number[]>((indexes, cell, index) => {
        if (['Mobile Web', 'PC Web', 'Desktop', 'Desktop Agent'].includes(cell)) {
          indexes.push(index);
        }
        return indexes;
      }, []);
      continue;
    }
    if (!tableHeader || statusIndex < 0 || statusIndex >= cells.length) continue;

    const id = cardIdFromCell(cells[0]);
    if (!id) continue;

    const explicitStatus = cardStatusFromCell(cells[statusIndex]);
    const platformStatuses = platformStatusIndexes.flatMap((index) => {
      const status = cardStatusFromCell(cells[index]);
      return status ? [status] : [];
    });
    const platformPrecedence: readonly CardStatus[] = [
      'blocked',
      'doing',
      'partial',
      'verify',
      'done',
      'frozen',
      'todo',
    ];
    const platformStatus = platformPrecedence.find((status) => platformStatuses.includes(status));
    const status = explicitStatus ?? platformStatus;
    if (status) registry.set(id, status);
  }

  return registry;
}

const documentedCardRegistry = documentedMigrationCardRegistry(REPO_ROOT);
export const MIGRATION_CARD_IDS = Object.freeze([...documentedCardRegistry.keys()]);
const migrationCardIdSchema = z.string().regex(CARD_ID_PATTERN, 'card id 格式无效');
const evidenceLevelSchema = z.enum(EVIDENCE_LEVELS);
const evidenceResultSchema = z.enum(EVIDENCE_RESULTS);
const cardStatusSchema = z.enum(CARD_STATUSES);
const platformStatusSchema = z.enum([
  'pass',
  'fail',
  'skip',
  'blocked',
  'unregistered',
  'not-applicable',
]);
const testCaseResultSchema = z.enum(['pass', 'fail', 'skip', 'blocked', 'unregistered']);

const platformMatrixSchema = z
  .object({
    mobileWeb: platformStatusSchema,
    pcWeb: platformStatusSchema,
    desktop: platformStatusSchema,
    desktopAgent: platformStatusSchema,
  })
  .strict();

const platformNotesSchema = z
  .object({
    mobileWeb: z.string().nullable(),
    pcWeb: z.string().nullable(),
    desktop: z.string().nullable(),
    desktopAgent: z.string().nullable(),
  })
  .strict();

function isRepoRelativePath(value: string): boolean {
  return (
    value.length > 0 &&
    value === value.replaceAll('\\', '/') &&
    !value.startsWith('/') &&
    !value.startsWith('~/') &&
    value !== '~' &&
    !/^[A-Za-z]:\//.test(value) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) &&
    !value.split('/').includes('..')
  );
}

function isSafeReference(value: string): boolean {
  if (isRepoRelativePath(value)) return true;
  if (!value.startsWith('https://')) return false;

  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    for (const key of url.searchParams.keys()) {
      if (/(?:token|secret|key|auth|credential|signature)/i.test(key)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

const repoRelativePathSchema = z.string().min(1).refine(isRepoRelativePath, '必须是仓库相对路径');
const safeReferenceSchema = z
  .string()
  .min(1)
  .refine(isSafeReference, '必须是仓库相对路径或不带凭据的 HTTPS 引用');
const nullableSafeReferenceSchema = safeReferenceSchema.nullable();
const testCaseSchema = z
  .object({
    path: repoRelativePathSchema,
    name: z.string().min(1),
    result: testCaseResultSchema,
  })
  .strict();

export const evidenceClaimSchema = z
  .object({
    id: z.string().regex(CLAIM_ID_PATTERN, 'claim id 格式无效'),
    card: migrationCardIdSchema,
    status: cardStatusSchema,
    level: evidenceLevelSchema,
    result: evidenceResultSchema,
    platforms: platformMatrixSchema,
    platformNotes: platformNotesSchema,
    sourcePaths: z.array(repoRelativePathSchema),
    testPaths: z.array(repoRelativePathSchema),
    workflowPaths: z.array(repoRelativePathSchema),
    testCases: z.array(testCaseSchema).default([]),
    command: z.string().min(1),
    commit: z
      .string()
      .regex(
        /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/,
        'commit 必须是 40 位 SHA-1 或 64 位 SHA-256 完整小写十六进制,不接受缩写 SHA',
      )
      .nullable(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date 必须为 YYYY-MM-DD')
      .nullable(),
    report: nullableSafeReferenceSchema,
    artifact: nullableSafeReferenceSchema,
    skipReason: z.string().nullable().default(null),
    blockedReason: z.string().nullable().default(null),
    unregisteredReason: z.string().nullable().default(null),
    failureReason: z.string().nullable().default(null),
    rerun: z.string().nullable().default(null),
  })
  .strict();

export const migrationEvidenceManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    sourceOfTruth: repoRelativePathSchema,
    claims: z.array(evidenceClaimSchema).min(1),
  })
  .strict();

export type EvidenceClaim = z.infer<typeof evidenceClaimSchema>;
export type MigrationEvidenceManifest = z.infer<typeof migrationEvidenceManifestSchema>;

function collectStrings(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') {
    out.push(`${path}=${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectStrings(item, `${path}[${index}]`, out);
    });
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      collectStrings(child, path ? `${path}.${key}` : key, out);
    }
  }
}

const SENSITIVE_KEY =
  /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|password|secret|credential|private[_-]?key|oauth|token|prompt(?:text|body|content)|positive[_-]?prompt|negative[_-]?prompt|request[_-]?template)$/i;
const CREDENTIAL_VALUE =
  /(?:\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|password|secret)\s*[:=]\s*[^\s,;]+)|(?:^|[^A-Za-z0-9_])(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|Bearer\s+\S+|AKIA[0-9A-Z]{12,})(?:$|[^A-Za-z0-9_-])/i;
const PROMPT_BODY_VALUE =
  /\b(?:positive|negative)[_ -]?prompt(?:[_ -]?(?:text|body|content))?\s*[:=]\s*\S+|\bprompt(?:text|body|content)\s*[:=]\s*\S+/i;
const ABSOLUTE_USER_PATH =
  /(?:^|[^A-Za-z0-9_])(?:~(?:[\\/]|$)|\/(?:Users|home|root|private\/var|var\/folders|tmp)(?:[\\/]|$)|\/mnt\/[A-Za-z](?:[\\/]|$)|[A-Za-z]:[\\/]|(?:\\\\|\/\/)[^\\/]+[\\/]|(?:file|media):\/\/)/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function assertManifestContainsNoSensitiveData(value: unknown): void {
  const strings: string[] = [];
  collectStrings(value, '', strings);
  const violations: string[] = [];

  for (const entry of strings) {
    const separator = entry.indexOf('=');
    const path = separator >= 0 ? entry.slice(0, separator) : entry;
    const text = separator >= 0 ? entry.slice(separator + 1) : entry;
    if (path.split('.').some((part) => SENSITIVE_KEY.test(part))) {
      violations.push(`${path}: sensitive field name`);
    }
    if (CREDENTIAL_VALUE.test(text)) violations.push(`${path}: credential-like value`);
    if (PROMPT_BODY_VALUE.test(text)) violations.push(`${path}: prompt body`);
    if (ABSOLUTE_USER_PATH.test(text)) violations.push(`${path}: absolute local path`);
    if (PRIVATE_KEY_BLOCK.test(text)) violations.push(`${path}: private key material`);
    if (EMAIL_ADDRESS.test(text)) violations.push(`${path}: user identity`);
  }

  if (violations.length > 0) {
    throw new Error(`evidence manifest 包含敏感信息:\n${violations.join('\n')}`);
  }
}

function assertExistingRepoPath(repoRoot: string, path: string, field: string): void {
  const absolutePath = resolve(repoRoot, path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    throw new Error(`${field} 引用不存在的仓库路径: ${path}`);
  }
}

function isTestPath(path: string): boolean {
  return (
    path.startsWith('tests/') ||
    path.includes('/__tests__/') ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(path)
  );
}

function isWorkflowPath(path: string): boolean {
  return path.startsWith('.github/workflows/') && /\.(?:yml|yaml)$/.test(path);
}

function isEvidenceReferencePath(path: string, field: 'report' | 'artifact'): boolean {
  const normalized = path.toLowerCase();
  if (field === 'report') {
    return (
      normalized.startsWith('reports/') ||
      normalized.startsWith('test-results/') ||
      normalized.includes('/report') ||
      normalized.includes('report.') ||
      /\.(?:json|xml|txt|log)$/.test(normalized)
    );
  }
  return (
    normalized.startsWith('artifacts/') ||
    normalized.startsWith('test-results/') ||
    normalized.startsWith('release/') ||
    normalized.startsWith('dist/') ||
    normalized.includes('/artifact') ||
    normalized.includes('screenshot') ||
    normalized.includes('package-smoke')
  );
}

function assertPathSemantics(claim: EvidenceClaim): void {
  for (const path of claim.testPaths) {
    if (!isTestPath(path)) {
      throw new Error(`${claim.id}: testPaths 必须引用测试文件: ${path}`);
    }
  }
  for (const path of claim.workflowPaths) {
    if (!isWorkflowPath(path)) {
      throw new Error(`${claim.id}: workflowPaths 必须引用 workflow 文件: ${path}`);
    }
  }
  for (const [field, reference] of [
    ['report', claim.report],
    ['artifact', claim.artifact],
  ] as const) {
    if (reference && isRepoRelativePath(reference) && !isEvidenceReferencePath(reference, field)) {
      throw new Error(`${claim.id}.${field} 不是合理的 evidence 引用: ${reference}`);
    }
  }
}

function assertUniquePaths(paths: readonly string[], field: string): void {
  if (new Set(paths).size !== paths.length) {
    throw new Error(`${field} 不得重复引用路径`);
  }
}

export function readCurrentGitState(repoRoot: string): { head: string; dirty: boolean } {
  try {
    const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const dirtyOutput = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(head)) {
      throw new Error('HEAD 不是完整 commit SHA');
    }
    return { head, dirty: dirtyOutput.length > 0 };
  } catch (error) {
    throw new Error(
      `无法读取 Git evidence 状态: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertTestCases(claim: EvidenceClaim, repoRoot: string): void {
  for (const testCase of claim.testCases) {
    assertExistingRepoPath(repoRoot, testCase.path, `${claim.id}.testCases`);
    if (!claim.testPaths.includes(testCase.path)) {
      throw new Error(`${claim.id}: testCase path 必须出现在 testPaths 中`);
    }
  }

  if (claim.result === 'pass') {
    if (claim.testCases.length === 0) {
      throw new Error(`${claim.id}: pass 必须登记具体 testCases，不能以 test.skip 冒充 pass`);
    }
    const nonPass = claim.testCases.find((testCase) => testCase.result !== 'pass');
    if (nonPass) {
      throw new Error(
        `${claim.id}: test case ${nonPass.name} 的 ${nonPass.result} 不能构成 pass evidence`,
      );
    }
  }
  if (claim.result === 'skip') {
    if (!claim.testCases.some((testCase) => testCase.result === 'skip')) {
      throw new Error(`${claim.id}: skip 必须登记具体 skipped testCase`);
    }
    if (!claim.skipReason) {
      throw new Error(`${claim.id}: skip 必须填写 skipReason`);
    }
  }
  if (
    claim.result === 'blocked' &&
    claim.testCases.some((testCase) => testCase.result === 'pass')
  ) {
    throw new Error(`${claim.id}: blocked 不得登记 pass testCase`);
  }
  if (
    claim.result === 'unregistered' &&
    claim.testCases.some((testCase) => testCase.result === 'pass')
  ) {
    throw new Error(`${claim.id}: unregistered 不得登记 pass testCase`);
  }
}

function assertExecutionFields(claim: EvidenceClaim, repoRoot: string): void {
  if (claim.status === 'done' && claim.result !== 'pass') {
    throw new Error(`${claim.id}: done claim 必须有 pass result`);
  }
  if (claim.status === 'blocked' && (!claim.blockedReason || !claim.rerun)) {
    throw new Error(`${claim.id}: blocked card 必须填写 blockedReason 和 rerun`);
  }
  if (claim.result === 'blocked' && (!claim.blockedReason || !claim.rerun)) {
    throw new Error(`${claim.id}: blocked result 必须填写 blockedReason 和 rerun`);
  }
  if (
    claim.result === 'skip' &&
    (!claim.skipReason || claim.blockedReason || claim.unregisteredReason)
  ) {
    throw new Error(`${claim.id}: skip 只能填写 skipReason`);
  }
  if (claim.result === 'unregistered') {
    if (!claim.unregisteredReason) {
      throw new Error(`${claim.id}: unregistered 必须填写 unregisteredReason`);
    }
    if ([claim.commit, claim.date, claim.report, claim.artifact].some((field) => field !== null)) {
      throw new Error(`${claim.id}: unregistered 不得伪造 execution metadata`);
    }
  }
  if (claim.result === 'fail' && !claim.failureReason) {
    throw new Error(`${claim.id}: fail 必须填写 failureReason`);
  }
  if (claim.result !== 'fail' && claim.failureReason) {
    throw new Error(`${claim.id}: 只有 fail result 可以填写 failureReason`);
  }

  assertTestCases(claim, repoRoot);

  if (claim.level === 'blocked' && claim.result !== 'blocked') {
    throw new Error(`${claim.id}: blocked evidence level 必须使用 blocked result`);
  }
  if (claim.result === 'blocked' && claim.level !== 'blocked') {
    throw new Error(`${claim.id}: blocked result 必须使用 blocked evidence level`);
  }

  if (claim.result === 'pass' || claim.result === 'fail') {
    if (!claim.commit || !claim.date || (!claim.report && !claim.artifact)) {
      throw new Error(`${claim.id}: ${claim.result} 必须绑定 commit、date 和 report/artifact`);
    }
    assertEvidenceSourceCommit(repoRoot, claim.commit);
  }
}

function assertPlatformFields(claim: EvidenceClaim): void {
  for (const [platform, status] of Object.entries(claim.platforms)) {
    const note = claim.platformNotes[platform as keyof typeof claim.platformNotes];
    if ((status === 'blocked' || status === 'not-applicable') && !note) {
      throw new Error(`${claim.id}: ${platform} 的 ${status} 必须填写 platformNotes`);
    }
  }
}

export function assertMigrationEvidenceManifest(
  value: unknown,
  repoRoot = REPO_ROOT,
): MigrationEvidenceManifest {
  const manifest = migrationEvidenceManifestSchema.parse(value);
  assertManifestContainsNoSensitiveData(manifest);

  if (manifest.sourceOfTruth !== MIGRATION_CARDS_PATH) {
    throw new Error('sourceOfTruth 必须指向 V25-MIGRATION-CARDS.md');
  }
  assertExistingRepoPath(repoRoot, manifest.sourceOfTruth, 'sourceOfTruth');

  const ledgerSource = readFileSync(resolve(repoRoot, manifest.sourceOfTruth), 'utf8');
  assertMigrationLedgerTables(ledgerSource);

  const documentedRegistry = documentedMigrationCardRegistry(repoRoot);
  const ids = new Set<string>();
  for (const claim of manifest.claims) {
    if (ids.has(claim.id)) throw new Error(`claim id 重复: ${claim.id}`);
    ids.add(claim.id);
    assertExecutionFields(claim, repoRoot);
    assertPlatformFields(claim);

    const documentedStatus = documentedRegistry.get(claim.card);
    if (!documentedStatus) {
      throw new Error(`${claim.id}: card 未在 V25-MIGRATION-CARDS 中登记: ${claim.card}`);
    }
    if (claim.status !== documentedStatus) {
      throw new Error(
        `${claim.id}: status ${claim.status} 与 V25-MIGRATION-CARDS 中 ${claim.card} 的 ${documentedStatus} 不一致`,
      );
    }

    assertPathSemantics(claim);
    assertUniquePaths(claim.sourcePaths, `${claim.id}.sourcePaths`);
    assertUniquePaths(claim.testPaths, `${claim.id}.testPaths`);
    assertUniquePaths(claim.workflowPaths, `${claim.id}.workflowPaths`);
    if (['done', 'verify', 'blocked'].includes(claim.status)) {
      if (claim.sourcePaths.length === 0 || claim.testPaths.length === 0) {
        throw new Error(`${claim.id}: ${claim.status} claim 必须同时引用 source/test path`);
      }
      if (claim.workflowPaths.length === 0) {
        throw new Error(`${claim.id}: ${claim.status} claim 必须引用 workflow path`);
      }
      if (!claim.command) throw new Error(`${claim.id}: ${claim.status} claim 必须填写 command`);
    }

    for (const path of claim.sourcePaths) {
      assertExistingRepoPath(repoRoot, path, `${claim.id}.sourcePaths`);
    }
    for (const path of claim.testPaths) {
      assertExistingRepoPath(repoRoot, path, `${claim.id}.testPaths`);
    }
    for (const path of claim.workflowPaths) {
      assertExistingRepoPath(repoRoot, path, `${claim.id}.workflowPaths`);
    }
    for (const [field, reference] of [
      ['report', claim.report],
      ['artifact', claim.artifact],
    ] as const) {
      if (reference && isRepoRelativePath(reference)) {
        assertExistingRepoPath(repoRoot, reference, `${claim.id}.${field}`);
      }
    }
  }

  return manifest;
}

export function readMigrationEvidenceManifest(repoRoot = REPO_ROOT): MigrationEvidenceManifest {
  const path = resolve(repoRoot, EVIDENCE_MANIFEST_PATH);
  return assertMigrationEvidenceManifest(JSON.parse(readFileSync(path, 'utf8')), repoRoot);
}
