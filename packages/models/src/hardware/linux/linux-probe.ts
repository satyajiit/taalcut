// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Linux HardwareProbe (LNX1): files the kernel and the distribution publish, plus nvidia-smi. CPU from
 * /proc/cpuinfo (and the hybrid core lists in /sys/devices/cpu_core and cpu_atom), memory from /proc/meminfo, the
 * OS from os-release, GPUs from DRM's sysfs, nvidia-smi, the Vulkan ICDs and pci.ids (linux-gpus.ts), free disk
 * from statfs. Files go through an injected reader and nvidia-smi through the injected runner, by absolute path and
 * without a shell, so tests replay what a real machine had. The environment is injected too (accelerator-env.ts).
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { arch, availableParallelism, platform, totalmem } from 'node:os';
import { HardwareProbeFailed } from '../../errors';
import { applyAcceleratorEnv, type ProbeEnv } from '../accelerator-env';
import { defaultCommandRunner, type CommandRunner } from '../command-runner';
import { statfsFreeBytes } from '../free-disk';
import { queryNvidiaSmi, type NvidiaSmiGpu } from '../nvidia-smi';
import type { HardwareInfo, HardwareProbe } from '../types';
import { nodeLinuxFs, type LinuxFs } from './linux-fs';
import { linuxGpus, PCI_IDS_FILES, readDrmGpus, readVulkanDrivers, type DrmGpu } from './linux-gpus';
import { countCpuList, parseCpuinfo, parseMemTotal, parseOsRelease } from './parse-proc';
import { pciDeviceName, PCI_VENDORS } from './parse-sysfs';

export interface LinuxHardwareProbeDeps {
  /** Directory whose volume holds Taalcut's data; free disk is measured there. */
  readonly dataDir: string;
  /** TAALCUT_FORCE_CPU and CUDA_VISIBLE_DEVICES (accelerator-env.ts). Default: none set. */
  readonly env?: ProbeEnv;
  readonly run?: CommandRunner;
  readonly fs?: LinuxFs;
  readonly freeDiskBytes?: (path: string) => Promise<number>;
  readonly system?: {
    readonly platform: () => string;
    readonly arch: () => string;
    readonly totalmem: () => number;
    readonly cpuCount: () => number;
  };
}

export const NVIDIA_SMI_LINUX = '/usr/bin/nvidia-smi';
const OS_RELEASE = ['/etc/os-release', '/usr/lib/os-release'] as const;

export function createLinuxHardwareProbe(deps: LinuxHardwareProbeDeps): HardwareProbe {
  const run = deps.run ?? defaultCommandRunner;
  const fs = deps.fs ?? nodeLinuxFs;
  const freeDisk = deps.freeDiskBytes ?? statfsFreeBytes;
  const system = deps.system ?? { platform, arch, totalmem, cpuCount: availableParallelism };

  const firstText = async (paths: readonly string[]) => {
    for (const path of paths) {
      const text = await fs.readText(path);
      if (text !== undefined) return text;
    }
    return undefined;
  };

  async function nvidiaGpus(signal: { signal?: AbortSignal }): Promise<NvidiaSmiGpu[]> {
    return (await fs.exists(NVIDIA_SMI_LINUX)) ? queryNvidiaSmi(run, NVIDIA_SMI_LINUX, signal) : [];
  }

  /** pci.ids is about 1.4 MB: read only when a GPU has no name from nvidia-smi. */
  async function pciNames(drm: readonly DrmGpu[], nvidia: readonly NvidiaSmiGpu[]) {
    const named = new Set(nvidia.map((row) => row.pciBusId));
    const needed = drm.some((d) => PCI_VENDORS[d.vendorId] !== 'nvidia' || !named.has(d.pciBusId));
    const ids = needed ? ((await firstText(PCI_IDS_FILES)) ?? '') : '';
    return (vendorId: number, deviceId: number) => pciDeviceName(ids, vendorId, deviceId);
  }

  return {
    async probe(options = {}): AsyncResult<HardwareInfo> {
      const signal = options.signal ? { signal: options.signal } : {};
      try {
        const cpuinfo = await fs.readText('/proc/cpuinfo');
        if (cpuinfo === undefined) return err(HardwareProbeFailed({ step: 'cpuinfo' }));
        const cpu = parseCpuinfo(cpuinfo);
        const memoryBytes = parseMemTotal((await fs.readText('/proc/meminfo')) ?? '') ?? system.totalmem();
        const os = parseOsRelease((await firstText(OS_RELEASE)) ?? '');
        const performance = countCpuList((await fs.readText('/sys/devices/cpu_core/cpus')) ?? '');
        const efficiency = countCpuList((await fs.readText('/sys/devices/cpu_atom/cpus')) ?? '');

        const drm = await readDrmGpus(fs);
        const nvidia = await nvidiaGpus(signal);
        const probed = linuxGpus({
          drm,
          nvidia,
          vulkan: await readVulkanDrivers(fs),
          pciName: await pciNames(drm, nvidia),
        });
        const { gpus, forcedCpu } = applyAcceleratorEnv(probed, deps.env ?? {});
        const osName = os.get('PRETTY_NAME') ?? os.get('NAME');
        return ok({
          platform: system.platform(),
          arch: system.arch(),
          chip: cpu.model ?? 'Unknown CPU',
          memoryBytes,
          gpus,
          // Apple's Neural Engine only; Linux NPUs (Intel, AMD) aren't used before v1.
          neuralEngine: false,
          cpuCores: {
            total: cpu.logical || system.cpuCount(),
            // Hybrid Intel: logical CPUs of each kind (a performance core's two threads count as two).
            ...(performance > 0 ? { performance } : {}),
            ...(efficiency > 0 ? { efficiency } : {}),
          },
          freeDiskBytes: await freeDisk(deps.dataDir),
          osVersion: os.get('VERSION_ID') ?? '',
          ...(osName ? { osName } : {}),
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
