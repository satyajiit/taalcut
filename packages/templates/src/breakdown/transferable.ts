// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CAST: a template's intents must fit anyone's footage. A reel of one city broken down into "the traveler
 * climbs towards Marisol Tower" can only be cast from that city, and casting then matches clips to the landmark's
 * words instead of to what the shot does. templates.setIntents refuses an intent that names the reel's specifics,
 * with the words to change and what to write instead; the reel's own words go in `reel`.
 *
 * What counts as specific, in the line, the subject and the place:
 * - a proper noun: a capitalised word anywhere but the start of a sentence, or a run of two capitalised words at
 *   the start ("Mount Fuji", "Golden Pavilion", "Verenta Crossing", a brand, a city, a country);
 * - quoted words (a sign's or a shirt's text);
 * - a named kind of landmark or a reel-only object, from the list below, with the general words to use instead.
 */

/** Specific words and the general ones that fit any footage. */
const GENERAL: Readonly<Record<string, string>> = {
  torii: 'a gateway',
  pagoda: 'a landmark',
  shrine: 'a landmark',
  temple: 'a landmark',
  castle: 'a landmark',
  palace: 'a landmark',
  cathedral: 'a landmark',
  mosque: 'a landmark',
  church: 'a landmark',
  pavilion: 'a landmark',
  tower: 'a lit landmark or skyline',
  skyscraper: 'a skyline',
  statue: 'a landmark',
  monument: 'a landmark',
  pyramid: 'a landmark',
  colosseum: 'a landmark',
  train: 'a vehicle arriving, or transit',
  trains: 'vehicles, or transit',
  subway: 'transit',
  metro: 'transit',
  tram: 'transit',
  shinkansen: 'transit',
  tuk: 'a vehicle',
  rickshaw: 'a vehicle',
  gondola: 'a boat',
  kimono: 'clothing',
  sari: 'clothing',
  geisha: 'a person',
  sushi: 'food',
  ramen: 'food',
};

/** Capitalised words that are not names: the start of a clause after a colon or semicolon, and so on. */
const COMMON = new Set(['i', 'a', 'an', 'the', 'pov', 'tv', 'ok', 'cta', 'b-roll']);

export interface ReelSpecific {
  /** The words as written. */
  readonly words: string;
  /** What to write instead, when known. */
  readonly instead: string | null;
}

const SENTENCE_END = /[.!?]["')\]]?$/;

/**
 * The reel's specifics in one piece of text: proper nouns, quoted words, named landmarks and objects. A label (a
 * subject or a place) is lower case unless it names something, so its first word counts too.
 */
export function reelSpecifics(text: string, label = false): ReelSpecific[] {
  const found: ReelSpecific[] = [];
  const seen = new Set<string>();
  const add = (words: string, instead: string | null) => {
    const key = words.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ words, instead });
  };
  for (const quoted of text.matchAll(
    /["“]([^"”]{1,80})["”]|‘([^’]{1,80})’|(?<![\p{L}\p{N}])'([^']{1,80})'(?![\p{L}\p{N}])/gu,
  ))
    add(quoted[0], "the kind of sign or text, without quoting it ('a lit sign')");
  const tokens = text.split(/\s+/).filter(Boolean);
  let run: string[] = [];
  let runStartsSentence = false;
  const flush = () => {
    if (run.length > 0 && (label || !runStartsSentence || run.length > 1)) add(run.join(' '), null);
    run = [];
  };
  tokens.forEach((raw, index) => {
    const word = raw.replace(/^[("'“‘[]+|[)"'”’\],.;:!?]+$/g, '');
    const startsSentence = index === 0 || SENTENCE_END.test(tokens[index - 1] ?? '');
    const capital = /^\p{Lu}/u.test(word) && /\p{Ll}/u.test(word) && !COMMON.has(word.toLocaleLowerCase());
    const acronym = /^\p{Lu}{2,}$/u.test(word) && !COMMON.has(word.toLocaleLowerCase());
    if (capital || acronym) {
      if (run.length === 0) runStartsSentence = startsSentence;
      run.push(word);
    } else flush();
    // A word that ends a clause ends the run: "Verenta, then" is one name.
    if (/[,.;:!?]$/.test(raw)) flush();
  });
  flush();
  for (const match of text.toLocaleLowerCase().matchAll(/\p{L}+/gu)) {
    const instead = GENERAL[match[0]];
    if (instead) add(match[0], instead);
  }
  return found;
}

export interface IntentFields {
  readonly text: string;
  readonly subject: string | null;
  readonly place: string | null;
}

/** What makes an intent specific to the reel, field by field; empty when it fits anyone's footage. */
export function intentSpecifics(
  intent: IntentFields,
): { field: 'text' | 'subject' | 'place'; found: ReelSpecific[] }[] {
  return (['text', 'subject', 'place'] as const).flatMap((field) => {
    const value = intent[field];
    const found = value ? reelSpecifics(value, field !== 'text') : [];
    return found.length > 0 ? [{ field, found }] : [];
  });
}

/** One line the model can act on: the slot, the words, what to write instead, and where the reel's words go. */
export function specificsMessage(slotIndex: number, problems: ReturnType<typeof intentSpecifics>): string {
  const words = problems.flatMap(({ field, found }) =>
    found.map((item) => `${field} "${item.words}"${item.instead ? ` (write ${item.instead})` : ''}`),
  );
  return (
    `Slot ${slotIndex}'s intent names the reel's specifics: ${words.join(', ')}. Write what the shot does so it ` +
    "fits anyone's footage: its role, who is in it and what they do, the shot size and framing, the camera, the " +
    'light and time of day, the mood; no place names, landmarks, brands, sign text or reel-only objects. Put what ' +
    'the reel literally shows in reel.'
  );
}
