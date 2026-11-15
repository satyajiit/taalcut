// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// KEEP1: a reel whose last two shots are the format's fixed part, in the breakdown review against the fake backend.
// Each slot says whose clip it plays; "Use my clip" and "Keep the reel's clip" make template.slot.setFootage, a new
// version each time; the last slot left for the person's clips can't be given to the reel. And the fake's seed: the
// template, and (when asked for) the video made from it, whose cast notes the reel's own shots.
import { callRpc, templateSchema, timelineSchema, type Template } from '@taalcut/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import {
  KEPT_REEL_ASSET,
  KEPT_REEL_CONVERSATION,
  KEPT_REEL_PROJECT,
  KEPT_REEL_TIMELINE,
} from '../src/backend/fake/make/p3/seeds/kept-reel';
import { seedProjects } from '../src/backend/fake/make/seed';
import { keptReelOptions } from '../src/backend/fake/options/kept-reel';
import { mergeSlots } from '../src/backend/fake/templates/template-edits';
import { buildTemplate, HOOK_TEST, templateIdOf } from '../src/backend/fake/templates/template-data';
import { setFootage } from '../src/backend/fake/templates/template-footage-edits';
import {
  KEPT_REEL,
  KEPT_REEL_REASONS,
  keptReelTemplate,
} from '../src/backend/fake/templates/template-kept-reel';
import { splitSlot } from '../src/backend/fake/templates/template-review-edits';
import { KEPT_REEL_CARDS, keptReelSeed } from '../src/chat/fake-seed-kept-reel';
import { renderApp } from './render-app';

const TEMPLATE = templateIdOf(KEPT_REEL);
const T0 = Date.UTC(2026, 10, 15);
const footageOf = (template: Template) => template.slots.map((slot) => slot.footage ?? null);
const status = () => document.querySelector('[data-slot=slot-footage-status]')?.textContent;
const reasonLine = () => document.querySelector('[data-slot=slot-footage-reason]')?.textContent ?? null;
const why = () => document.querySelector('[data-slot=slot-footage-why]')?.textContent ?? null;
const said = () => document.querySelector('[data-slot=review-said]')?.textContent ?? null;
const choice = (name: RegExp | string) => screen.getByRole('radio', { name });
const checked = (name: RegExp | string) => choice(name).getAttribute('aria-checked') === 'true';

const open = (slot: number) =>
  renderApp(`/templates/${TEMPLATE}/slots?slot=${slot}`, { phase2: { library: { tickMs: 0 } } });

describe('the fake’s kept-reel seed (KEEP1)', () => {
  it('is a valid reference template of three slots whose last two are the reel’s own, by the Analyst', () => {
    const template = keptReelTemplate();
    expect(templateSchema.safeParse(template).error?.issues ?? []).toEqual([]);
    expect(template.origin.kind).toBe('reference');
    expect(footageOf(template)).toEqual([
      null,
      { from: 'reel', by: 'analyst', reason: KEPT_REEL_REASONS[1] },
      { from: 'reel', by: 'analyst', reason: KEPT_REEL_REASONS[2] },
    ]);
  });

  it('is in the fake unlisted, keeping its reel', async () => {
    const { client } = createFakeBackend({ phase2: { library: { tickMs: 0 } } });
    const { summary, template } = await client.templates.get({ templateId: TEMPLATE });
    expect(summary).toMatchObject({ listed: false, head: 1 });
    expect(summary.media).not.toBeNull();
    expect(template.slots).toHaveLength(3);
  });

  it('its video is seeded only when asked for, with the reel’s own shots noted in the cast', () => {
    expect(keptReelOptions({})).toEqual({});
    expect(keptReelOptions({ keptReel: true })).toEqual({ make: { areas: { keptReel: true } } });
    const usual = seedProjects().projects;
    expect(usual.some((project) => project.id === KEPT_REEL_PROJECT)).toBe(false);
    const asked = seedProjects(undefined, { keptReel: true }).projects;
    expect(asked).toHaveLength(usual.length + 1);
    const project = asked.find((candidate) => candidate.id === KEPT_REEL_PROJECT);
    expect(project?.conversationId).toBe(KEPT_REEL_CONVERSATION);
    const timeline = project?.timelines[0];
    expect(timelineSchema.safeParse(timeline).error?.issues ?? []).toEqual([]);
    expect(timeline?.id).toBe(KEPT_REEL_TIMELINE);
    expect(timeline?.template).toEqual({ id: TEMPLATE, version: 1 });
    const slots = timeline?.cast?.slots ?? [];
    expect(slots.map((slot) => slot.note)).toEqual([null, 'reelKept', 'reelKept']);
    // A kept slot: the reel as its pick, nothing scored, no other shots; its clip is the reel, whole and muted.
    const template = keptReelTemplate();
    for (const index of [1, 2]) {
      const cast = slots[index]!;
      expect(cast).toMatchObject({ confidence: null, needsRerank: false, alternates: [] });
      expect(cast.pick).toMatchObject({ assetId: KEPT_REEL_ASSET, shotId: null });
      expect(cast.pick?.sourceStart).toEqual(template.slots[index]!.start);
      const clip = timeline?.tracks[0]?.items.find((item) => item.id === cast.clipId);
      expect(clip).toMatchObject({
        type: 'clip',
        media: { kind: 'video', assetId: KEPT_REEL_ASSET, shotId: null },
        sourceStart: template.slots[index]!.start,
        duration: template.slots[index]!.duration,
        fit: 'contain',
        reframe: null,
        locked: false,
        audio: { muted: true },
      });
    }
    expect(slots[0]!.pick?.assetId).not.toBe(KEPT_REEL_ASSET);
    expect(slots[0]!.confidence).not.toBeNull();
  });

  it('its chat holds the breakdown and the cast board for that video', () => {
    const seed = keptReelSeed();
    expect(seed.summary).toMatchObject({ id: KEPT_REEL_CONVERSATION, projectId: KEPT_REEL_PROJECT });
    expect(KEPT_REEL_CARDS.breakdown.template).toEqual({ id: TEMPLATE, version: 1 });
    expect(KEPT_REEL_CARDS.castBoard.timelineIds).toEqual([KEPT_REEL_TIMELINE]);
  });
});

