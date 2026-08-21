import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '' } }));

import { hasPersistedOsCryptKey, waitForPersistedOsCryptKey } from '../os-crypt-durability';

let dir: string;
let localState: string;

function writeLocalState(payload: unknown): void {
  writeFileSync(localState, JSON.stringify(payload), 'utf8');
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'musefold-local-state-'));
  localState = join(dir, 'Local State');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('os_crypt 主密钥落盘探测', () => {
  it('文件缺席、JSON 损坏、缺少 encrypted_key 一律算未落盘', () => {
    expect(hasPersistedOsCryptKey(localState)).toBe(false);

    writeFileSync(localState, '{"os_crypt":', 'utf8'); // ImportantFileWriter 换名窗口
    expect(hasPersistedOsCryptKey(localState)).toBe(false);

    writeLocalState({ os_crypt: { audit_enabled: true } });
    expect(hasPersistedOsCryptKey(localState)).toBe(false);

    writeLocalState({ os_crypt: { encrypted_key: '' } });
    expect(hasPersistedOsCryptKey(localState)).toBe(false);
  });

  it('DPAPI 密钥已写入时算落盘', () => {
    writeLocalState({ os_crypt: { encrypted_key: 'RFBBUEkBAAAA', audit_enabled: true } });
    expect(hasPersistedOsCryptKey(localState)).toBe(true);
  });
});

describe('等待主密钥落盘', () => {
  it('Chromium 的提交定时器到期后返回 true，且不再空转', () => {
    let elapsed = 0;
    let slept = 0;
    const result = waitForPersistedOsCryptKey({
      localStatePath: localState,
      budgetMs: 20_000,
      pollIntervalMs: 100,
      now: () => elapsed,
      sleep: (ms) => {
        elapsed += ms;
        slept += 1;
        // 模拟 Chromium 在 10s 时提交 Local State。
        if (elapsed >= 10_000) writeLocalState({ os_crypt: { encrypted_key: 'RFBBUEk=' } });
      },
    });

    expect(result).toBe(true);
    expect(slept).toBe(100); // 10s / 100ms，等到即停
  });

  it('已经落盘时一次都不睡', () => {
    writeLocalState({ os_crypt: { encrypted_key: 'RFBBUEk=' } });
    const sleep = vi.fn();
    expect(waitForPersistedOsCryptKey({ localStatePath: localState, sleep })).toBe(true);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('超时返回 false 而不是抛错——挡住保存比丢一次密钥更糟', () => {
    let elapsed = 0;
    const result = waitForPersistedOsCryptKey({
      localStatePath: localState,
      budgetMs: 1_000,
      pollIntervalMs: 100,
      now: () => elapsed,
      sleep: (ms) => {
        elapsed += ms;
      },
    });
    expect(result).toBe(false);
  });
});
