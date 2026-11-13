// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-STORY: the concrete things a slot asks for (a phone, a dog, a guitar, cooking), read from its intent's words
 * and from the graphics over it, against what vision said each shot shows: its description and its objects. A line's
 * embedding blurs one object among a dozen words, so the intent part also counts these words apart (score.ts).
 *
 * Each word counts by how few of the shots casting weighs show it: its IDF scaled to 0..1 (1 for a word one shot
 * shows, 0 for a word every shot shows), raised to the config's sharpness, so "walking" or "street" in a travel
 * library counts for next to nothing and "phone" in one shot counts fully. A shot's match is the union of the words
 * it shows (1 − Π(1 − w)). As with the attributes, only what a shot says counts: a one-line description that doesn't
 * name a phone doesn't say there is none, so a word raises the shots that show it and leaves the others as they are
 * (score.ts).
 *
 * Words are English, as the Analyst's intents and vision's descriptions are: core's search terms (NFC, lower case,
 * letter runs, function words out), less the words other parts already score (people, camera and shot words,
 * night or day, indoors or out, colours and sizes), each reduced to a stem by a light suffix stripper so "phones",
 * "phoning" and "phone" are one word. An object tag counts by its last word, the thing ("coffee cups" are cups);
 * text a description quotes is what is written in the frame, not what it shows, so it is left out.
 */
import { searchTerms, type GRAPHIC_BRIEF_KINDS, type ShotProfile } from '@taalcut/core';
import { profileKey } from './catalog';
import type { CastingConfig } from './config';

export type GraphicKind = (typeof GRAPHIC_BRIEF_KINDS)[number];

/** Words for a person: a slot about "the traveler" is about anyone in the shot (the subject part counts people). */
export const PERSON_WORDS: ReadonlySet<string> = new Set(
  'person people traveler traveller tourist man woman men women girl boy couple friend friends someone subject creator host walker figure'.split(
    ' ',
  ),
);

/** Words that say no thing a shot shows, or that another part already scores. */
const NOT_THINGS: ReadonlySet<string> = new Set(
  [
    // function words core's search terms keep
    'about above across after again against all along also amid among another any around away back before behind being below beneath beside between beyond both but can could did do does down during each either else even ever every few first front further he her here hers him his how its itself just last less like many may might more most much near nearby next no nor not now off once one only onto other others our out over own past per quite rather same several she should since so some such than their theirs them then there these they those though through throughout thus together too toward towards under until up upon us very was we were what when where whether which while who whom whose why will within without would yet you your two three four',
    // the camera and the cut (motion, shot size and the hook score these)
    'camera cameras frame frames framing framed view views scene scenes angle angled lens close closeup medium wide long full extreme eye level low high overhead aerial pov handheld track tracks tracking tracked pan pans panning tilt tilts tilting push pushes pushing pull pulls pulling dolly zoom zooming static steady shake shaky shaking movement move moves moving motion slow slowly quick quickly fast follow follows following focus focused blur blurred blurry foreground background left right center centre middle top bottom side sides edge distance distant closer image picture photo footage visible seen shown shows showing appears captured depicts features featuring set sets setting',
    // the story and the edit
    'journey story moment moments montage beat beats peak contrast mood vibe feel sense sequence opening ending intro outro hook energy drama dramatic',
    // night or day, the light, indoors or out, facing (attributes.ts)
    'day daytime daylight night nighttime evening morning afternoon dusk twilight midday noon sun sunny sunlit sunlight sunshine sunset sunrise lit glow glowing illuminated shadow shadows shade dappled indoor indoors outdoor outdoors inside outside interior exterior face faces facing rear',
    // colours, sizes and looks
    'red orange yellow green blue purple pink brown black white grey gray golden gold silver colorful colourful bright dark large small big tall narrow short little huge giant tiny various busy quiet calm soft warm cool cold hot beautiful lush vibrant ornate grand historic old new modern ancient traditional famous open empty',
  ]
    .join(' ')
    .split(' '),
);

/** A word's stem: plurals, -ing and -ed off, a final e off, so a word's forms meet ("phones", "phoning" → "phon"). */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3) return w;
  if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  const suffix = /(?:ing|ed)$/.exec(w);
  if (suffix) {
    const base = w.slice(0, -suffix[0].length);
    // "bring" and "shed" keep theirs: what is left has no vowel. "running" loses its doubled n.
    if (base.length >= 3 && /[aeiouy]/.test(base))
      w = /([^aeiouylsz])\1$/.test(base) ? base.slice(0, -1) : base;
  }
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** The person words' stems, so "travelers" and "girls" are people too. */
const PERSON_STEMS: ReadonlySet<string> = new Set([...PERSON_WORDS].map(stem));

