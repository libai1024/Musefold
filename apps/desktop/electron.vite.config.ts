import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';
import { resolve } from 'path';
import { pickAliases } from '../../tooling/aliases.mjs';

// 配置文件已迁入 apps/desktop/：相对路径以本目录为基准。
// 仓库根仍是 workspace manifest / packages 所在处。
const desktopRoot = __dirname;
const repoRoot = resolve(desktopRoot, '../..');

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/main'),
      externalizeDeps: {
        exclude: [
          '@musefold/contracts',
          '@musefold/desktop-contracts',
          '@musefold/desktop-db',
          '@musefold/domain',
          '@musefold/update-protocol',
          '@musefold/core',
          '@musefold/automation-server',
          '@musefold/new-api-client',
          // 纯 JS 运行时依赖打进 main chunk(M5-b):electron-builder 26 的
          // pnpm 收集器会剥掉嵌套传递依赖(lazystream → readable-stream@2),
          // bundle 后 asar 不再依赖这些包的 node_modules 树。
          'archiver',
          'archiver-utils',
          'yauzl',
        ],
      },
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'electron/main/index.ts'),
        },
      },
    },
    resolve: {
      alias: pickAliases(
        [
          '@electron',
          // workspace 包直读 TS 源、随主进程 chunk 打包（不外部化），
          // electron-builder 的 node_modules 打包面因此零变化（V04-CORE-01）。
          '@musefold/core',
          '@musefold/automation-server',
          '@musefold/contracts',
          '@musefold/desktop-contracts',
          '@musefold/desktop-db',
          '@musefold/domain',
          '@musefold/update-protocol',
          '@musefold/new-api-client',
        ],
        repoRoot,
      ),
    },
  },
  preload: {
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/preload'),
      // 沙箱 preload 不能 require workspace 的 TS 源码。旧兼容别名不是 npm
      // 包，会被打进 index.cjs；改成 @musefold/desktop-contracts 后必须显式
      // 排除外部化，否则运行时 module not found。
      externalizeDeps: {
        exclude: ['@musefold/desktop-contracts', '@musefold/domain'],
      },
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'electron/preload/index.ts'),
          // v2.5 单通道桥 preload(纯转发,不 import workspace TS)
          v25: resolve(desktopRoot, 'electron/preload/v25.ts'),
        },
        // sandbox:true 的预加载脚本必须是 CommonJS。显式固定输出 .cjs，
        // 与 window.ts 的 preload 路径一致，不受 manifest 模块类型影响。
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
    resolve: {
      alias: pickAliases(['@musefold/desktop-contracts', '@musefold/domain'], repoRoot),
    },
  },
  renderer: {
    root: resolve(desktopRoot, 'src'),
    // Tailwind v4 只服务 v25 新渲染壳;旧入口 CSS 不含 tailwind 指令,不受影响。
    plugins: [tailwindcss()],
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/renderer'),
      rollupOptions: {
        input: {
          // 桌宠是独立窗口，单独出一个入口，不让它的代码进主窗口的包
          pet: resolve(desktopRoot, 'src/pet.html'),
          // 一次性 file:// origin 偏好导出页：不含应用代码，主进程以 file:// 加载
          storageExport: resolve(desktopRoot, 'src/storage-export.html'),
          // v2.5 渲染壳 —— 主窗口唯一入口(M4e 定稿;旧 index 入口已删,M5c)
          shellV25: resolve(desktopRoot, 'src/v25/shell.html'),
        },
      },
    },
    resolve: {
      alias: pickAliases(
        ['@musefold/desktop-contracts', '@musefold/domain', '@musefold/contracts', '@renderer'],
        repoRoot,
      ),
    },
  },
});
