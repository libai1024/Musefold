import {
  designSchemeTextBindingSchema,
  designSchemeTextModelOfferSchema,
  type DesignSchemeTextAuthorization,
  type DesignSchemeTextBinding,
} from '@musefold/contracts';
import {
  lockAccountExecutionIdentity,
  executionDigest,
  type MusefoldDatabase,
  type MusefoldTransaction,
} from '@musefold/db';
import type { ApiEnv } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { DesignSchemeTextTransport } from './text-transport.js';

/** Text policy is separate from image authority; only identity checks/lock order are shared. */
export class DesignSchemeTextAuthority {
  readonly transport: DesignSchemeTextTransport;
  constructor(
    private readonly db: MusefoldDatabase,
    private readonly env: ApiEnv,
    transport?: DesignSchemeTextTransport,
  ) {
    this.transport = transport ?? new DesignSchemeTextTransport(env);
  }
  async lock(
    tx: MusefoldTransaction,
    userId: string,
    sessionId: string,
    expected?: DesignSchemeTextBinding,
    revision?: number,
  ) {
    if (!this.env.SCHEME_AGENT_TEXT_MODEL) throw unavailable();
    const authority = await lockAccountExecutionIdentity(tx, {
      principalId: userId,
      authSessionId: sessionId,
      apiIssuer: this.env.PUBLIC_BASE_URL,
      upstreamIssuer: this.env.NEW_API_BASE_URL,
      expectedAuthRevision: revision,
    });
    const binding = designSchemeTextBindingSchema.parse({
      ...authority.identity,
      providerId: 'cloud-agent',
      model: this.env.SCHEME_AGENT_TEXT_MODEL,
      policyVersion: 'agent-text-v1',
      capabilities: { image: false, text: true },
    });
    if (expected && executionDigest(binding) !== executionDigest(expected)) throw unavailable();
    return { ...authority, binding };
  }
  async offer(userId: string, sessionId: string) {
    const authority = await this.verified(userId, sessionId);
    return designSchemeTextModelOfferSchema.parse({
      binding: authority.binding,
      maxModelCalls: 17,
      maxOutputTokens: 8192,
      cost: 'unknown',
    });
  }
  async prepare(
    userId: string,
    sessionId: string,
    text: DesignSchemeTextAuthorization,
    sourceCount: number,
  ) {
    if (text.maxModelCalls !== sourceCount + 1)
      throw new AppError('VALIDATION_FAILED', '文本调用上限须与本次来源和编译步骤一致', 400);
    const authority = await this.verified(userId, sessionId, text.binding);
    return { authSessionId: sessionId, authRevision: authority.authRevision, authorization: text };
  }
  private async verified(userId: string, sessionId: string, expected?: DesignSchemeTextBinding) {
    try {
      const first = await this.db.transaction((tx) => this.lock(tx, userId, sessionId, expected));
      // Read-only token-scoped model discovery, after trusted identity verification; no paid call.
      await this.transport.assertModelAvailable(first.encryptedCredential, first.binding.model);
      return await this.db.transaction((tx) =>
        this.lock(tx, userId, sessionId, first.binding, first.authRevision),
      );
    } catch {
      throw unavailable();
    }
  }
}
export function unavailable() {
  return new AppError(
    'VALIDATION_FAILED',
    '当前文本模型或账号执行资格不可用，请重新核对',
    409,
    false,
    { reason: 'AGENT_TEXT_AUTHORIZATION_UNAVAILABLE' },
  );
}
