// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  defineError,
  err,
  FrameRate,
  newId,
  ok,
  RationalTime,
  TimeRange,
  type AsyncResult,
} from '@taalcut/core';
import type { JsonValue } from '@taalcut/media';
import { createSubjectTracker, topLeftBox, type HelperRequester } from '../../src/reframe/subject-tracker';

const recorded: unknown = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'track-shot.json'), 'utf8'),
);
const NTSC = FrameRate.of(30000, 1001);
const DecodeFailed = defineError('track.decode_failed', { retryable: true });

type Options = Parameters<HelperRequester['request']>[2];

function helper(
  reply: unknown,
): HelperRequester & { calls: { method: string; params: JsonValue; options: Options }[] } {
  const calls: { method: string; params: JsonValue; options: Options }[] = [];
  return {
    calls,
    request(method, params, options): AsyncResult<unknown> {
      calls.push({ method, params, options });
      return Promise.resolve(ok(reply));
    },
  };
}

const input = () => ({
  assetId: newId<'Asset'>(),
  contentHash: 'b'.repeat(64),
  path: '/allowed/clip.mov',
  range: TimeRange.of(RationalTime.of(30, NTSC), RationalTime.of(300, NTSC)),
});

describe('subject tracker (track.shot client)', () => {
  it('asks the helper for the shot with its recipe and times as CMTime', async () => {
    const fake = helper(recorded);
    await createSubjectTracker(fake).track(input());
    expect(fake.calls[0]?.method).toBe('track.shot');
    expect(fake.calls[0]?.params).toEqual({
      path: '/allowed/clip.mov',
      start: { value: 30030, rate: 30000 },
      end: { value: 330330, rate: 30000 },
      detectHz: 4,
      trackHz: 12,
      shortSide: 480,
    });
  });

  it('waits for the helper after a cancel and hands it the let-go (IX3-F5, H6)', async () => {
    const fake = helper(recorded);
    const signal = new AbortController().signal;
    const onLetGo = () => undefined;
    const onSend = () => undefined;
    await createSubjectTracker(fake).track({ ...input(), signal, onLetGo, onSend });
    expect(fake.calls[0]?.options).toMatchObject({ signal, settleOnReply: true, onLetGo, onSend });
  });

  it("flips Vision's lower-left boxes to top-left once", async () => {
    const tracked = await createSubjectTracker(helper(recorded)).track(input());
    expect(tracked.ok).toBe(true);
    if (!tracked.ok) return;
    const [detect, track, none] = tracked.value.track.samples;
    expect(detect?.faces[0]?.box.y).toBeCloseTo(1 - 0.62 - 0.08, 12);
    expect(detect?.humans[0]?.box.y).toBeCloseTo(0.1, 12);
    expect(detect?.subject.focus?.y).toBeCloseTo(0.34, 12);
    expect(detect?.faces[0]?.yaw).toBe(-0.1);
    // A tracker sample has no detections: the arrays default to empty.
    expect(track?.faces).toEqual([]);
    expect(track?.subject.kind).toBe('track');
    expect(none?.subject).toEqual({ kind: 'none', box: null, focus: null, confidence: 0 });
    expect(RationalTime.toSeconds(detect?.t ?? RationalTime.zero(NTSC))).toBeCloseTo(1001 / 30000, 3);
  });

  it('reports the requests that ran on the CPU', async () => {
    const tracked = await createSubjectTracker(helper(recorded)).track(input());
    expect(tracked.ok && tracked.value.cpu).toEqual(['track']);
    expect(tracked.ok && tracked.value.track.compute).toEqual({
      faces: 'neuralEngine',
      humans: 'neuralEngine',
      saliency: 'gpu',
      track: 'cpu',
    });
  });

  it('clamps boxes into the frame', () => {
    const box = topLeftBox({ x: -0.1, y: 0.95, width: 0.5, height: 0.2 });
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBeCloseTo(0.4, 12);
    expect(box.height).toBeCloseTo(0.05, 12);
  });

  it('refuses a reply that is not a track', async () => {
    const tracked = await createSubjectTracker(
      helper({ boxSpace: 'normalized-top-left', samples: [] }),
    ).track(input());
    expect(!tracked.ok && tracked.error.code).toBe('core.validation');
  });

  it('passes the helper error through', async () => {
    const failing: HelperRequester = {
      request: () => Promise.resolve(err(DecodeFailed())),
    };
    const tracked = await createSubjectTracker(failing).track(input());
    expect(!tracked.ok && tracked.error.code).toBe('track.decode_failed');
  });
});
