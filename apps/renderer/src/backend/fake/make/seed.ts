// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- project names, captions and on-screen text: data, never translated */

/**
 * The Make fakes' projects: Golden hour market (the Golden hour template's
 * 12 slots at 120 BPM, cast three ways), Trip to Goa reel (30 s, cast in
 * story order; the recovery fake names it), Monsoon in 60 seconds (the 60 s
 * playback benchmark), Product teaser (nothing cut yet) and an archived
 * Diwali reel. Same documents on every run.
 */
import type { SlotId, TimelineId } from '@taalcut/core';
import { FIXTURE_NOW } from '../library/assets';
import { fakeUlid, prng } from '../library/seed';
import { buildTemplate, GOLDEN_HOUR } from '../templates/template-data';
import { buildTimeline, steadyBeats, type SlotSpec, type TimelinePlan } from './build';
import {
  DIWALI_PROJECT,
  DIWALI_TIMELINE,
  GOLDEN_CAST,
  GOLDEN_PROJECT,
  GOLDEN_TIMELINES,
  LONG_PROJECT,
  LONG_TIMELINE,
  MAKE_KIND,
  TEASER_PROJECT,
  TRIP_PROJECT,
  TRIP_TIMELINE,
} from './ids';
import { seedPhase3 } from './p3/seeds';
import type { SeededProject } from './seeded-project';
import { shotPool, type PoolShot } from './shot-pool';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type { SeededProject } from './seeded-project';

/** Slots in beats, cut on a steady 120 BPM grid (15 frames a beat at 30 fps). */
function storySlots(beats: readonly number[], n: number): SlotSpec[] {
  let beat = 0;
  return beats.map((length, index) => {
    const slot = {
      slotId: fakeUlid<'TemplateSlot'>(29, n * 100 + index) as SlotId,
      frames: length * 15,
      beatIndex: beat,
    };
    beat += length;
    return slot;
  });
}

/** Beat lengths summing to `total`, mostly 2 and 3 with the odd 4, from a seed. */
function beatLengths(total: number, seed: number): number[] {
  const random = prng(seed);
  const lengths: number[] = [];
  let left = total;
  while (left > 0) {
    const roll = random();
    const length = Math.min(left, roll < 0.5 ? 2 : roll < 0.85 ? 3 : 4);
    lengths.push(left - length === 1 ? length + 1 : length);
    left -= lengths[lengths.length - 1]!;
  }
  return lengths;
}

const story = (
  base: Pick<TimelinePlan, 'id' | 'n' | 'projectId' | 'name' | 'createdAt'>,
  beats: number,
  pool: readonly PoolShot[],
  captions: TimelinePlan['captions'],
): TimelinePlan => ({
  ...base,
  template: null,
  beatMap: steadyBeats(120, beats / 2 + 1),
  slots: storySlots(beatLengths(beats, base.n * 13), base.n),
  pool,
  variantIndex: 0,
  variantCount: 1,
  castId: fakeUlid<'Cast'>(MAKE_KIND.cast, base.n),
  mode: 'story',
  text: [],
  captions,
  language: 'en',
  unsure: [2],
});

