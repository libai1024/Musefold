import { serve } from '@hono/node-server';
import { startPackageExchangeApp } from './package-exchange-app.js';
import { packageExchangeContent } from './package-exchange-content.js';

if (process.env.PACKAGE_EXCHANGE_TEST !== '1' || !process.send)
  throw new Error('Requires isolated package exchange process');
// Startup diagnostics contain only fixed phase names and elapsed milliseconds.
// No database URLs, credentials or arbitrary exception payloads cross IPC.
const startedAt = performance.now();
const phase = (name: string) =>
  process.send?.({
    type: 'startup',
    phase: name,
    elapsedMs: Math.round(performance.now() - startedAt),
  });
phase('module-loaded');
const fixture = await startPackageExchangeApp({ onStartupPhase: phase });
phase('package-encode');
const bytes = await (await packageExchangeContent()).encode();
phase('http-listen');
const server = serve({ fetch: fixture.app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No fixture address');
phase('ready');
process.send({
  type: 'ready',
  result: { baseUrl: `http://127.0.0.1:${address.port}`, bytes: bytes.toString('base64') },
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if ('closeAllConnections' in server) server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fixture.close();
  process.exit(0);
}
process.on('SIGTERM', () => void close());
process.on('disconnect', () => void close());
process.on('message', (message: { id: number; action: string; schemeId?: string }) => {
  void (async () => {
    if (message.action === 'snapshot') return fixture.snapshot();
    if (message.action === 'import-snapshot') return fixture.importSnapshot();
    if (message.action === 'import-digest') return fixture.importSnapshot(false);
    if (message.action === 'seed-trial' && message.schemeId) {
      await fixture.seedTrial(message.schemeId);
      return null;
    }
    throw new Error('Unknown fixture action');
  })().then(
    (result) => process.send?.({ id: message.id, result }),
    () => process.send?.({ id: message.id, error: 'Fixture operation failed' }),
  );
});
