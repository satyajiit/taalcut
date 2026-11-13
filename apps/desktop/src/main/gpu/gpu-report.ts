// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the GPU is doing for the UI (ADR 0002: GPU first; a CPU route is
 * allowed only with a recorded reason). Pure, so the rules are unit-tested;
 * gpu-info.ts feeds it from Electron.
 *
 * Chromium's feature status values: 'enabled', 'enabled_on', 'enabled_force',
 * 'enabled_readback', … run on the GPU; 'disabled_software',
 * 'unavailable_software', 'disabled_off', … don't.
 */

/** Chromium features the UI relies on running on the GPU. video_encode is left out: exports encode with FFmpeg. */
export const UI_GPU_FEATURES = [
  'gpu_compositing',
  'rasterization',
  '2d_canvas',
  'webgl',
  'webgpu',
  'video_decode',
] as const;

/** Switches that move Chromium work off the GPU. None is ever set by Taalcut; a user may pass them. */
export const GPU_DISABLING_SWITCHES = [
  'disable-gpu',
  'disable-gpu-compositing',
  'disable-gpu-rasterization',
  'disable-accelerated-2d-canvas',
  'disable-accelerated-video-decode',
  'disable-webgl',
] as const;

/** Switches that can force a software GL backend (SwiftShader). */
const GL_BACKEND_SWITCHES = ['use-gl', 'use-angle'] as const;

const VENDORS: Readonly<Record<number, string>> = {
  0x106b: 'Apple',
  0x8086: 'Intel',
  0x1002: 'AMD',
  0x10de: 'NVIDIA',
  0x5143: 'Qualcomm',
};

export interface GpuDevice {
  readonly vendorId: number;
  readonly deviceId: number;
  readonly vendor: string;
  readonly active: boolean;
}

export interface CpuFallback {
  readonly feature: string;
  /** Chromium's status, or 'missing' when it doesn't report the feature. */
  readonly status: string;
  readonly reason: string;
}

export interface GpuReport {
  readonly hardwareAcceleration: boolean;
  readonly devices: readonly GpuDevice[];
  /** For example "Mac 17.7"; undefined when Chromium doesn't say. */
  readonly machineModel: string | undefined;
  /** Every feature status Chromium reports. */
  readonly features: Readonly<Record<string, string>>;
  /** UI features running on the CPU, each with why. Empty when everything is on the GPU. */
  readonly cpuFallbacks: readonly CpuFallback[];
}

export interface GpuReportInputs {
  readonly hardwareAcceleration: boolean;
  /** app.getGPUFeatureStatus() */
  readonly featureStatus: object;
  /** app.getGPUInfo('basic'), or undefined if it failed. */
  readonly basicInfo: unknown;
  /** Why getGPUInfo failed, e.g. Chromium's "GPU access not allowed. Reason: …". */
  readonly gpuInfoError?: string | undefined;
  /** GPU-disabling switches on the command line, as "--name" or "--name=value". */
  readonly switches: readonly string[];
  /** False when Chromium never sent gpu-info-update, so the status may be a placeholder. */
  readonly statusReported: boolean;
}

export function isGpuStatus(status: string | undefined): boolean {
  return status?.startsWith('enabled') ?? false;
}

/** The GPU-disabling switches present, e.g. ['--disable-gpu', '--use-angle=swiftshader']. */
export function gpuDisablingSwitches(commandLine: {
  hasSwitch(name: string): boolean;
  getSwitchValue(name: string): string;
}): string[] {
  const found: string[] = GPU_DISABLING_SWITCHES.filter((name) => commandLine.hasSwitch(name)).map(
    (name) => `--${name}`,
  );
  for (const name of GL_BACKEND_SWITCHES) {
    const value = commandLine.hasSwitch(name) ? commandLine.getSwitchValue(name) : '';
    if (/swiftshader/i.test(value)) found.push(`--${name}=${value}`);
  }
  return found;
}

export function toGpuReport(inputs: GpuReportInputs): GpuReport {
  const features = stringEntries(inputs.featureStatus);
  const cause = sharedCause(inputs);
  const cpuFallbacks = UI_GPU_FEATURES.filter((feature) => !isGpuStatus(features[feature])).map((feature) => {
    const status = features[feature] ?? 'missing';
    return { feature, status, reason: cause ?? statusReason(status) };
  });
  const basic = isRecord(inputs.basicInfo) ? inputs.basicInfo : {};
  return {
    hardwareAcceleration: inputs.hardwareAcceleration,
    devices: Array.isArray(basic.gpuDevice) ? basic.gpuDevice.filter(isRecord).map(toDevice) : [],
    machineModel:
      typeof basic.machineModelName === 'string'
        ? [basic.machineModelName, basic.machineModelVersion]
            .filter((part) => typeof part === 'string')
            .join(' ')
        : undefined,
    features,
    cpuFallbacks,
  };
}

/**
 * A reason that explains every fallback at once, most specific first. A
 * switch comes before the acceleration flag: --disable-gpu also makes
 * isHardwareAccelerationEnabled() false.
 */
function sharedCause(inputs: GpuReportInputs): string | undefined {
  if (inputs.switches.length > 0) return `disabled on the command line: ${inputs.switches.join(' ')}`;
  if (!inputs.hardwareAcceleration) {
    return 'hardware acceleration is disabled (app.disableHardwareAcceleration)';
  }
  if (inputs.gpuInfoError) return inputs.gpuInfoError;
  if (!inputs.statusReported) return 'the GPU process never reported its status';
  return undefined;
}

function statusReason(status: string): string {
  if (status === 'missing') return 'Chromium does not report this feature';
  if (status.endsWith('_software')) {
    return 'Chromium runs it in software: no usable GPU, the GPU is blocklisted, or the GPU process crashed';
  }
  return `Chromium turned it off (${status})`;
}

function toDevice(device: Record<string, unknown>): GpuDevice {
  const vendorId = typeof device.vendorId === 'number' ? device.vendorId : 0;
  return {
    vendorId,
    deviceId: typeof device.deviceId === 'number' ? device.deviceId : 0,
    vendor: VENDORS[vendorId] ?? `0x${vendorId.toString(16).padStart(4, '0')}`,
    active: device.active === true,
  };
}

function stringEntries(value: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
