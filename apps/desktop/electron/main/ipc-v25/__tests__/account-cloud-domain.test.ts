import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  local: vi.fn(),
  cloudList: vi.fn(),
  legacy: vi.fn(),
  item: vi.fn(),
  reconcile: vi.fn(),
  cancel: vi.fn(),
  status: vi.fn(),
  review: vi.fn(),
}));
vi.mock('../../../system/managed-generation-client', () => ({
  withManagedGenerationSession: mocks.session,
}));
vi.mock('../../../system/managed-execution', () => ({ withManagedExecution: mocks.local }));
vi.mock('../../../system/account-cloud-recovery', () => ({
  listAccountCloudRecovery: mocks.cloudList,
  listLegacyManagedDiagnostics: mocks.legacy,
  accountCloudRecoveryItem: mocks.item,
}));
vi.mock('../../../system/account-cloud-connection', () => ({
  getAccountCloudStatus: mocks.status,
  applyAccountCloudReview: mocks.review,
  managedConnectionMessage: () => '核对失败，请刷新原任务',
}));
vi.mock('../../../system/managed-generation-runtime', () => ({
  reconcileManagedGeneration: mocks.reconcile,
  cancelManagedGeneration: mocks.cancel,
}));
import { buildAccountCloudDomainMethods } from '../account-cloud-domain';

const context = {
  apiIssuer: 'https://api.example.invalid',
  principalId: 'owner',
  authEpoch: 'captured',
};
const ledger = {};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockImplementation(async (work) => work({ client: { context }, ledger }));
  mocks.local.mockImplementation(async (work) => work({}));
});
describe('account cloud recovery IPC boundary', () => {
  it('validates strict cursor input and forwards it inside the captured owner session', async () => {
    const method = buildAccountCloudDomainMethods()['accountCloud.listRecovery'];
    const page = { items: [], nextCursor: null };
    mocks.cloudList.mockReturnValue(page);
    expect(method.input.safeParse({ cursor: 'page', principalId: 'foreign' }).success).toBe(false);
    expect(method.input.safeParse({ cursor: '' }).success).toBe(false);
    expect(await method.handle({ cursor: 'page' })).toBe(page);
    expect(mocks.cloudList).toHaveBeenCalledWith(ledger, context, { cursor: 'page' });
  });
  it('uses only the local database scope for legacy diagnostics while signed out', async () => {
    const page = { items: [], nextCursor: null };
    mocks.legacy.mockReturnValue(page);
    expect(
      await buildAccountCloudDomainMethods()['accountCloud.listLegacy'].handle(undefined),
    ).toBe(page);
    expect(mocks.legacy).toHaveBeenCalledWith({});
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it.each(['reconcile', 'cancel'] as const)(
    'awaits %s before reading its owned recovery result',
    async (action) => {
      const result = { requestId: 'original' };
      mocks.item.mockReturnValue(result);
      expect(
        await buildAccountCloudDomainMethods()[`accountCloud.${action}`].handle({
          requestId: 'original',
        }),
      ).toBe(result);
      expect(mocks[action]).toHaveBeenCalledExactlyOnceWith('original');
      expect(mocks.item).toHaveBeenCalledWith('original', ledger, context);
      expect(mocks[action].mock.invocationCallOrder[0]).toBeLessThan(
        mocks.item.mock.invocationCallOrder[0],
      );
    },
  );
  it('does not return stale task data after the new owner/session check rejects', async () => {
    mocks.session.mockRejectedValue(new Error('synthetic private identity detail'));
    await expect(
      buildAccountCloudDomainMethods()['accountCloud.reconcile'].handle({ requestId: 'original' }),
    ).rejects.toThrow('核对失败，请刷新原任务');
    expect(mocks.item).not.toHaveBeenCalled();
  });
});
