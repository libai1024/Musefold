import { describe, expect, it } from 'vitest';
import { skillRuntimePolicyForProvider } from '../skill-runtime-policy';

describe('skillRuntimePolicyForProvider', () => {
  it('forces pasted Skills to bypass Agent for Doubao web', () => {
    expect(skillRuntimePolicyForProvider('doubao-web')).toBe('direct-forward');
  });

  it('keeps the existing Agent-first behavior for other providers', () => {
    expect(skillRuntimePolicyForProvider('openai-compatible')).toBe('agent-preferred');
    expect(skillRuntimePolicyForProvider(null)).toBe('agent-preferred');
  });
});
