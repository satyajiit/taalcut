// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The P3-V5 fixture: a 30-clip timeline with mixed 24, 25, 30 and 29.97 fps media, two ramps, three transitions,
 * gaps, stills, a music bed and a voice track, 12 text items and an offline original; and the originals an
 * InterchangeMediaSource would return for it.
 */
import {
  FrameRates,
  newId,
  RationalTime,
  TimeRange,
  timelineSchema,
  type AssetId,
  type FrameRate,
  type InterchangeMedia,
  type SequenceItem,
  type Timeline,
} from '@taalcut/core';
import { clipMedia } from '../../src/interchange/media-paths';
import { buildTimeline, type ClipDef } from './timeline';

const MEDIA_RATES = [FrameRates.fps24, FrameRates.fps25, FrameRates.fps30, FrameRates.fps29_97];

function clipDefs(): ClipDef[] {
  const defs: ClipDef[] = [];
  for (let index = 0; index < 30; index++) {
    const frames = 15 + ((index * 7) % 4) * 15;
    const base: ClipDef = {
      frames,
      mediaRate: MEDIA_RATES[index % 4] as FrameRate,
      sourceStart: 40 + index,
      media: 900,
    };
    if (index === 5 || index === 17)
      defs.push({
        ...base,
        frames: 45,
        ramp: [
          [0, 1],
          [30, 2],
        ],
      });
    else if (index === 9 || index === 21) defs.push({ frames, image: true });
    else if (index === 3 || index === 13 || index === 25)
      defs.push({ ...base, transition: ['dissolve', 4, 4] });
    else defs.push(base);
    if (index === 11 || index === 23) defs.push({ frames: 15, gap: true });
  }
  return defs;
}

/** A voice track of two lines and the user's own track under the whole video. */
function withAudio(timeline: Timeline): Timeline {
  const rate = timeline.canvas.rate;
  const audioRate = FrameRates.hz48000;
  const line = (frames: number): SequenceItem => ({
    type: 'clip',
    id: newId<'TimelineItem'>(),
    media: {
      kind: 'audio',
      assetId: newId<'Asset'>(),
      available: TimeRange.of(RationalTime.zero(audioRate), RationalTime.of(48_000 * 10, audioRate)),
    },
    sourceStart: RationalTime.of(4800, audioRate),
    duration: RationalTime.of(frames, rate),
    speed: null,
    slotId: null,
    syncPoint: null,
    beatAnchor: null,
    fit: 'cover',
    audio: { gainDb: -3, muted: false },
    locked: false,
    enabled: true,
    stillMotion: null,
    reframe: null,
  });
  const voice = {
    kind: 'audio' as const,
    id: 'A1',
    name: 'Voice',
    enabled: true,
    role: 'voice' as const,
    items: [
      {
        type: 'gap' as const,
        id: newId<'TimelineItem'>(),
        duration: RationalTime.of(45, rate),
        slotId: null,
      },
      line(60),
      {
        type: 'gap' as const,
        id: newId<'TimelineItem'>(),
        duration: RationalTime.of(90, rate),
        slotId: null,
      },
      line(75),
    ],
  };
  const [video, ...rest] = timeline.tracks;
  return timelineSchema.parse({
    ...timeline,
    tracks: [video, voice, ...rest],
    music: { path: 'ownTrack', assetId: newId<'Asset'>(), offset: RationalTime.of(48, rate), gainDb: -6 },
  });
}

export function thirtyClipTimeline(rate: FrameRate): Timeline {
  const texts = Array.from({ length: 12 }, (_, index) => ({
    start: index * 30,
    frames: 20,
    track: index % 2,
  }));
  const { timeline } = buildTimeline({ rate, clips: clipDefs(), texts });
  return withAudio(timeline);
}

/** What the library knows of one original: its media rate (null for a still or a track's own), picture or not. */
interface OriginalFacts {
  readonly rate: FrameRate | null;
  readonly hasVideo: boolean;
  readonly offline: boolean;
}

function original(name: string, facts: OriginalFacts): InterchangeMedia {
  const path = `/Volumes/Shoot Day/${name}`;
  return {
    path: facts.offline ? null : path,
    lastKnownPath: path,
    name,
    rate: facts.rate,
    durationFrames: facts.rate ? 900 : null,
    width: facts.hasVideo ? 1080 : null,
    height: facts.hasVideo ? 1920 : null,
    hasAudio: true,
    audioChannels: 2,
    audioRate: 48000,
  };
}

/** Originals for every asset of the timeline; `offline` are known but not where their path says. */
export function originals(
  timeline: Timeline,
  offline: ReadonlySet<AssetId> = new Set(),
  name: (assetId: AssetId) => string = (assetId) => `${assetId}.mov`,
): Map<AssetId, InterchangeMedia> {
  const out = new Map<AssetId, InterchangeMedia>();
  const add = (assetId: AssetId, rate: FrameRate | null, hasVideo: boolean) =>
    out.set(assetId, original(name(assetId), { rate, hasVideo, offline: offline.has(assetId) }));
  for (const media of clipMedia(timeline))
    add(media.assetId, media.kind === 'image' ? null : media.available.start.rate, media.kind !== 'audio');
  if (timeline.music.path === 'ownTrack') add(timeline.music.assetId, FrameRates.hz48000, false);
  return out;
}

/** The V1 clip ids in order (no gaps). */
export function clipIds(timeline: Timeline): string[] {
  const video = timeline.tracks[0];
  return video?.kind === 'video'
    ? video.items.filter((item) => item.type === 'clip').map((item) => item.id)
    : [];
}
