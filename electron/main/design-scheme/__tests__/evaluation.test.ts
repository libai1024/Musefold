import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { buildRepairHint, evaluateSchemeRun, probeImageSize } from '../evaluation';

/** 只含签名 + IHDR 尺寸的最小 PNG 头（质量门只读文件头）。 */
export function fakePngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function fakeJpegBuffer(width: number, height: number): Buffer {
  // SOI + SOF0（height 在 offset+5，width 在 offset+7）
  const buffer = Buffer.alloc(11);
  buffer[0] = 0xff; buffer[1] = 0xd8;
  buffer[2] = 0xff; buffer[3] = 0xc0;
  buffer.writeUInt16BE(7, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

describe('probeImageSize', () => {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-eval-'));

  it('解析 PNG / JPEG 尺寸，无法识别时返回 null', () => {
    const png = join(dir, 'a.png');
    writeFileSync(png, fakePngBuffer(1024, 1536));
    expect(probeImageSize(png)).toEqual({ width: 1024, height: 1536 });

    const jpeg = join(dir, 'b.jpg');
    writeFileSync(jpeg, fakeJpegBuffer(1536, 1024));
    expect(probeImageSize(jpeg)).toEqual({ width: 1536, height: 1024 });

    const junk = join(dir, 'c.bin');
    writeFileSync(junk, Buffer.from('not an image'));
    expect(probeImageSize(junk)).toBeNull();
    expect(probeImageSize(join(dir, 'missing.png'))).toBeNull();
  });
});

describe('evaluateSchemeRun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-eval-run-'));
  const image = (name: string, width: number, height: number) => {
    const path = join(dir, name);
    writeFileSync(path, fakePngBuffer(width, height));
    return path;
  };

  it('全部达标：数量/文件/比例（按档位尺寸 1024x1536 判定 3:4）全 pass', () => {
    const outcome = evaluateSchemeRun({
      plannedCount: 2,
      outputs: [
        { jobId: 'j1', imagePath: image('ok-1.png', 1024, 1536) },
        { jobId: 'j2', imagePath: image('ok-2.png', 1024, 1536) },
      ],
      ratioId: '3:4',
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.checks.map((check) => [check.id, check.status])).toEqual([
      ['output-count', 'pass'],
      ['file-valid', 'pass'],
      ['aspect-ratio', 'pass'],
    ]);
    expect(outcome.evidence).toHaveLength(2);
    expect(outcome.evidence[0]).toMatchObject({ jobId: 'j1', width: 1024, height: 1536 });
  });

  it('部分成功 + 比例漂移：warn 不算失败；auto 不约束比例', () => {
    const outcome = evaluateSchemeRun({
      plannedCount: 2,
      outputs: [{ jobId: 'j1', imagePath: image('square.png', 1024, 1024) }],
      ratioId: '3:4',
    });
    expect(outcome.passed).toBe(true);
    expect(outcome.checks.find((check) => check.id === 'output-count')?.status).toBe('warn');
    expect(outcome.checks.find((check) => check.id === 'aspect-ratio')?.status).toBe('warn');

    const auto = evaluateSchemeRun({
      plannedCount: 1,
      outputs: [{ jobId: 'j1', imagePath: image('any.png', 640, 480) }],
      ratioId: 'auto',
    });
    expect(auto.checks.find((check) => check.id === 'aspect-ratio')).toMatchObject({ status: 'pass', detail: '未约束比例（自动）' });
  });

  it('文件缺失：file-valid fail，整体不通过', () => {
    const outcome = evaluateSchemeRun({
      plannedCount: 1,
      outputs: [{ jobId: 'j1', imagePath: join(dir, 'missing.png') }],
      ratioId: 'auto',
    });
    expect(outcome.passed).toBe(false);
    expect(outcome.checks.find((check) => check.id === 'file-valid')?.status).toBe('fail');
    expect(outcome.evidence[0]).toMatchObject({ bytes: null, width: null, height: null });
  });
});

describe('buildRepairHint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'musefold-repair-'));
  const image = (name: string, width: number, height: number) => {
    const path = join(dir, name);
    writeFileSync(path, fakePngBuffer(width, height));
    return path;
  };

  it('全部通过时不给建议', () => {
    const outcome = evaluateSchemeRun({
      plannedCount: 1,
      outputs: [{ jobId: 'j1', imagePath: image('good.png', 1024, 1536) }],
      ratioId: '3:4',
    });
    expect(buildRepairHint(outcome.checks, '3:4')).toBeNull();
  });

  it('比例漂移 + 缺张时给出确定性纠偏建议', () => {
    const outcome = evaluateSchemeRun({
      plannedCount: 2,
      outputs: [{ jobId: 'j1', imagePath: image('square.png', 1024, 1024) }],
      ratioId: '3:4',
    });
    const hint = buildRepairHint(outcome.checks, '3:4');
    expect(hint).toContain('输出缺失');
    expect(hint).toContain('3:4');
  });
});
