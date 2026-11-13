// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V3 done-when: "5 variants of one template each differ in their hook and in ≥ 30% of picks; all from one
 * request". On the synthetic catalogue: 5 hook variants of a 12-slot template, each pair (and each against the
 * base) differing in the hook shot and in ≥ 4 picks; music and caption axes give distinct choices; locked and
 * picked clips kept; deterministic for one seed; shortfalls reported.
 */
import { newId, ok, timelineSchema, type MusicChoice, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { positions, videoItems, withVideoItems } from '../../src/model/sequence';
import { resyncToBeatMap } from '../../src/resync/resync';
import { shownBySlot } from '../../src/model/slot-shots';
import { slotsDiffering } from '../../src/variants/differences';
import { classicCaptions, variantWorld } from '../fixtures/variants';

const twelve = { slots: 12, perSlot: 8, distractors: 60, seed: 11 };

function expectPairwise(sets: readonly Timeline[], minimum: number) {
  for (let a = 0; a < sets.length; a++)
    for (let b = a + 1; b < sets.length; b++) {
      const left = sets[a];
      const right = sets[b];
      if (!left || !right) throw new Error('missing timeline');
      const differing = slotsDiffering(left, right);
      expect(differing.length, `${left.name} vs ${right.name}`).toBeGreaterThanOrEqual(minimum);
      const hook = [...shownBySlot(left).keys()][0];
      expect(differing, `${left.name} vs ${right.name}: the hook`).toContain(hook);
    }
}

/** The base with its clip in slot `index` locked, and slot `picked` marked as the user's pick. */
function withChoices(base: Timeline, locked: number, picked: number): Timeline {
  const items = [...videoItems(base)];
  const at = positions(items)[locked];
  if (!at || at.item.type !== 'clip') throw new Error('no clip to lock');
  items[at.itemIndex] = { ...at.item, locked: true };
  const pickedSlot = positions(items)[picked]?.item.slotId;
  const cast = base.cast && {
    ...base.cast,
    slots: base.cast.slots.map((slot) =>
      slot.slotId === pickedSlot ? { ...slot, note: 'userPick' as const } : slot,
    ),
  };
  return withVideoItems({ ...base, cast }, items);
}

describe('planVariants', () => {
  it('makes 5 hook variants of a 12-slot template that differ pairwise and from the base in the hook and ≥ 4 picks', async () => {
    const world = variantWorld(twelve);
    const base = await world.base();
    const plan = await world.plan(base, { count: 5, axes: ['hook'] });
    if (!plan.ok) throw new Error(plan.error.code);
    const { timelines, differences, variantsShort } = plan.value;
    expect(timelines).toHaveLength(5);
    expect(variantsShort).toBeNull();
    expectPairwise([base, ...timelines], 4);
    for (const [index, timeline] of timelines.entries()) {
      expect(timelineSchema.safeParse(timeline).success).toBe(true);
      expect(timeline.id).toBe(world.timelineIds[index]);
      expect(timeline.name).toBe(`Beach day · Variant ${index + 1}`);
      expect(timeline.cast).toMatchObject({ castId: world.castId, variantIndex: index + 1, variantCount: 5 });
      expect(timeline.revision).toBe(1);
      // Every item is the variant's own, and the cast points at the variant's clips.
      const ids = new Set(timeline.tracks.flatMap((track) => track.items.map((item) => item.id)));
      for (const track of base.tracks) for (const item of track.items) expect(ids.has(item.id)).toBe(false);
      for (const slot of timeline.cast?.slots ?? []) if (slot.clipId) expect(ids.has(slot.clipId)).toBe(true);
    }
    for (const difference of differences) {
      expect(difference.hookChanged).toBe(true);
      expect(difference.picksChanged).toBeGreaterThanOrEqual(4 / 12);
      expect(difference.music).toBeNull();
      expect(difference.captionPreset).toBeNull();
    }
    // The base is untouched, and the length and text of every variant follow the base's.
    expect(base.revision).toBe(1);
    for (const timeline of timelines)
      expect(timeline.tracks[2]?.items.length).toBe(base.tracks[2]?.items.length);
  });

  it('keeps the clips the user locked or picked', async () => {
    const world = variantWorld(twelve);
    const base = withChoices(await world.base(), 4, 7);
    const plan = await world.plan(base, { count: 5, axes: ['hook'] });
    if (!plan.ok) throw new Error(plan.error.code);
    const before = [...shownBySlot(base).entries()];
    const [, lockedShot] = before[4] ?? [];
    const [, pickedShot] = before[7] ?? [];
    for (const timeline of plan.value.timelines) {
      const shown = [...shownBySlot(timeline).values()];
      expect(shown[4]).toBe(lockedShot);
      expect(shown[7]).toBe(pickedShot);
    }
    expectPairwise([base, ...plan.value.timelines], 4);
  });

  it('is deterministic for one seed', async () => {
    const world = variantWorld(twelve);
    const base = await world.base();
    const first = await world.plan(base, { count: 3, axes: ['hook', 'captions'] });
    const again = await world.plan(base, { count: 3, axes: ['hook', 'captions'] });
    expect(first).toEqual(again);
  });

  it("gives each variant its own caption preset, never the base's, and refuses a base without captions", async () => {
    const world = variantWorld({ slots: 6, perSlot: 6, distractors: 20, seed: 7 });
    const base = { ...(await world.base()), captions: classicCaptions };
    const plan = await world.plan(base, { count: 4, axes: ['captions'] });
    if (!plan.ok) throw new Error(plan.error.code);
    const presets = plan.value.differences.map((difference) => difference.captionPreset);
    expect(presets).toEqual(['bold', 'boxed', 'karaoke', 'minimal']);
    for (const timeline of plan.value.timelines) expect(slotsDiffering(base, timeline)).toEqual([]);
    const short = await world.plan(base, {
      count: 5,
      axes: ['captions'],
      captionPresets: ['classic', 'bold'],
    });
    if (!short.ok) throw new Error(short.error.code);
    expect(short.value.variantsShort).toEqual({ axis: 'captions', asked: 5, made: 1 });
    const none = await world.plan({ ...base, captions: null }, { count: 2, axes: ['captions'] });
    expect(!none.ok && none.error.code).toBe('timeline.no_captions');
  });

  it("gives each variant its own music, the reel's with no acknowledgement and another template's passed over", async () => {
    const world = variantWorld({ slots: 6, perSlot: 6, distractors: 20, seed: 7 });
    const base = await world.base();
    const rate = base.canvas.rate;
    const track = (assetId = newId<'Asset'>()): MusicChoice => ({
      path: 'ownTrack',
      assetId,
      offset: { value: 0, rate },
      gainDb: 0,
    });
    const ownAsset = newId<'Asset'>();
    const own = track(ownAsset);
    const reel: MusicChoice = { path: 'referenceAudio', templateId: world.template.id, gainDb: 0 };
    const otherReel: MusicChoice = { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: 0 };
    const candidates = [base.music, otherReel, reel, own, track()];
    const beatMap = base.beatMap;
    const beatsAsked: string[] = [];
    const music = {
      trackBeats: async (assetId: string) => {
        beatsAsked.push(assetId);
        return ok(assetId === ownAsset ? beatMap : null);
      },
    };
    const plan = await world.plan(base, { count: 3, axes: ['music'], music: candidates }, { music });
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.differences.map((difference) => difference.music?.path)).toEqual([
      'referenceAudio',
      'ownTrack',
      'ownTrack',
    ]);
    expect(plan.value.timelines[0]?.music).toEqual(reel);
    // The base is on the reel's beats already: the reel's variant keeps its cuts.
    expect(plan.value.timelines[0]?.beatMap).toEqual(base.beatMap);
    expect(beatsAsked).toHaveLength(2);
    const fewer = await world.plan(base, { count: 3, axes: ['music'], music: [otherReel, own] }, { music });
    if (!fewer.ok) throw new Error(fewer.error.code);
    expect(fewer.value.variantsShort).toEqual({ axis: 'music', asked: 3, made: 1 });
  });

  it("puts a variant with the reel's music back on the reel's beats when the base follows an own track", async () => {
    const world = variantWorld({ slots: 6, perSlot: 6, distractors: 20, seed: 7 });
    const assembled = await world.base();
    const reelBeats = assembled.beatMap!;
    const shifted = { ...reelBeats, beats: reelBeats.beats.map((beat) => ({ ...beat, value: beat.value + 7 })) };
    const own: MusicChoice = { path: 'ownTrack', assetId: newId<'Asset'>(), offset: { value: 0, rate: reelBeats.rate }, gainDb: 0 };
    const base = { ...resyncToBeatMap(assembled, shifted), music: own };
    expect(base.beatMap).toEqual(shifted);
    const reel: MusicChoice = { path: 'referenceAudio', templateId: world.template.id, gainDb: 0 };
    const plan = await world.plan(base, { count: 2, axes: ['music'], music: [reel] });
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.timelines[0]?.music).toEqual(reel);
    expect(plan.value.timelines[0]?.beatMap).toEqual(world.template.beatMap);
  });

  it('combines the hook with the caption look on every variant', async () => {
    const world = variantWorld(twelve);
    const base = { ...(await world.base()), captions: classicCaptions };
    const plan = await world.plan(base, { count: 3, axes: ['captions', 'hook'] });
    if (!plan.ok) throw new Error(plan.error.code);
    for (const difference of plan.value.differences) {
      expect(difference.hookChanged).toBe(true);
      expect(difference.captionPreset).not.toBeNull();
    }
    expectPairwise([base, ...plan.value.timelines], 4);
  });

  it('reports the shortfall of a small library and makes none when the hook is locked', async () => {
    const small = variantWorld({ slots: 4, perSlot: 1, distractors: 2, seed: 3 });
    const base = await small.base();
    const plan = await small.plan(base, { count: 5, axes: ['hook'] });
    if (!plan.ok) throw new Error(plan.error.code);
    expect(plan.value.timelines.length).toBeLessThan(5);
    expect(plan.value.variantsShort).toEqual({ axis: 'hook', asked: 5, made: plan.value.timelines.length });

    const world = variantWorld(twelve);
    const locked = withChoices(await world.base(), 0, 0);
    const none = await world.plan(locked, { count: 2, axes: ['hook'] });
    expect(!none.ok && none.error.code).toBe('timeline.variants_none');
    // The other axes still apply; the hook's shortfall is reported.
    const captions = await world.plan(
      { ...locked, captions: classicCaptions },
      { count: 2, axes: ['hook', 'captions'] },
    );
    if (!captions.ok) throw new Error(captions.error.code);
    expect(captions.value.timelines).toHaveLength(2);
    expect(captions.value.variantsShort).toEqual({ axis: 'hook', asked: 2, made: 0 });
  });

  it('refuses a count outside 2–5', async () => {
    const world = variantWorld({ slots: 4, perSlot: 4, distractors: 4, seed: 5 });
    const base = await world.base();
    const one = await world.plan(base, { count: 1, axes: ['hook'] });
    expect(!one.ok && one.error.code).toBe('core.validation');
  });
});
