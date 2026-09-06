'use client';

import { useCallback, useState } from 'react';

/**
 * 脏表单关闭守卫(与 PromptEditorDialog 同方案):Esc / 点外 / X / 取消统一走 requestClose。
 * clean 直接关;dirty 弹出「放弃修改?」。
 */
export function useDiscardGuard(dirty: boolean) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestClose = useCallback(
    (close: () => void) => {
      if (!dirty) {
        close();
        return;
      }
      setConfirmOpen(true);
    },
    [dirty],
  );

  const confirmDiscard = useCallback((close: () => void) => {
    setConfirmOpen(false);
    close();
  }, []);

  return { confirmOpen, setConfirmOpen, requestClose, confirmDiscard };
}
