import { and, desc, eq, sql } from 'drizzle-orm';
import {
  designSchemePackageExportHistoryQuerySchema,
  designSchemePackageExportHistorySchema,
  designSchemePackageExportRecoverySchema,
  opaqueIdSchema,
  type DesignSchemePackageExportHistoryQuery,
  type DesignSchemePackageExportRecovery,
} from '@musefold/contracts';
import {
  designSchemePackageExports as exports,
  designSchemes,
  type MusefoldDatabase,
} from '@musefold/db';
import type { DesignSchemeService } from '../design-schemes/service.js';
import type { DesignSchemeAssetService } from '../design-scheme-assets/service.js';
import { lockPackageAuthority } from './authority.js';
import { collectExportBasis } from './export-content.js';
import { packageExportView, PACKAGE_EXPORT_MIN_IO_MS } from './export-view.js';
import { AppError } from '../../lib/errors.js';

const join = and(eq(designSchemes.id, exports.schemeId), eq(designSchemes.userId, exports.userId));
const columns = { row: exports, schemeName: designSchemes.name };
function record(item: { row: typeof exports.$inferSelect; schemeName: string | null }) {
  return {
    export: packageExportView(item.row),
    expectedVersion: item.row.expectedVersion,
    createdAt: item.row.createdAt.toISOString(),
    schemeName: item.schemeName,
  };
}

export async function listPackageExports(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  raw: DesignSchemePackageExportHistoryQuery,
) {
  const query = designSchemePackageExportHistoryQuerySchema.parse(raw);
  return db.transaction(async (tx) => {
    await lockPackageAuthority(tx, userId, sessionId);
    if (query.cursor) {
      const [cursor] = await tx
        .select({ id: exports.id })
        .from(exports)
        .where(and(eq(exports.userId, userId), eq(exports.id, query.cursor)));
      if (!cursor) throw new AppError('VALIDATION_FAILED', '导出记录游标已失效，请刷新列表', 400);
    }
    const before = query.cursor
      ? sql`(${exports.createdAt}, ${exports.id}) < (
      SELECT created_at, id FROM design_scheme_package_exports
      WHERE user_id=${userId} AND id=${query.cursor})`
      : undefined;
    const rows = await tx
      .select(columns)
      .from(exports)
      .leftJoin(designSchemes, join)
      .where(and(eq(exports.userId, userId), before))
      .orderBy(desc(exports.createdAt), desc(exports.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return designSchemePackageExportHistorySchema.parse({
      items: page.map(record),
      nextCursor: rows.length > query.limit ? page.at(-1)?.row.id : null,
    });
  });
}

export async function recoverPackageExport(
  db: MusefoldDatabase,
  userId: string,
  sessionId: string,
  rawId: string,
  schemes: DesignSchemeService,
  assets: DesignSchemeAssetService,
) {
  const id = opaqueIdSchema.parse(rawId);
  return db.transaction(async (tx) => {
    const authority = await lockPackageAuthority(tx, userId, sessionId);
    // A share lock keeps cancellation/ready publication consistent through the basis check.
    const [row] = await tx
      .select()
      .from(exports)
      .where(and(eq(exports.userId, userId), eq(exports.id, id)))
      .for('share');
    if (!row) throw new AppError('VALIDATION_FAILED', '导出请求不存在', 404);
    const [scheme] = await tx
      .select({ name: designSchemes.name })
      .from(designSchemes)
      .where(and(eq(designSchemes.userId, userId), eq(designSchemes.id, row.schemeId)));
    const item = record({ row, schemeName: scheme?.name ?? null });
    let blockedReason: DesignSchemePackageExportRecovery['blockedReason'] = null;
    if (row.authorityHash !== authority) blockedReason = 'session_changed';
    else if (
      row.expiresAt.getTime() - Date.now() < PACKAGE_EXPORT_MIN_IO_MS ||
      !['ready', 'preparing'].includes(item.export.status)
    )
      blockedReason = 'export_unavailable';
    else if (item.export.status === 'preparing') blockedReason = 'export_in_progress';
    else {
      try {
        const basis = await collectExportBasis(
          tx,
          userId,
          {
            requestId: row.requestId,
            schemeId: row.schemeId,
            revisionId: row.revisionId,
            expectedVersion: row.expectedVersion,
            formatVersion: 2,
          },
          schemes,
          assets,
        );
        if (basis.hash !== row.basisHash) blockedReason = 'basis_changed';
      } catch (error) {
        if (!(error instanceof AppError) || ![400, 404, 409, 422].includes(error.status))
          throw error;
        blockedReason = 'basis_changed';
      }
    }
    // No renewal, object reads/writes, archive construction, or client delivery claim.
    return designSchemePackageExportRecoverySchema.parse({
      ...item,
      canDownload: blockedReason === null,
      blockedReason,
    });
  });
}
