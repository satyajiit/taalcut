// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs the Apple tools packaging needs (codesign, ditto, notarytool, stapler)
 * without a shell. Injected everywhere, so the hooks are unit-tested with a
 * fake.
 */
import { spawnSync } from 'node:child_process';

export interface CommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type Run = (command: string, args: readonly string[]) => CommandResult;

export const runCommand: Run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || (result.error ? String(result.error) : ''),
  };
};

/** Runs a command and returns its stdout, or throws with its stderr. */
export function runChecked(run: Run, command: string, args: readonly string[], what: string): string {
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`${what} failed (${command} exited ${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout;
}
