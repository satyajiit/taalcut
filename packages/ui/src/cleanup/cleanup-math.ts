// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a cleanup plan cuts, on the timeline it was planned on (P3-V9): each planned clip's kept source ranges
 * as the clip's frames, what lies between them removed, and where the punch-ins play, all in the timeline's
 * canvas frames. The card's strip and the editor's bed draw them; nothing here changes the timeline.
 */
import type { CleanupPlan, Timeline } from '@taalcut/core';

export interface FrameSpanView {
  readonly start: number;
  readonly end: number;
}

export interface CleanupMarks {
  /** Spans the plan removes. */
  readonly removed: readonly FrameSpanView[];
  /** Spans that play punched in. */
  readonly punches: readonly FrameSpanView[];
  /** The timeline's length before the cleanup. */
  readonly total: number;
}

const seconds = (time: {
  readonly value: number;
  readonly rate: { readonly num: number; readonly den: number };
}) => (time.value * time.rate.den) / time.rate.num;

/** [0, total) without the kept spans. */
function between(kept: readonly FrameSpanView[], total: number): FrameSpanView[] {
  const out: FrameSpanView[] = [];
  let at = 0;
  for (const span of [...kept].sort((a, b) => a.start - b.start)) {
    if (span.start > at) out.push({ start: at, end: Math.min(span.start, total) });
    at = Math.max(at, span.end);
  }
  if (at < total) out.push({ start: at, end: total });
  return out.filter((span) => span.end > span.start);
}

/** The plan's marks on `timeline`; a clip the plan names that isn't there any more is left out. */
export function cleanupMarks(timeline: Timeline, plan: CleanupPlan): CleanupMarks {
  const fps = timeline.canvas.rate.num / timeline.canvas.rate.den;
  const video = timeline.tracks[0];
  const items = video?.kind === 'video' ? video.items : [];
  const byClip = new Map<string, CleanupPlan['clips'][number]>(plan.clips.map((clip) => [clip.clipId, clip]));
  const removed: FrameSpanView[] = [];
  const punches: FrameSpanView[] = [];
  let at = 0;
  for (const item of items) {
    if (item.type === 'transition') continue;
    const planned = byClip.get(item.id);
    if (planned && item.type === 'clip') {
      const origin = seconds(item.sourceStart);
      const span = (range: CleanupPlan['clips'][number]['keep'][number]) => {
        const start = Math.round((seconds(range.start) - origin) * fps);
        return { start, end: start + Math.round(seconds(range.duration) * fps) };
      };
      for (const gap of between(planned.keep.map(span), item.duration.value))
        removed.push({ start: at + gap.start, end: at + gap.end });
      for (const punch of planned.punch) {
        const frames = span(punch.range);
        punches.push({ start: at + frames.start, end: at + frames.end });
      }
    }
    at += item.duration.value;
  }
  return { removed, punches, total: at };
}

/** Seconds of video before and after, from the timeline and the plan. */
export function cleanupLengths(marks: CleanupMarks, fps: number) {
  const gone = marks.removed.reduce((sum, span) => sum + span.end - span.start, 0);
  return { before: marks.total / fps, after: (marks.total - gone) / fps };
}
