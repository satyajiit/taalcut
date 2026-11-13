// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM: timeline.slipClip on core's bus. The second of three one-second clips plays a made-up 10 s shot that
 * starts its file; the clip starts a third of a second in, as the owner's "starting up" clips did. Subject tracks
 * are made-up scenes (fixtures/people.ts).
 */
import {
  diffEdits,
  EDITOR_COMMANDS,
  editSnapshot,
  RationalTime,
  TimeRange,
  type CommandOrigin,
  type ShotProfile,
  type SubjectSource,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog } from '../../src/casting/catalog';
import { mediaRef } from '../../src/casting/result';
import { agentOrigin, commandWorld, ui } from '../fixtures/command-world';
import { makeProfile, unitVector } from '../fixtures/library';
import { fakeSubjects, standsThenWalks, type Scene } from '../fixtures/people';
import { buildTimeline, candidate, clipById } from '../fixtures/timeline';

const ms = (value: number) => RationalTime.of(value, { num: 1000, den: 1 });
const three = { clips: [{ frames: 30 }, { frames: 30 }, { frames: 30 }] };

/** A 10 s shot at 30 fps from its file's start; `fileFrames` long (default 30 frames past it). */
function shot(fileFrames?: number): ShotProfile {
  const base = makeProfile({ embedding: unitVector(3), frames: 300, peaks: [] });
  return fileFrames === undefined
    ? base
    : {
        ...base,
        available: TimeRange.of(
          RationalTime.zero(base.range.start.rate),
          RationalTime.of(fileFrames, base.range.start.rate),
        ),
      };
}

async function world(
  options: { profile?: ShotProfile; at?: number; locked?: boolean; subjects?: SubjectSource } = {},
) {
  const profile = options.profile ?? shot();
  const built = buildTimeline({
    ...three,
    clips: three.clips.map((clip, index) =>
      index === 1 ? { ...clip, locked: options.locked ?? false } : clip,
    ),
  });
  const id = built.ids[1]!;
  const video = built.timeline.tracks[0]!;
  if (video.kind !== 'video') throw new Error('no V1');
  const items = video.items.map((item) =>
    item.id === id && item.type === 'clip'
      ? {
          ...item,
          media: mediaRef(profile),
          sourceStart: RationalTime.of(options.at ?? 10, item.sourceStart.rate),
          syncPoint: null,
        }
      : item,
  );
  const clip = items.find((item) => item.id === id)!;
  const timeline: Timeline = {
    ...built.timeline,
    tracks: [{ ...video, items }, ...built.timeline.tracks.slice(1)],
    cast: built.timeline.cast && {
      ...built.timeline.cast,
      slots: built.timeline.cast.slots.map((slot) =>
        slot.clipId === id && clip.type === 'clip' ? { ...slot, pick: candidate(clip) } : slot,
      ),
    },
  };
  const made = commandWorld({
    catalog: createMemoryShotCatalog([profile]),
    ...(options.subjects ? { subjects: options.subjects } : {}),
  });
  const created = await made.dispatch('timeline.create', {
    projectId: timeline.projectId,
    timelines: [timeline],
  });
  if (!created.ok) throw new Error(created.error.code);
  const target = { projectId: timeline.projectId, timelineId: timeline.id };
  const doc = () => made.doc(timeline.id);
  const slip = (payload: Record<string, unknown>, origin: CommandOrigin = agentOrigin) =>
    made.dispatch(EDITOR_COMMANDS.slipClip, { ...target, clipId: id, ...payload }, origin);
  const inPoint = () => clipById(doc(), id).sourceStart.value;
  return { ...made, id, profile, doc, slip, inPoint, before: timeline, target };
}

/** Faces until `until` seconds, then the person turned away; standing still throughout. */
const facesUntil =
  (until: number): Scene =>
  (t) => ({ person: { x: 0.4, y: 0.4, width: 0.15, height: 0.4 }, face: t < until });

