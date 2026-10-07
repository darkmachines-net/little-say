/** @file One-time issue-23 extraction from the verified master strings; not product code. */
import fs from 'node:fs';
import path from 'node:path';
import ts from './little-say-prompts/node_modules/typescript/lib/typescript.js';
const root = path.resolve('little-say-prompts');
const sources = new Map();
function source(file) {
  if (!sources.has(file)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    sources.set(file, { text, ast: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS), edits: [] });
  }
  return sources.get(file);
}
function extract(file, prefix, replacement, fields = []) {
  const item = source(file);
  let found;
  function visit(node) {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && (prefix.startsWith('raw:') ? node.getText(item.ast).slice(1).startsWith(prefix.slice(4)) : (ts.isTemplateExpression(node) ? node.head.text : node.text).startsWith(prefix))) {
      if (found) throw new Error(`Ambiguous ${prefix}`);
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(item.ast);
  if (!found) throw new Error(`Missing ${prefix}`);
  let value;
  if (ts.isTemplateExpression(found)) {
    if (fields.length !== found.templateSpans.length) throw new Error(`Fields ${prefix}`);
    value = found.head.text + found.templateSpans.map((span, i) => `{{${fields[i]}}}` + span.literal.text).join('');
  } else value = found.text;
  item.edits.push({ start: found.getStart(item.ast), end: found.end, replacement });
  return value;
}
function resource(file, values) {
  const dest = path.join(root, 'prompts', file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(values, null, 2) + '\n');
}
const provider = 'apps/server/src/provider.ts';
resource('server/board.json', {
  instructions: extract(provider, 'You help parents', 'boardPrompts.instructions'),
  pictures: extract(provider, '\nThis client supports', 'boardPrompts.pictures'),
  translation: extract(provider, 'Translate toddler', 'boardPrompts.translation'),
  transcription: extract(provider, 'A parent describing', 'boardPrompts.transcription'),
});
const picture = 'apps/server/src/picture-provider.ts';
resource('server/pictures.json', {
  visualRules: extract(picture, 'You evaluate pictures', 'picturePrompts.visualRules'),
  analysis: extract(picture, 'Describe each card', 'picturePrompts.analysis'),
  selection: extract(picture, 'raw:${visualRules} Select', 'pictureSelectionInstructions', ['visualRules']),
  review: extract(picture, 'raw:${visualRules} Compare', 'pictureReviewInstructions', ['visualRules']),
  color: extract(picture, 'Simple flat color', 'picturePrompts.color'),
  line: extract(picture, 'Simple black-and-white', 'picturePrompts.line'),
  generation: extract(picture, 'raw:${look} One', 'pictureGenerationPrompt(look, concept)', ['look', 'concept']),
});
resource('server/speech.json', {
  instructions: extract('apps/server/src/synthesis.ts', 'You are a text-to-speech', 'speechInstructions(input.language)', ['language']),
});
const onboarding = 'packages/core/src/onboarding.ts';
resource('shared/onboarding.json', {
  farm: extract(onboarding, 'cow, sheep, horse', 'starterConcepts.farm'),
  everyday: extract(onboarding, 'more, water, help', 'starterConcepts.everyday'),
  family: extract(onboarding, 'mother, father, grandmother', 'starterConcepts.family'),
  template: extract(onboarding, 'Create a starter soundboard', 'starterPromptText({ concepts: content.prompt })', ['concepts']),
});
const mobile = 'apps/mobile/src/ui/AiConversation.tsx';
resource('shared/conversation.json', {
  farm: extract(mobile, 'Create six farm', 'conversationPrompts.farm'),
  snack: extract(mobile, 'Create six things', 'conversationPrompts.snack'),
  family: extract(mobile, 'Create six family', 'conversationPrompts.family'),
});
const imports = {
  [provider]: "import { boardPrompts } from './prompts';\n",
  [picture]: "import { picturePrompts, pictureSelectionInstructions, pictureReviewInstructions, pictureGenerationPrompt } from './prompts';\n",
  'apps/server/src/synthesis.ts': "import { speechInstructions } from './prompts';\n",
  [onboarding]: "import { starterConcepts, starterPromptText } from './promptPresets';\n",
  [mobile]: "import { conversationPrompts } from '@little-say/core';\n",
};
for (const [file, item] of sources) {
  let text = item.text;
  for (const edit of item.edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  text = text.replace(/(?=import )/, imports[file]);
  if (file === picture) text = text.replace('const visualRules = picturePrompts.visualRules;\r\n', '').replace('const visualRules = picturePrompts.visualRules;\n', '');
  fs.writeFileSync(path.join(root, file), text);
}
console.log('Extracted 20 exact prose/preset resources; substitutions named without interpreting data.');
