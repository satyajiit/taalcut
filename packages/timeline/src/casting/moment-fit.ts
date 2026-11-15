// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: how well each part of a shot shows what a slot states (SPEC, "MOM1: the part of a shot").
 *
 * Vision's describe stage splits a shot into moments, each with a note of what the camera shows in it, in the
 * model's own words (core's `ShotProfileMoment`, with the note's vector). A slot states what it should show: its
 * intent and its needs, which the cast embeds (`SlotSpec.intentVector`, `SlotNeed.vector`). Nothing here knows what
 * a note or an ask is about: there is no word list, only what the two models said, compared by meaning.
 *
 * A raw cosine misleads. On the owner's footage a note of the lens being covered by an arm sat nearer most of a
 * template's intents than a note of what the shot was filmed for: intents are written in camera words, and so is a
 * note of the camera doing nothing. So a moment's fit to a slot is its *lift*: how far its cosine to this slot's
 * asks stands above its median cosine to every slot of the template (`askSet`), less `margin`, never under 0. A note
 * that sits as near every slot as this one says nothing about this one; a note that names what this slot alone asks
 * for stands out. A window's fit is its moments' lifts by the time each plays in it.
 *
 * The fit is read relative to the shot's own best window of the same length: a window loses nothing within `slack`
 * of the best, up to `weight` from `scale` under it. A shot with no moments, moments with no vectors yet, a slot that
 * states nothing, or a template with fewer than three slots that state something has no fit, and everything stays as
 * it was before MOM1.
 *
 * MOM2: a moment the describer states as the camera being handled (`handling`, handling.ts) fits no slot: its lift
 * is 0 whatever its note says, so nothing a handling stretch happens to show draws a window to it, and QA's better
 * part is never one.
 */
import type { ShotProfile } from '@taalcut/core';
import type { CastingConfig } from './config';
import type { SlotSpec } from './slots';

type ContentConfig = CastingConfig['inPoint']['content'];
type Asking = Pick<SlotSpec, 'intentVector' | 'needs' | 'askSet'>;

/** Fewer slots that state something than this give no median worth standing above. */
const MIN_ASKING_SLOTS = 3;

/** The vectors of what a slot states: its intent's, then each need's. Empty before a cast embeds them. */
export function slotAsks(slot: Pick<SlotSpec, 'intentVector' | 'needs'>): Float32Array[] {
  return [slot.intentVector ?? null, ...slot.needs.map((need) => need.vector)].filter(
    (vector): vector is Float32Array => !!vector && vector.length > 0,
  );
}

/** The specs, each with every slot's asks (its own included): what a moment's fit to one slot is read against. */
export function withAskSet<S extends Pick<SlotSpec, 'intentVector' | 'needs'>>(
  specs: readonly S[],
): (S & { readonly askSet: readonly (readonly Float32Array[])[] })[] {
  const askSet = specs.map(slotAsks).filter((asks) => asks.length > 0);
  return specs.map((spec) => ({ ...spec, askSet }));
}

function cosine(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let index = 0; index < length; index++) {
    const x = a[index] as number;
    const y = b[index] as number;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
}

/** A note's mean cosine to one slot's asks. */
const near = (asks: readonly Float32Array[], note: Float32Array) =>
  asks.reduce((sum, ask) => sum + cosine(ask, note), 0) / asks.length;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

export interface PartFit {
  /** Each moment's lift for this slot (0 for a handling one); one whose note has no vector yet has the others' mean. */
  readonly moments: readonly number[];
  /** The fit of the frames [from, to) of the shot, by the time each moment plays in them. */
  fit(from: number, to: number): number;
  /** The best window of `window` frames that fits in the shot: its (first) start and its fit. */
  best(window: number): { readonly start: number; readonly fit: number };
}

/**
 * The shot's parts against a slot's `asks`, read against every slot's (`askSet`); null when there is nothing to
 * compare: no ask, too few slots that state something, or fewer than two moments with a vector (one moment says the
 * same of every window).
 */
