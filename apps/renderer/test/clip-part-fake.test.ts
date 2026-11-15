// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the fake behind "pick the part". timeline.slipClip moves the part inside the clip's shot (place and
 * length kept, the cast's pick following, ⌘Z putting it back) and refuses to leave it; timeline.swapClip takes a
 * clip to another shot of its own file; `clipPart: 'samples'` puts the sample clips in Golden hour's first scenes.
 */
import {
  callRpc,
  EDITOR_COMMANDS,
  RationalTime,
  TIMELINE_COMMANDS,
  type Clip,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { fileShots } from '../src/backend/fake/make/shot-pool';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;

function setup(areas?: Record<string, unknown>) {
  const { client } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0, ...(areas ? { areas } : {}) },
  });
  const run = (name: string, payload: Record<string, unknown>) =>
    callRpc(client.commands.dispatch({ name, payload: { projectId, timelineId, ...payload }, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId, source: 'ui' }));
  const timeline = () => client.timelines.get({ timelineId });
  return { client, run, undo, timeline };
}

const clips = (timeline: Timeline) =>
  timeline.tracks[0]!.items.filter((item): item is Clip => item.type === 'clip');
const video = (clip: Clip) => {
  if (clip.media.kind !== 'video') throw new Error('a video clip was expected');
  return clip.media;
};
/** The clip's shot in its file, and the first frames the clip may start on inside it (media frames). */
function shotOf(clip: Clip) {
  const media = video(clip);
  const shot = fileShots(media.assetId).find((each) => each.candidate.shotId === media.shotId)!;
  const rate = clip.sourceStart.rate;
  const first = RationalTime.rescale(shot.shot.start, rate, 'round').value;
  const length = RationalTime.rescale(shot.shot.duration, rate, 'round').value;
  const needs = RationalTime.rescale(clip.duration, rate, 'ceil').value;
  return { shot, rate, first, last: first + length - needs };
}

describe('the part a clip plays, in the fake (TRIM1)', () => {
  it('plays another part of the same shot: place and length kept, the pick following, and ⌘Z back', async () => {
    const s = setup();
    const before = await s.timeline();
    const clip = clips(before)[1]!;
    const { rate, first, last } = shotOf(clip);
    const to = clip.sourceStart.value === first ? last : first;
    expect(to).not.toBe(clip.sourceStart.value);
    const result = await s.run(EDITOR_COMMANDS.slipClip, {
      clipId: clip.id,
      sourceStart: RationalTime.of(to, rate),
    });
    expect(result.ok).toBe(true);
    const after = await s.timeline();
    const moved = clips(after)[1]!;
    expect(moved.sourceStart).toEqual(RationalTime.of(to, rate));
    expect(moved.duration).toEqual(clip.duration);
    expect(video(moved).shotId).toBe(video(clip).shotId);
    expect(clips(after).map((each) => each.id)).toEqual(clips(before).map((each) => each.id));
    const slot = after.cast?.slots.find((each) => each.clipId === clip.id);
    expect(slot?.pick?.sourceStart).toEqual(RationalTime.of(to, rate));
    expect(slot?.note).toBe('userPick');
    await s.undo();
    expect(clips(await s.timeline())[1]).toEqual(clip);
  });

  it('refuses a part outside the clip’s shot, and leaves the timeline as it was', async () => {
    const s = setup();
    const before = await s.timeline();
    const clip = clips(before)[1]!;
    const { rate, last } = shotOf(clip);
    const result = await s.run(EDITOR_COMMANDS.slipClip, {
      clipId: clip.id,
      sourceStart: RationalTime.of(last + 1, rate),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeline.invalid_move');
    expect((await s.timeline()).revision).toBe(before.revision);
  });

  it('moves by a signed time too', async () => {
    const s = setup();
    const clip = clips(await s.timeline())[1]!;
    const { rate, first } = shotOf(clip);
    const by = clip.sourceStart.value > first ? -1 : 1;
    await s.run(EDITOR_COMMANDS.slipClip, { clipId: clip.id, by: RationalTime.of(by, rate) });
    expect(clips(await s.timeline())[1]!.sourceStart.value).toBe(clip.sourceStart.value + by);
  });

  it('takes a clip to another shot of its own file, at the frame asked for', async () => {
    const s = setup();
    const before = await s.timeline();
    // A clip whose file has another shot long enough for it.
    const found = clips(before)
      .map((clip) => {
        const media = video(clip);
        const rate = clip.sourceStart.rate;
        const needs = RationalTime.rescale(clip.duration, rate, 'ceil').value;
        const other = fileShots(media.assetId).find(
          (shot) =>
            shot.candidate.shotId !== media.shotId &&
            RationalTime.rescale(shot.shot.duration, rate, 'floor').value >= needs,
        );
        return other ? { clip, other, rate } : null;
      })
      .find((each) => each !== null);
    expect(found).toBeTruthy();
    const { clip, other, rate } = found!;
    const sourceStart = RationalTime.rescale(other.shot.start, rate, 'ceil');
    const result = await s.run(TIMELINE_COMMANDS.swapClip, {
      clipId: clip.id,
      media: { assetId: video(clip).assetId, shotId: other.candidate.shotId },
      sourceStart,
      from: 'search',
    });
    expect(result.ok).toBe(true);
    const moved = clips(await s.timeline()).find((each) => each.id === clip.id)!;
    expect(video(moved).assetId).toBe(video(clip).assetId);
    expect(video(moved).shotId).toBe(other.candidate.shotId);
    expect(moved.sourceStart).toEqual(sourceStart);
    expect(moved.duration).toEqual(clip.duration);
  });

  it('puts the sample clips in Golden hour’s first scenes when asked, and nowhere else', async () => {
    const plain = clips(await setup().timeline());
    const s = setup({ clipPart: 'samples' });
    const sampled = clips(await s.timeline());
    expect(sampled.map((clip) => clip.duration)).toEqual(plain.map((clip) => clip.duration));
    const first = sampled[0]!;
    expect(video(first).assetId).not.toBe(video(plain[0]!).assetId);
    // A sample clip is its files: a real filmstrip and a copy to play.
    const detail = await callRpc(s.client.library.asset({ assetId: video(first).assetId }));
    expect(detail.ok && detail.value.filmstrip).toBeTruthy();
    expect(detail.ok && detail.value.playback).toBeTruthy();
    // The part sits inside the shot the clip names.
    const { first: low, last: high } = shotOf(first);
    expect(first.sourceStart.value).toBeGreaterThanOrEqual(low);
    expect(first.sourceStart.value).toBeLessThanOrEqual(high);
    expect(sampled.at(-1)).toEqual(plain.at(-1));
  });
});
