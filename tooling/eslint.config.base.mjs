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
    // 存量违规冻结（首轮全量 2026-08-20）。第一批棘轮已收紧：违规最少的 8 条
    // 已修复并重新启用。以下 8 条仍 off，违规数保持首轮基线，待后续棘轮。
    rules: {
      '@typescript-eslint/no-unused-vars': 'off', // 57; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/set-state-in-effect': 'off', // 47; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-explicit-any': 'off', // 41; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-require-imports': 'off', // 18; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/exhaustive-deps': 'off', // 12; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/refs': 'off', // 5; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/immutability': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/incompatible-library': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
    },
  },
  eslintConfigPrettier,
);
