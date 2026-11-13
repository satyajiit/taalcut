// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F7 (F3's open item): the Mac probe honours TAALCUT_FORCE_CPU as the Linux and Windows probes do, so a forced
 * Mac reports no GPU API and `forcedCpu`, and the listening components' fit picks the int8 builds.
 */
import { describe, expect, it } from 'vitest';
import { assessHardware, createMacHardwareProbe, type HardwareInfo } from '@taalcut/models';
import { loadMacFixture } from './support/hardware-fixtures';

async function probeM1(env?: Readonly<Record<string, string | undefined>>): Promise<HardwareInfo> {
  const fixture = loadMacFixture('m1-8gb');
  const probe = createMacHardwareProbe({
    dataDir: '/Users/test/Library/Application Support/Taalcut',
    ...(env ? { env } : {}),
    run: async (file) => {
      if (file.endsWith('/sysctl')) return { stdout: fixture.commands.sysctl, exitCode: 0 };
      if (file.endsWith('/system_profiler')) return { stdout: fixture.commands.system_profiler, exitCode: 0 };
      if (file.endsWith('/sw_vers')) return { stdout: fixture.commands.sw_vers, exitCode: 0 };
      throw new Error(`unexpected command ${file}`);
    },
    freeDiskBytes: async () => fixture.freeDiskBytes,
    system: { platform: () => fixture.platform, arch: () => fixture.arch, totalmem: () => fixture.totalmem },
  });
  const probed = await probe.probe();
  if (!probed.ok) throw new Error(probed.error.code);
  return probed.value;
}

describe('the Mac probe and TAALCUT_FORCE_CPU', () => {
  it('without it, the M1 keeps Metal and is not forced', async () => {
    const info = await probeM1({});
    expect(info.gpus[0]?.apis).toContain('metal');
    expect(info.forcedCpu).toBeUndefined();
    expect(assessHardware(info).compute.backends).not.toEqual(['cpu']);
  });

  it.each(['1', 'true', 'YES'])(
    'TAALCUT_FORCE_CPU=%s takes every GPU API away and marks it forced',
    async (value) => {
      const info = await probeM1({ TAALCUT_FORCE_CPU: value });
      expect(info.forcedCpu).toBe(true);
      expect(info.gpus.length).toBeGreaterThan(0);
      expect(info.gpus.every((gpu) => gpu.apis.length === 0)).toBe(true);
      // The GPU is still described (cores, vendor): only its APIs are off.
      expect(info.gpuCores).toBe(7);
      const assessment = assessHardware(info);
      expect(assessment.compute.backends).toEqual(['cpu']);
      expect(assessment.compute.forcedCpu).toBe(true);
    },
  );

  it('no environment given reads none (the default)', async () => {
    expect((await probeM1()).forcedCpu).toBeUndefined();
  });
});
