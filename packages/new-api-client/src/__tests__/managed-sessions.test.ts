import { describe, expect, it, vi } from 'vitest';
import { createNewApiClient } from '../index';

function fixture(body: unknown, status = 200) {
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const managed = createNewApiClient('https://accounts.example', { fetchImpl }).managedSessions;
  if (!managed) throw new Error('Missing managed protocol');
  return { managed, fetchImpl };
}
describe('managed session response boundaries', () => {
  it.each(['', '<html>rate limited</html>'])(
    'handles empty/non-JSON middleware 429 safely (%j)',
    async (body) => {
      const managed = createNewApiClient('https://accounts.example', {
        fetchImpl: async () => new Response(body, { status: 429 }),
      }).managedSessions;
      await expect(managed?.begin({ username: 'a', password: 'synthetic' })).rejects.toMatchObject({
        code: 'network',
        httpStatus: 429,
        message: '账号服务器请求过于频繁，请稍后再试',
      });
    },
  );
  it('preserves only the issuance retry timestamp and safe error copy', async () => {
    const { managed } = fixture(
      {
        success: false,
        code: 'AUTH_SESSION_ISSUANCE_LIMIT',
        retry_at: 1790006400,
        message: 'private-upstream-body',
      },
      429,
    );
    await expect(managed.begin({ username: 'a', password: 'synthetic' })).rejects.toMatchObject({
      code: 'AUTH_SESSION_ISSUANCE_LIMIT',
      retryAt: new Date(1790006400000).toISOString(),
      message: '登录设备操作未完成，请核对后重试',
    });
  });
  it.each([{}, { released: false }, { revoked_count: 1 }])(
    'never treats unconfirmed release as success (%j)',
    async (data) => {
      const { managed } = fixture({ success: true, data });
      await expect(
        managed.release({ sid: 'synthetic-sid', token: 'synthetic-cleanup' }),
      ).rejects.toMatchObject({ code: 'server' });
    },
  );
  it('sends the exact operation and selection for authenticated batch release', async () => {
    const { managed, fetchImpl } = fixture({ success: true, data: { revoked_count: 1 } });
    const input = { operationId: 'same-operation', selected: [{ sid: 'fixed-sid', version: 2 }] };
    expect(await managed.revoke('synthetic-jwt', input)).toBe(1);
    const request = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(request[1].body))).toEqual({
      operation: input.operationId,
      selected: input.selected,
    });
    expect(request[1].redirect).toBe('error');
  });
});
