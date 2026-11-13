// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { TEST_CORES_ENV } from './cores.ts';

const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('gives the scripts Vitest runner its allocated worker limit', async () => {
  vi.stubEnv(TEST_CORES_ENV, '1');
  vi.resetModules();
  const { default: config } = await import('../vitest.config.ts');
  expect(config.test?.maxWorkers).toBe(1);
});

it('runs every Node test file without overlapping files when allocated one core', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-script-budget-'));
  dirs.push(dir);
  const events = join(dir, 'events.jsonl');
  const files = ['a', 'b', 'c'].map((id) => {
    const file = join(dir, `${id}.test.mjs`);
    writeFileSync(
      file,
      `import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
test(${JSON.stringify(id)}, async () => {
  appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(`${id}:start\n`)});
  await setTimeout(100);
  appendFileSync(${JSON.stringify(events)}, ${JSON.stringify(`${id}:end\n`)});
});\n`,
    );
    return file;
  });
  const run = spawnSync(process.execPath, [join(import.meta.dirname, 'node.mjs'), ...files], {
    env: { ...process.env, [TEST_CORES_ENV]: '1' },
    encoding: 'utf8',
  });
  expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
  const lines = readFileSync(events, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(6);
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^[abc]:start$/);
    expect(lines[i + 1]).toBe(lines[i]!.replace(':start', ':end'));
  }
  expect(new Set(lines.filter((line) => line.endsWith(':end'))).size).toBe(3);
});

it('refuses an invalid Node script allocation before starting tests', () => {
  const run = spawnSync(process.execPath, [join(import.meta.dirname, 'node.mjs'), 'missing.test.mjs'], {
    env: { ...process.env, [TEST_CORES_ENV]: '0' },
    encoding: 'utf8',
  });
  expect(run.status).toBe(2);
  expect(run.stderr).toContain(`${TEST_CORES_ENV} must be a whole number of cores`);
  expect(run.stderr).not.toContain('missing.test.mjs');
});
