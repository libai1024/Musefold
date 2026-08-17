import type { GenerationJob, GenerationStatus } from '@musefold/contracts';

const TERMINAL_STATUSES = new Set<GenerationStatus>(['succeeded', 'failed', 'cancelled']);

export function isGenerationTerminal(status: GenerationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canCancelGeneration(job: Pick<GenerationJob, 'status'>): boolean {
  return job.status === 'queued' || job.status === 'running';
}
