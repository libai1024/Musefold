/** Desktop transport for the shared analyst role; authorization and IO stay in the host. */
import {
  analystReportSchema,
  type AnalystInput,
  type AnalystReport,
} from '@musefold/contracts/design-scheme-model';
import { buildAnalystPrompt } from '@musefold/domain/design-scheme/analyst-prompt';
import { completeStructured, type OpenAiCompatibleTextAdapter } from '../text-adapter';

export type { AnalystInput } from '@musefold/contracts/design-scheme-model';

export async function runRepositoryAnalyst(
  adapter: OpenAiCompatibleTextAdapter,
  input: AnalystInput,
  signal?: AbortSignal,
): Promise<{ report: AnalystReport; model: string; retried: boolean }> {
  const result = await completeStructured({
    adapter,
    schema: analystReportSchema,
    ...buildAnalystPrompt(input),
    signal,
    label: '仓库分析',
  });
  return { report: result.value, model: result.model, retried: result.retried };
}
