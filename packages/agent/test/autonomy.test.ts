// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G4 "Done when": a destructive tool can't run without an approval event
 * in the log, at every autonomy level. Plus the rest of the SPEC section 7
 * table, local-only mode, and a policy bug that tries to skip approval.
 */
import { unwrap } from '@taalcut/core';
import { AUTONOMY_LEVELS, needsApproval, type AgentEvent, type AutonomyLevel } from '@taalcut/agent';
import { createToolExecutor } from '@taalcut/tools';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, recordingCommands, turns } from './support/harness';

/** Every completed destructive or external call has an earlier approval.granted covering its id. */
function approvalsHold(events: readonly AgentEvent[]): string[] {
  const problems: string[] = [];
  const granted = new Set<string>();
  const sideEffects = new Map(
    ofType(events, 'tool.requested').map((e) => [e.payload.toolCallId as string, e.payload.sideEffect]),
  );
  const covered = new Map(
    ofType(events, 'approval.requested').map((e) => [e.payload.requestId, e.payload.toolCallIds]),
  );
  for (const event of events) {
    if (event.type === 'approval.granted')
      for (const id of covered.get(event.payload.requestId) ?? []) granted.add(id);
    if (event.type !== 'tool.completed') continue;
    const effect = sideEffects.get(event.payload.toolCallId);
    if ((effect === 'destructive' || effect === 'external') && !granted.has(event.payload.toolCallId)) {
      problems.push(`${event.payload.toolCallId} ran without approval`);
    }
  }
  return problems;
}

const deleteScript = turns(
  plan('Delete the blurry clip'),
  { toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
  { text: 'Done.' },
);

describe.each(AUTONOMY_LEVELS)('a destructive tool at "%s"', (autonomy: AutonomyLevel) => {
  it('waits for approval and never runs without an answer', async () => {
    const h = harness({ script: deleteScript, settings: { autonomy } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'delete c1' }));
    expect(outcome).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.completed').filter((e) => e.payload.approvalId)).toEqual([]);
    expect(h.applied).toEqual([]);
    expect(h.ui).toContainEqual(
      expect.objectContaining({
        card: expect.objectContaining({
          kind: 'approval',
          calls: [expect.objectContaining({ tool: 'clips.deleteClip', sideEffect: 'destructive' })],
        }),
      }),
    );
    expect(approvalsHold(events)).toEqual([]);
  });

  it('runs once approved, carrying the approval id, after the approval event', async () => {
    const h = harness({ script: deleteScript, settings: { autonomy } });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'delete c1' }));
    const requestId = paused.pending[0]!.requestId;
    expect(unwrap(await h.agent.answer(paused.runId, { requestId, decision: 'approve' })).status).toBe(
      'completed',
    );
    const events = await h.events(paused.runId);
    const ran = ofType(events, 'tool.completed').find((e) => e.payload.approvalId);
    expect(ran?.payload.approvalId).toBe(requestId);
    expect(ofType(events, 'approval.granted')[0]!.seq).toBeLessThan(ran!.seq);
    expect(h.applied.map((a) => a.command)).toEqual(['clips.deleteClip']);
    expect(approvalsHold(events)).toEqual([]);
  });

  it('never runs when denied', async () => {
    const h = harness({ script: deleteScript, settings: { autonomy } });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'delete c1' }));
    const done = unwrap(
      await h.agent.answer(paused.runId, {
        requestId: paused.pending[0]!.requestId,
        decision: 'deny',
        note: 'keep it',
      }),
    );
    expect(done.status).toBe('completed');
    expect(ofType(await h.events(paused.runId), 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.denied',
    ]);
    expect(h.applied).toEqual([]);
  });
});

