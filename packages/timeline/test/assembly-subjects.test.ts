// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: assembly reframes a clip whose aspect differs from the canvas's by more than 1% (render SPEC P3.2), and
 * every pick's subject track is made before the first draft, from the cast's ranges, within a budget; then, in
 * what is left of it, the ranges placement's retime and recast read (FRM1-OVL's request).
 */
import {
  err,
  FrameRates,
  newId,
  NotFoundError,
  ok,
  RationalTime,
  timelineSchema,
  type ShotProfile,
  type SubjectClipRange,
  type SubjectSource,
  type Template,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assemble, reframeFor } from '../src/assembly/assemble';
import { clipSourceRange } from '../src/assembly/placement/subjects';
import {
  ALTERNATES_TRACKED,
  castRanges,
  ensureForAssembly,
  ensureSubjects,
  fallbackRanges,
  RETIME_REACH_SECONDS,
  timelineRanges,
  widened,
} from '../src/assembly/subjects';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine, type CastResult } from '../src/casting/engine';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const ids = { item: () => newId<'TimelineItem'>() };
const PORTRAIT = { width: 1080, height: 1920 };

async function cast(template: Template, profiles: ShotProfile[]): Promise<CastResult> {
  const engine = createCastingEngine({
    catalog: createMemoryShotCatalog(profiles),
    embedder: fakeEmbedder(new Map()),
  });
  const result = await engine.cast({
    projectId: newId<'Project'>(),
    template,
    mode: 'template',
    variants: 1,
    seed: 1,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function assembled(template: Template, result: CastResult, aspects?: ReadonlyMap<string, number>) {
  const made = assemble(
    {
      projectId: newId<'Project'>(),
      template,
      variant: result.variants[0]!,
      cast: { castId: result.castId, mode: 'template', variantIndex: 0, variantCount: 1, configVersion: '1' },
      canvas: PORTRAIT,
      ...(aspects ? { aspects } : {}),
      timelineId: newId<'Timeline'>(),
      name: 'Made',
      now: 1,
    },
    ids,
  );
  if (!made.ok) throw new Error(made.error.code);
  return made.value;
}

const setup = async () => {
  const template = buildTemplate({ slots: [{ frames: 45 }, { frames: 60 }, { frames: 30 }] });
  const profiles = Array.from({ length: 6 }, (_, index) =>
    makeProfile({ embedding: unitVector(700 + index), rate: FrameRates.fps30, frames: 300, offset: 30 }),
  );
  return { template, result: await cast(template, profiles) };
};

describe('reframing where the aspects differ (FRM1-SUB)', () => {
  it('follows the subject past 1%, and keeps the fit within it', () => {
    expect(reframeFor(9 / 16, PORTRAIT)).toBeNull();
    expect(reframeFor(1080 / 1918, PORTRAIT)).toBeNull();
    expect(reframeFor(3 / 4, PORTRAIT)).toEqual({ mode: 'auto', nudge: { x: 0, y: 0 }, scale: 1 });
    expect(reframeFor(16 / 9, PORTRAIT)?.mode).toBe('auto');
    expect(reframeFor(undefined, PORTRAIT)).toBeNull();
    expect(reframeFor(0, PORTRAIT)).toBeNull();
  });

  it("sets each clip's reframe from its asset's aspect, and the timeline still parses", async () => {
    const { template, result } = await setup();
    const picks = result.variants[0]!.slots.map((slot) => slot.pick!.assetId);
    const aspects = new Map<string, number>([
      [picks[0]!, 3 / 4],
      [picks[1]!, 9 / 16],
      [picks[2]!, 16 / 9],
    ]);
    const timeline = assembled(template, result, aspects);
    const clips = timeline.tracks[0]!.items.filter((item) => item.type === 'clip');
    expect(clips.map((clip) => clip.reframe?.mode ?? null)).toEqual(['auto', null, 'auto']);
    expect(timelineSchema.safeParse(timeline).success).toBe(true);
    // Unknown aspects: as before FRM1.
    const unknown = assembled(template, result);
    expect(unknown.tracks[0]!.items.every((item) => item.type !== 'clip' || item.reframe === null)).toBe(
      true,
    );
  });
});

describe('subject tracks before the first draft (FRM1-SUB)', () => {
  it("gives the cast's ranges, the same ones the assembled clips play", async () => {
    const { template, result } = await setup();
    const ranges = castRanges(template, result);
    expect(ranges).toHaveLength(3);
    const timeline = assembled(template, result);
    const played = timelineRanges(timeline);
    const key = (range: SubjectClipRange) =>
      `${range.assetId}@${RationalTime.toSeconds(range.start)}-${RationalTime.toSeconds(range.end)}`;
    expect(played.map(key).sort()).toEqual(ranges.map(key).sort());
    for (const range of ranges)
      expect(RationalTime.toSeconds(range.end)).toBeGreaterThan(RationalTime.toSeconds(range.start));
  });

  it('waits for the tracks, and reports a failure or a budget out without failing', async () => {
    const asked: SubjectClipRange[][] = [];
    const source = (answer: () => Promise<unknown>): SubjectSource => ({
      over: async () => ok(undefined),
      ensure: async (ranges) => {
        asked.push([...ranges]);
        return (await answer()) as Awaited<ReturnType<SubjectSource['ensure']>>;
      },
    });
    const range = {
      assetId: newId<'Asset'>(),
      start: RationalTime.of(0, FrameRates.fps30),
      end: RationalTime.of(30, FrameRates.fps30),
    };
    const done = await ensureSubjects(
      source(async () => ok(undefined)),
      [range],
    );
    expect(done).toMatchObject({ ranges: 1, done: true });
    const failed = await ensureSubjects(
      source(async () => err(NotFoundError({ entity: 'subjectTracker' }))),
      [range],
    );
    expect(failed).toMatchObject({ done: false, reason: 'core.not_found' });
    const slow = await ensureSubjects(
      source(() => new Promise((resolve) => setTimeout(() => resolve(ok(undefined)), 200))),
      [range],
      10,
    );
    expect(slow).toMatchObject({ done: false, reason: 'budget' });
    expect(
      await ensureSubjects(
        source(async () => ok(undefined)),
        [],
      ),
    ).toMatchObject({ ranges: 0, done: true });
    expect(asked).toHaveLength(3);
  });
});

/** Whether a stored track over `outer` holds `inner` (SubjectSource's covering). */
const holds = (outer: SubjectClipRange, inner: SubjectClipRange) =>
  outer.assetId === inner.assetId &&
  RationalTime.toSeconds(outer.start) <= RationalTime.toSeconds(inner.start) + 1e-9 &&
  RationalTime.toSeconds(inner.end) <= RationalTime.toSeconds(outer.end) + 1e-9;

describe('tracks for placement’s fallbacks, after the picks (FRM1-SUB for FRM1-OVL)', () => {
  it('holds what retime reads around each clip and what recast reads of the first two alternates', async () => {
    const { template, result } = await setup();
    const tracked = fallbackRanges(template, result);
    const timeline = assembled(template, result);
    const rate = timeline.canvas.rate;
    const clips = timeline.tracks[0]!.items.filter((item) => item.type === 'clip');
    const variant = result.variants[0]!;
    for (const clip of clips) {
      if (clip.media.kind !== 'video') throw new Error('a video clip');
      // Retime's read (run-placement.ts): the clip's span widened by its reach, inside the media.
      const window = widened(
        { assetId: clip.media.assetId, ...clipSourceRange(clip, rate) },
        RETIME_REACH_SECONDS,
        clip.media.available,
      );
      // Wider than the clip on both sides.
      const played = clipSourceRange(clip, rate);
      expect(RationalTime.toSeconds(window.start)).toBeLessThan(RationalTime.toSeconds(played.start));
      expect(RationalTime.toSeconds(window.end)).toBeGreaterThan(RationalTime.toSeconds(played.end));
      expect(tracked.some((range) => holds(range, window))).toBe(true);
      // Recast's read: each alternate over the span the slot plays; the first two are tracked, the third isn't.
      const slot = variant.slots.find((entry) => entry.slotId === clip.slotId)!;
      expect(slot.alternates.length).toBeGreaterThan(ALTERNATES_TRACKED);
      slot.alternates.forEach((alternate, index) => {
        const ref = variant.media.find((media) => media.assetId === alternate.assetId)!;
        if (ref.kind !== 'video') throw new Error('a video alternate');
        const read = {
          assetId: alternate.assetId,
          ...clipSourceRange({ ...clip, media: ref, sourceStart: alternate.sourceStart }, rate),
        };
        const found = tracked.some((range) => holds(range, read));
        if (index < ALTERNATES_TRACKED) expect(found).toBe(true);
      });
    }
    // Nothing reaches outside its media.
    for (const range of tracked) expect(range.start.value).toBeGreaterThanOrEqual(0);
  });

  it('waits for the picks first, then the fallbacks in what is left of the budget', async () => {
    const { template, result } = await setup();
    const asked: SubjectClipRange[][] = [];
    let clock = 0;
    const source: SubjectSource = {
      over: async () => ok(undefined),
      ensure: async (ranges) => {
        asked.push([...ranges]);
        clock += 40;
        return ok(undefined);
      },
    };
    const made = await ensureForAssembly(source, template, result, 100, () => clock);
    expect(asked[0]).toEqual(castRanges(template, result));
    expect(asked[1]).toEqual(fallbackRanges(template, result));
    expect(made.picks).toMatchObject({ done: true, ms: 40 });
    expect(made.fallbacks).toMatchObject({ done: true, ms: 40 });
    // The picks use the whole budget: the fallbacks are still asked for (queued), and reported late.
    const slow: SubjectSource = {
      over: async () => ok(undefined),
      ensure: (ranges) => {
        asked.push([...ranges]);
        return new Promise((resolve) => setTimeout(() => resolve(ok(undefined)), 50));
      },
    };
    const late = await ensureForAssembly(slow, template, result, 10);
    expect(late.picks).toMatchObject({ done: false, reason: 'budget' });
    expect(late.fallbacks).toMatchObject({ done: false, reason: 'budget' });
    expect(asked).toHaveLength(4);
  });
});
