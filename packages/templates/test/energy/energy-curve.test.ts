// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Energy curve (P3-V12): default round-trip, splits, merges, hook cap, downbeats, undo. */
import { describe, expect, it } from 'vitest';
import {
  newId,
  TEMPLATE_COMMANDS,
  type EnergyCurve,
  type Result,
  type SlotId,
  type Template,
} from '@taalcut/core';
import { ENERGY_CONFIG, beatsForEnergy } from '../../src/energy/energy-config';
import { createEnergyCommands } from '../../src/energy/energy-commands';
import { applyEnergyCurve, energyCurveOf, type EnergyIds } from '../../src/energy/energy-curve';
import { setupTemplates, UI } from '../helpers/setup';
import { BEAT, gridTemplate } from './fixture';

const N = TEMPLATE_COMMANDS;

function section(
  template: Template,
  from: number,
  to: number,
  beatsPerClip: EnergyCurve['sections'][number]['beatsPerClip'],
  align: 'beat' | 'downbeat' = 'beat',
  energy = 0.5,
): EnergyCurve['sections'][number] {
  const start = template.slots[from];
  const end = template.slots[to];
  if (!start || !end) throw new Error(`section ${from}..${to}`);
  return { fromSlotId: start.id, toSlotId: end.id, energy, beatsPerClip, align };
}

function countingSlots(): EnergyIds {
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let n = 0;
  return {
    slot: (): SlotId => {
      let value = n++;
      let tail = '';
      for (let i = 0; i < 8; i += 1, value = Math.floor(value / 32)) {
        tail = (crockford[value % 32] ?? '0') + tail;
      }
      return `01HZZZZZZZZZZZZZZZ${tail}` as SlotId;
    },
  };
}

function run(template: Template, sections: EnergyCurve['sections'], ids?: EnergyIds) {
  const before = JSON.stringify(template);
  const applied = applyEnergyCurve(template, { sections }, ids ?? { slot: () => newId<'TemplateSlot'>() });
  expect(JSON.stringify(template)).toBe(before);
  return applied;
}

function take(template: Template, sections: EnergyCurve['sections'], ids?: EnergyIds) {
  const applied = run(template, sections, ids);
  const detail = applied.ok ? '' : `${applied.error.code} ${applied.error.detail ?? ''}`;
  expect(applied.ok, detail).toBe(true);
  if (!applied.ok) throw new Error(applied.error.code);
  return applied.value;
}

function starts(template: Template): number[] {
  return template.slots.map((slot) => slot.start.value);
}

function onBeatOrHalf(frame: number, beats: readonly number[]): boolean {
  if (beats.includes(frame)) return true;
  for (let index = 0; index < beats.length; index += 1) {
    const here = beats[index];
    const next = beats[index + 1] ?? (here === undefined ? undefined : here + BEAT);
    if (here !== undefined && next !== undefined && Math.round((here + next) / 2) === frame) return true;
  }
  return false;
}

/** Hook plus three body slots, 30 frames each, covering 0–120. */
function fourSlots(withOverlay: boolean): Template {
  return gridTemplate(
    [
      { frames: 30, role: 'hook', energy: 0.4 },
      { frames: 30, role: 'body', energy: 0.3 },
      { frames: 30, role: 'body', energy: 0.3 },
      { frames: 30, role: 'body', energy: 0.3 },
    ],
    withOverlay ? [{ start: 45, frames: 8, slot: 1 }] : [],
  );
}

function faster(template: Template): EnergyCurve['sections'] {
  return [section(template, 0, 0, 2, 'beat', 0.4), section(template, 1, 3, 1, 'beat', 0.8)];
}

describe('energy config', () => {
  it('maps a drag to beats per clip', () => {
    expect(ENERGY_CONFIG.version).toBe(1);
    expect(beatsForEnergy(1)).toBe(1);
    expect(beatsForEnergy(0.85)).toBe(1);
    expect(beatsForEnergy(0.849)).toBe(2);
    expect(beatsForEnergy(0.65)).toBe(2);
    expect(beatsForEnergy(0.64)).toBe(4);
    expect(beatsForEnergy(0.4)).toBe(4);
    expect(beatsForEnergy(0.2)).toBe(8);
    expect(beatsForEnergy(0.19)).toBe(16);
    expect(beatsForEnergy(0)).toBe(16);
  });
});

