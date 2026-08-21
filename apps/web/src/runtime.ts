import {
  type AccountSession,
  type ApiErrorCode,
  type CreateGenerationInput,
  type GenerationHistoryPage,
  type GenerationJob,
  type LoginRequest,
  type McpConnectionPage,
  type PromptDocument,
  type PromptListQuery,
  type PromptPage,
  type PromptUseInput,
  type PromptUseResult,
  type UpdatePromptDocument,
  type CreateWorkbenchSession,
  type UpdateWorkbenchSession,
  type WorkbenchSession,
  type WorkbenchSessionListQuery,
  type WorkbenchSessionPage,
  type GenerationHistoryQuery,
} from '@musefold/contracts';
import {
  createMusefoldCloudClient,
  MusefoldCloudError,
  type GenerationEvent,
  type MusefoldCloudClient,
} from '@musefold/cloud-client';
import type {
  AccountGateway,
  GenerationGateway,
  HistoryGateway,
  PromptGateway,
  WorkbenchGateway,
} from '@musefold/domain';
import { resolveWebGatewayMode } from './runtime-mode';

export interface WebGateway
  extends
    PromptGateway,
    WorkbenchGateway,
    GenerationGateway,
    HistoryGateway,
    AccountGateway {
  readonly mode: 'api' | 'fixture';
}

export class WebGatewayError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'WebGatewayError';
  }
}

class HttpWebGateway implements WebGateway {
  readonly mode = 'api' as const;
  private readonly client: MusefoldCloudClient;

  constructor(baseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api/musefold/v1') {
    this.client = createMusefoldCloudClient(baseUrl);
  }

  getSession(): Promise<AccountSession> {
    return this.call(() => this.client.getSession());
  }

  login(input: LoginRequest): Promise<AccountSession> {
    return this.call(() => this.client.login(input));
  }

  async logout(): Promise<void> {
    await this.call(() => this.client.logout());
  }

  listPrompts(query: PromptListQuery): Promise<PromptPage> {
    return this.call(() => this.client.listPrompts(query));
  }

  getPrompt(id: string): Promise<PromptDocument> {
    return this.call(() => this.client.getPrompt(id));
  }

  createPrompt(input: Parameters<MusefoldCloudClient['createPrompt']>[0]): Promise<PromptDocument> {
    return this.call(() => this.client.createPrompt(input));
  }

  updatePrompt(id: string, input: UpdatePromptDocument): Promise<PromptDocument> {
    return this.call(() => this.client.updatePrompt(id, input));
  }

  deletePrompt(id: string, expectedVersion: number): Promise<PromptDocument> {
    return this.call(() => this.client.deletePrompt(id, expectedVersion));
  }

  restorePrompt(id: string, expectedVersion: number): Promise<PromptDocument> {
    return this.call(() => this.client.restorePrompt(id, expectedVersion));
  }

  usePrompt(id: string, input: PromptUseInput): Promise<PromptUseResult> {
    return this.call(() => this.client.usePrompt(id, input));
  }

  createGeneration(input: CreateGenerationInput, idempotencyKey: string): Promise<GenerationJob> {
    return this.call(() => this.client.createGeneration(input, idempotencyKey));
  }

  getGeneration(id: string): Promise<GenerationJob> {
    return this.call(() => this.client.getGeneration(id));
  }

  streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.call(() => this.client.streamGenerationEvents(id, afterSeq, onEvent, signal));
  }

  cancelGeneration(id: string): Promise<GenerationJob> {
    return this.call(() => this.client.cancelGeneration(id));
  }

  retryGeneration(id: string, idempotencyKey: string): Promise<GenerationJob> {
    return this.call(() => this.client.retryGeneration(id, idempotencyKey));
  }

  deleteGeneration(id: string): Promise<GenerationJob> {
    return this.call(() => this.client.deleteGeneration(id));
  }

  restoreGeneration(id: string): Promise<GenerationJob> {
    return this.call(() => this.client.restoreGeneration(id));
  }

  approveGeneration(id: string, token: string): Promise<GenerationJob> {
    return this.call(() => this.client.approveGeneration(id, token));
  }

  listGenerationHistory(query: GenerationHistoryQuery): Promise<GenerationHistoryPage> {
    return this.call(() => this.client.listGenerationHistory(query));
  }

  listWorkbenchSessions(query: WorkbenchSessionListQuery): Promise<WorkbenchSessionPage> {
    return this.call(() => this.client.listWorkbenchSessions(query));
  }

  getWorkbenchSession(id: string): Promise<WorkbenchSession> {
    return this.call(() => this.client.getWorkbenchSession(id));
  }

  createWorkbenchSession(input: CreateWorkbenchSession): Promise<WorkbenchSession> {
    return this.call(() => this.client.createWorkbenchSession(input));
  }

  updateWorkbenchSession(id: string, input: UpdateWorkbenchSession): Promise<WorkbenchSession> {
    return this.call(() => this.client.updateWorkbenchSession(id, input));
  }

  deleteWorkbenchSession(id: string, expectedVersion: number): Promise<WorkbenchSession> {
    return this.call(() => this.client.deleteWorkbenchSession(id, expectedVersion));
  }

  listConnections(): Promise<McpConnectionPage> {
    return this.call(() => this.client.listConnections());
  }

  updateConnection(
    id: string,
    input: Parameters<MusefoldCloudClient['updateConnection']>[1],
  ): Promise<McpConnectionPage> {
    return this.call(() => this.client.updateConnection(id, input));
  }

  async revokeConnection(id: string): Promise<void> {
    await this.call(() => this.client.revokeConnection(id));
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof MusefoldCloudError)
        throw new WebGatewayError(error.code, error.message, error.details);
      throw error;
    }
  }
}

