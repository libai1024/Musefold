import { describe, expect, it } from 'vitest';
import {
  exactGithubSkillUrl,
  filterCommandHints,
  matchDesignPlanCommand,
  parseDesignPlanBody,
  parseDesignPlanIntent,
  shouldShowCommandHints,
} from '../composerIntent';

describe('Composer intent routing', () => {
  it('treats a plain GitHub Skill URL as a direct runtime attachment', () => {
    const url = 'https://github.com/LiamGvchi/gc-minimal-zine-poster';
    expect(exactGithubSkillUrl(url)).toBe(url);
    expect(parseDesignPlanIntent(url)).toBeNull();
  });

  it('only enters design-plan mode for the explicit slash command', () => {
    expect(parseDesignPlanIntent('/ create design plan 做一套留白海报方案')).toEqual({
      prompt: '做一套留白海报方案',
      githubUrls: [],
    });
    expect(parseDesignPlanIntent('create design plan 做一套方案')).toBeNull();
  });

  it('extracts a Skill URL as the source of an explicit design plan', () => {
    expect(parseDesignPlanIntent(
      '/create design plan https://github.com/LiamGvchi/gc-minimal-zine-poster 保留大面积留白',
    )).toEqual({
      prompt: '保留大面积留白',
      githubUrl: 'https://github.com/LiamGvchi/gc-minimal-zine-poster',
      githubUrls: ['https://github.com/LiamGvchi/gc-minimal-zine-poster'],
    });
  });

  it('accepts the Chinese command alias', () => {
    expect(parseDesignPlanIntent('/创建设计方案 做一套胶片颗粒的夜景方案')).toEqual({
      prompt: '做一套胶片颗粒的夜景方案',
      githubUrls: [],
    });
    expect(parseDesignPlanIntent('/ 创建设计方案 https://github.com/a/b 保留版式')).toEqual({
      prompt: '保留版式',
      githubUrl: 'https://github.com/a/b',
      githubUrls: ['https://github.com/a/b'],
    });
  });

  it('shows command hints only for incomplete slash input', () => {
    expect(shouldShowCommandHints('/')).toBe(true);
    expect(shouldShowCommandHints('/crea')).toBe(true);
    expect(shouldShowCommandHints('/create design plan 想法')).toBe(false);
    expect(shouldShowCommandHints('/创建设计方案 想法')).toBe(false);
    expect(shouldShowCommandHints('普通提示词')).toBe(false);
  });

  it('filters command hints by the typed prefix', () => {
    expect(filterCommandHints('/').map((hint) => hint.command)).toEqual([
      '/create design plan',
      '/创建设计方案',
    ]);
    expect(filterCommandHints('/cre').map((hint) => hint.command)).toEqual(['/create design plan']);
    expect(filterCommandHints('/CREATE DES').map((hint) => hint.command)).toEqual(['/create design plan']);
    expect(filterCommandHints('/创建').map((hint) => hint.command)).toEqual(['/创建设计方案']);
    expect(filterCommandHints('/xyz')).toEqual([]);
    expect(filterCommandHints('/创建设计方案')).toEqual([]);
  });

  it('converts a complete command into chip + body text (Codex-style)', () => {
    expect(matchDesignPlanCommand('/create design plan 做一套方案')).toEqual({ rest: '做一套方案' });
    expect(matchDesignPlanCommand('/创建设计方案')).toEqual({ rest: '' });
    expect(matchDesignPlanCommand('/create design pla')).toBeNull();
    expect(matchDesignPlanCommand('普通提示词 /创建设计方案')).toBeNull();
  });

  it('parses the body while a command chip is mounted', () => {
    expect(parseDesignPlanBody('保留版式 https://github.com/a/b')).toEqual({
      prompt: '保留版式',
      githubUrl: 'https://github.com/a/b',
      githubUrls: ['https://github.com/a/b'],
    });
    expect(parseDesignPlanBody('  ')).toEqual({ prompt: '', githubUrls: [] });
  });

  it('collects multiple Skill URLs for a merged scheme (P3)', () => {
    const parsed = parseDesignPlanBody(
      '合并这两个 https://github.com/a/b 和 https://github.com/c/d 成一个海报方案',
    );
    expect(parsed.githubUrls).toEqual(['https://github.com/a/b', 'https://github.com/c/d']);
    expect(parsed.githubUrl).toBe('https://github.com/a/b');
    expect(parsed.prompt).toBe('合并这两个 和 成一个海报方案');
    // 重复地址去重
    expect(parseDesignPlanBody('https://github.com/a/b https://github.com/a/b').githubUrls).toEqual([
      'https://github.com/a/b',
    ]);
  });
});
