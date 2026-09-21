import archiver from 'archiver';
import {
  sharePackageManifestSchema,
  DESIGN_SCHEME_PACKAGE_LIMITS,
  type CanonicalDesignSchemePackageManifest,
} from '@musefold/contracts';
import { MAX_DESIGN_SCHEME_PACKAGE_BYTES, validateCanonicalPackage } from './archive.js';

/** Hosts authorize exports and collect owned bytes. The codec never grants formal status itself. */
export async function writeDesignSchemePackageBytes(
  manifest: CanonicalDesignSchemePackageManifest,
  content: ReadonlyMap<string, Uint8Array>,
): Promise<Buffer> {
  manifest = sharePackageManifestSchema.parse(manifest);
  if (content.size + 1 > DESIGN_SCHEME_PACKAGE_LIMITS.entries)
    throw new Error('分享包条目超过上限');
  let inputSize = 0;
  for (const bytes of content.values()) {
    inputSize += bytes.byteLength;
    if (
      bytes.byteLength > DESIGN_SCHEME_PACKAGE_LIMITS.entryBytes ||
      inputSize > DESIGN_SCHEME_PACKAGE_LIMITS.expandedBytes
    )
      throw new Error('分享包内容超过大小上限');
  }
  const entries = new Map([...content].map(([path, bytes]) => [path, Buffer.from(bytes)]));
  if (entries.has('manifest.json')) throw new Error('内容不能覆盖manifest.json');
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  if (
    manifestBytes.length > DESIGN_SCHEME_PACKAGE_LIMITS.manifestBytes ||
    entries.size + 1 > DESIGN_SCHEME_PACKAGE_LIMITS.entries
  )
    throw new Error('分享包元数据超过上限');
  if (
    [...entries.values()].reduce((size, bytes) => size + bytes.length, manifestBytes.length) >
    MAX_DESIGN_SCHEME_PACKAGE_BYTES
  ) {
    throw new Error('分享包解压后超过大小上限');
  }
  entries.set('manifest.json', manifestBytes);
  validateCanonicalPackage(manifest, entries);
  return new Promise((resolve, reject) => {
    // STORE avoids producing a legitimate text export that trips the reader's compression-ratio limit.
    const archive = archiver('zip', { store: true });
    const parts: Buffer[] = [];
    let total = 0;
    let failed = false;
    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      archive.abort();
      reject(error);
    };
    archive.on('error', fail);
    archive.on('warning', fail);
    archive.on('data', (chunk: Buffer) => {
      if (failed) return;
      total += chunk.length;
      if (total > MAX_DESIGN_SCHEME_PACKAGE_BYTES) {
        fail(new Error('分享包超过大小上限'));
        return;
      }
      parts.push(chunk);
    });
    archive.on('end', () => {
      if (!failed) resolve(Buffer.concat(parts, total));
    });
    for (const [name, bytes] of entries)
      archive.append(bytes, { name, date: new Date('2000-01-01T00:00:00Z'), mode: 0o600 });
    void archive.finalize().catch(fail);
  });
}
