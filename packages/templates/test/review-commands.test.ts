// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-CMD's cut commands on core's real bus: template.slot.moveCut and template.slot.split make a version on
 * their base, undo to it and redo without a duplicate, refuse a stale base, and carry overlays, tiles, anchors,
 * transitions and ramps along. The fixture: slots at 0, 30, 45 and 90 (30 fps), beats every 15 frames, overlays
 * at 32 (slot 2) and 95 (slot 4), tiles at 5, 35, 50 and 95.
 */
import { describe, expect, it } from 'vitest';
import {
  FrameRate,
  RationalTime,
  TEMPLATE_COMMANDS as N,
  templateSchema,
  type CommandOrigin,
  type Template,
} from '@taalcut/core';
import { at, json, referenceTemplate } from './helpers/fixtures';
import { setupTemplates, UI } from './helpers/setup';

async function created(template: Template = referenceTemplate()) {
  const setup = setupTemplates();
  const made = await setup.bus.dispatch(
    N.create,
    { projectId: setup.projectA, template, name: 'Goa reel', listed: true },
    UI,
  );
  expect(made.ok).toBe(true);
  const head = async (): Promise<Template> => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    expect(templateSchema.safeParse(json(got.value.template)).success).toBe(true);
    return got.value.template;
  };
  const where = { projectId: setup.projectA, templateId: template.id };
  const run = (name: string, payload: object, origin: CommandOrigin = UI) =>
    setup.bus.dispatch(name, { ...where, ...payload }, origin);
  return { ...setup, template, head, where, run };
}

const spans = (template: Template) => template.slots.map((slot) => [slot.start.value, slot.duration.value]);
const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error!.code);

describe('template.slot.moveCut', () => {
  it('moves the cut between two slots; undo goes back to the base and redo reuses the version', async () => {
    const { run, head, template, bus, projectA, store } = await created();
    const slot = template.slots[2]!;
    const moved = await run(N.moveCut, { baseVersion: 1, slotId: slot.id, to: at(40) });
    expect(moved.ok && moved.value.result).toEqual({ templateId: template.id, version: 2 });
    const after = await head();
    expect(spans(after)).toEqual([
      [0, 30],
      [30, 10],
      [40, 50],
      [90, 30],
    ]);
    expect(after.slots[2]).toMatchObject({
      cut: { method: 'user', confidence: 1 },
      beatAnchor: { beatIndex: 3, offset: { value: -5 } },
    });
    expect(after.duration).toEqual(template.duration);
    expect(after.pacing.cutsOnBeat).toBeCloseTo(2 / 3);

    expect((await bus.undo(projectA, UI)).ok).toBe(true);
    expect(spans(await head())).toEqual(spans(template));
    expect((await bus.redo(projectA, UI)).ok).toBe(true);
    expect((await head()).version).toBe(2);
    const versions = await store.versions(template.id);
    expect(versions.ok && versions.value.map((v) => [v.version, v.command])).toEqual([
      [1, null],
      [2, N.moveCut],
    ]);
  });

  it('takes a time at any rate and lands it on the nearest frame', async () => {
    const { run, head, template } = await created();
    // 1.234 s is frame 37.02 at 30 fps.
    const to = RationalTime.of(1234, FrameRate.of(1000));
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId: template.slots[2]!.id, to }))).toBe('ok');
    expect((await head()).slots[2]!.start).toEqual(at(37));
  });

  it('snaps to the nearest beat between the neighbouring cuts', async () => {
    const { run, head, template } = await created();
    const slotId = template.slots[3]!.id;
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId, to: at(70), snap: 'beat' }))).toBe('ok');
    const after = await head();
    expect(after.slots[3]!.start).toEqual(at(75));
    expect(after.slots[3]!.beatAnchor).toEqual({ beatIndex: 5, offset: at(0) });
  });

  it('carries overlays and tiles to the slot their start now falls in', async () => {
    const { run, head, template } = await created();
    // Slot 2 starts at 30; the overlay at 32 and the tile at 35 are in it until its cut moves to 36.
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId: template.slots[1]!.id, to: at(36) }))).toBe(
      'ok',
    );
    const after = await head();
    expect(after.text[0]!.slotId).toBe(template.slots[0]!.id);
    expect(after.text[1]!.slotId).toBe(template.slots[3]!.id);
    expect(after.contactSheet!.frames.map((frame) => frame.slotId)).toEqual([
      template.slots[0]!.id,
      template.slots[0]!.id,
      template.slots[2]!.id,
      template.slots[3]!.id,
    ]);
    // Slot 2 (36–45) has no tile inside it now: it keeps the one it had.
    expect(after.slots[1]!.frame).toBe(1);
  });

  it('trims a transition and a ramp to the slots they now sit in', async () => {
    const { run, head, template } = await created();
    // The dissolve into slot 3 reaches 4 frames back; slot 2 shrinks to 2.
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId: template.slots[2]!.id, to: at(32) }))).toBe(
      'ok',
    );
    expect((await head()).slots[2]!.transitionIn).toMatchObject({ before: at(2), after: at(4) });
    // Slot 4's ramp counts from its start: a moved start drops it.
    expect(code(await run(N.moveCut, { baseVersion: 2, slotId: template.slots[3]!.id, to: at(100) }))).toBe(
      'ok',
    );
    expect((await head()).slots[3]!.speedRamp).toBeNull();
  });

  it('refuses the first slot, a cut outside its neighbours, and a beat with no beat map', async () => {
    const { run, template } = await created();
    const [first, second] = template.slots;
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId: first!.id, to: at(10) }))).toBe(
      'templates.first_slot_cut',
    );
    for (const to of [at(0), at(45), at(-3), RationalTime.of(Number.MAX_SAFE_INTEGER, FrameRate.of(1, 1000))])
      expect(code(await run(N.moveCut, { baseVersion: 1, slotId: second!.id, to }))).toBe(
        'templates.cut_out_of_range',
      );
    // Slot 2 runs 30–45: a cut at 1 or 44 leaves a frame either side.
    expect(code(await run(N.moveCut, { baseVersion: 1, slotId: second!.id, to: at(1) }))).toBe('ok');
    const silent = { ...referenceTemplate(), beatMap: null };
    silent.slots = silent.slots.map((slot) => ({ ...slot, beatAnchor: null }));
    silent.pacing = { ...silent.pacing, cutsOnBeat: null };
    const { run: runSilent, template: plain } = await created(silent);
    const beat = { baseVersion: 1, slotId: plain.slots[1]!.id, to: at(20), snap: 'beat' };
    expect(code(await runSilent(N.moveCut, beat))).toBe('templates.no_beat_map');
    expect(code(await runSilent(N.moveCut, { ...beat, snap: 'frame' }))).toBe('ok');
  });
});

