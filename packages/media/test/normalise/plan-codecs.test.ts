// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** UX2: the clip page's facts name the codecs and the bit depth the probe found. */
import { describe, expect, it } from 'vitest';
import { planNormalisation } from '../../src/normalise/plan';
import type { AudioStreamInfo, ProbeResult } from '../../src/probe/types';
import { probeOf, videoStream } from '../helpers/probe-fixture';

const SECONDS = { value: 2_000_000, rate: 1_000_000 };

function clip(video: Parameters<typeof videoStream>[0], audioCodec?: string): ProbeResult {
  const stream = videoStream({
    averageFrameRate: { num: 30, den: 1 },
    frameRate: { num: 30, den: 1 },
    duration: SECONDS,
    frameCount: 60,
    ...video,
  });
  const base = probeOf('/tmp/clip.mov', stream);
  if (!audioCodec) return base;
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
}

describe('the codecs in a clip’s facts', () => {
  it('names the video and audio codecs and the bit depth', () => {
    const plan = planNormalisation(clip({ codec: 'hevc', bitDepth: 10, pixelFormat: 'yuv420p10le' }, 'aac'));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.facts.videoCodec).toBe('hevc');
    expect(plan.value.facts.hasAudio).toBe(true);
    expect(plan.value.facts.audioCodec).toBe('aac');
    expect(plan.value.facts.bitDepth).toBe(10);
  });

  it('leaves out what the probe didn’t say, and no audio codec without sound', () => {
    const plan = planNormalisation(clip({ codec: 'h264', bitDepth: undefined }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.facts.videoCodec).toBe('h264');
    expect(plan.value.facts.audioCodec).toBeUndefined();
    expect(plan.value.facts.bitDepth).toBeUndefined();
  });
});
