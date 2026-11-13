// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * From words to cues (SPEC section 6). Words come from the transcripts in
 * source time; `captionWordsFromPlan` maps them through each clip onto the
 * render's frames. `buildCaptionCues` groups them: a cue ends at sentence
 * punctuation (¿ and ¡ open one), at a pause over 300 ms, at the style's
 * word limit, or when its shaped lines would exceed maxLines inside the safe
 * width; a cue shorter than ⌈0.6 · fps⌉ frames borrows from the gap after
 * it, else merges with a neighbour.
 */
import {
  newId,
  RationalTime,
  type AssetId,
  type CaptionCue,
  type CaptionCueId,
  type CaptionStyle,
  type CaptionWord,
  type FrameRate,
  type Rect,
  type Transcript,
} from '@taalcut/core';
import { outputFramesAt, sourceFramesAt, visualCurve } from '../plan/speed-curve';
import type { RenderPlan } from '../plan/types';
import type { TextMeasurer } from '../types';
import { layoutCue } from './layout';
import { endsSentence, opensSentence } from './text';

/** Longer silences than this end a cue. */
export const PAUSE_MS = 300;
/** The taste rule: a cue stays up at least this long. */
export const MIN_CUE_SECONDS = 0.6;

export interface BuildCuesOptions {
  readonly language: string;
  readonly rate: FrameRate;
  /** The render's length: the last cue may borrow up to here. Default: no borrowing past the last word. */
  readonly durationFrames?: number;
  readonly newCueId?: () => CaptionCueId;
}

interface FramedWord {
  readonly word: CaptionWord;
  readonly start: number;
  readonly end: number;
}

interface Group {
  words: FramedWord[];
  start: number;
  end: number;
}

export function minCueFrames(rate: FrameRate): number {
  return Math.ceil((MIN_CUE_SECONDS * rate.num) / rate.den - 1e-9);
}

const frameSpan = (start: number, end: number, rate: FrameRate) => ({
  start: RationalTime.of(start, rate),
  duration: RationalTime.of(end - start, rate),
});

const textOf = (words: readonly FramedWord[]) => words.map((framed) => framed.word.text).join(' ');

function framed(words: readonly CaptionWord[], rate: FrameRate): FramedWord[] {
  return words
    .map((word) => {
      const start = RationalTime.toFrames(word.range.start, rate);
      return { word, start, end: start + Math.max(1, RationalTime.toFrames(word.range.duration, rate)) };
    })
    .sort((a, b) => a.start - b.start);
}

function group(
  words: readonly FramedWord[],
  style: CaptionStyle,
  measurer: TextMeasurer,
  safe: Rect,
  options: BuildCuesOptions,
): Group[] {
  const pauseFrames = (PAUSE_MS / 1000) * (options.rate.num / options.rate.den);
  const groups: Group[] = [];
  let current: FramedWord[] = [];
  const close = () => {
    if (current.length === 0) return;
    groups.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end });
    current = [];
  };
  for (const word of words) {
    const previous = current[current.length - 1];
    if (previous) {
      const fits = () => {
        const layout = layoutCue(textOf([...current, word]), style, measurer, safe, options.language);
        return layout.lines.length <= style.maxLines;
      };
      if (
        opensSentence(word.word.text) ||
        word.start - previous.end > pauseFrames ||
        current.length >= style.maxWords ||
        !fits()
      )
        close();
    }
    current.push(word);
    if (endsSentence(word.word.text)) close();
  }
  close();
  return groups;
}

/** Short cues borrow from the gap after them, then merge with a neighbour, until every cue is long enough. */
function lengthen(groups: Group[], minFrames: number, durationFrames: number | undefined): Group[] {
  const result = groups.map((g) => ({ ...g, words: [...g.words] }));
  let index = 0;
  while (index < result.length) {
    const cue = result[index]!;
    const length = cue.end - cue.start;
    if (length >= minFrames) {
      index += 1;
      continue;
    }
    const next = result[index + 1];
    const limit = next ? next.start : (durationFrames ?? cue.end);
    cue.end = Math.min(cue.start + minFrames, Math.max(cue.end, limit));
    if (cue.end - cue.start >= minFrames || result.length === 1) {
      index += 1;
      continue;
    }
    if (next) {
      result.splice(index, 2, {
        words: [...cue.words, ...next.words],
        start: cue.start,
        end: Math.max(cue.end, next.end),
      });
    } else {
      const previous = result[index - 1]!;
      result.splice(index - 1, 2, {
        words: [...previous.words, ...cue.words],
        start: previous.start,
        end: cue.end,
      });
      index -= 1;
    }
  }
  return result;
}

