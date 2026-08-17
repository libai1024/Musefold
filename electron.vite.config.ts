import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@electron': resolve(__dirname, 'electron'),
        // workspace 包直读 TS 源、随主进程 chunk 打包（不外部化），
        // electron-builder 的 node_modules 打包面因此零变化（V04-CORE-01）。
        '@musefold/core': resolve(__dirname, 'packages/core/src'),
        '@musefold/automation-server': resolve(__dirname, 'packages/automation-server/src'),
      },
    },
  },
  preload: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts'),
        },
        // package.json 有 "type":"module"，默认会产出 .mjs；但 sandbox:true 的
        // 预加载脚本必须是 CommonJS。强制输出 .cjs，与 window.ts 的 preload 路径一致。
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
      },
    },
  },
  renderer: {
    root: 'src',
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.html'),
          // 桌宠是独立窗口，单独出一个入口，不让它的代码进主窗口的包
          pet: resolve(__dirname, 'src/pet.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'shared'),
        '@renderer': resolve(__dirname, 'src'),
      },
    },
  },
});
