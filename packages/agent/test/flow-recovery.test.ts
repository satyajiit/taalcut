// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Flow recovery, plain-step scaling & prompt deduplication, selection chips,
 * fallback s1 plan updates, and step failure card/estimate settlement.
 */
import { newId, unwrap, type Card } from '@taalcut/core';
import {
  createSkillRegistry,
  DEFAULT_LOOP_SETTINGS,
  foldEvents,
  runTurnLimit,
  stepTurnLimit,
  type AgentEvent,
  type ModelScript,
} from '@taalcut/agent';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialState } from '../src/state';
import { selectionNote } from '../src/state-flow';
import { FLOW_RULES } from '../src/skill-prompt';
import { startFlowSpec } from '../src/skill-tools';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { call, harness, ofType, registryFor } from './support/harness';

const CLOUD_WINDOW = 272_000;

describe('startFlow runtime brief length & FLOW_RULES guidance', () => {
  it('keeps brief.text wire schema at maxLength 500 while accepting >500 chars at runtime', async () => {
    const wire = z.toJSONSchema(startFlowSpec(['describe', 'reference']).parameters) as {
      properties?: { brief?: { properties?: { text?: { maxLength?: number } } } };
    };
    expect(wire.properties?.brief?.properties?.text?.maxLength).toBe(500);
    expect(FLOW_RULES).toContain('aiming under 500 chars');

    const filenames = Array.from({ length: 12 }, (_, i) => `clip_${i + 1}_new_home_floor.mp4`).join(', ');
    const longText =
      `${filenames} — our first own house after 10+ years in a rented house, ground floor ready and first floor in progress with warm cinematic transitions and music pacing `.repeat(
        3,
      );
    expect(longText.length).toBeGreaterThan(600);
    expect(longText.length).toBeLessThanOrEqual(4000);

    const base = flowScript({ ask: false, variants: 1 });
    const h = flowHarness({
      settings: { autonomy: 'autopilot' },
      script: (request, turn) => {
        if (turn === 0)
          return {
            toolCalls: [
              call('startFlow', { path: 'describe', brief: { text: longText, targetSeconds: 30 } }),
            ],
          };
        return base(request, turn);
      },
    });
    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Make a reel from my 12 new home clips',
      }),
    );
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'flow.started')[0]?.payload.input).toMatchObject({
      brief: { text: longText.trim(), targetSeconds: 30 },
    });
  });
});

