// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-V3, IX2-G3: the decode service's client over the mac helper's `decode.pass` and `decode.frames`, on a fake
 * sidecar. IX2-F4: a request the helper hasn't let go of (a cancel it didn't answer) keeps the caller's lease and
 * starts no other pass or frame read.
 */
import { err, ok } from '@taalcut/core';
import {
  createMacHelperDecodeService,
  DECODE_FRAMES_METHOD,
  DECODE_PASS_METHOD,
  MediaCancelled,
  SidecarFailed,
  SidecarRejected,
  type DecodeFramesRequest,
  type DecodePassRequest,
  type JsonLineRequestOptions,
  type JsonLineSidecar,
  type JsonValue,
} from '@taalcut/media';
import { describe, expect, it } from 'vitest';

const request: DecodePassRequest = {
  path: '/library/clip.mov',
  rate: { num: 30000, den: 1001 },
  window: { from: 300, frames: 600 },
  rotation: 90,
  range: 'video',
  analysis: { width: 144, height: 256, path: '/frames/a.nv12' },
  sets: [{ width: 360, height: 640, every: 15, maxFrames: 40, format: 'gray8', path: '/frames/s.raw' }],
};

const frames: DecodeFramesRequest = {
  path: '/library/clip.mov',
  rate: { num: 30, den: 1 },
  rotation: 0,
  range: 'full',
  gapSeconds: 2,
  sets: [
    { width: 768, height: 384, frames: [3, 90, 400], path: '/frames/e.nv12' },
    { width: 256, height: 144, frames: [10], path: '/frames/g.nv12' },
  ],
};

/**
 * A sidecar answering every request with `reply`, letting go of it as the helper's reply does; or, `mute`, settling
 * a request cancelled (a cancel whose grace ran out) and letting go only when the test says (its late reply).
 */
function sidecarAnswering(reply: JsonValue | 'reject' | 'mute') {
  const seen: { method: string; params: JsonValue; options?: JsonLineRequestOptions }[] = [];
  const unanswered: (() => void)[] = [];
  const sidecar: JsonLineSidecar = {
    ready: async () => ok({}),
    request: async (method, params, options) => {
      seen.push({ method, params, ...(options ? { options } : {}) });
      const letGo = () => options?.onLetGo?.();
      if (reply === 'mute') {
        unanswered.push(letGo);
        return err(MediaCancelled());
      }
      letGo();
      return reply === 'reject' ? err(SidecarRejected({ helperCode: 'decode.unsupported' })) : ok(reply);
    },
    close: async () => {},
  };
  return { sidecar, seen, unanswered };
}

