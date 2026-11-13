// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Valid Timeline v2 documents for audio's tests: video clips by frames (with slots), a beat map, extra tracks. */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type BeatMap,
  type SequenceItem,
  type SlotId,
  type Timeline,
  type Track,
  type Voiceover,
} from '@taalcut/core';

export interface TestTimelineSpec {
  readonly rate?: FrameRate;
  readonly clips: readonly { readonly frames: number; readonly slotId?: SlotId }[];
  readonly beatMap?: BeatMap | null;
  readonly extraTracks?: readonly Track[];
  readonly voiceover?: Voiceover | null;
}

/** A beat map at `bpm` from 0 ms, on a 1000/1 clock, with a downbeat every four beats. */
export function steadyBeatMap(bpm: number, seconds: number): BeatMap {
  const rate = FrameRate.of(1000, 1);
  const beatMs = 60_000 / bpm;
  const beats = Array.from({ length: Math.floor((seconds * 1000) / beatMs) + 1 }, (_, i) =>
    RationalTime.of(Math.round(i * beatMs), rate),
  );
  const downbeats = beats.map((_, i) => i).filter((i) => i % 4 === 0);
  return { rate, beats, downbeats, bpm, beatsPerBar: 4, confidence: 1, source: 'tracker' };
}

export function makeTestTimeline(spec: TestTimelineSpec): Timeline {
  const rate = spec.rate ?? FrameRate.of(30);
  const items: SequenceItem[] = spec.clips.map((clip) => ({
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'video',
      assetId: newId<'Asset'>(),
      shotId: null,
      available: { start: RationalTime.of(0, rate), duration: RationalTime.of(clip.frames + 60, rate) },
    },
    sourceStart: RationalTime.of(0, rate),
    duration: RationalTime.of(clip.frames, rate),
    speed: null,
    slotId: clip.slotId ?? null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: 0, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  }));
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Test',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: spec.beatMap ?? null,
    tracks: [{ kind: 'video', id: 'V1', name: 'Video', enabled: true, items }, ...(spec.extraTracks ?? [])],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: spec.voiceover ?? null,
    mix: DEFAULT_MIX,
    createdAt: 1,
    updatedAt: 1,
  });
}
