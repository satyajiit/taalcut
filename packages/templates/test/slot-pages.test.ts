// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writing the slots a page at a time (LRN1-CTX, SPEC "Writing the slots a page at a time"): templates.judgeCut stores
 * a verdict and hands out the next disputed cut; templates.resolveCuts hands out the next slots without an intent,
 * one frame each, as many as the model's window holds; templates.setIntents stores a page's intents; both savers
 * save progress; templates.finalise reads it all and refuses while a slot has no intent.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { TemplateId } from '@taalcut/core';
import { BREAKDOWN_FILE, type BreakdownDraft } from '../src/index';
import { judging, JUDGED_DISPUTES } from '../src/breakdown/slot-context-disputes';
import { slotPageFor } from '../src/breakdown/slot-context-pages';
import type {
  judgeCutOutputSchema,
  resolveCutsOutputSchema,
  setIntentsOutputSchema,
} from '../src/tools/schemas';
import { longDraft } from './helpers/context-draft';
import { draftFixture } from './helpers/draft';
import { setupTools, type ToolSetup } from './helpers/tool-setup';

let setup: ToolSetup | undefined;
afterEach(() => setup?.cleanup());

type Page = z.output<typeof resolveCutsOutputSchema>;
type Written = z.output<typeof setIntentsOutputSchema>;
type Judging = z.output<typeof judgeCutOutputSchema>;

/** The scratch templates.breakdown leaves: the draft under its experiment's id. */
async function scratchWith(s: ToolSetup, draft: BreakdownDraft) {
  const id = s.deps.ids.experiment();
  const scratch = await s.sandbox.open({ id, projectId: s.projectA, purpose: 'breakdown' });
  if (!scratch.ok) throw new Error(scratch.error.code);
  writeFileSync(join(scratch.value.dir, BREAKDOWN_FILE), JSON.stringify({ ...draft, breakdownId: id }));
  return { breakdownId: id, dir: scratch.value.dir };
}

const intent = (slotIndex: number) => ({
  slotIndex,
  intent: {
    text: `shot ${slotIndex}, mid shot`,
    shotType: 'medium',
    motion: 'static',
    subject: null,
    people: 1,
    place: null,
    energy: 0.5,
  },
});

const reel = (slots = 12) => longDraft({ slots, tracks: 1, chars: 20, words: 3 });

/** Every page resolveCuts hands out until each slot has an intent, writing each one. */
async function pagesOf(s: ToolSetup, breakdownId: string, total: number): Promise<number[][]> {
  const seen: number[][] = [];
  for (;;) {
    const page = await s.value<Page>('templates.resolveCuts', { breakdownId });
    expect(page.total).toBe(total);
    if (page.slots.length === 0) {
      expect(page.written).toBe(total);
      return seen;
    }
    seen.push(page.slots.map((slot) => slot.index));
    // One frame per slot, the middle one, as a path the vision tool can open.
    expect(page.slots.every((slot) => slot.frame?.endsWith(`${slot.index * 30 + 15}.jpg`))).toBe(true);
    const written = await s.value<Written>('templates.setIntents', {
      breakdownId,
      intents: page.slots.map((slot) => intent(slot.index)),
    });
    expect(written).toEqual({ written: page.written + page.slots.length, total });
  }
}

