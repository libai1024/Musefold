import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import {
  parseDesignSchemeRevisionDocument,
  type DesignSchemeRevisionDocument,
  type Fidelity,
  type SchemeStatus,
  type SourceRole,
} from '@musefold/desktop-contracts/design-scheme/schema';
import type {
  DesignSchemeAssetSummary,
  DesignSchemeSourceSnapshotDetail,
  DesignSchemeSummary,
} from '@musefold/desktop-contracts/design-scheme';

export interface SourceSnapshotWriteInput {
  package: {
    id: string;
    kind: 'github' | 'history' | 'user-brief';
    repositoryUrl?: string;
    license?: string;
  };
  snapshot: {
    id: string;
    ref: string;
    commitHash: string | null;
    contentHash?: string;
    totalBytes: number;
    scan: unknown;
  };
  files: Array<{
    path: string;
    kind: 'text' | 'image' | 'other';
    contentHash: string;
    sizeBytes: number;
    storeKey?: string;
    textContent?: string;
    /** v6：来源文件 MIME（canonical 创建/导入持久化；未知为 null）。 */
    mimeType?: string | null;
    /** v6：canonical 证据相对路径；无证据为 null。 */
    evidencePath?: string | null;
  }>;
}

/** v6：资产的完整 canonical 元数据（designSchemeAssetSchema 全部必填项）。 */
export interface AssetMetadataWrite {
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentHash: string;
}

export interface SchemeDraftWriteInput {
  document: DesignSchemeRevisionDocument;
  sourceLabel: string;
  sourcePresentation: 'skill' | 'musefold-created';
  createdBy: 'agent' | 'user' | 'import';
  bindings: Array<{ snapshotId: string; role: SourceRole }>;
}

interface SchemeRow {
  id: string;
  name: string;
  summary: string;
  status: SchemeStatus;
  source_presentation: 'skill' | 'musefold-created';
  source_label: string;
  current_revision_id: string;
  working_draft_revision_id: string | null;
  cover_asset_id: string | null;
  fidelity: Fidelity;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface SchemeRunWriteInput {
  runId: string;
  revisionId: string;
  mode: 'trial' | 'formal';
  policy: unknown;
  provider?: unknown;
}

/**
 * v6 canonical 资产读模型：跨 revision 的相册资产行（新结果在前）。
 * storeKey 仅供主进程解析 managed 存储做懒回填，绝不进入 canonical 出参。
 */
export interface AssetMetadataRow {
  id: string;
  revisionId: string;
  storeKey: string;
  role: 'cover' | 'example' | 'reference';
  origin: 'repository' | 'local-run';
  license: string | null;
  createdAt: number;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number | null;
  contentHash: string | null;
}

/** v6 canonical 来源文件读模型：path-free（相对路径 + 元数据，无 storeKey）。 */
export interface SourceFileMetadataRow {
  path: string;
  kind: 'text' | 'image' | 'other';
  sizeBytes: number;
  contentHash: string;
  mimeType: string | null;
  evidencePath: string | null;
  textExcerpt: string | null;
}

export interface SourceSnapshotMetadataRow {
  snapshotId: string;
  packageId: string;
  packageKind: 'github' | 'history' | 'user-brief';
  repositoryUrl: string | null;
  ref: string;
  commitHash: string | null;
  contentHash: string | null;
  totalBytes: number;
  createdAt: number;
  files: SourceFileMetadataRow[];
}

const SCHEME_SUMMARY_COLUMNS = `id, name, summary, status, source_presentation, source_label,
              current_revision_id, working_draft_revision_id, cover_asset_id, fidelity, version, created_at, updated_at`;

export class DesignSchemeVersionConflictError extends Error {
  readonly code = 'DESIGN_SCHEME_VERSION_CONFLICT';

  constructor(schemeId: string, expectedVersion: number) {
    super(`设计方案 ${schemeId} 版本已变化，期望版本 ${expectedVersion}`);
    this.name = 'DesignSchemeVersionConflictError';
  }
}

export class DesignSchemeRunStatusConflictError extends Error {
  readonly code = 'DESIGN_SCHEME_RUN_STATUS_CONFLICT';

