// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The Trending sounds & hooks shelf's sounds, as the connected shelf lists them (apps/renderer/src/features/make/
 * edits-pulse.tsx and edits-pulse-model.ts at d9ab77925): the feed's tabs, the licence filter, the search, each
 * sound's hook drops in seconds, and what Cut with AI lays on it. Pure, so test/unit/showcase-instagram-edits.test.ts
 * can hold it.
 *
 * The titles are plain names that pose as no real artist or song; the artist is "Original audio" or the visitor's own
 * handle. Each sound's rhythm is a real one: the music beats of one of the owner's three reels (#content/reels, from
 * Taalcut's breakdown), their spacing kept and paced, so the waveforms and the cuts sit on beats a reel really has.
 */

import { SAMPLE_REELS } from '#content/reels';
import type { SlotRole } from '#content/schema';

/** The shelf's tabs, in the app's order and words. */
export const FEED_TABS = ['Trending', 'For You', 'Original audio', 'Royalty-free', 'Saved'] as const;
export type FeedTab = (typeof FEED_TABS)[number];

/** The tabs the showcase puts on show: the story needs what is trending, what is for you and what you saved. The
 *  licence filter beside them covers royalty-free; the page's words name every tab. */
export const SHOWN_TABS: readonly FeedTab[] = ['Trending', 'For You', 'Saved'];

/** The licence filter, in the app's words (edits-pulse.tsx). */
export type LicenceFilter = 'any' | 'royalty_free' | 'licensed';
export const LICENCES: readonly { readonly value: LicenceFilter; readonly label: string }[] = [
  { value: 'any', label: 'All audio' },
  { value: 'royalty_free', label: 'Royalty-free' },
  { value: 'licensed', label: 'Licensed' },
];

export interface Sound {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** The feed tabs it is listed under (Saved is the visitor's own list). */
  readonly tabs: readonly Exclude<FeedTab, 'Saved'>[];
  /** Royalty-free or licensed music, or someone's original audio (neither: only All audio lists it). */
  readonly licence: 'royalty_free' | 'licensed' | 'original';
  /** Whose rhythm it has: one of the owner's reels. */
  readonly reel: 'airport' | 'vietnam' | 'repeat';
  /** Its beats' spacing against the reel's: below 1 is quicker. */
  readonly pace: number;
  readonly durationSec: number;
  /** The beats its hook drops land on, by index. */
  readonly hookBeats: readonly number[];
  /** Varies the waveform's grain, so no two sounds look alike. */
  readonly seed: number;
  /** The reel it would cut: the clip from the owner's camera roll its cut opens on. */
  readonly clipId: string;
}

export const SOUNDS: readonly Sound[] = [
  { id: 'boarding', title: 'Boarding call bounce', artist: 'Original audio', tabs: ['Trending', 'For You'], licence: 'licensed', reel: 'airport', pace: 1, durationSec: 18, hookBeats: [6, 22], seed: 3, clipId: 'airport-06' },
  { id: 'night-market', title: 'Night market loop', artist: 'Original audio', tabs: ['Trending', 'Original audio'], licence: 'original', reel: 'vietnam', pace: 1, durationSec: 15, hookBeats: [5], seed: 11, clipId: 'vietnam-02' },
  { id: 'lantern', title: 'Lantern walk', artist: 'Original audio', tabs: ['Trending', 'Royalty-free'], licence: 'royalty_free', reel: 'vietnam', pace: 1.08, durationSec: 21, hookBeats: [8, 24], seed: 7, clipId: 'repeat-06' },
  { id: 'runway', title: 'Runway hum', artist: 'Original audio', tabs: ['Trending'], licence: 'licensed', reel: 'airport', pace: 0.94, durationSec: 24, hookBeats: [10], seed: 19, clipId: 'airport-07' },
  { id: 'palm-deck', title: 'Palm deck groove', artist: 'Original audio', tabs: ['For You'], licence: 'licensed', reel: 'repeat', pace: 0.96, durationSec: 16, hookBeats: [7], seed: 5, clipId: 'repeat-15' },
  { id: 'gate', title: 'Gate to gate shuffle', artist: 'Original audio', tabs: ['For You', 'Royalty-free'], licence: 'royalty_free', reel: 'airport', pace: 1.05, durationSec: 20, hookBeats: [4, 16], seed: 23, clipId: 'airport-03' },
  { id: 'voiceover', title: 'My trip, in my words', artist: '@yourname', tabs: ['Original audio'], licence: 'original', reel: 'vietnam', pace: 1.12, durationSec: 14, hookBeats: [3], seed: 13, clipId: 'repeat-10' },
  { id: 'bay', title: 'Bay breeze', artist: 'Original audio', tabs: ['Royalty-free'], licence: 'royalty_free', reel: 'repeat', pace: 1.1, durationSec: 19, hookBeats: [9], seed: 29, clipId: 'repeat-02' },
];

/** Saved to begin with: one the visitor kept earlier (the app starts its Saved tab with one too). */
export const FIRST_SAVED: readonly string[] = ['night-market'];

export function soundById(id: string): Sound {
  return SOUNDS.find((s) => s.id === id) ?? (SOUNDS[0] as Sound);
}

/** What a tab, the licence filter and the search leave on the shelf, in the shelf's order. */
export function soundsIn(tab: FeedTab, licence: LicenceFilter, query: string, saved: ReadonlySet<string>): Sound[] {
  const q = query.trim().toLowerCase();
  return SOUNDS.filter((s) => (tab === 'Saved' ? saved.has(s.id) : s.tabs.includes(tab)))
    .filter((s) => licence === 'any' || s.licence === licence)
    .filter((s) => !q || s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
}

/** A sound's music beats, in seconds: its reel's spacing, paced, repeated to the sound's end. */
export function beatsOf(sound: Sound): number[] {
  const reel = SAMPLE_REELS.find((r) => r.id === sound.reel) ?? SAMPLE_REELS[0];
  const source = reel?.beats ?? [];
  const gaps = source.slice(1).map((b, i) => b - (source[i] ?? 0)).filter((g) => g > 0.2);
  if (gaps.length === 0) return [];
  const beats: number[] = [];
  let at = 0.4 * sound.pace;
  for (let i = 0; at < sound.durationSec - 0.2; i += 1) {
    beats.push(Math.round(at * 1000) / 1000);
    at += (gaps[i % gaps.length] ?? 0.5) * sound.pace;
  }
  return beats;
}

/** Where its hooks drop, in seconds, each on a beat. */
export function hooksOf(sound: Sound): number[] {
  const beats = beatsOf(sound);
  return sound.hookBeats.flatMap((i) => (beats[i] === undefined ? [] : [beats[i]]));
}

/** A hook drop as the shelf writes it: seconds to one place ("3.1s"). */
export function hookLabel(seconds: number): string {
  return `${(Math.round(seconds * 10) / 10).toFixed(1)}s`;
}

/** A small deterministic grain for the waveform, 0 to 1. */
function grain(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface WaveBar {
  /** Its height, 0.12 to 1. */
  readonly level: number;
  /** Its time, in seconds (the bar's middle). */
  readonly at: number;
  /** It falls on a hook drop. */
  readonly hook: boolean;
}

/** The sound's waveform as `count` bars: loud on its beats, louder from the hook drop on. */
export function waveOf(sound: Sound, count: number): WaveBar[] {
  const beats = beatsOf(sound);
  const hooks = hooksOf(sound);
  const first = hooks[0] ?? sound.durationSec;
  const span = sound.durationSec / count;
  return Array.from({ length: count }, (_, i) => {
    const at = (i + 0.5) * span;
    const near = beats.reduce((d, b) => Math.min(d, Math.abs(b - at)), Infinity);
    const pulse = Math.exp(-((near / 0.12) ** 2));
    const lift = at >= first ? 1 : 0.72;
    const level = Math.min(1, Math.max(0.12, (0.26 + 0.52 * pulse + 0.22 * grain(sound.seed, i)) * lift));
    const hook = hooks.some((h) => Math.abs(h - at) <= Math.max(span, 0.3));
    return { level: Math.round(level * 100) / 100, at: Math.round(at * 100) / 100, hook };
  });
}

export interface CutSlot {
  readonly start: number;
  readonly end: number;
  readonly group: SlotRole;
}

/**
 * What Cut with AI lays on the sound: the hook up to the first hook drop, then a build, a fast run and an outro, every
 * cut on one of the sound's beats.
 */
export function cutOf(sound: Sound): CutSlot[] {
  const beats = beatsOf(sound);
  const hook = sound.hookBeats[0] ?? 4;
  const steps: readonly [SlotRole, number][] = [
    ['build', 2],
    ['build', 2],
    ['peak', 1],
    ['peak', 1],
    ['peak', 1],
    ['peak', 1],
    ['build', 2],
    ['outro', 3],
  ];
  const slots: CutSlot[] = [{ start: 0, end: beats[hook] ?? 0, group: 'hook' }];
  let at = hook;
  for (const [group, length] of steps) {
    const next = Math.min(at + length, beats.length - 1);
    if (next <= at) break;
    slots.push({ start: beats[at] ?? 0, end: beats[next] ?? 0, group });
    at = next;
  }
  return slots;
}

/** The clips the AI scored with Edits' vibe score as it cut, from the owner's camera roll; the first opens the cut. */
export const SCORED: readonly { readonly clipId: string; readonly words: string; readonly level: 1 | 2 | 3 }[] = [
  { clipId: 'repeat-05', words: 'A boat under the cliffs', level: 3 },
  { clipId: 'vietnam-04', words: 'A neon sign', level: 3 },
  { clipId: 'airport-09', words: 'City lights below', level: 2 },
  { clipId: 'repeat-12', words: 'City traffic', level: 1 },
];

/** A vibe score's level in words: the app shows a level, never a number out of a hundred. */
export const LEVEL_WORDS: Readonly<Record<1 | 2 | 3, string>> = { 1: 'Low', 2: 'Medium', 3: 'High' };
