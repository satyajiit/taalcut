// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The design eval's made-up video (HFW1-DSN): a 9:16 timeline at 30 fps with the clips and the person's captions a
 * case names, and any graphics already on it. Made-up media only: the assets are ids, nothing is read.
 */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type CaptionTrack,
  type GraphicItem,
  type Timeline,
} from '@taalcut/core';

export const RATE = FrameRate.of(30);
const at = (frames: number) => RationalTime.of(frames, RATE);

export interface VideoSpec {
  /** Each clip's length in seconds. */
  readonly clips: readonly number[];
  /** The person's words: start and end in seconds, and what they say. */
  readonly captions: readonly (readonly [number, number, string])[];
  /** Graphics already on the video. */
  readonly graphics?: readonly GraphicItem[];
}

function captionTrack(cues: VideoSpec['captions']): CaptionTrack {
  return {
    enabled: true,
    language: 'en',
    styleSource: 'preset',
    style: {
      version: 1,
      font: 'notoSans',
      weight: 700,
      sizePx: 72,
      textColor: '#ffffff',
      highlightColor: '#ffd400',
      stroke: { color: '#000000', widthPx: 4 },
      background: null,
      highlight: 'color',
      letterCase: 'asIs',
      anchorY: 0.55,
      maxLines: 2,
      maxWords: 6,
    },
    cues: cues.map(([from, to, text]) => {
      const start = Math.round(from * 30);
      const frames = Math.round((to - from) * 30);
      const words = text.split(' ').filter(Boolean);
      const each = Math.max(1, Math.floor(frames / words.length));
      return {
        id: newId<'CaptionCue'>(),
        range: { start: at(start), duration: at(frames) },
        words: words.map((word, index) => ({
          text: word,
          range: {
            start: at(start + index * each),
            duration: at(index === words.length - 1 ? frames - index * each : each),
          },
          confidence: 0.95,
        })),
        edited: false,
      };
    }),
  };
}

/** A made-up 9:16 video at 30 fps. */
export function madeUpVideo(spec: VideoSpec): Timeline {
  const clips = spec.clips.map((seconds) => {
    const frames = Math.round(seconds * 30);
    return {
      type: 'clip' as const,
      id: newId<'TimelineItem'>(),
      media: {
        kind: 'video' as const,
        assetId: newId<'Asset'>(),
        shotId: null,
        available: { start: at(0), duration: at(frames + 60) },
      },
      sourceStart: at(30),
      duration: at(frames),
      speed: null,
      slotId: null,
      syncPoint: null,
      beatAnchor: null,
      fit: 'cover' as const,
      audio: { gainDb: 0, muted: false },
      locked: false,
      enabled: true,
      stillMotion: null,
      reframe: null,
    };
  });
  return timelineSchema.parse({
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Made-up video',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: RATE },
    template: null,
    beatMap: null,
    tracks: [
      { kind: 'video', id: 'V1', name: 'Video', enabled: true, items: clips },
      ...(spec.graphics?.length
        ? [{ kind: 'text', id: 'T2', name: 'Graphics', enabled: true, items: spec.graphics }]
        : []),
    ],
    markers: [],
    cast: null,
    captions: captionTrack(spec.captions),
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  });
}
