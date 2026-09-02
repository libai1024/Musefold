/**
 * v6 真实元数据探测单测（source-ingestion 的 probe helper）：
 * 魔数 MIME 嗅探、stat/sha256/尺寸探测、缺失与不可识别文件返回 null（不伪造）。
 * 另覆盖 persistHistorySnapshot 的历史来源固化安全边界：条目路径是不可信输入，
 * 只接受受管根（userData/pictures）内常规文件，越根/symlink 与缺失同语义跳过。
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

import { runDesignSchemeDbMigrations } from '@musefold/core/db/design-scheme/migrations';
import {
  persistHistorySnapshot,
  probeImageAssetMetadata,
  sniffImageMimeType,
  textMimeTypeForPath,
} from '../source-ingestion';
import { fakePngBuffer } from './evaluation.test';

const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'musefold-probe-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 最小 JPEG 头（SOI + SOF0：height/width 内嵌），与 evaluation.test 同构；补齐魔数嗅探所需长度。 */
function minimalJpegBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(16);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(7, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

describe('sniffImageMimeType', () => {
  it('按魔数识别 PNG/JPEG/WebP;文本与过短缓冲返回 null', () => {
    expect(sniffImageMimeType(fakePngBuffer(2, 2))).toBe('image/png');
    expect(sniffImageMimeType(minimalJpegBuffer(2, 2))).toBe('image/jpeg');
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0, 'ascii');
    webp.write('WEBP', 8, 'ascii');
    expect(sniffImageMimeType(webp)).toBe('image/webp');
    expect(sniffImageMimeType(Buffer.from('plain text file'))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(4))).toBeNull();
  });
});

describe('textMimeTypeForPath', () => {
  it('按扩展名映射常见文本类型,缺省 text/plain', () => {
    expect(textMimeTypeForPath('SKILL.md')).toBe('text/markdown');
    expect(textMimeTypeForPath('docs/guide.markdown')).toBe('text/markdown');
    expect(textMimeTypeForPath('data.json')).toBe('application/json');
    expect(textMimeTypeForPath('notes.txt')).toBe('text/plain');
    expect(textMimeTypeForPath('noext')).toBe('text/plain');
  });
});

