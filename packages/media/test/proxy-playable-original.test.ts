// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2: an original kept as its own proxy plays straight from its file in the clip page's viewer. */
import { describe, expect, it } from 'vitest';
import { planNormalisation } from '../src/normalise/plan';
import type { AudioStreamInfo, ProbeResult } from '../src/probe/types';
import { isPreviewFriendly } from '../src/proxy/ladder';
import { probeOf, videoStream } from './helpers/probe-fixture';

const SECONDS = { value: 4_000_000, rate: 1_000_000 };

function plan(path: string, audioCodec?: string) {
  const stream = videoStream({
    codec: 'h264',
    bitDepth: 8,
    width: 720,
    height: 1280,
    averageFrameRate: { num: 30, den: 1 },
    frameRate: { num: 30, den: 1 },
    duration: SECONDS,
    frameCount: 120,
  });
  const base = probeOf(path, stream);
  const probe: ProbeResult = audioCodec
    ? (() => {
        const audio: AudioStreamInfo = {
          kind: 'audio',
          index: 1,
          tags: {},
          codec: audioCodec,
          channels: 2,
          sampleRate: 48_000,
          duration: SECONDS,
        };
        return { ...base, audio, streams: [stream, audio] };
      })()
    : base;
  const planned = planNormalisation(probe);
  if (!planned.ok) throw new Error(planned.error.code);
  return planned.value;
}

describe('isPreviewFriendly', () => {
  it('keeps a small H.264 MP4 or MOV with AAC sound, or none, as its own proxy', () => {
    expect(isPreviewFriendly(plan('/clips/a.mp4', 'aac'), '/clips/a.mp4')).toBe(true);
    expect(isPreviewFriendly(plan('/clips/b.MOV', 'aac'), '/clips/b.MOV')).toBe(true);
    expect(isPreviewFriendly(plan('/clips/c.m4v'), '/clips/c.m4v')).toBe(true);
  });

  it('makes a copy of a file the viewer couldn’t play as it is', () => {
    expect(isPreviewFriendly(plan('/clips/d.mkv', 'aac'), '/clips/d.mkv')).toBe(false);
    expect(isPreviewFriendly(plan('/clips/e.mov', 'pcm_s16le'), '/clips/e.mov')).toBe(false);
    expect(isPreviewFriendly(plan('/clips/f.mp4', 'alac'), '/clips/f.mp4')).toBe(false);
  });
});
