// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-HW: the Linux hardware probe over replayed files and nvidia-smi output, and what the tier rules, the lane
 * plan and the session cap make of it. One machine is recorded (the RTX 4090 host); the others are constructed
 * from its formats, and say so.
 */
import { jobConcurrencyPlanSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  hardwareVideoEngine,
  planJobConcurrency,
  type HardwareInfo,
  type ProbeEnv,
} from '@taalcut/models';
import { NVIDIA_SMI_ARGS, NVIDIA_SMI_LEGACY_ARGS } from '../src/hardware/nvidia-smi';
import { LINUX_FIXTURES, linuxProbeFor, loadLinuxFixture } from './support/linux-fixtures';

const HOST = 'rtx4090-uhd770-ubuntu-24.04';
const SMI = '/usr/bin/nvidia-smi';

async function probe(name: string, env: ProbeEnv = {}): Promise<HardwareInfo> {
  const result = await linuxProbeFor(loadLinuxFixture(name), { env }).probe.probe();
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
  return result.value;
}

describe('Linux hardware probe', () => {
  it('has the recorded host and constructed machines, each saying which it is', () => {
    expect(LINUX_FIXTURES).toContain(HOST);
    expect(LINUX_FIXTURES.length).toBeGreaterThanOrEqual(5);
    for (const name of LINUX_FIXTURES) {
      const { provenance } = loadLinuxFixture(name);
      expect(provenance).toMatch(name === HOST ? /^Recorded on the LNX1 host/ : /^Constructed, not captured/);
    }
  });

  it.each(LINUX_FIXTURES)('%s: facts, tier, lane plan and video engine', async (name) => {
    const { expected } = loadLinuxFixture(name);
    const info = await probe(name);
    expect(info).toMatchObject({
      platform: 'linux',
      arch: 'x64',
      chip: expected.chip,
      memoryBytes: expected.memoryBytes,
      osVersion: expected.osVersion,
      osName: expected.osName,
      neuralEngine: false,
    });
    expect(info.cpuCores).toEqual(expected.cpuCores);
    expect(info.gpus).toEqual(expected.gpus);
    expect(info.forcedCpu).toBeUndefined();
    const assessment = assessHardware(info);
    expect(assessment.compute.backends).toEqual(expected.backends);
    expect(assessment.tier).toBe(expected.tier);
    expect(assessment.shortfalls).toEqual(expected.shortfalls);
    const planned = planJobConcurrency(info, assessment.tier);
    expect(planned.profile).toBe(expected.profile);
    expect(planned.plan.classes).toEqual({ ...expected.classes, io: 4, network: 4 });
    expect(planned.plan.foldInto).toEqual({ npu: 'gpu' });
    expect(jobConcurrencyPlanSchema.safeParse(planned.plan).success).toBe(true);
    expect(hardwareVideoEngine(info)).toBe(expected.videoEngine);
  });

  it('on the host: "NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver 615.71.09", Ubuntu 24.04, High', async () => {
    const info = await probe(HOST);
    const [gpu] = info.gpus;
    const line = `${gpu?.name} · ${Math.round((gpu?.vramBytes ?? 0) / 1024 ** 3)} GB · ${gpu?.apis[0]?.toUpperCase()} · driver ${gpu?.driverVersion}`;
    expect(line).toBe('NVIDIA GeForce RTX 4090 · 24 GB · CUDA · driver 615.71.09');
    expect(info.osName).toBe('Ubuntu 24.04.5 LTS');
    expect(assessHardware(info).tier).toBe('high');
  });

  it('CUDA_VISIBLE_DEVICES=-1 hides CUDA (Vulkan still sees the card); the iGPU takes video', async () => {
    for (const hidden of ['-1', '', '1']) {
      const info = await probe(HOST, { CUDA_VISIBLE_DEVICES: hidden });
      expect(info.gpus[0]).toMatchObject({ name: 'NVIDIA GeForce RTX 4090', apis: ['vulkan'] });
      expect(info.gpus[0]?.cudaDeviceId).toBeUndefined();
      const assessment = assessHardware(info);
      expect(assessment.compute.backends).toEqual(['vulkan', 'webgpu', 'cpu']);
      expect(assessment.tier).toBe('recommended');
      expect(assessment.shortfalls).toEqual([]);
      expect(hardwareVideoEngine(info)).toBe('vaapi');
    }
    const shown = await probe(HOST, { CUDA_VISIBLE_DEVICES: '0' });
    expect(shown.gpus[0]).toMatchObject({ apis: ['cuda', 'vulkan'], cudaDeviceId: 0 });
  });

  it('TAALCUT_FORCE_CPU=1 reports every GPU with no API: CPU only, Minimum, no_gpu_for_local_models', async () => {
    const info = await probe(HOST, { TAALCUT_FORCE_CPU: '1' });
    expect(info.forcedCpu).toBe(true);
    expect(info.gpus.map((g) => [g.name, g.apis])).toEqual([
      ['NVIDIA GeForce RTX 4090', []],
      ['Intel UHD Graphics 770', []],
    ]);
    const assessment = assessHardware(info);
    expect(assessment.compute.backends).toEqual(['cpu']);
    expect(assessment.tier).toBe('minimum');
    expect(assessment.shortfalls).toEqual(['no_gpu_for_local_models']);
    const planned = planJobConcurrency(info, assessment.tier);
    expect(planned.profile).toBe('no-accelerator');
    expect(hardwareVideoEngine(info)).toBe('none');
    // Anything but 1, true or yes leaves the GPUs on.
    expect((await probe(HOST, { TAALCUT_FORCE_CPU: '0' })).forcedCpu).toBeUndefined();
  });

  it('runs nvidia-smi by absolute path with the wide query, and the legacy query when a driver refuses it', async () => {
    const fixture = loadLinuxFixture(HOST);
    const wide = linuxProbeFor(fixture);
    await wide.probe.probe();
    expect(wide.calls).toEqual([{ file: SMI, args: NVIDIA_SMI_ARGS }]);

    const old = fixture.commands.nvidiaSmi!.stdout.replace(', compute_cap', '').replace(', 8.9', '');
    const legacy = linuxProbeFor(fixture, {
      smi: (args) => (args === NVIDIA_SMI_ARGS ? { stdout: '', exitCode: 2 } : { stdout: old, exitCode: 0 }),
    });
    const result = await legacy.probe.probe();
    expect(legacy.calls.map((c) => c.args)).toEqual([NVIDIA_SMI_ARGS, NVIDIA_SMI_LEGACY_ARGS]);
    expect(result.ok && result.value.gpus[0]).toMatchObject({
      apis: ['cuda', 'vulkan'],
      driverVersion: '615.71.09',
    });
    expect(result.ok && result.value.gpus[0]?.computeCapability).toBeUndefined();
  });

  it('without nvidia-smi (or when it fails) an NVIDIA card has no CUDA, a pci.ids name and no VRAM', async () => {
    const fixture = loadLinuxFixture(HOST);
    const { [SMI]: _smi, ...withoutSmi } = fixture.files;
    const missing = linuxProbeFor(fixture, { files: withoutSmi });
    const result = await missing.probe.probe();
    expect(missing.calls).toEqual([]);
    expect(result.ok && result.value.gpus.map((g) => [g.name, g.apis])).toEqual([
      ['NVIDIA GeForce RTX 4090', ['vulkan']],
      ['Intel UHD Graphics 770', ['vulkan']],
    ]);
    const failing = await linuxProbeFor(fixture, { smi: () => ({ stdout: '', exitCode: 9 }) }).probe.probe();
    expect(failing.ok && failing.value.gpus[0]?.apis).toEqual(['vulkan']);
  });

  it('adds an nvidia-smi GPU that DRM does not list (a compute card without nvidia-drm)', async () => {
    const fixture = loadLinuxFixture(HOST);
    const smi =
      fixture.commands.nvidiaSmi!.stdout +
      '1, NVIDIA L4, 23034 MiB, 0 MiB, 615.71.09, 8.9, 00000000:41:00.0\n';
    const result = await linuxProbeFor(fixture, { smi: () => ({ stdout: smi, exitCode: 0 }) }).probe.probe();
    expect(result.ok && result.value.gpus.map((g) => [g.name, g.apis, g.cudaDeviceId, g.pciBusId])).toEqual([
      ['NVIDIA GeForce RTX 4090', ['cuda', 'vulkan'], 0, '0000:01:00.0'],
      ['NVIDIA L4', ['cuda', 'vulkan'], 1, '0000:41:00.0'],
      ['Intel UHD Graphics 770', ['vulkan'], undefined, '0000:00:02.0'],
    ]);
  });

  it('offers no Vulkan without the loader, and reads pci.ids only for a GPU nvidia-smi does not name', async () => {
    const fixture = loadLinuxFixture('rtx3080-driver-570-ubuntu-22.04');
    const noLoader = Object.fromEntries(
      Object.entries(fixture.files).filter(([p]) => !p.includes('libvulkan.so')),
    );
    const run = linuxProbeFor(fixture, { files: noLoader });
    const result = await run.probe.probe();
    expect(result.ok && result.value.gpus[0]?.apis).toEqual(['cuda']);
    expect(run.reads.some((path) => path.endsWith('pci.ids'))).toBe(false);
    const host = linuxProbeFor(loadLinuxFixture(HOST));
    await host.probe.probe();
    expect(host.reads).toContain('/usr/share/misc/pci.ids');
  });

  it('fails with models.hardware_probe_failed without /proc/cpuinfo, and falls back for the rest', async () => {
    const fixture = loadLinuxFixture('no-gpu-vm-ubuntu-20.04');
    const { ['/proc/cpuinfo']: _cpu, ...noProc } = fixture.files;
    expect(await linuxProbeFor(fixture, { files: noProc }).probe.probe()).toMatchObject({
      ok: false,
      error: { code: 'models.hardware_probe_failed' },
    });
    const bare = await linuxProbeFor(fixture, { files: { '/proc/cpuinfo': '' } }).probe.probe();
    expect(bare.ok && bare.value).toMatchObject({
      chip: 'Unknown CPU',
      memoryBytes: 1,
      cpuCores: { total: 1 },
      osVersion: '',
      gpus: [],
    });
    expect(bare.ok && bare.value.osName).toBeUndefined();
  });
});
