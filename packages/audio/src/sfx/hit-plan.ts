// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Sound-effect hits on cuts (SPEC P3.6), pure: whip and slide → a whoosh whose peak lands on the cut; zoom → a
 * riser ending on the cut, then an impact; flash and glitch → an impact; a hard cut on a downbeat → a subtle hit;
 * dissolves and fades → nothing. Density picks the cuts: `everyCut` (hard cuts get a hit wherever they are),
 * `downbeats` (the default: transitions, and hard cuts on a downbeat), `hookOnly` (the downbeats rule in the first
 * 3 s). Hits keep 400 ms apart, skip a cut inside spoken voiceover unless the style is `punchy`, never overlap
 * (`withoutOverlaps`) and sit 14 dB under the bed. The pack sound for each is picked by turns, so a timeline
 * doesn't hear the same whoosh twice in a row.
 *
 * EAR1-D2: a sound may say which instant lands on the cut (`anchorMs`): an SFX bank take's apex, the centre of its
 * loudest 5 ms, or a kit role's sync point (onset, apex or end) less its offset. A pack sound (v1) has none and
 * keeps its peak, a riser its end.
 *
 * EAR1-R2: overlaps are resolved in the order of the sounds' apexes, not their starts. A bank take's lead-in can be
 * seconds long (a riser's 3.7 s), so the sound that starts first is often the later cut's; trimming it where the
 * next one starts cut it before its own apex. Now a sound keeps its apex and a short tail, and a next sound whose
 * lead-in reaches into that starts later, skipping into itself, its apex still on its cut. Templates' reel
 * effects (reel-sfx.ts) are placed and resolved by the same functions.
 */
import { SFX_CATEGORIES, type SfxCategory } from '@taalcut/core';
import type { Cut } from './cuts';
import type { SfxPackItem } from './pack-catalogue';

/** What planning needs of a sound: a pack item, or a generated one measured the same way, or a bank take. */
export type HitSound = Pick<SfxPackItem, 'id' | 'category' | 'durationMs' | 'peakMs' | 'loudnessLufs'> & {
  /** EAR1-D2: ms into the sound that lands on the cut (fractional; may be negative: it starts after the cut). */
  readonly anchorMs?: number;
};

export const HIT_DENSITIES = ['everyCut', 'downbeats', 'hookOnly'] as const;
export type HitDensity = (typeof HIT_DENSITIES)[number];
export const HIT_STYLES = ['subtle', 'punchy'] as const;
export type HitStyle = (typeof HIT_STYLES)[number];

export const HIT_CONFIG = {
  minSpacingMs: 400,
  hookMs: 3000,
  /** Pack sounds are levelled to this momentary-max loudness, then sit this far under the bed. */
  bedLufs: -16,
  underBedDb: -14,
  /** A subtle hit (hard cuts) sits a further 4 dB down. */
  subtleDb: -4,
  /** EAR1-R2: a sound plays at least this long past its apex before the next sound may start. */
  apexTailMs: 50,
} as const;

export interface PlannedHit {
  readonly cutIndex: number;
  /** EAR1-K3: timeline ms of the cut it was placed for (the hit's `cut`; its clip's sync point). */
  readonly cutMs: number;
  readonly category: SfxCategory;
  readonly item: HitSound;
  /** Timeline ms where the sound starts (its peak, or a riser's end, on the cut). */
  readonly startMs: number;
  /** Source ms into the sound where playing starts (> 0 when the cut is too near the start). */
  readonly sourceStartMs: number;
  readonly durationMs: number;
  readonly gainDb: number;
}

export interface Span {
  readonly startMs: number;
  readonly endMs: number;
}

function categoriesFor(cut: Cut, density: HitDensity): SfxCategory[] {
  switch (cut.transition) {
    case 'whip':
    case 'slide':
      return ['whoosh'];
    case 'zoom':
      return ['riser', 'impact'];
    case 'flash':
    case 'glitch':
      return ['impact'];
    case null:
      return density === 'everyCut' || cut.onDownbeat ? ['hit'] : [];
    default:
      return [];
  }
}

const levelled = (item: HitSound, category: SfxCategory) =>
  Math.max(
    -40,
    Math.min(
      0,
      HIT_CONFIG.underBedDb +
        (HIT_CONFIG.bedLufs - item.loudnessLufs) +
        (category === 'hit' ? HIT_CONFIG.subtleDb : 0),
    ),
  );

/** Pack sounds by category, taken in turn so neighbouring cuts don't repeat one sound. */
function soundPicker(items: readonly HitSound[]) {
  const turns = new Map<SfxCategory, number>(SFX_CATEGORIES.map((c) => [c, 0]));
  return (category: SfxCategory): HitSound | null => {
    const choices = items.filter((i) => i.category === category);
    if (choices.length === 0) return null;
    const turn = turns.get(category) ?? 0;
    turns.set(category, turn + 1);
    return choices[turn % choices.length] ?? null;
  };
}

/** The ms into a sound that lands on its cut: its own anchor, else a pack sound's peak (a riser's end). */
const anchorOf = (item: HitSound, category: SfxCategory) =>
  item.anchorMs ?? (category === 'riser' ? item.durationMs : item.peakMs);

/** Where a sound goes: its cut (index and timeline ms) and where its anchor lands (the cut, or a reel's offset). */
export interface HitTarget {
  readonly cutIndex: number;
  readonly cutMs: number;
  /** Default `cutMs`; a reel's effect: its cut plus the reel's offset. */
  readonly atMs?: number;
}

/**
 * One sound with its anchor on `target` (the cut, or the cut plus a reel's offset), trimmed at the timeline's ends
 * and levelled under the bed. Null when none of it is left to play.
 */
export function placeHit(
  target: HitTarget,
  category: SfxCategory,
  item: HitSound,
  timelineMs: number,
): PlannedHit | null {
  const { cutIndex, cutMs } = target;
  const startMs = (target.atMs ?? cutMs) - anchorOf(item, category);
  const sourceStartMs = Math.max(0, -startMs);
  const durationMs = Math.min(item.durationMs - sourceStartMs, timelineMs - Math.max(0, startMs));
  if (durationMs <= 0) return null;
  return {
    cutIndex,
    cutMs,
    category,
    item,
    startMs: Math.max(0, startMs),
    sourceStartMs,
    durationMs,
    gainDb: levelled(item, category),
  };
}

/** Where a planned sound's apex (its loudest moment, `peakMs`) is on the timeline. */
const apexAt = (hit: PlannedHit) => hit.startMs - hit.sourceStartMs + hit.item.peakMs;

/**
 * No overlaps on the one effects track (EAR1-R2). Sounds are taken in the order of their apexes (two on one cut,
 * a zoom's riser and impact, together, by their starts). A sound keeps its apex and `apexTailMs` after it; it stops
 * where the next starts, and a next sound whose lead-in would reach into that starts later instead, skipping into
 * itself, so its apex still lands where it was placed. Two sounds on one cut are one gesture: the riser gives way
 * where the impact starts. Hits that don't overlap are returned unchanged, by start.
 */
export function withoutOverlaps(hits: readonly PlannedHit[]): PlannedHit[] {
  const cutApex = new Map<number, number>();
  for (const hit of hits)
    cutApex.set(hit.cutIndex, Math.min(cutApex.get(hit.cutIndex) ?? Infinity, apexAt(hit)));
  const order = hits
    .map((hit, index) => ({ hit, index, key: cutApex.get(hit.cutIndex) ?? apexAt(hit) }))
    .sort((a, b) => a.key - b.key || a.hit.startMs - b.hit.startMs || a.index - b.index);
  const kept: PlannedHit[] = [];
  for (const { hit } of order) {
    const last = kept[kept.length - 1];
    if (!last || hit.startMs >= last.startMs + last.durationMs) {
      kept.push(hit);
      continue;
    }
    const lastEnd = last.startMs + last.durationMs;
    const keeps = Math.max(last.startMs, Math.min(lastEnd, apexAt(last) + HIT_CONFIG.apexTailMs));
    // Where the last stops and this one starts: where this one starts, unless that is inside the last's apex.
    const at =
      last.cutIndex === hit.cutIndex || hit.startMs >= keeps
        ? hit.startMs
        : Math.max(hit.startMs, Math.min(keeps, apexAt(hit)));
    const skip = at - hit.startMs;
    const next = {
      ...hit,
      startMs: at,
      sourceStartMs: hit.sourceStartMs + skip,
      durationMs: hit.durationMs - skip,
    };
    if (next.durationMs <= 0) continue;
    const lastMs = Math.min(last.durationMs, at - last.startMs);
    if (lastMs > 0) kept[kept.length - 1] = { ...last, durationMs: lastMs };
    else kept.pop();
    kept.push(next);
  }
  return kept.sort((a, b) => a.startMs - b.startMs);
}

export interface HitPlanInput {
  readonly cuts: readonly Cut[];
  readonly items: readonly HitSound[];
  readonly density?: HitDensity;
  readonly style?: HitStyle;
  /** Spoken voiceover, timeline ms. */
  readonly speech?: readonly Span[];
  readonly timelineMs: number;
}

/** A cut gets no hit past the hook (hookOnly) or, unless punchy, inside a spoken line. */
function skips(cut: Cut, input: HitPlanInput, density: HitDensity): 'stop' | 'skip' | null {
  if (density === 'hookOnly' && cut.ms > HIT_CONFIG.hookMs) return 'stop';
  if (input.style === 'punchy') return null;
  return (input.speech ?? []).some((s) => cut.ms > s.startMs && cut.ms < s.endMs) ? 'skip' : null;
}

export function planHits(input: HitPlanInput): PlannedHit[] {
  const density = input.density ?? 'downbeats';
  const pick = soundPicker(input.items);
  const hits: PlannedHit[] = [];
  let lastCutMs = -Infinity;
  for (const cut of input.cuts) {
    const skip = skips(cut, input, density);
    if (skip === 'stop') break;
    if (skip === 'skip' || cut.ms - lastCutMs < HIT_CONFIG.minSpacingMs) continue;
    const placed = categoriesFor(cut, density).flatMap((category) => {
      const item = pick(category);
      const hit = item
        ? placeHit({ cutIndex: cut.index, cutMs: cut.ms }, category, item, input.timelineMs)
        : null;
      return hit ? [hit] : [];
    });
    if (placed.length === 0) continue;
    hits.push(...placed);
    lastCutMs = cut.ms;
  }
  return withoutOverlaps(hits);
}