describe('timeline.slipClip by a time or to an in-point', () => {
  it('plays a later part of its shot in the same place for the same length, as one undo step', async () => {
    const w = await world();
    expect((await w.slip({ by: ms(2000) }, ui)).ok).toBe(true);
    const clip = clipById(w.doc(), w.id);
    expect([clip.sourceStart.value, clip.duration.value]).toEqual([70, 30]);
    expect(diffEdits(editSnapshot(w.before), editSnapshot(w.doc())).changes.map((row) => row.change)).toEqual(
      [{ kind: 'part', before: 0.333, after: 2.333 }],
    );
    // The person's own pick now: a later re-cast leaves it be.
    const slot = w.doc().cast!.slots.find((candidate) => candidate.clipId === w.id)!;
    expect([slot.pick!.sourceStart.value, slot.note]).toEqual([70, 'userPick']);
    await w.bus.undo(w.target.projectId, ui);
    expect(w.inPoint()).toBe(10);
    await w.bus.redo(w.target.projectId, ui);
    expect(w.inPoint()).toBe(70);
  });

  it('goes to an in-point, and says how far it can go when asked for too much', async () => {
    const w = await world();
    expect((await w.slip({ sourceStart: RationalTime.of(150, { num: 30, den: 1 }) })).ok).toBe(true);
    expect(w.inPoint()).toBe(150);
    const far = await w.slip({ by: ms(9000) });
    expect(!far.ok && far.error.detail).toBe(
      'This clip can play at most 4 s later or 5 s earlier in its shot.',
    );
    expect(w.inPoint()).toBe(150);
  });

  it('refuses a locked clip for the agent, not for the person', async () => {
    const locked = await world({ locked: true });
    const refused = await locked.slip({ by: ms(1000) });
    expect(!refused.ok && refused.error.code).toBe('timeline.clip_locked');
    expect((await locked.slip({ by: ms(1000) }, ui)).ok).toBe(true);
  });
});

describe('timeline.slipClip away from what the clip should not show', () => {
  it('keeps out of the recording’s first second for "start", with no tracks at all', async () => {
    const w = await world();
    expect((await w.slip({ avoid: ['start'] })).ok).toBe(true);
    expect(w.inPoint()).toBeGreaterThanOrEqual(30);
    expect(w.inPoint()).toBeLessThan(90);
  });

  it('waits for the person to be under way for "start"', async () => {
    const profile = shot();
    const fake = fakeSubjects(new Map([[profile.assetId, standsThenWalks(3)]]));
    const w = await world({ profile, at: 40, subjects: fake.source });
    expect((await w.slip({ avoid: ['start'] })).ok).toBe(true);
    // Half a second into the walk.
    expect(w.inPoint()).toBeGreaterThanOrEqual(105);
    // The span assembly tracks (six seconds either side, in the shot), then the clip's new part for its overlays.
    expect([fake.asked[0]!.start.value, fake.asked[0]!.end.value]).toEqual([0, 250]);
  });

  it('moves a second on the person’s word when nothing measured shows the start', async () => {
    const w = await world({ at: 150 });
    expect((await w.slip({ avoid: ['start'] })).ok).toBe(true);
    expect(w.inPoint()).toBeGreaterThanOrEqual(180);
  });

  it('keeps out of the recording’s last half second for "end", earlier', async () => {
    const w = await world({ profile: shot(300), at: 265 });
    expect((await w.slip({ avoid: ['end'] })).ok).toBe(true);
    expect(w.inPoint()).toBeLessThanOrEqual(255);
    const first = await world({ at: 0 });
    const none = await first.slip({ avoid: ['end'] });
    expect(!none.ok && none.error.detail).toMatch(/already plays the first part of its shot/);
  });

  it('finds a part with no face for "face", inside the span it tracked', async () => {
    const profile = shot();
    const fake = fakeSubjects(new Map([[profile.assetId, facesUntil(4)]]));
    const w = await world({ profile, at: 30, subjects: fake.source });
    expect((await w.slip({ avoid: ['face'] })).ok).toBe(true);
    expect(w.inPoint()).toBeGreaterThanOrEqual(120);
    expect(w.inPoint() + 30).toBeLessThanOrEqual(240);
  });

  it('refuses "face" when every part shows one, or there is no way to look', async () => {
    const profile = shot();
    const everywhere = fakeSubjects(new Map([[profile.assetId, facesUntil(99)]]));
    const all = await world({ profile, at: 30, subjects: everywhere.source });
    const none = await all.slip({ avoid: ['face'] });
    expect(!none.ok && none.error.detail).toMatch(/shows a face as much as the clip does now/);
    expect(all.inPoint()).toBe(30);
    const blind = await world({ at: 30 });
    const unknown = await blind.slip({ avoid: ['face'] });
    expect(!unknown.ok && unknown.error.detail).toMatch(/can’t look for faces/);
    const late = fakeSubjects(new Map([[profile.assetId, facesUntil(4)]]), { tracks: false });
    const waiting = await world({ profile, at: 30, subjects: late.source });
    const still = await waiting.slip({ avoid: ['face'] });
    expect(!still.ok && still.error.detail).toMatch(/still looking for faces/);
  });
});
