// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Hardware video sessions (hardware decode and encode, GPU FFmpeg filters) the whole app may hold at once,
 * by the machine's video engine and tier. The gate counts every decode and every encode as one session
 * (weight.ts), so a cap of N also keeps encodes at N or fewer.
 *
 * - VideoToolbox (every Mac), by tier: deliberately low. On 2026-10-13 a Mac panicked twice in the Apple
 *   Video Encoder's IOMMU (`dart-ave1 … PTE invalid exception`) with many sessions open from several
 *   processes. One transcode with a hardware decode and encode holds two, so the minimum tier runs one
 *   transcode at a time. Unchanged by round IX.
 * - NVIDIA (Windows profiles, round IX; not run on real hardware): consumer GeForce cards allow 8
 *   concurrent NVENC sessions per system ("On non-qualified GPUs, the number of concurrent encode sessions
 *   is limited to 8 per system", NVIDIA Video Codec SDK 13.0, NVENC Application Note,
 *   https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-application-note/; older drivers
 *   allowed 3, then 5). NVDEC has no session limit, so the encode limit is the cap.
 * - Intel Quick Sync and AMD AMF publish no consumer session cap; conservative, like the smallest Mac.
 * - VA-API (Intel or AMD on Linux, LNX1): the same drivers' engines, the same conservative cap.
 * - No hardware video engine: one, for the odd GPU filter.
 */
import type { HardwareTier } from '@taalcut/core';

/** The hardware video engine a machine decodes and encodes with (the desktop derives it from the probe). */
export const HARDWARE_VIDEO_ENGINES = ['videotoolbox', 'nvidia', 'intel', 'amd', 'vaapi', 'none'] as const;
export type HardwareVideoEngine = (typeof HARDWARE_VIDEO_ENGINES)[number];

export interface HardwareSessionProfile {
  readonly engine: HardwareVideoEngine;
  readonly tier: HardwareTier;
}

/** VideoToolbox, by tier. */
export const HARDWARE_SESSION_LIMITS: Readonly<Record<HardwareTier, number>> = {
  minimum: 2,
  recommended: 3,
  high: 4,
};

/** Other engines: one cap each, whatever the tier. */
export const ENGINE_SESSION_LIMITS: Readonly<Record<Exclude<HardwareVideoEngine, 'videotoolbox'>, number>> = {
  nvidia: 8,
  intel: 2,
  amd: 2,
  vaapi: 2,
  none: 1,
};

/** The limit when the hardware is unknown (the probe failed): the lowest Mac's. */
export const DEFAULT_HARDWARE_SESSION_LIMIT = HARDWARE_SESSION_LIMITS.minimum;

export function hardwareSessionLimit(profile: HardwareSessionProfile | undefined): number {
  if (!profile) return DEFAULT_HARDWARE_SESSION_LIMIT;
  return profile.engine === 'videotoolbox'
    ? HARDWARE_SESSION_LIMITS[profile.tier]
    : ENGINE_SESSION_LIMITS[profile.engine];
}
