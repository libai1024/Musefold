import { cloudAgentAssets } from '@musefold/domain/design-scheme/cloud-materials';
import { decodeSchemeListCursor, encodeSchemeListCursor } from './list-cursor.js';
import type { DesignSchemeAgentMaterials } from '@musefold/contracts';
import { executionDigest } from '@musefold/db';
import {
  type CheckDesignSchemeUpdateInput,
  type CreateDesignSchemeInput,
  type DesignSchemeDetail,
  type DesignSchemeDetailInput,
  type DesignSchemePage,
  type DesignSchemeSummary,
  type ExportDesignSchemeInput,
  type FormalizeDesignSchemeInput,
  type ImportDesignSchemeInput,
  type ModifyDesignSchemeInput,
  type ParsedDesignSchemeListQuery,
  type ParsedMarketSearchQuery,
  type PrepareDesignSchemeImportPackageInput,
  type PromoteWorkingDraftInput,
  type RemoveDesignSchemeInput,
  type RenameDesignSchemeInput,
  type SelectCoverInput,
  type UpdateDesignSchemeInput,
  cancelDesignSchemeInputSchema,
  confirmDesignSchemeInstallInputSchema,
  createDesignSchemeInputSchema,
  createDesignSchemeResultSchema,
  designSchemeAssetSchema,
  designSchemeDetailInputSchema,
  designSchemeDetailSchema,
  designSchemePageSchema,
  designSchemeRevisionDocumentSchema,
  designSchemeRunInputSchema,
  designSchemeSummarySchema,
  formalizeDesignSchemeInputSchema,
  formalizeDesignSchemeResultSchema,
  prepareDesignSchemeImportPackageInputSchema,
  promoteWorkingDraftInputSchema,
  promoteWorkingDraftResultSchema,
  removeDesignSchemeInputSchema,
  removeDesignSchemeResultSchema,
  renameDesignSchemeInputSchema,
  renameDesignSchemeResultSchema,
  selectCoverInputSchema,
  selectCoverResultSchema,
  sourceSnapshotSchema,
  updateDesignSchemeInputSchema,
  updateDesignSchemeResultSchema,
} from '@musefold/contracts';
import {
  type MusefoldDatabase,
  designSchemeAssets,
  designSchemeRevisions,
  designSchemeSourceBindings,
  designSchemeSourceFiles,
  designSchemeSourcePackages,
  designSchemeSourceSnapshots,
  designSchemeSourcePreparations,
  designSchemes,
} from '@musefold/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import type { DesignSchemeRunService } from '../design-scheme-runs/service.js';
import type { PrepareDesignSchemeRunInput } from '@musefold/contracts';
import type { DesignSchemeMarketSearchService } from './market-search.js';
import type { DesignSchemePackageImportService } from '../design-scheme-packages/import-service.js';
import { purgeDesignScheme } from './purge-service.js';
import type { PurgeDesignSchemeInput } from '@musefold/contracts';

type Tx = MusefoldDatabase | Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];

const MAX_PG_INTEGER = 2_147_483_647;

/**
 * Fail-closed cloud blocker codes. Values must match the api-client operation
 * mapping (`unavailableCodeByOperation` in packages/api-client design-schemes)
 * so the server-reported code and the client-mapped code never diverge.
 */
export const CLOUD_DESIGN_SCHEME_UNAVAILABLE = {
  market: 'DESIGN_SCHEME_CLOUD_MARKET_UNAVAILABLE',
  create: 'DESIGN_SCHEME_CLOUD_CREATE_UNAVAILABLE',
  agentModify: 'DESIGN_SCHEME_CLOUD_AGENT_MODIFY_UNAVAILABLE',
  run: 'DESIGN_SCHEME_CLOUD_RUN_UNAVAILABLE',
  cancel: 'DESIGN_SCHEME_CLOUD_RUN_CANCEL_UNAVAILABLE',
  checkUpdate: 'DESIGN_SCHEME_CLOUD_CHECK_UPDATE_UNAVAILABLE',
  prepareImportPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  importPackage: 'DESIGN_SCHEME_CLOUD_IMPORT_STAGING_UNAVAILABLE',
  exportPackage: 'DESIGN_SCHEME_CLOUD_EXPORT_STAGING_UNAVAILABLE',
  assetStaging: 'DESIGN_SCHEME_CLOUD_ASSET_STAGING_UNAVAILABLE',
} as const;

const summaryProjection = sql`
  ds.id, ds.name, ds.summary, ds.status, ds.source_presentation,
  ds.source_label, ds.current_revision_id, ds.working_draft_revision_id,
  ds.cover_asset_id, ds.fidelity, ds.version, ds.created_at, ds.updated_at,
  current_revision.document AS current_document,
  EXISTS (
    SELECT 1 FROM design_scheme_runs successful_run
    WHERE successful_run.user_id = ds.user_id
      AND successful_run.revision_id = ds.current_revision_id
      AND successful_run.mode = 'trial'
      AND successful_run.status = 'completed'
      AND successful_run.deleted_at IS NULL
  ) AS has_successful_trial,
  (
    SELECT max(completed_run.created_at)
    FROM design_scheme_runs completed_run
    WHERE completed_run.user_id = ds.user_id
      AND completed_run.scheme_id = ds.id
      AND completed_run.status = 'completed'
      AND completed_run.deleted_at IS NULL
  ) AS last_run_at
`;

interface SummaryRow {
  id: string;
  name: string;
  summary: string;
  status: string;
  source_presentation: string;
  source_label: string;
  current_revision_id: string;
  working_draft_revision_id: string | null;
  cover_asset_id: string | null;
  fidelity: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  current_document: unknown;
  has_successful_trial: boolean;
  last_run_at: Date | string | null;
}