describe('probeImageAssetMetadata', () => {
  it('真实 PNG:完整元数据(MIME/尺寸/字节/sha256)', () => {
    const root = tempRoot();
    const png = join(root, 'run.png');
    const bytes = fakePngBuffer(1024, 1536);
    writeFileSync(png, bytes);

    expect(probeImageAssetMetadata(png)).toEqual({
      mimeType: 'image/png',
      width: 1024,
      height: 1536,
      byteSize: bytes.byteLength,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('真实 JPEG:尺寸来自 SOF 段', () => {
    const root = tempRoot();
    const jpeg = join(root, 'run.jpg');
    const bytes = minimalJpegBuffer(640, 480);
    writeFileSync(jpeg, bytes);

    expect(probeImageAssetMetadata(jpeg)).toMatchObject({
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
      byteSize: bytes.byteLength,
    });
  });

  it('缺失/非图片/空文件返回 null,不伪造', () => {
    const root = tempRoot();
    expect(probeImageAssetMetadata(join(root, 'missing.png'))).toBeNull();
    const junk = join(root, 'junk.png');
    writeFileSync(junk, Buffer.from('not an image at all'));
    expect(probeImageAssetMetadata(junk)).toBeNull();
    const empty = join(root, 'empty.png');
    writeFileSync(empty, Buffer.alloc(0));
    expect(probeImageAssetMetadata(empty)).toBeNull();
  });

  it('目录而不是文件 → null', () => {
    expect(probeImageAssetMetadata(tempRoot())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// persistHistorySnapshot:历史来源固化只信任受管根内的常规文件。
// 条目路径的历史调用方是渲染层(不可信输入):越根/symlink/缺失与「文件已不存在」
// 同语义跳过,绝不读盘外文件,也不阻塞创建。
// ---------------------------------------------------------------------------

describe('persistHistorySnapshot', () => {
  it('受管根内文件被复制固化,提示词按条目入库', () => {
    const userData = tempRoot();
    const pictures = join(userData, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const png = fakePngBuffer(320, 240);
    const source = join(pictures, 'generated-run.png');
    writeFileSync(source, png);
    const db = historyDb();

    const persisted = persistHistorySnapshot(
      db,
      [{ historyId: '01JXCZRUN', imagePath: source, promptText: ' 双色海报 ' }],
      userData,
      pictures,
    );

    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]).toMatchObject({ historyId: '01JXCZRUN' });
    // 固化产物真实存在且字节一致;快照目录落在 userData 受管根内。
    expect(existsSync(persisted.items[0].snapshotImagePath)).toBe(true);
    expect(readFileSync(persisted.items[0].snapshotImagePath)).toEqual(png);
    expect(persisted.items[0].snapshotImagePath.startsWith(userData)).toBe(true);
    // 入库文件行:图片 + 提示词文本,hash 与真实字节一致。
    const rows = db
      .prepare('SELECT path, kind, content_hash FROM source_files ORDER BY path')
      .all() as Array<{ path: string; kind: string; content_hash: string }>;
    expect(rows.map((row) => row.path)).toEqual([
      'history/01JXCZRUN.png',
      'history/01JXCZRUN.prompt.txt',
    ]);
    expect(rows[0].content_hash).toBe(createHash('sha256').update(png).digest('hex'));
    db.close();
  });

  it('受管根外的绝对路径被跳过,不读盘外文件', () => {
    const userData = tempRoot();
    const pictures = join(userData, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const outside = tempRoot(); // 独立临时根:不在 userData/pictures 之下
    const secret = join(outside, 'secret.png');
    writeFileSync(secret, fakePngBuffer(64, 64));
    const db = historyDb();

    const persisted = persistHistorySnapshot(
      db,
      [{ historyId: '01JXEVIL01', imagePath: secret }],
      userData,
      pictures,
    );

    expect(persisted.items).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM source_files').get()).toEqual({ n: 0 });
    // 快照目录没有为被拒条目落任何文件。
    expect(existsSync(join(userData, 'design-scheme-sources'))).toBe(false);
    db.close();
  });

  it('指向根外的 symlink 被跳过(防目录穿越)', () => {
    const userData = tempRoot();
    const pictures = join(userData, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const outside = tempRoot();
    const secret = join(outside, 'secret.png');
    writeFileSync(secret, fakePngBuffer(64, 64));
    const link = join(pictures, 'run-link.png');
    symlinkSync(secret, link);
    const db = historyDb();

    const persisted = persistHistorySnapshot(
      db,
      [{ historyId: '01JXLINK01', imagePath: link }],
      userData,
      pictures,
    );

    expect(persisted.items).toEqual([]);
    db.close();
  });

  it('快照入库失败时清理已复制文件与事务残留', () => {
    const userData = tempRoot();
    const pictures = join(userData, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const source = join(pictures, 'generated-run.png');
    writeFileSync(source, fakePngBuffer(320, 240));
    const db = historyDb();
    db.exec(`
      CREATE TRIGGER reject_history_source_file
      BEFORE INSERT ON source_files
      BEGIN
        SELECT RAISE(ABORT, 'source file rejected');
      END;
    `);

    expect(() =>
      persistHistorySnapshot(
        db,
        [{ historyId: '01JXFAIL01', imagePath: source, promptText: '不会残留' }],
        userData,
        pictures,
      ),
    ).toThrow('source file rejected');

    expect(db.prepare('SELECT COUNT(*) AS n FROM source_packages').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_snapshots').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM source_files').get()).toEqual({ n: 0 });
    expect(existsSync(join(userData, 'design-scheme-sources', ''))).toBe(true);
    const snapshotRoots = readdirSync(join(userData, 'design-scheme-sources'));
    expect(snapshotRoots).toEqual([]);
    db.close();
  });

  it('已消失的文件沿用旧语义跳过;混合条目只固化合法项', () => {
    const userData = tempRoot();
    const pictures = join(userData, 'Pictures');
    mkdirSync(pictures, { recursive: true });
    const outside = tempRoot();
    const valid = join(pictures, 'ok.png');
    writeFileSync(valid, fakePngBuffer(120, 90));
    const db = historyDb();

    const persisted = persistHistorySnapshot(
      db,
      [
        { historyId: '01JXOKOK01', imagePath: valid },
        { historyId: '01JXGONE01', imagePath: join(pictures, 'gone.png') },
        { historyId: '01JXOUTS01', imagePath: join(outside, 'escape.png') },
      ],
      userData,
      pictures,
    );

    expect(persisted.items.map((item) => item.historyId)).toEqual(['01JXOKOK01']);
    const rows = db.prepare('SELECT path FROM source_files ORDER BY path').all() as Array<{
      path: string;
    }>;
    expect(rows.map((row) => row.path)).toEqual(['history/01JXOKOK01.png']);
    db.close();
  });
});

/** 独立 design-scheme 内存库(persistHistorySnapshot 的 saveSourceSnapshot 落库目标)。 */
function historyDb() {
  const db = new Database(':memory:');
  runDesignSchemeDbMigrations(db);
  return db;
}
