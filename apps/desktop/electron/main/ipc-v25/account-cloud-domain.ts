import { z } from 'zod';
import {
  accountCloudReviewInputSchema,
  accountCloudReconcileInputSchema,
  accountCloudPageQuerySchema,
} from '@musefold/contracts';
import { withManagedGenerationSession } from '../../system/managed-generation-client';
import { withManagedExecution } from '../../system/managed-execution';
import {
  listAccountCloudRecovery,
  listLegacyManagedDiagnostics,
  accountCloudRecoveryItem,
} from '../../system/account-cloud-recovery';
import {
  getAccountCloudStatus,
  applyAccountCloudReview,
  managedConnectionMessage,
} from '../../system/account-cloud-connection';
import {
  reconcileManagedGeneration,
  cancelManagedGeneration,
} from '../../system/managed-generation-runtime';
import { BridgeError, type MethodDef } from './envelope';

async function publicResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new BridgeError('ACCOUNT_CLOUD_REVIEW_REQUIRED', managedConnectionMessage(error));
  }
}

export function buildAccountCloudDomainMethods(): Record<string, MethodDef> {
  return {
    'accountCloud.getStatus': {
      input: z.undefined().or(z.object({}).strict()),
      handle: () => getAccountCloudStatus(),
    },
    'accountCloud.connect': {
      input: accountCloudReviewInputSchema,
      handle: (input) =>
        publicResult(() =>
          applyAccountCloudReview(accountCloudReviewInputSchema.parse(input).reviewRef, 'connect'),
        ),
    },
    'accountCloud.resume': {
      input: accountCloudReviewInputSchema,
      handle: (input) =>
        publicResult(() =>
          applyAccountCloudReview(accountCloudReviewInputSchema.parse(input).reviewRef, 'resume'),
        ),
    },
    'accountCloud.listRecovery': {
      input: accountCloudPageQuerySchema.optional(),
      handle: (input) =>
        publicResult(() =>
          withManagedGenerationSession(async ({ client, ledger }) =>
            listAccountCloudRecovery(
              ledger,
              client.context,
              accountCloudPageQuerySchema.parse(input ?? {}),
            ),
          ),
        ),
    },
    'accountCloud.listLegacy': {
      input: accountCloudPageQuerySchema.optional(),
      handle: (input) =>
        publicResult(() =>
          withManagedExecution(async () =>
            listLegacyManagedDiagnostics(accountCloudPageQuerySchema.parse(input ?? {})),
          ),
        ),
    },
    'accountCloud.reconcile': {
      input: accountCloudReconcileInputSchema,
      handle: async (input) => {
        await publicResult(() =>
          reconcileManagedGeneration(accountCloudReconcileInputSchema.parse(input).requestId),
        );
        return publicResult(() =>
          withManagedGenerationSession(async ({ client, ledger }) =>
            accountCloudRecoveryItem(
              accountCloudReconcileInputSchema.parse(input).requestId,
              ledger,
              client.context,
            ),
          ),
        );
      },
    },
    'accountCloud.cancel': {
      input: accountCloudReconcileInputSchema,
      handle: async (input) => {
        await publicResult(() =>
          cancelManagedGeneration(accountCloudReconcileInputSchema.parse(input).requestId),
        );
        return publicResult(() =>
          withManagedGenerationSession(async ({ client, ledger }) =>
            accountCloudRecoveryItem(
              accountCloudReconcileInputSchema.parse(input).requestId,
              ledger,
              client.context,
            ),
          ),
        );
      },
    },
  };
}
