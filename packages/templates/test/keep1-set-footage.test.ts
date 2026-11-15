// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: `template.slot.setFootage` on core's real bus. The review's "Keep the reel's clip" and "Use my clip" make
 * a new version with the statement as the person's, keeping the reason the Analyst gave; the statement survives the
 * other edits; and what would leave no slot for the person's clips, or keep a reel a template never had, is refused.
 */
import { describe, expect, it } from 'vitest';
import { TEMPLATE_COMMANDS as N, templateSchema, type SlotFootage, type Template } from '@taalcut/core';
import { at, json, referenceTemplate } from './helpers/fixtures';
import { AGENT, setupTemplates, UI } from './helpers/setup';

const REASON = 'A film scene the joke lands on';
const film: SlotFootage = { from: 'reel', by: 'analyst', reason: REASON };

/** The reference template, with `reel` naming the slots the Analyst stated as the reel's own footage. */
async function created(reel: readonly number[] = [], change: (t: Template) => Template = (t) => t) {
  const setup = setupTemplates();
  const base = referenceTemplate();
  const template = change({
    ...base,
    slots: base.slots.map((slot, index) => (reel.includes(index) ? { ...slot, footage: film } : slot)),
  });
  const made = await setup.bus.dispatch(
    N.create,
    { projectId: setup.projectA, template, name: 'Film reel', listed: true },
    UI,
  );
  expect(made.ok).toBe(true);
  const head = async (): Promise<Template> => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    return got.value.template;
  };
  const where = { projectId: setup.projectA, templateId: template.id };
  const footage = async () => (await head()).slots.map((slot) => slot.footage?.from ?? null);
  return { ...setup, template, head, where, footage };
}

describe('template.slot.setFootage (KEEP1)', () => {
  it('keeps the reel’s clip as the person’s statement, in a new version that undo takes back', async () => {
    const { bus, template, head, where, projectA } = await created();
    const slotId = template.slots[2]!.id;
    const done = await bus.dispatch(N.setFootage, { ...where, baseVersion: 1, slotId, from: 'reel' }, UI);
    expect(done.ok && done.value.result).toEqual({ templateId: template.id, version: 2 });
    expect((await head()).slots[2]!.footage).toEqual({ from: 'reel', by: 'user', reason: null });
    expect(templateSchema.safeParse(json(await head())).success).toBe(true);
    expect((await bus.undo(projectA, UI)).ok).toBe(true);
    expect((await head()).slots[2]!.footage).toBeUndefined();
  });

  it('“Use my clip” overrules the Analyst and keeps its reason; flipping back keeps it too', async () => {
    const { bus, template, head, where } = await created([1, 2]);
    const slotId = template.slots[1]!.id;
    const mine = await bus.dispatch(N.setFootage, { ...where, baseVersion: 1, slotId, from: 'person' }, UI);
    expect(mine.ok).toBe(true);
    expect((await head()).slots[1]!.footage).toEqual({ from: 'person', by: 'user', reason: REASON });
    const back = await bus.dispatch(N.setFootage, { ...where, baseVersion: 2, slotId, from: 'reel' }, UI);
    expect(back.ok).toBe(true);
    expect((await head()).slots[1]!.footage).toEqual({ from: 'reel', by: 'user', reason: REASON });
    // The same choice again is still the person's statement: the Analyst's becomes theirs.
    const other = template.slots[2]!.id;
    const same = await bus.dispatch(
      N.setFootage,
      { ...where, baseVersion: 3, slotId: other, from: 'reel' },
      UI,
    );
    expect(same.ok).toBe(true);
    expect((await head()).slots[2]!.footage).toEqual({ from: 'reel', by: 'user', reason: REASON });
  });

  it('refuses the change that leaves no slot for the person’s clips', async () => {
    const { bus, template, where, footage } = await created([0, 1, 2]);
    const last = template.slots[3]!.id;
    const all = await bus.dispatch(
      N.setFootage,
      { ...where, baseVersion: 1, slotId: last, from: 'reel' },
      UI,
    );
    expect(!all.ok && all.error.code).toBe('templates.no_person_slot');
    // Nor may another edit do it: dropping the person's last slot, or merging it into the reel's footage.
    const dropped = await bus.dispatch(N.dropSlot, { ...where, baseVersion: 1, slotId: last }, UI);
    expect(!dropped.ok && dropped.error.code).toBe('templates.no_person_slot');
    const merged = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 1, slotIds: [template.slots[2]!.id, last], intentFrom: template.slots[2]!.id },
      UI,
    );
    expect(!merged.ok && merged.error.code).toBe('templates.no_person_slot');
    expect(await footage()).toEqual(['reel', 'reel', 'reel', null]);
  });

  it('refuses the reel’s footage on a template that was not made from a reel', async () => {
    const manual = (t: Template): Template => ({ ...t, origin: { kind: 'manual' } });
    const { bus, template, where } = await created([], manual);
    const slotId = template.slots[1]!.id;
    const done = await bus.dispatch(N.setFootage, { ...where, baseVersion: 1, slotId, from: 'reel' }, UI);
    expect(!done.ok && done.error.code).toBe('templates.no_reel');
    const mine = await bus.dispatch(N.setFootage, { ...where, baseVersion: 1, slotId, from: 'person' }, UI);
    expect(mine.ok).toBe(true);
  });

  it('an agent’s change is the Analyst’s, and never on a slot the person approved', async () => {
    const { bus, template, head, where } = await created();
    const [, second, third] = template.slots;
    const stated = await bus.dispatch(
      N.setFootage,
      { ...where, baseVersion: 1, slotId: second!.id, from: 'reel' },
      AGENT,
    );
    expect(stated.ok).toBe(true);
    expect((await head()).slots[1]!.footage).toEqual({ from: 'reel', by: 'analyst', reason: null });
    await bus.dispatch(N.approveSlots, { ...where, baseVersion: 2, slotIds: [third!.id] }, UI);
    const refused = await bus.dispatch(
      N.setFootage,
      { ...where, baseVersion: 3, slotId: third!.id, from: 'reel' },
      AGENT,
    );
    expect(!refused.ok && refused.error.code).toBe('templates.slot_approved');
    const unknown = await bus.dispatch(
      N.setFootage,
      { ...where, baseVersion: 3, slotId: template.id as never, from: 'reel' },
      UI,
    );
    expect(unknown.ok).toBe(false);
  });
});

