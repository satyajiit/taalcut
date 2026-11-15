// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a slot's stated moment (`lands`) through the review's edits, on core's real bus. The statement is about
 * one edge of the slot. Moving the cut keeps it (the same edge at another frame); a split, a merge or a dropped
 * neighbour gives the slot another edge there, and the statement goes with the edge it was about. The fixture:
 * four slots at 0, 30, 45 and 90 (30 fps).
 */
import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_COMMANDS as N,
  templateSchema,
  type CommandOrigin,
  type SlotLands,
  type Template,
} from '@taalcut/core';
import { at, json, referenceTemplate } from './helpers/fixtures';
import { setupTemplates, UI } from './helpers/setup';

const START: SlotLands = { edge: 'start', moment: 'The door opens' };
const END: SlotLands = { edge: 'end', moment: 'The door swings shut' };

/** The fixture with a moment on the given slots. */
function stating(lands: Readonly<Record<number, SlotLands>>): Template {
  const template = referenceTemplate();
  return {
    ...template,
    slots: template.slots.map((slot, index) => (lands[index] ? { ...slot, lands: lands[index] } : slot)),
  };
}

async function created(template: Template) {
  const setup = setupTemplates();
  await setup.bus.dispatch(N.create, { projectId: setup.projectA, template, name: 'Goa', listed: true }, UI);
  const lands = async () => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    expect(templateSchema.safeParse(json(got.value.template)).success).toBe(true);
    return got.value.template.slots.map((slot) => slot.lands ?? null);
  };
  const run = async (name: string, payload: object, origin: CommandOrigin = UI) => {
    const done = await setup.bus.dispatch(
      name,
      { projectId: setup.projectA, templateId: template.id, baseVersion: 1, ...payload },
      origin,
    );
    if (!done.ok) throw new Error(done.error.code);
  };
  return { template, lands, run };
}

describe('a stated moment through the review’s edits (MATCH1)', () => {
  it('moving a cut keeps the moments on both sides of it', async () => {
    const { run, lands, template } = await created(stating({ 1: END, 2: START }));
    await run(N.moveCut, { slotId: template.slots[2]!.id, to: at(40) });
    expect(await lands()).toEqual([null, END, START, null]);
  });

  it('a split leaves each half the moment of the edge it keeps', async () => {
    const ending = await created(stating({ 2: END }));
    await ending.run(N.splitSlot, { slotId: ending.template.slots[2]!.id, at: at(60) });
    expect(await ending.lands()).toEqual([null, null, null, END, null]);
    const starting = await created(stating({ 2: START }));
    await starting.run(N.splitSlot, { slotId: starting.template.slots[2]!.id, at: at(60) });
    expect(await starting.lands()).toEqual([null, null, START, null, null]);
  });

  it('a merge keeps the first slot’s start and the last slot’s end, and drops the moments on the cut inside', async () => {
    const outer = await created(stating({ 1: START, 2: END }));
    const [, second, third] = outer.template.slots;
    await outer.run(N.mergeSlots, { slotIds: [second!.id, third!.id] });
    // One moment a slot: the start's, since the merged slot starts where the first did.
    expect(await outer.lands()).toEqual([null, START, null]);
    const inner = await created(stating({ 1: END, 2: START }));
    await inner.run(N.mergeSlots, { slotIds: [inner.template.slots[1]!.id, inner.template.slots[2]!.id] });
    expect(await inner.lands()).toEqual([null, null, null]);
    const last = await created(stating({ 2: END }));
    await last.run(N.mergeSlots, { slotIds: [last.template.slots[1]!.id, last.template.slots[2]!.id] });
    expect(await last.lands()).toEqual([null, END, null]);
  });

  it('a dropped slot takes the moment on the cut it shared with the slot that absorbs it', async () => {
    const before = await created(stating({ 1: END, 3: START }));
    await before.run(N.dropSlot, { slotId: before.template.slots[2]!.id });
    // The slot before now runs to the next cut: its end is another instant. The slot after is untouched.
    expect(await before.lands()).toEqual([null, null, START]);
    const first = await created(stating({ 1: START }));
    await first.run(N.dropSlot, { slotId: first.template.slots[0]!.id });
    expect((await first.lands())[0]).toBeNull();
    const kept = await created(stating({ 1: START }));
    await kept.run(N.dropSlot, { slotId: kept.template.slots[2]!.id });
    expect(await kept.lands()).toEqual([null, START, null]);
  });
});
