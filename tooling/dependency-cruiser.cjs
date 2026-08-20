const { resolve } = require('node:path');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      // 动态 import 是刻意打破初始化顺序环的手段；把它算违规会逼人改写法绕过规则。
      name: 'no-circular',
      comment:
        '§3.2 禁止全局：静态循环依赖一律拦。动态 import 是刻意用来打破初始化顺序环的手段，环上只要有一条 dynamic-import 边即不算违规。',
      severity: 'error',
      from: {},
      to: {
        circular: true,
        viaOnly: {
          dependencyTypesNot: ['dynamic-import'],
        },
      },
    },

    {
      // §3.2 contracts ← 不依赖任何 workspace 包（仅 zod）
      name: 'contracts-no-workspace',
      comment:
        '§3.2 contracts：不依赖任何 workspace 包（仅 zod）。当前布局禁止 import 其他 packages/、apps/desktop/src/、apps/desktop/electron/、shared/、apps/。',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
          '^packages/(?!contracts)[^/]+/',
        ],
      },
    },

    {
      // V121-CHAN-04/05: update-protocol is a pure protocol package compiled into the
      // Electron main process. It may depend on zod + semver only — no workspace
      // packages, and no electron/src/apps (those would invert the shell boundary).
      name: 'update-protocol-pure',
      comment:
        '内容层热更新协议包保持纯协议：只允许 zod / semver / Node 内置模块。禁止 import 任何 workspace 包与 apps/desktop/electron/、apps/desktop/src/、apps/、shared/。公钥槽位在 apps/desktop/electron/update/，不在本包。',
      severity: 'error',
      from: { path: '^packages/update-protocol/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
          '^packages/(?!update-protocol)[^/]+/',
        ],
      },
    },

    {
      // §3.2 desktop-contracts ← contracts（少量交叉类型），禁止反向
      name: 'desktop-contracts-no-upward',
      comment:
        '§3.2 desktop-contracts 是契约叶子：可 import contracts、update-protocol（type-only Channel）与 domain（prompt-compiler / AppResult）。禁止 import core、apps/desktop/src/、apps/desktop/electron/ 以及其他 packages/。反向（contracts → desktop-contracts）由 contracts-no-workspace 覆盖。',
      severity: 'error',
      from: { path: '^packages/desktop-contracts/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/(?!contracts|update-protocol|domain|desktop-contracts)[^/]+/',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 domain ← contracts；禁止 desktop-contracts、electron、window.api
      name: 'domain-cloud-pure',
      comment:
        '§3.2 domain 保持 cloud-pure：只依赖 contracts。禁止 desktop-contracts、apps/desktop/electron/、apps/desktop/src/、apps/ 以及其他 packages/。window.api 不是模块 import，由 packages-no-desktop-app 拦截通往 IPC 桥的路径。',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: [
          '^packages/(?!domain|contracts)[^/]+/',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 domain 禁止 fs
      name: 'domain-no-node-fs',
      comment: '§3.2 domain 保持 cloud-pure：禁止 fs（含 node:fs）。',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?fs(?:/|$)',
      },
    },

    {
      // §3.2 ui ← 不依赖任何 workspace 包
      name: 'ui-no-workspace',
      comment:
        '§3.2 ui：不依赖任何 workspace 包。当前布局禁止 import product-ui、apps/desktop/src/、apps/desktop/electron/、apps/、packages/core 及其他 packages/。',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: {
        path: [
          '^packages/(?!ui)[^/]+/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 product-ui ← ui；禁止 domain 实现细节、window.api、cloud-client、electron
      // 任务卡允许 ui / contracts / domain（及外部包）。
      name: 'product-ui-allowed-deps',
      comment:
        '§3.2 product-ui ← ui；禁止 cloud-client、electron、window.api。任务卡：只准 import ui/contracts/domain（及外部包），不得 import apps/desktop/src/、apps/desktop/electron/、apps/、packages/core。',
      severity: 'error',
      from: { path: '^packages/product-ui/' },
      to: {
        path: [
          '^packages/(?!product-ui|ui|contracts|domain)[^/]+/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 cloud-client ← contracts
      name: 'cloud-client-only-contracts',
      comment:
        '§3.2 cloud-client ← contracts。禁止 desktop-contracts（shared/）、core、electron、apps/desktop/src/、apps/ 及其他 workspace 包。',
      severity: 'error',
      from: { path: '^packages/cloud-client/' },
      to: {
        path: [
          '^packages/(?!cloud-client|contracts)[^/]+/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 core ← contracts + desktop-contracts + better-sqlite3；禁止 electron
      name: 'core-no-electron-or-renderer',
      comment:
        '§3.2 core 禁止 electron（桌面主进程无关性）。任务卡：packages/core 不得 import apps/desktop/electron/、apps/desktop/src/。允许 desktop-contracts、domain 与 contracts。',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        path: [
          '^apps/desktop/electron/',
          '^@electron',
          '^electron$',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/',
        ],
      },
    },

    {
      // §3.2 apps/web ← contracts/domain/ui/product-ui/cloud-client；禁止 desktop-contracts、core
      name: 'web-no-desktop',
      comment:
        '§3.2 apps/web 禁止 desktop-contracts、core。任务卡：不得 import apps/desktop/src/、apps/desktop/electron/、shared/。允许 contracts/domain/ui/product-ui/cloud-client。',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/(?!web/)',
          '^packages/(?!contracts|domain|ui|product-ui|cloud-client)[^/]+/',
        ],
      },
    },

    {
      // §3.2 apps/web-api ← contracts/domain/new-api-client/server-crypto；禁止 desktop-contracts、core
      name: 'web-api-no-frontend-or-desktop',
      comment:
        '§3.2 apps/web-api 禁止 desktop-contracts、core。任务卡：不得 import 前端包（ui/product-ui）与 apps/desktop/src/、apps/desktop/electron/。',
      severity: 'error',
      from: { path: '^apps/web-api/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/(?!web-api/)',
          '^packages/(?!contracts|domain|new-api-client|server-crypto)[^/]+/',
        ],
      },
    },

    {
      // §3.2 未单独列出 generation-worker，按与 web-api 同级的服务层补齐
      name: 'generation-worker-no-frontend-or-desktop',
      comment:
        '§3.2 服务层与 web-api 同约束（禁止 desktop-contracts、core、前端包）。任务卡：apps/generation-worker 不得 import ui/product-ui 与 apps/desktop/src/、apps/desktop/electron/。',
      severity: 'error',
      from: { path: '^apps/generation-worker/' },
      to: {
        path: [
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/(?!generation-worker/)',
          '^packages/(?!contracts|domain|server-crypto|new-api-client)[^/]+/',
        ],
      },
    },

    {
      // §3.2 禁止全局 ← better-sqlite3 出现在 web/web-api
      name: 'no-better-sqlite3-in-web-services',
      comment:
        '§3.2 禁止全局：better-sqlite3 出现在 web/web-api。generation-worker 同属云服务侧，一并禁止。',
      severity: 'error',
      from: { path: '^apps/(web|web-api|generation-worker)/' },
      to: { path: 'better-sqlite3' },
    },

    {
      // §3.2 apps/desktop 渲染进程禁止 import 'electron'（当前布局 apps/desktop/src）
      name: 'renderer-no-electron',
      comment:
        '§3.2 apps/desktop 渲染进程禁止 import electron。当前布局渲染进程在 apps/desktop/src/。',
      severity: 'error',
      from: { path: '^apps/desktop/src/' },
      to: {
        path: [
          '^apps/desktop/electron/',
          '^@electron',
          '^electron$',
          'node_modules/electron(?:/|$)',
        ],
      },
    },

    {
      // §3.2 禁止全局 ← window.api 出现在 packages/*（拦截通往桌面 App 的 import）
      name: 'packages-no-desktop-app',
      comment:
        '§3.2 禁止 window.api 出现在 packages/*。depcruise 看不到全局标识符，改为禁止 packages/ import apps/desktop/src/ 与 apps/desktop/electron/（含 IPC 桥）。core 的 electron/src 禁令由 core-no-electron-or-renderer 重复覆盖。',
      severity: 'error',
      from: { path: '^packages/' },
      to: {
        path: ['^apps/desktop/src/', '^@renderer', '^apps/desktop/electron/', '^@electron'],
      },
    },

    {
      name: 'new-api-client-no-desktop-or-ui',
      comment:
        '§3.2 传输层 new-api-client 与 cloud-client 同级：供 web-api 使用，禁止依赖桌面 App、shared/、前端包。',
      severity: 'error',
      from: { path: '^packages/new-api-client/' },
      to: {
        path: [
          '^packages/(?!new-api-client|contracts)[^/]+/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
        ],
      },
    },

    {
      name: 'server-crypto-no-desktop-or-ui',
      comment:
        '§3.2 apps/web-api ← server-crypto。server-crypto 自身禁止依赖桌面 App、shared/、前端包。',
      severity: 'error',
      from: { path: '^packages/server-crypto/' },
      to: {
        path: [
          '^packages/(?!server-crypto)[^/]+/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/desktop/electron/',
          '^@electron',
          '^packages/desktop-contracts/',
          '^@shared',
          '^@musefold/desktop-contracts',
          '^apps/',
        ],
      },
    },

    {
      name: 'desktop-tooling-no-frontend',
      comment:
        '§3.3 本地控制面三件套（automation-server / client / cli）与 mcp 属桌面生态，不参与 Web 重构；禁止反向依赖前端包、apps/desktop 渲染层与 apps/web*。主进程 apps/desktop/electron/ 仍允许（迁移前 ^electron/ 未列入本规则）。',
      severity: 'error',
      from: { path: '^packages/(cli|client|mcp|automation-server)/' },
      to: {
        path: [
          '^packages/(ui|product-ui)/',
          '^apps/desktop/src/',
          '^@renderer',
          '^apps/(?!desktop/)',
        ],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', '(^|/)(dist|out|coverage|\\.turbo|\\.tsout)(/|$)'],
    },
    exclude: {
      path: ['(^|/)(dist|out|coverage|\\.turbo|\\.tsout)(/|$)'],
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: {
      // Path aliases for the current layout. apps/desktop/tsconfig.node.json
      // covers @electron；`^@shared` 锁定已删除的兼容别名，防止旧路径回流。
      // @renderer is matched as an unresolved specifier
      // in rules that forbid apps/desktop/src/ (see ^@renderer).
      // 必须用绝对路径：depcruise 的 parseJsonConfigFileContent 在相对 fileName 下
      // 无法解析出 apps/desktop 里 `extends: ../../tooling/tsconfig.base.json`（TS5083）。
      fileName: resolve(__dirname, '../apps/desktop/tsconfig.node.json'),
    },
    combinedDependencies: true,
    skipAnalysisNotInRules: true,
    extraExtensionsToScan: ['.css'],
    builtInModules: {
      add: ['electron'],
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
  },
};
