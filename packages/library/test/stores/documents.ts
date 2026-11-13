// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template v1 and Timeline v1 documents for the store tests (after core's contract fixtures). */
import {
  DEFAULT_MIX,
  FrameRate,
  FrameRates,
  newId,
  RationalTime,
  TIMELINE_SCHEMA_VERSION,
  TimeRange,
  unwrap,
  type AssetId,
  type FrameRate as Rate,
  type ProjectId,
  type Template,
  type TemplateId,
  type Timeline,
} from '@taalcut/core';
import { createRepositories, type LibraryDatabase } from '../../src/index';

export const T0 = 1_760_000_000_000;
const fps30 = FrameRates.fps30;
const fps25 = FrameRates.fps25;
const beatRate = FrameRate.of(50);

export const at = (value: number, rate: Rate = fps30): RationalTime => RationalTime.of(value, rate);
const span = (start: number, duration: number, rate: Rate = fps30) =>
  TimeRange.of(at(start, rate), at(duration, rate));

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

export interface TemplateOptions {
  readonly id?: TemplateId;
  readonly version?: number;
  readonly parentVersion?: number | null;
  /** The contact sheet's asset; null for none. */
  readonly sheet?: string | null;
  readonly fingerprint?: string;
  readonly intents?: readonly [string, string, string];
  readonly overlay?: string;
}

/** A 3-second reference template at 30 fps: three slots, one overlay, a beat map at 120 BPM. */
export function template(options: TemplateOptions = {}): Template {
  const slots = [newId<'TemplateSlot'>(), newId<'TemplateSlot'>(), newId<'TemplateSlot'>()];
  const texts = options.intents ?? ['wide beach at sunset', 'close up of waves', 'friends laughing'];
  const sheet = options.sheet === undefined ? 'a'.repeat(64) : options.sheet;
  return {
    schemaVersion: 1,
    id: options.id ?? newId<'Template'>(),
    version: options.version ?? 1,
    parentVersion: options.parentVersion ?? null,
    createdAt: T0,
    origin: {
      kind: 'reference',
      input: 'link',
      platform: 'reels',
      url: 'https://www.instagram.com/reel/abc',
      fingerprint: options.fingerprint ?? 'f'.repeat(64),
      source: { duration: at(90), rate: fps30, width: 1080, height: 1920 },
      crop: null,
      pipelineVersion: '1',
      configVersion: 'c1',
      analysedAt: T0,
    },
    canvas: { width: 1080, height: 1920, rate: fps30 },
    duration: at(90),
    slots: slots.map((id, index) => ({
      id,
      name: index === 0 ? 'Hook' : null,
      role: index === 0 ? ('hook' as const) : ('body' as const),
      start: at(index * 30),
      duration: at(30),
      intent: intent(texts[index]!),
      beatAnchor: null,
      transitionIn: null,
      speedRamp: null,
      cut: { method: 'both' as const, confidence: 0.9 },
      approved: false,
      frame: sheet ? index : null,
    })),
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
        text: options.overlay ?? 'Day 1 in Goa',
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
    audio: { kind: 'music', loudnessLufs: -14, sound: null, speech: null, waveform: null },
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
    contactSheet: sheet
      ? {
          asset: sheet,
          mediaType: 'image/jpeg',
          columns: 3,
          rows: 1,
          tile: { width: 120, height: 180 },
          frames: slots.map((slotId, index) => ({ at: at(index * 30 + 15), slotId })),
        }
      : null,
    language: 'en',
  };
}

/** The next version of a template: same lineage, a new number, its parent the given one. */
export function nextVersion(
  base: Template,
  version: number,
  parentVersion: number,
  intent0 = 'a new hook',
): Template {
  return {
    ...base,
    version,
    parentVersion,
    slots: base.slots.map((slot, index) =>
      index === 0 ? { ...slot, intent: { ...slot.intent, text: intent0 } } : slot,
    ),
  };
}

const clip = (assetId: AssetId, duration: number) => ({
  type: 'clip' as const,
  id: newId<'TimelineItem'>(),
  media: { kind: 'video' as const, assetId, shotId: null, available: span(0, 250, fps25) },
  sourceStart: at(25, fps25),
  duration: at(duration),
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

/** A 30 fps timeline: two clips over the given assets and a 30-frame gap (V1 lasts 150 frames). */
export function timeline(
  projectId: ProjectId,
  assets: readonly [AssetId, AssetId],
  options: { readonly name?: string; readonly template?: { id: TemplateId; version: number } | null } = {},
): Timeline {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    id: newId<'Timeline'>(),
    projectId,
    name: options.name ?? 'Goa, variant 1',
    revision: 1,
    canvas: { width: 1080, height: 1920, rate: fps30 },
    template: options.template === undefined ? { id: newId<'Template'>(), version: 1 } : options.template,
    beatMap: null,
    tracks: [
      {
        kind: 'video',
        id: 'V1',
        name: 'Video',
        enabled: true,
        items: [
          clip(assets[0], 60),
          clip(assets[1], 60),
          { type: 'gap', id: newId<'TimelineItem'>(), duration: at(30), slotId: null },
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
    createdAt: T0,
    updatedAt: T0,
  };
}

/** A copy with V1's first clip lasting `frames` instead (an edit). */
export function edited(document: Timeline, frames: number): Timeline {
  const [video, ...rest] = document.tracks;
  if (!video || video.kind !== 'video') throw new Error('V1 must be a video track');
  const items = video.items.map((item, index) =>
    index === 0 && item.type === 'clip' ? { ...item, duration: at(frames) } : item,
  );
  return { ...document, tracks: [{ ...video, items }, ...rest] };
}

/** A project and two video assets to cast from. */
export function seed(db: LibraryDatabase, name = 'Goa trip') {
  const repos = createRepositories(db);
  const project = unwrap(repos.projects.create({ name }));
  const asset = (file: string) =>
    unwrap(repos.assets.create({ kind: 'video', sizeBytes: 1000, originalFilename: file })).id;
  return { repos, project, assets: [asset('a.mov'), asset('b.mov')] as [AssetId, AssetId] };
}
