// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-MAKE, gate blocker 2: the owner's "Make a video with my template" failed in the gaps step. Casting left
 * 11 unsure picks (portrait clips capped on a landscape reel) and 2 empty slots, 12 and 13. The step was given
 * all 13 as gaps. The on-device model marked the 11 for filming, gave the 2 real gaps no fix, and the check
 * failed the run: "Slot 12 … was given to you as a gap and has no fix". Now an unsure pick is no gap, so the
 * step gets slots 12 and 13 alone. A model that does nothing still never fails the make: after its last retry
 * the step is settled from the stored timeline, and the flow goes on to the export. FIX-GAPS: unsure picks are gaps
 * again, but with no clip that fits better their default is keep, which needs no tool call. FIX-ASK: the owner's shape
 * asks before render now (two shots with no clip, an unsure opening clip, most clips unsure); here the person takes
 * the card's fixes, so the rows are the defaults.
 */
import { CONTROL_PREFIX, SKILL_INPUT_NOTE, type AgentEvent, type ModelScript } from '@taalcut/agent';
import { unwrap, type CardOf } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { json, text } from '../support/flow-script';
import { call, ofType } from '../support/harness';
import { gapHarness, takeGapDefaults } from './gap-harness';
import { gapFlowScript } from './gap-script';
import type { Planted } from './gap-world';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/EXAMPLE123/' };
/** Eleven unsure picks, then the two slots no clip fits. */
const OWNER: Planted[] = [...Array<Planted>(11).fill('weak'), 'empty', 'empty'];

/** The gaps step's input, from its control note. */
function stepInput(request: Parameters<ModelScript>[0]): Record<string, unknown> {
  const marker = `${CONTROL_PREFIX} ${SKILL_INPUT_NOTE}`;
  const note = request.messages.findLast((m) => m.role === 'user' && text(m).startsWith(marker));
  return note ? json(text(note).slice(marker.length).trim()) : {};
}

/** The owner's model in the gaps step: it applies nothing and hands off no gap, every time it is asked. */
const doesNothing: ModelScript = (request, turn) => {
  if (!/# Skill: agent\.gaps\b/.test(request.system ?? ''))
    return gapFlowScript({ ask: false })(request, turn);
  const ids = (stepInput(request).timelineIds as string[] | undefined) ?? [];
  return {
    toolCalls: [
      call('handOff', {
        gaps: [],
        filming: 0,
        timelines: ids.map((id) => ({ timelineId: id, revision: 1 })),
      }),
    ],
  };
};

const inGaps = (request: Parameters<ModelScript>[0]) => /# Skill: agent\.gaps\b/.test(request.system ?? '');

/** The owner's model in m2: it calls fills that can't run, turn after turn, and never hands off. */
const neverHandsOff: ModelScript = (request, turn) =>
  inGaps(request)
    ? { toolCalls: [call('timeline_fillGap', { timelineId: 'nope', gapId: 'nope', assetId: 'nope' })] }
    : gapFlowScript({ ask: false })(request, turn);

/** A model that only says it applied the fixes (the text loop). */
const onlyTalks: ModelScript = (request, turn) =>
  inGaps(request)
    ? { text: 'I applied the drop fix to both empty slots. Taalcut is checking it again.' }
    : gapFlowScript({ ask: false })(request, turn);

function start(h: ReturnType<typeof gapHarness>) {
  return h.agent.start({
    conversationId: 'c1',
    projectId: h.world.projectId,
    message: 'Make a video with my template',
    start: { path: 'reference', reference: reel },
  });
}

const gapCards = (events: readonly AgentEvent[]): CardOf<'gapFix'>[] =>
  ofType(events, 'card.sent')
    .map((e) => e.payload.card)
    .filter((c): c is CardOf<'gapFix'> => c.type === 'gapFix');

const gapsInput = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered').find((e) => e.payload.skill === 'agent.gaps')?.payload.input as {
    gaps: { number: number; fix: string }[];
  };

describe("the owner's gaps (BRK1-MAKE, gate blocker 2)", () => {
  it('keeps the eleven unsure picks no clip beats, and a model that follows its input drops the two empty slots', async () => {
    const h = gapHarness({ plan: OWNER, localOnly: true });
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    const events = await h.events(runId);
    // FIX-GAPS: the weak picks are gaps again, but their default is keep: nothing films or replaces them blindly.
    expect(gapsInput(events).gaps.map((g) => [g.number, g.fix])).toEqual([
      ...Array.from({ length: 11 }, (_, i) => [i + 1, 'keep']),
      [12, 'drop'],
      [13, 'drop'],
    ]);
    expect(h.gaps.calls).toEqual(['timeline.dropSlot', 'timeline.dropSlot']);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload.settled).toBeUndefined();
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
  });

  it('never fails the make when the model gives the gaps no fix: the step is settled and the flow goes on', async () => {
    const h = gapHarness({ plan: OWNER, localOnly: true, script: doesNothing });
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    const events = await h.events(runId);
    // Before: this was the end of the run, agent.verify_failed, "A step didn't pass its check".
    const refused = ofType(events, 'skill.verified').filter((e) => e.payload.verdict === 'retry');
    expect(refused).toHaveLength(3);
    expect(refused[0]?.payload.reason).toMatch(/Slot 1 .*has no fix\. Apply its fix \(keep\)/);
    expect(ofType(events, 'run.failed')).toEqual([]);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    const kept = Array.from({ length: 11 }, () => ({ applied: 'keep' }));
    expect(handed?.payload).toMatchObject({
      settled: true,
      output: { gaps: [...kept, { applied: 'film' }, { applied: 'film' }], filming: 2 },
    });
    // The card says how each gap settled: the unsure picks stay, both empty slots wait for footage on the film list.
    expect(
      gapCards(events)
        .at(-1)
        ?.gaps.map((g) => [g.number, g.outcome]),
    ).toEqual([...Array.from({ length: 11 }, (_, i) => [i + 1, 'kept']), [12, 'open'], [13, 'open']]);
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    // A replay reads the logged settlement instead of settling again, and ends the same way.
    const replayed = await h.agent.replay(runId);
    expect(replayed.ok && replayed.value.status).toBe('paused');
  });

  it('settles the step at its turn limit too, so a model that never hands off does not fail the make', async () => {
    const h = gapHarness({ plan: OWNER, localOnly: true, script: neverHandsOff });
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    const events = await h.events(runId);
    // Before: run.failed agent.turn_limit after the step's ten turns.
    expect(ofType(events, 'run.failed')).toEqual([]);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload).toMatchObject({ settled: true, output: { filming: 2 } });
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const replayed = await h.agent.replay(runId);
    expect(replayed.ok && replayed.value.status).toBe('paused');
  });

  it('settles the step after three turns in words and a corrective note (AGT1), before its turn limit', async () => {
    const h = gapHarness({ plan: OWNER, localOnly: true, script: onlyTalks });
    const runId = unwrap(await start(h));
    const outcome = await takeGapDefaults(h, runId);
    const events = await h.events(runId);
    expect(ofType(events, 'run.failed')).toEqual([]);
    expect(h.models.requests.filter(inGaps)).toHaveLength(4);
    expect(ofType(events, 'step.corrected')).toHaveLength(1);
    const handed = ofType(events, 'skill.handedOff').find((e) => e.payload.skill === 'agent.gaps');
    expect(handed?.payload).toMatchObject({ settled: true, output: { filming: 2 } });
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
  });
});
