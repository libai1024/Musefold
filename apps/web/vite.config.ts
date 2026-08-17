import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const fixtureImagePath = resolve(appDir, '../../generated/v31-skill-research/skill-ref-pause-map.jpeg');

export default defineConfig({
  base: '/Musefold/app/',
  plugins: [
    react(),
    {
      name: 'musefold-development-fixture',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/__musefold-fixture/skill-ref-pause-map.jpeg', (_request, response) => {
          response.setHeader('Content-Type', 'image/jpeg');
          response.setHeader('Cache-Control', 'no-store');
          createReadStream(fixtureImagePath).pipe(response);
        });
      },
    },
  ],
  server: {
    port: 4174,
  },
  preview: {
    port: 4174,
  },
});
