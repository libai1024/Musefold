// prompts 域桥守护:回收站永久删除只对已软删行合法,删除后行彻底消失。
// 库为临时文件 SQLite(core runtime 惰性建库),sync 域 mock 掉避免拉 electron。

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../sync-domain', () => ({
  scheduleV25CloudSync: vi.fn(),
}));

import type { NewPromptDocument, PromptDocument } from '@musefold/contracts';
import { configureCoreRuntime } from '@musefold/core/runtime';
import { buildPromptsDomainMethods } from '../prompts-domain';

const tempDir = mkdtempSync(join(tmpdir(), 'musefold-prompts-domain-'));

configureCoreRuntime({
  getPaths: () => ({
    userData: tempDir,
    db: join(tempDir, 'test.db'),
    backups: tempDir,
    previews: tempDir,
    pictures: tempDir,
    logs: tempDir,
  }),
  loadApiKey: () => null,
  createLogger: () => ({
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }),
  estimateProviderCost: () => null,
});

const NEW_DOC: NewPromptDocument = {
  title: '待永久删除',
  description: null,
  content: 'purge me',
  negative: null,
  folderId: null,
  tagIds: [],
  modelId: null,
  params: null,
  rating: 0,
  isPinned: false,
  source: 'manual',
  sourceUrl: null,
};

type Methods = Record<string, { handle(input: unknown): Promise<unknown> }>;

describe('prompts 域桥:永久删除', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildPromptsDomainMethods() as Methods;
  });

  it('活跃行拒绝 purge;软删后 purge 成功且 get 抛 NOT_FOUND', async () => {
    const created = (await methods['prompts.create'].handle(NEW_DOC)) as PromptDocument;

    await expect(methods['prompts.purge'].handle({ id: created.id })).rejects.toThrow(
      '只能永久删除回收站中的提示词',
    );

    const removed = (await methods['prompts.remove'].handle({
      id: created.id,
    })) as PromptDocument;
    expect(removed.deletedAt).not.toBeNull();

    await expect(methods['prompts.purge'].handle({ id: created.id })).resolves.toBeUndefined();
    await expect(methods['prompts.get'].handle({ id: created.id })).rejects.toThrow('不存在');
  });
});

describe('prompts 域桥:清空回收站', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildPromptsDomainMethods() as Methods;
  });

  it('只清软删行,活跃行原样保留;空回收站返回 0(幂等)', async () => {
    await expect(methods['prompts.emptyTrash'].handle(undefined)).resolves.toEqual({ purged: 0 });

    const keep = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '保留的活跃行',
    })) as PromptDocument;
    const trashedA = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '回收站 A',
    })) as PromptDocument;
    const trashedB = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '回收站 B',
    })) as PromptDocument;
    await methods['prompts.remove'].handle({ id: trashedA.id });
    await methods['prompts.remove'].handle({ id: trashedB.id });

    await expect(methods['prompts.emptyTrash'].handle(undefined)).resolves.toEqual({ purged: 2 });

    await expect(methods['prompts.get'].handle({ id: trashedA.id })).rejects.toThrow('不存在');
    await expect(methods['prompts.get'].handle({ id: trashedB.id })).rejects.toThrow('不存在');
    await expect(methods['prompts.get'].handle({ id: keep.id })).resolves.toMatchObject({
      title: '保留的活跃行',
    });

    await expect(methods['prompts.emptyTrash'].handle(undefined)).resolves.toEqual({ purged: 0 });
  });
});

describe('prompts 域桥:封面 media:// 映射', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildPromptsDomainMethods() as Methods;
  });

  it('受管路径的封面回显为 media:// URL,绝对路径不出主进程', async () => {
    const coverPath = join(tempDir, 'cover.png');
    const created = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '带封面',
      coverImageUrl: `media://local/?p=${encodeURIComponent(coverPath)}`,
    })) as PromptDocument;

    expect(created.coverImageUrl).toBe(`media://local/?p=${encodeURIComponent(coverPath)}`);
    expect(created.coverImageUrl).not.toContain(tempDir.replaceAll('/', ''));
    expect(created.coverImageUrl?.startsWith('media://local/?p=')).toBe(true);
  });

  it('受管根目录之外的封面不落盘(防目录穿越)', async () => {
    const created = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '越界封面',
      coverImageUrl: 'media://local/?p=%2Fetc%2Fhosts',
    })) as PromptDocument;

    expect(created.coverImageUrl).toBeNull();
  });

  it('远端 https 封面在桌面无槽位,回显为无封面', async () => {
    const created = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '远端封面',
      coverImageUrl: 'https://cdn.example/cover.png',
    })) as PromptDocument;

    expect(created.coverImageUrl).toBeNull();
  });

  it('更新显式 null 清除封面', async () => {
    const coverPath = join(tempDir, 'cover-clear.png');
    const created = (await methods['prompts.create'].handle({
      ...NEW_DOC,
      title: '待清除封面',
      coverImageUrl: `media://local/?p=${encodeURIComponent(coverPath)}`,
    })) as PromptDocument;
    expect(created.coverImageUrl).not.toBeNull();

    const updated = (await methods['prompts.update'].handle({
      id: created.id,
      patch: { coverImageUrl: null, expectedVersion: created.version },
    })) as PromptDocument;

    expect(updated.coverImageUrl).toBeNull();
  });
});

describe('prompts 域桥:目录 workspace 作用域', () => {
  let methods: Methods;

  beforeAll(() => {
    methods = buildPromptsDomainMethods() as Methods;
  });

  it('文件夹与标签 CRUD 使用当前 workspace,删除后不再出现在列表', async () => {
    const folder = (await methods['prompts.createFolder'].handle({
      name: '作用域文件夹',
      parentId: null,
      sortOrder: 0,
    })) as { id: string; name: string };
    const tag = (await methods['prompts.createTag'].handle({
      name: '作用域标签',
      group: null,
      color: null,
    })) as { id: string; name: string };

    const folders = (await methods['prompts.listFolders'].handle(undefined)) as Array<{
      id: string;
      name: string;
    }>;
    expect(folders.some((item) => item.id === folder.id && item.name === folder.name)).toBe(true);

    const tags = (await methods['prompts.listTags'].handle(undefined)) as Array<{
      id: string;
      name: string;
    }>;
    expect(tags.some((item) => item.id === tag.id && item.name === tag.name)).toBe(true);

    await methods['prompts.removeFolder'].handle({ id: folder.id });
    await methods['prompts.removeTag'].handle({ id: tag.id });

    const foldersAfterDelete = (await methods['prompts.listFolders'].handle(undefined)) as Array<{
      id: string;
    }>;
    expect(foldersAfterDelete.some((item) => item.id === folder.id)).toBe(false);

    const tagsAfterDelete = (await methods['prompts.listTags'].handle(undefined)) as Array<{
      id: string;
    }>;
    expect(tagsAfterDelete.some((item) => item.id === tag.id)).toBe(false);
  });
});