interface SummaryRecord {
  summary: DesignSchemeSummary;
  document: z.output<typeof designSchemeRevisionDocumentSchema>;
}

/** Owner-scoped cloud persistence for deterministic Design Schemes operations. */
export class DesignSchemeService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly assets?: DesignSchemeAssetService,
    private readonly runs?: DesignSchemeRunService,
    private readonly market?: DesignSchemeMarketSearchService,
    private readonly packageImports?: DesignSchemePackageImportService,
  ) {}

  async list(userId: string, query: ParsedDesignSchemeListQuery): Promise<DesignSchemePage> {
    const conditions = [
      sql`ds.user_id = ${userId}`,
      query.deletedOnly ? sql`ds.deleted_at IS NOT NULL` : sql`ds.deleted_at IS NULL`,
    ];
    if (query.status) conditions.push(sql`ds.status = ${query.status}`);
    if (query.fidelity) conditions.push(sql`ds.fidelity = ${query.fidelity}`);
    if (query.query) {
      const pattern = `%${query.query.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(
        sql`(ds.name || ' ' || ds.summary || ' ' || ds.source_label || ' ' || ds.id) ILIKE ${pattern}`,
      );
    }
    const cursor = decodeSchemeListCursor(query);
    if (cursor) {
      conditions.push(
        sql`(ds.updated_at, ds.id COLLATE "C") < (${cursor.updatedAt}::timestamptz, ${cursor.id} COLLATE "C")`,
      );
    }

    const result = await this.db.execute(sql`
      SELECT ${summaryProjection},
        to_char(ds.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_updated_at
      FROM design_schemes ds
      JOIN design_scheme_revisions current_revision
        ON current_revision.revision_id = ds.current_revision_id
       AND current_revision.user_id = ds.user_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY ds.updated_at DESC, ds.id COLLATE "C" DESC
      LIMIT ${query.limit + 1}
    `);
    const rows = result.rows as unknown as Array<SummaryRow & { cursor_updated_at: string }>;
    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const items = pageRows.map((row) => toSummaryRecord(row).summary);
    const last = pageRows.at(-1);
    return designSchemePageSchema.parse({
      items,
      nextCursor:
        hasMore && last ? encodeSchemeListCursor(query, last.cursor_updated_at, last.id) : null,
    });
  }

  async get(userId: string, rawInput: DesignSchemeDetailInput): Promise<DesignSchemeDetail> {
    const input = designSchemeDetailInputSchema.parse(rawInput);
    const record = await this.getSummaryRecord(this.db, userId, input.id);
    let document = record.document;
    if (input.revision.kind === 'working-draft') {
      if (record.summary.workingDraftRevisionId !== input.revision.revisionId) {
        throw revisionSelectorMismatch();
      }
      document = await this.requireRevision(this.db, userId, input.id, input.revision.revisionId);
    }
    const assets = await this.listAssets(this.db, userId, input.id);
    const sourceSnapshots = await this.listSourceSnapshots(this.db, userId, document);
    return designSchemeDetailSchema.parse({
      summary: record.summary,
      document,
      assets,
      sourceSnapshots,
    });
  }

  async create(userId: string, rawInput: CreateDesignSchemeInput) {
    const input = createDesignSchemeInputSchema.parse(rawInput);
    if (!input.document) {
      throwUnavailable(
        'create',
        CLOUD_DESIGN_SCHEME_UNAVAILABLE.create,
        'Cloud Agent compilation is not available; submit a complete canonical document.',
      );
    }
    if (
      input.historySources.length > 0 ||
      (!this.assets &&
        (input.sourceAssetIds.length > 0 ||
          input.sourceAssets.length > 0 ||
          input.document.assetIds.length > 0))
    ) {
      throwUnavailable(
        'create',
        CLOUD_DESIGN_SCHEME_UNAVAILABLE.assetStaging,
        'Cloud asset staging is not available for Design Scheme creation.',
      );
    }
    designSchemeRevisionDocumentSchema.parse(input.document);

    try {
      return await this.db.transaction((tx) => this.createInTransaction(tx, userId, input));
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueViolation(error)) throw identifierUnavailable('revision or source');
      throw error;
    }
  }

  /** Shares the caller transaction so Agent result/event and draft commit atomically. */
  async createInTransaction(
    tx: Tx,
    userId: string,
    rawInput: CreateDesignSchemeInput,
    trustedMaterials?: DesignSchemeAgentMaterials,
  ) {
    const input = createDesignSchemeInputSchema.parse(rawInput);
    const document = designSchemeRevisionDocumentSchema.parse(input.document);

    if (
      input.sourceSnapshots.some(
        (snapshot) =>
          snapshot.historyItems &&
          (!trustedMaterials?.history ||
            executionDigest(snapshot) !== executionDigest(trustedMaterials.history.snapshot)),
      )
    )
      throw invalidState('History source snapshots require server-authored material authority.');
    const presentation = derivePresentation(input);
    const insertedScheme = await tx
      .insert(designSchemes)
      .values({
        id: document.schemeId,
        userId,
        name: document.name,
        summary: document.summary,
        status: 'draft',
        sourcePresentation: presentation.sourcePresentation,
        sourceLabel: presentation.sourceLabel,
        currentRevisionId: document.revisionId,
        fidelity: document.fidelity,
      })
      .onConflictDoNothing()
      .returning({ id: designSchemes.id });
    if (!insertedScheme[0]) throw identifierUnavailable('scheme');

    await tx.insert(designSchemeRevisions).values({
      revisionId: document.revisionId,
      schemeId: document.schemeId,
      userId,
      schemaVersion: document.schemaVersion,
      document: document as Record<string, unknown>,
      createdBy: document.createdBy,
      ...(document.createdAt === undefined ? {} : { createdAt: toDate(document.createdAt) }),
    });
    await this.persistSources(tx, userId, input, document.revisionId);
    await this.requireDocumentSnapshots(tx, userId, document);
    await this.addDocumentBindings(tx, userId, document.revisionId, document.sources);
    await this.addDocumentBindings(
      tx,
      userId,
      document.revisionId,
      document.sourceSnapshotIds.map((snapshotId) => ({ snapshotId, role: 'context' })),
    );
    await this.assets?.attach(
      tx,
      userId,
      document,
      input.sourceAssetIds,
      input.sourceAssets,
      trustedMaterials,
    );

    await this.assets?.requireRepositoryImages(tx, userId, document);
    const created = await this.getSummaryRecord(tx, userId, document.schemeId);
    return createDesignSchemeResultSchema.parse({
      scheme: created.summary,
      document: created.document,
      revisionId: document.revisionId,
      trace: document.compilation.trace,
    });
  }

  async update(userId: string, rawInput: UpdateDesignSchemeInput) {
    const input = updateDesignSchemeInputSchema.parse(rawInput);
    const document = designSchemeRevisionDocumentSchema.parse(input.document);
    if (document.revisionId === input.baseRevisionId) {
      throw invalidState('Revision documents are immutable and require a new revision ID.');
    }
    if (document.parentRevisionId !== input.baseRevisionId) {
      throw invalidState('The new revision must identify its base revision as parentRevisionId.');
    }

    try {
      return await this.db.transaction((tx) => this.updateInTransaction(tx, userId, input));
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueViolation(error)) throw identifierUnavailable('revision');
      throw error;
    }
  }

  /** Atomic caller transaction for Agent result/event plus deterministic revision CAS. */
  async updateInTransaction(
    tx: Tx,
    userId: string,
    rawInput: UpdateDesignSchemeInput,
    trustedMaterials?: DesignSchemeAgentMaterials,
  ) {
    const input = updateDesignSchemeInputSchema.parse(rawInput);
    const document = designSchemeRevisionDocumentSchema.parse(input.document);
    if (document.revisionId === input.baseRevisionId) {
      throw invalidState('Revision documents are immutable and require a new revision ID.');
    }
    if (document.parentRevisionId !== input.baseRevisionId) {
      throw invalidState('The new revision must identify its base revision as parentRevisionId.');
    }

    await tx
      .select({ id: designSchemes.id })
      .from(designSchemes)
      .where(
        and(
          eq(designSchemes.userId, userId),
          eq(designSchemes.id, input.schemeId),
          isNull(designSchemes.deletedAt),
        ),
      )
      .for('update');
    const current = await this.getSummaryRecord(tx, userId, input.schemeId);
    assertVersion(current.summary, input.expectedVersion);
    const validBase =
      current.summary.status === 'draft'
        ? input.baseRevisionId === current.summary.currentRevisionId
        : input.baseRevisionId === current.summary.currentRevisionId ||
          input.baseRevisionId === current.summary.workingDraftRevisionId;
    if (!validBase) throw invalidState('The base revision is no longer current.');
    await this.requireRevision(tx, userId, input.schemeId, input.baseRevisionId);
    await this.requireDocumentSnapshots(tx, userId, document);
    const staged = cloudAgentAssets(trustedMaterials);
    const stagedIds = staged.map((asset) => asset.id);
    if (stagedIds.some((id) => !document.assetIds.includes(id)))
      throw invalidState('Staged revision images must be referenced.');
    if (this.assets)
      await this.assets.requireDocumentAssets(tx, userId, {
        ...document,
        assetIds: document.assetIds.filter((id) => !stagedIds.includes(id)),
      });
    else if (document.assetIds.length > 0) {
      throwUnavailable(
        'update',
        CLOUD_DESIGN_SCHEME_UNAVAILABLE.assetStaging,
        'Cloud asset validation is not available.',
      );
    }

    const inserted = await tx
      .insert(designSchemeRevisions)
      .values({
        revisionId: document.revisionId,
        schemeId: input.schemeId,
        userId,
        schemaVersion: document.schemaVersion,
        document: document as Record<string, unknown>,
        createdBy: document.createdBy,
        ...(document.createdAt === undefined ? {} : { createdAt: toDate(document.createdAt) }),
      })
      .onConflictDoNothing()
      .returning({ revisionId: designSchemeRevisions.revisionId });
    if (!inserted[0]) throw identifierUnavailable('revision');
    if (staged.length) {
      if (!this.assets) throw invalidState('Asset staging is unavailable.');
      await this.assets.attach(
        tx,
        userId,
        { ...document, assetIds: stagedIds },
        stagedIds,
        staged,
        trustedMaterials,
      );
    }
    await this.assets?.requireRepositoryImages(tx, userId, document);
    // Bind exactly the new document. Copying every old binding makes replaced snapshots
    // leak into the new run authority; the original revision keeps its own bindings.
    await this.addDocumentBindings(tx, userId, document.revisionId, document.sources);
    await this.addDocumentBindings(
      tx,
      userId,
      document.revisionId,
      document.sourceSnapshotIds.map((snapshotId) => ({ snapshotId, role: 'context' })),
    );

    const set =
      current.summary.status === 'draft'
        ? {
            currentRevisionId: document.revisionId,
            name: document.name,
            summary: document.summary,
            fidelity: document.fidelity,
            version: sql`${designSchemes.version} + 1`,
            updatedAt: new Date(),
          }
        : {
            workingDraftRevisionId: document.revisionId,
            version: sql`${designSchemes.version} + 1`,
            updatedAt: new Date(),
          };
    const updated = await tx
      .update(designSchemes)
      .set(set)
      .where(
        and(
          eq(designSchemes.userId, userId),
          eq(designSchemes.id, input.schemeId),
          isNull(designSchemes.deletedAt),
          eq(designSchemes.version, input.expectedVersion),
        ),
      )
      .returning({ id: designSchemes.id });
    if (!updated[0]) throw versionConflict(current.summary);
    const next = await this.getSummaryRecord(tx, userId, input.schemeId);
    return updateDesignSchemeResultSchema.parse({ scheme: next.summary, document });
  }

  async selectCover(userId: string, rawInput: SelectCoverInput) {
    const input = selectCoverInputSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getSummaryRecord(tx, userId, input.schemeId);
      assertVersion(current.summary, input.expectedVersion);
      const asset = await tx
        .select({ id: designSchemeAssets.id })
        .from(designSchemeAssets)
        .innerJoin(
          designSchemeRevisions,
          and(
            eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
            eq(designSchemeRevisions.userId, designSchemeAssets.userId),
          ),
        )
        .where(
          and(
            eq(designSchemeAssets.userId, userId),
            eq(designSchemeAssets.id, input.assetId),
            eq(designSchemeRevisions.schemeId, input.schemeId),
          ),
        );
      if (!asset[0]) throw invalidState('The selected cover asset does not belong to this scheme.');
      const updated = await tx
        .update(designSchemes)
        .set({
          coverAssetId: input.assetId,
          version: sql`${designSchemes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designSchemes.userId, userId),
            eq(designSchemes.id, input.schemeId),
            isNull(designSchemes.deletedAt),
            eq(designSchemes.version, input.expectedVersion),
          ),
        )
        .returning({ id: designSchemes.id });
      if (!updated[0]) throw versionConflict(current.summary);
      const next = await this.getSummaryRecord(tx, userId, input.schemeId);
      return selectCoverResultSchema.parse({
        scheme: next.summary,
        selectedAssetId: input.assetId,
      });
    });
  }

  async formalize(userId: string, rawInput: FormalizeDesignSchemeInput) {
    const input = formalizeDesignSchemeInputSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getSummaryRecord(tx, userId, input.schemeId);
      assertVersion(current.summary, input.expectedVersion);
      if (current.summary.status !== 'draft') throw invalidState('The scheme is already formal.');
      if (current.summary.currentRevisionId !== input.revisionId) {
        throw invalidState('The requested revision is no longer current.');
      }
      if (current.summary.coverAssetId !== input.coverAssetId) {
        throw invalidState('Select the requested cover asset before formalizing.');
      }
      if (!current.summary.hasSuccessfulTrial) {
        throw invalidState('A successful trial of the current revision is required.');
      }
      const updated = await tx
        .update(designSchemes)
        .set({
          status: 'formal',
          version: sql`${designSchemes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designSchemes.userId, userId),
            eq(designSchemes.id, input.schemeId),
            eq(designSchemes.status, 'draft'),
            eq(designSchemes.version, input.expectedVersion),
            isNull(designSchemes.deletedAt),
          ),
        )
        .returning({ id: designSchemes.id });
      if (!updated[0]) throw versionConflict(current.summary);
      const next = await this.getSummaryRecord(tx, userId, input.schemeId);
      return formalizeDesignSchemeResultSchema.parse({
        scheme: next.summary,
        revisionId: input.revisionId,
        formalized: true,
      });
    });
  }

  async promoteWorkingDraft(userId: string, rawInput: PromoteWorkingDraftInput) {
    const input = promoteWorkingDraftInputSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getSummaryRecord(tx, userId, input.schemeId);
      assertVersion(current.summary, input.expectedVersion);
      if (current.summary.status !== 'formal') {
        throw invalidState('Only formal schemes can promote a working draft.');
      }
      if (current.summary.workingDraftRevisionId !== input.workingDraftRevisionId) {
        throw invalidState('The requested working draft is no longer pending.');
      }
      if (!(await this.hasSuccessfulTrial(tx, userId, input.workingDraftRevisionId))) {
        throw invalidState('A successful trial of the working draft is required.');
      }
      const document = await this.requireRevision(
        tx,
        userId,
        input.schemeId,
        input.workingDraftRevisionId,
      );
      const updated = await tx
        .update(designSchemes)
        .set({
          currentRevisionId: input.workingDraftRevisionId,
          workingDraftRevisionId: null,
          name: document.name,
          summary: document.summary,
          fidelity: document.fidelity,
          version: sql`${designSchemes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designSchemes.userId, userId),
            eq(designSchemes.id, input.schemeId),
            eq(designSchemes.version, input.expectedVersion),
            eq(designSchemes.workingDraftRevisionId, input.workingDraftRevisionId),
            isNull(designSchemes.deletedAt),
          ),
        )
        .returning({ id: designSchemes.id });
      if (!updated[0]) throw versionConflict(current.summary);
      const next = await this.getSummaryRecord(tx, userId, input.schemeId);
      return promoteWorkingDraftResultSchema.parse({
        scheme: next.summary,
        promotedRevisionId: input.workingDraftRevisionId,
        promoted: true,
      });
    });
  }

  async rename(userId: string, rawInput: RenameDesignSchemeInput) {
    const input = renameDesignSchemeInputSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getSummaryRecord(tx, userId, input.schemeId);
      assertVersion(current.summary, input.expectedVersion);
      const updated = await tx
        .update(designSchemes)
        .set({
          name: input.name,
          version: sql`${designSchemes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designSchemes.userId, userId),
            eq(designSchemes.id, input.schemeId),
            eq(designSchemes.version, input.expectedVersion),
            isNull(designSchemes.deletedAt),
          ),
        )
        .returning({ id: designSchemes.id });
      if (!updated[0]) throw versionConflict(current.summary);
      const next = await this.getSummaryRecord(tx, userId, input.schemeId);
      return renameDesignSchemeResultSchema.parse({ scheme: next.summary });
    });
  }

  async remove(userId: string, rawInput: RemoveDesignSchemeInput) {
    const input = removeDesignSchemeInputSchema.parse(rawInput);
    return this.db.transaction(async (tx) => {
      const current = await this.getSummaryRecord(tx, userId, input.schemeId);
      assertVersion(current.summary, input.expectedVersion);
      const updated = await tx
        .update(designSchemes)
        .set({
          deletedAt: new Date(),
          version: sql`${designSchemes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(designSchemes.userId, userId),
            eq(designSchemes.id, input.schemeId),
            eq(designSchemes.version, input.expectedVersion),
            isNull(designSchemes.deletedAt),
          ),
        )
        .returning({ id: designSchemes.id });
      if (!updated[0]) throw versionConflict(current.summary);
      return removeDesignSchemeResultSchema.parse({ schemeId: input.schemeId, removed: true });
    });
  }

  purge(userId: string, input: PurgeDesignSchemeInput, sessionId: string) {
    return purgeDesignScheme(this.db, userId, sessionId, input);
  }

  async searchMarket(userId: string, query: ParsedMarketSearchQuery) {
    if (!this.market) throw new AppError('INTERNAL_ERROR', '市场搜索服务暂时不可用', 503, true);
    return this.market.search(userId, query);
  }

  modify(_userId: string, _input: ModifyDesignSchemeInput): never {
    throwUnavailable(
      'modify',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.agentModify,
      'Cloud Agent modification is not available; submit a complete revision with update.',
    );
  }

  cancel(userId: string, rawInput: unknown) {
    cancelDesignSchemeInputSchema.parse(rawInput);
    if (this.runs) return this.runs.cancel(userId, rawInput);
    throwUnavailable(
      'cancel',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.cancel,
      'Cloud Design Scheme execution cancellation is not available.',
    );
  }

  /** Install confirmation belongs to the Agent creation session, which the cloud runtime does not host yet. */
  confirmInstall(_userId: string, rawInput: unknown): never {
    confirmDesignSchemeInstallInputSchema.parse(rawInput);
    throwUnavailable(
      'confirmInstall',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.create,
      'Cloud Design Scheme Agent creation is not available.',
    );
  }

  checkUpdate(_userId: string, _input: CheckDesignSchemeUpdateInput): never {
    throwUnavailable(
      'checkUpdate',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.checkUpdate,
      'Cloud source update checking and recompilation are not available.',
    );
  }

  prepareImportPackage(_userId: string, rawInput: PrepareDesignSchemeImportPackageInput): never {
    prepareDesignSchemeImportPackageInputSchema.parse(rawInput);
    throwUnavailable(
      'prepareImportPackage',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.prepareImportPackage,
      'Cloud .musefold.design package upload and staging is not available.',
    );
  }

  importPackage(
    userId: string,
    input: ImportDesignSchemeInput,
    sessionId: string,
    signal?: AbortSignal,
  ) {
    if (this.packageImports) return this.packageImports.execute(userId, sessionId, input, signal);
    throwUnavailable(
      'importPackage',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.importPackage,
      'Cloud .musefold.design package staging is not available for import.',
    );
  }

  exportPackage(_userId: string, _input: ExportDesignSchemeInput): never {
    throwUnavailable(
      'exportPackage',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.exportPackage,
      'Cloud .musefold.design package staging is not available for export.',
    );
  }

  prepareRun(userId: string, input: PrepareDesignSchemeRunInput, authorizingSessionId: string) {
    if (this.runs) return this.runs.prepare(userId, input, authorizingSessionId);
    throwUnavailable(
      'run',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.run,
      'Cloud run preparation is not available.',
    );
  }

  getRun(userId: string, runId: string) {
    if (this.runs) return this.runs.get(userId, runId);
    throwUnavailable(
      'run',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.run,
      'Cloud run lookup is not available.',
    );
  }

  runEvents(userId: string, runId: string, afterSeq: number) {
    if (this.runs) return this.runs.events(userId, runId, afterSeq);
    throwUnavailable(
      'run',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.run,
      'Cloud run events are not available.',
    );
  }

  run(userId: string, rawInput: unknown, authorizingSessionId: string) {
    const input = designSchemeRunInputSchema.parse(rawInput);
    if (this.runs) return this.runs.run(userId, input, authorizingSessionId);
    throwUnavailable(
      'run',
      CLOUD_DESIGN_SCHEME_UNAVAILABLE.run,
      'Cloud Design Scheme execution is not available.',
    );
  }

  /** Server-only immutable revision read, sharing the export caller's authority transaction. */
  async readRevisionSources(tx: Tx, userId: string, schemeId: string, revisionId: string) {
    const document = await this.requireRevision(tx, userId, schemeId, revisionId);
    return { document, sourceSnapshots: await this.listSourceSnapshots(tx, userId, document) };
  }

  private async getSummaryRecord(tx: Tx, userId: string, schemeId: string): Promise<SummaryRecord> {
    const result = await tx.execute(sql`
      SELECT ${summaryProjection}
      FROM design_schemes ds
      JOIN design_scheme_revisions current_revision
        ON current_revision.revision_id = ds.current_revision_id
       AND current_revision.user_id = ds.user_id
      WHERE ds.user_id = ${userId} AND ds.id = ${schemeId} AND ds.deleted_at IS NULL
      LIMIT 1
    `);
    const row = (result.rows as unknown as SummaryRow[])[0];
    if (!row) throw notFound();
    return toSummaryRecord(row);
  }

  private async requireRevision(tx: Tx, userId: string, schemeId: string, revisionId: string) {
    const rows = await tx
      .select({ document: designSchemeRevisions.document })
      .from(designSchemeRevisions)
      .where(
        and(
          eq(designSchemeRevisions.userId, userId),
          eq(designSchemeRevisions.schemeId, schemeId),
          eq(designSchemeRevisions.revisionId, revisionId),
        ),
      );
    if (!rows[0]) throw invalidState('The requested revision does not belong to this scheme.');
    return designSchemeRevisionDocumentSchema.parse(rows[0].document);
  }

  private async hasSuccessfulTrial(tx: Tx, userId: string, revisionId: string): Promise<boolean> {
    const result = await tx.execute(sql`
      SELECT 1 FROM design_scheme_runs
      WHERE user_id = ${userId} AND revision_id = ${revisionId}
        AND mode = 'trial' AND status = 'completed' AND deleted_at IS NULL
      LIMIT 1
    `);
    return Boolean(result.rows[0]);
  }

  private async listAssets(tx: Tx, userId: string, schemeId: string) {
    const rows = await tx
      .select({
        id: designSchemeAssets.id,
        origin: designSchemeAssets.origin,
        mimeType: designSchemeAssets.mimeType,
        width: designSchemeAssets.width,
        height: designSchemeAssets.height,
        byteSize: designSchemeAssets.byteSize,
        contentHash: designSchemeAssets.contentHash,
        role: designSchemeAssets.role,
        license: designSchemeAssets.license,
        createdAt: designSchemeAssets.createdAt,
      })
      .from(designSchemeAssets)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
          eq(designSchemeRevisions.userId, designSchemeAssets.userId),
        ),
      )
      .where(
        and(eq(designSchemeAssets.userId, userId), eq(designSchemeRevisions.schemeId, schemeId)),
      )
      .orderBy(sql`${designSchemeAssets.createdAt} DESC`, sql`${designSchemeAssets.id} DESC`);
    return rows.map((row) =>
      designSchemeAssetSchema.parse({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }),
    );
  }

  private async listSourceSnapshots(
    tx: Tx,
    userId: string,
    document: z.output<typeof designSchemeRevisionDocumentSchema>,
  ) {
    const bindingRows = await tx
      .select({ snapshotId: designSchemeSourceBindings.sourceSnapshotId })
      .from(designSchemeSourceBindings)
      .where(
        and(
          eq(designSchemeSourceBindings.userId, userId),
          eq(designSchemeSourceBindings.revisionId, document.revisionId),
        ),
      );
    const ids = [
      ...new Set([
        ...document.sourceSnapshotIds,
        ...document.sources.flatMap((source) => (source.snapshotId ? [source.snapshotId] : [])),
        ...bindingRows.map((row) => row.snapshotId),
      ]),
    ];
    if (ids.length === 0) return [];

    const snapshots = await tx
      .select({
        id: designSchemeSourceSnapshots.id,
        packageId: designSchemeSourceSnapshots.packageId,
        resolvedRef: designSchemeSourceSnapshots.resolvedRef,
        commitHash: designSchemeSourceSnapshots.commitHash,
        contentHash: designSchemeSourceSnapshots.contentHash,
        totalBytes: designSchemeSourceSnapshots.totalBytes,
        scan: designSchemeSourceSnapshots.scan,
        createdAt: designSchemeSourceSnapshots.createdAt,
        kind: designSchemeSourcePackages.kind,
        repositoryUrl: designSchemeSourcePackages.repositoryUrl,
      })
      .from(designSchemeSourceSnapshots)
      .innerJoin(
        designSchemeSourcePackages,
        and(
          eq(designSchemeSourcePackages.id, designSchemeSourceSnapshots.packageId),
          eq(designSchemeSourcePackages.userId, designSchemeSourceSnapshots.userId),
        ),
      )
      .where(
        and(
          eq(designSchemeSourceSnapshots.userId, userId),
          inArray(designSchemeSourceSnapshots.id, ids),
        ),
      );
    if (snapshots.length !== ids.length) {
      throw new Error('Design Scheme source snapshot metadata is incomplete.');
    }
    const files = await tx
      .select()
      .from(designSchemeSourceFiles)
      .where(
        and(
          eq(designSchemeSourceFiles.userId, userId),
          inArray(designSchemeSourceFiles.snapshotId, ids),
        ),
      )
      .orderBy(designSchemeSourceFiles.snapshotId, designSchemeSourceFiles.relativePath);
    const filesBySnapshot = new Map<string, typeof files>();
    for (const file of files) {
      const group = filesBySnapshot.get(file.snapshotId) ?? [];
      group.push(file);
      filesBySnapshot.set(file.snapshotId, group);
    }

    const byId = new Map(
      snapshots.map((row) => {
        const stored = sourceSnapshotSchema.safeParse(row.scan);
        if (!stored.success && row.scan && Object.hasOwn(row.scan, 'historyItems'))
          throw invalidState('History source metadata is invalid.');
        const value = stored.success
          ? stored.data
          : sourceSnapshotSchema.parse({
              id: row.id,
              packageId: row.packageId,
              kind: row.kind,
              ...(row.repositoryUrl ? { repositoryUrl: row.repositoryUrl } : {}),
              resolvedRef: row.resolvedRef,
              commitHash: row.commitHash,
              contentHash: row.contentHash,
              totalBytes: row.totalBytes,
              files: (filesBySnapshot.get(row.id) ?? []).map((file) => ({
                relativePath: file.relativePath,
                kind: file.kind,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                contentHash: file.contentHash,
                evidencePath: file.evidencePath,
                textExcerpt: file.textExcerpt,
              })),
              createdAt: row.createdAt.toISOString(),
            });
        if (value.id !== row.id || value.packageId !== row.packageId) {
          throw new Error('Design Scheme source snapshot identity mismatch.');
        }
        return [row.id, value] as const;
      }),
    );
    return ids.map((id) => {
      const snapshot = byId.get(id);
      if (!snapshot) throw new Error('Design Scheme source snapshot is missing.');
      return snapshot;
    });
  }

  private async persistSources(
    tx: Tx,
    userId: string,
    input: z.output<typeof createDesignSchemeInputSchema>,
    revisionId: string,
  ): Promise<void> {
    const packages = new Map(input.sourcePackages.map((item) => [item.id, item]));
    for (const snapshot of input.sourceSnapshots) {
      const existing = packages.get(snapshot.packageId);
      if (existing && existing.kind !== snapshot.kind) {
        throw invalidState('Source package and snapshot kinds do not match.');
      }
      if (!existing) {
        packages.set(snapshot.packageId, {
          id: snapshot.packageId,
          kind: snapshot.kind,
          repositoryUrl: snapshot.repositoryUrl ?? snapshot.repositoryUri ?? snapshot.uri ?? null,
          resolvedRef: snapshot.resolvedRef ?? snapshot.ref ?? null,
          commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
          contentHash: snapshot.contentHash ?? null,
          license: null,
          createdAt: snapshot.createdAt,
        });
      }
    }

    for (const item of packages.values()) {
      const inserted = await tx
        .insert(designSchemeSourcePackages)
        .values({
          id: item.id,
          userId,
          kind: item.kind,
          repositoryUrl: item.repositoryUrl ?? item.repositoryUri ?? item.uri ?? null,
          license: item.license,
          createdAt: toDate(item.createdAt),
        })
        .onConflictDoNothing()
        .returning({ id: designSchemeSourcePackages.id });
      if (!inserted[0]) {
        const owned = await tx
          .select({ id: designSchemeSourcePackages.id })
          .from(designSchemeSourcePackages)
          .where(
            and(
              eq(designSchemeSourcePackages.userId, userId),
              eq(designSchemeSourcePackages.id, item.id),
            ),
          );
        if (!owned[0]) throw identifierUnavailable('source package');
      }
    }

    for (const snapshot of input.sourceSnapshots) {
      assertPgInteger(snapshot.totalBytes, 'source snapshot totalBytes');
      for (const file of snapshot.files) assertPgInteger(file.sizeBytes, 'source file sizeBytes');
      const inserted = await tx
        .insert(designSchemeSourceSnapshots)
        .values({
          id: snapshot.id,
          userId,
          packageId: snapshot.packageId,
          resolvedRef: snapshot.resolvedRef ?? snapshot.ref ?? '',
          commitHash: snapshot.commitHash ?? snapshot.commit ?? null,
          contentHash: snapshot.contentHash ?? null,
          totalBytes: snapshot.totalBytes,
          scan: snapshot as Record<string, unknown>,
          createdAt: toDate(snapshot.createdAt),
        })
        .onConflictDoNothing()
        .returning({ id: designSchemeSourceSnapshots.id });
      if (!inserted[0]) {
        const existing = await tx
          .select({ scan: designSchemeSourceSnapshots.scan })
          .from(designSchemeSourceSnapshots)
          .where(
            and(
              eq(designSchemeSourceSnapshots.userId, userId),
              eq(designSchemeSourceSnapshots.id, snapshot.id),
            ),
          );
        const parsed = existing[0] ? sourceSnapshotSchema.safeParse(existing[0].scan) : null;
        if (!parsed?.success || JSON.stringify(parsed.data) !== JSON.stringify(snapshot)) {
          throw identifierUnavailable('source snapshot');
        }
        continue;
      }
      if (snapshot.files.length > 0) {
        await tx.insert(designSchemeSourceFiles).values(
          snapshot.files.map((file) => ({
            snapshotId: snapshot.id,
            userId,
            relativePath: file.relativePath,
            kind: file.kind,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            contentHash: file.contentHash,
            evidencePath: file.evidencePath,
            textExcerpt: file.textExcerpt,
            objectKey: null,
          })),
        );
      }
    }
    await this.addDocumentBindings(tx, userId, revisionId, input.sourceBindings);
  }

  private async addDocumentBindings(
    tx: Tx,
    userId: string,
    revisionId: string,
    sources: ReadonlyArray<{ snapshotId?: string; role: string }>,
  ): Promise<void> {
    const roles = new Map<string, string>();
    for (const source of sources) {
      if (!source.snapshotId) continue;
      const previous = roles.get(source.snapshotId);
      // The canonical document retains every semantic binding. PG stores one ownership/GC edge
      // per snapshot; its role is the strongest declared role, not a second source of semantics.
      const rank = ['context', 'example', 'reference', 'normative'];
      if (!previous || rank.indexOf(source.role) > rank.indexOf(previous))
        roles.set(source.snapshotId, source.role);
    }
    if (roles.size === 0) return;
    const ids = [...roles.keys()];
    await this.assertPreparedSourcesBindable(tx, userId, ids);
    const owned = await tx
      .select({ id: designSchemeSourceSnapshots.id })
      .from(designSchemeSourceSnapshots)
      .where(
        and(
          eq(designSchemeSourceSnapshots.userId, userId),
          inArray(designSchemeSourceSnapshots.id, ids),
        ),
      );
    if (owned.length !== ids.length) throw invalidState('A source snapshot is not available.');
    await tx
      .insert(designSchemeSourceBindings)
      .values(
        ids.map((snapshotId) => ({
          revisionId,
          sourceSnapshotId: snapshotId,
          userId,
          role: roles.get(snapshotId) as string,
        })),
      )
      .onConflictDoNothing();
  }

  private async requireDocumentSnapshots(
    tx: Tx,
    userId: string,
    document: z.output<typeof designSchemeRevisionDocumentSchema>,
  ): Promise<void> {
    const ids = [
      ...new Set([
        ...document.sourceSnapshotIds,
        ...document.sources.flatMap((source) => (source.snapshotId ? [source.snapshotId] : [])),
      ]),
    ];
    if (ids.length === 0) return;
    await this.assertPreparedSourcesBindable(tx, userId, ids);
    const owned = await tx
      .select({ id: designSchemeSourceSnapshots.id })
      .from(designSchemeSourceSnapshots)
      .where(
        and(
          eq(designSchemeSourceSnapshots.userId, userId),
          inArray(designSchemeSourceSnapshots.id, ids),
        ),
      );
    if (owned.length !== ids.length) throw invalidState('A source snapshot is not available.');
  }

  private async assertPreparedSourcesBindable(tx: Tx, userId: string, ids: string[]) {
    const rows = await tx
      .select()
      .from(designSchemeSourcePreparations)
      .where(
        and(
          eq(designSchemeSourcePreparations.userId, userId),
          inArray(designSchemeSourcePreparations.snapshotId, ids),
        ),
      )
      .orderBy(designSchemeSourcePreparations.executionId)
      .for('update');
    for (const row of rows) {
      const bound = await tx
        .select({ id: designSchemeSourceBindings.revisionId })
        .from(designSchemeSourceBindings)
        .where(
          and(
            eq(designSchemeSourceBindings.userId, userId),
            eq(designSchemeSourceBindings.sourceSnapshotId, row.snapshotId ?? ''),
          ),
        )
        .limit(1);
      if (bound.length) continue; // Existing revision ownership survives preparation expiry.
      if (row.status !== 'confirmed' || row.expiresAt.getTime() <= Date.now() || row.retiredAt)
        throw invalidState('The prepared source must be confirmed before binding.');
    }
  }
}

