// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * When a graphic plays (SPEC P3.4, "Timed to speech"): its anchor (a phrase someone says, a slot, a time) as a
 * frame, the graphic starting 6 frames before the phrase's first word. A phrase that isn't said falls back to where
 * the graphic was and is reported in `unmatched`, which is how the agent tells the person what it couldn't find.
 * HFW1 retire: the kit's list items, each on its own phrase, are gone. Pure; frames are the render's.
 */
import {
  RationalTime,
  type AssetId,
  type FrameRate,
  type GraphicAnchor,
  type Timeline,
  type Transcript,
} from '@taalcut/core';
import { captionWordsFromPlan } from '../captions/cues';
import type { RenderPlan } from '../plan/types';
import { toFrame } from '../time/frames';
import { findPhrase, type TimedWord } from './phrase-match';

/** The graphic starts this many frames before the phrase's first word, so it is up as the word lands. */
export const LEAD_FRAMES = 6;

export interface TimingContext {
  /** The spoken words on the render's frames, in order. */
  readonly words: readonly TimedWord[];
  readonly language: string;
  /** Each slot's first frame on V1. */
  readonly slots: ReadonlyMap<string, number>;
  readonly rate: FrameRate;
  /** The timeline's length (V1): a graphic never runs past it. */
  readonly durationFrames: number;
}

export interface TimingRequest {
  readonly anchor: GraphicAnchor;
  /** The graphic's length in frames. */
  readonly frames: number;
  /** Where the graphic goes when its own anchor isn't found (its stored start, or 0 for a new one). */
  readonly fallbackStart: number;
}

export interface ResolvedTiming {
  readonly start: number;
  readonly end: number;
  /** Phrases (or slot ids) not found. */
  readonly unmatched: readonly string[];
  /** Whether the graphic's own anchor was found. */
  readonly matched: boolean;
}

/** The caption track's words on the timeline's frames (empty without captions). */
export function captionWords(timeline: Timeline): TimedWord[] {
  const rate = timeline.canvas.rate;
  return (timeline.captions?.cues ?? [])
    .flatMap((cue) =>
      cue.words.map((word) => {
        const start = RationalTime.toFrames(word.range.start, rate);
        return { text: word.text, start, end: start + RationalTime.toFrames(word.range.duration, rate) };
      }),
    )
    .sort((a, b) => a.start - b.start);
}

/** Transcript words mapped through the clips (what captions would say), for timelines without captions. */
export function transcriptWords(
  plan: RenderPlan,
  transcripts: ReadonlyMap<AssetId, Transcript>,
): TimedWord[] {
  return captionWordsFromPlan(plan, transcripts).map((word) => {
    const start = RationalTime.toFrames(word.range.start, plan.rate);
    return { text: word.text, start, end: start + RationalTime.toFrames(word.range.duration, plan.rate) };
  });
}

/** The timeline's length in frames (V1's clips and gaps). */
export function timelineFrames(timeline: Timeline): number {
  const track = timeline.tracks[0];
  if (track?.kind !== 'video') return 0;
  return track.items.reduce(
    (total, item) =>
      item.type === 'transition' ? total : total + toFrame(item.duration, timeline.canvas.rate),
    0,
  );
}

/** Each slot's first frame on V1 (clips and gaps carry their slot). */
export function slotStarts(timeline: Timeline): Map<string, number> {
  const rate = timeline.canvas.rate;
  const starts = new Map<string, number>();
  const track = timeline.tracks[0];
  if (track?.kind !== 'video') return starts;
  let at = 0;
  for (const item of track.items) {
    if (item.type === 'transition') continue;
    if (item.slotId && !starts.has(item.slotId)) starts.set(item.slotId, at);
    at += toFrame(item.duration, rate);
  }
  return starts;
}

/** An anchor's frame (lead not yet applied for phrases: `word` is the phrase's first word's start). */
function anchorAt(
  anchor: GraphicAnchor,
  context: TimingContext,
): { readonly frame: number; readonly phrase: boolean } | { readonly unmatched: string } {
  switch (anchor.kind) {
    case 'phrase': {
      const found = findPhrase(context.words, anchor.text, anchor.occurrence, context.language);
      const word = found ? context.words[found.first] : undefined;
      return word ? { frame: word.start, phrase: true } : { unmatched: anchor.text };
    }
    case 'slot': {
      const frame = context.slots.get(anchor.slotId);
      return frame === undefined ? { unmatched: anchor.slotId } : { frame, phrase: false };
    }
    case 'time':
      return { frame: RationalTime.toFrames(anchor.at, context.rate, 'round'), phrase: false };
  }
}

export function resolveTiming(request: TimingRequest, context: TimingContext): ResolvedTiming {
  const unmatched: string[] = [];
  const own = anchorAt(request.anchor, context);
  let start: number;
  if ('unmatched' in own) {
    unmatched.push(own.unmatched);
    start = request.fallbackStart;
  } else start = own.phrase ? own.frame - LEAD_FRAMES : own.frame;
  const length = Math.max(1, Math.min(request.frames, context.durationFrames));
  start = Math.max(0, Math.min(start, context.durationFrames - length));
  return { start, end: start + length, unmatched, matched: !('unmatched' in own) };
}
