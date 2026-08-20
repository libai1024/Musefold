// musefold generate（V04-CLI-02）：文生图与参考图精修。
// 输出契约：人类模式进度走 stderr；--json 模式 stdout 输出 NDJSON 事件流，
// 末行 {"type":"result",…}。非 TTY 且无 -y 直接 exit 4（零网络调用，T9）。

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { connect, type CliContext } from './context';
import { EXIT, printJson } from './io';

interface GenerateIo {
  isTty(): boolean;
  askYesNo(question: string): Promise<boolean>;
  onInterrupt(handler: () => void): () => void;
}

const defaultGenerateIo: GenerateIo = {
  isTty: () => process.stdin.isTTY === true && process.stdout.isTTY === true,
  async askYesNo(question) {
    process.stderr.write(`${question} [y/N] `);
    const answer = await new Promise<string>((resolve) => {
      const onData = (chunk: Buffer) => {
        process.stdin.off('data', onData);
        process.stdin.pause();
        resolve(chunk.toString('utf8').trim().toLowerCase());
      };
      process.stdin.resume();
      process.stdin.on('data', onData);
    });
    return answer === 'y' || answer === 'yes';
  },
  onInterrupt(handler) {
    const listener = () => handler();
    process.on('SIGINT', listener);
    return () => process.off('SIGINT', listener);
  },
};

function mimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function formatCliCost(detail: { costPoints?: number | null; cost?: number | null }): string | null {
  const points = detail.costPoints ?? detail.cost;
  if (points != null) return `${points.toLocaleString('zh-CN', { maximumFractionDigits: 6 })} 积分`;
  return null;
}

