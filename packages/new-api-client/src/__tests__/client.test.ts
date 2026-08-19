import { describe, expect, it, vi } from 'vitest';
import { createNewApiClient, NewApiClientError, normalizeNewApiUrl } from '../index';

describe('shared new-api client', () => {
  it('normalizes safe server URLs and rejects embedded credentials', () => {
    expect(normalizeNewApiUrl('https://api.example.com/')).toBe('https://api.example.com');
    expect(() => normalizeNewApiUrl('https://user:pass@example.com')).toThrow(NewApiClientError);
  });

  it('parses login access and refresh credentials without exposing them to logs', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        access_token: 'jwt-secret',
        access_expires_at: 1_787_000_000,
        user: { id: 7, username: 'musefold', quota: 9000, group: 'default' },
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'set-cookie': 'new_api_refresh=refresh-secret; HttpOnly; Path=/' },
    }));
    const client = createNewApiClient('https://api.example.com', { fetchImpl });
    const session = await client.login({ username: 'musefold', password: 'secret' });
    expect(session).toMatchObject({
      jwt: 'jwt-secret',
      refreshToken: 'refresh-secret',
      user: { id: 7, quota: 9000 },
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/api/user/login', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
    }));
  });

  it('maps all redemption failures to one non-enumerating error', async () => {
    const client = createNewApiClient('https://api.example.com', {
      fetchImpl: async () => new Response(JSON.stringify({ success: false, message: 'code already used' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    });
    await expect(client.redeem('jwt', 'bad-code')).rejects.toMatchObject({ code: 'redeem' });
  });
});
