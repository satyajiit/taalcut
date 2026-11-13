// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  ok,
  RationalTime,
  ValidationError,
  type CaptionCue,
  type CaptionCueId,
  type Timeline,
} from '@taalcut/core';

/** Literal replacement only: a search string never becomes an executable regular expression. */
function replace(text: string, find: string, replacement: string, matchCase: boolean) {
  const pattern = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let count = 0;
  const result = text.replace(new RegExp(pattern, matchCase ? 'gu' : 'giu'), () => {
    count += 1;
    return replacement;
  });
  return { text: result.trim(), count };
}

/** Changed display words keep the cue's original interval. Recorded speech and media timing stay untouched. */
function wordsFor(cue: CaptionCue, text: string): CaptionCue['words'] | null {
  const tokens = text.split(/\s+/u).filter(Boolean);
  if (
    tokens.length > 40 ||
    tokens.some((token) => token.length > 100) ||
    tokens.length > cue.range.duration.value
  )
    return null;
  const frames = cue.range.duration.value;
  const rate = cue.range.start.rate;
  return tokens.map((word, index) => {
    const start = Math.floor((index * frames) / tokens.length);
    const end = Math.floor(((index + 1) * frames) / tokens.length);
    return {
      text: word,
      confidence: 1,
      range: {
        start: RationalTime.of(cue.range.start.value + start, rate),
        duration: RationalTime.of(end - start, rate),
      },
    };
  });
}

export function replaceCaptions(
  timeline: Timeline,
  input: { find: string; replacement: string; matchCase: boolean; cueIds?: readonly CaptionCueId[] },
) {
  const captions = timeline.captions;
  if (!captions)
    return err(ValidationError({ field: 'captions' }, { detail: 'There are no captions to replace' }));
  const targets = input.cueIds ? new Set(input.cueIds) : null;
  if (targets && [...targets].some((id) => !captions.cues.some((cue) => cue.id === id)))
    return err(ValidationError({ field: 'cueIds' }, { detail: 'A selected caption no longer exists' }));
  const cues: CaptionCue[] = [];
  let replacements = 0;
  for (const cue of captions.cues) {
    const changed =
      targets && !targets.has(cue.id)
        ? { text: '', count: 0 }
        : replace(
            cue.words.map((word) => word.text).join(' '),
            input.find,
            input.replacement,
            input.matchCase,
          );
    if (!changed.count) {
      cues.push(cue);
      continue;
    }
    const words = changed.text ? wordsFor(cue, changed.text) : [];
    if (!words)
      return err(
        ValidationError({ field: 'replacement' }, { detail: 'The replacement is too long for this caption' }),
      );
    replacements += changed.count;
    if (words.length) cues.push({ ...cue, words, edited: true });
  }
  return ok({
    timeline: { ...timeline, captions: { ...captions, cues } },
    changed: replacements ? (['captions'] as const) : [],
    replacements,
  });
}
