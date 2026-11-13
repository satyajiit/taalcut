// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V12, timeline part: changing the energy curve re-casts and re-times only the affected slots, in one undo
 * step that also moves the template's head back; redo reuses the version. The template half is the reference in
 * fixtures/energy.ts until @taalcut/templates ships it.
 */
import { newId, type EnergyCurve, type Template, type Timeline } from '@taalcut/core';
import { createTemplateService } from '@taalcut/templates';
import { createMemoryTemplateStore } from '@taalcut/templates/test-support';
import { describe, expect, it } from 'vitest';
import { assemble } from '../../src/assembly/assemble';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { candidateKey, clipKey } from '../../src/model/cast';
import { positions, videoItems, type Filler } from '../../src/model/sequence';
import { createTimelineService } from '../../src/service/service';
import { storeTemplateReader } from '../../src/service/templates';
import { world } from '../fixtures/casting';
import { agentOrigin, commandWorld, ui } from '../fixtures/command-world';
import { referenceApplier } from '../fixtures/energy';

const BEAT = 15;

async function setup() {
  const made = world({ slots: 8, perSlot: 6, distractors: 30, seed: 23, overlays: [{ start: 125, frames: 20, text: 'Title', slot: 4 }] });
  const projectId = newId<'Project'>();
  const cast = await made.engine.cast({ projectId, template: made.template, mode: 'template', variants: 1, seed: 1 });
  if (!cast.ok) throw new Error(cast.error.code);
  const assembled = assemble(
    {
      projectId,
      template: made.template,
      variant: cast.value.variants[0]!,
      cast: { castId: cast.value.castId, mode: 'template', variantIndex: 0, variantCount: 1, configVersion: 'casting.v4' },
      timelineId: newId<'Timeline'>(),
      name: 'Energy',
      now: 1,
    },
    { item: () => newId<'TimelineItem'>() },
  );
  if (!assembled.ok) throw new Error(assembled.error.code);
  const timeline = assembled.value;
  const probe = commandWorld();
  const templateStore = createMemoryTemplateStore(probe.clock);
  await templateStore.create(made.template, { name: 'Template', projectId: null, listed: true });
  const templates = createTemplateService({ store: templateStore, clock: probe.clock });
  const reader = storeTemplateReader(templateStore);
  const energy = { applyCurve: referenceApplier, templates, reader };
  const cmd = commandWorld({ catalog: createMemoryShotCatalog(made.profiles), templateStore, energy });
  await cmd.seed(timeline);
  const service = createTimelineService({
    store: cmd.store,
    events: cmd.events,
    engine: made.engine,
    templates: reader,
    applyEnergyCurve: referenceApplier,
  });
  return { ...cmd, timeline, template: made.template, templateStore, service, projectId };
}

/** Sections over slots [from, to] with a beats-per-clip each. */
function curve(template: Template, sections: readonly (readonly [number, number, number])[]): EnergyCurve {
  return {
    sections: sections.map(([from, to, beatsPerClip]) => ({
      fromSlotId: template.slots[from]!.id,
      toSlotId: template.slots[to]!.id,
      energy: 0.6,
      beatsPerClip: beatsPerClip as EnergyCurve['sections'][number]['beatsPerClip'],
      align: 'beat' as const,
    })),
  };
}

const bySlot = (timeline: Timeline) =>
  new Map(positions(videoItems(timeline)).flatMap(({ item }): [string, Filler][] => (item.slotId ? [[item.slotId, item]] : [])));

