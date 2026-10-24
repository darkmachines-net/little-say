/** @file Verifies public API documentation coverage, private/generated exclusions, and coexistence with TypeScript and React Hooks lint. */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const lint = new ESLint({ overrideConfigFile: fileURLToPath(new URL('../eslint.config.mjs', import.meta.url)) });
const header = '/** @file Documentation rule fixture. */\nconst fixture = 1;\n';

describe('documentation lint policy', () => {
  it('requires a file overview even for an empty module or a documented function', async () => {
    for (const source of ['', '/** Run the task. */\nexport function run() {}']) {
      const [result] = await lint.lintText(source, { filePath: 'fixture.ts' });
      expect(result.messages.map(message => message.ruleId)).toContain('jsdoc/require-file-overview');
    }
  });

  it.each([
    ['named function', 'export function run() {}'],
    ['arrow export', 'export const run = () => 1;'],
    ['function expression', 'export const run = function () {};'],
    ['default function', 'export default function () {}'],
    ['default arrow', 'export default () => 1;'],
    ['later export', 'const run = () => 1; export { run };'],
    ['constructor', 'export class Service { constructor() {} }'],
    ['method', 'export class Service { run() {} }'],
    ['getter', 'export class Service { get value() { return 1; } }'],
    ['setter', 'export class Service { set value(next: number) {} }'],
    ['callable class property', 'export class Service { run = () => 1; }'],
    ['declared class callback', 'export class Service { run!: () => void; }'],
    ['abstract method', 'export abstract class Service { abstract run(): void; }'],
    ['abstract callback', 'export abstract class Service { abstract run: () => void; }'],
    ['later class export', 'class Service { run() {} }; export { Service };'],
    ['interface method', 'export interface Service { run(): void; }'],
    ['interface callback', 'export interface Service { run?: () => void; }'],
    ['type method', 'export type Service = { run(): void };'],
    ['callable type', 'export type Callback = () => void;'],
    ['call signature', 'export interface Factory { (): string; }'],
    ['constructor signature', 'export interface Factory { new(): object; }'],
    ['exported object method', 'export const service = { run() {} };'],
    ['exported object arrow', 'export const service = { run: () => 1 };'],
    ['later object export', 'const service = { run() {} }; export { service };'],
    ['CommonJS function', 'function run() {}; module.exports = { run };'],
    ['CommonJS arrow', 'module.exports = () => 1;'],
  ])('requires JSDoc for a %s', async (_name, source) => {
    const [result] = await lint.lintText(header + source, { filePath: _name.startsWith('CommonJS') ? 'fixture.cjs' : 'fixture.ts' });
    // These small syntax fixtures intentionally leave unrelated recommended lint findings.
    const documentation = result.messages.filter(message => message.ruleId?.startsWith('jsdoc'));
    expect(documentation).toHaveLength(1);
    expect(documentation[0].ruleId).toMatch(/^(jsdoc|jsdoc-members)\/require-jsdoc$/);
  });

  it('does not accept a file overview or an empty comment as a function description', async () => {
    for (const source of ['/** @file Fixture. */\nexport function run() {}', header + '/** */\nexport function run() {}']) {
      const [result] = await lint.lintText(source, { filePath: 'fixture.ts' });
      expect(result.messages.map(message => message.ruleId)).toContain('jsdoc/require-description');
    }
  });

  it('accepts documented exports and leaves private helpers and re-exports alone', async () => {
    const [result] = await lint.lintText(header + `
      function helper() {}
      /** Run the public task. */
      export function run() { helper(); }
      export class Service {
        /** Create a service without owning external resources. */
        constructor() {}
        /** Report the current task result. */
        read = () => 1;
        private internal() {}
        protected inherited() {}
        #hidden() {}
      }
      export interface Port {
        /** Run a task supplied by the caller. */
        run(): void;
        /** Notify the owner when work is complete. */
        done?: () => void;
      }
      export { something } from './another-module';
    `, { filePath: 'fixture.ts' });
    expect(result.messages.filter(message => message.ruleId?.startsWith('jsdoc'))).toEqual([]);
  });

  it('preserves TypeScript errors and React Hooks errors/warnings alongside documentation checks', async () => {
    const [result] = await lint.lintText(header + `
      import { useEffect } from 'react';
      /** Render no output while logging the supplied value. */
      export function Fixture({ value }: { value: string }) {
        if (value) useEffect(() => { console.log(value); }, []);
        return null;
      }
    `, { filePath: 'apps/mobile/src/Fixture.tsx' });
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: '@typescript-eslint/no-unused-vars', severity: 2 }),
      expect.objectContaining({ ruleId: 'react-hooks/rules-of-hooks', severity: 2 }),
      expect.objectContaining({ ruleId: 'react-hooks/exhaustive-deps', severity: 1 }),
    ]));
  });

  it('covers authored platform/config files and excludes generated or temporary files', async () => {
    for (const filePath of ['fixture.cjs', 'fixture.mjs', 'apps/mobile/src/Fixture.web.tsx', 'fixture.d.ts']) {
      const [result] = await lint.lintText('', { filePath });
      expect(result.messages.map(message => message.ruleId)).toContain('jsdoc/require-file-overview');
    }
    for (const filePath of ['apps/server/dist/index.js', 'apps/mobile/android/generated.js', 'artifacts/capture.ts', 'node_modules/package/index.js']) {
      expect(await lint.isPathIgnored(filePath)).toBe(true);
    }
  });
});
