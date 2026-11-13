// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type CharacterAlignment,
  type CreationDraft,
  type Result,
} from '@taalcut/core';

export interface CreationVoiceTiming {
  readonly beatId: string;
  readonly sourceStartMs: number;
  readonly durationMs: number;
}

export function creationNarration(draft: CreationDraft): Result<string> {
  if (!draft.beats.length || draft.beats.some((beat) => !beat.narration.trim()))
    return err(
      ValidationError(
        { field: 'narration' },
        { detail: 'Add narration to every beat, or choose an uploaded recording or no voice.' },
      ),
    );
  const text = draft.beats.map((beat) => beat.narration.trim()).join('\n');
  return text.length <= 5000
    ? ok(text)
    : err(
        ValidationError(
          { field: 'narration' },
          { detail: 'A continuous voiceover requires 1–5,000 characters.' },
        ),
      );
}

const invalidAlignment = (detail: string) => err(ValidationError({ field: 'voice.alignment' }, { detail }));

interface Character {
  readonly value: string;
  readonly offset: number;
}

/** Compare spoken content exactly, allowing providers to normalize only whitespace. */
function canonicalCharacters(text: string): Character[] {
  const result: Character[] = [];
  let offset = 0;
  for (const value of text) {
    const whitespace = /\s/u.test(value);
    if (!whitespace || (result.length && result.at(-1)!.value !== ' '))
      result.push({ value: whitespace ? ' ' : value, offset });
    offset += value.length;
  }
  if (result.at(-1)?.value === ' ') result.pop();
  return result;
}

/** Provider entries can be code points, UTF-16 units or chunks; their indices are not text offsets. */
export function alignCreationVoice(
  draft: CreationDraft,
  text: string,
  alignment: CharacterAlignment,
): Result<readonly CreationVoiceTiming[]> {
  const { characters, startSeconds, endSeconds } = alignment;
  if (
    !characters.length ||
    characters.some((character) => !character.length) ||
    startSeconds.length !== characters.length ||
    endSeconds.length !== characters.length
  )
    return invalidAlignment('The voice provider returned incomplete character alignment.');
  for (let index = 0; index < characters.length; index++) {
    const start = startSeconds[index]!;
    const end = endSeconds[index]!;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      (index > 0 && (start < startSeconds[index - 1]! || end < endSeconds[index - 1]!))
    )
      return invalidAlignment('The voice provider returned invalid or non-monotonic character timings.');
  }
  const expected = canonicalCharacters(text);
  const actual = canonicalCharacters(characters.join(''));
  if (
    expected.length !== actual.length ||
    expected.some((character, index) => character.value !== actual[index]!.value)
  )
    return invalidAlignment('The voice provider alignment does not match the approved narration.');
  const entryAtOffset = characters.flatMap((character, index) => Array<number>(character.length).fill(index));
  let offset = 0;
  const starts: number[] = [];
  for (const [index, beat] of draft.beats.entries()) {
    const boundary = expected.findIndex((character) => character.offset === offset);
    if (boundary < 0) return invalidAlignment('A narration beat has no aligned text.');
    const entry = entryAtOffset[actual[boundary]!.offset]!;
    if (index > 0 && entry === entryAtOffset[actual[boundary - 1]!.offset])
      return invalidAlignment('The voice provider grouped text across a beat boundary.');
    starts.push(index === 0 ? 0 : Math.round(startSeconds[entry]! * 1000));
    offset += beat.narration.trim().length + 1;
  }
  const end = Math.ceil(endSeconds.at(-1)! * 1000);
  if (
    !starts.length ||
    !Number.isSafeInteger(end) ||
    starts.some((start, index) => !Number.isSafeInteger(start) || (starts[index + 1] ?? end) <= start)
  )
    return invalidAlignment('The voice provider did not give each narration beat a positive duration.');
  return ok(
    draft.beats.map((beat, index) => ({
      beatId: beat.id,
      sourceStartMs: starts[index]!,
      durationMs: (starts[index + 1] ?? end) - starts[index]!,
    })),
  );
}

/** Uploaded audio has no provider alignment: keep its duration and allocate editable beat seams by draft weight. */
export function proportionalVoiceTiming(
  draft: CreationDraft,
  measuredDurationMs: number,
): Result<readonly CreationVoiceTiming[]> {
  const durationMs = Math.round(measuredDurationMs);
  const weights = draft.beats.map((beat) => RationalTime.toSeconds(beat.duration));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (
    !weights.length ||
    !Number.isSafeInteger(durationMs) ||
    durationMs < weights.length ||
    !Number.isFinite(total) ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  )
    return err(
      ValidationError(
        { field: 'voice.assetId' },
        { detail: 'The recording and draft beats need positive measured durations.' },
      ),
    );
  let start = 0;
  let cumulative = 0;
  return ok(
    draft.beats.map((beat, index) => {
      cumulative += weights[index]!;
      const remaining = weights.length - index - 1;
      const end = Math.min(
        durationMs - remaining,
        Math.max(start + 1, Math.round((durationMs * cumulative) / total)),
      );
      const line = { beatId: beat.id, sourceStartMs: start, durationMs: end - start };
      start = end;
      return line;
    }),
  );
}
