// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-T6 commands on core's real bus: edits keep the invariants, undo and redo, conflicts, sources. */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_COMMANDS as N, templateSchema, type Template } from '@taalcut/core';
import { json, referenceTemplate } from './helpers/fixtures';
import { AGENT, setupTemplates, UI } from './helpers/setup';

async function created() {
  const setup = setupTemplates();
  const template = referenceTemplate();
  const receipt = await setup.bus.dispatch(
    N.create,
    { projectId: setup.projectA, template, name: 'Goa reel', listed: true },
    UI,
  );
  expect(receipt.ok).toBe(true);
  const head = async (): Promise<Template> => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    return got.value.template;
  };
  const where = { projectId: setup.projectA, templateId: template.id };
  return { ...setup, template, head, where };
}

describe('template slot commands', () => {
  it('approve makes version 2; undo moves the head back; redo reuses version 2', async () => {
    const { bus, store, template, head, where, projectA } = await created();
    const slotId = template.slots[1]!.id;
    const done = await bus.dispatch(N.approveSlots, { ...where, baseVersion: 1, slotIds: [slotId] }, UI);
    expect(done.ok && done.value.result).toEqual({ templateId: template.id, version: 2 });
    expect((await head()).slots[1]!.approved).toBe(true);
    expect((await head()).parentVersion).toBe(1);

    expect((await bus.undo(projectA, UI)).ok).toBe(true);
    expect((await head()).version).toBe(1);
    expect((await bus.redo(projectA, UI)).ok).toBe(true);
    expect((await head()).version).toBe(2);
    const versions = await store.versions(template.id);
    expect(versions.ok && versions.value.map((v) => [v.version, v.isHead, v.command])).toEqual([
      [1, false, null],
      [2, true, N.approveSlots],
    ]);
  });

  it('merge keeps the first slot, sums the time, takes the longest intent and re-points overlays', async () => {
    const { bus, template, head, where } = await created();
    const [, second, third] = template.slots;
    const done = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 1, slotIds: [second!.id, third!.id] },
      UI,
    );
    expect(done.ok).toBe(true);
    const merged = await head();
    expect(merged.slots).toHaveLength(3);
    expect(merged.slots[1]).toMatchObject({
      id: second!.id,
      start: second!.start,
      duration: { value: 60 },
      intent: third!.intent,
      speedRamp: null,
      approved: false,
    });
    expect(merged.pacing.shotCount).toBe(3);
    expect(merged.contactSheet!.frames[2]!.slotId).toBe(second!.id);
    expect(templateSchema.safeParse(json(merged)).success).toBe(true);
  });

  it('merge refuses slots that are not adjacent or not in order', async () => {
    const { bus, template, where } = await created();
    const [first, , third] = template.slots;
    const gap = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 1, slotIds: [first!.id, third!.id] },
      UI,
    );
    expect(!gap.ok && gap.error.code).toBe('templates.slots_not_adjacent');
    const reversed = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 1, slotIds: [template.slots[1]!.id, first!.id] },
      UI,
    );
    expect(!reversed.ok && reversed.error.code).toBe('templates.slots_not_adjacent');
  });

  it('drop gives the time to the previous slot, so every other cut stays on its beat', async () => {
    const { bus, template, head, where } = await created();
    const done = await bus.dispatch(
      N.dropSlot,
      { ...where, baseVersion: 1, slotId: template.slots[1]!.id },
      UI,
    );
    expect(done.ok).toBe(true);
    const after = await head();
    expect(after.slots.map((slot) => [slot.start.value, slot.duration.value])).toEqual([
      [0, 45],
      [45, 45],
      [90, 30],
    ]);
    expect(after.text[0]!.slotId).toBe(template.slots[0]!.id);
    expect(after.duration).toEqual(template.duration);
  });

  it('dropping the first slot gives its time to the next, which becomes the hook at zero', async () => {
    const { bus, template, head, where } = await created();
    const done = await bus.dispatch(
      N.dropSlot,
      { ...where, baseVersion: 1, slotId: template.slots[0]!.id },
      UI,
    );
    expect(done.ok).toBe(true);
    const first = (await head()).slots[0]!;
    expect(first).toMatchObject({
      id: template.slots[1]!.id,
      role: 'hook',
      start: { value: 0 },
      duration: { value: 45 },
    });
    expect(first.transitionIn).toBeNull();
    expect(first.beatAnchor).toEqual({ beatIndex: 0, offset: { value: 0, rate: template.canvas.rate } });
  });

  it('the only slot cannot be dropped', async () => {
    const { bus, template, where } = await created();
    let base = 1;
    for (const slot of template.slots.slice(1)) {
      const dropped = await bus.dispatch(N.dropSlot, { ...where, baseVersion: base, slotId: slot.id }, UI);
      expect(dropped.ok).toBe(true);
      base += 1;
    }
    const last = await bus.dispatch(
      N.dropSlot,
      { ...where, baseVersion: base, slotId: template.slots[0]!.id },
      UI,
    );
    expect(!last.ok && last.error.code).toBe('templates.last_slot');
  });

  it('rename labels a slot; null shows "Slot n" again', async () => {
    const { bus, template, head, where } = await created();
    await bus.dispatch(
      N.renameSlot,
      { ...where, baseVersion: 1, slotId: template.slots[1]!.id, name: 'Beach' },
      UI,
    );
    expect((await head()).slots[1]!.name).toBe('Beach');
    await bus.dispatch(
      N.renameSlot,
      { ...where, baseVersion: 2, slotId: template.slots[1]!.id, name: null },
      UI,
    );
    expect((await head()).slots[1]!.name).toBeNull();
  });

  it('editIntent: the user writes "user"; the agent writes "analyst" and may not touch an approved slot', async () => {
    const { bus, template, head, where } = await created();
    const slotId = template.slots[2]!.id;
    await bus.dispatch(
      N.editIntent,
      { ...where, baseVersion: 1, slotId, intent: { text: 'beach at dusk' } },
      UI,
    );
    expect((await head()).slots[2]!.intent).toMatchObject({ text: 'beach at dusk', source: 'user' });
    await bus.dispatch(N.editIntent, { ...where, baseVersion: 2, slotId, intent: { energy: 0.9 } }, AGENT);
    expect((await head()).slots[2]!.intent).toMatchObject({ energy: 0.9, source: 'analyst' });
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 3, slotIds: [slotId] }, UI);
    const refused = await bus.dispatch(
      N.editIntent,
      { ...where, baseVersion: 4, slotId, intent: { text: 'no' } },
      AGENT,
    );
    expect(!refused.ok && refused.error.code).toBe('templates.slot_approved');
  });

  it('a stale baseVersion is core.conflict', async () => {
    const { bus, template, where } = await created();
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 1, slotIds: [template.slots[0]!.id] }, UI);
    const stale = await bus.dispatch(
      N.renameSlot,
      { ...where, baseVersion: 1, slotId: template.slots[0]!.id, name: 'x' },
      UI,
    );
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
  });

  it('undo after someone else moved the head is core.conflict', async () => {
    const { bus, template, head, where, projectA } = await created();
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 1, slotIds: [template.slots[0]!.id] }, UI);
    // The same template edited from /templates (app-wide history) while project A's ⌘Z still points at v2.
    const elsewhere = { projectId: null, templateId: template.id };
    await bus.dispatch(
      N.renameSlot,
      { ...elsewhere, baseVersion: 2, slotId: template.slots[0]!.id, name: 'x' },
      UI,
    );
    const undo = await bus.undo(projectA, UI);
    expect(!undo.ok && undo.error.code).toBe('core.conflict');
    expect((await head()).version).toBe(3);
  });

  it('UI and agent audit entries match apart from source and actor', async () => {
    const { bus, audit, template, where, projectA } = await created();
    const slotIds = [template.slots[3]!.id];
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 1, slotIds }, UI);
    await bus.undo(projectA, UI);
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 1, slotIds }, AGENT);
    const entries = await audit.listByProject(projectA, { limit: 10 });
    const approvals = (entries.ok ? entries.value : []).filter((entry) => entry.name === N.approveSlots);
    expect(approvals).toHaveLength(2);
    const strip = ({
      id: _i,
      sequence: _s,
      source: _so,
      actor: _a,
      createdAt: _c,
      undone: _u,
      undoneAt: _ua,
      redoneAt: _r,
      ...rest
    }: Record<string, unknown>) => rest;
    expect(strip(approvals[0] as never)).toEqual(strip(approvals[1] as never));
    expect(approvals.map((entry) => entry.source).sort()).toEqual(['agent', 'ui']);
  });

  it('lineage metadata is undoable without a version; delete is refused while a timeline uses it', async () => {
    const { bus, store, template, where, projectA } = await created();
    await bus.dispatch(N.rename, { ...where, name: 'Goa v2' }, UI);
    await bus.dispatch(N.setListed, { ...where, listed: false }, UI);
    await bus.dispatch(N.archive, { ...where, archived: true }, UI);
    let summary = await store.get(template.id);
    expect(summary.ok && summary.value.summary).toMatchObject({
      name: 'Goa v2',
      listed: false,
      archived: true,
      head: 1,
    });
    for (let i = 0; i < 3; i++) await bus.undo(projectA, UI);
    summary = await store.get(template.id);
    expect(summary.ok && summary.value.summary).toMatchObject({
      name: 'Goa reel',
      listed: true,
      archived: false,
    });
    store.setUsage(template.id, 2);
    const refused = await bus.dispatch(N.remove, where, UI);
    expect(!refused.ok && refused.error).toMatchObject({
      code: 'templates.in_use',
      params: { timelines: 2 },
    });
    store.setUsage(template.id, 0);
    expect((await bus.dispatch(N.remove, where, UI)).ok).toBe(true);
    expect((await store.get(template.id)).ok).toBe(false);
  });

  it('create is undone by discard (deleted when unused, archived when used) and redone', async () => {
    const { bus, store, template, projectA } = await created();
    expect((await bus.undo(projectA, UI)).ok).toBe(true);
    expect((await store.get(template.id)).ok).toBe(false);
    expect((await bus.redo(projectA, UI)).ok).toBe(true);
    expect((await store.get(template.id)).ok).toBe(true);
    store.setUsage(template.id, 1);
    await bus.undo(projectA, UI);
    const archived = await store.get(template.id);
    expect(archived.ok && archived.value.summary.archived).toBe(true);
    await bus.redo(projectA, UI);
    const back = await store.get(template.id);
    expect(back.ok && back.value.summary.archived).toBe(false);
  });

  it('internal commands are refused from a person', async () => {
    const { bus, where } = await created();
    const refused = await bus.dispatch(N.setHead, { ...where, version: 1, expectedHead: 1 }, UI);
    expect(!refused.ok && refused.error.code).toBe('core.internal_command');
  });
});
