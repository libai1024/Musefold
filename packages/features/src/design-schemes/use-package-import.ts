'use client';

import {
  DESIGN_SCHEME_PACKAGE_LIMITS,
  type BeginDesignSchemePackageUpload,
  type DesignSchemePackageStage,
  type DesignSchemePackageRecovery,
  type ImportDesignSchemeResult,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';

/** Per-dialog intent. Retries reuse the same upload and import receipt; no automatic new copies. */
export function usePackageImport(onImported: (result: ImportDesignSchemeResult) => void) {
  const gateway = useGateway();
  const schemes = gateway.designSchemes;
  const transport = schemes?.packageImport;
  const client = useQueryClient();
  const [phase, setPhase] = useState<
    'idle' | 'reading' | 'uploading' | 'review' | 'importing' | 'checking' | 'cancelling'
  >('idle');
  const [recovery, setRecovery] = useState<DesignSchemePackageRecovery | null>(null);
  const [stage, setStage] = useState<DesignSchemePackageStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [formatVersion, setFormatVersion] = useState<1 | 2>(2);
  const intent = useRef<{
    epoch: number;
    input?: BeginDesignSchemePackageUpload;
    stage?: DesignSchemePackageStage;
    abort: AbortController;
    disposed: boolean;
    busy: boolean;
    recovering?: string;
  } | null>(null);

  useEffect(
    () => () => {
      const current = intent.current;
      if (!current) return;
      current.disposed = true;
      current.abort.abort();
      // Lifecycle disposal is not a user cancellation. Durable server records remain recoverable.
    },
    [],
  );

  function requireCurrent(current: NonNullable<typeof intent.current>) {
    assertAccountEpoch(client, current.epoch);
    if (current.disposed || current.abort.signal.aborted) throw new Error('导入已关闭');
  }

  function accept(current: NonNullable<typeof intent.current>, next: DesignSchemePackageStage) {
    const input = current.input;
    if (
      !input ||
      next.requestId !== input.requestId ||
      next.packageHash !== input.packageHash ||
      next.formatVersion !== input.formatVersion ||
      next.sizeBytes !== input.sizeBytes ||
      (current.stage && next.stagedPackageId !== current.stage.stagedPackageId) ||
      (current.recovering && next.stagedPackageId !== current.recovering)
    )
      throw new Error('方案包核对信息不一致，请关闭后重新选择文件');
    current.stage = next;
    requireCurrent(current);
    setStage(next);
    return next;
  }

  async function recover(id: string) {
    if (!transport?.recovery || intent.current?.busy) return;
    const current = intent.current ?? {
      epoch: accountEpoch(client),
      abort: new AbortController(),
      disposed: false,
      busy: false,
      recovering: id,
    };
    if (current.recovering !== id) return;
    intent.current = current;
    current.busy = true;
    setPhase('checking');
    setError(null);
    try {
      requireCurrent(current);
      const next = await transport.recovery.get(id);
      requireCurrent(current);
      current.input ??= {
        requestId: next.stage.requestId,
        packageHash: next.stage.packageHash,
        sizeBytes: next.stage.sizeBytes,
        formatVersion: next.stage.formatVersion,
      };
      accept(current, next.stage);
      setRecovery(next);
      setFormatVersion(next.stage.formatVersion);
      setPhase(next.stage.preview ? 'review' : 'idle');
    } catch (cause) {
      if (!current.disposed) {
        setError(cause instanceof Error ? cause.message : '暂时无法核对导入记录');
        setPhase(current.stage?.preview ? 'review' : 'idle');
      }
    } finally {
      current.busy = false;
    }
  }

  async function cancel() {
    const current = intent.current;
    if (!current?.stage || !transport || current.busy) return false;
    current.busy = true;
    setPhase('cancelling');
    setError(null);
    try {
      requireCurrent(current);
      if (transport.recovery) {
        const latest = await transport.recovery.get(current.stage.stagedPackageId);
        requireCurrent(current);
        if (latest.execution === 'completed' || latest.execution === 'running')
          throw new Error('该请求正在导入或已经完成，请核对导入结果');
      }
      const latest = await transport.cancel(current.stage.stagedPackageId);
      accept(current, latest);
      return true;
    } catch (cause) {
      if (!current.disposed)
        setError(cause instanceof Error ? cause.message : '取消未完成，请核对记录');
      return false;
    } finally {
      current.busy = false;
      if (!current.disposed) setPhase(current.stage?.preview ? 'review' : 'idle');
    }
  }

  async function upload() {
    if (!file || !transport || intent.current?.busy) return;
    const current = intent.current ?? {
      epoch: accountEpoch(client),
      abort: new AbortController(),
      disposed: false,
      busy: false,
    };
    intent.current = current;
    current.busy = true;
    setError(null);
    try {
      requireCurrent(current);
      if (!file.name.toLowerCase().endsWith('.musefold.design'))
        throw new Error('请选择 .musefold.design 方案包');
      if (!file.size || file.size > DESIGN_SCHEME_PACKAGE_LIMITS.archiveBytes)
        throw new Error('方案包必须非空且不超过 256 MiB');
      setPhase('reading');
      const bytes = new Uint8Array(await file.arrayBuffer());
      requireCurrent(current);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      requireCurrent(current);
      const packageHash = [...new Uint8Array(digest)]
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
      current.input ??= {
        requestId: globalThis.crypto.randomUUID(),
        packageHash,
        sizeBytes: bytes.byteLength,
        formatVersion,
      };
      if (
        current.input.packageHash !== packageHash ||
        current.input.sizeBytes !== bytes.byteLength ||
        current.input.formatVersion !== formatVersion
      )
        throw new Error('所选文件与原上传不一致，请重新选择原方案包');
      setPhase('uploading');
      let next = current.stage
        ? await transport.get(current.stage.stagedPackageId)
        : await transport.begin(current.input);
      accept(current, next);
      if (next.status === 'awaiting_upload') {
        next = await transport.upload(next.stagedPackageId, bytes, current.abort.signal);
        accept(current, next);
      }
      if (current.recovering && transport.recovery) {
        const restored = await transport.recovery.get(current.recovering);
        requireCurrent(current);
        next = accept(current, restored.stage);
        setRecovery(restored);
      }
      if (next.status === 'uploading') throw new Error('服务器仍在核对上传，请稍后重试核对');
      if (!['ready', 'confirmed', 'imported'].includes(next.status))
        throw new Error('这个上传已失效或取消，请关闭后重新选择文件');
      setPhase('review');
    } catch (cause) {
      if (!current.disposed) {
        setError(cause instanceof Error ? cause.message : '上传未完成，请重试核对');
        setPhase('idle');
      }
    } finally {
      current.busy = false;
    }
  }

  async function confirm() {
    const current = intent.current;
    if (!current || current.busy || !current.stage || !transport || !schemes) return;
    current.busy = true;
    setError(null);
    setPhase('importing');
    try {
      requireCurrent(current);
      const reviewed = current.stage;
      if (current.recovering && transport.recovery) {
        const latest = await transport.recovery.get(current.recovering);
        requireCurrent(current);
        if (
          latest.stage.confirmationHash !== reviewed.confirmationHash ||
          latest.stage.parserVersion !== reviewed.parserVersion
        )
          throw new Error('方案包预览已变化，请先刷新核对记录');
        accept(current, latest.stage);
        setRecovery(latest);
        if (latest.receipt) {
          void client.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
          onImported(latest.receipt);
          return;
        }
        if (!latest.canContinue) throw new Error('原导入目前不能继续，请先核对记录状态');
      }
      const latest = await transport.get(reviewed.stagedPackageId);
      requireCurrent(current);
      if (latest.confirmationHash !== reviewed.confirmationHash || !latest.confirmationHash)
        throw new Error('方案包预览已变化，请关闭后重新核对');
      accept(current, latest);
      if (latest.status === 'ready') {
        const decided = await transport.decide(latest.stagedPackageId, {
          packageHash: latest.packageHash,
          formatVersion: latest.formatVersion,
          parserVersion: latest.parserVersion,
          confirmationHash: latest.confirmationHash,
          decision: 'confirm',
        });
        if (
          decided.confirmationHash !== reviewed.confirmationHash ||
          decided.parserVersion !== reviewed.parserVersion
        )
          throw new Error('方案包确认信息已变化，请关闭后重新核对');
        accept(current, decided);
      }
      if (!current.stage || !['confirmed', 'imported'].includes(current.stage.status))
        throw new Error('方案包尚未确认或已失效，请关闭后重新选择文件');
      requireCurrent(current);
      const result = await schemes.importPackage({
        stagedPackageId: latest.stagedPackageId,
        packageHash: latest.packageHash,
        formatVersion: latest.formatVersion,
      });
      requireCurrent(current);
      // An immutable receipt can refer to a later-removed draft. Navigation will re-read live detail.
      void client.invalidateQueries({ queryKey: queryKeys.designSchemes.all() });
      onImported(result);
    } catch (cause) {
      if (!current.disposed) {
        setError(cause instanceof Error ? cause.message : '导入结果尚未核对，请重试');
        setPhase('review');
      }
    } finally {
      current.busy = false;
    }
  }

  return {
    phase,
    stage,
    recovery,
    recover,
    cancel,
    canRecover: !!transport?.recovery,
    recovering: intent.current?.recovering,
    canSelectFile:
      !intent.current ||
      (!intent.current.busy && intent.current.stage?.status === 'awaiting_upload'),
    error,
    file,
    formatVersion,
    upload,
    confirm,
    locked: intent.current !== null,
    changedAccount: intent.current !== null && intent.current.epoch !== accountEpoch(client),
    setFile: (next: File | null) => {
      if (
        !intent.current ||
        (!intent.current.busy && intent.current.stage?.status === 'awaiting_upload')
      )
        setFile(next);
    },
    setFormatVersion: (next: 1 | 2) => {
      if (!intent.current) setFormatVersion(next);
    },
  };
}
