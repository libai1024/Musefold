import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  completeStructured,
  extractJsonCandidate,
  OpenAiCompatibleTextAdapter,
  type TextCompletionRequest,
} from '../text-adapter';

const schema = z.object({ name: z.string(), count: z.number().int() });

function fakeAdapter(responses: string[]): { adapter: OpenAiCompatibleTextAdapter; requests: TextCompletionRequest[] } {
  const requests: TextCompletionRequest[] = [];
  const adapter = {
    modelId: 'test-model',
    connectionName: 'test',
    complete: async (request: TextCompletionRequest) => {
      requests.push(request);
      const text = responses.shift();
      if (text === undefined) throw new Error('no more responses');
      return { text, model: 'test-model' };
    },
  } as unknown as OpenAiCompatibleTextAdapter;
  return { adapter, requests };
}

describe('extractJsonCandidate', () => {
  it('剥离 Markdown 代码块', () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('从说明文字中提取平衡的 JSON 对象', () => {
    expect(extractJsonCandidate('结果如下：{"a":{"b":"}"}} 完毕')).toBe('{"a":{"b":"}"}}');
  });
});

describe('completeStructured', () => {
  it('一次通过时不重试', async () => {
    const { adapter, requests } = fakeAdapter(['{"name":"极简海报","count":2}']);
    const result = await completeStructured({ adapter, schema, system: 's', user: 'u', label: '测试' });
    expect(result.value).toEqual({ name: '极简海报', count: 2 });
    expect(result.retried).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('校验失败时带 issues 重试一次并成功', async () => {
    const { adapter, requests } = fakeAdapter([
      '{"name":"x"}',
      '{"name":"x","count":1}',
    ]);
    const result = await completeStructured({ adapter, schema, system: 's', user: 'u', label: '测试' });
    expect(result.retried).toBe(true);
    expect(result.value.count).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.user).toContain('未通过结构校验');
    expect(requests[1]?.user).toContain('count');
  });

  it('两次都失败时抛出可解释错误', async () => {
    const { adapter } = fakeAdapter(['not json', 'still not json']);
    await expect(
      completeStructured({ adapter, schema, system: 's', user: 'u', label: '方案编译' }),
    ).rejects.toThrow(/方案编译.*两次都未通过校验/);
  });
});
