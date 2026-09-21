import type { ReleaseReferenceImageInput } from '@musefold/contracts';

/** View, submission and quota recovery each hold the same upload independently. */
export function createReferenceUploadLifetime(
  id: ReleaseReferenceImageInput['id'],
  releaseUpload: (input: ReleaseReferenceImageInput) => Promise<void>,
) {
  let holds = 1;
  function releaseHold() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds -= 1;
      if (holds === 0) {
        // Desktop owns a durable cleanup queue; cloud uploads retain their expiry fallback.
        // A failed release must never resubmit generation or create an unhandled rejection.
        void Promise.resolve()
          .then(() => releaseUpload({ id }))
          .catch(() => {});
      }
    };
  }
  return {
    release: releaseHold(),
    retain() {
      if (holds === 0) throw new Error('Cannot retain a released reference upload');
      holds += 1;
      return releaseHold();
    },
  };
}
