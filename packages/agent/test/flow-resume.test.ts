// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flows keep the loop's guarantees (SPEC sections 5 and 11): a flow paused
 * on its question resumes in a new process (another agent over the same
 * log) and reaches the same export card; replay of a finished flow makes the
 * same tool calls from the logged verdicts, with no cards, estimates or
 * telemetry; a follow-up message in the conversation reuses the flow's card
 * ids.
 */
import { unwrap, type Telemetry } from '@taalcut/core';
import { createMemoryEventLogStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';
import { ofType } from './support/harness';

const start = {
  path: 'reference' as const,
  reference: { kind: 'link' as const, url: 'https://www.instagram.com/reel/r/' },
};

describe('flows resume and replay', () => {
  it('a flow paused on its question resumes in another agent over the same log', async () => {
    const world = createWorld();
    const store = createMemoryEventLogStore();
    const first = flowHarness({ world, store, script: flowScript() });
    const runId = unwrap(
      await first.agent.start({ conversationId: 'c', projectId: world.projectId, message: 'Copy', start }),
    );
    const asked = unwrap(await first.agent.wait(runId));
    first.agent.close();

    const second = flowHarness({ world, store, script: flowScript() });
    const done = unwrap(
      await second.agent.answer(runId, {
        requestId: asked.pending[0]!.requestId,
        decision: 'approve',
        answer: { kind: 'variants', count: 1 },
      }),
    );
    expect(done).toMatchObject({ status: 'paused', pending: [{ kind: 'tool' }] });
    const events = await second.events(runId);
    expect(ofType(events, 'skill.entered').map((e) => e.payload.skill)).toEqual([
      'templates.analyst',
      'timeline.librarian',
      'timeline.editor',
      'render.reviewer',
    ]);
    // The second agent's Librarian turn was asked nothing: it read the answer.
    expect(world.calls.filter((c) => c.startsWith('timeline.cast'))).toEqual(['timeline.cast:1']);
  });

  it('replay of a finished flow makes the same calls and sends nothing out', async () => {
    const records: string[] = [];
    const telemetry: Telemetry = { record: (e) => void records.push(e.name) };
    const h = flowHarness({
      telemetry,
      script: flowScript({ ask: false }),
      settings: { autonomy: 'autopilot' },
      world: createWorld({ qa: [false, true] }),
    });
    const outcome = unwrap(
      await h.agent.run({ conversationId: 'c', projectId: h.world.projectId, message: 'Copy', start }),
    );
    expect(outcome.status).toBe('completed');
    const sent = records.length;
    const calls = h.world.calls.length;
    const report = unwrap(await h.agent.replay(outcome.runId));
    expect(report.status).toBe('completed');
    const logged = ofType(await h.events(outcome.runId), 'tool.requested').map((e) => e.payload.tool);
    expect(report.toolCalls.map((c) => c.tool)).toEqual(
      logged.filter((t) => !['handOff', 'askUser', 'startFlow'].includes(t)),
    );
    expect(report.promptDrift).toBe(0);
    expect(records).toHaveLength(sent);
    expect(h.world.calls).toHaveLength(calls);
  });

  it("a follow-up message in the conversation reuses the flow's card ids", async () => {
    const world = createWorld();
    const plan = { value: undefined as Record<string, unknown> | undefined };
    // "Make it punchier": the main model plans one Editor step on the same timeline.
    const script = flowScript({
      ask: false,
      reply: (request) =>
        plan.value &&
        !request.messages.some((m) => m.role === 'assistant' && JSON.stringify(m).includes('updatePlan'))
          ? { toolCalls: [{ name: 'updatePlan', arguments: plan.value }] }
          : { text: 'Tightened.' },
    });
    const h = flowHarness({ world, script, settings: { autonomy: 'autopilot' } });
    const first = unwrap(
      await h.agent.run({ conversationId: 'c', projectId: world.projectId, message: 'Copy', start }),
    );
    const firstEvents = await h.events(first.runId);
    const flowId = ofType(firstEvents, 'flow.started')[0]!.payload.cardFlowId;
    const timelineId = [...world.timelines.keys()][0]!;
    const templateId = [...world.templates.keys()][0]!;
    plan.value = {
      steps: [
        {
          text: 'Tighten the cuts',
          skill: 'timeline.editor',
          input: { projectId: world.projectId, timelineId, templateId },
        },
      ],
    };
    const next = unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: world.projectId,
        message: 'Make it punchier',
        earlierRuns: [first.runId],
      }),
    );
    expect(next.status).toBe('completed');
    const events = await h.events(next.runId);
    expect(ofType(events, 'run.started')[0]?.payload.lastFlow).toEqual({
      flowId,
      projectId: world.projectId,
    });
    expect(ofType(events, 'card.sent').map((e) => e.payload.card.id)).toEqual([
      `step:${flowId}:timeline.editor`,
    ]);
  });
});