describe('the mac helper decode service', () => {
  it('sends decode.pass, settling on the reply, and reads the report', async () => {
    const { sidecar, seen } = sidecarAnswering({
      frames: 600,
      decoded: 612,
      sets: [40],
      fullRange: false,
      ms: 900,
    });
    const service = createMacHelperDecodeService(sidecar);
    const signal = new AbortController().signal;
    const report = await service.pass(request, { signal, timeoutMs: 1000 });
    expect(report.ok && report.value).toEqual({ frames: 600, sets: [40], ms: 900 });
    expect(seen[0]?.method).toBe(DECODE_PASS_METHOD);
    expect(seen[0]?.params).toEqual({ ...request, sets: [...request.sets] });
    expect(seen[0]?.options).toMatchObject({ settleOnReply: true, timeoutMs: 1000, signal });
  });

  it('passes the helper failure on and refuses a malformed report', async () => {
    const rejected = await createMacHelperDecodeService(sidecarAnswering('reject').sidecar).pass(request);
    expect(!rejected.ok && rejected.error.params).toEqual({ helperCode: 'decode.unsupported' });
    const bad = await createMacHelperDecodeService(sidecarAnswering({ frames: -1 }).sidecar).pass(request);
    expect(!bad.ok && SidecarFailed.is(bad.error)).toBe(true);
  });

  it('sends decode.frames, settling on the reply, and reads which frames each set got', async () => {
    const { sidecar, seen } = sidecarAnswering({
      written: [[3, 90], [10]],
      decoded: 77,
      reads: 2,
      fullRange: true,
      ms: 140,
    });
    const service = createMacHelperDecodeService(sidecar);
    const report = await service.frames(frames, { timeoutMs: 1000 });
    expect(report.ok && report.value).toEqual({ written: [[3, 90], [10]], decoded: 77, reads: 2, ms: 140 });
    expect(seen[0]?.method).toBe(DECODE_FRAMES_METHOD);
    expect(seen[0]?.params).toEqual({
      ...frames,
      sets: frames.sets.map((set) => ({ ...set, frames: [...set.frames] })),
    });
    expect(seen[0]?.options).toMatchObject({ settleOnReply: true, timeoutMs: 1000 });
    // One written list per set, or it isn't the report of this request.
    const short = await createMacHelperDecodeService(
      sidecarAnswering({ written: [[3]], decoded: 1, reads: 1, ms: 1 }).sidecar,
    ).frames(frames);
    expect(!short.ok && SidecarFailed.is(short.error)).toBe(true);
    const rejected = await createMacHelperDecodeService(sidecarAnswering('reject').sidecar).frames(frames);
    expect(!rejected.ok && rejected.error.params).toEqual({ helperCode: 'decode.unsupported' });
  });

  it('remembers the files it should leave to FFmpeg', () => {
    const service = createMacHelperDecodeService(sidecarAnswering({}).sidecar);
    expect(service.avoided('/a.mov')).toBeUndefined();
    service.avoid('/a.mov', 'decode.off_grid');
    expect(service.avoided('/a.mov')).toBe('decode.off_grid');
  });

  it('lets the caller go at the reply, and starts no pass while a cancel is unanswered', async () => {
    const answering = sidecarAnswering({ frames: 1, sets: [], ms: 1 });
    let letGo = 0;
    const service = createMacHelperDecodeService(answering.sidecar);
    expect((await service.pass(request, { onLetGo: () => letGo++ })).ok).toBe(true);
    expect(letGo).toBe(1);

    const mute = sidecarAnswering('mute');
    const stuck = createMacHelperDecodeService(mute.sidecar);
    let first = 0;
    const cancelled = await stuck.pass(request, { onLetGo: () => first++ });
    expect(!cancelled.ok && MediaCancelled.is(cancelled.error)).toBe(true);
    expect(first).toBe(0);
    // Another pass would be a session beside the one that may still be open: it declines, sending nothing.
    let second = 0;
    const declined = await stuck.pass(request, { onLetGo: () => second++ });
    expect(!declined.ok && SidecarFailed.is(declined.error) && declined.error.params).toEqual({
      helperCode: 'decode.unanswered_cancel',
    });
    expect(second).toBe(1);
    expect(mute.seen).toHaveLength(1);
    // The helper's late reply (or its exit) lets the first go; passes start again.
    mute.unanswered[0]?.();
    expect(first).toBe(1);
    await stuck.pass(request);
    expect(mute.seen).toHaveLength(2);
  });

  it('holds off frame reads and passes alike while either is unanswered', async () => {
    const mute = sidecarAnswering('mute');
    const stuck = createMacHelperDecodeService(mute.sidecar);
    let read = 0;
    expect((await stuck.frames(frames, { onLetGo: () => read++ })).ok).toBe(false);
    expect(read).toBe(0);
    const pass = await stuck.pass(request);
    expect(!pass.ok && pass.error.params).toEqual({ helperCode: 'decode.unanswered_cancel' });
    let again = 0;
    const another = await stuck.frames(frames, { onLetGo: () => again++ });
    expect(!another.ok && another.error.params).toEqual({ helperCode: 'decode.unanswered_cancel' });
    expect(again).toBe(1);
    expect(mute.seen.map((seen) => seen.method)).toEqual([DECODE_FRAMES_METHOD]);
    mute.unanswered[0]?.();
    expect(read).toBe(1);
    await stuck.frames(frames);
    expect(mute.seen).toHaveLength(2);
  });
});
