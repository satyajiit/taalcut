// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What people in a shot are doing (LIB1-FIND), from the describing model's answer. The prompt asks for core's
 * fixed words (SHOT_ACTIONS); small models answer with their own ("dance", "biking", "playing the guitar"), so the
 * answer is read leniently: each phrase is cleaned, matched to a fixed word through its inflections and a short
 * list of synonyms, or kept as a free word when it looks like one (a short -ing phrase). Fixed words the sentence
 * itself uses count too: a model that writes "men dance on a stage" and lists no actions still danced.
 *
 * One still frame can't show movement, and a model shown a crowd standing still may still say "dancing". The shot's
 * energy (vision's motion and change, 0..1) gates the words that need movement: a shot that barely moves keeps
 * "talking" or "posing", never "running".
 */
import {
  RationalTime,
  SHOT_ACTION_LIMITS,
  SHOT_ACTIONS,
  type ShotAction,
  type ShotAnalysis,
  type ShotDescription,
  type TimeRange,
} from '@taalcut/core';

/** Words that need the shot to move: vigorous actions a still frame often suggests wrongly. */
export const MOTION_ACTIONS: ReadonlySet<ShotAction> = new Set<ShotAction>([
  'dancing',
  'running',
  'jumping',
  'cycling',
  'swimming',
  'surfing',
  'skateboarding',
  'climbing',
  'exercising',
  'playing sport',
]);

/**
 * The energy below which a motion word is dropped (vision's analysis, `ShotAnalysis.energy`), from the find eval's
 * Commons clips: the stillest dance measures 0.093 and slow-motion volleyball 0.021, while a tripod shot where
 * nothing moves (a sunset, a puppet stage between scenes) measures 0.014–0.016. Energy can't tell dancing from
 * talking (a talking head measures up to 0.098), so the floor only catches shots where nothing moves.
 */
export const MOTION_ENERGY_FLOOR = 0.02;

/** A shot at least this long is footage, whose energy measures movement; a shorter one is a photo's frame. */
const FOOTAGE_SECONDS = 0.5;

/**
 * True for footage in which nothing moves: a shot of `FOOTAGE_SECONDS` or more whose energy is under the floor. A
 * photo is never still, as one frame measures no movement. The describe job carries only this, never the energy,
 * so a re-analysis re-describes a shot only when its gate flips (vision.analyse's stored digest holds the same).
 */
export function isStill(shot: {
  readonly range: TimeRange;
  readonly analysis: ShotAnalysis | null;
}): boolean {
  const energy = shot.analysis?.energy;
  return (
    energy !== undefined &&
    energy < MOTION_ENERGY_FLOOR &&
    RationalTime.toSeconds(shot.range.duration) >= FOOTAGE_SECONDS
  );
}

/** Other words models use for a fixed one. Inflections ("dances", "ran") are found without a list. */
const SYNONYMS: Readonly<Record<string, ShotAction>> = {
  strolling: 'walking',
  jogging: 'running',
  sprinting: 'running',
  leaping: 'jumping',
  biking: 'cycling',
  bicycling: 'cycling',
  'riding a bicycle': 'cycling',
  'riding a bike': 'cycling',
  diving: 'swimming',
  bodysurfing: 'surfing',
  trekking: 'hiking',
  kayaking: 'paddling',
  canoeing: 'paddling',
  rowing: 'paddling',
  'working out': 'exercising',
  'doing yoga': 'exercising',
  stretching: 'exercising',
  speaking: 'talking',
  chatting: 'talking',
  conversing: 'talking',
  presenting: 'talking',
  'giving a speech': 'talking',
  'giving a presentation': 'talking',
  'talking to the camera': 'talking',
  'speaking to the camera': 'talking',
  frying: 'cooking',
  grilling: 'cooking',
  baking: 'cooking',
  'stir-frying': 'cooking',
  'preparing food': 'cooking',
  lapping: 'drinking',
  cutting: 'chopping',
  slicing: 'chopping',
  drawing: 'painting',
  strumming: 'playing music',
  drumming: 'playing music',
  'playing guitar': 'playing music',
  'playing the guitar': 'playing music',
  'playing drums': 'playing music',
  'playing the drums': 'playing music',
  'playing an instrument': 'playing music',
  'playing instruments': 'playing music',
  'playing piano': 'playing music',
  'playing the piano': 'playing music',
  'playing football': 'playing sport',
  'playing soccer': 'playing sport',
  'playing cricket': 'playing sport',
  'playing volleyball': 'playing sport',
  'playing basketball': 'playing sport',
  'playing tennis': 'playing sport',
  embracing: 'hugging',
  photographing: 'filming',
  recording: 'filming',
  'taking photos': 'filming',
  'taking a photo': 'filming',
  'taking pictures': 'filming',
  'taking selfies': 'taking a selfie',
  selfie: 'taking a selfie',
  buying: 'shopping',
  worshipping: 'praying',
  partying: 'celebrating',
  napping: 'sleeping',
  'playing games': 'playing',
};

/** A fixed one-word action's inflections: dancing → dance, dances, danced; running → run, runs, ran. */
function inflections(action: ShotAction): string[] {
  if (action.includes(' ') || !action.endsWith('ing')) return [];
  const stem = action.slice(0, -3);
  const bases = new Set([stem, `${stem}e`]);
  // running → run, swimming → swim: a doubled last consonant.
  if (stem.length > 2 && stem.at(-1) === stem.at(-2)) bases.add(stem.slice(0, -1));
  return [...bases].flatMap((base) => [base, `${base}s`, `${base}es`, `${base}d`, `${base}ed`]);
}

const IRREGULAR: Readonly<Record<string, ShotAction>> = {
  ran: 'running',
  swam: 'swimming',
  rode: 'riding',
  drove: 'driving',
  sang: 'singing',
  ate: 'eating',
  drank: 'drinking',
  wrote: 'writing',
  slept: 'sleeping',
};

/** Every word that means a fixed action, to that action. */
const WORD_TO_ACTION: ReadonlyMap<string, ShotAction> = (() => {
  const map = new Map<string, ShotAction>();
  for (const action of SHOT_ACTIONS)
    for (const form of inflections(action)) if (!map.has(form)) map.set(form, action);
  for (const [word, action] of Object.entries({ ...IRREGULAR, ...SYNONYMS })) map.set(word, action);
  for (const action of SHOT_ACTIONS) map.set(action, action);
  return map;
})();

/** Text as stored actions are written: NFC, lowercase, letters, digits, spaces, hyphens, apostrophes. */
function plainWords(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}' -]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** An answer's phrase as a stored action: plain words, without a leading doer ("people dancing" → "dancing"). */
export function cleanAction(phrase: string): string {
  return plainWords(phrase).replace(/^(?:is|are|people|someone|a person|a man|a woman|men|women|they) /u, '');
}

/** The fixed action a phrase means, if any. */
export function fixedAction(phrase: string): ShotAction | undefined {
  const clean = cleanAction(phrase);
  return WORD_TO_ACTION.get(clean) ?? WORD_TO_ACTION.get(clean.replace(/^(?:a|the) /u, ''));
}

/** A free word worth keeping: one to three words, the first an -ing verb, within the stored size. */
function isFreeAction(clean: string): boolean {
  const words = clean.split(' ');
  return (
    clean.length > 0 &&
    clean.length <= SHOT_ACTION_LIMITS.chars &&
    words.length <= 3 &&
    /^\p{L}{3,}ing$/u.test(words[0] ?? '')
  );
}

/**
 * Words after which an action word is a verb: someone doing it ("a man is cooking", "two girls dance", "people
 * walking"). Elsewhere the same word is often a thing ("a painting", "a swimming pool", "drinks on a table").
 */
const DOERS = new Set(
  (
    'is are was were while who they he she someone people person man men woman women boy boys girl girls ' +
    'child children kids couple group crowd dancers'
  ).split(' '),
);

/** Fixed actions the sentence has someone doing; quoted text (signs, t-shirts) doesn't count. */
export function actionsInSentence(sentence: string): ShotAction[] {
  const unquoted = sentence.replace(/(["“”‘’]).*?\1|(?<!\p{L})'[^']*'(?!\p{L})/gu, ' ');
  const words = plainWords(unquoted).split(' ');
  const found = new Set<ShotAction>();
  for (let i = 1; i < words.length; i++) {
    if (!DOERS.has(words[i - 1]!)) continue;
    for (const span of [3, 2, 1]) {
      const action = WORD_TO_ACTION.get(words.slice(i, i + span).join(' '));
      if (action) found.add(action);
    }
  }
  return [...found];
}

export interface ShotActionsInput {
  /** The model's `actions`: a list, a comma-separated string, or anything else (ignored). */
  readonly answer: unknown;
  readonly sentence: string;
  /** Nothing in the shot moves (`isStill`): its motion words are dropped. */
  readonly still?: boolean;
}

/** The shot's actions: fixed words first (in vocabulary order), then free ones as answered; a still shot's motion
 * words dropped. */
export function shotActions({ answer, sentence, still = false }: ShotActionsInput): string[] {
  const phrases =
    typeof answer === 'string'
      ? answer.split(/[,;\n]/u)
      : Array.isArray(answer)
        ? answer.filter((item): item is string => typeof item === 'string')
        : [];
  const fixed = new Set<ShotAction>(actionsInSentence(sentence));
  const free: string[] = [];
  for (const phrase of phrases) {
    const action = fixedAction(phrase);
    if (action) fixed.add(action);
    else {
      const clean = cleanAction(phrase);
      if (isFreeAction(clean) && !free.includes(clean)) free.push(clean);
    }
  }
  const kept = SHOT_ACTIONS.filter((action) => fixed.has(action) && !(still && MOTION_ACTIONS.has(action)));
  return [...kept, ...free].slice(0, SHOT_ACTION_LIMITS.count);
}

/**
 * A description as the one text its vector is made from: the sentence, then what people are doing, so a search for
 * "dancing" meets a shot whose sentence says "men on a stage" but whose actions say it.
 */
export function descriptionDocument(description: Pick<ShotDescription, 'text' | 'actions'>): string {
  const actions = description.actions ?? [];
  return actions.length > 0 ? `${description.text} Actions: ${actions.join(', ')}.` : description.text;
}
