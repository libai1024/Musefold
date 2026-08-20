// vite.preview.config.ts
// 仅用于浏览器内可视化预览渲染层 UI（不含 Electron 主进程 / IPC）。
// 生产由 electron-vite 打包；此文件不参与打包，只服务于本地 UI 走查。
import { defineConfig } from 'vite';
import { resolve } from 'path';
import { previewApiBridge } from './preview/bridge-plugin.mjs';

export default defineConfig({
  root: 'apps/desktop/src',
  // 预览桥：仅此配置加载，注入 window.api 的 HTTP 客户端 + 挂载 /__preview_api__ 后端。
  // 生产 electron-vite 打包不引用本文件，故桥代码绝不进入发布产物。
  plugins: [previewApiBridge()],
  resolve: {
    alias: {
      '@shared/types': resolve(__dirname, 'packages/desktop-contracts/src'),
      '@musefold/desktop-contracts': resolve(__dirname, 'packages/desktop-contracts/src'),
      '@musefold/domain': resolve(__dirname, 'packages/domain/src'),
      '@musefold/contracts': resolve(__dirname, 'packages/contracts/src'),
      '@renderer': resolve(__dirname, 'apps/desktop/src'),
    },
  },
  server: process.env.PORT
    ? { port: Number(process.env.PORT), strictPort: true }
    : { port: 5199, strictPort: true },
});