describe('template.slot.split', () => {
  it('adds a cut inside a slot: the second half copies the intent, unapproved, its cut the user’s', async () => {
    const { run, head, template, bus, projectA } = await created();
    const slot = template.slots[2]!;
    expect(code(await run(N.approveSlots, { baseVersion: 1, slotIds: [slot.id] }))).toBe('ok');
    expect(code(await run(N.splitSlot, { baseVersion: 2, slotId: slot.id, at: at(60) }))).toBe('ok');
    const after = await head();
    expect(spans(after)).toEqual([
      [0, 30],
      [30, 15],
      [45, 15],
      [60, 30],
      [90, 30],
    ]);
    const [first, second] = [after.slots[2]!, after.slots[3]!];
    expect(first).toMatchObject({
      id: slot.id,
      approved: true,
      cut: slot.cut,
      transitionIn: slot.transitionIn,
    });
    expect(second.id).not.toBe(slot.id);
    expect(second).toMatchObject({
      name: null,
      role: slot.role,
      intent: slot.intent,
      approved: false,
      cut: { method: 'user', confidence: 1 },
      beatAnchor: { beatIndex: 4, offset: at(0) },
      transitionIn: null,
      speedRamp: null,
    });
    expect(after.pacing.shotCount).toBe(5);
    expect((await bus.undo(projectA, UI)).ok).toBe(true);
    expect((await head()).slots).toHaveLength(4);
  });

  it('carries an overlay into the new slot and trims a ramp that no longer fits', async () => {
    const { run, head, template } = await created();
    const slot = template.slots[3]!;
    expect(code(await run(N.splitSlot, { baseVersion: 1, slotId: slot.id, at: at(93) }))).toBe('ok');
    const after = await head();
    expect(after.text[1]!.slotId).toBe(after.slots[4]!.id);
    expect(after.contactSheet!.frames[3]!.slotId).toBe(after.slots[4]!.id);
    expect(after.slots[4]!.frame).toBe(3);
    // The ramp's second point (20) is past the first half's 3 frames.
    expect(after.slots[3]!.speedRamp).toBeNull();
  });

  it('snaps to a beat inside the slot, and refuses a cut on its edges', async () => {
    const { run, head, template } = await created();
    const slot = template.slots[2]!;
    expect(code(await run(N.splitSlot, { baseVersion: 1, slotId: slot.id, at: at(52), snap: 'beat' }))).toBe(
      'ok',
    );
    expect((await head()).slots[3]!.start).toEqual(at(60));
    for (const cut of [at(45), at(90), at(120)])
      expect(code(await run(N.splitSlot, { baseVersion: 2, slotId: slot.id, at: cut }))).toBe(
        'templates.cut_out_of_range',
      );
    expect(code(await run(N.splitSlot, { baseVersion: 2, slotId: template.id, at: at(50) }))).toBe(
      'templates.slot_not_found',
    );
  });
});

describe('the review commands and a stale base', () => {
  it('each answers core.conflict when the head has moved', async () => {
    const { run, template } = await created();
    const [, second, third] = template.slots;
    expect(code(await run(N.renameSlot, { baseVersion: 1, slotId: second!.id, name: 'x' }))).toBe('ok');
    const stale = [
      [N.moveCut, { slotId: third!.id, to: at(40) }],
      [N.splitSlot, { slotId: third!.id, at: at(60) }],
      [N.setRole, { slotId: third!.id, role: 'peak' }],
      [N.removeText, { overlayIds: [template.text[0]!.id] }],
      [N.setTempo, { factor: 2 }],
      [N.dismissDoubt, { target: { kind: 'template' }, reason: 'tempoMaybeHalfOrDouble' }],
    ] as const;
    for (const [name, payload] of stale)
      expect([name, code(await run(name, { baseVersion: 1, ...payload }))]).toEqual([name, 'core.conflict']);
  });
});
