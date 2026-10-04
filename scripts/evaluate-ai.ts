import { starterLibrary } from '../tests/fixtures/library';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { loadDevelopmentEnv, withDevelopmentApiKey } from './dev-config';
import { openAIProvider } from '../apps/server/src/provider';
import { boardContext, starterBoard, starterPrompt, validateGeneratedBoard, type GeneratedBoard, type ProposalRequest } from '@little-say/core';
const env = await withDevelopmentApiKey(await loadDevelopmentEnv(fileURLToPath(new URL('../', import.meta.url))));
const provider = openAIProvider(env);
if (!provider) { console.error('Set AAC_OPENAI_KEY or OPENAI_API_KEY to run the live evaluation. This script makes billable API requests.'); process.exit(1); }
const farm = starterLibrary().boards[0];
const languageProfile = { languages: ['fr-FR', 'es-ES'], defaultLanguage: 'fr-FR' };
const fixtures: { name: string; request: ProposalRequest; check: (value: GeneratedBoard) => boolean; followups?: { prompt: string; check: (value: GeneratedBoard) => boolean }[] }[] = [
  { name: 'Conversation clarification and multilingual refinements', request: { prompt: 'Create exactly 30 farm animal cards on one board.', board: null, languageProfile }, check: value => value.needsClarification && value.tiles.length === 0, followups: [
    { prompt: 'Just three then: cow, sheep, horse.', check: value => !value.needsClarification && value.tiles.length === 3 && value.tiles.every(t => t.language === 'fr-FR' && t.translations?.some(v => v.language === 'es-ES')) },
    { prompt: 'Replace the horse with a goat. Keep the other cards and both languages.', check: value => !value.needsClarification && value.tiles.length === 3 && value.tiles.some(t => /chèvre/i.test(t.label)) && value.tiles.every(t => t.existingId === null && t.language === 'fr-FR' && t.translations?.some(v => v.language === 'es-ES')) },
  ] },
  { name: 'Conversation retains prior edits and original photo references', request: { prompt: 'Replace Horse with Goat. Keep everything else unchanged.', board: { ...boardContext(farm), tiles: boardContext(farm).tiles.map((t, i) => i === 0 ? { ...t, hasPhoto: true, emoji: null } : t) } }, check: value => value.tiles.some(t => t.label.toLowerCase() === 'goat' && t.existingId === null), followups: [
    { prompt: 'Now rename the board to Our farm and make the new goat blue. Leave everything else alone.', check: value => value.title === 'Our farm' && value.tiles.length === 6 && value.tiles.some(t => t.label.toLowerCase() === 'goat' && t.existingId === null && t.color === 'sky') && farm.tiles.filter(t => t.label !== 'Horse').every(old => value.tiles.some(t => t.existingId === old.id && t.label === old.label && t.speech === old.speech && t.language === old.language)) },
  ] },
  ...(['farm', 'family'] as const).map(topic => ({ name: `First-time setup ${topic} board`, request: { prompt: starterPrompt(topic), board: null, languageProfile }, check: (value: GeneratedBoard) => { starterBoard({ boardId: null, baseRevision: null, proposal: value }, languageProfile, randomUUID); return true; } })),
  { name: 'Device profile defaults to French with Spanish translations', request: { prompt: 'Create exactly two cards: apple and pear.', board: null, languageProfile }, check: value => value.tiles.length === 2 && JSON.stringify(value.playLanguages) === JSON.stringify(['fr-FR', 'es-ES']) && value.tiles.every(tile => tile.language === 'fr-FR' && tile.languageMode === 'board' && tile.translations?.some(t => t.language === 'es-ES')) },
  { name: 'Explicit language overrides the device profile', request: { prompt: 'Create exactly two animal cards in German only: cat and dog. No language switching.', board: null, languageProfile }, check: value => value.tiles.length === 2 && value.tiles.every(tile => tile.language.startsWith('de') && tile.languageMode === 'fixed' && !tile.translations?.length) && (value.playLanguages ?? []).every(tag => tag.startsWith('de')) },
  { name: 'Six farm tiles, explicit items', request: { prompt: 'Create six farm animal tiles including cow, sheep, and horse.', board: null }, check: value => value.tiles.length === 6 && ['cow', 'sheep', 'horse'].every(word => value.tiles.some(t => t.label.toLowerCase() === word)) },
  { name: 'Mixed-language family', request: { prompt: 'Create four family tiles: Grandma and Grandpa in English, Babushka and Dedushka in Russian. Show the Russian names transliterated in the labels, but speak in Russian.', board: null }, check: value => value.tiles.length === 4 && value.tiles.filter(t => t.language.startsWith('ru') && /[а-яё]/i.test(t.speech)).length === 2 },
  { name: 'Preserve unrelated tiles despite a different device profile', request: { prompt: 'Replace Horse with Goat; keep every other tile exactly as it is.', board: boardContext(farm), languageProfile }, check: value => value.tiles.length === 6 && !value.playLanguages?.length && value.tiles.some(t => t.label.toLowerCase() === 'goat' && t.existingId === null) && farm.tiles.filter(t => t.label !== 'Horse').every(old => value.tiles.some(t => t.existingId === old.id && t.label === old.label && t.speech === old.speech && t.language === old.language)) },
  { name: '24-tile upper bound', request: { prompt: 'Make exactly 24 distinct everyday toddler words, each with an emoji.', board: null }, check: value => value.tiles.length === 24 && new Set(value.tiles.map(t => t.label.toLowerCase())).size === 24 },
  { name: 'Over-limit clarification', request: { prompt: 'Make exactly 30 farm animal tiles on one board.', board: null }, check: value => value.needsClarification && value.tiles.length === 0 },
];
let failures = 0;
const durations: number[] = [];
const filterIndex = process.argv.indexOf('--filter');
const filter = filterIndex >= 0 ? process.argv[filterIndex + 1]?.toLowerCase() : undefined;
const selectedFixtures = filter ? fixtures.filter(fixture => fixture.name.toLowerCase().includes(filter)) : fixtures;
if (!selectedFixtures.length) throw new Error('No evaluation fixtures matched the filter.');
for (const fixture of selectedFixtures) {
  const start = performance.now();
  try {
    let result = validateGeneratedBoard(await provider.propose(fixture.request), fixture.request.board);
    const ms = Math.round(performance.now() - start); durations.push(ms);
    const passed = fixture.check(result); if (!passed) failures++;
    console.log(JSON.stringify({ fixture: fixture.name, passed, durationMs: ms, tiles: result.tiles.length }));
    if (!passed) console.log(JSON.stringify({ fixture: fixture.name, proposal: result }));
    const history: { prompt: string; reply: string }[] = [];
    let previousPrompt = fixture.request.prompt;
    let draft = result.needsClarification ? null : result;
    for (const followup of fixture.followups ?? []) {
      history.push({ prompt: previousPrompt, reply: result.explanation });
      const turnStart = performance.now();
      result = validateGeneratedBoard(await provider.propose({ ...fixture.request, prompt: followup.prompt, conversation: { history, draft } }), fixture.request.board);
      const turnPassed = followup.check(result); if (!turnPassed) failures++;
      console.log(JSON.stringify({ fixture: fixture.name, turn: history.length + 1, passed: turnPassed, durationMs: Math.round(performance.now() - turnStart), tiles: result.tiles.length }));
      if (!turnPassed) console.log(JSON.stringify({ fixture: fixture.name, proposal: result }));
      if (!result.needsClarification) draft = result;
      previousPrompt = followup.prompt;
    }
  } catch (e) { failures++; console.error(JSON.stringify({ fixture: fixture.name, passed: false, error: 'Provider request or output validation failed', type: (e as Error).name, validation: e instanceof ZodError ? e.issues.map(issue => ({ path: issue.path, message: issue.message })) : undefined, status: (e as { status?: number }).status, code: (e as { code?: string }).code })); }
}
durations.sort((a, b) => a - b);
console.log(JSON.stringify({ model: env.OPENAI_BOARD_MODEL || 'gpt-6.1-sol', effort: env.OPENAI_REASONING_EFFORT || 'low', fixtures: selectedFixtures.length, failures, medianMs: durations[Math.floor(durations.length / 2)] ?? null }));
process.exitCode = failures ? 1 : 0;
