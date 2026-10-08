/** @file Independent boundary experiment for protected translation drafts and explicit replacement guards. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { editTileTranslation, storedTileTranslation, missingTranslations } from '../little-say-qa/packages/core/src/boardLanguages';
import { tileSchema, assertTranslationSourceLanguageChange, tileSource, applyProposal } from '../little-say-qa/packages/core/src/schema';
const fixture=JSON.parse(fs.readFileSync('reassess38/owner/refresh/current-captures/fixture.json','utf8'));
const tile=fixture.boards[0].tiles[0];tile.translations[0].origin='manual';
const first=editTileTranslation(tile,'ru-RU',{label:''});
const second=editTileTranslation(first,'ru-RU',{speech:''});
const result={sourceUnchanged:second.label===tile.label&&second.speech===tile.speech,oneEmptyFieldValid:tileSchema.safeParse(first).success,bothEmptyFieldsValid:tileSchema.safeParse(second).success,protectedBefore:storedTileTranslation(tile,'ru-RU'),protectedAfter:storedTileTranslation(second,'ru-RU')??null,remainingLanguages:second.translations.map(t=>t.language),automaticPreparationTargets:missingTranslations({...fixture.boards[0],tiles:[second]})?.tiles[0].targets};
assert.equal(result.oneEmptyFieldValid,false);assert.equal(result.bothEmptyFieldsValid,true);assert.equal(result.protectedAfter,null);
for(const language of ['ru-RU','ru-ru'])assert.throws(()=>assertTranslationSourceLanguageChange(tile,{language}));
fs.writeFileSync('reassess38/boundary-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
