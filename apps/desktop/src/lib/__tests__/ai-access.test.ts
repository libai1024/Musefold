import { describe, expect, it, vi } from 'vitest';
import {
  accessModeOfProvider,
  accessSourceOf,
  accountImageSourceOfProvider,
  preferredByokEntry,
  verifyAiAccessConnectivity,
} from '../ai-access';

describe('AI access source helpers', () => {
  it('separates account-managed and self-provided entries', () => {
    expect(accessSourceOf({ managedBy: 'account' })).toBe('account');
    expect(accessSourceOf({ managedBy: null })).toBe('byok');
    expect(accessSourceOf(null)).toBeNull();
  });

  it('treats Doubao and official providers as account mode', () => {
    expect(accessModeOfProvider({ type: 'doubao-web', managedBy: null })).toBe('account');
    expect(accessModeOfProvider({ type: 'openai-compatible', managedBy: 'account' })).toBe('account');
    expect(accessModeOfProvider({ type: 'openai-compatible', managedBy: null })).toBe('relay');
    expect(accessModeOfProvider(null)).toBeNull();
  });

  it('identifies the selected account image source from the active provider', () => {
    expect(accountImageSourceOfProvider({ type: 'doubao-web', managedBy: null })).toBe('doubao');
    expect(accountImageSourceOfProvider({ type: 'openai-compatible', managedBy: 'account' })).toBe('official');
    expect(accountImageSourceOfProvider({ type: 'openai-compatible', managedBy: null })).toBeNull();
  });

  it('restores the most recent usable self-provided service', () => {
    const selected = preferredByokEntry([
      { id: 'managed', managedBy: 'account' as const, hasKey: true, updatedAt: 100 },
      { id: 'old-ready', managedBy: null, hasKey: true, updatedAt: 20 },
      { id: 'new-missing-key', managedBy: null, hasKey: false, updatedAt: 50 },
      { id: 'new-ready', managedBy: null, hasKey: true, updatedAt: 40 },
    ]);

    expect(selected?.id).toBe('new-ready');
  });

  it('returns the most recent incomplete entry when none has a key', () => {
    const selected = preferredByokEntry([
      { id: 'older', managedBy: null, hasKey: false, updatedAt: 10 },
      { id: 'newer', managedBy: null, hasKey: false, updatedAt: 30 },
    ]);

    expect(selected?.id).toBe('newer');
  });

  it('accepts the target only after every connectivity check passes', async () => {
    const image = vi.fn(async () => ({ ok: true }));
    const agent = vi.fn(async () => ({ ok: true }));

    await expect(verifyAiAccessConnectivity([
      { label: '生图', run: image },
      { label: 'Agent', run: agent },
    ])).resolves.toBeUndefined();
    expect(image).toHaveBeenCalledOnce();
    expect(agent).toHaveBeenCalledOnce();
  });

  it('runs every check and reports all failed target channels', async () => {
    const image = vi.fn(async () => ({ ok: false, message: '模型不可用' }));
    const agent = vi.fn(async () => {
      throw new Error('网关超时');
    });

    await expect(verifyAiAccessConnectivity([
      { label: '生图', run: image },
      { label: 'Agent', run: agent },
    ])).rejects.toThrow('生图：模型不可用；Agent：网关超时');
    expect(image).toHaveBeenCalledOnce();
    expect(agent).toHaveBeenCalledOnce();
  });
});
