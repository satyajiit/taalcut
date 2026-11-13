// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Behavioural checks on the release build: the fuses don't just read "off",
 * they stop the attacks they exist for, and a tampered app.asar won't start.
 *
 * Each launch adds --remote-debugging-port, which the release build's flag
 * guard refuses with exit code 1 and a message. Seeing that message proves
 * Taalcut's own main script ran (rather than Node running the attacker's
 * script), and the app exits without opening a window.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { assertPackaged, PACKAGED_UNAVAILABLE, RELEASE_APP, startPackaged } from './packaged-app';

const REFUSAL = /refusing to start with .*--remote-debugging-port \(/;
let scratch: string;

test.skip(Boolean(PACKAGED_UNAVAILABLE), PACKAGED_UNAVAILABLE);
test.beforeAll(() => {
  assertPackaged(RELEASE_APP);
  scratch = mkdtempSync(join(tmpdir(), 'taalcut-hardening-'));
});

test.afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A script that leaves a marker file if Node ever runs it. */
function markerScript(name: string): { script: string; marker: string } {
  const marker = join(scratch, `${name}.ran`);
  const script = join(scratch, `${name}.cjs`);
  writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  return { script, marker };
}

test('ELECTRON_RUN_AS_NODE does not turn the app into Node (RunAsNode off)', async () => {
  const { script, marker } = markerScript('run-as-node');
  const app = startPackaged(RELEASE_APP, {
    args: [script, '--remote-debugging-port=0'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  try {
    expect(await app.exitWithin(10_000)).toBe(1);
    expect(app.stderr()).toMatch(REFUSAL);
    expect(existsSync(marker)).toBe(false);
  } finally {
    await app.stop();
  }
});

test('NODE_OPTIONS and --inspect are ignored (NodeOptions and NodeCliInspect off)', async () => {
  const { script, marker } = markerScript('node-options');
  const app = startPackaged(RELEASE_APP, {
    args: ['--inspect=0', '--inspect-brk=0', '--remote-debugging-port=0'],
    env: { ...process.env, NODE_OPTIONS: `--require ${script}` },
  });
  try {
    expect(await app.exitWithin(10_000)).toBe(1);
    expect(app.stderr()).toMatch(REFUSAL);
    expect(existsSync(marker)).toBe(false);
    expect(app.stderr()).not.toContain('Debugger listening');
  } finally {
    await app.stop();
  }
});

test('a tampered app.asar refuses to start (ASAR integrity)', async () => {
  // An APFS clone (cp -c) costs no disk until a block is written.
  const clone = join(scratch, 'Taalcut.app');
  execFileSync('cp', ['-cR', RELEASE_APP, clone]);
  const asar = join(clone, 'Contents', 'Resources', 'app.asar');
  const bytes = readFileSync(asar);
  const at = bytes.indexOf('index.html');
  expect(at).toBeGreaterThan(0);
  bytes[at] = 'X'.charCodeAt(0);
  writeFileSync(asar, bytes);

  const app = startPackaged(clone);
  const exit = await app.exitWithin(10_000);
  await app.stop();
  expect(exit).not.toBe('still running');
  expect(app.stderr()).toContain('Integrity check failed for asar archive');
});
