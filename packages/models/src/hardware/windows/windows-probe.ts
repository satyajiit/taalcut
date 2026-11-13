// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Windows HardwareProbe (round IX, IX-S6): one PowerShell call for CPU, RAM, OS and display adapters
 * (parse-cim.ts), nvidia-smi for NVIDIA VRAM, driver, compute capability and index (../nvidia-smi.ts, shared with
 * Linux since LNX1), statfs for free disk. Commands run by absolute path through an injected runner, so tests
 * replay recorded output; the environment switches are injected too (../accelerator-env.ts). The planner and the
 * session cap read what it reports (vendor, VRAM, compute APIs). Not run on real Windows hardware yet;
 * packages/models/SPEC.md says so.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { arch, platform, totalmem } from 'node:os';
import { HardwareProbeFailed } from '../../errors';
import { applyAcceleratorEnv, type ProbeEnv } from '../accelerator-env';
import { defaultCommandRunner, type CommandRunner } from '../command-runner';
import { statfsFreeBytes } from '../free-disk';
import { gpuVendorOf } from '../gpu-vendor';
import { queryNvidiaSmi, type NvidiaSmiGpu } from '../nvidia-smi';
import type { GpuApi, GpuInfo, GpuVendor, HardwareInfo, HardwareProbe } from '../types';
import { CIM_SCRIPT, parseCim, type CimOutput } from './parse-cim';

export interface WindowsHardwareProbeDeps {
  /** Directory whose volume holds Taalcut's data; free disk is measured there. */
  readonly dataDir: string;
  /** %SystemRoot%: powershell.exe and (current drivers) nvidia-smi.exe live under it. Default C:\Windows. */
  readonly systemRoot?: string;
  /** TAALCUT_FORCE_CPU and CUDA_VISIBLE_DEVICES (../accelerator-env.ts). Default: none set. */
  readonly env?: ProbeEnv;
  readonly run?: CommandRunner;
  readonly freeDiskBytes?: (path: string) => Promise<number>;
  readonly system?: {
    readonly platform: () => string;
    readonly arch: () => string;
    readonly totalmem: () => number;
  };
}

/** Compute APIs each vendor's Windows driver offers (CUDA only with NVIDIA's driver, which nvidia-smi proves). */
const APIS: Readonly<Record<GpuVendor, readonly GpuApi[]>> = {
  nvidia: ['directml', 'vulkan'],
  amd: ['directml', 'vulkan'],
  intel: ['directml', 'vulkan'],
  apple: [],
  // Microsoft Basic Display Adapter, remote display drivers: no GPU compute.
  other: [],
};

/** -EncodedCommand takes UTF-16LE base64, so no quoting reaches the command line. */
const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

export function createWindowsHardwareProbe(deps: WindowsHardwareProbeDeps): HardwareProbe {
  const run = deps.run ?? defaultCommandRunner;
  const freeDisk = deps.freeDiskBytes ?? statfsFreeBytes;
  const system = deps.system ?? { platform, arch, totalmem };
  const root = deps.systemRoot ?? 'C:\\Windows';
  const powershell = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const nvidiaSmi = [
    `${root}\\System32\\nvidia-smi.exe`,
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ];

  async function nvidiaGpus(signal: { signal?: AbortSignal }): Promise<NvidiaSmiGpu[]> {
    for (const file of nvidiaSmi) {
      const gpus = await queryNvidiaSmi(run, file, signal);
      if (gpus.length > 0) return gpus;
    }
    return [];
  }

  return {
    async probe(options = {}): AsyncResult<HardwareInfo> {
      const signal = options.signal ? { signal: options.signal } : {};
      try {
        const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
        const ps = await run(powershell, [...args, '-EncodedCommand', encoded(CIM_SCRIPT)], signal);
        if (ps.exitCode !== 0)
          return err(HardwareProbeFailed({ step: 'powershell' }, { detail: `exit ${ps.exitCode}` }));
        const cim = parseCim(ps.stdout);
        if (!cim.ok) return err(HardwareProbeFailed({ step: 'cim' }, { detail: cim.reason }));
        const hasNvidia = cim.value.gpus.some((g) => vendorOf(g) === 'nvidia');
        const probed = windowsGpus(cim.value, hasNvidia ? await nvidiaGpus(signal) : []);
        const { gpus, forcedCpu } = applyAcceleratorEnv(probed, deps.env ?? {});
        const osName = cim.value.os.Caption?.trim();
        const cpu = cim.value.cpu;
        const logical = cpu.reduce((sum, c) => sum + (c.NumberOfLogicalProcessors ?? c.NumberOfCores), 0);
        return ok({
          platform: system.platform(),
          arch: system.arch(),
          chip: cpu[0]?.Name.trim() || 'Unknown CPU',
          memoryBytes: cim.value.memory || system.totalmem(),
          gpus,
          // Apple's Neural Engine only; Windows NPUs are not used before v1.
          neuralEngine: false,
          // CIM doesn't tell performance from efficiency cores: the planner then counts all of them.
          cpuCores: { total: logical },
          freeDiskBytes: await freeDisk(deps.dataDir),
          osVersion: cim.value.os.Version,
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

type CimGpu = CimOutput['gpus'][number];

const vendorOf = (gpu: CimGpu): GpuVendor => gpuVendorOf(`${gpu.AdapterCompatibility ?? ''} ${gpu.Name}`);

/** Display adapters, the one with the most VRAM first (the primary GPU, as on a Mac with discrete GPUs). */
export function windowsGpus(cim: CimOutput, nvidia: readonly NvidiaSmiGpu[]): GpuInfo[] {
  const unmatched = [...nvidia];
  const registry = cim.adapterMemory ?? [];
  const gpus = cim.gpus.map((gpu): GpuInfo => {
    const vendor = vendorOf(gpu);
    const smi = vendor === 'nvidia' ? takeByName(unmatched, gpu.Name) : undefined;
    const fromRegistry = registry.find((r) => r.DriverDesc === gpu.Name)?.Bytes ?? undefined;
    const vramBytes = smi?.vramBytes ?? fromRegistry ?? gpu.AdapterRAM ?? undefined;
    // NVIDIA's own numbering ('581.57') from nvidia-smi; CIM's driver store version ('32.0.15.8157') for the rest.
    const driverVersion = smi?.driverVersion ?? (vendor === 'nvidia' ? undefined : gpu.DriverVersion?.trim());
    return {
      name: gpu.Name.trim(),
      vendor,
      ...(vramBytes ? { vramBytes } : {}),
      ...(smi?.vramUsedBytes !== undefined
        ? { vramFreeBytes: Math.max(0, smi.vramBytes - smi.vramUsedBytes) }
        : {}),
      // Integrated GPUs share system memory too, but Windows reports only their small carve-out.
      unifiedMemory: false,
      apis: smi ? ['cuda', ...APIS.nvidia] : APIS[vendor],
      ...(driverVersion ? { driverVersion } : {}),
      ...(smi?.computeCapability ? { computeCapability: smi.computeCapability } : {}),
      ...(smi?.index !== undefined ? { index: smi.index } : {}),
      ...(smi?.pciBusId ? { pciBusId: smi.pciBusId } : {}),
    };
  });
  return gpus.sort((a, b) => (b.vramBytes ?? 0) - (a.vramBytes ?? 0));
}

/** The first nvidia-smi row with this name (several identical cards: in order), taken off the list. */
function takeByName(rows: NvidiaSmiGpu[], name: string): NvidiaSmiGpu | undefined {
  const at = rows.findIndex((row) => row.name === name.trim());
  return at >= 0 ? rows.splice(at, 1)[0] : undefined;
}
