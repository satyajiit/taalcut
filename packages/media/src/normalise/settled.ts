// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The plan as it applies to a file this package already wrote (a proxy or a
 * conformed master). Rotation, the tone-map and the audio offset were applied
 * on the way in; applying them again would flip the picture twice.
 *
 * The file is 8-bit 4:2:0 H.264 whatever the original was, so a hardware
 * decode downloads it in the row's own format for that (NV12 on VideoToolbox,
 * CUDA and VA-API). Keeping the original's surface format broke every read of
 * a 10-bit original's proxy on CUDA: `hwdownload,format=p010le` of NV12 frames
 * exits 234 (UX3-IDX, iPhone HLG clips). VideoToolbox converts on the way
 * down, so it never showed on a Mac.
 */
import { FrameRate, RationalTime, type FrameRate as Rate } from '@taalcut/core';
import type { DecodePlan } from '../backends';
import { hwVideoBackend } from '../hw-video/table';
import { uprightPixels } from './size';
import type { NormalisationPlan } from './types';

/** What the files this package writes are, for the decoder's surface format. */
const SETTLED_STREAM = { codec: 'h264', pixelFormat: 'yuv420p' } as const;

/** The plan's decoder, downloading the settled file's frames in the format it hands them back in. */
function settledDecode(decode: DecodePlan): DecodePlan {
  if (decode.backend === 'software') return decode;
  const surfaceFormat = hwVideoBackend(decode.backend).decode?.surfaceFormat(SETTLED_STREAM) ?? 'nv12';
  return { ...decode, surfaceFormat };
}

export function settledPlan(plan: NormalisationPlan, fps?: Rate): NormalisationPlan {
  const size = uprightPixels(plan);
  const output = fps ?? plan.frameRate.output;
  const seconds = RationalTime.toSeconds(plan.duration);
  const rate = output.den === 0 ? 0 : output.num / output.den;
  const frames = Math.max(1, Math.round(seconds * (rate || 1)));
  return {
    ...plan,
    decode: settledDecode(plan.decode),
    rotation: 0,
    mirrored: false,
    hdr: 'none',
    toneMap: 'none',
    frameRate: { output },
    frames: plan.kind === 'video' ? frames : plan.frames,
    source: {
      ...plan.source,
      width: size.width,
      height: size.height,
      displayWidth: size.width,
      displayHeight: size.height,
      bitDepth: 8,
      pixelFormat: 'yuv420p',
      codec: 'h264',
      colour: { space: 'bt709', transfer: 'bt709', primaries: 'bt709', range: 'tv' },
      hdrFormats: [],
      dolbyProfile: undefined,
      vfr: false,
    },
    ...(plan.audio ? { audio: { offset: RationalTime.of(0, FrameRate.of(1)), trimToVideo: true } } : {}),
    speed: { kind: 'normal', factor: 1, retimedInFile: plan.speed.retimedInFile },
  };
}
