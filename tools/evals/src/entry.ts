// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { pathToFileURL } from 'node:url';

/** True when this module is the process entry, so importing it from tests does not exit. */
export function isDirectRun(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === pathToFileURL(entry).href;
}

/** pnpm run forwards a leading `--` before the script's own flags. */
export function cliArgs(argv: string[]): string[] {
  return argv[0] === '--' ? argv.slice(1) : argv;
}