describe('templates.resolveCuts, a page at a time', () => {
  it('hands out the slots without an intent, as many as the window holds, until every slot has one', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, reel());
    const seen = await pagesOf(setup, breakdownId, 12);
    expect(seen.flat()).toEqual(Array.from({ length: 12 }, (_, index) => index));
    // An unknown window is taken as the smallest local one.
    expect(seen.map((page) => page.length)).toEqual(
      seen.map((_, index) => Math.min(slotPageFor(undefined), 12 - index * slotPageFor(undefined))),
    );
  });

  it('makes the pages larger for a larger window', async () => {
    setup = setupTools({ contextWindow: 32_768 });
    const { breakdownId } = await scratchWith(setup, reel(30));
    const seen = await pagesOf(setup, breakdownId, 30);
    expect(slotPageFor(32_768)).toBeGreaterThan(slotPageFor(8_192));
    expect(seen[0]).toHaveLength(slotPageFor(32_768));
  });

  it('keeps the verdicts, and hands a slot out again when a new verdict moves its cut', async () => {
    // A window whose page holds every slot of the fixture, so the open slots show on one page.
    setup = setupTools({ contextWindow: 32_768 });
    const { breakdownId } = await scratchWith(setup, draftFixture());
    // The rule keeps 45 and drops 70: four slots.
    const first = await setup.value<Page>('templates.resolveCuts', { breakdownId });
    expect(first.total).toBe(4);
    await setup.value('templates.setIntents', { breakdownId, intents: [0, 1, 2, 3].map(intent) });
    // A cut at 70 splits the slot 45–90: its intent no longer applies, the other three keep theirs.
    await setup.value('templates.judgeCut', { breakdownId, at: 70, cut: true });
    const split = await setup.value<Page>('templates.resolveCuts', { breakdownId });
    expect(split).toMatchObject({ total: 5, written: 3 });
    expect(split.slots.map((slot) => slot.index)).toEqual([2, 3]);
  });

  it('gives each slot a frame inside it, when a verdict moves a cut', async () => {
    // A window that holds the whole reel on one page.
    setup = setupTools({ contextWindow: 32_768 });
    const base = draftFixture();
    const draft = {
      ...base,
      slotFrames: base.slotFrames.map((slot) =>
        slot.start === 45
          ? {
              ...slot,
              frames: ['frames/frame-000045.jpg', 'frames/frame-000067.jpg', 'frames/frame-000089.jpg'],
            }
          : slot,
      ),
    };
    const frames = async (verdicts: { at: number; cut: boolean }[]) => {
      const s = setup ?? setupTools();
      const { breakdownId } = await scratchWith(s, draft);
      for (const verdict of verdicts) await s.value('templates.judgeCut', { breakdownId, ...verdict });
      const page = await s.value<Page>('templates.resolveCuts', { breakdownId });
      return page.slots.map((slot) => slot.frame?.split('/').at(-1) ?? null);
    };
    // A cut at 70 splits 45–90: 45–70 gets the first frame of 45–90, 70–90 the dispute's frame after the cut.
    expect(await frames([{ at: 70, cut: true }])).toEqual([
      'frame-000014.jpg',
      'frame-000030.jpg',
      'frame-000045.jpg',
      'frame-000070.jpg',
      'frame-000104.jpg',
    ]);
    // No cut at 45 merges 30–45 into 30–90: the middle frame of 30–45 is inside it.
    expect(await frames([{ at: 45, cut: false }])).toEqual([
      'frame-000014.jpg',
      'frame-000030.jpg',
      'frame-000104.jpg',
    ]);
  });
});

describe('templates.judgeCut', () => {
  it('stores each verdict and hands out the next disputed cut, nearest the start first', async () => {
    setup = setupTools();
    const { breakdownId, dir } = await scratchWith(setup, draftFixture());
    const first = await setup.value<Judging>('templates.judgeCut', { breakdownId, at: 45, cut: false });
    expect(first).toMatchObject({ judged: 1, toJudge: 2, next: { at: 70, method: 'embedding' } });
    expect(first.next?.after).toBe(join(dir, 'frames/frame-000070.jpg'));
    // Judging a cut again replaces its verdict.
    await setup.value('templates.judgeCut', { breakdownId, at: 45, cut: true });
    const last = await setup.value<Judging>('templates.judgeCut', { breakdownId, at: 70, cut: true });
    expect(last).toEqual({ judged: 2, toJudge: 2, next: null });
    // 45 and 70 are both cuts now: five slots.
    expect((await setup.value<Page>('templates.resolveCuts', { breakdownId })).total).toBe(5);
  });

  it('refuses a frame that is not a disputed cut, and names the next to judge', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const refused = await setup.call('templates.judgeCut', { breakdownId, at: 30, cut: true });
    expect(refused.ok || refused.error.code).toBe('core.validation');
    expect(refused.ok || refused.error.detail).toContain('the next to judge is at frame 45');
  });

  it(`judges the ${JUDGED_DISPUTES} nearest the start and leaves the rest to the rule`, () => {
    const base = draftFixture();
    const [dispute] = base.disputes;
    if (!dispute) throw new Error('the fixture has a dispute');
    const many = {
      ...base,
      disputes: Array.from({ length: 25 }, (_, i) => ({ ...dispute, frame: 100 - i })),
    };
    expect(judging(many, [], '/x')).toMatchObject({ judged: 0, toJudge: JUDGED_DISPUTES, next: { at: 76 } });
    const verdicts = Array.from({ length: JUDGED_DISPUTES }, (_, i) => ({ at: 76 + i, cut: true }));
    expect(judging(many, verdicts, '/x')).toEqual({
      judged: JUDGED_DISPUTES,
      toJudge: JUDGED_DISPUTES,
      next: null,
    });
  });
});

