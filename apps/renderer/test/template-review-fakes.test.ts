// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import {
  callRpc,
  proposalCommand,
  templateProposalsSchema,
  templateSchema,
  type RationalTime,
  type Template,
} from '@taalcut/core';
import { reviewEditCommand } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { fakeProposeEdits } from '../src/backend/fake/templates/fake-propose-edits';
import { templateIdOf } from '../src/backend/fake/templates/template-data';
import {
  dismissDoubt,
  editIntent,
  moveCut,
  removeText,
  setRole,
  setSoundCredit,
  setTempo,
  splitSlot,
} from '../src/backend/fake/templates/template-review-edits';
import {
  COAST_ROAD,
  coastRoad,
  RAINY_MARKET,
  rainyMarket,
  sampleReelOf,
  sampleSheetOf,
} from '../src/backend/fake/templates/template-review-plans';

const valid = (template: Template) => {
  const parsed = templateSchema.safeParse(template);
  if (!parsed.success)
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  return true;
};
const frames = (n: number): RationalTime => ({ value: n, rate: { num: 30, den: 1 } });
const ok = (result: ReturnType<typeof moveCut>): Template => {
  if (!result.ok) throw new Error(result.reason);
  expect(valid(result.template)).toBe(true);
  return result.template;
};
const T0 = Date.UTC(2026, 9, 31);

describe('BRK1-REV fakes: the review reels', () => {
  it('are Template v1 with doubts and designs: one portrait, one landscape of 15 slots', () => {
    const rainy = rainyMarket();
    const coast = coastRoad();
    expect(valid(rainy) && valid(coast)).toBe(true);
    expect(rainy.canvas.height).toBeGreaterThan(rainy.canvas.width);
    expect(coast.canvas.width).toBeGreaterThan(coast.canvas.height);
    expect(coast.slots).toHaveLength(15);
    expect(rainy.slots.flatMap((slot) => slot.doubts ?? []).map((d) => d.reason)).toEqual([
      'intentVague',
      'cutUnsure',
      'cutMaybeTransition',
      'fadeTail',
    ]);
    expect(rainy.doubts?.map((d) => d.reason)).toEqual(['tempoMaybeHalfOrDouble', 'soundCreditMissing']);
    expect(rainy.text.map((t) => t.design?.kind ?? null)).toEqual(['chatBubble', 'plain', 'pill']);
    expect(coast.text[1]!.doubts?.[0]!.reason).toBe('textMaybeScene');
  });

  it('play their own synthetic reels and show those reels’ frames', () => {
    expect(sampleReelOf(templateIdOf(RAINY_MARKET))).toBe('reel-portrait.mp4');
    expect(sampleReelOf(templateIdOf(COAST_ROAD))).toBe('reel-landscape.mp4');
    expect(sampleSheetOf(rainyMarket().contactSheet!.asset)).toBe('reel-portrait-sheet.jpg');
    expect(sampleSheetOf('ffff')).toBeNull();
  });
});

