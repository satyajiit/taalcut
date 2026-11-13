// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: the option builders and the swap from another shot. A gap is offered the clip another shot has when it
 * clears casting's line here and fits better than what the gap has, with the shot that gives it up and what that shot
 * gets instead; another part of a used clip when one fits better; and Add more clips when new clips can be cast. A
 * borrow is a default only when the two shots fit better together and the giver isn't the opening shot. Answers name
 * an offered clip; two trades never touch one shot, and a shot that gives its clip up leaves the step's rows.
 */
import {
  answeredRows,
  chooseDefaults,
  gapRow,
  proposeFixes,
  settleTrades,
  tradeGain,
  type GapRow,
  type ProposalInput,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { borrowFrom, clip, madeUp, reuseOf, sure, unsure } from './ask-made-up';

const input: ProposalInput = {
  image: { ok: false, reason: 'localOnly' },
  stock: { ok: false, reason: 'localOnly' },
  addClips: true,
};

/** The owner's opening: an unsure neon sign (fits .45); shot 3 has the phone clip (fits .29 there, .85 here). */
function owner() {
  const base = madeUp([
    { state: 'weak', weak: unsure(0.45) },
    ...sure(1),
    { state: 'weak', weak: unsure(0.29) },
  ]);
  const [opening, , three] = base.slots;
  const neon = opening!.weak!.pick;
  const borrow = borrowFrom(three!, 0.85, { ...neon, fit: 0.32 });
  const timeline = {
    ...base,
    slots: [{ ...opening!, offers: { borrow: [borrow], reuse: [] } }, ...base.slots.slice(1)],
  };
  return { timeline, opening: timeline.slots[0]!, three: three!, borrow };
}

const rowsOf = (timeline: ReturnType<typeof owner>['timeline']) => {
  const open = timeline.slots.filter((s) => s.state === 'empty' || s.state === 'weak');
  const proposed = open.map((slot) => ({ slot, proposal: proposeFixes(slot, timeline, input) }));
  const chosen = chooseDefaults(timeline, proposed, { budgetLeftUsd: null });
  return proposed.map(({ slot, proposal }) =>
    gapRow(timeline.timelineId, slot, proposal, chosen.get(slot.gapId)!),
  );
};

describe('the fixes a gap is offered (FIX-ASK)', () => {
  it('an unsure clip: its swaps and keep, then the clip from another shot, Add more clips, film, drop', () => {
    const { timeline, opening } = owner();
    const { options } = proposeFixes(opening, timeline, input);
    expect(options.map((o) => o.kind)).toEqual(['keep', 'borrow', 'addClips', 'film', 'drop']);
    const borrow = options.find((o) => o.kind === 'borrow');
    expect(borrow?.kind === 'borrow' && borrow.candidates[0]).toMatchObject({
      description: 'Someone checks a phone on a bench',
      fit: 0.85,
      from: { number: 3, fit: 0.29 },
      instead: { description: 'A neon sign over a shop door at night', fit: 0.32 },
    });
  });

  it("offers another shot's clip only when it clears casting's line here and fits better than what is there", () => {
    const { timeline, opening, three } = owner();
    const weaker = borrowFrom(three, 0.4, clip('A tram', 0.3));
    const under = borrowFrom(three, 0.9, clip('A tram', 0.3), false);
    const offers = { borrow: [weaker, under], reuse: [] };
    const kinds = proposeFixes({ ...opening, offers }, timeline, input).options.map((o) => o.kind);
    expect(kinds).not.toContain('borrow');
  });

  it('an empty shot: another part of a used clip, Add more clips, film, drop; no Add more clips without the port', () => {
    const base = madeUp([...sure(2), { state: 'empty' }]);
    const gap = { ...base.slots[2]!, offers: { borrow: [], reuse: [reuseOf(base.slots[0]!, 0.6)] } };
    const { options } = proposeFixes(gap, base, input);
    expect(options.map((o) => o.kind)).toEqual(['reuse', 'addClips', 'film', 'drop']);
    const reuse = options[0];
    expect(reuse?.kind === 'reuse' && reuse.candidates[0]).toMatchObject({
      usedIn: 1,
      sourceStart: { value: 300 },
      description: 'A long walk down a lit walkway',
    });
    const without = proposeFixes(gap, base, { ...input, addClips: false }).options.map((o) => o.kind);
    expect(without).toEqual(['reuse', 'film', 'drop']);
  });
});

describe('the swap from another shot', () => {
  it('is the default when the two shots fit better together; the giving shot leaves the rows', () => {
    const { timeline, borrow, three } = owner();
    expect(tradeGain(timeline.slots[0]!, borrow)).toBeCloseTo(0.85 - 0.45 + (0.32 - 0.29));
    const rows = rowsOf(timeline);
    expect(rows[0]).toMatchObject({
      number: 1,
      fix: 'borrow',
      swapTo: { assetId: borrow.assetId, shotId: borrow.shotId },
      borrow: { clipId: three.gapId, number: 3, instead: { assetId: borrow.instead.assetId } },
    });
    expect(rows[0]?.why).toMatch(/Shot 3's clip fits this one clearly better/);
    // Shot 3 gives its clip up: the borrow says what it gets, so the step isn't also told to keep it.
    expect(answeredRows(rows, undefined).map((r) => [r.number, r.fix])).toEqual([[1, 'borrow']]);
  });

  it('is no default when the trade gains too little, or would take the opening shot’s clip', () => {
    const { timeline, opening, three } = owner();
    const small = borrowFrom(three, 0.5, clip('A tram', 0.3));
    const flat = {
      ...timeline,
      slots: [{ ...opening, offers: { borrow: [small], reuse: [] } }, ...timeline.slots.slice(1)],
    };
    expect(rowsOf(flat)[0]).toMatchObject({ fix: 'keep' });

    const base = madeUp([
      { state: 'weak', weak: unsure(0.2) },
      ...sure(1),
      { state: 'weak', weak: unsure(0.3) },
    ]);
    const fromOpening = borrowFrom(base.slots[0]!, 0.9, clip('A tram', 0.3));
    const three2 = { ...base.slots[2]!, offers: { borrow: [fromOpening], reuse: [] } };
    const taking = { ...base, slots: [base.slots[0]!, base.slots[1]!, three2] };
    expect(rowsOf(taking)[1]).toMatchObject({ number: 3, fix: 'keep' });
    // It is still offered: the person may choose it.
    expect(proposeFixes(three2, taking, input).options.map((o) => o.kind)).toContain('borrow');
  });

  it("applies the person's borrow or reuse only with a clip the card offered", () => {
    const { timeline, borrow, three } = owner();
    const rows = rowsOf(timeline).map((r): GapRow => ({ ...r, fix: 'keep', why: 'x' }));
    const offered = {
      borrows: () => [{ ...borrow, from: { gapId: three.gapId, number: 3 }, instead: borrow.instead }],
      reuses: () => [],
    };
    const gapId = rows[0]!.gapId;
    const take = { assetId: borrow.assetId, shotId: borrow.shotId };
    expect(answeredRows(rows, [{ gapId, fix: 'borrow', swapTo: take }], offered)[0]).toMatchObject({
      fix: 'borrow',
      swapTo: take,
      borrow: { clipId: three.gapId, number: 3 },
      why: 'The user chose it.',
    });
    const other = { assetId: clip(null, 0).assetId, shotId: null };
    expect(answeredRows(rows, [{ gapId, fix: 'borrow', swapTo: other }], offered)[0]).toMatchObject({
      fix: 'keep',
    });
  });

  it('Add more clips, once the run can no longer wait for them, keeps an unsure clip and films an empty shot', () => {
    const base = madeUp([{ state: 'weak', weak: unsure(0.3) }, { state: 'empty' }]);
    const rows = base.slots.map((slot) =>
      gapRow(base.timelineId, slot, proposeFixes(slot, base, input), { fix: 'drop', why: 'x' }),
    );
    const answer = rows.map((r) => ({ gapId: r.gapId, fix: 'addClips' as const }));
    expect(answeredRows(rows, answer).map((r) => r.fix)).toEqual(['keep', 'film']);
  });

  it('never lets two trades touch one shot or one clip: the first in shot order stands', () => {
    const base = madeUp([
      { state: 'weak', weak: unsure(0.2) },
      { state: 'weak', weak: unsure(0.2) },
      ...sure(1),
    ]);
    const giver = base.slots[2]!;
    const row = (index: number): GapRow => ({
      timelineId: base.timelineId,
      gapId: base.slots[index]!.gapId,
      slotId: null,
      number: index + 1,
      state: 'weak',
      intent: '',
      fixes: ['keep', 'borrow', 'film', 'drop'],
      fix: 'borrow',
      swapTo: giver.current!,
      borrow: { clipId: giver.gapId, number: 3, instead: base.slots[index]!.current! },
    });
    const settled = settleTrades([row(0), row(1)]);
    expect(settled.map((r) => [r.number, r.fix])).toEqual([
      [1, 'borrow'],
      [2, 'keep'],
    ]);
    expect(settled[1]?.why).toMatch(/Another change took that clip/);
  });
});