  constructor(runId: string, expectedStatus: string, actualStatus: string) {
    super(`设计方案运行 ${runId} 状态冲突：期望 ${expectedStatus}，实际 ${actualStatus}`);
    this.name = 'DesignSchemeRunStatusConflictError';
  }
}

function assertValidDocument(document: DesignSchemeRevisionDocument): DesignSchemeRevisionDocument {
  const parsed = parseDesignSchemeRevisionDocument(document);
  if (!parsed.ok) {
    const issues = parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
    throw new Error(`设计方案文档校验失败：${issues}`);
  }
  return parsed.value;
}

/** 镜像 contracts designSchemeMimeSchema：type/subtype 形状（不限定 image/*）。 */
const ASSET_MIME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;
/** 镜像 contracts designSchemeHashSchema：可选 sha256: 前缀 + 64 位 hex。 */
const ASSET_SHA256_PATTERN = /^(?:sha256:)?[0-9a-f]{64}$/i;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * v6 资产元数据写入校验（镜像 contracts designSchemeAssetSchema 字段约束）。
 * 仓储层不做文件 IO；探测与文件的一致性由主进程 probe 保证，这里保证入库元数据
 * 自身完整、形状与 canonical 契约一致——半截或伪造的元数据不允许落库/回填。
 */
function assertAssetMetadataWrite(metadata: AssetMetadataWrite): void {
  if (typeof metadata.mimeType !== 'string' || !ASSET_MIME_PATTERN.test(metadata.mimeType)) {
    throw new Error('资产元数据 mimeType 不合法（应为 type/subtype 形状）');
  }
  for (const field of ['width', 'height'] as const) {
    const value = metadata[field];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`资产元数据 ${field} 必须是正整数`);
    }
  }
  if (!Number.isSafeInteger(metadata.byteSize) || metadata.byteSize < 0) {
    throw new Error('资产元数据 byteSize 必须是非负整数');
  }
  if (
    typeof metadata.contentHash !== 'string' ||
    !ASSET_SHA256_PATTERN.test(metadata.contentHash)
  ) {
    throw new Error('资产元数据 contentHash 必须是 SHA-256（64 位 hex，可选 sha256: 前缀）');
  }
}

/**
 * 仓储层 storeKey 写入校验：非空、无控制字符。
 * managed 根 containment（userData/Pictures）由主进程 resolveManagedStoreKey 负责——
 * core 包没有宿主路径知识，不在此重复判定。
 */
function assertManagedStoreKey(storeKey: string): void {
  if (typeof storeKey !== 'string' || storeKey.trim().length === 0) {
    throw new Error('资产 storeKey 不能为空');
  }
  if (hasControlCharacter(storeKey)) {
    throw new Error('资产 storeKey 含非法控制字符');
  }
}

export class DesignSchemeRepository {
  constructor(private readonly db: Database.Database) {}

