// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B8 (agent half, SPEC section 26): every empty slot gets at least one proposed fix. On a synthetic
 * library with planted gaps (slot 2 has no shot, slot 4 only a weak one), the gaps step joins after the
 * Librarian, its gapFix card offers film and drop always, generate only with an image path and stock only
 * with the stock tool; the default follows the autonomy level; the answer round-trips; and the second
 * method refuses a handoff the stored timeline doesn't show. A step whose model never passes the check is
 * settled from the stored timelines, so the make goes on (BRK1-MAKE). FIX-GAPS: the weak pick is a gap again,
 * which keeps its clip by default when no other clip fits better.
 */
import { type Card, type CardOf, unwrap } from '@taalcut/core';
import type { AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { ofType } from '../support/harness';
import { gapHarness, takeGapDefaults } from './gap-harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };

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

const skills = (events: readonly AgentEvent[]) => ofType(events, 'skill.entered').map((e) => e.payload.skill);

describe('the gaps step (P3-B8)', () => {
  it('joins after the Librarian and offers film and drop on every gap, generate with an image path', async () => {
    const h = gapHarness();
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] }); // the export's approval
    const events = await h.events(runId);
    expect(skills(events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'agent.gaps',
      'timeline.editor',
      'render.reviewer',
    ]);
    const card = gapCards(events)[0]!;
    // Slot 2 is empty; slot 4's pick is weak, a gap too (FIX-GAPS): it may swap or keep, and no candidate fits better.
    expect(card.gaps.map((gap) => gap.number)).toEqual([2, 4]);
    expect(card.gaps[1]?.options.map((o) => o.kind)).toEqual(['swap', 'keep', 'film', 'generate', 'drop']);
    expect(card.gaps[1]?.weak).toMatchObject({ confidence: 0.2, betterFit: false });
    for (const gap of card.gaps) {
      const kinds = gap.options.map((o) => o.kind);
      expect(kinds).toEqual(expect.arrayContaining(['film', 'drop']));
      expect(kinds).toContain('generate');
      expect(kinds).not.toContain('stock');
      expect(gap.unavailable).toEqual([{ kind: 'stock', reason: 'stockOff' }]);
    }
    // FIX-ASK: before render, a shot with no clip (and one unsure clip in four) asks; the person takes the card's
    // fixes: slot 2 is dropped, the weak slot 4 stays as it is.
    expect(card.asking?.why).toEqual(['empty', 'manyUnsure']);
    expect(h.gaps.calls).toEqual(['timeline.dropSlot']);
    // After the handoff the card shows how each gap settled, in the flow's step.
    const settled = gapCards(events).at(-1)!;
    expect(settled.gaps.map((g) => [g.number, g.outcome])).toEqual([
      [2, 'dropped'],
      [4, 'kept'],
    ]);
    expect(settled.step).toMatchObject({ skill: 'agent.gaps', status: 'ready' });
  });

  it('offers no generated still without an image path, and stock only with the stock tool', async () => {
    const h = gapHarness({ image: { ok: false, reason: 'noImageModel' }, stock: true });
    const runId = unwrap(await start(h));
    unwrap(await h.agent.wait(runId));
    const card = gapCards(await h.events(runId))[0]!;
    for (const gap of card.gaps) {
      const own = gap.weak ? ['swap', 'keep'] : [];
      expect(gap.options.map((o) => o.kind)).toEqual([...own, 'film', 'stock', 'drop']);
      expect(gap.unavailable).toEqual([{ kind: 'generate', reason: 'noImageModel' }]);
    }
  });

  it('under Local only says why generate and stock are missing', async () => {
    const h = gapHarness({ localOnly: true, stock: true });
    const runId = unwrap(await start(h));
    unwrap(await h.agent.wait(runId));
    const card = gapCards(await h.events(runId))[0]!;
    expect(card.gaps[0]?.unavailable).toEqual([
      { kind: 'generate', reason: 'localOnly' },
      { kind: 'stock', reason: 'localOnly' },
    ]);
  });

  it('fills the hook with a generated still, since the hook is never dropped by default', async () => {
    const h = gapHarness({ plan: ['empty', 'ok', 'ok'] });
    const runId = unwrap(await start(h));
    await takeGapDefaults(h, runId);
    expect(h.gaps.calls).toEqual(['images.generateForSlot']);
    const events = await h.events(runId);
    expect(gapCards(events).at(-1)?.gaps[0]).toMatchObject({ number: 1, outcome: 'filled' });
    // The still is paid for under the images module.
    expect(
      ofType(events, 'estimate.recorded').find((e) => e.payload.skill === 'agent.gaps')?.payload,
    ).toMatchObject({
      estimate: { usd: expect.closeTo(0.04, 6) },
      // Review M8: the images line says what it bills, so the card shows "1 image", not "0 tokens".
      lines: expect.arrayContaining([
        expect.objectContaining({ module: 'images', billed: { unit: 'image', quantity: 1 } }),
      ]),
    });
  });

  it('at "Ask me at every step" asks on the card and applies the answer', async () => {
    const h = gapHarness({ autonomy: 'every-step', plan: ['ok', 'empty', 'ok', 'empty'] });
    const runId = unwrap(await start(h));
    // Every-step autonomy asks before the Analyst's writes too; approve until the gap question comes.
    let outcome = unwrap(await h.agent.wait(runId));
    let card: CardOf<'gapFix'> | undefined;
    for (let i = 0; i < 10 && !card; i++) {
      card = gapCards(await h.events(runId)).find((c) => c.asking);
      if (card) break;
      outcome = unwrap(
        await h.agent.answer(runId, { requestId: outcome.pending[0]!.requestId, decision: 'approve' }),
      );
    }
    expect(card?.asking?.approvalId).toBe(outcome.pending[0]?.requestId);
    expect(outcome.pending[0]?.kind).toBe('question');
    const [empty, weak] = card!.gaps;
    expect(weak).toBeDefined();
    unwrap(
      await h.agent.answer(runId, {
        requestId: card!.asking!.approvalId,
        decision: 'approve',
        answer: {
          kind: 'gapFix',
          fixes: [
            { gapId: empty!.gapId, fix: 'generate' },
            { gapId: weak!.gapId, fix: 'drop' },
          ],
        },
      }),
    );
    const entered = ofType(await h.events(runId), 'skill.entered').find(
      (e) => e.payload.skill === 'agent.gaps',
    );
    expect(entered?.payload.input).toMatchObject({
      gaps: [
        { gapId: empty!.gapId, fix: 'generate' },
        { gapId: weak!.gapId, fix: 'drop' },
      ],
    });
  });

  it('a declined question leaves every gap on the film list', async () => {
    const h = gapHarness({ autonomy: 'every-step', plan: ['ok', 'empty', 'ok', 'empty'] });
    const runId = unwrap(await start(h));
    let outcome = unwrap(await h.agent.wait(runId));
    for (let i = 0; i < 10 && outcome.pending[0]?.kind !== 'question'; i++)
      outcome = unwrap(
        await h.agent.answer(runId, { requestId: outcome.pending[0]!.requestId, decision: 'approve' }),
      );
    unwrap(await h.agent.answer(runId, { requestId: outcome.pending[0]!.requestId, decision: 'deny' }));
    const entered = ofType(await h.events(runId), 'skill.entered').find(
      (e) => e.payload.skill === 'agent.gaps',
    );
    expect((entered?.payload.input as { gaps: { fix: string }[] }).gaps.map((g) => g.fix)).toEqual([
      'film',
      'film',
    ]);
  });

  it("the second method refuses a handoff that claims a fix the timeline doesn't show; Taalcut settles it", async () => {
    const h = gapHarness();
    h.gaps.lie = true;
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    const events = await h.events(runId);
    const verified = ofType(events, 'skill.verified').filter((e) => e.payload.verdict !== 'pass');
    expect(verified[0]?.payload.reason).toMatch(/doesn't show "drop"/);
    // BRK1-MAKE: after the last retry the step is settled from what is stored: the slot that wasn't dropped is
    // still empty, so it waits on the film list, and the make goes on to the export instead of failing.
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload).toMatchObject({
      settled: true,
      output: { gaps: [{ applied: 'film' }, { applied: 'keep' }], filming: 1 },
    });
    expect(
      gapCards(events)
        .at(-1)
        ?.gaps.map((g) => [g.number, g.outcome]),
    ).toEqual([
      [2, 'open'],
      [4, 'kept'],
    ]);
    expect(skills(events)).toContain('render.reviewer');
  });

  it('adds no step when the cast has no gaps', async () => {
    const h = gapHarness({ plan: ['ok', 'ok', 'ok'] });
    const runId = unwrap(await start(h));
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    expect(skills(events)).not.toContain('agent.gaps');
    expect(ofType(events, 'flow.extensionChecked').map((e) => e.payload)).toEqual([
      { extension: 'gaps', anchorStepId: expect.any(String), joined: false },
    ]);
  });
});
