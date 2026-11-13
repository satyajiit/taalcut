// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: a gap's clips from the rest of the video, pure. The owner's opening shot asked for someone checking a phone,
 * and the one clip that showed it was in shot 3, unsure there too; nothing offered to move it. `borrow` offers the clip
 * another shot has when it clears casting's line here and fits better than what this shot has, with the shot that
 * gives it up and what that shot gets instead, so no clip is used twice. `reuse` offers another part of a clip a shot
 * already shows, when the clip is long enough for two moments; it's offered, never a default. Two trades never touch
 * the same shot or clip: the first one in shot order stands.
 */
import { RationalTime, type GapFixOption } from '@taalcut/core';
import type { BorrowShot, GapRow, GapShot, GapSlot, ReuseShot, SwapTarget } from './gap-types';

/** At most this many clips per offer (core's limit). */
const OFFERED = 3;
/** A borrow is a default only when the two shots together fit at least this much better. */
export const BORROW_GAIN = 0.1;

const unit = (fit: number) => Math.min(1, Math.max(0, fit));
const view = (shot: GapShot) => ({
  assetId: shot.assetId,
  shotId: shot.shotId,
  description: shot.description?.slice(0, 300) ?? null,
  fit: unit(shot.fit),
});

/** How well the shot fits now: its unsure clip's fit, nothing for an empty one. */
const fitNow = (slot: GapSlot) => (slot.state === 'weak' ? (slot.weak?.pick.fit ?? 0) : 0);

/** Another shot's clips that clear casting's line here and fit better than what this shot has, best first. */
export function borrowable(slot: GapSlot): BorrowShot[] {
  const floor = fitNow(slot);
  return (slot.offers?.borrow ?? [])
    .filter((shot) => shot.better && shot.fit > floor)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, OFFERED);
}

/** Other parts of used clips that fit better than what this shot has, best first. */
export function reusable(slot: GapSlot): ReuseShot[] {
  const floor = fitNow(slot);
  return (slot.offers?.reuse ?? [])
    .filter((shot) => shot.fit > floor)
    .sort((a, b) => b.fit - a.fit)
    .slice(0, OFFERED);
}

/** The gap's borrow and reuse fixes, for its card row. */
export function tradeOptions(slot: GapSlot): GapFixOption[] {
  const borrow = borrowable(slot);
  const reuse = reusable(slot);
  return [
    ...(borrow.length > 0
      ? [
          {
            kind: 'borrow' as const,
            candidates: borrow.map((shot) => ({
              ...view(shot),
              from: { gapId: shot.from.gapId, number: shot.from.number, fit: unit(shot.from.fit) },
              instead: view(shot.instead),
            })),
          } as GapFixOption,
        ]
      : []),
    ...(reuse.length > 0
      ? [
          {
            kind: 'reuse' as const,
            candidates: reuse.map((shot) => ({
              ...view(shot),
              usedIn: shot.usedIn,
              sourceStart: shot.sourceStart,
            })),
          } as GapFixOption,
        ]
      : []),
  ];
}

/** How much better the two shots fit together after the trade (this shot's gain, the giving shot's loss). */
export function tradeGain(slot: GapSlot, shot: BorrowShot): number {
  return shot.fit - fitNow(slot) + (shot.instead.fit - shot.from.fit);
}

const key = (media: SwapTarget) => `${media.assetId}:${media.shotId ?? ''}`;

/** What trades so far have touched: the shots (by gap or clip id) and the clips they moved. */
export class Trades {
  private readonly shots = new Set<string>();
  private readonly clips = new Set<string>();

  /** Whether a borrow of `shot` into the gap is still clear of every trade so far. */
  clear(gapId: string, borrow: { readonly clipId: string; readonly instead: SwapTarget }, take: SwapTarget) {
    return (
      !this.shots.has(gapId) &&
      !this.shots.has(borrow.clipId) &&
      !this.clips.has(key(take)) &&
      !this.clips.has(key(borrow.instead))
    );
  }

  take(gapId: string, borrow: { readonly clipId: string; readonly instead: SwapTarget }, take: SwapTarget) {
    this.shots.add(gapId).add(borrow.clipId);
    this.clips.add(key(take)).add(key(borrow.instead));
  }
}

/**
 * The default borrow for a gap, if one: a clip that clears casting's line here, from a shot that isn't the opening,
 * whose trade makes the two shots fit at least BORROW_GAIN better together, and clear of the trades chosen so far.
 */
export function defaultBorrow(slot: GapSlot, trades: Trades): BorrowShot | undefined {
  return borrowable(slot)
    .filter((shot) => shot.from.number !== 1 && tradeGain(slot, shot) >= BORROW_GAIN)
    .sort((a, b) => tradeGain(slot, b) - tradeGain(slot, a))
    .find((shot) => trades.clear(slot.gapId, borrowOf(shot), shot));
}

/** A borrow as a row carries it. */
export const borrowOf = (shot: BorrowShot): NonNullable<GapRow['borrow']> => ({
  clipId: shot.from.gapId,
  number: shot.from.number,
  instead: { assetId: shot.instead.assetId, shotId: shot.instead.shotId },
});

/**
 * The rows with their trades made safe: a borrow that touches a shot or a clip an earlier trade took falls back
 * (an unsure clip stays, an empty shot waits for footage), and a shot that gives its clip up leaves the rows (the
 * borrow says what it gets instead), so the model never applies two fixes to one shot.
 */
export function settleTrades(rows: readonly GapRow[]): GapRow[] {
  const trades = new Trades();
  const kept: GapRow[] = [];
  for (const row of rows) {
    if (row.fix !== 'borrow' || !row.borrow || !row.swapTo) {
      kept.push(row);
      continue;
    }
    if (trades.clear(row.gapId, row.borrow, row.swapTo)) {
      trades.take(row.gapId, row.borrow, row.swapTo);
      kept.push(row);
      continue;
    }
    const { borrow: _b, swapTo: _s, ...rest } = row;
    kept.push(
      row.state === 'weak' && row.fixes.includes('keep')
        ? { ...rest, fix: 'keep', why: 'Another change took that clip, so this one stays.' }
        : { ...rest, fix: 'film', why: 'Another change took that clip, so it waits for footage.' },
    );
  }
  const givers = new Set(
    kept.flatMap((row) => (row.fix === 'borrow' && row.borrow ? [row.borrow.clipId] : [])),
  );
  return kept.filter((row) => !givers.has(row.gapId));
}

/** A reuse candidate's start, for a row: a copy, so the row is plain data. */
export const startOf = (shot: ReuseShot) => RationalTime.of(shot.sourceStart.value, shot.sourceStart.rate);
