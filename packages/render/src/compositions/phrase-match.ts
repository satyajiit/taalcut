// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Finding an anchor phrase in the words someone says (SPEC P3.4, "Timed to speech"). Both sides are reduced
 * to the same tokens: lower case, no punctuation, Latin accents dropped, Devanagari digits and spelling
 * variants folded, "per cent" in any of the four languages as '%', and runs of number words as one number
 * ("fifty" → 50, "treinta y cinco" → 35, "दो सौ" → 200). Matching is then token for token, across caption
 * word boundaries. The phrase is untrusted text: it is only ever compared, never rendered or evaluated.
 */
import { NUMBER_JOINERS, NUMBER_WORDS, PERCENT_PHRASES, type NumberWord } from './number-words';

/** A spoken word on the render's frame grid. */
export interface TimedWord {
  readonly text: string;
  /** Frames [start, end) on the render. */
  readonly start: number;
  readonly end: number;
}

interface Token {
  readonly value: string;
  /** The word it came from (its index in the words given). */
  readonly word: number;
}

const DEVANAGARI_ZERO = 0x0966;
const LATIN_MARKS = /[̀-ͯ]/g;
const NUKTA = /़/g;
const CHANDRABINDU = /ँ/g;
/** Everything but letters, marks, digits, '%', and the separators inside a number. */
const STRIP = /[^\p{L}\p{M}\p{N}%.,]/gu;

function fold(text: string, language: string): string {
  let lowered: string;
  try {
    lowered = text.normalize('NFKC').toLocaleLowerCase(language);
  } catch {
    // An unknown locale tag: plain lower case is the right fallback.
    lowered = text.normalize('NFKC').toLowerCase();
  }
  return lowered
    .normalize('NFD')
    .replace(LATIN_MARKS, '')
    .normalize('NFC')
    .replace(NUKTA, '')
    .replace(CHANDRABINDU, 'ं')
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - DEVANAGARI_ZERO));
}

/** "1,000" and "1.000" are a thousand; "2,5" and "2.5" are two and a half. */
function canonicalNumber(piece: string): string | null {
  if (/^\d{1,3}([.,]\d{3})+$/.test(piece)) return String(Number(piece.replace(/[.,]/g, '')));
  if (/^\d+([.,]\d+)?$/.test(piece)) return String(Number(piece.replace(',', '.')));
  return null;
}

/** One word's raw tokens: '%' split off, hyphens and dashes as spaces, punctuation dropped. */
function rawTokens(text: string, language: string): string[] {
  return fold(text, language)
    .replace(/%/g, ' % ')
    .replace(/[-‐-―/]/g, ' ')
    .split(/\s+/u)
    .map((piece) => piece.replace(STRIP, '').replace(/^[.,]+|[.,]+$/g, ''))
    .filter((piece) => piece !== '')
    .map((piece) => canonicalNumber(piece) ?? piece.replace(/[.,]/g, ''))
    .filter((piece) => piece !== '');
}

type Kind = 'digit' | 'unit' | 'tens' | 'hundreds' | 'scale';

function numberOf(value: string): { kind: Kind; word: NumberWord } | null {
  if (/^\d+(\.\d+)?$/.test(value)) return { kind: 'digit', word: { value: Number(value) } };
  const word = NUMBER_WORDS.get(value);
  if (!word) return null;
  if (word.scale) return { kind: 'scale', word };
  if (word.value >= 100) return { kind: 'hundreds', word };
  if (word.value >= 20 && word.value % 10 === 0) return { kind: 'tens', word };
  return { kind: 'unit', word };
}

/** Whether `next` continues a spoken number whose last part was `last` ("twenty" + "one", "hundred" + "five"). */
function continues(last: { kind: Kind; value: number }, next: { kind: Kind; word: NumberWord }): boolean {
  if (next.kind === 'scale') return true;
  if (next.kind === 'digit') return false;
  if (last.kind === 'scale' || last.kind === 'hundreds') return next.word.value < last.value;
  if (last.kind === 'tens') return next.kind === 'unit' && next.word.value < 10;
  return false;
}

/** Collapses "per cent" phrases to '%' and runs of number words to one number. */
function canonical(tokens: readonly Token[]): Token[] {
  const out: Token[] = [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) break;
    const percent = PERCENT_PHRASES.find((phrase) =>
      phrase.every((part, offset) => tokens[index + offset]?.value === part),
    );
    if (percent) {
      out.push({ value: '%', word: token.word });
      index += percent.length;
      continue;
    }
    const first = numberOf(token.value);
    if (!first) {
      out.push(token);
      index += 1;
      continue;
    }
    let total = 0;
    let current = 0;
    const add = (part: { kind: Kind; word: NumberWord }) => {
      if (part.kind !== 'scale') current += part.word.value;
      else if (part.word.value >= 1000) {
        total += (current || 1) * part.word.value;
        current = 0;
      } else current = (current || 1) * part.word.value;
    };
    add(first);
    let last = { kind: first.kind, value: first.word.value };
    index += 1;
    for (;;) {
      const joined = NUMBER_JOINERS.has(tokens[index]?.value ?? '') ? 1 : 0;
      const candidate = tokens[index + joined];
      const next = candidate ? numberOf(candidate.value) : null;
      if (!next || !continues(last, next)) break;
      add(next);
      last = { kind: next.kind, value: next.word.value };
      index += joined + 1;
    }
    out.push({ value: String(total + current), word: token.word });
  }
  return out;
}

/** The phrase's tokens as matching compares them (exported for tests and the tool's report). */
export function phraseTokens(text: string, language: string): string[] {
  return canonical(rawTokens(text, language).map((value) => ({ value, word: 0 }))).map(
    (token) => token.value,
  );
}

/**
 * The `occurrence`th place (1-based) the phrase is said: the indexes of its first and last words, or null.
 * An empty phrase never matches.
 */
export function findPhrase(
  words: readonly TimedWord[],
  phrase: string,
  occurrence: number,
  language: string,
): { readonly first: number; readonly last: number } | null {
  const wanted = phraseTokens(phrase, language);
  if (wanted.length === 0) return null;
  const stream = canonical(
    words.flatMap((word, index) => rawTokens(word.text, language).map((value) => ({ value, word: index }))),
  );
  let seen = 0;
  for (let at = 0; at + wanted.length <= stream.length; at++) {
    if (!wanted.every((value, offset) => stream[at + offset]?.value === value)) continue;
    seen += 1;
    const first = stream[at];
    const last = stream[at + wanted.length - 1];
    if (seen === occurrence && first && last) return { first: first.word, last: last.word };
  }
  return null;
}