function toSummaryRecord(row: SummaryRow): SummaryRecord {
  const document = designSchemeRevisionDocumentSchema.parse(row.current_document);
  const summary = designSchemeSummarySchema.parse({
    id: row.id,
    name: row.name,
    summary: row.summary,
    status: row.status,
    sourcePresentation: row.source_presentation,
    sourceLabel: row.source_label || 'Musefold 创建',
    currentRevisionId: row.current_revision_id,
    workingDraftRevisionId: row.working_draft_revision_id,
    coverAssetId: row.cover_asset_id,
    fidelity: row.fidelity,
    version: row.version,
    inputLabels: document.inputs.map((input) =>
      input.required ? `${input.label} · 必需` : input.label,
    ),
    hasSuccessfulTrial: row.has_successful_trial,
    lastRunAt: toIsoOrNull(row.last_run_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
  return { summary, document };
}

function derivePresentation(input: z.output<typeof createDesignSchemeInputSchema>): {
  sourcePresentation: 'skill' | 'musefold-created';
  sourceLabel: string;
} {
  const repositoryUrl =
    input.sourceUris[0] ??
    input.sourcePackages.find((item) => item.kind === 'github')?.repositoryUrl ??
    input.sourcePackages.find((item) => item.kind === 'github')?.repositoryUri ??
    input.sourcePackages.find((item) => item.kind === 'github')?.uri;
  if (!repositoryUrl) {
    return { sourcePresentation: 'musefold-created', sourceLabel: 'Musefold 创建' };
  }
  const path = new URL(repositoryUrl).pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter(Boolean);
  return {
    sourcePresentation: 'skill',
    sourceLabel: path.slice(-2).join('/') || 'GitHub Skill',
  };
}

function throwUnavailable(operation: string, code: string, message: string): never {
  throw new AppError('INTERNAL_ERROR', message, 501, false, {
    operation,
    designSchemeError: {
      code,
      message,
      retryable: false,
      recoveryAction: 'none',
    },
  });
}

function notFound(): AppError {
  return new AppError('VALIDATION_FAILED', 'Design Scheme not found.', 404, false, {
    designSchemeCode: 'DESIGN_SCHEME_NOT_FOUND',
  });
}

function invalidState(message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_INVALID_STATE',
  });
}

function revisionSelectorMismatch(): AppError {
  const message = 'The requested revision is not the visible working draft.';
  return new AppError('VALIDATION_FAILED', message, 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_DETAIL_REVISION_MISMATCH',
    designSchemeError: {
      code: 'DESIGN_SCHEME_DETAIL_REVISION_MISMATCH',
      message,
      retryable: false,
      recoveryAction: 'retry',
    },
  });
}

function identifierUnavailable(kind: string): AppError {
  return new AppError('VALIDATION_FAILED', `The ${kind} identifier is unavailable.`, 409, false, {
    designSchemeCode: 'DESIGN_SCHEME_IDENTIFIER_UNAVAILABLE',
  });
}

function versionConflict(current: DesignSchemeSummary): AppError {
  return new AppError(
    'VALIDATION_FAILED',
    'The Design Scheme changed; refresh and retry.',
    409,
    false,
    {
      designSchemeCode: 'DESIGN_SCHEME_VERSION_CONFLICT',
      current,
    },
  );
}

function assertVersion(current: DesignSchemeSummary, expectedVersion: number): void {
  if (current.version !== expectedVersion) throw versionConflict(current);
}

function assertPgInteger(value: number, field: string): void {
  if (value > MAX_PG_INTEGER) {
    throw new AppError('VALIDATION_FAILED', `${field} exceeds cloud storage limits.`, 400);
  }
}

function toDate(value: string | number): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_FAILED', 'Invalid Design Scheme timestamp.', 400);
  }
  return date;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
