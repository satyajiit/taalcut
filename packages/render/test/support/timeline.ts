// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Builds valid Timeline v1 documents for render tests: clips by frame count,
 * gaps, transitions, beat anchors, text items, captions and music. Every
 * result passes core's timelineSchema, so tests exercise real documents.
 */
import {
  DEFAULT_MIX,
  FrameRate,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  timelineSchema,
  type AssetId,
  type BeatMap,
  type CaptionTrack,
  type MusicChoice,
  type SequenceItem,
  type SpeedRamp,
  type TextItem,
  type Timeline,
  type TRANSITION_KINDS,
} from '@taalcut/core';

export const at = (value: number, rate: FrameRate) => RationalTime.of(value, rate);
export const span = (start: number, duration: number, rate: FrameRate) => ({
  start: at(start, rate),
  duration: at(duration, rate),
});

export interface ClipSpec {
  readonly frames: number;
  readonly id?: string;
  readonly assetId?: AssetId;
  readonly kind?: 'video' | 'image';
  /** In-point in media frames (media rate = timeline rate unless `mediaRate`). Default: 30 frames of handle. */
  readonly sourceStart?: number;
  readonly mediaRate?: FrameRate;
  /** Length of the media in its own frames. Default: in-point + clip + 60. */
  readonly mediaFrames?: number;
  /** A transition from the previous clip into this one. */
  readonly transition?: {
    readonly kind: (typeof TRANSITION_KINDS)[number];
    readonly inFrames: number;
    readonly outFrames: number;
    readonly direction?: 'left' | 'right' | 'up' | 'down';
  };
  readonly beat?: { readonly beatIndex: number; readonly offset?: number };
  readonly enabled?: boolean;
  readonly muted?: boolean;
  readonly fit?: 'cover' | 'contain';
  readonly speed?: SpeedRamp | null;
}

export interface GapSpec {
  readonly gap: number;
}

export interface TimelineSpec {
  readonly rate?: FrameRate;
  readonly items: readonly (ClipSpec | GapSpec)[];
  readonly texts?: readonly {
    readonly start: number;
    readonly frames: number;
    readonly text: string;
    readonly language?: string;
    /** How it comes on; fade when absent. */
    readonly reveal?: TextItem['reveal'];
  }[];
  readonly captions?: CaptionTrack | null;
  readonly music?: MusicChoice;
  readonly beatMap?: BeatMap | null;
  /** Extra audio tracks: each a list of clips by frames (assets are made up). */
  readonly audioTracks?: readonly (readonly { readonly frames: number; readonly assetId?: AssetId }[])[];
}

const isGap = (item: ClipSpec | GapSpec): item is GapSpec => 'gap' in item;

function clipItem(spec: ClipSpec, rate: FrameRate) {
  const mediaRate = spec.mediaRate ?? rate;
  const kind = spec.kind ?? 'video';
  const sourceStart = spec.sourceStart ?? 30;
  const mediaFrames = spec.mediaFrames ?? sourceStart + spec.frames + 60;
  const assetId = spec.assetId ?? newId<'Asset'>();
  return {
    type: 'clip' as const,
    id: spec.id ?? newId<'TimelineItem'>(),
    media:
      kind === 'image'
        ? { kind: 'image' as const, assetId }
        : { kind: 'video' as const, assetId, shotId: null, available: span(0, mediaFrames, mediaRate) },
    sourceStart: kind === 'image' ? at(0, mediaRate) : at(sourceStart, mediaRate),
    duration: at(spec.frames, rate),
    speed: spec.speed ?? null,
    slotId: null,
    syncPoint: null,
    beatAnchor: spec.beat
      ? { beatIndex: spec.beat.beatIndex, offset: at(spec.beat.offset ?? 0, rate) }
      : null,
    fit: spec.fit ?? 'cover',
    audio: { gainDb: 0, muted: spec.muted ?? false },
    locked: false,
    enabled: spec.enabled ?? true,
    stillMotion: null,
    reframe: null,
  };
}

