import { describe, expect, it, vi } from 'vitest';
import { createEventHub } from '../events';
import { createMusefoldCore } from '../core';
import type { CoreOptions, SecretsPort } from '../ports';

function fakeSecrets(): SecretsPort {
  return {
    getProviderKey: async () => null,
    setProviderKey: async () => undefined,
    deleteProviderKey: async () => undefined,
    getAiConnectionKey: async () => null,
    setAiConnectionKey: async () => undefined,
    deleteAiConnectionKey: async () => undefined,
  };
}

function fakeOptions(): CoreOptions {
  return {
    paths: { dataDir: '/tmp/musefold-test', picturesDir: '/tmp/musefold-test/Pictures', logsDir: '/tmp/musefold-test/logs' },
    secrets: fakeSecrets(),
    events: { emit: () => undefined },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe('createMusefoldCore（骨架）', () => {
  it('组装后暴露版本与路径端口', () => {
    const core = createMusefoldCore(fakeOptions());
    expect(core.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(core.paths.dataDir).toBe('/tmp/musefold-test');
    expect(core.disposed).toBe(false);
  });

  it('dispose 幂等', () => {
    const options = fakeOptions();
    const core = createMusefoldCore(options);
    core.dispose();
    core.dispose();
    expect(core.disposed).toBe(true);
    // 就绪 + 释放各记一条，重复 dispose 不再记
    expect(options.logger.info).toHaveBeenCalledTimes(2);
  });
});

describe('createEventHub', () => {
  it('sink 发出的事件广播给所有订阅者，退订即停', () => {
    const hub = createEventHub();
    const a = vi.fn();
    const b = vi.fn();
    const offA = hub.subscribe(a);
    hub.subscribe(b);

    hub.sink.emit({ type: 'generation.progress', payload: { percent: 42 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    hub.sink.emit({ type: 'generation.completed', payload: {} });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('单个订阅者抛错不影响其他订阅者（SSE 半关闭场景）', () => {
    const hub = createEventHub();
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    hub.subscribe(bad);
    hub.subscribe(good);
    hub.sink.emit({ type: 'scheme.run.step', payload: null });
    expect(good).toHaveBeenCalledTimes(1);
  });
});
