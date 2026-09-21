import type {
  AutomationCostEvidence,
  AutomationPayerBinding,
} from '@musefold/desktop-contracts/automation-spend';
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageProgressHandler,
} from '@musefold/desktop-contracts/providers';
import { sanitizeProviderErrorMessage } from './sanitize-error';

/**
 * Process-local execution port. The key and callbacks must never enter request DTOs,
 * generation metadata, logs or persistence. The host owns durable claims and payer policy.
 */
export interface GenerationExecution {
  apiKey: string;
  binding: AutomationPayerBinding;
  /** Synchronous epoch/reference validation and durable claim, immediately before HTTP. */
  beforeDispatch(info: { referenceHashes: string[]; request: GenerateImageRequest }): void;
  /** Called only after a successful claim, before a late cancellation can discard output. */
  onCost(evidence: AutomationCostEvidence): void;
}

/** Host dispatch errors retain their safe code without being classified as upstream failures. */
export class GenerationDispatchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(sanitizeProviderErrorMessage(message));
    this.name = 'GenerationDispatchError';
    this.code = /^[A-Z][A-Z0-9_/-]{0,100}$/.test(code) ? code : 'AUTOMATION_DISPATCH_REJECTED';
  }
}

export function claimGenerationDispatch(
  execution: GenerationExecution,
  request: GenerateImageRequest,
  referenceHashes: string[],
): void {
  try {
    // The host can inspect/hash the final request but cannot mutate the HTTP payload or bytes.
    const result: unknown = execution.beforeDispatch({
      request: structuredClone(request),
      referenceHashes: [...referenceHashes],
    });
    if (result !== undefined) {
      // An accidentally async port must never allow HTTP before its claim settles.
      void Promise.resolve(result).catch(() => undefined);
      throw new GenerationDispatchError(
        'AUTOMATION_DISPATCH_ASYNC',
        '发送前登记必须同步完成，已停止本次生成',
      );
    }
  } catch (error) {
    if (error instanceof GenerationDispatchError) throw error;
    const cause = error as { code?: unknown; message?: unknown };
    throw new GenerationDispatchError(
      typeof cause?.code === 'string' ? cause.code : 'AUTOMATION_DISPATCH_REJECTED',
      typeof cause?.message === 'string' ? cause.message : '发送前登记未通过，已停止本次生成',
    );
  }
}

/** Host-owned remote transport; no Provider API key or serializable execution capability. */
export interface GenerationTransportExecution {
  readonly providerId: string;
  /** Trusted host has frozen and independently authorized this specific retry parent. */
  readonly retryOfRunId?: string;
  assertCurrent(): void;
  /** Receives raw caller input; the host uses its already frozen remote request exactly once. */
  generate(
    request: GenerateImageRequest,
    signal: AbortSignal,
    progress: ImageProgressHandler,
  ): Promise<GenerateImageResult>;
}
