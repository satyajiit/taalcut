// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- hub file data (an intent, the licence id): the author's, never UI */

/**
 * The fake hub's files and index (P3-B12, P3-V8): each seed as a hub template v0 document that passes core's
 * hubTemplateV0Schema (test/hub-fake.test.ts parses all 40), and its index row (slot strip, sha256, dates) as the
 * hub repository's CI would build it. Times are whole frames at 30 fps; beats are milliseconds.
 */
import {
  HUB_FORMAT,
  HUB_FORMAT_VERSION,
  HUB_ROLE_PLACEHOLDERS,
  type HubIndexEntry,
  type HubRating,
  type HubTemplateId,
  type HubTemplateV0,
} from '@taalcut/core';
import { fakeHash, fakeUlid, prng } from '../../library/seed';
import { HUB_SEEDS, INTENTS, type HubSeed } from './hub-seed-data';

/** fakeUlid's kind for hub template ids (17: 'H' in the id). */
export const HUB_KIND = 17;
const FPS = { num: 30, den: 1 } as const;
const MS = { num: 1000, den: 1 } as const;
const DAY_MS = 86_400_000;
const at = (frames: number) => ({ value: frames, rate: FPS });

type Doc = HubTemplateV0;
type Slot = Doc['structure']['slots'][number];
type Overlay = Doc['structure']['text'][number];
type ShotType = NonNullable<Slot['intent']['shotType']>;

const SHOTS: readonly ShotType[] = ['wide', 'medium', 'close', 'detail', 'pov'];
const MOTIONS = ['static', 'push-in', 'pan', 'handheld', 'tracking', 'tilt', 'pull-out'] as const;

export const hubIdOf = (n: number): HubTemplateId => fakeUlid<'HubTemplate'>(HUB_KIND, n);

/** Slot lengths in frames, cut from the running beat count so every cut stays within a frame of its beat. */
function slotFrames(seed: HubSeed): number[] {
  const frameOf = (beats: number) => (seed.bpm ? Math.round((beats * 1800) / seed.bpm) : beats * 15);
  let beats = 0;
  return seed.slots.map((count) => {
    const start = frameOf(beats);
    beats += count;
    return frameOf(beats) - start;
  });
}

function role(index: number, count: number): Slot['role'] {
  if (index === 0) return 'hook';
  if (index === count - 1) return 'outro';
  return count >= 4 && index === Math.floor((count * 2) / 3) ? 'peak' : 'body';
}

function slotsOf(seed: HubSeed, frames: readonly number[]): Slot[] {
  const random = prng(seed.n * 7_331);
  const textFirst = seed.formatId === 'tutorial' || seed.formatId === 'ugcAd';
  let start = 0;
  let beat = 0;
  return frames.map((length, index) => {
    const shotType: ShotType =
      textFirst && index === 0 ? 'text' : (SHOTS[Math.floor(random() * SHOTS.length)] ?? 'wide');
    const words = INTENTS[shotType] ?? INTENTS.wide ?? [];
    const slot: Slot = {
      role: role(index, frames.length),
      name: null,
      start: at(start),
      duration: at(length),
      intent: {
        text: words[Math.floor(random() * words.length)] ?? 'A shot',
        shotType,
        motion: shotType === 'text' ? 'static' : (MOTIONS[Math.floor(random() * MOTIONS.length)] ?? 'static'),
        subject: null,
        people: shotType === 'medium' ? 1 : null,
        place: null,
        energy: Math.round((0.3 + random() * 0.6) * 100) / 100,
      },
      beatAnchor: seed.bpm ? { beatIndex: beat, offset: at(0) } : null,
      transitionIn:
        index > 0 && index === frames.length - 1 && seed.n % 3 === 0
          ? { kind: 'dissolve', before: at(4), after: at(4), direction: null, confidence: 0.8 }
          : null,
      speedRamp: null,
    };
    start += length;
    beat += seed.slots[index] ?? 0;
    return slot;
  });
}

function overlay(role: Overlay['role'], slot: Slot, slotIndex: number, y: number, chars: number): Overlay {
  return {
    role,
    start: slot.start,
    duration: slot.duration,
    slotIndex,
    box: { x: 0.08, y, width: 0.84, height: 0.08 },
    appearance: {
      size: 0.035,
      align: 'center',
      case: role === 'title' ? 'upper' : 'mixed',
      background: 'none',
    },
    styleKey: role === 'title' ? 'title' : 'label',
    reveal: role === 'title' ? 'wordByWord' : 'pop',
    language: null,
    placeholder: HUB_ROLE_PLACEHOLDERS[role],
    words: Math.max(1, Math.round(chars / 6)),
    chars,
  };
}