describe('the energy curve on a timeline', () => {
  it('speeds up a middle section: splits and re-casts only it, cuts on beats, one undo, redo reuses the version', async () => {
    const world = await setup();
    const { timeline, template } = world;
    const faster = curve(template, [[0, 1, 2], [2, 5, 1], [6, 7, 2]]);
    const plan = await world.service.planEnergyCurve!(timeline.id, faster);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.templateBaseVersion).toBe(1);
    expect(plan.value.changedSlots).toBe(8);
    expect(plan.value.slotMap.filter((entry) => entry.unchanged)).toHaveLength(4);
    expect(plan.value.cuts.every((cut) => cut % BEAT === 0)).toBe(true);
    const unchangedKeys = new Set(
      [0, 1, 6, 7].map((slot) => {
        const item = bySlot(timeline).get(template.slots[slot]!.id);
        return item?.type === 'clip' ? clipKey(item) : null;
      }),
    );
    for (const { pick } of plan.value.picks) expect(unchangedKeys.has(candidateKey(pick))).toBe(false);

    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const done = await world.dispatch('timeline.applyEnergyCurve', {
      ...target,
      templateBaseVersion: 1,
      curve: faster,
      picks: plan.value.picks,
    });
    if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
    const after = world.doc(timeline.id);
    expect(after.template).toEqual({ id: template.id, version: 2 });
    const before = bySlot(timeline);
    const now = bySlot(after);
    for (const slot of [0, 1, 6, 7]) {
      const id = template.slots[slot]!.id;
      expect(now.get(id), `slot ${slot} unchanged`).toEqual(before.get(id));
    }
    const placed = positions(videoItems(after));
    expect(placed).toHaveLength(12);
    expect(placed.every((position) => position.start % BEAT === 0)).toBe(true);
    expect(placed.at(-1)?.end).toBe(positions(videoItems(timeline)).at(-1)?.end);
    const keys = placed.flatMap(({ item }) => (item.type === 'clip' ? [clipKey(item)] : []));
    expect(new Set(keys).size).toBe(keys.length);
    expect(after.cast?.slots).toHaveLength(12);
    const title = after.tracks.find((track) => track.kind === 'text')?.items[0];
    expect(title?.start.value).toBe(125);
    expect(after.markers.filter((item) => item.kind === 'hook')).toHaveLength(1);

    await world.bus.undo(timeline.projectId, ui);
    const undone = world.doc(timeline.id);
    expect({ ...undone, revision: 0, updatedAt: 0 }).toEqual({ ...timeline, revision: 0, updatedAt: 0 });
    const head = await world.templateStore.get(template.id);
    expect(head.ok && head.value.version).toBe(1);

    await world.bus.redo(timeline.projectId, ui);
    expect(world.doc(timeline.id).template).toEqual({ id: template.id, version: 2 });
    expect(videoItems(world.doc(timeline.id)).map((item) => item.id)).toEqual(videoItems(after).map((item) => item.id));
    const latest = await world.templateStore.latestVersion(template.id);
    expect(latest.ok && latest.value).toBe(2);
  });

  it('slows a section down: merges its slots', async () => {
    const world = await setup();
    const { timeline, template } = world;
    const slower = curve(template, [[0, 1, 2], [2, 5, 4], [6, 7, 2]]);
    const plan = await world.service.planEnergyCurve!(timeline.id, slower);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.changedSlots).toBe(2);
    const done = await world.dispatch('timeline.applyEnergyCurve', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      templateBaseVersion: 1,
      curve: slower,
      picks: plan.value.picks,
    });
    if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
    const placed = positions(videoItems(world.doc(timeline.id)));
    expect(placed.map((position) => position.end - position.start)).toEqual([30, 30, 60, 60, 30, 30]);
  });

  it('keeps a locked clip on the first new slot of its span, and refuses an agent', async () => {
    const world = await setup();
    const { timeline, template } = world;
    const locked = bySlot(timeline).get(template.slots[3]!.id)!;
    const target = { projectId: timeline.projectId, timelineId: timeline.id };
    const lock = await world.dispatch('timeline.lockClip', { ...target, clipId: locked.id, locked: true });
    if (!lock.ok) throw new Error(lock.error.code);
    const faster = curve(template, [[0, 1, 2], [2, 5, 1], [6, 7, 2]]);
    const plan = await world.service.planEnergyCurve!(timeline.id, faster);
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.picks.some((entry) => entry.slotId === template.slots[3]!.id)).toBe(false);
    const payload = { ...target, templateBaseVersion: 1, curve: faster, picks: plan.value.picks };
    const refused = await world.dispatch('timeline.applyEnergyCurve', payload, agentOrigin);
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
    const done = await world.dispatch('timeline.applyEnergyCurve', payload);
    if (!done.ok) throw new Error(done.error.detail ?? done.error.code);
    const kept = bySlot(world.doc(timeline.id)).get(template.slots[3]!.id);
    expect(kept?.id).toBe(locked.id);
    expect(kept?.type === 'clip' && locked.type === 'clip' && kept.media).toEqual(locked.type === 'clip' && locked.media);
    expect(kept?.duration.value).toBe(BEAT);
  });

  it('refuses a plan made on another template version', async () => {
    const world = await setup();
    const { timeline, template } = world;
    const faster = curve(template, [[0, 1, 2], [2, 5, 1], [6, 7, 2]]);
    const stale = await world.dispatch('timeline.applyEnergyCurve', {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      templateBaseVersion: 3,
      curve: faster,
      picks: [],
    });
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
  });
});
