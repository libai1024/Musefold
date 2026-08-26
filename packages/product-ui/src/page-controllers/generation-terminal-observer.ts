import type { GenerationGateway } from '@musefold/domain';

type GenerationJob = Awaited<ReturnType<GenerationGateway['getGeneration']>>;
type GenerationStatus = GenerationJob['status'];

const ACCOUNT_REFRESH_TERMINAL_STATUSES = new Set<GenerationStatus>([
  'succeeded',
  'failed',
  'cancelled',
]);

export function isAccountRefreshGenerationTerminal(status: GenerationStatus): boolean {
  return ACCOUNT_REFRESH_TERMINAL_STATUSES.has(status);
}

export const DEFAULT_TERMINAL_JOB_MEMORY_LIMIT = 512;

/** Calls onTerminal once per job id, with bounded FIFO memory for settled jobs. */
export function createGenerationTerminalObserver(
  onTerminal: (job: GenerationJob) => void,
  memoryLimit = DEFAULT_TERMINAL_JOB_MEMORY_LIMIT,
) {
  const terminalJobIds = new Set<string>();
  const boundedMemoryLimit = Number.isFinite(memoryLimit)
    ? Math.max(1, Math.trunc(memoryLimit))
    : DEFAULT_TERMINAL_JOB_MEMORY_LIMIT;

  return {
    observe(job: GenerationJob): boolean {
      if (!isAccountRefreshGenerationTerminal(job.status)) {
        terminalJobIds.delete(job.id);
        return false;
      }
      if (terminalJobIds.has(job.id)) return false;

      terminalJobIds.add(job.id);
      if (terminalJobIds.size > boundedMemoryLimit) {
        const oldestJobId = terminalJobIds.values().next().value;
        if (oldestJobId !== undefined) terminalJobIds.delete(oldestJobId);
      }
      onTerminal(job);
      return true;
    },
  };
}
