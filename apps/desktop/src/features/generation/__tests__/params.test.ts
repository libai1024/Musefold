// src/features/generation/__tests__/params.test.ts
// 精修参数 → 生图请求的映射（docs/product/12 §1.3 两类 Provider 的尺寸语义差异）

import { describe, it, expect } from 'vitest';
import { buildImageRequest, resolveRatio, DEFAULT_REFINE_PARAMS, type RefineParams } from '../../../lib/generation-params';

const base: RefineParams = { ...DEFAULT_REFINE_PARAMS };

const build = (over: Partial<Parameters<typeof buildImageRequest>[0]> = {}) =>
  buildImageRequest({
    jobId: 'job-1',
    providerId: 'prov-1',
    prompt: 'a cat',
    params: base,
    ...over,
  });

describe('resolveRatio', () => {
  it('按 id 命中', () => {
    expect(resolveRatio('16:9').size).toBe('1536x1024');
    expect(resolveRatio('2:3').size).toBe('1024x1536');
    expect(resolveRatio('4:3')).toMatchObject({ size: '1536x1024', ratio: '4:3' });
    expect(resolveRatio('4:5')).toMatchObject({ size: '1024x1536', ratio: '4:5' });
    expect(resolveRatio('5:4')).toMatchObject({ size: '1536x1024', ratio: '5:4' });
    expect(resolveRatio('21:9')).toMatchObject({ size: '1536x1024', ratio: '21:9' });
  });

  it('未知 id 回落方图而不抛错', () => {
    // 面板里的 ratioId 可能来自旧持久化数据，回落比崩掉好
    const r = resolveRatio('42:1');
    expect(r.id).toBe('1:1');
    expect(r.size).toBe('1024x1024');
  });

  it('auto 档保留 size=auto，比例给 1:1', () => {
    expect(resolveRatio('auto')).toMatchObject({ size: 'auto', ratio: '1:1' });
  });
});

describe('buildImageRequest', () => {
  it('同时给出像素档与比例串，请求与历史快照各取所需', () => {
    const req = build({ params: { ...base, ratioId: '16:9' } });
    expect(req.size).toBe('1536x1024'); // OpenAI 兼容站
    expect(req.aspectRatio).toBe('16:9'); // 历史快照保留比例语义
  });

  it('n 恒为 1：张数靠调用方循环，保证逐张计费/写史/可单独重试', () => {
    expect(build({ params: { ...base, n: 4 } }).n).toBe(1);
  });

  it('透传 jobId —— 它同时是取消句柄与历史 id', () => {
    expect(build({ jobId: 'job-xyz' }).jobId).toBe('job-xyz');
  });

  it('空白负面提示词归一成 undefined，不发空串给上游', () => {
    expect(build({ negative: '   ' }).negative).toBeUndefined();
    expect(build({ negative: '' }).negative).toBeUndefined();
    expect(build({ negative: '  blurry  ' }).negative).toBe('blurry');
  });

  it('来源为库条目时只填 promptId', () => {
    const req = build({ source: { kind: 'prompt', id: 'p1', label: '电影感人像' } });
    expect(req.promptId).toBe('p1');
  });

  it('无来源 / 来源无 id 时不建立提示词关联', () => {
    expect(build({ source: null }).promptId).toBeUndefined();
    const anon = build({ source: { kind: 'prompt', label: '临时' } });
    expect(anon.promptId).toBeUndefined();
  });

  it('质量与可选项按面板值透传', () => {
    const req = build({
      params: { ...base, quality: 'high', background: 'transparent', moderation: 'low' },
    });
    expect(req.quality).toBe('high');
    expect(req.background).toBe('transparent');
    expect(req.moderation).toBe('low');
  });

  it('透传经过主进程托管的参考图片', () => {
    const referenceImages = [{
      source: 'upload' as const,
      path: '/tmp/previews/uploads/reference.png',
      name: 'reference.png',
      mimeType: 'image/png' as const,
      sizeBytes: 512,
    }];
    expect(build({ referenceImages }).referenceImages).toEqual(referenceImages);
  });

  it('把 Skill Agent 轨迹作为工作台回合快照透传', () => {
    const skillRuntime = {
      label: 'Poster Skill',
      repositoryUrl: 'https://github.com/example/poster-skill',
      executionMode: 'agent' as const,
      trace: [{ id: 'agent', kind: 'tool' as const, title: '执行 Skill', status: 'success' as const }],
    };
    expect(build({ skillRuntime }).skillRuntime).toEqual(skillRuntime);
  });

  it('默认参数是高清方图单张', () => {
    expect(DEFAULT_REFINE_PARAMS).toEqual({ ratioId: '1:1', quality: 'medium', n: 1, background: 'auto' });
  });
});
