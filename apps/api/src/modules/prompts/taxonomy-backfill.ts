import { type MusefoldDatabase, promptFolders, promptTags } from '@musefold/db';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { PromptService } from './service.js';
import {
  lockFolderTopology,
  lockTaxonomyIdentity,
  readTaxonomyTombstone,
} from './taxonomy-deletion.js';

const candidateSchema = z.object({
  owner: z.string(),
  kind: z.enum(['folder', 'tag']),
  id: z.string(),
});
const optionsSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    apply: z.boolean().default(false),
  })
  .strict();

/**
 * Post-expand, bounded legacy cleanup. Deploy deletion-aware writers first.
 * Each entity and its references/change log commit atomically; reruns resume from
 * remaining soft-deleted rows. No whole-library snapshot or mutation receipt rewrite.
 */
export async function backfillLegacyTaxonomy(
  db: MusefoldDatabase,
  options: z.input<typeof optionsSchema> = {},
) {
  const { limit, apply } = optionsSchema.parse(options);
  const rows = await db.execute(sql`
    SELECT user_id AS owner, 'folder' AS kind, id FROM prompt_folders WHERE deleted_at IS NOT NULL
    UNION ALL
    SELECT user_id AS owner, 'tag' AS kind, id FROM prompt_tags WHERE deleted_at IS NOT NULL
    ORDER BY owner, kind, id LIMIT ${limit + 1}
  `);
  const candidates = z.array(candidateSchema).parse(rows.rows);
  const selected = candidates.slice(0, limit);
  const service = new PromptService(db);
  let cleaned = 0;
  let skipped = 0;
  if (apply) {
    for (const candidate of selected) {
      const changed = await db.transaction(async (tx) => {
        const { owner, kind, id } = candidate;
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
        if (kind === 'folder') await lockFolderTopology(tx, owner);
        await lockTaxonomyIdentity(tx, owner, kind, id);
        const table = kind === 'folder' ? promptFolders : promptTags;
        const [current] = await tx
          .select({ deletedAt: table.deletedAt, version: table.version })
          .from(table)
          .where(and(eq(table.userId, owner), eq(table.id, id)))
          .for('update');
        // Another deletion or an unsupported old writer may have changed this candidate.
        // In particular, never turn a restored live row into a new deletion.
        if (!current?.deletedAt) return false;
        if (await readTaxonomyTombstone(tx, owner, kind, id)) {
          throw new AppError(
            'VALIDATION_FAILED',
            '分类实体与永久删除身份同时存在，请先核对迁移数据',
            409,
          );
        }
        const crossOwner =
          kind === 'folder'
            ? await tx.execute(sql`SELECT 1 FROM prompt_folders WHERE parent_id=${id} AND user_id<>${owner}
              UNION ALL SELECT 1 FROM prompts WHERE folder_id=${id} AND user_id<>${owner} LIMIT 1`)
            : await tx.execute(sql`SELECT 1 FROM prompt_tag_links l JOIN prompts p ON p.id=l.prompt_id
              WHERE l.tag_id=${id} AND p.user_id<>${owner} LIMIT 1`);
        if (crossOwner.rows.length) {
          throw new AppError('VALIDATION_FAILED', '分类存在跨账号异常引用，请先核对迁移数据', 409);
        }
        if (kind === 'folder') await service.deleteFolder(owner, id, current.version, { tx });
        else await service.deleteTag(owner, id, current.version, { tx });
        return true;
      });
      if (changed) cleaned++;
      else skipped++;
    }
  }
  return {
    mode: apply ? ('apply' as const) : ('preview' as const),
    selected: selected.length,
    cleaned,
    skipped,
    hasMore: candidates.length > limit,
  };
}
