import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import {
  sourceSnapshotSchema,
  MAX_DESIGN_SCHEME_HISTORY_PROMPT_CHARS,
  MAX_DESIGN_SCHEME_HISTORY_PROMPTS,
  MAX_DESIGN_SCHEME_HISTORY_PROMPT_LENGTH,
  MAX_AGENT_UPLOAD_TOTAL_BYTES,
  type DesignSchemeAgentMaterials,
  type designSchemeHistorySourceSelectionsSchema,
  type UploadDesignSchemeAssetInput,
  type StagedDesignSchemeAsset,
} from '@musefold/contracts';
import {
  generationRuns,
  generationAssets,
  executionDigest,
  type MusefoldDatabase,
  type MusefoldTransaction,
} from '@musefold/db';
import { createHash } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import { inspectSchemeImage } from './image.js';
import type { DesignSchemeAssetStorage } from './storage.js';

type History = NonNullable<DesignSchemeAgentMaterials['history']>;
type Selections = z.infer<typeof designSchemeHistorySourceSelectionsSchema>;
type Tx = MusefoldDatabase | MusefoldTransaction;

async function historyRow(tx: Tx, userId: string, selection: Selections[number], lock = false) {
  const query = tx
    .select({ asset: generationAssets, run: generationRuns })
    .from(generationAssets)
    .innerJoin(
      generationRuns,
      and(
        eq(generationRuns.id, generationAssets.runId),
        eq(generationRuns.userId, generationAssets.userId),
      ),
    )
    .where(
      and(
        eq(generationAssets.userId, userId),
        eq(generationAssets.id, selection.assetId),
        eq(generationRuns.id, selection.runId),
        eq(generationRuns.status, 'succeeded'),
        isNull(generationRuns.deletedAt),
      ),
    );
  const [row] = lock ? await query.for('share') : await query;
  if (
    !row ||
    row.asset.objectKey !== `users/${userId}/generations/${selection.runId}/${selection.assetId}`
  )
    throw historyInvalid();
  return row;
}
function selectedPrompt(row: Awaited<ReturnType<typeof historyRow>>, include: boolean) {
  if (!include) return null;
  const snapshot = row.run.promptSnapshot;
  if (
    snapshot?.schemaVersion !== 1 ||
    typeof snapshot.finalPrompt !== 'string' ||
    !snapshot.finalPrompt.trim() ||
    snapshot.finalPrompt.length > MAX_DESIGN_SCHEME_HISTORY_PROMPT_LENGTH ||
    snapshot.finalPrompt.includes('\0') ||
    snapshot.finalPrompt !== row.run.request.prompt
  )
    throw historyInvalid();
  return snapshot.finalPrompt;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Only server-owned completed history is read; free copies predate any text model authorization. */
export async function freezeHistoryMaterials(
  db: MusefoldDatabase,
  storage: DesignSchemeAssetStorage,
  userId: string,
  selections: Selections,
  stage: (input: UploadDesignSchemeAssetInput) => Promise<StagedDesignSchemeAsset>,
  existingBytes: number,
): Promise<History> {
  if (selections.filter((item) => item.includePrompt).length > MAX_DESIGN_SCHEME_HISTORY_PROMPTS)
    throw historyInvalid();
  const assets: History['assets'] = [];
  const files: z.infer<typeof sourceSnapshotSchema>['files'] = [];
  const historyItems: NonNullable<z.infer<typeof sourceSnapshotSchema>['historyItems']> = [];
  let total = existingBytes;
  let promptChars = 0;
  for (const selection of selections) {
    const row = await historyRow(db, userId, selection);
    const prompt = selectedPrompt(row, selection.includePrompt);
    promptChars += prompt?.length ?? 0;
    total += row.asset.byteSize;
    if (
      total > MAX_AGENT_UPLOAD_TOTAL_BYTES ||
      promptChars > MAX_DESIGN_SCHEME_HISTORY_PROMPT_CHARS
    )
      throw historyInvalid();
    let bytes: Uint8Array;
    try {
      bytes = await storage.read(row.asset.objectKey);
    } catch {
      throw historyInvalid();
    }
    const image = await inspectSchemeImage(bytes);
    if (
      image.contentHash !== row.asset.checksumSha256 ||
      image.mimeType !== row.asset.mimeType ||
      image.byteSize !== row.asset.byteSize ||
      image.width !== row.asset.width ||
      image.height !== row.asset.height
    )
      throw historyInvalid();
    const copy = await stage({ name: 'history.png', bytes: Uint8Array.from(bytes) });
    const asset: History['assets'][number] = {
      id: copy.id,
      origin: 'cloud-run',
      role: 'example',
      license: null,
      mimeType: copy.mimeType,
      width: copy.width,
      height: copy.height,
      byteSize: copy.byteSize,
      contentHash: copy.contentHash,
      createdAt: copy.createdAt,
    };
    assets.push(asset);
    const imagePath = `history/${asset.id}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'}`;
    const promptPath = prompt === null ? null : `history/${asset.id}.prompt.txt`;
    files.push({
      relativePath: imagePath,
      kind: 'image',
      mimeType: asset.mimeType,
      sizeBytes: asset.byteSize,
      contentHash: asset.contentHash,
      evidencePath: imagePath,
      textExcerpt: null,
    });
    if (prompt !== null && promptPath) {
      const text = Buffer.from(prompt, 'utf8');
      files.push({
        relativePath: promptPath,
        kind: 'text',
        mimeType: 'text/plain',
        sizeBytes: text.byteLength,
        contentHash: hash(text),
        evidencePath: promptPath,
        textExcerpt: null,
      });
    }
    historyItems.push({ selection, imageAssetId: asset.id, imagePath, promptPath, prompt });
  }
  const snapshot = sourceSnapshotSchema.parse({
    id: randomUUID(),
    packageId: randomUUID(),
    kind: 'history',
    resolvedRef: 'history',
    commitHash: null,
    contentHash: executionDigest({ files, historyItems }),
    totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    files,
    historyItems,
    createdAt: new Date().toISOString(),
  });
  return { snapshot, assets };
}

/** Admission is the freeze boundary. Once persisted, deleting original history cannot revoke the independent copy. */
export async function lockHistoryAdmission(
  tx: MusefoldTransaction | MusefoldDatabase,
  userId: string,
  history: History,
) {
  const entries = history.snapshot.historyItems ?? [];
  for (const item of [...entries].sort(
    (a, b) =>
      a.selection.runId.localeCompare(b.selection.runId) ||
      a.selection.assetId.localeCompare(b.selection.assetId),
  )) {
    const row = await historyRow(tx, userId, item.selection, true);
    const asset = history.assets.find((asset) => asset.id === item.imageAssetId);
    if (
      !asset ||
      row.asset.checksumSha256 !== asset.contentHash ||
      row.asset.byteSize !== asset.byteSize ||
      row.asset.mimeType !== asset.mimeType ||
      row.asset.width !== asset.width ||
      row.asset.height !== asset.height ||
      selectedPrompt(row, item.selection.includePrompt) !== item.prompt
    )
      throw historyInvalid();
  }
}
/** Validate the durable prompt/file manifest before any model call, including after process recovery. */
export function assertFrozenHistory(history: History) {
  const { files, historyItems } = history.snapshot;
  if (!historyItems || history.snapshot.contentHash !== executionDigest({ files, historyItems }))
    throw historyInvalid();
  for (const item of historyItems) {
    const asset = history.assets.find((asset) => asset.id === item.imageAssetId);
    const image = files.find((file) => file.relativePath === item.imagePath);
    if (
      !asset ||
      !image ||
      image.contentHash !== asset.contentHash ||
      image.sizeBytes !== asset.byteSize ||
      image.mimeType !== asset.mimeType
    )
      throw historyInvalid();
    if (item.prompt !== null) {
      const prompt = files.find((file) => file.relativePath === item.promptPath);
      const bytes = Buffer.from(item.prompt, 'utf8');
      if (!prompt || prompt.contentHash !== hash(bytes) || prompt.sizeBytes !== bytes.byteLength)
        throw historyInvalid();
    }
  }
}

function historyInvalid() {
  return new AppError(
    'VALIDATION_FAILED',
    '历史作品或所选提示词已变化、不可用或超过限制，请重新选择',
    409,
    false,
    { reason: 'AGENT_MATERIALS_INVALID' },
  );
}
