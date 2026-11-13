// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Loop and Agent API edges: verification, limits, model errors, cancel, resume rules, plan edits. */
import { unwrap, type RunId } from '@taalcut/core';
import { createAgent, createMemoryEventLogStore, type VerifyVerdict } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, ofType, plan, SOUL, turns, types } from './support/harness';

const ask = { conversationId: 'c', message: 'count words' };
const countThenSay = turns(
  plan('Count'),
  { toolCalls: [call('clips_countWords', { text: 'a b' })] },
  { text: 'Two words.' },
);

describe('verification', () => {
  it('sends a failed check back to the model, then passes', async () => {
    const verdicts: VerifyVerdict[] = [{ verdict: 'retry', reason: 'count again' }, { verdict: 'pass' }];
    const h = harness({
      script: countThenSay,
      deps: { verifier: { verify: async () => verdicts.shift()! } },
    });
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome.status).toBe('completed');
    const verify = ofType(await h.events(outcome.runId), 'verify.result').map((e) => e.payload.verdict);
    expect(verify).toEqual(['retry', 'pass']);
    expect(h.models.requests.at(-1)!.messages).toContainEqual({
      role: 'user',
      content: '[Taalcut] Check failed: count again',
    });
  });

  it('fails the run when the check fails or keeps asking for retries', async () => {
    const failing = harness({
      script: countThenSay,
      deps: { verifier: { verify: async () => ({ verdict: 'fail', reason: 'wrong' }) } },
    });
    const failed = unwrap(await failing.agent.run(ask));
    expect(failed).toMatchObject({
      status: 'failed',
      error: { code: 'agent.verify_failed', detail: 'wrong' },
    });
    const stubborn = harness({
      script: countThenSay,
      deps: { verifier: { verify: async () => ({ verdict: 'retry', reason: 'again' }) } },
    });
    expect(unwrap(await stubborn.agent.run(ask)).error?.code).toBe('agent.verify_failed');
    expect(failing.ui).toContainEqual(
      expect.objectContaining({ card: expect.objectContaining({ kind: 'error' }) }),
    );
  });
});

describe('limits and failures', () => {
  it('stops a model that never finishes a step', async () => {
    const loops = harness({
      script: (_r, turn) =>
        turn === 0 ? plan('Loop') : { toolCalls: [call('clips_countWords', { text: `${turn}` })] },
      settings: { loop: { maxTurnsPerStep: 3 } },
    });
    expect(unwrap(await loops.agent.run(ask)).error).toMatchObject({
      code: 'agent.turn_limit',
      params: { limit: 3 },
    });
    const total = harness({
      script: (_r, turn) => (turn === 0 ? plan('A', 'B', 'C') : { text: 'step done' }),
      settings: { loop: { maxTurns: 2 } },
    });
    expect(unwrap(await total.agent.run(ask)).error).toMatchObject({
      code: 'agent.turn_limit',
      params: { limit: 2 },
    });
  });

  it('fails the run with an error card when the model call fails', async () => {
    // A limit every model met pauses instead (G8, test/limits); a dropped call is retried first (FIX-RUN,
    // model-retry.test.ts); any other failure ends the run.
    const h = harness({
      script: () => ({
        error: {
          code: 'models.provider_unavailable',
          messageKey: 'errors.models.provider_unavailable',
          retryable: true,
        },
      }),
      settings: { loop: { modelRetryDelaysMs: [] } },
    });
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'models.provider_unavailable' } });
    expect(types(await h.events(outcome.runId))).toEqual([
      'run.started',
      'model.requested',
      'model.failed',
      'run.failed',
    ]);
  });

  it('plans one step when the plan turn calls something other than updatePlan', async () => {
    const h = harness({
      script: turns({ toolCalls: [call('clips_countWords', { text: 'x' })] }, { text: 'Counted.' }),
    });
    const outcome = unwrap(await h.agent.run(ask));
    expect(outcome.status).toBe('completed');
    expect(ofType(await h.events(outcome.runId), 'plan.created')[0]?.payload.steps).toEqual([
      { id: 's1', text: 'count words' },
    ]);
  });

  it('revises the plan, keeping ids, and reports bad plan and artifact calls as errors', async () => {
    const h = harness({
      script: turns(
        plan('One'),
        { toolCalls: [call('updatePlan', { steps: [{ id: 's1', text: 'One, better' }, { text: 'Two' }] })] },
        {
          toolCalls: [
            call('updatePlan', { steps: [] }),
            call('readArtifact', { id: 'not-an-id' }),
            call('findTools', { query: 'zzzz qqqq' }),
          ],
        },
        { text: 'Step one done.' },
        { text: 'Step two done.' },
      ),
    });
    const outcome = unwrap(await h.agent.run(ask));
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'plan.updated')[0]?.payload.steps).toEqual([
      { id: 's1', text: 'One, better' },
      { id: 's2', text: 'Two' },
    ]);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'tools.invalid_input',
      'core.not_found',
    ]);
    expect(ofType(events, 'tool.completed').at(-1)?.payload.output).toMatchObject({
      value: expect.stringContaining('No tool matches'),
    });
    expect(outcome.report).toBe('Step two done.');
  });
});

