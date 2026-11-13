// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Proxy bitrate ladder (recipe v1). The 15% budget is of the original file
 * size; the rung is also capped at 0.85 of that so container and audio fit.
 */
import { FrameRate, type FrameRate as Rate } from '@taalcut/core';
import type { NormalisationPlan } from '../normalise/types';

export const PROXY_RECIPE = 1;
export const PROXY_AUDIO_BPS = 128_000;
export const PROXY_AUDIO_RETRY_BPS = 64_000;
/** Closed GOP of about half a second. */
export function gopSize(fps: number): number {
  return Math.max(1, Math.round(fps * 0.5));
}

interface Rung {
  readonly longSide: number;
  readonly mbps: number;
  readonly maxFps: number;
}

const RUNGS: readonly Rung[] = [
  { longSide: 1280, maxFps: 30, mbps: 2.5 },
  { longSide: 1280, maxFps: 60, mbps: 3.5 },
  { longSide: 1280, maxFps: 120, mbps: 5 },
  { longSide: 960, maxFps: Number.POSITIVE_INFINITY, mbps: 1.5 },
  { longSide: 640, maxFps: Number.POSITIVE_INFINITY, mbps: 0.8 },
];

const FLOOR_MBPS = 0.4;

export interface ProxyLadderChoice {
  readonly longSide: number;
  readonly videoBps: number;
  readonly reusedOriginal: boolean;
  /** True when the chosen rung is the 640 floor paid at the budget, under 0.4 Mb/s. */
  readonly atBudget: boolean;
}

/** Slow motion keeps up to 120 fps so a 240 fps clip previews at 4×, not 8×. */
export function proxyRate(plan: NormalisationPlan): Rate {
  if (plan.speed.kind === 'slow-motion' && plan.frameRate.native) {
    const native = plan.frameRate.native.num / plan.frameRate.native.den;
    if (native > 120) return FrameRate.of(120);
    return plan.frameRate.native;
  }
  return plan.frameRate.output;
}

function topRung(fps: number): Rung {
  return RUNGS.find((rung) => rung.longSide === 1280 && fps <= rung.maxFps) ?? RUNGS[2]!;
}

/**
 * Step the long side down until the rung's bitrate fits under the cap.
 * Under the 0.4 Mb/s floor, a preview-friendly original is reused; otherwise
 * the 640 size is encoded at the budget itself.
 */
export function chooseProxyLadder(input: {
  readonly sizeBytes: number;
  readonly durationSec: number;
  readonly fps: number;
  readonly sourceLongSide: number;
  readonly previewFriendly: boolean;
}): ProxyLadderChoice {
  const duration = input.durationSec > 0 ? input.durationSec : 1;
  const capBps = 0.85 * 0.15 * ((input.sizeBytes * 8) / duration);
  const steps = [topRung(input.fps), ...RUNGS.filter((rung) => rung.longSide < 1280)];
  for (const rung of steps) {
    const rungBps = rung.mbps * 1_000_000;
    if (capBps < rungBps) continue;
    return {
      longSide: Math.min(rung.longSide, Math.max(2, input.sourceLongSide)),
      videoBps: Math.round(Math.min(rungBps, capBps)),
      reusedOriginal: false,
      atBudget: false,
    };
  }
  if (capBps < FLOOR_MBPS * 1_000_000 && input.previewFriendly) {
    return { longSide: input.sourceLongSide, videoBps: 0, reusedOriginal: true, atBudget: false };
  }
  return {
    longSide: Math.min(640, Math.max(2, input.sourceLongSide)),
    videoBps: Math.max(1, Math.round(capBps)),
    reusedOriginal: false,
    atBudget: true,
  };
}

/**
 * Containers and sound the app's viewer (Chromium's media stack) plays as they are (UX2): an original kept as its
 * own proxy is played straight from its file on the clip page, so it has to be one of these.
 */
const PLAYABLE_CONTAINER = /\.(mp4|m4v|mov)$/i;
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'flac']);

/** Can the original stand in for its proxy: small, upright, SDR, 8-bit H.264 or HEVC the viewer plays as is? */
export function isPreviewFriendly(plan: NormalisationPlan, path: string): boolean {
  const codec = plan.source.codec;
  const longSide = Math.max(plan.source.displayWidth, plan.source.displayHeight);
  const sound = !plan.facts.hasAudio || PLAYABLE_AUDIO.has(plan.facts.audioCodec ?? '');
  return (
    (codec === 'h264' || codec === 'hevc') &&
    PLAYABLE_CONTAINER.test(path) &&
    sound &&
    plan.hdr === 'none' &&
    (plan.source.bitDepth ?? 8) <= 8 &&
    plan.rotation === 0 &&
    !plan.mirrored &&
    !plan.source.vfr &&
    plan.kind === 'video' &&
    longSide <= 1280 &&
    longSide > 0
  );
}
