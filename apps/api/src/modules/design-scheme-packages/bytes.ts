import { createHash } from 'node:crypto';
import {
  DESIGN_SCHEME_PACKAGE_LIMITS,
  designSchemePackagePreviewSchema,
} from '@musefold/contracts';
import {
  readValidatedDesignSchemePackageBytes,
  decodeLegacyDesignSchemePackage,
} from '@musefold/scheme-package';
import { AppError } from '../../lib/errors.js';

/** Count actual stream bytes, including requests without Content-Length. Cancel on every failure. */
export async function readPackageUpload(
  body: ReadableStream<Uint8Array> | null,
  expectedSize: number,
  signal?: AbortSignal,
) {
  if (
    !body ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes
  )
    throw invalidPackage();
  const reader = body.getReader();
  let size = 0;
  const deadline = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
  const aborted = () => {
    void reader.cancel().catch(() => undefined);
  };
  deadline.addEventListener('abort', aborted, { once: true });
  try {
    if (deadline.aborted) throw invalidPackage();
    // Admission already bounds simultaneous readers. Own one exact-size buffer instead of
    // retaining copied chunks plus a second full payload during concatenation.
    // A partially filled buffer must never escape the exact-length check below.
    const bytes = Buffer.allocUnsafe(expectedSize);
    for (;;) {
      const result = await reader.read();
      if (deadline.aborted) throw invalidPackage();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > expectedSize || size > DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes)
        throw invalidPackage(413);
      bytes.set(result.value, size - result.value.byteLength);
    }
    if (size !== expectedSize) throw invalidPackage();
    return bytes;
  } finally {
    deadline.removeEventListener('abort', aborted);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
export const packageHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function inspectPackage(bytes: Uint8Array, version: 1 | 2) {
  try {
    const parsed = await readValidatedDesignSchemePackageBytes(bytes, [version]);
    if (parsed.formatVersion === 1) {
      const legacy = decodeLegacyDesignSchemePackage(parsed);
      return designSchemePackagePreviewSchema.parse({
        name: legacy.document.name,
        summary: legacy.document.summary,
        sourceCount: legacy.snapshots.length,
        entryCount: parsed.entries.size,
        imageCount: legacy.snapshots
          .flatMap((s) => s.files)
          .filter((f) => f.metadata.kind === 'image').length,
        legacyPreviewCount: legacy.previews.length,
      });
    }
    return designSchemePackagePreviewSchema.parse({
      name: parsed.manifest.document.name,
      summary: parsed.manifest.document.summary,
      sourceCount: parsed.manifest.sourceSnapshots.length,
      entryCount: parsed.entries.size,
      imageCount: parsed.manifest.assets.length,
      legacyPreviewCount: 0,
    });
  } catch {
    throw invalidPackage();
  }
}
export function invalidPackage(status = 400) {
  return new AppError('VALIDATION_FAILED', '方案包字节、大小、摘要或内容无效', status, false, {
    reason: 'SCHEME_PACKAGE_INVALID',
  });
}
