// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X7, agent half (SPEC sections 16 and 18): a flow emits flow.started,
 * breakdown.completed, cast.completed, qa.result, cost.recorded and (with the
 * desktop's export facts) export.completed, in that order, each
 * one valid against core's telemetry catalogue (enums and bounded numbers,
 * no ids or text), with the project as context only. A local-only run sends
 * none (the service also drops everything without consent). A flow left for
 * 24 hours reports its cost once, as abandoned.
 */
import { telemetryEventSchema, unwrap, type Telemetry, type TelemetryEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';
import { ofType } from './support/harness';

function recorder() {
  const events: { event: TelemetryEvent; projectId?: string }[] = [];
  const telemetry: Telemetry = {
    record: (event, context) =>
      void events.push({ event, ...(context?.projectId ? { projectId: context.projectId } : {}) }),
  };
  return { telemetry, events };
}

const reference = { kind: 'link' as const, url: 'https://www.instagram.com/reel/t/' };

describe("the agent's telemetry", () => {
  it("a flow emits its events in order, each valid against core's catalogue", async () => {
    const t = recorder();
    const asked: unknown[] = [];
    const h = flowHarness({
      telemetry: t.telemetry,
      script: flowScript({ ask: false, turnUsd: 0.002 }),
      settings: { autonomy: 'autopilot' },
      deps: {
        exports: {
          facts: async (input) => {
            asked.push(input);
            return {
              firstExport: true,
              slots: 4,
              slotsKeptAi: 3,
              slotsSwappedByUser: 1,
              orderChanged: false,
              breakdownEdited: false,
            };
          },
        },
      },
    });
    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy',
        start: { path: 'reference', reference },
      }),
    );
    expect(outcome.status).toBe('completed');
    expect(t.events.map((e) => e.event.name)).toEqual([
      'flow.started',
      'breakdown.completed',
      'cast.completed',
      'qa.result',
      'cost.recorded',
      'export.completed',
    ]);
    for (const { event, projectId } of t.events) {
      expect(telemetryEventSchema.safeParse(event).success, event.name).toBe(true);
      expect(projectId).toBe(h.world.projectId);
      // Nothing that could identify media or the project rides in the event itself.
      expect(JSON.stringify(event)).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}|instagram/);
    }
    expect(t.events[0]?.event).toEqual({ name: 'flow.started', path: 'reference' });
    expect(t.events[2]?.event).toMatchObject({
      name: 'cast.completed',
      slots: 4,
      variants: 1,
      lowConfidence: 1,
      reranked: 0,
    });
    expect(t.events[3]?.event).toEqual({
      name: 'qa.result',
      passed: true,
      firstPass: true,
      fixLoops: 0,
      failed: [],
    });
    expect(t.events[5]?.event).toEqual({
      name: 'export.completed',
      firstExport: true,
      path: 'reference',
      preset: 'reels',
      musicPath: 'platformSound',
      slots: 4,
      slotsKeptAi: 3,
      slotsSwappedByUser: 1,
      orderChanged: false,
      breakdownEdited: false,
      seconds: 30,
      renderMs: 12_500,
    });
    expect(asked).toEqual([
      { projectId: h.world.projectId, timelineId: expect.any(String), renderId: expect.any(String) },
    ]);
    const cost = t.events[4]!.event;
    expect(cost).toMatchObject({
      name: 'cost.recorded',
      scope: 'export',
      capHit: false,
      byModule: { agent: expect.any(Number) },
    });
    expect(cost.name === 'cost.recorded' && cost.usdMicros).toBeGreaterThan(0);
  });

  it('qa.result counts the fix rounds before each review', async () => {
    const t = recorder();
    const h = flowHarness({
      world: createWorld({ qa: [false, true] }),
      telemetry: t.telemetry,
      script: flowScript({ ask: false }),
      settings: { autonomy: 'autopilot' },
    });
    unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy',
        start: { path: 'reference', reference },
      }),
    );
    expect(t.events.filter((e) => e.event.name === 'qa.result').map((e) => e.event)).toEqual([
      { name: 'qa.result', passed: false, firstPass: false, fixLoops: 0, failed: [] },
      { name: 'qa.result', passed: true, firstPass: false, fixLoops: 1, failed: [] },
    ]);
    // Without the desktop's export facts there is no export.completed.
    expect(t.events.some((e) => e.event.name === 'export.completed')).toBe(false);
  });

  it('a local-only run sends nothing', async () => {
    const t = recorder();
    const h = flowHarness({
      telemetry: t.telemetry,
      script: flowScript({ ask: false }),
      settings: { autonomy: 'autopilot', localOnly: true },
    });
    unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy',
        start: { path: 'reference', reference },
      }),
    );
    expect(t.events).toEqual([]);
  });

  it('a flow with no step for 24 hours reports its cost once, as abandoned', async () => {
    const t = recorder();
    let clock = Date.parse('2026-10-01T10:00:00Z');
    const h = flowHarness({ telemetry: t.telemetry, script: flowScript(), deps: { now: () => clock } });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Copy',
        start: { path: 'reference', reference },
      }),
    );
    expect(unwrap(await h.agent.wait(runId)).status).toBe('paused');
    expect(unwrap(await h.agent.sweepAbandonedFlows())).toEqual([]);
    clock += 25 * 60 * 60 * 1000;
    expect(unwrap(await h.agent.sweepAbandonedFlows())).toEqual([runId]);
    expect(unwrap(await h.agent.sweepAbandonedFlows())).toEqual([]);
    expect(t.events.filter((e) => e.event.name === 'cost.recorded').map((e) => e.event)).toMatchObject([
      { scope: 'abandoned' },
    ]);
    expect(ofType(await h.events(runId), 'flow.abandoned')).toHaveLength(1);
  });
});
