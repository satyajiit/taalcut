// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-TRIM's contract: a shot profile carries vision's best frame, and one from before (without it) still reads; a
 * clip can play another part of its shot (timeline.slipClip), which the changes card words as such.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  diffEdits,
  EDITOR_COMMANDS,
  editChangeSchema,
  editorCommandPayloads as payloads,
  editSnapshot,
  FrameRates,
  newId,
  RationalTime,
  SLIP_AVOIDS,
  type ShotProfile,
  type Timeline,
} from '../src/index';
import { ntscTimeline } from './helpers/documents';

const fps25 = FrameRates.fps25;
const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
const clipId = newId<'TimelineItem'>();

/** The fixture's first V1 clip (25 frames into its media at 25 fps), changed. */
function withFirstClip(
  timeline: Timeline,
  change: (clip: Record<string, unknown>) => Record<string, unknown>,
): Timeline {
  const [video, ...rest] = timeline.tracks;
  if (video?.kind !== 'video') throw new Error('no V1');
  const items = video.items.map((item, index) => (index === 0 ? (change(item) as typeof item) : item));
  return { ...timeline, revision: timeline.revision + 1, tracks: [{ ...video, items }, ...rest] };
}
const later = (frames: number) => (clip: Record<string, unknown>) => ({
  ...clip,
  sourceStart: RationalTime.of(25 + frames, fps25),
});
const changes = (before: Timeline, after: Timeline) =>
  diffEdits(editSnapshot(before), editSnapshot(after)).changes.map((row) => row.change);

describe('FIX-TRIM contract', () => {
  it('lets a profile carry the best frame, a null or nothing', () => {
    expectTypeOf<ShotProfile['bestFrame']>().toEqualTypeOf<number | null | undefined>();
    const read = (profile: Pick<ShotProfile, 'bestFrame'>) => profile.bestFrame ?? null;
    expect(read({ bestFrame: 42 })).toBe(42);
    expect(read({ bestFrame: null })).toBeNull();
    expect(read({})).toBeNull();
  });

  it('slips a clip by a time, to an in-point or away from what it should not show: one of the three', () => {
    const slip = payloads[EDITOR_COMMANDS.slipClip];
    expect(EDITOR_COMMANDS.slipClip).toBe('timeline.slipClip');
    expect(SLIP_AVOIDS).toEqual(['start', 'end', 'face']);
    const ms = (value: number) => ({ value, rate: { num: 1000, den: 1 } });
    for (const way of [
      { by: ms(-1500) },
      { by: ms(2000) },
      { sourceStart: RationalTime.of(90, fps25) },
      { avoid: ['start'] },
      { avoid: ['start', 'face'] },
      { avoid: ['face', 'end', 'start'] },
    ])
      expect(slip.safeParse({ ...target, clipId, ...way }).success).toBe(true);
    for (const way of [
      {},
      { by: ms(1000), avoid: ['end'] },
      { by: ms(1000), sourceStart: RationalTime.of(90, fps25) },
      { avoid: [] },
      { avoid: ['start', 'start'] },
      { avoid: ['middle'] },
    ])
      expect(slip.safeParse({ ...target, clipId, ...way }).success).toBe(false);
  });

  it('words a slip as another part of the shot, only while the clip keeps its footage, place and length', () => {
    const before = ntscTimeline();
    expect(changes(before, withFirstClip(before, later(50)))).toEqual([
      { kind: 'part', before: 1, after: 3 },
    ]);
    expect(changes(before, withFirstClip(before, later(-25)))).toEqual([
      { kind: 'part', before: 1, after: 0 },
    ]);
    // A trim at the start moves the in-point too: that is a new length, not a slip.
    const trimmed = withFirstClip(before, (clip) => ({
      ...later(30)(clip),
      duration: RationalTime.of(30, before.canvas.rate),
    }));
    expect(changes(before, trimmed).map((change) => change.kind)).not.toContain('part');
    // A swap is new footage.
    const swapped = withFirstClip(before, (clip) => ({
      ...later(30)(clip),
      media: { ...(clip.media as object), shotId: newId<'Shot'>() },
    }));
    expect(changes(before, swapped)).toEqual([{ kind: 'media' }]);
    expect(editChangeSchema.safeParse({ kind: 'part', before: 1, after: 3 }).success).toBe(true);
    expect(editChangeSchema.safeParse({ kind: 'part', before: -1, after: 3 }).success).toBe(false);
  });

  it('reads a snapshot from before, which has no in-points, as no slip', () => {
    const before = ntscTimeline();
    const old = editSnapshot(before);
    const stripped = { ...old, items: old.items.map(({ part: _part, ...rest }) => rest) };
    const after = editSnapshot(withFirstClip(before, later(50)));
    const rows = diffEdits(stripped, after).changes.map((row) => row.change.kind);
    expect(rows).not.toContain('part');
  });
});
