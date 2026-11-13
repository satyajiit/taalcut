// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import type { Template, TemplateProposal } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  checkItems,
  checkSummary,
  cutRange,
  nudgeCut,
  placeCut,
  proposalGone,
  proposalWords,
  reviewCounts,
  reviewEditCommand,
} from '../src/index';
import { stepItem } from '../src/templates/review-checks';
import { templateFixture } from './template-fixture';

/** The fixture with what BRK1's breakdown wasn't sure of: an unsure cut, a vague slot, scene text, the tempo. */
function doubted(): Template {
  const base = templateFixture();
  return {
    ...base,
    doubts: [{ reason: 'tempoMaybeHalfOrDouble', confidence: 0.6 }],
    slots: base.slots.map((slot, i) =>
      i === 1
        ? { ...slot, doubts: [{ reason: 'cutUnsure', confidence: 0.4 }] }
        : i === 3
          ? { ...slot, doubts: [{ reason: 'intentVague' }] }
          : i === 0
            ? { ...slot, doubts: [{ reason: 'fadeTail' }] }
            : slot,
    ),
    text: [
      ...base.text,
      {
        ...base.text[0]!,
        id: base.text[0]!.id.replace(/8$/, '7') as never,
        slotId: base.slots[2]!.id,
        text: 'OPEN',
        doubts: [{ reason: 'textMaybeScene' }],
      },
    ],
  };
}

describe('the review: what is left to check', () => {
  it('lists the reel’s doubts first, then slot by slot with its text; an approved slot has none left', () => {
    const t = doubted();
    const items = checkItems(t);
    expect(items.map((item) => item.key)).toEqual([
      'reel::tempoMaybeHalfOrDouble',
      `slot:${t.slots[1]!.id}:cutUnsure`,
      `text:${t.text[1]!.id}:textMaybeScene`,
      `slot:${t.slots[3]!.id}:intentVague`,
    ]);
    // Slot 1 is approved, so its fade doubt is resolved with it.
    expect(reviewCounts(t, items)).toEqual({ toCheck: 4, approved: 1, waiting: 3 });
  });

  it('keeps a text doubt in an approved slot: approving a slot never says its text is text', () => {
    const t = doubted();
    const approved: Template = {
      ...t,
      slots: t.slots.map((slot, i) => (i === 2 ? { ...slot, approved: true } : slot)),
    };
    expect(checkItems(approved).map((item) => item.key)).toContain(`text:${t.text[1]!.id}:textMaybeScene`);
  });

  it('says what is left in words, by kind, with plurals', () => {
    expect(checkSummary(i18n, checkItems(doubted()))).toBe(
      '1 cut Taalcut isn’t sure of, 1 vague description, 1 line of text that may be part of the scene, and 1 thing about the sound',
    );
  });

  it('steps through the items with J and K, going round', () => {
    const items = checkItems(doubted());
    expect(stepItem(items, null, 1)!.key).toBe(items[0]!.key);
    expect(stepItem(items, null, -1)!.key).toBe(items[3]!.key);
    expect(stepItem(items, items[3]!.key, 1)!.key).toBe(items[0]!.key);
    expect(stepItem(items, items[0]!.key, -1)!.key).toBe(items[3]!.key);
    expect(stepItem([], null, 1)).toBeNull();
  });
});

describe('the review: moving a cut', () => {
  const t = templateFixture(); // slots at 0, 1, 2 and 4 s; a beat every 0.5 s; 30 fps
  const frame = 1 / 30;

  it('keeps a frame clear of the neighbours’ other edges', () => {
    expect(cutRange(t, 0)).toBeNull();
    const range = cutRange(t, 2)!;
    expect(range.min).toBeCloseTo(1 + frame);
    expect(range.max).toBeCloseTo(4 - frame);
  });

  it('snaps a drag to a beat within a few pixels, else to the nearest frame; Option drags free', () => {
    expect(placeCut(t, 2, 2.49, 100)).toEqual({ seconds: 2.5, snap: 'beat', beat: 6 });
    const near = placeCut(t, 2, 2.3, 100)!;
    expect(near.snap).toBe('frame');
    expect(near.seconds).toBeCloseTo(Math.round(2.3 * 30) / 30);
    expect(placeCut(t, 2, 2.49, 100, true)!.snap).toBe('frame');
    expect(placeCut(t, 2, 9, 100)!.seconds).toBeCloseTo(4 - frame);
  });

  it('nudges by a frame, or to the next beat with Shift, inside its range', () => {
    expect(nudgeCut(t, 2, 2, 1, 'frame')!.seconds).toBeCloseTo(2 + frame);
    expect(nudgeCut(t, 2, 2, 1, 'beat')).toEqual({ seconds: 2.5, snap: 'beat', beat: 6 });
    expect(nudgeCut(t, 2, 2, -1, 'beat')).toEqual({ seconds: 1.5, snap: 'beat', beat: 4 });
    expect(nudgeCut(t, 2, 1 + frame, -1, 'frame')!.seconds).toBeCloseTo(1 + frame);
  });
});

