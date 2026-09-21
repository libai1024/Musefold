import {
  runResultSchema,
  type RunEvaluation,
  type RunOutputMetadata,
  type RunResult,
  type StructuredDesignSchemeError,
} from '@musefold/contracts';

const TERMINAL = new Set<RunResult['status']>(['completed', 'blocked', 'failed', 'cancelled']);
const PHASES: Partial<Record<RunResult['status'], number>> = {
  planning: 0,
  executing: 1,
  evaluating: 2,
};

/** Advance a canonical result without changing identity or overwriting an existing terminal result. */
export function advanceCloudRunResult(
  previous: RunResult,
  status: RunResult['status'],
  options: {
    now: string;
    outputs?: RunOutputMetadata[];
    evaluation?: RunEvaluation | null;
    error?: StructuredDesignSchemeError | null;
  },
): RunResult {
  const current = runResultSchema.parse(previous);
  if (TERMINAL.has(current.status)) return current;
  if ((PHASES[status] ?? 3) < (PHASES[current.status] ?? 0)) return current;
  const activeId =
    current.steps.find((step) => step.status === 'running')?.id ??
    current.steps.find((step) => step.status === 'pending')?.id;
  const error = options.error === undefined ? current.error : options.error;
  const steps = current.steps.map((step) => {
    if (step.status === 'completed') return step;
    if (status === 'cancelled') {
      return { ...step, status: 'cancelled' as const, completedAt: options.now, error: null };
    }
    if (status === 'failed' || status === 'blocked') {
      return {
        ...step,
        status: step.id === activeId ? ('failed' as const) : ('cancelled' as const),
        completedAt: options.now,
        error: step.id === activeId ? error : null,
      };
    }
    if (status === 'completed' || (status === 'evaluating' && step.kind === 'generate-image')) {
      return {
        ...step,
        status: 'completed' as const,
        outputRefs:
          step.kind === 'generate-image' && options.outputs
            ? options.outputs.map((output) => output.id)
            : step.outputRefs,
        startedAt: step.startedAt ?? options.now,
        completedAt: options.now,
        error: null,
      };
    }
    if (
      (status === 'executing' && step.kind === 'generate-image') ||
      (status === 'evaluating' && step.kind === 'evaluate-image')
    ) {
      return { ...step, status: 'running' as const, startedAt: step.startedAt ?? options.now };
    }
    return step;
  });
  return runResultSchema.parse({
    ...current,
    status,
    steps,
    outputs: options.outputs ?? current.outputs,
    evaluation: options.evaluation === undefined ? current.evaluation : options.evaluation,
    error: status === 'completed' || status === 'cancelled' ? null : error,
    completedAt: TERMINAL.has(status) ? options.now : null,
  });
}
