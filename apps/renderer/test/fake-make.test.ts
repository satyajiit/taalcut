// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { RationalTime, timelineSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { GOLDEN_TIMELINES, LONG_TIMELINE } from '../src/backend/fake/make/ids';
import { seedProjects } from '../src/backend/fake/make/seed';

describe('the Make fakes’ seeded timelines', () => {
  const seeded = seedProjects();
  const timelines = seeded.projects.flatMap((project) => project.timelines);

  it.each(timelines.map((timeline) => [timeline.name, timeline] as const))(
    '%s passes core’s schema',
    (_, timeline) => {
      const parsed = timelineSchema.safeParse(timeline);
      expect(parsed.error?.issues ?? []).toEqual([]);
    },
  );

  it('casts Golden hour market three ways, 12 slots at 120 BPM', () => {
    const golden = timelines.filter((timeline) => GOLDEN_TIMELINES.includes(timeline.id));
    expect(golden).toHaveLength(3);
    for (const timeline of golden) {
      expect(timeline.cast?.slots).toHaveLength(12);
      expect(timeline.beatMap?.bpm).toBe(120);
      expect(timeline.cast?.slots.every((slot) => slot.alternates.length === 3)).toBe(true);
    }
    const firstPicks = golden.map((timeline) => timeline.cast?.slots[0]?.pick?.shotId);
    expect(new Set(firstPicks).size).toBe(3);
  });

  it('has a 60 s 9:16 timeline for the playback benchmark', () => {
    const long = timelines.find((timeline) => timeline.id === LONG_TIMELINE)!;
    const frames = long.tracks[0]!.items.reduce(
      (sum, item) => sum + (item.type === 'transition' ? 0 : item.duration.value),
      0,
    );
    expect(RationalTime.toSeconds(RationalTime.of(frames, long.canvas.rate))).toBe(60);
    expect(long.canvas).toMatchObject({ width: 1080, height: 1920 });
  });
});
