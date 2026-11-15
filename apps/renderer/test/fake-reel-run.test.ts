// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// FIX-DOCKCHAT: the reel-run fixture the editor's chat is checked against (e2e/fix-dockchat-cards.spec.ts): a
// project whose video has 32 cast slots in the shape a real run left, and two hidden chats for it (the run's four
// cards; every card the kit has). Seeded only when `taalcut.fake` asks, so the other fakes keep their numbers.
import { chatHistoryEventSchema, timelineSchema } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import {
  EVERY_CARD_CONVERSATION,
  REEL_RUN_CONVERSATION,
  REEL_RUN_PROJECT,
} from '../src/backend/fake/make/p3/seeds/reel-run';
import { seedRenders } from '../src/backend/fake/make/render-seed';
import { seedProjects } from '../src/backend/fake/make/seed';
import { reelRunOptions } from '../src/backend/fake/options/reel-run';
import { REEL_RUN_SLOTS } from '../src/backend/fake/templates/reel-run-slots';
import { everyCardSeed } from '../src/chat/fake-seed-every-card';
import { reelRunSeed } from '../src/chat/fake-seed-reel-run';

const cardsOf = (history: ReturnType<typeof reelRunSeed>['history']) =>
  history.flatMap((event) => (event.type === 'agent.card' ? [event.payload.card] : []));

describe('the reel-run fixture', () => {
  it('is seeded only when asked for', () => {
    expect(reelRunOptions({})).toEqual({});
    expect(reelRunOptions({ reelRun: 'yes' })).toEqual({});
    expect(reelRunOptions({ reelRun: true })).toEqual({ make: { areas: { reelRun: true } } });
    const usual = seedProjects().projects;
    expect(usual.some((project) => project.id === REEL_RUN_PROJECT)).toBe(false);
    const asked = seedProjects(undefined, { reelRun: true }).projects;
    expect(asked).toHaveLength(usual.length + 1);
  });

  it('has one video of 32 slots, cast as the run left it', () => {
    const project = seedProjects(undefined, { reelRun: true }).projects.find(
      (candidate) => candidate.id === REEL_RUN_PROJECT,
    );
    expect(project?.conversationId).toBe(REEL_RUN_CONVERSATION);
    const timeline = project?.timelines[0];
    expect(timelineSchema.safeParse(timeline).error?.issues ?? []).toEqual([]);
    const slots = timeline?.cast?.slots ?? [];
    expect(slots).toHaveLength(32);
    expect(slots.map((slot) => slot.alternates.length)).toEqual(
      REEL_RUN_SLOTS.map((slot) => slot.alternates),
    );
    expect(slots.map((slot) => slot.note)).toEqual(REEL_RUN_SLOTS.map((slot) => slot.note));
    // What the board has to lay out: a sentence a slot, long enough to wrap in a narrow column.
    expect(REEL_RUN_SLOTS.every((slot) => slot.text.length >= 80)).toBe(true);
  });

  it('has the export to look at and the one that failed', () => {
    const { projects } = seedProjects(undefined, { reelRun: true });
    const statuses = seedRenders(projects)
      .renders.filter((render) => render.snapshot.projectId === REEL_RUN_PROJECT)
      .map((render) => render.snapshot.status);
    expect(statuses.sort()).toEqual(['failed', 'needsAttention']);
    // Without the project, the usual exports and no more.
    expect(seedRenders(seedProjects().projects).renders).toHaveLength(
      seedRenders(projects).renders.length - 2,
    );
  });

  it('opens on the chat with every card when asked for that one', () => {
    const project = seedProjects(undefined, { reelRun: 'everyCard' }).projects.find(
      (candidate) => candidate.id === REEL_RUN_PROJECT,
    );
    expect(project?.conversationId).toBe(EVERY_CARD_CONVERSATION);
  });

  it('the run’s chat holds its four cards, as valid history', () => {
    const seed = reelRunSeed();
    expect(seed.summary).toMatchObject({ id: REEL_RUN_CONVERSATION, projectId: REEL_RUN_PROJECT });
    for (const event of seed.history)
      expect(chatHistoryEventSchema.safeParse(event).error?.issues ?? []).toEqual([]);
    expect(cardsOf(seed.history).map((card) => card.type)).toEqual([
      'breakdown',
      'castBoard',
      'renderProgress',
      'renderProgress',
    ]);
  });

  it('the other chat holds every card the kit has, as valid history', () => {
    const seed = everyCardSeed();
    expect(seed.summary).toMatchObject({ id: EVERY_CARD_CONVERSATION, projectId: REEL_RUN_PROJECT });
    for (const event of seed.history)
      expect(chatHistoryEventSchema.safeParse(event).error?.issues ?? []).toEqual([]);
    const cards = cardsOf(seed.history);
    expect(new Set(cards.map((card) => card.type))).toEqual(new Set(Object.keys(CARD_FIXTURES)));
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length);
  });
});