describe('the review: every fix is a command on the version on screen', () => {
  const t = templateFixture();
  const at = { projectId: null, templateId: t.id, baseVersion: t.version };
  const slot = t.slots[2]!;

  it('names core’s §2 commands with their payloads', () => {
    const to = { value: 75, rate: { num: 30, den: 1 } };
    expect(reviewEditCommand(t, null, { kind: 'moveCut', slotId: slot.id, to, snap: 'beat' })).toEqual({
      name: 'template.slot.moveCut',
      payload: { ...at, slotId: slot.id, to, snap: 'beat' },
    });
    expect(reviewEditCommand(t, null, { kind: 'split', slotId: slot.id, at: to }).name).toBe(
      'template.slot.split',
    );
    expect(reviewEditCommand(t, null, { kind: 'describe', slotId: slot.id, text: 'Steam' }).payload).toEqual({
      ...at,
      slotId: slot.id,
      intent: { text: 'Steam' },
    });
    expect(reviewEditCommand(t, null, { kind: 'tempo', factor: 2 })).toEqual({
      name: 'template.setTempo',
      payload: { ...at, factor: 2 },
    });
    expect(
      reviewEditCommand(t, null, {
        kind: 'dismiss',
        target: { kind: 'template' },
        reason: 'soundCreditMissing',
      }),
    ).toEqual({
      name: 'template.doubt.dismiss',
      payload: { ...at, target: { kind: 'template' }, reason: 'soundCreditMissing' },
    });
  });

  it('“Not a cut” joins the slot to the one before it', () => {
    expect(reviewEditCommand(t, null, { kind: 'notCut', slotId: slot.id })).toEqual({
      name: 'template.slot.merge',
      payload: { ...at, slotIds: [t.slots[1]!.id, slot.id] },
    });
  });

  it('an accepted proposal is its command on the head after this session’s last fix', () => {
    const proposal = {
      id: 'p1',
      command: 'template.slot.setRole',
      payload: { slotId: slot.id, role: 'peak' },
      why: 'It is the loudest moment.',
    } as TemplateProposal;
    expect(reviewEditCommand(t, null, { kind: 'proposal', proposal }, 4)).toEqual({
      name: 'template.slot.setRole',
      payload: { slotId: slot.id, role: 'peak', projectId: null, templateId: t.id, baseVersion: 4 },
    });
  });
});

describe('the review: a proposal in words', () => {
  const t = templateFixture();
  const words = (command: string, payload: Record<string, unknown>) =>
    proposalWords(i18n, t, { id: 'p1', command, payload, why: '…' } as TemplateProposal);

  it('names the slot, and shows a description’s before and after as someone’s words', () => {
    expect(
      words('template.slot.editIntent', { slotId: t.slots[1]!.id, intent: { text: 'Steam rising' } }),
    ).toEqual({
      what: 'Slot 2’s description',
      before: { text: 'Steam over the pot', words: true },
      after: { text: 'Steam rising', words: true },
      unreadable: false,
    });
    expect(
      words('template.slot.moveCut', {
        slotId: t.slots[2]!.id,
        to: { value: 75, rate: { num: 30, den: 1 } },
      }),
    ).toMatchObject({
      what: 'The cut before slot 3',
      before: { text: '2s', words: false },
      after: { text: '2.5s', words: false },
    });
    expect(words('template.setTempo', { factor: 0.5 })).toMatchObject({
      what: 'Half as many beats',
      after: { text: '60 beats a minute' },
    });
  });

  it('knows a proposal whose slot or line has gone', () => {
    const proposal = (command: string, payload: Record<string, unknown>) =>
      ({ id: 'p1', command, payload, why: '…' }) as TemplateProposal;
    const edit = proposal('template.slot.editIntent', { slotId: t.slots[2]!.id, intent: { text: 'x' } });
    expect(proposalGone(t, edit)).toBe(false);
    const merged: Template = { ...t, slots: t.slots.filter((_, i) => i !== 2) };
    expect(proposalGone(merged, edit)).toBe(true);
    expect(proposalGone(t, proposal('template.text.remove', { overlayIds: ['nope'] }))).toBe(true);
    expect(proposalGone(t, proposal('template.setTempo', { factor: 2 }))).toBe(false);
  });

  it('can’t be accepted when the review can’t read it', () => {
    expect(words('template.slot.editIntent', { slotId: 'nope', intent: { text: 'x' } }).unreadable).toBe(
      true,
    );
    expect(words('template.delete', {}).unreadable).toBe(true);
  });
});
