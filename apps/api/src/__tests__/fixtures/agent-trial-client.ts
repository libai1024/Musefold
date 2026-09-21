import { randomUUID } from 'node:crypto';
import { expect as defaultExpect } from 'vitest';
import {
  designSchemeAgentSessionSchema,
  designSchemeTextModelOfferSchema,
  designSchemeDetailSchema,
  designSchemeRunInputSchema,
  generationReferenceImageSchema,
} from '@musefold/contracts';
import type { startAgentBrowserApp } from './agent-browser-app.js';

/** Actual cookie login, Agent authorization and run preparation; never grants trial via SQL. */
export function agentTrialClient(
  fixture: Awaited<ReturnType<typeof startAgentBrowserApp>>,
  email: string,
  expect = defaultExpect,
) {
  let cookie = '';
  const request = (path: string, body?: unknown) =>
    fixture.app.request(path, {
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3399', cookie },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
  const json = async (path: string, body?: unknown) => {
    const response = await request(path, body);
    expect(response.status, path).toBe(path.endsWith('/agent/executions') ? 202 : 200);
    return response.json();
  };
  async function authenticate(action: 'sign-up' | 'sign-in') {
    const response = await request(`/api/auth/${action}/new-api`, {
      email,
      password: 'correct-password',
    });
    expect(response.status).toBe(200);
    // Invalid old sessions can emit a deletion and a new value for the same cookie.
    // Match browser replacement semantics instead of sending both values back.
    const cookies = new Map<string, string>();
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator).trim();
      if (/;\s*Max-Age=0(?:;|$)/i.test(header)) cookies.delete(name);
      else cookies.set(name, pair.slice(separator + 1));
    }
    cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    expect(cookie.length).toBeGreaterThan(0);
  }
  const detail = async (schemeId: string) =>
    designSchemeDetailSchema.parse(await json(`/api/v1/design-schemes/${schemeId}`));
  async function prepareNewTrial(referenceBytes?: Uint8Array) {
    if (referenceBytes) fixture.requireImageInput();
    await authenticate('sign-up');
    const offer = designSchemeTextModelOfferSchema.parse(
      await json('/api/v1/design-schemes/agent/text-model'),
    );
    const executionId = randomUUID();
    await json('/api/v1/design-schemes/agent/executions', {
      operation: 'create',
      input: {
        executionId,
        brief: '黑白书展海报',
        sourceUris: [],
        sourceBindings: [],
        sourceAssetIds: [],
      },
      text: {
        binding: offer.binding,
        maxModelCalls: 1,
        maxOutputTokens: offer.maxOutputTokens,
        acceptUnknownCost: true,
      },
    });
    const readSession = async () =>
      designSchemeAgentSessionSchema.parse(
        await json(`/api/v1/design-schemes/agent/executions/${executionId}`),
      );
    await expect
      .poll(async () => (await readSession()).status, { timeout: 20000 })
      .toBe('completed');
    const result = (await readSession()).result;
    if (!result) throw new Error('Missing actual Agent result');
    const draft = await detail(result.scheme.id);
    expect(draft.summary.hasSuccessfulTrial).toBe(false);
    const referenceAssetIds: string[] = [];
    if (referenceBytes) {
      const form = new FormData();
      form.set(
        'file',
        new File([new Uint8Array(referenceBytes)], 'reference.png', { type: 'image/png' }),
      );
      const response = await fixture.app.request('/api/v1/reference-images', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:3399', cookie },
        body: form,
      });
      expect(response.status).toBe(201);
      referenceAssetIds.push(generationReferenceImageSchema.parse(await response.json()).id);
    }
    const prepared = designSchemeRunInputSchema.parse(
      await json('/api/v1/design-schemes/prepare-run', {
        executionId: randomUUID(),
        schemeId: draft.summary.id,
        revisionId: draft.document.revisionId,
        mode: 'trial',
        brief: '秋季书展',
        inputValues: { topic: '秋季书展' },
        executionSettings: {
          providerId: 'cloud-default',
          size: 'auto',
          quality: 'auto',
          outputCount: 1,
          referenceAssetIds,
          promptReferenceSelections: [],
        },
      }),
    );
    expect((await fixture.snapshot()).imageCalls).toHaveLength(0);
    return { draft, prepared };
  }
  return { request, json, authenticate, detail, prepareNewTrial };
}
