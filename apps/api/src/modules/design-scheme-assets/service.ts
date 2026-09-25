import { freezeHistoryMaterials, lockHistoryAdmission, assertFrozenHistory } from './history.js';
import { cloudAgentAssets } from '@musefold/domain/design-scheme/cloud-materials';
import type { createDesignSchemeInputSchema } from '@musefold/contracts';
import type { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import {
  designSchemeAgentMaterialsSchema,
  sourceSnapshotSchema,
  MAX_AGENT_UPLOAD_TOTAL_BYTES,
  type DesignSchemeAgentMaterials,
} from '@musefold/contracts';
import type { DesignSchemeRevisionDocument, ReferenceAssetMetadata } from '@musefold/contracts';
import {
  DESIGN_SCHEME_UPLOAD_TTL_MS,
  type StagedDesignSchemeAsset,
  type UploadDesignSchemeAssetInput,
  stagedDesignSchemeAssetSchema,
  uploadDesignSchemeAssetInputSchema,
} from '@musefold/contracts/design-scheme-assets';
import {
  type MusefoldDatabase,
  designSchemeAssets,
  designSchemeSourceSnapshots,
  designSchemeRevisions,
  designSchemes,
  enqueueObjectCleanup,
  generationReferenceUploads,
  generationReferenceLinks,
  designSchemeGenerationReferences,
  executionDigest,
} from '@musefold/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';
import { inspectSchemeImage } from './image.js';
import { DESIGN_SCHEME_PACKAGE_LIMITS } from '@musefold/contracts';
import type { DesignSchemeAssetStorage } from './storage.js';

type Tx = MusefoldDatabase | Parameters<Parameters<MusefoldDatabase['transaction']>[0]>[0];
type UploadRow = typeof generationReferenceUploads.$inferSelect;
type RunReference = Omit<
  typeof designSchemeGenerationReferences.$inferInsert,
  'generationRunId' | 'userId'
>;
type RunReferencePreflight = ReadonlyArray<{
  readonly metadataDigest: string;
  readonly reference: Readonly<RunReference>;
}>;

/** Reuses the durable reference-upload registry; promotion consumes it transactionally. */
export class DesignSchemeAssetService {
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly storage: DesignSchemeAssetStorage,
  ) {}

  async stage(
    userId: string,
    rawInput: UploadDesignSchemeAssetInput,
  ): Promise<StagedDesignSchemeAsset> {
    const parsed = uploadDesignSchemeAssetInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', '方案图片文件名或大小无效');
    const image = await inspectSchemeImage(parsed.data.bytes);
    const id = randomUUID();
    const now = new Date();
    const objectKey = `${uploadPrefix(userId)}${id}`;
    const row = {
      id,
      userId,
      objectKey,
      originalName: parsed.data.name,
      mimeType: image.mimeType,
      byteSize: image.byteSize,
      status: 'uploading',
      createdAt: now,
      expiresAt: new Date(now.getTime() + DESIGN_SCHEME_UPLOAD_TTL_MS),
    };
    await this.db.insert(generationReferenceUploads).values(row);
    try {
      await this.storage.put(objectKey, parsed.data.bytes, image.mimeType);
      const [updated] = await this.db
        .update(generationReferenceUploads)
        .set({
          status: 'available',
          uploadedAt: new Date(),
        })
        .where(
          and(
            eq(generationReferenceUploads.id, id),
            eq(generationReferenceUploads.userId, userId),
            eq(generationReferenceUploads.status, 'uploading'),
            sql`${generationReferenceUploads.expiresAt} > now()`,
          ),
        )
        .returning();
      if (!updated) throw storageError();
      return stagedDesignSchemeAssetSchema.parse({
        id,
        name: row.originalName,
        ...image,
        createdAt: now.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      });
    } catch {
      // Even an ambiguous PUT is discoverable: the registry predates the object write.
      await this.db
        .transaction(async (tx) => {
          await tx
            .update(generationReferenceUploads)
            .set({ status: 'cleanup_pending', cleanupQueuedAt: new Date() })
            .where(
              and(
                eq(generationReferenceUploads.id, id),
                eq(generationReferenceUploads.userId, userId),
              ),
            );
          await enqueueObjectCleanup(tx, [
            {
              objectKey,
              ownerId: userId,
              objectType: 'generation_reference',
              reason: 'reference_upload_failed',
            },
          ]);
        })
        .catch(() => undefined);
      throw storageError();
    }
  }

  async freezeAgentMaterials(
    userId: string,
    input: z.infer<typeof createDesignSchemeInputSchema>,
  ): Promise<DesignSchemeAgentMaterials> {
    if (input.sourceAssetIds.length + input.historySources.length > 64) throw materialInvalid();
    const uploads = await this.freezeAgentUploads(userId, input.sourceAssetIds, input.sourceAssets);
    if (!input.historySources.length) return uploads;
    const history = await freezeHistoryMaterials(
      this.db,
      this.storage,
      userId,
      input.historySources,
      (input) => this.stage(userId, input),
      uploads.uploads.reduce((sum, item) => sum + item.asset.byteSize, 0),
    );
    return designSchemeAgentMaterialsSchema.parse({ ...uploads, history });
  }
  async lockHistoryAdmission(tx: Tx, userId: string, materials: DesignSchemeAgentMaterials) {
    if (materials.history) await lockHistoryAdmission(tx, userId, materials.history);
  }

  /** Copy before paid execution. Original uploads stay usable/discardable; copies have their own TTL registry. */
  async freezeAgentUploads(
    userId: string,
    ids: string[],
    claimed: ReferenceAssetMetadata[],
  ): Promise<DesignSchemeAgentMaterials> {
    if (
      ids.length > 64 ||
      new Set(ids).size !== ids.length ||
      new Set(claimed.map((asset) => asset.id)).size !== claimed.length ||
      (claimed.length > 0 &&
        (claimed.length !== ids.length || claimed.some((asset) => !ids.includes(asset.id))))
    )
      throw materialInvalid();
    const uploads: DesignSchemeAgentMaterials['uploads'] = [];
    let totalBytes = 0;
    for (const id of ids) {
      const row = await this.requireStage(this.db, userId, id);
      totalBytes += row.byteSize;
      if (totalBytes > MAX_AGENT_UPLOAD_TOTAL_BYTES) throw materialInvalid();
      const bytes = await this.read(row.objectKey);
      const image = await inspectSchemeImage(bytes);
      if (image.mimeType !== row.mimeType || image.byteSize !== row.byteSize)
        throw materialInvalid();
      const original = uploadedMetadata({ id, ...image, createdAt: row.createdAt.toISOString() });
      const expected = claimed.find((asset) => asset.id === id);
      if (expected && executionDigest(expected) !== executionDigest(original))
        throw materialInvalid();
      // stage registers cleanup authority before PUT, including partial/ambiguous writes and losing admissions.
      const copy = await this.stage(userId, {
        name: row.originalName,
        bytes: Uint8Array.from(bytes),
      });
      uploads.push({ sourceAssetId: id, asset: uploadedMetadata(copy) });
    }
    return designSchemeAgentMaterialsSchema.parse({ uploads });
  }

  /** Bounded object IO before authority locks; every paid role and recovery verifies the same bytes. */
  async verifyAgentUploads(userId: string, materials: DesignSchemeAgentMaterials): Promise<void> {
    if (materials.history) assertFrozenHistory(materials.history);
    for (const asset of cloudAgentAssets(designSchemeAgentMaterialsSchema.parse(materials))) {
      const actual = {
        ...uploadedMetadata(await this.getStage(userId, asset.id)),
        origin: asset.origin,
        role: asset.role,
      };
      if (executionDigest(actual) !== executionDigest(asset)) throw materialInvalid();
    }
  }

  /** Recheck availability under the same locks used by discard/promotion/GC, without storage IO. */
  async lockAgentUploads(
    tx: Tx,
    userId: string,
    materials: DesignSchemeAgentMaterials,
  ): Promise<void> {
    for (const asset of cloudAgentAssets(materials).sort((a, b) => a.id.localeCompare(b.id))) {
      const row = await this.requireStage(tx, userId, asset.id, true);
      await this.requireUnlinked(tx, row.id);
      if (
        row.mimeType !== asset.mimeType ||
        row.byteSize !== asset.byteSize ||
        row.createdAt.toISOString() !== asset.createdAt
      )
        throw materialInvalid();
    }
  }

  async getStage(userId: string, id: string): Promise<StagedDesignSchemeAsset> {
    return this.describe(await this.requireStage(this.db, userId, id));
  }

  async discard(userId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.requireStage(tx, userId, id, true);
      await this.requireUnlinked(tx, id);
      await tx
        .update(generationReferenceUploads)
        .set({ status: 'cleanup_pending', cleanupQueuedAt: new Date() })
        .where(eq(generationReferenceUploads.id, row.id));
      await enqueueObjectCleanup(tx, [
        {
          objectKey: row.objectKey,
          ownerId: userId,
          objectType: 'generation_reference',
          reason: 'reference_expired',
        },
      ]);
    });
  }

  /** Called only inside scheme creation's transaction, after inserting its revision. */
  async attach(
    tx: Tx,
    userId: string,
    document: DesignSchemeRevisionDocument,
    ids: string[],
    claimed: ReferenceAssetMetadata[],
    trustedMaterials?: DesignSchemeAgentMaterials,
  ): Promise<void> {
    const trusted = trustedMaterials
      ? cloudAgentAssets(designSchemeAgentMaterialsSchema.parse(trustedMaterials))
      : [];
    if (
      trustedMaterials?.repositories?.some((source) =>
        source.images.some(
          (image) =>
            !document.repositoryImages?.some(
              (provenance) => executionDigest(provenance) === executionDigest(image.provenance),
            ),
        ),
      )
    )
      throw new AppError('VALIDATION_FAILED', '仓库图片必须保留可信来源映射');
    const selected = new Set(ids);
    if (
      selected.size !== ids.length ||
      document.assetIds.length !== ids.length ||
      new Set(document.assetIds).size !== ids.length ||
      document.assetIds.some((id) => !selected.has(id)) ||
      new Set(claimed.map((asset) => asset.id)).size !== claimed.length ||
      claimed.some((asset) => !selected.has(asset.id))
    ) {
      throw new AppError('VALIDATION_FAILED', '方案文档必须精确引用本次选择的暂存图片');
    }
    // Global order avoids deadlock when concurrent create requests select overlapping uploads.
    for (const id of [...ids].sort()) {
      const row = await this.requireStage(tx, userId, id, true);
      await this.requireUnlinked(tx, id);
      const verified = await this.describe(row);
      const asset = {
        id,
        origin: trusted.find((asset) => asset.id === id)?.origin ?? 'uploaded',
        role: trusted.find((asset) => asset.id === id)?.role ?? 'reference',
        license: null,
        mimeType: verified.mimeType,
        width: verified.width,
        height: verified.height,
        byteSize: verified.byteSize,
        contentHash: verified.contentHash,
        createdAt: verified.createdAt,
      };
      const claim = claimed.find((item) => item.id === id);
      if (
        claim &&
        Object.entries(asset).some(
          ([key, value]) => claim[key as keyof ReferenceAssetMetadata] !== value,
        )
      ) {
        throw new AppError('VALIDATION_FAILED', '暂存图片信息已变化，请重新选择');
      }
      await tx.insert(designSchemeAssets).values({
        ...asset,
        userId,
        revisionId: document.revisionId,
        objectKey: row.objectKey,
        createdAt: row.createdAt,
      });
      await tx.delete(generationReferenceUploads).where(eq(generationReferenceUploads.id, id));
    }
  }

  /** Bounded object IO happens before admission locks; this snapshot never crosses transport. */
  async preflightRunReferences(
    userId: string,
    document: DesignSchemeRevisionDocument,
    ids: string[],
  ): Promise<RunReferencePreflight> {
    const metadata = await this.runReferenceMetadata(this.db, userId, document, ids, false);
    const verified = [];
    for (const row of metadata) {
      const image = await inspectSchemeImage(await this.read(row.reference.objectKey), {
        maxBytes: importedReadBudget(row.reference.objectKey),
      });
      if (
        image.mimeType !== row.reference.mimeType ||
        image.byteSize !== row.reference.byteSize ||
        (row.expectedHash && row.expectedHash !== image.contentHash)
      )
        throw storageError();
      verified.push(
        Object.freeze({
          metadataDigest: row.metadataDigest,
          reference: Object.freeze({ ...row.reference, contentHash: image.contentHash }),
        }),
      );
    }
    return Object.freeze(verified);
  }

  /** Recheck locked server metadata only. The worker verifies object bytes again before dispatch. */
  async resolveRunReferences(
    tx: Tx,
    userId: string,
    document: DesignSchemeRevisionDocument,
    ids: string[],
    preflight: RunReferencePreflight,
  ): Promise<RunReference[]> {
    const current = await this.runReferenceMetadata(tx, userId, document, ids, true);
    if (current.length !== preflight.length) throw notFound();
    return current.map((row, index) => {
      const verified = preflight[index];
      if (
        !verified ||
        row.metadataDigest !== verified.metadataDigest ||
        (row.expiresAt !== null && row.expiresAt <= Date.now())
      )
        throw notFound();
      return { ...verified.reference };
    });
  }

  private async runReferenceMetadata(
    tx: Tx,
    userId: string,
    document: DesignSchemeRevisionDocument,
    ids: string[],
    lock: boolean,
  ) {
    const rows: Array<{
      metadataDigest: string;
      expiresAt: number | null;
      expectedHash: string | undefined;
      reference: Omit<RunReference, 'contentHash'>;
    }> = [];
    for (const id of [...ids].sort()) {
      const assetQuery = tx
        .select({ asset: designSchemeAssets })
        .from(designSchemeAssets)
        .innerJoin(
          designSchemeRevisions,
          and(
            eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
            eq(designSchemeRevisions.userId, userId),
          ),
        )
        .where(
          and(
            eq(designSchemeAssets.id, id),
            eq(designSchemeAssets.userId, userId),
            eq(designSchemeRevisions.schemeId, document.schemeId),
          ),
        );
      const [asset] = lock ? await assetQuery.for('share') : await assetQuery;
      let objectKey: string;
      let name: string;
      let expectedHash: string | undefined;
      let expectedMime: string;
      let expectedBytes: number;
      let metadataDigest: string;
      let expiresAt: number | null = null;
      if (asset) {
        if (asset.asset.revisionId !== document.revisionId && !document.assetIds.includes(id))
          throw notFound();
        objectKey = asset.asset.objectKey;
        name = `参考图 ${ids.indexOf(id) + 1}`;
        expectedHash = asset.asset.contentHash;
        expectedMime = asset.asset.mimeType;
        expectedBytes = asset.asset.byteSize;
        metadataDigest = executionDigest({
          kind: 'asset',
          ...asset.asset,
          createdAt: asset.asset.createdAt.toISOString(),
        });
      } else {
        const uploadQuery = tx
          .select()
          .from(generationReferenceUploads)
          .where(
            and(
              eq(generationReferenceUploads.id, id),
              eq(generationReferenceUploads.userId, userId),
              eq(generationReferenceUploads.status, 'available'),
              sql`${generationReferenceUploads.expiresAt} > clock_timestamp()`,
            ),
          );
        const [upload] = lock ? await uploadQuery.for('update') : await uploadQuery;
        if (
          !upload ||
          upload.expiresAt.getTime() <= Date.now() ||
          ![`${uploadPrefix(userId)}${id}`, `users/${userId}/references/${id}`].includes(
            upload.objectKey,
          )
        )
          throw notFound();
        objectKey = upload.objectKey;
        name = upload.originalName.slice(0, 200);
        expectedMime = upload.mimeType;
        expectedBytes = upload.byteSize;
        expiresAt = upload.expiresAt.getTime();
        metadataDigest = executionDigest({
          kind: 'upload',
          ...upload,
          createdAt: upload.createdAt.toISOString(),
          uploadedAt: upload.uploadedAt?.toISOString() ?? null,
          expiresAt: upload.expiresAt.toISOString(),
          cleanupQueuedAt: upload.cleanupQueuedAt?.toISOString() ?? null,
        });
      }
      rows.push({
        metadataDigest,
        expiresAt,
        expectedHash,
        reference: {
          assetId: id,
          position: ids.indexOf(id),
          objectKey,
          name,
          mimeType: expectedMime,
          byteSize: expectedBytes,
        },
      });
    }
    return ids.map((id) => {
      const reference = rows.find((row) => row.reference.assetId === id);
      if (!reference) throw notFound();
      return reference;
    });
  }

  /** Revision edits can retain only assets already owned by this scheme. */
  async requireDocumentAssets(
    tx: Tx,
    userId: string,
    document: DesignSchemeRevisionDocument,
  ): Promise<void> {
    if (document.assetIds.length === 0) return;
    const rows = await tx
      .select({ id: designSchemeAssets.id })
      .from(designSchemeAssets)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
          eq(designSchemeRevisions.userId, userId),
        ),
      )
      .where(
        and(
          eq(designSchemeAssets.userId, userId),
          eq(designSchemeRevisions.schemeId, document.schemeId),
          inArray(designSchemeAssets.id, document.assetIds),
        ),
      );
    if (rows.length !== document.assetIds.length) throw notFound();
  }

  async documentAssetBytes(userId: string, schemeId: string, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const rows = await this.db
      .select({ bytes: designSchemeAssets.byteSize })
      .from(designSchemeAssets)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
          eq(designSchemeRevisions.userId, userId),
        ),
      )
      .where(
        and(
          eq(designSchemeAssets.userId, userId),
          eq(designSchemeRevisions.schemeId, schemeId),
          inArray(designSchemeAssets.id, ids),
        ),
      );
    if (rows.length !== ids.length) throw notFound();
    return rows.reduce((sum, row) => sum + row.bytes, 0);
  }

  /** Verify durable provenance against actual owned assets and the exact source file manifest. */
  async requireRepositoryImages(tx: Tx, userId: string, document: DesignSchemeRevisionDocument) {
    const provenance = document.repositoryImages ?? [];
    if (
      provenance.some(
        (image) =>
          !document.assetIds.includes(image.assetId) ||
          !document.sourceSnapshotIds.includes(image.snapshotId),
      )
    )
      throw new AppError('VALIDATION_FAILED', '仓库图片必须引用当前文档的真实资产与来源');
    if (!document.assetIds.length) return;
    const rows = await tx
      .select({ asset: designSchemeAssets, original: designSchemeRevisions.document })
      .from(designSchemeAssets)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
          eq(designSchemeRevisions.userId, userId),
        ),
      )
      .where(
        and(
          eq(designSchemeAssets.userId, userId),
          eq(designSchemeRevisions.schemeId, document.schemeId),
          inArray(designSchemeAssets.id, document.assetIds),
        ),
      );
    for (const row of rows) {
      const original = row.original as DesignSchemeRevisionDocument;
      if (
        row.asset.origin === 'repository' &&
        original.repositoryImages?.some((image) => image.assetId === row.asset.id) &&
        !provenance.some((image) => image.assetId === row.asset.id)
      )
        throw new AppError('VALIDATION_FAILED', '保留的仓库图片不能丢失来源');
    }
    for (const image of provenance) {
      const asset = rows.find((row) => row.asset.id === image.assetId)?.asset;
      const [stored] = await tx
        .select()
        .from(designSchemeSourceSnapshots)
        .where(
          and(
            eq(designSchemeSourceSnapshots.userId, userId),
            eq(designSchemeSourceSnapshots.id, image.snapshotId),
          ),
        );
      const parsed = sourceSnapshotSchema.safeParse(stored?.scan);
      const file = parsed.success
        ? parsed.data.files.find(
            (file) => file.relativePath === image.relativePath && file.kind === 'image',
          )
        : undefined;
      if (
        asset?.origin !== 'repository' ||
        asset.role !== 'reference' ||
        !parsed.success ||
        parsed.data.kind !== 'github' ||
        parsed.data.contentHash !== image.sourceContentHash ||
        !file ||
        file.contentHash !== image.contentHash ||
        asset.contentHash !== image.contentHash ||
        file.sizeBytes !== asset.byteSize ||
        file.mimeType !== asset.mimeType
      )
        throw new AppError('VALIDATION_FAILED', '仓库图片来源或资产摘要不一致');
    }
  }

  async content(userId: string, id: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const [asset] = await this.db
      .select({
        objectKey: designSchemeAssets.objectKey,
        contentHash: designSchemeAssets.contentHash,
        mimeType: designSchemeAssets.mimeType,
        byteSize: designSchemeAssets.byteSize,
      })
      .from(designSchemeAssets)
      .innerJoin(
        designSchemeRevisions,
        and(
          eq(designSchemeRevisions.revisionId, designSchemeAssets.revisionId),
          eq(designSchemeRevisions.userId, userId),
        ),
      )
      .innerJoin(
        designSchemes,
        and(eq(designSchemes.id, designSchemeRevisions.schemeId), eq(designSchemes.userId, userId)),
      )
      .where(
        and(
          eq(designSchemeAssets.id, id),
          eq(designSchemeAssets.userId, userId),
          isNull(designSchemes.deletedAt),
        ),
      );
    const [reference] = asset
      ? []
      : await this.db
          .select({
            objectKey: designSchemeGenerationReferences.objectKey,
            contentHash: designSchemeGenerationReferences.contentHash,
            mimeType: designSchemeGenerationReferences.mimeType,
            byteSize: designSchemeGenerationReferences.byteSize,
          })
          .from(designSchemeGenerationReferences)
          .where(
            and(
              eq(designSchemeGenerationReferences.userId, userId),
              eq(designSchemeGenerationReferences.assetId, id),
            ),
          )
          .limit(1);
    const trusted = asset ?? reference;
    const row = trusted ?? (await this.requireStage(this.db, userId, id));
    const bytes = await this.read(row.objectKey);
    const image = await inspectSchemeImage(bytes, { maxBytes: importedReadBudget(row.objectKey) });
    if (
      row.mimeType !== image.mimeType ||
      row.byteSize !== image.byteSize ||
      (trusted && trusted.contentHash !== image.contentHash)
    )
      throw storageError();
    return { bytes, mimeType: image.mimeType };
  }

  private async requireStage(tx: Tx, userId: string, id: string, lock = false): Promise<UploadRow> {
    const query = tx
      .select()
      .from(generationReferenceUploads)
      .where(
        and(
          eq(generationReferenceUploads.id, id),
          eq(generationReferenceUploads.userId, userId),
          eq(generationReferenceUploads.status, 'available'),
          sql`${generationReferenceUploads.expiresAt} > now()`,
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    if (!row || row.objectKey !== `${uploadPrefix(userId)}${id}`) throw notFound();
    return row;
  }

  private async requireUnlinked(tx: Tx, id: string) {
    const [linked] = await tx
      .select({ referenceId: generationReferenceLinks.referenceId })
      .from(generationReferenceLinks)
      .where(eq(generationReferenceLinks.referenceId, id))
      .limit(1);
    if (linked)
      throw new AppError('VALIDATION_FAILED', '图片已用于生图，请重新上传用于方案的参考图');
  }

  private async describe(row: UploadRow): Promise<StagedDesignSchemeAsset> {
    const image = await inspectSchemeImage(await this.read(row.objectKey));
    if (image.mimeType !== row.mimeType || image.byteSize !== row.byteSize) throw storageError();
    return stagedDesignSchemeAssetSchema.parse({
      id: row.id,
      name: row.originalName,
      ...image,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    });
  }

  private async read(objectKey: string): Promise<Uint8Array> {
    try {
      return await this.storage.read(objectKey, importedReadBudget(objectKey));
    } catch {
      throw storageError();
    }
  }
}

function importedReadBudget(objectKey: string) {
  return objectKey.startsWith('scheme-imports/')
    ? DESIGN_SCHEME_PACKAGE_LIMITS.entryBytes
    : undefined;
}

function uploadPrefix(userId: string) {
  return `users/${createHash('sha256').update(userId).digest('hex')}/design-scheme-uploads/`;
}

function notFound() {
  return new AppError('VALIDATION_FAILED', '方案图片不存在或已过期', 404);
}
function storageError() {
  return new AppError('INTERNAL_ERROR', '方案图片存储暂时不可用，请重试', 503, true);
}

function uploadedMetadata(
  value: Pick<
    StagedDesignSchemeAsset,
    'id' | 'mimeType' | 'width' | 'height' | 'byteSize' | 'contentHash' | 'createdAt'
  >,
): ReferenceAssetMetadata {
  return {
    id: value.id,
    origin: 'uploaded',
    role: 'reference',
    license: null,
    mimeType: value.mimeType,
    width: value.width,
    height: value.height,
    byteSize: value.byteSize,
    contentHash: value.contentHash,
    createdAt: value.createdAt,
  };
}
function materialInvalid() {
  return new AppError('VALIDATION_FAILED', '方案素材已变化或不可用，请重新选择后创建', 409, false, {
    reason: 'AGENT_MATERIALS_INVALID',
  });
}
