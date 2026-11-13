// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import {
  applied,
  CHANGES,
  CHECKS,
  clipsWith,
  frameAt,
  frameTimes,
  missedWith,
  ON_BEAT,
  PICKS,
  REEL,
  RUN_END,
  STEPS,
  SWAPS,
} from '#components/showcase/agent/run-script';
import { canTrim, captionAt, clipAt, clipBeats, clipSpan, CLIPS, sampleCut, trimClip } from '#components/showcase/editor/cut';
import { framesOf } from '#components/showcase/frames';

describe('the agent’s run', () => {
  it('starts with its slots empty and ends finished, every shot checked and every check passed', () => {
    const before = frameAt(-1);
    expect(before.slots.every((s) => s === 'waiting')).toBe(true);
    expect([before.checks, before.seams, before.done]).toEqual([0, 0, false]);
    expect(before.steps[0]).toBe('done');
    const end = frameAt(RUN_END);
    expect(end.steps.every((s) => s === 'done')).toBe(true);
    expect(end.slots.every((s) => s === 'checked')).toBe(true);
    expect(end.swapped.every(Boolean)).toBe(true);
    expect(end.checks).toBe(CHECKS.length);
    expect(end.seams).toBe(ON_BEAT.length);
    expect(end.done).toBe(true);
    expect(RUN_END).toBeLessThan(5000);
  });

  it('runs one step at a time, in order, and only ever moves forward', () => {
    let last = frameAt(0);
    for (const at of frameTimes()) {
      const frame = frameAt(at);
      expect(frame.steps.filter((s) => s === 'running').length).toBeLessThanOrEqual(1);
      const done = frame.steps.lastIndexOf('done');
      expect(frame.steps.slice(0, done + 1).every((s) => s === 'done')).toBe(true);
      expect(frame.checks).toBeGreaterThanOrEqual(last.checks);
      expect(frame.slots.filter((s) => s !== 'waiting').length).toBeGreaterThanOrEqual(
        last.slots.filter((s) => s !== 'waiting').length,
      );
      last = frame;
    }
  });

  it('flags a shot that misses its moment, swaps it, then ticks it, while the check step runs', () => {
    const missing = frameTimes()
      .map(frameAt)
      .find((f) => f.slots.includes('missed'));
    expect(missing?.steps[STEPS.length - 1]).toBe('running');
    const k = missing?.slots.indexOf('missed') ?? -1;
    expect(SWAPS.has(k)).toBe(true);
    expect(missing?.swapped[k]).toBe(false);
    expect(clipsWith(frameAt(RUN_END), 0)[k]).toBe(PICKS[k]);
  });

  it('marks only the cuts that fall on a music beat', () => {
    expect(ON_BEAT.length).toBeGreaterThan(0);
    for (const i of ON_BEAT)
      expect(REEL.beats.some((b) => Math.abs(b - (REEL.slots[i]?.start ?? -1)) <= 0.08)).toBe(true);
  });

  it('takes changes back from the last: a swap taken back shows the clip it had, and misses its moment again', () => {
    const end = frameAt(RUN_END);
    expect(applied(1).map((c) => c.id)).toEqual(CHANGES.slice(0, -1).map((c) => c.id));
    expect(missedWith(1)).toEqual([]);
    const swaps = CHANGES.filter((c) => c.swap);
    const lastSwap = swaps.at(-1)!;
    const undone = CHANGES.length - CHANGES.indexOf(lastSwap);
    expect(missedWith(undone)).toEqual([lastSwap.swap!.slot]);
    expect(clipsWith(end, undone)[lastSwap.swap!.slot]).toBe(lastSwap.swap!.before);
    for (const c of swaps) {
      expect(framesOf(c.swap!.before).length, c.id).toBeGreaterThan(0);
      expect(c.swap!.before).not.toBe(c.swap!.after);
    }
  });
});

describe('the editor’s sample cut', () => {
  const cut = sampleCut();

  it('covers the music with its clips, end to end', () => {
    const count = cut.edges.length - 1;
    expect(count).toBeLessThanOrEqual(CLIPS.length);
    expect(clipSpan(cut, 0)[0]).toBe(0);
    expect(clipSpan(cut, count - 1)[1]).toBe(cut.duration);
    for (let i = 1; i < count; i += 1) expect(clipSpan(cut, i)[0]).toBe(clipSpan(cut, i - 1)[1]);
  });

  it('trims on the beat: this clip takes what the next one gives, and the cut keeps its length', () => {
    const shorter = trimClip(cut, 2, -1);
    expect(clipBeats(shorter, 2)).toBe(clipBeats(cut, 2) - 1);
    expect(clipBeats(shorter, 3)).toBe(clipBeats(cut, 3) + 1);
    expect(clipSpan(shorter, shorter.edges.length - 2)[1]).toBe(cut.duration);
    expect(shorter.beats).toContain(clipSpan(shorter, 2)[1]);
  });

  it('keeps every clip at least a beat long, and leaves the last clip’s end to the music', () => {
    let squeezed = cut;
    for (let i = 0; i < 10; i += 1) squeezed = trimClip(squeezed, 1, -1);
    expect(clipBeats(squeezed, 1)).toBe(1);
    expect(canTrim(squeezed, 1, -1)).toBe(false);
    expect(trimClip(squeezed, 1, -1)).toBe(squeezed);
    expect(canTrim(cut, cut.edges.length - 2, 1)).toBe(false);
  });

  it('shows the owner’s footage in every clip', () => {
    for (const clip of CLIPS) expect(framesOf(clip.clipId).length, clip.word).toBeGreaterThan(0);
    expect(new Set(CLIPS.map((c) => c.clipId)).size).toBe(CLIPS.length);
  });

  it('knows the clip and the caption word under the playhead', () => {
    expect(clipAt(cut, 0)).toBe(0);
    expect(clipAt(cut, cut.duration - 0.01)).toBe(cut.edges.length - 2);
    expect(captionAt(0)).toBeNull();
    const said = captionAt(2.5);
    expect(said?.line[said.word]?.text).toBe('We');
  });
});
