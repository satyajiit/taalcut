// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `captions.applyTranslation` (P3-V20, SPEC P3.9; audio SPEC P3.11): every cue of the track gets its text in
 * another language, exactly once. The cue keeps its place; its words are split with `Intl.Segmenter` for the
 * new language and timed by their share of the graphemes, at least 120 ms each where the cue has room, on
 * whole frames, as `captions.editText` times typed words. Cues become `edited` (a rebuild keeps them), the
 * track's language changes, and a style font that can't draw the new script gives way to the curated font of
 * the same category that can. A cue translated to nothing is dropped, as `captions.editText` deletes an emptied
 * cue. The inverse is `captions.restore` with the previous track.
 */
import {
  CAPTION_COMMANDS,
  captionCommandPayloads,
  ConflictError,
  defineCommand,
  err,
  ok,
  RationalTime,
  ValidationError,
  type AsyncResult,
  type CaptionCue,
  type CaptionTrack,
  type CommandContext,
  type CommandOutcome,
  type FrameRate,
  type ProjectId,
  type Result,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { TranslationMismatch } from '../errors-phase3';
import { FONT_CATEGORY } from './fonts';
import { coversScript, fontFor, scriptOf } from './style';
import { breakUnits, graphemes } from './text';

/** The shortest a translated word may show, when the cue has room for every word at it. */
export const MIN_WORD_MS = 120;
/** core's captionCueSchema: at most 40 words a cue, 100 characters a word. */
const MAX_WORDS = 40;
const MAX_WORD_CHARS = 100;

/**
 * Words shared over the cue's frames by grapheme count, each at least `minFrames` (fewer when the cue is too
 * short for that), the last taking the rest. More words than frames join the last word.
 */
export function timeCueWords(
  cue: Pick<CaptionCue, 'range'>,
  given: readonly string[],
  rate: FrameRate,
  minFrames = 1,
): CaptionCue['words'] {
  const frames = RationalTime.toFrames(cue.range.duration, rate);
  const start = RationalTime.toFrames(cue.range.start, rate);
  const words =
    given.length > frames ? [...given.slice(0, frames - 1), given.slice(frames - 1).join(' ')] : [...given];
  const least = Math.max(1, Math.min(minFrames, Math.floor(frames / Math.max(1, words.length))));
  const weights = words.map((word) => graphemes(word).length);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cumulative = 0;
  let previous = 0;
  return words.map((word, index) => {
    cumulative += weights[index] ?? 0;
    const last = index === words.length - 1;
    const ideal = Math.round((frames * cumulative) / total);
    const end = last
      ? frames
      : Math.min(frames - (words.length - index - 1) * least, Math.max(previous + least, ideal));
    const range = {
      start: RationalTime.of(start + previous, rate),
      duration: RationalTime.of(end - previous, rate),
    };
    previous = end;
    return { text: word.slice(0, MAX_WORD_CHARS), range, confidence: 1 };
  });
}

/** A cue's words in a language: Intl.Segmenter's words with the punctuation around them kept on. */
export function translationWords(text: string, language: string): string[] {
  return breakUnits(text.trim(), language)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
}

/** The frames 120 ms covers at the timeline's rate. */
const minWordFrames = (rate: FrameRate) => Math.ceil((MIN_WORD_MS / 1000) * (rate.num / rate.den));

/** The track in `language` with every cue's new text; a mismatch of cue ids is refused whole. */
export function translateTrack(
  track: CaptionTrack,
  input: {
    readonly language: string;
    readonly cues: readonly { readonly cueId: string; readonly text: string }[];
  },
  rate: FrameRate,
): Result<CaptionTrack> {
  const texts = new Map<string, string>();
  let extra = 0;
  for (const cue of input.cues) {
    if (texts.has(cue.cueId) || !track.cues.some((candidate) => candidate.id === cue.cueId)) extra++;
    else texts.set(cue.cueId, cue.text);
  }
  const missing = track.cues.filter((cue) => !texts.has(cue.id)).length;
  if (missing > 0 || extra > 0) return err(TranslationMismatch({ missing, extra }));
  const minFrames = minWordFrames(rate);
  const cues: CaptionCue[] = [];
  for (const cue of track.cues) {
    const words = translationWords(texts.get(cue.id) ?? '', input.language);
    // An empty translation drops the cue, as captions.editText deletes an emptied one (contract P3-3).
    if (words.length === 0) continue;
    if (words.length > MAX_WORDS)
      return err(ValidationError({ field: 'cues' }, { detail: `A cue has at most ${MAX_WORDS} words` }));
    cues.push({ ...cue, words: timeCueWords(cue, words, rate, minFrames), edited: true });
  }
  const script = scriptOf(input.language);
  const font = coversScript(track.style.font, script)
    ? track.style.font
    : fontFor(FONT_CATEGORY[track.style.font], script);
  return ok({ ...track, language: input.language, style: { ...track.style, font }, cues });
}

/** Writes a caption track as a new timeline revision with `captions.restore` as its inverse (commands.ts). */
export type WriteCaptions<R> = (
  projectId: ProjectId,
  timelineId: TimelineId,
  context: CommandContext,
  next: (timeline: Timeline) => AsyncResult<CaptionTrack | null>,
) => AsyncResult<CommandOutcome<R>>;

export function applyTranslationCommand<R>(write: WriteCaptions<R>) {
  return defineCommand({
    name: CAPTION_COMMANDS.applyTranslation,
    payload: captionCommandPayloads[CAPTION_COMMANDS.applyTranslation],
    sideEffect: 'write',
    handle: ({ projectId, timelineId, revision, language, cues }, context) =>
      write(projectId, timelineId, context, async (timeline) => {
        // A redo replays the original payload, whose `revision` is the one the translation was made from; the
        // undo has moved the timeline on since, so the bus's redo (also after a restart) skips that guard.
        if (revision !== undefined && revision !== timeline.revision && context.replay !== 'redo')
          return err(ConflictError({ entity: 'timeline', id: timeline.id }));
        if (!timeline.captions)
          return err(ValidationError({ field: 'timelineId' }, { detail: 'No captions to translate' }));
        return translateTrack(timeline.captions, { language, cues }, timeline.canvas.rate);
      }),
  });
}