export function seedProjects(
  libraryCount?: number,
  areas: Readonly<Record<string, unknown>> = {},
): {
  projects: SeededProject[];
  shots: Map<string, PoolShot>;
  pools: Map<TimelineId, readonly PoolShot[]>;
} {
  const shots = new Map<string, PoolShot>();
  const pools = new Map<TimelineId, readonly PoolShot[]>();
  const build = (plan: TimelinePlan) => {
    const built = buildTimeline(plan);
    for (const [key, shot] of built.shots) shots.set(key, shot);
    // Every shot of the pool can come back through "Find something else".
    for (const shot of plan.pool) shots.set(shot.candidate.shotId ?? shot.candidate.assetId, shot);
    pools.set(plan.id, plan.pool);
    return built.timeline;
  };

  // Phase 3's areas seed their own projects (make/p3/seeds), after Phase 2's.
  const withPhase3 = (projects: SeededProject[]) => [
    ...projects,
    ...seedPhase3({ build, pool: (count, seed) => shotPool(count, seed, libraryCount), areas }),
  ];

  const template = buildTemplate(GOLDEN_HOUR);
  const goldenPool = shotPool(96, 1, libraryCount);
  const golden = GOLDEN_TIMELINES.map((id, variant) =>
    build({
      id,
      n: variant + 1,
      projectId: GOLDEN_PROJECT,
      name: `Golden hour market · ${variant + 1}`,
      template: { id: template.id, version: 2 },
      beatMap: template.beatMap,
      slots: template.slots.map((slot) => ({
        slotId: slot.id,
        frames: slot.duration.value,
        beatIndex: slot.beatAnchor?.beatIndex ?? null,
      })),
      pool: goldenPool,
      variantIndex: variant,
      variantCount: 3,
      castId: GOLDEN_CAST,
      mode: 'template',
      text: template.text.map((overlay) => ({
        slot: template.slots.findIndex((slot) => slot.id === overlay.slotId),
        item: {
          text: overlay.text,
          role: overlay.role,
          overlayId: overlay.id,
          box: overlay.box,
          appearance: overlay.appearance,
          styleKey: overlay.styleKey,
          reveal: overlay.reveal,
          language: overlay.language,
        },
      })),
      captions: [
        { slot: 1, text: 'Golden hour at the market' },
        { slot: 3, text: 'Chai for forty rupees' },
        { slot: 6, text: 'Every colour you can think of' },
        { slot: 9, text: 'And then the fireworks' },
      ],
      language: 'en',
      unsure: [5],
      createdAt: FIXTURE_NOW - 26 * HOUR,
    }),
  );

  const trip = build(
    story(
      {
        id: TRIP_TIMELINE,
        n: 10,
        projectId: TRIP_PROJECT,
        name: 'Trip to Goa reel',
        createdAt: FIXTURE_NOW - 4 * DAY,
      },
      60,
      shotPool(80, 2, libraryCount),
      [
        { slot: 0, text: 'Three days in Goa' },
        { slot: 6, text: 'The best fish thali' },
      ],
    ),
  );
  const long = build(
    story(
      {
        id: LONG_TIMELINE,
        n: 20,
        projectId: LONG_PROJECT,
        name: 'Monsoon in 60 seconds',
        createdAt: FIXTURE_NOW - 9 * DAY,
      },
      120,
      shotPool(160, 3, libraryCount),
      [{ slot: 0, text: 'The first rain of the year' }],
    ),
  );
  const diwali = build(
    story(
      {
        id: DIWALI_TIMELINE,
        n: 30,
        projectId: DIWALI_PROJECT,
        name: 'Diwali highlights',
        createdAt: FIXTURE_NOW - 40 * DAY,
      },
      40,
      shotPool(60, 4, libraryCount),
      [],
    ),
  );

  return {
    shots,
    pools,
    projects: withPhase3([
      {
        id: GOLDEN_PROJECT,
        name: 'Golden hour market',
        createdAt: FIXTURE_NOW - 26 * HOUR,
        archivedAt: null,
        timelines: golden,
      },
      {
        id: TRIP_PROJECT,
        name: 'Trip to Goa reel',
        createdAt: FIXTURE_NOW - 4 * DAY,
        archivedAt: null,
        timelines: [trip],
      },
      {
        id: LONG_PROJECT,
        name: 'Monsoon in 60 seconds',
        createdAt: FIXTURE_NOW - 9 * DAY,
        archivedAt: null,
        timelines: [long],
      },
      {
        id: TEASER_PROJECT,
        name: 'Product teaser, 15 s',
        createdAt: FIXTURE_NOW - 11 * DAY,
        archivedAt: null,
        timelines: [],
      },
      {
        id: DIWALI_PROJECT,
        name: 'Diwali highlights',
        createdAt: FIXTURE_NOW - 40 * DAY,
        archivedAt: FIXTURE_NOW - 20 * DAY,
        timelines: [diwali],
      },
    ]),
  };
}
