// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The last two steps of cleaning a shot's text (clean.ts): reads of one phrase become one text in one spelling, and
 * a fragment a longer text holds goes. Phrases are compared word by word, because a sample a second reads a printed
 * phrase on something that moves differently each time: a "TIGER TEAM" shirt print comes back as "TIGER P TEAM",
 * "TIGER TEAM", "TLGEN TEAM" and "TIGEV D TEA". As whole strings the last two are too far from the first; word by word
 * each lines up. Words that say something on their own count (two letters or more, or a number), so a stray "P" or
 * "D" neither keeps two reads apart nor gets into the spelling.
 */
import { RationalTime, TimeRange, type OnScreenText } from '@taalcut/core';
import { clampBox, normaliseText, scriptOf, textSimilarity } from './text';

export const PHRASE_MATCH = {
  /** Each word of one phrase is at least this alike to its counterpart in the other, case aside. */
  word: 0.6,
  /** And the words are this alike on average: a word two letters off passes only beside words that agree. */
  mean: 0.75,
} as const;

const graphemes = new Intl.Segmenter('und', { granularity: 'grapheme' });
const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const WORD = /[\p{L}\p{M}\p{Nd}]+/gu;

/** Letters as written: each grapheme with a letter in it (a Devanagari syllable with its marks is one). */
export function letterCount(text: string): number {
  let count = 0;
  for (const { segment } of graphemes.segment(text)) if (LETTER.test(segment)) count++;
  return count;
}

/** A text's words as written, and folded for comparing. */
interface Word {
  readonly raw: string;
  readonly folded: string;
}

const wordsOf = (text: string): Word[] =>
  (normaliseText(text).match(WORD) ?? []).map((raw) => ({ raw, folded: raw.toLowerCase() }));
/** A word that says something on its own: two letters or more, or a number. */
const significant = (word: Word) => DIGIT.test(word.raw) || letterCount(word.raw) >= 2;
const keyWords = (text: string) => wordsOf(text).filter(significant);

const digitsOf = (word: string) => (word.match(/\p{Nd}/gu) ?? []).join('');

/** How alike two words are; two different numbers not at all ("Day 1", "Day 2"), a misread digit as letters are. */
function wordSimilarity(a: string, b: string): number {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (x && y && x !== y) return 0;
  return textSimilarity(a, b);
}

/** Similarities pass when each is at least PHRASE_MATCH.word and their mean PHRASE_MATCH.mean. */
function passes(similarities: readonly number[]): boolean {
  if (similarities.length === 0) return false;
  const mean = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
  return Math.min(...similarities) >= PHRASE_MATCH.word && mean >= PHRASE_MATCH.mean;
}

/** Two texts are one phrase: as many words that say something, each lining up with its counterpart. */
export function samePhrase(a: string, b: string): boolean {
  const x = keyWords(a);
  const y = keyWords(b);
  return x.length === y.length && passes(x.map((word, i) => wordSimilarity(word.folded, y[i]!.folded)));
}

/** Better first: the more confident, the longer seen, the earlier. */
function byStanding(a: OnScreenText, b: OnScreenText): number {
  return (
    b.confidence - a.confidence ||
    b.range.duration.value - a.range.duration.value ||
    RationalTime.compare(a.range.start, b.range.start)
  );
}

/** Texts as one, led by `lead` (its box and reveal), with `text` and every member's stretch. */
export function asOne(members: readonly OnScreenText[], text: string, lead: OnScreenText): OnScreenText {
  const range = members.slice(1).reduce((all, t) => TimeRange.span(all, t.range), members[0]!.range);
  const language = members.find((t) => t.language)?.language;
  return {
    text: text.slice(0, 500),
    box: clampBox(lead.box),
    range,
    confidence: Math.max(...members.map((t) => t.confidence)),
    script: scriptOf(text),
    ...(language ? { language } : {}),
    reveal: members.length === 1 ? lead.reveal : 'none',
  };
}

/** Each position's word the members agree on: the most read, then the one most like the others, then the first. */
function agreedWords(members: readonly OnScreenText[]): Word[] {
  const rows = members.map((member) => keyWords(member.text));
  return rows[0]!.map((_, i) => {
    const column = rows.map((row) => row[i]!);
    const count = (word: Word) => column.filter((other) => other.folded === word.folded).length;
    const likeness = (word: Word) =>
      column.reduce((sum, other) => sum + wordSimilarity(word.folded, other.folded), 0);
    return column.reduce((best, word) =>
      count(word) > count(best) || (count(word) === count(best) && likeness(word) > likeness(best))
        ? word
        : best,
    );
  });
}

/** The spelling of a phrase read several ways: a member that reads exactly the agreed words, else those words. */
function spellingOf(members: readonly OnScreenText[]): string {
  const agreed = agreedWords(members);
  const key = agreed.map((word) => word.folded).join(' ');
  const exact = members.find(
    (member) =>
      wordsOf(member.text)
        .map((word) => word.folded)
        .join(' ') === key,
  );
  return exact ? exact.text : agreed.map((word) => word.raw).join(' ');
}

/** Step 4: reads of one phrase are one text, in the spelling their words agree on. */
export function oneSpelling(texts: readonly OnScreenText[]): OnScreenText[] {
  const groups: OnScreenText[][] = [];
  for (const text of [...texts].sort(byStanding)) {
    const group = groups.find((members) => samePhrase(members[0]!.text, text.text));
    if (group) group.push(text);
    else groups.push([text]);
  }
  return groups.map((members) =>
    members.length === 1 ? members[0]! : asOne(members, spellingOf(members), members[0]!),
  );
}

/** `outer` holds every word of `inner` that says something, and says more. */
function holds(outer: OnScreenText, inner: OnScreenText): boolean {
  const own = keyWords(inner.text);
  const theirs = keyWords(outer.text);
  if (own.length === 0 || theirs.length <= own.length) return false;
  return passes(
    own.map((word) => Math.max(...theirs.map((other) => wordSimilarity(word.folded, other.folded)))),
  );
}

/** Step 5: a fragment goes, and the text that holds it spans its stretch too. */
export function dropFragments(texts: readonly OnScreenText[]): OnScreenText[] {
  const kept = new Map<OnScreenText, OnScreenText[]>();
  // Fullest first, so a fragment's stretch goes to the fullest text that holds it.
  const order = [...texts].sort(
    (a, b) => keyWords(b.text).length - keyWords(a.text).length || byStanding(a, b),
  );
  for (const text of order) {
    const holder = [...kept.keys()].find((outer) => holds(outer, text));
    if (holder) kept.get(holder)!.push(text);
    else kept.set(text, [text]);
  }
  return [...kept].map(([text, all]) => (all.length === 1 ? text : asOne(all, text.text, text)));
}
