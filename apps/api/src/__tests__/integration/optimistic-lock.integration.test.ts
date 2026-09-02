import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type MusefoldDatabase, createDatabase, migrateDatabase } from '@musefold/db';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PromptService } from '../../modules/prompts/service.js';
import { WorkbenchService } from '../../modules/workbench/service.js';

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === 'true';
const describeDb = runDatabaseTests ? describe : describe.skip;

/**
 * 乐观锁丢失写入场次:服务在预检(current.version === expectedVersion)通过之后、
 * UPDATE 落库之前,可能被并发事务抢先提交。修复要求:
 * 1. UPDATE 带版本谓词并检查受影响行数,0 行立即抛稳定 CONFLICT(409 + 契约错误码);
 * 2. 裁决必须发生在标签替换 / 关联摘除 / 变更日志之前——败者事务不产生任何误导性副作用;
 * 3. 恰好一个胜者,胜者状态完整落库。
 *
 * 两种复现方式:
 * - 确定性竞态(loseRaceAfterPrecheck):行锁挂起服务事务的 UPDATE,再让另一连接提交版本推进,
 *   强制走「预检通过但 0 行落库」分支;
 * - 真并发(Promise.allSettled):同 expectedVersion 齐发,恰好一个胜者。
 */
describeDb('乐观锁并发裁决(prompts / workbench,真 PostgreSQL)', () => {
  let container: StartedPostgreSqlContainer;
  let db: MusefoldDatabase;
  let pool: pg.Pool;
  let prompts: PromptService;
  let workbench: WorkbenchService;
  const userId = 'optimistic-lock-user-a';
  const otherUserId = 'optimistic-lock-user-b';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();
    const created = createDatabase(container.getConnectionUri(), { max: 10 });
    db = created.db;
    pool = created.pool;
    await migrateDatabase(db);
    await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3), ($4, $5, $6)', [
      userId,
      '锁用户A',
      'optimistic-lock-a@musefold.app',
      otherUserId,
      '锁用户B',
      'optimistic-lock-b@musefold.app',
    ]);
    prompts = new PromptService(db);
    workbench = new WorkbenchService(db);
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  function newPromptInput(title: string, tagIds: string[] = []) {
    return {
      title,
      description: null,
      content: `content of ${title}`,
      negative: null,
      folderId: null,
      tagIds,
      modelId: null,
      params: null,
      rating: 0,
      isPinned: false,
      source: 'manual' as const,
      sourceUrl: null,
    };
  }

  function draft(prompt: string) {
    return {
      prompt,
      negative: '',
      params: {},
      promptReferenceSelections: [],
      promptReferenceIds: [],
    };
  }

  async function changeLogEntries(
    entityType: string,
    entityId: string,
  ): Promise<Array<{ operation: string; version: number }>> {
    const { rows } = await pool.query(
      'SELECT operation, version FROM sync_change_log WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY seq',
      [userId, entityType, entityId],
    );
    // version 是 bigint 列,node-postgres 以字符串返回,统一转回数字。
    return (rows as Array<{ operation: string; version: string | number }>).map((row) => ({
      operation: row.operation,
      version: Number(row.version),
    }));
  }

  async function tagLinksOf(promptId: string): Promise<string[]> {
    const { rows } = await pool.query(
      'SELECT tag_id FROM prompt_tag_links WHERE prompt_id = $1 ORDER BY tag_id',
      [promptId],
    );
    return (rows as Array<{ tag_id: string }>).map((row) => row.tag_id);
  }

  async function tableRow(table: string, id: string): Promise<Record<string, unknown>> {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return (rows[0] ?? {}) as Record<string, unknown>;
  }

  /** 等待服务事务的 UPDATE 被行锁阻塞(poll pg_stat_activity,避免竞态测试的睡眠竞态)。 */
  async function waitForBlockedWriter(timeoutMs = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        "SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND state = 'active'",
      );
      if (((rows[0] as { blocked: number } | undefined)?.blocked ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('乐观锁竞态测试:等待被行锁阻塞的 UPDATE 超时');
  }

  /**
   * 确定性复现「预检通过后输掉竞态」:
   * 1) 另一连接 BEGIN + SELECT ... FOR UPDATE 持住目标行(不改版本,服务预检照常通过);
   * 2) 发起服务写事务,其 UPDATE 阻塞在行锁上;
   * 3) 持锁连接把 version + 1 后 COMMIT;
   * 4) 服务的 UPDATE 解除阻塞并按 READ COMMITTED 重新评估版本谓词 → 0 行 → 必须抛 CONFLICT。
   * 返回被测事务的 Promise,由调用方断言拒绝与错误码。
   */
  async function loseRaceAfterPrecheck<T>(
    table: 'prompts' | 'prompt_folders' | 'prompt_tags' | 'workbench_sessions',
    id: string,
    attempt: () => Promise<T>,
  ): Promise<{ attempt: Promise<T> }> {
    const holder = await pool.connect();
    let outcome: Promise<T> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
      outcome = attempt();
      // 预挂 no-op 处理器:败者事务会在持锁连接 COMMIT 后立刻拒绝,
      // 早于调用方挂上断言,避免被 Node 记为未处理拒绝。
      outcome.catch(() => {});
    } catch (error) {
      holder.release();
      throw error;
    }
    try {
      await waitForBlockedWriter();
      await holder.query(
        `UPDATE ${table} SET version = version + 1, updated_at = now() WHERE id = $1`,
        [id],
      );
      await holder.query('COMMIT');
    } catch (error) {
      outcome?.catch(() => {});
      try {
        await holder.query('ROLLBACK');
      } catch {
        // 持锁连接可能已异常终结,回滚失败可忽略。
      }
      throw error;
    }
    holder.release();
    if (!outcome) throw new Error('unreachable: 竞态事务未启动');
    // 用对象包裹返回:直接返回 Promise 会被调用方的 await 递归展平,
    // 败者拒绝将提前抛进测试体,断言来不及挂载。
    return { attempt: outcome };
  }

  it('提示词更新输掉竞态:0 行裁决先于标签替换与变更日志', async () => {
    const keep = await prompts.createTag(userId, { name: 'race-keep', group: null, color: null });
    const swap = await prompts.createTag(userId, { name: 'race-swap', group: null, color: null });
    const prompt = await prompts.createPrompt(userId, newPromptInput('race-prompt', [keep.id]));
    expect(prompt.version).toBe(1);
    expect(await tagLinksOf(prompt.id)).toEqual([keep.id]);
    expect(await changeLogEntries('prompt', prompt.id)).toHaveLength(1);

    const { attempt } = await loseRaceAfterPrecheck('prompts', prompt.id, () =>
      prompts.updatePrompt(userId, prompt.id, {
        ...newPromptInput('race-prompt-loser'),
        tagIds: [swap.id],
        expectedVersion: prompt.version,
      }),
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'PROMPT_VERSION_CONFLICT',
      status: 409,
      details: { current: { version: 2 } },
    });

    // 败者零副作用:标题未改、标签仍是原集合、变更日志仍只有 create 一条。
    const row = await tableRow('prompts', prompt.id);
    expect(row.title).toBe('race-prompt');
    expect(row.version).toBe(2);
    expect(row.deleted_at).toBeNull();
    expect(await tagLinksOf(prompt.id)).toEqual([keep.id]);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
  });

  it('提示词同版本真并发更新:恰好一个胜者,标签只被替换一次', async () => {
    const keep = await prompts.createTag(userId, { name: 'conc-keep', group: null, color: null });
    const swap = await prompts.createTag(userId, { name: 'conc-swap', group: null, color: null });
    const prompt = await prompts.createPrompt(userId, newPromptInput('conc-prompt', [keep.id]));

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        prompts.updatePrompt(userId, prompt.id, {
          ...newPromptInput(`conc-prompt-winner-${index}`),
          tagIds: [swap.id],
          expectedVersion: prompt.version,
        }),
      ),
    );
    const fulfilled = attempts.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = attempts.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const outcome of rejected) {
      expect((outcome.reason as { code?: string }).code).toBe('PROMPT_VERSION_CONFLICT');
    }
    const winner = fulfilled[0];
    if (winner.status !== 'fulfilled') throw new Error('unreachable');

    const row = await tableRow('prompts', prompt.id);
    expect(row.title).toBe(winner.value.title);
    expect(row.version).toBe(2);
    expect(await tagLinksOf(prompt.id)).toEqual([swap.id]);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
      { operation: 'upsert', version: 2 },
    ]);
  });

  it('提示词软删输掉竞态:不落库、不写 delete 变更日志', async () => {
    const prompt = await prompts.createPrompt(userId, newPromptInput('race-delete-prompt'));

    const { attempt } = await loseRaceAfterPrecheck('prompts', prompt.id, () =>
      prompts.deletePrompt(userId, prompt.id, prompt.version),
    );
    await expect(attempt).rejects.toMatchObject({ code: 'PROMPT_VERSION_CONFLICT', status: 409 });

    const row = await tableRow('prompts', prompt.id);
    expect(row.deleted_at).toBeNull();
    expect(row.version).toBe(2);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
  });

  it('提示词恢复携带过期版本被拒;缺省版本的无条件软删不被并发版本推进丢写', async () => {
    const prompt = await prompts.createPrompt(userId, newPromptInput('uncond-prompt'));
    const removed = await prompts.deletePrompt(userId, prompt.id, undefined);
    expect(removed.deletedAt).not.toBeNull();
    expect(removed.version).toBe(2);

    await expect(prompts.restorePrompt(userId, prompt.id, prompt.version)).rejects.toMatchObject({
      code: 'PROMPT_VERSION_CONFLICT',
      status: 409,
    });
    expect((await tableRow('prompts', prompt.id)).deleted_at).not.toBeNull();

    // 无条件路径:并发方先推进版本,缺省 expectedVersion 的软删仍必须落库。
    await pool.query('UPDATE prompts SET version = version + 1 WHERE id = $1', [prompt.id]);
    const unconditioned = await prompts.deletePrompt(userId, prompt.id, undefined);
    expect(unconditioned.deletedAt).not.toBeNull();
    expect(unconditioned.version).toBe(4);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
      { operation: 'delete', version: 2 },
      { operation: 'delete', version: 4 },
    ]);
  });

  it('文件夹更新输掉竞态:稳定 CONFLICT 且不追加变更日志', async () => {
    const folder = await prompts.createFolder(userId, {
      name: 'race-folder',
      parentId: null,
      sortOrder: 0,
    });

    const { attempt } = await loseRaceAfterPrecheck('prompt_folders', folder.id, () =>
      prompts.updateFolder(userId, folder.id, {
        name: 'race-folder-loser',
        parentId: null,
        sortOrder: 0,
        expectedVersion: folder.version,
      }),
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'PROMPT_VERSION_CONFLICT',
      status: 409,
      details: { current: { version: 2 } },
    });

    const row = await tableRow('prompt_folders', folder.id);
    expect(row.name).toBe('race-folder');
    expect(row.version).toBe(2);
    expect(await changeLogEntries('folder', folder.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
  });

  it('文件夹软删输掉竞态:裁决先于子文件夹/提示词摘除', async () => {
    const folder = await prompts.createFolder(userId, {
      name: 'race-detach-folder',
      parentId: null,
      sortOrder: 0,
    });
    const child = await prompts.createFolder(userId, {
      name: 'race-detach-child',
      parentId: folder.id,
      sortOrder: 0,
    });
    const prompt = await prompts.createPrompt(userId, {
      ...newPromptInput('race-detach-prompt'),
      folderId: folder.id,
    });

    const { attempt } = await loseRaceAfterPrecheck('prompt_folders', folder.id, () =>
      prompts.deleteFolder(userId, folder.id, folder.version),
    );
    await expect(attempt).rejects.toMatchObject({ code: 'PROMPT_VERSION_CONFLICT', status: 409 });

    // 败者不得摘除任何关联:子文件夹仍挂在本文件夹下,提示词仍属于本文件夹且版本不变。
    const folderRow = await tableRow('prompt_folders', folder.id);
    expect(folderRow.deleted_at).toBeNull();
    expect(folderRow.version).toBe(2);
    expect((await tableRow('prompt_folders', child.id)).parent_id).toBe(folder.id);
    const promptRow = await tableRow('prompts', prompt.id);
    expect(promptRow.folder_id).toBe(folder.id);
    expect(promptRow.version).toBe(1);
    expect(await changeLogEntries('folder', folder.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
    expect(await changeLogEntries('folder', child.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
  });

  it('标签更新输掉竞态:稳定 CONFLICT 且不追加变更日志', async () => {
    const tag = await prompts.createTag(userId, { name: 'race-tag', group: null, color: null });

    const { attempt } = await loseRaceAfterPrecheck('prompt_tags', tag.id, () =>
      prompts.updateTag(userId, tag.id, {
        name: 'race-tag-loser',
        group: null,
        color: null,
        expectedVersion: tag.version,
      }),
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'PROMPT_VERSION_CONFLICT',
      status: 409,
      details: { current: { version: 2 } },
    });

    const row = await tableRow('prompt_tags', tag.id);
    expect(row.name).toBe('race-tag');
    expect(row.version).toBe(2);
    expect(await changeLogEntries('tag', tag.id)).toEqual([{ operation: 'upsert', version: 1 }]);
  });

  it('标签软删输掉竞态:裁决先于链接摘除与提示词版本推进', async () => {
    const tag = await prompts.createTag(userId, {
      name: 'race-tag-delete',
      group: null,
      color: null,
    });
    const prompt = await prompts.createPrompt(userId, newPromptInput('race-tag-prompt', [tag.id]));
    expect(await tagLinksOf(prompt.id)).toEqual([tag.id]);

    const { attempt } = await loseRaceAfterPrecheck('prompt_tags', tag.id, () =>
      prompts.deleteTag(userId, tag.id, tag.version),
    );
    await expect(attempt).rejects.toMatchObject({ code: 'PROMPT_VERSION_CONFLICT', status: 409 });

    // 败者不得摘除链接、不得递增提示词版本、不得写 delete 变更日志。
    const tagRow = await tableRow('prompt_tags', tag.id);
    expect(tagRow.deleted_at).toBeNull();
    expect(tagRow.version).toBe(2);
    expect(await tagLinksOf(prompt.id)).toEqual([tag.id]);
    expect((await tableRow('prompts', prompt.id)).version).toBe(1);
    expect(await changeLogEntries('tag', tag.id)).toEqual([{ operation: 'upsert', version: 1 }]);
    expect(await changeLogEntries('prompt', prompt.id)).toEqual([
      { operation: 'upsert', version: 1 },
    ]);
  });

  it('工作台更新输掉竞态:0 行裁决,不把胜者状态当成功返回', async () => {
    const session = await workbench.create(userId, {
      title: 'race-session',
      draft: draft('original'),
    });

    const { attempt } = await loseRaceAfterPrecheck('workbench_sessions', session.id, () =>
      workbench.update(userId, session.id, {
        expectedVersion: session.version,
        title: 'race-session-loser',
        draft: draft('loser draft'),
      }),
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'WORKBENCH_VERSION_CONFLICT',
      status: 409,
      details: { current: { version: 2 } },
    });

    const row = await tableRow('workbench_sessions', session.id);
    expect(row.title).toBe('race-session');
    expect((row.draft as Record<string, unknown>).prompt).toBe('original');
    expect(row.version).toBe(2);
  });

  it('工作台同版本真并发更新:恰好一个胜者', async () => {
    const session = await workbench.create(userId, {
      title: 'conc-session',
      draft: draft('original'),
    });

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) =>
        workbench.update(userId, session.id, {
          expectedVersion: session.version,
          draft: draft(`winner draft ${index}`),
        }),
      ),
    );
    const fulfilled = attempts.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = attempts.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(5);
    for (const outcome of rejected) {
      expect((outcome.reason as { code?: string }).code).toBe('WORKBENCH_VERSION_CONFLICT');
    }

    const row = await tableRow('workbench_sessions', session.id);
    const winner = fulfilled[0];
    if (winner.status !== 'fulfilled') throw new Error('unreachable');
    expect((row.draft as Record<string, unknown>).prompt).toBe(winner.value.draft.prompt);
    expect(row.version).toBe(2);
  });

  it('工作台软删输掉竞态不落库;恢复携带过期版本被拒', async () => {
    const session = await workbench.create(userId, {
      title: 'race-session-delete',
      draft: draft('original'),
    });

    const { attempt } = await loseRaceAfterPrecheck('workbench_sessions', session.id, () =>
      workbench.remove(userId, session.id, session.version),
    );
    await expect(attempt).rejects.toMatchObject({
      code: 'WORKBENCH_VERSION_CONFLICT',
      status: 409,
    });
    expect((await tableRow('workbench_sessions', session.id)).deleted_at).toBeNull();

    const removed = await workbench.remove(userId, session.id, undefined);
    expect(removed.deletedAt).not.toBeNull();
    // 竞态胜者已把版本推进到 2,无条件软删再原子自增一档。
    expect(removed.version).toBe(3);
    await expect(workbench.restore(userId, session.id, session.version)).rejects.toMatchObject({
      code: 'WORKBENCH_VERSION_CONFLICT',
      status: 409,
    });
    expect((await tableRow('workbench_sessions', session.id)).deleted_at).not.toBeNull();
  });

  it('所有者隔离:他人版本匹配也不得触发竞态裁决路径', async () => {
    const tag = await prompts.createTag(userId, { name: 'scope-tag', group: null, color: null });
    const prompt = await prompts.createPrompt(userId, newPromptInput('scope-prompt', [tag.id]));
    const folder = await prompts.createFolder(userId, {
      name: 'scope-folder',
      parentId: null,
      sortOrder: 0,
    });
    const session = await workbench.create(userId, {
      title: 'scope-session',
      draft: draft('original'),
    });

    await expect(
      prompts.updatePrompt(otherUserId, prompt.id, {
        ...newPromptInput('scope-hijack'),
        expectedVersion: prompt.version,
      }),
    ).rejects.toMatchObject({ code: 'PROMPT_NOT_FOUND', status: 404 });
    await expect(
      prompts.deletePrompt(otherUserId, prompt.id, prompt.version),
    ).rejects.toMatchObject({ code: 'PROMPT_NOT_FOUND', status: 404 });
    await expect(
      prompts.updateFolder(otherUserId, folder.id, {
        name: 'scope-hijack',
        parentId: null,
        sortOrder: 0,
        expectedVersion: folder.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 404 });
    await expect(
      prompts.updateTag(otherUserId, tag.id, {
        name: 'scope-hijack',
        group: null,
        color: null,
        expectedVersion: tag.version,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 404 });
    await expect(
      workbench.update(otherUserId, session.id, {
        expectedVersion: session.version,
        title: 'scope-hijack',
      }),
    ).rejects.toMatchObject({ code: 'WORKBENCH_SESSION_NOT_FOUND', status: 404 });

    // 原所有者的数据未被越权路径触碰。
    expect(await tagLinksOf(prompt.id)).toEqual([tag.id]);
    expect((await tableRow('prompts', prompt.id)).version).toBe(1);
    expect((await tableRow('workbench_sessions', session.id)).version).toBe(1);
  });
});
