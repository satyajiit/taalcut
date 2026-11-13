// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Linux probe fixtures (test/fixtures/hardware-linux): a machine's files and nvidia-smi output, replayed. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createLinuxHardwareProbe,
  type CommandOutput,
  type CommandRunner,
  type GpuInfo,
  type LinuxFs,
  type ProbeEnv,
} from '@taalcut/models';

export interface LinuxFixture {
  readonly description: string;
  readonly provenance: string;
  /** Absolute path → contents. Directories are the paths' prefixes; device nodes are empty files. */
  readonly files: Readonly<Record<string, string>>;
  readonly commands: { readonly nvidiaSmi: CommandOutput | null };
  readonly freeDiskBytes: number;
  readonly expected: {
    readonly chip: string;
    readonly memoryBytes: number;
    readonly cpuCores: {
      readonly total: number;
      readonly performance?: number;
      readonly efficiency?: number;
    };
    readonly osVersion: string;
    readonly osName: string;
    readonly gpus: readonly GpuInfo[];
    readonly backends: readonly string[];
    readonly tier: string;
    readonly shortfalls: readonly string[];
    readonly profile: string;
    readonly classes: Readonly<Record<'cpu' | 'video' | 'gpu' | 'npu', number>>;
    readonly videoEngine: string;
  };
}

const DIR = join(import.meta.dirname, '../fixtures/hardware-linux');

export const LINUX_FIXTURES = readdirSync(DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));

export const loadLinuxFixture = (name: string): LinuxFixture =>
  JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as LinuxFixture;

/** A read-only file system over the fixture's files; it records what was read. */
export function fixtureFs(files: Readonly<Record<string, string>>) {
  const reads: string[] = [];
  const fs: LinuxFs = {
    readText: async (path) => {
      reads.push(path);
      return files[path];
    },
    list: async (dir) => {
      const prefix = `${dir}/`;
      const names = Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length).split('/')[0] ?? '');
      return [...new Set(names)].sort();
    },
    exists: async (path) => path in files || Object.keys(files).some((p) => p.startsWith(`${path}/`)),
  };
  return { fs, reads };
}

export interface LinuxProbeOptions {
  readonly env?: ProbeEnv;
  readonly files?: Readonly<Record<string, string>>;
  /** Replaces the fixture's nvidia-smi answer per argument list (joined with spaces). */
  readonly smi?: (args: readonly string[]) => CommandOutput;
}

export function linuxProbeFor(fixture: LinuxFixture, options: LinuxProbeOptions = {}) {
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: CommandRunner = async (file, args) => {
    calls.push({ file, args });
    if (options.smi) return options.smi(args);
    return fixture.commands.nvidiaSmi ?? { stdout: '', exitCode: 127 };
  };
  const { fs, reads } = fixtureFs(options.files ?? fixture.files);
  const probe = createLinuxHardwareProbe({
    dataDir: '/home/test/.config/Taalcut',
    env: options.env ?? {},
    run,
    fs,
    freeDiskBytes: async () => fixture.freeDiskBytes,
    system: { platform: () => 'linux', arch: () => 'x64', totalmem: () => 1, cpuCount: () => 1 },
  });
  return { probe, calls, reads };
}
