// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The composition roots as tests run them: the real roots, with a fixed
 * Apple-silicon machine instead of the macOS probe, no llama.cpp sidecar,
 * and (for jobs) the kinds a test gives instead of FFmpeg's.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  defineJobKind,
  ok,
  registerJob,
  type JobRegistration,
  type PortLike,
  type UtilityName,
} from '@taalcut/core';
import { assessHardware, type HardwareInfo } from '@taalcut/models';
import { z } from 'zod';
import type { UtilityConfig } from '../../src/shared/rpc-ipc';
import type { LocalRuntimeSlot, ProbedHardware } from '../../src/shared/tokens';
import { composeAgent } from '../../src/utility/roots/agent-root';
import { composeJobs } from '../../src/utility/roots/jobs-root';
import { composeStub } from '../../src/utility/roots/stub-root';
import type { ComposeUtility } from '../../src/utility/runtime';

export const SOUL = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'SOUL.md'), 'utf8');

const GIB = 1024 ** 3;

export const M3_INFO: HardwareInfo = {
  platform: 'darwin',
  arch: 'arm64',
  chip: 'Apple M3 Pro',
  appleChip: { generation: 3, variant: 'pro' },
  machineModel: 'Mac15,6',
  memoryBytes: 36 * GIB,
  gpuCores: 18,
  gpus: [
    {
      name: 'Apple M3 Pro',
      vendor: 'apple',
      cores: 18,
      unifiedMemory: true,
      apis: ['metal'],
      metalFamily: 'metal3',
    },
  ],
  neuralEngine: true,
  cpuCores: { total: 12, performance: 6, efficiency: 6 },
  freeDiskBytes: 400 * GIB,
  osVersion: '15.1',
};

export const fakeHardware = async (): Promise<ProbedHardware> => ({
  info: M3_INFO,
  assessment: assessHardware(M3_INFO),
});

export const noLocalRuntime = (): LocalRuntimeSlot => ({
  localLease: async () => ok(undefined),
  runtime: () => undefined,
  start: () => undefined,
  stopForExport: async () => ok(undefined),
  resumeAfterExport: async () => ok(undefined),
  dispose: async () => undefined,
});

/** A job kind that counts, for runner tests. */
export const countKind = defineJobKind({
  kind: 'test.count',
  input: z.object({ to: z.int().positive() }),
  output: z.object({ counted: z.int() }),
  resource: 'cpu',
});

export const COUNT_JOBS: readonly JobRegistration[] = [
  registerJob(countKind, async ({ to }, context) => {
    for (let i = 1; i <= to; i++) context.progress({ fraction: i / to });
    return ok({ counted: to });
  }),
];

/** One scratch userData per test file (the component manager writes there), removed afterwards. */
let scratch: string | undefined;
const testUserData = (): string => (scratch ??= mkdtempSync(join(tmpdir(), 'taalcut-test-')));
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

export function testConfig(
  process: UtilityName,
  dbPath = ':memory:',
  userData = testUserData(),
): UtilityConfig {
  return {
    process,
    dbPath,
    userData,
    resourcesPath: join(userData, 'resources'),
    packaged: false,
    componentManifest: join(userData, 'resources', 'manifest.signed.json'),
  };
}

export function testAgent(config: UtilityConfig, options: { main?: PortLike; pid?: number } = {}) {
  return composeAgent(config, {
    soul: SOUL,
    hardware: fakeHardware,
    localRuntime: noLocalRuntime,
    ...(options.main ? { main: options.main } : {}),
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
  });
}

export function testJobs(config: UtilityConfig, pid?: number) {
  return composeJobs(config, {
    jobs: COUNT_JOBS,
    ...(pid !== undefined ? { pid } : {}),
  });
}

/** What fakeHost runs for each process. */
export const testRoots =
  (name: string): ComposeUtility =>
  (config, main) =>
    name === 'agent'
      ? testAgent(config, main ? { main } : {})
      : name === 'jobs'
        ? testJobs(config)
        : composeStub(config);
