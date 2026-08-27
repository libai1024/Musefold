// 设置 · 开放能力页统一剪贴板 helper:token 与接入片段复制共用同一标准
// (对照 ConnectedAppsScreen.copyServerUrl):失败 toast 提示、不静默;成功反馈自动消退。
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../../../stores/toast';

const COPY_FEEDBACK_MS = 1500;

export interface CopyWithFeedback {
  /** 当前刚复制成功的 key('token' / 'cursor' / 'codex' / 'claude' / 'skill-url'),1.5s 后回落 null。 */
  copiedKey: string | null;
  /** 复制文本;失败时 toast 提示且不置位 copiedKey。 */
  copy: (key: string, text: string) => Promise<void>;
}

export function useCopyWithFeedback(): CopyWithFeedback {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // unmount 时清理定时器,避免卸载后 setState。
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.error('复制失败', '无法访问剪贴板,请重试或手动复制');
      return;
    }
    setCopiedKey(key);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopiedKey(null), COPY_FEEDBACK_MS);
  }, []);

  return { copiedKey, copy };
}
