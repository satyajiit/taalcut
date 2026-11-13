// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { main as buildIndex } from '../scripts/build-index.mjs';
import { run } from '../scripts/lib/cli.mjs';
import { main as moderate } from '../scripts/moderate.mjs';
import { main as validate } from '../scripts/validate.mjs';

export const SCRIPTS = { 'build-index.mjs': buildIndex, 'moderate.mjs': moderate, 'validate.mjs': validate };

/**
 * A script run as the workflows run it, `node scripts/<name> …args`, but in this process: its exit code and
 * what it wrote to stderr. Starting node for each run made every test wait on process start-up, half a second
 * and more under load (cli.test.ts starts each script once).
 */
export function runScript(name: keyof typeof SCRIPTS, args: string[]): { status: number; stderr: string } {
  const { status, lines } = run(SCRIPTS[name], args);
  return { status, stderr: lines.map((line) => `${line}\n`).join('') };
}

/**
 * The suites whose tests start processes: git (build-index asks it for each template's times) or
 * node. On the dev Mac under a full parallel load, starting a process takes from a few hundred
 * milliseconds to about 6 s (UX2 round 2, beside other lanes' tests at load 25 to 35; about 20 ms
 * idle), and a test here starts up to seven, so Vitest's 5 s default doesn't tell a hang from a busy
 * machine for them. Tests that start nothing keep it.
 */
export const STARTS_PROCESSES = { timeout: 60_000 };

export function tempHub(): string {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-hub-'));
  mkdirSync(join(root, 'moderation'), { recursive: true });
  mkdirSync(join(root, 'templates'), { recursive: true });
  writeFileSync(join(root, 'moderation', 'hidden.json'), '[]\n');
  return root;
}

export function writeRel(root: string, rel: string, contents: string | Buffer): void {
  const absolute = join(root, rel);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

export function withHub(body: (root: string) => void): void {
  const root = tempHub();
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A JSON file under `root`, read back as the type the test expects of it. */
export function readJson<T>(root: string, rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
}
