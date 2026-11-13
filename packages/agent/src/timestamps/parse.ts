// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * References to a place in a video in a chat message (P3-V15, SPEC section 23): slot numbers ("slot 3",
 * "स्लॉट 3"), ordinals ("the third shot", "el tercer clip"), the hook, times ("0:04", "00:04.5", "at 4 seconds",
 * "cambia el clip del segundo 8") and ranges ("from 0:03 to 0:06", "between 3 and 5 seconds"), in the four v1
 * languages; and which video the message means. Pure: the same message always gives the same references.
 */
import { FrameRate, RationalTime, TimeRange } from '@taalcut/core';
import {
  asciiDigits,
  COPY_WORDS,
  EDIT_WORDS,
  HOOK_WORDS,
  NUMBER_WORDS,
  ORDINAL_WORDS,
  POSITION_AFTER,
  POSITION_BEFORE,
  RANGE_ENDS,
  RANGE_JOINS,
  RANGE_STARTS,
  readNumber,
  SECOND_PREFIXES,
  SECOND_UNITS,
  SLOT_NOUNS,
  TEMPLATE_WORDS,
  TIMELINE_WORDS,
  TRANSITION_WORDS,
} from './lexicon';

export type ReferenceTarget =
  /** 1-based; LAST (-1) for "the last shot". */
  | { readonly kind: 'slot'; readonly index: number }
  | { readonly kind: 'time'; readonly at: RationalTime }
  | { readonly kind: 'range'; readonly range: TimeRange };

export interface TimeReference {
  /** The words as written, at most 80 characters. */
  readonly said: string;
  /** Where they are in the message (UTF-16 offsets, end exclusive). */
  readonly span: { readonly start: number; readonly end: number };
  readonly target: ReferenceTarget;
  /** "the transition at 0:04": the cut there, not the slot around it. */
  readonly cut: boolean;
}

/** Which video the words point into: the reference (template), the user's own (timeline), or unclear. */
export type ReferenceBasis = 'template' | 'timeline' | 'both';

export interface ParsedReferences {
  readonly references: readonly TimeReference[];
  readonly basis: ReferenceBasis;
}

/** At most this many references per message: core keeps ten pointers, and a "both" reference makes two. */
export const MAX_REFERENCES = 5;
const MAX_SAID = 80;

const START = '(?<![\\p{L}\\p{M}\\p{N}])';
const END = '(?![\\p{L}\\p{M}\\p{N}])';
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alt = (words: readonly string[]) =>
  [...words]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
const re = (source: string) => new RegExp(source, 'giu');

const NUMBER = `(?:\\d+(?:[.,]\\d+)?|${alt(Object.keys(NUMBER_WORDS))})`;
/** [h:]m:ss[.fff] */
const CLOCK = '(?:\\d{1,2}:)?\\d{1,2}:[0-5]\\d(?:[.,]\\d{1,3})?';
const UNIT = `(?:${alt(SECOND_UNITS)})${END}`;
const SPOKEN = `${NUMBER}\\s*${UNIT}`;

const PATTERNS = {
  range: re(
    `${START}(?:(${alt(RANGE_STARTS)})\\s+)?(${CLOCK}|${NUMBER}(?:\\s*${UNIT})?)\\s*(${alt(RANGE_JOINS)})\\s*(${CLOCK}|${SPOKEN})(?:\\s*(?:${alt(RANGE_ENDS)}))?`,
  ),
  clock: re(`${START}${CLOCK}${END}`),
  slotNumber: re(
    `${START}(?:${alt(SLOT_NOUNS)})\\s*(?:#|no\\.|nº|n°|number|número|नंबर)?\\s*(\\d{1,3}|${alt(Object.keys(NUMBER_WORDS))})${END}(?!\\s*${UNIT})`,
  ),
  ordinal: re(
    `${START}(${alt(Object.keys(ORDINAL_WORDS))}|\\d{1,3}(?:st|nd|rd|th|º|ª))\\s+(?:${alt(SLOT_NOUNS)})${END}`,
  ),
  hook: re(`${START}(?:${alt(HOOK_WORDS)})${END}`),
  spokenBefore: re(`${START}(?:${alt(POSITION_BEFORE)})\\s+(?:the\\s+)?(${SPOKEN})`),
  spokenAfter: re(`${START}(${SPOKEN})\\s*(?:${alt(POSITION_AFTER)})${END}`),
  prefixed: re(`${START}(?:${alt(SECOND_PREFIXES)})\\s+(\\d+(?:[.,]\\d+)?)${END}(?!\\s*${UNIT})`),
} as const;

/**
 * The rate a typed time is read at: thousandths of a second, so every clock ("0:04.250", at most three
 * decimals) and spoken time ("3.5 s") is exact. Resolving compares it with the video's own frame rate exactly
 * (RationalTime compares across rates), and frame-based rules use the video's rate.
 */
export const TYPED_TIME_RATE = FrameRate.of(1000);

