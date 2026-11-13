// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: the person in a shot decides where its clip starts (SPEC, "FIX-TRIM: the person"). Made-up tracks: a
 * person who stands for 3 s and then walks, in a push-in whose frame motion is flat (as on the footage that showed
 * it, where the frame's motion couldn't see them start), and a face that shows for the first half of a shot.
 */
import { FrameRates, newId, RationalTime, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { inPointWithPerson, personInPoints, searchRange } from '../src/assembly/person-in-points';
import { ensureForAssembly } from '../src/assembly/subjects';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { selectInPoint } from '../src/casting/in-points';
import { slotSpecs } from '../src/casting/slots';
import { personMoves, personPace } from '../src/casting/subject-motion';
import { shotPerson, slotWants } from '../src/casting/subject-terms';
import { fakeEmbedder, unitVector } from './fixtures/library';
import {
  DETECT_HZ,
  FRAME,
  fakeSubjects,
  pushInShot,
  spanOf,
  standsThenWalks,
  type Scene,
} from './fixtures/people';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const settings = config.inPoint.subjects;
const fps30 = FrameRates.fps30;

/** An opening, then a one-second slot saying what it shows (no beat anchor), and a closing. */
function walkingTemplate(text = 'Walking down a busy street', energy = 0.5): Template {
  return buildTemplate({
    slots: [{ frames: 15 }, { frames: 30, text, energy, anchor: false }, { frames: 15 }],
  });
}

const range = (assetId: string, from: number, to: number) => ({
  assetId: assetId as never,
  start: RationalTime.of(from * 30, fps30),
  end: RationalTime.of(to * 30, fps30),
});

const moments = (scene: Scene, seconds: number) =>
  spanOf(scene, 0, seconds).samples.map((sample) => ({
    t: RationalTime.toSeconds(sample.t),
    people: sample.people!,
  }));

describe('the person over a shot', () => {
  it('reads the person standing for 3 s, then walking: the onset at 3 s, no stop', () => {
    const pace = personPace(moments(standsThenWalks(3), 6), FRAME.width / FRAME.height, settings);
    const moves = personMoves(pace, settings);
    expect(moves.seen).toBe(true);
    expect(moves.onset).toBeGreaterThanOrEqual(3 - 1 / DETECT_HZ);
    expect(moves.onset).toBeLessThanOrEqual(3 + 2 / DETECT_HZ);
    expect(moves.stop).toBeNull();
  });

  it('reads no onset for someone walking from the start, and a stop for someone who stops', () => {
    const walking = personMoves(personPace(moments(standsThenWalks(0), 4), 16 / 9, settings), settings);
    expect(walking.onset).toBeNull();
    const stops: Scene = (t) => standsThenWalks(-1)(Math.min(t, 2.5));
    const stopping = personMoves(personPace(moments(stops, 5), 16 / 9, settings), settings);
    expect(stopping.onset).toBeNull();
    expect(stopping.stop).toBeGreaterThan(2.25);
    expect(stopping.stop).toBeLessThan(3.25);
    expect(
      personMoves(
        personPace(
          moments(() => ({}), 4),
          16 / 9,
          settings,
        ),
        settings,
      ).seen,
    ).toBe(false);
  });

  it('keeps to one person when another walks past', () => {
    const crowd: Scene = () => ({ person: { x: 0.4, y: 0.4, width: 0.15, height: 0.4 } });
    const withPasser = moments(crowd, 4).map((moment) => ({
      ...moment,
      people: [
        ...moment.people,
        { box: { x: (moment.t * 0.4) % 0.8, y: 0.5, width: 0.1, height: 0.3 }, confidence: 0.9 },
      ],
    }));
    const moves = personMoves(personPace(withPasser, 16 / 9, settings), settings);
    expect(moves.movingShare).toBe(0);
  });
});

describe('a window with the person in it', () => {
  it('lands after 3 s when the person stands for 3 s, then walks, and the frame’s motion is flat', () => {
    const template = walkingTemplate();
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(6, { bestFrame: 9 });
    // The frame's motion alone (stage 1): no onset, and the best frame at 0.3 s pulls the window as early as the
    // recording's first second allows, while the person still stands.
    expect(selectInPoint(profile, slot, fps30, config, false)!.sourceStart.value).toBe(30);
    const span = spanOf(standsThenWalks(3), 0, 6);
    const point = inPointWithPerson({
      profile,
      slot,
      template,
      span,
      range: range(profile.assetId, 0, 6),
      config,
    });
    expect(slotWants(slot, template, settings).moving).toBe(true);
    // Half a second into the walk, on the stride rather than the first step.
    expect(point!.sourceStart.value).toBeGreaterThanOrEqual(90 + 15);
    expect(point!.sourceStart.value + 30).toBeLessThanOrEqual(180);
  });

  it('reads a moment as motion from the reel’s own person, before the slot’s words', () => {
    const template = walkingTemplate('A quiet bench by the sea');
    const slot = slotSpecs(template, config)[1]!;
    expect(slotWants(slot, template, settings).moving).toBe(false);
    // The reel is portrait: its walker crosses 0.3 of the frame's width a second, about 0.4 of their height.
    const box = (t: number) => ({ x: 0.1 + 0.3 * t, y: 0.4, width: 0.2, height: 0.4 });
    const subjects: NonNullable<Template['subjects']> = {
      version: 1,
      detector: 'vision',
      hz: 4,
      samples: Array.from({ length: 8 }, (_, k) => ({
        t: RationalTime.fromSeconds(k / 4, fps30, 'round'),
        heads: [],
        people: [{ box: box(k / 4), confidence: 0.9 }],
      })),
    };
    expect(slotWants(slot, { ...template, subjects }, settings).moving).toBe(true);
  });

  it('keeps a person who starts walking out of a still moment’s window, rather than across it', () => {
    const template = walkingTemplate('A quiet bench by the sea', 0.2);
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(6, { bestFrame: 90 });
    const span = spanOf(standsThenWalks(3), 0, 6);
    const whole = range(profile.assetId, 0, 6);
    const onset = shotPerson(profile, span, whole, settings)!.onset!;
    expect(Math.abs(onset - 90)).toBeLessThanOrEqual(8);
    const start = inPointWithPerson({ profile, slot, template, span, range: whole, config })!.sourceStart
      .value;
    // The best frame alone would centre the window on the start of the walk.
    expect(selectInPoint(profile, slot, fps30, config, false)!.sourceStart.value).toBe(75);
    expect(start + 30 <= onset || start >= onset).toBe(true);
  });

  it('chooses the window with the fewest faces when the moment shows none', () => {
    const faceFirst: Scene = (t) => ({ person: { x: 0.4, y: 0.3, width: 0.2, height: 0.5 }, face: t < 6 });
    const template = walkingTemplate('Waves on the rocks', 0.2);
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(12, { bestFrame: 60, faceCount: 1 });
    const span = spanOf(faceFirst, 0, 12);
    const whole = range(profile.assetId, 0, 12);
    // Nothing says no face: the best frame at 2 s wins, face and all.
    expect(
      inPointWithPerson({ profile, slot, template, span, range: whole, config })!.sourceStart.value,
    ).toBeLessThan(180);
    // The reel shows nobody during the slot: no face.
    const nobody: NonNullable<Template['subjects']> = {
      version: 1,
      detector: 'vision',
      hz: 4,
      samples: [0.5, 0.75, 1, 1.25].map((t) => ({
        t: RationalTime.fromSeconds(t, fps30),
        heads: [],
        people: [],
      })),
    };
    const quiet = { ...template, subjects: nobody };
    expect(slotWants(slot, quiet, settings).noFace).toBe(true);
    const point = inPointWithPerson({ profile, slot, template: quiet, span, range: whole, config });
    expect(point!.sourceStart.value).toBeGreaterThanOrEqual(180);
    // Or the person asks for no face (a slip's avoid).
    const asked = inPointWithPerson({
      profile,
      slot,
      template,
      span,
      range: whole,
      config,
      wants: { noFace: true },
    });
    expect(asked!.sourceStart.value).toBeGreaterThanOrEqual(180);
  });

  it('keeps a clip where it is when no window helps the person by enough', () => {
    const template = walkingTemplate('Waves on the rocks', 0.2);
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(12, { bestFrame: 60 });
    const whole = range(profile.assetId, 0, 12);
    // A face everywhere but one sample: "no face" can't be had, so the clip at 4 s stays.
    const always: Scene = (t) => ({ person: { x: 0.4, y: 0.3, width: 0.2, height: 0.5 }, face: t !== 9 });
    const span = spanOf(always, 0, 12);
    const kept = {
      profile,
      slot,
      template,
      span,
      range: whole,
      config,
      wants: { noFace: true },
      current: 120,
    };
    expect(inPointWithPerson(kept)).toBeNull();
    // A walker the clip is already on: nothing to gain either.
    const walk = {
      ...kept,
      span: spanOf(standsThenWalks(3), 0, 12),
      wants: { moving: true, noFace: false },
      current: 150,
    };
    expect(inPointWithPerson(walk)).toBeNull();
    // From the start of the walk it moves.
    expect(inPointWithPerson({ ...walk, current: 0 })!.sourceStart.value).toBeGreaterThanOrEqual(105);
  });

  it('sits on a walk shorter than the window and its margins', () => {
    const template = walkingTemplate();
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(8);
    // Still, walks from 3 s to 4.5 s, still again: 1.5 s of walking for a 1 s window.
    const short: Scene = (t) => standsThenWalks(3)(Math.min(t, 4.5));
    const whole = range(profile.assetId, 0, 8);
    const point = inPointWithPerson({
      profile,
      slot,
      template,
      span: spanOf(short, 0, 8),
      range: whole,
      config,
    });
    const start = point!.sourceStart.value;
    expect(start).toBeGreaterThanOrEqual(90);
    expect(start + 30).toBeLessThanOrEqual(140);
  });

  it('chooses only windows inside the tracked span, and nothing from a span nobody is in', () => {
    const template = walkingTemplate();
    const slot = slotSpecs(template, config)[1]!;
    const profile = pushInShot(6);
    const scene = standsThenWalks(3);
    const part = range(profile.assetId, 0, 2);
    const point = inPointWithPerson({
      profile,
      slot,
      template,
      span: spanOf(scene, 0, 2),
      range: part,
      config,
    });
    expect(point!.sourceStart.value + 30).toBeLessThanOrEqual(60);
    const empty = spanOf(() => ({}), 0, 6);
    expect(
      inPointWithPerson({
        profile,
        slot,
        template,
        span: empty,
        range: range(profile.assetId, 0, 6),
        config,
      }),
    ).toBeNull();
  });
});

describe('assembly’s in-points with the person', () => {
  async function made(lock = false) {
    const template = walkingTemplate();
    const profiles = [
      pushInShot(6, { bestFrame: 9, embedding: unitVector(21) }),
      pushInShot(4, { embedding: unitVector(22) }),
      pushInShot(4, { embedding: unitVector(23) }),
    ];
    const catalog = createMemoryShotCatalog(profiles);
    // Each slot's words find its own shot: the walker for the walking slot.
    const table = new Map(
      template.slots.map((slot, index) => [slot.intent.text, profiles[(index + 2) % 3]!.embedding]),
    );
    const engine = createCastingEngine({ catalog, embedder: fakeEmbedder(table) });
    const walker = profiles[0]!;
    const result = await engine.cast({
      projectId: newId<'Project'>(),
      template,
      mode: 'template',
      variants: 1,
      seed: 1,
      ...(lock
        ? {
            locked: [
              {
                slotId: template.slots[1]!.id,
                assetId: walker.assetId,
                shotId: walker.shotId!,
                sourceStart: RationalTime.of(0, fps30),
              },
            ],
          }
        : {}),
    });
    if (!result.ok) throw new Error(result.error.code);
    return { template, profiles, engine, walker, cast: result.value };
  }

  it('moves the walking slot’s clip past the person’s start, and tracks only each pick’s search span', async () => {
    const { template, engine, walker, cast } = await made();
    const slot = cast.variants[0]!.slots[1]!;
    // Casting with the frame's motion alone put the walker in the walking slot a second in, still standing.
    expect(slot.pick!.assetId).toBe(walker.assetId);
    expect(slot.pick!.sourceStart.value).toBe(30);
    const fake = fakeSubjects(new Map([[walker.assetId, standsThenWalks(3)]]));
    const done = await personInPoints(
      { subjects: fake.source, profiles: engine.profiles! },
      template,
      cast,
      config,
      5_000,
    );
    expect(done.report.moved).toBe(1);
    expect(done.cast.variants[0]!.slots[1]!.pick!.sourceStart.value).toBeGreaterThanOrEqual(90);
    // The span: the pick's window and six seconds after it, inside the 6 s shot.
    const spec = slotSpecs(template, config)[1]!;
    const asked = searchRange(walker, slot.pick!.sourceStart, spec, config);
    expect([asked.start.value, asked.end.value]).toEqual([0, 180]);
    expect(fake.asked).toContainEqual(asked);
  });

  it('runs between the picks’ tracks and the fallbacks’, and placement’s ranges follow the moved clip', async () => {
    const { template, engine, walker, cast } = await made();
    const fake = fakeSubjects(new Map([[walker.assetId, standsThenWalks(3)]]));
    const refine = async (next: typeof cast, budget: number) =>
      (
        await personInPoints(
          { subjects: fake.source, profiles: engine.profiles! },
          template,
          next,
          config,
          budget,
        )
      ).cast;
    const tracks = await ensureForAssembly(fake.source, template, cast, 5_000, Date.now, refine);
    expect(tracks.cast.variants[0]!.slots[1]!.pick!.sourceStart.value).toBeGreaterThanOrEqual(90);
    expect(tracks.picks.done && tracks.fallbacks.done).toBe(true);
  });

  it('leaves a locked pick, an untracked shot and a shot nobody is in as cast', async () => {
    const locked = await made(true);
    const fake = fakeSubjects(new Map([[locked.walker.assetId, standsThenWalks(3)]]));
    const kept = await personInPoints(
      { subjects: fake.source, profiles: locked.engine.profiles! },
      locked.template,
      locked.cast,
      config,
      5_000,
    );
    expect(kept.cast).toBe(locked.cast);
    const open = await made();
    const untracked = fakeSubjects(new Map([[open.walker.assetId, standsThenWalks(3)]]), { tracks: false });
    const late = await personInPoints(
      { subjects: untracked.source, profiles: open.engine.profiles! },
      open.template,
      open.cast,
      config,
      5_000,
    );
    expect(late.report.moved).toBe(0);
    expect(late.cast).toBe(open.cast);
    const empty = fakeSubjects(new Map([[open.walker.assetId, () => ({})]]));
    const nobody = await personInPoints(
      { subjects: empty.source, profiles: open.engine.profiles! },
      open.template,
      open.cast,
      config,
      5_000,
    );
    expect(nobody.report.moved).toBe(0);
  });
});
