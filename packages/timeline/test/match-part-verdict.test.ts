// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MOM1: the part of its shot a draft clip plays, against what its slot states, for render QA's `slotPart`. A clip
 * on the stretch that shows something else misses and is told where the better part starts; one on the stretch that
 * fits is met; a shot without moments, a photo and a slot that states nothing have no verdict. Read from made-up
 * profiles and a table embedder: no vision model, no frame.
 *
 * MOM2: a clip that rests on a stretch the describer stated as the camera being handled misses whatever its slot
 * states, and is sent to the clear part that fits best; a part the person picked by hand is never read.
 */
import { ok, type Clip, type ShotProfile, type Template, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { partVerdict } from '../src/match/part-verdict';
import { slotShots } from '../src/match/slot-shots';
import { videoItems, withVideoItems } from '../src/model/sequence';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { ASK, ASK_SET, axis, OTHER_ASKS, withMoments } from './fixtures/moments';
import { buildTemplate } from './fixtures/template';
import { buildTimeline } from './fixtures/timeline';

const inPoint = CASTING_CONFIG.inPoint;
const content = inPoint.content;
const INTENT = 'Boarding passes held up in a hall';

/**
 * Four one-second slots, each saying something else (a part is read by how it stands out among what the template's
 * slots state). The first clip plays its shot, which has moments, from frame `from`; the second's shot has none.
 */
function world(from: number, moments = true, handling = false) {
  const template: Template = buildTemplate({
    slots: [
      { frames: 30, text: INTENT },
      { frames: 30, text: 'A beach at noon' },
      { frames: 30, text: 'A night street' },
      { frames: 30, text: 'A meal on a table' },
    ],
  });
  const base = buildTimeline({ clips: [{ frames: 30, sourceStart: from }, { frames: 30 }] }).timeline;
  const items = videoItems(base).map((item, index) =>
    item.type === 'clip' ? { ...item, slotId: template.slots[index]!.id } : item,
  );
  const timeline: Timeline = withVideoItems(base, items);
  const clips = videoItems(timeline).filter((item): item is Clip => item.type === 'clip');
  const profileOf = (clip: Clip, seed: number): ShotProfile => ({
    ...makeProfile({ embedding: unitVector(seed), frames: 300 }),
    assetId: clip.media.assetId,
    shotId: clip.media.kind === 'video' ? clip.media.shotId : null,
  });
  const plain = profileOf(clips[0]!, 1);
  const first = moments
    ? withMoments(plain, [
        { to: 170, note: 'Hands hold up boarding passes in a hall.', fit: 0.8 },
        { to: 240, note: 'The camera tilts down, the picture blurred.', fit: 0.45 },
        // MOM2: with `handling`, the describer stated the last two seconds as the camera being lowered.
        {
          to: 300,
          note: 'The floor, with shoes and suitcases.',
          fit: 0.3,
          ...(handling ? { handling: true } : {}),
        },
      ])
    : plain;
  const all = [first, profileOf(clips[1]!, 2)];
  const profiles = {
    profiles: async (refs: readonly { assetId: string; shotId: string | null }[]) =>
      ok(all.filter((profile) => refs.some((ref) => ref.shotId === profile.shotId))),
  };
  const table = new Map([
    [INTENT, ASK],
    ['A beach at noon', axis(4)],
    ['A night street', OTHER_ASKS[0]],
    ['A meal on a table', OTHER_ASKS[1]],
  ]);
  return { template, timeline, clips, first, profiles, embedder: fakeEmbedder(table) };
}

describe('the part of its shot a clip plays', () => {
  it('misses on the stretch that shows something else, and says where the better part starts', async () => {
    const w = world(250);
    const shots = await slotShots(w.timeline, w.template, { profiles: w.profiles, embedder: w.embedder });
    if (!shots.ok) throw new Error(shots.error.code);
    // Frame 250 of a 30 fps shot from the file's start: 8.33 s. The best second-long part starts at the top.
    expect(shots.value[0]?.part).toEqual({ met: false, under: 0.5, playsFrom: 8.33, betterFrom: 0 });
    // The second slot's shot has no moments: no verdict, and its entry is as it was before MOM1.
    expect(shots.value[1]).toEqual({
      clipId: w.clips[1]!.id,
      slotId: w.template.slots[1]!.id,
      motion: 'handheld',
      needs: [],
    });
  });

  it('is met on the stretch that fits, and within the margin of it', async () => {
    const on = world(100);
    const shots = await slotShots(on.timeline, on.template, { profiles: on.profiles, embedder: on.embedder });
    expect(shots.ok && shots.value[0]?.part).toEqual({ met: true, under: 0, playsFrom: 3.33, betterFrom: 0 });
    // Three frames of thirty into the blurred tilt: 0.35 under for a tenth of the window, under the margin.
    const edge = world(143);
    const verdict = partVerdict(
      edge.clips[0]!,
      edge.first,
      { intentVector: ASK, needs: [], askSet: ASK_SET },
      edge.timeline.canvas.rate,
      inPoint,
    )!;
    expect(verdict.under).toBeCloseTo((3 * 0.35) / 30, 3);
    expect(verdict.under).toBeLessThan(content.missMargin);
    expect(verdict.met).toBe(true);
  });

  it('has no verdict without moments, without an embedder, or for a slot that states nothing', async () => {
    const plain = world(250, false);
    const none = await slotShots(plain.timeline, plain.template, {
      profiles: plain.profiles,
      embedder: plain.embedder,
    });
    expect(none.ok && none.value[0]?.part).toBeUndefined();
    const w = world(250);
    const wordsOnly = await slotShots(w.timeline, w.template, { profiles: w.profiles });
    expect(wordsOnly.ok && wordsOnly.value[0]?.part).toBeUndefined();
    expect(partVerdict(w.clips[0]!, w.first, { needs: [] }, w.timeline.canvas.rate, inPoint)).toBeNull();
    // A photo in the slot has no part to play.
    const photo = { ...w.first, kind: 'image' as const };
    expect(
      partVerdict(
        w.clips[0]!,
        photo,
        { intentVector: ASK, needs: [], askSet: ASK_SET },
        w.timeline.canvas.rate,
        inPoint,
      ),
    ).toBeNull();
  });

  it('misses on a stretch where the camera is being handled, and is sent to the clear part that fits', async () => {
    const w = world(255, true, true);
    const shots = await slotShots(w.timeline, w.template, { profiles: w.profiles, embedder: w.embedder });
    if (!shots.ok) throw new Error(shots.error.code);
    // All of its second lies in the lowering. The best clear second is anywhere in the first stretch: the nearest
    // to where it plays, frames 140 to 170 (4.67 s).
    expect(shots.value[0]?.part).toEqual({
      met: false,
      under: 0.76,
      playsFrom: 8.5,
      betterFrom: 4.67,
      handling: 1,
    });
    // It needs nothing stated: the same clip in a slot that states nothing still misses, and slips the least.
    expect(partVerdict(w.clips[0]!, w.first, { needs: [] }, w.timeline.canvas.rate, inPoint)).toEqual({
      met: false,
      under: 0,
      playsFrom: 8.5,
      betterFrom: 7,
      handling: 1,
    });
    // A clip on the held part of the same shot is met, and a few frames into the lowering are let be.
    const clear = world(100, true, true);
    expect(
      partVerdict(clear.clips[0]!, clear.first, { needs: [] }, clear.timeline.canvas.rate, inPoint),
    ).toMatchObject({ met: true, betterFrom: 3.33 });
    const edge = world(214, true, true);
    expect(
      partVerdict(edge.clips[0]!, edge.first, { needs: [] }, edge.timeline.canvas.rate, inPoint),
    ).toMatchObject({ met: true });
  });

  it('never sends a clip to a handling stretch as the better part', async () => {
    // Without the describer's word, the floor is the best part for a slot that asks for it.
    const asks = { intentVector: axis(1), needs: [], askSet: [[axis(1)], ...ASK_SET.slice(1)] };
    const filmed = world(100);
    expect(
      partVerdict(filmed.clips[0]!, filmed.first, asks, filmed.timeline.canvas.rate, inPoint),
    ).toMatchObject({ met: false, betterFrom: 8 });
    const lowered = world(100, true, true);
    const verdict = partVerdict(
      lowered.clips[0]!,
      lowered.first,
      asks,
      lowered.timeline.canvas.rate,
      inPoint,
    )!;
    expect(verdict.betterFrom).toBeLessThanOrEqual(7);
    expect(verdict.handling).toBeUndefined();
  });

  it('does not read a part the person picked by hand', async () => {
    const w = world(255, true, true);
    const read = async (timeline: Timeline) => {
      const shots = await slotShots(timeline, w.template, { profiles: w.profiles, embedder: w.embedder });
      if (!shots.ok) throw new Error(shots.error.code);
      return shots.value[0];
    };
    expect((await read(w.timeline))?.part?.met).toBe(false);
    // The person's own slip or swap marks the clip's cast slot `userPick`; a lock is on the clip itself.
    const clipId = w.clips[0]!.id;
    const picked: Timeline = {
      ...w.timeline,
      cast: {
        ...w.timeline.cast!,
        slots: w.timeline.cast!.slots.map((slot) =>
          slot.clipId === clipId ? { ...slot, note: 'userPick' as const } : slot,
        ),
      },
    };
    expect((await read(picked))?.part).toBeUndefined();
    const locked = withVideoItems(
      w.timeline,
      videoItems(w.timeline).map((item) => (item.id === clipId ? { ...item, locked: true } : item)),
    );
    expect((await read(locked))?.part).toBeUndefined();
  });

  it('does not read a part in a slot that states a moment for its edge (MATCH1)', async () => {
    const w = world(255, true, true);
    const read = async (template: Template) => {
      const shots = await slotShots(w.timeline, template, { profiles: w.profiles, embedder: w.embedder });
      if (!shots.ok) throw new Error(shots.error.code);
      return shots.value;
    };
    expect((await read(w.template))[0]?.part?.met).toBe(false);
    // The instant on the cut decides which part plays there: a better part elsewhere would take it off the cut.
    const lands = { edge: 'end', moment: 'The passes are held up' } as const;
    const stating = (index: number): Template => ({
      ...w.template,
      slots: w.template.slots.map((slot, at) => (at === index ? { ...slot, lands } : slot)),
    });
    const shots = await read(stating(0));
    expect(shots[0]?.part).toBeUndefined();
    // The slot's needs are read all the same, and another slot's statement changes nothing here.
    expect(shots[0]?.needs).toEqual((await read(w.template))[0]?.needs);
    expect((await read(stating(1)))[0]?.part?.met).toBe(false);
  });
});
