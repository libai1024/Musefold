import { describe, expect, it, vi } from 'vitest';
import { createNewApiClient, noticeId } from '../index';

function client(status: unknown, notice: unknown, code = 200) {
  const fetchImpl = vi.fn(
    async (url: string | URL | Request) =>
      new Response(
        JSON.stringify({ success: true, data: String(url).endsWith('/status') ? status : notice }),
        { status: code },
      ),
  );
  return {
    api: createNewApiClient('https://notices.example', { fetchImpl: fetchImpl as typeof fetch }),
    fetchImpl,
  };
}

describe('independent service notice reads', () => {
  it('normalizes and deduplicates content across both sources without credentials', async () => {
    const { api, fetchImpl } = client(
      {
        announcements: [
          ' 公告 ',
          { content: '公告' },
          { text: '<script>literal</script>', publishDate: '1970-01-01T00:00:00Z' },
        ],
      },
      '公告',
    );
    expect(await api.getNotices({ strict: true })).toEqual([
      {
        id: noticeId('公告'),
        content: '公告',
        publishedAt: null,
        legacyReadIds: [noticeId(' 公告 ')],
      },
      {
        id: noticeId('<script>literal</script>'),
        content: '<script>literal</script>',
        publishedAt: 0,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls as unknown as [string, RequestInit][]) {
      expect(init.method).toBe('GET');
      expect(new Headers(init.headers).has('authorization')).toBe(false);
      expect(init.body).toBeUndefined();
    }
  });
  it('distinguishes a verified empty feed from an unavailable feed', async () => {
    await expect(
      client({ announcements: [] }, '').api.getNotices({ strict: true }),
    ).resolves.toEqual([]);
    await expect(client({}, '', 503).api.getNotices({ strict: true })).rejects.toMatchObject({
      code: 'server',
    });
    await expect(client({}, '', 503).api.getNotices()).resolves.toEqual([]);
  });
  it.each([
    { announcements: [{ content: { private: 'must-not-stringify' } }] },
    { announcements: ['x'.repeat(16_385)] },
    { announcements: Array.from({ length: 101 }, (_, i) => `notice-${i}`) },
  ])('rejects malformed or oversized feeds without leaking their contents', async (data) => {
    await expect(client(data, '').api.getNotices({ strict: true })).rejects.toMatchObject({
      code: 'server',
      message: '账号服务器公告格式无效',
    });
  });
});
