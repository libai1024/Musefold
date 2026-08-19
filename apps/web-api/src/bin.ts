import { buildWebApi } from './app.js';
import { loadWebApiConfig } from './config.js';

const config = loadWebApiConfig();
const app = await buildWebApi({ config });

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'Shutting down Musefold Web API');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Failed to start Musefold Web API');
  await app.close();
  process.exit(1);
}
