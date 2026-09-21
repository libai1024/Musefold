/** Desktop transport for the shared compiler role; authorization and IO stay in the host. */
import {
  compilerOutputSchema,
  type CompilerInput,
  type CompilerOutput,
} from '@musefold/contracts/design-scheme-model';
import { buildCompilerPrompt } from '@musefold/domain/design-scheme/compiler-prompt';
import { completeStructured, type OpenAiCompatibleTextAdapter } from '../text-adapter';

export type { CompilerInput } from '@musefold/contracts/design-scheme-model';

export async function runSchemeCompiler(
  adapter: OpenAiCompatibleTextAdapter,
  input: CompilerInput,
  signal?: AbortSignal,
): Promise<{ output: CompilerOutput; model: string; retried: boolean }> {
  const result = await completeStructured({
    adapter,
    schema: compilerOutputSchema,
    ...buildCompilerPrompt(input),
    signal,
    label: '方案编译',
  });
  return { output: result.value, model: result.model, retried: result.retried };
}
