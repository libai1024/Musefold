import { type MusefoldDatabase, publishedSkills } from '@musefold/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { AppError } from '../../lib/errors.js';

export interface PublishedSkill {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  inputSchema: Record<string, unknown>;
  contentHash: string;
}

/** 官方 Skills 只读查询;服务端从不执行 skill 内容。 */
export class SkillService {
  constructor(private readonly db: MusefoldDatabase) {}

  async list(): Promise<
    Array<Pick<PublishedSkill, 'id' | 'version' | 'title' | 'summary' | 'contentHash'>>
  > {
    const rows = await this.db
      .select({
        id: publishedSkills.id,
        version: publishedSkills.version,
        title: publishedSkills.title,
        summary: publishedSkills.summary,
        contentHash: publishedSkills.contentHash,
      })
      .from(publishedSkills)
      .where(eq(publishedSkills.status, 'published'))
      .orderBy(asc(publishedSkills.id), desc(publishedSkills.version));
    return rows.map((row) => ({ ...row, contentHash: row.contentHash.trim() }));
  }

  async get(id: string, version: string): Promise<PublishedSkill> {
    const rows = await this.db
      .select()
      .from(publishedSkills)
      .where(
        and(
          eq(publishedSkills.id, id),
          eq(publishedSkills.version, version),
          eq(publishedSkills.status, 'published'),
        ),
      );
    const row = rows[0];
    if (!row) throw new AppError('VALIDATION_FAILED', '官方 Skill 不存在或已下线', 404);
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      content: row.content,
      inputSchema: row.inputSchema,
      contentHash: row.contentHash.trim(),
    };
  }
}
