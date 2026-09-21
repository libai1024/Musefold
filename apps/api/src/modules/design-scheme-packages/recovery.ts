import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DESIGN_SCHEME_PACKAGE_PARSER_VERSION,
  designSchemePackageRecoverySchema,
  designSchemePackageRecoveryPageSchema,
  designSchemePackageRecoveryQuerySchema,
  opaqueIdSchema,
  type DesignSchemePackageRecovery,
  type DesignSchemePackageRecoveryQuery,
} from '@musefold/contracts';
import {
  designSchemePackageStages as stages,
  designSchemePackageImports as imports,
  executionDigest,
  type MusefoldDatabase,
} from '@musefold/db';
import { AppError } from '../../lib/errors.js';
import { lockPackageAuthority } from './authority.js';
import { packageStageView } from './stage-view.js';
import {
  packageConfirmationHash,
  PACKAGE_IMPORT_MAPPING_VERSION,
  PACKAGE_IMPORT_MAX_ATTEMPTS,
  PACKAGE_IMPORT_MIN_IO_LIFETIME_MS,
} from './import-policy.js';

const join = and(eq(imports.stageId, stages.id), eq(imports.userId, stages.userId));
type Stage = typeof stages.$inferSelect;
type Import = typeof imports.$inferSelect;

/** No writes or storage IO: a page reload discovers persisted requests even after a lost begin reply. */
export async function listPackageRecovery(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  raw: DesignSchemePackageRecoveryQuery,
) {
  const input = designSchemePackageRecoveryQuerySchema.parse(raw);
  return db.transaction(async (tx) => {
    const authority = await lockPackageAuthority(tx, userId, sessionId);
    if (input.cursor) {
      const [cursor] = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(and(eq(stages.userId, userId), eq(stages.id, input.cursor)));
      if (!cursor) throw new AppError('VALIDATION_FAILED', '导入记录游标已失效，请刷新列表', 400);
    }
    // Compare in PG to retain timestamp microseconds; cursor lookup is always owner-scoped.
    const before = input.cursor
      ? sql`(${stages.createdAt}, ${stages.id}) < (
      SELECT created_at, id FROM design_scheme_package_stages
      WHERE user_id = ${userId} AND id = ${input.cursor}
    )`
      : undefined;
    const rows = await tx
      .select({ stage: stages, execution: imports })
      .from(stages)
      .leftJoin(imports, join)
      .where(and(eq(stages.userId, userId), before))
      .orderBy(desc(stages.createdAt), desc(stages.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const now = new Date();
    return designSchemePackageRecoveryPageSchema.parse({
      items: page.map((row) => recoveryView(row.stage, row.execution, authority, now)),
      nextCursor: rows.length > input.limit ? page.at(-1)?.stage.id : null,
    });
  });
}

export async function getPackageRecovery(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  rawId: string,
) {
  const id = opaqueIdSchema.parse(rawId);
  return db.transaction(async (tx) => {
    const authority = await lockPackageAuthority(tx, userId, sessionId);
    // Stage and receipt share one statement snapshot, so a concurrent commit cannot tear the DTO.
    const [row] = await tx
      .select({ stage: stages, execution: imports })
      .from(stages)
      .leftJoin(imports, join)
      .where(and(eq(stages.userId, userId), eq(stages.id, id)));
    if (!row) throw new AppError('VALIDATION_FAILED', '方案包不存在', 404);
    return recoveryView(row.stage, row.execution, authority, new Date());
  });
}

function recoveryView(stage: Stage, row: Import | null, authority: string, now: Date) {
  const execution = !row
    ? 'not_started'
    : row.status === 'completed'
      ? 'completed'
      : row.status === 'running' && row.leaseUntil > now
        ? 'running'
        : 'retryable';
  let blockedReason: DesignSchemePackageRecovery['blockedReason'] = null;
  const view = packageStageView(stage, now);
  if (execution !== 'completed') {
    if (stage.authorityHash !== authority || (row && row.authorityHash !== authority))
      blockedReason = 'session_changed';
    else if (
      stage.parserVersion !== DESIGN_SCHEME_PACKAGE_PARSER_VERSION ||
      (row &&
        (row.parserVersion !== stage.parserVersion ||
          row.mappingVersion !== PACKAGE_IMPORT_MAPPING_VERSION))
    )
      blockedReason = 'incompatible_version';
    else if (
      !['awaiting_upload', 'uploading', 'ready', 'confirmed'].includes(view.status) ||
      stage.expiresAt.getTime() - now.getTime() < PACKAGE_IMPORT_MIN_IO_LIFETIME_MS
    )
      blockedReason = 'stage_unavailable';
    else if (
      row &&
      (row.confirmationHash !== stage.confirmationHash ||
        row.requestHash !==
          executionDigest({
            stagedPackageId: stage.id,
            packageHash: stage.packageHash,
            formatVersion: stage.formatVersion,
          }))
    )
      blockedReason = 'confirmation_changed';
    else if (execution === 'running') blockedReason = 'import_in_progress';
    else if (row && row.epoch >= PACKAGE_IMPORT_MAX_ATTEMPTS) blockedReason = 'retry_limit';
    else if (view.status === 'uploading') blockedReason = 'upload_in_progress';
    if (!blockedReason && ['ready', 'confirmed'].includes(view.status)) {
      const expected = packageConfirmationHash(stage);
      if (stage.confirmationHash !== expected) blockedReason = 'confirmation_changed';
    }
  }
  return designSchemePackageRecoverySchema.parse({
    stage: view,
    createdAt: stage.createdAt.toISOString(),
    execution,
    receipt: row?.status === 'completed' ? row.result : null,
    canContinue: execution !== 'completed' && blockedReason === null,
    blockedReason,
  });
}
