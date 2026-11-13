// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Mode `on` (SPEC section 24): a `live` family, honoured only while the setting's gate is recorded, narrows
 * the act turn to that family's tools; findTools there is an override; `live` without a gate, or the family
 * set back to `shadow`, gives the full catalogue back; a late router leaves the turn main-model-only.
 */
import { unwrap } from '@taalcut/core';
import { familyLive, LIVE_FAMILY_CONFIDENCE, type RouteOutcome } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { captionsModule } from '../support/captions-module';
import { clipsModule } from '../support/fixtures';
import { call, harness, ofType, plan, turns } from '../support/harness';
import { answered, setting, stubRouter } from './router-support';

const ask = { conversationId: 'c', message: 'Count the words and suggest a caption for clip c1.' };
const gate = { passedAt: 1, reportId: 'router-1' };
const modules = () => [clipsModule(), captionsModule()];
const act = (calls: ReturnType<typeof call>[]) => ({ toolCalls: calls });

async function run(
  routerSetting = setting({}),
  outcome: RouteOutcome = answered('clips'),
  first = act([call('clips_countWords', { text: 'a b' })]),
) {
  const script = turns(plan('count words and suggest captions for a clip'), first, { text: 'Done.' });
  const router = stubRouter(routerSetting, () => outcome);
  const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
  const outcomeOfRun = unwrap(await h.agent.run(ask));
  return { h, router, events: await h.events(outcomeOfRun.runId), status: outcomeOfRun.status };
}

/** The tools the first act turn was offered. */
const offered = (h: Awaited<ReturnType<typeof run>>['h']) =>
  h.models.requests[1]?.tools?.map((t) => t.name) ?? [];

describe('router mode on', () => {
  it('a live family with a passed gate loads only its tools, plus the pseudo-tools', async () => {
    const { h, events } = await run(setting({ mode: 'on', families: { clips: 'live' }, gate }));
    const tools = offered(h);
    expect(tools).toEqual(
      expect.arrayContaining(['updatePlan', 'findTools', 'readArtifact', 'clips_countWords']),
    );
    expect(tools.some((name) => name.startsWith('captions_'))).toBe(false);
    expect(ofType(events, 'route.chosen').at(-1)?.payload).toMatchObject({ by: 'router', family: 'clips' });
    expect(ofType(events, 'route.shadow')).toHaveLength(2);
    // The turn after is asked again; the earlier narrowing doesn't carry over by itself.
    expect(ofType(events, 'route.override')).toHaveLength(0);
  });

  it('findTools inside a routed turn is an override, and a disagreement', async () => {
    const { events } = await run(
      setting({ mode: 'on', families: { clips: 'live' }, gate }),
      answered('clips'),
      act([call('findTools', { query: 'suggest captions' })]),
    );
    expect(ofType(events, 'route.override')[0]?.payload).toMatchObject({
      routed: 'clips',
      called: 'findTools',
    });
  });

  it('live without a gate behaves as shadow: logged, nothing narrowed', async () => {
    const { h, events } = await run(setting({ mode: 'on', families: { clips: 'live' }, gate: null }));
    expect(offered(h).some((name) => name.startsWith('captions_'))).toBe(true);
    expect(ofType(events, 'route.chosen').some((e) => e.payload.by === 'router')).toBe(false);
    expect(ofType(events, 'route.shadow')).toHaveLength(2);
  });

  it('setting a family back to shadow restores the full catalogue for it', async () => {
    const { h } = await run(setting({ mode: 'on', families: { clips: 'shadow', captions: 'live' }, gate }));
    expect(offered(h)).toEqual(expect.arrayContaining(['clips_countWords']));
    expect(offered(h).some((name) => name.startsWith('captions_'))).toBe(true);
  });

  it('a low-confidence answer narrows nothing', async () => {
    const { h } = await run(
      setting({ mode: 'on', families: { clips: 'live' }, gate }),
      answered('clips', LIVE_FAMILY_CONFIDENCE - 0.1),
    );
    expect(offered(h).some((name) => name.startsWith('captions_'))).toBe(true);
  });

  it('none, confident and live, offers no domain tools; a domain call then is an override', async () => {
    const { h, events } = await run(
      setting({ mode: 'on', noneLive: true, gate }),
      answered('none', 0.9),
      act([call('clips_countWords', { text: 'a b' })]),
    );
    expect(offered(h)).toEqual(['updatePlan', 'findTools', 'readArtifact']);
    expect(ofType(events, 'route.override')[0]?.payload).toMatchObject({
      routed: 'none',
      called: 'clips_countWords',
    });
  });

  it('a router past its 800 ms budget leaves the turn main-model-only', async () => {
    const script = turns(plan('count words'), act([call('clips_countWords', { text: 'a' })]), { text: 'ok' });
    const router = stubRouter(
      setting({ mode: 'on', families: { clips: 'live' }, gate }),
      () => answered('clips'),
      { delayMs: 200, timings: { liveMs: 20 } },
    );
    const h = harness({ script, modules: modules(), deps: { phase3: { router } } });
    const result = unwrap(await h.agent.run(ask));
    const events = await h.events(result.runId);
    expect(ofType(events, 'route.timeout')[0]?.payload.afterMs).toBeGreaterThanOrEqual(15);
    expect(ofType(events, 'route.chosen').some((e) => e.payload.by === 'router')).toBe(false);
    expect(router.aborted.length).toBeGreaterThan(0);
  });

  it('familyLive follows the mode, the gate and noneLive', () => {
    expect(familyLive(undefined, 'clips')).toBe(false);
    expect(familyLive(setting({ mode: 'shadow', families: { clips: 'live' }, gate }), 'clips')).toBe(false);
    expect(familyLive(setting({ mode: 'on', families: { clips: 'live' }, gate }), 'clips')).toBe(true);
    expect(familyLive(setting({ mode: 'on', families: {}, gate }), 'clips')).toBe(false);
    expect(familyLive(setting({ mode: 'on', noneLive: true, gate }), 'none')).toBe(true);
    expect(familyLive(setting({ mode: 'on', noneLive: true, gate: null }), 'none')).toBe(false);
  });
});
