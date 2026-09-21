import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { serve } from '@hono/node-server';
import { z } from 'zod';
import { startPackageExchangeApp } from './package-exchange-app.js';

if (process.env.OAUTH_BROWSER_TEST !== '1' || !process.send)
  throw new Error('Isolated OAuth test only');
let fixture: Awaited<ReturnType<typeof startPackageExchangeApp>>;
// Real same-origin HTTP front door. Native browser redirects must not escape a
// route mock and accidentally reach the independently running live-account API.
const apiServer = serve({
  fetch: async (request) => {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith('/api/') ||
      url.pathname === '/mcp' ||
      url.pathname.startsWith('/.well-known/')
    )
      return fixture.app.fetch(request);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const response = await fetch(`http://127.0.0.1:3399${url.pathname}${url.search}`, {
      headers,
      redirect: 'manual',
    });
    const forwarded = new Headers(response.headers);
    // Node fetch already decompresses; do not ask the browser to decode twice.
    forwarded.delete('content-encoding');
    forwarded.delete('content-length');
    return new Response(response.body, { status: response.status, headers: forwarded });
  },
  hostname: '127.0.0.1',
  port: 0,
});
await new Promise<void>((resolve) => apiServer.once('listening', resolve));
const address = apiServer.address();
if (!address || typeof address === 'string') throw new Error('Missing API port');
const baseUrl = `http://127.0.0.1:${address.port}`;
const publicOrigin = baseUrl;
fixture = await startPackageExchangeApp({ publicBaseUrl: publicOrigin });
const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
const clients: Array<{
  id: string;
  url: string;
  server: Server;
  state: string;
  verifier: string;
  accessToken: string | null;
  refreshToken: string | null;
  outcome: 'idle' | 'connected' | 'denied' | 'failed';
  exchanges: number;
}> = [];
for (const id of ['reader-a', 'reader-b']) {
  const client = {
    id,
    url: '',
    state: '',
    verifier: '',
    accessToken: null as string | null,
    refreshToken: null as string | null,
    outcome: 'idle' as 'idle' | 'connected' | 'denied' | 'failed',
    exchanges: 0,
  };
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', client.url);
      if (url.pathname === '/begin') {
        client.state = randomUUID();
        client.verifier = hash(randomUUID());
        client.outcome = 'idle';
        const query = new URLSearchParams({
          client_id: id,
          redirect_uri: `${client.url}/callback`,
          response_type: 'code',
          scope: 'prompts:read offline_access',
          resource: `${publicOrigin}/mcp`,
          code_challenge_method: 'S256',
          code_challenge: hash(client.verifier),
          state: client.state,
          prompt: url.searchParams.get('reauth') === '1' ? 'login consent' : 'consent',
        });
        res.writeHead(302, { location: `${publicOrigin}/api/auth/oauth2/authorize?${query}` });
        res.end();
        return;
      }
      if (url.pathname !== '/callback' || url.searchParams.get('state') !== client.state)
        throw new Error('Invalid callback');
      if (url.searchParams.get('error') === 'access_denied') client.outcome = 'denied';
      else {
        const code = url.searchParams.get('code');
        if (!code) throw new Error('Missing code');
        client.exchanges++;
        const response = await fetch(`${baseUrl}/api/auth/oauth2/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: id,
            redirect_uri: `${client.url}/callback`,
            grant_type: 'authorization_code',
            code,
            code_verifier: client.verifier,
          }),
        });
        if (response.status !== 200) throw new Error('Token exchange failed');
        const value = z
          .object({ access_token: z.string(), refresh_token: z.string() })
          .parse(await response.json());
        client.accessToken = value.access_token;
        client.refreshToken = value.refresh_token;
        client.outcome = 'connected';
      }
      res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end(`${id}: ${client.outcome}`);
    })().catch(() => {
      client.outcome = 'failed';
      res.writeHead(500);
      res.end('Callback failed');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const a = server.address();
  if (!a || typeof a === 'string') throw new Error('Missing callback port');
  client.url = `http://127.0.0.1:${a.port}`;
  // Accessors preserve the per-client callback state; no OAuth credential crosses IPC.
  clients.push(Object.assign(client, { server }));
  await fixture.database.pool.query(
    "INSERT INTO oauth_client (id,client_id,name,uri,redirect_uris,scopes,grant_types,response_types,token_endpoint_auth_method,require_pkce) VALUES ($1,$1,$2,$3,$4,$5,$6,$7,'none',true)",
    [
      id,
      `Reader ${id.slice(-1).toUpperCase()}`,
      client.url,
      [`${client.url}/callback`],
      ['prompts:read', 'offline_access'],
      ['authorization_code', 'refresh_token'],
      ['code'],
    ],
  );
  await fixture.database.pool.query(
    'INSERT INTO oauth_client_resource (id,client_id,resource_id) VALUES ($1,$1,$2)',
    [id, `${publicOrigin}/mcp`],
  );
}
async function snapshot() {
  const result = [];
  for (const client of clients) {
    let mcpStatus: number | null = null;
    let tools: string[] = [];
    if (client.accessToken) {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${client.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-method': 'tools/list',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {},
              'io.modelcontextprotocol/clientInfo': { name: client.id, version: '1.0' },
            },
          },
        }),
      });
      mcpStatus = response.status;
      if (response.ok) {
        const result = z
          .object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) })
          .parse(await response.json());
        tools = result.result.tools.map((tool) => tool.name).sort();
      } else await response.arrayBuffer();
    }
    result.push({
      id: client.id,
      outcome: client.outcome,
      exchanges: client.exchanges,
      mcpStatus,
      tools,
    });
  }
  const grants = await fixture.database.pool.query(
    'SELECT client_id FROM oauth_consent ORDER BY client_id',
  );
  return { clients: result, consents: grants.rows.map((r) => r.client_id as string) };
}
process.send({
  type: 'ready',
  result: { baseUrl, clients: clients.map((c) => ({ id: c.id, url: c.url })) },
});
process.on('message', (message: { id: number; action: string }) => {
  if (message.action !== 'snapshot') return;
  void snapshot().then(
    (result) => process.send?.({ id: message.id, result }),
    () => process.send?.({ id: message.id, error: 'OAuth fixture snapshot failed' }),
  );
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  for (const server of [...clients.map((c) => c.server), apiServer]) {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await fixture.close();
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('disconnect', () => void close());
