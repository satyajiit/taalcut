// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-STORY: swaps between two slots, for a library with no spare shot. An unsure slot with no alternate has
 * nothing a rerank can reorder, yet another slot's pick may fit it far better (an opening can take a shot without
 * the thing it names while the one shot that shows it fills another slot). So the cast offers, for such a slot, the picks of the
 * other slots that could change places with its own (`swapOptions`), and the Librarian may put one first in its
 * rerank. `planReranks` reads that as a swap on the cast the Librarian saw (the same cast again, without the
 * rerank): the slot takes that shot, the slot it leaves takes this slot's pick, and each is kept for its slot, so the
 * search can't undo the swap or use either shot twice. Both slots are marked reranked. A rerank never takes another
 * slot's pick except as its first choice, so the rest of an order stays inside the slot's own shots.
 */
import type { CastCandidate, FrameRate, SlotCast, SlotId } from '@taalcut/core';
import { candidateKey } from '../model/cast';
import { inContext, toCastCandidate, type Adjacency } from './alternates';
import type { Sequence } from './beam';
import type { Candidate, SlotPool } from './candidates';
import type { CastingConfig } from './config';

/** Another slot's pick that could fill this slot: scored here, with the slot it would leave. */
export interface SwapOption {
  readonly candidate: CastCandidate;
  readonly fromSlotId: SlotId;
}

/**
 * The picks of the other slots (locked ones aside) that can fill `slot` while their slot takes `slot`'s pick, each
 * scored in `slot` as it would be after the swap, best first, at most `limit`.
 */
export function swapOptions(
  pools: readonly SlotPool[],
  sequence: Sequence,
  slot: number,
  context: { readonly adjacency: Adjacency; readonly config: CastingConfig; readonly canvasRate: FrameRate },
  limit: number,
): SwapOption[] {
  const pool = pools[slot];
  const mine = sequence.picks[slot];
  if (!pool || pool.locked || !mine) return [];
  const here = new Map(pool.candidates.map((candidate) => [candidate.key, candidate]));
  const scored: { option: SwapOption; score: number; key: string }[] = [];
  sequence.picks.forEach((theirs, other) => {
    const there = pools[other];
    if (other === slot || !theirs || !there || there.locked) return;
    const incoming = here.get(theirs.key);
    const outgoing = there.candidates.find((candidate) => candidate.key === mine.key);
    if (!incoming || !outgoing) return;
    const picks: (Candidate | null)[] = [...sequence.picks];
    picks[slot] = incoming;
    picks[other] = outgoing;
    const entry = inContext(incoming, picks[slot - 1] ?? null, picks[slot + 1] ?? null, context.adjacency);
    const candidate = toCastCandidate(entry, pool, context.canvasRate, context.config);
    if (candidate)
      scored.push({
        option: { candidate, fromSlotId: there.slot.slotId },
        score: entry.score,
        key: incoming.key,
      });
  });
  return scored
    .sort((a, b) =>
      Math.abs(a.score - b.score) > context.config.tieEpsilon ? b.score - a.score : a.key < b.key ? -1 : 1,
    )
    .slice(0, limit)
    .map((entry) => entry.option);
}

/** What a rerank becomes once its swaps are read: each slot's order, and the shots kept for one slot. */
export interface RerankPlan {
  readonly rerank: readonly { readonly slotId: SlotId; readonly order: readonly string[] }[];
  /** Shot key → the slot it is kept for: no other slot's pool holds it. */
  readonly reserved: ReadonlyMap<string, string>;
  /**
   * The cast the Librarian saw with its swaps made, a key (or null) per slot: where the search starts as well as
   * from its own beam, so a rerank changes only what it swapped unless a move raises the score.
   */
  readonly seed: readonly (string | null)[];
}

/**
 * The rerank as the search runs it, on `base` (the first variant of the same cast without the rerank). An order
 * whose first shot is another slot's pick swaps the two slots (one swap per slot: the first that names it); every
 * other order keeps only its slot's own shots and spares. An order left with nothing is dropped, so that slot is
 * cast as if it hadn't been reranked.
 */
export function planReranks(
  rerank: readonly { readonly slotId: SlotId; readonly order: readonly string[] }[],
  base: { readonly slots: readonly SlotCast[] } | undefined,
): RerankPlan {
  const pickOf = new Map<string, string | null>();
  const owner = new Map<string, SlotId>();
  const locked = new Set<string>();
  for (const slot of base?.slots ?? []) {
    const key = slot.pick ? candidateKey(slot.pick) : null;
    pickOf.set(slot.slotId, key);
    // A user's pick is locked: it never moves, and no other slot takes it.
    if (key && slot.note === 'userPick') locked.add(key);
    else if (key) owner.set(key, slot.slotId);
  }
  const swapped = new Set<string>();
  const reserved = new Map<string, string>();
  const seed = new Map(pickOf);
  const out: { slotId: SlotId; order: string[] }[] = [];
  for (const entry of rerank) {
    if (swapped.has(entry.slotId)) continue;
    const mine = pickOf.get(entry.slotId) ?? null;
    const top = entry.order[0];
    const from = top === undefined ? undefined : owner.get(top);
    const ownShots = (key: string) => {
      const of = owner.get(key);
      return (of === undefined || of === entry.slotId) && !reserved.has(key) && !locked.has(key);
    };
    if (
      top !== undefined &&
      from !== undefined &&
      from !== entry.slotId &&
      !swapped.has(from) &&
      !reserved.has(top)
    ) {
      swapped.add(entry.slotId).add(from);
      reserved.set(top, entry.slotId);
      // The slot it leaves takes this one's pick, whatever its own order said earlier.
      const earlier = out.findIndex((planned) => planned.slotId === from);
      if (earlier >= 0) out.splice(earlier, 1);
      seed.set(entry.slotId, top);
      seed.set(from, mine);
      if (mine) {
        reserved.set(mine, from);
        out.push({ slotId: from, order: [mine] });
      }
      out.push({
        slotId: entry.slotId,
        order: [top, ...entry.order.slice(1).filter((key) => key !== mine && ownShots(key))],
      });
      continue;
    }
    const order = entry.order.filter(ownShots);
    if (order.length > 0) out.push({ slotId: entry.slotId, order });
  }
  return { rerank: out, reserved, seed: (base?.slots ?? []).map((slot) => seed.get(slot.slotId) ?? null) };
}
