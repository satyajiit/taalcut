// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 through the Analyst's tools, on a reel of two moving pictures joined by a dissolve
 * (testing/moving-reel.ts). The slot page says how each slot starts and ends in the reel (`startsIn`, `endsIn`);
 * templates.setIntents takes a moment that must land on a slot's edge (`lands`) and lists it in its answer;
 * templates.finalise stores it on the slot, beside the transition the breakdown found from pixels; templates.get
 * says both. A reel of hard cuts has none of it.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SLOT_MOMENT_CHARS, type TemplateId } from '@taalcut/core';
import type { z } from 'zod';
import type { resolveCutsOutputSchema } from '../../src/tools/schemas';
import { MOVING_REEL, movingReelArgs, runProcess } from '../../src/test-support';
import { fakeYtDlp } from '../helpers/fake-fetcher';
import { findFfmpeg } from '../helpers/ffmpeg';
import type { BreakdownStart } from '../helpers/finalise-flow';
import { setupTools, type ToolSetup } from '../helpers/tool-setup';

const { bins } = findFfmpeg('match1 analyst lands');
const work = mkdtempSync(join(tmpdir(), 'taalcut-match1-lands-'));
const reels = { dissolve: join(work, 'dissolve.mp4'), cut: join(work, 'cut.mp4') };
const SHORT = 'https://www.youtube.com/shorts/abcDEF12345';
const MOMENT = 'The door swings shut';
let setup: ToolSetup | undefined;

type Page = z.output<typeof resolveCutsOutputSchema>;
type Lands = { edge: 'start' | 'end'; moment: string };
interface Stored {
  readonly written: number;
  readonly landSlots?: number[];
}

beforeAll(async () => {
  if (!bins) return;
  for (const kind of ['dissolve', 'cut'] as const) {
    const made = await runProcess(bins.ffmpeg, movingReelArgs(kind, reels[kind]));
    if (!made.ok) throw new Error(made.error.detail);
  }
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

/** Breaks the reel down and writes every slot, with the moment `lands` gives for it. */
async function written(tools: ToolSetup, lands: (index: number) => Lands | undefined) {
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
  const pages: Page[] = [];
  const answers: Stored[] = [];
  const resolve = () => tools.value<Page>('templates.resolveCuts', { breakdownId });
  for (let page = await resolve(); page.slots.length > 0; page = await resolve()) {
    pages.push(page);
    answers.push(
      await tools.value<Stored>('templates.setIntents', {
        breakdownId,
        intents: page.slots.map((slot) => ({
          slotIndex: slot.index,
          intent: intent(slot.index),
          ...(lands(slot.index) ? { lands: lands(slot.index) } : {}),
        })),
      }),
    );
  }
  const slots = pages.flatMap((page) => page.slots);
  return { breakdownId, slots, last: answers.at(-1)! };
}

describe.skipIf(!bins)('the Analyst states a moment that lands on a slot’s edge (MATCH1)', () => {
  it('the page says how each slot starts and ends; the statement is stored on the slot and read back', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reels.dissolve, { exitCode: 101 }) });
    const { breakdownId, slots, last } = await written(setup, (index) =>
      index === 0 ? { edge: 'end', moment: MOMENT } : undefined,
    );
    // Two slots, the cut inside the dissolve; each slot's page says the dissolve is at that edge of it.
    expect(slots.map((slot) => [slot.context.startsIn ?? null, slot.context.endsIn ?? null])).toEqual([
      [null, 'dissolve'],
      ['dissolve', null],
    ]);
    expect(last.landSlots).toEqual([0]);

    const done = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Match dissolve',
    });
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    const [first, second] = stored.value.template.slots;
    expect(first!.lands).toEqual({ edge: 'end', moment: MOMENT });
    expect(second).not.toHaveProperty('lands');
    // The transition the breakdown found from pixels: the slot starts inside it, with the blended frames either side.
    const { dissolve } = MOVING_REEL;
    expect(second!.transitionIn?.kind).toBe('dissolve');
    const start = second!.start.value;
    expect(start).toBeGreaterThan(dissolve.start);
    expect(start).toBeLessThanOrEqual(dissolve.end);
    expect(start - second!.transitionIn!.before.value).toBeLessThanOrEqual(dissolve.start);
    expect(start + second!.transitionIn!.after.value).toBeGreaterThan(dissolve.end);

    const read = await setup.value<{ slots: { index: number; transitionIn?: string; lands?: Lands }[] }>(
      'templates.get',
      { templateId: done.templateId },
    );
    expect(read.slots.map((slot) => [slot.transitionIn ?? null, slot.lands ?? null])).toEqual([
      [null, { edge: 'end', moment: MOMENT }],
      ['dissolve', null],
    ]);
  });

  it('a long moment is cut at a word, never refused; one with no words or no edge is refused by the schema', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reels.dissolve, { exitCode: 101 }) });
    const long = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
    const { breakdownId, last } = await written(setup, (index) =>
      index === 1 ? { edge: 'start', moment: long } : undefined,
    );
    expect(last.landSlots).toEqual([1]);
    const done = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Long moment',
    });
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    const moment = stored.value.template.slots[1]!.lands!.moment;
    expect(moment.length).toBeLessThanOrEqual(SLOT_MOMENT_CHARS);
    expect(long.startsWith(moment)).toBe(true);
    expect(long[moment.length]).toBe(' ');

    const input = setup.tool('templates.setIntents').input;
    const entry = (lands: unknown) => ({
      breakdownId,
      intents: [{ slotIndex: 0, intent: intent(0), lands }],
    });
    expect(input.safeParse(entry({ edge: 'end', moment: MOMENT })).success).toBe(true);
    for (const bad of [{ edge: 'end' }, { edge: 'end', moment: '  ' }, { edge: 'middle', moment: MOMENT }])
      expect(input.safeParse(entry(bad)).success, JSON.stringify(bad)).toBe(false);
  });

  it('a reel of hard cuts has no transition on its pages and nothing about moments in its answers', async () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reels.cut, { exitCode: 101 }) });
    const { breakdownId, slots, last } = await written(setup, () => undefined);
    expect(slots.length).toBe(2);
    for (const slot of slots) {
      expect(slot.context).not.toHaveProperty('startsIn');
      expect(slot.context).not.toHaveProperty('endsIn');
    }
    expect(last).not.toHaveProperty('landSlots');
    const done = await setup.value<{ templateId: string }>('templates.finalise', {
      projectId: setup.projectA,
      breakdownId,
      name: 'Hard cut',
    });
    const stored = await setup.service.get({ templateId: done.templateId as TemplateId });
    if (!stored.ok) throw new Error(stored.error.code);
    expect(
      stored.value.template.slots.every((slot) => !('lands' in slot) && slot.transitionIn === null),
    ).toBe(true);
  });

  it('the tools’ versions', () => {
    setup = setupTools({ bins: bins!, run: fakeYtDlp(reels.cut, { exitCode: 101 }) });
    const versions = Object.fromEntries(
      [
        'templates.breakdown',
        'templates.judgeCut',
        'templates.resolveCuts',
        'templates.setIntents',
        'templates.get',
      ].map((name) => [name, setup!.tool(name).version]),
    );
    expect(versions).toEqual({
      'templates.breakdown': '3.2.0',
      'templates.judgeCut': '1.1.0',
      'templates.resolveCuts': '3.1.0',
      'templates.setIntents': '1.5.0',
      'templates.get': '1.3.0',
    });
  });
});