export function partFit(
  profile: ShotProfile,
  asks: readonly Float32Array[],
  askSet: readonly (readonly Float32Array[])[] | undefined,
  margin: number,
): PartFit | null {
  const moments = profile.moments ?? [];
  const length = Math.floor(profile.range.duration.value);
  const slots = (askSet ?? []).filter((entry) => entry.length > 0);
  if (asks.length === 0 || slots.length < MIN_ASKING_SLOTS || moments.length < 2 || !(length > 0))
    return null;
  const known = moments.map((moment) => {
    // MOM2: what a handling stretch happens to show is not footage for any slot.
    if (moment.handling) return 0;
    const note = moment.vector;
    if (!note || note.length === 0) return null;
    const usual = median(slots.map((entry) => near(entry, note)));
    return Math.max(0, near(asks, note) - usual - margin);
  });
  const values = known.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const fits = known.map((value) => value ?? mean);
  // Running sums by frame: a frame no moment covers (there should be none) reads as the mean.
  const sums = new Float64Array(length + 1);
  const perFrame = new Float64Array(length).fill(mean);
  moments.forEach((moment, index) => {
    const from = Math.max(0, Math.min(length, Math.round(moment.start)));
    const to = Math.max(from, Math.min(length, Math.round(moment.end)));
    perFrame.fill(fits[index] as number, from, to);
  });
  for (let frame = 0; frame < length; frame++)
    sums[frame + 1] = (sums[frame] as number) + (perFrame[frame] as number);
  const fit = (from: number, to: number) => {
    const a = Math.max(0, Math.min(length, Math.round(from)));
    const b = Math.max(a, Math.min(length, Math.round(to)));
    return b > a ? ((sums[b] as number) - (sums[a] as number)) / (b - a) : mean;
  };
  const bests = new Map<number, { start: number; fit: number }>();
  const best = (window: number) => {
    const size = Math.max(1, Math.min(length, Math.round(window)));
    let found = bests.get(size);
    if (!found) {
      found = { start: 0, fit: fit(0, size) };
      for (let start = 1; start + size <= length; start++) {
        const value = fit(start, start + size);
        if (value > found.fit + 1e-12) found = { start, fit: value };
      }
      bests.set(size, found);
    }
    return found;
  };
  return { moments: fits, fit, best };
}

const cache = new WeakMap<ShotProfile, WeakMap<Asking, PartFit | null>>();

/** `partFit` of a shot for a slot, kept for the cast: the in-point rule asks for it once per candidate window. */
export function partFitFor(profile: ShotProfile, slot: Asking, config: ContentConfig): PartFit | null {
  let bySlot = cache.get(profile);
  if (!bySlot) cache.set(profile, (bySlot = new WeakMap()));
  let found = bySlot.get(slot);
  if (found === undefined)
    bySlot.set(slot, (found = partFit(profile, slotAsks(slot), slot.askSet, config.margin)));
  return found;
}

/** What a window `under` the best fit loses: nothing within `slack`, `weight` from `scale`, a line between. */
export function missCost(under: number, config: ContentConfig): number {
  const span = Math.max(1e-9, config.scale - config.slack);
  return config.weight * Math.min(1, Math.max(0, (under - config.slack) / span));
}

/**
 * The content term of the in-point rule: what each window of `window` media frames (by its start, from the shot's
 * start) loses for showing what the slot states less well than the shot's best window. Null when there is no fit.
 */
export function contentPenalty(
  profile: ShotProfile,
  slot: Asking,
  window: number,
  config: ContentConfig,
): ((start: number) => number) | null {
  if (!(config.weight > 0) || profile.kind === 'image') return null;
  const parts = partFitFor(profile, slot, config);
  if (!parts) return null;
  const best = parts.best(window).fit;
  return (start) => missCost(best - parts.fit(start, start + window), config);
}
