// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timelines.planCleanup, as @taalcut/timeline's planCleanup answers it (P3-V9, reads only): which parts of each
 * talking clip go. A clip is cleaned when it is an enabled, real-time video clip whose asset has a speech
 * analysis with speech over at least half of it; none: timeline.cleanup_no_speech. The plan carries the
 * planned clips' fingerprint (contract round P3-3 §10), so applyCleanup knows an unrelated edit from a stale plan.
 */
import {
  CLEANUP_SETTING,
  cleanupSettingsSchema,
  coveredFrames as covered,
  err,
  ok,
  RationalTime,
  TimeRange,
  ValidationError,
  type CleanupPlan,
  type CleanupSettings,
  type Clip,
  type FrameRate,
  type Result,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { timelineError } from '../../edits';
import { speechOf } from './speech';
import {
  complement,
  guardRemovals,
  punchRanges,
  punchReframe,
  segments,
  speechSpans,
  type Interval,
  type SpeechSpans,
} from './spans';

/** The shortest removal and the shortest wordless piece, in canvas frames. */
const MIN_CUT_FRAMES = 2;

type Stats = CleanupPlan['stats'];
type PlannedClip = CleanupPlan['clips'][number];

/** A span counts as gone when at least half of it is removed. */
const gone = (spans: readonly Interval[], removals: readonly Interval[]) =>
  spans.filter((span) => covered(span, removals) * 2 >= span.end - span.start).length;

function sourceRange(clip: Clip, span: Interval, canvas: FrameRate) {
  const start = RationalTime.add(clip.sourceStart, RationalTime.of(span.start, canvas));
  return TimeRange.of(start, RationalTime.of(span.end - span.start, canvas));
}

/** Clips that can be cleaned: enabled, real-time video, in timeline order. */
export function cleanableClips(timeline: Timeline): Clip[] {
  const video = timeline.tracks[0];
  return (video?.kind === 'video' ? video.items : []).flatMap((item) =>
    item.type === 'clip' && item.enabled && item.media.kind === 'video' && item.speed === null ? [item] : [],
  );
}

/** Whether the timeline has a clip with speech over half of it: the dock's Clean up shows for it. */
export function hasSpeech(timeline: Timeline): boolean {
  return cleanableClips(timeline).some((clip) => speechOf(clip.media.assetId) !== null);
}

function planClip(
  clip: Clip,
  spans: SpeechSpans,
  settings: CleanupSettings,
  canvas: FrameRate,
  ids: () => TimelineItemId,
) {
  const total = clip.duration.value;
  const fps = canvas.num / canvas.den;
  const pad = (settings.padMs / 1000) * fps;
  const removals = guardRemovals(
    [...spans.fillers, ...spans.pauses, ...spans.retakes],
    spans.keptWords,
    total,
    {
      padFrames: pad,
      minFrames: MIN_CUT_FRAMES,
    },
  );
  const pieces = complement(removals, total);
  if (pieces.length === 0) return null;
  const punches = settings.punchIns
    ? punchRanges(
        {
          emphasis: spans.emphasis,
          pieces,
          words: spans.keptWords,
          padFrames: pad,
          fps,
          minFrames: MIN_CUT_FRAMES,
        },
        settings,
      )
    : [];
  if (removals.length === 0 && punches.length === 0) return null;
  const split = segments(pieces, punches);
  const removed = removals.reduce((sum, span) => sum + span.end - span.start, 0);
  const planned: PlannedClip = {
    clipId: clip.id,
    keep: pieces.map((piece) => sourceRange(clip, piece, canvas)),
    newIds: split.slice(1).map(() => ids()),
    punch: punches.map((punch) => ({
      range: sourceRange(clip, punch, canvas),
      reframe: punchReframe(clip.reframe, settings),
    })),
  };
  const stats: Stats = {
    fillers: gone(spans.fillers, removals),
    pauses: spans.pauses.filter((pause) => covered(pause, removals) >= MIN_CUT_FRAMES).length,
    retakes: gone(spans.retakes, removals),
    punchIns: punches.length,
    secondsSaved: removed / fps,
  };
  return { planned, stats };
}

/**
 * sha256 (lowercase hex) of the canonical JSON of the planned clips as they are now (id, asset, shot,
 * sourceStart, duration, enabled, speed), in timeline order; one helper for planning and applying.
 */
export async function clipsFingerprint(timeline: Timeline, clipIds: ReadonlySet<string>): Promise<string> {
  const clips = cleanableClips(timeline)
    .filter((clip) => clipIds.has(clip.id))
    .map((clip) => ({
      asset: clip.media.assetId,
      duration: clip.duration,
      enabled: clip.enabled,
      id: clip.id,
      shot: clip.media.kind === 'video' ? clip.media.shotId : null,
      sourceStart: clip.sourceStart,
      speed: clip.speed,
    }));
  const canonical = JSON.stringify(clips, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function planCleanup(
  timeline: Timeline,
  changes: Partial<CleanupSettings> | undefined,
  ids: () => TimelineItemId,
): Promise<Result<CleanupPlan>> {
  const merged = cleanupSettingsSchema.safeParse({ ...CLEANUP_SETTING.defaultValue, ...changes });
  if (!merged.success)
    return err(ValidationError({ field: 'settings' }, { detail: merged.error.issues[0]?.message ?? '' }));
  const settings = merged.data;
  const canvas = timeline.canvas.rate;
  let stats: Stats = { fillers: 0, pauses: 0, retakes: 0, punchIns: 0, secondsSaved: 0 };
  let talking = 0;
  const clips: PlannedClip[] = [];
  for (const clip of cleanableClips(timeline)) {
    const analysis = speechOf(clip.media.assetId);
    if (!analysis) continue;
    const spans = speechSpans(
      analysis,
      { sourceStart: clip.sourceStart, frames: clip.duration.value, canvas },
      settings,
    );
    if (spans.speechFrames * 2 < clip.duration.value) continue;
    talking++;
    const planned = planClip(clip, spans, settings, canvas, ids);
    if (!planned) continue;
    clips.push(planned.planned);
    stats = {
      fillers: stats.fillers + planned.stats.fillers,
      pauses: stats.pauses + planned.stats.pauses,
      retakes: stats.retakes + planned.stats.retakes,
      punchIns: stats.punchIns + planned.stats.punchIns,
      secondsSaved: stats.secondsSaved + planned.stats.secondsSaved,
    };
  }
  if (talking === 0) return err(timelineError('timeline.cleanup_no_speech'));
  const clipsFingerprintHex = await clipsFingerprint(timeline, new Set(clips.map((clip) => clip.clipId)));
  return ok({
    timelineId: timeline.id,
    revision: timeline.revision,
    clipsFingerprint: clipsFingerprintHex,
    clips,
    stats,
  });
}
