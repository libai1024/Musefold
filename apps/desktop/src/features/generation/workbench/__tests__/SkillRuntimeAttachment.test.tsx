import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const storageValues = new Map<string, string>();
const storage = {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, String(value)),
  removeItem: (key: string) => storageValues.delete(key),
  clear: () => storageValues.clear(),
  key: (index: number) => [...storageValues.keys()][index] ?? null,
  get length() { return storageValues.size; },
} as Storage;
vi.stubGlobal('localStorage', storage);

const runtimeState = vi.hoisted(() => ({
  status: 'idle' as const,
  sourceUrl: null,
  attachment: null,
  error: null,
  remove: async () => undefined,
}));

vi.mock('../skill-runtime-store', () => ({
  useSkillRuntimeStore: <T,>(selector: (state: typeof runtimeState) => T) => selector(runtimeState),
}));

let SkillRuntimeConversation: typeof import('../../../../components/SkillRuntimeConversation').SkillRuntimeConversation;
beforeAll(async () => {
  ({ SkillRuntimeConversation } = await import('../../../../components/SkillRuntimeConversation'));
});

const trace = [
  { id: 'one', kind: 'tool' as const, title: '读取 GitHub 仓库', status: 'success' as const },
  { id: 'two', kind: 'assistant' as const, title: 'Agent', status: 'running' as const, output: '正在整理画面规则' },
  { id: 'three', kind: 'tool' as const, title: '调用生图模型', status: 'success' as const },
];

describe('SkillRuntimeConversation stepper', () => {
  it('draws only the two adjacent connectors for a three-step trace', () => {
    const html = renderToStaticMarkup(<SkillRuntimeConversation trace={trace} />);
    // Three segments (start / through / end) form exactly two adjacent gaps.
    expect((html.match(/left-\[calc\(0\.4375rem-23\.5px\)\]/g) ?? [])).toHaveLength(3);
    expect(html).toContain('bottom-0 top-[0.9375rem]');
    expect(html).toContain('bottom-0 top-0');
    expect(html).toContain('top-0 h-[0.9375rem]');
    expect(html).toContain('data-trace-status="running"');
    expect(html).toContain('animate-spin');
    expect(html).toContain('data-trace-status="success"');
  });

  it('does not draw a floating connector for one trace item', () => {
    const html = renderToStaticMarkup(<SkillRuntimeConversation trace={[trace[0]]} />);
    expect(html).not.toContain('left-[calc(0.4375rem-23.5px)]');
  });
});
