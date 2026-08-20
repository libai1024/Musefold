import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_SESSION_RESTART_REQUIRED,
  isWorkbenchSessionRuntimeMismatch,
  workbenchSessionErrorMessage,
} from '../sessionErrors';

describe('workbench session IPC runtime errors', () => {
  it('turns a stale main-process handler error into a restart instruction', () => {
    const error = new Error(
      "Error invoking remote method 'workbenchSession:list': Error: No handler registered for 'workbenchSession:list'",
    );

    expect(isWorkbenchSessionRuntimeMismatch(error)).toBe(true);
    expect(workbenchSessionErrorMessage(error, '加载对话失败'))
      .toBe(WORKBENCH_SESSION_RESTART_REQUIRED);
  });

  it('preserves ordinary session errors', () => {
    const error = new Error('对话数据库暂时不可用');
    expect(isWorkbenchSessionRuntimeMismatch(error)).toBe(false);
    expect(workbenchSessionErrorMessage(error, '加载对话失败')).toBe('对话数据库暂时不可用');
  });
});
