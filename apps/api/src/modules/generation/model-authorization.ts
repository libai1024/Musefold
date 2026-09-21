import {
  accountModelCatalogSchema,
  type AccountModelCatalog,
  type ExecutionBinding,
} from '@musefold/contracts';
import { supportsCloudImageGeneration } from '@musefold/domain/cloud-generation-policy';
import { AppError } from '../../lib/errors.js';

export type AccountModelCatalogReader = (sessionId: string) => Promise<AccountModelCatalog>;

/** Read again for each new intent. Accepted idempotency keys bypass this lookup entirely. */
export async function readGenerationModelAuthorization(
  readCatalog: AccountModelCatalogReader | undefined,
  sessionId: string,
  model: string,
) {
  if (!readCatalog)
    throw new AppError('GENERATION_UPSTREAM_UNKNOWN', '云端模型目录暂不可用，请刷新后重试', 503);
  const parsed = accountModelCatalogSchema.safeParse(await readCatalog(sessionId));
  if (!parsed.success)
    throw new AppError('GENERATION_UPSTREAM_UNKNOWN', '云端模型目录无效，请刷新后重试', 503);
  const catalog = parsed.data;
  const selected = catalog.models.find((entry) => entry.model === model);
  if (!selected) throw new AppError('VALIDATION_FAILED', '当前账号不支持所选生图模型', 409);
  if (selected.pricing.kind === 'unavailable')
    throw new AppError(
      'GENERATION_UPSTREAM_UNKNOWN',
      '所选模型的云端价格不可用，请刷新后重试',
      503,
    );
  if (!supportsCloudImageGeneration(model, selected.supportedEndpointTypes))
    throw new AppError('VALIDATION_FAILED', '当前账号不支持所选生图模型', 409);
  return { model, identity: catalog.identity };
}

/** Compare after database authority locks, so an in-flight catalog cannot cross credentials. */
export function assertModelAuthorizationIdentity(
  authorization: Awaited<ReturnType<typeof readGenerationModelAuthorization>>,
  binding: ExecutionBinding,
) {
  const identity = authorization.identity;
  if (
    identity.apiIssuer !== binding.apiIssuer ||
    identity.principalId !== binding.principalId ||
    identity.payer.issuer !== binding.payer.issuer ||
    identity.payer.ownerId !== binding.payer.ownerId ||
    identity.credential.ref !== binding.credential.ref ||
    identity.credential.version !== binding.credential.version ||
    authorization.model !== binding.model
  )
    throw new AppError(
      'GENERATION_BINDING_CHANGED',
      '账号或凭据已变化，请刷新模型列表后重新提交',
      409,
    );
}
