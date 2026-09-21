import type Database from 'better-sqlite3';
import { parseDesignSchemeRevisionDocument } from '@musefold/desktop-contracts/design-scheme/schema';

/**
 * asset.revision_id records where an image originated. A later revision may explicitly
 * retain its ID in its canonical document; this never transfers trial/cover eligibility.
 * Keep the document as the reference authority rather than a second mutable ID list.
 */
export function readRevisionAssetIds(
  db: Database.Database,
  schemeId: string,
  revisionId: string,
): string[] {
  const row = db
    .prepare(`SELECT r.document_json FROM design_scheme_revisions r
    JOIN design_schemes s ON s.id = r.scheme_id
    WHERE r.revision_id = ? AND r.scheme_id = ? AND s.deleted_at IS NULL`)
    .get(revisionId, schemeId) as { document_json: string } | undefined;
  if (!row) throw new Error('方案版本不存在或不属于当前方案');
  const parsed = parseDesignSchemeRevisionDocument(JSON.parse(row.document_json));
  if (!parsed.ok || parsed.value.schemeId !== schemeId || parsed.value.revisionId !== revisionId)
    throw new Error('方案素材引用文档无效');
  const declared = parsed.value.assetIds ?? [];
  if (new Set(declared).size !== declared.length) throw new Error('方案素材引用重复');
  const owned = db
    .prepare(`SELECT a.id, a.revision_id FROM design_scheme_assets a
    JOIN design_scheme_revisions r ON r.revision_id = a.revision_id WHERE r.scheme_id = ?
    AND (a.revision_id = ? OR a.id IN (SELECT value FROM json_each(?)))
    ORDER BY a.created_at, a.id`)
    .all(schemeId, revisionId, JSON.stringify(declared)) as Array<{
    id: string;
    revision_id: string;
  }>;
  const found = new Set(owned.map((asset) => asset.id));
  if (declared.some((id) => !found.has(id))) throw new Error('方案声明的素材缺失或属于其他方案');
  return [...new Set([...declared, ...owned.map((asset) => asset.id)])];
}
