// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * BRK1-CMD's other commands on core's real bus (role, "Not text", tempo, dismiss a doubt) and how every edit
 * resolves the doubts it answers. The fixture: four slots at 0, 30, 45 and 90 (30 fps) on 120 BPM beats every 15
 * frames, downbeats on beats 0 and 4, overlays in slots 2 and 4.
 */
import { describe, expect, it } from 'vitest';
import {
  TEMPLATE_COMMANDS as N,
  templateSchema,
  type CommandOrigin,
  type Doubt,
  type DoubtReason,
  type Template,
} from '@taalcut/core';
import { at, json, referenceTemplate } from './helpers/fixtures';
import { AGENT, setupTemplates, UI } from './helpers/setup';

const doubts = (...reasons: DoubtReason[]): Doubt[] => reasons.map((reason) => ({ reason, confidence: 0.4 }));
const reasonsOf = (item: { readonly doubts?: readonly Doubt[] | undefined }) =>
  item.doubts?.map((doubt) => doubt.reason) ?? [];

/** The fixture with doubts everywhere the breakdown writes them. */
function doubtful(): Template {
  const template = referenceTemplate();
  return {
    ...template,
    doubts: doubts('tempoMaybeHalfOrDouble', 'soundCreditMissing'),
    slots: template.slots.map((slot, index) =>
      index === 0 ? slot : { ...slot, doubts: doubts('cutUnsure', 'fadeTail', 'intentVague') },
    ),
    text: template.text.map((item) => ({ ...item, doubts: doubts('textMaybeScene') })),
  };
}

async function created(template: Template = doubtful()) {
  const setup = setupTemplates();
  await setup.bus.dispatch(N.create, { projectId: setup.projectA, template, name: 'Goa', listed: true }, UI);
  const head = async (): Promise<Template> => {
    const got = await setup.service.get({ templateId: template.id });
    if (!got.ok) throw new Error(got.error.code);
    expect(templateSchema.safeParse(json(got.value.template)).success).toBe(true);
    return got.value.template;
  };
  const run = (name: string, payload: object, origin: CommandOrigin = UI) =>
    setup.bus.dispatch(name, { projectId: setup.projectA, templateId: template.id, ...payload }, origin);
  return { ...setup, template, head, run };
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error!.code);

describe('template.slot.setRole and template.text.remove', () => {
  it('sets a role, and undo puts it back', async () => {
    const { run, head, template, bus, projectA } = await created();
    expect(code(await run(N.setRole, { baseVersion: 1, slotId: template.slots[2]!.id, role: 'peak' }))).toBe(
      'ok',
    );
    expect((await head()).slots[2]!.role).toBe('peak');
    await bus.undo(projectA, UI);
    expect((await head()).slots[2]!.role).toBe('body');
    expect(code(await run(N.setRole, { baseVersion: 1, slotId: template.id, role: 'peak' }))).toBe(
      'templates.slot_not_found',
    );
  });

  it('removes overlays with their doubts; an unknown one refuses the whole edit', async () => {
    const { run, head, template, bus, projectA } = await created();
    const [goa, follow] = template.text;
    const unknown = template.slots[0]!.id as unknown as string;
    expect(code(await run(N.removeText, { baseVersion: 1, overlayIds: [goa!.id, unknown] }))).toBe(
      'templates.overlay_not_found',
    );
    expect(code(await run(N.removeText, { baseVersion: 1, overlayIds: [goa!.id, goa!.id] }))).toBe('ok');
    expect((await head()).text.map((item) => item.id)).toEqual([follow!.id]);
    await bus.undo(projectA, UI);
    expect((await head()).text).toEqual(template.text);
  });
});

describe('template.setSoundCredit (BRK1-REV)', () => {
  it('writes the credit, answers soundCreditMissing, and undo puts both back', async () => {
    const { run, head, template, bus, projectA } = await created();
    const credit = { title: 'Monsoon', artist: 'Rhea', url: 'https://example.com/sound/1' };
    expect(code(await run(N.setSoundCredit, { baseVersion: 1, credit }))).toBe('ok');
    const after = await head();
    expect(after.audio.sound).toEqual(credit);
    expect(reasonsOf(after)).toEqual(['tempoMaybeHalfOrDouble']);
    expect(after.version).toBe(2);
    await bus.undo(projectA, UI);
    expect((await head()).audio.sound).toEqual(template.audio.sound);
    expect(reasonsOf(await head())).toEqual(['tempoMaybeHalfOrDouble', 'soundCreditMissing']);
  });

  it('keeps what was given (a title alone has no artist and no link), and null clears it', async () => {
    const { run, head } = await created();
    expect(code(await run(N.setSoundCredit, { baseVersion: 1, credit: { title: '  Monsoon ' } }))).toBe('ok');
    expect((await head()).audio.sound).toEqual({ title: 'Monsoon', artist: null });
    expect(code(await run(N.setSoundCredit, { baseVersion: 2, credit: null }))).toBe('ok');
    expect((await head()).audio.sound).toBeNull();
    expect(code(await run(N.setSoundCredit, { baseVersion: 3, credit: { url: 'http://example.com' } }))).toBe(
      'core.validation',
    );
    expect(code(await run(N.setSoundCredit, { baseVersion: 1, credit: null }))).toBe('core.conflict');
  });
});

