/** @file Protects exact whitespace, literal single-pass substitutions, and clear invalid-resource failures. */

import { expect, it } from 'vitest';
import { loadPromptResource, loadPromptTemplate } from './promptResources';

it('preserves whitespace and treats replacement tokens, dollars, quotes and Unicode as literal data', () => {
  const { text } = loadPromptResource({ text: '\n {{first}} / {{second}} / {{first}} \n' }, ['text'], 'fixture');
  const render = loadPromptTemplate(text, ['first', 'second'], 'fixture.text');
  const value = '牛 "quoted" \\ $& $` $\' $$ {{second}}\nnext';
  expect(render({ first: value, second: '{{first}}' })).toBe(`\n ${value} / {{first}} / ${value} \n`);
});

it('fails clearly for missing or invalid resource text and missing or unexpected template fields', () => {
  for (const resource of [null, [], {}, { text: 3 }, { text: '' }, { text: ' \n' }]) {
    expect(() => loadPromptResource(resource, ['text'], 'fixture')).toThrow(/prompt.*fixture/i);
  }
  for (const template of ['no field', '{{wrong}}', '{{first}} {{unknown}}']) {
    expect(() => loadPromptTemplate(template, ['first'], 'fixture.text')).toThrow('Invalid prompt fields: fixture.text');
  }
  const render = loadPromptTemplate('{{first}}', ['first'], 'fixture.text');
  expect(() => render({ first: undefined! })).toThrow('Missing prompt value: fixture.text.first');
});
