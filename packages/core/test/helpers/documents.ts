// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template v1 and Timeline v1 fixtures for the contract tests. */
import {
  DEFAULT_MIX,
  FrameRate,
  FrameRates,
  newId,
  RationalTime,
  TimeRange,
  type CaptionTrack,
  type FrameRate as Rate,
  type Template,
  type Timeline,
} from '@taalcut/core';

export const T0 = 1_760_000_000_000;
export const SHA = 'a'.repeat(64);
const fps30 = FrameRates.fps30;
const beatRate = FrameRate.of(50);

export const at = (value: number, rate: Rate = fps30): RationalTime => RationalTime.of(value, rate);
export const span = (start: number, duration: number, rate: Rate = fps30) =>
  TimeRange.of(at(start, rate), at(duration, rate));

/** A JSON round trip: what storage and IPC do to a document. */
export const json = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** Paths of the issues a schema reports, joined with dots. */
export function issuePaths(
  schema: { safeParse(value: unknown): { success: boolean; error?: unknown } },
  value: unknown,
) {
  const result = schema.safeParse(value) as {
    success: boolean;
    error?: { issues: { path: PropertyKey[] }[] };
  };
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.map(String).join('.'));
}

const intent = (text: string) => ({
  text,
  shotType: 'wide' as const,
  motion: 'static' as const,
  subject: null,
  people: null,
  place: null,
  energy: 0.5,
  source: 'analyst' as const,
});

/** A 3-second reference template at 30 fps: three slots, a dissolve, a ramp, one overlay and a beat map. */
export function referenceTemplate(): Template {
  const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
  const slot = (index: number) => ({
    id: slots[index]!,
    name: index === 0 ? 'Hook' : null,
    role: index === 0 ? ('hook' as const) : ('body' as const),
    start: at(index * 30),
    duration: at(30),
    intent: intent(`shot ${index + 1}`),
    beatAnchor: null,
    transitionIn: null,
    speedRamp: null,
    cut: { method: 'both' as const, confidence: 0.9 },
    approved: false,
    frame: index,
  });
  return {
    schemaVersion: 1,
    id: newId<'Template'>(),
    version: 1,
    parentVersion: null,
    createdAt: T0,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/abc',
      fingerprint: SHA,
      source: { duration: at(90), rate: fps30, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: 'c1',
      analysedAt: T0,
    },
    canvas: { width: 1080, height: 1920, rate: fps30 },
    duration: at(90),
    slots: [
      slot(0),
      {
        ...slot(1),
        beatAnchor: { beatIndex: 2, offset: at(0) },
        transitionIn: { kind: 'dissolve', before: at(5), after: at(5), direction: null, confidence: 0.8 },
      },
      {
        ...slot(2),
        speedRamp: {
          points: [
            { at: at(0), speed: 1 },
            { at: at(20), speed: 2 },
          ],
          curve: 'linear',
        },
      },
    ],
    beatMap: {
      rate: beatRate,
      beats: [0, 25, 50, 75, 100, 125].map((value) => at(value, beatRate)),
      downbeats: [0, 4],
      bpm: 120,
      beatsPerBar: 4,
      confidence: 0.9,
      source: 'tracker',
    },
    text: [
      {
        id: newId<'TextOverlay'>(),
        text: 'Day 1 in Goa',
        role: 'title',
        start: at(10),
        duration: at(30),
        slotId: slots[0]!,
        box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
        appearance: { size: 0.04, align: 'center', case: 'mixed', background: 'none' },
        styleKey: 'title',
        reveal: 'pop',
        language: 'en',
        confidence: 0.95,
      },
    ],
    audio: {
      kind: 'music',
      loudnessLufs: -14,
      sound: { title: 'Original audio', artist: null },
      speech: null,
      waveform: { rate: beatRate, peaks: [0.1, 0.5, 0.2] },
    },
    pacing: {
      shotCount: 3,
      meanShot: at(30),
      medianShot: at(30),
      shortestShot: at(30),
      longestShot: at(30),
      hookEnd: at(30),
      cutsOnBeat: 1,
    },
    styleId: null,
    contactSheet: {
      asset: SHA,
      mediaType: 'image/jpeg',
      columns: 3,
      rows: 1,
      tile: { width: 120, height: 180 },
      frames: slots.map((slotId, index) => ({ at: at(index * 30 + 15), slotId })),
    },
    language: 'en',
  };
}

export function formatTemplate(): Template {
  const base = referenceTemplate();
  return {
    ...base,
    origin: {
      kind: 'format',
      formatId: 'vlog',
      formatVersion: '1',
      target: at(90),
      brief: 'a 3 s vlog',
    },
    beatMap: base.beatMap && { ...base.beatMap, source: 'format' },
    slots: base.slots.map((slot) => ({ ...slot, frame: null, intent: { ...slot.intent, source: 'format' } })),
    contactSheet: null,
  };
}

