// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1 through the Analyst's tools, on a real (synthetic) reel: templates.setIntents takes the statement that a
 * slot is the reel's own footage, templates.finalise stores it on the template's slots and keeps the reel, and
 * templates.get says it. A statement the reel can't back (nothing kept on this Mac) is stored as the person's slot
 * and said so; a statement with no reason is refused by the schema; every slot stated is refused at finalise.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TemplateId } from '@taalcut/core';
import type { z } from 'zod';
import type { resolveCutsOutputSchema } from '../../src/tools/schemas';
import { runProcess, SYNTHETIC_REELS, syntheticReelArgs } from '../../src/test-support';
import { fakeYtDlp } from '../helpers/fake-fetcher';
import { findFfmpeg } from '../helpers/ffmpeg';
import type { BreakdownStart } from '../helpers/finalise-flow';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';

const { bins } = findFfmpeg('keep1 analyst statement');
const work = mkdtempSync(join(tmpdir(), 'taalcut-keep1-'));
const reel = join(work, 'hard-cuts.mp4');
const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
const REASON = 'A film scene the joke lands on';
let setup: ToolSetup | undefined;

type Page = z.output<typeof resolveCutsOutputSchema>;
interface Stored {
  readonly written: number;
  readonly note?: string;
  readonly reelSlots?: number[];
}

beforeAll(async () => {
  if (!bins) return;
  const made = await runProcess(bins.ffmpeg, syntheticReelArgs(SYNTHETIC_REELS[0]!, reel));
  if (!made.ok) throw new Error(made.error.detail);
});
afterEach(() => setup?.cleanup());
afterAll(() => rmSync(work, { recursive: true, force: true }));

const intent = (index: number) => ({
  text: `shot ${index}`,
  shotType: 'medium',
  motion: 'static',
  subject: null,
  people: 0,
  place: null,
  energy: 0.5,
});

/** Breaks the reel down and writes every slot, those `isReel` names as the reel's own footage. */
async function written(tools: ToolSetup, isReel: (index: number) => boolean) {
  const fetched = await tools.value<{ experimentId: string }>('templates.fetchReference', {
    projectId: tools.projectA,
    url: SHORT,
  });
  const breakdown = await tools.value<BreakdownStart>('templates.breakdown', {
    projectId: tools.projectA,
    experimentId: fetched.experimentId,
  });
  const { breakdownId } = breakdown;
  for (let next = breakdown.next; next !== null;)
    next = (
      await tools.value<{ next: BreakdownStart['next'] }>('templates.judgeCut', {
        breakdownId,
        at: next.at,
        cut: next.ruleKeeps,
      })
    ).next;
  const answers: Stored[] = [];
  const resolve = () => tools.value<Page>('templates.resolveCuts', { breakdownId });
  for (let page = await resolve(); page.slots.length > 0; page = await resolve())
    answers.push(
      await tools.value<Stored>('templates.setIntents', {
        breakdownId,
        intents: page.slots.map((slot) => ({
          slotIndex: slot.index,
          intent: intent(slot.index),
          ...(isReel(slot.index) ? { footage: { from: 'reel', reason: REASON } } : {}),
        })),
      }),
    );
  return { breakdownId, answers, last: answers.at(-1)! };
}

describe.skipIf(!bins)('the Analyst states a slot as the reel’s own footage (KEEP1)', () => {
  it('stores the statement on the slots, keeps the reel, and says it in every answer', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const { breakdownId, last } = await written(setup, (index) => index === 1 || index === 2);
    expect(last.reelSlots).toEqual([1, 2]);
    expect(last.note ?? '').not.toContain("can't keep");
    const done = await setup.value<{ templateId: string; slotCount: number; reelSlots?: number[] }>(
      'templates.finalise',
      { projectId: setup.projectA, breakdownId, name: 'Film reel' },
    );
    expect(done.reelSlots).toEqual([1, 2]);
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    const { slots } = stored.value.template;
    expect(slots.length).toBe(done.slotCount);
    expect(slots.map((slot) => slot.footage ?? null)).toEqual(
      slots.map((_, index) =>
        index === 1 || index === 2 ? { from: 'reel', by: 'analyst', reason: REASON } : null,
      ),
    );
    // The reel those slots are cut from is the template's kept media.
    const kept = await setup.media.get(done.templateId as TemplateId);
    expect(kept.ok && kept.value?.media.file).toBe('reference.mp4');
    const read = await setup.value<{ slots: { index: number; keepsReel?: true }[] }>('templates.get', {
      templateId: done.templateId,
    });
    expect(read.slots.filter((slot) => slot.keepsReel).map((slot) => slot.index)).toEqual([1, 2]);
  });

  it('a template with nothing stated is the template it always was', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const { breakdownId, answers } = await written(setup, () => false);
    expect(answers.every((answer) => answer.reelSlots === undefined)).toBe(true);
    const done = await setup.value<{ templateId: string; reelSlots?: number[] }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Plain reel',
    });
    expect(done).not.toHaveProperty('reelSlots');
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    expect(stored.value.template.slots.every((slot) => !('footage' in slot))).toBe(true);
  });

  it('stores the slot as the person’s, and says so, when the reel can’t be kept', async () => {
    // No template media store in this process: finalise will have nowhere to keep the reel.
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }), media: false });
    const { breakdownId, answers, last } = await written(setup, (index) => index === 1);
    expect(last.reelSlots).toBeUndefined();
    const told = answers.map((answer) => answer.note ?? '').join(' ');
    expect(told).toContain("Slots 1 can't keep the reel's own footage");
    expect(told).toContain("stored as slots for the user's clips");
    const done = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'No media',
    });
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    expect(stored.value.template.slots.every((slot) => slot.footage === undefined)).toBe(true);
  });

  it('refuses a template whose every slot is the reel’s own, until one is the person’s again', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const { breakdownId, last } = await written(setup, () => true);
    expect(last.note).toContain("Every slot is stored as the reel's own footage");
    const refused = await setup.call('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'All film',
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('core.validation');
    expect(refused.error.detail).toContain('with nothing of the user');
    // The mend the refusal names: the slot the person's clips go in, sent again.
    const mended = await setup.value<Stored>('templates.setIntents', {
      breakdownId,
      intents: [{ slotIndex: 0, intent: intent(0), footage: { from: 'person' } }],
    });
    expect(mended.reelSlots).not.toContain(0);
    const done = await setup.value<{ reelSlots?: number[] }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'All film',
    });
    expect(done.reelSlots?.includes(0)).toBe(false);
    expect(done.reelSlots!.length).toBeGreaterThan(0);
  });

  it('refuses a statement with no reason, and cuts a long reason at a word', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reel, { exitCode: 101 }) });
    const { breakdownId } = await written(setup, () => false);
    const bare = await setup.call('templates.setIntents', {
      breakdownId,
      intents: [{ slotIndex: 1, intent: intent(1), footage: { from: 'reel' } }],
    });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error.detail).toContain('footage.reason');
    const long = `${'A film scene the joke lands on and that every video in this format keeps '.repeat(3)}end`;
    const stated = await setup.value<Stored>('templates.setIntents', {
      breakdownId,
      intents: [{ slotIndex: 1, intent: intent(1), footage: { from: 'reel', reason: long } }],
    });
    expect(stated.reelSlots).toEqual([1]);
    const done = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Long reason',
    });
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    const reason = stored.value.template.slots[1]!.footage!.reason!;
    expect(reason.length).toBeLessThanOrEqual(160);
    expect(long.startsWith(reason)).toBe(true);
    expect(long[reason.length]).toBe(' ');
  });
});
