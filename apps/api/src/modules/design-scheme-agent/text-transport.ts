import { designSchemeTextUsageSchema, type DesignSchemeRolePrompt } from '@musefold/contracts';
import { openJsonFromString } from '@musefold/server-crypto';
import type { AccountExecutionAuthority } from '@musefold/db';
import type { ApiEnv } from '../../env.js';

export class TextTransportError extends Error {
  constructor() {
    super('Text model response unavailable');
  }
}

/** Fixed trusted account endpoint, bounded response/deadline, no redirects or implicit retry. */
export class DesignSchemeTextTransport {
  constructor(
    private readonly env: ApiEnv,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async assertModelAvailable(
    credential: AccountExecutionAuthority['encryptedCredential'],
    model: string,
  ) {
    const payload = await this.request('/v1/models', this.key(credential), undefined, 10_000);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('data' in payload) ||
      !Array.isArray(payload.data) ||
      !payload.data.some(
        (item) => item && typeof item === 'object' && 'id' in item && item.id === model,
      )
    )
      throw new TextTransportError();
  }

  async complete(
    prompt: DesignSchemeRolePrompt,
    model: string,
    maxOutputTokens: number,
    claim: () => Promise<AccountExecutionAuthority['encryptedCredential'] | null>,
  ) {
    // Serialize the frozen request before acquiring the only send capability.
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
      stream: false,
      response_format: { type: 'json_object' },
      max_tokens: maxOutputTokens,
    });
    const credential = await claim();
    if (!credential) return null;
    const payload = await this.request('/v1/chat/completions', this.key(credential), body, 120_000);
    if (!payload || typeof payload !== 'object') throw new TextTransportError();
    const candidate = payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = candidate.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new TextTransportError();
    const count = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return {
      content,
      usage: designSchemeTextUsageSchema.parse({
        inputTokens: count(candidate.usage?.prompt_tokens),
        outputTokens: count(candidate.usage?.completion_tokens),
      }),
    };
  }

  private key(credential: AccountExecutionAuthority['encryptedCredential']) {
    try {
      const value = openJsonFromString<{ apiKey?: unknown }>(
        credential.ciphertext,
        this.env.CREDENTIAL_ENCRYPTION_KEY,
      );
      if (typeof value.apiKey !== 'string' || !value.apiKey || value.apiKey.length > 8192)
        throw new TextTransportError();
      return value.apiKey;
    } catch {
      throw new TextTransportError();
    }
  }

  private async request(
    path: string,
    key: string,
    body: string | undefined,
    timeout: number,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(
        `${this.env.NEW_API_BASE_URL.replace(/\/+$/, '')}${path}`,
        {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body,
          redirect: 'manual',
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) throw new TextTransportError();
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 512 * 1024) throw new TextTransportError();
          parts.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch {
      throw new TextTransportError();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
