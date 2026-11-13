// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the scripts run. Each exports `main(argv)`; anything below it that refuses the run calls `stop` with the
 * lines to report. The workflows start a script with `node scripts/<name>.mjs …` (`runIfDirect`: the lines go
 * to stderr, and the exit code is 1); the tests call `run` in their own process, so a test does not start node
 * for each run.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** A refused run, and what it reports. */
class Stop extends Error {
  /** @param {string[]} lines */
  constructor(lines) {
    super(lines.join('\n'));
    this.lines = lines;
  }
}

/**
 * Ends the run with exit code 1, reporting `lines`.
 * @param {...string} lines
 * @returns {never}
 */
export function stop(...lines) {
  throw new Stop(lines);
}

/**
 * Runs `main(argv)`: its exit code, and the lines it reported.
 * @param {(argv: string[]) => void} main
 * @param {string[]} argv
 * @returns {{ status: 0 | 1, lines: string[] }}
 */
export function run(main, argv) {
  try {
    main(argv);
    return { status: 0, lines: [] };
  } catch (error) {
    if (error instanceof Stop) return { status: 1, lines: error.lines };
    throw error;
  }
}

/**
 * Runs `main` as the process when `moduleUrl` is the file node was started with.
 * @param {string} moduleUrl
 * @param {(argv: string[]) => void} main
 */
export function runIfDirect(moduleUrl, main) {
  const invoked = process.argv[1];
  if (!invoked || realpathSync(invoked) !== realpathSync(fileURLToPath(moduleUrl))) return;
  const { status, lines } = run(main, process.argv.slice(2));
  for (const line of lines) console.error(line);
  process.exitCode = status;
}
