// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: a slot the template states as the reel's own footage (a film scene, a meme clip) is filled by the tools.
 * `timeline.cast` asks the library for nothing there and notes it `reelKept`; `timeline.assemble` puts a clip of
 * the template's reel at the slot's exact frames, whole in the frame, muted, with no gap; the person's clips go only
 * in the other slots. The owner's reel is the first case: their clip, then two shots of a film.
 */
import { RationalTime, type Clip, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { CASTING_CONFIG } from '../src/casting/config';
import { checkCast } from '../src/skills/skills';
import { REEL_KEPT_WORDS } from '../src/tools/cast-answer';
import { agentWorldOver } from './fixtures/agent';
import { askedFor, FILM_REASON, reelSource, reelWorld, type ReelWorldDef } from './fixtures/reel';

type SlotRow = { slotId: string; note: string | null; assetId: string | null; alternates: unknown[] };

async function made(def: ReelWorldDef, extra: Record<string, unknown> = {}) {
  const cast = reelWorld(def);
  const reel = reelSource();
  const w = agentWorldOver(cast, { keptAudio: true, reel: reel.source });
  const target = { projectId: w.projectId, template: { id: cast.template.id }, ...extra };
  const read = await w.call('timeline.cast', target);
  if (!read.ok) throw new Error(read.error.code);
  const assembled = await w.call('timeline.assemble', target);
  if (!assembled.ok) throw new Error(assembled.error.code);
  const timeline = w.store.docs.get((assembled.value.timelineIds as string[])[0]!)!;
  const rows = (read.value.variants as { slots: SlotRow[] }[])[0]!.slots;
  return { cast, reel, w, rows, answer: read.value, assembled: assembled.value, timeline };
}

const video = (timeline: Timeline) =>
  timeline.tracks.flatMap((track) => (track.kind === 'video' ? track.items : []));
const clipsOf = (timeline: Timeline) => video(timeline).filter((item): item is Clip => item.type === 'clip');
const frames = (clip: Clip) => [clip.sourceStart.value, clip.duration.value];

describe('a slot that keeps the reel’s own footage (KEEP1)', () => {
  it('the owner’s reel: their clip, then two clips of the reel at the slots’ exact frames, and no gap', async () => {
    const { cast, reel, rows, answer, assembled, timeline, w } = await made({ kept: [1, 2] });
    // The cast: nothing picked for the two film slots, by statement, and the library never asked for them.
    expect(rows.map((row) => row.note)).toEqual([null, 'reelKept', 'reelKept']);
    expect(rows.map((row) => row.assetId === null)).toEqual([false, true, true]);
    expect(rows.slice(1).every((row) => row.alternates.length === 0)).toBe(true);
    expect([0, 1, 2].map((slot) => askedFor(cast, slot))).toEqual([true, false, false]);
    // The answer says what the note means, so the Librarian's prompt needn't.
    expect(answer.reelKept).toBe(REEL_KEPT_WORDS);
    // Reading a cast changes nothing: the reel is put in the library only when a video is assembled.
    expect(reel.calls).toEqual([{ templateId: cast.template.id, projectId: w.projectId, runId: null }]);

    expect(video(timeline).map((item) => item.type)).toEqual(['clip', 'clip', 'clip']);
    const [person, film, tail] = clipsOf(timeline) as [Clip, Clip, Clip];
    expect(person.media.assetId).toBe(cast.profiles[0]!.assetId);
    expect(person.duration.value).toBe(324);
    for (const clip of [film, tail]) {
      expect(clip.media).toEqual({
        kind: 'video',
        assetId: reel.assetId,
        shotId: null,
        available: { start: RationalTime.of(0, cast.template.canvas.rate), duration: cast.template.duration },
      });
      // Whole in the frame as the reel showed it, in real time, never the person's lock.
      expect(clip).toMatchObject({
        fit: 'contain',
        reframe: null,
        speed: null,
        locked: false,
        syncPoint: null,
      });
      expect(clip.visualLayout).toBeUndefined();
    }
    expect(frames(film)).toEqual([324, 129]);
    expect(frames(tail)).toEqual([453, 14]);
    expect(film.sourceStart.rate).toEqual(cast.template.canvas.rate);

    // The stored cast says whose each shot is, and none is unsure.
    expect(
      timeline.cast!.slots.map((slot) => [slot.note, slot.clipId, slot.confidence, slot.needsRerank]),
    ).toEqual([
      [null, person.id, expect.any(Number), false],
      ['reelKept', film.id, null, false],
      ['reelKept', tail.id, null, false],
    ]);
    expect(timeline.cast!.slots[1]!.pick).toMatchObject({ assetId: reel.assetId, shotId: null });
    expect(timeline.cast!.slots[1]!.alternates).toEqual([]);
    expect(assembled.reelSlots).toEqual([cast.template.slots[1]!.id, cast.template.slots[2]!.id]);
    expect(assembled.lowConfidence).toBe(0);
    // The Librarian's own check passes the handoff: no slot without a pick, nothing unsure.
    const handoff = {
      templateId: cast.template.id,
      timelineIds: [timeline.id],
      revisions: [timeline.revision],
      lowConfidenceSlots: 0,
      reranked: 0,
    };
    expect(checkCast([timeline], handoff as never, CASTING_CONFIG)).toEqual({ verdict: 'pass' });
  });

  it('sound: the reel’s own music plays under the whole video and every clip is muted', async () => {
    const { cast, timeline } = await made({ kept: [1, 2] });
    // The film's dialogue is in the reel's audio, which plays from frame 0: the slot sits where it sat in the reel.
    expect(timeline.music).toEqual({ path: 'referenceAudio', templateId: cast.template.id, gainDb: 0 });
    expect(clipsOf(timeline).map((clip) => clip.audio)).toEqual(
      Array.from({ length: 3 }, () => ({ gainDb: 0, muted: true })),
    );
  });

  it('keeps the reel’s footage first, and puts the person’s clips after it', async () => {
    const { cast, reel, rows, timeline } = await made({ kept: [0], clips: 2 });
    expect(rows.map((row) => row.note)).toEqual(['reelKept', null, null]);
    expect(askedFor(cast, 0)).toBe(false);
    const [opening, second, third] = clipsOf(timeline) as [Clip, Clip, Clip];
    expect(video(timeline)).toHaveLength(3);
    expect(opening.media.assetId).toBe(reel.assetId);
    expect(frames(opening)).toEqual([0, 324]);
    const mine = new Set(cast.profiles.map((profile) => profile.assetId as string));
    expect([second, third].every((clip) => mine.has(clip.media.assetId))).toBe(true);
    expect([second.duration.value, third.duration.value]).toEqual([129, 14]);
  });

  it('keeps the reel’s footage in the middle, between the person’s clips', async () => {
    const { cast, reel, rows, timeline } = await made({ kept: [1], clips: 2 });
    expect(rows.map((row) => row.note)).toEqual([null, 'reelKept', null]);
    expect([0, 1, 2].map((slot) => askedFor(cast, slot))).toEqual([true, false, true]);
    const [first, middle, last] = clipsOf(timeline) as [Clip, Clip, Clip];
    expect(video(timeline)).toHaveLength(3);
    expect(middle.media.assetId).toBe(reel.assetId);
    expect(frames(middle)).toEqual([324, 129]);
    expect(first.media.assetId).not.toBe(reel.assetId);
    expect(last.media.assetId).not.toBe(reel.assetId);
    expect(first.media.assetId).not.toBe(last.media.assetId);
  });

  it('never takes a lock, a rerank or a part for a reel slot, and keeps the person’s clip out of it', async () => {
    const cast = reelWorld({ kept: [1, 2] });
    const reel = reelSource();
    const w = agentWorldOver(cast, { keptAudio: true, reel: reel.source });
    const shot = cast.profiles[0]!;
    const film = cast.template.slots[1]!.id;
    // A model that locks the person's clip into the film slot, reranks it and states a part there: all dropped,
    // and the clip fills its own slot.
    const target = {
      projectId: w.projectId,
      template: { id: cast.template.id },
      locked: [{ slotId: film, assetId: shot.assetId, shotId: shot.shotId, sourceStart: shot.range.start }],
      rerank: [{ slotId: film, order: [shot.shotId] }],
      parts: [{ slotId: film, shotId: shot.shotId, from: 1, to: 3 }],
    };
    const read = await w.call('timeline.cast', target);
    if (!read.ok) throw new Error(read.error.code);
    const rows = (read.value.variants as { slots: SlotRow[] }[])[0]!.slots;
    expect(rows.map((row) => row.note)).toEqual([null, 'reelKept', 'reelKept']);
    expect(rows[0]!.assetId).toBe(shot.assetId);
    const assembled = await w.call('timeline.assemble', target);
    if (!assembled.ok) throw new Error(assembled.error.code);
    const timeline = w.store.docs.get((assembled.value.timelineIds as string[])[0]!)!;
    expect(clipsOf(timeline).map((clip) => clip.media.assetId === reel.assetId)).toEqual([false, true, true]);
  });

  it('a person’s statement fills the slot like the Analyst’s', async () => {
    const { rows } = await made({ kept: [2], by: 'user', clips: 2 });
    expect(rows.map((row) => row.note)).toEqual([null, null, 'reelKept']);
    expect(FILM_REASON).toBe('A film scene the joke lands on');
  });

  it('draws no whip of the template’s into or out of the reel’s footage', async () => {
    // A whip's frames are each side's own. A dissolve or a fade blends the two: match1-reel-transitions.test.ts.
    const whip = { kind: 'whip' as const, before: 4, after: 4 };
    const slots = [
      { frames: 90, text: 'the creator talks to the camera' },
      { frames: 60, text: 'a film scene: an actor answers', transition: whip },
      { frames: 60, text: 'the film scene ends', transition: whip },
      { frames: 60, text: 'the creator again', transition: whip },
      { frames: 60, text: 'the creator waves', transition: whip },
    ];
    const { timeline } = await made({ kept: [1, 2], slots, clips: 3 });
    // Only the cut between the person's own two clips keeps the template's whip.
    expect(video(timeline).map((item) => item.type)).toEqual([
      'clip',
      'clip',
      'clip',
      'clip',
      'transition',
      'clip',
    ]);
  });
});

describe('a reel slot with no reel on this Mac (KEEP1)', () => {
  it('refuses the assembly with the fix that fetches the reel again, and makes nothing', async () => {
    const cast = reelWorld({ kept: [1, 2] });
    for (const reel of [undefined, async () => ({ ok: true as const, value: null })]) {
      const w = agentWorldOver(cast, { keptAudio: true, ...(reel ? { reel } : {}) });
      const refused = await w.call('timeline.assemble', {
        projectId: w.projectId,
        template: { id: cast.template.id },
      });
      expect(refused.ok).toBe(false);
      if (refused.ok) return;
      expect(refused.error.code).toBe('timeline.reel_missing');
      expect(refused.error.fix).toEqual({
        command: 'templates.fetchMedia',
        labelKey: 'fix.getReelMedia',
        payload: { id: cast.template.id },
      });
      expect(w.store.docs.size).toBe(0);
    }
  });

  it('still reads the cast: timeline.cast needs no reel', async () => {
    const cast = reelWorld({ kept: [1, 2] });
    const w = agentWorldOver(cast, { keptAudio: true });
    const read = await w.call('timeline.cast', {
      projectId: w.projectId,
      template: { id: cast.template.id },
    });
    expect(read.ok).toBe(true);
  });
});