describe('the statement survives a template edit (KEEP1)', () => {
  it('through a rename, a new description, an approval, a role and a moved cut', async () => {
    const { bus, template, where, footage, head } = await created([1, 2]);
    const [, second, third] = template.slots;
    const edits: [string, object][] = [
      [N.renameSlot, { slotId: second!.id, name: 'The scene' }],
      [N.editIntent, { slotId: second!.id, intent: { text: 'An actor answers' } }],
      [N.approveSlots, { slotIds: [second!.id] }],
      [N.setRole, { slotId: third!.id, role: 'body' }],
      [N.moveCut, { slotId: third!.id, to: at(50) }],
    ];
    let version = 1;
    for (const [name, payload] of edits) {
      const done = await bus.dispatch(
        name as never,
        { ...where, baseVersion: version, ...payload } as never,
        UI,
      );
      expect(done.ok, name).toBe(true);
      version += 1;
    }
    expect(await footage()).toEqual([null, 'reel', 'reel', null]);
    expect((await head()).slots[1]!.footage).toEqual(film);
  });

  it('a split copies it to both halves, and a merge takes it with the description it takes', async () => {
    const { bus, template, where, footage } = await created([2]);
    const [, second, third] = template.slots;
    const split = await bus.dispatch(
      N.splitSlot,
      { ...where, baseVersion: 1, slotId: third!.id, at: at(60) },
      UI,
    );
    expect(split.ok).toBe(true);
    expect(await footage()).toEqual([null, null, 'reel', 'reel', null]);
    // Slot 2 (the person's) merged with the first half of the film: the film's description, so the film's footage.
    const reel = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 2, slotIds: [second!.id, third!.id], intentFrom: third!.id },
      UI,
    );
    expect(reel.ok).toBe(true);
    expect(await footage()).toEqual([null, 'reel', 'reel', null]);
  });

  it('a merge that takes the person’s description leaves the slot the person’s', async () => {
    const { bus, template, where, footage } = await created([2]);
    const [, second, third] = template.slots;
    const mine = await bus.dispatch(
      N.mergeSlots,
      { ...where, baseVersion: 1, slotIds: [second!.id, third!.id], intentFrom: second!.id },
      UI,
    );
    expect(mine.ok).toBe(true);
    expect(await footage()).toEqual([null, null, null]);
  });
});