class DeferredFixtureWebGateway implements WebGateway {
  readonly mode = 'fixture' as const;
  private readonly delegate = import('./fixture-runtime').then(
    ({ FixtureWebGateway }) => new FixtureWebGateway(),
  );

  async getSession(): Promise<AccountSession> {
    return (await this.delegate).getSession();
  }

  async login(input: LoginRequest): Promise<AccountSession> {
    return (await this.delegate).login(input);
  }

  async logout(): Promise<void> {
    return (await this.delegate).logout();
  }

  async listPrompts(query: PromptListQuery): Promise<PromptPage> {
    return (await this.delegate).listPrompts(query);
  }

  async getPrompt(id: string): Promise<PromptDocument> {
    return (await this.delegate).getPrompt(id);
  }

  async createPrompt(
    input: Parameters<MusefoldCloudClient['createPrompt']>[0],
  ): Promise<PromptDocument> {
    return (await this.delegate).createPrompt(input);
  }

  async updatePrompt(id: string, input: UpdatePromptDocument): Promise<PromptDocument> {
    return (await this.delegate).updatePrompt(id, input);
  }

  async deletePrompt(id: string, expectedVersion: number): Promise<PromptDocument> {
    return (await this.delegate).deletePrompt(id, expectedVersion);
  }

  async restorePrompt(id: string, expectedVersion: number): Promise<PromptDocument> {
    return (await this.delegate).restorePrompt(id, expectedVersion);
  }

  async usePrompt(id: string, input: PromptUseInput): Promise<PromptUseResult> {
    return (await this.delegate).usePrompt(id, input);
  }

  async createGeneration(
    input: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob> {
    return (await this.delegate).createGeneration(input, idempotencyKey);
  }

  async getGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).getGeneration(id);
  }

  async streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void> {
    return (await this.delegate).streamGenerationEvents(id, afterSeq, onEvent, signal);
  }

  async cancelGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).cancelGeneration(id);
  }

  async retryGeneration(id: string, idempotencyKey: string): Promise<GenerationJob> {
    return (await this.delegate).retryGeneration(id, idempotencyKey);
  }

  async deleteGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).deleteGeneration(id);
  }

  async restoreGeneration(id: string): Promise<GenerationJob> {
    return (await this.delegate).restoreGeneration(id);
  }

  async approveGeneration(id: string, token: string): Promise<GenerationJob> {
    return (await this.delegate).approveGeneration(id, token);
  }

  async listGenerationHistory(query: GenerationHistoryQuery): Promise<GenerationHistoryPage> {
    return (await this.delegate).listGenerationHistory(query);
  }

  async listWorkbenchSessions(query: WorkbenchSessionListQuery): Promise<WorkbenchSessionPage> {
    return (await this.delegate).listWorkbenchSessions(query);
  }

  async getWorkbenchSession(id: string): Promise<WorkbenchSession> {
    return (await this.delegate).getWorkbenchSession(id);
  }

  async createWorkbenchSession(input: CreateWorkbenchSession): Promise<WorkbenchSession> {
    return (await this.delegate).createWorkbenchSession(input);
  }

  async updateWorkbenchSession(
    id: string,
    input: UpdateWorkbenchSession,
  ): Promise<WorkbenchSession> {
    return (await this.delegate).updateWorkbenchSession(id, input);
  }

  async deleteWorkbenchSession(id: string, expectedVersion: number): Promise<WorkbenchSession> {
    return (await this.delegate).deleteWorkbenchSession(id, expectedVersion);
  }

  async listConnections(): Promise<McpConnectionPage> {
    return (await this.delegate).listConnections();
  }

  async updateConnection(
    id: string,
    input: Parameters<MusefoldCloudClient['updateConnection']>[1],
  ): Promise<McpConnectionPage> {
    return (await this.delegate).updateConnection(id, input);
  }

  async revokeConnection(id: string): Promise<void> {
    return (await this.delegate).revokeConnection(id);
  }
}

export function createWebGateway(): WebGateway {
  if (
    resolveWebGatewayMode({
      isDevelopment: import.meta.env.DEV,
      useFixtures: import.meta.env.VITE_USE_FIXTURES,
    }) === 'fixture'
  ) {
    return new DeferredFixtureWebGateway();
  }
  return new HttpWebGateway();
}
