// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createGpuInfo, logCpuFallbacks, type GpuAppPort } from '../src/main/gpu/gpu-info';
import { gpuDisablingSwitches, toGpuReport, UI_GPU_FEATURES } from '../src/main/gpu/gpu-report';

/** What Electron 44 reports on an Apple silicon Mac (checked on 2026-10-12). */
const ON_GPU = {
  '2d_canvas': 'enabled',
  gpu_compositing: 'enabled',
  multiple_raster_threads: 'enabled_on',
  opengl: 'enabled_on',
  rasterization: 'enabled',
  skia_graphite: 'enabled_on',
  video_decode: 'enabled',
  video_encode: 'enabled',
  webgl: 'enabled',
  webgpu: 'enabled',
  webnn: 'disabled_off',
};
const SOFTWARE = Object.fromEntries(
  Object.keys(ON_GPU).map((key) => [
    key,
    key === 'webgl' || key === 'webgpu' ? 'disabled_off' : 'disabled_software',
  ]),
);
const BASIC = {
  auxAttributes: { inProcessGpu: true },
  gpuDevice: [{ active: true, deviceId: 0, gpuPreference: 0, vendorId: 4203 }],
  machineModelName: 'Mac',
  machineModelVersion: '17.7',
};
const noSwitches = { hasSwitch: () => false, getSwitchValue: () => '' };
const base = { hardwareAcceleration: true, basicInfo: BASIC, switches: [], statusReported: true };

describe('toGpuReport', () => {
  it('reports devices, model and features, and no CPU fallback when the UI is on the GPU', () => {
    expect(toGpuReport({ ...base, featureStatus: ON_GPU })).toEqual({
      hardwareAcceleration: true,
      devices: [{ vendorId: 0x106b, deviceId: 0, vendor: 'Apple', active: true }],
      machineModel: 'Mac 17.7',
      features: ON_GPU,
      cpuFallbacks: [],
    });
  });

  it('records a reason for every UI feature that runs on the CPU', () => {
    const report = toGpuReport({ ...base, featureStatus: { ...ON_GPU, rasterization: 'disabled_software' } });
    expect(report.cpuFallbacks).toEqual([
      {
        feature: 'rasterization',
        status: 'disabled_software',
        reason: expect.stringMatching(/^Chromium runs it in software/),
      },
    ]);
    const { webgpu: _, ...withoutWebGpu } = ON_GPU;
    expect(toGpuReport({ ...base, featureStatus: withoutWebGpu }).cpuFallbacks).toEqual([
      { feature: 'webgpu', status: 'missing', reason: 'Chromium does not report this feature' },
    ]);
  });

  it('blames the most specific cause: a switch, acceleration off, a GPU error, no report', () => {
    const reasons = (inputs: Partial<Parameters<typeof toGpuReport>[0]>) =>
      new Set(toGpuReport({ ...base, featureStatus: SOFTWARE, ...inputs }).cpuFallbacks.map((f) => f.reason));
    // --disable-gpu also turns isHardwareAccelerationEnabled() false (Electron 44, packaged app).
    expect(reasons({ switches: ['--disable-gpu'], hardwareAcceleration: false })).toEqual(
      new Set(['disabled on the command line: --disable-gpu']),
    );
    expect(reasons({ hardwareAcceleration: false })).toEqual(
      new Set(['hardware acceleration is disabled (app.disableHardwareAcceleration)']),
    );
    const denied =
      'GPU access not allowed. Reason: GPU access is disabled through commandline switch --disable-gpu';
    expect(reasons({ basicInfo: undefined, gpuInfoError: denied })).toEqual(new Set([denied]));
    expect(reasons({ statusReported: false })).toEqual(
      new Set(['the GPU process never reported its status']),
    );
    expect(toGpuReport({ ...base, featureStatus: SOFTWARE }).cpuFallbacks.map((f) => f.feature)).toEqual([
      ...UI_GPU_FEATURES,
    ]);
  });

  it('copes with missing or odd basic info', () => {
    const report = toGpuReport({
      ...base,
      featureStatus: ON_GPU,
      basicInfo: { gpuDevice: [{ vendorId: 0x1234 }, 7] },
    });
    expect(report.devices).toEqual([{ vendorId: 0x1234, deviceId: 0, vendor: '0x1234', active: false }]);
    expect(report.machineModel).toBeUndefined();
    expect(toGpuReport({ ...base, featureStatus: ON_GPU, basicInfo: undefined }).devices).toEqual([]);
  });
});