export async function commandGenerate(
  context: CliContext,
  _rest: string[],
  generateIo: GenerateIo = defaultGenerateIo,
): Promise<number> {
  const flags = context.args.flags;
  const stdinPrompt = flags['stdin-prompt'] === true;
  const prompt = typeof flags.prompt === 'string'
    ? flags.prompt
    : stdinPrompt
      ? readFileSync(0, 'utf8').trim()
      : undefined;
  if (!prompt?.trim()) {
    context.io.stderr('musefold: 需要 -p <提示词> 或 --stdin-prompt');
    return EXIT.ARGS;
  }

  // T9：CI 无人值守不允许静默花钱——任何网络调用之前先裁决
  const interactive = generateIo.isTty();
  if (!interactive && !context.yes) {
    context.io.stderr('musefold: 非交互终端下的花钱命令必须显式 --yes（并建议 --max-cost 设定上限）');
    if (context.json) printJson(context.io, { type: 'error', code: 'CONFIRMATION_REQUIRED', message: '需要 --yes' });
    return EXIT.REFUSED;
  }

  const client = await connect(context);

  // --ref 本地路径：先经 /v1/uploads 显式转存（规避白名单问题，等价 App 内 stageLocal）
  const referenceImagePaths: string[] = [];
  const refs = typeof flags.ref === 'string' ? flags.ref.split(',') : [];
  for (const ref of refs) {
    const bytes = readFileSync(ref);
    const uploaded = await client.uploadImage(bytes, basename(ref), mimeTypeFor(ref));
    referenceImagePaths.push(uploaded.image.path);
  }

  const body: Record<string, unknown> = {
    prompt,
    ...(typeof flags.provider === 'string' ? { providerId: flags.provider } : {}),
    ...(typeof flags.model === 'string' ? { model: flags.model } : {}),
    ...(typeof flags.ratio === 'string' ? { aspectRatio: flags.ratio } : {}),
    ...(typeof flags.n === 'string' ? { n: Number(flags.n) } : {}),
    ...(typeof flags.quality === 'string' ? { quality: flags.quality } : {}),
    ...(typeof flags.background === 'string' ? { background: flags.background } : {}),
    ...(typeof flags.negative === 'string' ? { negative: flags.negative } : {}),
    ...(referenceImagePaths.length ? { referenceImagePaths } : {}),
    ...(typeof flags['ref-history'] === 'string' ? { referenceHistoryIds: flags['ref-history'].split(',') } : {}),
  };

  // 估算 + 确认（TTY 且未 --yes 时询问；--yes/确认通过 = 交互同意放行）
  const estimate = await client.estimateGeneration(body);
  const costLabel = estimate.points != null ? `${estimate.points} 积分` : '未知（未配置单价）';
  if (context.maxCostPoints != null && estimate.points != null && estimate.points > context.maxCostPoints) {
    context.io.stderr(`musefold: 预估成本 ${costLabel} 超过 --max-cost 上限，已取消`);
    if (context.json) printJson(context.io, { type: 'error', code: 'BUDGET_EXCEEDED', message: '超出 --max-cost' });
    return EXIT.BUDGET;
  }
  if (!context.yes) {
    const approved = await generateIo.askYesNo(
      `将用 ${estimate.providerName} · ${estimate.model} 生成 ${estimate.n} 张，预估 ${costLabel}，继续？`,
    );
    if (!approved) {
      context.io.stderr('musefold: 已取消');
      if (context.json) printJson(context.io, { type: 'error', code: 'CONFIRMATION_DENIED', message: '用户取消' });
      return EXIT.REFUSED;
    }
  }
  body.consent = 'interactive';
  if (context.maxCostPoints != null) body.declaredBudgetPoints = context.maxCostPoints;

  let lastPhase = '';
  const noWait = flags['no-wait'] === true;
  const submitted = await client.startGeneration(body);

  if (noWait) {
    if (context.json) printJson(context.io, { type: 'result', jobId: submitted.jobId, status: submitted.status });
    else context.io.stdout(submitted.jobId);
    return EXIT.OK;
  }

  // Ctrl-C：先发取消再退出（exit 130）
  const offInterrupt = generateIo.onInterrupt(() => {
    void client.cancelGeneration(submitted.jobId).finally(() => process.exit(EXIT.INTERRUPTED));
  });

  try {
    const detail = await client.waitForGeneration(submitted.jobId, {
      onEvent: (event) => {
        if (event.type !== 'generation.progress') return;
        const payload = event.payload as { phase?: string; percent?: number; jobId?: string };
        if (context.json) printJson(context.io, { type: 'progress', ...payload });
        else if (payload.phase && payload.phase !== lastPhase) {
          lastPhase = payload.phase;
          context.io.stderr(`musefold: ${payload.phase}…`);
        }
      },
    });

    const assets = detail.assets ?? [];
    // -o：复制产物到目标目录（账本仍指向受管路径）
    const outDir = typeof flags.out === 'string' ? flags.out : null;
    const copied: string[] = [];
    if (outDir && assets.length) {
      mkdirSync(outDir, { recursive: true });
      for (const asset of assets) {
        const target = join(outDir, basename(asset.path));
        copyFileSync(asset.path, target);
        copied.push(target);
      }
    }

    if (context.json) {
      printJson(context.io, {
        type: 'result',
        jobId: detail.jobId,
        historyId: detail.historyId,
        status: detail.status,
        assets: (copied.length ? copied : assets.map((asset) => asset.path)).map((path) => ({ path })),
        costPoints: detail.costPoints ?? detail.cost ?? null,
        cost: detail.cost ?? null,
        costUnit: 'point',
        durationMs: detail.durationMs ?? null,
        actualSize: detail.actualSize ?? null,
        sizeMismatch: detail.sizeMismatch ?? null,
        ...(detail.error ? { error: detail.error } : {}),
      });
    } else if (detail.status === 'success') {
      for (const path of copied.length ? copied : assets.map((asset) => asset.path)) context.io.stdout(path);
      const costLabel = formatCliCost(detail);
      if (costLabel) context.io.stderr(`musefold: 成本 ${costLabel}`);
      if (detail.sizeMismatch) {
        context.io.stderr(`musefold: 返回尺寸 ${detail.sizeMismatch.actual} 与请求 ${detail.sizeMismatch.expected} 不一致`);
      }
    } else {
      context.io.stderr(`musefold: 生成${detail.status === 'cancelled' ? '已取消' : '失败'}${detail.error ? `：${detail.error.message}` : ''}`);
    }
    if (detail.status === 'success') return EXIT.OK;
    if (detail.status === 'cancelled') return EXIT.INTERRUPTED;
    return detail.error?.code?.startsWith('PROVIDER') || detail.error?.code === 'AUTH' ? EXIT.PROVIDER : EXIT.GENERAL;
  } finally {
    offInterrupt();
  }
}
