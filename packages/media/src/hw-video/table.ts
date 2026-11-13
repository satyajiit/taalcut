// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The rows, and which ones each platform tries, in order (ADR 0002: GPU first). A platform's entry says how a row
 * is used there:
 * - default: planned unless the machine is known to lack it (a failed device trial, a probe without that GPU);
 * - probe: only where the host's hardware probe names it and its device trial passes (VA-API on Linux);
 * - slot: typed and unit-tested, never selected this round (Windows).
 */
import type { HardwareVideoEngine } from '../hardware-sessions/limits';
import { cudaBackend } from './rows/cuda';
import { vaapiBackend } from './rows/vaapi';
import { videoToolboxBackend } from './rows/videotoolbox';
import { amfBackend, d3d11vaBackend, mfBackend, qsvBackend } from './rows/windows';
import type { EncodeCodec, HardwareBackend, HwVideoBackend } from './types';

export const HW_VIDEO_BACKENDS: Readonly<Record<HardwareBackend, HwVideoBackend>> = {
  videotoolbox: videoToolboxBackend,
  cuda: cudaBackend,
  vaapi: vaapiBackend,
  d3d11va: d3d11vaBackend,
  qsv: qsvBackend,
  amf: amfBackend,
  mf: mfBackend,
};

export type HwBackendUse = 'default' | 'probe' | 'slot';

export interface PlatformHwBackend {
  readonly id: HardwareBackend;
  readonly use: HwBackendUse;
}

const row = (id: HardwareBackend, use: HwBackendUse): PlatformHwBackend => ({ id, use });

/** Each platform's rows in the order to try them. */
export const PLATFORM_HW_VIDEO: Readonly<Partial<Record<NodeJS.Platform, readonly PlatformHwBackend[]>>> = {
  darwin: [row('videotoolbox', 'default')],
  linux: [row('cuda', 'default'), row('vaapi', 'probe')],
  win32: [
    row('cuda', 'slot'),
    row('qsv', 'slot'),
    row('amf', 'slot'),
    row('d3d11va', 'slot'),
    row('mf', 'slot'),
  ],
};

export function hwVideoBackend(id: HardwareBackend): HwVideoBackend {
  return HW_VIDEO_BACKENDS[id];
}

/** The rows a platform plans with when nothing is known about the machine: its `default` ones. */
export function hardwareBackends(platform: NodeJS.Platform): readonly HardwareBackend[] {
  return (PLATFORM_HW_VIDEO[platform] ?? [])
    .filter((entry) => entry.use === 'default')
    .map((entry) => entry.id);
}

/**
 * The rows this machine may use, from what the host's probe named, in the platform's order: `default` and `probe`
 * rows it named; never a slot.
 */
export function machineHardwareBackends(
  platform: NodeJS.Platform,
  named: readonly HardwareBackend[],
): HardwareBackend[] {
  return (PLATFORM_HW_VIDEO[platform] ?? [])
    .filter((entry) => entry.use !== 'slot' && named.includes(entry.id))
    .map((entry) => entry.id);
}

/**
 * The rows a hardware video engine (the desktop's reading of the probe, as for the session cap) can drive. The
 * platform's entry then decides which of them run there.
 */
const ENGINE_BACKENDS: Readonly<Record<HardwareVideoEngine, readonly HardwareBackend[]>> = {
  videotoolbox: ['videotoolbox'],
  nvidia: ['cuda'],
  intel: ['vaapi', 'qsv', 'd3d11va', 'mf'],
  amd: ['vaapi', 'amf', 'd3d11va', 'mf'],
  vaapi: ['vaapi'],
  none: [],
};

export function engineHardwareBackends(engine: HardwareVideoEngine): readonly HardwareBackend[] {
  return ENGINE_BACKENDS[engine];
}

/** The row an encoder name belongs to, or undefined for a software encoder. */
export function backendOfEncoder(encoder: string): HwVideoBackend | undefined {
  return Object.values(HW_VIDEO_BACKENDS).find((backend) =>
    Object.values(backend.encode?.encoders ?? {}).includes(encoder),
  );
}

/** The encoder a row has for `codec`, if any. */
export function hardwareEncoderFor(id: HardwareBackend, codec: EncodeCodec): string | undefined {
  return HW_VIDEO_BACKENDS[id].encode?.encoders[codec];
}