  saveSourceSnapshot(input: SourceSnapshotWriteInput): { packageId: string; snapshotId: string } {
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO source_packages (id, kind, repository_url, license, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.package.id,
          input.package.kind,
          input.package.repositoryUrl ?? null,
          input.package.license ?? null,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO source_snapshots (id, package_id, ref, commit_hash, content_hash, total_bytes, scan_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.snapshot.id,
          input.package.id,
          input.snapshot.ref,
          input.snapshot.commitHash,
          input.snapshot.contentHash ?? null,
          input.snapshot.totalBytes,
          JSON.stringify(input.snapshot.scan ?? {}),
          now,
        );
      const insertFile = this.db.prepare(
        `INSERT INTO source_files
           (snapshot_id, path, kind, content_hash, size_bytes, store_key, text_content, mime_type, evidence_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const file of input.files) {
        insertFile.run(
          input.snapshot.id,
          file.path,
          file.kind,
          file.contentHash,
          file.sizeBytes,
          file.storeKey ?? null,
          file.textContent ?? null,
          file.mimeType ?? null,
          file.evidencePath ?? null,
        );
      }
    })();
    return { packageId: input.package.id, snapshotId: input.snapshot.id };
  }

  insertSchemeDraft(input: SchemeDraftWriteInput): DesignSchemeSummary {
    const document = assertValidDocument(input.document);
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO design_schemes
           (id, name, summary, status, source_presentation, source_label,
            current_revision_id, fidelity, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          document.schemeId,
          document.name,
          document.summary,
          input.sourcePresentation,
          input.sourceLabel,
          document.revisionId,
          document.fidelity,
          now,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO design_scheme_revisions
           (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          document.revisionId,
          document.schemeId,
          document.schemaVersion,
          JSON.stringify(document),
          input.createdBy,
          now,
        );
      const insertBinding = this.db.prepare(
        `INSERT OR IGNORE INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         VALUES (?, ?, ?)`,
      );
      for (const binding of input.bindings) {
        insertBinding.run(document.revisionId, binding.snapshotId, binding.role);
      }
    })();
    return this.requireSummary(document.schemeId);
  }

  listSummaries(): DesignSchemeSummary[] {
    const rows = this.db
      .prepare(
        `SELECT ${SCHEME_SUMMARY_COLUMNS}
         FROM design_schemes
        WHERE deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 200`,
      )
      .all() as SchemeRow[];
    return rows.map((row) => this.toSummary(row));
  }

  /** 方案全部相册资产（跨 revision），新结果在前；封面排序交给 UI。 */
  listAssets(schemeId: string): DesignSchemeAssetSummary[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.revision_id, a.store_key, a.role, a.origin, a.created_at
         FROM design_scheme_assets a
         JOIN design_scheme_revisions r ON r.revision_id = a.revision_id
        WHERE r.scheme_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200`,
      )
      .all(schemeId) as Array<{
      id: string;
      revision_id: string;
      store_key: string;
      role: string;
      origin: string;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      revisionId: row.revision_id,
      path: row.store_key,
      role: row.role === 'cover' ? 'cover' : 'example',
      origin: row.origin === 'repository' ? 'repo-example' : 'local-run',
      createdAt: row.created_at,
    }));
  }

  /**
   * v6 canonical 资产读模型（详情用）：跨 revision 全量资产 + 元数据列。
   * storeKey 只回给主进程做懒回填定位；映射层负责剔除元数据不完整的行。
   */
  listAssetMetadataRows(schemeId: string): AssetMetadataRow[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.revision_id, a.store_key, a.role, a.origin, a.license, a.created_at,
                a.mime_type, a.width, a.height, a.byte_size, a.content_hash
         FROM design_scheme_assets a
         JOIN design_scheme_revisions r ON r.revision_id = a.revision_id
        WHERE r.scheme_id = ?
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 200`,
      )
      .all(schemeId) as Array<{
      id: string;
      revision_id: string;
      store_key: string;
      role: string;
      origin: string;
      license: string | null;
      created_at: number;
      mime_type: string | null;
      width: number | null;
      height: number | null;
      byte_size: number | null;
      content_hash: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      revisionId: row.revision_id,
      storeKey: row.store_key,
      role: row.role === 'cover' ? 'cover' : row.role === 'reference' ? 'reference' : 'example',
      origin: row.origin === 'repository' ? 'repository' : 'local-run',
      license: row.license,
      createdAt: row.created_at,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      byteSize: row.byte_size,
      contentHash: row.content_hash,
    }));
  }

  requireSummary(schemeId: string): DesignSchemeSummary {
    const row = this.db
      .prepare(
        `SELECT ${SCHEME_SUMMARY_COLUMNS}
         FROM design_schemes
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(schemeId) as SchemeRow | undefined;
    if (!row) throw new Error('设计方案不存在');
    return this.toSummary(row);
  }

  /** 重命名只改展示名（编译文档是不可变产物，保留编译时名称）。 */
  rename(schemeId: string, name: string, expectedVersion?: number): DesignSchemeSummary {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('方案名称不能为空');
    if (trimmed.length > 80) throw new Error('方案名称不能超过 80 个字符');
    const summary = this.requireSummary(schemeId);
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    const result = this.db
      .prepare(
        `UPDATE design_schemes
            SET name = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(trimmed, Date.now(), schemeId, summary.version);
    this.assertUpdated(schemeId, summary.version, result.changes);
    return this.requireSummary(schemeId);
  }

  /**
   * 删除草稿 / 移除正式方案：软删除（运行记录与来源快照保留，保证历史可追溯；
   * schema 中 runs → revisions 也没有级联删除）。
   */
  softDelete(schemeId: string, expectedVersion?: number): void {
    const summary = this.requireSummary(schemeId);
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE design_schemes
            SET deleted_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(now, now, schemeId, summary.version);
    this.assertUpdated(schemeId, summary.version, result.changes);
  }

  /**
   * 「查看来源」数据：当前 revision 绑定的每个来源快照及其固化文件清单。
   * 文本内容截断到 2000 字符，图片返回 storeKey 供 UI 以 file 协议展示。
   */
  listSourceFiles(schemeId: string): DesignSchemeSourceSnapshotDetail[] {
    const summary = this.requireSummary(schemeId);
    const snapshots = this.db
      .prepare(
        `SELECT s.id, s.ref, s.commit_hash, s.created_at, p.kind, p.repository_url, p.license
         FROM design_scheme_source_bindings b
         JOIN source_snapshots s ON s.id = b.source_snapshot_id
         JOIN source_packages p ON p.id = s.package_id
        WHERE b.revision_id = ?
        ORDER BY s.created_at`,
      )
      .all(summary.currentRevisionId) as Array<{
      id: string;
      ref: string;
      commit_hash: string | null;
      created_at: number;
      kind: 'github' | 'history' | 'user-brief';
      repository_url: string | null;
      license: string | null;
    }>;
    const fileQuery = this.db.prepare(
      `SELECT path, kind, size_bytes, store_key, text_content
         FROM source_files WHERE snapshot_id = ? ORDER BY path LIMIT 200`,
    );
    return snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      packageKind: snapshot.kind,
      repositoryUrl: snapshot.repository_url,
      ref: snapshot.ref,
      commitHash: snapshot.commit_hash,
      license: snapshot.license,
      createdAt: snapshot.created_at,
      files: (
        fileQuery.all(snapshot.id) as Array<{
          path: string;
          kind: 'text' | 'image' | 'other';
          size_bytes: number;
          store_key: string | null;
          text_content: string | null;
        }>
      ).map((file) => ({
        path: file.path,
        kind: file.kind,
        sizeBytes: file.size_bytes,
        storeKey: file.store_key,
        textExcerpt: file.text_content ? file.text_content.slice(0, 2000) : null,
      })),
    }));
  }

  /**
   * v6 canonical 来源读模型（详情用）：指定 revision 绑定的快照与固化文件，
   * 只含相对路径与元数据（无 storeKey）；文本节选截断到 2000 字符。
   */
  listSourceSnapshotMetadata(schemeId: string, revisionId?: string): SourceSnapshotMetadataRow[] {
    const summary = this.requireSummary(schemeId);
    const selectedRevisionId = revisionId ?? summary.currentRevisionId;
    const snapshots = this.db
      .prepare(
        `SELECT s.id, s.package_id, p.kind, p.repository_url, s.ref, s.commit_hash,
                s.content_hash, s.total_bytes, s.created_at
         FROM design_scheme_source_bindings b
         JOIN design_scheme_revisions r ON r.revision_id = b.revision_id
         JOIN source_snapshots s ON s.id = b.source_snapshot_id
         JOIN source_packages p ON p.id = s.package_id
        WHERE b.revision_id = ? AND r.scheme_id = ?
        ORDER BY s.created_at`,
      )
      .all(selectedRevisionId, schemeId) as Array<{
      id: string;
      package_id: string;
      kind: 'github' | 'history' | 'user-brief';
      repository_url: string | null;
      ref: string;
      commit_hash: string | null;
      content_hash: string | null;
      total_bytes: number;
      created_at: number;
    }>;
    const fileQuery = this.db.prepare(
      `SELECT path, kind, size_bytes, content_hash, mime_type, evidence_path, text_content
         FROM source_files WHERE snapshot_id = ? ORDER BY path LIMIT 500`,
    );
    return snapshots.map((snapshot) => ({
      snapshotId: snapshot.id,
      packageId: snapshot.package_id,
      packageKind: snapshot.kind,
      repositoryUrl: snapshot.repository_url,
      ref: snapshot.ref,
      commitHash: snapshot.commit_hash,
      contentHash: snapshot.content_hash,
      totalBytes: snapshot.total_bytes,
      createdAt: snapshot.created_at,
      files: (
        fileQuery.all(snapshot.id) as Array<{
          path: string;
          kind: 'text' | 'image' | 'other';
          size_bytes: number;
          content_hash: string;
          mime_type: string | null;
          evidence_path: string | null;
          text_content: string | null;
        }>
      ).map((file) => ({
        path: file.path,
        kind: file.kind,
        sizeBytes: file.size_bytes,
        contentHash: file.content_hash,
        mimeType: file.mime_type,
        evidencePath: file.evidence_path,
        textExcerpt: file.text_content ? file.text_content.slice(0, 2000) : null,
      })),
    }));
  }

  // -------------------------------------------------------------------------
  // 运行切片：试运行 / 正式使用的运行记录、相册资产、封面与转正
  // -------------------------------------------------------------------------

  insertRun(input: SchemeRunWriteInput): void {
    this.db
      .prepare(
        `INSERT INTO design_scheme_runs (run_id, revision_id, mode, status, policy_json, provider_json, created_at)
       VALUES (?, ?, ?, 'planning', ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.revisionId,
        input.mode,
        JSON.stringify(input.policy ?? {}),
        input.provider === undefined ? null : JSON.stringify(input.provider),
        Date.now(),
      );
  }

  finalizeRunStatus(runId: string, status: 'completed' | 'blocked' | 'failed' | 'cancelled'): void {
    const terminalStatuses = new Set(['completed', 'blocked', 'failed', 'cancelled']);
    const current = this.db
      .prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?')
      .get(runId) as { status: string } | undefined;
    if (!current) throw new Error('设计方案运行不存在');
    if (current.status === status) return;
    if (terminalStatuses.has(current.status)) {
      throw new DesignSchemeRunStatusConflictError(
        runId,
        'planning|executing|evaluating',
        current.status,
      );
    }
    if (!terminalStatuses.has(status)) throw new Error('设计方案运行终态无效');
    const result = this.db
      .prepare(
        `UPDATE design_scheme_runs
            SET status = ?, completed_at = COALESCE(completed_at, ?)
          WHERE run_id = ? AND status IN ('planning', 'executing', 'evaluating')`,
      )
      .run(status, Date.now(), runId);
    if (result.changes !== 1) {
      const next = this.db
        .prepare('SELECT status FROM design_scheme_runs WHERE run_id = ?')
        .get(runId) as { status: string } | undefined;
      if (!next || next.status !== status) {
        throw new DesignSchemeRunStatusConflictError(
          runId,
          'planning|executing|evaluating',
          next?.status ?? 'missing',
        );
      }
    }
  }

  updateRunStatus(
    runId: string,
    status:
      | 'planning'
      | 'executing'
      | 'evaluating'
      | 'completed'
      | 'blocked'
      | 'failed'
      | 'cancelled',
  ): void {
    const terminal = ['completed', 'blocked', 'failed', 'cancelled'].includes(status);
    if (terminal) {
      this.db
        .prepare(
          `UPDATE design_scheme_runs
              SET status = ?, completed_at = COALESCE(completed_at, ?)
            WHERE run_id = ? AND status NOT IN ('completed', 'blocked', 'failed', 'cancelled')`,
        )
        .run(status, Date.now(), runId);
      return;
    }
    this.db
      .prepare(
        `UPDATE design_scheme_runs
            SET status = ?
          WHERE run_id = ? AND status NOT IN ('completed', 'blocked', 'failed', 'cancelled')`,
      )
      .run(status, runId);
  }

  upsertRunStep(
    runId: string,
    stepId: string,
    patch: {
      status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
      input?: unknown;
      output?: unknown;
    },
  ): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO design_scheme_run_steps (run_id, step_id, status, input_json, output_json, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, step_id) DO UPDATE SET
         status = excluded.status,
         input_json = COALESCE(excluded.input_json, design_scheme_run_steps.input_json),
         output_json = COALESCE(excluded.output_json, design_scheme_run_steps.output_json),
         completed_at = excluded.completed_at`,
      )
      .run(
        runId,
        stepId,
        patch.status,
        patch.input === undefined ? null : JSON.stringify(patch.input),
        patch.output === undefined ? null : JSON.stringify(patch.output),
        now,
        ['completed', 'failed', 'cancelled'].includes(patch.status) ? now : null,
      );
  }

  /** 质量门结果入库（开发规范 §10：metrics 指标 + 逐张证据），返回评估 id。 */
  insertEvaluation(
    runId: string,
    input: {
      passed: boolean;
      metrics: unknown;
      evidence: unknown;
    },
  ): string {
    const evaluationId = `dse_${ulid()}`;
    this.db
      .prepare(
        `INSERT INTO design_scheme_evaluations (evaluation_id, run_id, passed, metrics_json, evidence_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evaluationId,
        runId,
        input.passed ? 1 : 0,
        JSON.stringify(input.metrics),
        JSON.stringify(input.evidence),
        Date.now(),
      );
    return evaluationId;
  }

  getRunEvaluation(runId: string): {
    evaluationId: string;
    passed: boolean;
    metrics: unknown;
    evidence: unknown;
    createdAt: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT evaluation_id, passed, metrics_json, evidence_json, created_at
         FROM design_scheme_evaluations WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(runId) as
      | {
          evaluation_id: string;
          passed: number;
          metrics_json: string;
          evidence_json: string;
          created_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      evaluationId: row.evaluation_id,
      passed: row.passed === 1,
      metrics: JSON.parse(row.metrics_json),
      evidence: JSON.parse(row.evidence_json),
      createdAt: row.created_at,
    };
  }

  /**
   * 试运行成功结果自动进入草稿相册（UI 规范 §5.2），返回资产 id。
   * v6：调用方（主进程）应传入真实探测到的文件元数据；legacy 行不传，
   * 由 canonical 读路径懒回填，不在此伪造。入库前校验 storeKey 形状与元数据
   * 完整性（镜像 canonical 契约），拒绝半截/伪造元数据落库。
   */
  insertLocalRunAsset(revisionId: string, storeKey: string, metadata?: AssetMetadataWrite): string {
    assertManagedStoreKey(storeKey);
    if (metadata !== undefined) assertAssetMetadataWrite(metadata);
    const assetId = `dsa_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    this.db
      .prepare(
        `INSERT INTO design_scheme_assets
           (id, revision_id, store_key, role, origin, mime_type, width, height, byte_size, content_hash, created_at)
       VALUES (?, ?, ?, 'example', 'local-run', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        assetId,
        revisionId,
        storeKey,
        metadata?.mimeType ?? null,
        metadata?.width ?? null,
        metadata?.height ?? null,
        metadata?.byteSize ?? null,
        metadata?.contentHash ?? null,
        Date.now(),
      );
    return assetId;
  }

  /**
   * v6 懒回填：把主进程真实探测到的元数据写回不完整的资产行。
   * - 全 NULL 的 legacy 行：一次性全量补齐；
   * - 部分字段已写的行：视为过期残片，不信任既有字段，整体以探测结果覆盖
   *   （避免新旧字段拼接出互相矛盾的元数据）；
   * - 五字段齐全的行：canonical 写入即权威，回填是 no-op，不覆盖。
   */
  backfillAssetMetadata(assetId: string, metadata: AssetMetadataWrite): void {
    assertAssetMetadataWrite(metadata);
    this.db
      .prepare(
        `UPDATE design_scheme_assets
            SET mime_type = ?, width = ?, height = ?, byte_size = ?, content_hash = ?
          WHERE id = ? AND (mime_type IS NULL OR width IS NULL OR height IS NULL
                            OR byte_size IS NULL OR content_hash IS NULL)`,
      )
      .run(
        metadata.mimeType,
        metadata.width,
        metadata.height,
        metadata.byteSize,
        metadata.contentHash,
        assetId,
      );
  }

  /**
   * 封面来源不变量（provenance）：只接受「当前选中 revision」上的本机试运行产物，
   * 即 origin = 'local-run' 且 role ∈ {'example', 'cover'} 的资产。
   * 仓库示例图（origin = 'repository'）、参考图（role = 'reference'）与其他 revision
   * 的历史资产一律拒绝；拒绝时不改封面、不递增版本。
   * 「成功试运行」资格本身由转正链路（formalize / promoteWorkingDraft）裁决，此处不重复。
   */
  selectCover(schemeId: string, assetId: string, expectedVersion?: number): DesignSchemeSummary {
    const summary = this.requireSummary(schemeId);
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    const asset = this.db
      .prepare(
        `SELECT a.revision_id, a.role, a.origin FROM design_scheme_assets a
        JOIN design_scheme_revisions r ON r.revision_id = a.revision_id
       WHERE a.id = ? AND r.scheme_id = ?`,
      )
      .get(assetId, schemeId) as { revision_id: string; role: string; origin: string } | undefined;
    if (!asset) throw new Error('封面必须选择本方案的试运行结果');
    if (asset.origin !== 'local-run') {
      throw new Error('封面必须来自本机试运行结果，不能使用仓库示例图');
    }
    if (asset.role === 'reference') throw new Error('封面不能使用参考图资产');
    if (asset.revision_id !== summary.currentRevisionId) {
      throw new Error('封面必须来自当前选中版本的试运行结果，请刷新后再选择');
    }
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE design_schemes
            SET cover_asset_id = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(assetId, now, schemeId, summary.version);
    this.assertUpdated(schemeId, summary.version, result.changes);
    return this.requireSummary(schemeId);
  }

  /**
   * 结构化编辑输入槽位（改必需/可选、删除）：产出新 revision 并把方案指向它。
   *
   * - 只允许草稿方案；正式方案的修改走 Composer 修改再版（规范 §8）。
   * - 不允许新增槽位；文本类槽位被 promptProgram 模板引用时不允许删除，
   *   否则运行时会出现无法填充的 {{变量}}。
   * - 新 revision 继承来源绑定；试运行校验按 revision 计，编辑后需重新试运行。
   */
  updateRevisionInputs(
    schemeId: string,
    baseRevisionId: string,
    nextInputs: Array<{ id: string; required: boolean }>,
    expectedVersion?: number,
  ): { summary: DesignSchemeSummary; document: DesignSchemeRevisionDocument } {
    const summary = this.requireSummary(schemeId);
    if (summary.status !== 'draft') {
      throw new Error('正式方案暂不支持结构化编辑输入，请通过修改再版调整');
    }
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    if (summary.currentRevisionId !== baseRevisionId) {
      throw new Error('方案已有更新版本，请刷新后再编辑');
    }
    const document = this.getRevisionDocument(baseRevisionId);
    if (!document) throw new Error('方案版本不存在');

    const existing = new Map(document.inputs.map((slot) => [slot.id, slot]));
    for (const edit of nextInputs) {
      if (!existing.has(edit.id)) throw new Error('结构化编辑不支持新增输入槽位');
    }
    const keptIds = new Set(nextInputs.map((edit) => edit.id));
    const templateVariables = new Set(document.promptProgram.flatMap((module) => module.variables));
    for (const slot of document.inputs) {
      if (keptIds.has(slot.id)) continue;
      const isTextSlot = slot.kind === 'text' || slot.kind === 'article' || slot.kind === 'choice';
      if (isTextSlot && templateVariables.has(slot.id)) {
        throw new Error(`「${slot.label}」被方案提示词模板引用，不能删除`);
      }
    }

    const requiredById = new Map(nextInputs.map((edit) => [edit.id, edit.required]));
    const inputs = document.inputs
      .filter((slot) => keptIds.has(slot.id))
      .map((slot) => ({ ...slot, required: requiredById.get(slot.id) ?? slot.required }));

    const revisionId = `dsrv_${ulid()}`;
    const nextDocument = assertValidDocument({ ...document, revisionId, inputs });
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO design_scheme_revisions
           (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
         VALUES (?, ?, ?, ?, 'user', ?)`,
        )
        .run(revisionId, schemeId, nextDocument.schemaVersion, JSON.stringify(nextDocument), now);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         SELECT ?, source_snapshot_id, role FROM design_scheme_source_bindings WHERE revision_id = ?`,
        )
        .run(revisionId, baseRevisionId);
      const result = this.db
        .prepare(
          `UPDATE design_schemes
              SET current_revision_id = ?, version = version + 1, updated_at = ?
            WHERE id = ? AND deleted_at IS NULL AND version = ?`,
        )
        .run(revisionId, now, schemeId, summary.version);
      if (result.changes !== 1) {
        throw new DesignSchemeVersionConflictError(schemeId, summary.version);
      }
    })();
    return { summary: this.requireSummary(schemeId), document: nextDocument };
  }

  /**
   * Agent 修改再版（UI 规范 §8.3）：
   * - 草稿方案：新 revision 直接成为当前版本（同一份草稿被更新）。
   * - 正式方案：当前正式 revision 不动，新 revision 写入 working_draft_revision_id；
   *   只有它再次通过本机试运行并由用户确认后才替换正式版本（规范 §2.2）。
   * 新 revision 继承基线的来源绑定。
   */
  applyAgentRevision(
    schemeId: string,
    baseRevisionId: string,
    document: DesignSchemeRevisionDocument,
    extraBindings: Array<{ snapshotId: string; role: SourceRole }> = [],
    expectedVersion?: number,
  ): { summary: DesignSchemeSummary; document: DesignSchemeRevisionDocument } {
    const summary = this.requireSummary(schemeId);
    const validBase =
      summary.status === 'draft'
        ? baseRevisionId === summary.currentRevisionId
        : baseRevisionId === summary.currentRevisionId ||
          baseRevisionId === summary.workingDraftRevisionId;
    if (!validBase) throw new Error('方案已有更新版本，请刷新后再修改');
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    if (document.schemeId !== schemeId) throw new Error('修改结果与方案不匹配');
    const validated = assertValidDocument(document);
    const now = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO design_scheme_revisions
           (revision_id, scheme_id, schema_version, document_json, created_by, created_at)
         VALUES (?, ?, ?, ?, 'agent', ?)`,
        )
        .run(
          validated.revisionId,
          schemeId,
          validated.schemaVersion,
          JSON.stringify(validated),
          now,
        );
      this.db
        .prepare(
          `INSERT OR IGNORE INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         SELECT ?, source_snapshot_id, role FROM design_scheme_source_bindings WHERE revision_id = ?`,
        )
        .run(validated.revisionId, baseRevisionId);
      const insertBinding = this.db.prepare(
        `INSERT OR IGNORE INTO design_scheme_source_bindings (revision_id, source_snapshot_id, role)
         VALUES (?, ?, ?)`,
      );
      for (const binding of extraBindings) {
        insertBinding.run(validated.revisionId, binding.snapshotId, binding.role);
      }
      if (summary.status === 'draft') {
        const result = this.db
          .prepare(
            `UPDATE design_schemes
                SET current_revision_id = ?, name = ?, summary = ?, fidelity = ?,
                    version = version + 1, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL AND version = ?`,
          )
          .run(
            validated.revisionId,
            validated.name,
            validated.summary,
            validated.fidelity,
            now,
            schemeId,
            summary.version,
          );
        if (result.changes !== 1) {
          throw new DesignSchemeVersionConflictError(schemeId, summary.version);
        }
      } else {
        // 正式方案：名称/简介保持正式版本的展示；新内容只挂在待验证草稿上。
        const result = this.db
          .prepare(
            `UPDATE design_schemes
                SET working_draft_revision_id = ?, version = version + 1, updated_at = ?
              WHERE id = ? AND deleted_at IS NULL AND version = ?`,
          )
          .run(validated.revisionId, now, schemeId, summary.version);
        if (result.changes !== 1) {
          throw new DesignSchemeVersionConflictError(schemeId, summary.version);
        }
      }
    })();
    return { summary: this.requireSummary(schemeId), document: validated };
  }

  /**
   * 待验证草稿替换正式版本（规范 §2.2）：要求该草稿 revision 已有成功本机试运行，
   * 且由用户明确确认（调用方即确认动作）。
   */
  promoteWorkingDraft(schemeId: string, expectedVersion?: number): DesignSchemeSummary {
    const summary = this.requireSummary(schemeId);
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    if (summary.status !== 'formal') throw new Error('只有正式方案存在待验证草稿');
    const workingDraft = summary.workingDraftRevisionId;
    if (!workingDraft) throw new Error('这个方案没有待验证的新版本');
    if (!this.hasSuccessfulTrial(workingDraft)) {
      throw new Error('新版本需要先完成一次成功的本机试运行');
    }
    const document = this.getRevisionDocument(workingDraft);
    if (!document) throw new Error('待验证版本不存在');
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE design_schemes
            SET current_revision_id = ?, working_draft_revision_id = NULL,
                name = ?, summary = ?, fidelity = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(
        workingDraft,
        document.name,
        document.summary,
        document.fidelity,
        now,
        schemeId,
        summary.version,
      );
    this.assertUpdated(schemeId, summary.version, result.changes);
    return this.requireSummary(schemeId);
  }

  hasSuccessfulTrial(revisionId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS hit FROM design_scheme_runs
        WHERE revision_id = ? AND mode = 'trial' AND status = 'completed'
        LIMIT 1`,
      )
      .get(revisionId) as { hit: number } | undefined;
    return Boolean(row);
  }

  /**
   * 草稿转正式（规范 §2.2/§15.1）：至少一次成功本机试运行 + 有效封面。
   * 试运行成功不会自动调用这里；必须由用户明确执行。
   */
  formalize(schemeId: string, expectedVersion?: number): DesignSchemeSummary {
    const summary = this.requireSummary(schemeId);
    this.assertExpectedVersion(schemeId, summary.version, expectedVersion);
    if (summary.status === 'formal') throw new Error('方案已是正式状态');
    if (!summary.hasSuccessfulTrial) throw new Error('转为正式前需要至少一次成功的本机试运行');
    if (!summary.coverAssetId) throw new Error('请先从试运行结果中选择封面');
    const result = this.db
      .prepare(
        `UPDATE design_schemes
            SET status = 'formal', version = version + 1, updated_at = ?
          WHERE id = ? AND deleted_at IS NULL AND version = ?`,
      )
      .run(Date.now(), schemeId, summary.version);
    this.assertUpdated(schemeId, summary.version, result.changes);
    return this.requireSummary(schemeId);
  }

  private assertExpectedVersion(
    schemeId: string,
    actualVersion: number,
    expectedVersion: number | undefined,
  ): void {
    if (expectedVersion !== undefined && expectedVersion !== actualVersion) {
      throw new DesignSchemeVersionConflictError(schemeId, expectedVersion);
    }
  }

  private assertUpdated(schemeId: string, expectedVersion: number, changes: number): void {
    if (changes !== 1) {
      throw new DesignSchemeVersionConflictError(schemeId, expectedVersion);
    }
  }

  private coverImagePath(coverAssetId: string | null): string | null {
    if (!coverAssetId) return null;
    const row = this.db
      .prepare('SELECT store_key FROM design_scheme_assets WHERE id = ?')
      .get(coverAssetId) as { store_key: string } | undefined;
    return row?.store_key ?? null;
  }

  getRevisionDocument(revisionId: string): DesignSchemeRevisionDocument | null {
    const row = this.db
      .prepare('SELECT document_json FROM design_scheme_revisions WHERE revision_id = ?')
      .get(revisionId) as { document_json: string } | undefined;
    if (!row) return null;
    const parsed = parseDesignSchemeRevisionDocument(JSON.parse(row.document_json));
    if (!parsed.ok) throw new Error('设计方案文档已损坏，无法读取');
    return parsed.value;
  }

  private toSummary(row: SchemeRow): DesignSchemeSummary {
    return {
      id: row.id,
      name: row.name,
      summary: row.summary,
      status: row.status,
      fidelity: row.fidelity,
      sourcePresentation: row.source_presentation,
      sourceLabel: row.source_label,
      currentRevisionId: row.current_revision_id,
      version: row.version,
      workingDraftRevisionId: row.working_draft_revision_id,
      inputLabels: this.inputLabels(row.current_revision_id),
      coverAssetId: row.cover_asset_id,
      coverImagePath: this.coverImagePath(row.cover_asset_id),
      hasSuccessfulTrial: this.hasSuccessfulTrial(row.current_revision_id),
      lastRunAt: this.lastRunAt(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** 方案任意 revision 最近一次完成运行的时间（选择器「最近使用」排序）。 */
  private lastRunAt(schemeId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(run.created_at) AS latest
         FROM design_scheme_runs run
         JOIN design_scheme_revisions rev ON rev.revision_id = run.revision_id
        WHERE rev.scheme_id = ? AND run.status = 'completed'`,
      )
      .get(schemeId) as { latest: number | null } | undefined;
    return row?.latest ?? null;
  }

  private inputLabels(revisionId: string): string[] {
    try {
      const document = this.getRevisionDocument(revisionId);
      return (document?.inputs ?? []).map((input) =>
        input.required ? `${input.label} · 必需` : input.label,
      );
    } catch {
      return [];
    }
  }
}
