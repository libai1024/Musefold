import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sealJsonToString } from '@musefold/server-crypto';
import { loadEnv } from '../../../env.js';
import { textModelFixture } from '../../../__tests__/fixtures/text-model.js';
import { DesignSchemeTextTransport } from '../text-transport.js';
let model: Awaited<ReturnType<typeof textModelFixture>>;
const key = 'synthetic-text-encryption';
const credential = {
  ciphertext: sealJsonToString({ apiKey: 'synthetic-text-key' }, key),
  keyVersion: 'v1',
};
const prompt = { system: 'Compiler', user: 'Brief' };
const transport = () =>
  new DesignSchemeTextTransport(
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      BETTER_AUTH_SECRET: 'fixture-auth-long-secret',
      CREDENTIAL_ENCRYPTION_KEY: key,
      NEW_API_BASE_URL: model.endpoint,
      SCHEME_AGENT_TEXT_MODEL: 'fixture-text',
    }),
  );
beforeEach(async () => {
  model = await textModelFixture();
});
afterEach(async () => {
  await model.close();
});
describe('text transport on a real loopback HTTP socket', () => {
  it('discovers the credential-scoped model and sends once only after the claim', async () => {
    await transport().assertModelAvailable(credential, 'fixture-text');
    expect(await transport().complete(prompt, 'fixture-text', 8192, async () => null)).toBeNull();
    expect(model.posts).toHaveLength(0);
    const result = await transport().complete(prompt, 'fixture-text', 8192, async () => credential);
    expect(result?.usage).toEqual({ inputTokens: 30, outputTokens: 60 });
    expect(model.gets).toHaveLength(1);
    expect(model.posts).toHaveLength(1);
    expect(model.posts[0]).toMatchObject({
      model: 'fixture-text',
      max_tokens: 8192,
      stream: false,
    });
  });
  it.each(['drop', 'redirect', '503', 'oversize'])(
    'never follows/retries %s or exposes an upstream body',
    async (mode) => {
      model.state.mode = mode;
      await expect(
        transport().complete(prompt, 'fixture-text', 8192, async () => credential),
      ).rejects.toThrow('Text model response unavailable');
      expect(model.posts).toHaveLength(1);
    },
  );
  it('disables text by default and rejects unlisted or invalid models', async () => {
    expect(
      loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://unused',
        BETTER_AUTH_SECRET: 'fixture-auth-long-secret',
        NEW_API_BASE_URL: model.endpoint,
        CREDENTIAL_ENCRYPTION_KEY: key,
      }).SCHEME_AGENT_TEXT_MODEL,
    ).toBeUndefined();
    model.state.mode = 'no-model';
    await expect(transport().assertModelAvailable(credential, 'fixture-text')).rejects.toThrow();
    expect(model.posts).toHaveLength(0);
  });
});

it('aborts a held response body at the 120-second deadline without a second claim', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const fetcher = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                'abort',
                () => controller.error(new Error('fixture body aborted')),
                { once: true },
              );
            },
          }),
        ),
    );
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused',
      BETTER_AUTH_SECRET: 'fixture-auth-long-secret',
      NEW_API_BASE_URL: model.endpoint,
      CREDENTIAL_ENCRYPTION_KEY: key,
    });
    const claim = vi.fn(async () => credential);
    const result = new DesignSchemeTextTransport(env, fetcher).complete(
      prompt,
      'fixture-text',
      8192,
      claim,
    );
    const rejected = expect(result).rejects.toThrow('Text model response unavailable');
    await vi.advanceTimersByTimeAsync(120_001);
    await rejected;
    expect(claim).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
