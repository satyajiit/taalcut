// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { callRpc, timelineSchema, type Clip, type EnergyCurve, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES, TRIP_TIMELINE } from '../src/backend/fake/make/ids';
import { energyCurveOf, withEnergy } from '../src/features/timeline/energy/energy-model';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[1]!;

function setup() {
  const { client, controls } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0 },
  });
  const dispatch = (name: string, payload: unknown, source: 'ui' | 'agent' = 'ui') =>
    source === 'agent'
      ? controls.bus.dispatch(name, payload, { source, actor: 'agent:test' })
      : callRpc(client.commands.dispatch({ name, payload, source }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const redo = () => callRpc(client.commands.redo({ projectId, source: 'ui' }));
  const timeline = () => client.timelines.get({ timelineId });
  const template = async (version?: number) => {
    const ref = (await timeline()).template!;
    return client.templates.get({ templateId: ref.id, ...(version ? { version } : {}) });
  };
  return { client, dispatch, undo, redo, timeline, template };
}

const clips = (timeline: Timeline) =>
  timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip');
const lengths = (timeline: Timeline) =>
  timeline.tracks[0]!.items.map((item) => (item.type === 'transition' ? 0 : item.duration.value));

/** The golden template's curve with its second band at full energy (a cut every beat). */
async function fasterCurve(s: ReturnType<typeof setup>): Promise<EnergyCurve> {
  const { template } = await s.template((await s.timeline()).template!.version);
  return withEnergy(energyCurveOf(template), 1, 1);
}

describe('energy curve fake (P3-V12)', () => {
  it('plans on the beat: a faster band cuts more often, the film keeps its length, nobody picked twice', async () => {
    const s = setup();
    const before = await s.timeline();
    const { template } = await s.template(before.template!.version);
    const base = await s.client.timelines.planEnergyCurve({ timelineId, curve: energyCurveOf(template) });
    expect(base.templateBaseVersion).toBe(before.template!.version);
    // Golden hour's body slots are 2 and 3 beats long: its own curve (a cut every 2 beats) evens them out.
    expect(base.cuts.every((cut) => cut % 15 === 0)).toBe(true);
    const again = await s.client.timelines.planEnergyCurve({ timelineId, curve: energyCurveOf(template) });
    expect(again).toEqual(base);

    const plan = await s.client.timelines.planEnergyCurve({ timelineId, curve: await fasterCurve(s) });
    expect(plan.cuts.length).toBeGreaterThan(base.cuts.length);
    expect(plan.picks.length).toBe(plan.changedSlots);
    expect(new Set(plan.picks.map((entry) => entry.pick.shotId)).size).toBe(plan.picks.length);
    expect(plan.cuts.at(-1)).toBe(lengths(before).reduce((a, b) => a + b));
  });

  it('apply re-cuts the timeline and makes a template version; one undo puts both back, redo again', async () => {
    const s = setup();
    const before = await s.timeline();
    const heads = (await s.template()).summary.head;
    const curve = await fasterCurve(s);
    const plan = await s.client.timelines.planEnergyCurve({ timelineId, curve });
    const applied = await s.dispatch('timeline.applyEnergyCurve', {
      projectId,
      timelineId,
      templateBaseVersion: plan.templateBaseVersion,
      curve,
      picks: plan.picks,
    });
    expect(applied.ok).toBe(true);
    const after = await s.timeline();
    expect(timelineSchema.safeParse(after).error?.issues ?? []).toEqual([]);
    expect(clips(after).length).toBe(plan.cuts.length - 1);
    expect(after.template!.version).toBe(heads + 1);
    expect((await s.template()).summary.head).toBe(heads + 1);
    expect(lengths(after).reduce((a, b) => a + b)).toBe(lengths(before).reduce((a, b) => a + b));

    expect((await s.undo()).ok).toBe(true);
    const undone = await s.timeline();
    expect(undone.tracks).toEqual(before.tracks);
    expect(undone.template).toEqual(before.template);
    expect((await s.template()).summary.head).toBe(heads);

    expect((await s.redo()).ok).toBe(true);
    expect(clips(await s.timeline()).length).toBe(plan.cuts.length - 1);
  });

  it('refuses a plan made on another version, a timeline without a template, and the agent moving a locked clip', async () => {
    const s = setup();
    const curve = await fasterCurve(s);
    const plan = await s.client.timelines.planEnergyCurve({ timelineId, curve });
    const stale = await s.dispatch('timeline.applyEnergyCurve', {
      projectId,
      timelineId,
      templateBaseVersion: plan.templateBaseVersion + 1,
      curve,
      picks: plan.picks,
    });
    expect(stale.ok ? null : stale.error.code).toBe('core.conflict');

    await expect(
      s.client.timelines.planEnergyCurve({ timelineId: TRIP_TIMELINE, curve }),
    ).rejects.toMatchObject({
      data: { code: 'timeline.template_not_found' },
    });

    const second = clips(await s.timeline())[2]!;
    expect(
      (await s.dispatch('timeline.lockClip', { projectId, timelineId, clipId: second.id, locked: true })).ok,
    ).toBe(true);
    const locked = await s.client.timelines.planEnergyCurve({ timelineId, curve });
    expect(locked.picks.length).toBe(locked.changedSlots - 1);
    const refused = await s.dispatch(
      'timeline.applyEnergyCurve',
      { projectId, timelineId, templateBaseVersion: locked.templateBaseVersion, curve, picks: locked.picks },
      'agent',
    );
    expect(refused.ok ? null : refused.error.code).toBe('timeline.clip_locked');
    // You may: the locked shot stays on the first new cut of its band.
    const yours = await s.dispatch('timeline.applyEnergyCurve', {
      projectId,
      timelineId,
      templateBaseVersion: locked.templateBaseVersion,
      curve,
      picks: locked.picks,
    });
    expect(yours.ok).toBe(true);
    expect(clips(await s.timeline()).find((clip) => clip.id === second.id)?.locked).toBe(true);
  });

  it('template.setEnergyCurve makes the next version from the head it names; undo moves the head back', async () => {
    const s = setup();
    const { summary, template } = await s.template();
    const curve = withEnergy(energyCurveOf(template), 0, 1);
    const payload = { projectId: null, templateId: template.id, baseVersion: summary.head, curve };
    expect((await s.dispatch('template.setEnergyCurve', payload)).ok).toBe(true);
    const next = await s.client.templates.get({ templateId: template.id });
    expect(next.summary.head).toBe(summary.head + 1);
    expect(next.template.slots.length).toBeGreaterThan(template.slots.length);
    const again = await s.dispatch('template.setEnergyCurve', payload);
    expect(again.ok ? null : again.error.code).toBe('core.conflict');
    expect((await callRpc(s.client.commands.undo({ projectId: null, source: 'ui' }))).ok).toBe(true);
    expect((await s.client.templates.get({ templateId: template.id })).summary.head).toBe(summary.head);
  });
});
