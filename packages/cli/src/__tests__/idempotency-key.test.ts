// 幂等键 CLI 透传测试（GAPX/GAP-B1）：--idempotency-key 在 generate（G）/ scheme run（R）/
// skill run（S）三个写入口透传为 Idempotency-Key header；G 走真实闸门钉死
// 同键同输入重放不重发、同键异输入 409、无键保持既有行为；R/S 用桩路由钉死 header 契约。

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEventHub } from '@musefold/core';
import type { GenerateImageResult } from '@musefold/desktop-contracts/providers';
import {
  createAutomationServer,
  createGenerationGate,
  type AutomationRouteContext,
  type AutomationServer,
  type AutomationServerInfo,
} from '@musefold/automation-server';
import { runCli, EXIT } from '../index';

let root: string;
let server: AutomationServer;
let info: AutomationServerInfo;
const runSpy = vi.fn();

/** R/S 提交的 header + body 快照（R/S 重放语义归桌面持久层，这里只钉客户端契约） */
const schemeRuns: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];
const skillRuns: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];

function firstHeader(context: AutomationRouteContext, name: string): string | undefined {
  const value = context.request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (l: string) => stdout.push(l), stderr: (l: string) => stderr.push(l) },
  };
}

function run(argv: string[], io: ReturnType<typeof capture>) {
  return runCli(
    [...argv, '--endpoint', `http://127.0.0.1:${info.port}`, '--token', info.token],
    io.io,
    {},
  );
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'musefold-cli-idem-'));

  const hub = createEventHub();
  const gate = createGenerationGate(
    {
      run: runSpy.mockImplementation(
        async (
          req: { jobId?: string },
          onProgress: (p: unknown) => void,
        ): Promise<GenerateImageResult> => {
          onProgress({ phase: 'generating', percent: 50 });
          return {
            historyId: req.jobId ?? 'his-idem',
            status: 'success',
            imagePath: join(root, 'out.png'),
            cost: 18,
            durationMs: 5,
          };
        },
      ),
      cancel: vi.fn(() => true),
      estimate: vi.fn(() => ({
        points: 18,
        managedByAccount: true,
        providerId: 'prov',
        providerName: '幂等测试站',
        model: 'gpt-image-2',
        n: 1,
      })),
      budget: { remainingPoints: () => 10_000, settle: vi.fn() },
      requestConfirmation: vi.fn(async () => 'approved' as const),
      authorizeReferencePath: () => true,
      stageUpload: vi.fn(async (bytes: Buffer, name: string) => ({
        path: join(root, name),
        name,
        source: 'upload' as const,
        mimeType: 'image/png' as const,
        sizeBytes: bytes.length,
      })),
      resolveHistoryImage: () => null,
    },
    hub,
  );

  server = createAutomationServer({
    core: {
      version: '0.1.0',
      status: {
        snapshot: () => ({ prompts: 0, formalSchemes: 0, providers: 0, activeProviderId: null }),
      },
    },
    events: hub,
    dataDir: root,
    owner: 'desktop-app',
    appVersion: '0.4.0-dev',
    rateLimit: 1000,
    generationRateLimit: 1000,
    routes: {
      ...gate.routes,
      'POST /v1/schemes/:id/runs': (context) => {
        schemeRuns.push({
          key: firstHeader(context, 'idempotency-key'),
          body: context.body as Record<string, unknown>,
        });
        return { jobId: `sch-${schemeRuns.length}`, status: 'running' };
      },
      'GET /v1/scheme-runs/:id': ({ params }) => ({
        jobId: params.id,
        status: 'success',
        assets: [],
      }),
      'POST /v1/skills/github/run': (context) => {
        skillRuns.push({
          key: firstHeader(context, 'idempotency-key'),
          body: context.body as Record<string, unknown>,
        });
        return { jobId: `skl-${skillRuns.length}`, status: 'running' };
      },
      'GET /v1/skill-runs/:id': ({ params }) => ({
        jobId: params.id,
        status: 'success',
        assets: [],
      }),
    },
  });
  info = await server.start();
});

afterAll(async () => {
  await server.stop();
  rmSync(root, { recursive: true, force: true });
});

