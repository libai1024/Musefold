/**
 * 确定性质量门（开发规范 §5.5 / §10）：
 * 对一次方案运行的成功输出做不依赖模型的检查——输出数量、文件有效性、
 * 输出比例——并把指标与逐张证据写入 design_scheme_evaluations。
 *
 * 视觉模型评估（结构化评分/修复建议）属于 P4 校准，不在这里。
 * 质量门不通过不阻断运行：输出已经存在，结论以警告呈现，由用户决定取舍。
 */
import { openSync, readSync, closeSync, statSync } from 'fs';
import { RATIO_OPTIONS } from '@shared/constants';
import type { SchemeRunEvaluationCheck } from '@shared/types/design-scheme';

export interface ImageProbe {
  width: number;
  height: number;
}

/**
 * 只读文件头解析 PNG / JPEG / WebP 尺寸（生图产物只有这三种格式）。
 * 解析失败返回 null，由调用方降级为 warn，不抛错。
 */
export function probeImageSize(path: string): ImageProbe | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'r');
    const head = Buffer.alloc(64 * 1024);
    const bytesRead = readSync(fd, head, 0, head.length, 0);
    const buffer = head.subarray(0, bytesRead);
    return parsePng(buffer) ?? parseWebp(buffer) ?? parseJpeg(buffer);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function parsePng(buffer: Buffer): ImageProbe | null {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
  // IHDR 固定是第一个 chunk：宽高在偏移 16 / 20。
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseWebp(buffer: Buffer): ImageProbe | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8 ') {
    // 有损帧：跳过 3 字节 frame tag 与 3 字节起始码后是 14 位宽高。
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

function parseJpeg(buffer: Buffer): ImageProbe | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  // 读宽度需要 offset+7..8 两个字节可用。
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0-SOF15（排除 DHT/DAC/RST 等非帧标记）携带尺寸。
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

export interface EvaluationOutput {
  jobId: string;
  imagePath: string;
}

export interface RunEvaluationInput {
  /** 计划生成张数。 */
  plannedCount: number;
  /** 成功产出（仅 success 且有 imagePath）。 */
  outputs: EvaluationOutput[];
  /** Composer 比例设置；'auto' 表示未约束。 */
  ratioId: string;
}

export interface RunEvaluationOutcome {
  passed: boolean;
  checks: SchemeRunEvaluationCheck[];
  /** 逐张证据（尺寸/字节数），入库 evidence_json。 */
  evidence: Array<{
    jobId: string;
    path: string;
    bytes: number | null;
    width: number | null;
    height: number | null;
  }>;
}

/** 比例容差：Provider 尺寸档位有限（如 3:4 实际按 1024x1536 出图），按名义比例或档位尺寸就近判定。 */
const RATIO_TOLERANCE = 0.05;

function ratioTargets(ratioId: string): number[] {
  const option = RATIO_OPTIONS.find((item) => item.id === ratioId);
  if (!option || option.size === 'auto') return [];
  const targets: number[] = [];
  const [ratioW, ratioH] = option.ratio.split(':').map(Number);
  if (ratioW > 0 && ratioH > 0) targets.push(ratioW / ratioH);
  const [sizeW, sizeH] = option.size.split('x').map(Number);
  if (sizeW > 0 && sizeH > 0) targets.push(sizeW / sizeH);
  return targets;
}

export function evaluateSchemeRun(input: RunEvaluationInput): RunEvaluationOutcome {
  const checks: SchemeRunEvaluationCheck[] = [];
  const evidence: RunEvaluationOutcome['evidence'] = [];

  // 1. 输出数量
  const produced = input.outputs.length;
  checks.push({
    id: 'output-count',
    label: '输出数量',
    status: produced >= input.plannedCount ? 'pass' : produced > 0 ? 'warn' : 'fail',
    detail: `${produced}/${input.plannedCount} 张`,
  });

  // 2. 文件有效性 + 收集证据
  let invalidFiles = 0;
  for (const output of input.outputs) {
    let bytes: number | null = null;
    try {
      bytes = statSync(output.imagePath).size;
    } catch {
      bytes = null;
    }
    const probe = bytes && bytes > 0 ? probeImageSize(output.imagePath) : null;
    if (!bytes || bytes <= 0) invalidFiles += 1;
    evidence.push({
      jobId: output.jobId,
      path: output.imagePath,
      bytes,
      width: probe?.width ?? null,
      height: probe?.height ?? null,
    });
  }
  checks.push({
    id: 'file-valid',
    label: '文件有效',
    status: invalidFiles === 0 ? 'pass' : 'fail',
    detail: invalidFiles === 0 ? `${produced} 个文件均可读取` : `${invalidFiles} 个文件缺失或为空`,
  });

  // 3. 输出比例（'auto' 不约束；尺寸解析失败降级为 warn）
  const targets = ratioTargets(input.ratioId);
  if (targets.length === 0) {
    checks.push({ id: 'aspect-ratio', label: '输出比例', status: 'pass', detail: '未约束比例（自动）' });
  } else {
    const measured = evidence.filter((item) => item.width && item.height);
    if (measured.length === 0) {
      checks.push({ id: 'aspect-ratio', label: '输出比例', status: 'warn', detail: '无法解析输出图片尺寸' });
    } else {
      const offTarget = measured.filter((item) => {
        const actual = item.width! / item.height!;
        return !targets.some((target) => Math.abs(actual - target) / target <= RATIO_TOLERANCE);
      });
      checks.push({
        id: 'aspect-ratio',
        label: '输出比例',
        status: offTarget.length === 0 ? 'pass' : 'warn',
        detail: offTarget.length === 0
          ? `${measured.length} 张符合 ${input.ratioId}`
          : `${offTarget.length} 张与请求比例 ${input.ratioId} 不一致`,
      });
    }
  }

  return { passed: checks.every((check) => check.status !== 'fail'), checks, evidence };
}

/**
 * 有限修复链（开发规范 §5.5 / §12）：从质量门结论推导一条确定性修复建议。
 * 修复不改方案、不删原始输出——只允许发起一次新运行（新 runId），
 * 建议文本作为纠偏要求附加进重跑的用户简述。全部通过时返回 null。
 */
export function buildRepairHint(checks: SchemeRunEvaluationCheck[], ratioId: string): string | null {
  const hints: string[] = [];
  const byId = (id: string) => checks.find((check) => check.id === id);

  const count = byId('output-count');
  if (count && count.status !== 'pass') {
    hints.push('上一次运行有输出缺失，请重新生成计划数量的图片');
  }
  const ratio = byId('aspect-ratio');
  if (ratio && ratio.status !== 'pass') {
    hints.push(`严格按照 ${ratioId} 的画面比例输出，不要裁切或留出多余边框`);
  }
  const file = byId('file-valid');
  if (file && file.status !== 'pass') {
    hints.push('上一次有输出文件损坏，请重新完整生成');
  }
  return hints.length > 0 ? hints.join('；') : null;
}
