// shared/__tests__/export-format.test.ts
// 信封格式契约单测（TASK-SET-01/02）
//
// 这里只测纯逻辑。真正的库级往返（导出→导入→查得回来）在 tests/e2e：
// better-sqlite3 是按 Electron ABI 编译的，vitest 的 Node 里 dlopen 直接失败。

import { describe, it, expect } from 'vitest';
import {
  validateEnvelope,
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  FORBIDDEN_EXPORT_KEYS,
  PROVIDER_EXPORT_FIELDS,
} from '../export-format';

/** 一个刚好合法的最小信封 */
function minimal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    dbUserVersion: 1,
    appVersion: '0.1.0',
    exportedAt: 1_700_000_000_000,
    mode: 'db-only',
    counts: {},
    data: {},
    ...over,
  };
}

describe('validateEnvelope', () => {
  it('接受合法信封', () => {
    expect(validateEnvelope(minimal())).toEqual({ ok: true });
  });

  it('data 为空对象也合法 —— 空库导出必须能导回去', () => {
    expect(validateEnvelope(minimal({ data: {} })).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字符串', 'not an object'],
    ['数字', 42],
    // 数组 typeof 也是 'object'，单靠 typeof 判断会放过它
    ['数组', [{ format: EXPORT_FORMAT }]],
  ])('拒绝非对象输入：%s', (_label, input) => {
    const r = validateEnvelope(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('对象');
  });

  it('format 不匹配时拒绝并说明是选错了文件', () => {
    const r = validateEnvelope(minimal({ format: 'some-other-app' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Musefold');
  });

  it('缺 format 时拒绝（而不是当成默认值放过）', () => {
    const env = minimal();
    delete env.format;
    expect(validateEnvelope(env).ok).toBe(false);
  });

  it('schemaVersion 高于本端时拒绝并提示升级（doc 16 场景 3）', () => {
    const r = validateEnvelope(minimal({ schemaVersion: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('99');
      expect(r.error).toContain('升级');
    }
  });

  it('schemaVersion 低于本端时拒绝并要求先完成版本升级', () => {
    const result = validateEnvelope(minimal({ schemaVersion: EXPORT_SCHEMA_VERSION - 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('对应版本');
  });

  it.each([
    ['缺失', undefined],
    ['字符串', '1'],
    ['NaN', Number.NaN],
  ])('schemaVersion 非有限数字时拒绝：%s', (_label, v) => {
    const r = validateEnvelope(minimal({ schemaVersion: v }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('schemaVersion');
  });

  it.each([
    ['缺失', undefined],
    ['null', null],
    ['数组', []],
    ['字符串', 'x'],
  ])('data 段非对象时拒绝：%s', (_label, v) => {
    const r = validateEnvelope(minimal({ data: v }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('data');
  });
});

describe('data 分段形状', () => {
  // 回归：这一道闸门缺失时，非数组分段会**静默丢数据**而不是报错 ——
  // 导入端取分段用 `Array.isArray(v) ? … : []`，于是对象形状的 prompts
  // 被当成"零条"，导入报告一片 0、无任何警告。看起来像成功的失败最难排查。
  it.each([
    ['对象（手改过的文件 / 稀疏数组被序列化成对象）', { '0': { id: 'p1' } }],
    ['字符串', 'nope'],
    ['数字', 7],
    ['布尔', true],
  ])('拒绝 data.prompts 是%s', (_label, bad) => {
    const r = validateEnvelope(minimal({ data: { prompts: bad } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('data.prompts');
  });

  it('每个已知分段都受检，不只是 prompts', () => {
    for (const k of [
      'prompts',
      'folders',
      'tags',
      'smartSets',
      'providers',
      'history',
    ]) {
      const r = validateEnvelope(minimal({ data: { [k]: { bad: 1 } } }));
      expect(r.ok, `data.${k} 是对象时应被拒绝`).toBe(false);
      if (!r.ok) expect(r.error).toContain(`data.${k}`);
    }
  });

  it('分段缺失（undefined）不算错 —— 空库导出与 history 可选都靠这个', () => {
    expect(validateEnvelope(minimal({ data: { prompts: undefined } })).ok).toBe(true);
    expect(validateEnvelope(minimal({ data: { prompts: [] } })).ok).toBe(true);
  });

  it('未知分段一律放过 —— 旧版读新文件不该判成损坏', () => {
    // 向前不兼容已由 schemaVersion 硬拒；这里只保证"多了个不认识的键"
    // 不会让旧版把一个其实能读的文件拒之门外。
    expect(validateEnvelope(minimal({ data: { futureSection: { any: 'shape' } } })).ok).toBe(true);
  });
});

describe('providers 字段白名单', () => {
  it('白名单里没有任何密钥相关字段', () => {
    for (const f of PROVIDER_EXPORT_FIELDS) {
      expect(FORBIDDEN_EXPORT_KEYS).not.toContain(f);
    }
  });

  it('禁列覆盖 apiKey / hasKey / keySuffix 的驼峰与下划线两种写法', () => {
    // 断言的是**禁列本身**的完备性：真正的导出产物在 E2E 里 grep。
    // 少写一种变体，等于给未来的泄漏留了道门。
    for (const k of ['apiKey', 'api_key', 'hasKey', 'has_key', 'keySuffix', 'key_suffix']) {
      expect(FORBIDDEN_EXPORT_KEYS).toContain(k);
    }
  });
});
