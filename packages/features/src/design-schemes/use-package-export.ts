'use client';

import type {
  BeginDesignSchemePackageExport,
  DesignSchemePackageExport,
  DesignSchemePackageDelivery,
  DesignSchemePackageExportRecovery,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';

/** One explicit selection binds one durable export; closing only stops local IO. */
export function usePackageExport(
  selection?: Omit<BeginDesignSchemePackageExport, 'requestId' | 'formatVersion'>,
) {
  const transport = useGateway().designSchemes?.packageExport;
  const client = useQueryClient();
  const [intent] = useState(() => ({
    input: selection
      ? { ...selection, requestId: globalThis.crypto.randomUUID(), formatVersion: 2 as const }
      : (null as BeginDesignSchemePackageExport | null),
    epoch: accountEpoch(client),
    abort: new AbortController(),
    stage: null as DesignSchemePackageExport | null,
    recovering: null as string | null,
    busy: false,
    disposed: false,
    finished: false,
    started: false,
  }));
  const [phase, setPhase] = useState<
    'idle' | 'preparing' | 'ready' | 'saving' | 'checking' | 'cancelling' | 'finished'
  >('idle');
  const [stage, setStage] = useState<DesignSchemePackageExport | null>(null);
  const [recovery, setRecovery] = useState<DesignSchemePackageExportRecovery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DesignSchemePackageDelivery | null>(null);
  useEffect(
    () => () => {
      if (!intent.started) return;
      intent.disposed = true;
      intent.abort.abort();
      // Other pages may still use the same export. TTL or explicit cancellation owns cleanup.
    },
    [intent],
  );
  const check = () => {
    assertAccountEpoch(client, intent.epoch);
    if (client.getQueryState(queryKeys.account.status())?.status === 'error')
      throw new Error('账号核对失败，请关闭后重新核对账号');
    if (intent.disposed) throw new Error('导出已关闭');
    intent.abort.signal.throwIfAborted();
  };
  function accept(next: DesignSchemePackageExport) {
    const input = intent.input;
    if (
      !input ||
      next.requestId !== input.requestId ||
      next.schemeId !== input.schemeId ||
      next.revisionId !== input.revisionId ||
      next.formatVersion !== input.formatVersion ||
      (intent.stage && next.exportId !== intent.stage.exportId)
    )
      throw new Error('方案包核对信息不一致，请关闭后重新导出');
    intent.stage = next;
    setStage(next);
  }
  async function recover(id: string) {
    if (
      !transport?.recovery ||
      intent.busy ||
      intent.finished ||
      (intent.started && intent.recovering !== id)
    )
      return;
    intent.busy = true;
    intent.started = true;
    intent.recovering = id;
    setPhase('checking');
    setError(null);
    try {
      check();
      const next = await transport.recovery.get(id);
      check();
      if (
        next.export.exportId !== id ||
        (intent.stage && next.expectedVersion !== intent.input?.expectedVersion)
      )
        throw new Error('导出记录已变化，请关闭后重新核对');
      if (!intent.stage)
        intent.input = {
          requestId: next.export.requestId,
          schemeId: next.export.schemeId,
          revisionId: next.export.revisionId,
          expectedVersion: next.expectedVersion,
          formatVersion: next.export.formatVersion,
        };
      accept(next.export);
      setRecovery(next);
      setPhase(next.canDownload ? 'ready' : 'idle');
    } catch (cause) {
      if (!intent.disposed) {
        setRecovery(null);
        setError(cause instanceof Error ? cause.message : '暂时无法核对导出记录');
        setPhase('idle');
      }
    } finally {
      intent.busy = false;
    }
  }
  async function prepare() {
    if (intent.recovering) return recover(intent.recovering);
    if (!transport || !intent.input || intent.busy || intent.finished) return;
    intent.busy = true;
    intent.started = true;
    setPhase('preparing');
    setError(null);
    try {
      check();
      const next = intent.stage
        ? await transport.get(intent.stage.exportId)
        : await transport.begin(intent.input);
      check();
      accept(next);
      if (next.status === 'preparing') throw new Error('服务器仍在准备，请稍后重试核对');
      if (next.status !== 'ready') throw new Error('这次导出已失效或取消，请关闭后新建导出');
      setPhase('ready');
    } catch (cause) {
      if (!intent.disposed) {
        setError(cause instanceof Error ? cause.message : '导出准备未完成，请重试核对');
        setPhase('idle');
      }
    } finally {
      intent.busy = false;
    }
  }
  async function save() {
    if (!transport || !intent.stage || intent.busy || intent.finished || phase !== 'ready') return;
    intent.busy = true;
    intent.started = true;
    setError(null);
    setPhase('saving');
    try {
      check();
      // No await before host.save: retain the user gesture for the native save picker.
      const result = await transport.save(intent.stage, {
        signal: intent.abort.signal,
        assertCurrent: check,
      });
      check();
      if (result.exportId !== intent.stage.exportId)
        throw new Error('导出回执不匹配，请核对下载列表');
      if (result.status === 'cancelled') {
        setPhase('ready');
        return;
      }
      intent.finished = true;
      setReceipt(result);
      setPhase('finished');
      // A handoff is not a durable save receipt. Keep the archive until TTL/explicit cancellation.
    } catch (cause) {
      if (!intent.disposed) {
        setError(cause instanceof Error ? cause.message : '保存未确认，请核对下载列表后重试');
        setPhase('ready');
      }
    } finally {
      intent.busy = false;
    }
  }
  async function cancel() {
    if (!transport || !intent.stage || intent.busy || intent.finished) return false;
    intent.busy = true;
    intent.started = true;
    setPhase('cancelling');
    setError(null);
    try {
      check();
      const result = await transport.cancel(intent.stage.exportId);
      check();
      accept(result);
      if (result.status !== 'cancelled') throw new Error('取消尚未确认，请重新核对记录');
      intent.finished = true;
      setPhase('finished');
      return true;
    } catch (cause) {
      if (!intent.disposed) {
        setError(cause instanceof Error ? cause.message : '取消未确认，请核对记录');
        setPhase('idle');
      }
      return false;
    } finally {
      intent.busy = false;
    }
  }
  return {
    phase,
    stage,
    recovery,
    error,
    receipt,
    prepare,
    save,
    recover,
    cancel,
    canRecover: !!transport?.recovery,
    canChoose: !intent.started,
    recovering: intent.recovering !== null,
    selection: intent.input,
    changedAccount: accountEpoch(client) !== intent.epoch,
  };
}