describe('the autonomy table (SPEC section 7)', () => {
  const tool = (sideEffect: 'read' | 'write' | 'destructive' | 'external', checkpoint = false) => ({
    sideEffect,
    checkpoint,
  });
  it.each([
    ['read', tool('read'), [false, false, false]],
    ['write', tool('write'), [true, false, false]],
    ['checkpoint (render)', tool('write', true), [true, true, false]],
    ['destructive', tool('destructive'), [true, true, true]],
    ['external', tool('external'), [true, true, true]],
  ] as const)('%s', (_label, descriptor, expected) => {
    expect(AUTONOMY_LEVELS.map((level) => needsApproval(descriptor, level))).toEqual(expected);
  });

  it('asks once per model turn for the writes at "Ask me at every step"', async () => {
    const h = harness({
      settings: { autonomy: 'every-step' },
      script: turns(
        plan('Rename'),
        {
          toolCalls: [
            call('clips_renameClip', { id: 'c1', title: 'A' }),
            call('clips_renameClip', { id: 'c2', title: 'B' }),
            call('clips_countWords', { text: 'x' }),
          ],
        },
        { text: 'Renamed.' },
      ),
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'rename' }));
    expect(paused.pending).toHaveLength(1);
    const requested = ofType(await h.events(paused.runId), 'approval.requested');
    expect(requested[0]?.payload.toolCallIds).toHaveLength(2);
    expect(
      unwrap(
        await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
      ).status,
    ).toBe('completed');
    expect(h.applied).toHaveLength(2);
  });

  it.each([
    ['before-render', true],
    ['autopilot', false],
  ] as const)('stops before a render at "%s": %s', async (autonomy, stops) => {
    const h = harness({
      settings: { autonomy },
      script: turns(
        plan('Render'),
        { toolCalls: [call('clips_renderVideo', { preset: 'reels' })] },
        { text: 'Rendered.' },
      ),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'render' }));
    expect(outcome.status).toBe(stops ? 'paused' : 'completed');
  });

  it('lets writes run without asking at the default level', async () => {
    const h = harness({
      settings: { autonomy: 'before-render' },
      script: turns(
        plan('Rename'),
        { toolCalls: [call('clips_renameClip', { id: 'c1', title: 'A' })] },
        { text: 'Renamed.' },
      ),
    });
    expect(unwrap(await h.agent.run({ conversationId: 'c', message: 'rename' })).status).toBe('completed');
  });
});

describe('guards around the policy', () => {
  it('refuses internet tools in local-only mode', async () => {
    const h = harness({
      settings: { localOnly: true },
      script: turns(
        plan('Share'),
        { toolCalls: [call('clips_shareClip', { id: 'c1' })] },
        { text: 'Could not share.' },
      ),
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'share' }));
    expect(ofType(await h.events(outcome.runId), 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.permission_denied',
    ]);
  });

  it('still refuses a destructive call when a buggy policy allows it without an approval id', async () => {
    const lax = harness({ script: deleteScript });
    const { commands, applied } = recordingCommands();
    const executor = createToolExecutor({
      registry: lax.registry,
      policy: { authorize: () => ({ kind: 'allow' }) },
      commands: {
        dispatch: (command, payload, meta) =>
          commands.dispatch(command, payload, { source: 'agent', toolCallId: meta.callId, tool: meta.tool }),
      },
    });
    const h = harness({ script: deleteScript, deps: { executor } });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'delete' }));
    expect(ofType(await h.events(outcome.runId), 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.approval_required',
    ]);
    expect(applied).toEqual([]);
  });

  it.each([
    ['every-step', 'tools.approval_required'],
    ['before-render', 'tools.approval_required'],
    ['autopilot', undefined],
  ] as const)(
    'refuses a render on a buggy allow unless the level skips the stop (%s)',
    async (autonomy, refused) => {
      const renderScript = turns(
        plan('Render'),
        { toolCalls: [call('clips_renderVideo', { preset: 'reel' })] },
        { text: 'Done.' },
      );
      const lax = harness({ script: renderScript });
      const { commands, applied } = recordingCommands();
      const executor = createToolExecutor({
        registry: lax.registry,
        policy: { authorize: () => ({ kind: 'allow' }) },
        commands: {
          dispatch: (command, payload, meta) =>
            commands.dispatch(command, payload, { source: 'agent', toolCallId: meta.callId, tool: meta.tool }),
        },
      });
      const h = harness({ script: renderScript, deps: { executor }, settings: { autonomy, budget: {} } });
      const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'render' }));
      const failed = ofType(await h.events(outcome.runId), 'tool.failed').map((e) => e.payload.error.code);
      expect(failed).toEqual(refused ? [refused] : []);
      expect(applied).toHaveLength(refused ? 0 : 1);
    },
  );
});
