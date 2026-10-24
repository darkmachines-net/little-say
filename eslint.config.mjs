/** @file Lints authored JavaScript/TypeScript, React Hooks, file overviews, and public API documentation. */

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import jsdoc from 'eslint-plugin-jsdoc';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Public members are documented even when a class/object is exported later or used as a test adapter.
const publicMembers = [
  'MethodDefinition:not([accessibility="private"]):not([accessibility="protected"]):not([key.type="PrivateIdentifier"])',
  'TSAbstractMethodDefinition:not([accessibility="protected"])',
  ':matches(PropertyDefinition, TSAbstractPropertyDefinition):not([accessibility="private"]):not([accessibility="protected"]):not([key.type="PrivateIdentifier"]):matches([value.type="ArrowFunctionExpression"], [value.type="FunctionExpression"], [typeAnnotation.typeAnnotation.type="TSFunctionType"])',
  ':matches(ExportNamedDeclaration > VariableDeclaration > VariableDeclarator, Program > VariableDeclaration > VariableDeclarator, ExportDefaultDeclaration, AssignmentExpression) > ObjectExpression > Property:matches([value.type="ArrowFunctionExpression"], [value.type="FunctionExpression"])',
];
const callableDeclarations = [
  'TSDeclareFunction',
  'TSMethodSignature',
  'TSPropertySignature[typeAnnotation.typeAnnotation.type="TSFunctionType"]',
  'TSTypeAliasDeclaration > TSFunctionType',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
];

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
  {
    files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 'latest', parserOptions: { ecmaFeatures: { jsx: true } } },
    // The alias applies the same upstream rule with a separate policy for public members.
    plugins: { jsdoc, 'jsdoc-members': jsdoc },
    settings: { jsdoc: { mode: 'typescript' } },
    rules: {
      'jsdoc/require-file-overview': 'error',
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: true,
        enableFixer: false,
        exemptEmptyConstructors: false,
        require: { FunctionDeclaration: true, FunctionExpression: true, ArrowFunctionExpression: true, MethodDefinition: false },
        contexts: callableDeclarations,
      }],
      'jsdoc-members/require-jsdoc': ['error', {
        enableFixer: false,
        exemptEmptyConstructors: false,
        require: { FunctionDeclaration: false },
        contexts: publicMembers,
      }],
      // A file overview or an empty block cannot stand in for a callable's description.
      'jsdoc/require-description': ['error', { contexts: ['FunctionDeclaration', 'ArrowFunctionExpression', 'FunctionExpression', ...callableDeclarations, ...publicMembers] }],
    },
  },
);