describe('template.slot.setFootage in the fake (KEEP1)', () => {
  it('states the slot as the person’s, keeps Taalcut’s reason, and is a new version even when nothing changes', () => {
    const template = keptReelTemplate();
    const mine = setFootage(template, template.slots[1]!.id, 'person', T0);
    if (!mine.ok) throw new Error(mine.reason);
    expect(templateSchema.safeParse(mine.template).error?.issues ?? []).toEqual([]);
    expect(mine.template.version).toBe(2);
    expect(mine.template.slots[1]!.footage).toEqual({
      from: 'person',
      by: 'user',
      reason: KEPT_REEL_REASONS[1],
    });
    // Slot 1 states nothing (the person's): saying so is still a new version, now the person's statement.
    const same = setFootage(template, template.slots[0]!.id, 'person', T0);
    if (!same.ok) throw new Error(same.reason);
    expect(same.template.version).toBe(2);
    expect(same.template.slots[0]!.footage).toEqual({ from: 'person', by: 'user', reason: null });
  });

  it('refuses the reel on a template that was not made from one, and the last slot left for the person', () => {
    const format = buildTemplate(HOOK_TEST);
    expect(format.origin.kind).toBe('format');
    const noReel = setFootage(format, format.slots[0]!.id, 'reel', T0);
    expect(noReel.ok || noReel.error?.code).toBe('templates.no_reel');
    const template = keptReelTemplate();
    const last = setFootage(template, template.slots[0]!.id, 'reel', T0);
    expect(last.ok || last.error?.code).toBe('templates.no_person_slot');
    expect(setFootage(template, format.slots[0]!.id, 'person', T0).ok).toBe(false);
  });

  it('a split copies the statement to both halves; a merge takes it from the slot whose intent it takes', () => {
    const template = keptReelTemplate();
    const kept = template.slots[1]!;
    const split = splitSlot(
      template,
      kept.id,
      { value: kept.start.value + 30, rate: kept.start.rate },
      'frame',
      T0,
    );
    if (!split.ok) throw new Error(split.reason);
    expect(split.template.slots).toHaveLength(4);
    expect(split.template.slots[1]!.footage).toEqual(kept.footage);
    expect(split.template.slots[2]!.footage).toEqual(kept.footage);
    const [first, second] = template.slots;
    const asFirst = mergeSlots(template, [first!.id, second!.id], undefined, T0);
    if (!asFirst.ok) throw new Error(asFirst.reason);
    expect(asFirst.template.slots[0]!.footage).toBeUndefined();
    const asSecond = mergeSlots(template, [first!.id, second!.id], second!.id, T0);
    if (!asSecond.ok) throw new Error(asSecond.reason);
    expect(asSecond.template.slots[0]!.footage).toEqual(second!.footage);
    expect(templateSchema.safeParse(asSecond.template).error?.issues ?? []).toEqual([]);
  });
});

