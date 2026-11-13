// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-ASK: Add more clips, end to end in the agent. The owner added a clip while the run was going and nothing used
 * it. Now an answer of Add more clips waits for the clips added since the cast began (the ones added while the
 * question waited count too), casts those gaps again, and starts the next round: what the new clips filled is
 * settled, and what is still open asks again when it matters. With no clips coming, the gap asks again and the
 * person's next answer stands. A swap from another shot and another part of a used clip run through the step too.
 * All made-up data.
 */
import { newId, ok, unwrap, type CardOf, type RunId } from '@taalcut/core';
import type { AgentEvent, GapClips } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { ofType } from '../support/harness';
import { gapHarness, latestGapData } from './gap-harness';
import { shot, type GapWorld } from './gap-world';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/MADEUP42/' };

/** The person's library as the port sees it: clips added since a time, how many are ready, and a recast. */
function library() {
  const lib = {
    world: undefined as GapWorld | undefined,
    added: 0,
    ready: 0,
    sinces: [] as number[],
    recasts: [] as string[][],
    port: undefined as unknown as GapClips,
  };
  lib.port = {
    async added(since) {
      lib.sinces.push(since);
      return ok({ added: lib.added, ready: lib.ready });
    },
    async recast(timelineId, gapIds) {
      lib.recasts.push([...gapIds]);
      const own = lib.world?.slots.get(timelineId) ?? [];
      let changed = 0;
      for (const gapId of gapIds) {
        const at = own.findIndex((s) => s.gapId === gapId);
        if (at < 0 || lib.ready === 0) continue;
        const { weak: _weak, ...slot } = own[at]!;
        own[at] = {
          ...slot,
          state: 'picked',
          note: null,
          current: { assetId: newId<'Asset'>(), shotId: null },
        };
        changed += 1;
      }
      return ok({ changed });
    },
  };
  return lib;
}

function setUp(plan: GapWorld['plan']) {
  const lib = library();
  const h = gapHarness({ plan, localOnly: true, clips: lib.port, clipWait: { maxMs: 60, everyMs: 5 } });
  lib.world = h.gaps;
  return { h, lib };
}

async function start(h: ReturnType<typeof gapHarness>) {
  return unwrap(
    await h.agent.start({
      conversationId: 'c1',
      projectId: h.world.projectId,
      message: 'Make a video with my template',
      start: { path: 'reference', reference: reel },
    }),
  );
}

const gapCards = (events: readonly AgentEvent[]): CardOf<'gapFix'>[] =>
  ofType(events, 'card.sent')
    .map((e) => e.payload.card)
    .filter((c): c is CardOf<'gapFix'> => c.type === 'gapFix');

async function gapQuestion(h: ReturnType<typeof gapHarness>, runId: RunId) {
  const outcome = unwrap(await h.agent.wait(runId));
  const events = await h.events(runId);
  const pending = outcome.pending[0];
  const asked = ofType(events, 'approval.requested').find((e) => e.payload.requestId === pending?.requestId);
  expect(asked?.payload.question).toBe('gapFix');
  return { requestId: pending!.requestId, data: latestGapData(events)!, events };
}

const answer = (h: ReturnType<typeof gapHarness>, runId: RunId, requestId: string, fixes: unknown[]) =>
  h.agent.answer(runId, {
    requestId: requestId as never,
    decision: 'approve',
    answer: { kind: 'gapFix', fixes } as never,
  });

