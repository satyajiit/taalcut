// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT1: an intent that names the reel's specifics, rewritten by Taalcut to fit anyone's footage instead of refused.
 * On the owner's reel the local models were refused 35 to 39 times in five breakdowns for words like "pagoda",
 * "train" or "Japanese", and could not mend the line themselves: they sent the same words back until a limit, or gave
 * up on the reel. The fix is mechanical, so the tool makes it and says what it changed:
 *
 * - a named landmark or reel-only object (transferable.ts' list) becomes its general word: "a temple and pagoda"
 *   is "a landmark", "a train platform" is "a transit platform";
 * - a name whose last word is a kind of place keeps that word: "Verenta Crossing" is "a crossing", "Marisol Tower"
 *   is "a landmark";
 * - any other name goes: "Japanese characters" is "characters", "arrives in Verenta at dusk" is "arrives at dusk";
 * - quoted text goes, with the verb that introduces it: "a sign reading 'OPEN'" is "a sign".
 *
 * A name dropped with no general word for it (`dropped`) may have carried meaning, so the slot asks the review
 * (doubts.ts, intentGeneralised). A line that is too short once rewritten is not repaired: the tool refuses it with
 * the rewrite it tried as an example (`rewriteExample`).
 */
import { reelSpecifics, type IntentFields } from './transferable';
import {
  DETERMINERS,
  GENERAL_WORDS,
  LINKS,
  NOUN,
  PLACE_KINDS,
  PREPOSITIONS,
  SAID_BY_NEXT,
  TRANSIT_PLACES,
} from './transferable-words';

/** Words that introduce quoted text: they go with it. */
const QUOTE_VERBS =
  /\s*(?:that\s+)?(?:reads?|reading|says?|saying|labell?ed|marked|with\s+the\s+words?)\s*:?\s*$/iu;
const QUOTED = /["“]([^"”]{1,80})["”]|‘([^’]{1,80})’|(?<![\p{L}\p{N}])'([^']{1,80})'(?![\p{L}\p{N}])/gu;
const SENTENCE_END = /[.!?]["')\]]?$/;
/** A line rewritten to fewer words than this says too little to cast from: refused, with the rewrite as an example. */
export const MIN_REWRITTEN_WORDS = 3;

export interface IntentRewrite {
  readonly field: 'text' | 'subject' | 'place';
  readonly from: string;
  /** Null: a label with nothing left once its specifics went. */
  readonly to: string | null;
}

export interface GeneralisedIntent {
  readonly intent: IntentFields & { readonly needs?: string[] };
  readonly rewrites: readonly IntentRewrite[];
  /** A name went with no general word for it: the review should look at the line. */
  readonly dropped: boolean;
  /** The line still names the reel, or says too little once rewritten: not stored, the rewrite is an example. */
  readonly refused: boolean;
}

interface Token {
  text: string;
  /** Removed from the output. */
  gone?: boolean;
  /** An article said before the word ("at Verenta Crossing" is "at a crossing"). */
  article?: string;
}

const bare = (raw: string) => raw.replace(/^[("'“‘[]+|[)"'”’\],.;:!?]+$/gu, '');
const isName = (word: string) =>
  (/^\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) || /^\p{Lu}{2,}$/u.test(word);
const COMMON = new Set(['i', 'a', 'an', 'the', 'pov', 'tv', 'ok', 'cta', 'b-roll']);
/** Small words inside one name ("Welcome to Verenta", "Temple of the Golden Hall"): they go with it. */
const NAME_JOINS = new Set(['of', 'to', 'the', 'de', 'la', 'and', '&']);
const nameAt = (tokens: readonly Token[], index: number): boolean => {
  const word = bare(tokens[index]?.text ?? '').replace(/['’]s$/u, '');
  return isName(word) && !COMMON.has(word.toLocaleLowerCase());
};
/** Whether the words from `index` on are joins and then a name. */
function nameAhead(tokens: readonly Token[], index: number): boolean {
  let at = index;
  while (at < tokens.length && NAME_JOINS.has(bare(tokens[at]!.text).toLocaleLowerCase())) {
    if (/[,.;:!?]$/u.test(tokens[at]!.text)) return false;
    at++;
  }
  return at > index && nameAt(tokens, at);
}

/** Names in one text, as runs of token indexes, by reelSpecifics' rule (a lone capital that starts a sentence isn't one). */
function nameRuns(tokens: readonly Token[], label: boolean): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  let startsSentence = false;
  const flush = () => {
    if (run.length > 0 && (label || !startsSentence || run.length > 1)) runs.push(run);
    run = [];
  };
  tokens.forEach((token, index) => {
    const sentenceStart = index === 0 || SENTENCE_END.test(tokens[index - 1]?.text ?? '');
    if (nameAt(tokens, index)) {
      if (run.length === 0) startsSentence = sentenceStart;
      run.push(index);
    } else if (run.length > 0 && nameAhead(tokens, index)) run.push(index);
    else flush();
    if (/[,.;:!?]$/u.test(token.text)) flush();
  });
  flush();
  return runs;
}

/** Keeps a token's punctuation around a new word. */
function replaceWord(raw: string, word: string): string {
  const lead = /^[("'“‘[]+/u.exec(raw)?.[0] ?? '';
  const tail = /[)"'”’\],.;:!?]+$/u.exec(raw)?.[0] ?? '';
  return `${lead}${word}${tail}`;
}

function dropNames(tokens: Token[], label: boolean): { dropped: boolean } {
  let dropped = false;
  for (const run of nameRuns(tokens, label)) {
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const words = run.map((index) => bare(tokens[index]!.text).toLocaleLowerCase());
    // The kind of place it ends with, else a listed word in it ("the Temple of the Golden Hall" is a temple).
    const lastWord = PLACE_KINDS.has(words.at(-1)!)
      ? words.at(-1)!
      : (words.find((word) => NOUN[word] !== undefined) ?? words.at(-1)!);
    const before = first > 0 ? bare(tokens[first - 1]!.text).toLocaleLowerCase() : undefined;
    const possessive = /['’]s[)"'”’\],.;:!?]*$/u.test(tokens[last]!.text);
    const next = tokens[last + 1]?.text;
    const ending = /[,.;:!?]$/u.test(tokens[last]!.text);
    for (const index of run) tokens[index]!.gone = true;
    // "arrives in Verenta at dusk" loses "in", "toward the Golden Hall" "the" and "toward"; "Japanese characters" stay.
    const following = next === undefined ? undefined : bare(next).toLocaleLowerCase();
    const nounUse = possessive
      ? false
      : ending ||
        following === undefined ||
        !/^\p{Ll}/u.test(bare(next!)) ||
        PREPOSITIONS.has(following) ||
        LINKS.has(following);
    if (!possessive && (PLACE_KINDS.has(lastWord) || NOUN[lastWord] !== undefined)) {
      // "at Verenta Crossing" is "at a crossing"; "the Marisol Tower" keeps its article; "red Torii gates" are red
      // torii gates (then gates), with no article.
      const bareNoun = before === undefined || !DETERMINERS.has(before);
      const article = bareNoun && (PLACE_KINDS.has(lastWord) || nounUse) ? 'a ' : undefined;
      tokens[last] = { text: replaceWord(tokens[last]!.text, lastWord), ...(article ? { article } : {}) };
      continue;
    }
    dropped = true;
    const article = nounUse && before !== undefined && DETERMINERS.has(before) ? first - 1 : undefined;
    if (article !== undefined) tokens[article]!.gone = true;
    const lead = article ?? first;
    const leading = lead > 0 ? bare(tokens[lead - 1]!.text).toLocaleLowerCase() : undefined;
    if (nounUse && leading !== undefined && PREPOSITIONS.has(leading)) tokens[lead - 1]!.gone = true;
    if (ending) {
      // The clause's punctuation stays on the word before; a question or an exclamation was the name's own (an
      // overlay's words written out: "hook: How's Verenta? text pops in").
      const kept = tokens.slice(0, first).findLastIndex((token) => !token.gone);
      const tail = (/[,.;:!?]+$/u.exec(tokens[last]!.text)?.[0] ?? '').replace(/[!?]/gu, '');
      if (kept >= 0 && tail) tokens[kept] = { text: `${tokens[kept]!.text}${tail}` };
    }
  }
  return { dropped };
}

/** A listed specific's general word; "train" before a platform or a station is transit, not a vehicle. */
function generalWord(word: string, next: string | undefined): string | undefined {
  const lower = word.toLocaleLowerCase();
  const noun = NOUN[lower];
  if (!noun) return undefined;
  if (lower === 'train' && next && TRANSIT_PLACES.has(bare(next).toLocaleLowerCase())) return 'transit';
  return /^\p{Lu}/u.test(word) ? noun[0]!.toLocaleUpperCase() + noun.slice(1) : noun;
}

function tidy(text: string): string {
  let out = text
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/([,;:])(?=[,.;:!?])/gu, '')
    // u3: "asking How's Verenta? and Well." left "asking and.": a conjunction with nothing after it goes.
    .replace(/\s+(?:and|or|&)(?=[,.;:!?]|$)/giu, '')
    .replace(/^[\s,.;:]+/u, '')
    .trim();
  // "a landmark and landmark", "landmark, landmark", "transit transit": one general word is enough.
  for (;;) {
    const next = out
      .replace(
        /\b(\p{L}+)((?:\s*,\s*|\s+(?:and|or|&)\s+|\s+)(?:an?\s+|the\s+)?\1\b)+/giu,
        (match, word: string) => (GENERAL_WORDS.has(word.toLocaleLowerCase()) ? word : match),
      )
      .replace(/\b(an?)\s+(?=an?\b)/giu, '');
    if (next === out) break;
    out = next;
  }
  out = out.replace(/\b(a|an)\s+(\p{L})/giu, (match, article: string, letter: string) => {
    const vowel = /[aeiou]/iu.test(letter);
    const wanted = vowel ? 'an' : 'a';
    const cased = /^A/u.test(article) ? wanted[0]!.toUpperCase() + wanted.slice(1) : wanted;
    return `${cased} ${letter}`;
  });
  return out;
}

const capitaliseLike = (text: string, original: string) =>
  /^\p{Lu}/u.test(original) && text ? text[0]!.toLocaleUpperCase() + text.slice(1) : text;

/** Passes over one field: a name dropped can leave another one starting a clause no longer ("? Well." → ": Well."). */
const PASSES = 3;

/** One field rewritten; unchanged when it names nothing of the reel. */
export function generaliseText(text: string, label: boolean): { text: string; dropped: boolean } {
  let current = { text, dropped: false };
  for (let pass = 0; pass < PASSES && reelSpecifics(current.text, label).length > 0; pass++) {
    const next = generaliseOnce(current.text, label);
    if (next.text === current.text) break;
    current = {
      text: label ? next.text : capitaliseLike(next.text, text),
      dropped: current.dropped || next.dropped,
    };
  }
  return current;
}

function generaliseOnce(text: string, label: boolean): { text: string; dropped: boolean } {
  let dropped = false;
  // Quoted text goes, with what introduces it.
  let unquoted = '';
  let at = 0;
  for (const match of text.matchAll(QUOTED)) {
    const before = text.slice(at, match.index);
    const verb = QUOTE_VERBS.exec(before);
    unquoted += verb ? before.slice(0, verb.index) : `${before}text`;
    if (!verb) dropped = true;
    at = match.index + match[0].length;
  }
  unquoted += text.slice(at);
  const tokens: Token[] = unquoted
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => ({ text: part }));
  if (dropNames(tokens, label).dropped) dropped = true;
  const kept = tokens.filter((token) => !token.gone);
  const words = kept.flatMap((token, index) => {
    const next = kept[index + 1]?.text;
    // "torii gates" are gates: the kind is already said.
    if (SAID_BY_NEXT[bare(token.text).toLocaleLowerCase()]?.has(bare(next ?? '').toLocaleLowerCase()))
      return [];
    const general = generalWord(bare(token.text), next);
    return [(token.article ?? '') + (general ? replaceWord(token.text, general) : token.text)];
  });
  return { text: tidy(words.join(' ')), dropped };
}

const BACKGROUND_NEED = /\b(?:in (?:the )?background|passing by|behind (?:them|him|her|the subject))\b/iu;

/** Rewrites one need or label phrase, removing reel specifics. */
export function generalisePhrase(phrase: string): { text: string; dropped: boolean } {
  return generaliseText(phrase, true);
}

const wordCount = (text: string) => text.split(/\s+/u).filter((word) => /\p{L}/u.test(word)).length;

/** The intent with its specifics rewritten; undefined when it names nothing of the reel. */
export function generaliseIntent(
  intent: IntentFields & { readonly needs?: readonly string[] },
  minWords = MIN_REWRITTEN_WORDS,
): GeneralisedIntent | undefined {
  const rewrites: IntentRewrite[] = [];
  let dropped = false;
  const field = (name: IntentRewrite['field'], value: string | null): string | null => {
    if (!value) return value;
    const rewritten = generaliseText(value, name !== 'text');
    if (rewritten.text === value) return value;
    dropped ||= rewritten.dropped;
    const to = rewritten.text.trim() ? rewritten.text : null;
    rewrites.push({ field: name, from: value, to });
    return to;
  };
  const text = field('text', intent.text) ?? '';
  const subject = field('subject', intent.subject);
  const place = field('place', intent.place);
  let needsChanged = false;
  const needs = intent.needs?.flatMap((need) => {
    if (BACKGROUND_NEED.test(need)) {
      needsChanged = true;
      return [];
    }
    const rewritten = generalisePhrase(need);
    if (rewritten.text !== need) needsChanged = true;
    const cleaned = rewritten.text.trim();
    if (!cleaned || BACKGROUND_NEED.test(cleaned)) {
      needsChanged = true;
      return [];
    }
    return [cleaned];
  });
  if (rewrites.length === 0 && !needsChanged) return undefined;
  const generalised = {
    text,
    subject,
    place,
    ...(needs !== undefined ? { needs } : {}),
  };
  const still = [text, subject ?? '', place ?? ''].some(
    (value, index) => reelSpecifics(value, index > 0).length > 0,
  );
  return {
    intent: generalised,
    rewrites,
    dropped,
    refused: still || wordCount(text) < minWords,
  };
}
