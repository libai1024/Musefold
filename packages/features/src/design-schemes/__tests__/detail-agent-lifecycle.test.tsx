import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlatformProvider, WEB_CAPABILITIES, type MusefoldGateway } from '@musefold/platform';
import { designSchemeDetailSchema } from '@musefold/contracts';
import { expect, it, vi } from 'vitest';
import { SchemeDetailView } from '../SchemeDetailView';

const state = vi.hoisted(() => ({ pending: false, error: false }));
vi.mock('../hooks', async (original) => ({
  ...(await original<typeof import('../hooks')>()),
  useSchemeDetail: () => ({
    data: state.pending || state.error ? undefined : detail,
    isPending: state.pending,
    isError: state.error,
    refetch: vi.fn(),
  }),
}));
// Isolate observer lifetime. Real Agent state/call semantics are covered by agent-flow and E2E.
vi.mock('../SchemeAgentDialog', () => ({
  SchemeAgentDialog: () => {
    const [execution, setExecution] = useState('not-started');
    return (
      <button type="button" onClick={() => setExecution('original-completed')}>
        {execution}
      </button>
    );
  },
}));
const detail = designSchemeDetailSchema.parse({
  summary: {
    id: 'scheme',
    name: '海报',
    summary: '已有正式方案',
    status: 'formal',
    currentRevisionId: 'revision',
    coverAssetId: 'cover',
    hasSuccessfulTrial: true,
    sourcePresentation: 'skill',
    sourceLabel: 'example/design',
    fidelity: 'adapted',
    createdAt: 0,
    updatedAt: 0,
  },
  document: {
    schemaVersion: 1,
    schemeId: 'scheme',
    revisionId: 'revision',
    name: '海报',
    summary: '已有正式方案',
    fidelity: 'adapted',
    sources: [
      {
        id: 'source',
        kind: 'github-skill',
        role: 'normative',
        uri: 'https://github.com/example/design',
      },
    ],
    inputs: [],
    parameters: [],
    constraints: [],
    promptProgram: [
      {
        id: 'style',
        order: 0,
        kind: 'style-rule',
        template: '黑白海报',
        variables: [],
        sourceIds: [],
      },
    ],
    compilation: {
      compiledAt: 0,
      model: { model: 'fixture' },
      adopted: [],
      omitted: [],
      warnings: [],
      trace: [],
    },
  },
  assets: [],
  sourceSnapshots: [],
});
it('retains the original Agent observer through pending and failed working-revision reads', async () => {
  state.pending = false;
  state.error = false;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const gateway = { designSchemes: { agent: {} } } as unknown as MusefoldGateway;
  const view = () => (
    <QueryClientProvider client={client}>
      <PlatformProvider runtime={{ gateway, capabilities: WEB_CAPABILITIES }}>
        <SchemeDetailView schemeId="scheme" actions={{}} onBack={vi.fn()} onRemoved={vi.fn()} />
      </PlatformProvider>
    </QueryClientProvider>
  );
  const rendered = render(view());
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  await user.click(screen.getByTestId('runtime-scheme-menu'));
  await user.click(await screen.findByTestId('runtime-scheme-menu-check-update'));
  fireEvent.click(screen.getByText('not-started'));
  state.pending = true;
  rendered.rerender(view());
  expect(screen.getByTestId('runtime-scheme-detail-loading')).toBeTruthy();
  expect(screen.getByText('original-completed')).toBeTruthy();
  state.pending = false;
  state.error = true;
  rendered.rerender(view());
  expect(screen.getByTestId('runtime-scheme-detail-error')).toBeTruthy();
  expect(screen.getByText('original-completed')).toBeTruthy();
  state.error = false;
  rendered.rerender(view());
  expect(screen.getByTestId('runtime-scheme-detail')).toBeTruthy();
  expect(screen.getByText('original-completed')).toBeTruthy();
  rendered.unmount();
  client.clear();
});
