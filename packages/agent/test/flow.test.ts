// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M13 (SPEC sections 13 and 18): chat alone reaches an export, and edits
 * don't block. An opening card seeds the plan with no planning turn; the
 * Librarian asks once; the one approval is the export tool's own card; a
 * change while casting runs the later steps again once and keeps the edit; a
 * swap while the export waits sends the card back to "updating" and asks
 * again under the same card; on autopilot nothing stops.
 */
import { newId, unwrap, type Card, type RunId } from '@taalcut/core';
import type { AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness, settleWatcher } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { userEdit } from './support/flow-world';
import { ofType } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };

function cards(events: readonly AgentEvent[]): Card[] {
  return ofType(events, 'card.sent').map((e) => e.payload.card);
}
const skillsEntered = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered').map((e) => e.payload.skill);

function start(h: ReturnType<typeof flowHarness>) {
  return h.agent.start({
    conversationId: 'c1',
    projectId: h.world.projectId,
    message: 'Copy this reel',
    start: { path: 'reference', reference: reel },
  });
}

async function pendingOf(h: ReturnType<typeof flowHarness>, runId: RunId) {
  const outcome = unwrap(await h.agent.wait(runId));
  return { outcome, request: outcome.pending[0] };
}

describe('a flow from an opening card to the one approval', () => {
  it('seeds the plan without a model call, asks only how many variants, and exports after the one approval', async () => {
    const h = flowHarness({ script: flowScript() });
    const runId = unwrap(await start(h));
    const asked = await pendingOf(h, runId);
    expect(asked.outcome.status).toBe('paused');
    expect(asked.request?.kind).toBe('question');
    // No planning turn: the first model call is the Analyst's.
    expect(h.models.requests[0]?.system).toContain('# Skill: templates.analyst');
    let events = await h.events(runId);
    const flow = ofType(events, 'flow.started')[0]!.payload;
    expect(flow).toMatchObject({ path: 'reference', projectId: h.world.projectId });
    expect(
      ofType(events, 'plan.created')[0]?.payload.steps.map((s) => [s.skill ?? s.tool, s.text, s.labelKey]),
    ).toEqual([
      ['templates.analyst', '', 'skills.templates.analyst'],
      ['timeline.librarian', '', 'skills.timeline.librarian'],
      ['timeline.editor', '', 'skills.timeline.editor'],
      ['render.reviewer', '', 'skills.render.reviewer'],
      ['render.export', '', 'flows.step.export'],
    ]);
    // The breakdown card, then the cast board asking.
    expect(cards(events).map((c) => [c.type, c.id])).toEqual([
      ['breakdown', `step:${flow.cardFlowId}:templates.analyst`],
      ['castBoard', `step:${flow.cardFlowId}:timeline.librarian`],
    ]);
    expect(cards(events)[1]).toMatchObject({
      castId: null,
      timelineIds: [],
      asking: { suggested: 2, slotCount: 4 },
    });

    const exporting = unwrap(
      await h.agent.answer(runId, {
        requestId: asked.request!.requestId,
        decision: 'approve',
        answer: { kind: 'variants', count: 1 },
      }),
    );
    expect(exporting).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    events = await h.events(runId);
    const exportCard = cards(events).find((c) => c.type === 'exportApproval');
    expect(exportCard).toMatchObject({
      id: `export:${flow.cardFlowId}:1`,
      approvalId: exporting.pending[0]!.requestId,
      status: 'pending',
      projectId: h.world.projectId,
      timelineRevision: 2,
    });
    expect(h.world.exported).toEqual([]);
    expect(skillsEntered(events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
    ]);
    // The plan's export step is the agent's own call: no model turn asked for it.
    const exportCall = ofType(events, 'tool.requested').find((e) => e.payload.tool === 'render.export')!;
    expect(exportCall.payload).toMatchObject({
      modelCallId: expect.stringMatching(/^flow:/),
      cards: { approval: true, result: true },
    });

    const done = unwrap(
      await h.agent.answer(runId, { requestId: exporting.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done.status).toBe('completed');
    expect(h.world.exported).toEqual([{ timelineId: expect.any(String), revision: 2 }]);
    events = await h.events(runId);
    expect(
      cards(events)
        .slice(-2)
        .map((c) => c.type),
    ).toEqual(['renderProgress', 'openingChoices']);
  });

  it('a change while casting runs the later steps again once and keeps the edit', async () => {
    const h = flowHarness({ script: flowScript() });
    const runId = unwrap(await start(h));
    const asked = await pendingOf(h, runId);
    const templateId = [...h.world.templates.keys()][0]!;
    h.world.templates.set(templateId, 2); // The user renamed a slot on the breakdown card.
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId: h.world.projectId, source: 'ui' });
    let events = await h.events(runId);
    expect(ofType(events, 'flow.inputChanged')[0]?.payload.refs).toEqual([
      { entity: 'template', id: templateId, version: 2 },
    ]);
    // Paused on the question: the change waits for the run to go on.
    expect(ofType(events, 'run.resumed')).toHaveLength(0);
    unwrap(
      await h.agent.answer(runId, {
        requestId: asked.request!.requestId,
        decision: 'approve',
        answer: { kind: 'variants', count: 1 },
      }),
    );
    events = await h.events(runId);
    expect(skillsEntered(events)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
    ]);
    // Asked once: the rerun keeps the answer.
    expect(ofType(events, 'approval.requested').filter((e) => e.payload.kind === 'question')).toHaveLength(1);
    expect(h.world.templates.get(templateId)).toBe(2);
    const rerun = ofType(events, 'plan.updated').find((e) => e.payload.applies?.length);
    expect(rerun?.payload.steps.map((s) => [s.skill, s.flow?.rerun])).toEqual([['timeline.librarian', true]]);
  });

  it('a swap while the export waits shows "updating", reviews again and asks under the same card', async () => {
    const h = flowHarness({ script: flowScript({ ask: false }) });
    const runId = unwrap(await start(h));
    const first = await pendingOf(h, runId);
    let events = await h.events(runId);
    const flow = ofType(events, 'flow.started')[0]!.payload;
    const timelineId = [...h.world.timelines.keys()][0]!;
    userEdit(h.world, timelineId); // A swap on the cast board.
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId: h.world.projectId, source: 'ui' });
    await settleWatcher();
    const second = await pendingOf(h, runId);
    expect(second.outcome.status).toBe('paused');
    expect(second.request?.requestId).not.toBe(first.request?.requestId);
    events = await h.events(runId);
    expect(ofType(events, 'approval.denied')[0]?.payload).toEqual({
      requestId: first.request!.requestId,
      reason: 'stale',
    });
    const exports = cards(events).filter((c) => c.type === 'exportApproval');
    expect(exports.map((c) => [c.id, c.type === 'exportApproval' && c.status])).toEqual([
      [`export:${flow.cardFlowId}:1`, 'pending'],
      [`export:${flow.cardFlowId}:1`, 'updating'],
      [`export:${flow.cardFlowId}:1`, 'pending'],
    ]);
    // The steps whose work changed show "You changed this", under their own ids.
    const marked = cards(events).filter((c) => 'step' in c && c.step?.editedByYou);
    expect(marked.map((c) => c.id)).toEqual([
      `step:${flow.cardFlowId}:timeline.librarian`,
      `step:${flow.cardFlowId}:timeline.editor`,
    ]);
    // The Editor runs once more on top of the swap (revision 3 → 4), then one review, then the same card asks.
    expect(skillsEntered(events).slice(4)).toEqual(['timeline.editor', 'render.reviewer']);
    unwrap(await h.agent.answer(runId, { requestId: second.request!.requestId, decision: 'approve' }));
    expect(h.world.exported).toEqual([{ timelineId, revision: 4 }]);
  });

  it('on autopilot it never stops: no question, no export card', async () => {
    const h = flowHarness({ script: flowScript(), settings: { autonomy: 'autopilot' } });
    const outcome = unwrap(await h.agent.wait(unwrap(await start(h))));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'approval.requested')).toHaveLength(0);
    expect(cards(events).some((c) => c.type === 'exportApproval')).toBe(false);
    expect(h.world.calls).toContain('timeline.cast:2');
    expect(h.world.exported).toHaveLength(2);
  });
});
