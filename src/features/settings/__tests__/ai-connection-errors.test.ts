import { describe, expect, it } from 'vitest';
import {
  AI_CONNECTION_RESTART_REQUIRED,
  aiConnectionErrorMessage,
  isAiConnectionRuntimeMismatch,
} from '../ai-connection-errors';

describe('AI connection IPC runtime errors', () => {
  it('turns stale main-process handler errors into an actionable message', () => {
    const error = new Error(
      "Error invoking remote method 'aiConnection:create': Error: No handler registered for 'aiConnection:create'",
    );

    expect(isAiConnectionRuntimeMismatch(error)).toBe(true);
    expect(aiConnectionErrorMessage(error, '保存失败')).toBe(AI_CONNECTION_RESTART_REQUIRED);
  });

  it('preserves ordinary provider errors', () => {
    const error = new Error('模型不存在');
    expect(isAiConnectionRuntimeMismatch(error)).toBe(false);
    expect(aiConnectionErrorMessage(error, '连接失败')).toBe('模型不存在');
  });
});
