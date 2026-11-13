// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fixed phrases earshot embeds, shipped as text embeddings in the CLAP audio component (text-bank.ts) so none of
 * them needs the text model: the vocabulary (vocab.json), timeline's compact event vocabulary (`EVENT_VOCAB`, through
 * its `TAG_TEMPLATES`, the vocabulary's templates), search's one-shot and continuous anchors (`EVENT_ANCHORS`,
 * `TEXTURE_ANCHORS`) and realness's prompts (realness_model.json `prompts`, embedded as they are; listed here because
 * that file's `eval` key can't be a JSON module's export, and checked against it in a test). Lanes that score these phrases look them up with
 * `ListenText.embed(phrases, templates)`; a phrase not listed here goes to the text model.
 */
import { vocabTerms } from './vocab';

/** timeline.EVENT_VOCAB at ff41f07: event kind → caption-like phrases. */
export const EVENT_VOCAB: Readonly<Record<string, readonly string[]>> = {
  WHOOSH: ['a fast air whoosh', 'a swoosh passing by', 'a short swish', 'a whip pan whoosh transition'],
  RISER: ['a rising riser building tension', 'a reverse cymbal swell', 'an uplifter sweep'],
  HIT: ['a deep cinematic boom', 'a punchy impact hit', 'a heavy thud', 'a sub bass drop', 'a soft thump'],
  KEY: [
    'a mechanical keyboard key press',
    'typing on a computer keyboard',
    'a laptop key click',
    'a spacebar press',
  ],
  UI: [
    'a mouse click',
    'a soft UI button tap',
    'a notification ding',
    'a chat message pop',
    'a toggle switch click',
    'a camera shutter click',
  ],
  STEP: ['footsteps on grass', 'footsteps on wood', 'a small soft footstep'],
  FOLEY: [
    'a plastic click',
    'lego bricks clicking',
    'a wooden block hit',
    'glass clinking',
    'paper rustling',
    'leaves rustling',
    'a cork pop',
    'a bubble pop',
    'a water drop',
    'a small object dropping on a table',
  ],
  NOTE: [
    'a piano note',
    'a bell chime',
    'a plucked string note',
    'an orchestral stab',
    'a celesta note',
    'a glockenspiel note',
  ],
  DRUM: ['a kick drum', 'a snare drum hit', 'a hi-hat', 'a drum hit'],
  VOICE: ['a spoken word', 'a person talking', 'a breath', 'a short vocal sound'],
};

/** timeline.TAG_TEMPLATES (the same five as vocab.json's). */
export const TAG_TEMPLATES = [
  '{}',
  'the sound of {}',
  'a recording of {}',
  '{} sound effect',
  'an audio clip of {}',
] as const;

/** search.EVENT_ANCHORS and TEXTURE_ANCHORS: is a query a one-shot or a continuous sound? */
export const EVENT_ANCHORS = [
  'a single short sound effect',
  'one short hit',
  'a click',
  'a single impact',
  'one short pop',
  'a quick one-shot sound',
] as const;
export const TEXTURE_ANCHORS = [
  'a continuous sound',
  'a long background atmosphere',
  'a steady drone',
  'a piece of music',
  'ambient room noise',
  'a soundscape',
] as const;

/** realness_model.json `prompts.real`, then `prompts.synth`. */
export const REALNESS_PROMPTS = [
  'a real recording made with a microphone',
  'a field recording of a real place',
  'a real foley recording of an object',
  'a professionally produced music track',
  'a professional cinematic sound effect from a sound library',
  'a natural acoustic sound',
  'a cheap synthesized beep',
  'a pure sine wave test tone',
  'a simple electronic synthesizer tone made by code',
  'an 8-bit video game sound effect',
  'filtered white noise',
  'a basic drum machine loop',
] as const;

export interface PhraseSet {
  readonly name: string;
  readonly phrases: readonly string[];
  readonly templates: readonly string[];
  readonly categories?: readonly string[];
}

/** Every set the text bank ships, in its order. */
export function listenPhraseSets(): PhraseSet[] {
  const vocab = vocabTerms();
  return [
    { name: 'vocab', phrases: vocab.terms, templates: vocab.templates, categories: vocab.categories },
    { name: 'events', phrases: Object.values(EVENT_VOCAB).flat(), templates: [...TAG_TEMPLATES] },
    { name: 'kind-anchors', phrases: [...EVENT_ANCHORS, ...TEXTURE_ANCHORS], templates: vocab.templates },
    { name: 'realness', phrases: [...REALNESS_PROMPTS], templates: ['{}'] },
  ];
}
