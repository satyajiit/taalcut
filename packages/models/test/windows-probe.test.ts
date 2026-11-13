// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S6: the Windows hardware probe over replayed PowerShell and nvidia-smi output, and what the tier rules (LNX1:
 * by GPU capability, as on Linux), the lane plan and the session cap make of it. The fixtures are constructed from
 * the documented formats, not captured: this has not run on real Windows hardware.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessHardware,
  createWindowsHardwareProbe,
  hardwareVideoEngine,
  planJobConcurrency,
  type CommandOutput,
  type CommandRunner,
  type GpuInfo,
} from '@taalcut/models';
import { NVIDIA_SMI_ARGS, NVIDIA_SMI_LEGACY_ARGS, parseNvidiaSmi } from '../src/hardware/nvidia-smi';
import { CIM_SCRIPT } from '../src/hardware/windows/parse-cim';

interface WindowsFixture {
  readonly description: string;
  readonly provenance: string;
  readonly commands: { readonly powershell: string; readonly nvidiaSmi: string | null };
  readonly expected: {
    readonly chip: string;
    readonly memoryBytes: number;
    readonly cpuCores: { readonly total: number };
    readonly osVersion: string;
    readonly osName: string;
    readonly gpus: readonly GpuInfo[];
    readonly tier: string;
    readonly shortfalls: readonly string[];
    readonly profile: string;
    readonly classes: Readonly<Record<'cpu' | 'video' | 'gpu' | 'npu', number>>;
    readonly videoEngine: string;
  };
}

const DIR = join(import.meta.dirname, 'fixtures/hardware-win');
const FIXTURES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));
const load = (name: string): WindowsFixture =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as WindowsFixture;

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SMI = 'C:\\Windows\\System32\\nvidia-smi.exe';
const SMI_OLD = 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe';

function probeWith(commands: Record<string, CommandOutput>, env: Record<string, string> = {}) {
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: CommandRunner = async (file, args) => {
    calls.push({ file, args });
    return commands[file] ?? { stdout: '', exitCode: 1 };
  };
  const probe = createWindowsHardwareProbe({
    dataDir: 'C:\\Users\\test\\AppData\\Roaming\\Taalcut',
    env,
    run,
    freeDiskBytes: async () => 300 * 1024 ** 3,
    system: { platform: () => 'win32', arch: () => 'x64', totalmem: () => 16 * 1024 ** 3 },
  });
  return { probe, calls };
}

function fixtureCommands(fixture: WindowsFixture): Record<string, CommandOutput> {
  return {
    [POWERSHELL]: { stdout: fixture.commands.powershell, exitCode: 0 },
    ...(fixture.commands.nvidiaSmi === null
      ? {}
      : { [SMI]: { stdout: fixture.commands.nvidiaSmi, exitCode: 0 } }),
  };
}

describe('Windows hardware probe (constructed fixtures; not run on real hardware)', () => {
  it('every fixture says it was constructed, not captured', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(4);
    for (const name of FIXTURES) expect(load(name).provenance).toMatch(/^Constructed, not captured/);
  });

  it.each(FIXTURES)('%s: facts, lane plan and video engine', async (name) => {
    const fixture = load(name);
    const { probe } = probeWith(fixtureCommands(fixture));
    const result = await probe.probe();
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    const info = result.value;
    const { expected } = fixture;
    expect(info).toMatchObject({
      platform: 'win32',
      arch: 'x64',
      chip: expected.chip,
      memoryBytes: expected.memoryBytes,
      cpuCores: expected.cpuCores,
      osVersion: expected.osVersion,
      osName: expected.osName,
      neuralEngine: false,
      freeDiskBytes: 300 * 1024 ** 3,
    });
    expect(info.gpus).toEqual(expected.gpus);
    // The same capability rule as Linux; not_apple_silicon is a Mac's. The NVIDIA rows come from VRAM, not the tier.
    const assessment = assessHardware(info);
    expect(assessment.tier).toBe(expected.tier);
    expect(assessment.shortfalls).toEqual(expected.shortfalls);
    const planned = planJobConcurrency(info, assessment.tier);
    expect(planned.profile).toBe(expected.profile);
    expect(planned.plan.classes).toEqual({ ...expected.classes, io: 4, network: 4 });
    expect(planned.plan.foldInto).toEqual({ npu: 'gpu' });
    expect(hardwareVideoEngine(info)).toBe(expected.videoEngine);
  });

  it('runs PowerShell by absolute path with an encoded command, and nvidia-smi only for NVIDIA', async () => {
    const nvidia = probeWith(fixtureCommands(load('rtx4090-desktop')));
    await nvidia.probe.probe();
    expect(nvidia.calls.map((c) => c.file)).toEqual([POWERSHELL, SMI]);
    const [ps, smi] = nvidia.calls;
    expect(ps?.args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    expect(Buffer.from(ps?.args[5] ?? '', 'base64').toString('utf16le')).toBe(CIM_SCRIPT);
    expect(smi?.args).toEqual([
      '--query-gpu=index,name,memory.total,memory.used,driver_version,compute_cap,pci.bus_id',
      '--format=csv',
    ]);

    const amd = probeWith(fixtureCommands(load('radeon-rx7800xt')));
    await amd.probe.probe();
    expect(amd.calls.map((c) => c.file)).toEqual([POWERSHELL]);
  });

  it('tries the older NVSMI folder, and without nvidia-smi falls back to the registry and drops CUDA', async () => {
    const fixture = load('rtx4090-desktop');
    const powershell = { stdout: fixture.commands.powershell, exitCode: 0 };
    const older = probeWith({
      [POWERSHELL]: powershell,
      [SMI_OLD]: { stdout: fixture.commands.nvidiaSmi ?? '', exitCode: 0 },
    });
    const viaOld = await older.probe.probe();
    // Each nvidia-smi: the wide query, then the legacy one (drivers before R510 refuse compute_cap).
    expect(older.calls.map((c) => [c.file, c.args])).toEqual([
      [POWERSHELL, expect.anything()],
      [SMI, NVIDIA_SMI_ARGS],
      [SMI, NVIDIA_SMI_LEGACY_ARGS],
      [SMI_OLD, NVIDIA_SMI_ARGS],
    ]);
    expect(viaOld.ok && viaOld.value.gpus[0]?.apis).toEqual(['cuda', 'directml', 'vulkan']);

    const none = await probeWith({ [POWERSHELL]: powershell }).probe.probe();
    expect(none.ok && none.value.gpus[0]).toMatchObject({
      vramBytes: 25_757_220_864,
      apis: ['directml', 'vulkan'],
    });
  });

  it('fails with models.hardware_probe_failed on a failed or unreadable PowerShell call', async () => {
    const failed = await probeWith({ [POWERSHELL]: { stdout: '', exitCode: 1 } }).probe.probe();
    expect(failed).toMatchObject({ ok: false, error: { code: 'models.hardware_probe_failed' } });
    const garbage = await probeWith({
      [POWERSHELL]: { stdout: 'Get-CimInstance : Access denied', exitCode: 0 },
    }).probe.probe();
    expect(garbage).toMatchObject({
      ok: false,
      error: { code: 'models.hardware_probe_failed', detail: 'PowerShell printed no JSON.' },
    });
    const wrong = await probeWith({
      [POWERSHELL]: {
        stdout: JSON.stringify({ cpu: [], os: { Version: 'ten' }, memory: 1, gpus: [] }),
        exitCode: 0,
      },
    }).probe.probe();
    expect(wrong).toMatchObject({ ok: false, error: { code: 'models.hardware_probe_failed' } });
  });
});

