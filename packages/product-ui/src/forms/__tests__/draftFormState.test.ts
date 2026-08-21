import { describe, expect, it } from 'vitest';
import {
  allTouched,
  isDraftDirty,
  isDraftValid,
  visibleError,
} from '../draftFormState';

type Field = 'title' | 'content';

const errors = { title: '标题必填', content: '正文必填' };

describe('draft form state', () => {
  it('未碰过的字段不吐错误，碰过才吐', () => {
    expect(visibleError<Field>(errors, {}, 'title')).toBeUndefined();
    expect(visibleError<Field>(errors, { title: true }, 'title')).toBe('标题必填');
    expect(visibleError<Field>(errors, { title: true }, 'content')).toBeUndefined();
  });

  it('字段没有错误时，碰过也不吐', () => {
    expect(visibleError<Field>({}, { title: true }, 'title')).toBeUndefined();
  });

  it('allTouched 一次点亮提交路径涉及的全部字段', () => {
    expect(allTouched<Field>(['title', 'content'])).toEqual({
      title: true,
      content: true,
    });
    expect(allTouched<Field>([])).toEqual({});
  });

  it('valid 以错误表是否为空为准', () => {
    expect(isDraftValid({})).toBe(true);
    expect(isDraftValid({ title: '标题必填' })).toBe(false);
  });

  it('dirty 逐值比较，字段顺序不影响结果，改回原值即不脏', () => {
    const initial = { title: 'a', content: 'b' };
    expect(isDraftDirty({ title: 'a', content: 'b' }, initial)).toBe(false);
    expect(isDraftDirty({ title: 'a', content: 'c' }, initial)).toBe(true);
  });
});