/** A clock ("1:02.5") or a spoken time ("4 sec", "cuatro segundos") as a time; undefined if neither. */
function typedTime(text: string): RationalTime | undefined {
  const trimmed = text.trim();
  const clock = /^(?:(\d{1,2}):)?(\d{1,2}):([0-5]\d)(?:[.,](\d{1,3}))?$/.exec(trimmed);
  if (clock) {
    const [, hours = '0', minutes = '0', seconds = '0', fraction = ''] = clock;
    const whole = (Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds);
    return RationalTime.of(whole * 1000 + Number(fraction.padEnd(3, '0')), TYPED_TIME_RATE);
  }
  const spoken = new RegExp(`^(${NUMBER})\\s*${UNIT}$`, 'iu').exec(trimmed);
  const value = spoken?.[1] === undefined ? readNumber(trimmed) : readNumber(spoken[1]);
  return value === undefined ? undefined : RationalTime.fromSeconds(value, TYPED_TIME_RATE);
}

interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly target: ReferenceTarget;
}

function* matches(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  pattern.lastIndex = 0;
  for (let found = pattern.exec(text); found; found = pattern.exec(text)) yield found;
}

/** Each pattern's references, in priority order: a later one never takes words an earlier one took. */
function candidates(text: string): Candidate[] {
  const found: Candidate[] = [];
  const at = (m: RegExpExecArray, target: ReferenceTarget | undefined) => {
    if (target) found.push({ start: m.index, end: m.index + m[0].length, target });
  };
  for (const m of matches(PATTERNS.range, text)) {
    const [, from, first = '', join = '', second = ''] = m;
    // "3 to 5 seconds" alone is a length; a range needs "from"/"between", a clock, or Hindi's से.
    const isRange = from !== undefined || first.includes(':') || join === 'से';
    const start = typedTime(first);
    const end = typedTime(second);
    if (isRange && start && end && RationalTime.isAfter(end, start))
      at(m, { kind: 'range', range: TimeRange.fromStartEnd(start, end) });
  }
  for (const m of matches(PATTERNS.clock, text)) {
    const time = typedTime(m[0]);
    at(m, time ? { kind: 'time', at: time } : undefined);
  }
  for (const m of matches(PATTERNS.slotNumber, text)) {
    const index = readNumber(m[1] ?? '');
    at(m, index !== undefined && Number.isInteger(index) && index > 0 ? { kind: 'slot', index } : undefined);
  }
  for (const m of matches(PATTERNS.ordinal, text)) {
    const word = (m[1] ?? '').toLowerCase();
    const index = ORDINAL_WORDS[word] ?? Number.parseInt(word, 10);
    at(m, Number.isInteger(index) && index !== 0 ? { kind: 'slot', index } : undefined);
  }
  for (const m of matches(PATTERNS.hook, text)) at(m, { kind: 'slot', index: 1 });
  for (const pattern of [PATTERNS.spokenBefore, PATTERNS.spokenAfter, PATTERNS.prefixed]) {
    for (const m of matches(pattern, text)) {
      const time = typedTime(m[1] ?? '');
      at(m, time ? { kind: 'time', at: time } : undefined);
    }
  }
  return found;
}

const overlaps = (a: Candidate, b: Candidate) => a.start < b.end && b.start < a.end;

function wordAt(text: string, words: readonly string[]): RegExp {
  return new RegExp(`${START}(?:${alt(words)})${END}`, 'iu');
}

/** A transition word just before the reference, or (Hindi) just after it; never across another reference. */
function isCut(
  text: string,
  candidate: Candidate,
  previous: Candidate | undefined,
  next: Candidate | undefined,
) {
  if (candidate.target.kind === 'range') return false;
  const before = text.slice(Math.max(previous?.end ?? 0, candidate.start - 30), candidate.start);
  const after = text.slice(candidate.end, Math.min(next?.start ?? text.length, candidate.end + 12));
  const words = wordAt(text, TRANSITION_WORDS);
  return words.test(before) || words.test(after);
}

/**
 * Which video. A copy verb points at the template ("copy the cut at 0:04": copy it from there) unless the
 * user's own video is named too; words naming one video decide next; then edit verbs point at the timeline.
 * Anything else is unclear, and both are resolved.
 */
export function referenceBasis(message: string): ReferenceBasis {
  const has = (words: readonly string[]) => wordAt(message, words).test(message);
  const template = has(TEMPLATE_WORDS);
  const timeline = has(TIMELINE_WORDS);
  const copy = has(COPY_WORDS);
  if (copy) return timeline ? 'both' : 'template';
  if (template !== timeline) return template ? 'template' : 'timeline';
  if (template) return 'both';
  return has(EDIT_WORDS) ? 'timeline' : 'both';
}

export function parseReferences(message: string): ParsedReferences {
  const text = asciiDigits(message);
  const taken: Candidate[] = [];
  for (const candidate of candidates(text)) {
    if (!taken.some((other) => overlaps(candidate, other))) taken.push(candidate);
  }
  const ordered = taken.sort((a, b) => a.start - b.start);
  const references = ordered.slice(0, MAX_REFERENCES).map((candidate, i) => ({
    said: message.slice(candidate.start, candidate.end).trim().slice(0, MAX_SAID),
    span: { start: candidate.start, end: candidate.end },
    target: candidate.target,
    cut: isCut(text, candidate, ordered[i - 1], ordered[i + 1]),
  }));
  return { references, basis: references.length > 0 ? referenceBasis(text) : 'both' };
}
