// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the part of a shot a slot plays is chosen by what it shows (SPEC, "MOM1: the part of a shot"). Made-up
 * shots whose moments' notes sit at known cosines to what the slot states: the sharp, moving stretch that shows
 * something else loses to the softer stretch that shows it; a slot that hides the face does not take an empty
 * stretch that shows something else; and a shot without moments is chosen as before.
 */
import { FrameRates, RationalTime, type ShotProfile, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { inPointWithPerson } from '../src/assembly/person-in-points';
import { CASTING_CONFIG } from '../src/casting/config';
import { selectInPoint } from '../src/casting/in-points';
import { contentPenalty, missCost, partFit, slotAsks, withAskSet } from '../src/casting/moment-fit';
import { slotSpecs, type SlotSpec } from '../src/casting/slots';
import { makeProfile, unitVector } from './fixtures/library';
import { ASK, ASK_SET, axis, fits, OTHER_ASKS, withMoments } from './fixtures/moments';
import { pushInShot, spanOf, type Scene } from './fixtures/people';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const content = config.inPoint.content;
const fps30 = FrameRates.fps30;

/** A one-second slot with no beat anchor, which states something (`ASK`) among slots that state other things. */
function askingSlot(template: Template = oneSecond()): SlotSpec {
  return { ...slotSpecs(template, config)[1]!, intentVector: ASK, askSet: ASK_SET };
}
/** A note's fit for that slot: its cosine to the ask less the margin (the other slots sit away from every note). */
const lift = (cosine: number) => cosine - content.margin;
const read = (shot: ShotProfile, asks: readonly Float32Array[] = [ASK], set = ASK_SET) =>
  partFit(shot, asks, set, content.margin);
function oneSecond(text = 'Boarding passes held up in a hall', anchor = false): Template {
  return buildTemplate({ slots: [{ frames: 15 }, { frames: 30, text, anchor }, { frames: 15 }] });
}

/** 10 s at 30 fps: the first half sharp with a peak every second, the second half soft and flat. */
function sharpThenSoft(): ShotProfile {
  const base = makeProfile({ embedding: unitVector(5), frames: 300, peaks: [45, 75, 105] });
  return {
    ...base,
    sharpnessCurve: base.sharpnessCurve!.map((_, index) => (index < 50 ? 0.95 : 0.55)),
    motionCurve: base.motionCurve!.map((value, index) => (index < 50 ? value : 0.2)),
    bestFrame: 60,
  };
}

const startOf = (point: { sourceStart: RationalTime } | null) => point!.sourceStart.value;
/** A window may keep a frame or two of the stretch next door: a share of it within the slack costs nothing. */
const EDGE = 2;

describe('how well a part of a shot shows what a slot states', () => {
  const shot = withMoments(sharpThenSoft(), [
    { to: 150, note: 'The floor, with shoes and suitcases.', fit: 0.3 },
    { to: 300, note: 'Hands hold up boarding passes in a hall.', fit: 0.8 },
  ]);

  it('reads each moment against the ask, a window by the time each moment plays in it', () => {
    const parts = read(shot)!;
    expect(parts.moments[0]).toBeCloseTo(lift(0.3), 5);
    expect(parts.moments[1]).toBeCloseTo(lift(0.8), 5);
    expect(parts.fit(0, 30)).toBeCloseTo(lift(0.3), 5);
    // A third in the first moment, two thirds in the second.
    expect(parts.fit(140, 170)).toBeCloseTo((10 * lift(0.3) + 20 * lift(0.8)) / 30, 5);
    expect(parts.best(30)).toEqual({ start: 150, fit: expect.closeTo(lift(0.8), 5) });
  });

  it('reads a note by how far it stands out for this slot, not by how near it sits to every slot', () => {
    // A note that sits as near each of the three slots (a blurred picture, in camera words) and one that names what
    // this slot alone asks for: the first is nearer the ask, and still says nothing about this slot.
    const near = Math.sqrt(1 / 3);
    const everywhere = new Float32Array(axis(0).length);
    for (const index of [0, 2, 3]) everywhere[index] = near;
    const base = sharpThenSoft();
    const hub = {
      ...base,
      moments: [
        { start: 0, end: 150, note: 'The picture blurs as the camera turns.', vector: everywhere },
        { start: 150, end: 300, note: 'Hands hold up boarding passes.', vector: fits(0.5) },
      ],
    };
    const parts = read(hub)!;
    expect(near).toBeGreaterThan(0.5);
    expect(parts.moments[0]).toBe(0);
    expect(parts.moments[1]).toBeCloseTo(lift(0.5), 5);
    expect(parts.best(30).start).toBe(150);
    // Under the margin a note doesn't stand out: neither part is preferred, and nothing moves.
    const faint = withMoments(base, [
      { to: 150, note: 'A hall.', fit: content.margin / 2 },
      { to: 300, note: 'Another hall.', fit: content.margin },
    ]);
    expect(read(faint)!.moments).toEqual([0, 0]);
    expect(contentPenalty(faint, askingSlot(), 30, content)!(0)).toBe(0);
  });

  it('needs three slots that state something to tell what stands out', () => {
    expect(read(shot, [ASK], [[ASK], [OTHER_ASKS[0]]])).toBeNull();
    expect(partFit(shot, [ASK], undefined, content.margin)).toBeNull();
    const specs = withAskSet([
      { intentVector: ASK, needs: [] },
      { intentVector: null, needs: [] },
      { intentVector: OTHER_ASKS[0], needs: [] },
      { needs: [{ text: 'a suitcase', stems: ['suitcase'], vector: OTHER_ASKS[1] }] },
    ]);
    // Every slot carries the same set: the three that state something.
    expect(specs.map((spec) => spec.askSet.length)).toEqual([3, 3, 3, 3]);
    expect(partFit(shot, slotAsks(specs[0]!), specs[0]!.askSet, content.margin)).not.toBeNull();
  });

  it('counts the intent and every need: a moment fits by their mean', () => {
    const slot = {
      intentVector: ASK,
      needs: [{ text: 'a boarding pass', stems: ['boarding', 'pass'], vector: fits(0.6) }],
    };
    expect(slotAsks(slot)).toHaveLength(2);
    // The second moment's note is `fits(0.8)`: 0.8 to the intent, and to the need its cosine to `fits(0.6)`.
    const toNeed = 0.8 * 0.6 + Math.sqrt(1 - 0.64) * Math.sqrt(1 - 0.36);
    const set = [slotAsks(slot), [OTHER_ASKS[0]], [OTHER_ASKS[1]]];
    expect(read(shot, slotAsks(slot), set)!.moments[1]).toBeCloseTo(lift((0.8 + toNeed) / 2), 5);
  });

  it('has nothing to say without an ask, without moments, or with fewer than two embedded notes', () => {
    expect(read(shot, [])).toBeNull();
    expect(read(sharpThenSoft())).toBeNull();
    const one = withMoments(sharpThenSoft(), [{ to: 300, note: 'A hall.', fit: 0.8 }]);
    expect(read(one)).toBeNull();
    const waiting = withMoments(sharpThenSoft(), [
      { to: 150, note: 'The floor.', fit: 0.3 },
      { to: 300, note: 'Not embedded yet.', fit: null },
    ]);
    expect(read(waiting)).toBeNull();
    expect(contentPenalty(waiting, askingSlot(), 30, content)).toBeNull();
    // A note still waiting for its vector reads as the others' mean, so it neither wins nor loses by being unread.
    const mixed = withMoments(sharpThenSoft(), [
      { to: 100, note: 'The floor.', fit: 0.3 },
      { to: 200, note: 'Not embedded yet.', fit: null },
      { to: 300, note: 'Boarding passes.', fit: 0.8 },
    ]);
    expect(read(mixed)!.moments[1]).toBeCloseTo(lift(0.55), 5);
  });

  it('costs nothing within the slack of the best part, all of the weight from the scale under it', () => {
    expect(missCost(0, content)).toBe(0);
    expect(missCost(content.slack, content)).toBe(0);
    expect(missCost(content.scale, content)).toBeCloseTo(content.weight, 9);
    expect(missCost(1, content)).toBeCloseTo(content.weight, 9);
    const half = (content.slack + content.scale) / 2;
    expect(missCost(half, content)).toBeCloseTo(content.weight / 2, 9);
    // More than a face the slot hides: an empty stretch never wins by being empty (person terms' faceWeight).
    expect(content.weight).toBeGreaterThan(config.inPoint.subjects.faceWeight);
  });
});

describe('the in-point with what the window shows', () => {
  it('plays the softer stretch that shows what the slot states, not the sharp, moving one that does not', () => {
    const slot = askingSlot();
    const plain = sharpThenSoft();
    // Before MOM1 (no moments): the sharp half, near the best frame.
    expect(startOf(selectInPoint(plain, slot, fps30, config, false))).toBeLessThan(120);
    const shot = withMoments(plain, [
      { to: 150, note: 'The floor, with shoes and suitcases.', fit: 0.3 },
      { to: 300, note: 'Hands hold up boarding passes in a hall.', fit: 0.8 },
    ]);
    expect(startOf(selectInPoint(shot, slot, fps30, config, false))).toBeGreaterThanOrEqual(150 - EDGE);
    // The other way round, the sharp half shows it: nothing moves.
    const fitsFirst = withMoments(plain, [
      { to: 150, note: 'Hands hold up boarding passes in a hall.', fit: 0.8 },
      { to: 300, note: 'The floor, with shoes and suitcases.', fit: 0.3 },
    ]);
    expect(startOf(selectInPoint(fitsFirst, slot, fps30, config, false))).toBe(
      startOf(selectInPoint(plain, slot, fps30, config, false)),
    );
  });

  it('never lets a peak on the beat win a stretch that shows something else', () => {
    const anchored = askingSlot(oneSecond('Boarding passes', true));
    expect(anchored.anchorRel).not.toBeNull();
    const plain = sharpThenSoft();
    expect(selectInPoint(plain, anchored, fps30, config, false)?.aligned).toBe(true);
    const shot = withMoments(plain, [
      { to: 150, note: 'The floor.', fit: 0.3 },
      { to: 300, note: 'Boarding passes held up.', fit: 0.8 },
    ]);
    const point = selectInPoint(shot, anchored, fps30, config, false)!;
    // Every peak is in the first half: the clip plays the second with no sync point.
    expect(startOf(point)).toBeGreaterThanOrEqual(150 - EDGE);
    expect(point.aligned).toBe(false);
  });

  it('leaves the choice as it was when the parts fit about equally, or the slot states nothing', () => {
    const plain = sharpThenSoft();
    const before = startOf(selectInPoint(plain, askingSlot(), fps30, config, false));
    const alike = withMoments(plain, [
      { to: 150, note: 'A hall with travellers.', fit: 0.7 },
      { to: 300, note: 'Travellers in a hall.', fit: 0.7 + content.slack / 2 },
    ]);
    expect(startOf(selectInPoint(alike, askingSlot(), fps30, config, false))).toBe(before);
    const apart = withMoments(plain, [
      { to: 150, note: 'The floor.', fit: 0.3 },
      { to: 300, note: 'Boarding passes held up.', fit: 0.8 },
    ]);
    const silent = slotSpecs(oneSecond(), config)[1]!;
    expect(silent.intentVector).toBeUndefined();
    expect(startOf(selectInPoint(apart, silent, fps30, config, false))).toBe(before);
  });
});

describe('a slot that shows no face', () => {
  /** A person, face to the camera, for the first 6 s of 12; then nobody. */
  const faceFirst: Scene = (t) =>
    t < 6 ? { person: { x: 0.4, y: 0.3, width: 0.2, height: 0.5 }, face: true } : {};
  const template = oneSecond('A boarding pass held up to the camera');
  const whole = (assetId: string) => ({
    assetId: assetId as never,
    start: RationalTime.of(0, fps30),
    end: RationalTime.of(360, fps30),
  });
  const choose = (profile: ShotProfile, current?: number) =>
    inPointWithPerson({
      profile,
      slot: askingSlot(template),
      template,
      span: spanOf(faceFirst, 0, 12),
      range: whole(profile.assetId),
      config,
      wants: { noFace: true },
      ...(current !== undefined ? { current } : {}),
    });

  it('does not take the empty stretch that shows something else, merely for being empty', () => {
    const plain = pushInShot(12, { bestFrame: 60, faceCount: 1 });
    // Before MOM1: the window with no face in it, whatever it shows.
    expect(startOf(choose(plain))).toBeGreaterThanOrEqual(180);
    const shot = withMoments(plain, [
      { to: 180, note: 'A woman holds a boarding pass up to the camera.', fit: 0.8 },
      { to: 360, note: 'The floor of the hall.', fit: 0.3 },
    ]);
    // The stretch that shows what the slot states plays, face and all; a clip already there stays.
    expect(startOf(choose(shot)) + 30).toBeLessThanOrEqual(180 + EDGE);
    expect(choose(shot, 60)).toBeNull();
    // A clip the cast left on the empty floor moves back to what the slot states.
    expect(startOf(choose(shot, 240)) + 30).toBeLessThanOrEqual(180 + EDGE);
  });

  it('takes the stretch with no face when it shows what the slot states as well', () => {
    const shot = withMoments(pushInShot(12, { bestFrame: 60, faceCount: 1 }), [
      { to: 180, note: 'A woman holds a boarding pass up to the camera.', fit: 0.8 },
      { to: 360, note: 'A boarding pass held up, nobody in view.', fit: 0.796 },
    ]);
    expect(startOf(choose(shot))).toBeGreaterThanOrEqual(180);
    expect(startOf(choose(shot, 60))).toBeGreaterThanOrEqual(180);
  });
});
