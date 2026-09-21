import { serve } from '@hono/node-server';
import { packageExchangeContent } from './package-exchange-content.js';
import { startAgentBrowserApp } from './agent-browser-app.js';

if (process.env.AGENT_BROWSER_TEST !== '1' || !process.send)
  throw new Error('Requires isolated Agent browser process');
const fixture = await startAgentBrowserApp();
const server = serve({ fetch: fixture.app.fetch, hostname: '127.0.0.1', port: 0 });
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No fixture address');
process.send({ type: 'ready', result: { baseUrl: `http://127.0.0.1:${address.port}` } });
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
process.on('message', (message: { id: number; action: string; value?: string }) => {
  void (async () => {
    if (message.action === 'base-package')
      return (await (await packageExchangeContent()).encode()).toString('base64');
    if (message.action === 'seed-trial' && message.value) {
      await fixture.seedTrial(message.value);
      return null;
    }
    if (message.action === 'snapshot') return fixture.snapshot();
    if (message.action === 'provider-authorization') return fixture.providerAuthorizationSnapshot();
    if (message.action === 'revoke-upstream') return fixture.revokeUpstreamCredentials();
    if (message.action === 'restore-upstream') {
      fixture.restoreUpstreamCredentials();
      return null;
    }
    if (message.action === 'require-image-input') {
      fixture.requireImageInput();
      return null;
    }
    if (message.action === 'start-generation')
      return fixture.startGeneration(message.value === 'images');
    if (message.action === 'stop-generation') return fixture.stopGeneration();
    if (message.action === 'release-image') {
      fixture.releaseImage();
      return null;
    }
    if (
      message.action === 'image-mode' &&
      ['normal', 'hold', 'drop', 'reject'].includes(message.value ?? '')
    ) {
      fixture.setImageMode(message.value as 'normal' | 'hold' | 'drop' | 'reject');
      return null;
    }
    if (
      message.action === 'github-version' &&
      (message.value === 'base' || message.value === 'changed' || message.value === 'next')
    ) {
      await fixture.githubVersion(message.value);
      return null;
    }
    if (message.action === 'seed-history' && message.value)
      return fixture.seedHistory(message.value);
    if (message.action === 'release') {
      fixture.release();
      return null;
    }
    if (message.action === 'revoke') {
      await fixture.revoke();
      return null;
    }
    if (
      message.action === 'mode' &&
      ['normal', 'hold', 'hold-compiler', 'drop'].includes(message.value ?? '')
    ) {
      fixture.setMode(message.value as 'normal' | 'hold' | 'hold-compiler' | 'drop');
      return null;
    }
    throw new Error('Unknown fixture action');
  })().then(
    (result) => process.send?.({ id: message.id, result }),
    () => process.send?.({ id: message.id, error: 'Fixture operation failed' }),
  );
});