describe('musefold --idempotency-key（G：真实闸门）', () => {
  it('同键同输入两次提交：重放原任务，Provider 只执行一次', async () => {
    const first = capture();
    expect(
      await run(
        [
          'generate',
          '-p',
          '幂等重放',
          '-y',
          '--json',
          '--no-wait',
          '--idempotency-key',
          'gen-key-1',
        ],
        first,
      ),
    ).toBe(EXIT.OK);
    const replay = capture();
    expect(
      await run(
        [
          'generate',
          '-p',
          '幂等重放',
          '-y',
          '--json',
          '--no-wait',
          '--idempotency-key',
          'gen-key-1',
        ],
        replay,
      ),
    ).toBe(EXIT.OK);
    const firstJob = JSON.parse(first.stdout.at(-1)!).jobId;
    const replayJob = JSON.parse(replay.stdout.at(-1)!).jobId;
    expect(replayJob).toBe(firstJob);
    expect(runSpy).toHaveBeenCalledOnce();
  });

  it('同键异输入：409 IDEMPOTENCY_CONFLICT，exit 1', async () => {
    const first = capture();
    expect(
      await run(
        ['generate', '-p', '原始意图', '-y', '--no-wait', '--idempotency-key', 'gen-key-2'],
        first,
      ),
    ).toBe(EXIT.OK);
    const conflict = capture();
    expect(
      await run(
        [
          'generate',
          '-p',
          '换了个意图',
          '-y',
          '--json',
          '--no-wait',
          '--idempotency-key',
          'gen-key-2',
        ],
        conflict,
      ),
    ).toBe(EXIT.GENERAL);
    expect(JSON.parse(conflict.stdout.at(-1)!)).toMatchObject({
      type: 'error',
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('无键兼容：两次相同提交各自执行（键不代生成）', async () => {
    const before = runSpy.mock.calls.length;
    for (const prompt of ['无键甲', '无键乙']) {
      const io = capture();
      expect(await run(['generate', '-p', prompt, '-y', '--json', '--no-wait'], io)).toBe(EXIT.OK);
      expect(JSON.parse(io.stdout.at(-1)!).jobId).toBeTruthy();
    }
    expect(runSpy.mock.calls.length).toBe(before + 2);
  });
});

describe('musefold --idempotency-key（R/S：header 透传）', () => {
  it('scheme run 带 --idempotency-key：作为 Idempotency-Key header 送达，不混入 body', async () => {
    const io = capture();
    expect(
      await run(
        [
          'scheme',
          'run',
          'scheme-x',
          '--input',
          'a=b',
          '-y',
          '--no-wait',
          '--idempotency-key',
          'r-key-1',
        ],
        io,
      ),
    ).toBe(EXIT.OK);
    expect(schemeRuns.at(-1)?.key).toBe('r-key-1');
    expect(schemeRuns.at(-1)?.body).toMatchObject({ inputs: { a: 'b' }, consent: 'interactive' });
    expect(schemeRuns.at(-1)?.body).not.toHaveProperty('idempotencyKey');
  });

  it('scheme run 不带键：header 缺席（既有无键行为）', async () => {
    const io = capture();
    expect(await run(['scheme', 'run', 'scheme-x', '-y', '--no-wait'], io)).toBe(EXIT.OK);
    expect(schemeRuns.at(-1)?.key).toBeUndefined();
  });

  it('skill run 带 --idempotency-key：作为 Idempotency-Key header 送达', async () => {
    const io = capture();
    expect(
      await run(
        [
          'skill',
          'run',
          'https://github.com/musefold/example',
          '-p',
          '样张',
          '-y',
          '--no-wait',
          '--idempotency-key',
          's-key-1',
        ],
        io,
      ),
    ).toBe(EXIT.OK);
    expect(skillRuns.at(-1)?.key).toBe('s-key-1');
    expect(skillRuns.at(-1)?.body).toMatchObject({
      url: 'https://github.com/musefold/example',
      prompt: '样张',
      consent: 'interactive',
    });
  });

  it('skill run 不带键：header 缺席（既有无键行为）', async () => {
    const io = capture();
    expect(
      await run(
        ['skill', 'run', 'https://github.com/musefold/example', '-p', '样张', '-y', '--no-wait'],
        io,
      ),
    ).toBe(EXIT.OK);
    expect(skillRuns.at(-1)?.key).toBeUndefined();
  });
});
