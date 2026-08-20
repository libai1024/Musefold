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
    // Stock-violation freeze from the first full run (2026-08-20).
    // Do not fix these in v1.2.1 — counts are the v1.2.2 Phase 0 ratchet input.
    rules: {
      '@typescript-eslint/no-unused-vars': 'off', // 57; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/set-state-in-effect': 'off', // 47; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-explicit-any': 'off', // 41; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-require-imports': 'off', // 18; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/exhaustive-deps': 'off', // 12; ratchet: v1.2.2 Phase 0 重新启用
      'no-useless-escape': 'off', // 8; ratchet: v1.2.2 Phase 0 重新启用
      'no-useless-assignment': 'off', // 7; ratchet: v1.2.2 Phase 0 重新启用
      'no-empty': 'off', // 5; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/refs': 'off', // 5; ratchet: v1.2.2 Phase 0 重新启用
      'no-undef': 'off', // 4; ratchet: v1.2.2 Phase 0 重新启用
      'preserve-caught-error': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/immutability': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
      'react-hooks/incompatible-library': 'off', // 2; ratchet: v1.2.2 Phase 0 重新启用
      'no-control-regex': 'off', // 1; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-empty-object-type': 'off', // 1; ratchet: v1.2.2 Phase 0 重新启用
      '@typescript-eslint/no-unused-expressions': 'off', // 1; ratchet: v1.2.2 Phase 0 重新启用
    },
  },
  eslintConfigPrettier,
);
