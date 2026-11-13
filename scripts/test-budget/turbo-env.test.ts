// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';

interface PlannedTask {
  task: string;
  hash: string;
  environmentVariables: { specified: { env: string[] }; configured: string[] };
}

const root = join(import.meta.dirname, '..', '..');
const tasks = ['test', 'test:coverage'];
let fixture: string;

/** Ask Turbo itself: strict env filtering and cache invalidation must both preserve an explicit test fixture. */
function planned(cores: string, toolchain: string, sfxWork: string): PlannedTask[] {
  const result = spawnSync(
    join(root, 'node_modules/.bin/turbo'),
    ['run', ...tasks, '--filter=@taalcut/test-budget-probe', '--dry=json'],
    {
      cwd: fixture,
      env: {
        ...process.env,
        TAALCUT_TEST_CORES: cores,
        TAALCUT_SHELL_TOOLCHAIN_DIR: toolchain,
        TAALCUT_SFX_BANK_WORK: sfxWork,
      },
      encoding: 'utf8',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const dry = JSON.parse(result.stdout) as { tasks: PlannedTask[] };
  return dry.tasks.filter((task) => tasks.includes(task.task)).sort((a, b) => a.task.localeCompare(b.task));
}

let baseline: PlannedTask[];
beforeAll(() => {
  // Preserve the real task configuration while keeping the hash scan independent of repository size and load.
  fixture = mkdtempSync(join(tmpdir(), 'taalcut-turbo-env-'));
  const packageDir = join(fixture, 'packages/probe');
  mkdirSync(packageDir, { recursive: true });
  const { packageManager } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager: string;
  };
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, packageManager }));
  writeFileSync(join(fixture, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(
    join(fixture, 'pnpm-lock.yaml'),
    'lockfileVersion: "9.0"\nimporters:\n  .: {}\n  packages/probe: {}\n',
  );
  writeFileSync(join(fixture, 'turbo.json'), readFileSync(join(root, 'turbo.json')));
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: '@taalcut/test-budget-probe',
      scripts: { test: 'node --version', 'test:coverage': 'node --version' },
    }),
  );
  baseline = planned('1', '/tmp/taalcut-test-toolchain-a', '/tmp/taalcut-test-sfx-a');
});
afterAll(() => {
  if (fixture) rmSync(fixture, { recursive: true, force: true });
});

it('passes the allocation and explicit fixtures into both strict-mode test tasks', () => {
  expect(baseline.map((task) => task.task)).toEqual(tasks);
  for (const task of baseline) {
    expect(task.environmentVariables.specified.env).toEqual(
      expect.arrayContaining(['TAALCUT_TEST_CORES', 'TAALCUT_SHELL_TOOLCHAIN_DIR', 'TAALCUT_SFX_BANK_WORK']),
    );
    expect(task.environmentVariables.configured).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^TAALCUT_TEST_CORES=/),
        expect.stringMatching(/^TAALCUT_SHELL_TOOLCHAIN_DIR=/),
        expect.stringMatching(/^TAALCUT_SFX_BANK_WORK=/),
      ]),
    );
  }
});

it.for([
  ['2', '/tmp/taalcut-test-toolchain-a', '/tmp/taalcut-test-sfx-a'],
  ['1', '/tmp/taalcut-test-toolchain-b', '/tmp/taalcut-test-sfx-a'],
  ['1', '/tmp/taalcut-test-toolchain-a', '/tmp/taalcut-test-sfx-b'],
])(
  'invalidates cached test results for allocation %s, toolchain %s and SFX work %s',
  ([cores, toolchain, sfxWork]) => {
    const changed = planned(cores!, toolchain!, sfxWork!);
    expect(changed).toHaveLength(baseline.length);
    for (const [i, task] of changed.entries()) expect(task.hash).not.toBe(baseline[i]!.hash);
  },
);
