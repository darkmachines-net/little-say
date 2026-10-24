/** @file Lints authored JavaScript/TypeScript and React Hooks while excluding generated output. */

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/**', '**/.expo/**', '**/dist/**', '**/coverage/**',
    '**/test-results/**', '**/playwright-report/**', '**/.cache/**', '**/artifacts/**',
    'apps/mobile/android/**', 'apps/mobile/ios/**',
  ]),
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    // Release provider JSON and test doubles intentionally accept dynamic shapes.
    files: ['scripts/release/**/*.ts', '**/*.test.ts', 'tests/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/mobile/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}', 'tests/web/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/mobile/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Metro resolves bundled image assets through static require calls.
      '@typescript-eslint/no-require-imports': ['error', { allow: ['\\.png$'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