describe('Windows probe: environment switches', () => {
  it('honours TAALCUT_FORCE_CPU and CUDA_VISIBLE_DEVICES like the Linux probe', async () => {
    const commands = fixtureCommands(load('rtx4090-desktop'));
    const forced = await probeWith(commands, { TAALCUT_FORCE_CPU: '1' }).probe.probe();
    expect(forced.ok && forced.value.forcedCpu).toBe(true);
    expect(forced.ok && forced.value.gpus[0]?.apis).toEqual([]);
    expect(forced.ok && assessHardware(forced.value).tier).toBe('minimum');
    expect(forced.ok && hardwareVideoEngine(forced.value)).toBe('none');
    const hidden = await probeWith(commands, { CUDA_VISIBLE_DEVICES: '-1' }).probe.probe();
    expect(hidden.ok && hidden.value.gpus[0]?.apis).toEqual(['directml', 'vulkan']);
    // DirectML still runs the models: still High.
    expect(hidden.ok && assessHardware(hidden.value).tier).toBe('high');
  });
});

describe('parseNvidiaSmi', () => {
  it('reads the wide query by its header, with what each column holds', () => {
    const csv =
      'index, name, memory.total [MiB], memory.used [MiB], driver_version, compute_cap, pci.bus_id\n' +
      '0, NVIDIA GeForce RTX 4090, 24564 MiB, 3474 MiB, 615.71.09, 8.9, 00000000:01:00.0\n' +
      '1, NVIDIA RTX A6000, 49140 MiB, [N/A], 615.71.09, [N/A], 00000000:41:00.0\n';
    expect(parseNvidiaSmi(csv)).toEqual([
      {
        name: 'NVIDIA GeForce RTX 4090',
        vramBytes: 24564 * 1024 ** 2,
        vramUsedBytes: 3474 * 1024 ** 2,
        driverVersion: '615.71.09',
        index: 0,
        computeCapability: '8.9',
        pciBusId: '0000:01:00.0',
      },
      {
        name: 'NVIDIA RTX A6000',
        vramBytes: 49140 * 1024 ** 2,
        driverVersion: '615.71.09',
        index: 1,
        pciBusId: '0000:41:00.0',
      },
    ]);
    // nounits, and a name with a comma in it.
    expect(
      parseNvidiaSmi(
        'index, name, memory.total [MiB], driver_version\n0, NVIDIA GeForce RTX 4090, Founders, 24564, 615.71.09\n',
      ),
    ).toEqual([
      {
        name: 'NVIDIA GeForce RTX 4090, Founders',
        vramBytes: 24564 * 1024 ** 2,
        driverVersion: '615.71.09',
        index: 0,
      },
    ]);
  });

  it('reads every GPU, and nothing from output that is not its CSV', () => {
    const csv =
      'name, memory.total [MiB], driver_version\nNVIDIA RTX A6000, 49140 MiB, 560.94\nNVIDIA RTX A6000, 49140 MiB, 560.94\n';
    expect(parseNvidiaSmi(csv)).toEqual([
      { name: 'NVIDIA RTX A6000', vramBytes: 49140 * 1024 ** 2, driverVersion: '560.94' },
      { name: 'NVIDIA RTX A6000', vramBytes: 49140 * 1024 ** 2, driverVersion: '560.94' },
    ]);
    expect(
      parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.'),
    ).toEqual([]);
    expect(parseNvidiaSmi('name, memory.total [MiB], driver_version\nNVIDIA RTX, [N/A], 560.94')).toEqual([]);
    expect(parseNvidiaSmi('')).toEqual([]);
  });
});