/** Quoted text in a description: words written in the frame (a sign, a shirt), not things it shows. */
const QUOTED = /(^|\s)["'“‘][^"'”’]{1,120}["'”’](?=[\s.,;:!?)]|$)/gu;

/** The stems of the things these words name, once each. */
export function thingTerms(text: string): string[] {
  const out = new Set<string>();
  // Core's search terms keep at most 32 words, so each clause is read on its own.
  for (const clause of text.replace(QUOTED, ' ').split(/[.,;:!?()\n]+/u)) {
    for (const word of searchTerms(clause)) {
      if (word.length < 2 || NOT_THINGS.has(word) || /^\p{N}+$/u.test(word)) continue;
      const term = stem(word);
      if (!PERSON_STEMS.has(term)) out.add(term);
    }
  }
  return [...out];
}

/** An object tag's thing: its last word ("palm tree" is a tree), unless that says no thing. */
function tagTerm(tag: string): string | null {
  const last = thingTerms(tag).at(-1);
  return last ?? null;
}

/** What a shot shows, as stems: its description's things and its objects. */
export function shotTerms(profile: Pick<ShotProfile, 'description' | 'objectTags'>): ReadonlySet<string> {
  const terms = new Set(thingTerms(profile.description ?? ''));
  for (const tag of profile.objectTags) {
    const term = tagTerm(tag);
    if (term) terms.add(term);
  }
  return terms;
}

/** How many of the shots casting weighs show each word, and each shot's words. */
export interface TermIndex {
  readonly shots: number;
  readonly df: ReadonlyMap<string, number>;
  of(profile: ShotProfile): ReadonlySet<string>;
}

/** The index over these shots (each counted once, however many slots it is a candidate for). */
export function termIndex(profiles: Iterable<ShotProfile>): TermIndex {
  const byKey = new Map<string, ReadonlySet<string>>();
  for (const profile of profiles) {
    const key = profileKey(profile);
    if (!byKey.has(key)) byKey.set(key, shotTerms(profile));
  }
  const df = new Map<string, number>();
  for (const terms of byKey.values()) for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1);
  return {
    shots: byKey.size,
    df,
    of: (profile) => byKey.get(profileKey(profile)) ?? shotTerms(profile),
  };
}

/** A slot's asks: each stem with how strongly the slot says it (1 for its intent's words). */
export type SlotTerms = ReadonlyMap<string, number>;

/**
 * What a slot asks for: its intent's words (line, place and subject; never `reel`, the reference's own footage) at
 * strength 1. FIX-HOOK: graphics no longer add words of their own; what the footage under a graphic must show is the
 * slot's `needs`, which the Analyst states (needs.ts).
 */
export function slotTerms(
  intent: { readonly text: string; readonly place: string | null; readonly subject: string | null } | null,
): SlotTerms {
  const terms = new Map<string, number>();
  const add = (term: string, strength: number) => terms.set(term, Math.max(terms.get(term) ?? 0, strength));
  if (intent)
    for (const term of thingTerms([intent.text, intent.place ?? '', intent.subject ?? ''].join('. ')))
      add(term, 1);
  return terms;
}

/** A shot's match to a slot's asks. */
export interface TermMatch {
  /** 0..1: the union of the weights of the words the shot shows; 0 when it shows none. */
  readonly score: number;
  /** The stems the shot shows, strongest first. */
  readonly matched: readonly string[];
}

/** A word's weight among `shots` shots of which `df` show it: IDF on 0..1, sharpened; 0 with nothing to compare. */
export function rarity(df: number, shots: number, sharpness: number): number {
  if (shots <= 1 || df <= 0) return 0;
  return Math.max(0, Math.log(shots / df) / Math.log(shots)) ** sharpness;
}

/** Null when the shot shows nothing the slot asks for: the intent part is then as it was. */
export function termMatch(
  asks: SlotTerms,
  shot: ReadonlySet<string>,
  index: TermIndex,
  config: CastingConfig['terms'],
): TermMatch | null {
  let missed = 1;
  const matched: { term: string; weight: number }[] = [];
  for (const [term, strength] of asks) {
    if (!shot.has(term)) continue;
    const weight = strength * rarity(index.df.get(term) ?? 0, index.shots, config.sharpness);
    if (weight <= 0) continue;
    missed *= 1 - weight;
    matched.push({ term, weight });
  }
  if (matched.length === 0) return null;
  return {
    score: 1 - missed,
    matched: matched
      .sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : 1))
      .map((entry) => entry.term),
  };
}
