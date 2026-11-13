// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-GAPS: a weak pick is a gap too. With a scripted model on planted slots (slot 2's pick has a candidate that
 * clearly fits better, slot 4's has none), the gaps step gets both as `weak`, each offered swap (its candidates,
 * best fit first, with what they show and how well they fit), keep, film and drop. On autopilot slot 2 swaps to
 * the better clip and slot 4 keeps its clip, and the card says which, plainly. The person's swap to another
 * candidate goes through; one to a shot the card didn't offer doesn't. A swap the stored timeline doesn't show is
 * refused, and the step settles with the clip kept.
 */
import { type Card, type CardOf, unwrap } from '@taalcut/core';
import { answeredRows, type AgentEvent, type GapRow } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { ofType } from '../support/harness';
import { gapHarness } from './gap-harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/weak123/' };

function start(h: ReturnType<typeof gapHarness>) {
  return h.agent.start({
    conversationId: 'c1',
    projectId: h.world.projectId,
    message: 'Copy this reel',
    start: { path: 'reference', reference: reel },
  });
}

const gapCards = (events: readonly AgentEvent[]): CardOf<'gapFix'>[] =>
  ofType(events, 'card.sent')
    .map((e) => e.payload.card)
    .filter((c: Card): c is CardOf<'gapFix'> => c.type === 'gapFix');

type Row = GapRow & { swapTo?: { assetId: string; shotId: string | null } };
const gapsInput = (events: readonly AgentEvent[]) =>
  (
    ofType(events, 'skill.entered').find((e) => e.payload.skill === 'agent.gaps')?.payload.input as {
      gaps: Row[];
    }
  ).gaps;

describe('weak picks are gaps too (FIX-GAPS)', () => {
  it('on autopilot swaps to a clip that clearly fits better, keeps one no clip beats, and the card says so', async () => {
    const h = gapHarness({
      plan: ['ok', 'weakBetter', 'ok', 'weak'],
      localOnly: true,
      autonomy: 'autopilot',
    });
    const runId = unwrap(await start(h));
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    const rows = gapsInput(events);
    expect(rows.map((r) => [r.number, r.state, r.fix])).toEqual([
      [2, 'weak', 'swap'],
      [4, 'weak', 'keep'],
    ]);
    expect(rows[1]?.why).toMatch(/No other clip fits this slot better/);

    const card = gapCards(events)[0]!;
    const [two, four] = card.gaps;
    expect(two?.weak).toMatchObject({
      confidence: 0.2,
      betterFit: true,
      pick: { description: 'A person talks to the camera on a sunny beach', fit: 0.35 },
    });
    expect(four?.weak).toMatchObject({ betterFit: false });
    expect(two?.options.map((o) => o.kind)).toEqual(['swap', 'keep', 'film', 'drop']);
    // The next-best candidates, best fit first, each with what it shows and how well it fits.
    const swapOf = (gap: typeof two) => {
      const option = gap?.options.find((o) => o.kind === 'swap');
      return option?.kind === 'swap' ? option.candidates : [];
    };
    expect(swapOf(two).map((c) => [c.description, c.fit])).toEqual([
      ['A person walks away down a lit street at night', 0.86],
      ['A quiet street at dusk', 0.5],
    ]);
    expect(swapOf(four)).toHaveLength(2);
    const best = swapOf(two)[0]!;
    expect(rows[0]?.swapTo).toEqual({ assetId: best.assetId, shotId: best.shotId });
    // The stored slot now holds the better clip, and casting is no longer unsure of it.
    const stored = h.gaps.slots.values().next().value!;
    expect(stored[1]).toMatchObject({
      state: 'picked',
      current: { assetId: best.assetId, shotId: best.shotId },
    });
    expect(h.gaps.calls).toEqual(['timeline.swapClip']);
    // After the handoff: slot 2 swapped, slot 4 kept.
    expect(
      gapCards(events)
        .at(-1)
        ?.gaps.map((g) => [g.number, g.outcome]),
    ).toEqual([
      [2, 'swapped'],
      [4, 'kept'],
    ]);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload.settled).toBeUndefined();
  });

  it("at every step applies the person's swap to the candidate they chose, and ignores one the card didn't offer", async () => {
    const h = gapHarness({
      autonomy: 'every-step',
      plan: ['ok', 'weak', 'ok', 'weakBetter'],
      localOnly: true,
    });
    const runId = unwrap(await start(h));
    let outcome = unwrap(await h.agent.wait(runId));
    let card: CardOf<'gapFix'> | undefined;
    for (let i = 0; i < 10 && !card; i++) {
      card = gapCards(await h.events(runId)).find((c) => c.asking);
      if (card) break;
      outcome = unwrap(
        await h.agent.answer(runId, { requestId: outcome.pending[0]!.requestId, decision: 'approve' }),
      );
    }
    const [two, four] = card!.gaps;
    const swapOf = (gap: typeof two) => {
      const option = gap?.options.find((o) => o.kind === 'swap');
      return option?.kind === 'swap' ? option.candidates : [];
    };
    const second = swapOf(two)[1]!;
    const elsewhere = swapOf(four)[0]!;
    unwrap(
      await h.agent.answer(runId, {
        requestId: card!.asking!.approvalId,
        decision: 'approve',
        answer: {
          kind: 'gapFix',
          fixes: [
            { gapId: two!.gapId, fix: 'swap', swapTo: { assetId: second.assetId, shotId: second.shotId } },
            { gapId: four!.gapId, fix: 'swap', swapTo: { assetId: two!.weak!.pick.assetId, shotId: null } },
          ],
        },
      }),
    );
    const rows = gapsInput(await h.events(runId));
    expect(rows[0]).toMatchObject({
      fix: 'swap',
      swapTo: { assetId: second.assetId, shotId: second.shotId },
    });
    // Slot 4's answer named a shot it wasn't offered: its default stands (the better candidate).
    expect(rows[1]).toMatchObject({
      fix: 'swap',
      swapTo: { assetId: elsewhere.assetId, shotId: elsewhere.shotId },
    });
  });

  it("refuses a swap the stored timeline doesn't show, then settles the step with the clip kept", async () => {
    // One unsure clip in six, not the opening one: nothing that asks before render (FIX-ASK).
    const h = gapHarness({ plan: ['ok', 'weakBetter', 'ok', 'ok', 'ok', 'ok'], localOnly: true });
    h.gaps.lie = true;
    const runId = unwrap(await start(h));
    const outcome = unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    const refused = ofType(events, 'skill.verified').filter((e) => e.payload.verdict !== 'pass');
    expect(refused[0]?.payload.reason).toMatch(/doesn't show "swap"/);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload).toMatchObject({
      settled: true,
      output: { gaps: [{ applied: 'keep' }], filming: 0 },
    });
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
  });

  it('a declined question keeps every weak pick and films every empty slot', () => {
    const row = (state: GapRow['state'], fixes: GapRow['fixes']): GapRow => ({
      timelineId: 't',
      gapId: `g-${state}`,
      slotId: null,
      number: 2,
      state,
      intent: '',
      fixes,
      fix: 'drop',
    });
    const rows = [row('weak', ['swap', 'keep', 'film', 'drop']), row('empty', ['film', 'drop'])];
    expect(answeredRows(rows, []).map((r) => r.fix)).toEqual(['keep', 'film']);
  });
});
