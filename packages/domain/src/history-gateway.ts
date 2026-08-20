import type {
  GenerationHistoryPage,
  GenerationHistoryQuery,
  GenerationJob,
} from '@musefold/contracts';

/**
 * 生成历史分页查询与软删 / 恢复。
 * 方法名照抄 WebGateway（listGenerationHistory / deleteGeneration / restoreGeneration）。
 */
export interface HistoryGateway {
  listGenerationHistory(
    query: GenerationHistoryQuery,
  ): Promise<GenerationHistoryPage>;
  deleteGeneration(id: string): Promise<GenerationJob>;
  restoreGeneration(id: string): Promise<GenerationJob>;
}
