import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

// 配置文件已迁入 apps/desktop/：相对路径以本目录为基准。
// 仓库根仍是 App manifest / packages 所在处。
const desktopRoot = __dirname;
const repoRoot = resolve(desktopRoot, '../..');

const desktopContractsSrc = resolve(repoRoot, 'packages/desktop-contracts/src');
const domainSrc = resolve(repoRoot, 'packages/domain/src');

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/main'),
      externalizeDeps: {
        exclude: [
          '@musefold/cloud-client',
          '@musefold/contracts',
          '@musefold/desktop-contracts',
          '@musefold/domain',
          '@musefold/update-protocol',
          '@musefold/core',
          '@musefold/automation-server',
        ],
      },
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'electron/main/index.ts'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared/types': desktopContractsSrc,
        '@electron': resolve(desktopRoot, 'electron'),
        // workspace 包直读 TS 源、随主进程 chunk 打包（不外部化），
        // electron-builder 的 node_modules 打包面因此零变化（V04-CORE-01）。
        '@musefold/core': resolve(repoRoot, 'packages/core/src'),
        '@musefold/automation-server': resolve(repoRoot, 'packages/automation-server/src'),
        '@musefold/cloud-client': resolve(repoRoot, 'packages/cloud-client/src'),
        '@musefold/contracts': resolve(repoRoot, 'packages/contracts/src'),
        '@musefold/desktop-contracts': desktopContractsSrc,
        '@musefold/domain': domainSrc,
        '@musefold/update-protocol': resolve(repoRoot, 'packages/update-protocol/src'),
      },
    },
  },
  preload: {
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/preload'),
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'electron/preload/index.ts'),
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
        '@shared/types': desktopContractsSrc,
        '@musefold/desktop-contracts': desktopContractsSrc,
        '@musefold/domain': domainSrc,
      },
    },
  },
  renderer: {
    root: resolve(desktopRoot, 'src'),
    build: {
      sourcemap: true,
      outDir: resolve(desktopRoot, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(desktopRoot, 'src/index.html'),
          // 桌宠是独立窗口，单独出一个入口，不让它的代码进主窗口的包
          pet: resolve(desktopRoot, 'src/pet.html'),
          // 一次性 file:// origin 偏好导出页：不含应用代码，主进程以 file:// 加载
          storageExport: resolve(desktopRoot, 'src/storage-export.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@shared/types': desktopContractsSrc,
        '@musefold/desktop-contracts': desktopContractsSrc,
        '@musefold/domain': domainSrc,
        '@musefold/contracts': resolve(repoRoot, 'packages/contracts/src'),
        '@renderer': resolve(desktopRoot, 'src'),
      },
    },
  },
});
