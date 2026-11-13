// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the compile sweep asks macOS (IX3-B6): the OS build Core ML names its cache folder after, and whether any mac
 * helper runs now (this app's, another Taalcut's, a development build's: they share one cache, and a running one may
 * be reading or writing it). Both from the system's own tools, their output checked before use.
 */
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';

const run = promisify(execFile);
const HELPER_PROCESS = 'taalcut-mac-helper';
const buildSchema = z.string().regex(/^[0-9A-Za-z]{3,16}$/);

export interface SweepProbes {
  /** `kern.osversion` (25G241), or null when it can't be read. */
  osBuild(): Promise<string | null>;
  helperRunning(): Promise<boolean>;
}

/** Whether `ps -axo comm=` output lists the mac helper. */
export const listsHelper = (psOutput: string): boolean =>
  psOutput.split('\n').some((line) => basename(line.trim()) === HELPER_PROCESS);

export function macProbes(): SweepProbes {
  return {
    async osBuild() {
      const { stdout } = await run('sysctl', ['-n', 'kern.osversion']);
      const parsed = buildSchema.safeParse(stdout.trim());
      return parsed.success ? parsed.data : null;
    },
    async helperRunning() {
      const { stdout } = await run('ps', ['-axo', 'comm=']);
      return listsHelper(stdout);
    },
  };
}
