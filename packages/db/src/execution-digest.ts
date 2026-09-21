import { createHash } from 'node:crypto';
import { cloudGenerationRequestSchema } from '@musefold/contracts';

/** Stable JSON semantics shared by enqueue and dispatch; array order remains significant. */
export function executionDigest(raw: unknown): string {
  const seen = new Set<object>();
  const normalize = (value: unknown): unknown => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || seen.has(value)) {
      throw new TypeError('Execution digest requires finite, acyclic JSON input');
    }
    seen.add(value);
    try {
      if (Array.isArray(value))
        return value.map((item) => (item === undefined ? null : normalize(item)));
      if (
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null
      ) {
        throw new TypeError('Execution digest requires plain JSON objects');
      }
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .flatMap((key) => {
            const item = (value as Record<string, unknown>)[key];
            return item === undefined ? [] : [[key, normalize(item)]];
          }),
      );
    } finally {
      seen.delete(value);
    }
  };
  return createHash('sha256')
    .update(JSON.stringify(normalize(raw)))
    .digest('hex');
}

/** The canonical provider request is parsed/defaulted identically on both sides of the queue. */
export function generationRequestDigest(raw: unknown): string {
  return executionDigest(cloudGenerationRequestSchema.parse(raw));
}
