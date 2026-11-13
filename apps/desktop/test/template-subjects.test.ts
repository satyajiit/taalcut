// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: the breakdown's subject analyser on the mac helper: `track.shot` over the whole reel, detecting only,
 * from the experiment's folder; heads and people of the detect samples at the reel's frames, top-left; no helper,
 * no subjects.
 */
import { describe, expect, it } from 'vitest';
import { err, FrameRates, NotFoundError, ok, type Container } from '@taalcut/core';
import type { JsonValue } from '@taalcut/media';
import type { HelperRequester } from '@taalcut/render';
import { reelSubjects } from '../src/utility/roots/template-subjects';

const noSessions = { has: () => false } as unknown as Container;
const scored = (x: number, y: number, width: number, height: number) => ({
  box: { x, y, width, height },
  confidence: 0.9,
});

function fakeHelper(): HelperRequester & { asked: { method: string; params: JsonValue }[] } {
  const asked: { method: string; params: JsonValue }[] = [];
  return {
    asked,
    request: async (method, params, options) => {
      asked.push({ method, params });
      options?.onLetGo?.();
      return ok({
        boxSpace: 'normalized-lower-left',
        width: 480,
        height: 854,
        compute: { faces: 'neuralEngine' },
        samples: [
          {
            t: { value: 0, rate: 30 },
            source: 'detect',
            heads: [scored(0.4, 0.6, 0.2, 0.15)],
            people: [scored(0.3, 0, 0.4, 0.75)],
            subject: { kind: 'face', box: scored(0.4, 0.6, 0.2, 0.15).box, confidence: 0.9 },
          },
          {
            t: { value: 7, rate: 30 },
            source: 'detect',
            heads: [],
            people: [],
            subject: { kind: 'none', confidence: 0 },
          },
        ],
      } as unknown as JsonValue);
    },
  };
}

describe("the reel's subject analyser (FRM1-SUB)", () => {
  it('detects over the whole reel from its folder, and gives the heads at the reel frames, top-left', async () => {
    const helper = fakeHelper();
    const roots: (readonly string[])[] = [];
    const subjects = reelSubjects(async (services, allowed) => {
      roots.push([services, ...allowed]);
      return ok(helper);
    }, noSessions);
    const found = await subjects('/exp/abc/normalised.mp4', {
      rate: FrameRates.fps30,
      hz: 4,
      frames: 90,
      signal: new AbortController().signal,
    });
    expect(roots).toEqual([['track', '/exp/abc']]);
    expect(helper.asked[0]?.method).toBe('track.shot');
    expect(helper.asked[0]?.params).toMatchObject({
      detectHz: 4,
      trackHz: 0,
      path: '/exp/abc/normalised.mp4',
    });
    const value = found.ok ? found.value : null;
    expect(value?.detector).toBe('vision');
    expect(value?.samples.map((sample) => sample.frame)).toEqual([0, 7]);
    const head = value?.samples[0]?.heads[0]?.box;
    expect(head?.x).toBeCloseTo(0.4, 6);
    expect(head?.y).toBeCloseTo(0.25, 6);
    expect(value?.samples[1]?.heads).toEqual([]);
  });

  it('answers the helper error when there is none', async () => {
    const subjects = reelSubjects(async () => err(NotFoundError({ entity: 'macHelper' })), noSessions);
    const found = await subjects('/exp/abc/normalised.mp4', {
      rate: FrameRates.fps30,
      hz: 4,
      frames: 90,
      signal: new AbortController().signal,
    });
    expect(found.ok).toBe(false);
  });
});
