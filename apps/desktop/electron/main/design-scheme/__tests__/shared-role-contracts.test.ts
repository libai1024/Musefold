import { describe, expect, it } from 'vitest';
import { analystReportSchema, compilerOutputSchema } from '@musefold/contracts/design-scheme-model';
import * as legacy from '@musefold/desktop-contracts/design-scheme/agents';
import { runRepositoryAnalyst } from '../roles/analyst';
import { runSchemeCompiler } from '../roles/compiler';
import { runSchemeReviser } from '../roles/reviser';
import type { OpenAiCompatibleTextAdapter, TextCompletionRequest } from '../text-adapter';

function adapterFor(responses: string[]) {
  const requests: TextCompletionRequest[] = [];
  const adapter = {
    complete: async (request: TextCompletionRequest) => {
      requests.push(request);
      const text = responses.shift();
      if (text === undefined) throw new Error('Unexpected extra model call');
      return { text, model: 'fixture-model' };
    },
  } as unknown as OpenAiCompatibleTextAdapter;
  return { adapter, requests };
}

const draft = {
  name: '海报',
  summary: '极简海报',
  fidelity: 'adapted',
  inputs: [{ label: '主题', kind: 'text', variable: 'topic', required: true }],
  constraints: [],
  promptProgram: [{ kind: 'input-template', template: '{{topic}}' }],
  creationSummary: '请先试运行。',
};

describe('desktop shared Agent role integration', () => {
  it('uses the same schema instance through old and new import paths', () => {
    expect(legacy.analystReportSchema).toBe(analystReportSchema);
    expect(legacy.compilerOutputSchema).toBe(compilerOutputSchema);
  });

  it('returns a validated analysis and preserves cancellation signal and JSON mode', async () => {
    const { adapter, requests } = adapterFor([
      JSON.stringify({
        repoKind: 'prompt-repo',
        capabilitySummary: '风格',
        rules: [],
        variables: [],
        ownerId: 'ignored',
      }),
    ]);
    const controller = new AbortController();
    const result = await runRepositoryAnalyst(
      adapter,
      {
        brief: '',
        repositoryLabel: 'a/b',
        textFiles: [{ path: 'README.md', text: '纸张风格' }],
        imagePaths: [],
        license: null,
      },
      controller.signal,
    );
    expect(result.model).toBe('fixture-model');
    expect(result.retried).toBe(false);
    expect(result.report).not.toHaveProperty('ownerId');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal).toBe(controller.signal);
    expect(requests[0]?.jsonMode).toBe(true);
    expect(requests[0]?.system).toContain('Repository Analyst');
    expect(requests[0]?.user).toContain('纸张风格');
  });

  it('keeps the desktop validation-repair limit and strips model-supplied identifiers', async () => {
    const { adapter, requests } = adapterFor([
      '{"name":"缺少字段"}',
      JSON.stringify({ ...draft, schemeId: 'untrusted' }),
    ]);
    const signal = new AbortController().signal;
    const result = await runSchemeCompiler(adapter, { brief: '城市海报' }, signal);
    expect(result.output).toEqual(compilerOutputSchema.parse(draft));
    expect(result.retried).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.user).toContain('未通过结构校验');
    expect(requests[1]?.signal).toBe(signal);
    expect(requests[0]?.system).toContain('Scheme Compiler');
    const failed = adapterFor(['{}', '{}']);
    await expect(runSchemeCompiler(failed.adapter, { brief: '城市海报' })).rejects.toThrow(
      /方案编译.*两次都未通过校验/,
    );
    expect(failed.requests).toHaveLength(2);
  });
});

describe('desktop shared reviser integration', () => {
  it('validates the revised output and forwards the original signal without persisting model IDs', async () => {
    const { adapter, requests } = adapterFor([
      JSON.stringify({ ...draft, revisionId: 'untrusted' }),
    ]);
    const signal = new AbortController().signal;
    const result = await runSchemeReviser(
      adapter,
      {
        instruction: '改成红色',
        document: {
          name: '海报',
          summary: '极简',
          fidelity: 'adapted',
          inputs: [{ id: 'topic', label: '主题', kind: 'text', required: true }],
          constraints: [],
          promptProgram: [
            {
              id: 'module-1',
              order: 0,
              kind: 'input-template',
              template: '{{topic}}',
              variables: ['topic'],
              sourceIds: [],
            },
          ],
        },
      },
      signal,
    );
    expect(result.output).toEqual(compilerOutputSchema.parse(draft));
    expect(result.model).toBe('fixture-model');
    expect(result.retried).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal).toBe(signal);
    expect(requests[0]?.system).toContain('Scheme Reviser');
    expect(requests[0]?.user).toContain('改成红色');
  });
});
