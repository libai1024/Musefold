// GenerationService 错误脱敏（core/Desktop 边界）聚焦测试：
// 无论 Provider 是 throw 还是返回 failed 结果，渲染层 GenerateImageResult
// 与账本 error_message 都只能落「有界、用户安全」的消息；错误码分类保持稳定。

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureTestCoreRuntime } from '../../testing';

const root = mkdtempSync(join(tmpdir(), 'musefold-generation-sanitize-'));
const doubaoRuntime = {
  validate: vi.fn(),
  generateImage: vi.fn(),
};
configureTestCoreRuntime(root, { doubaoWeb: doubaoRuntime });

import { closeDb, getDb, initDb } from '../../db/index';
import { createWorkbenchRepositories } from '../../db/repositories/workbench';
import { generate } from '../generation';

const SENSITIVE_THROWN =
  'upstream rejected Bearer sk-AAAABBBBCCCC12345678, trace https://relay.test/v1/images?X-Amz-Signature=deadbeefcafe1234deadbeefcafe1234 and /Users/wangwei/Library/Application Support/musefold/main.log';
const SENSITIVE_RESULT =
  '下载失败 https://lf-cdn.example.com/a.png?token=abcdefghij1234567890abcdefghij，本地缓存 /Users/wangwei/.musefold/cache/a.png 已损坏';

function baseRequest(jobId: string, providerId: string) {
  return {
    jobId,
    providerId,
    prompt: '一张测试图片',
    size: '1024x1024' as const,
    quality: 'medium' as const,
    n: 1,
  };
}

beforeAll(() => {
  initDb();
  getDb()
    .prepare(
      `INSERT INTO providers
       (id, name, type, base_url, model, has_key, is_active, created_at, updated_at)
     VALUES ('doubao-test', '豆包测试', 'doubao-web', 'https://www.doubao.com/chat/create-image',
       'seedream-4.5', 1, 1, 1, 1)`,
    )
    .run();
  getDb()
    .prepare(
      `INSERT INTO providers
       (id, name, type, base_url, model, has_key, is_active, created_at, updated_at, managed_by)
     VALUES ('account-test', '托管服务', 'musefold-cloud', 'https://cloud.example.invalid',
       'musefold-image-pro', 0, 0, 1, 1, 'account')`,
    )
    .run();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  closeDb();
  rmSync(root, { recursive: true, force: true });
});

function expectSanitized(message: string | null | undefined): void {
  expect(message).toBeTruthy();
  expect(message).not.toContain('sk-AAAABBBBCCCC12345678');
  expect(message).not.toContain('Bearer sk-');
  expect(message).not.toContain('X-Amz-Signature');
  expect(message).not.toContain('token=');
  expect(message).not.toContain('/Users/wangwei');
  expect(message?.length ?? 0).toBeLessThanOrEqual(500);
}

describe('generation error sanitization', () => {
  it('sanitizes thrown provider errors for both the result and the ledger', async () => {
    doubaoRuntime.generateImage.mockRejectedValueOnce(
      Object.assign(new Error(SENSITIVE_THROWN), { code: 'AUTH', status: 401 }),
    );

    const result = await generate(baseRequest('sanitize-thrown', 'doubao-test'));

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('AUTH');
    expectSanitized(result.error?.message);
    const run = createWorkbenchRepositories().runs.get('sanitize-thrown');
    expect(run?.status).toBe('failed');
    expect(run?.errorCode).toBe('AUTH');
    expectSanitized(run?.errorMessage);
  });

  it('sanitizes provider-returned failed results for both the result and the ledger', async () => {
    doubaoRuntime.generateImage.mockResolvedValueOnce({
      historyId: 'sanitize-result',
      status: 'failed',
      error: { code: 'NO_BALANCE', message: SENSITIVE_RESULT },
    });

    const result = await generate(baseRequest('sanitize-result', 'doubao-test'));

    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('NO_BALANCE');
    expectSanitized(result.error?.message);
    const run = createWorkbenchRepositories().runs.get('sanitize-result');
    expect(run?.errorCode).toBe('NO_BALANCE');
    expectSanitized(run?.errorMessage);
  });

  it('keeps authorized account-transport error mapping intact while sanitizing the message', async () => {
    const result = await generate(baseRequest('sanitize-account', 'account-test'), undefined, {
      transport: {
        providerId: 'account-test',
        assertCurrent: () => undefined,
        generate: async () => {
          throw Object.assign(new Error(SENSITIVE_THROWN), { code: 'NO_BALANCE', status: 402 });
        },
      },
    });

    expect(result.status).toBe('failed');
    // managed_by=account 的上游 NO_BALANCE 稳定映射为 ACCOUNT/QUOTA。
    expect(result.error?.code).toBe('ACCOUNT/QUOTA');
    expectSanitized(result.error?.message);
    expect(createWorkbenchRepositories().runs.get('sanitize-account')?.errorCode).toBe(
      'ACCOUNT/QUOTA',
    );
  });

  it('bounds oversize provider messages instead of persisting them in full', async () => {
    doubaoRuntime.generateImage.mockRejectedValueOnce(
      Object.assign(new Error(`模型返回异常：${'detail '.repeat(400)}`), { code: 'SERVER' }),
    );

    const result = await generate(baseRequest('sanitize-truncate', 'doubao-test'));

    expect(result.error?.code).toBe('SERVER');
    expect(result.error?.message?.length).toBeLessThanOrEqual(500);
    expect(
      createWorkbenchRepositories().runs.get('sanitize-truncate')?.errorMessage?.length,
    ).toBeLessThanOrEqual(500);
  });

  it('keeps ordinary user-friendly failures readable', async () => {
    doubaoRuntime.generateImage.mockRejectedValueOnce(
      Object.assign(new Error('余额不足，请充值后重试'), { code: 'NO_BALANCE' }),
    );

    const result = await generate(baseRequest('sanitize-friendly', 'doubao-test'));

    expect(result.error).toEqual({ code: 'NO_BALANCE', message: '余额不足，请充值后重试' });
  });
});
