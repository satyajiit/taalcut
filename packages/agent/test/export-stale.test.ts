// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M13 (SPEC section 13): the export approval is for the timeline revision
 * its card shows. An edit while the card waits closes the approval as stale at
 * once, and a grant that lands before anyone noticed the edit is refused the
 * same way, so the edited timeline is never exported under the old approval:
 * a flow goes back through the Editor and Reviewer and asks again, and a
 * model's own export call is told to check the new revision.
 */
import { newId, unwrap, type RunId } from '@taalcut/core';
import type { AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness, settleWatcher } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld, userEdit } from './support/flow-world';
import { call, ofType, plan, toolText, turns } from './support/harness';

const reel = { kind: 'link' as const, url: 'https://www.instagram.com/reel/abc123/' };
const skillsEntered = (events: readonly AgentEvent[]) =>
  ofType(events, 'skill.entered').map((e) => e.payload.skill);
const exportCards = (events: readonly AgentEvent[]) =>
  ofType(events, 'card.sent')
    .map((e) => e.payload.card)
    .flatMap((c) => (c.type === 'exportApproval' ? [[c.timelineRevision, c.status]] : []));

async function pendingOf(h: ReturnType<typeof flowHarness>, runId: RunId) {
  const outcome = unwrap(await h.agent.wait(runId));
  return { outcome, request: outcome.pending[0] };
}

describe('an export approval is bound to the revision on its card', () => {
  it('a grant that lands before the watcher heard of a swap closes as stale and the flow reviews again', async () => {
    const h = flowHarness({ script: flowScript({ ask: false }) });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c1',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: reel },
      }),
    );
    const first = await pendingOf(h, runId);
    const timelineId = [...h.world.timelines.keys()][0]!;
    expect(h.world.timelines.get(timelineId)).toBe(2);
    userEdit(h.world, timelineId); // A swap on the cast board; its command.changed hasn't reached the agent.

    const asked = unwrap(
      await h.agent.answer(runId, { requestId: first.request!.requestId, decision: 'approve' }),
    );
    expect(h.world.exported).toEqual([]);
    expect(asked).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    expect(asked.pending[0]!.requestId).not.toBe(first.request!.requestId);
    let events = await h.events(runId);
    expect(ofType(events, 'approval.granted')).toEqual([]);
    expect(ofType(events, 'approval.denied').map((e) => e.payload)).toEqual([
      { requestId: first.request!.requestId, reason: 'stale' },
    ]);
    // The Editor runs on top of the swap (3 → 4), the Reviewer checks it, and the card asks for revision 4.
    expect(skillsEntered(events).slice(4)).toEqual(['timeline.editor', 'render.reviewer']);
    expect(exportCards(events)).toEqual([
      [2, 'pending'],
      [2, 'updating'],
      [4, 'pending'],
    ]);

    unwrap(await h.agent.answer(runId, { requestId: asked.pending[0]!.requestId, decision: 'approve' }));
    expect(h.world.exported).toEqual([{ timelineId, revision: 4 }]);
    events = await h.events(runId);
    expect(ofType(events, 'approval.granted')).toHaveLength(1);
  });

  it('an edit between the grant and the export is refused by the command, and the flow reviews again', async () => {
    const h = flowHarness({ script: flowScript({ ask: false }) });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c1',
        projectId: h.world.projectId,
        message: 'Copy this reel',
        start: { path: 'reference', reference: reel },
      }),
    );
    const first = await pendingOf(h, runId);
    const timelineId = [...h.world.timelines.keys()][0]!;
    h.world.beforeExport = async () => {
      h.world.beforeExport = undefined;
      userEdit(h.world, timelineId);
      await h.agent.noteCommand({ id: newId<'Command'>(), projectId: h.world.projectId, source: 'ui' });
    };
    const asked = unwrap(
      await h.agent.answer(runId, { requestId: first.request!.requestId, decision: 'approve' }),
    );
    expect(h.world.exported).toEqual([]);
    expect(asked).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const events = await h.events(runId);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual(['core.conflict']);
    expect(skillsEntered(events).slice(4)).toEqual(['timeline.editor', 'render.reviewer']);
    unwrap(await h.agent.answer(runId, { requestId: asked.pending[0]!.requestId, decision: 'approve' }));
    expect(h.world.exported).toEqual([{ timelineId, revision: 4 }]);
  });

  it("closes a model's own export approval at once when its timeline moves, and tells the model why", async () => {
    const world = createWorld();
    const timelineId = newId<'Timeline'>();
    world.timelines.set(timelineId, 2);
    const h = flowHarness({
      world,
      script: turns(
        plan('Export the timeline'),
        {
          toolCalls: [call('render_export', { projectId: world.projectId, timelineId, timelineRevision: 2 })],
        },
        { text: 'The timeline changed, so I did not export it.' },
      ),
    });
    const runId = unwrap(
      await h.agent.start({ conversationId: 'c1', projectId: world.projectId, message: 'Export it' }),
    );
    const asked = await pendingOf(h, runId);
    expect(asked.outcome.status).toBe('paused');
    expect(exportCards(await h.events(runId))).toEqual([[2, 'pending']]);

    userEdit(world, timelineId);
    await h.agent.noteCommand({ id: newId<'Command'>(), projectId: world.projectId, source: 'ui' });
    // No quiet moment first: a grant right after the edit finds nothing to approve.
    expect(ofType(await h.events(runId), 'approval.denied').map((e) => e.payload)).toEqual([
      { requestId: asked.request!.requestId, reason: 'stale' },
    ]);
    const late = await h.agent.answer(runId, { requestId: asked.request!.requestId, decision: 'approve' });
    expect(late.ok).toBe(false);

    await settleWatcher();
    const done = unwrap(await h.agent.wait(runId));
    expect(done.status).toBe('completed');
    expect(world.exported).toEqual([]);
    const events = await h.events(runId);
    expect(exportCards(events)).toEqual([
      [2, 'pending'],
      [2, 'updating'],
    ]);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual(['tools.denied']);
    const told = h.models.requests.at(-1)!.messages.map(toolText).join('\n');
    expect(told).toContain('The timeline changed while this export waited for approval');
  });
});
