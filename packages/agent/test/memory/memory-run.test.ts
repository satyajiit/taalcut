// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM in a run: memory is recalled once, logged in run.started and ends every system prompt; a replay builds
 * the same prompts from the log whatever memory says now; `memory.remember` asks the creator even on autopilot
 * and stores an agent item only when they approve; `memory.recall`'s words reach the model fenced.
 */
import { MEMORY_COMMANDS, newId, ok, unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createMemoryEventLogStore,
  memoryBlock,
  memoryRunFacts,
  memoryToolModule,
  needsApproval,
  redactRunEvent,
} from '../../src';
import { clipsModule } from '../support/fixtures';
import { call, harness, ofType, plan, toolText, turns } from '../support/harness';
import { fakeRanker, memoryView, recallDeps } from './memory-support';

const projectId = newId<'Project'>();
const ASK = { conversationId: 'c', projectId, message: 'Make a reel of my Goa trip.' };
const whip = memoryView('Never use whip transitions.');
const decision = memoryView('Open on the drone shot.', {
  scope: { kind: 'project', projectId },
  scopeName: 'Goa trip',
  source: 'agent',
});

function setup(script: Parameters<typeof turns>) {
  const ranker = fakeRanker([whip, decision]);
  const memory = recallDeps(ranker);
  // The tools read the run's chat and project from its run.started, as the agent root wires them.
  const store = createMemoryEventLogStore();
  const h = harness({
    script: turns(...script),
    store,
    modules: [
      clipsModule(),
      memoryToolModule({
        ranker,
        run: memoryRunFacts(store),
        scopeName: async (scope) => ok(scope.kind === 'user' ? null : 'Goa trip'),
      }),
    ],
    deps: { phase3: { memory } },
  });
  return { ...h, ranker };
}

describe('memory in a run (LRN1-MEM)', () => {
  it('recalls once, logs it in run.started and ends every system prompt with it', async () => {
    const h = setup([
      plan('List the clips'),
      { toolCalls: [call('clips_listClips', { count: 1 })] },
      { text: 'Done.' },
    ]);
    const outcome = unwrap(await h.agent.run(ASK));
    expect(outcome.status).toBe('completed');
    const started = ofType(await h.events(outcome.runId), 'run.started')[0]!.payload;
    expect(started.memory?.use).toBe('on-device');
    expect(started.memory?.items.map((item) => item.text)).toEqual([whip.text, decision.text]);
    expect(h.ranker.asked).toHaveLength(1);
    const block = memoryBlock(started.memory)!;
    expect(h.models.requests.length).toBeGreaterThan(1);
    expect(h.models.requests.every((request) => request.system?.endsWith(block))).toBe(true);
  });

  it("keeps only recalled memory's shape in a support bundle unless chat text is included", async () => {
    const h = setup([plan('List the clips'), { text: 'Done.' }]);
    const outcome = unwrap(await h.agent.run(ASK));
    const started = ofType(await h.events(outcome.runId), 'run.started')[0]!;
    const redacted = JSON.stringify(
      redactRunEvent(started, { includeChatText: false, home: '/Users/me' }).event,
    );
    expect(redacted).not.toContain('whip');
    expect(redacted).not.toContain('Goa trip');
    expect(redacted).toContain(whip.id);
    expect(redacted).toContain('"use":"on-device"');
    const kept = JSON.stringify(redactRunEvent(started, { includeChatText: true, home: '/Users/me' }).event);
    expect(kept).toContain('Never use whip transitions.');
  });

  it('replays the prompts the run had, though memory changed since', async () => {
    const h = setup([
      plan('List the clips'),
      { toolCalls: [call('clips_listClips', { count: 1 })] },
      { text: 'Done.' },
    ]);
    const outcome = unwrap(await h.agent.run(ASK));
    h.ranker.items = [memoryView('Always use whip transitions.')];
    const report = unwrap(await h.agent.replay(outcome.runId));
    expect(report).toMatchObject({ promptDrift: 0, status: 'completed' });
    expect(h.ranker.asked).toHaveLength(1);
  });

  it('asks before remembering even on autopilot, and stores an agent item for the project once approved', async () => {
    const remember = call('memory_remember', { text: 'Never use whip transitions.', scope: 'project' });
    const h = setup([plan('Remember the preference'), { toolCalls: [remember] }, { text: 'Noted.' }]);
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused.status).toBe('paused');
    expect(h.applied).toEqual([]);
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done.status).toBe('completed');
    expect(h.applied).toHaveLength(1);
    expect(h.applied[0]).toMatchObject({
      command: MEMORY_COMMANDS.create,
      payload: {
        item: {
          scope: { kind: 'project', projectId },
          text: 'Never use whip transitions.',
          source: 'agent',
          conversationId: 'c',
        },
      },
    });
  });

  it('stores nothing when the creator says no', async () => {
    const remember = call('memory_remember', { text: 'Bold captions.', scope: 'user' });
    const h = setup([plan('Remember it'), { toolCalls: [remember] }, { text: 'Fine.' }]);
    const paused = unwrap(await h.agent.run(ASK));
    unwrap(await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'deny' }));
    expect(h.applied).toEqual([]);
  });

  it('refuses a project item in a chat without a project', async () => {
    const remember = call('memory_remember', { text: 'Open on the drone.', scope: 'project' });
    const h = setup([plan('Remember it'), { toolCalls: [remember] }, { text: 'Could not.' }]);
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: ASK.message }));
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    const failed = ofType(await h.events(done.runId), 'tool.failed');
    expect(failed.map((event) => event.payload.error.code)).toEqual(['core.validation']);
    expect(h.applied).toEqual([]);
  });

  it('fences what memory.recall read before the model sees it', async () => {
    const h = setup([
      plan('Check memory'),
      { toolCalls: [call('memory_recall', { query: 'transitions' })] },
      { text: 'Ok.' },
    ]);
    const outcome = unwrap(await h.agent.run(ASK));
    expect(outcome.status).toBe('completed');
    const last = h.models.requests.at(-1)!;
    const text = toolText(last.messages.findLast((message) => message.role === 'tool'));
    expect(text).not.toMatch(/"text":"Never/);
    expect(text).toContain('<untrusted id="1" source="memory">\nNever use whip transitions.\n</untrusted>');
  });

  it('needs approval for an always-ask tool at every autonomy level', () => {
    const tool = { sideEffect: 'write' as const, checkpoint: false, alwaysAsk: true };
    expect(needsApproval(tool, 'autopilot')).toBe(true);
    expect(needsApproval({ ...tool, alwaysAsk: false }, 'autopilot')).toBe(false);
  });
});
