import Ajv from "ajv";
import { sql, type Kysely } from 'kysely';
import type { MusefoldDatabase } from '../../database/types.js';
import { AppError } from '../../errors.js';

export interface PublishedSkill {
  id: string;
  version: string;
  title: string;
  summary: string;
  content: string;
  inputSchema: Record<string, unknown>;
  contentHash: string;
}

export class SkillService {
  constructor(private readonly db: Kysely<MusefoldDatabase>) {}

  async list(): Promise<
    Array<
      Pick<
        PublishedSkill,
        'id' | 'version' | 'title' | 'summary' | 'contentHash'
      >
    >
  > {
    const result = await sql<{
      id: string;
      version: string;
      title: string;
      summary: string;
      content_hash: string;
    }>`
      SELECT id, version, title, summary, content_hash
      FROM app.published_skills WHERE status = 'published'
      ORDER BY id, version DESC
    `.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      contentHash: row.content_hash.trim(),
    }));
  }

  async get(id: string, version: string): Promise<PublishedSkill> {
    const result = await sql<{
      id: string;
      version: string;
      title: string;
      summary: string;
      content: string;
      input_schema: Record<string, unknown>;
      content_hash: string;
    }>`
      SELECT id, version, title, summary, content, input_schema, content_hash
      FROM app.published_skills
      WHERE id = ${id} AND version = ${version} AND status = 'published'
    `.execute(this.db);
    const row = result.rows[0];
    if (!row)
      throw new AppError('VALIDATION_FAILED', '官方 Skill 不存在或已下线', 404);
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      summary: row.summary,
      content: row.content,
      inputSchema: row.input_schema,
      contentHash: row.content_hash.trim(),
    };
  }

  validateInputs(
    skill: PublishedSkill,
    inputs: Record<string, unknown>,
  ): void {
    let validate: ReturnType<Ajv["compile"]>;
    try {
      validate = new Ajv({ allErrors: true, strict: true }).compile(
        skill.inputSchema,
      );
    } catch {
      // schema 编译失败不得把 Ajv 细节泄漏给客户端
      throw new AppError(
        "INTERNAL_ERROR",
        "官方 Skill 输入 schema 无法使用",
        500,
        false,
        { skillId: skill.id, skillVersion: skill.version },
      );
    }
    if (validate(inputs)) return;
    const detail = (validate.errors ?? [])
      .slice(0, 4)
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "无效"}`)
      .join("；");
    throw new AppError(
      "VALIDATION_FAILED",
      `Skill 输入不符合 schema${detail ? `：${detail}` : ""}`,
      400,
    );
  }
}