describe('applyEnergyCurve', () => {
  it('round-trips the default curve without changing the template', () => {
    const template = gridTemplate([
      { frames: 30, role: 'hook', energy: 0.9 },
      { frames: 30, role: 'body', energy: 0.2 },
      { frames: 30, role: 'body', energy: 0.9 },
      { frames: 30, role: 'body', energy: 0.4 },
      { frames: 30, role: 'peak', energy: 0.95 },
      { frames: 30, role: 'peak', energy: 0.7 },
      { frames: 30, role: 'body', energy: 0.3 },
      { frames: 30, role: 'outro', energy: 0.1 },
    ]);
    const applied = take(template, energyCurveOf(template).sections);
    expect(applied.template).toEqual(template);
    expect(applied.slotMap.every((row) => row.unchanged)).toBe(true);
  });

  it('splits a faster section, keeps boundary cuts and moves the overlay', () => {
    const template = fourSlots(true);
    const applied = take(template, faster(template));
    const next = applied.template;
    expect(starts(next)).toEqual([0, 30, 45, 60, 75, 90, 105]);
    expect(next.slots[0]?.id).toBe(template.slots[0]?.id);
    expect(next.slots[1]?.id).toBe(template.slots[1]?.id);
    expect(next.slots[3]?.id).toBe(template.slots[2]?.id);
    expect(next.slots[5]?.id).toBe(template.slots[3]?.id);
    expect(next.slots[1]?.duration.value).toBe(15);
    expect(next.slots[0]?.duration.value).toBe(30);
    const end = next.slots[next.slots.length - 1];
    expect(end && end.start.value + end.duration.value).toBe(120);
    const beats = template.beatMap?.beats.map((beat) => beat.value) ?? [];
    expect(next.slots.every((slot) => onBeatOrHalf(slot.start.value, beats))).toBe(true);
    expect(next.slots.slice(1).every((slot) => slot.intent.energy === 0.8)).toBe(true);
    expect(next.slots[0]?.intent.energy).toBe(0.4);
    const overlay = next.text[0];
    expect(overlay?.slotId).toBe(next.slots[2]?.id);
    expect(applied.slotMap[2]?.unchanged).toBe(false);
  });

  it('merges a slower section into the slot that started it', () => {
    const template = fourSlots(false);
    const applied = take(template, [section(template, 0, 0, 2), section(template, 1, 3, 8, 'beat', 0.2)]);
    const next = applied.template;
    expect(starts(next)).toEqual([0, 30]);
    expect(next.slots[1]?.id).toBe(template.slots[1]?.id);
    expect(next.slots[1]?.duration.value).toBe(90);
    expect(next.slots[0]?.duration.value).toBe(30);
    expect(applied.slotMap[1]?.unchanged).toBe(false);
    expect(applied.slotMap[1]?.from).toEqual([
      template.slots[1]?.id,
      template.slots[2]?.id,
      template.slots[3]?.id,
    ]);
    expect(next.slots[1]?.intent.energy).toBe(0.2);
  });

  it('keeps slot 0 at or under 1.5 seconds', () => {
    const template = gridTemplate([{ frames: 60, role: 'hook', energy: 0.8 }]);
    const next = take(template, [section(template, 0, 0, 4)]).template;
    expect(starts(next)).toEqual([0, 45]);
    expect(next.slots[0]?.duration.value).toBe(45);
    expect(next.slots[0]?.role).toBe('hook');
    expect(next.slots[1]?.duration.value).toBe(15);
  });

  it('aligns the first inner cut to the next downbeat', () => {
    const template = gridTemplate([
      { frames: 30, role: 'hook', energy: 0.4 },
      { frames: 120, role: 'body', energy: 0.5 },
    ]);
    const down = take(template, [
      section(template, 0, 0, 2),
      section(template, 1, 1, 4, 'downbeat', 0.7),
    ]).template;
    expect(starts(down)).toEqual([0, 30, 60, 120]);
    expect(down.slots[1]?.id).toBe(template.slots[1]?.id);
    expect(down.slots[2]?.id).not.toBe(template.slots[1]?.id);
    const beat = take(template, [section(template, 0, 0, 2), section(template, 1, 1, 4, 'beat')]).template;
    expect(starts(beat)).toEqual([0, 30, 90]);
  });

  it('is deterministic for the same id source', () => {
    const template = fourSlots(false);
    const left = take(template, faster(template), countingSlots());
    const right = take(template, faster(template), countingSlots());
    expect(left).toEqual(right);
  });

  it('refuses a curve that does not tile, a bad config and a missing beat map', () => {
    const template = gridTemplate([
      { frames: 30, role: 'hook', energy: 0.2 },
      { frames: 30, role: 'body', energy: 0.2 },
      { frames: 30, role: 'body', energy: 0.2 },
    ]);
    const ids = { slot: () => newId<'TemplateSlot'>() };
    const unknown = newId<'TemplateSlot'>();
    const cases: { readonly name: string; readonly result: Result<unknown> }[] = [
      {
        name: 'unknown-slot',
        result: run(
          template,
          [{ ...section(template, 0, 2, 2), fromSlotId: unknown, toSlotId: unknown }],
          ids,
        ),
      },
      { name: 'order', result: run(template, [section(template, 2, 0, 2)], ids) },
      {
        name: 'gap',
        result: run(template, [section(template, 0, 0, 2), section(template, 2, 2, 2)], ids),
      },
      {
        name: 'overlap',
        result: run(template, [section(template, 0, 1, 2), section(template, 1, 2, 2)], ids),
      },
      {
        name: 'config',
        result: applyEnergyCurve(template, energyCurveOf(template), ids, {
          version: 0,
          levels: ENERGY_CONFIG.levels,
        }),
      },
    ];
    for (const item of cases) {
      expect(item.result.ok, item.name).toBe(false);
      if (!item.result.ok) expect(item.result.error.params?.reason).toBe(item.name);
      expect(item.result.ok ? '' : item.result.error.code).toBe('templates.energy_curve_invalid');
    }
    const quiet = run({ ...template, beatMap: null }, energyCurveOf(template).sections, ids);
    expect(quiet.ok).toBe(false);
    if (!quiet.ok) expect(quiet.error.code).toBe('templates.no_beat_map');
    const map = template.beatMap;
    if (!map) throw new Error('beat map');
    const empty = run({ ...template, beatMap: { ...map, beats: [] } }, energyCurveOf(template).sections, ids);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('templates.no_beat_map');
  });
});