describe('template.setTempo', () => {
  it('doubles the beat map: a beat between each pair, the bars where they were, every anchor following', async () => {
    const { run, head, template } = await created();
    expect(code(await run(N.setTempo, { baseVersion: 1, factor: 2 }))).toBe('ok');
    const after = await head();
    const map = after.beatMap!;
    expect(map.beats.map((beat) => beat.value)).toEqual([
      0, 13, 25, 38, 50, 63, 75, 88, 100, 113, 125, 138, 150, 163, 175,
    ]);
    expect(map).toMatchObject({ downbeats: [0, 8], bpm: 240, beatsPerBar: 8, source: 'user' });
    expect(after.slots.map((slot) => slot.beatAnchor!.beatIndex)).toEqual([0, 4, 6, 12]);
    expect(after.pacing.cutsOnBeat).toBe(1);
    expect(reasonsOf(after)).toEqual(['soundCreditMissing']);
    expect(after.slots.map((slot) => slot.start)).toEqual(template.slots.map((slot) => slot.start));
  });

  it('halves it on the downbeats’ side, and halving a doubled map gives the first back', async () => {
    const { run, head, template } = await created();
    expect(code(await run(N.setTempo, { baseVersion: 1, factor: 0.5 }))).toBe('ok');
    const half = await head();
    expect(half.beatMap!.beats.map((beat) => beat.value)).toEqual([0, 50, 100, 150]);
    expect(half.beatMap).toMatchObject({ downbeats: [0, 2], bpm: 60 });
    // Slot 3 starts at 45, halfway between beats at 30 and 60: the earlier one.
    expect(half.slots[2]!.beatAnchor).toEqual({ beatIndex: 1, offset: at(15) });
    expect(half.pacing.cutsOnBeat).toBeCloseTo(2 / 3);
    expect(code(await run(N.setTempo, { baseVersion: 2, factor: 2 }))).toBe('ok');
    expect(code(await run(N.setTempo, { baseVersion: 3, factor: 0.5 }))).toBe('ok');
    expect((await head()).beatMap).toEqual(half.beatMap);
    const other = await created();
    await other.run(N.setTempo, { baseVersion: 1, factor: 2 });
    await other.run(N.setTempo, { baseVersion: 2, factor: 0.5 });
    expect((await other.head()).beatMap!.beats).toEqual(template.beatMap!.beats);
    expect((await other.head()).slots.map((slot) => slot.beatAnchor)).toEqual(
      template.slots.map((slot) => slot.beatAnchor),
    );
  });

  it('refuses a template with no beat map, and a tempo past 400 BPM', async () => {
    const silent = { ...doubtful(), beatMap: null };
    silent.slots = silent.slots.map((slot) => ({ ...slot, beatAnchor: null }));
    silent.pacing = { ...silent.pacing, cutsOnBeat: null };
    expect(code(await (await created(silent)).run(N.setTempo, { baseVersion: 1, factor: 2 }))).toBe(
      'templates.no_beat_map',
    );
    const fast = doubtful();
    const fastest = { ...fast, beatMap: { ...fast.beatMap!, bpm: 240 } };
    expect(code(await (await created(fastest)).run(N.setTempo, { baseVersion: 1, factor: 2 }))).toBe(
      'core.validation',
    );
  });
});

