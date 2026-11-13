// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A provider's character timings → words (SPEC P3.3 "Alignment to words"), pure. This is the provider edge: the
 * float seconds ElevenLabs returns become RationalTime here, on the 48 kHz clock every voice line file is decoded
 * at, and nothing after it does float time. Characters are grouped with Intl.Segmenter in the line's language, so
 * a Devanagari or accented word stays whole; audio tags such as [whispers] are dropped. The first word's start is
 * the line's onset: the provider's leading silence comes before it.
 */
import { FrameRate, RationalTime, TimeRange, type CharacterAlignment, type Transcript } from '@taalcut/core';
import { MILLISECONDS } from '../rates';

/** Voice line files are decoded and measured at this rate; their times are samples of it. */
export const LINE_RATE = FrameRate.of(48_000, 1);

export interface AlignedWord {
  readonly text: string;
  /** On the line file's clock (LINE_RATE). */
  readonly range: TimeRange;
}

export interface AlignedLine {
  readonly words: readonly AlignedWord[];
  /** The first word's start: what lands on the beat. */
  readonly onset: RationalTime;
  /** The last word's end. */
  readonly speechEnd: RationalTime;
}

/** Character indices inside [audio tags], which aren't spoken. */
function taggedIndices(text: string): Set<number> {
  const hidden = new Set<number>();
  for (const match of text.matchAll(/\[[^\]]*\]/g)) {
    const start = match.index ?? 0;
    for (let i = start; i < start + match[0].length; i++) hidden.add(i);
  }
  return hidden;
}

const at = (seconds: number) => RationalTime.fromSeconds(Math.max(0, seconds), LINE_RATE);

export function alignWords(alignment: CharacterAlignment, language: string): AlignedLine {
  // Code units → character index, since a character entry may be more than one UTF-16 unit.
  const owner: number[] = [];
  alignment.characters.forEach((c, index) => {
    for (let k = 0; k < c.length; k++) owner.push(index);
  });
  const text = alignment.characters.join('');
  const hidden = taggedIndices(text);
  const words: AlignedWord[] = [];
  const segmenter = new Intl.Segmenter(language, { granularity: 'word' });
  for (const segment of segmenter.segment(text)) {
    if (!segment.isWordLike || hidden.has(segment.index)) continue;
    const first = owner[segment.index];
    const last = owner[segment.index + segment.segment.length - 1];
    if (first === undefined || last === undefined) continue;
    const start = at(alignment.startSeconds[first] ?? 0);
    const end = RationalTime.max(
      at(alignment.endSeconds[last] ?? 0),
      RationalTime.add(start, RationalTime.of(1, LINE_RATE)),
    );
    words.push({
      text: segment.segment.normalize('NFC'),
      range: TimeRange.of(start, RationalTime.subtract(end, start)),
    });
  }
  const first = words[0];
  const last = words.at(-1);
  return {
    words,
    onset: first ? first.range.start : RationalTime.zero(LINE_RATE),
    speechEnd: last ? TimeRange.end(last.range) : RationalTime.zero(LINE_RATE),
  };
}

/** The line as a file compressed to `ratio` of its length says it: every time scaled, on the same clock. */
export function scaleAlignedLine(line: AlignedLine, ratio: number): AlignedLine {
  const scale = (t: RationalTime) => RationalTime.of(Math.round(t.value * ratio), t.rate);
  return {
    words: line.words.map((word) => ({
      text: word.text,
      range: TimeRange.of(scale(word.range.start), scale(word.range.duration)),
    })),
    onset: scale(line.onset),
    speechEnd: scale(line.speechEnd),
  };
}

/** The line's words as the asset's transcript (engine 'tts', confidence 1), on the transcript's ms clock. */
export function ttsTranscript(line: AlignedLine, language: string, model: string): Transcript {
  const ms = (range: TimeRange) =>
    TimeRange.of(
      RationalTime.rescale(range.start, MILLISECONDS),
      RationalTime.rescale(range.duration, MILLISECONDS),
    );
  const whole = TimeRange.of(line.onset, RationalTime.subtract(line.speechEnd, line.onset));
  return {
    version: 1,
    language,
    engine: 'tts',
    model,
    local: false,
    wordTiming: 'native',
    segments: line.words.length
      ? [
          {
            text: line.words.map((w) => w.text).join(' '),
            range: ms(whole),
            language,
            words: line.words.map((w) => ({ text: w.text, range: ms(w.range), confidence: 1 })),
          },
        ]
      : [],
  };
}
