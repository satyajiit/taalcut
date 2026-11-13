// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A two-second 30 fps plan, with no FFmpeg. */
import { planNormalisation, type NormalisationPlan } from '@taalcut/media';
import { probeOf, videoStream } from './probe-fixture';
import type { AudioStreamInfo, VideoStreamInfo } from '@taalcut/media';

const audioStream = (): AudioStreamInfo => ({
  kind: 'audio',
  index: 1,
  tags: {},
  codec: 'aac',
  channels: 2,
  sampleRate: 48_000,
  duration: { value: 2, rate: 1 },
});

export function videoPlan(
  overrides: Partial<VideoStreamInfo> = {},
  withAudio = false,
  platform?: NodeJS.Platform,
): NormalisationPlan {
  const video = videoStream({
    duration: { value: 2, rate: 1 },
    frameRate: { num: 30, den: 1 },
    averageFrameRate: { num: 30, den: 1 },
    frameCount: 60,
    ...overrides,
  });
  const audio = audioStream();
  const base = probeOf('/clip.mp4', video);
  const probe = withAudio ? { ...base, audio, streams: [video, audio] } : base;
  const plan = planNormalisation(probe, platform ? { platform } : {});
  if (!plan.ok) throw new Error(`${plan.error.code}: ${plan.error.detail ?? ''}`);
  return plan.value;
}

/** A 1920×1080 30 fps plan (two seconds) for the platform's decoder. */
export function hdPlan(
  overrides: Partial<VideoStreamInfo> = {},
  platform: NodeJS.Platform = 'darwin',
): NormalisationPlan {
  const hd = { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 };
  return videoPlan({ ...hd, ...overrides }, false, platform);
}

/** A 10-bit HLG stream's facts, for `hdPlan`. */
export const HLG_STREAM = {
  isHdr: true,
  hdrFormats: ['hlg' as const],
  bitDepth: 10,
  pixelFormat: 'yuv420p10le',
  colour: { transfer: 'arib-std-b67', primaries: 'bt2020', space: 'bt2020nc', range: 'tv' },
};
