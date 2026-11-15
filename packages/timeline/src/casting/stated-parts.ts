// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the part of a shot the model states for a slot (SPEC, "MOM1: the part of a shot"). The model reads each
 * shot's moments (what it shows from when to when) and names the stretch a slot should play: `from`, and `to` when it
 * wants one, in seconds of the shot's file, the clock `sourceStart`, `playsShotFrom` and the shown moments use.
 *
 * The tools enforce it. The stretch is brought inside the shot. One as long as the slot's window or longer limits
 * the window's start to it, and the in-point rule (settled, on the beat, sharp) chooses inside. A shorter one is
 * made just long enough: the window must hold the whole stretch, as far as the shot allows. A stated part never
 * locks the clip and applies only while that shot fills that slot.
 *
 * MOM2: a stated part is set aside when every window it allows rests on a stretch the describer states as the
 * camera being handled while the shot has a window that keeps off them (handling.ts): the in-point rule then
 * chooses among those, and the tools say the part was not used and where the clip plays from. Reported, not
 * refused: QA's `slotPart` would fail that window anyway, and a refusal would cost the model a whole cast to learn
 * what the answer can tell it. A part that reaches outside the handling stretch keeps the windows that are clear.
 */
import { RationalTime, type ShotId, type ShotProfile, type SlotId } from '@taalcut/core';
import { profileKey } from './catalog';
import type { SlotPool } from './candidates';
import { clearStarts, type HandlingConfig } from './handling';
import type { WindowTerms } from './in-points';

export interface StatedPart {
  readonly slotId: SlotId;
  readonly shotId: ShotId;
  /** Seconds in the shot's file where the stretch starts. */
  readonly from: number;
  /**
   * Where it ends. Absent (or not after `from`): the end of the moment that holds `from`; for a shot without
   * moments, the slot's own length on from there.
   */
  readonly to?: number;
}

export interface PartStarts {
  /** The window starts the part allows, in media frames from the shot's start: `first`..`last`. */
  readonly first: number;
  readonly last: number;
  /** The window lies inside the stated stretch; false when the stretch was made longer to hold the slot. */
  readonly inside: boolean;
}

/** The starts a stated part allows a window of `window` media frames; null when the shot can't hold the window. */
export function partStarts(
  profile: ShotProfile,
  window: number,
  part: Pick<StatedPart, 'from' | 'to'>,
): PartStarts | null {
  const length = Math.floor(profile.range.duration.value);
  const last = length - window;
  if (profile.kind === 'image' || window < 1 || last < 0) return null;
  const rate = profile.range.start.rate;
  const origin = RationalTime.toSeconds(profile.range.start);
  const frame = (seconds: number) =>
    Math.max(0, Math.min(length, Math.round(((seconds - origin) * rate.num) / rate.den)));
  const from = frame(part.from);
  const holding = (profile.moments ?? []).find((moment) => from >= moment.start && from < moment.end);
  const to =
    part.to !== undefined && part.to > part.from
      ? frame(part.to)
      : Math.min(length, holding ? holding.end : from + window);
  if (to - from >= window) return { first: from, last: to - window, inside: true };
  // Shorter than the slot: the window holds the whole stretch, as far as the shot allows.
  return { first: Math.max(0, Math.min(last, to - window)), last: Math.min(last, from), inside: false };
}

/**
 * MOM2: the stated part allows no window that keeps off the shot's handling stretches, though the shot has one: it
 * is set aside. False for a shot with no such stretch, one that can't keep off them, or one that can't hold the
 * window.
 */
export function partSetAside(
  profile: ShotProfile,
  window: number,
  part: Pick<StatedPart, 'from' | 'to'>,
  handling: HandlingConfig,
): boolean {
  const starts = partStarts(profile, window, part);
  const clear = starts ? clearStarts(profile, window, handling) : null;
  if (!starts || !clear) return false;
  for (let start = starts.first; start <= starts.last; start++) if (clear(start)) return false;
  return true;
}

/**
 * A stated part as terms on the in-point rule's windows; undefined when the shot can't hold the window, and (MOM2)
 * when the part is set aside for lying in a handling stretch.
 */
export function partTerms(
  profile: ShotProfile,
  window: number,
  part: Pick<StatedPart, 'from' | 'to'>,
  handling: HandlingConfig,
): WindowTerms | undefined {
  const starts = partStarts(profile, window, part);
  if (!starts || partSetAside(profile, window, part, handling)) return undefined;
  return { allowed: (start) => start >= starts.first && start <= starts.last };
}

/** The pools with the parts stated for their slots, by candidate key; a part for a slot the cast lacks is dropped. */
export function withParts(pools: readonly SlotPool[], parts: readonly StatedPart[] | undefined): SlotPool[] {
  if (!parts || parts.length === 0) return [...pools];
  return pools.map((pool) => {
    const stated = parts.filter((part) => part.slotId === pool.slot.slotId);
    return stated.length === 0
      ? pool
      : { ...pool, parts: new Map(stated.map((part) => [part.shotId as string, part])) };
  });
}

/** The part stated for this shot in this slot, if any. */
export function statedFor(
  parts: readonly StatedPart[] | undefined,
  slotId: string,
  profile: ShotProfile,
): StatedPart | undefined {
  const key = profileKey(profile);
  return parts?.find((part) => part.slotId === slotId && part.shotId === key);
}