describe('template.doubt.dismiss', () => {
  it('removes one doubt from a slot, an overlay or the template', async () => {
    const { run, head, template } = await created();
    const slotId = template.slots[1]!.id;
    const overlayId = template.text[0]!.id;
    expect(
      code(
        await run(N.dismissDoubt, { baseVersion: 1, target: { kind: 'slot', slotId }, reason: 'cutUnsure' }),
      ),
    ).toBe('ok');
    expect(reasonsOf((await head()).slots[1]!)).toEqual(['fadeTail', 'intentVague']);
    const text = { kind: 'text', overlayId };
    expect(code(await run(N.dismissDoubt, { baseVersion: 2, target: text, reason: 'textMaybeScene' }))).toBe(
      'ok',
    );
    // An item left with no doubt has no `doubts` at all: absent means none.
    expect((await head()).text[0]).not.toHaveProperty('doubts');
    const whole = { kind: 'template' };
    expect(
      code(await run(N.dismissDoubt, { baseVersion: 3, target: whole, reason: 'soundCreditMissing' })),
    ).toBe('ok');
    expect(reasonsOf(await head())).toEqual(['tempoMaybeHalfOrDouble']);
  });

  it('refuses a doubt the item doesn’t have, and an item the template doesn’t have', async () => {
    const { run, template } = await created();
    const dismiss = (target: object, reason: DoubtReason) =>
      run(N.dismissDoubt, { baseVersion: 1, target, reason });
    expect(code(await dismiss({ kind: 'slot', slotId: template.slots[0]!.id }, 'cutUnsure'))).toBe(
      'templates.doubt_not_found',
    );
    expect(code(await dismiss({ kind: 'template' }, 'cutUnsure'))).toBe('templates.doubt_not_found');
    expect(code(await dismiss({ kind: 'text', overlayId: template.slots[0]!.id }, 'textMaybeScene'))).toBe(
      'templates.overlay_not_found',
    );
    expect(code(await dismiss({ kind: 'slot', slotId: template.text[0]!.id }, 'cutUnsure'))).toBe(
      'templates.slot_not_found',
    );
  });
});

describe('doubts cleared on edit', () => {
  it('approving clears the slot’s own doubts, not its overlays’', async () => {
    const { run, head, template } = await created();
    await run(N.approveSlots, { baseVersion: 1, slotIds: [template.slots[1]!.id, template.slots[3]!.id] });
    const after = await head();
    expect(after.slots.map(reasonsOf)).toEqual([[], [], ['cutUnsure', 'fadeTail', 'intentVague'], []]);
    expect(after.text.map(reasonsOf)).toEqual([['textMaybeScene'], ['textMaybeScene']]);
  });

  it('a typed description is the user’s and answers only the vague-intent doubt', async () => {
    const { run, head, template } = await created();
    const slotId = template.slots[2]!.id;
    expect(
      code(
        await run(N.editIntent, {
          baseVersion: 1,
          slotId,
          intent: { text: 'train window, fields pan left' },
        }),
      ),
    ).toBe('ok');
    const slot = (await head()).slots[2]!;
    expect(slot.intent).toMatchObject({ text: 'train window, fields pan left', source: 'user' });
    expect(reasonsOf(slot)).toEqual(['cutUnsure', 'fadeTail']);
    await run(
      N.editIntent,
      { baseVersion: 2, slotId: template.slots[3]!.id, intent: { motion: 'pan' } },
      AGENT,
    );
    expect(reasonsOf((await head()).slots[3]!)).toEqual(['cutUnsure', 'fadeTail']);
  });

  it('moving a cut answers its cut and fade doubts, and the fade doubt of the slot before', async () => {
    const { run, head, template } = await created();
    await run(N.moveCut, { baseVersion: 1, slotId: template.slots[2]!.id, to: at(40) });
    const after = await head();
    expect(after.slots.map(reasonsOf)).toEqual([
      [],
      ['cutUnsure', 'intentVague'],
      ['intentVague'],
      ['cutUnsure', 'fadeTail', 'intentVague'],
    ]);
  });

  it('a split’s new half takes only the intent’s doubt; a merge keeps the first cut’s and the intent’s', async () => {
    const { run, head, template } = await created();
    await run(N.splitSlot, { baseVersion: 1, slotId: template.slots[2]!.id, at: at(60) });
    expect((await head()).slots.map(reasonsOf)).toEqual([
      [],
      ['cutUnsure', 'fadeTail', 'intentVague'],
      ['cutUnsure', 'fadeTail', 'intentVague'],
      ['intentVague'],
      ['cutUnsure', 'fadeTail', 'intentVague'],
    ]);
    const merged = await created();
    const [, second, third] = merged.template.slots;
    await merged.run(N.mergeSlots, { baseVersion: 1, slotIds: [second!.id, third!.id] });
    expect(reasonsOf((await merged.head()).slots[1]!)).toEqual(['cutUnsure', 'intentVague']);
  });

  it('dropping the first slot leaves the new first slot with no cut doubt', async () => {
    const { run, head, template } = await created();
    await run(N.dropSlot, { baseVersion: 1, slotId: template.slots[0]!.id });
    expect(reasonsOf((await head()).slots[0]!)).toEqual(['fadeTail', 'intentVague']);
  });
});
