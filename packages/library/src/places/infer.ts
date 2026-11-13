// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Each clip's place as the library settles it (LIB1-PLACE), from what every clip knows on its own:
 *
 * 1. Its own coordinates' city ('gps').
 * 2. Else the city of the clip from the same source shot nearest in time, within NEARBY_PLACE_MS, that has its own
 *    coordinates ('nearby'): a phone that tags photos and not videos, a clip a sharing app stripped.
 * 3. Else, from the UTC offset it was shot at, the countries that keep it ('zone', a hint). The offset is its own
 *    when the file names one, else a clip's from the same source within NEARBY_OFFSET_MS (LIB1-OEM's rule). Unknown
 *    is no offset at all (null); 0 is UTC itself, Lisbon or London in winter, a hint like any other.
 *
 * Pure: the refresh (refresh.ts) reads the clips and writes what this returns.
 */
import type { AssetId, CaptureOffset, Place } from '@taalcut/core';

/** A neighbour's coordinates count for a clip shot this close in time (a walk, a day out). */
export const NEARBY_PLACE_MS = 3 * 3_600_000;
/** A neighbour's offset counts this far (LIB1-OEM's captureOffset 'nearby'). */
export const NEARBY_OFFSET_MS = 12 * 3_600_000;

export type GpsPlace = Extract<Place, { basis: 'gps' }>;

export interface PlaceSubject {
  readonly assetId: AssetId;
  /** The source of its first location; clips borrow only from their own source. */
  readonly sourceId: string | null;
  readonly capturedAt: number | null;
  /** The offset the file itself names (LIB1-OEM's MediaFacts.captureOffsetMin); null when it names no zone. */
  readonly fileOffsetMin: number | null;
  /**
   * The offset LIB1-OEM borrowed for it from a clip nearby (`asset_borrowed_offsets`, the summary's captureOffset
   * from 'nearby'); null when it found none. Left out, this settles the borrowing by the same rule itself.
   */
  readonly borrowedOffsetMin?: number | null;
  /** Its own coordinates' city (library.place). */
  readonly own: GpsPlace | null;
  /** Its own coordinates, for distances on this Mac. */
  readonly coords: { readonly lat: number; readonly lon: number } | null;
}

export interface SettledPlace {
  readonly assetId: AssetId;
  readonly place: Place | null;
  readonly offset: CaptureOffset | null;
  /** The coordinates the place stands on: its own, or the neighbour's it borrowed. */
  readonly coords: { readonly lat: number; readonly lon: number } | null;
}

/** The index in `times` (sorted) nearest to `t` within `within`, or -1. */
function nearestIn(times: readonly number[], t: number, within: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (times[mid]! < t) low = mid + 1;
    else high = mid;
  }
  let best = -1;
  let bestGap = within;
  for (const i of [low - 1, low]) {
    if (i < 0 || i >= times.length) continue;
    const gap = Math.abs(times[i]! - t);
    if (gap <= bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

export interface SettleOptions {
  /** The countries that keep `offsetMin` at `at`, likeliest first (zones.ts). */
  readonly countriesAt: (offsetMin: number, at: number) => readonly string[];
}

export function settlePlaces(subjects: readonly PlaceSubject[], options: SettleOptions): SettledPlace[] {
  const bySource = new Map<string, PlaceSubject[]>();
  for (const s of subjects) {
    if (s.capturedAt === null || s.sourceId === null) continue;
    const list = bySource.get(s.sourceId) ?? [];
    list.push(s);
    bySource.set(s.sourceId, list);
  }
  const located = new Map<string, { times: number[]; of: PlaceSubject[] }>();
  const zoned = new Map<string, { times: number[]; of: PlaceSubject[] }>();
  for (const [source, list] of bySource) {
    const sorted = [...list].sort(
      (a, b) => a.capturedAt! - b.capturedAt! || a.assetId.localeCompare(b.assetId),
    );
    const gps = sorted.filter((s) => s.own !== null && s.coords !== null);
    const offsets = sorted.filter((s) => s.fileOffsetMin !== null);
    located.set(source, { times: gps.map((s) => s.capturedAt!), of: gps });
    zoned.set(source, { times: offsets.map((s) => s.capturedAt!), of: offsets });
  }
  const neighbour = (
    lists: Map<string, { times: number[]; of: PlaceSubject[] }>,
    s: PlaceSubject,
    within: number,
  ): PlaceSubject | null => {
    if (s.capturedAt === null || s.sourceId === null) return null;
    const list = lists.get(s.sourceId);
    if (!list) return null;
    const i = nearestIn(list.times, s.capturedAt, within);
    return i < 0 ? null : list.of[i]!;
  };

  return subjects.map((s): SettledPlace => {
    const ownOffset = s.fileOffsetMin;
    // The library's own borrowed offset when it has worked one out, so the hint and the clip's time agree.
    const lent = ownOffset !== null || s.borrowedOffsetMin === undefined ? undefined : s.borrowedOffsetMin;
    const near = ownOffset === null && lent === undefined ? neighbour(zoned, s, NEARBY_OFFSET_MS) : null;
    const offset: CaptureOffset | null =
      ownOffset !== null
        ? { minutes: ownOffset, from: 'file' }
        : lent !== undefined
          ? lent === null
            ? null
            : { minutes: lent, from: 'nearby' }
          : near && near.fileOffsetMin !== null
            ? { minutes: near.fileOffsetMin, from: 'nearby' }
            : null;
    if (s.own && s.coords) return { assetId: s.assetId, place: s.own, offset, coords: s.coords };
    const borrowed = neighbour(located, s, NEARBY_PLACE_MS);
    if (borrowed?.own && borrowed.coords && s.capturedAt !== null) {
      const place: Place = {
        ...borrowed.own,
        basis: 'nearby',
        from: borrowed.assetId,
        apartMs: Math.abs(borrowed.capturedAt! - s.capturedAt),
      };
      return { assetId: s.assetId, place, offset, coords: borrowed.coords };
    }
    if (offset && s.capturedAt !== null) {
      const countries = options.countriesAt(offset.minutes, s.capturedAt).slice(0, 3);
      if (countries.length > 0) {
        const place: Place = { basis: 'zone', offsetMin: offset.minutes, offsetFrom: offset.from, countries };
        return { assetId: s.assetId, place, offset, coords: null };
      }
    }
    return { assetId: s.assetId, place: null, offset, coords: null };
  });
}
