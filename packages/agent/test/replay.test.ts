// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P1-G2: exact replay from the log, with no side effects; divergence and prompt drift. */
import { unwrap, type RunId } from '@taalcut/core';
import { createAgent, createMemoryEventLogStore, parseSoul, type AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, SOUL, turns } from './support/harness';

const script = turns(
  plan('Tidy the library'),
  { toolCalls: [call('clips_listClips', { count: 2 }), call('clips_countWords', { text: 'a b' })] },
  {
    toolCalls: [
      call('clips_deleteClip', { id: 'c1' }),
      call('clips_renameClip', { id: 'c0', title: 'Keep' }),
    ],
  },
  { text: 'Deleted one clip and renamed another.' },
);

async function finishedRun() {
  const h = harness({ script, settings: { autonomy: 'before-render' } });
  const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'tidy up' }));
  expect(paused.status).toBe('paused');
  const done = unwrap(
    await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
  );
  expect(done.status).toBe('completed');
  return { h, runId: done.runId };
}

describe('exact replay', () => {
  it('reproduces the tool sequence of a run that paused for approval, without dispatching or calling a model', async () => {
    const { h, runId } = await finishedRun();
    const requestsBefore = h.models.requests.length;
    const report = unwrap(await h.agent.replay(runId));
    expect(report).toMatchObject({ runId, modelTurns: 4, promptDrift: 0, status: 'completed' });
    expect(report.toolCalls.map((c) => c.tool)).toEqual([
      'clips.listClips',
      'clips.countWords',
      'clips.deleteClip',
      'clips.renameClip',
    ]);
    expect(h.models.requests).toHaveLength(requestsBefore);
    expect(h.applied).toHaveLength(2);
    // The real log is untouched.
    expect(ofType(await h.events(runId), 'run.completed')).toHaveLength(1);
  });

  it('reports prompt drift when the soul changed since the run, without diverging', async () => {
    const { h, runId } = await finishedRun();
    const edited = createAgent({
      models: h.models,
      tools: h.registry,
      log: h.store,
      soul: parseSoul(`${SOUL.text}\nBe extra brief.`),
    });
    const report = unwrap(await edited.replay(runId));
    expect(report.promptDrift).toBe(4);
    expect(report.toolCalls).toHaveLength(4);
  });

  it('fails with agent.replay_diverged at the first call that differs from the log', async () => {
    const { h, runId } = await finishedRun();
    const tampered = (await h.events(runId)).map((event): AgentEvent => {
      if (event.type !== 'tool.requested' || event.payload.tool !== 'clips.countWords') return event;
      return { ...event, payload: { ...event.payload, input: { text: 'tampered' } } };
    });
    const store = createMemoryEventLogStore();
    unwrap(await store.append(runId, 0, tampered));
    const agent = createAgent({ models: h.models, tools: h.registry, log: store, soul: SOUL });
    const result = await agent.replay(runId);
    expect(!result.ok && result.error).toMatchObject({ code: 'agent.replay_diverged', params: { index: 1 } });
  });

  it('fails when the replay asks the model more often than the log recorded', async () => {
    const { h, runId } = await finishedRun();
    const cut = (await h.events(runId)).filter(
      (e) => !(e.type === 'model.responded' && e.payload.text.startsWith('Deleted')),
    );
    const store = createMemoryEventLogStore();
    unwrap(
      await store.append(
        runId,
        0,
        cut.map((e, seq) => ({ ...e, seq })),
      ),
    );
    const result = await createAgent({ models: h.models, tools: h.registry, log: store, soul: SOUL }).replay(
      runId,
    );
    expect(!result.ok && result.error.code).toBe('agent.replay_diverged');
  });

  it('refuses a run that is not in the log', async () => {
    const h = harness({ script });
    const result = await h.agent.replay('01J00000000000000000000000' as RunId);
    expect(!result.ok && result.error.code).toBe('agent.run_not_found');
  });
});
