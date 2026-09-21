'use client';
import { useEffect, useRef, useState } from 'react';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import type { SchemeComposerHandlers } from './integration-store';
import {
  toCloudSchemeCreateInput,
  toCloudSchemeModifyInput,
  type SchemeAgentIntent,
} from './agent-presentation';
import { SchemeAgentDialog } from './SchemeAgentDialog';

/** Adapt cloud create/modify lifecycles. Each waiter resolves only after its completed result. */
export function useCloudSchemeCreate(onOpenScheme?: (id: string) => void) {
  const transport = useGateway().designSchemes?.agent;
  const client = useQueryClient();
  const [input, setInput] = useState<SchemeAgentIntent | null>(null);
  const waiter = useRef<{ resolve(): void; reject(error: Error): void; done: boolean } | null>(
    null,
  );
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      if (waiter.current && !waiter.current.done)
        waiter.current.reject(new Error('已离开方案任务，可在方案任务中核对原执行'));
      waiter.current = null;
    },
    [],
  );
  async function open(next: SchemeAgentIntent) {
    if (waiter.current) throw new Error('请先核对当前方案任务');
    trigger.current = document.activeElement as HTMLElement | null;
    return new Promise<void>((resolve, reject) => {
      waiter.current = { resolve, reject, done: false };
      setInput(next);
    });
  }
  const onCreate: SchemeComposerHandlers['onCreate'] = transport
    ? (submission) => open({ operation: 'create', input: toCloudSchemeCreateInput(submission) })
    : undefined;
  const onModify: SchemeComposerHandlers['onModify'] = transport
    ? (submission) => open({ operation: 'modify', input: toCloudSchemeModifyInput(submission) })
    : undefined;
  const close = () => {
    const current = waiter.current;
    if (current && !current.done)
      current.reject(new Error('已关闭方案进度；如已提交，请从方案任务核对原执行，避免重复发送'));
    waiter.current = null;
    setInput(null);
  };
  return {
    onCreate,
    onModify,
    dialog: input ? (
      <SchemeAgentDialog
        key={input.input.executionId}
        intent={input}
        onClose={close}
        onRestoreFocus={() => trigger.current?.focus()}
        onCompleted={() => {
          const current = waiter.current;
          if (current && !current.done) {
            current.done = true;
            current.resolve();
          }
          void client.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
        }}
        onOpenScheme={(id) => {
          close();
          onOpenScheme?.(id);
        }}
      />
    ) : null,
  };
}
