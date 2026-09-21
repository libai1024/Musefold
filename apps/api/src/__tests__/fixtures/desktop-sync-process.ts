import { startDesktopSyncApp } from './desktop-sync-app.js';

if (process.env.DESKTOP_SYNC_TEST !== '1' || !process.send)
  throw new Error('Requires isolated desktop sync test process');
const app = await startDesktopSyncApp();
process.send({ type: 'ready', result: app.ready });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  try {
    const result = await app.close();
    process.send?.({ type: 'closed', result });
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.on('SIGTERM', () => void close());
process.on('disconnect', () => void close());
process.on('message', (message: { id: number; action: string; owner?: string }) => {
  void (async () => {
    if (message.action === 'snapshot') return app.snapshot();
    if (message.action === 'hold-push') return app.holdPush();
    if (message.action === 'release-push') return app.releasePush();
    if (message.action === 'trim-sync-history') return app.trimSyncHistory();
    if (message.action === 'expire-session' && (message.owner === '42' || message.owner === '43'))
      return app.expireSession(message.owner);
    throw new Error('Unknown fixture action');
  })().then(
    (result) => process.send?.({ id: message.id, result }),
    () => process.send?.({ id: message.id, error: 'Desktop sync fixture operation failed' }),
  );
});
