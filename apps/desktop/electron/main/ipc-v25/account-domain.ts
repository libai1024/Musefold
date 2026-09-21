// Account secrets remain in the main process; every request captures one pinned session.
import { randomBytes } from 'node:crypto';
import {
  type AccountSummary,
  accountExecutionBindingSchema,
  accountModelCatalogSchema,
  accountRecoveryRequestSchema,
  accountRecoveryReviewSchema,
  accountSummarySchema,
  accountNoticesSchema,
  loginRequestSchema,
  redeemRequestSchema,
  redeemResultSchema,
  loginCapacityReviewSchema,
  loginCapacityRequestSchema,
  completeLoginCapacitySchema,
  loginSessionPageSchema,
  revokeLoginSessionsSchema,
  revokeLoginSessionsResultSchema,
  type LoginCapacityReview,
} from '@musefold/contracts';
import { z } from 'zod';
import { createLogger } from '../../system/logger';
import {
  type SessionCredentials,
  apiBase,
  clearStoredSession,
  readSessionCredentials,
  readStoredSession,
  sessionForAccount,
  withAccountTransition,
  writeStoredSession,
} from './account-session-store';
import { BridgeError, type MethodDef } from './envelope';
import {
  enqueueAccountRelease,
  retryAccountReleases,
  pendingAccountReleaseCount,
} from './account-release-queue';

export { accountWorkspaceOwner, apiBase, readSessionCredentials } from './account-session-store';
export type { SessionCredentials } from './account-session-store';

const logger = createLogger('ipc-v25:account');
let authOperation = 0;
let pendingLogin: {
  review: LoginCapacityReview;
  binding: string;
  issuer: string;
  operation: number;
  original: Awaited<ReturnType<typeof readStoredSession>>;
} | null = null;
let executionAccessRevision = 0;
const changedSession = () => new BridgeError('CONFLICT', '账号状态已变化,请重试当前操作');

export async function readSessionToken(): Promise<string | null> {
  const session = await readSessionCredentials();
  return session && !session.restricted ? session.token : null;
}

/** Compatibility seam for sync. It cannot manufacture or overwrite a session identity. */
export async function bindSessionOwner(token: string, ownerId: string): Promise<void> {
  const current = await readSessionCredentials();
  if (!current || current.token !== token || current.restricted || current.ownerId !== ownerId)
    throw changedSession();
}

async function requireSession(): Promise<SessionCredentials> {
  const session = await readSessionCredentials();
  if (!session)
    throw new BridgeError('AUTH_REQUIRED', '请重新登录账号以确认服务来源;原有本地数据会保留');
  return session;
}

async function assertCurrent(session: SessionCredentials): Promise<void> {
  const current = await readSessionCredentials();
  if (!current || current.authEpoch !== session.authEpoch || current.token !== session.token)
    throw changedSession();
}

/** Main-process-only capture; never expose the returned credentials through a gateway/IPC DTO. */
export async function captureManagedAccountSession() {
  return withAccountTransition(async () => {
    const session = await requireSession();
    if (session.restricted || !session.principalId || session.pendingRecovery)
      throw new BridgeError('ACCOUNT_IDENTITY_UNVERIFIED', '请先完成账号身份核对');
    const revision = executionAccessRevision;
    const assertCaptured = () => {
      if (revision !== executionAccessRevision || apiBase() !== session.apiIssuer)
        throw changedSession();
    };
    return {
      session,
      assertCurrent: assertCaptured,
      async assertFresh() {
        assertCaptured();
        await assertCurrent(session);
        assertCaptured();
      },
      async invalidate() {
        await invalidateSession(session);
      },
    };
  });
}

