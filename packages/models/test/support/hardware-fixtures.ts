// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Recorded macOS probe output (test/fixtures/hardware) replayed through the real probe. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { createMacHardwareProbe, type CommandRunner, type GpuInfo, type HardwareInfo } from '@taalcut/models';

/** The recorded machines: M1 8 GB, M2 16 GB, M3 Max 48 GB, the M5 Max dev machine, an Intel i9 MacBook Pro. */
export const MAC_FIXTURES = [
  'm1-8gb',
  'm2-16gb',
  'm3-max-48gb',
  'm5-max-64gb-dev-machine',
  'intel-i9-16gb',
] as const;

export interface MacFixture {
  readonly description: string;
  readonly platform: string;
  readonly arch: string;
  readonly totalmem: number;
  readonly freeDiskBytes: number;
  readonly commands: { sysctl: string; sysctlExitCode?: number; system_profiler: string; sw_vers: string };
  /** GPU facts, compute backends and the tier this machine must get (ADR 0002). */
  readonly expected: {
    readonly gpus: readonly GpuInfo[];
    readonly neuralEngine: boolean;
    readonly backends: readonly string[];
    readonly tier: string;
    readonly shortfalls: readonly string[];
  };
}

export function loadMacFixture(name: string): MacFixture {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, '../fixtures/hardware', `${name}.json`), 'utf8'),
  ) as MacFixture;
}

export function macProbeFor(fixture: MacFixture, overrides: Partial<MacFixture['commands']> = {}) {
  const commands = { ...fixture.commands, ...overrides };
  const calls: string[] = [];
  const run: CommandRunner = async (file, args) => {
    calls.push([file, ...args].join(' '));
    if (file.endsWith('/sysctl')) return { stdout: commands.sysctl, exitCode: commands.sysctlExitCode ?? 0 };
    if (file.endsWith('/system_profiler')) return { stdout: commands.system_profiler, exitCode: 0 };
    if (file.endsWith('/sw_vers')) return { stdout: commands.sw_vers, exitCode: 0 };
    throw new Error(`unexpected command ${file}`);
  };
  const probe = createMacHardwareProbe({
    dataDir: '/Users/test/Library/Application Support/Taalcut',
    run,
    freeDiskBytes: async () => fixture.freeDiskBytes,
    system: { platform: () => fixture.platform, arch: () => fixture.arch, totalmem: () => fixture.totalmem },
  });
  return { probe, calls };
}

export async function probeMacFixture(name: string): Promise<HardwareInfo> {
  return unwrap(await macProbeFor(loadMacFixture(name)).probe.probe());
}