describe('retrying phase: plan when startFlow or updatePlan fails validation', () => {
  it('retries phase: plan on Turn 2 after Turn 1 startFlow fails, then starts the flow', async () => {
    const base = flowScript({ ask: false, variants: 1 });
    const phases: string[] = [];
    const h = flowHarness({
      settings: { autonomy: 'autopilot' },
      script: (request, turn) => {
        const offered = (request.tools ?? []).map((t) => t.name);
        if (offered.includes('startFlow')) phases.push('plan');
        if (turn === 0) {
          // Invalid: path "describe" with >4000 chars fails runtime validation.
          return {
            toolCalls: [call('startFlow', { path: 'describe', brief: { text: 'x'.repeat(4500) } })],
          };
        }
        if (turn === 1) {
          return {
            toolCalls: [
              call('startFlow', { path: 'describe', brief: { text: 'First own home milestone reel' } }),
            ],
          };
        }
        return base(request, turn);
      },
    });
    const outcome = unwrap(
      await h.agent.run({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Make a milestone reel',
      }),
    );
    expect(outcome.status).toBe('completed');
    expect(phases).toEqual(['plan', 'plan']);
    const events = await h.events(outcome.runId);
    expect(ofType(events, 'tool.failed')[0]?.payload.error.code).toBe('tools.invalid_input');
    expect(ofType(events, 'flow.started')).toHaveLength(1);
  });

  it('falls back to default plain step s1 after 3 failed planning turns', async () => {
    const h = flowHarness({
      script: (_request, turn) => {
        if (turn < 3) return { toolCalls: [call('updatePlan', { steps: [] })] };
        return { text: 'Handled directly.' };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Quick question' }));
    expect(outcome.status).toBe('completed');
    const events = await h.events(outcome.runId);
    expect(
      ofType(events, 'model.requested')
        .slice(0, 3)
        .map((e) => e.payload.phase),
    ).toEqual(['plan', 'plan', 'plan']);
    expect(ofType(events, 'plan.created')[0]?.payload.steps).toEqual([{ id: 's1', text: 'Quick question' }]);
  });
});

describe('SelectionChip kind: asset', () => {
  it('formats asset chips with and without filename in selectionNote', () => {
    const a1 = newId<'Asset'>();
    const a2 = newId<'Asset'>();
    const note = selectionNote([
      { kind: 'asset', assetId: a1, name: 'ground_floor.mp4' },
      { kind: 'asset', assetId: a2 },
    ]);
    expect(note).toBe(
      `The user selected:\n- library asset ${a1} ("ground_floor.mp4")\n- library asset ${a2}`,
    );
  });
});

describe('plain-step turn scaling, prompt deduplication & last-turn warning', () => {
  it('scales stepTurnLimit and runTurnLimit for plain steps on cloud windows', () => {
    const emptySkills = unwrap(createSkillRegistry([], registryFor([])));
    const settings = { ...DEFAULT_LOOP_SETTINGS, maxTurns: 25, maxTurnsPerStep: 10 };
    expect(stepTurnLimit(undefined, settings, { window: undefined })).toBe(10);
    expect(stepTurnLimit(undefined, settings, { window: 64_000 })).toBe(15);
    expect(stepTurnLimit(undefined, settings, { window: CLOUD_WINDOW })).toBe(30);

    const unscaled = initialState(newId<'AgentRun'>());
    unscaled.plan = [
      { id: 's1', text: 'Work', status: 'doing', turns: 0, verifyRetries: 0, ended: false, summary: '' },
    ];
    expect(runTurnLimit(unscaled, emptySkills, settings)).toBe(25);

    const cloud = initialState(newId<'AgentRun'>());
    cloud.plan = [
      {
        id: 's1',
        text: 'Work',
        status: 'doing',
        turns: 0,
        verifyRetries: 0,
        ended: false,
        summary: '',
        window: CLOUD_WINDOW,
      },
    ];
    expect(runTurnLimit(cloud, emptySkills, settings)).toBe(75);
  });

  it('omits # Tool catalogue when plain.all is true and warns on the plain step’s final turn', async () => {
    const h = harness({
      deps: { contextWindow: () => CLOUD_WINDOW },
      settings: { loop: { maxTurnsPerStep: 1, maxTurns: 10 } },
      script: (_request, turn) => {
        if (turn === 0) return { toolCalls: [call('updatePlan', { steps: [{ text: 'Count words' }] })] };
        if (turn === 1) return { toolCalls: [call('clips_countWords', { text: 'one two' })] };
        return { text: 'Counted two words.' };
      },
    });
    const outcome = unwrap(await h.agent.run({ conversationId: 'c', message: 'Count words' }));
    expect(outcome.status).toBe('completed');
    const [planReq, act1, actLast] = h.models.requests;
    // Plan turn keeps # Tool catalogue; act turns with plain.all omit it and use ACT_OFFERED.
    expect(planReq?.system).toContain('# Tool catalogue');
    expect(act1?.system).not.toContain('# Tool catalogue');
    expect(act1?.system).toContain('- Act with tools. Every tool you can call is offered to you.');
    expect(act1?.system).not.toContain('# Last turn');
    // Step limit = 1 * 3 = 3 turns (indices 0, 1, 2): turn index 2 (actLast, step.turns === 2) gets # Last turn.
    const hLast = harness({
      deps: { contextWindow: () => CLOUD_WINDOW },
      settings: { loop: { maxTurnsPerStep: 1, maxTurns: 10 } },
      script: (_request, turn) => {
        if (turn === 0) return { toolCalls: [call('updatePlan', { steps: [{ text: 'Count words' }] })] };
        if (turn <= 2) return { toolCalls: [call('clips_countWords', { text: 'one two' })] };
        return { text: 'Finished cleanly on the final turn.' };
      },
    });
    const done = unwrap(await hLast.agent.run({ conversationId: 'c', message: 'Count words' }));
    expect(done.status).toBe('completed');
    expect(hLast.models.requests.at(-1)?.system).toContain('# Last turn');
    expect(actLast?.system).not.toContain('# Last turn');
  });
});

describe('updatePlan on auto-generated fallback step s1', () => {
  it('updates s1 text in place and appends remaining steps instead of leaving stale s1', () => {
    const state = initialState(newId<'AgentRun'>());
    let seq = 0;
    const push = (type: AgentEvent['type'], payload: unknown) =>
      applyEvent(state, { seq: ++seq, at: seq * 10, v: 1, type, payload } as AgentEvent);

    push('plan.created', { steps: [{ id: 's1', text: 'Original user message' }] });
    push('step.started', { stepId: 's1', index: 0, text: 'Original user message' });
    state.plan![0]!.turns = 2;

    push('plan.updated', {
      steps: [
        { id: 's2', text: 'Inspect clips' },
        { id: 's3', text: 'Assemble reel' },
        { id: 's4', text: 'Verify output' },
      ],
    });

    expect(state.plan?.map((s) => ({ id: s.id, text: s.text, status: s.status, turns: s.turns }))).toEqual([
      { id: 's1', text: 'Inspect clips', status: 'doing', turns: 2 },
      { id: 's3', text: 'Assemble reel', status: 'todo', turns: 0 },
      { id: 's4', text: 'Verify output', status: 'todo', turns: 0 },
    ]);
  });
});

describe('settling step estimate and open plain step card on turn-limit failure', () => {
  it('settles estimate.recorded and updates open plain step card to failed at turn limit', async () => {
    const loopBrief: ModelScript = (request, turn) => {
      if (/# Skill: agent\.brief\b/.test(request.system ?? ''))
        return { toolCalls: [call('findTools', { query: `clips ${turn}` })] };
      return flowScript({ ask: false })(request, turn);
    };
    const h = flowHarness({
      script: loopBrief,
      settings: { loop: { maxTurnsPerStep: 2 } },
      deps: {
        prices: {
          price: (module) => ({
            module,
            provider: 'cloudco',
            model: 'big',
            local: false,
            usdPerMTok: { input: 10, output: 30, cacheRead: 1 },
          }),
          options: () => [],
        },
      },
    });
    const runId = unwrap(
      await h.agent.start({
        conversationId: 'c',
        projectId: h.world.projectId,
        message: 'Make something from my library',
        start: { path: 'library' },
      }),
    );
    const outcome = unwrap(await h.agent.wait(runId));
    expect(outcome).toMatchObject({ status: 'failed', error: { code: 'agent.turn_limit' } });
    const events = await h.events(runId);
    const recorded = ofType(events, 'estimate.recorded');
    expect(recorded).toHaveLength(1);
    expect(ofType(events, 'estimate.settled').map((e) => e.payload.estimateId)).toEqual([
      recorded[0]!.payload.estimateId,
    ]);
    const stepCards = ofType(events, 'card.sent')
      .map((e) => e.payload.card)
      .filter((c): c is Extract<Card, { type: 'step' }> => c.type === 'step');
    expect(stepCards.map((c) => c.step.status)).toEqual(['running', 'failed']);
    expect(foldEvents(runId, events).plan?.[0]?.status).toBe('failed');
  });
});
