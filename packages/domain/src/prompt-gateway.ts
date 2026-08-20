import type {
  NewPromptDocument,
  PromptDocument,
  PromptListQuery,
  PromptPage,
  PromptUseInput,
  PromptUseResult,
  UpdatePromptDocument,
} from '@musefold/contracts';

/**
 * Prompt CRUD 与使用记录。
 * 方法名、参数顺序与 Promise 包装照抄 WebGateway；createPrompt 的入参
 * 对应 WebGateway 的 Parameters<MusefoldCloudClient['createPrompt']>[0]
 * （即 contracts 的 NewPromptDocument），domain 不引用 cloud-client。
 */
export interface PromptGateway {
  listPrompts(query: PromptListQuery): Promise<PromptPage>;
  getPrompt(id: string): Promise<PromptDocument>;
  createPrompt(input: NewPromptDocument): Promise<PromptDocument>;
  updatePrompt(
    id: string,
    input: UpdatePromptDocument,
  ): Promise<PromptDocument>;
  deletePrompt(id: string, expectedVersion: number): Promise<PromptDocument>;
  restorePrompt(id: string, expectedVersion: number): Promise<PromptDocument>;
  usePrompt(id: string, input: PromptUseInput): Promise<PromptUseResult>;
}
