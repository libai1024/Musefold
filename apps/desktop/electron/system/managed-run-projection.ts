import { automationInputHash } from '@musefold/core/db/repositories/automation-spend';
import { ManagedExecutionError } from '@musefold/core/db/repositories/managed-execution';
import type { ManagedRunRegistration } from '@musefold/desktop-contracts/managed-generation';
import type { GenerateImageRequest } from '@musefold/desktop-contracts/providers';

/** Trusted host context, never renderer/API input or cloud spend authority. */
export type LocalRunProjection = Pick<GenerateImageRequest, 'workbench' | 'promptReferences'> & {
  /** Source identity captured from the prepared, digest-checked Skill runtime. */
  skillRuntimeSource?: Pick<
    NonNullable<GenerateImageRequest['skillRuntime']>,
    'label' | 'repositoryUrl'
  >;
};

export function assertChildProjection(
  req: GenerateImageRequest,
  ordinal: number,
  projection: LocalRunProjection | undefined,
  runKind: ManagedRunRegistration['runKind'],
): void {
  const expectedWorkbench = projection?.workbench
    ? { ...projection.workbench, resultIndex: ordinal }
    : null;
  const source = projection?.skillRuntimeSource;
  const skillMatches = source
    ? runKind === 'run_github_skill' &&
      req.skillRuntime?.label === source.label &&
      req.skillRuntime.repositoryUrl === source.repositoryUrl
    : req.skillRuntime === undefined;
  if (
    req.promptId ||
    req.parentHistoryId ||
    req.sourceAssetId ||
    !skillMatches ||
    automationInputHash(req.workbench ?? null) !== automationInputHash(expectedWorkbench) ||
    automationInputHash(req.promptReferences ?? []) !==
      automationInputHash(projection?.promptReferences ?? [])
  )
    throw new ManagedExecutionError('MANAGED_INPUT_UNSUPPORTED');
}
