// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM2: a stretch the describer states as the camera being handled is not footage (SPEC, "MOM2: handling
 * stretches"). Made-up shots whose moments carry that word: the in-point rule, the content term, a stated part and
 * assembly's step with the person never rest a clip on one while the shot has another stretch long enough; a shot
 * that is handling all through, or has nothing else long enough, is chosen from as before. Nothing reads a note.
 */
import { FrameRates, newId, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { personInPoints } from '../src/assembly/person-in-points';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { clearStarts, handlingRead, handlingVerdict } from '../src/casting/handling';
import { selectInPoint } from '../src/casting/in-points';
import { partFit } from '../src/casting/moment-fit';
import { slotSpecs, type SlotSpec } from '../src/casting/slots';
import { partSetAside, partTerms, type StatedPart } from '../src/casting/stated-parts';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { ASK, ASK_SET, withMoments, type MomentDef } from './fixtures/moments';
import { fakeSubjects, pushInShot, standsThenWalks } from './fixtures/people';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const handling = config.inPoint.handling;
const fps30 = FrameRates.fps30;

/** 10 s at 30 fps whose last two seconds are the sharpest, with the best frame and the peaks in them. */
function sharpAtTheEnd(): ShotProfile {
  const base = makeProfile({ embedding: unitVector(5), frames: 300, peaks: [255, 270, 285] });
  return {
    ...base,
    sharpnessCurve: base.sharpnessCurve!.map((_, index) => (index >= 80 ? 0.95 : 0.55)),
    bestFrame: 270,
  };
}

/** Eight seconds held on something, then two of the camera being lowered. */
const HELD_THEN_LOWERED: MomentDef[] = [
  { to: 240, note: 'People hold up their tickets.', fit: 0.3 },
  { to: 300, note: 'The floor and a pair of shoes.', fit: 0.9, handling: true },
];
const lowered = () => withMoments(sharpAtTheEnd(), HELD_THEN_LOWERED);

/** A slot of `frames` canvas frames (30 fps) with no beat anchor; `asks` gives it something to state. */
function slotOf(frames: number, asks = false, anchor = false): SlotSpec {
  const template = buildTemplate({
    slots: [{ frames: 15 }, { frames, text: 'feet', anchor }, { frames: 15 }],
  });
  const spec = slotSpecs(template, config)[1]!;
  return asks ? { ...spec, intentVector: ASK, askSet: ASK_SET } : spec;
}
const startOf = (point: { sourceStart: { value: number } } | null) => point!.sourceStart.value;

describe('a shot’s handling stretches', () => {
  it('counts the frames of a window that lie in them, and the least any window must', () => {
    const read = handlingRead(lowered(), 30, handling)!;
    expect(read.inside(0)).toBe(0);
    expect(read.inside(225)).toBe(15);
    expect(read.inside(270)).toBe(30);
    expect(read).toMatchObject({ least: 0, avoidable: true });
    const clear = clearStarts(lowered(), 30, handling)!;
    expect([0, 210, 211, 270].map(clear)).toEqual([true, true, false, false]);
  });

  it('lets a window longer than the held stretch lie in them a little, and only as little as it must', () => {
    // 9 s of a shot with 8 s held: 30 frames in the lowering at the least, a ninth of the window.
    expect(handlingRead(lowered(), 270, handling)).toMatchObject({ least: 30, avoidable: true });
    const clear = clearStarts(lowered(), 270, handling)!;
    expect([0, 1, 30].map(clear)).toEqual([true, false, false]);
  });

  it('has nothing to keep off when no window can, the whole shot is one, or none is stated', () => {
    // 9.7 s: 50 frames in the lowering at the least, more than the allowed share.
    expect(handlingRead(lowered(), 290, handling)).toMatchObject({ least: 50, avoidable: false });
    expect(clearStarts(lowered(), 290, handling)).toBeNull();
    const whole = withMoments(sharpAtTheEnd(), [
      { to: 300, note: 'A hand over the lens.', fit: null, handling: true },
    ]);
    expect(clearStarts(whole, 30, handling)).toBeNull();
    expect(handlingRead(whole, 30, handling)).toMatchObject({ least: 30, avoidable: false });
    const held = withMoments(sharpAtTheEnd(), [{ to: 300, note: 'A boat crosses the bay.', fit: null }]);
    expect(handlingRead(held, 30, handling)).toBeNull();
    expect(handlingRead(sharpAtTheEnd(), 30, handling)).toBeNull();
    expect(handlingRead({ ...lowered(), kind: 'image' }, 30, handling)).toBeNull();
    expect(handlingRead(lowered(), 301, handling)).toBeNull();
  });

  it('says what a placed window is to them', () => {
    expect(handlingVerdict(lowered(), 270, 30, handling)).toEqual({
      share: 1,
      rests: true,
      unavoidable: false,
    });
    // Four frames of thirty: within the allowed overlap.
    expect(handlingVerdict(lowered(), 214, 30, handling)).toMatchObject({ rests: false, unavoidable: false });
    expect(handlingVerdict(lowered(), 216, 30, handling)).toMatchObject({ share: 0.2, rests: true });
    expect(handlingVerdict(lowered(), 5, 290, handling)).toMatchObject({ rests: false, unavoidable: true });
  });
});

describe('the in-point rule and handling stretches', () => {
  it('never rests a clip on one while the shot has another stretch long enough', () => {
    // Left to the curves, the clip plays the sharp last two seconds, on the best frame.
    expect(startOf(selectInPoint(sharpAtTheEnd(), slotOf(30), fps30, config, false))).toBeGreaterThanOrEqual(
      240,
    );
    const start = startOf(selectInPoint(lowered(), slotOf(30), fps30, config, false));
    expect(start + 30).toBeLessThanOrEqual(240);
    // The slot states what only the lowering shows (its note sits at 0.9 to the ask): it still plays the held part.
    const asked = startOf(selectInPoint(lowered(), slotOf(30, true), fps30, config, false));
    expect(asked + 30).toBeLessThanOrEqual(240);
  });

  it('does not give a peak on the beat to a handling stretch', () => {
    const point = selectInPoint(lowered(), slotOf(30, false, true), fps30, config, false)!;
    expect(startOf(point) + 30).toBeLessThanOrEqual(240);
    expect(point.aligned).toBe(false);
  });

  it('gives a handling moment no fit, whatever its note says', () => {
    const parts = partFit(lowered(), [ASK], ASK_SET, config.inPoint.content.margin)!;
    expect(parts.moments[1]).toBe(0);
    expect(parts.moments[0]).toBeCloseTo(0.3 - config.inPoint.content.margin, 6);
    // The same notes without the word: the second fits far better.
    const filmed = withMoments(
      sharpAtTheEnd(),
      HELD_THEN_LOWERED.map(({ handling: _, ...moment }) => moment),
    );
    expect(partFit(filmed, [ASK], ASK_SET, config.inPoint.content.margin)!.moments[1]).toBeGreaterThan(0.8);
  });

  it('chooses as before when the shot is handling all through, or has nothing else long enough', () => {
    const whole = withMoments(sharpAtTheEnd(), [
      { to: 300, note: 'A hand over the lens.', fit: null, handling: true },
    ]);
    expect(startOf(selectInPoint(whole, slotOf(30), fps30, config, false))).toBe(
      startOf(selectInPoint(sharpAtTheEnd(), slotOf(30), fps30, config, false)),
    );
    // 9.7 s of the 10 s shot: no window keeps off the lowering, so every start stands.
    expect(startOf(selectInPoint(lowered(), slotOf(290), fps30, config, false))).toBe(
      startOf(selectInPoint(sharpAtTheEnd(), slotOf(290), fps30, config, false)),
    );
  });

  it('keeps to it under other terms: none of the allowed windows is clear, none is chosen', () => {
    const onlyTheEnd = { allowed: (start: number) => start >= 250 };
    expect(selectInPoint(sharpAtTheEnd(), slotOf(30), fps30, config, false, onlyTheEnd)).not.toBeNull();
    expect(selectInPoint(lowered(), slotOf(30), fps30, config, false, onlyTheEnd)).toBeNull();
    const either = { allowed: (start: number) => start >= 250 || start === 100 };
    expect(startOf(selectInPoint(lowered(), slotOf(30), fps30, config, false, either))).toBe(100);
  });
});

describe('a stated part and handling stretches', () => {
  it('is set aside when every window it allows rests on one and the shot has a window that does not', () => {
    // The shot starts at its file's start: 8.5 s to 10 s is frames 255 to 300, inside the lowering.
    expect(partSetAside(lowered(), 30, { from: 8.5, to: 10 }, handling)).toBe(true);
    expect(partTerms(lowered(), 30, { from: 8.5, to: 10 }, handling)).toBeUndefined();
    // A part that reaches back into the held stretch keeps its clear windows.
    expect(partSetAside(lowered(), 30, { from: 6, to: 10 }, handling)).toBe(false);
    const allowed = partTerms(lowered(), 30, { from: 6, to: 10 }, handling)!.allowed!;
    expect(
      startOf(selectInPoint(lowered(), slotOf(30), fps30, config, false, { allowed })) + 30,
    ).toBeLessThanOrEqual(240);
    // Nothing to set aside on a shot with no such stretch, or one that can't keep off them.
    expect(partSetAside(sharpAtTheEnd(), 30, { from: 8.5, to: 10 }, handling)).toBe(false);
    expect(partSetAside(lowered(), 290, { from: 0.2, to: 10 }, handling)).toBe(false);
  });

  function world(moments: MomentDef[] | null) {
    const template = buildTemplate({
      slots: [
        { frames: 15, text: 'opening' },
        { frames: 30, text: 'the walk', anchor: false },
        { frames: 15, text: 'closing' },
      ],
    });
    const long = pushInShot(8, { bestFrame: 30, embedding: unitVector(21) });
    const profiles: ShotProfile[] = [
      moments ? withMoments(long, moments) : long,
      pushInShot(4, { embedding: unitVector(22) }),
      pushInShot(4, { embedding: unitVector(23) }),
    ];
    const table = new Map(
      template.slots.map((slot, index) => [slot.intent.text, profiles[(index + 2) % 3]!.embedding]),
    );
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog(profiles),
      embedder: fakeEmbedder(table),
    });
    const cast = async (parts?: StatedPart[]) => {
      const result = await engine.cast({
        projectId: newId<'Project'>(),
        template,
        mode: 'template',
        variants: 1,
        seed: 1,
        ...(parts ? { parts } : {}),
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.value;
    };
    return { template, engine, cast, long: profiles[0]!, slotId: template.slots[1]!.id };
  }
  /** The 8 s shot: three seconds held, then five of the camera being handled. */
  const THREE_HELD: MomentDef[] = [
    { to: 90, note: 'A man stands by a gate.', fit: null },
    { to: 240, note: 'The camera swings down the street.', fit: null, handling: true },
  ];

  it('is not used by the cast: the clip plays a part that keeps off the stretch', async () => {
    const w = world(THREE_HELD);
    const stated = (await w.cast([{ slotId: w.slotId, shotId: w.long.shotId!, from: 5, to: 7 }])).variants[0]!
      .slots[1]!;
    expect(stated.pick!.shotId).toBe(w.long.shotId);
    expect(stated.pick!.sourceStart.value + 30).toBeLessThanOrEqual(90);
    // Without the describer's word the same part is kept (stated-parts.test.ts).
    const plain = world(null);
    const kept = (await plain.cast([{ slotId: plain.slotId, shotId: plain.long.shotId!, from: 5, to: 7 }]))
      .variants[0]!.slots[1]!;
    expect(kept.pick!.sourceStart.value).toBeGreaterThanOrEqual(150);
  });

  it('holds assembly’s step with the person off the stretch too', async () => {
    // The person stands for 3 s, then walks: left to itself the step moves the clip past 3 s.
    const fake = (assetId: string) => fakeSubjects(new Map([[assetId, standsThenWalks(3)]]));
    const plain = world(null);
    const free = await personInPoints(
      { subjects: fake(plain.long.assetId).source, profiles: plain.engine.profiles! },
      plain.template,
      await plain.cast(),
      config,
      5_000,
    );
    expect(free.cast.variants[0]!.slots[1]!.pick!.sourceStart.value).toBeGreaterThanOrEqual(90);
    const w = world(THREE_HELD);
    const held = await personInPoints(
      { subjects: fake(w.long.assetId).source, profiles: w.engine.profiles! },
      w.template,
      await w.cast(),
      config,
      5_000,
    );
    expect(held.cast.variants[0]!.slots[1]!.pick!.sourceStart.value + 30).toBeLessThanOrEqual(90);
  });
});
