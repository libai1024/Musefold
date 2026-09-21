import type { CreateGenerationInput } from '@musefold/contracts';

/** One-shot recovery keeps the original input/key; resource ownership stays in memory. */
export type QuotaRecovery =
  | { kind: 'retry-job'; jobId: string }
  | { kind: 'replay-create'; intent: readonly [CreateGenerationInput, string] };

function ownRecovery(intent: QuotaRecovery, releaseResources?: () => void) {
  let released = false;
  return {
    intent,
    release() {
      if (released) return;
      released = true;
      // Resource release is best effort; a cleanup fault must not undo credited quota.
      // Hosts retain their durable cleanup queue / upload expiry fallback.
      try {
        releaseResources?.();
      } catch {
        // No generation or redemption may be retried as a consequence of cleanup.
      }
    },
  };
}

let recovery: ReturnType<typeof ownRecovery> | null = null;

export function rememberQuotaRecovery(next: QuotaRecovery, releaseResources?: () => void): void {
  const previous = recovery;
  recovery = ownRecovery(next, releaseResources);
  previous?.release();
}

export function peekQuotaRecovery(): QuotaRecovery | null {
  return recovery?.intent ?? null;
}

/** Transfers the hold to the caller, which must release it in its replay's finally block. */
export function consumeQuotaRecovery(expected?: QuotaRecovery | null) {
  // Redemption cannot consume an intent selected while its crediting request was in flight.
  if (expected !== undefined && (recovery?.intent ?? null) !== expected) return null;
  const current = recovery;
  recovery = null;
  return current;
}

export function resetQuotaRecovery(): void {
  const previous = recovery;
  recovery = null;
  previous?.release();
}
