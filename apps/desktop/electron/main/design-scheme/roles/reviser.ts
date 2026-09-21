/** Desktop transport for the shared reviser role; revision persistence stays in the host. */
import {
  compilerOutputSchema,
  type CompilerOutput,
  type ReviserInput,
} from '@musefold/contracts/design-scheme-model';
import { buildReviserPrompt } from '@musefold/domain/design-scheme/reviser-prompt';
import { completeStructured, type OpenAiCompatibleTextAdapter } from '../text-adapter';

export type { ReviserInput } from '@musefold/contracts/design-scheme-model';

export async function runSchemeReviser(
  adapter: OpenAiCompatibleTextAdapter,
  input: ReviserInput,
  signal?: AbortSignal,
): Promise<{ output: CompilerOutput; model: string; retried: boolean }> {
  const result = await completeStructured({
    adapter,
    schema: compilerOutputSchema,
    ...buildReviserPrompt(input),
    signal,
    label: '方案修订',
  });
  return { output: result.value, model: result.model, retried: result.retried };
}