describe('gpuDisablingSwitches', () => {
  it('finds --disable-gpu* switches and a forced SwiftShader backend', () => {
    const switches: Record<string, string> = { 'disable-gpu-compositing': '', 'use-angle': 'swiftshader' };
    const commandLine = {
      hasSwitch: (name: string) => name in switches,
      getSwitchValue: (name: string) => switches[name] ?? '',
    };
    expect(gpuDisablingSwitches(commandLine)).toEqual([
      '--disable-gpu-compositing',
      '--use-angle=swiftshader',
    ]);
    expect(
      gpuDisablingSwitches({ hasSwitch: (n) => n === 'use-angle', getSwitchValue: () => 'metal' }),
    ).toEqual([]);
    expect(gpuDisablingSwitches(noSwitches)).toEqual([]);
  });
});

function fakeApp(status: object, basic: () => Promise<unknown> = async () => BASIC) {
  let update = (): void => {};
  const app: GpuAppPort = {
    isHardwareAccelerationEnabled: () => true,
    getGPUFeatureStatus: () => status,
    getGPUInfo: basic,
    on: (_event, listener) => {
      update = listener;
    },
  };
  return { app, update: () => update() };
}

describe('createGpuInfo', () => {
  it('waits for the GPU process to report before reading', async () => {
    const fake = fakeApp(ON_GPU);
    const read = createGpuInfo(fake.app, noSwitches, { timeoutMs: 10_000 }).read();
    fake.update();
    expect((await read).cpuFallbacks).toEqual([]);
  });

  it('reads anyway after the timeout, and says the status was never reported', async () => {
    const report = await createGpuInfo(fakeApp(SOFTWARE).app, noSwitches, { timeoutMs: 1 }).read();
    expect(report.cpuFallbacks[0]?.reason).toBe('the GPU process never reported its status');
  });

  it("keeps Chromium's reason when getGPUInfo is refused", async () => {
    const fake = fakeApp(SOFTWARE, () =>
      Promise.reject(new Error('GPU access not allowed. Reason: blocklisted')),
    );
    const gpu = createGpuInfo(fake.app, noSwitches);
    fake.update();
    const report = await gpu.read();
    expect(report.devices).toEqual([]);
    expect(report.cpuFallbacks[0]?.reason).toBe('GPU access not allowed. Reason: blocklisted');
  });
});

describe('logCpuFallbacks', () => {
  it('logs only when something runs on the CPU', () => {
    const warn = vi.fn();
    expect(logCpuFallbacks(toGpuReport({ ...base, featureStatus: ON_GPU }), warn)).toBe(false);
    expect(
      logCpuFallbacks(toGpuReport({ ...base, featureStatus: SOFTWARE, switches: ['--disable-gpu'] }), warn),
    ).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/^\[gpu\] CPU fallback \[.*--disable-gpu/);
  });
});

describe('hardware acceleration (ADR 0002)', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(dir, entry.name)) : [join(dir, entry.name)],
    );

  it('is never disabled, and no GPU-disabling switch is ever appended', () => {
    for (const file of sources(join(import.meta.dirname, '..', 'src'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/disableHardwareAcceleration\s*\(/);
      expect(text, file).not.toMatch(
        /appendSwitch\([^)]*(gpu|swiftshader|use-gl|use-angle|accelerated|webgl)/i,
      );
    }
  });
});
