// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the indexing tests' child processes share: a line on stdout, written whole before a SIGKILL can cut it. */
import { writeSync } from 'node:fs';

export function say(line: string): void {
  const bytes = Buffer.from(`${line}\n`);
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(1, bytes, offset);
}