/** A caption track at `rate` from [start, frames, text] cues, one word per space. */
export function captionTrackOf(
  rate: FrameRate,
  cues: readonly (readonly [number, number, string])[],
  overrides: Partial<CaptionTrack['style']> = {},
  language = 'en',
): CaptionTrack {
  return {
    enabled: true,
    language,
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
      ...overrides,
    },
    cues: cues.map(([start, frames, text]) => {
      const words = text.split(' ').filter(Boolean);
      const each = Math.max(1, Math.floor(frames / words.length));
      return {
        id: newId<'CaptionCue'>(),
        range: span(start, frames, rate),
        words: words.map((word, index) => {
          const wordStart = start + index * each;
          const wordFrames = index === words.length - 1 ? start + frames - wordStart : each;
          return { text: word, range: span(wordStart, wordFrames, rate), confidence: 0.9 };
        }),
        edited: false,
      };
    }),
  };
}

export function makeTimeline(spec: TimelineSpec): Timeline {
  const rate = spec.rate ?? FrameRate.of(30);
  const items: SequenceItem[] = [];
  for (const item of spec.items) {
    if (isGap(item)) {
      items.push({ type: 'gap', id: newId<'TimelineItem'>(), duration: at(item.gap, rate), slotId: null });
      continue;
    }
    if (item.transition) {
      items.push({
        type: 'transition',
        id: newId<'TimelineItem'>(),
        kind: item.transition.kind,
        inOffset: at(item.transition.inFrames, rate),
        outOffset: at(item.transition.outFrames, rate),
        direction: item.transition.direction ?? null,
      });
    }
    items.push(clipItem(item, rate) as SequenceItem);
  }
  const texts: TextItem[] = (spec.texts ?? []).map((text) => ({
    type: 'text',
    id: newId<'TimelineItem'>(),
    start: at(text.start, rate),
    duration: at(text.frames, rate),
    text: text.text,
    role: 'title',
    slotId: null,
    overlayId: null,
    box: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
    appearance: { size: 0.03, align: 'center', case: 'mixed', background: 'none' },
    styleKey: 'title',
    reveal: text.reveal ?? 'fade',
    language: text.language ?? 'en',
    origin: 'editor',
  }));
  const audioTracks = (spec.audioTracks ?? []).map((clips, index) => ({
    kind: 'audio' as const,
    id: `A${index + 1}`,
    name: 'Audio',
    enabled: true,
    role: 'clip' as const,
    items: clips.map((clip) => ({
      ...clipItem(
        { frames: clip.frames, sourceStart: 0, ...(clip.assetId ? { assetId: clip.assetId } : {}) },
        rate,
      ),
      media: {
        kind: 'audio' as const,
        assetId: clip.assetId ?? newId<'Asset'>(),
        available: span(0, clip.frames + 60, rate),
      },
    })),
  }));
  const timeline = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Render test',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate },
    template: null,
    beatMap: spec.beatMap ?? null,
    tracks: [
      { kind: 'video', id: 'V1', name: 'Video', enabled: true, items },
      ...audioTracks,
      ...(texts.length > 0 ? [{ kind: 'text', id: 'T1', name: 'Text', enabled: true, items: texts }] : []),
    ],
    markers: [],
    cast: null,
    captions: spec.captions ?? null,
    music: spec.music ?? { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: 0,
    updatedAt: 0,
  };
  return timelineSchema.parse(timeline);
}

/** A beat map at 1000/1 from beat times in milliseconds. */
export function beatMapOf(beatsMs: readonly number[]): BeatMap {
  const rate = FrameRate.of(1000);
  return {
    rate,
    beats: beatsMs.map((ms) => at(ms, rate)),
    downbeats: [],
    bpm: null,
    beatsPerBar: null,
    confidence: 1,
    source: 'user',
  };
}