describe('Add more clips (FIX-ASK)', () => {
  it('waits for the clips added while it asked, casts that gap again, and goes on with the shot filled', async () => {
    const { h, lib } = setUp(['ok', 'ok', 'empty', 'ok', 'ok']);
    const runId = await start(h);
    const first = await gapQuestion(h, runId);
    const [gap] = first.data.gaps;
    expect(first.data.round).toBe(1);
    expect(gap?.view.options.map((o) => o.kind)).toEqual(['addClips', 'film', 'drop']);
    // The card says what's wrong in counts: five shots, four with a clip, one with nothing.
    expect(gapCards(first.events).find((c) => c.asking)?.summary).toEqual({
      shots: 5,
      filled: 4,
      empty: 1,
      unsure: 0,
    });

    // The person adds a clip from this Mac while the question waits; it is indexed by the time they answer.
    lib.added = 1;
    lib.ready = 1;
    unwrap(await answer(h, runId, first.requestId, [{ gapId: gap!.view.gapId, fix: 'addClips' }]));
    const outcome = unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);

    // The clips counted are the ones added since the Librarian began; that one gap was cast again.
    const librarian = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'timeline.librarian');
    expect(lib.sinces[0]).toBe(first.data.since);
    expect(first.data.since).toBeLessThanOrEqual(librarian!.at);
    expect(lib.recasts).toEqual([[gap!.view.gapId]]);
    const rounds = ofType(events, 'flow.extended').filter((e) => e.payload.extension === 'gaps');
    expect(rounds.map((e) => e.payload.again ?? false)).toEqual([false, true]);
    const second = latestGapData(events)!;
    expect(second).toMatchObject({ round: 2, newClips: { added: 1, ready: 1, used: 1 } });
    expect(second.gaps.map((g) => g.settled)).toEqual(['filled']);
    // Nothing is open any more: no second question, and the step's model has no gap to fix.
    expect(ofType(events, 'approval.requested').filter((e) => e.payload.question === 'gapFix')).toHaveLength(
      1,
    );
    const input = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'agent.gaps')?.payload
      .input;
    expect(input).toMatchObject({ gaps: [] });
    expect(
      gapCards(events)
        .at(-1)
        ?.gaps.map((g) => [g.number, g.outcome]),
    ).toEqual([[3, 'filled']]);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    // A replay reads the logged rounds and asks nothing.
    const replayed = unwrap(await h.agent.replay(runId));
    expect(replayed.status).toBe('paused');
  });

  it('with no clip coming, asks again, says none came, and the next answer stands', async () => {
    const { h, lib } = setUp(['ok', 'ok', 'empty', 'ok', 'ok']);
    const runId = await start(h);
    const first = await gapQuestion(h, runId);
    const gapId = first.data.gaps[0]!.view.gapId;
    unwrap(await answer(h, runId, first.requestId, [{ gapId, fix: 'addClips' }]));
    const second = await gapQuestion(h, runId);
    expect(lib.recasts).toEqual([]);
    expect(second.data).toMatchObject({ round: 2, newClips: { added: 0, ready: 0, used: 0 } });
    expect(gapCards(second.events).find((c) => c.asking?.approvalId === second.requestId)?.newClips).toEqual({
      added: 0,
      ready: 0,
      used: 0,
    });
    unwrap(await answer(h, runId, second.requestId, [{ gapId, fix: 'drop' }]));
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    const input = ofType(events, 'skill.entered').find((e) => e.payload.skill === 'agent.gaps')?.payload
      .input as {
      gaps: { gapId: string; fix: string }[];
    };
    expect(input.gaps.map((g) => [g.gapId, g.fix])).toEqual([[gapId, 'drop']]);
    expect(h.gaps.calls).toEqual(['timeline.dropSlot']);
  });

  it('takes the clip from another shot when the person says so; that shot gets another clip instead', async () => {
    const { h } = setUp(['weak', 'ok', 'weak', 'ok', 'ok', 'ok']);
    // Shot 3's clip shows what the opening asks for; shot 3 can take the opening's clip in its place.
    h.gaps.offers = (slot, all) => {
      if (slot.number !== 1) return undefined;
      const giver = all.find((s) => s.number === 3)!;
      const instead = { ...slot.weak!.pick, fit: 0.36 };
      return {
        reuse: [],
        borrow: [
          {
            ...shot('Someone checks a phone on a bench', 0.84),
            assetId: giver.current!.assetId,
            shotId: giver.current!.shotId,
            better: true,
            from: { gapId: giver.gapId, slotId: giver.slotId, number: 3, fit: 0.35 },
            instead,
          },
        ],
      };
    };
    const runId = await start(h);
    const first = await gapQuestion(h, runId);
    const opening = first.data.gaps.find((g) => g.view.number === 1)!;
    const borrow = opening.view.options.find((o) => o.kind === 'borrow');
    expect(borrow?.kind === 'borrow' && borrow.candidates[0]?.from.number).toBe(3);
    // An unsure opening asks before render; the default already trades the two shots' clips.
    expect(gapCards(first.events).find((c) => c.asking)?.asking?.why).toEqual(['opening', 'manyUnsure']);
    expect(opening.row).toMatchObject({ fix: 'borrow', borrow: { number: 3 } });
    // The asking card starts with that proposal chosen.
    const asked = gapCards(first.events).find((c) => c.asking)?.gaps.find((g) => g.number === 1);
    expect(asked?.proposed).toEqual({ fix: 'borrow', swapTo: opening.row.swapTo });
    const take = borrow?.kind === 'borrow' ? borrow.candidates[0]! : undefined;
    unwrap(
      await answer(h, runId, first.requestId, [
        {
          gapId: opening.view.gapId,
          fix: 'borrow',
          swapTo: { assetId: take!.assetId, shotId: take!.shotId },
        },
      ]),
    );
    unwrap(await h.agent.wait(runId));
    const events = await h.events(runId);
    // Shot 3 first takes the opening's clip, then the opening takes shot 3's: no clip is used twice.
    expect(h.gaps.calls).toEqual(['timeline.swapClip', 'timeline.swapClip']);
    const own = [...h.gaps.slots.values()][0]!;
    expect(own[0]?.current?.assetId).toBe(take!.assetId);
    expect(own[2]?.current?.assetId).toBe(take!.instead.assetId);
    expect(
      gapCards(events)
        .at(-1)
        ?.gaps.map((g) => [g.number, g.outcome]),
    ).toEqual([
      [1, 'borrowed'],
      [3, 'swapped'],
    ]);
  });
});
