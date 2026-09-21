import {
  legacyDesignSchemeRevisionDocumentSchema,
  sourceFileMetadataSchema,
} from '@musefold/contracts';
import { sha256, type ValidatedDesignSchemePackage } from './archive.js';
import { sniffImageMimeType } from './image.js';

/** Decode owned archive content only; database identities, import authority and image decoding belong to hosts. */
export function decodeLegacyDesignSchemePackage(
  validated: Extract<ValidatedDesignSchemePackage, { formatVersion: 1 }>,
) {
  const { manifest, entries } = validated;
  const readText = (bytes: Uint8Array) => new TextDecoder('utf8', { fatal: true }).decode(bytes);
  const documentBytes = entries.get('scheme.json');
  if (!documentBytes) throw new Error('分享包缺少 scheme.json');
  const document = legacyDesignSchemeRevisionDocumentSchema.parse(
    JSON.parse(readText(documentBytes)),
  );
  if (document.revisionId !== manifest.revisionId) throw new Error('旧包版本身份不一致');
  if (
    new Set(manifest.snapshots.map((snapshot) => snapshot.dir)).size !== manifest.snapshots.length
  )
    throw new Error('旧包来源目录重复');
  const claimed = new Set(['manifest.json', 'scheme.json']);
  const snapshots = manifest.snapshots.map((snapshot) => {
    const seen = new Set<string>();
    const files = [...entries].flatMap(([archivePath, bytes]) => {
      const textPrefix = `sources/${snapshot.dir}/`;
      const imagePrefix = `assets/${snapshot.dir}/`;
      const kind = archivePath.startsWith(textPrefix)
        ? 'text'
        : archivePath.startsWith(imagePrefix)
          ? 'image'
          : null;
      if (!kind) return [];
      const relativePath = archivePath.slice((kind === 'text' ? textPrefix : imagePrefix).length);
      if (seen.has(relativePath)) throw new Error('旧包同一来源中文件路径冲突');
      seen.add(relativePath);
      claimed.add(archivePath);
      const text = kind === 'text' ? readText(bytes) : null;
      const metadata = sourceFileMetadataSchema.parse({
        relativePath,
        kind,
        contentHash: sha256(bytes),
        sizeBytes: bytes.length,
        mimeType: kind === 'text' ? 'text/plain' : sniffImageMimeType(bytes),
        evidencePath: null,
        textExcerpt: text?.slice(0, 2000) ?? null,
      });
      return [{ archivePath, metadata, text }];
    });
    return { snapshot, files };
  });
  // V1 previews carry no portable asset/role/trial metadata. Preserve their bytes as previews,
  // never infer a successful run or promote them to an owned cover.
  const previews = [...entries.keys()].filter((name) => name.startsWith('previews/'));
  for (const name of previews) claimed.add(name);
  if ([...entries.keys()].some((name) => !claimed.has(name)))
    throw new Error('旧包包含无法归属的内容');
  return { document, snapshots, previews };
}