describe('templates.setIntents', () => {
  it('saves progress, as templates.judgeCut does', () => {
    setup = setupTools();
    expect(setup.tool('templates.setIntents').savesProgress).toBe(true);
    expect(setup.tool('templates.judgeCut').savesProgress).toBe(true);
    expect(setup.tool('templates.resolveCuts').savesProgress).toBeUndefined();
  });

  it('leaves out a slot the breakdown does not have, with a note, and refuses a page of only those (AGT1)', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const stored = await setup.value<{ written: number; note?: string }>('templates.setIntents', {
      breakdownId,
      intents: [intent(0), intent(9)],
    });
    expect(stored.written).toBe(1);
    expect(stored.note).toContain('No slot 9: this breakdown has slots 0 to 3. Those were left out');
    const refused = await setup.call('templates.setIntents', { breakdownId, intents: [intent(9)] });
    expect(refused.ok || refused.error.code).toBe('templates.slot_not_found');
    expect(refused.ok || refused.error.detail).toContain('Nothing was stored');
    const page = await setup.value<Page>('templates.resolveCuts', { breakdownId });
    expect(page.written).toBe(1);
  });

  it('stores slots that read the same and asks for them again (AGT1 y1)', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, draftFixture());
    const same = (slotIndex: number) => ({
      ...intent(slotIndex),
      intent: { ...intent(slotIndex).intent, text: 'A person walks under a gate, mid shot.' },
    });
    const stored = await setup.value<{ written: number; note?: string }>('templates.setIntents', {
      breakdownId,
      intents: [same(0), intent(1), same(2)],
    });
    expect(stored.written).toBe(3);
    expect(stored.note).toContain('These read the same, word for word: slots 0, 2.');
    const apart = await setup.value<{ note?: string }>('templates.setIntents', {
      breakdownId,
      intents: [intent(2)],
    });
    expect(apart.note).toBeUndefined();
  });

  it('keeps every intent of two calls made at once', async () => {
    const s = setupTools();
    setup = s;
    const { breakdownId } = await scratchWith(s, reel());
    await Promise.all(
      [0, 1, 2, 3].map((slot) => s.value('templates.setIntents', { breakdownId, intents: [intent(slot)] })),
    );
    const page = await s.value<Page>('templates.resolveCuts', { breakdownId });
    expect(page.written).toBe(4);
    expect(page.slots[0]?.index).toBe(4);
  });

  it('takes only a shot type and camera motion it can keep', async () => {
    setup = setupTools();
    const { breakdownId } = await scratchWith(setup, reel());
    const open = intent(0);
    const refused = await setup.call('templates.setIntents', {
      breakdownId,
      intents: [{ ...open, intent: { ...open.intent, shotType: null } }],
    });
    expect(refused.ok || refused.error.code).toBe('core.validation');
  });
});

describe('templates.finalise from the stored progress', () => {
  it('refuses while a slot has no intent, and keeps the reference', async () => {
    setup = setupTools();
    const { breakdownId, dir } = await scratchWith(setup, draftFixture());
    await setup.value('templates.setIntents', { breakdownId, intents: [0, 1, 3].map(intent) });
    const refused = await setup.call('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Day in Goa',
    });
    expect(refused.ok || refused.error.code).toBe('core.validation');
    expect(refused.ok || refused.error.detail).toContain('1 of 4 slots have no intent yet (first: slot 2)');
    expect(existsSync(dir)).toBe(true);
  });

  it('saves the stored verdicts and intents as version 1', async () => {
    setup = setupTools();
    const { breakdownId, dir } = await scratchWith(setup, draftFixture());
    await setup.value('templates.judgeCut', { breakdownId, at: 45, cut: false });
    await setup.value('templates.setIntents', { breakdownId, intents: [0, 1, 2].map(intent) });
    const saved = await setup.value<{ templateId: string; slotCount: number; unconfirmedCuts: number[] }>(
      'templates.finalise',
      { projectId: setup.projectA, breakdownId, name: 'Day in Goa' },
    );
    expect(saved).toMatchObject({ slotCount: 3, unconfirmedCuts: [] });
    const stored = await setup.service.get({ templateId: saved.templateId as TemplateId });
    expect(
      stored.ok && stored.value.template.slots.map((slot) => [slot.intent.text, slot.intent.source]),
    ).toEqual([0, 1, 2].map((slot) => [`shot ${slot}, mid shot`, 'analyst']));
    expect(existsSync(dir)).toBe(false);
  });
});