export function manualTemplate(): Template {
  return {
    ...formatTemplate(),
    origin: { kind: 'manual' },
    beatMap: null,
    text: [],
    slots: formatTemplate().slots.map((slot) => ({ ...slot, beatAnchor: null })),
  };
}

const ntsc = FrameRates.fps29_97;
const fps25 = FrameRates.fps25;

const clip = (sourceStart: number, duration: number) => ({
  type: 'clip' as const,
  id: newId<'TimelineItem'>(),
  media: {
    kind: 'video' as const,
    assetId: newId<'Asset'>(),
    shotId: newId<'Shot'>(),
    available: span(0, 250, fps25),
  },
  sourceStart: at(sourceStart, fps25),
  duration: at(duration, ntsc),
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
});

const text = (start: number, duration: number) => ({
  type: 'text' as const,
  id: newId<'TimelineItem'>(),
  start: at(start, ntsc),
  duration: at(duration, ntsc),
  text: 'Day 1',
  role: 'title' as const,
  slotId: null,
  overlayId: null,
  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 },
  appearance: { size: 0.04, align: 'center' as const, case: 'mixed' as const, background: 'none' as const },
  styleKey: 'title',
  reveal: 'none' as const,
  language: 'en',
  origin: 'template' as const,
});

export function captionTrack(cues: readonly [number, number][]): CaptionTrack {
  return {
    enabled: true,
    language: 'en',
    styleSource: 'preset',
    style: {
      version: 1,
      font: 'notoSans',
      weight: 700,
      sizePx: 64,
      textColor: '#ffffff',
      highlightColor: '#ffcc00',
      stroke: { color: '#000000', widthPx: 4 },
      background: null,
      highlight: 'color',
      letterCase: 'asIs',
      anchorY: 0.7,
      maxLines: 2,
      maxWords: 4,
    },
    cues: cues.map(([start, duration]) => ({
      id: newId<'CaptionCue'>(),
      range: span(start, duration, ntsc),
      words: [{ text: 'hello', range: span(start, duration, ntsc), confidence: 1 }],
      edited: false,
    })),
  };
}

/**
 * An NTSC (29.97) timeline over 25 fps media: two clips with a dissolve, a gap, an audio bed, a text track,
 * captions, a marker and a cast. V1 lasts 150 frames.
 */
export function ntscTimeline(): Timeline {
  const first = clip(25, 60);
  const second = clip(50, 60);
  const slotA = newId<'TemplateSlot'>();
  return {
    schemaVersion: 2,
    id: newId<'Timeline'>(),
    projectId: newId<'Project'>(),
    name: 'Goa, variant 1',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: ntsc },
    template: { id: newId<'Template'>(), version: 1 },
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [
          { ...first, slotId: slotA },
          {
            type: 'transition',
            id: newId<'TimelineItem'>(),
            kind: 'dissolve',
            inOffset: at(5, ntsc),
            outOffset: at(5, ntsc),
            direction: null,
          },
          second,
          { type: 'gap', id: newId<'TimelineItem'>(), duration: at(30, ntsc), slotId: null },
        ],
      },
      {
        kind: 'audio',
        id: 'A1',
        name: 'Music',
        enabled: true,
        role: 'clip',
        items: [
          {
            ...clip(0, 150),
            media: {
              kind: 'audio',
              assetId: newId<'Asset'>(),
              available: span(0, 480_000, FrameRates.hz48000),
            },
            sourceStart: at(0, FrameRates.hz48000),
          },
        ],
      },
      { kind: 'text', id: 'T1', name: 'Text', enabled: true, items: [text(0, 30), text(30, 30)] },
    ],
    markers: [
      { id: newId<'TimelineItem'>(), range: span(0, 30, ntsc), kind: 'hook', label: 'Hook', colour: 'RED' },
    ],
    cast: {
      castId: newId<'Cast'>(),
      mode: 'template',
      variantIndex: 0,
      variantCount: 2,
      configVersion: 'c1',
      sequenceConfidence: 0.8,
      slots: [
        {
          slotId: slotA,
          clipId: first.id,
          pick: null,
          alternates: [],
          confidence: 0.9,
          needsRerank: false,
          note: null,
        },
        {
          slotId: newId<'TemplateSlot'>(),
          clipId: second.id,
          pick: null,
          alternates: [],
          confidence: 0.4,
          needsRerank: true,
          note: 'reranked',
        },
      ],
    },
    captions: captionTrack([
      [0, 30],
      [30, 30],
    ]),
    music: { path: 'platformSound' },
    styleId: null,
    voiceover: null,
    mix: DEFAULT_MIX,
    createdAt: T0,
    updatedAt: T0,
  };
}
