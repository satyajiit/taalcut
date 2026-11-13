// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Test builds only: main's console lines and each utility process's stderr, appended as they arrive to
 * `<TAALCUT_TEST_LOG_DIR>/<process>.log` (main.log, jobs.log, agent.log, …), each line stamped with the time.
 * The e2e launcher (e2e/launch.ts) points the folder into the test's output, so a failure's artifacts hold what
 * every process said, even when the app hangs or is killed: the ring the debug bundle keeps lives in main's
 * memory and holds only the last 500 lines of each utility. index.ts reaches this module only inside
 * `__TAALCUT_FLAVOUR__ === 'test'` through import().
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { onProcessOutput } from './debug/log-ring';

export const TEST_LOG_DIR_ENV = 'TAALCUT_TEST_LOG_DIR';

export interface ProcessLogDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Appends text to a file. Default: the file system. */
  readonly append?: (path: string, text: string) => void;
  readonly now?: () => Date;
}

/** Each line of `text`, stamped; a chunk's trailing partial line is written as a line of its own. */
export function stampedLines(text: string, at: Date): string {
  const stamp = at.toISOString();
  return text
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `${stamp} ${line}\n`)
    .join('');
}

/** Starts writing when the variable names a folder; returns the stop, or null when it is unset. */
export function writeProcessLogs(deps: ProcessLogDeps): (() => void) | null {
  const dir = deps.env[TEST_LOG_DIR_ENV]?.trim();
  if (!dir) return null;
  mkdirSync(dir, { recursive: true });
  const append = deps.append ?? appendFileSync;
  const now = deps.now ?? (() => new Date());
  const stop = onProcessOutput((source, text) => {
    const lines = stampedLines(text, now());
    if (lines.length === 0) return;
    try {
      append(join(dir, `${source.replace(/[^a-z0-9-]/gi, '_')}.log`), lines);
    } catch (cause) {
      // The folder went away (the test removed it): stop, once, and say so where it can't loop back here.
      stop();
      process.stderr.write(`[test-logs] stopped writing to ${dir}: ${String(cause)}\n`);
    }
  });
  return stop;
}
