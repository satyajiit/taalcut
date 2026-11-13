// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the edit eval's video, a 12-second cut at 30 fps on a 120 bpm grid (a beat every half second):
 *
 *   1 bike 0–2 s (own sound) · 2 coffee 2–3.5 s · 3 crossing 3.5–5.5 s (own sound) · crossfade · 4 waves 5.5–8.5 s
 *   (own sound) · 5 dog 8.5–10 s · 6 skyline 10–12 s
 *
 * Text "Weekend ride" over 0–1.5 s and "Sea breeze" over 6–8 s, a voice line at 7–8.5 s, the person's own music
 * under it all. Ids are fixed (ids.ts), so recorded sessions replay against the same ones.
 */
import {
  DEFAULT_MIX,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  TimeRange,
  timelineSchema,
  type Clip,
  type ProjectId,
  type SequenceItem,
  type TextItem,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import { FPS, MEDIA_FRAMES, VIDEO_SHOTS } from './footage';
import { fixedId } from './ids';

export const PROJECT_ID = fixedId<'Project'>('01K8EP', 1);
export const TIMELINE_ID = fixedId<'Timeline'>('01K8ET', 1);
const item = (n: number) => fixedId<'TimelineItem'>('01K8EM', n);

/** Clip ids by shot, in order; the transition, texts and voice line. */
export const IDS = {
  clips: VIDEO_SHOTS.map((_shot, index) => item(index + 1)) as readonly TimelineItemId[],
  crossfade: item(20),
  title: item(30),
  caption: item(31),
  voiceGap: item(40),
  voice: item(41),
} as const;

/** Each clip's length in frames. */
export const CLIP_FRAMES = [60, 45, 60, 90, 45, 60] as const;
/** Clips with their own sound on. */
const SOUND_ON = new Set([0, 2, 3]);
export const MUSIC_ASSET = fixedId<'Asset'>('01K8EA', 90);
const VOICE_ASSET = fixedId<'Asset'>('01K8EA', 91);

const at = (frames: number) => RationalTime.of(frames, FPS);

function clip(index: number, start: number): Clip {
  const shot = VIDEO_SHOTS[index]!;
  return {
    type: 'clip',
    id: IDS.clips[index]!,
    media: {
      kind: 'video',
      assetId: shot.assetId,
      shotId: shot.shotId,
      available: TimeRange.of(at(0), at(MEDIA_FRAMES)),
    },
    // Three seconds into each file, where the words are.
    sourceStart: at(90),
    duration: at(CLIP_FRAMES[index]!),
    speed: null,
    slotId: null,
    syncPoint: at(90),
    beatAnchor: { beatIndex: start / 15, offset: at(0) },
    fit: 'cover',
    audio: { gainDb: 0, muted: !SOUND_ON.has(index) },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  };
}

function text(id: TimelineItemId, words: string, start: number, frames: number, y: number): TextItem {
  return {
    type: 'text',
    id,
    start: at(start),
    duration: at(frames),
    text: words,
    role: 'title',
    slotId: null,
    overlayId: null,
    box: { x: 0.1, y, width: 0.8, height: 0.1 },
    appearance: { size: 0.05, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: 'none',
    language: 'en',
    origin: 'editor',
  };
}

export function editTimeline(projectId: ProjectId = PROJECT_ID, id: TimelineId = TIMELINE_ID): Timeline {
  const items: SequenceItem[] = [];
  let start = 0;
  CLIP_FRAMES.forEach((frames, index) => {
    if (index === 3)
      items.push({
        type: 'transition',
        id: IDS.crossfade,
        kind: 'dissolve',
        inOffset: at(7),
        outOffset: at(8),
        direction: null,
      });
    items.push(clip(index, start));
    start += frames;
  });
  const beats = Array.from({ length: start / 15 + 5 }, (_beat, index) => at(index * 15));
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id,
    projectId,
    name: 'Weekend ride',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: FPS },
    template: null,
    beatMap: { rate: FPS, beats, downbeats: [0], bpm: 120, beatsPerBar: 4, confidence: 1, source: 'tracker' },
    tracks: [
      { kind: 'video', id: 'V1', name: 'V1', enabled: true, items },
      {
        kind: 'audio',
        id: 'A2',
        name: 'Voice',
        enabled: true,
        role: 'voice',
        items: [
          { type: 'gap', id: IDS.voiceGap, duration: at(210), slotId: null },
          {
            type: 'clip',
            id: IDS.voice,
            media: { kind: 'audio', assetId: VOICE_ASSET, available: TimeRange.of(at(0), at(120)) },
            sourceStart: at(0),
            duration: at(45),
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
      {
        kind: 'text',
        id: 'T1',
        name: 'T1',
        enabled: true,
        items: [text(IDS.title, 'Weekend ride', 0, 45, 0.2), text(IDS.caption, 'Sea breeze', 180, 60, 0.6)],
      },
    ],
    markers: [],
    cast: null,
    captions: null,
    music: { path: 'ownTrack', assetId: MUSIC_ASSET, offset: at(0), gainDb: 0 },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
}
