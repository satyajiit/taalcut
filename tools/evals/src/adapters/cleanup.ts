// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `planCleanup` on an analysis built from the label's frame ranges. No Silero and no audio analyser.
 * Fillers are whatever the label says; the canonical fixture places them between words.
 */
import {
  CLEANUP_SETTING,
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  speechCleanupAnalysisSchema,
  TimeRange,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AssetId,
  type CleanupSettings,
} from '@taalcut/core';
import { planCleanup } from '@taalcut/timeline';
import type { CleanupLabel, CleanupPrediction, FrameRange } from '../cleanup/schema';
import { requireSyntheticLabels } from './synthetic-only';

function range(startFrame: number, endFrame: number, rate: FrameRate): TimeRange {
  return TimeRange.of(RationalTime.of(startFrame, rate), RationalTime.of(endFrame - startFrame, rate));
}

function clipOf(label: CleanupLabel) {
  const rate = FrameRate.of(label.fps);
  const assetId = newId<'Asset'>();
  const settings: CleanupSettings = { ...CLEANUP_SETTING.defaultValue, punchIns: false, retakes: false };
  const timeline = timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Cleanup',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [
          {
            type: 'clip',
            id: newId<'TimelineItem'>(),
            media: {
              kind: 'video',
              assetId,
              shotId: null,
              available: {
                start: RationalTime.of(0, rate),
                duration: RationalTime.of(label.clipFrames, rate),
              },
            },
            sourceStart: RationalTime.of(0, rate),
            duration: RationalTime.of(label.clipFrames, rate),
            speed: null,
            slotId: null,
            syncPoint: null,
            beatAnchor: null,
            fit: 'cover',
            audio: { gainDb: 0, muted: false },
            locked: false,
            enabled: true,
            stillMotion: null,
            reframe: null,
          },
        ],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  });
  const analysis = speechCleanupAnalysisSchema.parse({
    version: 1,
    assetId,
    contentHash: 'c'.repeat(64),
    configVersion: 1,
    language: 'en',
    engine: 'whisper',
    words: label.words.map((word) => ({
      text: 'word',
      range: range(word.start, word.end, rate),
      confidence: 0.9,
    })),
    speech: [range(0, label.clipFrames, rate)],
    fillers: label.fillers.map((filler) => ({
      range: range(filler.start, filler.end, rate),
      text: 'um',
      wordIndex: null,
      confidence: 0.9,
    })),
    pauses: label.pauses.map((pause) => ({ range: range(pause.start, pause.end, rate) })),
    retakes: [],
    emphasis: [],
    ambiguous: [],
  });
  return { timeline, analysis, assetId, settings, rate };
}

function removalsOf(keeps: readonly FrameRange[], total: number): FrameRange[] {
  const sorted = [...keeps].sort((a, b) => a.start - b.start);
  const out: FrameRange[] = [];
  let cursor = 0;
  for (const keep of sorted) {
    if (keep.start > cursor) out.push({ start: cursor, end: keep.start });
    cursor = Math.max(cursor, keep.end);
  }
  if (cursor < total) out.push({ start: cursor, end: total });
  return out.filter((span) => span.end > span.start);
}

export function predictCleanup(labels: readonly CleanupLabel[]): CleanupPrediction[] {
  requireSyntheticLabels(
    'cleanup',
    labels,
    "the clip's audio and audio's speech analysis (fillers, pauses, words)",
  );
  return labels.map((label) => {
    const built = clipOf(label);
    const analyses = new Map<AssetId, typeof built.analysis>([[built.assetId, built.analysis]]);
    const plan = planCleanup(built.timeline, analyses, built.settings, () => newId<'TimelineItem'>());
    if (!plan.ok) throw new Error(`planCleanup: ${plan.error.code}`);
    const planned = plan.value.clips[0];
    if (planned === undefined) throw new Error(`planCleanup: no clip for ${label.caseId}`);
    const keeps = planned.keep.map((span) => ({
      start: RationalTime.toFrames(span.start, built.rate),
      end: RationalTime.toFrames(TimeRange.end(span), built.rate),
    }));
    return { caseId: label.caseId, removals: removalsOf(keeps, label.clipFrames) };
  });
}
