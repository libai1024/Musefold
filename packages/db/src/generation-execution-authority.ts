import { type ExecutionBinding, executionBindingSchema } from '@musefold/contracts';
import type { MusefoldTransaction } from './client.js';
import {
  lockAccountExecutionIdentity,
  ExecutionAuthorityError,
  type AccountExecutionAuthorityInput,
} from './account-execution-authority.js';
export {
  ExecutionAuthorityError,
  type ExecutionAuthorityFailure,
} from './account-execution-authority.js';

export type GenerationExecutionAuthorityInput = AccountExecutionAuthorityInput & {
  expectedBinding?: ExecutionBinding;
  /** Server-verified catalog choice at admission, or the immutable receipt model at dispatch.
   * Never derive this from the caller's expectedBinding (which is only an expectation).
   */
  authorizedModel?: ExecutionBinding['model'];
};
export type GenerationExecutionAuthority = {
  binding: ExecutionBinding;
  authRevision: number;
  encryptedCredential: Readonly<{ ciphertext: string; keyVersion: string }>;
};

/** Compare only stable execution identity; account verification timestamps are not identity. */
export function executionBindingsEqual(left: ExecutionBinding, right: ExecutionBinding): boolean {
  return (
    left.apiIssuer === right.apiIssuer &&
    left.principalId === right.principalId &&
    left.payer.issuer === right.payer.issuer &&
    left.payer.ownerId === right.payer.ownerId &&
    left.credential.ref === right.credential.ref &&
    left.credential.version === right.credential.version &&
    left.providerId === right.providerId &&
    left.model === right.model &&
    left.capabilities.image === right.capabilities.image &&
    left.capabilities.text === right.capabilities.text
  );
}

/** Sharing identity locks never grants text capability or validates a client model choice. */
export async function lockGenerationExecutionAuthority(
  tx: MusefoldTransaction,
  input: GenerationExecutionAuthorityInput,
): Promise<GenerationExecutionAuthority> {
  const authority = await lockAccountExecutionIdentity(tx, input);
  const binding = executionBindingSchema.parse({
    ...authority.identity,
    providerId: 'cloud-default',
    model: input.authorizedModel ?? 'musefold-image-pro',
    capabilities: { image: true, text: false },
  });
  if (input.expectedBinding && !executionBindingsEqual(binding, input.expectedBinding)) {
    throw new ExecutionAuthorityError('binding_changed');
  }
  return {
    binding,
    authRevision: authority.authRevision,
    encryptedCredential: authority.encryptedCredential,
  };
}
