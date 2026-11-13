// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether a component runs on a machine (LNX1 seam 4): its `requires` checked against the machine's description.
 * jobs can't import the hardware probe (`@taalcut/models`), so the machine has its own small shape here and the
 * desktop app maps the probe's HardwareInfo into it. The download set and Settings use this one function; the
 * reason a component doesn't fit is said in words, for the log (ADR 0002: a CPU route says why).
 */
import { KNOWN_REQUIREMENTS, type ComponentRequires } from './requires';

/** One GPU as the probe found it. Fields the probe couldn't read are absent, and a requirement on them fails. */
export interface MachineGpu {
  /** 'nvidia', 'amd', 'intel', 'apple' or 'other'. */
  readonly vendor: string;
  /** The APIs a compute path can target on it: 'cuda', 'vulkan', 'metal', 'directml', 'rocm'. */
  readonly apis: readonly string[];
  /** e.g. '615.71.09'. */
  readonly driverVersion?: string;
  /** CUDA compute capability, e.g. '8.9'. */
  readonly computeCapability?: string;
  /** Dedicated video memory. Absent with unified memory. */
  readonly vramBytes?: number;
}

/** The machine as components see it. */
export interface MachineDescription {
  /** process.platform, e.g. 'linux'. */
  readonly platform: string;
  /** process.arch, e.g. 'x64'. */
  readonly arch: string;
  /** e.g. '24.04' or '15.1'. Absent when unknown: a minimum OS then fails. */
  readonly osVersion?: string;
  /** Every usable GPU, primary first. Empty on a CPU-only machine (or with `CUDA_VISIBLE_DEVICES=-1`). */
  readonly gpus: readonly MachineGpu[];
  /** The C library on Linux, e.g. '2.39' (Ubuntu 24.04). Absent elsewhere or when unknown: a minimum then fails. */
  readonly glibcVersion?: string;
}

export type MachineFitResult = { readonly fits: true } | { readonly fits: false; readonly reason: string };

const FITS: MachineFitResult = { fits: true };
const misfit = (reason: string): MachineFitResult => ({ fits: false, reason });

/**
 * Compares dotted numeric versions ('615.71.09' with '580'): negative, zero or positive. Missing parts count as 0;
 * a part that isn't a number counts as -1, so it never satisfies a minimum.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : -1));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Why `gpu` falls short of the GPU requirements, or undefined when it meets them. */
function gpuShortfall(gpu: MachineGpu, requires: ComponentRequires): string | undefined {
  const { minDriver, minComputeCapability, minVramBytes } = requires;
  if (minDriver !== undefined) {
    if (gpu.driverVersion === undefined) return `its ${gpu.vendor} driver version is unknown`;
    if (compareVersions(gpu.driverVersion, minDriver) < 0)
      return `the ${gpu.vendor} driver is ${gpu.driverVersion}; it needs ${minDriver} or later`;
  }
  if (minComputeCapability !== undefined) {
    if (gpu.computeCapability === undefined) return 'its compute capability is unknown';
    if (compareVersions(gpu.computeCapability, minComputeCapability) < 0)
      return `compute capability ${gpu.computeCapability}; it needs ${minComputeCapability} or later`;
  }
  if (minVramBytes !== undefined) {
    if (gpu.vramBytes === undefined) return 'its video memory is unknown';
    if (gpu.vramBytes < minVramBytes)
      return `${gpu.vramBytes} bytes of video memory; it needs ${minVramBytes}`;
  }
  return undefined;
}

/**
 * Whether `component` runs on `machine`. No `requires`: it does. A machine that isn't described (the probe failed)
 * meets no requirement. Several GPUs: one of them must meet every GPU requirement on its own.
 */
export function machineFit(
  component: { readonly requires?: ComponentRequires | undefined },
  machine: MachineDescription | undefined,
): MachineFitResult {
  const requires = component.requires;
  if (!requires) return FITS;
  const unknown = Object.keys(requires).filter(
    (key) => !(KNOWN_REQUIREMENTS as readonly string[]).includes(key),
  );
  if (unknown.length > 0) return misfit(`it requires ${unknown.join(', ')}, which this build can't check`);
  if (!machine) return misfit("this machine's hardware is unknown");
  const { platform, minOsVersion, gpuApi } = requires;
  if (platform !== undefined && platform !== machine.platform)
    return misfit(`it runs on ${platform}; this is ${machine.platform}`);
  if (minOsVersion !== undefined) {
    if (machine.osVersion === undefined)
      return misfit(`it needs ${platform} ${minOsVersion}; the version is unknown`);
    if (compareVersions(machine.osVersion, minOsVersion) < 0)
      return misfit(`it needs ${platform} ${minOsVersion} or later; this is ${machine.osVersion}`);
  }
  if (requires.minGlibc !== undefined) {
    if (machine.glibcVersion === undefined)
      return misfit(`it needs glibc ${requires.minGlibc}; this has none known`);
    if (compareVersions(machine.glibcVersion, requires.minGlibc) < 0)
      return misfit(`it needs glibc ${requires.minGlibc} or later; this has ${machine.glibcVersion}`);
  }
  if (gpuApi === undefined) return FITS;
  const offering = machine.gpus.filter((gpu) => gpu.apis.includes(gpuApi));
  if (offering.length === 0) return misfit(`no GPU here offers ${gpuApi}`);
  const shortfalls = offering.map((gpu) => gpuShortfall(gpu, requires));
  if (shortfalls.some((shortfall) => shortfall === undefined)) return FITS;
  return misfit(`the ${gpuApi} GPU falls short: ${shortfalls[0]!}`);
}
