// musefold generate 测试（V04-CLI-02）：对着真实闸门（假生图宿主）验证
// NDJSON 契约、退出码矩阵、--no-wait、--max-cost、-o 复制。

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import type { GenerateImageResult } from '@musefold/desktop-contracts/providers';
import {
  createAutomationServer,
  createGenerationGate,
  type AutomationServer,
  type AutomationServerInfo,
} from '@musefold/automation-server';
import { runCli, EXIT } from '../index';

let root: string;
let server: AutomationServer;
let info: AutomationServerInfo;
let assetPath: string;
const runSpy = vi.fn();

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) } };
}

function run(argv: string[], io: ReturnType<typeof capture>) {
  return runCli([...argv, '--endpoint', `http://127.0.0.1:${info.port}`, '--token', info.token], io.io, {});
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-cli-gen-'));
  assetPath = join(root, 'artifact.png');
  writeFileSync(assetPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const hub = createEventHub();
  const gate = createGenerationGate(
    {
      run: runSpy.mockImplementation(async (req: { jobId?: string }, onProgress: (p: unknown) => void): Promise<GenerateImageResult> => {
        onProgress({ phase: 'generating', percent: 50 });
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { historyId: req.jobId ?? 'his-x', status: 'success', imagePath: assetPath, cost: 18, durationMs: 30 };
      }),
      cancel: vi.fn(() => true),
      estimate: vi.fn(() => ({ points: 18, managedByAccount: true, providerId: 'prov', providerName: '测试站', model: 'gpt-image-2', n: 1 })),
      budget: { remainingPoints: () => 0, settle: vi.fn() },
      requestConfirmation: vi.fn(async () => 'denied' as const),
      authorizeReferencePath: () => true,
      stageUpload: vi.fn(async (bytes: Buffer, name: string) => ({
        path: join(root, name), name, source: 'upload' as const, mimeType: 'image/png' as const, sizeBytes: bytes.length,
      })),
      resolveHistoryImage: () => null,
    },
    hub,
  );

  server = createAutomationServer({
    core: { version: '0.1.0', status: { snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }) } },
    events: hub,
    dataDir: root,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    routes: gate.routes,
  });
  info = await server.start();
});

afterAll(async () => {
  await server.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('musefold generate', () => {
  it('-y --json：交互同意放行（预算 0 也不弹确认），末行 result 带产物与成本', async () => {
    const io = capture();
    const code = await run(['generate', '-p', '一张测试图', '-y', '--json'], io);
    expect(code).toBe(EXIT.OK);
    const lines = io.stdout.map((line) => JSON.parse(line));
    const result = lines.at(-1);
    expect(result).toMatchObject({ type: 'result', status: 'success', costPoints: 18 });
    expect(result.assets[0].path).toBe(assetPath);
  });

  it('多图 Provider：JSON 结果保留全部 assets', async () => {
    const paths = [assetPath, `${assetPath}-2`, `${assetPath}-3`, `${assetPath}-4`];
    runSpy.mockImplementationOnce(async (req: { jobId?: string }, onProgress: (p: unknown) => void): Promise<GenerateImageResult> => {
      onProgress({ phase: 'generating', percent: 50 });
      return {
        historyId: req.jobId ?? 'his-multi',
        status: 'success',
        imagePath: paths[0],
        images: paths.map((imagePath) => ({ imagePath })),
        cost: 0,
        durationMs: 30,
      };
    });
    const io = capture();
    const code = await run(['generate', '-p', '豆包四图', '-y', '--json'], io);
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(io.stdout.at(-1)!).assets).toEqual(paths.map((path) => ({ path })));
  });

  it('--ratio 传入控制面时会映射成对应 OpenAI 像素尺寸', async () => {
    const io = capture();
    const code = await run(['generate', '-p', '宽图测试', '-y', '--ratio', '16:9'], io);
    expect(code).toBe(EXIT.OK);
    expect(runSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      size: '1536x1024',
      aspectRatio: '16:9',
    });
  });

  it('账号成本在人类输出中使用积分', async () => {
    runSpy.mockImplementationOnce(async (req: { jobId?: string }, onProgress: (p: unknown) => void): Promise<GenerateImageResult> => {
      onProgress({ phase: 'generating', percent: 50 });
      return {
        historyId: req.jobId ?? 'his-account',
        status: 'success',
        imagePath: assetPath,
        cost: 1.2,
        costUnit: 'point',
        costPoints: 1.2,
        durationMs: 30,
      };
    });
    const io = capture();
    const code = await run(['generate', '-p', '账号点数', '-y'], io);
    expect(code).toBe(EXIT.OK);
    expect(io.stderr.join('\n')).toContain('成本 1.2 积分');
  });

  it('账号 JSON 只返回积分口径', async () => {
    runSpy.mockImplementationOnce(async (req: { jobId?: string }, onProgress: (p: unknown) => void): Promise<GenerateImageResult> => {
      onProgress({ phase: 'generating', percent: 50 });
      return {
        historyId: req.jobId ?? 'his-account-json',
        status: 'success',
        imagePath: assetPath,
        cost: 1.2,
        costUnit: 'point',
        costPoints: 1.2,
        durationMs: 30,
      };
    });
    const io = capture();
    const code = await run(['generate', '-p', '账号点数 JSON', '-y', '--json'], io);
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(io.stdout.at(-1)!)).toMatchObject({
      type: 'result',
      status: 'success',
      costPoints: 1.2,
      cost: 1.2,
      costUnit: 'point',
    });
  });

  it('非 TTY 且无 -y：exit 4，未发起任何网络调用', async () => {
    const before = runSpy.mock.calls.length;
    const io = capture();
    const code = await run(['generate', '-p', '未授权'], io);
    expect(code).toBe(EXIT.REFUSED);
    expect(runSpy.mock.calls.length).toBe(before);
    expect(io.stderr.join()).toContain('--yes');
  });

  it('--max-cost 低于估算：exit 5（BUDGET）', async () => {
    const io = capture();
    const code = await run(['generate', '-p', '超预算', '-y', '--max-cost', '10', '--json'], io);
    expect(code).toBe(EXIT.BUDGET);
    expect(JSON.parse(io.stdout.at(-1)!)).toMatchObject({ type: 'error', code: 'BUDGET_EXCEEDED' });
  });

  it('--no-wait：受理即返回 jobId', async () => {
    const io = capture();
    const code = await run(['generate', '-p', '异步任务', '-y', '--no-wait'], io);
    expect(code).toBe(EXIT.OK);
    expect(io.stdout[0]).toBeTruthy();
  });

  it('-o 复制产物到目标目录', async () => {
    const outDir = join(root, 'out');
    const io = capture();
    const code = await run(['generate', '-p', '导出到目录', '-y', '-o', outDir], io);
    expect(code).toBe(EXIT.OK);
    expect(io.stdout[0]).toBe(join(outDir, 'artifact.png'));
    expect(readFileSync(io.stdout[0]).length).toBeGreaterThan(0);
  });

  it('缺提示词：exit 2', async () => {
    const io = capture();
    expect(await run(['generate', '-y'], io)).toBe(EXIT.ARGS);
  });

  it('cancel 命令对任务发出取消', async () => {
    const started = capture();
    await run(['generate', '-p', '将被取消', '-y', '--no-wait'], started);
    const jobId = started.stdout[0];
    const io = capture();
    expect(await run(['cancel', jobId], io)).toBe(EXIT.OK);
    expect(io.stdout.join()).toContain(jobId);
  });
});