describe('template.setEnergyCurve', () => {
  it('makes one version; undo restores the head and redo reuses that version', async () => {
    const setup = setupTemplates();
    setup.bus.register(...createEnergyCommands({ service: setup.service }).all);
    const template = fourSlots(false);
    const where = { projectId: setup.projectA, templateId: template.id };
    const created = await setup.bus.dispatch(
      N.create,
      { projectId: setup.projectA, template, name: 'Curve', listed: true },
      UI,
    );
    expect(created.ok).toBe(true);
    const curve = { sections: faster(template) };
    const done = await setup.bus.dispatch(N.setEnergyCurve, { ...where, baseVersion: 1, curve }, UI);
    expect(done.ok && done.value.result).toEqual({ templateId: template.id, version: 2 });
    const stale = await setup.bus.dispatch(N.setEnergyCurve, { ...where, baseVersion: 1, curve }, UI);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe('core.conflict');

    expect((await setup.bus.undo(setup.projectA, UI)).ok).toBe(true);
    const back = await setup.service.get({ templateId: template.id });
    if (!back.ok) throw new Error(back.error.code);
    expect(back.value.template.version).toBe(1);
    expect(back.value.template.slots).toHaveLength(4);

    expect((await setup.bus.redo(setup.projectA, UI)).ok).toBe(true);
    const again = await setup.service.get({ templateId: template.id });
    if (!again.ok) throw new Error(again.error.code);
    expect(again.value.template.version).toBe(2);
    expect(again.value.template.slots).toHaveLength(7);
    const versions = await setup.store.versions(template.id);
    expect(versions.ok && versions.value.length).toBe(2);
  });
});
