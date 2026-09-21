'use client';
import { useEffect, useId, useRef, useState } from 'react';
import {
  designSchemeAgentSessionSchema,
  startDesignSchemeAgentInputSchema,
  authorizeDesignSchemeUpdateInputSchema,
  type AuthorizeDesignSchemeUpdateInput,
  type DesignSchemeAgentSession,
  type DesignSchemeTextModelOffer,
  type StartDesignSchemeAgentInput,
} from '@musefold/contracts';
import { queryKeys, useGateway } from '@musefold/platform';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountEpoch, assertAccountEpoch } from '../account/account-session';
import {
  agentIsTerminal,
  agentIntentCallLimit,
  type SchemeAgentIntent,
} from './agent-presentation';

/** One dialog owns an observation, never the server task. No automatic write retries. */
export function useSchemeAgent(intent: SchemeAgentIntent | undefined, allowed: boolean) {
  const transport = useGateway().designSchemes?.agent;
  const client = useQueryClient();
  const observerId = useId();
  const [epoch] = useState(() => accountEpoch(client));
  const [id, setId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<DesignSchemeTextModelOffer | null>(null);
  const updateOfferVersion = useRef<number | null>(null);
  const updateRequest = useRef<AuthorizeDesignSchemeUpdateInput | null>(null);
  const allowedNow = useRef(allowed);
  allowedNow.current = allowed;
  const current = useRef<{
    mounted: boolean;
    busy: boolean;
    id: string | null;
    view: DesignSchemeAgentSession | null;
    request: StartDesignSchemeAgentInput | null;
  }>({ mounted: true, busy: false, id: null, view: null, request: null });
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  const changedAccount = accountEpoch(client) !== epoch;
  const key = [...queryKeys.designSchemes.all(), 'agent-execution', epoch, observerId, id];
  const assertCurrent = () => {
    assertAccountEpoch(client, epoch);
    if (!current.current.mounted || !allowedNow.current || !transport)
      throw new Error('当前账号或页面不能继续此操作');
  };
  function accept(raw: DesignSchemeAgentSession, expected: string) {
    assertCurrent();
    const next = designSchemeAgentSessionSchema.parse(raw);
    if (next.executionId !== expected || current.current.id !== expected)
      throw new Error('任务响应不匹配，请重新核对原任务');
    if (current.current.request && next.operation !== current.current.request.operation)
      throw new Error('任务类型不匹配');
    const old = current.current.view;
    if (old && next.operation !== old.operation) throw new Error('任务类型不匹配');
    if (old && next.version < old.version) return old;
    if (old && next.version === old.version && JSON.stringify(old) !== JSON.stringify(next))
      throw new Error('任务状态无法核对，请刷新原任务');
    current.current.view = next;
    if (!old || next.version > old.version) setError(null);
    return next;
  }
  const observation = useQuery({
    queryKey: key,
    enabled: !!transport && !!id && allowed && !changedAccount && !busy && !rejected,
    queryFn: async ({ signal }) => {
      assertCurrent();
      if (!id || !transport) throw new Error('请先选择原任务');
      const last = current.current.view;
      let next: DesignSchemeAgentSession;
      if (!last) next = await transport.get(id);
      else {
        const page = await transport.events(id, last.version);
        let version = last.version;
        next = last;
        for (const event of page.events) {
          if (
            event.seq !== event.session.version ||
            event.seq <= version ||
            event.session.executionId !== id ||
            event.session.operation !== last.operation
          )
            throw new Error('任务事件无法核对，请刷新原任务');
          version = event.seq;
          next = event.session;
        }
        if (page.nextSeq !== version) throw new Error('任务事件游标无法核对，请刷新原任务');
      }
      if (signal.aborted) throw new Error('已停止查看此任务');
      return accept(next, id);
    },
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.status === 'error' || (query.state.data && agentIsTerminal(query.state.data))
        ? false
        : 2000,
    refetchOnWindowFocus: true,
  });
  async function act(work: () => Promise<void>) {
    if (current.current.busy) return;
    current.current.busy = true;
    setBusy(true);
    setError(null);
    try {
      assertCurrent();
      await work();
    } catch (cause) {
      const versionChanged =
        cause instanceof Error &&
        'details' in cause &&
        typeof cause.details === 'object' &&
        cause.details !== null &&
        'reason' in cause.details &&
        cause.details.reason === 'AGENT_BASE_REVISION_CHANGED';
      if (current.current.mounted && versionChanged) setRejected(true);
      if (current.current.mounted)
        setError(
          versionChanged
            ? intent?.operation === 'check-update'
              ? '方案版本已经变化，本次检查未提交。请关闭并从方案详情重新选择版本。'
              : '方案版本已经变化，本次修改未提交。请关闭并从方案详情重新选择版本；修改描述仍保留在工作台。'
            : current.current.id
              ? '操作结果尚未核对。请刷新原任务；不会自动重新创建或调用模型。'
              : '暂时无法核对文本模型与授权，请重试。尚未提交方案任务。',
        );
    } finally {
      current.current.busy = false;
      if (current.current.mounted) setBusy(false);
    }
  }
  function publish(next: DesignSchemeAgentSession, expected: string) {
    const value = accept(next, expected);
    client.setQueryData(
      [...queryKeys.designSchemes.all(), 'agent-execution', epoch, observerId, expected],
      value,
    );
  }
  function select(executionId: string) {
    if (current.current.busy) return;
    try {
      assertCurrent();
    } catch {
      setError('账号已变化，请关闭后重新核对。');
      return;
    }
    current.current.id = executionId;
    current.current.view = null;
    current.current.request = null;
    updateRequest.current = null;
    updateOfferVersion.current = null;
    setId(executionId);
    setOffer(null);
    setRejected(false);
    setError(null);
  }
  const loadOffer = () =>
    act(async () => {
      if (!transport || updateRequest.current) return;
      const view = current.current.view;
      const update = view?.operation === 'check-update' && view.status === 'authorization-required';
      if (!update && (current.current.request || !intent || intent.operation === 'check-update'))
        return;
      const next = await transport.textModel();
      assertCurrent();
      if (update && current.current.view?.version !== view.version)
        throw new Error('任务状态已变化，请重新核对更新费用');
      updateOfferVersion.current = update ? view.version : null;
      setOffer(next);
    });
  const start = () =>
    act(async () => {
      if (!intent || !transport) return;
      // A repeated explicit click replays the exact authorized request, even if POST's reply was lost.
      if (!current.current.request) {
        if (intent.operation === 'check-update') {
          current.current.request = startDesignSchemeAgentInputSchema.parse(intent);
        } else {
          if (!offer) throw new Error('请先核对文本模型');
          current.current.request = startDesignSchemeAgentInputSchema.parse({
            ...intent,
            text: {
              binding: offer.binding,
              maxModelCalls: agentIntentCallLimit(intent),
              maxOutputTokens: offer.maxOutputTokens,
              acceptUnknownCost: true,
            },
          });
        }
        current.current.id = intent.input.executionId;
        setId(intent.input.executionId);
        setOffer(null);
      }
      const next = await transport.start(current.current.request);
      if (next.operation !== current.current.request.operation) throw new Error('任务类型不匹配');
      publish(next, current.current.request.input.executionId);
    });
  const authorizeUpdate = () =>
    act(async () => {
      const view = current.current.view;
      const expected = current.current.id;
      if (!transport || !expected || view?.operation !== 'check-update') return;
      if (!updateRequest.current) {
        if (
          !offer ||
          !view.update ||
          view.status !== 'authorization-required' ||
          updateOfferVersion.current !== view.version
        ) {
          setOffer(null);
          setError('任务状态已变化，请重新核对更新模型与费用后再明确授权。');
          return;
        }
        updateRequest.current = authorizeDesignSchemeUpdateInputSchema.parse({
          executionId: expected,
          expectedSessionVersion: updateOfferVersion.current,
          text: {
            binding: offer.binding,
            maxModelCalls: view.update.changes.length + 1,
            maxOutputTokens: offer.maxOutputTokens,
            acceptUnknownCost: true,
          },
        });
        setOffer(null);
      }
      publish(await transport.authorizeUpdate(updateRequest.current), expected);
    });
  const refresh = () =>
    act(async () => {
      const expected = current.current.id;
      if (!expected || !transport) return;
      publish(await transport.get(expected), expected);
    });
  const confirm = (confirmationId: string) =>
    act(async () => {
      const expected = current.current.id;
      if (
        !expected ||
        !transport ||
        current.current.view?.pendingSource?.confirmationId !== confirmationId
      )
        return;
      publish(
        await transport.confirmSource({
          executionId: expected,
          confirmationId,
          decision: 'install',
        }),
        expected,
      );
    });
  const cancel = () =>
    act(async () => {
      const expected = current.current.id;
      if (!expected || !transport) return;
      publish(
        await transport.cancel(
          expected,
          current.current.view?.operation ??
            current.current.request?.operation ??
            intent?.operation ??
            'create',
        ),
        expected,
      );
    });
  return {
    id,
    busy,
    error,
    offer,
    changedAccount,
    select,
    loadOffer,
    start,
    authorizeUpdate,
    refresh,
    confirm,
    cancel,
    session: allowed && !changedAccount && !observation.isError ? (observation.data ?? null) : null,
    readError: observation.isError,
    reading: !!id && observation.isPending && !busy,
    rejected,
    canReplay: !rejected && !!current.current.request && !current.current.view,
    canReplayUpdate:
      !!updateRequest.current &&
      !!current.current.view &&
      !agentIsTerminal(current.current.view) &&
      !current.current.view.text,
    updateAuthorized: !!updateRequest.current,
    started: !!current.current.request,
  };
}
