const { resolve } = require('node:path');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'managed-fs-node-hosts-only',
      comment:
        'Directory-handle native IO is internal to desktop main/core and the CLI serve host; never renderer or cloud.',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/managed-fs/',
          '^packages/core/',
          '^packages/cli/',
          '^apps/desktop/electron/',
        ],
      },
      to: { path: '^packages/managed-fs/' },
    },
    {
      name: 'managed-fs-leaf',
      comment: 'Native IO owns no product, database, account or host state.',
      severity: 'error',
      from: { path: '^packages/managed-fs/' },
      to: { path: ['^apps/', '^packages/(?!managed-fs)[^/]+/'] },
    },
    {
      name: 'scheme-package-node-hosts-only',
      comment:
        'Node archive codec is only consumed by API/worker and desktop main process, never renderer or domain.',
      severity: 'error',
      from: {
        pathNot: ['^packages/scheme-package/', '^apps/(api|worker)/', '^apps/desktop/electron/'],
      },
      to: { path: '^packages/scheme-package/' },
    },
    {
      name: 'scheme-package-contracts-only',
      comment:
        'Archive codec owns no host, database or account state; only contracts is a workspace dependency.',
      severity: 'error',
      from: { path: '^packages/scheme-package/' },
      to: { path: ['^apps/', '^packages/(?!scheme-package|contracts)[^/]+/'] },
    },
    {
      // 动态 import 是刻意打破初始化顺序环的手段；把它算违规会逼人改写法绕过规则。
      name: 'no-circular',
      comment:
        '禁止全局：静态循环依赖一律拦。动态 import 是刻意用来打破初始化顺序环的手段，环上只要有一条 dynamic-import 边即不算违规。',
      severity: 'error',
      from: {},
      to: {
        circular: true,
        viaOnly: {
          dependencyTypesNot: ['dynamic-import'],
        },
      },
    },

    // ═══ 存活 legacy 包边界(桌面本地生态:core/desktop-contracts/domain/控制面三件套)═══

    {
      // contracts ← 不依赖任何 workspace 包（仅 zod）
      name: 'contracts-no-workspace',
      comment: 'contracts 是唯一实体契约叶子：不依赖任何 workspace 包（仅 zod）。',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: {
        path: ['^apps/', '^packages/(?!contracts)[^/]+/'],
      },
    },

    {
      // update-protocol 是编入主进程的纯协议包：zod + semver only。
      name: 'update-protocol-pure',
      comment:
        '内容层热更新协议包保持纯协议：只允许 zod / semver / Node 内置模块。公钥槽位在 apps/desktop/electron/update/，不在本包。',
      severity: 'error',
      from: { path: '^packages/update-protocol/' },
      to: {
        path: ['^apps/', '^packages/(?!update-protocol)[^/]+/'],
      },
    },

    {
      // desktop-contracts 是桌面契约叶子(pet/skill-runtime/design-scheme/automation 冻结面)。
      name: 'desktop-contracts-no-upward',
      comment:
        'desktop-contracts 可 import contracts、update-protocol（type-only Channel）与 domain（prompt-compiler / AppResult）。禁止 core、apps/。',
      severity: 'error',
      from: { path: '^packages/desktop-contracts/' },
      to: {
        path: ['^apps/', '^packages/(?!contracts|update-protocol|domain|desktop-contracts)[^/]+/'],
      },
    },

    {
      // domain 保持 cloud-pure：只依赖 contracts。
      name: 'domain-cloud-pure',
      comment: 'domain 保持 cloud-pure：只依赖 contracts,禁止 desktop-contracts、electron、apps/。',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        path: ['^apps/', '^packages/(?!domain|contracts)[^/]+/'],
      },
    },

    {
      name: 'domain-no-node-fs',
      comment: 'domain 保持 cloud-pure：禁止 fs（含 node:fs）。',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        dependencyTypes: ['core'],
        path: '^(node:)?fs(?:/|$)',
      },
    },

    {
      // core ← contracts + desktop-contracts + better-sqlite3；禁止 electron
      name: 'core-no-electron-or-renderer',
      comment:
        'core 禁止 electron（桌面主进程无关性）与 apps/。允许 desktop-contracts、domain 与 contracts。',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: {
        path: ['^electron$', 'node_modules/electron(?:/|$)', '^apps/'],
      },
    },

    {
      // 渲染进程（v25 壳与 pet 窗口）禁止 import electron。
      name: 'renderer-no-electron',
      comment: 'apps/desktop/src（v25 壳 + pet 窗口）禁止 import electron 与主进程代码。',
      severity: 'error',
      from: { path: '^apps/desktop/src/' },
      to: {
        path: ['^apps/desktop/electron/', '^electron$', 'node_modules/electron(?:/|$)'],
      },
    },

    {
      // 拦截 packages/* 通往桌面 App 的 import。
      name: 'packages-no-desktop-app',
      comment: '禁止 packages/ import apps/desktop/src/ 与 apps/desktop/electron/（含 IPC 桥）。',
      severity: 'error',
      from: { path: '^packages/' },
      to: {
        path: ['^apps/desktop/src/', '^apps/desktop/electron/'],
      },
    },

    {
      name: 'new-api-client-no-desktop-or-ui',
      comment: '传输层 new-api-client 供 apps/api 使用：仅可依赖 contracts,禁止桌面与前端包。',
      severity: 'error',
      from: { path: '^packages/new-api-client/' },
      to: {
        path: ['^apps/', '^packages/(?!new-api-client|contracts)[^/]+/'],
      },
    },

    {
      name: 'server-crypto-no-desktop-or-ui',
      comment: 'server-crypto 供 apps/api 与 apps/worker 使用：不依赖任何 workspace 包。',
      severity: 'error',
      from: { path: '^packages/server-crypto/' },
      to: {
        path: ['^apps/', '^packages/(?!server-crypto)[^/]+/'],
      },
    },

    {
      name: 'desktop-tooling-no-frontend',
      comment:
        '本地控制面三件套（automation-server / client / cli）与 mcp 属桌面生态：禁止依赖前端包（ui/features/platform）、渲染层与其他 apps。主进程 apps/desktop/electron/ 仍允许。',
      severity: 'error',
      from: { path: '^packages/(cli|client|mcp|automation-server)/' },
      to: {
        path: [
          '^packages/(ui|features|platform|api-client)/',
          '^apps/desktop/src/',
          '^apps/(?!desktop/)',
        ],
      },
    },

    // ═══ v2.5 新架构边界(V25-ARCHITECTURE「依赖边界」;M5-a2 上线)═══

    {
      // features 平台无关:数据只经 MusefoldGateway(platform 接口),UI 只用 ui 原语。
      name: 'v25-features-platform-agnostic',
      comment:
        'V25 §3:packages/features 四端同一份,禁止触达宿主 —— 不得 import electron、next、' +
        '宿主 gateway 实现(api-client / apps/*)与桌面本地包;数据接缝只有 @musefold/platform。',
      severity: 'error',
      from: { path: '^packages/features/' },
      to: {
        path: [
          '^electron(/|$)',
          '^next(/|$)',
          '^packages/api-client/',
          '^packages/(core|desktop-db|db|desktop-contracts|domain)/',
          '^apps/',
        ],
      },
    },
    {
      // features 是纯渲染层,连 Node 内置都不许(防 fs/path 溜进共享 UI)。
      name: 'v25-features-no-node-builtins',
      comment: 'V25 §3:features 运行在浏览器/渲染进程,禁止 Node 内置模块。',
      severity: 'error',
      from: { path: '^packages/features/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      // platform 是接口叶子:contracts 之外不依赖任何 workspace 包。
      name: 'v25-platform-leaf',
      comment:
        'V25 §3:packages/platform 只定义 MusefoldGateway/能力/query keys,仅可 import contracts;' +
        '禁止 ui/features/宿主实现,否则接口层反向耦合实现。',
      severity: 'error',
      from: { path: '^packages/platform/' },
      to: { path: ['^packages/(?!platform|contracts)[^/]+/', '^apps/', '^electron(/|$)'] },
    },
    {
      // PG schema 只进服务端。
      name: 'v25-db-server-only',
      comment:
        'V25 §4:packages/db(Drizzle PG schema)只允许 apps/api 与 apps/worker 消费;' +
        '前端/桌面/共享包不得 import,数据一律走 API 契约。',
      severity: 'error',
      from: { path: '^(packages/(?!db/)|apps/(?!api/|worker/))' },
      to: { path: '^packages/db/' },
    },
    {
      // v25 preload 纯转发。
      name: 'v25-preload-pure-relay',
      comment:
        'V25 §5:v2.5 preload 只做单通道转发,除 electron 外不得 import 任何模块' +
        '(workspace TS 会被打进沙箱 preload,Node 内置在 sandbox 下不可用)。',
      severity: 'error',
      from: { path: '^apps/desktop/electron/preload/v25\\.ts$' },
      to: { pathNot: ['^electron$'] },
    },
    {
      // shadcn 原语层保持叶子。
      name: 'v25-ui-primitives-leaf',
      comment:
        'V25 §3:packages/ui 是 shadcn 原语层,禁止依赖任何 workspace 包与宿主;' +
        '产品语义(数据/状态)属于 features。',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: ['^packages/(?!ui)[^/]+/', '^apps/'] },
    },
    {
      // web 数据实现只依赖契约与接口。
      name: 'v25-api-client-thin',
      comment:
        'V25 §3:packages/api-client 是 Web 宿主的 gateway 实现,只可 import contracts 与 platform;' +
        '禁止 ui/features(实现层不得反向依赖消费层)。',
      severity: 'error',
      from: { path: '^packages/api-client/' },
      to: {
        path: ['^packages/(?!api-client|contracts|platform)[^/]+/', '^apps/', '^electron(/|$)'],
      },
    },
    {
      // 桌面 SQLite 受管层生产代码保持独立(core 仅测试/脚本可用)。
      name: 'v25-desktop-db-standalone',
      comment:
        'V25 数据迁移:packages/desktop-db 生产代码只依赖 drizzle/better-sqlite3,' +
        '不得 import 其他 workspace 包(__tests__ 与 scripts 可用 core 建 legacy 库比对)。',
      severity: 'error',
      from: { path: '^packages/desktop-db/src/', pathNot: ['/__tests__/'] },
      to: { path: ['^packages/(?!desktop-db)[^/]+/', '^apps/'] },
    },
  ],
  options: {
    doNotFollow: {
      path: ['node_modules', '(^|/)(dist|out|coverage|\\.turbo|\\.tsout|\\.next)(/|$)'],
    },
    exclude: {
      // Parallel builds delete generated config modules and .next files while this scan runs.
      // Keep the real electron.vite.config.ts in the graph; exclude only timestamped output.
      path: [
        '(^|/)(dist|out|coverage|\\.turbo|\\.tsout|\\.next)(/|$)',
        '^apps/desktop/electron\\.vite\\.config\\.[0-9]+\\.mjs$',
      ],
    },
    moduleSystems: ['es6', 'cjs'],
    tsPreCompilationDeps: true,
    tsConfig: {
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
