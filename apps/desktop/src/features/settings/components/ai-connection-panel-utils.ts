// src/features/settings/components/ai-connection-panel-utils.ts
// Agent 中转站详情面板的纯函数与错误上报(自 AiConnectionDialog 迁入,行为不变)。

import type {
  AiConnectionValidationResult,
  AiTextModelInfo,
} from '@musefold/desktop-contracts/ai';
import { desktopHost as api } from '@renderer/runtime/desktop-host-services';
import { toast } from '../../../stores/toast';
import { aiConnectionErrorMessage, isAiConnectionRuntimeMismatch } from '../ai-connection-errors';

export function mergeModels(current: string, models: AiTextModelInfo[]): AiTextModelInfo[] {
  const values = new Map<string, AiTextModelInfo>();
  if (current.trim()) values.set(current.trim(), { id: current.trim(), name: current.trim() });
  for (const model of models) {
    if (model.id.trim()) values.set(model.id.trim(), model);
  }
  return [...values.values()];
}

export function reportConnectionError(error: unknown, title: string, fallback: string): string {
  const message = aiConnectionErrorMessage(error, fallback);
  if (isAiConnectionRuntimeMismatch(error)) {
    toast.show({
      title: '需要重启 Musefold',
      description: message,
      variant: 'warning',
      duration: 0,
      action: {
        label: '立即重启',
        onClick: () => {
          void api.system.relaunch();
        },
      },
    });
  } else {
    toast.error(title, message);
  }
  return message;
}

/** 测试抛错时的兜底 capabilities(沿用弹窗语义:未知而非虚构通过) */
export const FALLBACK_CAPABILITIES: AiConnectionValidationResult['capabilities'] = {
  modelDiscovery: 'unknown',
  supportedStructuredOutputModes: ['json-schema', 'json-object', 'json-text'],
  preferredStructuredOutputMode: 'json-schema',
  cancellation: true,
  streaming: false,
  lastValidatedAt: null,
};