describe('the review’s footage choice, against the fake backend (KEEP1)', () => {
  it('flips a reel slot to “Use my clip” and back, each a new version, and says what it did', async () => {
    const { client } = await open(2);
    await waitFor(() => expect(status()).toBe('This shot is the reel’s own clip'));
    const panel = document.querySelector<HTMLElement>('[data-slot=slot-footage]')!;
    // Taalcut's reading, with its reason, and what follows from it.
    expect(within(panel).getByLabelText('Taalcut’s reading')).toBeTruthy();
    expect(reasonLine()).toBe(KEPT_REEL_REASONS[1]);
    expect(
      within(panel).getByText('A video made from this template keeps it. Your clips go in the other slots.'),
    ).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Whose clip plays in slot 2' })).toBeTruthy();
    expect(checked('Keep the reel’s clip')).toBe(true);
    expect(why()).toBeNull();

    fireEvent.click(choice('Use my clip'));
    await waitFor(() => expect(status()).toBe('Your clip goes here'));
    const second = await client.templates.get({ templateId: TEMPLATE });
    expect(second.summary.head).toBe(2);
    expect(footageOf(second.template)).toEqual([
      null,
      { from: 'person', by: 'user', reason: KEPT_REEL_REASONS[1] },
      { from: 'reel', by: 'analyst', reason: KEPT_REEL_REASONS[2] },
    ]);
    // The person reads: it is theirs now, by their say, and why Taalcut had read it as the reel's.
    expect(checked('Use my clip')).toBe(true);
    expect(
      within(document.querySelector<HTMLElement>('[data-slot=slot-footage]')!).getByText('You'),
    ).toBeTruthy();
    expect(reasonLine()).toBe(`Taalcut read this shot as the reel’s own clip: ${KEPT_REEL_REASONS[1]}`);
    await waitFor(() => expect(said()).toBe('Slot 2 uses your clip'));

    fireEvent.click(choice('Keep the reel’s clip'));
    await waitFor(() => expect(status()).toBe('This shot is the reel’s own clip'));
    const third = await client.templates.get({ templateId: TEMPLATE });
    expect(third.summary.head).toBe(3);
    expect(third.template.parentVersion).toBe(2);
    expect(third.template.slots[1]!.footage).toEqual({
      from: 'reel',
      by: 'user',
      reason: KEPT_REEL_REASONS[1],
    });
    expect(
      within(document.querySelector<HTMLElement>('[data-slot=slot-footage]')!).getByText('You'),
    ).toBeTruthy();
    await waitFor(() => expect(said()).toBe('Slot 2 keeps the reel’s clip'));
  });

  it('won’t give the reel the last slot left for the person’s clips, in the review or on the bus', async () => {
    const { client } = await open(1);
    await waitFor(() => expect(status()).toBe('Your clip goes here'));
    expect(why()).toBe('Your clips need at least one slot, so this one stays yours.');
    const off = choice(/^Keep the reel’s clip/);
    expect(off.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(off);
    const before = await client.templates.get({ templateId: TEMPLATE });
    expect(before.summary.head).toBe(1);
    // The command itself refuses, with core's code, and makes no version.
    const refused = await callRpc(
      client.commands.dispatch({
        name: 'template.slot.setFootage',
        payload: {
          projectId: null,
          templateId: TEMPLATE,
          baseVersion: 1,
          slotId: before.template.slots[0]!.id,
          from: 'reel',
        },
        source: 'ui',
      }),
    );
    expect(refused.ok || refused.error.code).toBe('templates.no_person_slot');
    expect((await client.templates.get({ templateId: TEMPLATE })).summary.head).toBe(1);
    // With slot 2 the person's, slot 1 can keep the reel's clip.
    const freed = await callRpc(
      client.commands.dispatch({
        name: 'template.slot.setFootage',
        payload: {
          projectId: null,
          templateId: TEMPLATE,
          baseVersion: 1,
          slotId: before.template.slots[1]!.id,
          from: 'person',
        },
        source: 'ui',
      }),
    );
    expect(freed.ok).toBe(true);
    await waitFor(() => expect(why()).toBeNull());
    expect(choice('Keep the reel’s clip').getAttribute('aria-disabled')).toBeNull();
  });

  it('marks the reel’s own slots in the strip', async () => {
    await open(1);
    const strip = await screen.findByRole('listbox', { name: 'Slots' });
    const names = within(strip)
      .getAllByRole('option')
      .map((el) => el.getAttribute('aria-label') ?? '');
    expect(names.map((name) => name.includes('The reel’s own clip'))).toEqual([false, true, true]);
  });
});
