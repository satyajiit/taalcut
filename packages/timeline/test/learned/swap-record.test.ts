// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recording score parts where the swap is made (LRN1-PREF): on core's real bus, a swap keeps the score the person
 * was shown (the payload's `scored`, or the stored alternate's) as the slot's pick, and its audit entry gives the
 * learner the pair: the shot swapped in over the pick it replaced, both as scored at the time.
 */
import {
  createCommandBus,
  createEventBus,
  createManualClock,
  createMemoryAuditLogStore,
  RationalTime,
  type CommandOrigin,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { signalPairs } from '../../src/casting/learned/signals';
import { LEARNER_CONFIG } from '../../src/casting/learned/learner-config';
import { createTimelineCommands } from '../../src/commands/commands';
import { makeProfile, unitVector } from '../fixtures/library';
import { createMemoryTimelineStore } from '../fixtures/store';
import { buildTimeline } from '../fixtures/timeline';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };
const found = {
  intent: 0.3,
  motion: 1,
  quality: 0.6,
  subject: 0.2,
  energy: 0.5,
  hook: null,
  rerank: null,
  penalty: 0,
};

async function setup() {
  const clock = createManualClock(1_000);
  const audit = createMemoryAuditLogStore();
  const bus = createCommandBus({ store: audit, clock });
  const store = createMemoryTimelineStore();
  const shot = makeProfile({ embedding: unitVector(1), frames: 300 });
  const commands = createTimelineCommands({
    store,
    events: createEventBus({ clock }),
    clock,
    catalog: createMemoryShotCatalog([shot]),
  });
  bus.register(...commands.all);
  const built = buildTimeline({ clips: [{ frames: 30 }, { frames: 30 }] });
  await bus.dispatch(
    'timeline.create',
    { projectId: built.timeline.projectId, timelines: [built.timeline] },
    ui,
  );
  const target = { projectId: built.timeline.projectId, timelineId: built.timeline.id };
  const read = () => store.docs.get(built.timeline.id) as Timeline;
  return { bus, audit, shot, built, target, read };
}

describe('a swap records the score the person was shown', () => {
  it("keeps a found shot's score parts on the pick, and the log gives the pair", async () => {
    const { bus, audit, shot, built, target, read } = await setup();
    const swapped = await bus.dispatch(
      'timeline.swapClip',
      {
        ...target,
        clipId: built.ids[0],
        media: { assetId: shot.assetId, shotId: shot.shotId },
        sourceStart: RationalTime.of(30, shot.range.start.rate),
        from: 'search',
        scored: { score: 0.41, parts: found },
      },
      ui,
    );
    expect(swapped.ok).toBe(true);
    const pick = read().cast?.slots[0]?.pick;
    expect(pick).toMatchObject({ shotId: shot.shotId, score: 0.41, parts: found });

    const log = await audit.listByProject(target.projectId);
    const entry = log.ok ? log.value.find((row) => row.name === 'timeline.swapClip') : undefined;
    const pairs = entry ? signalPairs(entry, LEARNER_CONFIG) : [];
    expect(pairs).toEqual([
      {
        chosen: { intent: 0.3, motion: 1, quality: 0.6, subject: 0.2, energy: 0.5 },
        rejected: { intent: 0.7, motion: 1, quality: 0.8, subject: 0.5, energy: 0.9 },
        weight: 1,
      },
    ]);
  });

  it('records no score for a shot nobody scored', async () => {
    const { bus, shot, built, target, read } = await setup();
    await bus.dispatch(
      'timeline.swapClip',
      {
        ...target,
        clipId: built.ids[1],
        media: { assetId: shot.assetId, shotId: shot.shotId },
        from: 'agent',
      },
      ui,
    );
    expect(read().cast?.slots[1]?.pick).toMatchObject({
      score: 0,
      parts: { intent: 0, motion: 0, quality: 0 },
    });
  });
});
