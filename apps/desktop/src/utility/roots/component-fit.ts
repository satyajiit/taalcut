// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which components run on this machine (LNX1 seam 4): the probe's HardwareInfo as the machine description
 * packages/jobs checks components' `requires` against (jobs can't import @taalcut/models), and the one rule the
 * shipped manifest predates `requires` for. The download of everything this machine needs and Settings › About's
 * list both go through here, so they agree.
 */
import { machineFit, type ComponentRequires, type MachineDescription } from '@taalcut/jobs';
import { EMBEDDING_COREML_COMPONENT, EMBEDDING_COREML_MIN_MACOS } from '@taalcut/vision';

/**
 * One GPU as the probe reports it. driverVersion and computeCapability come with the Linux probe (LNX1-HW); a GPU
 * without them meets no driver or compute capability minimum.
 */
export interface ProbedGpu {
  readonly vendor: string;
  readonly apis: readonly string[];
  readonly vramBytes?: number | undefined;
  readonly driverVersion?: string | undefined;
  readonly computeCapability?: string | undefined;
}

export interface ProbedMachine {
  readonly platform: string;
  readonly arch: string;
  readonly osVersion: string;
  readonly gpus: readonly ProbedGpu[];
}

let glibc: { readonly version: string | undefined } | undefined;

/** This process's glibc ('2.39'), or undefined off glibc (macOS, Windows, musl). Read once: a report is slow. */
export function runtimeGlibc(): string | undefined {
  glibc ??= { version: readGlibc() };
  return glibc.version;
}

function readGlibc(): string | undefined {
  try {
    const header = (process.report.getReport() as { header?: { glibcVersionRuntime?: unknown } }).header;
    return typeof header?.glibcVersionRuntime === 'string' ? header.glibcVersionRuntime : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The probe's facts as packages/jobs reads them, with the C library the process runs on (`glibcVersion`, default
 * this process's; null: none, as off Linux).
 */
export function describeMachine(
  info: ProbedMachine,
  glibcVersion: string | null = runtimeGlibc() ?? null,
): MachineDescription {
  return {
    platform: info.platform,
    arch: info.arch,
    osVersion: info.osVersion,
    ...(glibcVersion ? { glibcVersion } : {}),
    gpus: info.gpus.map((gpu) => ({
      vendor: gpu.vendor,
      apis: [...gpu.apis],
      ...(gpu.driverVersion ? { driverVersion: gpu.driverVersion } : {}),
      ...(gpu.computeCapability ? { computeCapability: gpu.computeCapability } : {}),
      ...(gpu.vramBytes ? { vramBytes: gpu.vramBytes } : {}),
    })),
  };
}

/**
 * Requirements the shipped manifest (sequence 17) doesn't state yet, checked like the manifest's own. The Core ML
 * embedder needs macOS 15. Drop an entry once manifest.signed.json carries it as `requires`.
 */
const UNTIL_SIGNED: Readonly<Record<string, ComponentRequires>> = {
  [EMBEDDING_COREML_COMPONENT]: { platform: 'darwin', minOsVersion: String(EMBEDDING_COREML_MIN_MACOS) },
};

/**
 * Whether a component runs on this machine (`machine` undefined: not probed, so nothing with a requirement does):
 * its manifest `requires`, else the rule above. A component without either runs anywhere it has a build for.
 */
export function componentFits(
  component: { readonly id: string; readonly requires?: ComponentRequires | undefined },
  machine: MachineDescription | undefined,
): boolean {
  return machineFit({ requires: component.requires ?? UNTIL_SIGNED[component.id] }, machine).fits;
}