describe('BRK1-REV fakes: the review edits', () => {
  it('move a cut on a frame or a beat, keep a frame each side, and answer core’s codes', () => {
    const t = rainyMarket();
    const slot = t.slots[4]!; // starts at 4.5 s (frame 135), an unsure cut
    const moved = ok(moveCut(t, slot.id, frames(140), 'frame', T0));
    expect(moved.slots[4]!.start.value).toBe(140);
    expect(moved.slots[3]!.duration.value).toBe(140 - 105);
    expect(moved.slots[4]!.doubts ?? []).toEqual([]);
    expect(moved.slots[4]!.cut).toEqual({ method: 'user', confidence: 1 });
    // On the beat: the nearest beat inside the neighbours (every 15 frames).
    expect(ok(moveCut(t, slot.id, frames(124), 'beat', T0)).slots[4]!.start.value).toBe(120);
    const first = moveCut(t, t.slots[0]!.id, frames(10), 'frame', T0);
    expect(first.ok || first.error?.code).toBe('templates.first_slot_cut');
    const out = moveCut(t, slot.id, frames(500), 'frame', T0);
    expect(out.ok || out.error?.code).toBe('templates.cut_out_of_range');
  });

  it('split a slot: the second half copies the intent, unapproved, the user’s cut', () => {
    const t = coastRoad();
    const at = t.slots[0]!; // 0–45
    const split = ok(splitSlot(t, at.id, frames(30), 'frame', T0));
    expect(split.slots).toHaveLength(16);
    expect(split.slots[1]!.start.value).toBe(30);
    expect(split.slots[1]!.intent.text).toBe(at.intent.text);
    expect(split.slots[1]!.approved).toBe(false);
    expect(split.slots[1]!.cut).toEqual({ method: 'user', confidence: 1 });
  });

  it('set a role, a typed description, text and tempo, and clear the doubts they answer', () => {
    const t = rainyMarket();
    expect(ok(setRole(t, t.slots[1]!.id, 'peak', T0)).slots[1]!.role).toBe('peak');
    const described = ok(editIntent(t, t.slots[2]!.id, { text: 'A wet street at dusk' }, 'ui', T0));
    expect(described.slots[2]!.intent).toMatchObject({ text: 'A wet street at dusk', source: 'user' });
    expect(described.slots[2]!.doubts ?? []).toEqual([]);
    const sign = t.text[1]!;
    expect(ok(removeText(t, [sign.id], T0)).text.map((x) => x.id)).not.toContain(sign.id);
    const halved = ok(setTempo(t, 0.5, T0));
    expect(halved.beatMap?.bpm).toBe(60);
    expect(halved.doubts?.map((d) => d.reason)).toEqual(['soundCreditMissing']);
    expect(ok(setTempo(t, 2, T0)).beatMap?.bpm).toBe(240);
  });

  it('writes the sound’s credit and answers its doubt; null clears it (BRK1-REV)', () => {
    const t = rainyMarket();
    const credited = ok(setSoundCredit(t, { title: 'Monsoon', url: 'https://example.com/sound' }, T0));
    expect(credited.audio.sound).toEqual({
      title: 'Monsoon',
      artist: null,
      url: 'https://example.com/sound',
    });
    expect(credited.doubts?.map((d) => d.reason)).not.toContain('soundCreditMissing');
    expect(valid(credited)).toBe(true);
    expect(ok(setSoundCredit(credited, null, T0)).audio.sound).toBeNull();
  });

  it('dismiss a doubt on a slot, a line of text or the reel, and refuse one that isn’t there', () => {
    const t = rainyMarket();
    const slot = ok(dismissDoubt(t, { kind: 'slot', slotId: t.slots[9]!.id }, 'fadeTail', T0));
    expect(slot.slots[9]!.doubts ?? []).toEqual([]);
    const text = ok(dismissDoubt(t, { kind: 'text', overlayId: t.text[1]!.id }, 'textMaybeScene', T0));
    expect(text.text[1]!.doubts ?? []).toEqual([]);
    expect(ok(dismissDoubt(t, { kind: 'template' }, 'soundCreditMissing', T0)).doubts).toHaveLength(1);
    const none = dismissDoubt(t, { kind: 'slot', slotId: t.slots[0]!.id }, 'cutUnsure', T0);
    expect(none.ok || none.error?.code).toBe('templates.doubt_not_found');
  });

  it('run on the bus: a new version, undoable, a stale base a conflict', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const templateId = templateIdOf(RAINY_MARKET);
    const before = await client.templates.get({ templateId });
    expect(before.summary.media).not.toBeNull();
    const slotId = before.template.slots[4]!.id;
    const moved = await callRpc(
      client.commands.dispatch({
        name: 'template.slot.moveCut',
        payload: { projectId: null, templateId, baseVersion: 1, slotId, to: frames(120), snap: 'beat' },
        source: 'ui',
      }),
    );
    expect(moved.ok).toBe(true);
    expect((await client.templates.get({ templateId })).template.slots[4]!.start.value).toBe(120);
    const stale = await callRpc(
      client.commands.dispatch({
        name: 'template.doubt.dismiss',
        payload: {
          projectId: null,
          templateId,
          baseVersion: 1,
          target: { kind: 'template' },
          reason: 'soundCreditMissing',
        },
        source: 'ui',
      }),
    );
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    await client.commands.undo({ projectId: null, source: 'ui' });
    expect((await client.templates.get({ templateId })).template.slots[4]!.start.value).toBe(135);
  });
});

describe('BRK1-REV fakes: Tell Taalcut', () => {
  it('answers proposals core’s schema accepts, for what the words name', () => {
    const t = rainyMarket();
    const base = { baseVersion: t.version };
    const cut = fakeProposeEdits(t, { ...base, slotIds: [t.slots[5]!.id], message: 'This cut is early' });
    expect(templateProposalsSchema.parse(cut).proposals.map((p) => p.command)).toEqual([
      'template.slot.moveCut',
    ]);
    const shot = fakeProposeEdits(t, { ...base, slotIds: [t.slots[4]!.id], message: 'It is one shot' });
    expect(templateProposalsSchema.parse(shot).proposals[0]).toMatchObject({
      command: 'template.slot.merge',
      payload: { slotIds: [t.slots[3]!.id, t.slots[4]!.id] },
    });
    const tempo = fakeProposeEdits(t, { ...base, message: 'The beat feels too fast, half it' });
    expect(templateProposalsSchema.parse(tempo).proposals[0]).toMatchObject({ payload: { factor: 0.5 } });
  });

  it('asked nothing it knows, answers the doubts; with none, a note and nothing to accept', () => {
    const t = rainyMarket();
    const doubts = templateProposalsSchema.parse(fakeProposeEdits(t, { baseVersion: 1, message: 'Fix it' }));
    expect(doubts.proposals.map((p) => p.command)).toEqual([
      'template.slot.editIntent',
      'template.slot.moveCut',
      'template.slot.merge',
      'template.text.remove',
    ]);
    const calm = fakeProposeEdits(t, { baseVersion: 1, slotIds: [t.slots[0]!.id], message: 'Hmm' });
    expect(calm.proposals).toEqual([]);
    expect(calm.note).toMatch(/Nothing here looks off/);
  });

  it('an accepted proposal is the command core’s proposalCommand builds, on the head at that moment', () => {
    const t = rainyMarket();
    const answer = templateProposalsSchema.parse(fakeProposeEdits(t, { baseVersion: 1, message: 'Fix it' }));
    expect(answer.proposals.length).toBeGreaterThan(0);
    for (const proposal of answer.proposals)
      expect(reviewEditCommand(t, null, { kind: 'proposal', proposal }, 3)).toEqual(
        proposalCommand(proposal, { projectId: null, templateId: t.id, baseVersion: 3 }),
      );
  });

  it('is served on templates.proposeEdits, and a stale base is a conflict', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const templateId = templateIdOf(COAST_ROAD);
    const answer = await callRpc(
      client.templates.proposeEdits({ templateId, baseVersion: 1, message: 'text' }),
    );
    expect(answer.ok && answer.value.proposals[0]!.command).toBe('template.text.remove');
    const stale = await callRpc(
      client.templates.proposeEdits({ templateId, baseVersion: 9, message: 'text' }),
    );
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
  });
});
