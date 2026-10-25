/** @file Defines reviewed generic senses and aliases; unknown words and visual qualifiers never enter shared reuse. */

import { type PictureConcept } from '@little-say/core';
import { preparationConceptInstructions } from './prompts';

export interface GenericConcept { id: string; source?: string; emoji: string; aliases: string[]; features: string[]; }
const entry = (id: string, source: string | undefined, emoji: string, aliases: string[] = [], features: string[] = []): GenericConcept => ({ id, source, emoji, aliases: [id, ...aliases], features });
// Source IDs distinguish live chicken from prepared food and vehicles from category substitutes.
export const genericConcepts: GenericConcept[] = [
  entry('cow', 'mulberry-806', '🐄', ['vache', 'vaca']),
  entry('sheep', 'mulberry-2538', '🐑', ['mouton', 'oveja']),
  entry('horse', 'mulberry-1682', '🐎', ['cheval', 'caballo']),
  entry('rabbit', 'mulberry-2351', '🐇', ['bunny', 'lapin', 'conejo']),
  entry('chicken animal', 'mulberry-463', '🐓', ['hen', 'live chicken', 'poule', 'gallina']),
  entry('chicken food', 'mulberry-458', '🍗', ['cooked chicken']),
  entry('duck', 'mulberry-981', '🦆', ['canard', 'pato']),
  entry('cat', 'mulberry-399', '🐈', ['chat', 'gato']),
  entry('dog', 'mulberry-927', '🐕', ['chien', 'perro']),
  entry('bat animal', 'mulberry-128', '🦇', ['flying bat']),
  entry('apple', 'mulberry-44', '🍎', ['pomme', 'manzana']),
  entry('banana', 'mulberry-109', '🍌', ['banane', 'plátano']),
  entry('pear', 'mulberry-2170', '🍐', ['poire', 'pera']),
  entry('bread', 'mulberry-247', '🍞', ['pain', 'pan']),
  entry('milk', 'mulberry-1935', '🥛', ['lait', 'leche']),
  entry('water', 'mulberry-3022', '💧', ['eau', 'agua']),
  entry('chair', 'mulberry-425', '🪑'), entry('table', 'mulberry-2763', '🪑'),
  entry('bed', 'mulberry-2575', '🛏️'), entry('cup', 'mulberry-1990', '☕', ['mug']),
  entry('spoon', 'mulberry-2652', '🥄'), entry('toilet', 'mulberry-2870', '🚽'),
  entry('wash hands', 'mulberry-3012', '🧼'), entry('brush teeth', 'mulberry-289', '🪥'),
  entry('eat', 'mulberry-3192', '🍽️'), entry('drink', 'mulberry-960', '🥤'),
  entry('sleep', 'mulberry-3358', '😴'), entry('use toilet', 'mulberry-2871', '🚽'),
  entry('dump truck', 'mulberry-982', '🚚', ['dumper truck'], ['tipping bed', 'truck']),
  entry('concrete mixer truck', undefined, '🚚', ['concrete truck', 'cement mixer truck'], ['truck-mounted mixing drum', 'mixing drum', 'truck']),
  entry('excavator', undefined, '🚜', ['digger'], ['tracks', 'digging arm', 'bucket']),
  entry('bulldozer', undefined, '🚜', [], ['tracks', 'front blade']),
  entry('crane truck', undefined, '🏗️', ['mobile crane'], ['truck-mounted crane', 'lifting boom', 'hook']),
  entry('road roller', undefined, '🚜', ['steamroller'], ['large rolling drum']),
];

/** Normalize lookup text without erasing sense-bearing words or qualifiers. */
export function genericWords(value: string): string { return value.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/g, ' '); }

/** Resolve only an approved sense with known features; personalized instructions prohibit sharing. */
export function genericConcept(concept: PictureConcept, instruction = ''): GenericConcept | undefined {
  // Concept descriptions have an English contract. These foreign aliases have other English senses.
  if (instruction.trim() || ['chat', 'pain', 'pan'].includes(genericWords(concept.description))) return undefined;
  return genericConcepts.find(item => item.aliases.includes(genericWords(concept.description)) && concept.features.every(feature => item.features.includes(genericWords(feature))));
}

/** Construct the canonical, context-free input used for shared asset validation and generation. */
export function canonicalPictureConcept(item: GenericConcept): PictureConcept {
  return { description: item.id, features: item.features, searchTerms: [item.id], emojiAccurate: !['table', 'concrete mixer truck', 'excavator', 'bulldozer', 'road roller', 'crane truck', 'dump truck'].includes(item.id) };
}

/** Compact server-owned vocabulary supplied to drafting; it grants no authority to persist model text. */
export function genericConceptInstructions(): string {
  return preparationConceptInstructions(genericConcepts.map(item => item.id));
}
