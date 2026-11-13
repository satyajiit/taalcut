// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which decode route a multi-branch read takes: the plan's own route when it
 * names a hardware row (VideoToolbox, CUDA, VA-API), the software decoder when the plan
 * fell back because the hardware can't take this file, and the hardware
 * profile's decoder when the plan only fell back because no decoder was wired
 * for the platform (Windows profiles: NVDEC on NVIDIA, else D3D11VA). The
 * profile comes from the hardware probe, not from platform checks here.
 */
import type { HardwareVideoEngine } from '../hardware-sessions/limits';
import type { NormalisationPlan } from '../normalise/types';
import { turnsOnDevice } from '../hw-video/filters';
import { d3d11vaRoute } from './d3d11va';
import { nvdecRoute } from './nvdec';
import type { DecodeRoute } from './route';
import { softwareRoute } from './software';
import { surfaceRoute } from './surface-route';

export const HARDWARE_DECODERS = ['videotoolbox', 'nvdec', 'd3d11va', 'none'] as const;
export type HardwareDecoder = (typeof HARDWARE_DECODERS)[number];

/** What the machine decodes video with (the hardware profile's part this package reads). */
export interface DecodeProfile {
  readonly decoder: HardwareDecoder;
}

/** Where the profile comes from: probed once, lazily, by the host (undefined when the probe failed). */
export type DecodeProfileSource = () => Promise<DecodeProfile | undefined>;

/**
 * The decoder of each hardware video engine (the desktop derives the engine from the hardware probe, as for
 * the session cap): NVIDIA decodes on NVDEC, Intel and AMD on D3D11VA (IX2-T4; not run on Windows hardware).
 */
export const ENGINE_DECODERS: Readonly<Record<HardwareVideoEngine, HardwareDecoder>> = {
  videotoolbox: 'videotoolbox',
  nvidia: 'nvdec',
  intel: 'd3d11va',
  amd: 'd3d11va',
  // VA-API decode isn't wired (LNX1: the static FFmpeg aborts on Ubuntu 24.04's libva 2.20): software.
  vaapi: 'none',
  none: 'none',
};

export function decodeProfileFor(engine: HardwareVideoEngine): DecodeProfile {
  return { decoder: ENGINE_DECODERS[engine] };
}

const PROFILE_ROUTES: Readonly<Record<Exclude<HardwareDecoder, 'videotoolbox'>, DecodeRoute>> = {
  nvdec: nvdecRoute,
  d3d11va: d3d11vaRoute,
  none: softwareRoute,
};

export function decodeRouteFor(plan: NormalisationPlan, profile?: DecodeProfile): DecodeRoute {
  const decode = plan.decode;
  if (decode.backend === 'd3d11va') return d3d11vaRoute;
  if (decode.backend !== 'software' && turnsOnDevice(decode.backend))
    return surfaceRoute({ backend: decode.backend, surfaceFormat: decode.surfaceFormat });
  if (decode.backend !== 'software') return softwareRoute;
  const unwired = decode.fallbackReason.code === 'no_hardware_backend';
  if (!unwired || !profile || profile.decoder === 'videotoolbox') return softwareRoute;
  return PROFILE_ROUTES[profile.decoder];
}