describe('cancel', () => {
  it('stops a run mid-tool and closes the open call as cancelled', async () => {
    let entered: () => void = () => {};
    const inTool = new Promise<void>((resolve) => (entered = resolve));
    const h = harness({
      barrier: () => {
        entered();
        return new Promise(() => {});
      },
      script: turns(plan('Wait'), { toolCalls: [call('clips_waitAtBarrier', { id: 'a' })] }),
    });
    const runId = unwrap(await h.agent.start(ask));
    await inTool;
    const outcome = unwrap(await h.agent.cancel(runId));
    expect(outcome.status).toBe('cancelled');
    const events = await h.events(runId);
    expect(ofType(events, 'tool.failed').map((e) => e.payload.error.code)).toEqual(['core.cancelled']);
    expect(types(events).at(-1)).toBe('run.cancelled');
    expect(unwrap(await h.agent.cancel(runId)).status).toBe('cancelled');
  });

  it('cancels a paused run without driving it', async () => {
    const h = harness({
      script: turns(plan('Delete'), { toolCalls: [call('clips_deleteClip', { id: 'c1' })] }),
    });
    const paused = unwrap(await h.agent.run(ask));
    const outcome = unwrap(await h.agent.cancel(paused.runId));
    expect(outcome.status).toBe('cancelled');
    expect(ofType(await h.events(paused.runId), 'tool.failed').map((e) => e.payload.error.code)).toEqual([
      'core.cancelled',
    ]);
  });
});

describe('resume rules', () => {
  it('closes a model call cut off by a crash and asks again', async () => {
    const store = createMemoryEventLogStore();
    const first = harness({ store, script: countThenSay });
    const done = unwrap(await first.agent.run(ask));
    // Rebuild a log that stops right after a model.requested, as if the process died mid-call.
    const events = await first.events(done.runId);
    const cutAt = events.findIndex((e) => e.type === 'model.requested' && e.seq > 5);
    const crashed = createMemoryEventLogStore();
    const runId = done.runId;
    unwrap(await crashed.append(runId, 0, events.slice(0, cutAt + 1)));
    const second = harness({ store: crashed, script: countThenSay });
    expect(unwrap(await second.agent.recoverInterrupted())).toEqual([runId]);
    const outcome = unwrap(await second.agent.wait(runId));
    expect(outcome.status).toBe('completed');
    const failed = ofType(await second.events(runId), 'model.failed');
    expect(failed.map((e) => e.payload.error.code)).toEqual(['agent.model_call_abandoned']);
  });

  it('reports finished runs, keeps waiting runs paused, and resumes paused runs whose answers are in', async () => {
    const h = harness({
      script: turns(
        plan('Delete'),
        { toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
        { text: 'Deleted.' },
      ),
    });
    const paused = unwrap(await h.agent.run(ask));
    expect(unwrap(await h.agent.resume(paused.runId)).status).toBe('paused');
    expect(unwrap(await h.agent.recoverInterrupted())).toEqual([]);
    // Another process answers in the log; this one picks it up on resume.
    const other = createAgent({ models: h.models, tools: h.registry, log: h.store, soul: SOUL });
    const approved = unwrap(
      await other.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(approved.status).toBe('completed');
    const finished = await h.agent.resume(paused.runId);
    expect(!finished.ok && finished.error.code).toBe('agent.run_finished');
  });

  it('resumes a paused run whose answer was logged before a crash', async () => {
    const h = harness({
      script: turns(
        plan('Delete'),
        { toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
        { text: 'Deleted.' },
      ),
    });
    const paused = unwrap(await h.agent.run(ask));
    unwrap(
      await h.store.append(paused.runId, (await h.events(paused.runId)).length, [
        {
          type: 'approval.granted',
          v: 1,
          at: Date.now(),
          payload: { requestId: paused.pending[0]!.requestId },
        },
      ]),
    );
    const fresh = createAgent({
      models: h.models,
      tools: h.registry,
      log: h.store,
      soul: SOUL,
      commands: { dispatch: async () => ({ ok: true, value: {} }) },
    });
    expect(unwrap(await fresh.resume(paused.runId)).status).toBe('completed');
  });

  it('asks again before re-running an external call that may have gone out before a crash', async () => {
    const h = harness({
      script: turns(
        plan('Share'),
        { toolCalls: [call('clips_shareClip', { id: 'c1' })] },
        { text: 'Shared.' },
      ),
    });
    const paused = unwrap(await h.agent.run(ask));
    const first = paused.pending[0]!.requestId;
    // The user approved and the upload started; then the process died before the result was logged.
    const seq = (await h.events(paused.runId)).length;
    unwrap(
      await h.store.append(paused.runId, seq, [
        { type: 'approval.granted', v: 1, at: Date.now(), payload: { requestId: first } },
        { type: 'run.resumed', v: 1, at: Date.now(), payload: { after: 'approval' } },
      ]),
    );
    const fresh = createAgent({ models: h.models, tools: h.registry, log: h.store, soul: SOUL });
    expect(unwrap(await fresh.recoverInterrupted())).toEqual([paused.runId]);
    const again = unwrap(await fresh.wait(paused.runId));
    expect(again).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    expect(again.pending[0]!.requestId).not.toBe(first);
    const done = unwrap(
      await fresh.answer(paused.runId, { requestId: again.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done.status).toBe('completed');
    const shared = ofType(await h.events(paused.runId), 'tool.completed').at(-1);
    expect(shared?.payload.approvalId).toBe(again.pending[0]!.requestId);
  });

  it('answers clearly for unknown runs', async () => {
    const h = harness({ script: countThenSay });
    const missing = '01J00000000000000000000000' as RunId;
    expect((await h.agent.resume(missing)).ok).toBe(false);
    expect(unwrap(await h.agent.events(missing))).toEqual([]);
    expect((await h.agent.wait(missing)).ok).toBe(false);
  });
});
