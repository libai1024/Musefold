import { describe, expect, it } from 'vitest';
import { executionDigest, generationRequestDigest } from '../execution-digest.js';

describe('durable execution request digests', () => {
  it('includes the explicit model in the frozen digest and leaves legacy omitted-model hashes intact', () => {
    const request = {
      prompt: 'image',
      referenceImages: [],
      count: 1,
      quality: 'auto',
      size: 'auto',
    };
    expect(generationRequestDigest(request)).toBe(executionDigest(request));
    expect(generationRequestDigest({ ...request, model: 'image-a' })).not.toBe(
      generationRequestDigest(request),
    );
    expect(generationRequestDigest({ ...request, model: 'image-a' })).not.toBe(
      generationRequestDigest({ ...request, model: 'image-b' }),
    );
  });
  it('canonicalizes object order recursively while preserving ordered references', () => {
    expect(executionDigest({ b: 2, a: { d: 4, c: 3 } })).toBe(
      executionDigest({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(executionDigest({ references: ['one', 'two'] })).not.toBe(
      executionDigest({ references: ['two', 'one'] }),
    );
    expect(executionDigest({ prompt: 'first' })).not.toBe(executionDigest({ prompt: 'second' }));
  });

  it('uses a known SHA256 vector and JSON omission/null semantics', () => {
    expect(executionDigest({})).toBe(
      '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
    expect(executionDigest({ omit: undefined, array: [undefined, null] })).toBe(
      executionDigest({ array: [null, null] }),
    );
    const shared = { text: 'shared value' };
    expect(executionDigest([shared, shared])).toBe(
      executionDigest([{ text: 'shared value' }, { text: 'shared value' }]),
    );
  });

  it('defaults the same provider request at enqueue and worker dispatch', () => {
    expect(generationRequestDigest({ prompt: ' image ' })).toBe(
      generationRequestDigest({
        referenceImages: [],
        count: 1,
        quality: 'auto',
        size: 'auto',
        prompt: 'image',
      }),
    );
    expect(generationRequestDigest({ prompt: 'image', count: 1 })).not.toBe(
      generationRequestDigest({ prompt: 'image', count: 2 }),
    );
    expect(generationRequestDigest({ prompt: 'image', expectedBinding: { ignored: true } })).toBe(
      generationRequestDigest({ prompt: 'image' }),
    );
  });

  it('rejects invalid requests and non-JSON values instead of silently hashing a different request', () => {
    for (const raw of [NaN, Infinity, 1n, new Date(), new Map(), undefined, () => 1]) {
      expect(() => executionDigest(raw)).toThrow(TypeError);
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => executionDigest(cycle)).toThrow(TypeError);
    expect(() => generationRequestDigest({ prompt: '' })).toThrow();
  });
});
