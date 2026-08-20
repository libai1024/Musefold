import type { CreateGenerationInput, GenerationJob } from '@musefold/contracts';

/**
 * 生图进度事件信封。字段与 @musefold/cloud-client 的 GenerationEvent 结构一致，
 * 写在 domain 以免端口依赖 cloud-client / desktop-contracts。
 */
export interface GenerationEvent {
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * 生图提交、作业查询、进度订阅与运行控制（取消 / 重试 / 审批）。
 * 历史软删与恢复见 HistoryGateway。
 */
export interface GenerationGateway {
  createGeneration(
    input: CreateGenerationInput,
    idempotencyKey: string,
  ): Promise<GenerationJob>;
  getGeneration(id: string): Promise<GenerationJob>;
  streamGenerationEvents(
    id: string,
    afterSeq: number,
    onEvent: (event: GenerationEvent) => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<void>;
  cancelGeneration(id: string): Promise<GenerationJob>;
  retryGeneration(id: string, idempotencyKey: string): Promise<GenerationJob>;
  approveGeneration(id: string, token: string): Promise<GenerationJob>;
}