async function cloudFetch(
  issuer: string,
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown; loginBinding?: string },
): Promise<Response> {
  if (apiBase() !== issuer)
    throw new BridgeError('ACCOUNT_IDENTITY_SOURCE_CHANGED', '账号服务器已变化,请重新登录');
  try {
    return await fetch(`${issuer}${path}`, {
      method: init.method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.loginBinding
          ? {
              'x-musefold-login-binding': init.loginBinding,
              'user-agent': `Musefold Desktop/${process.platform}`,
            }
          : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    logger.warn('云服务不可达', { path });
    throw new BridgeError('ACCOUNT_SERVICE_UNAVAILABLE', '无法连接 Musefold 云服务,请检查网络');
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new BridgeError('INTERNAL_ERROR', '账号服务返回了无效响应');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 15_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new Error('deadline');
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw new Error('size');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } catch {
    throw new BridgeError('INTERNAL_ERROR', '账号服务返回了无效响应,请重试');
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function throwResponseError(response: Response): Promise<never> {
  const body = (await readJson(response).catch(() => undefined)) as
    | { error?: { code?: string; message?: string }; code?: string; message?: string }
    | undefined;
  const code = body?.error?.code ?? body?.code;
  const message = body?.error?.message ?? body?.message;
  throw new BridgeError(
    typeof code === 'string' ? code : 'INTERNAL_ERROR',
    typeof message === 'string' ? message : `云服务请求失败(HTTP ${response.status})`,
  );
}

async function invalidateSession(session: SessionCredentials): Promise<void> {
  await withAccountTransition(async () => {
    const current = await readSessionCredentials();
    if (current?.authEpoch !== session.authEpoch) return;
    await emitBeforeAccountChange();
    try {
      await clearStoredSession();
    } catch (error) {
      await emitAccountChangeCancelled();
      throw error;
    }
    await emitAccountChanged(null);
  });
}

async function requestForSession(
  session: SessionCredentials,
  path: string,
  body?: unknown,
): Promise<Response> {
  await assertCurrent(session);
  const response = await cloudFetch(session.apiIssuer, path, {
    method: body === undefined ? 'GET' : 'POST',
    token: session.token,
    body,
  });
  try {
    await assertCurrent(session);
  } catch (error) {
    await response.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    await invalidateSession(session);
    throw new BridgeError('AUTH_REQUIRED', '登录状态已失效,请重新登录');
  }
  if (!response.ok) return throwResponseError(response);
  return response;
}

async function acceptStatus(
  session: SessionCredentials,
  status: AccountSummary,
  allowNewPrincipal = false,
) {
  return withAccountTransition(async () => {
    await assertCurrent(session);
    const next = sessionForAccount(session.token, session.apiIssuer, status);
    if (
      session.principalId &&
      session.principalId !== next.principalId &&
      !(allowNewPrincipal && session.restricted)
    )
      throw changedSession();
    if (
      session.ownerId !== next.ownerId ||
      session.principalId !== next.principalId ||
      session.restricted !== next.restricted ||
      session.pendingRecovery !== null
    ) {
      await emitBeforeAccountChange();
      try {
        await writeStoredSession(next);
      } catch (error) {
        await emitAccountChangeCancelled();
        throw error;
      }
      await emitAccountChanged(status);
    }
    return status;
  });
}

export async function fetchAccountStatus(token: string): Promise<AccountSummary> {
  const session = await requireSession();
  if (session.token !== token) throw changedSession();
  if (session.pendingRecovery)
    return recover('independent-workspace', session.pendingRecovery, true);
  const response = await requestForSession(session, '/api/v1/account/status');
  return acceptStatus(session, accountSummarySchema.parse(await readJson(response)));
}

const beforeAccountChangeListeners: Array<() => Promise<void> | void> = [];
const accountChangedListeners: Array<(status: AccountSummary | null) => Promise<void> | void> = [];
const accountChangeCancelledListeners: Array<() => Promise<void> | void> = [];

export function onBeforeAccountChange(listener: () => Promise<void> | void): void {
  beforeAccountChangeListeners.push(listener);
}

export function onAccountChanged(
  listener: (status: AccountSummary | null) => Promise<void> | void,
): void {
  accountChangedListeners.push(listener);
}

export function onAccountChangeCancelled(listener: () => Promise<void> | void): void {
  accountChangeCancelledListeners.push(listener);
}

async function emitBeforeAccountChange(): Promise<void> {
  // Invalidate synchronous send/write guards before awaiting any slow subscriber.
  executionAccessRevision += 1;
  for (const listener of beforeAccountChangeListeners) await listener();
}

async function emitAccountChanged(status: AccountSummary | null): Promise<void> {
  for (const listener of accountChangedListeners) {
    try {
      await listener(status);
    } catch (error) {
      logger.warn('账号变化监听失败', error instanceof Error ? error.message : String(error));
    }
  }
}

async function emitAccountChangeCancelled(): Promise<void> {
  for (const listener of accountChangeCancelledListeners) {
    try {
      await listener();
    } catch (error) {
      logger.warn('账号变化回滚监听失败', error instanceof Error ? error.message : String(error));
    }
  }
}

const signInResponseSchema = z.looseObject({
  token: z.string().min(1),
  managed: z.boolean().optional(),
});

async function revokeCandidate(token: string, issuer: string): Promise<void> {
  try {
    await enqueueAccountRelease(token, issuer);
  } catch {
    // Failure to persist must not prevent immediate best-effort compensation;
    // managed candidates also retain their upstream five-minute lease.
    await fetch(`${issuer}/api/auth/sign-out`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    })
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
    return;
  }
  await retryAccountReleases();
}

async function signIn(
  endpoint: '/sign-in/new-api' | '/sign-up/new-api',
  input: z.infer<typeof loginRequestSchema>,
) {
  const { operation, issuer, original } = await withAccountTransition(async () => ({
    operation: ++authOperation,
    issuer: apiBase(),
    original: await readStoredSession(),
  }));
  pendingLogin = null;
  const binding = randomBytes(32).toString('base64url');
  let candidateToken: string | undefined;
  let committed = false;
  try {
    const response = await cloudFetch(issuer, `/api/auth${endpoint}`, {
      method: 'POST',
      token: original?.apiIssuer === issuer ? original.token : undefined,
      body: { email: input.username, password: input.password, twoFactorCode: input.twoFactorCode },
      loginBinding: binding,
    });
    if (response.status === 409) {
      const result = z
        .object({
          code: z.literal('AUTH_SESSION_LIMIT'),
          details: z.object({ review: loginCapacityReviewSchema }),
        })
        .safeParse(await readJson(response.clone()));
      if (result.success) {
        await withAccountTransition(async () => {
          if (operation !== authOperation || issuer !== apiBase()) throw changedSession();
          pendingLogin = {
            review: result.data.details.review,
            binding,
            issuer,
            operation,
            original,
          };
        });
        throw new BridgeError('AUTH_SESSION_LIMIT', '登录设备数量已达上限，请选择要退出的设备');
      }
    }
    if (!response.ok) return await throwResponseError(response);
    const result = signInResponseSchema.parse(await readJson(response));
    candidateToken = result.token;
    const statusResponse = await cloudFetch(issuer, '/api/v1/account/status', {
      method: 'GET',
      token: candidateToken,
    });
    if (statusResponse.status === 401)
      throw new BridgeError('AUTH_REQUIRED', '新登录会话未通过验证,原账号保持不变');
    if (!statusResponse.ok) return await throwResponseError(statusResponse);
    const status = accountSummarySchema.parse(await readJson(statusResponse));
    const next = sessionForAccount(candidateToken, issuer, status);
    if (result.managed) {
      await enqueueAccountRelease(candidateToken, issuer, true);
      const ack = await cloudFetch(issuer, '/api/v1/account/login-sessions/touch', {
        method: 'POST',
        token: candidateToken,
        body: { acknowledge: true },
      });
      if (!ack.ok) await throwResponseError(ack);
      await ack.body?.cancel();
    }
    await withAccountTransition(async () => {
      if (operation !== authOperation || issuer !== apiBase()) throw changedSession();
      const current = await readStoredSession();
      if (current?.authEpoch !== original?.authEpoch) throw changedSession();
      if (current && current.token !== candidateToken)
        await enqueueAccountRelease(current.token, current.apiIssuer);
      await emitBeforeAccountChange();
      try {
        await writeStoredSession(next);
      } catch (error) {
        await emitAccountChangeCancelled();
        throw error;
      }
      committed = true;
      await emitAccountChanged(status);
    });
    return status;
  } finally {
    if (candidateToken && !committed) await revokeCandidate(candidateToken, issuer);
  }
}

async function capacityRequest(path: 'review' | 'cancel' | 'complete', input?: unknown) {
  const pending = pendingLogin;
  if (!pending || pending.operation !== authOperation || pending.issuer !== apiBase())
    throw new BridgeError('AUTH_LOGIN_CHALLENGE_EXPIRED', '验证已过期，请重新登录');
  const flowRef =
    input && typeof input === 'object' && 'flowRef' in input
      ? input.flowRef
      : pending.review.flowRef;
  if (flowRef !== pending.review.flowRef) throw changedSession();
  const response = await cloudFetch(pending.issuer, `/api/auth/login-capacity/${path}`, {
    method: 'POST',
    loginBinding: pending.binding,
    token: pending.original?.apiIssuer === pending.issuer ? pending.original.token : undefined,
    body: input ?? { flowRef },
  });
  if (!response.ok) return throwResponseError(response);
  if (path === 'review') {
    const review = loginCapacityReviewSchema.parse(await readJson(response));
    if (pendingLogin !== pending || pending.operation !== authOperation) throw changedSession();
    pending.review = review;
    return review;
  }
  if (path === 'cancel') {
    await response.body?.cancel();
    if (pendingLogin === pending) pendingLogin = null;
    return undefined;
  }
  const candidate = signInResponseSchema.parse(await readJson(response));
  let committed = false;
  try {
    const statusResponse = await cloudFetch(pending.issuer, '/api/v1/account/status', {
      method: 'GET',
      token: candidate.token,
    });
    if (!statusResponse.ok) return await throwResponseError(statusResponse);
    const status = accountSummarySchema.parse(await readJson(statusResponse));
    await enqueueAccountRelease(candidate.token, pending.issuer, true);
    const ack = await cloudFetch(pending.issuer, '/api/v1/account/login-sessions/touch', {
      method: 'POST',
      token: candidate.token,
      body: { acknowledge: true },
    });
    if (!ack.ok) return await throwResponseError(ack);
    await ack.body?.cancel();
    await withAccountTransition(async () => {
      if (
        pendingLogin !== pending ||
        pending.operation !== authOperation ||
        pending.issuer !== apiBase()
      )
        throw changedSession();
      const current = await readStoredSession();
      if (current?.authEpoch !== pending.original?.authEpoch) throw changedSession();
      if (current && current.token !== candidate.token)
        await enqueueAccountRelease(current.token, current.apiIssuer);
      await emitBeforeAccountChange();
      try {
        await writeStoredSession(sessionForAccount(candidate.token, pending.issuer, status));
      } catch (error) {
        await emitAccountChangeCancelled();
        throw error;
      }
      committed = true;
      pendingLogin = null;
      await emitAccountChanged(status);
    });
    return status;
  } finally {
    if (!committed) await revokeCandidate(candidate.token, pending.issuer);
  }
}

async function recover(
  path: string,
  input: z.infer<typeof accountRecoveryRequestSchema>,
  independent = false,
) {
  const session = await requireSession();
  if (!independent && session.pendingRecovery)
    throw new BridgeError('CONFLICT', '独立工作区正在恢复,请刷新恢复状态以继续原申请');
  if (independent) {
    if (!session.restricted)
      throw new BridgeError('ACCOUNT_RECOVERY_CONFLICT', '当前账号不需要建立独立空间');
    await withAccountTransition(async () => {
      await assertCurrent(session);
      const current = await requireSession();
      if (current.pendingRecovery && current.pendingRecovery.requestId !== input.requestId)
        throw changedSession();
      // Persist user intent before the remote principal transition. A restart replays this exact request.
      if (!current.pendingRecovery)
        await writeStoredSession({ ...current, pendingRecovery: input });
    });
  }
  const response = await requestForSession(session, `/api/v1/account/recovery/${path}`, input);
  return acceptStatus(session, accountSummarySchema.parse(await readJson(response)), independent);
}

const noInput = z.undefined().or(z.object({}).strict());

export function buildAccountDomainMethods(): Record<string, MethodDef> {
  return {
    'account.getLoginCapacityReview': {
      input: loginCapacityRequestSchema.or(z.undefined()),
      handle: (input) => capacityRequest('review', input),
    },
    'account.completeLoginCapacity': {
      input: completeLoginCapacitySchema,
      handle: (input) => capacityRequest('complete', input),
    },
    'account.cancelLoginCapacity': {
      input: loginCapacityRequestSchema,
      handle: (input) => capacityRequest('cancel', input),
    },
    'account.listLoginSessions': {
      input: noInput,
      handle: async () => {
        const current = await requireSession();
        const response = await requestForSession(current, '/api/v1/account/login-sessions');
        return loginSessionPageSchema.parse(await readJson(response));
      },
    },
    'account.revokeLoginSessions': {
      input: revokeLoginSessionsSchema,
      handle: async (input) => {
        const current = await requireSession();
        const response = await requestForSession(
          current,
          '/api/v1/account/login-sessions/revoke',
          input,
        );
        return revokeLoginSessionsResultSchema.parse(await readJson(response));
      },
    },
    'account.touchLoginSession': {
      input: noInput,
      handle: async () => {
        const response = await requestForSession(
          await requireSession(),
          '/api/v1/account/login-sessions/touch',
          { acknowledge: false },
        );
        await response.body?.cancel();
      },
    },
    'account.getStatus': {
      input: noInput,
      handle: async () => fetchAccountStatus((await requireSession()).token),
    },
    'account.getLoginReleaseStatus': {
      input: noInput,
      handle: async () => ({ pending: await pendingAccountReleaseCount() }),
    },
    'account.login': {
      input: loginRequestSchema,
      handle: (input) => signIn('/sign-in/new-api', input as z.infer<typeof loginRequestSchema>),
    },
    'account.register': {
      input: loginRequestSchema,
      handle: (input) => signIn('/sign-up/new-api', input as z.infer<typeof loginRequestSchema>),
    },
    'account.logout': {
      input: noInput,
      handle: async () => {
        const previous = await withAccountTransition(async () => {
          ++authOperation;
          const session = await readStoredSession();
          pendingLogin = null;
          if (session) await enqueueAccountRelease(session.token, session.apiIssuer);
          await emitBeforeAccountChange();
          try {
            await clearStoredSession();
          } catch (error) {
            await emitAccountChangeCancelled();
            throw error;
          }
          await emitAccountChanged(null);
          return session;
        });
        if (previous) await revokeCandidate(previous.token, previous.apiIssuer);
        return null;
      },
    },
    'account.redeem': {
      input: redeemRequestSchema,
      handle: async (input) => {
        const session = await requireSession();
        if (session.restricted)
          throw new BridgeError('ACCOUNT_IDENTITY_UNVERIFIED', '请先完成账号恢复');
        const response = await requestForSession(session, '/api/v1/account/redeem', input);
        const result = redeemResultSchema.parse(await readJson(response));
        await acceptStatus(session, result.account);
        return result;
      },
    },
    'account.retryRecovery': {
      input: accountRecoveryRequestSchema,
      handle: (input) => recover('retry', input as z.infer<typeof accountRecoveryRequestSchema>),
    },
    'account.verifyOriginalSession': {
      input: accountRecoveryRequestSchema,
      handle: (input) =>
        recover('verify-original-session', input as z.infer<typeof accountRecoveryRequestSchema>),
    },
    'account.createIndependentWorkspace': {
      input: accountRecoveryRequestSchema,
      handle: (input) =>
        recover(
          'independent-workspace',
          input as z.infer<typeof accountRecoveryRequestSchema>,
          true,
        ),
    },
    'account.inspectRecovery': {
      input: accountRecoveryRequestSchema,
      handle: async (input) => {
        const session = await requireSession();
        const response = await requestForSession(
          session,
          '/api/v1/account/recovery/inspect',
          input,
        );
        const result = accountRecoveryReviewSchema.parse(await readJson(response));
        await assertCurrent(session);
        return result;
      },
    },
    'account.getExecutionBinding': {
      input: noInput,
      handle: async () => {
        const session = await requireSession();
        const response = await requestForSession(session, '/api/v1/account/execution-binding');
        const binding = accountExecutionBindingSchema.parse(await readJson(response));
        await assertCurrent(session);
        if (
          binding.apiIssuer !== session.apiIssuer ||
          binding.principalId !== session.principalId ||
          (session.restricted && binding.status === 'available')
        )
          throw changedSession();
        return binding;
      },
    },
    'account.getNotices': {
      input: noInput,
      handle: async () => {
        const session = await requireSession();
        if (session.restricted || !session.principalId)
          throw new BridgeError('ACCOUNT_IDENTITY_UNVERIFIED', '请先完成账号身份核对');
        const response = await requestForSession(session, '/api/v1/account/notices');
        const result = accountNoticesSchema.parse(await readJson(response));
        await assertCurrent(session);
        if (result.apiIssuer !== session.apiIssuer) throw changedSession();
        return result;
      },
    },
    'account.getModelCatalog': {
      input: noInput,
      handle: async () => {
        const session = await requireSession();
        if (session.restricted || !session.principalId)
          throw new BridgeError('ACCOUNT_IDENTITY_UNVERIFIED', '请先完成账号身份核对');
        const response = await requestForSession(session, '/api/v1/account/models');
        const result = accountModelCatalogSchema.parse(await readJson(response));
        await assertCurrent(session);
        if (
          result.identity.apiIssuer !== session.apiIssuer ||
          result.identity.principalId !== session.principalId
        )
          throw changedSession();
        return result;
      },
    },
  };
}
