// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Caption cues → translation units (SPEC P3.11 step 1): sentences, so the model translates whole thoughts. A unit
 * ends after a cue whose last word ends a sentence (. ? ! । ॥, closing quotes allowed after), before a pause of
 * 600 ms or more, or at three cues. Units go out in batches of core's TRANSLATION_LIMITS.units, each batch with
 * the previous one's last units as untranslated context.
 */
import {
  RationalTime,
  TimeRange,
  TRANSLATION_LIMITS,
  type CaptionCue,
  type TranslationUnit,
} from '@taalcut/core';
import { TRANSLATE_CONFIG } from './config';

export interface SourceUnit {
  /** `u<index>`: what the translator must give back once. */
  readonly id: string;
  /** In timeline order. */
  readonly cues: readonly CaptionCue[];
  /** The cues' words, spaced. Untrusted: what someone said. */
  readonly text: string;
}

export interface UnitBatch {
  readonly units: readonly TranslationUnit[];
  /** The previous batch's last units, for context; not translated. */
  readonly context: readonly TranslationUnit[];
}

const SENTENCE_END = /[.?!।॥]["'”’»)\]]*$/u;

export const cueText = (cue: CaptionCue): string => cue.words.map((word) => word.text).join(' ');

const ms = (time: RationalTime) => RationalTime.toSeconds(time) * 1000;

/** Milliseconds from the end of `a` to the start of `b`. */
const gapMs = (a: CaptionCue, b: CaptionCue) => ms(b.range.start) - ms(TimeRange.end(a.range));

function endsUnit(cue: CaptionCue, next: CaptionCue | undefined, size: number): boolean {
  if (!next || size >= TRANSLATE_CONFIG.maxCuesPerUnit) return true;
  const last = cue.words.at(-1)?.text ?? '';
  return SENTENCE_END.test(last.trim()) || gapMs(cue, next) >= TRANSLATE_CONFIG.pauseMs;
}

/** The cues, in timeline order, grouped into sentence units. */
export function captionUnits(cues: readonly CaptionCue[]): SourceUnit[] {
  const ordered = [...cues].sort((a, b) => RationalTime.compare(a.range.start, b.range.start));
  const units: SourceUnit[] = [];
  let current: CaptionCue[] = [];
  for (const [index, cue] of ordered.entries()) {
    current.push(cue);
    if (!endsUnit(cue, ordered[index + 1], current.length)) continue;
    units.push({ id: `u${units.length}`, cues: current, text: current.map(cueText).join(' ') });
    current = [];
  }
  return units;
}

const asUnit = (unit: Pick<SourceUnit, 'id' | 'text'>): TranslationUnit => ({ id: unit.id, text: unit.text });

/** Batches of at most `TRANSLATION_LIMITS.units`, each carrying the previous batch's last units as context. */
export function unitBatches(
  units: readonly Pick<SourceUnit, 'id' | 'text'>[],
  size: number = TRANSLATION_LIMITS.units,
): UnitBatch[] {
  const batches: UnitBatch[] = [];
  for (let start = 0; start < units.length; start += size) {
    const context = units.slice(Math.max(0, start - TRANSLATION_LIMITS.context), start);
    batches.push({ units: units.slice(start, start + size).map(asUnit), context: context.map(asUnit) });
  }
  return batches;
}