export function buildCaptionCues(
  words: readonly CaptionWord[],
  style: CaptionStyle,
  measurer: TextMeasurer,
  safe: Rect,
  options: BuildCuesOptions,
): CaptionCue[] {
  const rate = options.rate;
  const groups = lengthen(
    group(framed(words, rate), style, measurer, safe, options),
    minCueFrames(rate),
    options.durationFrames,
  );
  const nextId = options.newCueId ?? (() => newId<'CaptionCue'>());
  return groups.map((cue) => ({
    id: nextId(),
    range: frameSpan(cue.start, cue.end, rate),
    words: cue.words.map((framedWord) => ({
      text: framedWord.word.text,
      range: frameSpan(framedWord.start, framedWord.end, rate),
      confidence: framedWord.word.confidence,
    })),
    edited: false,
  }));
}

/**
 * Transcript words (source time) as caption words on the render's frames: through each enabled, audible
 * V1 clip, between its cut and on its speed curve (the one its picture and sound follow). Words outside the part of the source a clip uses are
 * dropped; words of muted clips are skipped (nothing to caption).
 */
export function captionWordsFromPlan(
  plan: RenderPlan,
  transcripts: ReadonlyMap<AssetId, Transcript>,
): CaptionWord[] {
  const rate = plan.rate;
  const fps = rate.num / rate.den;
  const words: { text: string; start: number; end: number; confidence: number }[] = [];
  for (const visual of plan.speech ?? plan.visuals) {
    const transcript = transcripts.get(visual.assetId);
    if (!transcript || visual.holdFrame || visual.kind !== 'video' || !visual.enabled || visual.audio.muted)
      continue;
    const curve = visualCurve(visual, rate);
    const lead = curve.lead;
    const sourceStart = RationalTime.toSeconds(visual.sourceAtCut);
    const sourceEnd =
      sourceStart + (sourceFramesAt(curve, visual.cut.end - visual.visible.start) - lead) / fps;
    // Frames from the cut at which a source time shows; real time is the identity, exactly.
    const fromCut = (source: number) => (curve.ramp ? outputFramesAt(curve, lead + source) - lead : source);
    const toFrame = (sourceSeconds: number) =>
      visual.cut.start + Math.round(fromCut((sourceSeconds - sourceStart) * fps));
    for (const segment of transcript.segments) {
      for (const word of segment.words) {
        const start = RationalTime.toSeconds(word.range.start);
        const end = start + RationalTime.toSeconds(word.range.duration);
        if (start < sourceStart || start >= sourceEnd) continue;
        const startFrame = toFrame(start);
        const endFrame = Math.min(
          visual.cut.end,
          Math.max(startFrame + 1, toFrame(Math.min(end, sourceEnd))),
        );
        if (startFrame >= visual.cut.end) continue;
        words.push({
          text: word.text.trim(),
          start: startFrame,
          end: endFrame,
          confidence: word.confidence ?? 1,
        });
      }
    }
  }
  words.sort((a, b) => a.start - b.start);
  const result: CaptionWord[] = [];
  let previousEnd = 0;
  for (const word of words) {
    if (!word.text) continue;
    const start = Math.max(word.start, previousEnd);
    const end = Math.max(start + 1, word.end);
    if (start >= plan.durationFrames) continue;
    result.push({
      text: word.text.slice(0, 100),
      range: frameSpan(start, Math.min(end, plan.durationFrames), rate),
      confidence: word.confidence,
    });
    previousEnd = Math.min(end, plan.durationFrames);
  }
  return result;
}
