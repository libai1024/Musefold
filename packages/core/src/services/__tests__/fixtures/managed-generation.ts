import { randomUUID } from 'node:crypto';
import type { GenerationExecutionReceipt } from '@musefold/contracts';
import {
  registerManagedGenerationSchema,
  type ManagedGenerationRecord,
} from '@musefold/desktop-contracts/managed-generation';

export function managedCommand() {
  return registerManagedGenerationSchema.parse({
    callerKey: 'fixture-stable-caller-key',
    caller: 'fixture',
    executionId: randomUUID(),
    binding: {
      apiIssuer: 'https://api.example.invalid',
      principalId: 'fixture-principal',
      payer: { issuer: 'https://payer.example.invalid', ownerId: 'fixture-owner' },
      credential: { ref: 'fixture-credential', version: 1 },
      providerId: 'cloud-default',
      model: 'musefold-image-pro',
      capabilities: { image: true, text: false },
    },
    authEpoch: '11111111-1111-4111-8111-111111111111',
    request: { prompt: 'synthetic image prompt', count: 4 },
    estimatedPoints: 4,
    now: Date.UTC(2026, 8, 8),
  });
}

export function managedContext(command = managedCommand()) {
  return {
    apiIssuer: command.binding.apiIssuer,
    principalId: command.binding.principalId,
    authEpoch: command.authEpoch,
  };
}

export function managedReceipt(
  record: ManagedGenerationRecord,
  patch: Partial<GenerationExecutionReceipt> = {},
): GenerationExecutionReceipt {
  return {
    id: 'fixture-receipt',
    principalId: record.binding.principalId,
    idempotencyKey: record.remoteKey,
    operation: 'ordinary_create',
    originalRunId: 'fixture-remote-run',
    sourceRunId: null,
    bindingState: 'bound',
    binding: record.binding,
    status: 'queued',
    dispatch: 'not_started',
    costProvenance: 'not_sent',
    costPoints: 0,
    revision: 1,
    createdAt: '2026-09-08T01:00:00.000Z',
    updatedAt: '2026-09-08T01:00:00.000Z',
    terminalAt: null,
    purgedAt: null,
    ...patch,
  };
}
