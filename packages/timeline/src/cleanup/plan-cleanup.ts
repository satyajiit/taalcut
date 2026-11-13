// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * planCleanup (P3-V9, pure): which parts of each talking clip go. A clip is cleaned when it is an enabled,
 * real-time video clip whose asset has a speech analysis with speech over at least half of it. Fillers go;
 * pauses longer than the threshold are shortened to `keepPauseMs` (not removed outright, so speech keeps its
 * breath); the earlier take of each retake goes (the last take stays); then the word guard keeps every word
 * whole. Punch-ins split the kept pieces. The plan names the new clips' ids, so redo makes the same document.
 */
import {
  err,
  FrameRate,
  ok,
  RationalTime,
  TimeRange,
  type AssetId,
  type CleanupPlan,
  type CleanupSettings,
  type Clip,
  type Result,
  type SpeechCleanupAnalysis,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { CleanupNoSpeech } from '../errors';
import { clipsFingerprint } from './clips-fingerprint';
import { positions, videoItems } from '../model/sequence';
import { complement, covered, type Interval } from '../model/intervals';
import { punchRanges, punchReframe, segments } from './punch-ins';
import { speechSpans, type SpeechSpans } from './speech-spans';
import { guardRemovals } from './word-guard';

/** The shortest removal and the shortest wordless piece, in canvas frames. */
export const MIN_CUT_FRAMES = 2;

type Stats = CleanupPlan['stats'];
type PlannedClip = CleanupPlan['clips'][number];

/** A span counts as gone when at least half of it is removed. */
const gone = (spans: readonly Interval[], removals: readonly Interval[]) =>
  spans.filter((span) => covered(span, removals) * 2 >= span.end - span.start).length;

/** Clip frames [start, end) as a source range, exact at the rate common to the media and the canvas. */
function sourceRange(clip: Clip, span: Interval, canvas: FrameRate) {
  const start = RationalTime.add(clip.sourceStart, RationalTime.of(span.start, canvas));
  return TimeRange.of(start, RationalTime.of(span.end - span.start, canvas));
}

function padFrames(clip: Clip, settings: CleanupSettings, canvas: FrameRate): number {
  const fps = FrameRate.toNumber(canvas);
  const media = clip.media.kind === 'video' ? clip.media.available.start.rate : canvas;
  // A piece's in-point is floored to a whole media frame when the rates differ: one more media frame of pad.
  const slack = FrameRate.equals(media, canvas) ? 0 : fps / FrameRate.toNumber(media);
  return (settings.padMs / 1000) * fps + slack;
}

function planClip(
  clip: Clip,
  spans: SpeechSpans,
  settings: CleanupSettings,
  canvas: FrameRate,
  ids: () => TimelineItemId,
): { readonly planned: PlannedClip; readonly stats: Stats } | null {
  const total = clip.duration.value;
  const fps = FrameRate.toNumber(canvas);
  const pad = padFrames(clip, settings, canvas);
  const removals = guardRemovals([...spans.fillers, ...spans.pauses, ...spans.retakes], spans.keptWords, total, {
    padFrames: pad,
    minFrames: MIN_CUT_FRAMES,
  });
  const pieces = complement(removals, total);
  if (pieces.length === 0) return null;
  const punches = settings.punchIns
    ? punchRanges(
        { emphasis: spans.emphasis, pieces, words: spans.keptWords, padFrames: pad, fps, minFrames: MIN_CUT_FRAMES },
        settings,
      )
    : [];
  if (removals.length === 0 && punches.length === 0) return null;
  const split = segments(pieces, punches);
  const removed = removals.reduce((sum, span) => sum + span.end - span.start, 0);
  return {
    planned: {
      clipId: clip.id,
      keep: pieces.map((piece) => sourceRange(clip, piece, canvas)),
      newIds: split.slice(1).map(() => ids()),
      punch: punches.map((punch) => ({ range: sourceRange(clip, punch, canvas), reframe: punchReframe(clip.reframe, settings) })),
    },
    stats: {
      fillers: gone(spans.fillers, removals),
      pauses: spans.pauses.filter((pause) => covered(pause, removals) >= MIN_CUT_FRAMES).length,
      retakes: gone(spans.retakes, removals),
      punchIns: punches.length,
      secondsSaved: removed / fps,
    },
  };
}

const plus = (a: Stats, b: Stats): Stats => ({
  fillers: a.fillers + b.fillers,
  pauses: a.pauses + b.pauses,
  retakes: a.retakes + b.retakes,
  punchIns: a.punchIns + b.punchIns,
  secondsSaved: a.secondsSaved + b.secondsSaved,
});

/** Clips that can be cleaned: enabled, real-time video. */
export function cleanableClips(timeline: Timeline): Clip[] {
  return positions(videoItems(timeline)).flatMap(({ item }) =>
    item.type === 'clip' && item.enabled && item.media.kind === 'video' && item.speed === null ? [item] : [],
  );
}

export function planCleanup(
  timeline: Timeline,
  analyses: ReadonlyMap<AssetId, SpeechCleanupAnalysis>,
  settings: CleanupSettings,
  ids: () => TimelineItemId,
): Result<CleanupPlan> {
  const canvas = timeline.canvas.rate;
  let stats: Stats = { fillers: 0, pauses: 0, retakes: 0, punchIns: 0, secondsSaved: 0 };
  let talking = 0;
  const clips: PlannedClip[] = [];
  for (const clip of cleanableClips(timeline)) {
    const analysis = analyses.get(clip.media.assetId);
    if (!analysis) continue;
    const spans = speechSpans(analysis, { sourceStart: clip.sourceStart, frames: clip.duration.value, canvas }, settings);
    if (spans.speechFrames * 2 < clip.duration.value) continue;
    talking++;
    const planned = planClip(clip, spans, settings, canvas, ids);
    if (!planned) continue;
    clips.push(planned.planned);
    stats = plus(stats, planned.stats);
  }
  if (talking === 0) return err(CleanupNoSpeech());
  const fingerprint = clipsFingerprint(timeline, clips.map((planned) => planned.clipId));
  return ok({
    timelineId: timeline.id,
    revision: timeline.revision,
    ...(fingerprint ? { clipsFingerprint: fingerprint } : {}),
    clips,
    stats,
  });
}
