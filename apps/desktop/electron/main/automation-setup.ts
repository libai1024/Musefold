// AI 安全配置交接：控制面只读脱敏状态、切换已配置 Provider，或唤起原生表单。
// 账号密码与 API Key 永远不进入 HTTP/MCP/CLI 请求。

import { randomUUID } from 'node:crypto';
import { app } from 'electron';
import {
  AutomationError,
  type AutomationRouteContext,
  type AutomationRouteHandler,
} from '@musefold/automation-server';
import { OFFICIAL_CLOUD_API_BASE } from '@musefold/contracts';
import type { ProviderConfig } from '@musefold/desktop-contracts/models';
import type {
  AutomationProviderDraft,
  AutomationSetupRequest,
} from '@musefold/desktop-contracts/ipc';
import { IPC } from '@musefold/desktop-contracts/ipc';
import { apiBase, readSessionToken, fetchAccountStatus } from './ipc-v25/account-domain';
import { getMainWindow } from './window';
import { getMusefoldCore } from './core-instance';
import { createElectronLocalAdminOps } from './automation-local';
import { getAccountCloudStatus } from '../system/account-cloud-connection';

const PROVIDER_TYPES = new Set<ProviderConfig['type']>(['openai', 'openai-compatible']);
const SENSITIVE_FIELD = /(api[-_]?key|password|token|secret|credential)/i;

// Legacy core ProviderConfig is the local-provider creation contract. Its stored rows also
// include host-owned v25 cloud connections, which must never require a local API key.
const isCloudProvider = (provider: ProviderConfig) => String(provider.type) === 'musefold-cloud';

/** setup/status 只暴露登录与服务器形态,不透传余额等账号细节(脱敏面)。 */
export interface AutomationAccountSnapshot {
  loggedIn: boolean;
  health: 'ok' | 'unknown';
  isDefaultServer: boolean;
}

export interface AutomationSetupDependencies {
  accountStatus(): Promise<AutomationAccountSnapshot>;
  listProviders(): ProviderConfig[];
  setActiveProvider(providerId: string): unknown;
  openSetup(request: AutomationSetupRequest): void;
  providerChanged(providerId: string): void;
  cloudReadyProviderId?(): Promise<string | null>;
}

function objectBody(context: AutomationRouteContext): Record<string, unknown> {
  if (
    !context.body ||
    typeof context.body !== 'object' ||
    Array.isArray(context.body) ||
    Buffer.isBuffer(context.body)
  ) {
    throw new AutomationError('INVALID_PARAMS', '请求体必须是 JSON 对象', 400);
  }
  return context.body as Record<string, unknown>;
}

function rejectSensitiveFields(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD.test(key)) {
      throw new AutomationError(
        'CREDENTIALS_NOT_ACCEPTED',
        '请只在 Musefold 原生界面输入账号凭据或 API Key',
        400,
        { field: key },
      );
    }
    rejectSensitiveFields(child);
  }
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string')
    throw new AutomationError('INVALID_PARAMS', `${field} 必须是字符串`, 400);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AutomationError('INVALID_PARAMS', `${field} 长度必须为 1-${maxLength}`, 400);
  }
  return normalized;
}

function providerDraft(value: unknown): AutomationProviderDraft | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AutomationError('INVALID_PARAMS', 'draft 必须是对象', 400);
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set(['name', 'type', 'baseUrl', 'model']);
  const unknown = Object.keys(raw).find((key) => !allowed.has(key));
  if (unknown) throw new AutomationError('INVALID_PARAMS', `draft 不支持字段 ${unknown}`, 400);

  const name = optionalText(raw.name, 'name', 80);
  const model = optionalText(raw.model, 'model', 160);
  const baseUrl = optionalText(raw.baseUrl, 'baseUrl', 2_048);
  let type: ProviderConfig['type'] | undefined;
  if (raw.type != null) {
    if (typeof raw.type !== 'string' || !PROVIDER_TYPES.has(raw.type as ProviderConfig['type'])) {
      throw new AutomationError('INVALID_PARAMS', 'type 不是受支持的 Provider 类型', 400);
    }
    type = raw.type as ProviderConfig['type'];
  }
  if (baseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new AutomationError('INVALID_PARAMS', 'baseUrl 必须是有效 URL', 400);
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new AutomationError(
        'INVALID_PARAMS',
        'baseUrl 仅支持无凭据、查询参数和片段的 HTTP(S) URL',
        400,
      );
    }
  }
  const draft = {
    ...(name ? { name } : {}),
    ...(type ? { type } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(model ? { model } : {}),
  };
  return Object.keys(draft).length ? draft : undefined;
}

function safeProvider(provider: ProviderConfig) {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    model: provider.model,
    isActive: provider.isActive,
    managedBy: provider.managedBy,
    available: provider.hasKey,
  };
}

