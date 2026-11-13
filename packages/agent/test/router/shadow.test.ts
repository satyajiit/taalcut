// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B11 "shadow mode logs both choices and changes nothing" (SPEC section 24): the router answers beside
 * every act turn, its answer and the main model's tool calls are both in the log, the run makes exactly the
 * calls it makes with the router off, a slow router never delays a turn, and replay reads the logged answers.
 */
import { unwrap } from '@taalcut/core';
import { routerDecisions, routerReport, type AgentEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { captionsModule } from '../support/captions-module';
import { clipsModule } from '../support/fixtures';
import { call, harness, ofType, plan, turns } from '../support/harness';
import { answered, setting, slowModel, stubRouter } from './router-support';

const ask = { conversationId: 'c', message: 'How many words are in "sunrise over the bay"?' };
const script = turns(
  plan('Count the words'),
  { toolCalls: [call('clips_countWords', { text: 'sunrise over the bay' })] },
  { text: 'Four words.' },
);
const modules = () => [clipsModule(), captionsModule()];
const callsOf = (events: readonly AgentEvent[]) =>
  ofType(events, 'tool.requested').map((e) => `${e.payload.tool} ${JSON.stringify(e.payload.input)}`);

describe('router shadow mode', () => {
  it('logs the router beside every act turn and changes nothing the run does', async () => {
    const off = harness({ script, modules: modules() });
    const offRun = unwrap(await off.agent.run(ask));
    const router = stubRouter(setting({ mode: 'shadow' }), (_ask, i) => answered(i === 0 ? 'clips' : 'none'));
    const on = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const onRun = unwrap(await on.agent.run(ask));

    expect(onRun.status).toBe('completed');
    const offEvents = await off.events(offRun.runId);
    const onEvents = await on.events(onRun.runId);
    expect(callsOf(onEvents)).toEqual(callsOf(offEvents));
    // The model was offered the same tools on every turn.
    expect(on.models.requests.map((r) => r.tools?.map((t) => t.name))).toEqual(
      off.models.requests.map((r) => r.tools?.map((t) => t.name)),
    );
    const acts = ofType(onEvents, 'model.requested').filter((e) => e.payload.phase === 'act');
    const shadows = ofType(onEvents, 'route.shadow');
    expect(shadows.map((e) => e.payload.modelCallId)).toEqual(acts.map((e) => e.payload.modelCallId));
    expect(shadows[0]?.payload.router).toMatchObject({ choice: 'clips', model: 'stand-in/router-1' });
    expect(ofType(onEvents, 'run.started')[0]?.payload.router).toMatchObject({ mode: 'shadow' });
    // The router never sees the families' tool lines as the decision; it is asked over the families on offer.
    expect(router.asks[0]?.families.map((f) => f.id)).toEqual(['captions', 'clips']);
    expect(router.asks[0]).toMatchObject({ message: ask.message, stepText: 'Count the words', turn: 0 });
    expect(router.asks[1]?.lastFamilies).toEqual(['clips']);
    // Off: nothing about the router in the log at all.
    expect(offEvents.some((e) => e.type.startsWith('route.') && e.type !== 'route.chosen')).toBe(false);
    expect(ofType(offEvents, 'run.started')[0]?.payload.router).toBeUndefined();
  });

  it('sends router.decision telemetry with enums only, never a family name', async () => {
    const sent: unknown[] = [];
    const router = stubRouter(setting({ mode: 'shadow' }), (_ask, i) =>
      answered(i === 0 ? 'clips' : 'captions', 0.55),
    );
    const h = harness({
      script,
      modules: modules(),
      deps: { phase3: { router }, telemetry: { record: (event) => sent.push(event) } },
    });
    unwrap(await h.agent.run(ask));
    const decisions = sent.filter((e) => (e as { name: string }).name === 'router.decision');
    expect(decisions).toEqual([
      {
        name: 'router.decision',
        mode: 'shadow',
        agree: true,
        routerNone: false,
        mainNone: false,
        confidence: 'mid',
        outcome: 'answered',
      },
      {
        name: 'router.decision',
        mode: 'shadow',
        agree: false,
        routerNone: false,
        mainNone: true,
        confidence: 'mid',
        outcome: 'answered',
      },
    ]);
    expect(JSON.stringify(decisions)).not.toMatch(/clips|captions/);
  });

  it('folds agreement from the log: the first domain call, or none, against the router', async () => {
    const router = stubRouter(setting({ mode: 'shadow' }), () => answered('captions'));
    const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const run = unwrap(await h.agent.run(ask));
    const events = await h.events(run.runId);
    expect(routerDecisions(events)).toEqual([
      { choice: 'captions', errored: false, main: 'clips' },
      { choice: 'captions', errored: false, main: 'none' },
    ]);
    expect(routerReport([events], undefined).agreement).toMatchObject({ n: 2, matches: 0 });
  });

  it('a router slower than the model is a timeout, never a delay', async () => {
    const router = stubRouter(setting({ mode: 'shadow' }), () => answered('clips'), {
      delayMs: Number.POSITIVE_INFINITY,
    });
    const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const started = Date.now();
    const run = unwrap(await h.agent.run(ask));
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(run.status).toBe('completed');
    const events = await h.events(run.runId);
    const timeouts = ofType(events, 'route.timeout');
    expect(timeouts).toHaveLength(2);
    expect(timeouts.every((e) => e.payload.errorCode === undefined)).toBe(true);
    expect(ofType(events, 'route.shadow')).toHaveLength(0);
    // The loop gave up on the router (its call is cancelled), and the report counts both as disagreements.
    expect(router.aborted).toHaveLength(2);
    expect(routerReport([events], undefined)).toMatchObject({
      agreement: { n: 2, matches: 0 },
      unanswered: { timeouts: 2, errors: 0, rate: 1 },
    });
  });

  it('abandons the router at its cap while the model is still thinking, and keeps an answer that came in time', async () => {
    const late = stubRouter(setting({ mode: 'shadow' }), () => answered('clips'), {
      delayMs: 80,
      timings: { shadowMs: 20 },
    });
    const h = harness({
      script,
      modules: modules(),
      deps: { models: slowModel(script, 120), phase3: { router: late } },
    });
    const run = unwrap(await h.agent.run(ask));
    const events = await h.events(run.runId);
    expect(ofType(events, 'route.timeout').map((e) => e.payload.afterMs)).toEqual([20, 20]);
    expect(late.aborted).toHaveLength(2);

    const quick = stubRouter(setting({ mode: 'shadow' }), () => answered('clips'), { delayMs: 10 });
    const q = harness({
      script,
      modules: modules(),
      deps: { models: slowModel(script, 80), phase3: { router: quick } },
    });
    const quickRun = unwrap(await q.agent.run(ask));
    expect(ofType(await q.events(quickRun.runId), 'route.shadow')).toHaveLength(2);
  });

  it('records a failing router as an error, still beside the turn', async () => {
    const router = stubRouter(setting({ mode: 'shadow' }), () => ({
      kind: 'failed',
      errorCode: 'models.rate_limited',
    }));
    const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const run = unwrap(await h.agent.run(ask));
    const events = await h.events(run.runId);
    expect(ofType(events, 'route.timeout').map((e) => e.payload.errorCode)).toEqual([
      'models.rate_limited',
      'models.rate_limited',
    ]);
    expect(routerReport([events], undefined).unanswered).toMatchObject({ errors: 2, timeouts: 0 });
  });

  it('replays from the logged answers and never calls the router', async () => {
    const router = stubRouter(setting({ mode: 'shadow' }), (_ask, i) =>
      i === 0 ? answered('clips') : { kind: 'failed', errorCode: 'models.provider_unavailable' },
    );
    const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const run = unwrap(await h.agent.run(ask));
    expect(router.asks).toHaveLength(2);
    const report = unwrap(await h.agent.replay(run.runId));
    expect(report.status).toBe('completed');
    expect(report.toolCalls.map((c) => c.tool)).toEqual(['clips.countWords']);
    expect(router.asks).toHaveLength(2);
  });
});
