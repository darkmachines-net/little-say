/** @file Verifies source-free Node ESM prompt bundles and exclusion of server instructions from shared code. */

import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'tsup';
import { expect, it } from 'vitest';
import { boardPrompts, picturePrompts, pictureGenerationPrompt, pictureSelectionInstructions, pictureReviewInstructions, speechInstructions } from '../apps/server/src/prompts';
import { starterConcepts, starterPromptText } from '../packages/core/src/promptPresets';

it('embeds validated JSON without runtime source paths and keeps server prompts out of shared bundles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'little-say-prompt-bundle-'));
  try {
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await build({ config: false, entry: { server: resolve('apps/server/src/prompts.ts'), shared: resolve('packages/core/src/promptPresets.ts') }, outDir: directory, format: ['esm'], target: 'node22', noExternal: ['@little-say/core'], splitting: false, silent: true });
    const concept = { description: '牛 {{look}} $&\n"quoted"', features: [], searchTerms: ['cow'], emojiAccurate: true };
    const program = `
      import * as server from ${JSON.stringify(pathToFileURL(join(directory, 'server.js')).href)};
      import * as shared from ${JSON.stringify(pathToFileURL(join(directory, 'shared.js')).href)};
      console.log(JSON.stringify({ board: server.boardPrompts, pictures: server.picturePrompts,
        selection: server.pictureSelectionInstructions, review: server.pictureReviewInstructions,
        generation: server.pictureGenerationPrompt('literal {{concept}} $&', ${JSON.stringify(concept)}),
        speech: server.speechInstructions('fr-FR'),
        concepts: shared.starterConcepts, starter: shared.starterPromptText({ concepts: 'literal {{concepts}} $&' }) }));`;
    // This process has only bundled files, runs outside the checkout, and has no tsx loader or credentials.
    const actual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', program], { cwd: directory, encoding: 'utf8' }));
    expect(actual).toEqual({ board: boardPrompts, pictures: picturePrompts, selection: pictureSelectionInstructions, review: pictureReviewInstructions, generation: pictureGenerationPrompt('literal {{concept}} $&', concept), speech: speechInstructions('fr-FR'), concepts: starterConcepts, starter: starterPromptText({ concepts: 'literal {{concepts}} $&' }) });
    const shared = await readFile(join(directory, 'shared.js'), 'utf8');
    for (const text of [boardPrompts.instructions, boardPrompts.translation, picturePrompts.analysis, speechInstructions('fr-FR')]) expect(shared).not.toContain(text.slice(0, 80));
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 30000);
