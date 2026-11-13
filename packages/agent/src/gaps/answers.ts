// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gaps with the person's answer applied (SPEC section 26), pure: their fix where they gave one the gap offers,
 * film for all on a no (FIX-GAPS: an unsure clip stays on a no). A swap, a borrow or a reuse counts only with a clip
 * the card offered that gap. FIX-ASK: Add more clips is the run's to act on (it waits for the clips, then casts
 * again); when it can't any more, the gap waits for footage. Every answer ends with the trades made safe.
 */
import type { GapFixKind, RationalTime } from '@taalcut/core';
import type { GapRow, SwapTarget } from './gap-types';
import { settleTrades } from './trades';

/** A gap's answer: the fix, and for a swap, a borrow or a reuse the clip the person chose. */
export interface GapAnswer {
  readonly gapId: string;
  readonly fix: GapFixKind;
  readonly swapTo?: SwapTarget;
}

/** The clips a card offered each gap, by gap id (what an answer's swapTo may name). */
export interface OfferedClips {
  readonly swaps?: (gapId: string) => readonly SwapTarget[];
  readonly borrows?: (gapId: string) => readonly (SwapTarget & {
    readonly from: { readonly gapId: string; readonly number: number };
    readonly instead: SwapTarget;
  })[];
  readonly reuses?: (gapId: string) => readonly (SwapTarget & { readonly sourceStart: RationalTime })[];
}

const sameShot = (a: SwapTarget, b: SwapTarget) => a.assetId === b.assetId && a.shotId === b.shotId;
const media = (shot: SwapTarget): SwapTarget => ({ assetId: shot.assetId, shotId: shot.shotId });

type Bare = Omit<GapRow, 'swapTo' | 'borrow' | 'sourceStart'>;
const bare = ({ swapTo: _s, borrow: _b, sourceStart: _t, ...row }: GapRow): Bare => row;

/** An unsure clip stays; an empty shot waits for footage. */
function waits(row: Bare, why: string): GapRow {
  return row.state === 'weak' && row.fixes.includes('keep')
    ? { ...row, fix: 'keep', why }
    : { ...row, fix: 'film', why };
}

/** The row for one answer, or undefined when it names a clip the gap wasn't offered (its default stands). */
function answered(row: GapRow, given: GapAnswer, offered: OfferedClips): GapRow | undefined {
  const rest = bare(row);
  const chose = 'The user chose it.';
  const target = given.swapTo;
  switch (given.fix) {
    case 'swap': {
      const shot = target ? offered.swaps?.(row.gapId).find((c) => sameShot(c, target)) : undefined;
      return shot ? { ...rest, fix: 'swap', swapTo: media(shot), why: chose } : undefined;
    }
    case 'borrow': {
      const shot = target ? offered.borrows?.(row.gapId).find((c) => sameShot(c, target)) : undefined;
      return shot
        ? {
            ...rest,
            fix: 'borrow',
            swapTo: media(shot),
            borrow: { clipId: shot.from.gapId, number: shot.from.number, instead: media(shot.instead) },
            why: chose,
          }
        : undefined;
    }
    case 'reuse': {
      const shot = target ? offered.reuses?.(row.gapId).find((c) => sameShot(c, target)) : undefined;
      return shot
        ? { ...rest, fix: 'reuse', swapTo: media(shot), sourceStart: shot.sourceStart, why: chose }
        : undefined;
    }
    case 'addClips':
      return waits(rest, 'It waits for the clips the user adds.');
    default:
      return { ...rest, fix: given.fix, why: chose };
  }
}

/**
 * The rows with the user's answer applied. Undefined: not asked, the defaults stand. [] (or a no): every unsure clip
 * stays and every empty shot waits for footage.
 */
export function answeredRows(
  rows: readonly GapRow[],
  answer: readonly GapAnswer[] | undefined,
  offered: OfferedClips = {},
): GapRow[] {
  if (answer === undefined) return settleTrades(rows);
  if (answer.length === 0)
    return rows.map((row) =>
      waits(
        bare(row),
        row.state === 'weak'
          ? 'The user declined the fixes; the pick stays as it is.'
          : 'The user declined the fixes; it waits for footage.',
      ),
    );
  const byGap = new Map(answer.map((a) => [a.gapId, a]));
  return settleTrades(
    rows.map((row) => {
      const given = byGap.get(row.gapId);
      if (!given || !row.fixes.includes(given.fix)) return row;
      return answered(row, given, offered) ?? row;
    }),
  );
}