export function createAutomationSetupRoutes(
  deps: AutomationSetupDependencies,
): Record<string, AutomationRouteHandler> {
  return {
    'GET /v1/setup/status': async () => {
      const account = await deps.accountStatus();
      const providers = deps.listProviders();
      const cloudReady = await deps.cloudReadyProviderId?.();
      return {
        account: {
          configured: account.loggedIn,
          health: account.health,
          serverKind: account.isDefaultServer ? 'default' : 'custom',
        },
        providers: providers.map((provider) => ({
          ...safeProvider(provider),
          available: isCloudProvider(provider) ? provider.id === cloudReady : provider.hasKey,
        })),
        activeProviderId: providers.find((provider) => provider.isActive)?.id ?? null,
      };
    },
    'POST /v1/setup/open': (context) => {
      const raw = objectBody(context);
      rejectSensitiveFields(raw);
      const allowed = new Set(['kind', 'mode', 'draft']);
      const unknown = Object.keys(raw).find((key) => !allowed.has(key));
      if (unknown) throw new AutomationError('INVALID_PARAMS', `不支持字段 ${unknown}`, 400);
      if (raw.kind !== 'account' && raw.kind !== 'provider') {
        throw new AutomationError('INVALID_PARAMS', 'kind 必须是 account 或 provider', 400);
      }
      if (raw.mode != null && raw.mode !== 'login' && raw.mode !== 'register') {
        throw new AutomationError('INVALID_PARAMS', 'mode 必须是 login 或 register', 400);
      }
      if (raw.kind === 'account' && raw.draft != null) {
        throw new AutomationError('INVALID_PARAMS', '账号配置不接受 draft 或任何凭据', 400);
      }
      const request: AutomationSetupRequest = {
        requestId: randomUUID(),
        kind: raw.kind,
        ...(raw.kind === 'account'
          ? { mode: (raw.mode as 'login' | 'register' | undefined) ?? 'login' }
          : {}),
        ...(raw.kind === 'provider' ? { draft: providerDraft(raw.draft) } : {}),
      };
      deps.openSetup(request);
      return {
        opened: true,
        requestId: request.requestId,
        kind: request.kind,
        message:
          request.kind === 'account'
            ? '已打开 Musefold 账号页。请让用户只在应用内输入账号和密码。'
            : '已打开 Musefold 中转站配置。请让用户只在应用内输入 API Key 并测试连接。',
      };
    },
    'GET /v1/providers': async () => {
      const ready = await deps.cloudReadyProviderId?.();
      return {
        providers: deps.listProviders().map((provider) => ({
          ...provider,
          available: isCloudProvider(provider) ? provider.id === ready : provider.hasKey,
        })),
      };
    },
    'POST /v1/setup/providers/:id/activate': async (context) => {
      const provider = deps.listProviders().find((item) => item.id === context.params.id);
      if (!provider)
        throw new AutomationError('NOT_FOUND', 'Provider 不存在', 404, {
          providerId: context.params.id,
        });
      const available = isCloudProvider(provider)
        ? provider.id === (await deps.cloudReadyProviderId?.())
        : provider.hasKey;
      if (!available) {
        throw new AutomationError(
          'PROVIDER_NOT_READY',
          'Provider 尚未配置凭据，请先打开 Musefold 原生配置页',
          409,
          { providerId: provider.id },
        );
      }
      await deps.setActiveProvider(provider.id);
      deps.providerChanged(provider.id);
      return { selected: { ...safeProvider(provider), available, isActive: true } };
    },
  };
}

export function createElectronAutomationSetupRoutes(): Record<string, AutomationRouteHandler> {
  return createAutomationSetupRoutes({
    cloudReadyProviderId: async () => {
      if (!getMusefoldCore().providers.list().some(isCloudProvider)) return null;
      const status = await getAccountCloudStatus();
      return status.mode === 'active' ? status.connectionId : null;
    },
    // A cached token alone is not proof that the account service is reachable.
    accountStatus: async () => {
      const token = await readSessionToken();
      const loggedIn = token !== null;
      let health: AutomationAccountSnapshot['health'] = 'unknown';
      if (token) {
        try {
          await fetchAccountStatus(token);
          health = 'ok';
        } catch {
          /* Remain unknown. */
        }
      }
      return {
        loggedIn,
        health,
        isDefaultServer: apiBase() === OFFICIAL_CLOUD_API_BASE,
      };
    },
    listProviders: () => getMusefoldCore().providers.list(),
    setActiveProvider: (providerId) => createElectronLocalAdminOps().setActiveProvider(providerId),
    openSetup(request) {
      const window = getMainWindow();
      if (!window || window.isDestroyed())
        throw new AutomationError('APP_UI_UNAVAILABLE', 'Musefold 主窗口尚未就绪', 409);
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (process.platform === 'darwin') app.focus({ steal: true });
      window.webContents.send(IPC.AUTOMATION_SETUP_REQUESTED, request);
    },
    providerChanged(providerId) {
      const window = getMainWindow();
      if (window && !window.isDestroyed())
        window.webContents.send(IPC.AUTOMATION_PROVIDER_CHANGED, { providerId });
    },
  });
}