function overlaysOf(seed: HubSeed, slots: readonly Slot[]): Overlay[] {
  const first = slots[0];
  const last = slots.at(-1);
  if (!first || !last) return [];
  const text = [overlay('title', first, 0, 0.18, 18 + (seed.n % 9))];
  if (seed.formatId === 'tutorial')
    slots.slice(1, -1).forEach((slot, i) => text.push(overlay('list', slot, i + 1, 0.72, 22)));
  if (seed.formatId === 'ugcAd') text.push(overlay('cta', last, slots.length - 1, 0.74, 14));
  if (seed.formatId === 'podcastClip' || seed.formatId === 'talkingHead')
    slots.slice(1).forEach((slot, i) => text.push(overlay('caption', slot, i + 1, 0.66, 32)));
  return text.map((item) => ({ ...item, language: seed.language }));
}

const isoDay = (epochMs: number) => new Date(epochMs).toISOString().slice(0, 10);

export function buildHubDocument(seed: HubSeed, now: number): Doc {
  const frames = slotFrames(seed);
  const total = frames.reduce((sum, length) => sum + length, 0);
  const slots = slotsOf(seed, frames);
  const sorted = [...frames].sort((a, b) => a - b);
  const beats = seed.bpm ? Math.floor((total / 30) * (seed.bpm / 60)) + 1 : 0;
  return {
    format: HUB_FORMAT,
    formatVersion: HUB_FORMAT_VERSION,
    licence: 'CC0-1.0',
    id: hubIdOf(seed.n),
    version: 1 + (seed.n % 3),
    name: seed.name,
    description: seed.description,
    handle: seed.handle,
    language: seed.language,
    tags: [...seed.tags],
    formatId: seed.formatId,
    trendFreshness: seed.trendDays === null ? null : isoDay(now - seed.trendDays * DAY_MS),
    forkedFrom: seed.n === 32 ? { id: hubIdOf(14), version: 1 + (14 % 3) } : null,
    structure: {
      canvas: { width: 1080, height: 1920, rate: FPS },
      duration: at(total),
      slots,
      beatMap: seed.bpm
        ? {
            rate: MS,
            beats: Array.from({ length: beats }, (_, i) => ({
              value: Math.round((i * 60_000) / (seed.bpm ?? 1)),
              rate: MS,
            })),
            downbeats: Array.from({ length: Math.ceil(beats / 4) }, (_, i) => i * 4),
            bpm: seed.bpm,
            beatsPerBar: 4,
            confidence: 0.9,
            source: 'tracker',
          }
        : null,
      text: overlaysOf(seed, slots),
      audio: {
        kind: seed.bpm ? 'music' : 'voice',
        loudnessLufs: seed.bpm ? -9.5 : -16,
        speechCoverage: seed.bpm ? null : 0.82,
        speechLanguage: seed.bpm ? null : seed.language,
      },
      pacing: {
        shotCount: slots.length,
        meanShot: at(Math.round(total / slots.length)),
        medianShot: at(sorted[Math.floor(sorted.length / 2)] ?? total),
        shortestShot: at(sorted[0] ?? total),
        longestShot: at(sorted.at(-1) ?? total),
        hookEnd: at(Math.min(frames[0] ?? total, 90)),
        cutsOnBeat: seed.bpm ? 1 : null,
      },
    },
    style: null,
  };
}

export function indexEntryOf(seed: HubSeed, doc: Doc, now: number): HubIndexEntry {
  const updatedAt = now - seed.age * DAY_MS - seed.n * 60_000;
  return {
    id: doc.id,
    version: doc.version,
    name: doc.name,
    description: doc.description,
    handle: doc.handle,
    language: doc.language,
    tags: [...doc.tags],
    formatId: doc.formatId,
    trendFreshness: doc.trendFreshness,
    forkedFrom: doc.forkedFrom,
    duration: doc.structure.duration,
    slotCount: doc.structure.slots.length,
    bpm: doc.structure.beatMap?.bpm ?? null,
    slotStrip: doc.structure.slots.map((slot) => slot.duration.value),
    sha256: fakeHash(seed.n, HUB_KIND),
    createdAt: updatedAt - (doc.version - 1) * 7 * DAY_MS,
    updatedAt,
  };
}

export interface HubSeedSet {
  readonly entries: HubIndexEntry[];
  readonly documents: Map<HubTemplateId, Doc>;
  readonly ratings: Map<HubTemplateId, HubRating>;
}

export function seedHub(now: number): HubSeedSet {
  const entries: HubIndexEntry[] = [];
  const documents = new Map<HubTemplateId, Doc>();
  const ratings = new Map<HubTemplateId, HubRating>();
  for (const seed of HUB_SEEDS) {
    const doc = buildHubDocument(seed, now);
    documents.set(doc.id, doc);
    entries.push(indexEntryOf(seed, doc, now));
    if (seed.rating) ratings.set(doc.id, { count: seed.rating[0], mean: seed.rating[1] });
  }
  return { entries, documents, ratings };
}
