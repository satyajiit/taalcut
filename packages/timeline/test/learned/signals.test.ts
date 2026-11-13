// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Signals to pairs, and the log folded into a start and the pairs since. */
import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../../src/casting/config';
import { foldLog } from '../../src/casting/learned/fold';
import { LEARNER_CONFIG } from '../../src/casting/learned/learner-config';
import { hasScore, signalPairs } from '../../src/casting/learned/signals';
import { scoredCandidate } from '../../src/test-support';
import {
  cast,
  clock,
  createEntry,
  deleteEntry,
  dropEntry,
  LEARNER,
  parts,
  slot,
  swapEntry,
  unscored,
  updateEntry,
} from './log-fixture';

const config = LEARNER_CONFIG;
const base = CASTING_CONFIG;

/** A slot whose pick leans on the description, its three alternates, and two slots beside it (one a person's). */
function board() {
  const pick = scoredCandidate(parts({ intent: 0.9, motion: 0.1 }));
  const moving = scoredCandidate(parts({ motion: 1 }));
  const sharp = scoredCandidate(parts({ quality: 0.9 }));
  const plain = scoredCandidate(parts());
  const swapped = slot(pick, [moving, sharp, plain]);
  const userPick = slot(scoredCandidate(parts({ subject: 0.9 })), [], 'userPick');
  const others = [slot(scoredCandidate(parts({ energy: 0.9 })), []), userPick];
  return { pick, moving, sharp, plain, swapped, userPick, before: cast([swapped, ...others]) };
}

describe('signalPairs', () => {
  it('turns a swap to an alternate into the replaced pick and the other shown alternates', () => {
    const { pick, moving, swapped, before } = board();
    const pairs = signalPairs(swapEntry(clock(), before, swapped, moving), config);
    expect(pairs.map((pair) => pair.weight)).toEqual([1, 0.25, 0.25]);
    expect(pairs[0]).toMatchObject({
      chosen: { motion: 1 },
      rejected: { intent: pick.parts.intent, motion: 0.1 },
    });
  });

  it('takes only the replaced pick from a search swap', () => {
    const { sharp, swapped, before } = board();
    expect(signalPairs(swapEntry(clock(), before, swapped, sharp, { from: 'search' }), config)).toHaveLength(
      1,
    );
  });

  it("skips the agent's swaps, undone swaps, and sides casting never scored", () => {
    const { moving, swapped, before } = board();
    expect(
      signalPairs(swapEntry(clock(), before, swapped, moving, { from: 'agent', source: 'agent' }), config),
    ).toEqual([]);
    expect(signalPairs(swapEntry(clock(), before, swapped, moving, { undone: true }), config)).toEqual([]);
    expect(
      signalPairs(swapEntry(clock(), before, swapped, scoredCandidate(parts()), { from: 'search' }), config),
    ).toEqual([]);
    const placed = unscored();
    const shown = scoredCandidate(parts({ motion: 1 }));
    const manual = slot(placed, [shown], 'userPick');
    expect(hasScore(placed)).toBe(false);
    expect(signalPairs(swapEntry(clock(), cast([manual]), manual, shown), config)).toEqual([]);
  });

  it('weighs a removal at a quarter, shared over the casting picks kept beside it', () => {
    const { swapped, before } = board();
    const pairs = signalPairs(dropEntry(clock(), before, swapped), config);
    // The kept user pick isn't casting's: only the other casting pick is compared.
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ weight: 0.25, chosen: { energy: 0.9 }, rejected: { intent: 0.9 } });
    const third = slot(scoredCandidate(parts({ quality: 0.1 })), []);
    const shared = signalPairs(dropEntry(clock(), cast([...before.slots, third]), swapped), config);
    expect(shared.map((pair) => pair.weight)).toEqual([0.125, 0.125]);
  });

  it("doesn't count removing a person's own pick", () => {
    const { before, userPick } = board();
    expect(signalPairs(dropEntry(clock(), before, userPick), config)).toEqual([]);
  });
});

describe('foldLog', () => {
  const edited = { intent: 0.3, motion: 0.25, quality: 0.15, subject: 0.15, energy: 0.15 };
  const learnt = { intent: 0.35, motion: 0.2, quality: 0.15, subject: 0.15, energy: 0.15 };

  it('starts at the defaults and collects every applied swap', () => {
    const time = clock();
    const { moving, sharp, swapped, before } = board();
    const folded = foldLog(
      [swapEntry(time, before, swapped, moving), swapEntry(time, before, swapped, sharp)],
      base,
      config,
    );
    expect(folded.start).toEqual(base.weights);
    expect(folded.pairs).toHaveLength(6);
  });

  it("starts from a person's edit and spends the pairs before it", () => {
    const time = clock();
    const { moving, sharp, swapped, before } = board();
    const id = newId<'MemoryItem'>();
    const entries = [
      swapEntry(time, before, swapped, moving),
      createEntry(time, id, learnt),
      updateEntry(time, id, edited),
      swapEntry(time, before, swapped, sharp, { from: 'search' }),
    ];
    const folded = foldLog(entries, base, config);
    expect(folded.start).toEqual(edited);
    expect(folded.pairs).toHaveLength(1);
  });

  it('resets to the defaults when the item is deleted, and not when the delete was undone', () => {
    const time = clock();
    const { moving, swapped, before } = board();
    const id = newId<'MemoryItem'>();
    const entries = [
      createEntry(time, id, edited, { source: 'ui' }),
      swapEntry(time, before, swapped, moving),
    ];
    expect(foldLog([...entries, deleteEntry(time, id)], base, config)).toEqual({
      start: base.weights,
      pairs: [],
    });
    const kept = foldLog([...entries, deleteEntry(time, id, { undone: true })], base, config);
    expect(kept.start).toEqual(edited);
    expect(kept.pairs).toHaveLength(3);
  });

  it("keeps the learner's own writes as outputs, and an undone one spends the pairs that led to it", () => {
    const time = clock();
    const { moving, sharp, swapped, before } = board();
    const id = newId<'MemoryItem'>();
    const swaps = [swapEntry(time, before, swapped, moving), swapEntry(time, before, swapped, sharp)];
    const applied = foldLog([...swaps, createEntry(time, id, learnt, LEARNER)], base, config);
    expect(applied.start).toEqual(base.weights);
    expect(applied.pairs).toHaveLength(6);
    const undone = foldLog(
      [
        ...swaps,
        createEntry(time, id, learnt, LEARNER),
        updateEntry(time, id, edited, { ...LEARNER, undone: true }),
      ],
      base,
      config,
    );
    expect(undone).toEqual({ start: learnt, pairs: [] });
  });

  it('is the same whatever order the reader returned the entries in', () => {
    const time = clock();
    const { moving, plain, swapped, before } = board();
    const id = newId<'MemoryItem'>();
    const first = swapEntry(time, before, swapped, moving);
    const update = updateEntry(time, id, edited);
    const create = createEntry(time, id, learnt, { source: 'ui' });
    // The update written a moment after the create, though the log numbered it first.
    const entries = [
      first,
      { ...update, createdAt: create.createdAt + 1 },
      create,
      swapEntry(time, before, swapped, plain),
    ];
    expect(JSON.stringify(foldLog([...entries].reverse(), base, config))).toBe(
      JSON.stringify(foldLog(entries, base, config)),
    );
  });
});
