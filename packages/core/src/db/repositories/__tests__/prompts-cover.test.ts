/**
 * 提示词封面语义（coverImagePath）：
 * 默认取「相关作品」最新一张成功图 —— 直接以本提示词生成的 + 引用过它的，
 * 没有作品时兜底 preview_image_path，两者都没有为 null。
 */
import { rmSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureTestCoreRuntime } from '../../../testing';
import { getDb, initDb } from '../../index';
import { promptsRepo } from '../prompts';

const electronPaths = { root: `/tmp/musefold-prompt-cover-${process.pid}` };

configureTestCoreRuntime(electronPaths.root);

function insertHistory(input: {
  id: string;
  promptId?: string | null;
  status?: string;
  imagePath?: string | null;
  createdAt: number;
  referencePromptId?: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO history (id, prompt_id, provider_id, model, prompt_text, status, image_path, created_at)
     VALUES (?, ?, 'prov', 'model', 'text', ?, ?, ?)`,
  ).run(input.id, input.promptId ?? null, input.status ?? 'success', input.imagePath ?? null, input.createdAt);
  if (input.referencePromptId) {
    db.prepare(
      `INSERT INTO history_prompt_references (history_id, prompt_id, prompt_title, excerpt, scope, sort_order)
       VALUES (?, ?, 't', 'e', 'full', 0)`,
    ).run(input.id, input.referencePromptId);
  }
}

beforeAll(() => {
  initDb();
});

afterAll(() => {
  rmSync(electronPaths.root, { recursive: true, force: true });
});

describe('promptsRepo coverImagePath', () => {
  it('默认使用相关作品最新一张成功图；失败/无图记录不参与', () => {
    const prompt = promptsRepo.create({ title: '海报', content: 'poster', previewImagePath: '/tmp/preview.png' });

    // 无作品 → 兜底 preview
    expect(promptsRepo.get(prompt.id)?.coverImagePath).toBe('/tmp/preview.png');

    insertHistory({ id: 'h1', promptId: prompt.id, imagePath: '/works/old.png', createdAt: 1000 });
    insertHistory({ id: 'h2', promptId: prompt.id, imagePath: '/works/new.png', createdAt: 2000 });
    // 更晚但失败 / 无图：不作为封面
    insertHistory({ id: 'h3', promptId: prompt.id, status: 'failed', imagePath: null, createdAt: 3000 });
    insertHistory({ id: 'h4', promptId: prompt.id, status: 'success', imagePath: null, createdAt: 4000 });

    const fresh = promptsRepo.get(prompt.id);
    expect(fresh?.coverImagePath).toBe('/works/new.png');
    // list 与 get 同口径
    expect(promptsRepo.list().find((item) => item.id === prompt.id)?.coverImagePath).toBe('/works/new.png');
  });

  it('引用过本提示词的作品同样计入，取全渠道最新', () => {
    const prompt = promptsRepo.create({ title: '插画', content: 'illust' });
    insertHistory({ id: 'h10', promptId: prompt.id, imagePath: '/works/direct.png', createdAt: 1000 });
    // 引用渠道（history_prompt_references）更新 → 应作为封面
    insertHistory({ id: 'h11', promptId: null, imagePath: '/works/referenced.png', createdAt: 2000, referencePromptId: prompt.id });

    expect(promptsRepo.get(prompt.id)?.coverImagePath).toBe('/works/referenced.png');
  });

  it('没有作品也没有 preview 时为 null', () => {
    const prompt = promptsRepo.create({ title: '空', content: 'empty' });
    expect(promptsRepo.get(prompt.id)?.coverImagePath).toBeNull();
  });
});
