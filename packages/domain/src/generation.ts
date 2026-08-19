import type { GenerationJob, GenerationStatus } from '@musefold/contracts';

const TERMINAL_STATUSES = new Set<GenerationStatus>(['succeeded', 'failed', 'cancelled']);

const TRANSITIONS: Readonly<Record<GenerationStatus, readonly GenerationStatus[]>> = {
  pending_approval: ['queued', 'cancelled', 'rejected', 'expired'],
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelling'],
  cancelling: ['cancelled', 'succeeded', 'failed'],
  succeeded: [],
  failed: [],
  cancelled: [],
  rejected: [],
  expired: [],
};

export function isGenerationTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.has(status) || status === 'rejected' || status === 'expired';
}

export function canCancelGeneration(job: Pick<GenerationJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}

export function canTransitionGeneration(from: GenerationStatus, to: GenerationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertGenerationTransition(from: GenerationStatus, to: GenerationStatus): void {
  if (!canTransitionGeneration(from, to)) {
    throw new Error(`Invalid generation transition: ${from} -> ${to}`);
  }
}
