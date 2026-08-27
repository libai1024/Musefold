import { defineConfig, type Connect, type PreviewServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = dirname(fileURLToPath(import.meta.url));
const fixtureImagePath = resolve(appDir, '../../generated/v31-skill-research/skill-ref-pause-map.jpeg');

// fixtures 预览构建没有 dev 中间件，预览服务器需要同一张本地 fixture 图片。
function serveFixtureImage(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use('/__musefold-fixture/skill-ref-pause-map.jpeg', (_request, response: Connect.IncomingMessage extends never ? never : import('http').ServerResponse) => {
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(fixtureImagePath).pipe(response);
  });
}

export default defineConfig({
  base: '/Musefold/app/',
  plugins: [
    react(),
    {
      name: 'musefold-development-fixture',
      configureServer(server) {
        serveFixtureImage(server);
      },
      configurePreviewServer(server) {
        serveFixtureImage(server);
      },
    },
  ],
  server: {
    port: 4174,
    ...(process.env.VITE_DEV_API_ORIGIN
      ? {
          proxy: {
            '/api': {
              target: process.env.VITE_DEV_API_ORIGIN,
              changeOrigin: true,
              secure: false,
            },
          },
        }
      : {}),
  },
  preview: {
    port: 4174,
  },
});
