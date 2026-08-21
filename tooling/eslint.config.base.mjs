import js from '@eslint/js';
import { globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  globalIgnores([
    '**/node_modules/**',
    '**/out/**',
    '**/dist/**',
    'release/**',
    '**/.turbo/**',
    'coverage/**',
    'website/**',
    'docs/**',
    'doc/**',
    'playwright-report/**',
    'test-results/**',
    'test-output/**',
    'package-lock.json',
    '**/*.tsbuildinfo',
    '**/.tsout/**',
    '.pytest_cache/**',
    '.venv-test/**',
    '.electron-driver/**',
    'generated/**',
    'artifacts/**',
    'output/**',
    'sandbox/**',
    '3dmodel/**',
    '.impeccable/**',
    'backups/**',
    '**/*.min.js',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    // 6 unused eslint-disable directives on the first run (5× exhaustive-deps,
    // 1× no-console). Turning stock rules off would create more. Keep silent
    // until the ratchet; ratchet: v1.2.2 Phase 0 重新启用
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  {
    files: ['**/*.tsx'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // 这不是棘轮欠账，而是永久性的职责划分：
    // TypeScript 编译器负责未定义标识符（含 NodeJS、RequestInit 等 ambient 类型）；
    // ESLint no-undef 看不到这些声明，在 TS 上是 typescript-eslint 官方已知误报。
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      'no-undef': 'off',
    },
  },
  {
    // JS 没有编译器兜底，未定义标识符必须由这条规则抓住。
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    rules: {
      'no-undef': 'error',
    },
  },
  {
    // V122-SHARE-06：@shared 兼容别名已删除，desktop-contracts 是唯一入口。
    // V122-SHARE-05：图标必须从 @musefold/ui/icons 进入；禁止直连 lucide-react（含深路径）。
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@shared(?:/|$)',
              message: '已删除 @shared 兼容别名。请改用 @musefold/desktop-contracts 子路径。',
            },
            {
              regex: '^lucide-react(?:/|$)',
              message:
                '图标必须从 @musefold/ui/icons 导入，禁止直连 lucide-react 或其深路径。',
            },
          ],
        },
      ],
    },
  },
  {
    // 唯一允许直连 lucide-react 的入口：@musefold/ui 的 icons 契约实现。
    files: ['packages/ui/src/icons.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@shared(?:/|$)',
              message: '已删除 @shared 兼容别名。请改用 @musefold/desktop-contracts 子路径。',
            },
          ],
        },
      ],
    },
  },
  {
    // V121-CI-08 第二批：未使用绑定清零。代码库已普遍用 _ 前缀标记占位
    //（接口参数、解构丢弃）；catch 未使用同样要求 _ 前缀，避免误吞真错误。
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // V13-GOV-01：文件尺寸棘轮。warn 600 提供编辑器即时反馈；
    // CI 硬门禁在 tests/repo/file-size-ratchet.test.ts（baseline 只减不增）。
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
    rules: {
      'max-lines': ['warn', { max: 600 }],
    },
  },
  {
    // V13-GOV-01 baseline：存量超标文件由 repo 守卫棘轮管辖（tooling/file-size-baseline.json），
    // 此处静音避免噪音。清单只减不增，消化完成（SPLIT 卡）后此块整体删除。
    files: [
      'apps/desktop/src/features/generation/workbench/GenerationWorkbench.tsx',
      'apps/desktop/src/features/generation/workbench/store.ts',
      'packages/core/src/sync/repository.ts',
      'apps/web/src/App.tsx',
      'apps/web-api/src/modules/prompts/service.ts',
      'apps/desktop/src/features/design-schemes/SchemeRuntimeDetail.tsx',
      'apps/desktop/electron/doubao-web/browser-service.ts',
      'packages/ui/src/extended-primitives.tsx',
      'apps/desktop/src/features/onboarding/OnboardingFlow.tsx',
      'apps/desktop/src/features/settings/components/AccountSection.tsx',
      'apps/desktop/electron/main/ipc/skill-runtime.ts',
      'apps/web-api/src/modules/generation/service.ts',
      'apps/desktop/electron/main/skill-import/github-reader.ts',
      'apps/web/src/fixture-runtime.ts',
      'apps/desktop/electron/system/import.ts',
      'packages/cloud-client/src/index.ts',
      'packages/core/src/db/design-scheme/repositories.ts',
      'apps/desktop/electron/main/integration.ts',
      'apps/desktop/src/runtime/desktop-gateway.ts',
      'apps/desktop/src/features/generation/components/ProviderDialog.tsx',
      'apps/desktop/src/features/generation/workbench/PromptReferenceSidebar.tsx',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
  {
    // V13-GOV-03 预置 / V13-STATE-03 启用：store 持久化只经 zustand persist middleware。
    files: ['apps/desktop/src/stores/**/*.ts', 'apps/desktop/src/features/**/store.ts', 'apps/desktop/src/features/**/*-store.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='localStorage'][property.name=/^(setItem|getItem|removeItem)$/]",
          message:
            'V13-STATE-03：store 持久化只经 zustand persist middleware，禁止手写 localStorage（读侧同理由 sessionPreferences 等 helper 收口）。',
        },
      ],
    },
  },
  {
    // CommonJS 里 require 是合法形态：按文件类型关闭，不是行内豁免。
    // .cjs 以及显式 "type": "commonjs" 的 skill 脚本（.js）。
    files: ['**/*.cjs', '.claude/skills/newapi/**/*.js'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // 存量违规冻结（首轮全量 2026-08-20）。第一、二批棘轮已收紧：
    // 第一批 8 条低违规规则 + 第二批 no-unused-vars / no-require-imports 已清零并启用。
    // 以下 6 条仍 off（react-hooks 系列与 no-explicit-any 留给 Phase 2 stores）。
    rules: {
      'react-hooks/set-state-in-effect': 'off', // 47; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-explicit-any': 'off', // 41; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/exhaustive-deps': 'off', // 12; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/refs': 'off', // 5; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/immutability': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/incompatible-library': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
    },
  },
  eslintConfigPrettier,
);
