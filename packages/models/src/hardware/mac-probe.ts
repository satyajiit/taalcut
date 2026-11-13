// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * macOS HardwareProbe: sysctl for chip, model, memory and cores;
 * system_profiler for the GPUs (Metal family, cores, VRAM); sw_vers for the OS version; statfs for free
 * disk. Commands go through an injected runner (command-runner.ts), so tests
 * feed recorded output from real machines instead of running anything. The environment is injected too
 * (accelerator-env.ts): TAALCUT_FORCE_CPU takes the GPUs' APIs away and marks the machine `forcedCpu`, as on Linux
 * and Windows, so the component fit picks the CPU builds.
 */
import { arch, platform, totalmem } from 'node:os';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { HardwareProbeFailed } from '../errors';
import { applyAcceleratorEnv, type ProbeEnv } from './accelerator-env';
import { defaultCommandRunner, type CommandRunner } from './command-runner';
import { statfsFreeBytes } from './free-disk';
import { parseAppleChip, parseGpus, parseOsVersion, parseSysctl } from './parse-mac';
import type { HardwareInfo, HardwareProbe } from './types';

export interface MacHardwareProbeDeps {
  /** Directory whose volume holds Taalcut's data; free disk is measured there. */
  readonly dataDir: string;
  /** TAALCUT_FORCE_CPU (accelerator-env.ts); the desktop passes `process.env`. Default: none set. */
  readonly env?: ProbeEnv;
  readonly run?: CommandRunner;
  readonly freeDiskBytes?: (path: string) => Promise<number>;
  readonly system?: {
    readonly platform: () => string;
    readonly arch: () => string;
    readonly totalmem: () => number;
  };
}

const SYSCTL_KEYS = [
  'machdep.cpu.brand_string',
  'hw.model',
  'hw.memsize',
  'hw.ncpu',
  'hw.perflevel0.physicalcpu',
  'hw.perflevel1.physicalcpu',
];

export function createMacHardwareProbe(deps: MacHardwareProbeDeps): HardwareProbe {
  const run = deps.run ?? defaultCommandRunner;
  const freeDisk = deps.freeDiskBytes ?? statfsFreeBytes;
  const system = deps.system ?? { platform, arch, totalmem };

  return {
    async probe(options = {}): AsyncResult<HardwareInfo> {
      const signal = options.signal ? { signal: options.signal } : {};
      try {
        // sysctl prints the names it knows even when one (perflevel on Intel) is unknown and it exits 1.
        const sysctl = parseSysctl((await run('/usr/sbin/sysctl', SYSCTL_KEYS, signal)).stdout);
        const brand = sysctl.get('machdep.cpu.brand_string');
        if (!brand) return err(HardwareProbeFailed({ step: 'sysctl' }, { detail: 'No CPU brand string.' }));

        const displays = await run('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json'], signal);
        const osVersion = parseOsVersion((await run('/usr/bin/sw_vers', ['-productVersion'], signal)).stdout);
        if (!osVersion) return err(HardwareProbeFailed({ step: 'sw_vers' }));

        const memoryBytes = Number(sysctl.get('hw.memsize')) || system.totalmem();
        const appleChip = parseAppleChip(brand);
        const { gpus, forcedCpu } = applyAcceleratorEnv(parseGpus(displays.stdout), deps.env ?? {});
        const gpuCores = gpus[0]?.cores;
        const performance = Number(sysctl.get('hw.perflevel0.physicalcpu')) || undefined;
        const efficiency = Number(sysctl.get('hw.perflevel1.physicalcpu')) || undefined;
        const machineModel = sysctl.get('hw.model');
        return ok({
          platform: system.platform(),
          arch: system.arch(),
          chip: brand,
          ...(appleChip ? { appleChip } : {}),
          ...(machineModel ? { machineModel } : {}),
          memoryBytes,
          ...(gpuCores !== undefined ? { gpuCores } : {}),
          gpus,
          // Every Apple Silicon chip has a Neural Engine; Intel Macs have none.
          neuralEngine: appleChip !== undefined,
          cpuCores: {
            total: Number(sysctl.get('hw.ncpu')) || (performance ?? 0) + (efficiency ?? 0),
            ...(performance !== undefined ? { performance } : {}),
            ...(efficiency !== undefined ? { efficiency } : {}),
          },
          freeDiskBytes: await freeDisk(deps.dataDir),
          osVersion,
          ...(forcedCpu ? { forcedCpu } : {}),
        });
      } catch (cause) {
        return err(
          HardwareProbeFailed(
            { step: 'probe' },
            { detail: cause instanceof Error ? cause.message : String(cause) },
          ),
        );
      }
    },
  };
}
