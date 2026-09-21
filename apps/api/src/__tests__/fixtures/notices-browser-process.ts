import { serve } from '@hono/node-server';
import { createNewApiClient } from '@musefold/new-api-client';
import { startPackageExchangeApp } from './package-exchange-app.js';
import { startNewApiIdentityFixture } from './new-api-identity-fixture.js';

if (process.env.NOTICES_BROWSER_TEST !== '1' || !process.send)
  throw new Error('Isolated notice test only');
let fixture: Awaited<ReturnType<typeof startPackageExchangeApp>> | undefined;
const upstream = await startNewApiIdentityFixture();
for (const [id, username] of [
  [42, 'notice-alice'],
  [84, 'notice-bob'],
] as const) {
  upstream.addOwner({ id, username });
  upstream.mapUsername(username, id);
}
const announce = (revision: number) =>
  upstream.setNotices({
    announcements: [
      '  旧版已读公告 \n',
      {
        content: `服务维护公告 ${revision}\n<script>这是公告原文，不执行</script>\n${'超长公告内容用于核对移动端换行'.repeat(12)}`,
        publishDate: '2026-09-21T00:00:00Z',
      },
    ],
    notice: '欢迎使用未像。本公告为隔离测试内容。',
  });
announce(1);
const server = serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      if (!fixture) return new Response('Starting', { status: 503 });
      return fixture.app.fetch(request);
    }
    const headers = new Headers(request.headers);
    headers.delete('host');
    const response = await fetch(`http://127.0.0.1:3399${url.pathname}${url.search}`, {
      headers,
      redirect: 'manual',
    });
    const forwarded = new Headers(response.headers);
    forwarded.delete('content-encoding');
    forwarded.delete('content-length');
    return new Response(response.body, { status: response.status, headers: forwarded });
  },
});
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Missing fixture port');
const baseUrl = `http://127.0.0.1:${address.port}`;
fixture = await startPackageExchangeApp({
  publicBaseUrl: baseUrl,
  upstreamIssuer: upstream.baseUrl,
  newApi: createNewApiClient(upstream.baseUrl),
});
process.send({ type: 'ready', result: { baseUrl } });
process.on('message', (message: { id: number; action: string }) => {
  void (async () => {
    if (message.action === 'update') announce(2);
    if (message.action === 'fail') upstream.failNext({ operation: 'notices' }, { status: 503 });
    const result = {
      notices: upstream.count({ operation: 'notices' }),
      logins: upstream.count({ operation: 'login' }),
      receipts: (
        await fixture?.database.pool.query(
          'SELECT count(*)::int AS count FROM generation_execution_receipts',
        )
      )?.rows[0]?.count,
    };
    process.send?.({ id: message.id, result });
  })().catch(() => process.send?.({ id: message.id, error: 'Notice fixture command failed' }));
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fixture?.close();
    await upstream.close();
    process.exitCode = 0;
  } catch {
    process.exitCode = 1;
  }
  process.disconnect?.();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
process.on('disconnect', () => void stop());
